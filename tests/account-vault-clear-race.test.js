const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const accountsSource = fs.readFileSync(path.join(root, 'web-tool', 'accounts.js'), 'utf8');

test('accounts page binds its trusted workspace scope before reading the active vault', () => {
  const start = accountsSource.indexOf('async function connect()');
  const end = accountsSource.indexOf("\n  window.addEventListener('message'", start);
  assert.ok(start >= 0 && end > start);
  const connectSource = accountsSource.slice(start, end);
  assert.ok(connectSource.indexOf("request('bindAccountVaultScope'") >= 0);
  assert.ok(connectSource.indexOf("request('bindAccountVaultScope'") <
    connectSource.indexOf("request('getStorage'"));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixtureElement() {
  const listeners = new Map();
  return {
    checked: false,
    className: '',
    dataset: {},
    hidden: false,
    innerHTML: '',
    open: false,
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

function createRaceHarness() {
  const events = [];
  const encryptionGate = deferred();
  const elements = new Map();
  const messageListeners = [];
  const eventListeners = new Map();
  const origin = 'http://127.0.0.1:3400';
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, fixtureElement());
    return elements.get(selector);
  };
  const windowObject = {
    confirm() { return true; },
    TaobaoAccountVault: {
      async encryptForSession(snapshot, password) {
        events.push({ action: 'encrypt:start', password, snapshot });
        return {
          record: await encryptionGate.promise,
          sessionKey: 'A'.repeat(43) + '=',
        };
      },
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
      else {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type).push(listener);
      }
    },
    dispatchEvent(event) {
      (eventListeners.get(event.type) || []).forEach((listener) => listener(event));
    },
    postMessage(message) {
      events.push({ action: message.action, payload: message.payload });
      Promise.resolve().then(() => {
        const data = ['setAccountSession', 'clearAccountSession'].includes(message.action)
          ? { ok: true }
          : {};
        messageListeners.forEach((listener) => listener({
          source: windowObject,
          origin,
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
  const documentObject = { querySelector: element };
  const bootMarker = '\n  showLocked();';
  const bootIndex = accountsSource.lastIndexOf(bootMarker);
  assert.ok(bootIndex > 0, 'accounts.js test hook insertion point is missing');
  const instrumentedSource = accountsSource.slice(0, bootIndex) + `
  window.__accountVaultRaceTest = {
    seed(value, password, encrypted) {
      vaultData = value;
      masterPassword = password;
      encryptedVault = encrypted;
    },
    saveVault,
    state() {
      return { masterPassword, vaultData, encryptedVault };
    },
  };
})();
`;
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    location: { origin },
    crypto: { randomUUID: () => 'race-test-id' },
    clearTimeout,
    setTimeout,
  });
  vm.runInContext(instrumentedSource, context, { filename: 'accounts-race-test.js' });
  windowObject.__accountVaultRaceTest.seed({
    schema: 4,
    accountGroups: [],
    storeGroups: [],
    stores: [],
    accounts: [{
      id: 'account-1',
      storeId: 'store-1',
      platform: 'taobao',
      username: 'private-user',
      password: 'private-password',
    }],
    notification: { webhook: '', secret: '' },
    updatedAt: '',
  }, 'master-password', { schema: 1, data: 'old-record' });
  return {
    api: windowObject.__accountVaultRaceTest,
    elements,
    encryptionGate,
    events,
    emitVaultLocked() {
      windowObject.dispatchEvent({
        type: 'taobao-cloud-sync',
        detail: { type: 'vault-locked', connected: false },
      });
    },
  };
}

async function runClearRace(buttonSelector, clearAction) {
  const harness = createRaceHarness();
  const savePromise = harness.api.saveVault('保存完成。').finally(() => {
    harness.events.push({ action: 'save:settled' });
  });
  await Promise.resolve();
  assert.equal(harness.events[0] && harness.events[0].action, 'encrypt:start');

  const clearPromise = harness.elements.get(buttonSelector).emit('click');
  await Promise.resolve();
  harness.encryptionGate.resolve({ schema: 1, data: 'new-record' });
  await Promise.all([savePromise, clearPromise]);

  const actions = harness.events.map((event) => event.action);
  const trace = actions.join(' -> ');
  const clearIndex = actions.indexOf(clearAction);
  assert.ok(clearIndex >= 0, clearAction + ' must be requested');
  assert.equal(
    actions.slice(clearIndex + 1).includes('setAccountSession'),
    false,
    'clearing the vault must be the final session mutation; trace: ' + trace,
  );
  assert.ok(
    clearIndex > actions.lastIndexOf('setAccountSession'),
    'clear must wait for the queued save and session sync to drain; trace: ' + trace,
  );
  assert.ok(
    clearIndex > actions.indexOf('save:settled'),
    'clear must not start before the existing save promise settles; trace: ' + trace,
  );
  assert.equal(harness.api.state().masterPassword, '');
  assert.equal(harness.api.state().vaultData, null);
}

test('locking waits for an in-flight save before clearing the session', async () => {
  await runClearRace('#lockVaultBtn', 'lockAccountVault');
});

test('resetting waits for an in-flight save before clearing the vault and session', async () => {
  await runClearRace('#resetVaultBtn', 'clearAccountVault');
});

test('an external cloud lock immediately clears plaintext and prevents a pending save from reviving it', async () => {
  const harness = createRaceHarness();
  const savePromise = harness.api.saveVault('must-not-complete');
  await Promise.resolve();
  assert.equal(harness.events[0] && harness.events[0].action, 'encrypt:start');

  harness.emitVaultLocked();
  assert.equal(harness.api.state().masterPassword, '');
  assert.equal(harness.api.state().vaultData, null);
  assert.equal(harness.elements.get('#vaultGate').hidden, false);
  assert.equal(harness.elements.get('#vaultWorkspace').hidden, true);

  harness.encryptionGate.resolve({ schema: 1, data: 'stale-after-lock' });
  await assert.rejects(savePromise, /锁定|失效|重新解锁/);
  const actions = harness.events.map((event) => event.action);
  assert.equal(actions.includes('setAccountVault'), false);
  assert.equal(actions.includes('setAccountSession'), false);
});
