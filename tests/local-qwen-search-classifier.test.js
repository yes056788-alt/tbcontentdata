const assert = require('node:assert/strict');
const test = require('node:test');

const modulePromise = import('../web-tool/qwen-search-classifier.mjs');

function request(body, options = {}) {
  return new Request('http://127.0.0.1:3400/api/search-keyword-classifications', {
    method: options.method || 'POST',
    headers: {
      Origin: options.origin || 'http://127.0.0.1:3400',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  });
}

function validBody() {
  return {
    schema: 'xhsSearchSemanticBatchRequestV1',
    schemaVersion: 1,
    requestId: 'request-1',
    promptVersion: 'xhs-search-hybrid-v1',
    taxonomyVersion: 'xhs-search-taxonomy-v2',
    context: {
      industry: 'health_supplements',
      industryName: '',
      profileId: 'health-supplements-v1',
    },
    items: [{
      itemId: 'item-1',
      keyword: '鱼油副作用值得买吗',
      ruleCandidate: {
        lockedEntityRelation: 'generic_category',
        topicTagIds: ['core_category'],
        intentIds: [],
        relevance: 'strong',
        confidenceScore: 0.48,
      },
    }],
  };
}

function openAiResponse(value, status = 'completed') {
  return Response.json({
    status,
    output: status === 'completed' ? [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    }] : [],
  });
}

test('local Qwen handler fails closed for cross-origin requests and missing server secret', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  const handler = createLocalQwenClassificationHandler({ env: {}, fetchImpl: async () => {
    throw new Error('must not call upstream');
  } });

  const forbidden = await handler(request(validBody(), { origin: 'https://evil.example' }));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, 'ORIGIN_FORBIDDEN');

  const missing = await handler(request(validBody()));
  assert.equal(missing.status, 503);
  const missingPayload = await missing.json();
  assert.equal(missingPayload.error.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(JSON.stringify(missingPayload).includes('OPENAI_API_KEY'), false);
});

test('local Qwen handler calls the pinned model with JSON output and returns only trusted enums', async () => {
  const { createLocalQwenClassificationHandler, DEFAULT_OPENAI_MODEL } = await modulePromise;
  let upstream;
  const handler = createLocalQwenClassificationHandler({
    env: {
      OPENAI_API_KEY: 'fictional-server-secret',
      OPENAI_MODEL: 'unbounded-expensive-model',
    },
    fetchImpl: async (url, init) => {
      upstream = { url: String(url), init };
      return openAiResponse({
          items: [{
            itemId: 'item-1',
            status: 'classified',
            topicTagIds: ['core_category', 'safety_adverse_effect'],
            intentIds: ['purchase_decision', 'problem_solving'],
            primaryIntentId: 'purchase_decision',
            relevance: 'strong',
            confidenceScore: 0.88,
            rationale: '涉及副作用与购买判断',
            entityRelation: 'competitor',
          }],
      });
    },
  });

  const response = await handler(request(validBody()));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(DEFAULT_OPENAI_MODEL, payload.model);
  assert.equal(payload.provider, 'openai');
  assert.equal(payload.items[0].status, 'classified');
  assert.deepEqual(payload.items[0].topicTagIds, ['safety_adverse_effect']);
  assert.deepEqual(payload.items[0].intentIds, ['purchase_decision']);
  assert.equal(payload.items[0].primaryIntentId, 'purchase_decision');
  assert.equal(Object.hasOwn(payload.items[0], 'entityRelation'), false);
  assert.equal(upstream.url, 'https://api.openai.com/v1/responses');
  assert.equal(upstream.init.headers.Authorization, 'Bearer fictional-server-secret');
  const upstreamBody = JSON.parse(upstream.init.body);
  assert.equal(upstreamBody.model, DEFAULT_OPENAI_MODEL);
  assert.equal(upstreamBody.store, false);
  assert.deepEqual(upstreamBody.reasoning, { effort: 'none' });
  assert.equal(upstreamBody.text.format.type, 'json_schema');
  assert.equal(upstreamBody.text.format.strict, true);
  assert.match(upstreamBody.input[0].content, /primaryIntentId/);
  assert.match(upstreamBody.input[0].content, /confidenceScore/);
  assert.equal(JSON.stringify(upstreamBody).includes('fictional-server-secret'), false);
});

test('local Qwen handler preserves a validated custom industry context', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  let upstreamBody;
  const handler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(init.body);
      return openAiResponse({ items: [] });
    },
  });
  const customBody = validBody();
  customBody.context = {
    industry: 'custom', industryName: '户外装备', profileId: 'cross-industry-generic-v1',
  };
  assert.equal((await handler(request(customBody))).status, 200);
  assert.match(upstreamBody.input[1].content, /户外装备/);

  const invalidBody = validBody();
  invalidBody.context.industryName = '不应出现';
  const invalid = await handler(request(invalidBody));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_BODY');
});

