const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const CHANNEL = 'xhs-page-bridge-v2';
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
  const responseBodies = Array.isArray(options.responseBodies) && options.responseBodies.length
    ? options.responseBodies
    : null;
  const messageListeners = [];
  const posted = [];
  const requests = [];
  const timers = [];

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
      const requestIndex = requests.indexOf(this);
      this.responseText = JSON.stringify(responseBodies
        ? responseBodies[Math.min(requestIndex, responseBodies.length - 1)]
        : responseBody);
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
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
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
    timers,
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
    async runNextTimer() {
      const timer = timers.shift();
      if (!timer) return false;
      timer.callback();
      await new Promise((resolve) => setImmediate(resolve));
      return true;
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

test('adstar retries the bounded login-info initialization error once and preserves safe diagnostics', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const evaluated = evaluateHook(hook, {
    responseBodies: [
      {
        success: false,
        msgCode: 'GET_USER_LOGIN_INFO_ERROR',
        msgInfo: '获取用户登录信息失败',
      },
      hook.responseBody,
    ],
  });

  await evaluated.dispatch(requestFor(hook));

  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.posted.length, 0, '受控恢复完成前不得提前报错');
  assert.equal(evaluated.timers.length, 1);
  assert.equal(evaluated.timers[0].delay, 800);

  await evaluated.runNextTimer();

  assert.equal(evaluated.requests.length, 2, '会话初始化仅重试一次');
  assert.equal(evaluated.posted.length, 1);
  assert.equal(evaluated.posted[0].message.ok, true);
});

test('adstar fails closed after one login-info retry and returns endpoint plus business diagnostics', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const loginInfoError = {
    success: false,
    msgCode: 'GET_USER_LOGIN_INFO_ERROR',
    msgInfo: '获取用户登录信息失败',
  };
  const evaluated = evaluateHook(hook, {
    responseBodies: [loginInfoError, loginInfoError],
  });

  await evaluated.dispatch(requestFor(hook));
  await evaluated.runNextTimer();

  assert.equal(evaluated.requests.length, 2);
  assert.equal(evaluated.timers.length, 0, '失败后不得继续重试');
  assert.equal(evaluated.posted.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(evaluated.posted[0].message)),
    {
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'adstar',
      requestId: 'fixture-request-123456',
      nonce: 'fixture-nonce-123456',
      ok: false,
      code: 'ADSTAR_API_ERROR',
      businessCode: 'GET_USER_LOGIN_INFO_ERROR',
      endpoint: 'projects.list',
      message: '[GET_USER_LOGIN_INFO_ERROR] 获取用户登录信息失败',
      retryable: false,
    },
  );
});

test('adstar does not retry or accept an unrelated business failure with HTTP 200', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const evaluated = evaluateHook(hook, {
    responseBody: {
      success: false,
      msgCode: 'STAR_PERMISSION_DENIED',
      msgInfo: '当前账号无权访问该数据',
      model: hook.responseBody.model,
    },
  });

  await evaluated.dispatch(requestFor(hook));

  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.timers.length, 0);
  assert.equal(evaluated.posted.length, 1);
  assert.equal(evaluated.posted[0].message.ok, false);
  assert.equal(evaluated.posted[0].message.businessCode, 'STAR_PERMISSION_DENIED');
  assert.equal(evaluated.posted[0].message.endpoint, 'projects.list');
  assert.equal(evaluated.posted[0].message.retryable, false);
  assert.match(evaluated.posted[0].message.message, /无权访问/);
});

test('adstar redacts sensitive query values from returned business diagnostics', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const evaluated = evaluateHook(hook, {
    responseBody: {
      success: false,
      msgCode: 'STAR_ERROR',
      msgInfo: 'request failed https://adstar.alimama.com/api/one/order/list?_tb_token_=fixture-secret&bizCode=adstar',
    },
  });

  await evaluated.dispatch(requestFor(hook));

  const response = JSON.stringify(evaluated.posted[0].message);
  assert.equal(response.includes('fixture-secret'), false);
  assert.equal(response.includes('_tb_token_'), false);
  assert.match(evaluated.posted[0].message.message, /bizCode=adstar/);
});

test('adstar conservatively redacts credential aliases and authorization schemes without changing the business code', async () => {
  const hook = HOOKS.find((item) => item.platform === 'adstar');
  const evaluated = evaluateHook(hook, {
    responseBody: {
      success: false,
      msgCode: 'STAR_PERMISSION_DENIED',
      msgInfo: [
        'request failed',
        'Authorization: Bearer fixture-bearer-secret',
        'Proxy-Authorization: Basic Zml4dHVyZS1iYXNpYy1zZWNyZXQ=',
        'https://adstar.alimama.com/api/one/order/list?sessionId=fixture-session-secret&secret=fixture-secret-value&csrf=fixture-csrf-secret&accessKey=fixture-access-key&apiKey=fixture-api-key&bizCode=adstar',
      ].join('; '),
    },
  });

  await evaluated.dispatch(requestFor(hook));

  const response = JSON.stringify(evaluated.posted[0].message);
  assert.equal(evaluated.posted[0].message.businessCode, 'STAR_PERMISSION_DENIED');
  assert.match(evaluated.posted[0].message.message, /\[STAR_PERMISSION_DENIED\]/);
  assert.match(evaluated.posted[0].message.message, /bizCode=adstar/);
  assert.doesNotMatch(response, /fixture-bearer-secret|Zml4dHVyZS1iYXNpYy1zZWNyZXQ=/);
  assert.doesNotMatch(
    response,
    /fixture-session-secret|fixture-secret-value|fixture-csrf-secret|fixture-access-key|fixture-api-key/,
  );
  assert.doesNotMatch(response, /sessionId=|secret=|csrf=|accessKey=|apiKey=/i);
});
