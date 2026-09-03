const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');

let reportModelApi;
let reportModelLoadError;
try {
  reportModelApi = require('../xhs/report-model');
} catch (error) {
  reportModelLoadError = error;
}

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-03-31',
  timezone: 'Asia/Shanghai',
});

function reportModel() {
  if (reportModelLoadError) {
    assert.fail(`xhs/report-model.js must expose the PGY v3 report API: ${reportModelLoadError.message}`);
  }
  assert.equal(
    typeof reportModelApi.aggregatePgyFacts,
    'function',
    'XhsReportModel.aggregatePgyFacts must be available to recalculate archived PGY facts'
  );
  return reportModelApi;
}

function pgyFact({
  id,
  publishDate,
  followerCount,
  authorId,
  cooperation,
  platformFee,
  impressions,
  reads,
  interactions,
  taobaoTaskId = null,
  taskEndDate = null,
  spus = [],
  noteUrl = null,
  spuName = null,
  crossDomainProjectName = null,
  taobaoSamplingRatio = null,
  taobao15d = null,
  searchKeywords = [],
  searchKeywordFetchStatus = 'empty',
  searchKeywordErrorCode,
}) {
  return {
    noteId: `fictional-pgy-v3-note-${id}`,
    sourceKey: `fictional-pgy-v3-cooperation-${id}`,
    title: `虚构蒲公英 V3 笔记 ${id}`,
    noteUrl,
    publishDate,
    spuName,
    crossDomainProjectName,
    taobaoSamplingRatio,
    spus,
    taobaoTaskId,
    taskEndDate,
    searchKeywords,
    searchKeywordFetchStatus,
    ...(searchKeywordErrorCode ? { searchKeywordErrorCode } : {}),
    author: {
      id: authorId || `fictional-pgy-v3-creator-${id}`,
      name: `虚构蒲公英 V3 达人 ${id}`,
      followerCount,
    },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: {
      impressions,
      reads,
      interactions,
      taobaoOffsiteActiveUv15d: taobao15d ? taobao15d.taobaoOffsiteActiveUv15d : null,
      taobaoOffsiteActiveCost15d: taobao15d ? taobao15d.taobaoOffsiteActiveCost15d : null,
      taobaoDealUv15d: taobao15d ? taobao15d.taobaoDealUv15d : null,
      taobaoAddCartUv15d: taobao15d ? taobao15d.taobaoAddCartUv15d : null,
      taobaoAddCartRate15d: taobao15d ? taobao15d.taobaoAddCartRate15d : null,
      taobaoPurchaseRate15d: taobao15d ? taobao15d.taobaoPurchaseRate15d : null,
    },
  };
}

