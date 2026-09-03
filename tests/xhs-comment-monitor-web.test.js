const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('comment monitor page exposes the five accessible work areas and export controls', () => {
  const html = read('web-tool/comments.html');

  assert.match(html, /class="skip-link" href="#mainContent"/);
  assert.match(html, /id="commentMonitorNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /role="tablist"[^>]*aria-label="评论监测视图"/);

  const tabs = [
    ['overview', '今日概览'],
    ['heat', '笔记热度'],
    ['insights', '主题洞察'],
    ['evidence', '评论证据'],
    ['runs', '运行记录与设置'],
  ];
  tabs.forEach(([view, label], index) => {
    assert.match(html, new RegExp(
      'role="tab"[^>]*data-comment-view="' + view + '"[^>]*aria-controls="comment-' + view +
      '-panel"[^>]*aria-selected="' + (index === 0 ? 'true' : 'false') + '"[^>]*>' + label
    ));
    assert.match(html, new RegExp(
      'id="comment-' + view + '-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="comment-' +
      view + '-tab"'
    ));
  });

  for (const id of [
    'commentDateFrom', 'commentDateTo', 'commentSearch', 'applyCommentFiltersBtn',
    'commentStoreSelect', 'commentStoreHelp',
    'runCommentMonitorBtn', 'exportCommentHtmlBtn', 'exportCommentCsvBtn', 'exportCommentJsonBtn',
    'commentScheduleTime', 'saveCommentSettingsBtn', 'commentEmptyState', 'commentErrorState',
    'commentHeatRows', 'commentInsightRows', 'commentEvidenceRows', 'commentRunRows',
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }

  assert.match(html, /id="commentScheduleTime"[^>]*type="time"[^>]*value="09:00"/);
  assert.match(html, /id="commentStoreSelect"[^>]*aria-describedby="commentStoreHelp"[^>]*required/);
  assert.match(html, /复用当前 Chrome 已登录的蒲公英账号/);
  assert.equal((html.match(/<table/g) || []).length >= 4, true, '列表需使用语义化表格');
  assert.match(html, /href="\/comments\.css"/);
  assert.match(html, /src="\/comments\.js"/);
});

test('comment monitor styles follow the existing flat workspace and cover responsive breakpoints', () => {
  const css = read('web-tool/comments.css');

  assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);
  assert.doesNotMatch(css, /#(?:7c3aed|8b5cf6|a855f7|9333ea)/i);
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /@media\s*\(max-width:\s*1024px\)/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /\.comment-tabs[^}]*overflow-x:\s*auto/s);
  assert.match(css, /:focus-visible/);
});

test('comment monitor request API posts the documented message envelope and accepts matching responses', async () => {
  const source = read('web-tool/comments.js');
  const posted = [];
  const listeners = {};
  const windowObject = {
    addEventListener(type, listener) { listeners[type] = listener; },
    postMessage(message, targetOrigin) { posted.push({ message, targetOrigin }); },
  };
  windowObject.window = windowObject;
  windowObject.self = windowObject;

  const document = {
    readyState: 'loading',
    addEventListener() {},
  };
  let timerId = 0;
  vm.runInNewContext(source, {
    Blob,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    String,
    URL,
    clearTimeout() {},
    console,
    document,
    location: { origin: 'http://127.0.0.1:3400', search: '' },
    navigator: {},
    setTimeout() { timerId += 1; return timerId; },
    window: windowObject,
  }, { filename: 'web-tool/comments.js' });

  const api = windowObject.CommentMonitorWeb;
  assert.ok(api, 'testable comment monitor API');
  for (const action of ['getState', 'configure', 'runNow', 'queryComments', 'exportRaw']) {
    const responsePromise = api.request(action, { fixture: action });
    const last = posted.at(-1);
    assert.equal(last.targetOrigin, 'http://127.0.0.1:3400');
    assert.equal(last.message.source, 'taobao-full-chain-web-tool');
    assert.equal(last.message.type, 'COMMENT_MONITOR_REQUEST');
    assert.equal(last.message.action, action);
    assert.equal(last.message.payload.fixture, action);
    assert.match(last.message.requestId, /^comment-monitor-/);
    listeners.message({
      source: windowObject,
      origin: 'http://127.0.0.1:3400',
      data: {
        source: 'taobao-full-chain-web-tool',
        type: 'COMMENT_MONITOR_RESPONSE',
        requestId: last.message.requestId,
        ok: true,
        payload: { acknowledged: action },
      },
    });
    assert.equal((await responsePromise).acknowledged, action);
  }
  assert.throws(() => api.request('unknownAction', {}), /不支持的评论监测操作/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.match(source, new RegExp("event\\.key === '" + key + "'"));
  }
});

test('comment monitor state and HTML export are safe and preserve the independent report boundary', () => {
  const source = read('web-tool/comments.js');
  const windowObject = { addEventListener() {}, postMessage() {} };
  windowObject.window = windowObject;
  windowObject.self = windowObject;
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(source, {
    Blob,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    String,
    URL,
    clearTimeout() {},
    console,
    document,
    location: { origin: 'http://127.0.0.1:3400', search: '' },
    navigator: {},
    setTimeout() { return 1; },
    window: windowObject,
  }, { filename: 'web-tool/comments.js' });

  const api = windowObject.CommentMonitorWeb;
  const normalized = api.normalizeState({
    profile: { scheduleTime: '25:90', storeId: 'store-a', storeName: '店铺 A' },
    stores: [{ id: 'store-a', name: '店铺 A' }, { id: '', name: '无效店铺' }],
    overview: { newNotes: -2, newComments: 12 },
    notes: 'invalid',
  });
  assert.equal(normalized.profile.scheduleTime, '09:00');
  assert.equal(normalized.profile.storeId, 'store-a');
  assert.deepEqual(Array.from(normalized.stores, (store) => store.name), ['店铺 A']);
  assert.equal(normalized.overview.newNotes, 0);
  assert.equal(normalized.overview.newComments, 12);
  assert.equal(normalized.notes.length, 0);

  const exported = api.buildHtmlExport({
    generatedAt: '2030-01-02T03:04:05.000Z',
    overview: { newNotes: 1, newComments: 8, hotNotes: 2 },
    notes: [{ title: '<script>alert(1)</script>', heatLevel: '高', commentDelta: 8 }],
    insights: [{ theme: '购买顾虑', count: 3, summary: '对价格敏感' }],
  }, { from: '2030-01-01', to: '2030-01-02', search: '' });

  assert.match(exported, /<!doctype html>/i);
  assert.match(exported, /评论监测洞察报告/);
  assert.match(exported, /仅表示关联笔记评论，不将评论归因到搜索词/);
  assert.doesNotMatch(exported, /<script>alert\(1\)<\/script>/);
  assert.match(exported, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
