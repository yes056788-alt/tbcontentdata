const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');

const root = path.join(__dirname, '..');
const bridgePath = path.join(root, 'web-tool-bridge.js');
const cloudSyncPath = path.join(root, 'web-tool', 'cloud-sync.js');
const accountsPath = path.join(root, 'web-tool', 'accounts.js');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const cloudSyncSource = fs.readFileSync(cloudSyncPath, 'utf8');
const accountsSource = fs.readFileSync(accountsPath, 'utf8');

const ORIGIN = 'https://tbdata.aizicheng.com';
const TEAM_SCOPE = 'team:https://tbdata.aizicheng.com';
const LOCAL_ORIGIN = 'http://127.0.0.1:3400';
const LEGACY_KEY = 'taobaoAccountVaultLegacyV1';
const SCOPE_KEY = 'taobaoAccountVaultScopeV1';
const LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';
const TEAM_SCOPED_KEY = 'taobaoAccountVaultScopedV1:' + encodeURIComponent(TEAM_SCOPE);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function encryptedVault(data = 'SUpLTA==', updatedAt = Date.UTC(2026, 7, 21, 8, 0, 0)) {
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

function response(body, status = 200) {
  const serialized = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return serialized; },
  };
}

function createCloudHarness(options = {}) {
  const listeners = [];
  const bridgeCalls = [];
  const httpCalls = [];
  const legacy = clone(options.legacy || encryptedVault());
  const fingerprint = options.fingerprint || 'a'.repeat(64);
  let vaultGetCount = 0;
  let legacyCommitted = false;
  let downloadedVault = null;

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      bridgeCalls.push(clone(message));
      queueMicrotask(() => {
        let data;
        let error;
        try {
          if (message.action === 'ping') data = { connected: true, capabilities: ['cloudSync'] };
          else if (message.action === 'bindAccountVaultScope') data = {
            bound: true,
            vaultScopeId: TEAM_SCOPE,
            vaultLockEpoch: 7,
            legacyAvailable: !legacyCommitted,
          };
          else if (message.action === 'getStorage') data = {};
          else if (message.action === 'getLegacyAccountVault') data = {
            legacyAvailable: !legacyCommitted,
            legacyVault: clone(legacy),
            fingerprint,
            vaultScopeId: TEAM_SCOPE,
            vaultLockEpoch: 7,
          };
          else if (message.action === 'commitLegacyAccountVault') {
            assert.equal(message.payload.fingerprint, fingerprint);
            assert.equal(message.payload.vaultLockEpoch, 7);
            legacyCommitted = true;
            data = { committed: true, vaultScopeId: TEAM_SCOPE, vaultLockEpoch: 7 };
          } else if (message.action === 'setAccountVault') {
            downloadedVault = clone(message.payload.vault);
            data = { saved: true };
          } else if (message.action === 'setProjectDirectory') data = { saved: true };
          else if (message.action === 'listStoreRuns') data = { runs: [] };
          else throw new Error('unexpected bridge action: ' + message.action);
        } catch (caught) {
          error = caught;
        }
        listeners.forEach((listener) => listener({
          source: windowObject,
          origin: ORIGIN,
          data: {
            channel: message.channel,
            type: 'response',
            requestId: message.requestId,
            ok: !error,
            data,
            message: error && error.message,
          },
        }));
      });
    },
    dispatchEvent() {},
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
  };
  windowObject.top = windowObject;

  async function fetch(input, init = {}) {
    const pathname = new URL(String(input)).pathname;
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    httpCalls.push({ method, pathname, body });
    if (pathname === '/api/session') {
      return response({
        role: options.role || 'owner',
        permissions: {
          canReadVault: true,
          canWriteVault: options.canWriteVault !== false,
          canWriteDirectory: true,
          canWriteRuns: true,
        },
      });
    }
    if (pathname === '/api/vault' && method === 'GET') {
      vaultGetCount += 1;
      const value = typeof options.vaultResponse === 'function'
        ? options.vaultResponse(vaultGetCount)
        : (options.vaultResponse || { vault: null, revision: 0, deleted: false });
      return response(value);
    }
    if (pathname === '/api/vault' && method === 'PUT') {
      if (options.putStatus === 409) {
        return response({ message: '账号库已被其他成员更新。' }, 409);
      }
      return response({ vault: clone(legacy), revision: 1, updatedAt: legacy.updatedAt });
    }
    if (pathname === '/api/directory') return response({ directory: null, revision: 0 });
    if (pathname === '/api/runs') return response({ runs: [] });
    return response({ message: 'not found' }, 404);
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
    clearTimeout,
    console,
    fetch,
    location: { origin: ORIGIN, hostname: 'tbdata.aizicheng.com' },
    queueMicrotask,
    setTimeout,
    window: windowObject,
  });
  vm.runInContext(cloudSyncSource, context, { filename: cloudSyncPath });
  return {
    windowObject,
    bridgeCalls,
    httpCalls,
    legacy,
    fingerprint,
    get legacyCommitted() { return legacyCommitted; },
    get downloadedVault() { return downloadedVault; },
  };
}

