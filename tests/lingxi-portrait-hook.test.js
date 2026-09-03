const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const hookPath = path.join(root, 'lingxi-page-hook.js');
const ORIGIN = 'https://idea.xiaohongshu.com';
const CHANNEL = 'xhs-page-bridge-v2';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';

const GROUP_LIST_PATH = '/api/idea/audience/group/list';
const PORTRAIT_PANEL_PATH = '/api/idea/audience/portrait/panel/view';
const DEFAULT_GROUP_TYPES = [1, 2, 11, 31, 3, 21];

function apiSuccess(data) {
  return { code: 0, success: true, data };
}

function portraitFixture(overrides = {}) {
  return Object.assign({
    panelType: 'TABLE',
    headers: [
      { fieldType: 'xIndex', fieldEn: 'segmentName', fieldCn: '人群分层' },
      { fieldType: 'yIndexLeft', fieldEn: 'rate', fieldCn: '占比' },
      { fieldType: 'yIndexLeft', fieldEn: 'tgi', fieldCn: 'TGI' },
      { fieldType: 'yIndexLeft', fieldEn: 'industryTgi', fieldCn: '行业 TGI' },
    ],
    tableResult: [
      {
        segmentName: '高潜人群',
        rate: 0,
        tgi: 0,
        industryTgi: 93,
        brandCode: 'brand-01',
        parentName: '美妆',
      },
    ],
    total: 1,
  }, overrides);
}

function evaluateHook(options = {}) {
  const source = fs.readFileSync(hookPath, 'utf8');
  const origin = options.origin || ORIGIN;
  const topFrame = options.topFrame !== false;
  const responseBodies = options.responseBodies || [
    apiSuccess({ firstPush: false, list: [], total: 0 }),
  ];
  const listeners = [];
  const posted = [];
  const requests = [];
  let responseIndex = 0;
  let cookieReadCount = 0;

  function nextResponse() {
    const fixture = responseBodies[Math.min(responseIndex, responseBodies.length - 1)] || {};
    responseIndex += 1;
    if (Object.prototype.hasOwnProperty.call(fixture, 'body')) {
      return {
        body: fixture.body,
        status: fixture.status == null ? 200 : fixture.status,
      };
    }
    return { body: fixture, status: 200 };
  }

  class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.listeners = new Map();
      this.readyState = 0;
      this.responseText = '';
      this.status = 0;
      requests.push(this);
    }

    open(method, url, async = true) {
      this.method = String(method || '').toUpperCase();
      this.url = String(url || '');
      this.async = async;
      this.readyState = 1;
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
      const response = nextResponse();
      this.status = response.status;
      this.readyState = 4;
      this.responseText = JSON.stringify(response.body);
      this.response = this.responseText;
      queueMicrotask(() => {
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onload === 'function') this.onload();
        for (const listener of this.listeners.get('load') || []) listener.call(this);
      });
    }

    abort() {
      this.aborted = true;
    }
  }

  async function fakeFetch(url, init = {}) {
    const response = nextResponse();
    const request = {
      body: init.body,
      headers: Object.fromEntries(new globalThis.Headers(init.headers || {}).entries()),
      method: String(init.method || 'GET').toUpperCase(),
      url: String(url),
      withCredentials: init.credentials === 'include',
    };
    requests.push(request);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() { return response.body; },
      async text() { return JSON.stringify(response.body); },
    };
  }

  const location = {
    href: `${origin}/idea/creativity/audience/list`,
    hostname: new URL(origin).hostname,
    origin,
  };
  const document = {};
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      cookieReadCount += 1;
      return 'sessionId=fixture-document-cookie-secret';
    },
  });

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.document = document;
  windowObject.fetch = fakeFetch;
  windowObject.location = location;
  windowObject.self = windowObject;
  windowObject.top = topFrame ? windowObject : { frame: 'parent' };
  windowObject.window = windowObject;
  windowObject.XMLHttpRequest = FakeXMLHttpRequest;

  const context = vm.createContext({
    Headers: globalThis.Headers,
    TextEncoder,
    URL,
    XMLHttpRequest: FakeXMLHttpRequest,
    clearTimeout() {},
    console: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: fakeFetch,
    location,
    queueMicrotask,
    self: windowObject,
    setTimeout() { return 1; },
    top: windowObject.top,
    window: windowObject,
  });

  vm.runInContext(source, context, { filename: hookPath });
  return {
    get cookieReadCount() { return cookieReadCount; },
    listeners,
    origin,
    posted,
    requests,
    windowObject,
    async dispatch(data, eventOverrides = {}) {
      const event = Object.assign({
        data,
        origin,
        source: windowObject,
      }, eventOverrides);
      const results = listeners.map((listener) => listener(event));
      await Promise.allSettled(results.map((result) => Promise.resolve(result)));
      for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function request(endpoint, payload = {}, overrides = {}) {
  return Object.assign({
    channel: CHANNEL,
    endpoint,
    nonce: 'fixture-lingxi-nonce-123456',
    payload,
    platform: 'lingxi',
    requestId: 'fixture-lingxi-request-123456',
    type: REQUEST_TYPE,
  }, overrides);
}

function requestBody(record) {
  return JSON.parse(record.body || '{}');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Lingxi hook installs only in the top-level exact IDEA origin', () => {
  const valid = evaluateHook();
  assert.equal(valid.listeners.length, 1);

  const childFrame = evaluateHook({ topFrame: false });
  assert.equal(childFrame.listeners.length, 0);

  for (const origin of [
    'http://idea.xiaohongshu.com',
    'https://evil.idea.xiaohongshu.com',
    'https://ad.xiaohongshu.com',
    'https://www.xiaohongshu.com',
  ]) {
    assert.equal(evaluateHook({ origin }).listeners.length, 0, origin);
  }
});

test('Lingxi hook correlates request and response envelopes with nonce and requestId', async () => {
  const evaluated = evaluateHook();
  const validRequest = request('listGroups');

  await evaluated.dispatch(Object.assign({}, validRequest, { nonce: '' }));
  await evaluated.dispatch(validRequest, { source: {} });
  await evaluated.dispatch(validRequest, { origin: 'https://attacker.example' });
  assert.equal(evaluated.requests.length, 0);
  assert.equal(evaluated.posted.length, 0);

  await evaluated.dispatch(validRequest);
  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.posted.length, 1);
  assert.deepEqual(
    plain(Object.assign({}, evaluated.posted[0].message, { data: undefined })),
    {
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'lingxi',
      requestId: validRequest.requestId,
      nonce: validRequest.nonce,
      ok: true,
    },
  );
  assert.equal(evaluated.posted[0].targetOrigin, ORIGIN);
});

