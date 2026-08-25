const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'web-tool-bridge.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function harness(pathname) {
  const listeners = [];
  const posted = [];
  const runtimeMessages = [];
  const storage = {};
  let localReadCount = 0;
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) { posted.push(message); },
  };
  windowObject.top = windowObject;
  const context = vm.createContext({
    console,
    document: { visibilityState: 'visible', hasFocus() { return true; } },
    location: { origin: 'https://tbdata.aizicheng.com', pathname },
    window: windowObject,
    chrome: {
      runtime: {
        lastError: null,
        getManifest() { return { version: '9.9.9' }; },
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          callback({ ok: true, locked: true, vaultLockEpoch: message.vaultLockEpoch });
        },
      },
      storage: {
        local: {
          async get(keys) {
            localReadCount += 1;
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter((key) => (
              Object.prototype.hasOwnProperty.call(storage, key)
            )).map((key) => [key, storage[key]]));
          },
          async set(value) { Object.assign(storage, value); },
          async remove(keys) {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[key]);
          },
        },
        onChanged: { addListener() {} },
      },
    },
  });
  vm.runInContext(source, context, { filename: sourcePath });

  async function send(action, requestId) {
    listeners.forEach((listener) => listener({
      source: windowObject,
      origin: context.location.origin,
      data: {
        channel: 'taobao-full-chain-tool-v1',
        type: 'request',
        requestId,
        action,
        payload: {},
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return posted.find((message) => message.requestId === requestId);
  }

  return {
    send,
    posted,
    runtimeMessages,
    get localReadCount() { return localReadCount; },
  };
}

test('/login is lock-only and automatically revokes a stale vault session', async () => {
  const page = harness('/login');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.runtimeMessages.length, 1);
  assert.equal(page.runtimeMessages[0].type, 'ACCOUNT_SESSION_LOCK');
  const ready = page.posted.find((message) => message.type === 'ready');
  assert.deepEqual(Array.from(ready.capabilities), ['accountVaultLock']);

  const ping = await page.send('ping', 'login-ping');
  assert.deepEqual(Array.from(ping.data.capabilities), ['accountVaultLock']);
  const denied = await page.send('getStorage', 'login-read');
  assert.equal(denied.ok, false);
});

for (const pathname of ['/admin', '/change-password', '/migration/']) {
  test(pathname + ' only exposes ping and account-vault lock', async () => {
    const page = harness(pathname);
    const denied = await page.send('getStorage', 'read');
    assert.equal(denied.ok, false);
    assert.match(denied.message, /仅允许锁定/);
    assert.equal(page.localReadCount, 0, 'lock-only page must not read extension storage');

    const locked = await page.send('lockAccountVault', 'lock');
    assert.equal(locked.ok, true);
    assert.equal(locked.data.locked, true);
    assert.equal(page.runtimeMessages.at(-1).type, 'ACCOUNT_SESSION_LOCK');
  });
}
