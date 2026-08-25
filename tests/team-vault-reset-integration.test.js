const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const bridgePath = path.join(root, 'web-tool-bridge.js');
const cloudPath = path.join(root, 'web-tool', 'cloud-sync.js');
const accountsPath = path.join(root, 'web-tool', 'accounts.js');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const cloudSource = fs.readFileSync(cloudPath, 'utf8');
const accountsSource = fs.readFileSync(accountsPath, 'utf8');

const ORIGIN = 'https://tbdata.aizicheng.com';
const TEAM_SCOPE = 'team:https://tbdata.aizicheng.com';
const SCOPE_KEY = 'taobaoAccountVaultScopeV1';
const LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';
const LOGICAL_VAULT_KEY = 'taobaoAccountVaultV1';
const TEAM_SCOPED_KEY = 'taobaoAccountVaultScopedV1:' + encodeURIComponent(TEAM_SCOPE);
const TEAM_REMOTE_STATE_KEY = 'taobaoAccountVaultRemoteStateV1:' + encodeURIComponent(TEAM_SCOPE);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function vault(updatedAt, data = 'SUpLTA==') {
  return {
    schema: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 310000,
      salt: 'QUJDRA==',
    },
    cipher: {
      name: 'AES-GCM',
      iv: 'RUZHSA==',
      data,
    },
    updatedAt,
  };
}

function activeVaultGetResponse(value, revision) {
  return {
    vault: clone(value),
    deleted: false,
    tombstone: false,
    revision,
    updatedAt: '2026-08-21T08:00:00.000Z',
  };
}

function tombstoneVaultGetResponse(revision) {
  return {
    vault: null,
    deleted: true,
    tombstone: true,
    revision,
    updatedAt: '2026-08-21T08:05:00.000Z',
  };
}

function emptyVaultGetResponse() {
  return {
    vault: null,
    deleted: false,
    tombstone: false,
    revision: 0,
    updatedAt: null,
  };
}

function jsonResponse(body, status = 200) {
  const serialized = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-length'
          ? String(Buffer.byteLength(serialized))
          : null;
      },
    },
    async text() { return serialized; },
  };
}

function fixtureElement() {
  const listeners = new Map();
  let html = '';
  const element = {
    checked: false,
    className: '',
    dataset: {},
    hidden: false,
    open: false,
    options: [{ value: '' }],
    placeholder: '',
    required: false,
    textContent: '',
    type: 'text',
    value: '',
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async emit(type, event = {}) {
      const values = listeners.get(type) || [];
      return Promise.all(values.map((listener) => listener(Object.assign({
        currentTarget: element,
        preventDefault() {},
        target: element,
      }, event))));
    },
    close() { element.open = false; },
    closest() { return null; },
    focus() {},
    reset() { element.value = ''; },
    showModal() { element.open = true; },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return html; },
    set(value) {
      html = String(value || '');
      const options = [];
      const pattern = /<option\b[^>]*value=["']([^"']*)["'][^>]*>/gi;
      let match;
      while ((match = pattern.exec(html))) options.push({ value: match[1] });
      if (options.length) element.options = options;
    },
  });
  return element;
}

function instrumentAccountsSource() {
  const marker = '\n  showLocked();';
  const index = accountsSource.lastIndexOf(marker);
  assert.ok(index > 0, 'accounts.js state probe insertion point is missing');
  return accountsSource.slice(0, index) + `
  window.__teamVaultResetTest = {
    state() {
      return {
        encryptedVault,
        masterPassword,
        vaultData,
        vaultLockEpoch,
        vaultClearing,
      };
    },
  };
` + accountsSource.slice(index);
}

