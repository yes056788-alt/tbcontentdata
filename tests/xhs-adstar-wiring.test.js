const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const collectorResource = 'xhs/adstar-collector.js';
const collectorPath = path.join(root, collectorResource);
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const syncSource = fs.readFileSync(
  path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs'),
  'utf8',
);
const pageHookPath = path.join(root, 'adstar-page-hook.js');
const pageHookSource = fs.readFileSync(pageHookPath, 'utf8');

const CHANNEL = 'xhs-page-bridge-v3';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
const ADSTAR_ORIGIN = 'https://adstar.alimama.com';
const ADSTAR_ENDPOINTS = [
  {
    endpoint: 'projects.list',
    pathname: '/api/one/deliveryProject/list',
    payload: { pageNo: 1, pageSize: 20 },
  },
  {
    endpoint: 'orders.list',
    pathname: '/api/one/order/list',
    payload: { saleType: 1, memberType: 5, pageNo: 1, pageSize: 20 },
  },
  {
    endpoint: 'reports.summary',
    pathname: '/api/report/multiscene/query/summary/data',
    payload: {
      bizType: 'fixture_summary',
      startTime: '2030-01-01 00:00:00',
      endTime: '2030-01-07 23:59:59',
      ext: { projectId: 'fictional-project-001' },
    },
  },
  {
    endpoint: 'reports.detail',
    pathname: '/api/report/multiscene/query/detail/data',
    payload: {
      bizType: 'fixture_detail',
      dataBatch: 'project',
      startTime: '2030-01-01 00:00:00',
      endTime: '2030-01-07 23:59:59',
      ext: { projectId: 'fictional-project-001' },
      pageNo: 1,
      pageSize: 20,
    },
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

function evaluateAdstarHook() {
  const listeners = [];
  const posted = [];
  const requests = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.status = 0;
      this.responseText = '';
      requests.push(this);
    }

    open(method, url, async = true) {
      this.method = String(method).toUpperCase();
      this.url = String(url);
      this.async = async;
    }

    send(body) {
      this.body = body;
      this.status = 200;
      this.responseText = JSON.stringify({
        success: true,
        model: { result: [], totalCount: 0 },
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
    decodeURIComponent,
    document: { cookie: '_tb_token_=fixture-star-token-must-not-leak' },
    location: {
      href: `${ADSTAR_ORIGIN}/fixture-page`,
      origin: ADSTAR_ORIGIN,
    },
    performance: { getEntriesByType() { return []; } },
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
    async request(endpoint) {
      const sequence = requests.length + 1;
      const message = {
        channel: CHANNEL,
        type: REQUEST_TYPE,
        platform: 'adstar',
        endpoint: endpoint.endpoint,
        nonce: `fixture-nonce-${sequence}`,
        requestId: `fixture-request-${sequence}`,
        payload: endpoint.payload,
      };
      for (const listener of listeners) listener({
        source: windowObject,
        origin: ADSTAR_ORIGIN,
        data: message,
      });
      await new Promise((resolve) => setImmediate(resolve));
      return message;
    },
  };
}

test('the standalone adstar collector exists', () => {
  assert.equal(
    fs.existsSync(collectorPath),
    true,
    `缺少独立星河采集器：${collectorResource}`,
  );
});

test('background service worker imports the standalone adstar collector', () => {
  assert.ok(
    importedWorkerScripts(backgroundSource).includes(collectorResource),
    `background importScripts 未加载：${collectorResource}`,
  );
});

test('cloud extension ZIP explicitly packages the standalone adstar collector', () => {
  assert.ok(
    quotedLiteralPattern(collectorResource).test(syncSource),
    `sync-web-tool.mjs 的 ZIP 资源清单缺少：${collectorResource}`,
  );
});

test('adstar page hook allowlists every required fixed endpoint', () => {
  for (const endpoint of ADSTAR_ENDPOINTS) {
    assert.ok(
      quotedLiteralPattern(endpoint.endpoint).test(pageHookSource),
      `星河 page hook 缺少 endpoint：${endpoint.endpoint}`,
    );
    assert.ok(
      quotedLiteralPattern(endpoint.pathname).test(pageHookSource),
      `星河 page hook 缺少固定 path：${endpoint.pathname}`,
    );
  }
});

test('adstar page hook uses its dynamic token without returning tokenized URLs', async () => {
  const evaluated = evaluateAdstarHook();
  assert.equal(evaluated.listeners.length, 1);

  for (const endpoint of ADSTAR_ENDPOINTS) {
    const message = await evaluated.request(endpoint);
    const xhr = evaluated.requests.at(-1);
    const response = evaluated.posted.at(-1);
    const requestUrl = new URL(xhr.url, ADSTAR_ORIGIN);

    assert.equal(xhr.method, 'GET');
    assert.equal(requestUrl.origin, ADSTAR_ORIGIN);
    assert.equal(requestUrl.pathname, endpoint.pathname);
    assert.equal(requestUrl.searchParams.get('_tb_token_'), 'fixture-star-token-must-not-leak');
    assert.equal(response.targetOrigin, ADSTAR_ORIGIN);
    assert.equal(response.message.channel, CHANNEL);
    assert.equal(response.message.type, RESPONSE_TYPE);
    assert.equal(response.message.requestId, message.requestId);
    assert.equal(response.message.nonce, message.nonce);
  }

  const serializedResponses = JSON.stringify(evaluated.posted);
  assert.equal(serializedResponses.includes('fixture-star-token-must-not-leak'), false);
  assert.equal(serializedResponses.includes('_tb_token_'), false);
});
