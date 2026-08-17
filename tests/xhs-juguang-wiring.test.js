const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const collectorResource = 'xhs/juguang-collector.js';
const collectorPath = path.join(root, collectorResource);
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const syncSource = fs.readFileSync(
  path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs'),
  'utf8',
);
const pageHookPath = path.join(root, 'juguang-page-hook.js');
const pageHookSource = fs.readFileSync(pageHookPath, 'utf8');
const platformContentSource = fs.readFileSync(path.join(root, 'xhs-platform-content.js'), 'utf8');
const pageClient = require('../xhs/page-client');

const CHANNEL = 'xhs-page-bridge-v2';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
const JUGUANG_ORIGIN = 'https://ad.xiaohongshu.com';
const MCC_ORIGIN = 'https://mcc.xiaohongshu.com';
const REPORT_PATH = '/api/leona/rtb/common/data/report';
const CURRENT_ACCOUNT_PATH = '/api/edith/get_account_info';
const ACCOUNT_LIST_PATH = '/api/edith/page_user_account';
const REPORT_FIELDS = [
  'pageNum', 'pageSize', 'sorts', 'filters', 'dataCaliber', 'timeUnit', 'splitColumns',
  'startDate', 'endDate', 'webModule', 'dataSource', 'dataPattern', 'columns',
];
const LIST_FIELDS = ['pageIndex', 'pageSize', 'shadowAccount'];
const MINIMAL_IDENTITY_FIELDS = [
  'accountType', 'advertiserId', 'brandUserId', 'brandUserName', 'name', 'vSellerId',
];

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function importedWorkerScripts(source) {
  const match = source.match(/importScripts\s*\(([\s\S]*?)\)\s*;/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+\.js)['"]/g), (entry) => entry[1]);
}

function responseBodyFor(url) {
  if (url.origin === JUGUANG_ORIGIN && url.pathname === REPORT_PATH) {
    return {
      code: 0,
      success: true,
      data: {
        page: { pageNum: 1, pageSize: 20, totalCount: 1, totalPage: 1 },
        totalData: { dataValueJson: '{"fee":"12.34"}' },
        dataList: [{
          noteId: 'fictional-juguang-note-001',
          noteJumpUrl: 'https://www.xiaohongshu.com/explore/fictional?xsec_token=fixture-url-token&xsec_source=pc_wind_export',
          noteImage: 'https://ci.xiaohongshu.com/fictional-image?sign=fixture-image-signature&t=999999',
          dataValueJson: '{"fee":"12.34"}',
        }],
        debugToken: 'fixture-api-token',
        signedUrl: 'https://ad.xiaohongshu.com/fixture?x-s=fixture-xs-token',
      },
    };
  }
  if (url.origin === MCC_ORIGIN && url.pathname === CURRENT_ACCOUNT_PATH) {
    return {
      code: 0,
      data: {
        data: {
          advertiserId: 123456,
          accountType: 602,
          brand: {
            brandUserId: 'fictional-brand-001',
            brandUserName: '虚构品牌',
            privateContact: 'fixture-private-contact',
          },
          subAccount: {
            agentSubAccountId: 'fictional-vseller-001',
            agentSubAccountName: '虚构聚光子账户',
            privateMobile: 'fixture-private-mobile',
          },
          agent: {
            agentUserId: 'fictional-agent-001',
            agentUserName: '虚构代理商',
            sessionToken: 'fixture-api-token',
          },
          orgList: [{ id: 'fictional-org-001', secret: 'fixture-org-secret' }],
          cookie: 'fixture-private-cookie',
          signedUrl: 'https://mcc.xiaohongshu.com/fixture?x-s=fixture-xs-token',
        },
      },
    };
  }
  if (url.origin === MCC_ORIGIN && url.pathname === ACCOUNT_LIST_PATH) {
    return {
      code: 0,
      data: {
        data: {
          pageIndex: 1,
          pageSize: 50,
          total: 1,
          dataList: [{
            virtualSellerId: 'fictional-vseller-001',
            advertiserId: 123456,
            accountType: 602,
            accountName: '虚构聚光子账户',
            owner: { name: '虚构聚光子账户', mobile: 'fixture-private-mobile' },
            brand: {
              brandUserId: 'fictional-brand-001',
              brandUserName: '虚构品牌',
              privateContact: 'fixture-private-contact',
            },
            agent: { agentUserName: '虚构代理商', token: 'fixture-api-token' },
            signedUrl: 'https://mcc.xiaohongshu.com/fixture?x-s=fixture-xs-token',
          }],
        },
      },
    };
  }
  throw new Error(`Unexpected fixture request: ${url}`);
}

function evaluateJuguangHook() {
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
      this.responseText = JSON.stringify(responseBodyFor(new URL(this.url, JUGUANG_ORIGIN)));
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
      cookie: 'session=fixture-private-cookie; token=fixture-document-token',
    },
    location: {
      href: `${JUGUANG_ORIGIN}/aurora/ad/datareports-basic/note?vSellerId=fictional-vseller-001`,
      origin: JUGUANG_ORIGIN,
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
    async request(endpoint, payload, sequence = 1, eventOverrides = {}) {
      const message = {
        channel: CHANNEL,
        type: REQUEST_TYPE,
        platform: 'juguang',
        endpoint,
        nonce: `fixture-juguang-nonce-${sequence}`,
        requestId: `fixture-juguang-request-${sequence}`,
        payload: Object.assign({}, payload, {
          url: 'https://attacker.example/exfiltrate?token=fixture-payload-token',
          path: '/admin/deleteEverything',
          method: 'DELETE',
          headers: {
            authorization: 'Bearer fixture-payload-token',
            'v-seller-id': 'attacker-vseller-id',
            'x-s': 'fixture-payload-xs-signature',
          },
          cookie: 'fixture-private-cookie',
          token: 'fixture-payload-token',
        }),
      };
      const event = Object.assign({
        source: windowObject,
        origin: JUGUANG_ORIGIN,
        data: message,
      }, eventOverrides);
      for (const listener of listeners) listener(event);
      await new Promise((resolve) => setImmediate(resolve));
      return message;
    },
  };
}

