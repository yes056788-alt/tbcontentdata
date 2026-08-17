const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function sourceBlock(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, 'missing source marker: ' + start);
  assert.ok(to > from, 'missing source marker: ' + end);
  return source.slice(from, to);
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createSerializationHarness(options = {}) {
  const firstGetStarted = deferred();
  const releaseFirstGet = deferred();
  let getCount = 0;
  let activeGets = 0;
  let maxActiveGets = 0;
  const writes = [];
  const state = {
    taobaoProjectDirectoryV1: {
      stores: [
        { id: 'fictional-store-vinda', name: '维达' },
        { id: 'fictional-store-other', name: '其他店铺' },
      ],
    },
    taobaoProjectTaskStatusV1: null,
    taobaoAccountBatchStatusV1: null,
    xhsStoreAccountBindingsV1: {
      schema: 'xhsStoreAccountBindingsV1',
      schemaVersion: 2,
      stores: {
        'fictional-store-vinda': {
          platforms: {
            pgy: ['pgy:fictional-old-pgy'],
            juguang: ['juguang:fictional-brand:fictional-advertiser:4:main'],
          },
          updatedAt: '2030-01-01T00:00:00.000Z',
        },
        'fictional-store-other': {
          platforms: { pgy: ['pgy:fictional-other-store'] },
          updatedAt: '2030-01-02T00:00:00.000Z',
        },
      },
    },
  };
  const selectStored = (keys) => {
    const names = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(names
      .filter((key) => Object.prototype.hasOwnProperty.call(state, key))
      .map((key) => [key, copy(state[key])]));
  };
  const context = vm.createContext({
    ACCOUNT_BATCH_STATUS_KEY: 'taobaoAccountBatchStatusV1',
    PROJECT_DIRECTORY_KEY: 'taobaoProjectDirectoryV1',
    PROJECT_TASK_STATUS_KEY: 'taobaoProjectTaskStatusV1',
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    XHS_STORE_BINDINGS_KEY: 'xhsStoreAccountBindingsV1',
    accountBatchPromise: null,
    projectTaskPromise: null,
    batchText(value, maxLength) {
      return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
    },
    normalizeProjectPlatformTaskIds(value) {
      return Array.isArray(value) ? value.slice() : [];
    },
    normalizeXhsDateRange(value) {
      return value;
    },
    xhsRuntime: {
      async run() {
        return {
          status: 'complete',
          platforms: {
            adstar: {
              status: 'complete',
              identity: { memberId: 'fictional-ready-star' },
            },
          },
        };
      },
    },
    XhsBindings: {
      reconcileStoreBindings(input) {
        const registry = copy(input.registry);
        const store = registry.stores[input.storeId];
        store.platforms = Object.assign({}, store.platforms, {
          adstar: ['adstar:fictional-ready-star'],
        });
        store.updatedAt = input.updatedAt;
        return {
          registry,
          bindings: { adstar: ['adstar:fictional-ready-star'] },
          issues: [],
          ready: true,
          changed: true,
        };
      },
    },
    XhsAnalysis: {
      createXhsAnalysisSnapshot() {
        return {
          schema: 'xhsAnalysisSnapshotV1',
          notes: [],
          quality: { decisionReady: true, issues: [] },
        };
      },
    },
    XhsMetrics: { assertSnapshotWithinLimit() {} },
    chrome: {
      runtime: { id: 'fictional-extension-id' },
      storage: {
        local: {
          async get(keys) {
            getCount += 1;
            activeGets += 1;
            maxActiveGets = Math.max(maxActiveGets, activeGets);
            const snapshot = selectStored(keys);
            if (getCount === 1 && options.blockFirstGet !== false) {
              firstGetStarted.resolve();
              await releaseFirstGet.promise;
            }
            activeGets -= 1;
            return snapshot;
          },
          async set(value) {
            writes.push(copy(value));
            Object.assign(state, copy(value));
          },
        },
      },
    },
    isOneClickWebToolSender(message, sender) {
      return message && message.source === 'business-defense-web-tool' &&
        sender && sender.id === 'fictional-extension-id' &&
        sender.url === 'http://127.0.0.1:3400/report.html';
    },
  });
  const block = sourceBlock(
    backgroundSource,
    'const XHS_TERMINAL_COLLECTION_ERROR_CODES',
    '\nasync function runContentDiagnosisReport'
  );
  vm.runInContext(
    block +
      '\nglobalThis.testRunReady = runXhsAnalysisTask;' +
      '\nglobalThis.testReset = requestXhsBindingReset;' +
      '\nglobalThis.testPending = () => xhsBindingMutationPending;' +
      '\nglobalThis.testTrustedSender = isTrustedXhsBindingResetSender;',
    context
  );
  return {
    context,
    firstGetStarted,
    maxActiveGets: () => maxActiveGets,
    releaseFirstGet,
    state,
    writes,
  };
}

