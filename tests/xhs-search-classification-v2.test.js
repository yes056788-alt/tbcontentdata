const assert = require('node:assert/strict');
const test = require('node:test');

const classification = require('../xhs/search-classification');

const {
  LIMITS,
  normalizeConfig,
  normalizeRuleClassification,
  validateQwenBatchResponse,
  resolveClassification,
  projectLegacyFields,
  createCacheKey,
  createArchiveEntry,
  findArchiveEntry,
} = classification;

function baseConfig(overrides = {}) {
  return normalizeConfig({
    profileId: 'home-furnishing-v1',
    revision: 'furniture-r1',
    facts: {
      ownBrands: ['顾家家居', '顾家'],
      ownProducts: ['深睡床垫 M1'],
      competitors: ['慕思', '喜临门'],
    },
    ...overrides,
  });
}

test('normalizeConfig sanitizes profile facts revision and bounded manual overrides', () => {
  const config = normalizeConfig({
    profileId: ' home-furnishing-v1 ',
    revision: ' furniture-r1 ',
    facts: {
      ownBrands: [' 顾家 ', '顾家', '', null, 'A'.repeat(LIMITS.termLength + 1)],
      ownProducts: [' 深睡床垫 M1 '],
      competitors: Array.from({ length: LIMITS.factTerms + 5 }, (_, index) => `竞品-${index}`),
    },
    manualOverrides: [{
      id: ' correction-1 ',
      scopeKey: ' store:test ',
      keyword: ' 顾家床垫 ',
      active: true,
      reason: ' 当前店铺自有产品 ',
      patch: {
        entityRelation: 'own_product',
        topicTagIds: ['core_category', 'core_category', 'not-allowed'],
        intentIds: ['brand_product_lookup', 'not-allowed'],
        primaryIntentId: 'brand_product_lookup',
        relevance: 'strong',
      },
    }, {
      id: 'invalid-without-keyword', patch: { entityRelation: 'competitor' },
    }],
  });

  assert.equal(config.profileId, 'home-furnishing-v1');
  assert.equal(config.industry, 'furniture');
  assert.equal(config.revision, 'furniture-r1');
  assert.deepEqual(config.facts.ownBrands, ['顾家']);
  assert.deepEqual(config.facts.ownProducts, ['深睡床垫 M1']);
  assert.equal(config.facts.competitors.length, LIMITS.factTerms);
  assert.equal(config.manualOverrides.length, 1);
  assert.deepEqual(config.manualOverrides[0], {
    id: 'correction-1',
    scopeKey: 'store:test',
    normalizedKeyword: '顾家床垫',
    active: true,
    reason: '当前店铺自有产品',
    patch: {
      entityRelation: 'own_product',
      topicTagIds: ['core_category'],
      intentIds: ['brand_product_lookup'],
      primaryIntentId: 'brand_product_lookup',
      relevance: 'strong',
    },
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.facts.ownBrands), true);
});

test('normalizeConfig fails closed to the generic profile and safe revision', () => {
  const config = normalizeConfig({
    profileId: 'unknown-profile',
    revision: 'Authorization: Bearer should-not-survive',
  });

  assert.equal(config.profileId, 'cross-industry-generic-v1');
  assert.equal(config.industry, 'generic');
  assert.equal(config.revision, 'unversioned');
});

test('normalizeRuleClassification compresses rule candidates to one topic and one primary intent', () => {
  const result = normalizeRuleClassification({
    entityRelation: 'generic_category',
    matchedTerm: '床垫',
    topicTags: [
      { id: 'core_category', evidence: ['床垫', '床垫'] },
      { id: 'need_pain_point', evidence: ['护腰'] },
      { id: 'core_category', evidence: ['床垫'] },
    ],
    intents: [
      { id: 'comparison', isPrimary: true },
      { id: 'purchase_decision', isPrimary: true },
      { id: 'problem_solving' },
    ],
    relevance: 'strong',
    confidenceScore: 0.82,
    reasonCodes: ['RULE_CORE_CATEGORY', 'RULE_CORE_CATEGORY'],
  });

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.entity.relation, 'generic_category');
  assert.deepEqual(result.topicTags.map((tag) => tag.id), ['need_pain_point'],
    'need/pain-point outranks a core-category candidate');
  assert.deepEqual(result.intents.map((intent) => [intent.id, intent.isPrimary]), [
    ['purchase_decision', true],
  ], 'purchase decision outranks comparison and problem-solving candidates');
  assert.equal(result.needsReview, false);
  assert.deepEqual(result.reasonCodes, ['RULE_CORE_CATEGORY']);
});

