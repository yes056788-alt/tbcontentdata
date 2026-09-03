const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.XhsSearchClassification = require('../xhs/search-classification');
const clientPromise = import('../web-tool/search-classification-client.js').then(() => (
  globalThis.XhsSearchClassificationClient
));

function row(keyword, overrides = {}) {
  return {
    keyword,
    commercialCategory: '核心品类词',
    relevance: '强相关',
    intent: '品类探索',
    confidenceScore: 0.7,
    confidence: '中',
    impressions: 100,
    reads: 20,
    clickRate: 0.2,
    noteCount: 1,
    notes: [{ noteId: 'note-1', title: '不应发送的笔记标题' }],
    ...overrides,
  };
}

const storeClassification = {
  schema: 1,
  profileId: 'auto',
  ownBrandTerms: ['顾家'],
  ownProductTerms: ['深睡床垫 M1'],
  competitorTerms: ['慕思'],
  manualOverrides: [],
  revision: 3,
  semantic: { enabled: true },
};

test('browser client maps flat store configuration to the trusted core contract', async () => {
  const client = await clientPromise;
  const config = client.normalizeStoreClassification(
    storeClassification, 'home-furnishing-v1'
  );
  assert.equal(config.profileId, 'home-furnishing-v1');
  assert.equal(config.industry, 'furniture');
  assert.equal(config.revision, 'r3');
  assert.deepEqual(config.facts, {
    ownBrands: ['顾家'], ownProducts: ['深睡床垫 M1'], competitors: ['慕思'],
  });
});

test('store facts use one commercial label with own brand before competitor and category', async () => {
  const client = await clientPromise;
  let called = false;
  const result = await client.classifyRows({
    rows: [row('顾家慕思床垫', { confidenceScore: 0.95, confidence: '高' })],
    storeClassification,
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture',
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
  });
  assert.equal(called, false);
  assert.equal(result.rows[0].commercialCategory, '自有品牌词');
  assert.equal(result.rows[0].classificationV2.entity.relation, 'own_brand');
  assert.ok(result.rows[0].classificationV2.topicTags.length <= 1);
  assert.ok(result.rows[0].classificationV2.intents.length <= 1);
});

test('product classification defaults to Sheba-style deterministic industry rules without an API call', async () => {
  const client = await clientPromise;
  let called = false;
  const result = await client.classifyRows({
    rows: [row('床垫怎么选', {
      commercialCategory: '核心品类词', relevance: '强相关',
      intent: '对比评估', confidenceScore: 0.88,
    })],
    storeClassification: {
      profileId: 'home-furnishing-v1', ownBrandTerms: ['顾家'], revision: 4,
    },
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture-rules-only',
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
  });
  assert.equal(called, false);
  assert.equal(result.archive.status, 'rules_only');
  assert.equal(result.archive.engine.provider, 'rules');
  assert.equal(result.archive.engine.rulesetVersion, 'xhs-search-sheba-style-v3');
  assert.equal(result.rows[0].commercialCategory, '核心品类词');
  assert.equal(result.rows[0].relevance, '强相关');
  assert.equal(result.rows[0].intent, '对比评估');
});

