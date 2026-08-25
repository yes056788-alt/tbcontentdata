const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const ACCOUNT_VAULT_SESSION_KEY = 'taobaoAccountVaultSessionV1';
const ACCOUNT_VAULT_LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';

function createHarness(initialState = {}) {
  const sessionState = JSON.parse(JSON.stringify(initialState.session || {}));
  const localState = JSON.parse(JSON.stringify(initialState.local || {}));
  const start = background.indexOf('function sanitizeAccountManagementSession');
  const end = background.indexOf('\nfunction accountSessionBatchAccount', start);
  assert.ok(start >= 0 && end > start, 'account session source block is missing');
  const context = vm.createContext({
    ACCOUNT_VAULT_SESSION_KEY,
    ACCOUNT_VAULT_LOCK_EPOCH_KEY,
    Array,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    String,
    chrome: {
      storage: {
        session: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter((key) => (
              Object.prototype.hasOwnProperty.call(sessionState, key)
            )).map((key) => [key, JSON.parse(JSON.stringify(sessionState[key]))]));
          },
          async set(value) {
            Object.assign(sessionState, JSON.parse(JSON.stringify(value)));
          },
          async remove(keys) {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete sessionState[key]);
          },
        },
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter((key) => (
              Object.prototype.hasOwnProperty.call(localState, key)
            )).map((key) => [key, JSON.parse(JSON.stringify(localState[key]))]));
          },
          async set(value) {
            Object.assign(localState, JSON.parse(JSON.stringify(value)));
          },
        },
      },
    },
    batchText(value, limit) {
      return String(value == null ? '' : value).trim().slice(0, Number(limit) || 160);
    },
    sanitizeAccountSessionVault(value) {
      return JSON.parse(JSON.stringify(value));
    },
  });
  vm.runInContext(
    'let accountSessionMutationQueue = Promise.resolve();\n' +
      'let projectTaskExecution = null;\n' +
      'let accountBatchPromise = null;\n' +
      'let accountBatchExecution = null;\n' +
      'let accountBatchCancelRequested = false;\n' +
      'function projectTaskCancellationError(message) { return new Error(message); }\n' +
      background.slice(start, end) + '\n' +
      'globalThis.setSession = setAccountManagementSession;\n' +
      'globalThis.lockSession = lockAccountManagementSession;\n' +
      'globalThis.readSession = readValidatedAccountSession;\n' +
      'globalThis.managementSession = accountManagementSession;\n' +
      'globalThis.seedTask = function(mode) {\n' +
      '  const signal = { aborted: false };\n' +
      '  projectTaskExecution = { credentialMode: mode, controller: { signal, abort() { signal.aborted = true; } } };\n' +
      '};\n' +
      'globalThis.seedBatch = function() {\n' +
      '  const signal = { aborted: false };\n' +
      '  accountBatchPromise = Promise.resolve();\n' +
      '  accountBatchExecution = { credentialMode: "vault", controller: { signal, abort() { signal.aborted = true; } } };\n' +
      '  accountBatchCancelRequested = false;\n' +
      '};\n' +
      'globalThis.revocationState = function() { return {\n' +
      '  projectAborted: Boolean(projectTaskExecution && projectTaskExecution.controller.signal.aborted),\n' +
      '  batchCancelled: accountBatchCancelRequested,\n' +
      '  batchAborted: Boolean(accountBatchExecution && accountBatchExecution.controller.signal.aborted)\n' +
      '}; };',
    context,
    { filename: 'account-vault-scope-session.js' },
  );
  return { context, sessionState, localState };
}

function sessionMessage(epoch) {
  return {
    vaultLockEpoch: epoch,
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultFingerprint: 'a'.repeat(64),
    vaultSessionKey: 'A'.repeat(43) + '=',
    vault: { schema: 4, stores: [], accounts: [] },
  };
}

