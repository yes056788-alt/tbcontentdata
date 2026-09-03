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
    storeGroups: [{ id: 'group-1', name: '默认组' }],
    stores: [{
      id: 'store-1',
      name: '家具店',
      groupId: 'group-1',
      credentialBindings: { taobaoAccountId: '', xiaohongshuAccountId: '' },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    }],
    accounts: [],
    notification: { webhook: '', secret: '' },
    updatedAt: '2026-08-24T00:00:00.000Z',
  };
  const classification = {
    schema: 1,
    profileId: 'home-furnishing-v1',
    customIndustry: '家具',
    ownBrandTerms: ['顾家'],
    ownProductTerms: ['护腰床垫'],
    competitorTerms: ['慕思'],
    manualOverrides: [{
      id: 'override-1',
      scopeKey: 'store-1',
      keyword: '顾家床垫值得买吗',
      active: true,
      reason: '运营人工确认',
      patch: {
        entityRelation: 'own_brand',
        topicTagIds: ['core_category'],
        intentIds: ['purchase_decision'],
        primaryIntentId: 'purchase_decision',
        relevance: 'strong',
        token: 'must-drop',
      },
      updatedAt: 1788048000000,
      password: 'must-drop',
    }],
    revision: 3,
    updatedAt: 1788048000000,
    secret: 'must-drop',
    unknown: 'must-drop',
  };
  const expectedClassification = {
    schema: 1,
    profileId: 'home-furnishing-v1',
    customIndustry: '家具',
    ownBrandTerms: ['顾家'],
    ownProductTerms: ['护腰床垫'],
    competitorTerms: ['慕思'],
    manualOverrides: [{
      id: 'override-1',
      scopeKey: 'store-1',
      keyword: '顾家床垫值得买吗',
      active: true,
      reason: '运营人工确认',
      patch: {
        entityRelation: 'own_brand',
        topicTagIds: ['core_category'],
        intentIds: ['purchase_decision'],
        primaryIntentId: 'purchase_decision',
        relevance: 'strong',
      },
      updatedAt: 1788048000000,
    }],
    revision: 3,
    updatedAt: 1788048000000,
  };
  const projectDirectory = {
    schema: 1,
    storeGroups: [{ id: 'group-1', name: '默认组' }],
    stores: [{
      id: 'store-1',
      name: '家具店',
      groupId: 'group-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
      classification,
    }],
    updatedAt: 1788048000000,
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
      return {
        taobaoAccountVaultV1: encryptedVault,
        taobaoProjectDirectoryV1: projectDirectory,
      };
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
  return { element, expectedClassification, requests };
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
  const directoryWrite = harness.requests.find((request) => request.action === 'setProjectDirectory');
  assert.ok(directoryWrite, '保存账号库时应重建项目目录');
  assert.deepEqual(
    JSON.parse(JSON.stringify(directoryWrite.payload.directory.stores[0].classification)),
    harness.expectedClassification,
    '按 storeId 重建目录时必须保留并清洗已有分类配置',
  );
});