test('legacy recovery uploads the exact ciphertext at revision zero before committing locally', async () => {
  const harness = createCloudHarness();
  await harness.windowObject.TaobaoCloudSync.ready;
  const initialState = harness.windowObject.TaobaoCloudSync.getState();
  assert.equal(initialState.legacyAvailable, true);
  assert.equal(initialState.remoteVaultExists, false);
  assert.equal(initialState.remoteVaultRevision, 0);
  assert.equal(initialState.remoteVaultDeleted, false);

  const result = await harness.windowObject.TaobaoCloudSync.migrateLegacyAccountVault({
    fingerprint: harness.fingerprint,
    vaultLockEpoch: 7,
  });
  assert.equal(result.migrated, true);
  const put = harness.httpCalls.find((call) => call.method === 'PUT' && call.pathname === '/api/vault');
  assert.deepEqual(put.body, { vault: harness.legacy, expectedRevision: 0 });
  assert.equal(JSON.stringify(put.body).includes('masterPassword'), false);
  assert.equal(JSON.stringify(put.body).includes('accounts'), false);
  const actions = harness.bridgeCalls.map((call) => call.action);
  assert.ok(actions.indexOf('commitLegacyAccountVault') > actions.indexOf('getLegacyAccountVault'));
  assert.equal(harness.legacyCommitted, true);
  harness.windowObject.TaobaoCloudSync.stop();
});

test('a remote vault appearing before migration is downloaded and the legacy ciphertext is retained', async () => {
  const remote = encryptedVault('UkVNT1RF');
  const harness = createCloudHarness({
    vaultResponse(count) {
      return count === 1
        ? { vault: null, revision: 0, deleted: false }
        : { vault: remote, revision: 1, deleted: false };
    },
  });
  await harness.windowObject.TaobaoCloudSync.ready;
  const result = await harness.windowObject.TaobaoCloudSync.migrateLegacyAccountVault({
    fingerprint: harness.fingerprint,
    vaultLockEpoch: 7,
  });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'remote-exists');
  assert.deepEqual(harness.downloadedVault, remote);
  assert.equal(harness.httpCalls.some((call) => call.method === 'PUT'), false);
  assert.equal(harness.legacyCommitted, false);
  harness.windowObject.TaobaoCloudSync.stop();
});

test('a 409 never overwrites the winner, downloads it, and retains the legacy ciphertext', async () => {
  const remote = encryptedVault('V0lOTkVS');
  const harness = createCloudHarness({
    putStatus: 409,
    vaultResponse(count) {
      return count <= 2
        ? { vault: null, revision: 0, deleted: false }
        : { vault: remote, revision: 1, deleted: false };
    },
  });
  await harness.windowObject.TaobaoCloudSync.ready;
  const result = await harness.windowObject.TaobaoCloudSync.migrateLegacyAccountVault({
    fingerprint: harness.fingerprint,
    vaultLockEpoch: 7,
  });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'conflict');
  assert.deepEqual(harness.downloadedVault, remote);
  assert.equal(harness.legacyCommitted, false);
  assert.equal(harness.httpCalls.filter((call) => call.method === 'PUT').length, 1);
  harness.windowObject.TaobaoCloudSync.stop();
});

test('a server tombstone blocks legacy recovery without issuing a PUT', async () => {
  const harness = createCloudHarness({
    vaultResponse: { vault: null, revision: 4, deleted: true, tombstone: true },
  });
  await harness.windowObject.TaobaoCloudSync.ready;
  const state = harness.windowObject.TaobaoCloudSync.getState();
  assert.equal(state.remoteVaultDeleted, true);
  await assert.rejects(
    harness.windowObject.TaobaoCloudSync.migrateLegacyAccountVault({
      fingerprint: harness.fingerprint,
      vaultLockEpoch: 7,
    }),
    /删除|deleted/,
  );
  assert.equal(harness.httpCalls.some((call) => call.method === 'PUT'), false);
  assert.equal(harness.legacyCommitted, false);
  harness.windowObject.TaobaoCloudSync.stop();
});

