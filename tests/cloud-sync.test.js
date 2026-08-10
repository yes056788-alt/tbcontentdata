const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'web-tool', 'cloud-sync.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function jsonResponse(body, status) {
  const text = body == null ? '' : JSON.stringify(body);
  const code = status == null ? 200 : status;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    headers: { get() { return null; } },
    async text() { return text; },
  };
}

function makeVault(updatedAt, data) {
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
      data: data || 'SUpLTA==',
    },
    updatedAt,
  };
}

function makeDirectory(updatedAt, storeName) {
  return {
    schema: 1,
    storeGroups: [{ id: 'group-1', name: '默认组' }],
    stores: [{
      id: 'store-1',
      name: storeName,
      groupId: 'group-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }],
    updatedAt,
  };
}

function makeRun(runId, updatedAt, storeName) {
  return {
    schema: 2,
    runId,
    batchId: 'batch-1',
    taskType: 'both',
    runMode: 'batch',
    account: {
      id: 'account-1',
      name: '账号一',
      platform: 'taobao',
      storeId: 'store-1',
      storeName,
      usernameMasked: 'us***r',
      roleKeyword: '品牌',
      accountGroupId: '',
      accountGroupName: '',
      storeGroupId: 'group-1',
      storeGroupName: '默认组',
    },
    startedAt: updatedAt - 2000,
    finishedAt: updatedAt - 1000,
    updatedAt,
    xinghe: { state: 'ready', noPermission: false },
    status: 'success',
    failures: [],
    snapshots: { businessDefenseManualInputsV1: { xhs_kolSpend: '100' } },
  };
}

function createEnvironment(options) {
  const listeners = [];
  const posted = [];
  const events = [];
  const bridge = options.bridge || (() => ({}));
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      posted.push(message);
      Promise.resolve().then(() => bridge(message)).then((data) => {
        listeners.forEach((listener) => listener({
          source: windowObject,
          origin: options.origin,
          data: {
            channel: 'taobao-full-chain-tool-v1',
            type: 'response',
            requestId: message.requestId,
            ok: true,
            data,
          },
        }));
      }).catch((error) => {
        listeners.forEach((listener) => listener({
          source: windowObject,
          origin: options.origin,
          data: {
            channel: 'taobao-full-chain-tool-v1',
            type: 'response',
            requestId: message.requestId,
            ok: false,
            message: error.message,
          },
        }));
      });
    },
    dispatchEvent(event) { events.push(event); },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
  };
  windowObject.top = windowObject;
  const location = {
    origin: options.origin,
    hostname: new URL(options.origin).hostname,
  };
  const context = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Map,
    Set,
    Promise,
    URL,
    location,
    window: windowObject,
    fetch: options.fetch,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return { context, windowObject, posted, events };
}

async function testLocalNoop() {
  let fetchCount = 0;
  const environment = createEnvironment({
    origin: 'http://127.0.0.1:3400',
    fetch: async () => {
      fetchCount += 1;
      throw new Error('localhost must not call fetch');
    },
  });
  const result = await environment.windowObject.TaobaoCloudSync.ready;
  assert.equal(result.skipped, true);
  assert.equal(environment.windowObject.TaobaoCloudSync.getState().enabled, false);
  assert.equal(fetchCount, 0);
  assert.equal(environment.posted.length, 0);
}

