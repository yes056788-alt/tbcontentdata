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
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const platformBridgeSource = fs.readFileSync(
  path.join(root, 'xhs-platform-content.js'),
  'utf8',
);

const CHANNEL = 'xhs-page-bridge-v3';
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
  {
    endpoint: 'projects.list',
    method: 'POST',
    pathname: '/api/solar/content/project/third_list',
    payload: { pageNum: 1, pageSize: 30 },
  },
];
const PGY_SEARCH_KEYWORD_ENDPOINT = {
  endpoint: 'notes.searchKeywords',
  method: 'GET',
  pathname: '/api/solar/trade/note/search_keyword_data',
  payload: {
    noteId: 'fictional-pgy-note-001',
    orderCategory: 'fictional-order-category-deal',
  },
};
const PGY_LINK_EXPORT_ENDPOINTS = Object.freeze({
  submit: '/api/solar/common/long_task/task/submit',
  status: '/api/solar/common/long_task/task/status',
  result: '/api/solar/common/long_task/task/result',
});

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function importedWorkerScripts(source) {
  const match = source.match(/importScripts\s*\(([\s\S]*?)\)\s*;/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+\.js)['"]/g), (entry) => entry[1]);
}

function evaluatePgyHook(options = {}) {
  const listeners = [];
  const posted = [];
  const requests = [];
  const downloads = [];

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
      const pathname = new URL(this.url, PGY_ORIGIN).pathname;
      if (pathname === PGY_SEARCH_KEYWORD_ENDPOINT.pathname && options.searchResponseStatus) {
        this.status = Number(options.searchResponseStatus);
        this.responseText = JSON.stringify(options.searchResponseBody || {
          code: this.status,
          success: false,
          msg: '请求过于频繁，请稍后重试',
        });
      } else if (pathname === '/api/solar/content/note/list/sum' && options.summaryResponseBody) {
        this.status = options.summaryResponseStatus || 200;
        this.responseText = JSON.stringify(options.summaryResponseBody);
      } else if (pathname === PGY_LINK_EXPORT_ENDPOINTS.submit) {
        this.responseText = JSON.stringify({
          code: 0,
          data: { data: { task_id: 'fictional-export-task-001' } },
        });
      } else if (pathname === PGY_LINK_EXPORT_ENDPOINTS.status) {
        this.responseText = JSON.stringify({ code: 0, data: { data: { status: 3 } } });
      } else if (pathname === PGY_LINK_EXPORT_ENDPOINTS.result) {
        this.responseText = JSON.stringify({
          code: 0,
          data: { data: { result: { extra: {
              url: options.resultFileUrl ||
                `${PGY_ORIGIN}/api/solar/common/long_task/fictional.xlsx?signature=private-result-signature`,
            } } } },
        });
      } else this.responseText = JSON.stringify({
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
  windowObject.$http = {
    async post(pathname, body, config) {
      requests.push({
        method: 'POST',
        url: pathname,
        body: JSON.stringify(body),
        config,
        headers: { 'content-type': 'application/json;charset=UTF-8' },
      });
      return { data: { taskId: 'fictional-export-task-001' } };
    },
    async get(pathname, config) {
      const url = new URL(pathname, PGY_ORIGIN);
      url.searchParams.set('task_id', String(config && config.params && config.params.taskId || ''));
      requests.push({
        method: 'GET',
        url: `${url.pathname}${url.search}`,
        body: null,
        config,
        headers: {},
      });
      if (pathname === PGY_LINK_EXPORT_ENDPOINTS.status) return { data: { status: 3 } };
      if (pathname === PGY_LINK_EXPORT_ENDPOINTS.result) {
        return { data: { result: { extra: {
          url: options.resultFileUrl ||
            `${PGY_ORIGIN}/api/solar/common/long_task/fictional.xlsx?signature=private-result-signature`,
        } } } };
      }
      throw new Error(`Unexpected official PGY GET: ${pathname}`);
    },
  };
  windowObject.self = windowObject;
  windowObject.top = windowObject;
  windowObject.XLSX = {};
  windowObject.XhsPgyExportLinks = {
    parseWorkbook(_buffer, _xlsx, noteIds) {
      return {
        links: noteIds.map((noteId) => [noteId,
          `https://www.xiaohongshu.com/explore/${noteId}` +
          `?xsec_token=official-result-${noteId}&xsec_source=pc_pgyexport`]),
        parsedRowCount: noteIds.length,
        rejectedRowCount: 0,
        matchedNoteCount: noteIds.length,
      };
    },
  };

  const context = vm.createContext({
    TextEncoder,
    URL,
    XMLHttpRequest: FakeXMLHttpRequest,
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    document: {
      cookie: 'session=fixture-private-cookie; xsec_token=fixture-private-token',
    },
    fetch: async (url, options) => {
      downloads.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async arrayBuffer() {
          return Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer;
        },
      };
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
    downloads,
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

test('pgy content bridge forwards the cross-domain project and note search-keyword endpoints', () => {
  const pgyAllowlist = platformBridgeSource.match(
    /pgy:\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  assert.ok(pgyAllowlist, '蒲公英内容桥接白名单不存在');
  assert.match(
    pgyAllowlist[1],
    quotedLiteralPattern('projects.list'),
    '跨域项目分页请求必须通过隔离世界内容桥接转发到页面钩子',
  );
  assert.match(
    pgyAllowlist[1],
    quotedLiteralPattern(PGY_SEARCH_KEYWORD_ENDPOINT.endpoint),
    '单篇笔记 TOP 搜索来源词请求必须通过隔离世界内容桥接转发到页面钩子',
  );
  for (const endpoint of [
    'notes.linkExport.submit', 'notes.linkExport.status', 'notes.linkExport.result',
  ]) {
    assert.match(pgyAllowlist[1], quotedLiteralPattern(endpoint), `${endpoint} 必须进入页面桥白名单`);
  }
  assert.match(
    platformBridgeSource,
    /const LINK_EXPORT_RESULT_TIMEOUT_MS\s*=\s*3\s*\*\s*60\s*\*\s*1000/,
    '官方结果文件下载与解析必须使用独立的三分钟页面桥预算',
  );
  assert.match(
    platformBridgeSource,
    /endpoint === 'notes\.linkExport\.result'[\s\S]{0,160}?LINK_EXPORT_RESULT_TIMEOUT_MS/,
    '三分钟预算只能应用于官方结果文件端点',
  );
});

test('pgy manifest loads the workbook parser before the MAIN-world export hook', () => {
  const scripts = manifest.content_scripts.find((entry) => (
    entry.world === 'MAIN' && entry.matches.includes('https://pgy.xiaohongshu.com/*')
  )).js;
  assert.deepEqual(scripts, [
    'vendor/xlsx.full.min.js',
    'xhs/contract.js',
    'xhs/pgy-export-links.js',
    'pgy-page-hook.js',
  ]);
});

test('pgy official link export submits the fixed platform task and polls by taskId only', async () => {
  const evaluated = evaluatePgyHook();
  await evaluated.request({
    endpoint: 'notes.linkExport.submit',
    payload: {
      brandUserId: 'fictional-brand-account-001',
      startTime: '2030-01-01',
      endTime: '2030-01-07',
    },
  }, 101);
  await evaluated.request({
    endpoint: 'notes.linkExport.status',
    payload: { taskId: 'fictional-export-task-001' },
  }, 102);

  assert.equal(evaluated.requests.length, 2);
  const submit = evaluated.requests[0];
  const submitBody = JSON.parse(submit.body);
  assert.equal(new URL(submit.url, PGY_ORIGIN).pathname, PGY_LINK_EXPORT_ENDPOINTS.submit);
  assert.equal(submit.method, 'POST');
  assert.equal(submit.config.transform, true);
  assert.equal(submitBody.moduleName, 'solar');
  assert.equal(submitBody.taskName, 'content_note_download_task');
  assert.deepEqual(submitBody.input.extra.brandUserIds, ['fictional-brand-account-001']);
  assert.deepEqual(submitBody.input.extra.operatorUserIds, []);
  assert.equal(submitBody.input.extra.dateType, '2');
  assert.equal(submitBody.input.extra.startTime, '2030-01-01');
  assert.equal(submitBody.input.extra.endTime, '2030-01-07');
  assert.equal(submitBody.input.extra.url, undefined);
  assert.equal(submitBody.input.extra.token, undefined);

  const status = evaluated.requests[1];
  const statusUrl = new URL(status.url, PGY_ORIGIN);
  assert.equal(status.method, 'GET');
  assert.equal(status.config.transform, true);
  assert.equal(statusUrl.pathname, PGY_LINK_EXPORT_ENDPOINTS.status);
  assert.deepEqual([...statusUrl.searchParams.entries()], [[
    'task_id', 'fictional-export-task-001',
  ]]);
  assert.equal(status.body, null);
  assert.equal(evaluated.posted[0].message.data.taskId, 'fictional-export-task-001');
  assert.equal(evaluated.posted[1].message.data.status, 3);

  for (const pathname of Object.values(PGY_LINK_EXPORT_ENDPOINTS)) {
    assert.match(pageHookSource, quotedLiteralPattern(pathname));
  }
});

test('pgy official link result downloads and parses in page memory without returning the signed file URL', async () => {
  const evaluated = evaluatePgyHook();
  await evaluated.request({
    endpoint: 'notes.linkExport.result',
    payload: {
      taskId: 'fictional-export-task-001',
      noteIds: ['fictional-pgy-note-001'],
    },
  }, 103);

  assert.equal(evaluated.requests.length, 1);
  const resultRequest = evaluated.requests[0];
  const resultUrl = new URL(resultRequest.url, PGY_ORIGIN);
  assert.equal(resultRequest.method, 'GET');
  assert.equal(resultRequest.config.transform, true);
  assert.equal(resultUrl.pathname, PGY_LINK_EXPORT_ENDPOINTS.result);
  assert.deepEqual([...resultUrl.searchParams.entries()], [[
    'task_id', 'fictional-export-task-001',
  ]]);
  assert.equal(evaluated.downloads.length, 1);
  assert.match(evaluated.downloads[0].url, /private-result-signature/);
  assert.equal(evaluated.downloads[0].options.credentials, 'include');

  const response = evaluated.posted[0].message;
  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data.links)), [[
    'fictional-pgy-note-001',
    'https://www.xiaohongshu.com/explore/fictional-pgy-note-001' +
      '?xsec_token=official-result-fictional-pgy-note-001&xsec_source=pc_pgyexport',
  ]]);
  assert.doesNotMatch(JSON.stringify(response), /fictional\.xlsx|private-result-signature/);

  const crossOrigin = evaluatePgyHook({
    resultFileUrl: 'https://download.example/fictional.xlsx?signature=private-result-signature',
  });
  await crossOrigin.request({
    endpoint: 'notes.linkExport.result',
    payload: { taskId: 'fictional-export-task-001', noteIds: ['fictional-pgy-note-001'] },
  }, 104);
  assert.equal(crossOrigin.downloads[0].options.credentials, 'omit',
    '跨域签名文件不得携带蒲公英会话凭据');
});

test('pgy note search-keyword endpoint uses a fixed GET path and only note-scoped query fields', async () => {
  const evaluated = evaluatePgyHook();
  const requestMessage = await evaluated.request(PGY_SEARCH_KEYWORD_ENDPOINT, 91);

  assert.equal(evaluated.requests.length, 1);
  assert.equal(evaluated.posted.length, 1);
  const xhr = evaluated.requests[0];
  const requestUrl = new URL(xhr.url, PGY_ORIGIN);
  assert.equal(xhr.method, 'GET');
  assert.equal(requestUrl.origin, PGY_ORIGIN);
  assert.equal(requestUrl.pathname, PGY_SEARCH_KEYWORD_ENDPOINT.pathname);
  assert.deepEqual([...requestUrl.searchParams.entries()].sort(), [
    ['noteId', PGY_SEARCH_KEYWORD_ENDPOINT.payload.noteId],
    ['orderCategory', PGY_SEARCH_KEYWORD_ENDPOINT.payload.orderCategory],
  ]);
  assert.ok(xhr.body == null, 'GET search-keyword request must not send an untrusted request body');
  assert.equal(xhr.headers.authorization, undefined);
  assert.equal(xhr.headers.cookie, undefined);
  assert.equal(xhr.url.includes('attacker.example'), false);
  assert.equal(xhr.url.includes('deleteEverything'), false);

  const response = evaluated.posted[0];
  assert.equal(response.targetOrigin, PGY_ORIGIN);
  assert.equal(response.message.requestId, requestMessage.requestId);
  assert.equal(response.message.nonce, requestMessage.nonce);
  assert.equal(response.message.ok, true);
  assert.doesNotMatch(
    JSON.stringify(response),
    /fixture-private-cookie|fixture-private-token|fixture-override-token|xsec_token/,
  );
});

test('pgy transient summary business failure is eligible for bounded collector retry', async () => {
  const evaluated = evaluatePgyHook({
    summaryResponseBody: { success: false, code: -1, msg: '汇总笔记列表的数据失败' },
  });
  await evaluated.request(PGY_ENDPOINTS.find(item => item.endpoint === 'notes.sum'), 95);
  assert.equal(evaluated.posted[0].message.ok, false);
  assert.equal(evaluated.posted[0].message.retryable, true);
});

test('pgy summary authentication and permission errors are not retried', async () => {
  for (const status of [401, 403]) {
    const evaluated = evaluatePgyHook({
      summaryResponseStatus: status,
      summaryResponseBody: { success: false, code: status, msg: '汇总笔记列表的数据失败' },
    });
    await evaluated.request(PGY_ENDPOINTS.find(item => item.endpoint === 'notes.sum'), 96);
    assert.equal(evaluated.posted[0].message.ok, false);
    assert.equal(evaluated.posted[0].message.retryable, false);
  }
});

test('pgy search-keyword throttling remains retryable for the bounded collector backoff', async () => {
  const evaluated = evaluatePgyHook({ searchResponseStatus: 429 });
  await evaluated.request(PGY_SEARCH_KEYWORD_ENDPOINT, 92);

  assert.equal(evaluated.posted.length, 1);
  assert.equal(evaluated.posted[0].message.ok, false);
  assert.equal(evaluated.posted[0].message.code, 'PGY_API_ERROR');
  assert.equal(evaluated.posted[0].message.retryable, true);
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