test('listGroups mirrors Lingxi public-host defaults for an empty type filter', async () => {
  const evaluated = evaluateHook({
    responseBodies: [apiSuccess({ firstPush: false, list: [{ groupId: 'group-1' }], total: 1 })],
  });

  await evaluated.dispatch(request('listGroups', { types: [] }));

  assert.equal(evaluated.requests.length, 1);
  const outgoing = evaluated.requests[0];
  const url = new URL(outgoing.url, ORIGIN);
  assert.equal(outgoing.method, 'POST');
  assert.equal(url.origin, ORIGIN);
  assert.equal(url.pathname, GROUP_LIST_PATH);
  assert.deepEqual(plain(requestBody(outgoing)), {
    pageNum: 1,
    pageSize: 20,
    types: DEFAULT_GROUP_TYPES,
    status: [],
    sourceTypeList: [],
    dmpFlag: 5,
  });
  assert.equal(evaluated.posted[0].message.ok, true);
});

test('getPortraitPanel posts the fixed panel path and EXT audience configuration', async () => {
  const evaluated = evaluateHook({ responseBodies: [apiSuccess(portraitFixture())] });
  const payload = {
    groupId: 'group-42',
    panelId: 17,
    panelName: '内容兴趣类目',
    page: 3,
    pageSize: 1000,
    filterField: [{
      fieldValues: ['province'],
      fieldCn: '地域等级',
      fieldEn: 'flatOption',
    }],
    orderField: ['tgi', 'item'],
    orderType: 'desc',
    bizType: 'ATTACKER_OVERRIDE',
    method: 'DELETE',
    path: '/admin/deleteEverything',
    url: 'https://attacker.example/exfiltrate',
  };

  await evaluated.dispatch(request('getPortraitPanel', payload));

  assert.equal(evaluated.requests.length, 1);
  const outgoing = evaluated.requests[0];
  const url = new URL(outgoing.url, ORIGIN);
  assert.equal(outgoing.method, 'POST');
  assert.equal(url.origin, ORIGIN);
  assert.equal(url.pathname, PORTRAIT_PANEL_PATH);
  assert.deepEqual(plain(requestBody(outgoing)), {
    groupId: 'group-42',
    panelId: 17,
    panelName: '内容兴趣类目',
    page: 3,
    pageSize: 1000,
    filterField: [{
      fieldValues: ['province'],
      fieldCn: '地域等级',
      fieldEn: 'flatOption',
    }],
    orderField: ['tgi', 'item'],
    orderType: 'desc',
    bizType: 'EXT_IDEA_AUDIENCE',
  });
});