function createHarness(options = {}) {
  const revision = Number(options.revision) || 9;
  const initialVault = options.localVault || null;
  const initialLockEpoch = Number.isSafeInteger(Number(options.initialLockEpoch))
    ? Number(options.initialLockEpoch)
    : 7;
  const elements = new Map();
  const eventListeners = new Map();
  const storageListeners = [];
  const storage = {
    [SCOPE_KEY]: TEAM_SCOPE,
    [LOCK_EPOCH_KEY]: initialLockEpoch,
  };
  if (initialVault) {
    const scopedEnvelope = {
      schema: 1,
      vaultScopeId: TEAM_SCOPE,
      vault: clone(initialVault),
    };
    if (Number.isSafeInteger(Number(options.localRemoteRevision)) &&
        Number(options.localRemoteRevision) >= 1) {
      scopedEnvelope.remoteRevision = Number(options.localRemoteRevision);
    }
    if (Number.isSafeInteger(Number(options.localVaultLockEpoch)) &&
        Number(options.localVaultLockEpoch) >= 0) {
      scopedEnvelope.vaultLockEpoch = Number(options.localVaultLockEpoch);
    }
    storage[TEAM_SCOPED_KEY] = scopedEnvelope;
  }
  if (options.remoteState) storage[TEAM_REMOTE_STATE_KEY] = clone(options.remoteState);

  let remoteEnvelope = clone(options.remoteEnvelope || (
    initialVault ? activeVaultGetResponse(initialVault, revision) : emptyVaultGetResponse()
  ));
  let deleteResponseLost = false;
  let putResponseLost = false;
  const bridgeRequests = [];
  const httpCalls = [];
  const runtimeMessages = [];
  const runtimeErrors = [];
  const timeline = [];
  const pendingPageRequests = new Map();
  const background = {
    lockEpoch: initialLockEpoch,
    plaintext: options.initialPlaintext || null,
    vaultFingerprint: '',
    vaultSessionKey: '',
  };

  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, fixtureElement());
    return elements.get(selector);
  };

  const windowObject = {
    confirm() { return true; },
    prompt() { return null; },
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) eventListeners.set(type, []);
      eventListeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      (eventListeners.get(event.type) || []).slice().forEach((listener) => listener(event));
    },
    postMessage(message, targetOrigin) {
      assert.equal(targetOrigin, ORIGIN);
      if (message && message.type === 'request') {
        bridgeRequests.push(clone(message));
        timeline.push('bridge:' + message.action);
      }
      queueMicrotask(() => {
        const event = { source: windowObject, origin: ORIGIN, data: message };
        (eventListeners.get('message') || []).slice().forEach((listener) => listener(event));
      });
    },
    TaobaoAccountVault: {
      async encryptForSession() {
        if (!options.createdVault) throw new Error('unexpected account-vault encryption');
        return {
          record: clone(options.createdVault),
          sessionKey: 'A'.repeat(43) + '=',
        };
      },
      async open() {
        return {
          value: clone(options.decryptedVault || {
            schema: 4,
            accountGroups: [],
            storeGroups: [],
            stores: [],
            accounts: [],
            notification: { webhook: '', secret: '' },
            updatedAt: '2026-08-21T08:00:00.000Z',
          }),
          sessionKey: 'A'.repeat(43) + '=',
        };
      },
    },
  };
  windowObject.top = windowObject;
  windowObject.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  };

  function storageKeys(keys) {
    if (keys == null) return Object.keys(storage);
    if (Array.isArray(keys)) return keys;
    if (typeof keys === 'string') return [keys];
    return Object.keys(keys);
  }

  const localStorage = {
    async get(keys) {
      return Object.fromEntries(storageKeys(keys).filter((key) => (
        Object.prototype.hasOwnProperty.call(storage, key)
      )).map((key) => [key, clone(storage[key])]));
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values || {})) {
        changes[key] = { oldValue: clone(storage[key]), newValue: clone(value) };
        storage[key] = clone(value);
        timeline.push('storage:set:' + key);
      }
      queueMicrotask(() => {
        storageListeners.slice().forEach((listener) => listener(clone(changes), 'local'));
      });
    },
    async remove(keys) {
      const changes = {};
      for (const key of storageKeys(keys)) {
        if (!Object.prototype.hasOwnProperty.call(storage, key)) continue;
        changes[key] = { oldValue: clone(storage[key]) };
        delete storage[key];
        timeline.push('storage:remove:' + key);
      }
      queueMicrotask(() => {
        storageListeners.slice().forEach((listener) => listener(clone(changes), 'local'));
      });
    },
  };

  const chromeObject = {
    runtime: {
      lastError: null,
      getManifest() { return { version: '9.9.9-reset-red' }; },
      sendMessage(message, callback) {
        runtimeMessages.push(clone(message));
        timeline.push('runtime:' + message.type);
        queueMicrotask(() => {
          try {
            assert.equal(message.source, 'business-defense-web-tool');
            if (message.type === 'ACCOUNT_SESSION_LOCK') {
              assert.ok(Number.isSafeInteger(message.vaultLockEpoch));
              assert.ok(message.vaultLockEpoch > background.lockEpoch);
              if (options.failRuntimeLock) {
                callback({ ok: false, message: 'simulated background lock failure' });
                return;
              }
              background.lockEpoch = message.vaultLockEpoch;
              background.plaintext = null;
              background.vaultFingerprint = '';
              background.vaultSessionKey = '';
              callback({ ok: true, locked: true, vaultLockEpoch: background.lockEpoch });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_SET') {
              assert.equal(message.vaultScopeId, TEAM_SCOPE);
              assert.equal(message.vaultLockEpoch, background.lockEpoch);
              background.plaintext = clone(message.vault);
              background.vaultFingerprint = message.vaultFingerprint;
              background.vaultSessionKey = message.vaultSessionKey || background.vaultSessionKey;
              callback({ ok: true, unlocked: true, vaultScopeId: TEAM_SCOPE });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_GET_MANAGEMENT') {
              assert.equal(message.expectedVaultScopeId, TEAM_SCOPE);
              const valid = background.plaintext && background.vaultSessionKey &&
                background.vaultFingerprint === message.expectedVaultFingerprint;
              callback({
                ok: true,
                management: valid ? {
                  vaultScopeId: TEAM_SCOPE,
                  vaultLockEpoch: background.lockEpoch,
                  vaultFingerprint: background.vaultFingerprint,
                  vaultSessionKey: background.vaultSessionKey,
                  vault: clone(background.plaintext),
                  unlockedAt: Date.now(),
                } : null,
              });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_GET_SUMMARY') {
              assert.equal(message.expectedVaultScopeId, TEAM_SCOPE);
              callback({
                ok: true,
                unlocked: Boolean(background.plaintext),
                vaultScopeId: TEAM_SCOPE,
              });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_CLEAR') {
              background.plaintext = null;
              background.vaultFingerprint = '';
              background.vaultSessionKey = '';
              callback({ ok: true, cleared: true });
              return;
            }
            throw new Error('unexpected runtime message: ' + message.type);
          } catch (error) {
            runtimeErrors.push(error);
            callback({ ok: false, message: error.message });
          }
        });
      },
    },
    storage: {
      local: localStorage,
      onChanged: {
        addListener(listener) { storageListeners.push(listener); },
      },
    },
  };

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    let body = null;
    if (init.body) body = JSON.parse(init.body);
    const call = { method, pathname: url.pathname, body };
    httpCalls.push(call);
    timeline.push('http:' + method + ':' + url.pathname);

    if (url.pathname === '/api/session' && method === 'GET') {
      return jsonResponse({ role: 'owner', user: { id: 'vault-owner' } });
    }
    if (url.pathname === '/api/vault' && method === 'GET') {
      return jsonResponse(clone(remoteEnvelope));
    }
    if (url.pathname === '/api/vault' && method === 'DELETE') {
      if (Number(options.deleteStatus) === 409) {
        return jsonResponse({
          error: { message: '账号库已被其他成员更新，请刷新后重试。' },
        }, 409);
      }
      const previousRevision = Number(remoteEnvelope.revision) || 0;
      const alreadyDeleted = remoteEnvelope.deleted === true;
      if (!alreadyDeleted) remoteEnvelope = tombstoneVaultGetResponse(previousRevision + 1);
      const deleteResult = {
        deleted: true,
        alreadyDeleted,
        previousRevision: alreadyDeleted ? null : previousRevision,
        revision: remoteEnvelope.revision,
      };
      if (options.loseDeleteResponse && !deleteResponseLost) {
        deleteResponseLost = true;
        throw new TypeError('simulated DELETE response loss after commit');
      }
      return jsonResponse(deleteResult);
    }
    if (url.pathname === '/api/vault' && method === 'PUT') {
      const nextRevision = (Number(remoteEnvelope.revision) || 0) + 1;
      remoteEnvelope = activeVaultGetResponse(body && body.vault, nextRevision);
      const putResult = {
        vault: clone(body && body.vault),
        revision: nextRevision,
        updatedAt: remoteEnvelope.updatedAt,
      };
      if (options.losePutResponse && !putResponseLost) {
        putResponseLost = true;
        throw new TypeError('simulated PUT response loss after commit');
      }
      return jsonResponse(putResult);
    }
    if (url.pathname === '/api/directory' && method === 'GET') {
      return jsonResponse({ directory: null, revision: 0 });
    }
    if (url.pathname === '/api/directory' && method === 'PUT') {
      return jsonResponse({ directory: body && body.directory, revision: 1 });
    }
    if (url.pathname === '/api/runs' && method === 'GET') {
      return jsonResponse({ runs: [] });
    }
    return jsonResponse({ error: { message: method + ' ' + url.pathname + ' is unexpected' } }, 500);
  }

  const location = {
    origin: ORIGIN,
    hostname: 'tbdata.aizicheng.com',
    pathname: '/accounts.html',
  };
  const context = vm.createContext({
    Array,
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextEncoder,
    Uint8Array,
    URL,
    chrome: chromeObject,
    clearTimeout,
    console,
    crypto: webcrypto,
    document: { querySelector: element, visibilityState: 'visible', hasFocus() { return true; } },
    fetch,
    location,
    queueMicrotask,
    setTimeout,
    window: windowObject,
  });

  windowObject.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'response' || !pendingPageRequests.has(message.requestId)) return;
    const pending = pendingPageRequests.get(message.requestId);
    pendingPageRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.message || 'bridge request failed'));
  });

  let requestSequence = 0;
  function pageRequest(action, payload) {
    requestSequence += 1;
    const requestId = 'reset-test-page-' + requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingPageRequests.delete(requestId);
        reject(new Error('bridge response timeout: ' + action));
      }, 2000);
      pendingPageRequests.set(requestId, { resolve, reject, timer });
      windowObject.postMessage({
        channel: 'taobao-full-chain-tool-v1',
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      }, ORIGIN);
    });
  }

  vm.runInContext(bridgeSource, context, { filename: bridgePath });
  if (options.loadCloud !== false) {
    vm.runInContext(cloudSource, context, { filename: cloudPath });
  }
  if (options.loadAccounts) {
    vm.runInContext(instrumentAccountsSource(), context, { filename: accountsPath });
  }

  async function waitFor(predicate, message) {
    const deadline = Date.now() + 1500;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(message || 'condition was not reached');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function waitForAccounts() {
    if (!windowObject.TaobaoCloudSync) throw new Error('accounts harness requires cloud-sync');
    await windowObject.TaobaoCloudSync.ready;
    await waitFor(() => (
      windowObject.__teamVaultResetTest &&
      element('#connectionState').textContent === '数据助手已连接' &&
      (!initialVault || Boolean(windowObject.__teamVaultResetTest.state().encryptedVault))
    ), 'accounts page did not finish connecting');
  }

  return {
    background,
    bridgeRequests,
    element,
    elements,
    httpCalls,
    pageRequest,
    runtimeErrors,
    runtimeMessages,
    storage,
    timeline,
    waitForAccounts,
    windowObject,
    accountState() {
      return clone(windowObject.__teamVaultResetTest && windowObject.__teamVaultResetTest.state());
    },
    stop() {
      if (windowObject.TaobaoCloudSync) windowObject.TaobaoCloudSync.stop();
    },
  };
}