function createBridgeHarness(origin) {
  const listeners = [];
  const posted = [];
  const storage = { [LEGACY_KEY]: encryptedVault() };
  const windowObject = {
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(message) { posted.push(clone(message)); },
    confirm() { return true; },
  };
  windowObject.top = windowObject;
  const chromeObject = {
    runtime: {
      lastError: null,
      getManifest() { return { version: 'test' }; },
      sendMessage(message, callback) {
        callback({ ok: true, locked: true, vaultLockEpoch: message.vaultLockEpoch });
      },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => (
            Object.prototype.hasOwnProperty.call(storage, key)
          )).map((key) => [key, clone(storage[key])]));
        },
        async set(values) { Object.assign(storage, clone(values)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        },
      },
      onChanged: { addListener() {} },
    },
  };
  const location = { origin, pathname: '/accounts.html' };
  const context = vm.createContext({
    TextEncoder,
    chrome: chromeObject,
    console,
    crypto: webcrypto,
    document: { visibilityState: 'visible', hasFocus() { return true; } },
    location,
    window: windowObject,
  });
  vm.runInContext(bridgeSource, context, { filename: bridgePath });
  let sequence = 0;
  async function request(action, payload = {}) {
    sequence += 1;
    const requestId = 'legacy-bridge-' + sequence;
    listeners.forEach((listener) => listener({
      source: windowObject,
      origin,
      data: {
        channel: 'taobao-full-chain-tool-v1',
        type: 'request',
        requestId,
        action,
        payload,
      },
    }));
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const answer = posted.find((message) => message.requestId === requestId);
      if (answer) {
        if (answer.ok) return answer.data;
        throw new Error(answer.message);
      }
    }
    throw new Error('bridge response timed out');
  }
  return { storage, request };
}

test('the production accounts bridge commits a fingerprint-matched legacy ciphertext once', async () => {
  const harness = createBridgeHarness(ORIGIN);
  const binding = await harness.request('bindAccountVaultScope');
  assert.equal(binding.legacyAvailable, true);
  const prepared = await harness.request('getLegacyAccountVault');
  assert.equal(prepared.legacyAvailable, true);
  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  const result = await harness.request('commitLegacyAccountVault', {
    fingerprint: prepared.fingerprint,
    vaultLockEpoch: prepared.vaultLockEpoch,
    remoteRevision: 1,
    serverConfirmed: true,
  });
  assert.equal(result.committed, true);
  assert.deepEqual(harness.storage[TEAM_SCOPED_KEY], {
    schema: 1,
    vaultScopeId: TEAM_SCOPE,
    vault: prepared.legacyVault,
    remoteRevision: 1,
    vaultLockEpoch: prepared.vaultLockEpoch,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, LEGACY_KEY), false);
});

test('localhost never exposes or commits a production legacy ciphertext', async () => {
  const harness = createBridgeHarness(LOCAL_ORIGIN);
  const binding = await harness.request('bindAccountVaultScope');
  assert.equal(binding.legacyAvailable, false);
  await assert.rejects(harness.request('getLegacyAccountVault'), /团队|在线|生产/);
  assert.deepEqual(harness.storage[LEGACY_KEY], encryptedVault());
  assert.equal(Object.prototype.hasOwnProperty.call(harness.storage, TEAM_SCOPED_KEY), false);
});

function fixtureElement() {
  const listeners = new Map();
  return {
    checked: false,
    className: '',
    dataset: {},
    hidden: false,
    innerHTML: '',
    open: false,
    options: [{ value: '' }],
    required: false,
    textContent: '',
    type: 'text',
    value: '',
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async emit(type, event = {}) {
      return Promise.all((listeners.get(type) || []).map((listener) => listener(Object.assign({
        currentTarget: this,
        preventDefault() {},
        target: this,
      }, event))));
    },
    close() { this.open = false; },
    focus() {},
    reset() { this.value = ''; },
    showModal() { this.open = true; },
  };
}

