const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../xhs/comment-monitor');
const localCache = require('../xhs/local-cache');
const runtimeApi = require('../xhs/comment-monitor-runtime');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeChrome(initial = {}) {
  const values = clone(initial);
  const alarmListeners = [];
  const startupListeners = [];
  const messageListeners = [];
  const alarms = [];
  return {
    runtime: {
      id: 'fixture-extension',
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      onStartup: { addListener(listener) { startupListeners.push(listener); } },
    },
    alarms: {
      create(name, options) { alarms.push({ name, options: clone(options) }); },
      async clear() { return true; },
      onAlarm: { addListener(listener) { alarmListeners.push(listener); } },
    },
    storage: {
      local: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested
            .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
            .map((key) => [key, clone(values[key])]));
        },
        async set(patch) { Object.assign(values, clone(patch)); },
      },
    },
    fixture: { values, alarms, alarmListeners, startupListeners, messageListeners },
  };
}

function note(noteId, overrides = {}) {
  return Object.assign({
    noteId,
    noteTitle: `测试笔记 ${noteId}`,
    notePublishTime: '2030-01-01',
    impNum: 1000,
    readNum: 200,
    engageNum: 30,
    cmtNum: 5,
    likeNum: 20,
    favNum: 4,
    shareNum: 1,
  }, overrides);
}

test('configure schedules a 09:00 Asia/Shanghai daily alarm and persists safe defaults', async () => {
  const chrome = createFakeChrome();
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache: localCache.createMemoryCache(),
    now: () => Date.parse('2030-01-01T00:00:00.000Z'),
    collectInventory: async () => ({ accountKey: 'unused', rows: [] }),
    collectNoteComments: async () => ({ comments: [], complete: true }),
  });

  await runtime.configure({
    enabled: true, accountKey: 'brand-001', storeId: 'store-a', storeName: '店铺 A',
  });

  const profile = chrome.fixture.values[runtimeApi.STORAGE_KEYS.profile];
  assert.equal(profile.schema, 'CommentMonitorProfileV1');
  assert.equal(profile.dailyTime, '09:00');
  assert.equal(profile.timezone, 'Asia/Shanghai');
  assert.equal(profile.perNoteLimit, 500);
  assert.equal(profile.rawRetention, 'local_only');
  assert.equal(chrome.fixture.alarms.at(-1).name, runtimeApi.ALARM_NAME);
  assert.equal(chrome.fixture.alarms.at(-1).options.periodInMinutes, 1440);
  assert.equal(chrome.fixture.alarms.at(-1).options.when,
    Date.parse('2030-01-01T01:00:00.000Z'));
});

test('first run captures every initial candidate in 500-comment round-robin batches', async () => {
  const chrome = createFakeChrome();
  const cache = localCache.createMemoryCache();
  const calls = [];
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache,
    now: () => Date.parse('2030-01-08T01:00:00.000Z'),
    collectInventory: async () => ({
      accountKey: 'brand-001',
      capturedAt: '2030-01-08T01:00:00.000Z',
      platformUpdatedAt: '2030-01-08T00:55:00.000Z',
      rows: [
        note('note-a', { notePublishTime: '2030-01-07', cmtNum: 700 }),
        note('note-b', { notePublishTime: '2029-12-15', cmtNum: 4 }),
      ],
    }),
    resolveOfficialLinks: async (_inventory, candidates) => Object.fromEntries(
      candidates.map((item) => [item.noteId,
        `https://www.xiaohongshu.com/explore/${item.noteId}?xsec_token=fixture-${item.noteId}&xsec_source=pc_pgyexport`])
    ),
    collectNoteComments: async (task) => {
      calls.push(clone(task));
      return {
        complete: task.noteId !== 'note-a',
        checkpoint: { cursor: task.noteId === 'note-a' ? 'cursor-next' : '' },
        comments: Array.from({ length: task.noteId === 'note-a' ? 500 : 4 }, (_, index) => ({
          id: `${task.noteId}-comment-${index}`,
          content: index % 2 ? '价格多少，怎么买？' : '使用体验很好',
          create_time: 1894060000 + index,
        })),
      };
    },
  });
  await runtime.configure({
    enabled: true, accountKey: 'brand-001', storeId: 'store-a', storeName: '店铺 A',
  });

  const result = await runtime.runOnce({ trigger: 'manual' });

  assert.equal(result.status, 'partial');
  assert.equal(calls.length, 2, 'all eligible notes run without a daily note cap');
  assert.ok(calls.every((call) => call.limit === 500));
  assert.equal(result.capturedCommentCount, 504);
  assert.equal(result.pendingContinuationCount, 1);
  assert.equal(chrome.fixture.values[runtimeApi.STORAGE_KEYS.summary].schema,
    'CommentInsightSummaryV1');
  assert.equal(chrome.fixture.values[runtimeApi.STORAGE_KEYS.state].zeroResult, false);

  const cached = await cache.read('xhs-comment-monitor:store-a:brand-001:note-a');
  assert.equal(cached.receivedCount, 500);
  assert.equal(cached.pages[0].items[0].nickname, undefined,
    'normalized raw records do not invent identity fields');
});