test('a server tombstone deletes an older-computer team ciphertext, locks plaintext, and never uploads it', async (t) => {
  const localVault = vault(Date.UTC(2026, 7, 21, 10, 0, 0), 'T0xELVZB');
  const harness = createHarness({
    localVault,
    initialPlaintext: { schema: 4, accounts: [{ username: 'must-be-locked' }] },
    revision: 14,
    remoteEnvelope: tombstoneVaultGetResponse(14),
  });
  t.after(() => harness.stop());

  const ready = await harness.windowObject.TaobaoCloudSync.ready;
  assert.equal(ready.ok, true, ready.message);
  await harness.windowObject.TaobaoCloudSync.syncNow();

  assert.equal(harness.httpCalls.some((call) => (
    call.method === 'PUT' && call.pathname === '/api/vault'
  )), false, 'ordinary sync must never resurrect a tombstoned vault, even when local is newer');
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, TEAM_SCOPED_KEY), false,
    'the real trusted bridge must remove the current team-scoped ciphertext');
  assert.equal(harness.background.plaintext, null,
    'the tombstone action must lock the background plaintext session');
  assert.ok(harness.bridgeRequests.some((message) => message.action === 'applyAccountVaultTombstone'));
  assert.ok(harness.runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_LOCK'));
  assert.deepEqual(harness.runtimeErrors, []);

  const logical = await harness.pageRequest('getStorage', { keys: [LOGICAL_VAULT_KEY] });
  assert.equal(logical[LOGICAL_VAULT_KEY], undefined);
});