function reportFacts() {
  return [
    pgyFact({
      id: 'before', publishDate: '2029-12-31', followerCount: 4999,
      taobaoTaskId: 'fictional-taobao-task-before', taskEndDate: '2029-12-30',
      cooperation: 800, platformFee: 80, impressions: 8000, reads: 800, interactions: 80,
    }),
    pgyFact({
      id: 'below-1k-start-boundary', publishDate: '2030-01-01', followerCount: 999,
      taobaoTaskId: 'fictional-taobao-task-start-boundary',
      cooperation: 10, platformFee: 100, impressions: 100, reads: 10, interactions: 1,
      searchKeywordFetchStatus: 'complete',
      searchKeywords: [{
        keyword: '虚构归档搜索词', impressions: 100, reads: 10, clickRate: 0.1,
      }],
    }),
    pgyFact({
      id: '1k', publishDate: '2030-01-15', followerCount: 1000,
      authorId: 'fictional-pgy-v3-repeat-creator',
      taobaoTaskId: 'fictional-taobao-task-1k', taskEndDate: '2030-01-31',
      cooperation: 20, platformFee: 200, impressions: 100, reads: 90, interactions: 9,
      searchKeywordFetchStatus: 'failed',
    }),
    pgyFact({
      id: '4999-repeat', publishDate: '2030-01-20', followerCount: 4999,
      authorId: 'fictional-pgy-v3-repeat-creator',
      cooperation: 25, platformFee: 250, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyFact({
      id: '5k', publishDate: '2030-01-31', followerCount: 5000,
      taobaoTaskId: 'fictional-taobao-task-5k', taskEndDate: '2030-04-20',
      cooperation: 30, platformFee: 300, impressions: 200, reads: 100, interactions: 20,
    }),
    pgyFact({
      id: '10k', publishDate: '2030-03-01', followerCount: 10000,
      cooperation: 40, platformFee: 400, impressions: 200, reads: 50, interactions: 5,
    }),
    pgyFact({
      id: '100k', publishDate: '2030-03-15', followerCount: 100000,
      taobaoTaskId: 'fictional-taobao-task-100k', taskEndDate: '2030-03-31',
      cooperation: 50, platformFee: 500, impressions: 100, reads: 50, interactions: 5,
    }),
    pgyFact({
      id: 'unknown-followers', publishDate: '2030-03-20', followerCount: null,
      cooperation: 70, platformFee: 700, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyFact({
      id: '500k-end-boundary', publishDate: '2030-03-31', followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-500k', taskEndDate: '2030-04-21',
      cooperation: 60, platformFee: 600, impressions: 300, reads: 100, interactions: 20,
    }),
    pgyFact({
      id: 'after', publishDate: '2030-04-01', followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-after', taskEndDate: '2030-01-01',
      cooperation: 900, platformFee: 90, impressions: 9000, reads: 900, interactions: 90,
    }),
    pgyFact({
      id: 'invalid-date', publishDate: null, followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-invalid-date', taskEndDate: '2030-01-01',
      cooperation: 1000, platformFee: 100, impressions: 10000, reads: 1000, interactions: 100,
    }),
    pgyFact({
      id: 'missing-date', publishDate: null, followerCount: 500000,
      cooperation: 1100, platformFee: 110, impressions: 11000, reads: 1100, interactions: 110,
    }),
  ];
}

function aggregateFixture() {
  return reportModel().aggregatePgyFacts({
    facts: reportFacts(),
    dateRange: RANGE,
    asOf: '2030-04-20',
  });
}

function pgyCollection(facts) {
  return {
    schemaVersion: 1,
    platform: 'pgy',
    runId: 'fictional-pgy-v3-run',
    accountKey: 'fictional-pgy-v3-account',
    dateRange: { ...RANGE },
    dateBasis: 'note_publish_time',
    collectionScope: 'all_available',
    latestPublishDate: '2030-04-01',
    startedAt: '2030-04-20T00:00:00.000Z',
    finishedAt: '2030-04-20T00:01:00.000Z',
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      accountKey: 'fictional-pgy-v3-account',
      brandUserId: 'fictional-pgy-v3-brand-user',
      brandUserName: '虚构蒲公英 V3 品牌账户',
    },
    notes: facts.map((fact) => ({
      ...structuredClone(fact),
      rawBusinessResponse: `fictional-large-raw-response-${fact.noteId}`,
    })),
    reconciliation: {
      reconciled: true,
      expectedCount: facts.length,
      receivedCount: facts.length,
      uniqueCount: facts.length,
      duplicateCount: 0,
      cooperationCost: facts.reduce((sum, fact) => sum + fact.costs.cooperation, 0),
      platformFee: facts.reduce((sum, fact) => sum + fact.costs.platformFee, 0),
      issues: [],
    },
    warnings: [],
    errors: [],
  };
}

test('analysis archives every all-available PGY row as compact facts while keeping the task range as the default aggregate', () => {
  const facts = reportFacts();
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-v3-run',
    storeId: 'fictional-pgy-v3-store',
    selectedPlatforms: ['pgy'],
    dateRange: { ...RANGE },
    generatedAt: '2030-04-20T00:02:00.000Z',
    asOf: '2030-04-20',
    collections: { pgy: pgyCollection(facts) },
  });

  assert.equal(snapshot.pgy.collectionScope, 'all_available');
  assert.deepEqual(snapshot.pgy.facts, facts);
  assert.equal(snapshot.pgy.noteCount, 8, 'the default summary still uses the task publication range');
  assert.deepEqual(snapshot.pgy.costs, {
    cooperation: 305,
    platformFee: 3050,
    total: 3355,
  });
  assert.doesNotMatch(JSON.stringify(snapshot.pgy.facts), /fictional-large-raw-response/);
});

test('PGY overdue notes compare task end dates with the current report date, never the collection date', () => {
  const facts = [pgyFact({
    id: 'collection-date', publishDate: '2030-01-15', followerCount: 5000,
    cooperation: 10, platformFee: 1, impressions: 100, reads: 10, interactions: 1,
    taskEndDate: '2030-04-20',
  })];
  const collection = pgyCollection(facts);
  collection.finishedAt = '2030-04-21T00:30:00.000Z';
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-collection-date-run',
    storeId: 'fictional-pgy-collection-date-store',
    selectedPlatforms: ['pgy'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    generatedAt: '2030-04-20T12:00:00.000Z',
    collections: { pgy: collection },
  });

  assert.equal(snapshot.pgy.asOf, '2030-04-20');
  assert.equal(snapshot.pgy.overdueNoteCount, 0,
    'collection completion time must not advance the overdue cutoff beyond the current report date');
});

