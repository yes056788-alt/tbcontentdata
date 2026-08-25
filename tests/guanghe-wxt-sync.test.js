const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(root, 'content-script.js'), 'utf8');
const pageHook = fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8');
const wxt = fs.readFileSync(path.join(root, 'wxt-report-content.js'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

async function verifyAutomaticSyncPinsTheReadyFrame() {
  const functionSource = sourceBetween(
    background,
    'async function requestGuangheAutomaticSync(',
    "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n  if (!message || message.type !== 'WXT_SYNC_GUANGHE_CONTENT') return;"
  );
  const calls = [];
  const context = vm.createContext({
    chrome: {
      tabs: {
        async sendMessage(tabId, message, options) {
          calls.push({ tabId, message, options });
          return { ok: true, matchedCount: 1 };
        },
      },
    },
    async waitMilliseconds() {},
    isMissingContentReceiver() { return false; },
  });
  vm.runInContext(functionSource + '\nthis.requestSync = requestGuangheAutomaticSync;', context);
  const response = await context.requestSync(
    41,
    9,
    'document-41',
    'gh-sync-test-1234',
    [{ ids: ['123'] }]
  );
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tabId, 41);
  assert.equal(calls[0].options.frameId, 9);
  assert.equal(calls[0].options.documentId, 'document-41');
  assert.equal(calls[0].message.type, 'GH_SYNC_ALL_CONTENT');
}

async function verifyExistingFrameBridgeIsRestoredAfterExtensionReload() {
  const functionSource = sourceBetween(
    background,
    'async function restoreGuangheAutomaticSyncBridge(',
    "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n  if (!message || message.type !== 'WXT_SYNC_GUANGHE_CONTENT') return;"
  );
  let sendAttempts = 0;
  let automaticAttempts = 0;
  const injected = [];
  const context = vm.createContext({
    chrome: {
      scripting: {
        async executeScript(options) { injected.push({ reset: options.target }); },
      },
      tabs: {
        async sendMessage(tabId, message, options) {
          sendAttempts += 1;
          if (message.type === 'GH_SYNC_BRIDGE_READY') return null;
          automaticAttempts += 1;
          if (automaticAttempts === 1) {
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return { ok: true, matchedCount: 1, tabId, message, options };
        },
      },
    },
    async injectScripts(tabId, scripts) { injected.push({ tabId, scripts }); },
    async findGuangheAutomaticSyncFrame() {
      return { tabId: 44, frameId: 8, documentId: 'document-new', role: 'asset' };
    },
    async waitForGuangheAutomaticSyncFrame() {
      throw new Error('ready re-probe should succeed without waiting');
    },
    async waitMilliseconds() {},
    isMissingContentReceiver() { return true; },
    Number,
  });
  vm.runInContext(functionSource + '\nthis.requestSync = requestGuangheAutomaticSync;', context);
  const response = await context.requestSync(
    44,
    6,
    'document-old',
    'gh-sync-reload-1234',
    [{ ids: ['123'] }]
  );
  assert.equal(response.ok, true);
  assert.equal(sendAttempts, 3);
  assert.equal(injected.length, 2);
  assert.equal(injected[0].reset.tabId, 44);
  assert.equal(injected[0].reset.documentIds[0], 'document-new');
  assert.equal(injected[1].scripts[0].documentIds[0], 'document-new');
  assert.ok(injected[1].scripts[0].files.includes('content-script.js'));
  assert.equal(response.options.frameId, 8);
  assert.equal(response.options.documentId, 'document-new');
}

async function verifyExistingGuangheTabIsReused() {
  const functionSource = sourceBetween(
    background,
    'async function findOrCreateGuangheTab(',
    'async function readGuangheFrames('
  );
  let createCount = 0;
  let queryCount = 0;
  const context = vm.createContext({
    BUSINESS_DEFENSE_GH_URL: 'https://creator.guanghe.taobao.com/page/unify/asset-overview',
    GUANGHE_TAB_PATTERNS: ['*://creator.guanghe.taobao.com/*'],
    reusableGuangheContext: { tabId: 73, frameId: 8, permissionRecovered: true },
    rememberGuangheContext(tabId, frameId, permissionRecovered) {
      context.reusableGuangheContext = { tabId, frameId, permissionRecovered };
    },
    guangheFrameRole() { return 'creator'; },
    chrome: {
      tabs: {
        async get(tabId) { return { id: tabId, url: 'https://creator.guanghe.taobao.com/' }; },
        async query() { queryCount += 1; return []; },
        async create() { createCount += 1; return { id: 99 }; },
      },
    },
  });
  vm.runInContext(functionSource + '\nthis.findTab = findOrCreateGuangheTab;', context);
  const target = await context.findTab(5);
  assert.equal(target.tabId, 73);
  assert.equal(target.created, false);
  assert.equal(queryCount, 0);
  assert.equal(createCount, 0);
}

async function verifyUnrelatedRememberedTabIsRejected() {
  const functionSource = sourceBetween(
    background,
    'async function findOrCreateGuangheTab(',
    'async function readGuangheFrames('
  );
  let queryCount = 0;
  const context = vm.createContext({
    BUSINESS_DEFENSE_GH_URL: 'https://creator.guanghe.taobao.com/page/unify/asset-overview',
    GUANGHE_TAB_PATTERNS: ['*://creator.guanghe.taobao.com/*'],
    reusableGuangheContext: { tabId: 73, frameId: 8, permissionRecovered: true },
    guangheFrameRole(url) { return String(url).includes('creator.guanghe') ? 'creator' : ''; },
    rememberGuangheContext(tabId, frameId, permissionRecovered) {
      context.reusableGuangheContext = { tabId, frameId, permissionRecovered };
    },
    chrome: {
      tabs: {
        async get() { return { id: 73, url: 'https://example.com/unrelated' }; },
        async query() {
          queryCount += 1;
          return [{ id: 84, url: 'https://creator.guanghe.taobao.com/page/unify/asset-overview' }];
        },
        async create() { throw new Error('should reuse the valid queried Guanghe tab'); },
      },
    },
  });
  vm.runInContext(functionSource + '\nthis.findTab = findOrCreateGuangheTab;', context);
  const target = await context.findTab(5);
  assert.equal(target.tabId, 84);
  assert.equal(target.created, false);
  assert.equal(queryCount, 1);
}

async function verifyGuangheWorkflowsAreSerialized() {
  const functionSource = sourceBetween(
    background,
    'function withGuangheWorkflow(',
    'function rememberGuangheContext('
  );
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const context = vm.createContext({
    guangheWorkflowTail: Promise.resolve(),
  });
  vm.runInContext(functionSource + '\nthis.withWorkflow = withGuangheWorkflow;', context);
  const first = context.withWorkflow(async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = context.withWorkflow(async () => {
    events.push('second:start');
    events.push('second:end');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
}

async function verifyRecoveredPermissionFlowIsReused() {
  const functionSource = sourceBetween(
    background,
    'async function prepareGuangheAutomaticSyncTarget(',
    'async function runBusinessDefenseGuanghe('
  );
  const events = [];
  const context = vm.createContext({
    reusableGuangheContext: {
      tabId: 51,
      frameId: 7,
      permissionRecovered: true,
    },
    async findOrCreateGuangheTab() {
      events.push('reuse-tab');
      return { tabId: 51, created: false };
    },
    async waitTabComplete() { events.push('wait-tab'); },
    async findGuangheAutomaticSyncFrame() { return null; },
    async readGuangheFrames() {
      return [{ frameId: 7, url: 'https://web.taobao.com/s-guanghe-creator/asset-overview' }];
    },
    guangheFrameRole() { return 'asset'; },
    async clickGuangheMenuItem() {
      events.push('works-tab');
      throw new Error('force the complete recovered navigation path');
    },
    async openRecoveredGuangheContentPage() {
      events.push('settings-recovery');
      return { tabId: 51, frameId: 9, role: 'asset' };
    },
    async inspectGuangheAccess() {
      events.push('unexpected-direct-inspection');
      return { permissionDenied: false };
    },
    async tryGuangheSettingsRecovery() {
      events.push('unexpected-new-recovery');
      return { ok: true };
    },
    chrome: {
      tabs: {
        async update() { events.push('unexpected-navigation'); },
      },
    },
    GH_AUTOMATIC_SYNC_URL: 'https://creator.guanghe.taobao.com/work',
    async waitMilliseconds() {},
    rememberGuangheContext() {},
    Object,
    Boolean,
  });
  vm.runInContext(functionSource + '\nthis.prepareTarget = prepareGuangheAutomaticSyncTarget;', context);
  const target = await context.prepareTarget(3);
  assert.equal(target.tabId, 51);
  assert.equal(target.frameId, 9);
  assert.equal(target.reused, true);
  assert.deepEqual(events, ['reuse-tab', 'wait-tab', 'works-tab', 'settings-recovery']);
}

async function verifyNewDeniedTabUsesExistingSettingsRecovery() {
  const functionSource = sourceBetween(
    background,
    'async function prepareGuangheAutomaticSyncTarget(',
    'async function runBusinessDefenseGuanghe('
  );
  const events = [];
  const context = vm.createContext({
    reusableGuangheContext: null,
    async findOrCreateGuangheTab() { return { tabId: 61, created: true }; },
    async waitTabComplete() {},
    async findGuangheAutomaticSyncFrame() { return null; },
    async readGuangheFrames() {
      return [{ frameId: 0, url: 'https://creator.guanghe.taobao.com/' }];
    },
    guangheFrameRole() { return 'creator'; },
    async inspectGuangheAccess() {
      events.push('inspect-denied');
      return { permissionDenied: true };
    },
    async tryGuangheSettingsRecovery() {
      events.push('open-settings');
      return { ok: true };
    },
    async openRecoveredGuangheContentPage() {
      events.push('content-data-asset-overview');
      return { tabId: 61, frameId: 12, role: 'asset' };
    },
    async clickGuangheMenuItem() {},
    async waitMilliseconds() { events.push('settle-settings'); },
    rememberGuangheContext() {},
    chrome: { tabs: { async update() { events.push('unexpected-direct-navigation'); } } },
    GH_AUTOMATIC_SYNC_URL: 'https://creator.guanghe.taobao.com/work',
    Object,
    Boolean,
  });
  vm.runInContext(functionSource + '\nthis.prepareTarget = prepareGuangheAutomaticSyncTarget;', context);
  const target = await context.prepareTarget(4);
  assert.equal(target.frameId, 12);
  assert.equal(target.role, 'asset');
  assert.deepEqual(events, [
    'inspect-denied',
    'open-settings',
    'settle-settings',
    'content-data-asset-overview',
  ]);
}

async function verifyStaleMainHookReloadsTheSameTab() {
  const functionSource = sourceBetween(
    background,
    'async function prepareGuangheAutomaticSyncTarget(',
    'async function runBusinessDefenseGuanghe('
  );
  const events = [];
  let probeCount = 0;
  const context = vm.createContext({
    reusableGuangheContext: { tabId: 66, frameId: 4, permissionRecovered: true },
    async findOrCreateGuangheTab() { return { tabId: 66, created: false }; },
    async waitTabComplete() { events.push('wait'); },
    async findGuangheAutomaticSyncFrame() {
      probeCount += 1;
      if (probeCount === 1) {
        const error = new Error('old hook');
        error.code = 'GUANGHE_PAGE_HOOK_STALE';
        throw error;
      }
      return {
        tabId: 66,
        frameId: 10,
        documentId: 'document-fresh',
        role: 'asset',
      };
    },
    rememberGuangheContext(tabId, frameId, permissionRecovered) {
      events.push(['remember', tabId, frameId, permissionRecovered]);
    },
    async waitMilliseconds() { events.push('settle'); },
    chrome: {
      tabs: {
        async reload(tabId) { events.push(['reload', tabId]); },
      },
    },
    Object,
  });
  vm.runInContext(functionSource + '\nthis.prepareTarget = prepareGuangheAutomaticSyncTarget;', context);
  const target = await context.prepareTarget(4);
  assert.equal(target.tabId, 66);
  assert.equal(target.documentId, 'document-fresh');
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === 'reload'));
  assert.ok(events.some((event) => (
    Array.isArray(event) && event[0] === 'remember' && event[2] === null
  )));
}

function verifyMtopBusinessErrorsAreNotTreatedAsEmptyRows() {
  const functionSource = sourceBetween(
    pageHook,
    'function mtopBusinessStatus(',
    'function throwTerminalMtopAccessError('
  );
  const context = vm.createContext({ Error, Array, String });
  vm.runInContext(
    functionSource + '\nthis.assertSuccess = assertMtopBusinessSuccess;' +
      '\nthis.normalizeRejection = normalizeMtopRejection;',
    context
  );
  const success = { ret: ['SUCCESS::\u8c03\u7528\u6210\u529f'], data: { model: { result: [] } } };
  assert.equal(context.assertSuccess(success), success);
  assert.throws(
    () => context.assertSuccess({ ret: ['FAIL_SYS_SESSION_EXPIRED::SESSION_EXPIRED'] }),
    (error) => error.code === 'GUANGHE_LOGIN_REQUIRED' && /\u767b\u5f55/.test(error.message)
  );
  assert.throws(
    () => context.assertSuccess({ ret: ['FAIL_BIZ_NO_PERMISSION::NO_PERMISSION'] }),
    (error) => error.code === 'GUANGHE_PERMISSION_DENIED' && /\u65e0\u6743/.test(error.message)
  );
  assert.equal(
    context.normalizeRejection(
      { ret: ['FAIL_BIZ_NO_PERMISSION::NO_PERMISSION'] },
      '光合作品接口'
    ).code,
    'GUANGHE_PERMISSION_DENIED'
  );
  assert.equal(
    context.normalizeRejection('FAIL_SYS_SESSION_EXPIRED::SESSION_EXPIRED').code,
    'GUANGHE_LOGIN_REQUIRED'
  );
  assert.throws(
    () => context.assertSuccess({ ret: ['FAIL_SYS_TOKEN_EXOIRED::\u4ee4\u724c\u8fc7\u671f'] }),
    (error) => error.code === 'GUANGHE_LOGIN_REQUIRED'
  );
  assert.equal(
    context.normalizeRejection({
      error: { ret: ['FAIL_SYS_TOKEN_EMPTY::TOKEN_EMPTY'] },
    }).code,
    'GUANGHE_LOGIN_REQUIRED'
  );
  assert.throws(
    () => context.assertSuccess({
      error: { ret: ['FAIL_BIZ_NO_PERMISSION::NO_PERMISSION'] },
    }),
    (error) => error.code === 'GUANGHE_PERMISSION_DENIED'
  );
  assert.equal(
    context.normalizeRejection({
      responseJSON: {
        data: { ret: ['FAIL_SYS_SESSION_EXPIRED::SESSION_EXPIRED'] },
      },
    }).code,
    'GUANGHE_LOGIN_REQUIRED'
  );
  assert.throws(
    () => context.assertSuccess({}),
    (error) => error.code === 'GUANGHE_API_FAILED'
  );
  const original = new Error('FAIL_BIZ_NO_PERMISSION::NO_PERMISSION');
  assert.equal(context.normalizeRejection(original), original);
  assert.equal(original.code, 'GUANGHE_PERMISSION_DENIED');
}

async function verifyManualAndAutomaticContentReadsCannotOverlap() {
  const leaseSource = sourceBetween(
    pageHook,
    'let contentWorkflowLease = null;',
    '// 主入口：一次捕获条件，同时抓作品 + 商品两套数据'
  );
  const context = vm.createContext({
    Date,
    Math,
    Number,
    String,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    leaseSource + '\nthis.acquireWorkflow = acquireContentWorkflow;',
    context
  );
  const releaseManual = await context.acquireWorkflow('manual:test', 0);
  await assert.rejects(
    context.acquireWorkflow('automatic:test', 0),
    (error) => error.code === 'GUANGHE_PAGE_BUSY'
  );
  releaseManual();
  const releaseAutomatic = await context.acquireWorkflow('automatic:test', 0);
  releaseAutomatic();
}

function verifyDocumentNavigationErrorsTriggerAReadyReprobe() {
  const functionSource = sourceBetween(
    background,
    'function isMissingContentReceiver(',
    'function normalizeGuangheTargetGroups('
  );
  const context = vm.createContext({ String });
  vm.runInContext(
    functionSource + '\nthis.isMissingReceiver = isMissingContentReceiver;',
    context
  );
  assert.equal(context.isMissingReceiver(new Error('No document with id ABC in tab 1')), true);
  assert.equal(context.isMissingReceiver(new Error('Frame with ID 8 was removed.')), true);
  assert.equal(context.isMissingReceiver(new Error('Extension manifest must request permission')), false);
}

async function verifyAutomaticSyncStorageIsRequestScoped() {
  const persistSource = sourceBetween(
    contentScript,
    'function persistAutomaticContentSync(',
    'function runAutomaticFullContentSync('
  );
  let written = null;
  const persistContext = vm.createContext({
    parseContentRows(rows) { return rows; },
    computeFilterFingerprint() { return 'fingerprint'; },
    collectVisibleFilters() { return {}; },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          set(values, callback) {
            written = values;
            callback();
          },
        },
      },
    },
    Date,
    Number,
    String,
    Set,
    Array,
    Promise,
  });
  vm.runInContext(persistSource + '\nthis.persistSync = persistAutomaticContentSync;', persistContext);
  const response = await persistContext.persistSync(
    [{ id: 'content-1', items: [{ itemId: 'product-1' }] }],
    { requestId: 'gh-sync-scoped-1234', targetCount: 1, matchedCount: 1 }
  );
  assert.equal(response.storageKey, 'gh_wxt_sync_v1:gh-sync-scoped-1234');
  assert.deepEqual(Object.keys(written), [response.storageKey]);
  assert.equal(written.gh_wxt_results, undefined);

  const readSource = sourceBetween(
    wxt,
    'function readGuangheStorage(',
    'function guangheOrganicMetrics('
  );
  const removed = [];
  const readContext = vm.createContext({
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get(keys, callback) {
            assert.ok(keys.includes(response.storageKey));
            callback({
              gh_wxt_results: [{ id: 'stale-global' }],
              gh_wxt_data_context: { requestId: 'gh-sync-other-1234' },
              [response.storageKey]: written[response.storageKey],
            });
          },
          remove(key) {
            removed.push(key);
            return Promise.resolve();
          },
        },
      },
    },
    String,
    Array,
    Promise,
  });
  vm.runInContext(readSource + '\nthis.readSync = readGuangheStorage;', readContext);
  const stored = await readContext.readSync(response);
  assert.equal(stored.gh_wxt_results[0].id, 'content-1');
  assert.equal(stored.gh_wxt_data_context.requestId, 'gh-sync-scoped-1234');
  assert.deepEqual(removed, [response.storageKey]);
}

