const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const collectorResource = 'xhs/pgy-collector.js';
const collectorPath = path.join(root, collectorResource);
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const syncSource = fs.readFileSync(
  path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs'),
  'utf8',
);
const pageHookPath = path.join(root, 'pgy-page-hook.js');
const pageHookSource = fs.readFileSync(pageHookPath, 'utf8');

const CHANNEL = 'xhs-page-bridge-v2';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
const PGY_ORIGIN = 'https://pgy.xiaohongshu.com';
const ALLOWED_BODY_FIELDS = [
  'brandUserIds', 'startTime', 'endTime', 'pageNum', 'pageSize', 'sorts', 'sceneType',
];
const PGY_ENDPOINTS = [
  {
    endpoint: 'identity.get',
    method: 'POST',
    pathname: '/api/solar/content/note/list',
    payload: { pageNum: 1, pageSize: 1 },
  },
  {
    endpoint: 'notes.sum',
    method: 'POST',
    pathname: '/api/solar/content/note/list/sum',
    payload: { pageNum: 1, pageSize: 30 },
  },
  {
    endpoint: 'notes.list',
    method: 'POST',
    pathname: '/api/solar/content/note/list',
    payload: { pageNum: 2, pageSize: 30 },
  },
];

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function importedWorkerScripts(source) {
  const match = source.match(/importScripts\s*\(([\s\S]*?)\)\s*;/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+\.js)['"]/g), (entry) => entry[1]);
}

function evaluatePgyHook() {
  const listeners = [];
  const posted = [];
  const requests = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.status = 0;
      this.responseText = '';
      requests.push(this);
    }

    open(method, url, async = true) {
      this.method = String(method).toUpperCase();
      this.url = String(url);
      this.async = async;
    }

    setRequestHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    }

    send(body) {
      this.body = body;
      this.status = 200;
      this.responseText = JSON.stringify({
        code: 0,
        data: {
          pageNum: 1,
          pageSize: 1,
          total: 1,
          totalPage: 1,
          list: [{
            noteId: 'fictional-pgy-note-001',
            reportBrandUserId: 'fictional-brand-account-001',
            reportBrandUserName: '虚构测试品牌',
          }],
        },
      });
      queueMicrotask(() => this.onload());
    }
  }

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.self = windowObject;
  windowObject.top = windowObject;

  const context = vm.createContext({
    TextEncoder,
    URL,
    XMLHttpRequest: FakeXMLHttpRequest,
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    document: {
      cookie: 'session=fixture-private-cookie; xsec_token=fixture-private-token',
    },
    location: {
      href: `${PGY_ORIGIN}/solar/post-trade/content-manage`,
      origin: PGY_ORIGIN,
    },
    queueMicrotask,
    self: windowObject,
    top: windowObject,
    window: windowObject,
  });
  vm.runInContext(pageHookSource, context, { filename: pageHookPath });

  return {
    listeners,
    posted,
    requests,
    windowObject,
    async request(endpoint, sequence) {
      const payload = Object.assign({
        brandUserIds: ['fictional-brand-account-001'],
        startTime: '2030-01-01',
        endTime: '2030-01-07',
        sorts: [],
        sceneType: 0,
        url: 'https://attacker.example/exfiltrate?xsec_token=fixture-override-token',
        path: '/admin/deleteEverything',
        method: 'DELETE',
        headers: { authorization: 'Bearer fixture-private-token' },
        cookie: 'fixture-private-cookie',
        token: 'fixture-private-token',
      }, endpoint.payload);
      const message = {
        channel: CHANNEL,
        type: REQUEST_TYPE,
        platform: 'pgy',
        endpoint: endpoint.endpoint,
        nonce: `fixture-pgy-nonce-${sequence}`,
        requestId: `fixture-pgy-request-${sequence}`,
        payload,
      };
      for (const listener of listeners) listener({
        source: windowObject,
        origin: PGY_ORIGIN,
        data: message,
      });
      await new Promise((resolve) => setImmediate(resolve));
      return message;
    },
  };
}

