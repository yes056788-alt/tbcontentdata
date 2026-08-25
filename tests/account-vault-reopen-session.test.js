const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const accountsSource = fs.readFileSync(path.join(root, 'web-tool', 'accounts.js'), 'utf8');

function fixtureElement() {
  const listeners = new Map();
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
      const callbacks = listeners.get(type) || [];
      return Promise.all(callbacks.map((listener) => listener(Object.assign({
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
  let html = '';
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

function createHarness() {
  const origin = 'http://127.0.0.1:3400';
  const elements = new Map();
  const requests = [];
  const messageListeners = [];
  const windowListeners = new Map();
  const encryptedVault = {
    schema: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: 'QUJDRA==' },
    cipher: { name: 'AES-GCM', iv: 'RUZHSA==', data: 'SUpLTA==' },
    updatedAt: 1,
  };
  const restoredVault = {
    schema: 4,
    accountGroups: [],
    storeGroups: [],
    stores: [],
    accounts: [],
    notification: { webhook: '', secret: '' },
    updatedAt: '2026-08-24T00:00:00.000Z',
  };
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, fixtureElement());
    return elements.get(selector);
  };
  const responseFor = (message) => {
    if (message.action === 'ping') return { connected: true, version: '2.37.25' };
    if (message.action === 'bindAccountVaultScope') {
      return { vaultScopeId: 'local:tbcontentdata', vaultLockEpoch: 4 };
    }
    if (message.action === 'getStorage') {
      return { taobaoAccountVaultV1: encryptedVault };
    }
    if (message.action === 'getAccountManagementSession') {
      return {
        unlocked: true,
        vaultScopeId: 'local:tbcontentdata',
        vaultLockEpoch: 4,
        vault: restoredVault,
      };
    }
    if (message.action === 'encryptAccountVaultFromSession') {
      return { vault: Object.assign({}, encryptedVault, { updatedAt: 2 }) };
    }
    if (message.action === 'setAccountSession') return { ok: true };
    return { saved: true };
  };
  const windowObject = {
    top: null,
    confirm() { return true; },
    prompt() { return null; },
    TaobaoAccountVault: {
      async decrypt() { throw new Error('重开管理页不应重新解密或要求密码。'); },
      async encryptForSession() { throw new Error('恢复会话保存时不应重新使用主密码。'); },
    },
    TaobaoCloudSync: { ready: Promise.resolve(), getState() { return null; } },
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
      else {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(listener);
      }
    },
    dispatchEvent(event) {
      (windowListeners.get(event.type) || []).forEach((listener) => listener(event));
    },
    postMessage(message) {
      requests.push({ action: message.action, payload: message.payload });
      Promise.resolve().then(() => {
        messageListeners.forEach((listener) => listener({
          source: windowObject,
          origin,
          data: {
            channel: message.channel,
            type: 'response',
            requestId: message.requestId,
            ok: true,
            data: responseFor(message),
          },
        }));
      });
    },
  };
  windowObject.top = windowObject;
  const context = vm.createContext({
    clearTimeout,
    console,
    crypto: { randomUUID: () => 'reopen-test-id' },
    document: { querySelector: element },
    location: { origin },
    setTimeout,
    window: windowObject,
  });
  vm.runInContext(accountsSource, context, { filename: 'accounts-reopen-session.js' });
  return { element, requests };
}

async function settle() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('reopening account management restores the current Chrome vault session and can still save', async () => {
  const harness = createHarness();
  await settle();

  assert.equal(harness.element('#vaultGate').hidden, true);
  assert.equal(harness.element('#vaultWorkspace').hidden, false);
  assert.equal(harness.element('#lockVaultBtn').hidden, false);
  assert.ok(harness.requests.some((request) => request.action === 'getAccountManagementSession'));

  harness.element('#dingWebhook').value = 'https://oapi.dingtalk.com/robot/send?access_token=test';
  await harness.element('#notificationForm').emit('submit');
  await settle();

  const actions = harness.requests.map((request) => request.action);
  assert.ok(actions.includes('encryptAccountVaultFromSession'));
  assert.ok(actions.includes('setAccountVault'));
  assert.ok(actions.includes('setAccountSession'));
});