test('cloud sync exposes only explicit account-vault deletion and recreation mutations', async (t) => {
  const harness = createHarness({
    remoteEnvelope: tombstoneVaultGetResponse(4),
    revision: 4,
  });
  t.after(() => harness.stop());
  await harness.windowObject.TaobaoCloudSync.ready;
  assert.deepEqual({
    deleteAccountVault: typeof harness.windowObject.TaobaoCloudSync.deleteAccountVault,
    recreateAccountVault: typeof harness.windowObject.TaobaoCloudSync.recreateAccountVault,
  }, {
    deleteAccountVault: 'function',
    recreateAccountVault: 'function',
  });
});

test('accounts reset waits for DELETE with the known revision before clearing local and in-memory vaults', async (t) => {
  const existingVault = vault(Date.UTC(2026, 7, 21, 8, 0, 0));
  const harness = createHarness({
    localVault: existingVault,
    loadAccounts: true,
    revision: 22,
    remoteEnvelope: activeVaultGetResponse(existingVault, 22),
  });
  t.after(() => harness.stop());
  await harness.waitForAccounts();
  const traceStart = harness.timeline.length;

  await harness.element('#resetVaultBtn').emit('click');

  const resetTrace = harness.timeline.slice(traceStart);
  const deleteIndex = resetTrace.indexOf('http:DELETE:/api/vault');
  const localDeleteIndex = resetTrace.indexOf('bridge:applyAccountVaultTombstone');
  assert.ok(deleteIndex >= 0, 'reset must DELETE the cloud vault');
  assert.ok(localDeleteIndex > deleteIndex,
    'trusted local deletion/lock must occur only after DELETE succeeds');
  const deleteCall = harness.httpCalls.find((call) => (
    call.method === 'DELETE' && call.pathname === '/api/vault'
  ));
  assert.deepEqual(deleteCall.body, { expectedRevision: 22 });
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, TEAM_SCOPED_KEY), false);
  assert.equal(harness.accountState().encryptedVault, null);
  assert.equal(harness.accountState().masterPassword, '');
  assert.equal(harness.accountState().vaultData, null);
  assert.equal(harness.element('#pageNotice').dataset.tone, 'success');
});