test('aggregatePgyFacts applies an inclusive publication-date range and recomputes costs and KPIs', () => {
  const result = aggregateFixture();

  assert.equal(result.noteCount, 8);
  assert.equal(result.reportedNoteCount, 8);
  assert.equal(result.starTaskNoteCount, 5);
  assert.equal(result.overdueNoteCount, 2);
  assert.deepEqual(result.excluded, { invalidPublishDate: 2, outsideRange: 2 });
  assert.deepEqual(result.costs, {
    cooperation: 305,
    platformFee: 3050,
    total: 3355,
  });
  assert.deepEqual(result.metrics, {
    impressions: 1000,
    reads: 400,
    interactions: 60,
    readRate: 0.4,
    engagementRate: 0.15,
  });
});

test('aggregatePgySearchKeywords applies sheba-cat-food-v1 and returns dimension summaries with note drilldowns', () => {
  const officialUrl = 'https://www.xiaohongshu.com/explore/fictional-pgy-v3-note-keyword-a?xsec_token=fictional&xsec_source=pc_pgyexport';
  const result = reportModel().aggregatePgySearchKeywords([
    pgyFact({
      id: 'keyword-a', publishDate: '2030-01-05', followerCount: 5000,
      cooperation: 100, platformFee: 10, impressions: 100, reads: 20, interactions: 2,
      noteUrl: officialUrl,
      searchKeywordFetchStatus: 'complete',
      searchKeywords: [
        { keyword: '希宝主食罐头推荐', impressions: 100, reads: 20, clickRate: 0.2 },
        { keyword: '猫砂盆推荐', impressions: 50, reads: 5, clickRate: 0.1 },
      ],
    }),
    pgyFact({
      id: 'keyword-b', publishDate: '2030-01-06', followerCount: 5000,
      cooperation: 200, platformFee: 20, impressions: 300, reads: 90, interactions: 9,
      searchKeywordFetchStatus: 'complete',
      searchKeywords: [
        { keyword: '希宝主食罐头推荐', impressions: 300, reads: 90, clickRate: 0.3 },
      ],
    }),
  ]);

  assert.equal(result.profile.id, 'sheba-cat-food-v1');
  assert.equal(result.totalKeywordCount, 2);
  const owned = result.keywords.find((row) => row.keyword === '希宝主食罐头推荐');
  assert.equal(owned.commercialCategory, '自有品牌词');
  assert.equal(owned.relevance, '强相关');
  assert.equal(owned.intent, '对比评估');
  assert.equal(owned.impressions, 400);
  assert.equal(owned.reads, 110);
  assert.equal(owned.clickRate, 0.275);
  assert.equal(owned.noteCount, 2);
  assert.deepEqual(owned.notes.map((note) => note.noteId), [
    'fictional-pgy-v3-note-keyword-b',
    'fictional-pgy-v3-note-keyword-a',
  ]);
  assert.equal(owned.notes[1].noteUrl, officialUrl);
  assert.equal(owned.notes[0].impressionContribution, 0.75);
  assert.equal(owned.notes[1].impressionContribution, 0.25);

  const commercial = result.summaries.commercialCategory;
  const ownedSummary = commercial.rows.find((row) => row.value === '自有品牌词');
  assert.deepEqual({
    keywordCount: ownedSummary.keywordCount,
    impressions: ownedSummary.impressions,
    reads: ownedSummary.reads,
    clickRate: ownedSummary.clickRate,
    noteCount: ownedSummary.noteCount,
  }, {
    keywordCount: 1,
    impressions: 400,
    reads: 110,
    clickRate: 0.275,
    noteCount: 2,
  });
  assert.equal(result.summaries.relevance.rows[0].value, '强相关');
  assert.equal(result.summaries.intent.rows[0].value, '对比评估');
});