test('local Qwen handler prefers a valid tool key and fails closed for an invalid tool cookie', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  let authorization = '';
  const handler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'shared-environment-secret' },
    apiKeyResolver: async () => ({ state: 'valid', apiKey: 'personal-tool-secret' }),
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return openAiResponse({ items: [] });
    },
  });
  assert.equal((await handler(request(validBody()))).status, 200);
  assert.equal(authorization, 'Bearer personal-tool-secret');

  const invalidHandler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'shared-environment-secret' },
    apiKeyResolver: async () => ({ state: 'invalid' }),
    fetchImpl: async () => { throw new Error('must not call upstream'); },
  });
  const invalid = await invalidHandler(request(validBody()));
  assert.equal(invalid.status, 409);
  assert.equal((await invalid.clone().json()).error.code, 'MODEL_KEY_REENTRY_REQUIRED');
  assert.equal(invalid.headers.get('set-cookie'), null);
});

test('local Qwen handler pins every later batch to one opaque credential version', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  let upstreamCalls = 0;
  const handler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    credentialVersionKey: Buffer.alloc(32, 4),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return openAiResponse({ items: [] });
    },
  });
  const first = await handler(request(validBody()));
  assert.equal(first.status, 200);
  const version = first.headers.get('x-openai-credential-version');
  assert.match(version, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(upstreamCalls, 1);

  const changed = await handler(request(validBody(), {
    headers: { 'X-OpenAI-Credential-Version': 'differentCredentialVersion123' },
  }));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, 'MODEL_CREDENTIAL_CHANGED');
  assert.equal(changed.headers.get('x-openai-credential-version'), version);
  assert.equal(upstreamCalls, 1);

  const pinned = await handler(request(validBody(), {
    headers: { 'X-OpenAI-Credential-Version': version },
  }));
  assert.equal(pinned.status, 200);
  assert.equal(upstreamCalls, 2);
});

test('local Qwen handler abstains malformed sibling items and never leaks upstream errors', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  const handler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => openAiResponse({
        items: [{
          itemId: 'item-1', status: 'classified', topicTagIds: ['invented'],
          intentIds: ['purchase_decision'], primaryIntentId: 'purchase_decision',
          relevance: 'strong', confidenceScore: 99, rationale: 'invalid',
        }],
    }),
  });
  const response = await handler(request(validBody()));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [{
    itemId: 'item-1', status: 'abstained', errorCode: 'MODEL_ITEM_INVALID',
  }]);

  const failing = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => {
      throw new Error('Authorization Bearer fictional-server-secret upstream exploded');
    },
  });
  const failure = await failing(request(validBody()));
  assert.equal(failure.status, 502);
  assert.match(failure.headers.get('x-openai-credential-version'), /^[A-Za-z0-9_-]{16,64}$/);
  const text = JSON.stringify(await failure.json());
  assert.match(text, /MODEL_UPSTREAM_UNAVAILABLE/);
  assert.doesNotMatch(text, /fictional-server-secret|Authorization|exploded/);

  const incomplete = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => openAiResponse({ items: [] }, 'incomplete'),
  });
  const incompleteResponse = await incomplete(request(validBody()));
  assert.equal(incompleteResponse.status, 502);
  assert.equal((await incompleteResponse.json()).error.code, 'MODEL_UPSTREAM_UNAVAILABLE');

  const oversized = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Length': '1000001', 'Content-Type': 'application/json' },
    }),
  });
  const oversizedResponse = await oversized(request(validBody()));
  assert.equal(oversizedResponse.status, 502);
  assert.equal((await oversizedResponse.json()).error.code, 'MODEL_UPSTREAM_UNAVAILABLE');

  const unauthorized = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => new Response('credential rejected', { status: 401 }),
  });
  const unauthorizedResponse = await unauthorized(request(validBody()));
  assert.equal(unauthorizedResponse.status, 503);
  assert.equal((await unauthorizedResponse.json()).error.code, 'OPENAI_AUTH_FAILED');
});

test('local Qwen handler rejects oversized batches, unknown fields and unsafe base URLs', async () => {
  const { createLocalQwenClassificationHandler } = await modulePromise;
  const handler = createLocalQwenClassificationHandler({
    env: {
      OPENAI_API_KEY: 'fictional-server-secret',
      OPENAI_BASE_URL: 'http://127.0.0.1:9999/steal',
    },
    fetchImpl: async () => { throw new Error('must not call upstream'); },
  });
  const unsafe = await handler(request(validBody()));
  assert.equal(unsafe.status, 503);
  assert.equal((await unsafe.json()).error.code, 'MODEL_CONFIGURATION_INVALID');

  const unknownBody = { ...validBody(), apiKey: 'client-secret' };
  const strictHandler = createLocalQwenClassificationHandler({
    env: { OPENAI_API_KEY: 'fictional-server-secret' },
    fetchImpl: async () => { throw new Error('must not call upstream'); },
  });
  const unknown = await strictHandler(request(unknownBody));
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_BODY');
});