const prepareBlock = sourceBetween(
  background,
  'async function prepareGuangheAutomaticSyncTarget(',
  'async function runBusinessDefenseGuanghe('
);
assert.match(prepareBlock, /findGuangheAutomaticSyncFrame/);
assert.ok(prepareBlock.includes("clickGuangheMenuItem(tabId, '\\u4f5c\\u54c1\\u5206\\u6790'"));
assert.match(prepareBlock, /tryGuangheSettingsRecovery/);
assert.match(prepareBlock, /openRecoveredGuangheContentPage/);
assert.doesNotMatch(prepareBlock, /chrome\.tabs\.create/);

const listenerBlock = background.slice(background.indexOf(
  "if (!message || message.type !== 'WXT_SYNC_GUANGHE_CONTENT') return;"
));
assert.match(listenerBlock, /prepareGuangheAutomaticSyncTarget/);
assert.match(listenerBlock, /guangheTarget\.frameId/);
assert.doesNotMatch(listenerBlock, /chrome\.tabs\.create/);
assert.doesNotMatch(listenerBlock, /chrome\.tabs\.remove/);

assert.match(wxt, /const guanghePartial = Boolean/);
assert.match(wxt, /partial: guanghePartial/);
assert.ok(wxt.includes('光合未匹配到万相台视频'));
assert.match(pageHook, /const PAGE_HOOK_PROTOCOL = 2/);
assert.match(background, /window\.__ghPageHookProtocol === 2/);
const channelBlock = sourceBetween(
  pageHook,
  'window.__ghFetchChannelDiagnosis = async function',
  'let contentWorkflowLease = null;'
);
assert.match(channelBlock, /acquireContentWorkflow\('channel-diagnosis'/);
assert.match(channelBlock, /releaseContentWorkflow\(\)/);
const loadMoreBlock = sourceBetween(
  pageHook,
  'window.__ghFetchMore = async function',
  '// 监听来自 content-script（ISOLATED world）的触发请求'
);
assert.match(loadMoreBlock, /acquireContentWorkflow\('load-more:' \+ requestId/);
assert.match(loadMoreBlock, /releaseContentWorkflow\(\)/);

Promise.all([
  verifyAutomaticSyncPinsTheReadyFrame(),
  verifyExistingFrameBridgeIsRestoredAfterExtensionReload(),
  verifyExistingGuangheTabIsReused(),
  verifyUnrelatedRememberedTabIsRejected(),
  verifyGuangheWorkflowsAreSerialized(),
  verifyRecoveredPermissionFlowIsReused(),
  verifyNewDeniedTabUsesExistingSettingsRecovery(),
  verifyStaleMainHookReloadsTheSameTab(),
  verifyManualAndAutomaticContentReadsCannotOverlap(),
  verifyAutomaticSyncStorageIsRequestScoped(),
]).then(() => {
  verifyMtopBusinessErrorsAreNotTreatedAsEmptyRows();
  verifyDocumentNavigationErrorsTriggerAReadyReprobe();
  console.log('guanghe and wanxiangtai sync guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