async function testInitialOwnerSync() {
  const now = Date.now();
  const localVault = Object.assign(makeVault(now - 10000, 'SUpLTA=='), {
    masterPassword: 'must-never-upload',
  });
  const localDirectory = makeDirectory(now - 20000, '本地店铺');
  const remoteDirectory = makeDirectory(now - 5000, '云端店铺');
  const localRun = makeRun('store-run-local-1', now - 4000, '本地店铺');
  const remoteRun = makeRun('store-run-remote-1', now - 3000, '云端店铺');
  const storage = {
    taobaoAccountVaultV1: localVault,
    taobaoProjectDirectoryV1: localDirectory,
    taobaoStoreRunIndexV1: [{
      runId: localRun.runId,
      finishedAt: localRun.finishedAt,
      updatedAt: localRun.updatedAt,
    }],
  };
  const uploads = [];
  const imports = [];
  const setVaults = [];
  const setDirectories = [];
  const fetchCalls = [];

  const bridge = async (message) => {
    if (message.action === 'ping') {
      return { connected: true, capabilities: ['cloudSync'] };
    }
    if (message.action === 'getStorage') {
      return Object.fromEntries(message.payload.keys.filter((key) => (
        Object.prototype.hasOwnProperty.call(storage, key)
      )).map((key) => [key, storage[key]]));
    }
    if (message.action === 'setAccountVault') {
      setVaults.push(message.payload.vault);
      storage.taobaoAccountVaultV1 = message.payload.vault;
      return { saved: true };
    }
    if (message.action === 'setProjectDirectory') {
      setDirectories.push(message.payload.directory);
      storage.taobaoProjectDirectoryV1 = message.payload.directory;
      return { saved: true };
    }
    if (message.action === 'listStoreRuns') return { runs: storage.taobaoStoreRunIndexV1 };
    if (message.action === 'getStoreRun') return { run: localRun };
    if (message.action === 'importStoreRun') {
      imports.push(message.payload.run);
      return { imported: true, runId: message.payload.runId };
    }
    throw new Error('unexpected bridge action: ' + message.action);
  };

  const fetchMock = async (input, init) => {
    const url = new URL(input);
    const method = (init && init.method) || 'GET';
    fetchCalls.push({ path: url.pathname, method, body: init && init.body });
    if (url.pathname === '/api/session' && method === 'GET') {
      return jsonResponse({ role: 'owner' });
    }
    if (url.pathname === '/api/vault' && method === 'GET') {
      return jsonResponse({ vault: null, revision: 0 });
    }
    if (url.pathname === '/api/vault' && method === 'PUT') {
      uploads.push({ type: 'vault', body: JSON.parse(init.body) });
      return jsonResponse({ revision: 1 });
    }
    if (url.pathname === '/api/directory' && method === 'GET') {
      return jsonResponse({ directory: remoteDirectory, revision: 7 });
    }
    if (url.pathname === '/api/runs' && method === 'GET') {
      return jsonResponse({ runs: [{
        runId: remoteRun.runId,
        finishedAt: remoteRun.finishedAt,
        updatedAt: remoteRun.updatedAt,
      }] });
    }
    if (url.pathname === '/api/runs' && method === 'POST') {
      uploads.push({ type: 'run', body: JSON.parse(init.body) });
      return jsonResponse({ created: true }, 201);
    }
    if (url.pathname === '/api/runs/' + remoteRun.runId && method === 'GET') {
      return jsonResponse({ run: remoteRun });
    }
    return jsonResponse({ message: 'not found' }, 404);
  };

  const environment = createEnvironment({
    origin: 'https://tool.example.com',
    bridge,
    fetch: fetchMock,
  });
  const result = await environment.windowObject.TaobaoCloudSync.ready;
  assert.equal(result.ok, true);
  assert.equal(result.role, 'owner');
  assert.deepEqual(Array.from(result.conflicts), []);
  const vaultUpload = uploads.find((item) => item.type === 'vault').body;
  assert.equal(vaultUpload.expectedRevision, 0);
  assert.equal(vaultUpload.vault.masterPassword, undefined);
  assert.deepEqual(Object.keys(vaultUpload.vault).sort(), ['cipher', 'kdf', 'schema', 'updatedAt']);
  assert.equal(setVaults.length, 0);
  assert.equal(setDirectories.length, 1);
  assert.equal(setDirectories[0].stores[0].name, '云端店铺');
  const runUpload = uploads.find((item) => item.type === 'run').body;
  assert.equal(runUpload.run.runId, localRun.runId);
  assert.equal(runUpload.expectedAbsent, true);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].runId, remoteRun.runId);
  assert.ok(fetchCalls.every((item) => item.path.startsWith('/api/')));
  environment.windowObject.TaobaoCloudSync.stop();
}

async function testVaultRevisionConflictDoesNotOverwrite() {
  const now = Date.now();
  const localVault = makeVault(now - 1000, 'SUpLTA==');
  const remoteVault = makeVault(now - 10000, 'TU5PUA==');
  const directory = makeDirectory(now - 1000, '同步店铺');
  const storage = {
    taobaoAccountVaultV1: localVault,
    taobaoProjectDirectoryV1: directory,
    taobaoStoreRunIndexV1: [],
  };
  let vaultSetCount = 0;
  let vaultPutCount = 0;
  const environment = createEnvironment({
    origin: 'https://tool.example.com',
    bridge: async (message) => {
      if (message.action === 'ping') return { connected: true, capabilities: ['cloudSync'] };
      if (message.action === 'getStorage') {
        return Object.fromEntries(message.payload.keys.filter((key) => (
          Object.prototype.hasOwnProperty.call(storage, key)
        )).map((key) => [key, storage[key]]));
      }
      if (message.action === 'setAccountVault') {
        vaultSetCount += 1;
        storage.taobaoAccountVaultV1 = message.payload.vault;
        return { saved: true };
      }
      if (message.action === 'listStoreRuns') return { runs: [] };
      throw new Error('unexpected bridge action: ' + message.action);
    },
    fetch: async (input, init) => {
      const url = new URL(input);
      const method = (init && init.method) || 'GET';
      if (url.pathname === '/api/session') return jsonResponse({ role: 'admin' });
      if (url.pathname === '/api/vault' && method === 'GET') {
        return jsonResponse({ vault: remoteVault, revision: 5 });
      }
      if (url.pathname === '/api/vault' && method === 'PUT') {
        vaultPutCount += 1;
        assert.equal(JSON.parse(init.body).expectedRevision, 5);
        return jsonResponse({ message: 'revision mismatch' }, 409);
      }
      if (url.pathname === '/api/directory') {
        return jsonResponse({ directory, revision: 2 });
      }
      if (url.pathname === '/api/runs') return jsonResponse({ runs: [] });
      return jsonResponse({ message: 'not found' }, 404);
    },
  });
  const result = await environment.windowObject.TaobaoCloudSync.ready;
  assert.equal(result.ok, true);
  assert.equal(vaultPutCount, 1);
  assert.equal(vaultSetCount, 0);
  assert.equal(storage.taobaoAccountVaultV1.cipher.data, localVault.cipher.data);
  assert.ok(Array.from(result.conflicts).includes('vault:revision'));
  environment.windowObject.TaobaoCloudSync.stop();
}

async function run() {
  await testLocalNoop();
  await testInitialOwnerSync();
  await testVaultRevisionConflictDoesNotOverwrite();
  console.log('cloud sync guards passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