test('a persisted local epoch can recover after browser session storage restarts empty', async () => {
  const harness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 5 } });
  await harness.context.setSession(sessionMessage(5));
  assert.equal(harness.localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY], 5);
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY].vaultScopeId,
    'team:https://tbdata.aizicheng.com');
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY].vaultLockEpoch, 5,
    'plaintext session must carry the canonical lock epoch');

  await assert.rejects(harness.context.setSession(sessionMessage(6)), /其他页面锁定/,
    '已有明文会话时不得用更大 epoch 覆盖');
});

test('management recovery requires the exact ciphertext fingerprint and preserves only the session key', async () => {
  const harness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 6 } });
  const initial = sessionMessage(6);
  await harness.context.setSession(initial);
  const session = await harness.context.readSession('team:https://tbdata.aizicheng.com');
  const recovered = harness.context.managementSession(
    session,
    'team:https://tbdata.aizicheng.com',
    initial.vaultFingerprint,
  );
  assert.equal(recovered.vaultSessionKey, initial.vaultSessionKey);
  assert.equal(recovered.masterPassword, undefined);
  assert.equal(harness.context.managementSession(
    session,
    'team:https://tbdata.aizicheng.com',
    'b'.repeat(64),
  ), null);

  const refreshed = sessionMessage(6);
  refreshed.vaultFingerprint = 'c'.repeat(64);
  delete refreshed.vaultSessionKey;
  await harness.context.setSession(refreshed);
  assert.equal(
    harness.sessionState[ACCOUNT_VAULT_SESSION_KEY].vaultSessionKey,
    initial.vaultSessionKey,
    're-encrypting with the same in-session key must not require the master password again',
  );
});

test('logout lock is serialized with session writes and stale writes cannot resurrect plaintext', async () => {
  const harness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 3 } });
  await harness.context.setSession(sessionMessage(3));

  const saveBeforeLock = harness.context.setSession(sessionMessage(3));
  const lockAfterSave = harness.context.lockSession(4);
  await Promise.all([saveBeforeLock, lockAfterSave]);
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY], undefined);
  assert.equal(harness.localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY], 4);

  const lockFirst = harness.context.lockSession(5);
  const staleSave = harness.context.setSession(sessionMessage(4));
  await lockFirst;
  await assert.rejects(staleSave, /其他页面锁定/);
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY], undefined);
  assert.equal(harness.localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY], 5);
});

test('a failed lock message still invalidates stale plaintext through the canonical local epoch', async () => {
  const harness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 8 } });
  await harness.context.setSession(sessionMessage(8));

  // The bridge persists epoch 9 before sending ACCOUNT_SESSION_LOCK. Simulate
  // the service worker/message failing before it can remove the old session.
  harness.localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY] = 9;
  await assert.rejects(
    harness.context.readSession('team:https://tbdata.aizicheng.com'),
    /锁定|失效|重新解锁/,
  );
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY], undefined,
    'a consumer must delete plaintext whose epoch no longer matches local canonical state');
});

test('validated session reads fail closed on a workspace mismatch', async () => {
  const harness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 2 } });
  await harness.context.setSession(sessionMessage(2));
  await assert.rejects(harness.context.readSession('local:tbcontentdata'), /其他工作区/);
  assert.equal(harness.sessionState[ACCOUNT_VAULT_SESSION_KEY], undefined);
});

test('lock revokes vault tasks and batches while leaving currentSession tasks alone', async () => {
  const vaultHarness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 1 } });
  vaultHarness.context.seedTask('vault');
  vaultHarness.context.seedBatch();
  await vaultHarness.context.lockSession(2);
  assert.deepEqual(JSON.parse(JSON.stringify(vaultHarness.context.revocationState())), {
    projectAborted: true,
    batchCancelled: true,
    batchAborted: true,
  });

  const currentHarness = createHarness({ local: { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 1 } });
  currentHarness.context.seedTask('currentSession');
  await currentHarness.context.lockSession(2);
  assert.equal(currentHarness.context.revocationState().projectAborted, false);
});
