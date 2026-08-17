const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const reportHtml = fs.readFileSync(path.join(root, 'web-tool', 'report.html'), 'utf8');
const taskSource = fs.readFileSync(path.join(root, 'web-tool', 'task.js'), 'utf8');

const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
const TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
const BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
const BINDINGS_KEY = 'xhsStoreAccountBindingsV1';

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createBridgeHarness(options = {}) {
  const messageListeners = [];
  const posted = [];
  const storageWrites = [];
  const runtimeMessages = [];
  const confirmCalls = [];
  const storageState = {
    [DIRECTORY_KEY]: {
      schema: 1,
      stores: [
        { id: 'fictional-store-vinda', name: '维达' },
        { id: 'fictional-store-other', name: '其他店铺' },
      ],
    },
    [TASK_STATUS_KEY]: null,
    [BATCH_STATUS_KEY]: null,
    [BINDINGS_KEY]: {
      schema: 'xhsStoreAccountBindingsV1',
      schemaVersion: 2,
      stores: {
        'fictional-store-vinda': {
          platforms: {
            adstar: ['adstar:fictional-secret-star-member'],
            pgy: ['pgy:fictional-secret-pgy-brand'],
            juguang: ['juguang:fictional-secret-brand:fictional-secret-advertiser:4:main'],
          },
          updatedAt: '2030-01-02T03:04:05.000Z',
        },
        'fictional-store-other': {
          platforms: {
            pgy: ['pgy:fictional-other-store-secret'],
          },
          updatedAt: '2030-01-03T03:04:05.000Z',
        },
      },
    },
  };
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    postMessage(message) {
      posted.push(copy(message));
    },
    confirm(message) {
      confirmCalls.push(String(message));
      return options.confirmResult !== false;
    },
  };
  const location = { origin: 'http://127.0.0.1:3400', pathname: '/report.html' };
  windowObject.top = options.topLevel === false
    ? { location: { origin: location.origin } }
    : windowObject;
  const documentObject = {
    visibilityState: options.visibilityState || 'visible',
    hasFocus() { return options.focused !== false; },
  };
  const chromeObject = {
    runtime: {
      lastError: null,
      getManifest() { return { version: '9.9.9' }; },
      sendMessage(message, callback) {
        runtimeMessages.push(copy(message));
        if (message && message.type === 'XHS_BINDING_RESET') {
          callback({
            ok: true,
            summary: {
              platforms: {
                adstar: { bound: true, updatedAt: '2030-01-04T03:04:05.000Z' },
                pgy: { bound: false, updatedAt: '2030-01-04T03:04:05.000Z' },
                juguang: { bound: true, updatedAt: '2030-01-04T03:04:05.000Z' },
              },
            },
          });
          return;
        }
        callback({ ok: true });
      },
    },
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names
            .filter((key) => Object.prototype.hasOwnProperty.call(storageState, key))
            .map((key) => [key, copy(storageState[key])]));
        },
        async set(value) {
          storageWrites.push(copy(value));
          Object.assign(storageState, copy(value));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storageState[key];
        },
      },
      onChanged: { addListener() {} },
    },
  };
  vm.runInNewContext(bridgeSource, {
    chrome: chromeObject,
    console,
    Date,
    document: documentObject,
    location,
    setTimeout,
    window: windowObject,
  }, { filename: 'web-tool-bridge.js' });

  async function request(action, payload, requestId) {
    const id = requestId || 'request-' + posted.length;
    messageListeners.forEach((listener) => listener({
      source: windowObject,
      origin: location.origin,
      data: {
        channel: 'taobao-full-chain-tool-v1',
        type: 'request',
        requestId: id,
        action,
        payload: payload || {},
      },
    }));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const response = posted.find((message) => message.type === 'response' && message.requestId === id);
      if (response) return response;
    }
    throw new Error('bridge response timed out for ' + action);
  }

  return {
    confirmCalls,
    location,
    posted,
    request,
    runtimeMessages,
    storageState,
    storageWrites,
  };
}