test('analysis and keyword aggregation preserve real searchScore while missing heat stays null', () => {
  const facts = [
    pgyFact({
      id: 'search-heat-real', publishDate: '2030-01-05', followerCount: 5000,
      cooperation: 100, platformFee: 10, impressions: 100, reads: 20, interactions: 2,
      searchKeywordFetchStatus: 'complete',
      searchKeywords: [
        { keyword: '虚构有搜索热度词', searchScore: 8765, impressions: 90, reads: 18 },
        { keyword: '虚构缺失搜索热度词', impressions: 80, reads: 8765 },
      ],
    }),
    pgyFact({
      id: 'search-heat-repeat', publishDate: '2030-01-06', followerCount: 5000,
      cooperation: 100, platformFee: 10, impressions: 100, reads: 20, interactions: 2,
      searchKeywordFetchStatus: 'complete',
      searchKeywords: [
        { keyword: '虚构有搜索热度词', searchScore: 8765, impressions: 10, reads: 2 },
      ],
    }),
  ];
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-search-heat-run',
    storeId: 'fictional-pgy-search-heat-store',
    selectedPlatforms: ['pgy'],
    dateRange: { ...RANGE },
    generatedAt: '2030-04-20T00:02:00.000Z',
    asOf: '2030-04-20',
    collections: { pgy: pgyCollection(facts) },
  });

  assert.equal(snapshot.pgy.facts[0].searchKeywords[0].searchScore, 8765,
    '真实搜索热度必须进入紧凑归档事实');
  const result = reportModel().aggregatePgySearchKeywords(snapshot.pgy.facts);
  const withHeat = result.keywords.find((row) => row.keyword === '虚构有搜索热度词');
  const withoutHeat = result.keywords.find((row) => row.keyword === '虚构缺失搜索热度词');
  assert.equal(withHeat.searchScore, 8765,
    '同词多篇笔记的全站搜索热度不得求和');
  assert.equal(withoutHeat.searchScore, null,
    '未采集搜索热度时必须保持 null，不得回退到阅读量');
});

test('legacy keyword classification uses brand then competitor then product priority', () => {
  const result = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-commercial-priority-note',
    title: '希宝与皇家主食罐头对比',
    spuName: '主食罐头',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [
      { keyword: '希宝皇家主食罐头', impressions: 30, reads: 6 },
      { keyword: '皇家主食罐头', impressions: 20, reads: 4 },
      { keyword: '主食罐头', impressions: 10, reads: 2 },
    ],
  }], { profileId: 'sheba-cat-food-v1' });

  const categories = Object.fromEntries(result.keywords.map((row) => [
    row.keyword, row.commercialCategory,
  ]));
  assert.deepEqual(categories, {
    '希宝皇家主食罐头': '自有品牌词',
    '皇家主食罐头': '竞品词',
    '主食罐头': '自有产品词',
  });
});

test('aggregatePgySearchKeywords returns all 1005 aggregated words by default without truncation', () => {
  const searchKeywords = Array.from({ length: 1005 }, (_, index) => ({
    keyword: `虚构全量聚合词-${String(index + 1).padStart(4, '0')}`,
    impressions: index + 1,
    reads: 1,
    clickRate: 1 / (index + 1),
  }));
  const result = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-all-keywords-note',
    title: '虚构全量搜索词笔记',
    searchKeywordFetchStatus: 'complete',
    searchKeywords,
  }]);

  assert.equal(result.totalKeywordCount, 1005);
  assert.equal(result.keywords.length, 1005,
    '默认报表必须返回全部聚合词，不得在 1000 条处截断');
  assert.equal(result.truncated, false);
  assert.equal(result.keywords[0].keyword, '虚构全量聚合词-1005');
  assert.equal(result.keywords.at(-1).keyword, '虚构全量聚合词-0001');
  assert.equal(result.summaries.commercialCategory.totalKeywords, 1005);
  assert.equal(result.summaries.commercialCategory.totalImpressions, 505515);
  assert.equal(result.summaries.commercialCategory.totalReads, 1005);
});