test('semantic candidates are privacy-minimized and collapse to one topic and one intent', async () => {
  const client = await clientPromise;
  let sentBody;
  const result = await client.classifyRows({
    rows: [row('鱼油副作用值得买吗', {
      commercialCategory: '品类需求词', relevance: '强相关',
      intent: '购买决策', confidenceScore: 0.62,
    })],
    storeClassification: { ...storeClassification, ownBrandTerms: [], competitorTerms: [] },
    profileId: 'health-supplements-v1',
    scopeKey: 'store:supplements',
    fetchImpl: async (url, init) => {
      assert.equal(url, '/api/search-keyword-classifications');
      sentBody = JSON.parse(init.body);
      return Response.json({
        schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
        requestId: sentBody.requestId, provider: 'openai',
        model: 'gpt-5.4-mini-2026-03-17', classifierVersion: 'xhs-search-hybrid-v1',
        promptVersion: sentBody.promptVersion, taxonomyVersion: sentBody.taxonomyVersion,
        items: [{
          itemId: sentBody.items[0].itemId, status: 'classified',
          topicTagIds: ['safety_adverse_effect'],
          intentIds: ['purchase_decision'], primaryIntentId: 'purchase_decision',
          relevance: 'strong', confidenceScore: 0.88, rationale: '购买与副作用判断',
        }],
      });
    },
  });

  assert.equal(sentBody.items.length, 1);
  assert.deepEqual(sentBody.context, {
    industry: 'health_supplements', industryName: '', profileId: 'health-supplements-v1',
  });
  assert.equal(JSON.stringify(sentBody).includes('不应发送的笔记标题'), false);
  assert.equal(JSON.stringify(sentBody).includes('note-1'), false);
  assert.equal(result.rows[0].commercialCategory, '品类需求词');
  assert.deepEqual(result.rows[0].classificationV2.topicTags.map((tag) => tag.id), [
    'safety_adverse_effect',
  ]);
  assert.deepEqual(result.rows[0].classificationV2.intents.map((intent) => intent.id), [
    'purchase_decision',
  ]);
  assert.equal(result.archive.status, 'complete');
  assert.equal(result.archive.entries.length, 1);
  assert.equal(result.archive.engine.model, 'gpt-5.4-mini-2026-03-17');
  assert.deepEqual(result.archive.semanticRun, {
    candidateCount: 1,
    attemptedCount: 1,
    classifiedCount: 1,
    deferredCount: 0,
    errorCode: '',
  });
});

test('model failure returns a rules-only archive and never prevents report rows', async () => {
  const client = await clientPromise;
  const result = await client.classifyRows({
    rows: [row('一个歧义短词', {
      commercialCategory: '待确认', relevance: '待确认', intent: '意图不明确',
      confidenceScore: 0.35,
    })],
    storeClassification,
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture',
    fetchImpl: async () => Response.json({
      error: { code: 'MODEL_NOT_CONFIGURED', message: 'not configured' },
    }, { status: 503 }),
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].needsReview, true);
  assert.equal(result.archive.status, 'rules_only');
  assert.equal(result.modelErrorCode, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(result.archive.semanticRun, {
    candidateCount: 1,
    attemptedCount: 1,
    classifiedCount: 0,
    deferredCount: 0,
    errorCode: 'MODEL_NOT_CONFIGURED',
  });
});

test('multi-batch classification pins one credential version and stops when it changes', async () => {
  const client = await clientPromise;
  const rows = Array.from({ length: 201 }, (_, index) => row(
    '歧义搜索关键词' + String(index).padStart(3, '0'),
    { commercialCategory: '待确认', relevance: '待确认', intent: '意图不明确', confidenceScore: 0.2 }
  ));
  let calls = 0;
  const result = await client.classifyRows({
    rows,
    storeClassification,
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture',
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      if (calls === 1) {
        assert.equal(init.headers['X-OpenAI-Credential-Version'], undefined);
        return Response.json({
          schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
          requestId: body.requestId, provider: 'openai',
          model: 'gpt-5.4-mini-2026-03-17', classifierVersion: 'xhs-search-hybrid-v1',
          promptVersion: body.promptVersion, taxonomyVersion: body.taxonomyVersion,
          items: body.items.map((item) => ({
            itemId: item.itemId, status: 'classified', topicTagIds: ['core_category'],
            intentIds: ['category_exploration'], primaryIntentId: 'category_exploration',
            relevance: 'medium', confidenceScore: 0.82, rationale: '首批分类',
          })),
        }, { headers: { 'X-OpenAI-Credential-Version': 'credentialVersionOne123' } });
      }
      assert.equal(init.headers['X-OpenAI-Credential-Version'], 'credentialVersionOne123');
      return Response.json({
        error: { code: 'MODEL_CREDENTIAL_CHANGED', message: 'credential changed' },
      }, {
        status: 409,
        headers: { 'X-OpenAI-Credential-Version': 'credentialVersionTwo456' },
      });
    },
  });

  assert.equal(calls, 2, 'the third batch must not use a different credential');
  assert.equal(result.classifiedCount, 30);
  assert.equal(result.modelErrorCode, 'MODEL_CREDENTIAL_CHANGED');
  assert.equal(result.archive.status, 'partial');
});