test('XHS binding management exposes only a safe per-platform summary on report.html', async () => {
  const harness = createBridgeHarness();
  const ready = harness.posted.find((message) => message.type === 'ready');
  assert.ok(ready.capabilities.includes('xhsBindingManagement'));

  const response = await harness.request('getXhsBindingSummary', {
    storeId: 'fictional-store-vinda',
  }, 'summary');

  assert.equal(response.ok, true);
  assert.deepEqual(copy(response.data), {
    platforms: {
      adstar: { bound: true, updatedAt: '2030-01-02T03:04:05.000Z' },
      pgy: { bound: true, updatedAt: '2030-01-02T03:04:05.000Z' },
      juguang: { bound: true, updatedAt: '2030-01-02T03:04:05.000Z' },
    },
  });
  const serialized = JSON.stringify(response.data);
  for (const secret of [
    'fictional-store-vinda', 'fictional-secret-star-member',
    'fictional-secret-pgy-brand', 'fictional-secret-advertiser',
  ]) {
    assert.equal(serialized.includes(secret), false, 'summary leaked ' + secret);
  }

  const rawRead = await harness.request('getStorage', { keys: [BINDINGS_KEY] }, 'raw-read');
  assert.deepEqual(copy(rawRead.data), {}, 'raw registry must not become readable through getStorage');
});