test('filterPgySearchKeywords applies three dimensions with AND semantics and recomputes weighted summaries', () => {
  const model = reportModel();
  assert.equal(typeof model.filterPgySearchKeywords, 'function',
    'XhsReportModel must expose one shared keyword-filter helper for online and offline reports');
  const keywords = [
    {
      keyword: '命中词 A', commercialCategory: '竞品词', relevance: '强相关', intent: '对比评估',
      impressions: 100, reads: 30, notes: [{ noteId: 'note-a' }],
    },
    {
      keyword: '命中词 B', commercialCategory: '竞品词', relevance: '强相关', intent: '对比评估',
      impressions: 300, reads: 60, notes: [{ noteId: 'note-b' }],
    },
    {
      keyword: '仅商业分类不匹配', commercialCategory: '自有产品词', relevance: '强相关', intent: '对比评估',
      impressions: 900, reads: 450, notes: [{ noteId: 'note-c' }],
    },
    {
      keyword: '仅相关度不匹配', commercialCategory: '竞品词', relevance: '中相关', intent: '对比评估',
      impressions: 800, reads: 320, notes: [{ noteId: 'note-d' }],
    },
    {
      keyword: '仅搜索意图不匹配', commercialCategory: '竞品词', relevance: '强相关', intent: '品类探索',
      impressions: 700, reads: 210, notes: [{ noteId: 'note-e' }],
    },
  ];

  const filtered = model.filterPgySearchKeywords(keywords, {
    commercialCategory: '竞品词',
    relevance: '强相关',
    intent: '对比评估',
  });

  assert.deepEqual(filtered.keywords.map((row) => row.keyword), ['命中词 A', '命中词 B'],
    '三个维度必须按 AND 取交集，任一维度不匹配的词都应排除');
  for (const dimension of ['commercialCategory', 'relevance', 'intent']) {
    assert.equal(filtered.summaries[dimension].totalKeywords, 2, `${dimension} 汇总词数`);
    assert.equal(filtered.summaries[dimension].totalImpressions, 400, `${dimension} 汇总曝光`);
    assert.equal(filtered.summaries[dimension].totalReads, 90, `${dimension} 汇总阅读`);
    assert.equal(filtered.summaries[dimension].totalClickRate, 0.225,
      `${dimension} 点击率必须用筛选后总阅读 / 总曝光加权重算`);
  }
});

test('analysis preserves bounded search-keyword failure codes and the report summarizes them', () => {
  const failedFact = pgyFact({
    id: 'keyword-failure-code', publishDate: '2030-01-05', followerCount: 5000,
    cooperation: 100, platformFee: 10, impressions: 100, reads: 20, interactions: 2,
    searchKeywordFetchStatus: 'failed',
    searchKeywordErrorCode: 'PGY_API_ERROR',
  });
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-search-failure-run',
    storeId: 'fictional-pgy-search-failure-store',
    selectedPlatforms: ['pgy'],
    dateRange: { ...RANGE },
    generatedAt: '2030-04-20T00:02:00.000Z',
    asOf: '2030-04-20',
    collections: { pgy: pgyCollection([failedFact]) },
  });

  assert.equal(snapshot.pgy.facts[0].searchKeywordErrorCode, 'PGY_API_ERROR');
  const searchSummary = reportModel().aggregatePgySearchKeywords(snapshot.pgy.facts);
  assert.deepEqual(searchSummary.coverage.failureCodeCounts, {
    PGY_API_ERROR: 1,
  });
});

test('aggregatePgySearchKeywords auto-selects furniture and supplement industry profiles', () => {
  const furniture = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-furniture-note',
    title: '小户型家具与护腰床垫选购',
    spuName: '护腰床垫',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [
      { keyword: '护腰床垫怎么选', impressions: 120, reads: 36, clickRate: 0.3 },
      { keyword: '小户型沙发推荐', impressions: 80, reads: 16, clickRate: 0.2 },
    ],
  }]);

  assert.equal(furniture.profile.id, 'home-furnishing-v1');
  assert.equal(furniture.keywords.find((row) => row.keyword === '护腰床垫怎么选').commercialCategory,
    '自有产品词');
  assert.equal(furniture.keywords.find((row) => row.keyword === '小户型沙发推荐').intent,
    '对比评估');
  assert.ok(furniture.keywords.every((row) => row.commercialCategory !== '泛宠物兴趣词'));

  const supplements = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-supplement-note',
    title: '日常营养补充与保健品科普',
    spuName: '深海鱼油软胶囊',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [
      { keyword: '深海鱼油什么时候吃', impressions: 100, reads: 25, clickRate: 0.25 },
      { keyword: '益生菌怎么选', impressions: 60, reads: 12, clickRate: 0.2 },
    ],
  }]);

  assert.equal(supplements.profile.id, 'health-supplements-v1');
  assert.equal(supplements.keywords.find((row) => row.keyword === '深海鱼油什么时候吃').commercialCategory,
    '自有产品词');
  assert.equal(supplements.keywords.find((row) => row.keyword === '深海鱼油什么时候吃').intent,
    '服用/使用');
  assert.ok(supplements.keywords.every((row) => row.commercialCategory !== '泛宠物兴趣词'));
});