test('accounts reset keeps encrypted and unlocked memory intact when DELETE returns 409', async (t) => {
  const existingVault = vault(Date.UTC(2026, 7, 21, 8, 0, 0));
  const harness = createHarness({
    deleteStatus: 409,
    localVault: existingVault,
    loadAccounts: true,
    revision: 31,
    remoteEnvelope: activeVaultGetResponse(existingVault, 31),
  });
  t.after(() => harness.stop());
  await harness.waitForAccounts();

  harness.element('#masterPassword').value = 'correct-master-password';
  await harness.element('#vaultForm').emit('submit');
  const beforeReset = harness.accountState();
  assert.ok(beforeReset.encryptedVault);
  assert.equal(beforeReset.masterPassword, 'correct-master-password');
  assert.ok(beforeReset.vaultData);
  const traceStart = harness.timeline.length;

  await harness.element('#resetVaultBtn').emit('click');

  const resetTrace = harness.timeline.slice(traceStart);
  assert.ok(resetTrace.includes('http:DELETE:/api/vault'));
  assert.equal(resetTrace.includes('bridge:applyAccountVaultTombstone'), false,
    'a 409 response must not invoke trusted local deletion');
  assert.ok(harness.storage[TEAM_SCOPED_KEY]);
  const afterReset = harness.accountState();
  assert.ok(afterReset.encryptedVault);
  assert.equal(afterReset.masterPassword, 'correct-master-password');
  assert.ok(afterReset.vaultData);
  assert.equal(harness.element('#pageNotice').dataset.tone, 'error');
  assert.match(harness.element('#pageNotice').textContent, /冲突|更新|刷新|重试/);
});