test('the standalone pgy collector exists', () => {
  assert.equal(
    fs.existsSync(collectorPath),
    true,
    `缺少独立蒲公英采集器：${collectorResource}`,
  );
});

test('background service worker imports the standalone pgy collector', () => {
  assert.ok(
    importedWorkerScripts(backgroundSource).includes(collectorResource),
    `background importScripts 未加载：${collectorResource}`,
  );
});

test('cloud extension ZIP explicitly packages the standalone pgy collector', () => {
  assert.ok(
    quotedLiteralPattern(collectorResource).test(syncSource),
    `sync-web-tool.mjs 的 ZIP 资源清单缺少：${collectorResource}`,
  );
});

test('pgy page hook allowlists identity, sum, and list endpoints with analyzer paths', () => {
  for (const endpoint of PGY_ENDPOINTS) {
    assert.ok(
      quotedLiteralPattern(endpoint.endpoint).test(pageHookSource),
      `蒲公英 page hook 缺少 endpoint：${endpoint.endpoint}`,
    );
    assert.ok(
      quotedLiteralPattern(endpoint.pathname).test(pageHookSource),
      `蒲公英 page hook 缺少固定 path：${endpoint.pathname}`,
    );
  }
  for (const field of ALLOWED_BODY_FIELDS) {
    assert.ok(
      quotedLiteralPattern(field).test(pageHookSource),
      `蒲公英请求字段白名单缺少：${field}`,
    );
  }
});

test('pgy endpoints keep fixed requests, correlate responses, and do not leak secrets or URLs', async () => {
  const evaluated = evaluatePgyHook();
  assert.equal(evaluated.listeners.length, 1);

  for (let index = 0; index < PGY_ENDPOINTS.length; index += 1) {
    const endpoint = PGY_ENDPOINTS[index];
    const requestMessage = await evaluated.request(endpoint, index + 1);
    assert.equal(evaluated.requests.length, index + 1, endpoint.endpoint);
    assert.equal(evaluated.posted.length, index + 1, endpoint.endpoint);
    const xhr = evaluated.requests[index];
    const requestUrl = new URL(xhr.url, PGY_ORIGIN);
    const response = evaluated.posted[index];
    const requestBody = JSON.parse(xhr.body);

    assert.equal(xhr.method, endpoint.method);
    assert.equal(requestUrl.origin, PGY_ORIGIN);
    assert.equal(requestUrl.pathname, endpoint.pathname);
    assert.equal(xhr.headers.authorization, undefined);
    assert.equal(xhr.headers.cookie, undefined);
    assert.ok(xhr.headers['content-type'].includes('application/json'));
    assert.deepEqual(
      Object.keys(requestBody).sort(),
      ALLOWED_BODY_FIELDS.filter((field) => (
        Object.prototype.hasOwnProperty.call(requestMessage.payload, field)
      )).sort(),
    );
    assert.equal(response.targetOrigin, PGY_ORIGIN);
    assert.equal(response.message.channel, CHANNEL);
    assert.equal(response.message.type, RESPONSE_TYPE);
    assert.equal(response.message.platform, 'pgy');
    assert.equal(response.message.requestId, requestMessage.requestId);
    assert.equal(response.message.nonce, requestMessage.nonce);
    assert.equal(response.message.ok, true);
  }

  const serializedResponses = JSON.stringify(evaluated.posted);
  for (const secret of [
    'fixture-private-cookie',
    'fixture-private-token',
    'fixture-override-token',
    'xsec_token',
    'attacker.example',
    '/admin/deleteEverything',
  ]) {
    assert.equal(serializedResponses.includes(secret), false, `响应泄露：${secret}`);
  }
  assert.equal(evaluated.posted.some((entry) => 'url' in entry.message), false);
});
