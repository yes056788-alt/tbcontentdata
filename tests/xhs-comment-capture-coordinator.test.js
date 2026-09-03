const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', 'xhs', 'comment-capture-coordinator.js');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createChromeFixture(options = {}) {
  const runtimeListeners = [];
  const updatedListeners = [];
  const removedListeners = [];
  const created = [];
  const updated = [];
  const queried = [];
  const commands = [];
  let nextTabId = 70;
  const availableTabs = Array.isArray(options.tabs) ? options.tabs.slice() : [];

  const chrome = {
    runtime: {
      id: 'fixture-extension',
      onMessage: {
        addListener(listener) { runtimeListeners.push(listener); },
      },
    },
    tabs: {
      onRemoved: {
        addListener(listener) { removedListeners.push(listener); },
      },
      onUpdated: {
        addListener(listener) { updatedListeners.push(listener); },
      },
      async query(queryInfo) {
        queried.push(queryInfo);
        return availableTabs.slice();
      },
      async create(createProperties) {
        created.push(createProperties);
        const tab = { id: nextTabId++, url: createProperties.url };
        availableTabs.push(tab);
        return tab;
      },
      async update(tabId, updateProperties) {
        updated.push({ tabId, updateProperties });
        const tab = availableTabs.find((item) => item.id === tabId);
        if (tab && updateProperties.url) tab.url = updateProperties.url;
        return Object.assign({ id: tabId }, tab, updateProperties);
      },
      async sendMessage(tabId, message) {
        commands.push({ tabId, message });
        return { ok: true, advanced: message.command === 'advance' };
      },
    },
  };

  return {
    chrome,
    commands,
    created,
    queried,
    removedListeners,
    runtimeListeners,
    updated,
    updatedListeners,
    async dispatchCapture(tabId, message) {
      const responses = [];
      const returns = runtimeListeners.map((listener) => listener(
        Object.assign({
          source: 'xhs-comment-content-v1',
          type: 'XHS_COMMENT_API_CAPTURE',
          endpointKind: 'root',
          url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-a&cursor=',
          capturedAt: 1893456000000,
          body: { code: 0, data: { comments: [], cursor: '', has_more: false } },
        }, message),
        { id: chrome.runtime.id, tab: { id: tabId } },
        (response) => responses.push(response),
      ));
      await flush();
      return { responses, returns };
    },
    emitUpdated(tabId, changeInfo, tab) {
      for (const listener of updatedListeners) listener(tabId, changeInfo, tab || { id: tabId });
    },
    emitRemoved(tabId) {
      for (const listener of removedListeners) listener(tabId, {});
    },
  };
}

function loadApi() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function task(overrides = {}) {
  return Object.assign({
    accountKey: 'account-a',
    noteId: 'note-a',
    officialUrl: 'https://www.xiaohongshu.com/explore/note-a?xsec_token=signed-token',
    limit: 500,
    knownCommentIds: [],
    checkpoint: {},
  }, overrides);
}

function rootCapture(overrides = {}) {
  return Object.assign({
    endpointKind: 'root',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-a&cursor=',
    body: {
      code: 0,
      data: {
        comments: [{ id: 'root-1', content: '想买', sub_comment_count: 0 }],
        cursor: '',
        has_more: false,
      },
    },
  }, overrides);
}

test('opens an official note in a background worker tab and passively parses a root response', async () => {
  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({
    chrome: fixture.chrome,
    timeoutMs: 1000,
    settleMs: 1,
  });

  const pending = coordinator.collect(task());
  await flush();

  assert.deepEqual(fixture.created, [{ url: 'about:blank', active: false }]);
  assert.deepEqual(fixture.updated, [{
    tabId: 70,
    updateProperties: { url: task().officialUrl, active: false },
  }]);
  await fixture.dispatchCapture(70, rootCapture());

  const result = await pending;
  assert.equal(result.complete, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].id, 'root-1');
  assert.equal(result.comments[0].note_id, 'note-a');
  assert.equal(result.checkpoint.rootHasMore, false);
  assert.ok(fixture.commands.some((entry) => entry.message.command === 'stop'));
});

test('reuses an idle Xiaohongshu tab, reloads the signed URL, and associates captures by tab id', async () => {
  const fixture = createChromeFixture({
    tabs: [{ id: 22, active: false, url: 'https://www.xiaohongshu.com/explore/note-a' }],
  });
  const coordinator = loadApi().createCommentCaptureCoordinator({
    chrome: fixture.chrome,
    timeoutMs: 1000,
    settleMs: 1,
  });
  coordinator.register();
  coordinator.register();

  const pending = coordinator.collect(task());
  await flush();
  assert.equal(fixture.created.length, 0);
  assert.equal(fixture.updated[0].tabId, 22);
  assert.equal(fixture.runtimeListeners.length, 1);

  const ignored = await fixture.dispatchCapture(999, rootCapture());
  assert.deepEqual(ignored.responses, [{ ok: false, handled: false }]);
  await fixture.dispatchCapture(22, rootCapture());
  assert.equal((await pending).comments[0].id, 'root-1');
});

test('caps each call at 500 new unique IDs and returns a continuation checkpoint', async () => {
  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({
    chrome: fixture.chrome,
    timeoutMs: 1000,
    settleMs: 1,
  });
  const pending = coordinator.collect(task());
  await flush();
  const comments = Array.from({ length: 510 }, (_, index) => ({
    id: `comment-${index}`,
    content: `comment ${index}`,
  }));
  comments.push({ id: 'comment-499', content: 'duplicate' });
  await fixture.dispatchCapture(70, rootCapture({
    body: { code: 0, data: { comments, cursor: 'root-next', has_more: true } },
  }));

  const result = await pending;
  assert.equal(result.comments.length, 500);
  assert.equal(new Set(result.comments.map((item) => item.id)).size, 500);
  assert.equal(result.complete, false);
  assert.equal(result.stopReason, 'limit_reached');
  assert.equal(result.checkpoint.rootCursor, '',
    'the next round repeats the current API page so its unprocessed tail cannot be skipped');
  assert.equal(result.checkpoint.rootHasMore, true);
});