test('getPortraitPanel normalizes xIndex/yIndexLeft headers and preserves portrait row metrics', async () => {
  const evaluated = evaluateHook({ responseBodies: [apiSuccess(portraitFixture())] });

  await evaluated.dispatch(request('getPortraitPanel', {
    groupId: 'group-42',
    panelId: 1,
    panelName: '性别',
    page: 1,
    pageSize: 20,
  }));

  const data = plain(evaluated.posted[0].message.data);
  assert.deepEqual(data.dimensions.map((header) => header.fieldEn), ['segmentName']);
  assert.deepEqual(
    data.metrics.map((header) => header.fieldEn),
    ['rate', 'tgi', 'industryTgi'],
  );
  assert.equal(data.rows.length, 1);
  assert.deepEqual(data.rows[0], {
    segmentName: '高潜人群',
    rate: 0,
    tgi: 0,
    industryTgi: 93,
    brandCode: 'brand-01',
    parentName: '美妆',
  });
});

test('buildPortrait preserves successful panels when another panel fails', async () => {
  const evaluated = evaluateHook({
    responseBodies: [
      apiSuccess(portraitFixture()),
      { code: 50001, success: false, msg: '年龄画像暂时不可用' },
    ],
  });

  await evaluated.dispatch(request('buildPortrait', {
    groupId: 'group-42',
    panels: [
      { panelId: 1, panelName: '性别' },
      { panelId: 2, panelName: '年龄' },
    ],
  }));

  assert.equal(evaluated.requests.length, 2);
  assert.deepEqual(
    evaluated.requests.map((outgoing) => new URL(outgoing.url, ORIGIN).pathname),
    [PORTRAIT_PANEL_PATH, PORTRAIT_PANEL_PATH],
  );
  assert.equal(evaluated.posted.length, 1);
  assert.equal(evaluated.posted[0].message.ok, true);
  const data = plain(evaluated.posted[0].message.data);
  assert.equal(data.partial, true);
  assert.equal(data.panels.length, 2);
  assert.equal(data.panels[0].panelId, 1);
  assert.equal(data.panels[0].rows.length, 1);
  assert.equal(data.panels[1].panelId, 2);
  assert.equal(data.panels[1].rows.length, 0);
  assert.match(data.panels[1].error, /年龄画像暂时不可用/);
  assert.equal(data.warnings.length, 1);
  assert.match(data.warnings[0], /年龄/);
});

test('Lingxi hook neither accepts injected headers nor exposes cookies, headers, or tokens', async () => {
  const sensitivePortrait = portraitFixture({
    authorization: 'Bearer fixture-response-bearer-secret',
    cookie: 'fixture-response-cookie-secret',
    headers: portraitFixture().headers.concat([
      { fieldType: 'yIndexLeft', fieldEn: 'accessToken', fieldCn: '令牌' },
    ]),
    tableResult: [{
      segmentName: '高潜人群',
      rate: 0.25,
      accessToken: 'fixture-row-access-token',
      cookie: 'fixture-row-cookie-secret',
      headers: { authorization: 'fixture-row-authorization-secret' },
    }],
    token: 'fixture-response-token',
  });
  const evaluated = evaluateHook({ responseBodies: [apiSuccess(sensitivePortrait)] });

  await evaluated.dispatch(request('getPortraitPanel', {
    groupId: 'group-42',
    panelId: 1,
    panelName: '性别',
    page: 1,
    pageSize: 20,
    headers: {
      authorization: 'Bearer fixture-injected-bearer-secret',
      cookie: 'fixture-injected-cookie-secret',
      'x-token': 'fixture-injected-token',
    },
    accessToken: 'fixture-payload-token',
  }));

  const outgoing = evaluated.requests[0];
  const body = requestBody(outgoing);
  assert.equal(body.headers, undefined);
  assert.equal(body.accessToken, undefined);
  assert.equal(outgoing.headers.authorization, undefined);
  assert.equal(outgoing.headers.cookie, undefined);
  assert.equal(outgoing.headers['x-token'], undefined);
  assert.equal(evaluated.cookieReadCount, 0);

  const serialized = JSON.stringify(evaluated.posted[0].message);
  assert.doesNotMatch(serialized, /fixture-(?:document|response|row|injected|payload)/);
  assert.equal(Object.prototype.hasOwnProperty.call(evaluated.posted[0].message.data, 'headers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(evaluated.posted[0].message.data, 'cookie'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(evaluated.posted[0].message.data, 'token'), false);
});