function resetInput() {
  return {
    type: 'XHS_BINDING_RESET',
    source: 'business-defense-web-tool',
    storeId: 'fictional-store-vinda',
    platform: 'pgy',
    confirmedByExtension: true,
  };
}

function readyInput() {
  return {
    runId: 'fictional-ready-run',
    storeId: 'fictional-store-vinda',
    platforms: ['adstar'],
    dateRange: { from: '2030-01-01', to: '2030-01-07', timezone: 'Asia/Shanghai' },
  };
}

async function assertSerializedInterleave(first) {
  const harness = createSerializationHarness();
  let resetPromise;
  let readyPromise;
  if (first === 'reset') {
    resetPromise = harness.context.testReset(resetInput());
    assert.equal(harness.context.testPending(), 1, 'reset must be pending synchronously');
    await harness.firstGetStarted.promise;
    readyPromise = harness.context.testRunReady(readyInput());
  } else {
    readyPromise = harness.context.testRunReady(readyInput());
    await harness.firstGetStarted.promise;
    resetPromise = harness.context.testReset(resetInput());
    assert.equal(harness.context.testPending(), 1, 'queued reset must be visible synchronously');
  }
  harness.releaseFirstGet.resolve();
  const [resetResult, readyResult] = await Promise.all([resetPromise, readyPromise]);
  assert.equal(readyResult.ok, true);
  assert.equal(resetResult.platforms.pgy.bound, false);
  assert.equal(harness.context.testPending(), 0);
  assert.equal(harness.maxActiveGets(), 1, 'registry read/modify/write sections must not overlap');

  const stores = harness.state.xhsStoreAccountBindingsV1.stores;
  assert.equal(Object.prototype.hasOwnProperty.call(
    stores['fictional-store-vinda'].platforms, 'pgy'
  ), false, 'reset binding must stay deleted');
  assert.deepEqual(
    stores['fictional-store-vinda'].platforms.adstar,
    ['adstar:fictional-ready-star'],
    'READY binding written by the concurrent task must be preserved'
  );
  assert.deepEqual(
    stores['fictional-store-vinda'].platforms.juguang,
    ['juguang:fictional-brand:fictional-advertiser:4:main'],
    'sibling platform binding must be preserved'
  );
  assert.deepEqual(
    stores['fictional-store-other'].platforms.pgy,
    ['pgy:fictional-other-store'],
    'other store binding must be preserved'
  );
  const serializedResponse = JSON.stringify(resetResult);
  for (const forbidden of [
    'fictional-store-vinda', 'fictional-old-pgy', 'fictional-ready-star',
    'fictional-advertiser', 'fictional-other-store',
  ]) {
    assert.equal(serializedResponse.includes(forbidden), false, 'reset response leaked ' + forbidden);
  }
}

test('reset first then READY reconciliation is serialized without losing sibling updates', async () => {
  await assertSerializedInterleave('reset');
});

test('READY reconciliation first then reset is serialized without resurrecting the old binding', async () => {
  await assertSerializedInterleave('ready');
});

test('background reset sender validation requires the same extension and exact report page', () => {
  const harness = createSerializationHarness();
  const valid = {
    id: 'fictional-extension-id',
    url: 'http://127.0.0.1:3400/report.html',
  };
  assert.equal(harness.context.testTrustedSender(resetInput(), valid), true);
  assert.equal(harness.context.testTrustedSender(resetInput(), Object.assign({}, valid, {
    id: 'different-extension-id',
  })), false);
  assert.equal(harness.context.testTrustedSender(resetInput(), Object.assign({}, valid, {
    url: 'http://127.0.0.1:3400/accounts.html',
  })), false);
  assert.equal(harness.context.testTrustedSender(Object.assign({}, resetInput(), {
    confirmedByExtension: false,
  }), valid), false);
});

test('background reset revalidates confirmation, platform, project directory, and running state', async () => {
  for (const [label, mutate, pattern] of [
    ['confirmation', (input) => { input.confirmedByExtension = false; }, /内部确认/],
    ['platform', (input) => { input.platform = 'unknown'; }, /平台/],
    ['directory', (input) => { input.storeId = 'fictional-store-missing'; }, /项目目录/],
  ]) {
    const harness = createSerializationHarness({ blockFirstGet: false });
    const input = resetInput();
    mutate(input);
    await assert.rejects(harness.context.testReset(input), pattern, label);
    assert.equal(harness.context.testPending(), 0);
    assert.deepEqual(harness.writes, []);
  }

  const runningHarness = createSerializationHarness({ blockFirstGet: false });
  runningHarness.state.taobaoProjectTaskStatusV1 = { running: true };
  await assert.rejects(
    runningHarness.context.testReset(resetInput()),
    /任务.*执行/,
  );
  assert.equal(runningHarness.context.testPending(), 0);
  assert.deepEqual(runningHarness.writes, []);
});