test('stops at a known-comment boundary after retaining newer comments', async () => {
  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({
    chrome: fixture.chrome,
    timeoutMs: 1000,
    settleMs: 1,
  });
  const pending = coordinator.collect(task({ knownCommentIds: ['known-1'] }));
  await flush();
  await fixture.dispatchCapture(70, rootCapture({
    body: {
      code: 0,
      data: {
        comments: [
          { id: 'new-1', content: 'new' },
          { id: 'known-1', content: 'known' },
          { id: 'older-1', content: 'must not pass the boundary' },
        ],
        cursor: 'older-page',
        has_more: true,
      },
    },
  }));

  const result = await pending;
  assert.deepEqual(result.comments.map((item) => item.id), ['new-1']);
  assert.equal(result.complete, true);
  assert.equal(result.stopReason, 'known_comment');
});

test('honors independent root and sub cursors when resuming without forging API calls', async () => {
  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({
    chrome: fixture.chrome,
    timeoutMs: 1000,
    settleMs: 20,
  });
  const pending = coordinator.collect(task({
    knownCommentIds: ['known-root', 'known-sub'],
    checkpoint: {
      rootCursor: 'resume-root',
      rootHasMore: true,
      subCursors: { 'root-thread': { cursor: 'resume-sub', hasMore: true } },
    },
  }));
  await flush();

  await fixture.dispatchCapture(70, rootCapture({
    body: { code: 0, data: { comments: [{ id: 'known-root' }], cursor: 'resume-root', has_more: true } },
  }));
  await fixture.dispatchCapture(70, rootCapture({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-a&cursor=resume-root',
    body: { code: 0, data: { comments: [{ id: 'new-root' }], cursor: '', has_more: false } },
  }));
  await fixture.dispatchCapture(70, {
    endpointKind: 'sub',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=note-a&root_comment_id=root-thread&cursor=',
    body: { code: 0, data: { comments: [{ id: 'known-sub' }], cursor: 'resume-sub', has_more: true } },
  });
  await fixture.dispatchCapture(70, {
    endpointKind: 'sub',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=note-a&root_comment_id=root-thread&cursor=resume-sub',
    body: { code: 0, data: { comments: [{ id: 'new-sub' }], cursor: '', has_more: false } },
  });

  const result = await pending;
  assert.deepEqual(result.comments.map((item) => item.id), ['new-root', 'new-sub']);
  assert.equal(result.complete, true);
  assert.equal(result.checkpoint.rootHasMore, false);
  assert.deepEqual(result.checkpoint.subCursors['root-thread'], { cursor: '', hasMore: false });
  assert.equal(fixture.commands.every((entry) => ['advance', 'stop'].includes(entry.message.command)), true);
});

for (const errorCase of [
  [{ code: 401, msg: '请先登录' }, 'LOGIN_REQUIRED'],
  [{ code: -110, msg: '请完成安全验证' }, 'VERIFICATION_REQUIRED'],
  [{ code: 429, msg: '请求过于频繁' }, 'RATE_LIMITED'],
]) {
  const [body, expectedCode] = errorCase;
  test(`preserves explicit ${expectedCode} API failure`, async () => {
    const fixture = createChromeFixture();
    const coordinator = loadApi().createCommentCaptureCoordinator({
      chrome: fixture.chrome,
      timeoutMs: 1000,
      settleMs: 1,
    });
    const pending = coordinator.collect(task());
    const rejected = assert.rejects(
      pending,
      (error) => error.code === expectedCode && error.retryable === true,
    );
    await flush();
    await fixture.dispatchCapture(70, rootCapture({ body }));
    await rejected;
  });
}

test('recognizes login and verification navigation signals and tab closure', async () => {
  for (const [url, expectedCode] of [
    ['https://www.xiaohongshu.com/login?redirect=/explore/note-a', 'LOGIN_REQUIRED'],
    ['https://www.xiaohongshu.com/verification?captcha=1', 'VERIFICATION_REQUIRED'],
  ]) {
    const fixture = createChromeFixture();
    const coordinator = loadApi().createCommentCaptureCoordinator({ chrome: fixture.chrome, timeoutMs: 1000 });
    const pending = coordinator.collect(task());
    await flush();
    fixture.emitUpdated(70, { url }, { id: 70, url });
    await assert.rejects(pending, (error) => error.code === expectedCode);
  }

  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({ chrome: fixture.chrome, timeoutMs: 1000 });
  const pending = coordinator.collect(task());
  await flush();
  fixture.emitRemoved(70);
  await assert.rejects(pending, (error) => error.code === 'COMMENT_CAPTURE_TAB_CLOSED');
});

test('times out safely without converting missing responses into zero comments', async () => {
  const fixture = createChromeFixture();
  const coordinator = loadApi().createCommentCaptureCoordinator({ chrome: fixture.chrome, timeoutMs: 25 });
  const pending = coordinator.collect(task());
  await assert.rejects(pending, (error) => (
    error.code === 'COMMENT_CAPTURE_TIMEOUT' && error.retryable === true && error.zeroResult === false
  ));
  assert.ok(fixture.commands.some((entry) => entry.message.command === 'stop'));
});

test('source contains no active request implementation', () => {
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|x-s-common|xsec_token\s*:/i);
  assert.match(source, /XHS_COMMENT_PAGE_COMMAND/);
});