test('multi-batch classification stops if the first response omits its credential version', async () => {
  const client = await clientPromise;
  const rows = Array.from({ length: 101 }, (_, index) => row(
    '缺少凭据版本关键词' + String(index).padStart(3, '0'),
    { commercialCategory: '待确认', relevance: '待确认', intent: '意图不明确', confidenceScore: 0.2 }
  ));
  let calls = 0;
  const result = await client.classifyRows({
    rows,
    profileId: 'cross-industry-generic-v1',
    scopeKey: 'store:credential-version-missing',
    storeClassification: {
      profileId: 'cross-industry-generic-v1', revision: 1, semantic: { enabled: true },
    },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      return Response.json({
        schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
        requestId: body.requestId, provider: 'openai', model: client.DEFAULT_MODEL,
        classifierVersion: 'xhs-search-hybrid-v1',
        promptVersion: body.promptVersion, taxonomyVersion: body.taxonomyVersion,
        items: body.items.map((item) => ({
          itemId: item.itemId, status: 'classified', topicTagIds: ['core_category'],
          intentIds: ['category_exploration'], primaryIntentId: 'category_exploration',
          relevance: 'medium', confidenceScore: 0.82, rationale: '首批分类',
        })),
      });
    },
  });

  assert.equal(calls, 1, 'a later batch must not run without a credential pin');
  assert.equal(result.classifiedCount, 30);
  assert.equal(result.modelErrorCode, 'MODEL_CREDENTIAL_VERSION_MISSING');
  assert.equal(result.archive.status, 'partial');
});

test('custom industry name reaches the trusted semantic context', async () => {
  const client = await clientPromise;
  let sentContext;
  const result = await client.classifyRows({
    rows: [row('露营炉怎么选', {
      commercialCategory: '待确认', relevance: '待确认', intent: '意图不明确',
      confidenceScore: 0.25,
    })],
    profileId: 'cross-industry-generic-v1',
    scopeKey: 'store:outdoor',
    storeClassification: {
      profileId: 'cross-industry-generic-v1', customIndustry: '户外装备', revision: 1,
      semantic: { enabled: true },
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      sentContext = body.context;
      return Response.json({
        schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
        requestId: body.requestId, provider: 'openai', model: client.DEFAULT_MODEL,
        classifierVersion: 'xhs-search-hybrid-v1',
        promptVersion: body.promptVersion, taxonomyVersion: body.taxonomyVersion,
        items: body.items.map((item) => ({
          itemId: item.itemId, status: 'classified', topicTagIds: ['core_category'],
          intentIds: ['category_exploration'], primaryIntentId: 'category_exploration',
          relevance: 'strong', confidenceScore: 0.9, rationale: '户外装备选购语境',
        })),
      });
    },
  });

  assert.deepEqual(sentContext, {
    industry: 'custom', industryName: '户外装备', profileId: 'cross-industry-generic-v1',
  });
  assert.equal(result.config.customIndustry, '户外装备');
  assert.equal(result.rows[0].classificationSource, 'hybrid');
});

test('semantic candidate budget bounds paid calls and leaves overflow on rules', async () => {
  const client = await clientPromise;
  const rows = Array.from({ length: 301 }, (_, index) => row(
    '预算保护关键词' + String(index).padStart(3, '0'),
    { commercialCategory: '待确认', relevance: '待确认', intent: '意图不明确', confidenceScore: 0.2 }
  ));
  let calls = 0;
  const result = await client.classifyRows({
    rows,
    profileId: 'cross-industry-generic-v1',
    scopeKey: 'store:budget',
    storeClassification: {
      profileId: 'cross-industry-generic-v1', revision: 1, semantic: { enabled: true },
    },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.ok(body.items.length <= 30);
      return Response.json({
        schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
        requestId: body.requestId, provider: 'openai', model: client.DEFAULT_MODEL,
        classifierVersion: 'xhs-search-hybrid-v1',
        promptVersion: body.promptVersion, taxonomyVersion: body.taxonomyVersion,
        items: body.items.map((item) => ({
          itemId: item.itemId, status: 'classified', topicTagIds: ['core_category'],
          intentIds: ['category_exploration'], primaryIntentId: 'category_exploration',
          relevance: 'medium', confidenceScore: 0.82, rationale: '预算内分类',
        })),
      }, { headers: { 'X-OpenAI-Credential-Version': 'credentialBudgetVersion123' } });
    },
  });

  assert.equal(calls, 10);
  assert.equal(result.pendingCount, 301);
  assert.equal(result.attemptedCount, 300);
  assert.equal(result.deferredCount, 1);
  assert.equal(result.classifiedCount, 300);
  assert.equal(result.modelErrorCode, 'MODEL_CANDIDATE_BUDGET_REACHED');
  assert.equal(result.archive.status, 'partial');
});

