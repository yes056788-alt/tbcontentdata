const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sourcePath = path.join(__dirname, '..', 'web-tool-bridge.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const messageListeners = [];
const posted = [];
const storageReads = [];
const storageWrites = [];
const storageRemovals = [];
const runtimeMessages = [];
const storageState = {};
let confirmResult = true;

const windowObject = {
  addEventListener(type, listener) {
    if (type === 'message') messageListeners.push(listener);
  },
  postMessage(message) {
    posted.push(message);
  },
  confirm() {
    return confirmResult;
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
      if (message.type === 'ACCOUNT_SESSION_GET_MANAGEMENT') {
        const current = runtimeMessages.findLast((item) => item.type === 'ACCOUNT_SESSION_SET');
        callback({
          ok: true,
          management: current ? {
            vaultScopeId: message.expectedVaultScopeId,
            vaultLockEpoch: current.vaultLockEpoch,
            vaultFingerprint: message.expectedVaultFingerprint,
            vaultSessionKey: current.vaultSessionKey,
            vault: current.vault,
            unlockedAt: Date.now(),
          } : null,
        });
        return;
      }
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
  atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
  btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
  chrome: chromeObject,
  console,
  crypto: webcrypto,
  document: {
    visibilityState: 'visible',
    hasFocus() { return true; },
  },
  location: { origin: 'http://127.0.0.1:3400', pathname: '/accounts.html' },
  TextEncoder,
  Uint8Array,
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
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function run() {
  assert.ok(posted.some((message) => (
    message.type === 'ready' &&
      message.version === '9.9.9' &&
      message.capabilities.includes('accountSessionUnlock') &&
      message.capabilities.includes('accountBatchMultiSelect') &&
      message.capabilities.includes('storeRunManualInputs') &&
      message.capabilities.includes('cloudSync') &&
      message.capabilities.includes('projectTaskCancel') &&
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
    credentialMode: 'vault',
    platforms: ['sycm', 'wxt'],
    store: { id: 'store-1', name: '一号店', groupId: 'group-1', groupName: '第一组' },
  }, 'project-task');
  await settle();
  const projectTaskMessage = runtimeMessages.find((message) => message.type === 'PROJECT_TASK_START');
  assert.equal(projectTaskMessage.payload.taskType, 'report');
  assert.deepEqual(Array.from(projectTaskMessage.payload.platforms), ['sycm', 'wxt']);
  assert.equal(projectTaskMessage.payload.credentialMode, 'vault');
  assert.equal(projectTaskMessage.payload.vaultScopeId, 'local:tbcontentdata');
  assert.equal(projectTaskMessage.payload.store.id, 'store-1');
  assert.ok(posted.some((message) => message.requestId === 'project-task' && message.ok === true));

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['juguang'],
    concurrentAccountTabs: 3,
    dateRange: { from: '2026-08-01', to: '2026-08-25' },
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-juguang-parallel');
  await settle();
  const concurrentJuguangTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(concurrentJuguangTaskMessage.payload.concurrentAccountTabs, 3,
    '聚光并发标签页设置应通过页面桥接层');

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['juguang'],
    concurrentAccountTabs: 4,
    dateRange: { from: '2026-08-01', to: '2026-08-25' },
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-juguang-invalid-parallel');
  await settle();
  const invalidConcurrentJuguangTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(invalidConcurrentJuguangTaskMessage.payload.concurrentAccountTabs, undefined,
    '聚光只允许显式启用 2 或 3 个并发标签页');

  const runtimeCountBeforeInvalidCredentialMode = runtimeMessages.length;
  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'legacy-default',
    platforms: ['sycm'],
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-invalid-credential-mode');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidCredentialMode);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-task-invalid-credential-mode' &&
      message.ok === false && /登录方式/.test(message.message)
  )));

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['sycm'],
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-current-session');
  await settle();
  const currentSessionTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(currentSessionTaskMessage.payload.credentialMode, 'currentSession');
  assert.equal(currentSessionTaskMessage.payload.vaultScopeId, undefined,
    '复用当前登录态不应依赖账号库工作区');

  context.location.pathname = '/accounts.html';
  const runtimeCountBeforeWrongPageCancel = runtimeMessages.length;
  send('cancelProjectTask', { taskId: 'project-task-safe-1' }, 'project-cancel-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-wrong-page' && message.ok === false && /\u4e00\u952e\u53d6\u6570/.test(message.message)
  )));

  context.location.pathname = '/report.html';
  context.document.visibilityState = 'hidden';
  send('cancelProjectTask', { taskId: 'project-task-safe-1' }, 'project-cancel-hidden-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-hidden-page' && message.ok === false && /\u53ef\u89c1/.test(message.message)
  )));
  context.document.visibilityState = 'visible';

  confirmResult = false;
  send('cancelProjectTask', {
    taskId: 'project-task-safe-1',
    confirmed: true,
    confirmedByExtension: true,
  }, 'project-cancel-forged-confirmation');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-forged-confirmation' && message.ok === true &&
      message.data && message.data.cancelled === false
  )));

  confirmResult = true;
  send('cancelProjectTask', {
    taskId: 'project-task-safe-1',
    confirmed: false,
    confirmedByExtension: false,
  }, 'project-cancel-confirmed');
  await settle();
  const projectCancelMessage = runtimeMessages.find((message) => message.type === 'PROJECT_TASK_CANCEL');
  assert.deepEqual(JSON.parse(JSON.stringify(projectCancelMessage)), {
    type: 'PROJECT_TASK_CANCEL',
    source: 'business-defense-web-tool',
    taskId: 'project-task-safe-1',
    confirmedByExtension: true,
  });
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-confirmed' && message.ok === true
  )));

  const runtimeCountBeforeInvalidTaskCancel = runtimeMessages.length;
  send('cancelProjectTask', { taskId: '../unsafe-task' }, 'project-cancel-invalid-task');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidTaskCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-invalid-task' && message.ok === false && /\u4efb\u52a1\u7f16\u53f7/.test(message.message)
  )));

  context.location.pathname = '/accounts.html';
  const vaultKey = 'taobaoAccountVaultV1';
  const vaultScopeKey = 'taobaoAccountVaultScopeV1';
  const vaultLockEpochKey = 'taobaoAccountVaultLockEpochV1';
  const legacyVaultKey = 'taobaoAccountVaultLegacyV1';
  const scopedVaultKey = (scopeId) => 'taobaoAccountVaultScopedV1:' + encodeURIComponent(scopeId);
  const localScopedVaultKey = scopedVaultKey('local:tbcontentdata');
  const teamScopedVaultKey = scopedVaultKey('team:https://tbdata.aizicheng.com');
  const scopedVault = (key) => storageState[key] && storageState[key].vault;
  const localQuarantineKey = 'taobaoAccountVaultQuarantineV1:' + encodeURIComponent('local:tbcontentdata');
  const teamQuarantineKey = 'taobaoAccountVaultQuarantineV1:' +
    encodeURIComponent('team:https://tbdata.aizicheng.com');
  const encryptedRecord = (data, updatedAt) => ({
    schema: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: 'QUJDRA==' },
    cipher: { name: 'AES-GCM', iv: 'RUZHSA==', data },
    updatedAt,
  });
  const legacyVault = encryptedRecord('TEVHQUNZ', 1893456000000);
  delete storageState[vaultScopeKey];
  storageState[vaultKey] = legacyVault;
  send('bindAccountVaultScope', { vaultScopeId: 'team:forged-by-page' }, 'bind-local-scope');
  await settle();
  const localBinding = posted.find((message) => message.requestId === 'bind-local-scope');
  assert.equal(localBinding.ok, true);
  assert.equal(localBinding.data.vaultScopeId, 'local:tbcontentdata');
  assert.equal(storageState[vaultScopeKey], 'local:tbcontentdata');
  assert.equal(storageState[vaultKey], undefined, '旧共享 active key 必须完成迁移后删除');
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, legacyVault.cipher.data);
  assert.equal(storageState[legacyVaultKey] && storageState[legacyVaultKey].cipher, undefined,
    '可信本地开发 scope 应直接认领旧本地密文，不创建无主隔离副本');

  const localVault = encryptedRecord('TE9DQUw=', 1893456001000);
  send('setAccountVault', {
    vault: localVault,
    vaultScopeId: 'team:forged-by-page',
    vaultLockEpoch: localBinding.data.vaultLockEpoch,
  }, 'set-local-vault');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data);
  const lockCountBeforeSameScope = runtimeMessages.filter((message) => (
    message.type === 'ACCOUNT_SESSION_LOCK'
  )).length;
  send('bindAccountVaultScope', {}, 'bind-local-scope-again');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '同团队/同 scope 重新绑定不得挪走密文');
  assert.equal(runtimeMessages.filter((message) => message.type === 'ACCOUNT_SESSION_LOCK').length,
    lockCountBeforeSameScope);

  send('lockAccountVault', {}, 'lock-team-vault');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '退出只清明文会话，团队密文必须保留');
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_LOCK'));

  context.location.origin = 'https://tbdata.aizicheng.com';
  send('bindAccountVaultScope', { vaultScopeId: 'local:forged' }, 'bind-team-scope');
  await settle();
  assert.equal(storageState[vaultScopeKey], 'team:https://tbdata.aizicheng.com');
  assert.equal(storageState[vaultKey], undefined);
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '生产团队站与本地开发 scope 必须以独立键隔离');
  send('getStorage', { keys: [vaultKey] }, 'read-team-before-vault');
  await settle();
  const emptyTeamRead = posted.find((message) => message.requestId === 'read-team-before-vault');
  assert.equal(emptyTeamRead.data[vaultKey], undefined,
    '生产页不得在任何 sidecar 交错下读到本地 scope 密文');
  const teamVault = encryptedRecord('VEVBTQ==', 1893456002000);
  send('setAccountVault', {
    vault: teamVault,
    vaultLockEpoch: storageState[vaultLockEpochKey],
  }, 'set-team-vault');
  await settle();
  assert.equal(scopedVault(teamScopedVaultKey).cipher.data, teamVault.cipher.data);
  context.location.origin = 'http://127.0.0.1:3400';
  send('bindAccountVaultScope', {}, 'restore-local-scope');
  await settle();
  assert.equal(storageState[vaultScopeKey], 'local:tbcontentdata');
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '切回原 scope 应恢复其隔离密文');
  assert.equal(scopedVault(teamScopedVaultKey).cipher.data, teamVault.cipher.data);

  // Simulate a stale team tab writing after the local tab has rebound. Its
  // scope-specific write may succeed, but the local logical read can only map
  // the local envelope and must never expose/upload the team record.
  context.location.origin = 'https://tbdata.aizicheng.com';
  storageState[vaultScopeKey] = 'team:https://tbdata.aizicheng.com';
  send('setAccountVault', {
    vault: encryptedRecord('VEVBTS1TVEFMRQ==', 1893456003000),
    vaultLockEpoch: storageState[vaultLockEpochKey],
  }, 'stale-team-write');
  await settle();
  context.location.origin = 'http://127.0.0.1:3400';
  send('getStorage', { keys: [vaultKey] }, 'read-local-after-stale-team-write');
  await settle();
  const isolatedRead = posted.find((message) => message.requestId === 'read-local-after-stale-team-write');
  assert.equal(isolatedRead.data[vaultKey].cipher.data, localVault.cipher.data,
    '跨 tab 交错保存不得串库');
  send('bindAccountVaultScope', {}, 'rebind-local-after-race');
  await settle();

  const bridgeUsernameSentinel = 'BRIDGE-USERNAME-SENTINEL';
  const bridgePasswordSentinel = 'BRIDGE-PASSWORD-SENTINEL';
  const masterPasswordSentinel = 'BRIDGE-MASTER-PASSWORD-SENTINEL';
  const vaultSessionKey = 'A'.repeat(43) + '=';
  send('setAccountSession', {
    vaultLockEpoch: storageState[vaultLockEpochKey],
    vaultSessionKey,
    masterPassword: masterPasswordSentinel,
    vault: {
      schema: 4,
      accountGroups: [],
      storeGroups: [{ id: 'group-1', name: '第一组', unexpected: 'drop-me' }],
      stores: [
        {
          id: 'store-1', name: '一号店', groupId: 'group-1',
          credentialBindings: { taobaoAccountId: 'account-1', xiaohongshuAccountId: 'account-xhs' },
        },
        {
          id: 'store-2', name: '二号店', groupId: '',
          credentialBindings: { taobaoAccountId: 'invalid-platform', xiaohongshuAccountId: '' },
        },
      ],
      accounts: [
        {
          id: 'account-1', label: '一号店淘宝主账号', platform: 'taobao', storeId: 'store-1',
          username: bridgeUsernameSentinel, password: bridgePasswordSentinel, enabled: true,
          unexpected: 'drop-me',
        },
        {
          id: 'account-xhs', label: '一号店小红书账号', platform: 'xiaohongshu', storeId: 'store-1',
          username: 'xhs-private-user', password: 'xhs-private-password', enabled: true,
        },
        {
          id: 'invalid-platform', label: '非法平台账号', platform: 'Taobao', storeId: 'store-2',
          username: 'invalid-user', password: 'invalid-password', enabled: true,
        },
        {
          id: 'missing-platform', label: '缺失平台账号', storeId: 'store-2',
          username: 'missing-user', password: 'missing-password', enabled: true,
        },
      ],
      notification: {},
      unexpected: 'drop-me',
    },
  }, 'session-set');
  await settle();
  const sessionSetMessage = runtimeMessages.find((message) => message.type === 'ACCOUNT_SESSION_SET');
  assert.ok(sessionSetMessage, JSON.stringify(posted.find((message) => message.requestId === 'session-set')));
  assert.equal(sessionSetMessage.vaultScopeId, 'local:tbcontentdata');
  assert.equal(sessionSetMessage.vault.schema, 4);
  assert.equal(sessionSetMessage.vault.accounts[0].username, bridgeUsernameSentinel);
  assert.equal(sessionSetMessage.vault.accounts[0].password, bridgePasswordSentinel);
  assert.equal(sessionSetMessage.vault.accounts[0].label, '一号店淘宝主账号');
  assert.doesNotMatch(sessionSetMessage.vault.accounts[0].label, /BRIDGE-(?:USERNAME|PASSWORD)-SENTINEL/);
  assert.deepEqual(Array.from(sessionSetMessage.vault.accounts, (account) => account.id), [
    'account-1', 'account-xhs',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sessionSetMessage.vault.stores[0].credentialBindings)), {
    taobaoAccountId: 'account-1',
    xiaohongshuAccountId: 'account-xhs',
  });
  assert.equal(sessionSetMessage.vault.stores[1].credentialBindings.taobaoAccountId, '');
  assert.equal(sessionSetMessage.vault.accounts[0].unexpected, undefined);
  assert.equal(sessionSetMessage.vault.unexpected, undefined);
  assert.equal(sessionSetMessage.vaultSessionKey, vaultSessionKey);
  assert.match(sessionSetMessage.vaultFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(sessionSetMessage.masterPassword, undefined);
  assert.doesNotMatch(JSON.stringify(sessionSetMessage), /BRIDGE-MASTER-PASSWORD-SENTINEL/);

  context.location.pathname = '/report.html';
  const runtimeCountBeforeWrongPageSessionSet = runtimeMessages.length;
  send('setAccountSession', {
    vault: {
      schema: 4,
      stores: [{
        id: 'store-1', name: '一号店',
        credentialBindings: { taobaoAccountId: '', xiaohongshuAccountId: '' },
      }],
      accounts: [],
    },
  }, 'session-set-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageSessionSet);
  assert.ok(posted.some((message) => (
    message.requestId === 'session-set-wrong-page' && message.ok === false && /账号库管理/.test(message.message)
  )));

  context.location.pathname = '/accounts.html';

  send('getAccountSessionSummary', {}, 'session-summary');
  await settle();
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_GET_SUMMARY'));
  const runtimeCountBeforeManagementRecovery = runtimeMessages.length;
  send('getAccountManagementSession', {}, 'session-management');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeManagementRecovery + 1);
  assert.equal(runtimeMessages.at(-1).type, 'ACCOUNT_SESSION_GET_MANAGEMENT');
  const managementResponse = posted.find((message) => message.requestId === 'session-management');
  assert.equal(managementResponse.ok, true);
  assert.equal(managementResponse.data.unlocked, true);
  assert.equal(managementResponse.data.vault.accounts[0].password, bridgePasswordSentinel);
  assert.equal(JSON.stringify(managementResponse).includes(vaultSessionKey), false,
    '会话加密密钥只能留在扩展隔离环境，不得回传网页上下文');

  send('encryptAccountVaultFromSession', {
    vaultLockEpoch: storageState[vaultLockEpochKey],
    vault: sessionSetMessage.vault,
  }, 'session-encrypt');
  await settle();
  const encryptedSessionResponse = posted.find((message) => message.requestId === 'session-encrypt');
  assert.equal(encryptedSessionResponse.ok, true);
  assert.equal(encryptedSessionResponse.data.vault.schema, 1);
  assert.notEqual(
    encryptedSessionResponse.data.vault.cipher.data,
    scopedVault(localScopedVaultKey).cipher.data,
  );
  assert.equal(JSON.stringify(encryptedSessionResponse).includes(vaultSessionKey), false);
  assert.doesNotMatch(
    JSON.stringify(encryptedSessionResponse),
    /BRIDGE-(?:USERNAME|PASSWORD)-SENTINEL/,
  );

  context.location.pathname = '/report.html';
  const runtimeCountBeforeWrongPageManagementRecovery = runtimeMessages.length;
  send('getAccountManagementSession', {}, 'session-management-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageManagementRecovery);
  assert.ok(posted.some((message) => (
    message.requestId === 'session-management-wrong-page' && message.ok === false &&
      /账号库管理/.test(message.message)
  )));
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
  assert.equal(sessionStartMessage.payload.vaultScopeId, 'local:tbcontentdata');
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
  const archiveSecretSentinel = 'ARCHIVE-PLAINTEXT-SENTINEL';
  send('importStoreRun', {
    runId: 'store-run-cloud-1',
    run: Object.assign({}, cloudRun, {
      account: Object.assign({}, cloudRun.account, { password: archiveSecretSentinel }),
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
  assert.doesNotMatch(JSON.stringify({
    run: storageState['taobaoStoreRunV1:store-run-cloud-1'],
    index: storageState.taobaoStoreRunIndexV1,
  }), /ARCHIVE-PLAINTEXT-SENTINEL/);
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
