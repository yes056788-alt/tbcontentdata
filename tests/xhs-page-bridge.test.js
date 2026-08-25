const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pageClientPath = path.join(root, 'xhs', 'page-client.js');
const platformContentPath = path.join(root, 'xhs-platform-content.js');

const EXPECTED_CHANNEL = 'xhs-page-bridge-v2';
const EXPECTED_REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
const PLATFORM_CASES = [
  {
    platform: 'adstar',
    origin: 'https://adstar.alimama.com',
    endpoint: 'projects.list',
  },
  {
    platform: 'pgy',
    origin: 'https://pgy.xiaohongshu.com',
    endpoint: 'notes.list',
  },
  {
    platform: 'juguang',
    origin: 'https://ad.xiaohongshu.com',
    endpoint: 'reports.query',
  },
];

function loadPageClient() {
  return require(pageClientPath);
}

function pageRequest(overrides = {}) {
  return Object.assign({
    tabId: 17,
    platform: 'pgy',
    endpoint: 'notes.list',
    payload: { pageNum: 1, pageSize: 20 },
  }, overrides);
}

function responseFor(message, overrides = {}) {
  return Object.assign({
    channel: EXPECTED_CHANNEL,
    type: RESPONSE_TYPE,
    requestId: message.requestId,
    platform: message.platform,
    ok: true,
    data: { items: [] },
  }, overrides);
}

function evaluatePlatformContent({
  origin = 'https://pgy.xiaohongshu.com',
  topFrame = true,
} = {}) {
  const source = fs.readFileSync(platformContentPath, 'utf8');
  const runtimeListeners = [];
  const windowListeners = [];
  const posted = [];
  let nonceSequence = 0;

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') windowListeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.window = windowObject;
  windowObject.self = windowObject;
  windowObject.top = topFrame ? windowObject : { frame: 'parent' };

  const context = vm.createContext({
    TextEncoder,
    URL,
    clearTimeout() {},
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    crypto: {
      randomUUID() {
        nonceSequence += 1;
        return `fixture-nonce-${nonceSequence}`;
      },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
      },
    },
    location: {
      href: `${origin}/fixture-page`,
      origin,
    },
    setTimeout() { return 1; },
    self: windowObject,
    top: windowObject.top,
    window: windowObject,
  });

  vm.runInContext(source, context, { filename: platformContentPath });
  return {
    posted,
    runtimeListeners,
    windowListeners,
    windowObject,
    dispatchWindowMessage(event) {
      for (const listener of windowListeners) listener(event);
    },
  };
}

test('page-client exports the shared protocol and uses the injected tab sender', async () => {
  const { CHANNEL, REQUEST_TYPE, createPageClient } = loadPageClient();
  assert.equal(CHANNEL, EXPECTED_CHANNEL);
  assert.equal(REQUEST_TYPE, EXPECTED_REQUEST_TYPE);
  assert.equal(typeof createPageClient, 'function');

  const calls = [];
  const client = createPageClient({
    async sendMessage(tabId, message) {
      calls.push({ tabId, message });
      return responseFor(message);
    },
    timeoutMs: 100,
  });

  await client.request(pageRequest());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tabId, 17);
  assert.equal(calls[0].message.channel, CHANNEL);
  assert.equal(calls[0].message.type, REQUEST_TYPE);
  assert.equal(calls[0].message.platform, 'pgy');
  assert.equal(calls[0].message.endpoint, 'notes.list');
  assert.equal(typeof calls[0].message.requestId, 'string');
  assert.ok(calls[0].message.requestId.length >= 8);
});

test('page-client rejects unknown platforms and endpoints before sending', async () => {
  const { createPageClient } = loadPageClient();
  let sendCount = 0;
  const client = createPageClient({
    async sendMessage() {
      sendCount += 1;
      throw new Error('sendMessage should not be called');
    },
  });

  await assert.rejects(
    client.request(pageRequest({ platform: 'unknown-platform' })),
    /platform|平台/i,
  );
  await assert.rejects(
    client.request(pageRequest({ endpoint: 'admin.deleteEverything' })),
    /endpoint|端点/i,
  );
  assert.equal(sendCount, 0);
});