test('frozen archive entries avoid repeat model calls unless reclassification is forced', async () => {
  const client = await clientPromise;
  const first = await client.classifyRows({
    rows: [row('床垫怎么选', { confidenceScore: 0.95 })],
    storeClassification,
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture',
    fetchImpl: async () => { throw new Error('must not call for high confidence'); },
  });
  let calls = 0;
  const second = await client.classifyRows({
    rows: [row('床垫怎么选', { confidenceScore: 0.35 })],
    storeClassification,
    profileId: 'home-furnishing-v1',
    scopeKey: 'store:furniture',
    archive: first.archive,
    preferFrozenArchive: true,
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  });
  assert.equal(calls, 0);
  assert.equal(second.rows[0].classificationSource, first.rows[0].classificationSource);
});

test('an archived automatic result reapplies a new scoped manual override without another model call', async () => {
  const client = await clientPromise;
  const keyword = '鱼油副作用值得买吗';
  const scopeKey = 'store:supplements';
  const initialClassification = {
    ...storeClassification,
    profileId: 'health-supplements-v1',
    ownBrandTerms: [],
    ownProductTerms: [],
    competitorTerms: [],
    revision: 9,
  };
  let modelCalls = 0;
  const first = await client.classifyRows({
    rows: [row(keyword, {
      commercialCategory: '品类需求词', relevance: '强相关',
      intent: '购买决策', confidenceScore: 0.62,
    })],
    storeClassification: initialClassification,
    profileId: 'health-supplements-v1',
    scopeKey,
    fetchImpl: async (_url, init) => {
      modelCalls += 1;
      const body = JSON.parse(init.body);
      return Response.json({
        schema: 'xhsSearchSemanticBatchResponseV1', schemaVersion: 1,
        requestId: body.requestId, provider: 'openai',
        model: 'gpt-5.4-mini-2026-03-17', classifierVersion: 'xhs-search-hybrid-v1',
        promptVersion: body.promptVersion, taxonomyVersion: body.taxonomyVersion,
        items: [{
          itemId: body.items[0].itemId, status: 'classified',
          topicTagIds: ['safety_adverse_effect'],
          intentIds: ['purchase_decision'], primaryIntentId: 'purchase_decision',
          relevance: 'strong', confidenceScore: 0.9, rationale: '识别为购买与副作用判断',
        }],
      });
    },
  });
  assert.equal(first.rows[0].classificationSource, 'hybrid');
  assert.equal(modelCalls, 1);

  const second = await client.classifyRows({
    rows: [row(keyword, {
      commercialCategory: '品类需求词', relevance: '强相关',
      intent: '购买决策', confidenceScore: 0.62,
    })],
    storeClassification: {
      ...initialClassification,
      manualOverrides: [{
        id: 'manual-supplement-brand',
        scopeKey,
        keyword,
        patch: {
          entityRelation: 'own_brand',
          topicTagIds: [],
          intentIds: ['brand_product_lookup'],
          primaryIntentId: 'brand_product_lookup',
          relevance: 'strong',
        },
      }],
    },
    profileId: 'health-supplements-v1',
    scopeKey,
    archive: first.archive,
    fetchImpl: async () => {
      modelCalls += 1;
      throw new Error('an archive hit must not request the model again');
    },
  });

  assert.equal(modelCalls, 1);
  assert.equal(second.rows[0].classificationSource, 'override');
  assert.equal(second.rows[0].classificationV2.entity.relation, 'own_brand');
  assert.deepEqual(second.rows[0].classificationV2.intents.map((intent) => intent.id), [
    'brand_product_lookup',
  ]);
  assert.equal(second.rows[0].classificationV2.appliedOverrideId, 'manual-supplement-brand');
  assert.equal(second.archive.entries.length, 1);
  assert.equal(second.archive.entries[0].automatic.source, 'hybrid');
  assert.equal(second.archive.entries[0].effective.source, 'override');
  assert.equal(second.archive.entries[0].appliedOverrideId, 'manual-supplement-brand');
  assert.equal(second.archive.status, 'complete');
});