test('only explicit vault creation can recreate a tombstone and its PUT carries recreate true', async (t) => {
  const createdVault = vault(Date.UTC(2026, 7, 21, 12, 0, 0), 'TkVXLVZB');
  const harness = createHarness({
    createdVault,
    loadAccounts: true,
    revision: 40,
    remoteEnvelope: tombstoneVaultGetResponse(40),
  });
  t.after(() => harness.stop());
  await harness.waitForAccounts();

  assert.equal(harness.httpCalls.some((call) => (
    call.method === 'PUT' && call.pathname === '/api/vault'
  )), false, 'ordinary sync must not add recreate or PUT across a tombstone');

  harness.element('#masterPassword').value = 'new-master-password';
  harness.element('#confirmPassword').value = 'new-master-password';
  await harness.element('#vaultForm').emit('submit');

  const vaultPuts = harness.httpCalls.filter((call) => (
    call.method === 'PUT' && call.pathname === '/api/vault'
  ));
  assert.equal(vaultPuts.length, 1, 'explicit creation must perform exactly one recreate PUT');
  assert.deepEqual(vaultPuts[0].body, {
    vault: createdVault,
    expectedRevision: 40,
    recreate: true,
  });
});

test('a persisted tombstone marker blocks stale ciphertext and plaintext writes after a bridge reload', async (t) => {
  const staleVault = vault(Date.UTC(2026, 7, 21, 7, 0, 0), 'U1RBTEU=');
  const harness = createHarness({
    loadCloud: false,
    localVault: staleVault,
    remoteState: {
      schema: 1,
      vaultScopeId: TEAM_SCOPE,
      revision: 51,
      deleted: true,
      vaultLockEpoch: 7,
    },
  });
  t.after(() => harness.stop());

  const logical = await harness.pageRequest('getStorage', { keys: [LOGICAL_VAULT_KEY] });
  assert.equal(logical[LOGICAL_VAULT_KEY], undefined,
    'a reloaded bridge must keep tombstoned ciphertext logically inaccessible');
  await assert.rejects(harness.pageRequest('setAccountVault', {
    vault: vault(Date.UTC(2026, 7, 21, 7, 30, 0), 'UkVWSVZF'),
    vaultLockEpoch: 7,
  }), /删除|重建|过期/);
  await assert.rejects(harness.pageRequest('setAccountSession', {
    vault: { schema: 4, accountGroups: [], storeGroups: [], stores: [], accounts: [] },
    vaultLockEpoch: 7,
  }), /删除|旧的明文会话|恢复/);

  assert.deepEqual(clone(harness.storage[TEAM_REMOTE_STATE_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    revision: 51,
    deleted: true,
    vaultLockEpoch: 7,
  });
  assert.equal(harness.storage[TEAM_SCOPED_KEY].vault.cipher.data, staleVault.cipher.data,
    'rejected writes must not overwrite the quarantined stale ciphertext');
  assert.equal(harness.runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_SET'), false);
});

test('a delayed tombstone revision cannot clear a server-confirmed active revision one step newer', async (t) => {
  const confirmedVault = vault(Date.UTC(2026, 7, 21, 13, 0, 0), 'TkVXRVNU');
  const harness = createHarness({
    initialLockEpoch: 8,
    localVault: confirmedVault,
    localRemoteRevision: 62,
    localVaultLockEpoch: 8,
    remoteEnvelope: tombstoneVaultGetResponse(61),
    remoteState: {
      schema: 1,
      vaultScopeId: TEAM_SCOPE,
      revision: 61,
      deleted: true,
      vaultLockEpoch: 8,
    },
  });
  t.after(() => harness.stop());

  const ready = await harness.windowObject.TaobaoCloudSync.ready;
  assert.equal(ready.ok, false, 'the delayed response should force a fresh sync instead of applying');
  assert.match(ready.message, /更新版本|重新同步/);
  assert.deepEqual(clone(harness.storage[TEAM_REMOTE_STATE_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    revision: 61,
    deleted: true,
    vaultLockEpoch: 8,
  });
  assert.equal(harness.storage[TEAM_SCOPED_KEY].vault.cipher.data, confirmedVault.cipher.data);
  assert.equal(harness.runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_LOCK'), false,
    'a stale tombstone must not lock the confirmed active session');
  assert.equal(harness.httpCalls.some((call) => call.method === 'PUT'), false);
});

test('DELETE response loss reconciles with GET and completes the durable tombstone locally', async (t) => {
  const existingVault = vault(Date.UTC(2026, 7, 21, 14, 0, 0), 'REVMRVRF');
  const harness = createHarness({
    localVault: existingVault,
    loseDeleteResponse: true,
    remoteEnvelope: activeVaultGetResponse(existingVault, 70),
  });
  t.after(() => harness.stop());
  await harness.windowObject.TaobaoCloudSync.ready;
  const callStart = harness.httpCalls.length;

  const result = await harness.windowObject.TaobaoCloudSync.deleteAccountVault();

  assert.equal(result.deleted, true);
  assert.equal(result.revision, 71);
  assert.deepEqual(harness.httpCalls.slice(callStart).map((call) => (
    call.method + ' ' + call.pathname
  )), [
    'GET /api/session',
    'GET /api/vault',
    'DELETE /api/vault',
    'GET /api/vault',
  ]);
  assert.deepEqual(harness.httpCalls.find((call) => call.method === 'DELETE').body, {
    expectedRevision: 70,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, TEAM_SCOPED_KEY), false);
  assert.deepEqual(clone(harness.storage[TEAM_REMOTE_STATE_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    revision: 71,
    deleted: true,
    vaultLockEpoch: 8,
  });
  assert.equal(harness.httpCalls.some((call) => call.method === 'PUT'), false);
});

test('recreate PUT response loss reconciles with GET before installing the confirmed active revision', async (t) => {
  const recreatedVault = vault(Date.UTC(2026, 7, 21, 15, 0, 0), 'UFVULU9L');
  const harness = createHarness({
    losePutResponse: true,
    remoteEnvelope: tombstoneVaultGetResponse(80),
  });
  t.after(() => harness.stop());
  await harness.windowObject.TaobaoCloudSync.ready;
  const callStart = harness.httpCalls.length;

  const result = await harness.windowObject.TaobaoCloudSync.recreateAccountVault(recreatedVault);

  assert.equal(result.recreated, true);
  assert.equal(result.revision, 81);
  assert.deepEqual(harness.httpCalls.slice(callStart).map((call) => (
    call.method + ' ' + call.pathname
  )), [
    'GET /api/session',
    'GET /api/vault',
    'PUT /api/vault',
    'GET /api/vault',
  ]);
  const putCall = harness.httpCalls.find((call) => call.method === 'PUT');
  assert.deepEqual(putCall.body, {
    vault: recreatedVault,
    expectedRevision: 80,
    recreate: true,
  });
  assert.equal(harness.storage[TEAM_SCOPED_KEY].vault.cipher.data, recreatedVault.cipher.data);
  assert.deepEqual(clone(harness.storage[TEAM_REMOTE_STATE_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    revision: 80,
    deleted: true,
    vaultLockEpoch: 8,
  });
  assert.equal(harness.storage[TEAM_SCOPED_KEY].remoteRevision, 81);
  assert.equal(harness.storage[TEAM_SCOPED_KEY].vaultLockEpoch, 8);
});

test('accounts memory locks when DELETE commits but the bridge tombstone apply fails', async (t) => {
  const existingVault = vault(Date.UTC(2026, 7, 21, 16, 0, 0), 'TE9DS0VE');
  const harness = createHarness({
    failRuntimeLock: true,
    localVault: existingVault,
    loadAccounts: true,
    remoteEnvelope: activeVaultGetResponse(existingVault, 90),
  });
  t.after(() => harness.stop());
  await harness.waitForAccounts();

  harness.element('#masterPassword').value = 'correct-master-password';
  await harness.element('#vaultForm').emit('submit');
  assert.ok(harness.accountState().vaultData);
  assert.equal(harness.accountState().masterPassword, 'correct-master-password');

  await harness.element('#resetVaultBtn').emit('click');

  const deleteCall = harness.httpCalls.find((call) => (
    call.method === 'DELETE' && call.pathname === '/api/vault'
  ));
  assert.deepEqual(deleteCall.body, { expectedRevision: 90 });
  assert.equal(harness.accountState().encryptedVault, null);
  assert.equal(harness.accountState().masterPassword, '');
  assert.equal(harness.accountState().vaultData, null);
  assert.equal(harness.element('#vaultGate').hidden, false);
  assert.equal(harness.element('#vaultWorkspace').hidden, true);
  assert.equal(harness.element('#pageNotice').dataset.tone, 'error');
  assert.match(harness.element('#pageNotice').textContent, /云端删除|本机锁定|重试同步/);

  await assert.rejects(
    harness.windowObject.TaobaoCloudSync.syncNow(),
    /本机锁定|重试同步/,
  );
  assert.equal(harness.httpCalls.some((call) => (
    call.method === 'PUT' && call.pathname === '/api/vault'
  )), false, 'a committed tombstone must never fall back to ordinary PUT after bridge failure');
  assert.deepEqual(clone(harness.storage[TEAM_REMOTE_STATE_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    revision: 91,
    deleted: true,
    vaultLockEpoch: 9,
  });
});