test('page-client rejects payloads larger than 64KB before sending', async () => {
  const { createPageClient } = loadPageClient();
  let sendCount = 0;
  const client = createPageClient({
    async sendMessage() {
      sendCount += 1;
      return null;
    },
  });

  await assert.rejects(
    client.request(pageRequest({ payload: { oversized: 'x'.repeat(70 * 1024) } })),
    /64\s*KB|payload|负载|大小/i,
  );
  assert.equal(sendCount, 0);
});

test('page-client rejects mismatched response requestId and platform', async () => {
  const { createPageClient } = loadPageClient();

  const wrongRequestClient = createPageClient({
    async sendMessage(tabId, message) {
      return responseFor(message, { requestId: `${message.requestId}-wrong` });
    },
  });
  await assert.rejects(
    wrongRequestClient.request(pageRequest()),
    /requestId|请求/i,
  );

  const wrongPlatformClient = createPageClient({
    async sendMessage(tabId, message) {
      return responseFor(message, { platform: 'adstar' });
    },
  });
  await assert.rejects(
    wrongPlatformClient.request(pageRequest()),
    /platform|平台/i,
  );
});

test('page-client times out a page request whose sender never settles', async () => {
  const { createPageClient } = loadPageClient();
  const client = createPageClient({
    sendMessage() {
      return new Promise(() => {});
    },
    timeoutMs: 20,
  });

  await assert.rejects(
    client.request(pageRequest()),
    /timeout|超时/i,
  );
});

test('page-client classifies an undefined receiver response without obscuring platform API errors', async () => {
  const { BRIDGE_UNAVAILABLE_CODE, createPageClient } = loadPageClient();
  const missingReceiver = createPageClient({
    async sendMessage() {
      return undefined;
    },
  });
  await assert.rejects(
    missingReceiver.request(pageRequest()),
    (error) => error && error.code === BRIDGE_UNAVAILABLE_CODE && error.retryable === true,
  );

  const apiFailure = createPageClient({
    async sendMessage(tabId, message) {
      return responseFor(message, {
        ok: false,
        code: 'FICTIONAL_PLATFORM_API_ERROR',
        message: 'fictional platform no response',
        retryable: true,
      });
    },
  });
  await assert.rejects(
    apiFailure.request(pageRequest()),
    (error) => error && error.code === 'FICTIONAL_PLATFORM_API_ERROR',
  );
});

test('page-client classifies Chrome stale-receiver rejection for one runtime-owned recovery', async () => {
  const { BRIDGE_UNAVAILABLE_CODE, createPageClient } = loadPageClient();
  for (const message of [
    'Could not establish connection. Receiving end does not exist.',
    'No tab with id: 17.',
    'A listener indicated an asynchronous response, but the message channel closed before a response was received.',
  ]) {
    const client = createPageClient({
      async sendMessage() {
        throw new Error(message);
      },
    });

    await assert.rejects(
      client.request(pageRequest()),
      (error) => error && error.code === BRIDGE_UNAVAILABLE_CODE && error.retryable === true,
      message,
    );
  }
});

test('platform content bridge does not register outside a top-level exact origin', () => {
  const childFrame = evaluatePlatformContent({ topFrame: false });
  assert.equal(childFrame.runtimeListeners.length, 0);
  assert.equal(childFrame.windowListeners.length, 0);

  for (const origin of [
    'http://pgy.xiaohongshu.com',
    'https://evil.pgy.xiaohongshu.com',
    'https://www.xiaohongshu.com',
  ]) {
    const untrusted = evaluatePlatformContent({ origin });
    assert.equal(untrusted.runtimeListeners.length, 0, origin);
    assert.equal(untrusted.windowListeners.length, 0, origin);
  }
});