test('validateQwenBatchResponse abstains invalid items without discarding valid siblings', () => {
  const request = {
    items: [
      { itemId: 'item-valid', keyword: '鱼油副作用值得买吗', entity: 'generic_category' },
      { itemId: 'item-invalid', keyword: '家具怎么买', entity: 'generic_category' },
      { itemId: 'item-missing', keyword: '短词', entity: 'unknown' },
    ],
  };
  const response = {
    items: [
      {
        itemId: 'item-valid',
        status: 'classified',
        topicTagIds: ['core_category', 'safety_adverse_effect'],
        intentIds: ['purchase_decision', 'problem_solving'],
        primaryIntentId: 'purchase_decision',
        relevance: 'strong',
        confidenceScore: 0.88,
        reason: '涉及安全性与购买判断',
        entity: 'competitor',
      },
      {
        itemId: 'item-invalid',
        status: 'classified',
        topicTagIds: ['invented-topic'],
        intentIds: ['purchase_decision'],
        primaryIntentId: 'purchase_decision',
        relevance: 'strong',
        confidenceScore: 99,
      },
      {
        itemId: 'unexpected-item', status: 'classified', topicTagIds: [], intentIds: [],
        relevance: 'review', confidenceScore: 0.2,
      },
    ],
  };

  const results = validateQwenBatchResponse(request, response);

  assert.equal(results.length, 3);
  assert.equal(results[0].status, 'classified');
  assert.deepEqual(results[0].result.topicTagIds, ['core_category', 'safety_adverse_effect']);
  assert.equal(Object.hasOwn(results[0].result, 'entity'), false,
    'the model response must never carry entity ownership into the trusted result');
  assert.deepEqual(results.slice(1).map((item) => [item.itemId, item.status, item.errorCode]), [
    ['item-invalid', 'abstained', 'QWEN_ITEM_INVALID'],
    ['item-missing', 'abstained', 'QWEN_ITEM_MISSING'],
  ]);
});

test('resolveClassification applies manual then facts then qwen then heuristic and never lets qwen change entity', () => {
  const config = baseConfig({
    manualOverrides: [{
      id: 'manual-product',
      scopeKey: 'store:test',
      keyword: '顾家床垫在哪里买',
      patch: {
        entityRelation: 'own_product',
        topicTagIds: ['core_category', 'usage_scenario'],
        intentIds: ['purchase_decision', 'brand_product_lookup'],
        primaryIntentId: 'brand_product_lookup',
        relevance: 'strong',
      },
    }],
  });
  const heuristic = normalizeRuleClassification({
    entityRelation: 'competitor',
    topicTags: ['industry_interest'],
    intents: ['interest_browsing'],
    relevance: 'weak',
    confidenceScore: 0.42,
  });
  const qwen = {
    status: 'classified',
    result: {
      entity: 'competitor',
      topicTagIds: ['core_category', 'need_pain_point'],
      intentIds: ['comparison', 'purchase_decision'],
      primaryIntentId: 'comparison',
      relevance: 'strong',
      confidenceScore: 0.91,
      rationale: '模型语义结果',
    },
  };

  const factResult = resolveClassification({
    keyword: '顾家床垫怎么样', scopeKey: 'store:test', config, heuristic, qwen,
  });
  assert.equal(factResult.entity.relation, 'own_brand');
  assert.equal(factResult.entity.source, 'fact');
  assert.deepEqual(factResult.topicTags.map((tag) => tag.id), ['need_pain_point']);
  assert.deepEqual(factResult.intents.map((intent) => [intent.id, intent.isPrimary]), [
    ['purchase_decision', true],
  ]);

  const manualResult = resolveClassification({
    keyword: '顾家床垫在哪里买', scopeKey: 'store:test', config, heuristic, qwen,
  });
  assert.equal(manualResult.entity.relation, 'own_product');
  assert.equal(manualResult.entity.source, 'override');
  assert.deepEqual(manualResult.topicTags.map((tag) => tag.id), ['core_category']);
  assert.deepEqual(manualResult.intents.map((intent) => [intent.id, intent.isPrimary]), [
    ['brand_product_lookup', true],
  ], 'an explicit manual primary remains authoritative over automatic intent priority');
  assert.equal(manualResult.source, 'override');
});