function assertCorrelatedResponse(entry, request) {
  assert.equal(entry.targetOrigin, JUGUANG_ORIGIN);
  assert.equal(entry.message.channel, CHANNEL);
  assert.equal(entry.message.type, RESPONSE_TYPE);
  assert.equal(entry.message.platform, 'juguang');
  assert.equal(entry.message.requestId, request.requestId);
  assert.equal(entry.message.nonce, request.nonce);
  assert.equal(entry.message.ok, true);
}

function assertNoSecrets(value) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    'fixture-private-cookie',
    'fixture-document-token',
    'fixture-payload-token',
    'fixture-payload-xs-signature',
    'fixture-api-token',
    'fixture-xs-token',
    'fixture-url-token',
    'fixture-image-signature',
    'fixture-private-contact',
    'fixture-private-mobile',
    'fixture-org-secret',
    'xsec_token',
    'attacker.example',
    '/admin/deleteEverything',
  ]) {
    assert.equal(serialized.includes(secret), false, `聚光响应泄露：${secret}`);
  }
  assert.equal(/https?:[^"\s]+[?&](?:x-s|sign|token)=/i.test(serialized), false);
}

test('the standalone juguang collector exists', () => {
  assert.equal(
    fs.existsSync(collectorPath),
    true,
    `缺少独立聚光采集器：${collectorResource}`,
  );
});

test('background service worker imports the standalone juguang collector', () => {
  assert.ok(
    importedWorkerScripts(backgroundSource).includes(collectorResource),
    `background importScripts 未加载：${collectorResource}`,
  );
});

test('cloud extension ZIP explicitly packages the standalone juguang collector', () => {
  assert.ok(
    quotedLiteralPattern(collectorResource).test(syncSource),
    `sync-web-tool.mjs 的 ZIP 资源清单缺少：${collectorResource}`,
  );
});

test('juguang page hook has the real fixed report and MCC account endpoints', () => {
  for (const endpoint of ['reports.query', 'accounts.current', 'accounts.list', 'identity.get']) {
    assert.ok(quotedLiteralPattern(endpoint).test(pageHookSource), `聚光 page hook 缺少：${endpoint}`);
  }
  for (const value of [REPORT_PATH, CURRENT_ACCOUNT_PATH, ACCOUNT_LIST_PATH]) {
    assert.ok(pageHookSource.includes(value), `聚光 page hook 缺少真实 path：${value}`);
  }
  for (const field of [...REPORT_FIELDS, ...LIST_FIELDS]) {
    assert.ok(quotedLiteralPattern(field).test(pageHookSource), `聚光字段白名单缺少：${field}`);
  }
});

test('account switching is real tab navigation and is not exposed as an invented page endpoint', () => {
  assert.equal(pageClient.ENDPOINTS.juguang.includes('accounts.switch'), false);
  assert.equal(quotedLiteralPattern('accounts.switch').test(platformContentSource), false);
  assert.equal(quotedLiteralPattern('accounts.switch').test(pageHookSource), false);
});

test('reports.query keeps its fixed request and strips signed URLs and secrets', async () => {
  const evaluated = evaluateJuguangHook();
  assert.equal(evaluated.listeners.length, 1);
  const reportPayload = {
    pageNum: 1,
    pageSize: 20,
    sorts: [],
    filters: [],
    dataCaliber: 0,
    timeUnit: 'SUMMARY',
    splitColumns: [],
    startDate: '2030-01-01',
    endDate: '2030-01-07',
    webModule: 'base_report_page',
    dataSource: 'note',
    dataPattern: 'table',
    columns: ['time', 'noteId', 'fee'],
  };
  const request = await evaluated.request('reports.query', reportPayload);
  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.posted.length, 1);
  const xhr = evaluated.requests[0];
  const url = new URL(xhr.url, JUGUANG_ORIGIN);
  const body = JSON.parse(xhr.body);
  assert.equal(xhr.method, 'POST');
  assert.equal(url.origin, JUGUANG_ORIGIN);
  assert.equal(url.pathname, REPORT_PATH);
  assert.deepEqual(Object.keys(body).sort(), REPORT_FIELDS.sort());
  assert.equal(xhr.headers.authorization, undefined);
  assert.equal(xhr.headers.cookie, undefined);
  assert.equal(xhr.headers['v-seller-id'], undefined);
  assert.equal(xhr.headers['x-s'], undefined);
  assertCorrelatedResponse(evaluated.posted[0], request);
  assertNoSecrets(evaluated.posted[0].message);

  const requestCount = evaluated.requests.length;
  await evaluated.request('reports.query', reportPayload, 2, { origin: 'https://attacker.example' });
  await evaluated.request('reports.query', reportPayload, 3, { source: {} });
  assert.equal(evaluated.requests.length, requestCount);
});