test('platform content bridge forwards only the endpoint allowlisted for its exact origin', () => {
  for (const platformCase of PLATFORM_CASES) {
    const bridge = evaluatePlatformContent({ origin: platformCase.origin });
    assert.equal(bridge.runtimeListeners.length, 1, platformCase.origin);
    assert.equal(bridge.windowListeners.length, 1, platformCase.origin);
    const runtimeListener = bridge.runtimeListeners[0];

    const rejectedResponses = [];
    const wrongPlatformHandled = runtimeListener({
      channel: EXPECTED_CHANNEL,
      type: EXPECTED_REQUEST_TYPE,
      requestId: 'fixture-wrong-platform',
      platform: platformCase.platform === 'pgy' ? 'adstar' : 'pgy',
      endpoint: platformCase.endpoint,
      payload: {},
    }, {}, (response) => rejectedResponses.push(response));
    assert.equal(wrongPlatformHandled, false);

    const wrongEndpointHandled = runtimeListener({
      channel: EXPECTED_CHANNEL,
      type: EXPECTED_REQUEST_TYPE,
      requestId: 'fixture-wrong-endpoint',
      platform: platformCase.platform,
      endpoint: 'admin.deleteEverything',
      payload: {},
    }, {}, (response) => rejectedResponses.push(response));
    assert.equal(wrongEndpointHandled, false);
    assert.equal(bridge.posted.length, 0);
    assert.equal(rejectedResponses.length, 0);

    const responses = [];
    const requestId = `fixture-${platformCase.platform}-request`;
    const handled = runtimeListener({
      channel: EXPECTED_CHANNEL,
      type: EXPECTED_REQUEST_TYPE,
      requestId,
      platform: platformCase.platform,
      endpoint: platformCase.endpoint,
      payload: { fixture: true },
    }, {}, (response) => responses.push(response));
    assert.equal(handled, true);
    assert.equal(bridge.posted.length, 1);
    assert.equal(bridge.posted[0].targetOrigin, platformCase.origin);
    assert.equal(bridge.posted[0].message.requestId, requestId);
    assert.equal(bridge.posted[0].message.platform, platformCase.platform);
    assert.equal(bridge.posted[0].message.endpoint, platformCase.endpoint);
    assert.match(bridge.posted[0].message.nonce, /^fixture-nonce-/);

    bridge.dispatchWindowMessage({
      source: bridge.windowObject,
      origin: platformCase.origin,
      data: responseFor(bridge.posted[0].message, {
        nonce: bridge.posted[0].message.nonce,
      }),
    });
    assert.equal(responses.length, 1);
  }
});

test('platform content bridge ignores responses with mismatched source, origin, nonce, or requestId', () => {
  const origin = 'https://pgy.xiaohongshu.com';
  const bridge = evaluatePlatformContent({ origin });
  const responses = [];
  bridge.runtimeListeners[0]({
    channel: EXPECTED_CHANNEL,
    type: EXPECTED_REQUEST_TYPE,
    requestId: 'fixture-correlated-request',
    platform: 'pgy',
    endpoint: 'notes.list',
    payload: { pageNum: 1 },
  }, {}, (response) => responses.push(response));

  const forwarded = bridge.posted[0].message;
  const validData = responseFor(forwarded, { nonce: forwarded.nonce });
  const invalidEvents = [
    { source: {}, origin, data: validData },
    { source: bridge.windowObject, origin: 'https://attacker.example', data: validData },
    {
      source: bridge.windowObject,
      origin,
      data: Object.assign({}, validData, { nonce: 'fixture-wrong-nonce' }),
    },
    {
      source: bridge.windowObject,
      origin,
      data: Object.assign({}, validData, { requestId: 'fixture-wrong-request' }),
    },
  ];

  for (const event of invalidEvents) bridge.dispatchWindowMessage(event);
  assert.equal(responses.length, 0);

  bridge.dispatchWindowMessage({
    source: bridge.windowObject,
    origin,
    data: validData,
  });
  assert.equal(responses.length, 1);
  assert.equal(responses[0].requestId, 'fixture-correlated-request');
  assert.equal(responses[0].platform, 'pgy');
});