test('XHS binding reset is confirmed in the isolated bridge and forwarded only as an internal command', async () => {
  const harness = createBridgeHarness();

  const response = await harness.request('resetXhsBinding', {
    storeId: 'fictional-store-vinda',
    platform: 'pgy',
  }, 'reset-pgy');

  assert.equal(response.ok, true);
  assert.equal(response.data.platforms.pgy.bound, false);
  assert.match(response.data.platforms.pgy.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(harness.confirmCalls.length, 1);
  assert.match(harness.confirmCalls[0], /当前“蒲公英”平台登录账号属于所选店铺“维达”/);
  assert.match(harness.confirmCalls[0], /只解除[\s\S]*不会立即重绑/);
  assert.match(harness.confirmCalls[0], /下次[\s\S]*READY[\s\S]*才会建立新绑定/);
  assert.deepEqual(harness.runtimeMessages, [{
    type: 'XHS_BINDING_RESET',
    source: 'business-defense-web-tool',
    storeId: 'fictional-store-vinda',
    platform: 'pgy',
    confirmedByExtension: true,
  }]);
  assert.equal(harness.storageWrites.length, 0, 'content-script bridge must never write the registry');

  const serialized = JSON.stringify(response.data);
  for (const secret of [
    'fictional-store-vinda', 'fictional-secret-star-member',
    'fictional-secret-pgy-brand', 'fictional-secret-advertiser',
    'fictional-other-store-secret',
  ]) {
    assert.equal(serialized.includes(secret), false, 'reset response leaked ' + secret);
  }

});

test('malicious confirmed:true still requires isolated confirmation and cancellation performs no write', async () => {
  const harness = createBridgeHarness({ confirmResult: false });
  const response = await harness.request('resetXhsBinding', {
    storeId: 'fictional-store-vinda',
    storeName: '伪造店铺名',
    platform: 'pgy',
    confirmed: true,
    confirmedByExtension: true,
  }, 'malicious-confirmed');

  assert.equal(response.ok, true);
  assert.equal(response.data.cancelled, true);
  assert.equal(harness.confirmCalls.length, 1);
  assert.match(harness.confirmCalls[0], /维达/);
  assert.doesNotMatch(harness.confirmCalls[0], /伪造店铺名/);
  assert.deepEqual(harness.runtimeMessages, []);
  assert.deepEqual(harness.storageWrites, []);
});

test('XHS binding management rejects active tasks and invalid targets', async () => {
  const harness = createBridgeHarness();

  for (const [requestId, action, payload, pattern] of [
    ['unknown-store', 'getXhsBindingSummary', { storeId: 'fictional-store-missing' }, /项目目录/],
    ['invalid-platform', 'resetXhsBinding', {
      storeId: 'fictional-store-vinda', platform: 'unknown',
    }, /平台/],
  ]) {
    const response = await harness.request(action, payload, requestId);
    assert.equal(response.ok, false);
    assert.match(response.message, pattern);
  }
  assert.equal(harness.storageWrites.length, 0);

  harness.storageState[TASK_STATUS_KEY] = { running: true, taskType: 'report' };
  const taskRunning = await harness.request('resetXhsBinding', {
    storeId: 'fictional-store-vinda', platform: 'pgy',
  }, 'task-running');
  assert.equal(taskRunning.ok, false);
  assert.match(taskRunning.message, /任务.*执行/);
  harness.storageState[TASK_STATUS_KEY] = null;

  harness.storageState[BATCH_STATUS_KEY] = { running: true };
  const batchRunning = await harness.request('getXhsBindingSummary', {
    storeId: 'fictional-store-vinda',
  }, 'batch-running');
  assert.equal(batchRunning.ok, false);
  assert.match(batchRunning.message, /批量任务.*执行/);
  assert.equal(harness.storageWrites.length, 0);

  harness.storageState[BATCH_STATUS_KEY] = null;
  harness.location.pathname = '/accounts.html';
  const wrongPage = await harness.request('getXhsBindingSummary', {
    storeId: 'fictional-store-vinda',
  }, 'wrong-page');
  assert.equal(wrongPage.ok, false);
  assert.match(wrongPage.message, /一键取数/);
});

test('binding reset rejects iframe, hidden, and unfocused callers before confirmation', async () => {
  for (const [label, options] of [
    ['iframe', { topLevel: false }],
    ['hidden', { visibilityState: 'hidden' }],
    ['unfocused', { focused: false }],
  ]) {
    const harness = createBridgeHarness(options);
    const response = await harness.request('resetXhsBinding', {
      storeId: 'fictional-store-vinda',
      platform: 'pgy',
      confirmed: true,
    }, 'unsafe-' + label);
    assert.equal(response.ok, false, label + ' reset must fail');
    assert.match(response.message, /顶层|可见|聚焦/);
    assert.deepEqual(harness.confirmCalls, []);
    assert.deepEqual(harness.runtimeMessages, []);
    assert.deepEqual(harness.storageWrites, []);
  }
});

test('task page renders safe XHS binding controls and requires explicit confirmation before reset', () => {
  for (const id of ['xhsBindingPanel', 'xhsBindingStoreName', 'xhsBindingRows']) {
    assert.match(reportHtml, new RegExp('id="' + id + '"'));
  }
  assert.match(reportHtml, /只显示是否已绑定/);
  assert.match(taskSource, /getXhsBindingSummary/);
  assert.match(taskSource, /resetXhsBinding/);
  const resetTask = taskSource.slice(
    taskSource.indexOf('async function resetXhsBinding'),
    taskSource.indexOf('\n  async function openRun'),
  );
  assert.doesNotMatch(resetTask, /confirmed\s*:/);
  assert.doesNotMatch(resetTask, /window\.confirm/);
  assert.match(bridgeSource, /请先确认[。：：\s\S]*当前[\s\S]*平台登录账号[\s\S]*所选店铺/);
  assert.match(bridgeSource, /只解除[\s\S]*不会立即重绑/);
  assert.match(bridgeSource, /下次[\s\S]*READY[\s\S]*采集[\s\S]*才会建立新绑定/);
  assert.match(bridgeSource, /confirmedByExtension:\s*true/);
});

test('binding reset authorization is owned by the visible top-level isolated bridge', () => {
  assert.doesNotMatch(taskSource, /confirmed:\s*true/);
  assert.match(bridgeSource, /window\.top\s*!==\s*window/);
  assert.match(bridgeSource, /document\.visibilityState\s*!==\s*['"]visible['"]/);
  assert.match(bridgeSource, /document\.hasFocus\(\)/);
  assert.match(bridgeSource, /window\.confirm\(/);
  assert.match(bridgeSource, /confirmedByExtension:\s*true/);
});

test('binding reset and READY reconciliation share one background serialization boundary', () => {
  assert.match(bridgeSource, /type:\s*['"]XHS_BINDING_RESET['"]/);
  assert.match(backgroundSource, /function\s+withXhsBindingRegistryLock\s*\(/);
  assert.match(backgroundSource, /runXhsAnalysisTask[\s\S]*?withXhsBindingRegistryLock\s*\(/);
  assert.match(backgroundSource, /XHS_BINDING_RESET[\s\S]*?requestXhsBindingReset\s*\(/);
  assert.match(backgroundSource, /PROJECT_TASK_START[\s\S]*?xhsBindingMutationPending/);
  assert.match(backgroundSource, /ACCOUNT_BATCH_START_FROM_SESSION[\s\S]*?xhsBindingMutationPending/);
});