test('furniture uses the Sheba-style priority and covers common desk, room and irrelevant terms', () => {
  const result = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-furniture-taxonomy-note',
    title: '三梦家具升降桌与书房布置',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [
      { keyword: '三梦乐歌升降桌', impressions: 60, reads: 12 },
      { keyword: '乐歌升降桌', impressions: 50, reads: 10 },
      { keyword: '电动升降桌', impressions: 40, reads: 8 },
      { keyword: '腰突', impressions: 30, reads: 6 },
      { keyword: '次卧电竞角', impressions: 20, reads: 4 },
      { keyword: '开放式耳机推荐', impressions: 10, reads: 2 },
    ],
  }], {
    profileId: 'home-furnishing-v1',
    ownBrandTerms: ['三梦'],
    factsConfigured: true,
  });
  const labels = Object.fromEntries(result.keywords.map((row) => [
    row.keyword, row.commercialCategory,
  ]));
  assert.deepEqual(labels, {
    '三梦乐歌升降桌': '自有品牌词',
    '乐歌升降桌': '竞品词',
    '电动升降桌': '核心品类词',
    '腰突': '品类需求词',
    '次卧电竞角': '邻近品类/场景',
    '开放式耳机推荐': '无关词',
  });
  assert.ok(result.keywords.every((row) => (
    typeof row.commercialCategory === 'string' &&
    typeof row.relevance === 'string' &&
    typeof row.intent === 'string'
  )));
});

test('an explicit false factsConfigured flag keeps legacy SPU product inference enabled', () => {
  const result = reportModel().aggregatePgySearchKeywords([{
    noteId: 'fictional-unconfigured-store-note',
    title: '护腰床垫测评',
    spuName: '护腰床垫',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [{ keyword: '护腰床垫怎么选', impressions: 50, reads: 10 }],
  }], {
    profileId: 'home-furnishing-v1',
    factsConfigured: false,
    ownBrandTerms: [],
    ownProductTerms: [],
    competitorTerms: [],
  });

  assert.equal(result.keywords[0].commercialCategory, '自有产品词');
});

test('search classification accepts a stable explicit profile and rejects unknown profiles', () => {
  const facts = [{
    noteId: 'fictional-profile-stability-note',
    title: '家具与健康跨界活动',
    spuName: '护腰床垫',
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [
      { keyword: '益生菌联名沙发', impressions: 20, reads: 4, clickRate: 0.2 },
    ],
  }];
  const furniture = reportModel().aggregatePgySearchKeywords(facts, {
    profileId: 'home-furnishing-v1',
  });

  assert.equal(furniture.profile.id, 'home-furnishing-v1');
  assert.equal(furniture.profile.selection, 'explicit');
  assert.ok(furniture.keywords.every((row) => row.commercialCategory !== '泛宠物兴趣词'));
  assert.throws(() => reportModel().aggregatePgySearchKeywords(facts, {
    profileId: 'fictional-unknown-profile',
  }), /unknown.*profile/i);
});

test('aggregatePgyFacts derives task and overdue counts from PGY facts inside the selected publication range', () => {
  const january = reportModel().aggregatePgyFacts({
    facts: reportFacts(),
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-04-20',
  });

  assert.equal(january.noteCount, 4);
  assert.equal(january.starTaskNoteCount, 3,
    'a canonical taobaoTaskId is direct task membership evidence');
  assert.equal(january.overdueNoteCount, 1,
    'only taskEndDate values strictly before asOf are overdue');
});

test('aggregatePgyFacts does not count the official missing-task marker as a Taobao task ID', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [pgyFact({
      id: 'missing-task-marker',
      publishDate: '2030-01-20',
      taobaoTaskId: '-',
    })],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-04-20',
  });

  assert.equal(result.starTaskNoteCount, 0);
});