function createAccountsHarness(options = {}) {
  const elements = new Map();
  const messageListeners = [];
  const eventListeners = new Map();
  const bridgeCalls = [];
  const migrationCalls = [];
  let confirmCount = 0;
  const legacy = encryptedVault();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, fixtureElement());
    return elements.get(selector);
  };
  const windowObject = {
    confirm() { confirmCount += 1; return options.confirm !== false; },
    TaobaoAccountVault: {
      async open() {
        if (options.wrongPassword) throw new Error('主密码错误或账号库已损坏。');
        return {
          value: {
            schema: 4,
            accountGroups: [],
            storeGroups: [],
            stores: [],
            accounts: [],
            notification: { webhook: '', secret: '' },
            updatedAt: '2026-08-21T00:00:00.000Z',
          },
          sessionKey: 'A'.repeat(43) + '=',
        };
      },
    },
    TaobaoCloudSync: {
      ready: Promise.resolve({ ok: true }),
      getState() {
        return {
          connected: true,
          permissions: { canWriteVault: true },
          legacyAvailable: true,
          remoteVaultExists: false,
          remoteVaultRevision: 0,
          remoteVaultDeleted: false,
        };
      },
      async migrateLegacyAccountVault(value) {
        migrationCalls.push(clone(value));
        return { migrated: true, revision: 1 };
      },
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
      else {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type).push(listener);
      }
    },
    postMessage(message) {
      bridgeCalls.push(clone(message));
      queueMicrotask(() => {
        let data = {};
        if (message.action === 'ping') data = { connected: true, version: 'test' };
        else if (message.action === 'bindAccountVaultScope') data = {
          bound: true,
          vaultScopeId: TEAM_SCOPE,
          vaultLockEpoch: 7,
          legacyAvailable: true,
        };
        else if (message.action === 'getStorage') data = {};
        else if (message.action === 'getLegacyAccountVault') data = {
          legacyAvailable: true,
          legacyVault: legacy,
          fingerprint: 'b'.repeat(64),
          vaultScopeId: TEAM_SCOPE,
          vaultLockEpoch: 7,
        };
        else if (message.action === 'setAccountSession') data = { ok: true };
        else if (message.action === 'setProjectDirectory') data = { saved: true };
        else throw new Error('unexpected bridge action: ' + message.action);
        messageListeners.forEach((listener) => listener({
          source: windowObject,
          origin: ORIGIN,
          data: {
            channel: message.channel,
            type: 'response',
            requestId: message.requestId,
            ok: true,
            data,
          },
        }));
      });
    },
  };
  windowObject.top = windowObject;
  const context = vm.createContext({
    clearTimeout,
    crypto: { randomUUID: () => 'legacy-ui-test-id' },
    document: { querySelector: element },
    location: { origin: ORIGIN },
    queueMicrotask,
    setTimeout,
    window: windowObject,
  });
  vm.runInContext(accountsSource, context, { filename: accountsPath });
  return {
    elements,
    element,
    bridgeCalls,
    migrationCalls,
    get confirmCount() { return confirmCount; },
    async settle() {
      for (let index = 0; index < 5; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

test('wrong legacy master password never confirms, uploads, or commits anything', async () => {
  const harness = createAccountsHarness({ wrongPassword: true });
  await harness.settle();
  assert.equal(harness.elements.get('#vaultTitle').textContent, '迁移升级前本机账号库');
  harness.element('#masterPassword').value = 'wrong-password';
  await harness.element('#vaultForm').emit('submit');
  assert.equal(harness.confirmCount, 0);
  assert.deepEqual(harness.migrationCalls, []);
  assert.equal(harness.bridgeCalls.some((call) => call.action === 'commitLegacyAccountVault'), false);
});

test('verified legacy plaintext is normalized locally and only fingerprint/epoch cross into cloud sync', async () => {
  const harness = createAccountsHarness();
  await harness.settle();
  harness.element('#masterPassword').value = 'correct-old-master-password';
  await harness.element('#vaultForm').emit('submit');
  assert.equal(harness.confirmCount, 1);
  assert.deepEqual(harness.migrationCalls, [{
    fingerprint: 'b'.repeat(64),
    vaultLockEpoch: 7,
  }]);
  const serialized = JSON.stringify(harness.migrationCalls);
  assert.equal(serialized.includes('correct-old-master-password'), false);
  assert.equal(serialized.includes('accounts'), false);
  assert.equal(harness.elements.get('#vaultWorkspace').hidden, false);
});
