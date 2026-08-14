const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const CHANNEL = 'xhs-page-bridge-v1';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';

const HOOKS = [
  {
    platform: 'pgy',
    filename: 'pgy-page-hook.js',
    origin: 'https://pgy.xiaohongshu.com',
    endpoint: 'notes.list',
    method: 'POST',
    pathname: '/api/solar/content/note/list',
    responseBody: { code: 0, data: { list: [], total: 0, totalPage: 0 } },
  },
  {
    platform: 'juguang',
    filename: 'juguang-page-hook.js',
    origin: 'https://ad.xiaohongshu.com',
    endpoint: 'reports.query',
    method: 'POST',
    pathname: '/api/leona/rtb/common/data/report',
    responseBody: { code: 0, data: { dataList: [], page: { totalCount: 0 } } },
  },
  {
    platform: 'adstar',
    filename: 'adstar-page-hook.js',
    origin: 'https://adstar.alimama.com',
    endpoint: 'projects.list',
    method: 'GET',
    pathname: '/api/one/deliveryProject/list',
    responseBody: { success: true, model: { result: [], totalCount: 0 } },
  },
];

function evaluateHook(hook, options = {}) {
  const source = fs.readFileSync(path.join(root, hook.filename), 'utf8');
  const origin = options.origin || hook.origin;
  const topFrame = options.topFrame !== false;
  const responseBody = options.responseBody || hook.responseBody;
  const messageListeners = [];
  const posted = [];
  const requests = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.listeners = new Map();
      this.responseText = '';
      this.status = 0;
      requests.push(this);
    }

    open(method, url, async = true) {
      this.method = String(method || '').toUpperCase();
      this.url = String(url || '');
      this.async = async;
    }

    setRequestHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    send(body) {
      this.body = body;
      this.status = 200;
      this.responseText = JSON.stringify(responseBody);
      queueMicrotask(() => {
        if (typeof this.onload === 'function') this.onload();
        for (const listener of this.listeners.get('load') || []) listener.call(this);
      });
    }

    abort() {
      this.aborted = true;
    }
  }

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
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
    XMLHttpRequest: FakeXMLHttpRequest,
    clearTimeout() {},
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    decodeURIComponent,
    document: {
      cookie: '_tb_token_=fixture-dynamic-star-token',
    },
    location: {
      href: `${origin}/fixture-page`,
      origin,
    },
    performance: {
      getEntriesByType() { return []; },
    },
    queueMicrotask,
    self: windowObject,
    setTimeout() { return 1; },
    top: windowObject.top,
    window: windowObject,
  });

  vm.runInContext(source, context, { filename: path.join(root, hook.filename) });
  return {
    context,
    messageListeners,
    origin,
    posted,
    requests,
    windowObject,
    async dispatch(data, eventOverrides = {}) {
      const event = Object.assign({
        source: windowObject,
        origin,
        data,
      }, eventOverrides);
      for (const listener of messageListeners) listener(event);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function requestFor(hook, overrides = {}) {
  return Object.assign({
    channel: CHANNEL,
    type: REQUEST_TYPE,
    platform: hook.platform,
    endpoint: hook.endpoint,
    nonce: 'fixture-nonce-123456',
    requestId: 'fixture-request-123456',
    payload: hook.platform === 'adstar'
      ? { pageNo: 1, pageSize: 20 }
      : { pageNum: 1, pageSize: 20 },
  }, overrides);
}

function requestUrl(request, origin) {
  return new URL(request.url, origin);
}

test('each page hook registers exactly one listener only in its top-level exact origin', () => {
  for (let index = 0; index < HOOKS.length; index += 1) {
    const hook = HOOKS[index];
    const valid = evaluateHook(hook);
    assert.equal(valid.messageListeners.length, 1, `${hook.platform} exact top frame`);

    const child = evaluateHook(hook, { topFrame: false });
    assert.equal(child.messageListeners.length, 0, `${hook.platform} child frame`);

    const otherPlatformOrigin = HOOKS[(index + 1) % HOOKS.length].origin;
    const otherPlatform = evaluateHook(hook, { origin: otherPlatformOrigin });
    assert.equal(otherPlatform.messageListeners.length, 0, `${hook.platform} wrong platform origin`);

    const wildcardSubdomain = evaluateHook(hook, {
      origin: hook.origin.replace('https://', 'https://evil.'),
    });
    assert.equal(wildcardSubdomain.messageListeners.length, 0, `${hook.platform} wildcard subdomain`);
  }
});

test('page hooks ignore malformed, cross-origin, oversized, and unknown endpoint requests', async () => {
  const hook = HOOKS[0];
  const evaluated = evaluateHook(hook);
  const valid = requestFor(hook);
  const invalidCases = [
    { data: Object.assign({}, valid, { channel: 'wrong-channel' }) },
    { data: Object.assign({}, valid, { type: 'WRONG_TYPE' }) },
    { data: Object.assign({}, valid, { platform: 'juguang' }) },
    { data: Object.assign({}, valid, { endpoint: 'admin.deleteEverything' }) },
    { data: Object.assign({}, valid, { nonce: '' }) },
    { data: Object.assign({}, valid, { requestId: '' }) },
    {
      data: Object.assign({}, valid, { payload: { oversized: 'x'.repeat(70 * 1024) } }),
    },
    { data: valid, eventOverrides: { source: {} } },
    { data: valid, eventOverrides: { origin: 'https://attacker.example' } },
  ];

  for (const invalid of invalidCases) {
    await evaluated.dispatch(invalid.data, invalid.eventOverrides);
  }
  assert.equal(evaluated.requests.length, 0);
  assert.equal(evaluated.posted.length, 0);
});

test('each allowlisted endpoint uses its fixed method and path and ignores request overrides', async () => {
  for (const hook of HOOKS) {
    const evaluated = evaluateHook(hook);
    const payload = hook.platform === 'adstar'
      ? { pageNo: 2, pageSize: 20 }
      : { pageNum: 2, pageSize: 20 };
    Object.assign(payload, {
      url: 'https://attacker.example/exfiltrate',
      path: '/admin/deleteEverything',
      method: 'DELETE',
      headers: { authorization: 'Bearer fixture-secret' },
    });

    await evaluated.dispatch(requestFor(hook, { payload }));
    assert.equal(evaluated.requests.length, 1, hook.platform);
    const xhr = evaluated.requests[0];
    const url = requestUrl(xhr, hook.origin);
    assert.equal(xhr.method, hook.method, `${hook.platform} method`);
    assert.equal(url.origin, hook.origin, `${hook.platform} origin`);
    assert.equal(url.pathname, hook.pathname, `${hook.platform} pathname`);
    assert.equal(xhr.headers.authorization, undefined, `${hook.platform} untrusted header`);
    assert.equal(xhr.url.includes('attacker.example'), false, `${hook.platform} untrusted url`);
    assert.equal(xhr.url.includes('deleteEverything'), false, `${hook.platform} untrusted path`);

    if (hook.method === 'POST') {
      const body = JSON.parse(xhr.body);
      assert.equal(body.url, undefined, `${hook.platform} body url override`);
      assert.equal(body.path, undefined, `${hook.platform} body path override`);
      assert.equal(body.method, undefined, `${hook.platform} body method override`);
      assert.equal(body.headers, undefined, `${hook.platform} body headers override`);
      assert.equal(body.pageNum, 2, `${hook.platform} allowlisted body field`);
    }

    assert.equal(evaluated.posted.length, 1, `${hook.platform} response count`);
    const response = evaluated.posted[0];
    assert.equal(response.targetOrigin, hook.origin);
    assert.equal(response.message.channel, CHANNEL);
    assert.equal(response.message.type, RESPONSE_TYPE);
    assert.equal(response.message.platform, hook.platform);
    assert.equal(response.message.nonce, 'fixture-nonce-123456');
    assert.equal(response.message.requestId, 'fixture-request-123456');
    assert.equal(response.message.ok, true);
  }
});

test('adstar reads the current token into its fixed request URL without returning it', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const evaluated = evaluateHook(hook);
  await evaluated.dispatch(requestFor(hook));

  assert.equal(evaluated.requests.length, 1);
  const url = requestUrl(evaluated.requests[0], hook.origin);
  assert.equal(url.searchParams.get('_tb_token_'), 'fixture-dynamic-star-token');
  assert.equal(url.searchParams.get('bizCode'), 'adstar');
  assert.equal(url.searchParams.get('pageNo'), '1');
  assert.equal(url.searchParams.get('pageSize'), '20');

  assert.equal(evaluated.posted.length, 1);
  assert.equal(
    JSON.stringify(evaluated.posted[0].message).includes('fixture-dynamic-star-token'),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(evaluated.posted[0].message, 'url'), false);
});