test('aggregatePgyFacts filters only by the official PGY spuName while retaining all name choices', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [
      pgyFact({
        id: 'spu-a', publishDate: '2030-01-05', followerCount: 5000,
        cooperation: 100, platformFee: 10, impressions: 100, reads: 50, interactions: 10,
        spuName: '虚构 SPU A',
        spus: [{ id: 'same-id-must-not-drive-filter', name: '旧别名 A' }],
      }),
      pgyFact({
        id: 'spu-b', publishDate: '2030-01-06', followerCount: 5000,
        cooperation: 200, platformFee: 20, impressions: 200, reads: 100, interactions: 20,
        spuName: '虚构 SPU B',
        spus: [{ id: 'same-id-must-not-drive-filter', name: '旧别名 B' }],
      }),
    ],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    spuName: '虚构 SPU B',
    asOf: '2030-01-31',
  });

  assert.equal(result.selectedSpuName, '虚构 SPU B');
  assert.equal(result.noteCount, 1);
  assert.equal(result.costs.total, 220);
  assert.deepEqual(result.spuOptions, ['虚构 SPU A', '虚构 SPU B']);
});

test('aggregatePgyFacts sums PGY 15-day Taobao volumes and recalculates cost and rates from totals', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [
      pgyFact({
        id: 'taobao-15-a', publishDate: '2030-01-05', followerCount: 5000,
        cooperation: 100, platformFee: 10, impressions: 100, reads: 100, interactions: 10,
        taobaoSamplingRatio: 0.5,
        taobao15d: {
          taobaoOffsiteActiveUv15d: 10,
          taobaoOffsiteActiveCost15d: 11,
          taobaoDealUv15d: 2,
          taobaoAddCartUv15d: 5,
          taobaoAddCartRate15d: 0.99,
          taobaoPurchaseRate15d: 0.88,
        },
      }),
      pgyFact({
        id: 'taobao-15-b', publishDate: '2030-01-06', followerCount: 5000,
        cooperation: 200, platformFee: 20, impressions: 200, reads: 100, interactions: 20,
        taobaoSamplingRatio: 0.25,
        taobao15d: {
          taobaoOffsiteActiveUv15d: 20,
          taobaoOffsiteActiveCost15d: 2.75,
          taobaoDealUv15d: 4,
          taobaoAddCartUv15d: 5,
          taobaoAddCartRate15d: 0.77,
          taobaoPurchaseRate15d: 0.66,
        },
      }),
    ],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-02-01',
  });

  assert.deepEqual(result.taobao15d, {
    offsiteActiveUv: 30,
    offsiteActiveCost: 4.4,
    dealUv: 6,
    addCartUv: 10,
    addCartRate: 0.15,
    purchaseRate: 0.1,
  });
});

test('aggregatePgyFacts zero-fills publication months for the selected closed interval', () => {
  assert.deepEqual(aggregateFixture().monthly, [
    { month: '2030-01', noteCount: 4 },
    { month: '2030-02', noteCount: 0 },
    { month: '2030-03', noteCount: 4 },
  ]);
});

test('aggregatePgyFacts recalculates follower tiers from cooperation cost only', () => {
  const result = aggregateFixture();

  assert.deepEqual(result.followerTiers, [
    {
      key: '1k_5k', label: '1K-5K', noteCount: 2, authorCount: 1,
      cooperationCost: 45, averageCooperationCost: 22.5,
    },
    {
      key: '5k_10k', label: '5K-1W', noteCount: 1, authorCount: 1,
      cooperationCost: 30, averageCooperationCost: 30,
    },
    {
      key: '10k_100k', label: '1W-10W', noteCount: 1, authorCount: 1,
      cooperationCost: 40, averageCooperationCost: 40,
    },
    {
      key: '100k_500k', label: '10W-50W', noteCount: 1, authorCount: 1,
      cooperationCost: 50, averageCooperationCost: 50,
    },
    {
      key: '500k_plus', label: '50W+', noteCount: 1, authorCount: 1,
      cooperationCost: 60, averageCooperationCost: 60,
    },
  ]);
  assert.deepEqual(result.followerTierExcluded, {
    below1k: { noteCount: 1, authorCount: 1 },
    unknown: { noteCount: 1, authorCount: 1 },
  });
});