test('login and verification failures remain explicit and never become zero-comment success', async () => {
  const chrome = createFakeChrome();
  const loginError = Object.assign(new Error('请登录蒲公英'), { code: 'LOGIN_REQUIRED' });
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache: localCache.createMemoryCache(),
    collectInventory: async () => { throw loginError; },
    collectNoteComments: async () => ({ comments: [], complete: true }),
  });
  await runtime.configure({ enabled: true, accountKey: 'brand-001' });

  const result = await runtime.runOnce({ trigger: 'alarm' });

  assert.equal(result.status, 'waiting_login');
  assert.equal(result.zeroResult, false);
  assert.equal(result.errorCode, 'LOGIN_REQUIRED');
  assert.equal(chrome.fixture.values[runtimeApi.STORAGE_KEYS.state].status, 'waiting_login');
});

test('a login failure while capturing a note pauses the run without advancing last success', async () => {
  const previousSuccess = '2029-12-31T01:00:00.000Z';
  const chrome = createFakeChrome({
    [runtimeApi.STORAGE_KEYS.state]: { lastSuccessfulAt: previousSuccess },
  });
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache: localCache.createMemoryCache(),
    now: () => Date.parse('2030-01-08T01:00:00.000Z'),
    collectInventory: async () => ({
      accountKey: 'brand-001',
      capturedAt: '2030-01-08T01:00:00.000Z',
      rows: [note('note-a', { notePublishTime: '2030-01-07' })],
    }),
    resolveOfficialLinks: async () => ({
      'note-a': 'https://www.xiaohongshu.com/explore/note-a?xsec_token=fixture',
    }),
    collectNoteComments: async () => {
      throw Object.assign(new Error('登录已过期'), { code: 'LOGIN_REQUIRED' });
    },
  });
  await runtime.configure({ enabled: true, accountKey: 'brand-001' });

  const result = await runtime.runOnce({ trigger: 'alarm' });

  assert.equal(result.status, 'waiting_login');
  assert.equal(result.zeroResult, false);
  assert.equal(result.lastSuccessfulAt, previousSuccess);
  assert.equal(chrome.fixture.values[runtimeApi.STORAGE_KEYS.runIndex][0].status, 'needs_login');
});

test('query and raw export read local comment pages without exposing them through summary storage', async () => {
  const chrome = createFakeChrome();
  const cache = localCache.createMemoryCache();
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache,
    collectInventory: async () => ({ accountKey: 'brand-001', rows: [] }),
    collectNoteComments: async () => ({ comments: [], complete: true }),
  });
  const cacheKey = 'xhs-comment-monitor:store-a:brand-001:note-a';
  await cache.open(cacheKey, 'comment-monitor-v2:store-a:brand-001:note-a');
  await cache.commitPage(cacheKey, 'comment-monitor-v2:store-a:brand-001:note-a', {
    page: 1,
    nextPage: null,
    items: [model.normalizeComment({ id: 'c-1', content: '物流多久到？' }, {
      accountKey: 'brand-001', noteId: 'note-a',
    })],
  });
  await chrome.storage.local.set({
    [runtimeApi.STORAGE_KEYS.noteIndex]: {
      schema: 'CommentMonitorNoteIndexV1',
      accountKey: 'brand-001',
      storeId: 'store-a',
      noteIds: ['note-a'],
    },
  });

  const queried = await runtime.queryComments({ accountKey: 'brand-001', search: '物流' });
  const exported = await runtime.exportRaw({ accountKey: 'brand-001', format: 'csv' });

  assert.equal(queried.items.length, 1);
  assert.match(exported.content, /物流多久到/);
  assert.equal(JSON.stringify(chrome.fixture.values).includes('物流多久到'), false,
    'raw comment text stays in IndexedDB-backed cache, not chrome.storage summaries');
});