test('accounts.current and identity.get use fixed MCC request and return minimal identity', async () => {
  const evaluated = evaluateJuguangHook();
  for (const [index, endpoint] of ['accounts.current', 'identity.get'].entries()) {
    const request = await evaluated.request(endpoint, {}, index + 1);
    assert.equal(evaluated.requests.length, index + 1, endpoint);
    assert.equal(evaluated.posted.length, index + 1, endpoint);
    const xhr = evaluated.requests[index];
    const url = new URL(xhr.url, JUGUANG_ORIGIN);
    const response = evaluated.posted[index];
    assert.equal(xhr.method, 'POST');
    assert.equal(url.origin, MCC_ORIGIN);
    assert.equal(url.pathname, CURRENT_ACCOUNT_PATH);
    assert.equal(url.searchParams.get('platform'), '1');
    assert.deepEqual(JSON.parse(xhr.body), {});
    assertCorrelatedResponse(response, request);
    assert.deepEqual(Object.keys(response.message.data).sort(), MINIMAL_IDENTITY_FIELDS.sort());
    assert.deepEqual({ ...response.message.data }, {
      accountType: 602,
      advertiserId: 123456,
      brandUserId: 'fictional-brand-001',
      brandUserName: '虚构品牌',
      name: '虚构聚光子账户',
      vSellerId: 'fictional-vseller-001',
    });
    assertNoSecrets(response.message);
  }
});

test('accounts.list uses fixed MCC pagination fields and returns minimized account rows', async () => {
  const evaluated = evaluateJuguangHook();
  const request = await evaluated.request('accounts.list', {
    pageIndex: 1,
    pageSize: 50,
    shadowAccount: true,
  });
  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.posted.length, 1);
  const xhr = evaluated.requests[0];
  const url = new URL(xhr.url, JUGUANG_ORIGIN);
  const response = evaluated.posted[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(url.origin, MCC_ORIGIN);
  assert.equal(url.pathname, ACCOUNT_LIST_PATH);
  assert.equal(url.searchParams.get('platform'), '1');
  assert.deepEqual(Object.keys(JSON.parse(xhr.body)).sort(), LIST_FIELDS.sort());
  assertCorrelatedResponse(response, request);
  assert.deepEqual(Object.keys(response.message.data).sort(), [
    'accounts', 'pageIndex', 'pageSize', 'total',
  ]);
  assert.equal(response.message.data.accounts.length, 1);
  assert.deepEqual(
    Object.keys(response.message.data.accounts[0]).sort(),
    MINIMAL_IDENTITY_FIELDS.sort(),
  );
  assertNoSecrets(response.message);
});
