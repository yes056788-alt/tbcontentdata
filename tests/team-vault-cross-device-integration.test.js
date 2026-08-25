const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bridgePath = path.join(root, 'web-tool-bridge.js');
const cloudSyncPath = path.join(root, 'web-tool', 'cloud-sync.js');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const cloudSyncSource = fs.readFileSync(cloudSyncPath, 'utf8');

const ORIGIN = 'https://tbdata.aizicheng.com';
const TEAM_SCOPE = 'team:https://tbdata.aizicheng.com';
const SCOPE_KEY = 'taobaoAccountVaultScopeV1';
const LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';
const LOGICAL_VAULT_KEY = 'taobaoAccountVaultV1';
const TEAM_SCOPED_KEY = 'taobaoAccountVaultScopedV1:' + encodeURIComponent(TEAM_SCOPE);
const LOCAL_SCOPED_KEY = 'taobaoAccountVaultScopedV1:' + encodeURIComponent('local:tbcontentdata');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function response(body, status = 200) {
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

function encryptedVault() {
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
      data: 'SUpLTA==',
    },
    updatedAt: Date.UTC(2026, 7, 21, 8, 0, 0),
  };
}

function createHarness(remoteVault) {
  const listeners = [];
  const storageListeners = [];
  const storage = {};
  const bridgeRequests = [];
  const httpCalls = [];
  const runtimeMessages = [];
  const runtimeProtocolErrors = [];
  const timeline = [];
  const pendingPageRequests = new Map();
  const backgroundSession = {
    vaultLockEpoch: 0,
    plaintext: null,
  };

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      assert.equal(targetOrigin, ORIGIN, 'bridge messages must stay on the authenticated origin');
      if (message && message.type === 'request') {
        bridgeRequests.push(clone(message));
        timeline.push('bridge:' + message.action);
      }
      queueMicrotask(() => {
        const event = { source: windowObject, origin: ORIGIN, data: message };
        listeners.slice().forEach((listener) => listener(event));
      });
    },
    dispatchEvent() {},
    confirm() { return true; },
  };
  windowObject.top = windowObject;

  const location = {
    origin: ORIGIN,
    hostname: 'tbdata.aizicheng.com',
    pathname: '/accounts.html',
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
        changes[key] = {
          oldValue: clone(storage[key]),
          newValue: clone(value),
        };
        storage[key] = clone(value);
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
      }
      queueMicrotask(() => {
        storageListeners.slice().forEach((listener) => listener(clone(changes), 'local'));
      });
    },
  };

  const chromeObject = {
    runtime: {
      lastError: null,
      getManifest() { return { version: '9.9.9-test' }; },
      sendMessage(message, callback) {
        runtimeMessages.push(clone(message));
        queueMicrotask(() => {
          try {
            assert.equal(message.source, 'business-defense-web-tool');
            if (message.type === 'ACCOUNT_SESSION_LOCK') {
              assert.ok(Number.isSafeInteger(message.vaultLockEpoch));
              assert.ok(message.vaultLockEpoch > backgroundSession.vaultLockEpoch);
              backgroundSession.vaultLockEpoch = message.vaultLockEpoch;
              backgroundSession.plaintext = null;
              callback({
                ok: true,
                locked: true,
                vaultLockEpoch: backgroundSession.vaultLockEpoch,
              });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_SET') {
              assert.equal(message.vaultScopeId, TEAM_SCOPE);
              assert.equal(message.vaultLockEpoch, backgroundSession.vaultLockEpoch);
              backgroundSession.plaintext = clone(message.vault);
              callback({ ok: true, unlocked: true, vaultScopeId: TEAM_SCOPE });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_GET_SUMMARY') {
              assert.equal(message.expectedVaultScopeId, TEAM_SCOPE);
              callback({
                ok: true,
                unlocked: Boolean(backgroundSession.plaintext),
                vaultScopeId: TEAM_SCOPE,
              });
              return;
            }
            if (message.type === 'ACCOUNT_SESSION_CLEAR') {
              backgroundSession.plaintext = null;
              callback({ ok: true, cleared: true });
              return;
            }
            throw new Error('unexpected runtime message: ' + message.type);
          } catch (error) {
            runtimeProtocolErrors.push(error);
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
    httpCalls.push({ method, pathname: url.pathname, body: init.body || '' });
    timeline.push('http:' + method + ':' + url.pathname);
    if (url.pathname === '/api/session' && method === 'GET') {
      return response({
        role: 'owner',
        user: { id: 'member-on-new-computer' },
      });
    }
    if (url.pathname === '/api/vault' && method === 'GET') {
      return response({ vault: remoteVault, revision: 12, updatedAt: remoteVault.updatedAt });
    }
    if (url.pathname === '/api/directory' && method === 'GET') {
      return response({ directory: null, revision: 0 });
    }
    if (url.pathname === '/api/runs' && method === 'GET') {
      return response({ runs: [] });
    }
    return response({ error: { message: method + ' ' + url.pathname + ' is unexpected' } }, 500);
  }

  const context = vm.createContext({
    Array,
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
    URL,
    chrome: chromeObject,
    clearTimeout,
    console,
    document: {
      visibilityState: 'visible',
      hasFocus() { return true; },
    },
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

  let pageRequestSequence = 0;
  function pageRequest(action, payload) {
    pageRequestSequence += 1;
    const requestId = 'integration-page-' + pageRequestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingPageRequests.delete(requestId);
        reject(new Error('timed out waiting for bridge response: ' + action));
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

  assert.deepEqual(storage, {}, 'new computer must begin without a local scope or vault');
  vm.runInContext(bridgeSource, context, { filename: bridgePath });
  vm.runInContext(cloudSyncSource, context, { filename: cloudSyncPath });

  return {
    windowObject,
    storage,
    bridgeRequests,
    httpCalls,
    runtimeMessages,
    runtimeProtocolErrors,
    timeline,
    backgroundSession,
    pageRequest,
  };
}

test('a new computer downloads the team vault through the real trusted bridge without uploading', async () => {
  const remoteVault = encryptedVault();
  const harness = createHarness(remoteVault);

  const ready = await harness.windowObject.TaobaoCloudSync.ready;
  assert.equal(ready.ok, true, ready.message);
  assert.equal(ready.vaultScopeId, TEAM_SCOPE);
  assert.equal(harness.windowObject.TaobaoCloudSync.getState().vaultScopeId, TEAM_SCOPE);

  const sessionIndex = harness.timeline.indexOf('http:GET:/api/session');
  const bindIndex = harness.timeline.indexOf('bridge:bindAccountVaultScope');
  const vaultIndex = harness.timeline.indexOf('http:GET:/api/vault');
  assert.ok(sessionIndex >= 0 && sessionIndex < bindIndex,
    'the authenticated session must succeed before the real bridge binds a scope');
  assert.ok(bindIndex < vaultIndex,
    'the trusted scope must be bound before cloud-sync reads the remote vault');

  assert.deepEqual(clone(harness.storage[TEAM_SCOPED_KEY]), {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    vault: remoteVault,
    remoteRevision: 12,
    vaultLockEpoch: 1,
  });
  assert.equal(harness.storage[SCOPE_KEY], TEAM_SCOPE);
  assert.equal(harness.storage[LOCK_EPOCH_KEY], 1);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, LOGICAL_VAULT_KEY), false,
    'the legacy unscoped vault key must stay empty');
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, LOCAL_SCOPED_KEY), false,
    'production sync must never write the local-development vault scope');

  const logicalVault = await harness.pageRequest('getStorage', {
    keys: [LOGICAL_VAULT_KEY],
    vaultScopeId: 'local:tbcontentdata',
  });
  assert.deepEqual(clone(logicalVault[LOGICAL_VAULT_KEY]), remoteVault,
    'logical vault reads must resolve to the trusted team-scoped ciphertext');

  const forgedBinding = await harness.pageRequest('bindAccountVaultScope', {
    vaultScopeId: 'local:tbcontentdata',
    scopeId: 'team:https://attacker.example',
  });
  assert.equal(forgedBinding.vaultScopeId, TEAM_SCOPE,
    'page-provided scope values must not override the production origin');
  assert.equal(harness.storage[SCOPE_KEY], TEAM_SCOPE);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, LOCAL_SCOPED_KEY), false);

  assert.equal(harness.httpCalls.some((call) => call.method === 'PUT'), false,
    'an empty new computer must only download the existing remote ciphertext');
  assert.deepEqual(harness.httpCalls.map((call) => call.method + ' ' + call.pathname), [
    'GET /api/session',
    'GET /api/vault',
    'GET /api/directory',
    'GET /api/runs',
  ]);
  assert.deepEqual(harness.runtimeProtocolErrors, []);
  assert.deepEqual(harness.runtimeMessages.map((message) => message.type), [
    'ACCOUNT_SESSION_LOCK',
  ]);
  assert.equal(harness.backgroundSession.plaintext, null,
    'ciphertext download must not create a plaintext background session');

  harness.windowObject.TaobaoCloudSync.stop();
});