test('continuation checkpoints stay local and resume the same note without entering summaries', async () => {
  const chrome = createFakeChrome();
  const cache = localCache.createMemoryCache();
  let inventoryRun = 0;
  const calls = [];
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache,
    now: () => Date.parse('2030-01-08T01:00:00.000Z') + inventoryRun * 60_000,
    collectInventory: async () => {
      inventoryRun += 1;
      return {
        accountKey: 'brand-001',
        capturedAt: new Date(Date.parse('2030-01-08T00:50:00.000Z') + inventoryRun * 60_000).toISOString(),
        platformUpdatedAt: new Date(Date.parse('2030-01-08T00:50:00.000Z') + inventoryRun * 60_000).toISOString(),
        rows: [note('note-a', { notePublishTime: '2030-01-07', cmtNum: 700 })],
      };
    },
    resolveOfficialLinks: async () => ({
      'note-a': 'https://www.xiaohongshu.com/explore/note-a?xsec_token=fixture',
    }),
    collectNoteComments: async (task) => {
      calls.push(clone(task));
      return calls.length === 1
        ? { comments: [{ id: 'c-1', content: '第一页' }], complete: false,
          checkpoint: { cursor: 'root-page-2', hasMore: true } }
        : { comments: [{ id: 'c-2', content: '第二页' }], complete: true,
          checkpoint: { cursor: '', hasMore: false } };
    },
  });
  await runtime.configure({ enabled: true, accountKey: 'brand-001' });

  await runtime.runOnce({ trigger: 'manual' });
  await runtime.runOnce({ trigger: 'catch_up' });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].checkpoint.rootCursor, 'root-page-2');
  assert.ok(calls[1].knownCommentIds.includes('c-1'));
  const checkpoints = chrome.fixture.values[runtimeApi.STORAGE_KEYS.checkpoints];
  assert.equal(checkpoints.notes['note-a'].rootCursor, '');
  const summaryText = JSON.stringify(chrome.fixture.values[runtimeApi.STORAGE_KEYS.summary]);
  assert.doesNotMatch(summaryText, /root-page-2|checkpoint/i);
});

test('raw JSON export is not truncated at the dashboard query page size', async () => {
  const chrome = createFakeChrome();
  const cache = localCache.createMemoryCache();
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache,
    collectInventory: async () => ({ accountKey: 'brand-001', rows: [] }),
    collectNoteComments: async () => ({ comments: [], complete: true }),
  });
  const key = 'xhs-comment-monitor:store-a:brand-001:note-a';
  const fingerprint = 'comment-monitor-v2:store-a:brand-001:note-a';
  await cache.open(key, fingerprint);
  for (let page = 0; page < 3; page += 1) {
    await cache.commitPage(key, fingerprint, {
      page: page + 1,
      nextPage: page === 2 ? null : page + 2,
      items: Array.from({ length: 500 }, (_, index) => model.normalizeComment({
        id: `c-${page}-${index}`,
        content: `评论 ${page}-${index}`,
      }, { accountKey: 'brand-001', noteId: 'note-a' })),
    });
  }
  await chrome.storage.local.set({
    [runtimeApi.STORAGE_KEYS.noteIndex]: {
      schema: 'CommentMonitorNoteIndexV1', accountKey: 'brand-001', storeId: 'store-a',
      noteIds: ['note-a'],
    },
  });

  const exported = await runtime.exportRaw({ accountKey: 'brand-001', format: 'json' });
  assert.equal(JSON.parse(exported.content).length, 1500);
});

test('project-history summary archive failures never replace a successful local capture state', async () => {
  const chrome = createFakeChrome();
  const runtime = runtimeApi.createCommentMonitorRuntime({
    chrome,
    model,
    cache: localCache.createMemoryCache(),
    now: () => Date.parse('2030-01-08T01:00:00.000Z'),
    collectInventory: async () => ({ accountKey: 'brand-001', rows: [] }),
    collectNoteComments: async () => ({ comments: [], complete: true }),
    persistSummary: async () => {
      throw Object.assign(new Error('无法唯一绑定店铺'), { code: 'ARCHIVE_BINDING_FAILED' });
    },
  });
  await runtime.configure({ enabled: true, accountKey: 'brand-001' });

  const result = await runtime.runOnce({ trigger: 'manual' });

  assert.equal(result.status, 'completed');
  assert.equal(result.summaryArchive.archived, false);
  assert.equal(result.summaryArchive.reason, 'archive_failed');
  assert.equal(result.summaryArchive.errorCode, 'ARCHIVE_BINDING_FAILED');
  assert.equal(chrome.fixture.values[runtimeApi.STORAGE_KEYS.state].status, 'completed');
});