test('fact entity resolution uses own-brand then competitor then own-product priority', () => {
  const config = normalizeConfig({
    profileId: 'home-furnishing-v1',
    facts: {
      ownBrands: ['重叠名称'],
      ownProducts: ['重叠名称床垫'],
      competitors: ['重叠名称床垫'],
    },
  });
  const ownBrand = resolveClassification({
    keyword: '重叠名称床垫怎么样', config,
    heuristic: { entityRelation: 'unknown', topicTags: ['core_category'], intents: ['comparison'], relevance: 'strong' },
  });
  assert.equal(ownBrand.entity.relation, 'own_brand');

  const competitorConfig = normalizeConfig({
    profileId: 'home-furnishing-v1',
    facts: {
      ownProducts: ['重叠名称床垫'],
      competitors: ['重叠名称床垫'],
    },
  });
  const competitor = resolveClassification({
    keyword: '重叠名称床垫怎么样', config: competitorConfig,
    heuristic: { entityRelation: 'unknown', topicTags: ['core_category'], intents: ['comparison'], relevance: 'strong' },
  });
  assert.equal(competitor.entity.relation, 'competitor');
});

test('resolveClassification marks unresolved and abstained semantic results for review', () => {
  const heuristic = normalizeRuleClassification({
    entityRelation: 'unknown',
    topicTags: [],
    intents: ['unclear'],
    relevance: 'review',
    confidenceScore: 0.35,
  });
  const result = resolveClassification({
    keyword: '一个歧义短词',
    config: normalizeConfig({}),
    heuristic,
    qwen: { status: 'abstained', errorCode: 'QWEN_ITEM_INVALID' },
  });

  assert.equal(result.needsReview, true);
  assert.equal(result.entity.relation, 'unknown');
  assert.ok(result.reasonCodes.includes('QWEN_ITEM_INVALID'));
});

test('projectLegacyFields preserves the legacy three dimensions from classificationV2', () => {
  const resolved = resolveClassification({
    keyword: '鱼油副作用值得买吗',
    config: normalizeConfig({ profileId: 'health-supplements-v1' }),
    heuristic: normalizeRuleClassification({
      entityRelation: 'generic_category',
      matchedTerm: '鱼油',
      topicTags: ['core_category'],
      intents: ['category_exploration'],
      relevance: 'strong',
      confidenceScore: 0.55,
    }),
    qwen: {
      status: 'classified',
      result: {
        topicTagIds: ['core_category', 'safety_adverse_effect'],
        intentIds: ['purchase_decision', 'problem_solving'],
        primaryIntentId: 'purchase_decision',
        relevance: 'strong',
        confidenceScore: 0.88,
        rationale: '购买与副作用判断',
      },
    },
  });

  assert.deepEqual(resolved.topicTags.map((tag) => tag.id), ['safety_adverse_effect']);
  assert.deepEqual(resolved.intents.map((intent) => [intent.id, intent.isPrimary]), [
    ['purchase_decision', true],
  ]);

  assert.deepEqual(projectLegacyFields(resolved, { profileId: 'health-supplements-v1' }), {
    commercialCategory: '品类需求词',
    relevance: '强相关',
    intent: '购买决策',
    confidenceScore: 0.88,
    confidence: '高',
    classificationReason: '规则与千问语义联合分类',
    intentReason: '千问识别主意图：购买决策',
  });
});

