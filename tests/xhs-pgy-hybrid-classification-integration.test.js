const assert = require('node:assert/strict');
const test = require('node:test');

const reportModel = require('../xhs/report-model');

function searchFact(keyword, options = {}) {
  return {
    noteId: options.noteId || 'hybrid-note-1',
    title: options.title || '家具选购指南',
    spuName: options.spuName || '床垫',
    publishDate: '2030-01-01',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [{ keyword, impressions: 100, reads: 20, clickRate: 0.2 }],
  };
}

test('store facts override industry competitor dictionaries and explicit product facts disable generic SPU ownership', () => {
  const options = {
    profileId: 'home-furnishing-v1',
    ownBrandTerms: ['顾家', '顾家家居'],
    ownProductTerms: ['深睡床垫 M1'],
    competitorTerms: ['慕思'],
    factsConfigured: true,
  };
  const owned = reportModel.aggregatePgySearchKeywords([
    searchFact('顾家床垫怎么样'),
  ], options).keywords[0];
  assert.equal(owned.commercialCategory, '自有品牌词');
  assert.match(owned.classificationReason, /顾家/);

  const generic = reportModel.aggregatePgySearchKeywords([
    searchFact('床垫', { spuName: '床垫' }),
  ], options).keywords[0];
  assert.equal(generic.commercialCategory, '核心品类词');
  assert.notEqual(generic.commercialCategory, '自有产品词');
});

test('an archived hybrid result overlays legacy dimensions without changing keyword metrics', () => {
  const classificationV2 = {
    schemaVersion: 2,
    entity: {
      relation: 'generic_category', label: '泛品类', matchedTerm: '鱼油',
      source: 'rule', lockedByFact: false,
    },
    topicTags: [
      { id: 'core_category', label: '核心品类', source: 'qwen', evidence: [] },
      { id: 'safety_adverse_effect', label: '安全/副作用', source: 'qwen', evidence: [] },
    ],
    intents: [
      { id: 'category_exploration', label: '品类探索', source: 'qwen', isPrimary: true },
      { id: 'purchase_decision', label: '购买决策', source: 'qwen', isPrimary: true },
    ],
    relevance: { id: 'strong', label: '强相关', source: 'hybrid' },
    source: 'hybrid',
    confidenceScore: 0.88,
    needsReview: false,
    reasonCodes: ['QWEN_SEMANTIC_ENRICHED'],
  };
  const result = reportModel.aggregatePgySearchKeywords([
    searchFact('鱼油副作用值得买吗', {
      title: '鱼油营养补充指南', spuName: '深海鱼油软胶囊',
    }),
  ], {
    profileId: 'health-supplements-v1',
    classificationArchive: {
      schema: 'xhsSearchClassificationArchiveV1',
      schemaVersion: 1,
      entries: [{
        normalizedKeyword: '鱼油副作用值得买吗',
        scopeKey: '',
        effective: classificationV2,
      }],
    },
  });
  const row = result.keywords[0];

  assert.equal(row.commercialCategory, '品类需求词');
  assert.equal(row.relevance, '强相关');
  assert.equal(row.intent, '购买决策');
  assert.equal(row.impressions, 100);
  assert.equal(row.reads, 20);
  assert.equal(row.classificationV2.topicTags.length, 1);
  assert.equal(row.classificationV2.intents.length, 1);
  assert.equal(row.classificationV2.topicTags[0].id, 'safety_adverse_effect');
  assert.equal(row.classificationV2.intents[0].id, 'purchase_decision');
  assert.equal(row.classificationV2.intents[0].isPrimary, true);
  assert.equal(row.classificationSource, 'hybrid');
  assert.equal(row.needsReview, false);
});

test('hybrid keyword filters link topic tag, source and review status with legacy dimensions', () => {
  const rows = [
    {
      keyword: '鱼油副作用', commercialCategory: '核心品类词', relevance: '强相关',
      intent: '问题解决', impressions: 100, reads: 20, noteCount: 1,
      classificationSource: 'qwen', needsReview: false,
      classificationV2: { topicTags: [{ id: 'safety_adverse_effect' }] },
    },
    {
      keyword: '鱼油', commercialCategory: '核心品类词', relevance: '强相关',
      intent: '品类探索', impressions: 50, reads: 5, noteCount: 1,
      classificationSource: 'rule', needsReview: true,
      classificationV2: { topicTags: [{ id: 'core_category' }] },
    },
  ];
  const filtered = reportModel.filterPgySearchKeywords(rows, {
    commercialCategory: '核心品类词',
    topicTagId: 'safety_adverse_effect',
    classificationSource: 'qwen',
    reviewRequired: false,
  });

  assert.deepEqual(filtered.keywords.map((row) => row.keyword), ['鱼油副作用']);
  assert.equal(filtered.total.keywordCount, 1);
  assert.equal(filtered.total.impressions, 100);
});
