const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'web-tool-bridge.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const messageListeners = [];
const posted = [];
const storageReads = [];
const storageWrites = [];
const storageRemovals = [];
const runtimeMessages = [];
const storageState = {};

const windowObject = {
  addEventListener(type, listener) {
    if (type === 'message') messageListeners.push(listener);
  },
  postMessage(message) {
    posted.push(message);
  },
};
windowObject.top = windowObject;

const chromeObject = {
  runtime: {
    getManifest() {
      return { version: '9.9.9' };
    },
    lastError: null,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      callback({ ok: true, results: [] });
    },
  },
  storage: {
    local: {
      async get(keys) {
        storageReads.push(keys);
        return Object.fromEntries(keys.map((key) => [
          key,
          Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : { key },
        ]));
      },
      async set(value) {
        storageWrites.push(value);
        Object.assign(storageState, value);
      },
      async remove(keys) {
        storageRemovals.push(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storageState[key];
      },
    },
    onChanged: {
      addListener() {},
    },
  },
};

const context = {
  chrome: chromeObject,
  console,
  location: { origin: 'http://127.0.0.1:3400', pathname: '/accounts.html' },
  window: windowObject,
};
vm.runInNewContext(source, context, { filename: sourcePath });

function send(action, payload, requestId) {
  messageListeners.forEach((listener) => listener({
    source: windowObject,
    origin: context.location.origin,
    data: {
      channel: 'taobao-full-chain-tool-v1',
      type: 'request',
      requestId,
      action,
      payload,
    },
  }));
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function run() {
  assert.ok(posted.some((message) => (
    message.type === 'ready' &&
      message.version === '9.9.9' &&
      message.capabilities.includes('accountSessionUnlock') &&
      message.capabilities.includes('accountBatchMultiSelect') &&
      message.capabilities.includes('storeRunManualInputs') &&
      message.capabilities.includes('cloudSync') &&
      !message.capabilities.includes('autoCollect') &&
      !message.capabilities.includes('contentDiagnosisReport')
  )));

  send('getStorage', {
    keys: ['gh_channel_snapshot', 'privateUnexpectedKey'],
  }, 'read');
  await settle();
  assert.deepEqual(Array.from(storageReads[0]), ['gh_channel_snapshot']);

  send('setManualInputs', {
    manualInputs: {
      xhs_kolSpend: '1200',
      xhs_dmpVisitors: '3600',
      xhs_l12Penetration: '30%',
      xhs_l45Penetration: '0.3',
      xhs_unreportedNoteCount: '2',
      xhs_storeGmv: {
        value: '8800',
        manualOverride: true,
        updatedAt: '2030-01-02T03:04:05.000Z',
        accountKeys: ['fictional-pgy-account'],
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
        unexpected: 'drop-me',
      },
      privateUnexpectedKey: 'secret',
    },
  }, 'write');
  await settle();
  assert.deepEqual(
    JSON.parse(JSON.stringify(storageWrites[0].businessDefenseManualInputsV1)),
    {
      xhs_kolSpend: '1200',
      xhs_dmpVisitors: '3600',
      xhs_l12Penetration: '30%',
      xhs_l45Penetration: '30%',
      xhs_unreportedNoteCount: '2',
      xhs_storeGmv: {
        value: '8800',
        manualOverride: true,
        updatedAt: '2030-01-02T03:04:05.000Z',
        accountKeys: ['fictional-pgy-account'],
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
      },
    }
  );

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_contentAudienceAsset',
    value: '8800',
  }, 'write-run');
  await settle();
  const runWrite = storageWrites.find((value) => value['taobaoStoreRunV1:store-run-history-1']);
  assert.ok(runWrite);
  assert.deepEqual(
    Object.assign({}, runWrite.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800' }
  );

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_dmpVisitors',
    value: '3600',
  }, 'write-run-second');
  await settle();
  const mergedRunWrite = storageWrites.at(-1);
  assert.deepEqual(
    Object.assign({}, mergedRunWrite['taobaoStoreRunV1:store-run-history-1'].snapshots.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800', xhs_dmpVisitors: '3600' }
  );

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_dmpVisitors',
    value: '30%',
  }, 'write-run-invalid');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'write-run-invalid' && message.ok === false && /百分号/.test(message.message)
  )));
  assert.deepEqual(
    Object.assign({}, runWrite['taobaoStoreRunV1:store-run-history-1'].snapshots.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800' }
  );

  send('clearStorage', {
    keys: ['businessDefenseAutoCollectStatusV1', 'privateUnexpectedKey'],
  }, 'clear');
  await settle();
  assert.deepEqual(Array.from(storageRemovals[0]), ['businessDefenseAutoCollectStatusV1']);

  const runtimeCountBeforeRetiredActions = runtimeMessages.length;
  send('startAutoCollect', { message: { type: 'UNSAFE_COMMAND' } }, 'start');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'start' && message.ok === false && /不在允许范围/.test(message.message)
  )));
  assert.equal(runtimeMessages.some((message) => message.type === 'BUSINESS_DEFENSE_AUTO_COLLECT'), false);

  send('startContentDiagnosisReport', { message: { type: 'UNSAFE_COMMAND' } }, 'report');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'report' && message.ok === false && /不在允许范围/.test(message.message)
  )));
  assert.equal(runtimeMessages.some((message) => message.type === 'BUSINESS_DEFENSE_GENERATE_CONTENT_REPORT'), false);
  assert.equal(runtimeMessages.length, runtimeCountBeforeRetiredActions);

  send('startProjectTask', {
    taskType: 'report',
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeRetiredActions);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-task-wrong-page' && message.ok === false && /一键取数/.test(message.message)
  )));

  context.location.pathname = '/report.html';
  send('startProjectTask', {
    taskType: 'collect',
    platforms: ['sycm', 'wxt'],
    store: { id: 'store-1', name: '一号店', groupId: 'group-1', groupName: '第一组' },
  }, 'project-task');
  await settle();
  const projectTaskMessage = runtimeMessages.find((message) => message.type === 'PROJECT_TASK_START');
  assert.equal(projectTaskMessage.payload.taskType, 'report');
  assert.deepEqual(Array.from(projectTaskMessage.payload.platforms), ['sycm', 'wxt']);
  assert.equal(projectTaskMessage.payload.store.id, 'store-1');
  assert.ok(posted.some((message) => message.requestId === 'project-task' && message.ok === true));

  context.location.pathname = '/accounts.html';
  send('setAccountSession', {
    masterPassword: 'master-password-123',
    vault: {
      accountGroups: [],
      storeGroups: [{ id: 'group-1', name: '第一组', unexpected: 'drop-me' }],
      stores: [{ id: 'store-1', name: '一号店', groupId: 'group-1' }],
      accounts: [{
        id: 'account-1', name: '一号店账号', storeId: 'store-1',
        username: 'private-user', password: 'private-password', enabled: true,
        unexpected: 'drop-me',
      }],
      notification: {},
      unexpected: 'drop-me',
    },
  }, 'session-set');
  await settle();
  const sessionSetMessage = runtimeMessages.find((message) => message.type === 'ACCOUNT_SESSION_SET');
  assert.equal(sessionSetMessage.vault.accounts[0].username, 'private-user');
  assert.equal(sessionSetMessage.vault.accounts[0].password, 'private-password');
  assert.equal(sessionSetMessage.vault.accounts[0].unexpected, undefined);
  assert.equal(sessionSetMessage.vault.unexpected, undefined);
  assert.equal(sessionSetMessage.masterPassword, 'master-password-123');

  send('getAccountSessionSummary', {}, 'session-summary');
  send('getAccountManagementSession', {}, 'session-management');
  await settle();
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_GET_SUMMARY'));
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_GET_MANAGEMENT'));

  context.location.pathname = '/report.html';
  send('startAccountBatchFromSession', {
    taskType: 'report',
    selection: {
      type: 'storeGroup', id: 'group-1', name: 'untrusted-name',
      accountIds: ['account-2', 'account-1', 'account-2', '', null],
    },
    accounts: [{ username: 'must-not-pass' }],
  }, 'session-start');
  await settle();
  const sessionStartMessage = runtimeMessages.find((message) => message.type === 'ACCOUNT_BATCH_START_FROM_SESSION');
  assert.deepEqual(JSON.parse(JSON.stringify(sessionStartMessage.payload.selection)), {
    type: 'storeGroup', id: 'group-1', accountIds: ['account-2', 'account-1'],
  });
  assert.equal(sessionStartMessage.payload.taskType, 'report');
  assert.equal(sessionStartMessage.payload.accounts, undefined);

  const runtimeCountBeforeInvalidSelections = runtimeMessages.length;
  send('startAccountBatchFromSession', {
    selection: { type: 'storeGroup', id: 'group-1', accountIds: [] },
  }, 'session-start-empty');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'session-start-empty' && message.ok === false && /至少选择一个/.test(message.message)
  )));
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidSelections);

  send('startAccountBatchFromSession', {
    selection: {
      type: 'storeGroup', id: 'group-1',
      accountIds: Array.from({ length: 101 }, (_, index) => 'account-' + index),
    },
  }, 'session-start-too-many');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'session-start-too-many' && message.ok === false && /最多选择 100/.test(message.message)
  )));
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidSelections);

  const importedAt = Date.now();
  const cloudRun = {
    schema: 2,
    runId: 'store-run-cloud-1',
    batchId: 'batch-cloud',
    taskType: 'both',
    runMode: 'batch',
    account: {
      id: 'account-cloud',
      name: '云端账号',
      platform: 'taobao',
      storeId: 'store-cloud',
      storeName: '云端店铺',
      usernameMasked: 'cl***d',
    },
    startedAt: importedAt - 1000,
    finishedAt: importedAt - 500,
    updatedAt: importedAt,
    xinghe: { state: 'ready', noPermission: false, unexpected: 'drop-me' },
    status: 'success',
    failures: [],
    snapshots: {
      businessDefenseManualInputsV1: { xhs_kolSpend: '1200' },
    },
  };
  send('importStoreRun', {
    runId: 'store-run-cloud-1',
    run: Object.assign({}, cloudRun, {
      account: Object.assign({}, cloudRun.account, { password: 'must-be-rejected' }),
    }),
  }, 'import-cloud-run-secret');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-cloud-run-secret' && message.ok === false && /敏感凭据/.test(message.message)
  )));

  send('importStoreRun', { runId: 'store-run-cloud-1', run: cloudRun }, 'import-cloud-run');
  await settle();
  const importedRun = storageState['taobaoStoreRunV1:store-run-cloud-1'];
  assert.equal(importedRun.runId, 'store-run-cloud-1');
  assert.equal(importedRun.account.storeName, '云端店铺');
  assert.equal(storageState.taobaoStoreRunIndexV1[0].runId, 'store-run-cloud-1');
  assert.ok(posted.some((message) => (
    message.requestId === 'import-cloud-run' && message.ok === true && message.data.imported === true
  )));

  send('importStoreRun', {
    runId: 'store-run-cloud-1',
    run: Object.assign({}, importedRun, {
      updatedAt: importedAt - 1,
      account: Object.assign({}, importedRun.account, { storeName: '过期云端店铺' }),
    }),
  }, 'import-stale-run');
  await settle();
  assert.equal(storageState['taobaoStoreRunV1:store-run-cloud-1'].account.storeName, '云端店铺');
  assert.ok(posted.some((message) => (
    message.requestId === 'import-stale-run' && message.ok === true &&
      message.data.imported === false && message.data.reason === 'local-newer-or-equal'
  )));

  send('importStoreRun', {
    runId: 'bad-run-id',
    run: { runId: 'bad-run-id' },
  }, 'import-invalid-run');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-invalid-run' && message.ok === false && /编号无效/.test(message.message)
  )));

  const oversizedRun = Object.assign({}, importedRun, {
    runId: 'store-run-cloud-too-large',
    snapshots: { gh_channel_snapshot: { raw: 'x'.repeat(24 * 1024 * 1024 + 1) } },
  });
  send('importStoreRun', {
    runId: oversizedRun.runId,
    run: oversizedRun,
  }, 'import-oversized-run');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-oversized-run' && message.ok === false && /安全限制/.test(message.message)
  )));

  assert.ok(posted.some((message) => message.requestId === 'start' && message.ok === false));
  assert.ok(posted.some((message) => message.requestId === 'report' && message.ok === false));
  console.log('web tool bridge guards passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