test('createCacheKey is stable, excludes manual overrides, and invalidates semantic or fact revisions', () => {
  const config = baseConfig();
  const sameConfigWithManual = baseConfig({
    facts: {
      ownBrands: ['顾家', '顾家家居'],
      ownProducts: ['深睡床垫 M1'],
      competitors: ['喜临门', '慕思'],
    },
    manualOverrides: [{
      id: 'manual-1', keyword: '鱼油副作用',
      patch: { relevance: 'strong' },
    }],
  });
  const first = createCacheKey({
    keyword: ' 鱼油  副作用 ', scopeKey: ' store:test ', config,
    semantic: { provider: 'qwen', model: 'qwen-plus', promptVersion: 'hybrid-v1' },
    ruleCandidate: { relevance: 'review', topicTagIds: ['need_pain_point'] },
  });
  const reordered = createCacheKey({
    scopeKey: 'store:test', keyword: '鱼油 副作用', config: sameConfigWithManual,
    ruleCandidate: { topicTagIds: ['need_pain_point'], relevance: 'review' },
    semantic: { promptVersion: 'hybrid-v1', model: 'qwen-plus', provider: 'qwen' },
  });

  assert.equal(first, reordered, 'fact dictionaries are sets; input ordering must not split the cache');
  assert.ok(first.length < 128, 'cache key must stay compact when repeated in large archives');
  assert.equal(first.includes('顾家'), false, 'cache key must not expose store fact terms');
  assert.notEqual(first, createCacheKey({
    keyword: '鱼油 副作用', scopeKey: 'store:test',
    config: baseConfig({ revision: 'furniture-r2' }),
    semantic: { provider: 'qwen', model: 'qwen-plus', promptVersion: 'hybrid-v1' },
    ruleCandidate: { relevance: 'review', topicTagIds: ['need_pain_point'] },
  }));
  assert.notEqual(first, createCacheKey({
    keyword: '鱼油 副作用', scopeKey: 'store:test', config,
    semantic: { provider: 'qwen', model: 'qwen-plus', promptVersion: 'hybrid-v2' },
    ruleCandidate: { relevance: 'review', topicTagIds: ['need_pain_point'] },
  }));
  const customOutdoor = createCacheKey({
    keyword: '帐篷怎么选', scopeKey: 'store:custom',
    config: baseConfig({
      profileId: 'cross-industry-generic-v1', customIndustry: '户外装备',
    }),
    semantic: { provider: 'qwen', model: 'qwen-plus', promptVersion: 'hybrid-v2' },
    ruleCandidate: { relevance: 'review', topicTagIds: [] },
  });
  const customBeauty = createCacheKey({
    keyword: '帐篷怎么选', scopeKey: 'store:custom',
    config: baseConfig({
      profileId: 'cross-industry-generic-v1', customIndustry: '美妆护肤',
    }),
    semantic: { provider: 'qwen', model: 'qwen-plus', promptVersion: 'hybrid-v2' },
    ruleCandidate: { relevance: 'review', topicTagIds: [] },
  });
  assert.notEqual(customOutdoor, customBeauty, 'custom industry context must invalidate the cache');
});

test('archive entries retain compact automatic and effective results and support normalized lookup', () => {
  const automatic = normalizeRuleClassification({
    entityRelation: 'generic_category', topicTags: ['core_category'],
    intents: ['category_exploration'], relevance: 'strong', confidenceScore: 0.7,
  });
  const effective = resolveClassification({
    keyword: ' 护腰床垫 ', config: baseConfig(), heuristic: automatic,
  });
  const cacheKey = createCacheKey({
    keyword: '护腰床垫', scopeKey: 'store:test', config: baseConfig(),
  });
  const entry = createArchiveEntry({
    keyword: ' 护腰床垫 ', scopeKey: ' store:test ', cacheKey,
    automatic, effective, appliedOverrideId: 'manual-1',
  });
  const archive = {
    schema: 'xhsSearchClassificationArchiveV1', schemaVersion: 1, entries: [entry],
  };

  assert.equal(entry.normalizedKeyword, '护腰床垫');
  assert.equal(entry.scopeKey, 'store:test');
  assert.equal(entry.automatic.schemaVersion, 2);
  assert.equal(entry.effective.schemaVersion, 2);
  assert.equal(entry.appliedOverrideId, 'manual-1');
  assert.equal(findArchiveEntry(archive, {
    keyword: '  护腰床垫  ', scopeKey: 'store:test',
  }), entry);
  assert.equal(findArchiveEntry(archive, {
    keyword: '护腰床垫', scopeKey: 'store:other',
  }), null);
  assert.throws(() => createArchiveEntry({
    keyword: '护腰床垫', scopeKey: 'store:test', cacheKey: 'xhs-search-classification-v2:not-a-hash',
    automatic, effective,
  }), /valid cacheKey/);
});

test('UMD export exposes a standalone factory source for offline reports', () => {
  assert.equal(typeof classification.standaloneSource, 'string');
  assert.match(classification.standaloneSource, /^\(function createXhsSearchClassificationApi\(\)/);
});
