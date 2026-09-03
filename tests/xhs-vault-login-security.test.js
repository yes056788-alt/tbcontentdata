const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const accountLogin = require('../xhs/account-login');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, 'missing source marker: ' + startMarker);
  assert.ok(end > start, 'missing source marker: ' + endMarker);
  return background.slice(start, end);
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function batchError(code, message, fields) {
  const error = Object.assign(new Error(message), fields || {});
  error.code = code;
  return error;
}

function cancellationError(reason) {
  const error = reason instanceof Error ? reason : new Error(String(reason || '任务已取消。'));
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}

function createPreexistingSessionHarness(platform, kind) {
  const entryUrl = accountLogin.XHS_PLATFORM_ENTRY_URLS[platform];
  const tabId = platform === 'pgy' ? 301 : 302;
  const tab = { id: tabId, status: 'complete', url: entryUrl };
  let submitCount = 0;
  const context = vm.createContext({
    Error,
    Number,
    Object,
    Promise,
    String,
    XHS_PLATFORM_ENTRY_URLS: accountLogin.XHS_PLATFORM_ENTRY_URLS,
    XhsAccountLogin: accountLogin,
    chrome: {
      tabs: {
        async create() {
          throw new Error('已存在平台页时不应新建标签页。');
        },
        async get() {
          return copy(tab);
        },
        async update(_tabId, update) {
          Object.assign(tab, copy(update));
          return copy(tab);
        },
      },
    },
    async queryUniqueXhsLoginTarget() {
      return copy(tab);
    },
    async waitTabComplete() {},
    async readXhsLoginState() {
      return { kind, frameId: 0, documentId: 'existing-document', href: entryUrl };
    },
    async waitForXhsLoginState() {
      return { kind, frameId: 0, documentId: 'existing-document', href: entryUrl };
    },
    async sendTabMessageWithRetry() {
      throw new Error('预存会话不应进入密码提交。');
    },
    async submitXhsPasswordLogin() {
      submitCount += 1;
      throw new Error('预存会话不应进入密码提交。');
    },
    batchError,
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled() {},
  });

  const source = sourceBlock(
    'function checkXhsLoginBlockingState',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(
    source + '\nglobalThis.ensureXhsPlatformSessionUnderTest = ensureXhsPlatformSession;',
    context,
    { filename: 'xhs-vault-existing-session-security.js' },
  );
  return { context, submitCount: () => submitCount };
}

for (const scenario of [
  { platform: 'pgy', kind: 'loggedIn', name: '蒲公英 loggedIn' },
  { platform: 'juguang', kind: 'productReady', name: '聚光 productReady' },
]) {
  test(`vault 模式遇到预存 ${scenario.name} 会话时 fail closed，不静默跳过所选凭据`, async () => {
    const harness = createPreexistingSessionHarness(scenario.platform, scenario.kind);
    await assert.rejects(
      harness.context.ensureXhsPlatformSessionUnderTest(scenario.platform, {
        username: 'selected-account@example.test',
        password: 'selected-account-password',
      }, {}),
      (error) => {
        assert.match(
          String(error && error.message || ''),
          /currentSession|复用当前.*登录态|当前会话模式|先退出|退出当前/,
          '拒绝复用时必须明确提示改用 currentSession/当前会话，或先退出已登录账号。',
        );
        return true;
      },
    );
    assert.equal(harness.submitCount(), 0, '已存会话不得继续提交所选账号的明文凭据。');
  });

  test(`项目新建页可显式继承 ${scenario.name} 会话并直接继续`, async () => {
    const harness = createPreexistingSessionHarness(scenario.platform, scenario.kind);
    const result = await harness.context.ensureXhsPlatformSessionUnderTest(scenario.platform, {
      username: 'selected-account@example.test',
      password: 'selected-account-password',
    }, {
      taskOwnedTabId: scenario.platform === 'pgy' ? 301 : 302,
      allowExistingSession: true,
    });

    assert.equal(result.tabId, scenario.platform === 'pgy' ? 301 : 302);
    assert.equal(result.taskSessionReused, true);
    assert.equal(harness.submitCount(), 0, '新页已继承登录态时不得重复提交密码。');
  });
}

function createConcurrentSharedSessionHarness() {
  const tabs = new Map([
    [611, { id: 611, status: 'complete', url: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy }],
    [612, { id: 612, status: 'complete', url: accountLogin.XHS_PLATFORM_ENTRY_URLS.juguang }],
  ]);
  const initialConfirmations = new Set();
  let releaseSubmission;
  const bothPrepared = new Promise((resolve) => { releaseSubmission = resolve; });
  let taskSessionEstablished = false;
  let submitCount = 0;

  const context = vm.createContext({
    Error,
    Number,
    Object,
    Promise,
    String,
    XHS_PLATFORM_ENTRY_URLS: accountLogin.XHS_PLATFORM_ENTRY_URLS,
    XhsAccountLogin: accountLogin,
    chrome: {
      tabs: {
        async create() {
          throw new Error('测试已准备两个平台页，不应新建。');
        },
        async get(tabId) {
          return copy(tabs.get(Number(tabId)));
        },
        async update(tabId, update) {
          const id = Number(tabId);
          const tab = Object.assign({}, tabs.get(id), copy(update), { status: 'complete' });
          tabs.set(id, tab);
          return copy(tab);
        },
      },
    },
    async queryUniqueXhsLoginTarget(platform) {
      return copy(tabs.get(platform === 'pgy' ? 611 : 612));
    },
    async waitTabComplete() {},
    async confirmXhsPlatformSession(tabId, platform) {
      if (!taskSessionEstablished) {
        initialConfirmations.add(platform);
        if (initialConfirmations.size === 2) releaseSubmission();
        return null;
      }
      return { tabId: Number(tabId), platform, state: 'loggedIn' };
    },
    async submitXhsPasswordLogin(tabId, platform) {
      submitCount += 1;
      await bothPrepared;
      taskSessionEstablished = true;
      return {
        tabId: Number(tabId),
        platform,
        state: 'loggedIn',
        credentialSubmitted: true,
      };
    },
    batchError,
    throwIfProjectTaskCancelled() {},
  });

  const source = sourceBlock(
    'async function ensureXhsPlatformSession',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(
    source + '\nglobalThis.ensureXhsPlatformSessionUnderTest = ensureXhsPlatformSession;',
    context,
    { filename: 'xhs-shared-session-coordinator.js' },
  );
  return { context, submitCount: () => submitCount };
}

test('蒲公英与聚光并发打开，但共享小红书会话只提交一次密码', async () => {
  const harness = createConcurrentSharedSessionHarness();
  const taskSessionCoordinator = {
    established: false,
    credentialSubmission: null,
  };

  const results = await Promise.all([
    harness.context.ensureXhsPlatformSessionUnderTest('pgy', {
      username: 'fixture@example.test', password: 'fixture-password',
    }, { taskSessionCoordinator }),
    harness.context.ensureXhsPlatformSessionUnderTest('juguang', {
      username: 'fixture@example.test', password: 'fixture-password',
    }, { taskSessionCoordinator }),
  ]);

  assert.equal(harness.submitCount(), 1, '并发平台不得同时提交同一套账号密码。');
  assert.equal(results.filter((item) => item.credentialSubmitted === true).length, 1);
  assert.equal(results.filter((item) => item.taskSessionReused === true).length, 1);
});

function createVerificationResumeHarness(loginOrigin) {
  const platform = 'pgy';
  const entryUrl = accountLogin.XHS_PLATFORM_ENTRY_URLS[platform];
  const tabs = new Map();
  const createdTabIds = [];
  const submittedTabIds = [];
  const verificationTabIds = [];
  let nextTabId = 401;
  let firstSubmission = true;

  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Error,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    clearTimeout,
    setTimeout,
    XHS_PLATFORM_ENTRY_URLS: accountLogin.XHS_PLATFORM_ENTRY_URLS,
    XhsAccountLogin: accountLogin,
    chrome: {
      tabs: {
        async create(details) {
          const tab = {
            id: nextTabId,
            status: 'complete',
            url: String(details && details.url || ''),
          };
          nextTabId += 1;
          tabs.set(tab.id, tab);
          createdTabIds.push(tab.id);
          return copy(tab);
        },
        async get(tabId) {
          const tab = tabs.get(Number(tabId));
          if (!tab) throw new Error('标签页已关闭。');
          return copy(tab);
        },
        async update(tabId, update) {
          const id = Number(tabId);
          const tab = Object.assign({}, tabs.get(id) || { id, status: 'complete' }, copy(update));
          tabs.set(id, tab);
          return copy(tab);
        },
      },
    },
    async queryUniqueXhsLoginTarget(selectedPlatform) {
      const matches = Array.from(tabs.values()).filter((tab) => (
        accountLogin.isPlatformOriginUrl(selectedPlatform, tab && tab.url)
      ));
      return matches.length === 1 ? copy(matches[0]) : null;
    },
    async waitTabComplete() {},
    async confirmXhsPlatformSession() {
      return null;
    },
    async submitXhsPasswordLogin(tabId, selectedPlatform) {
      submittedTabIds.push(Number(tabId));
      if (firstSubmission) {
        firstSubmission = false;
        const sentinel = tabs.get(Number(tabId));
        sentinel.url = loginOrigin + '/login?from=' + selectedPlatform;
        const error = batchError(
          'VERIFICATION_REQUIRED',
          '需要人工验证。',
          { tabId: Number(tabId), platform: selectedPlatform },
        );
        throw error;
      }
      return { tabId: Number(tabId), platform: selectedPlatform, state: 'loggedIn' };
    },
    async waitForProjectVerification(error) {
      verificationTabIds.push(Number(error && error.tabId));
      return { kind: 'login', frameId: 0 };
    },
    async assertVaultCredentialGeneration() {},
    async loginXingheAccount() {
      throw new Error('本契约不涉及星河。');
    },
    projectVerificationPlatformName() {
      return '蒲公英';
    },
    batchError,
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
  });

  const loginSource = sourceBlock(
    'async function ensureXhsPlatformSession',
    '\nconst ACCOUNT_RUN_SNAPSHOT_KEYS',
  );
  const preparationSource = sourceBlock(
    'async function prepareProjectPlatformSessions',
    '\nasync function runProjectTask',
  );
  vm.runInContext(
    loginSource + '\n' + preparationSource +
      '\nglobalThis.prepareProjectPlatformSessionsUnderTest = prepareProjectPlatformSessions;',
    context,
    { filename: 'xhs-verification-sentinel-tab-security.js' },
  );
  return { context, createdTabIds, submittedTabIds, verificationTabIds };
}

for (const loginOrigin of [
  'https://customer.xiaohongshu.com',
  'https://passport.xiaohongshu.com',
]) {
  const host = new URL(loginOrigin).hostname;
  test(`vault 验证从产品页重定向 ${host} 后 resume 复用 sentinel tabId`, async () => {
    const harness = createVerificationResumeHarness(loginOrigin);
    const result = await harness.context.prepareProjectPlatformSessionsUnderTest({
      vaultScopeId: 'local:test-vault',
      vaultLockEpoch: 7,
      platforms: ['pgy'],
      accounts: {
        taobao: null,
        xiaohongshu: {
          username: 'fixture@example.test',
          password: 'fixture-password',
        },
      },
    }, {
      async assertFreshVaultAuthorization() {},
    });

    assert.equal(result.xiaohongshu.state, 'loggedIn');
    assert.deepEqual(harness.verificationTabIds, [401], '验证等待必须绑定首次打开的 sentinel tabId。');
    assert.deepEqual(harness.createdTabIds, [401], 'resume 不得为同一平台新建第二个标签页。');
    assert.deepEqual(harness.submittedTabIds, [401, 401], '验证前后必须在同一 sentinel tabId 继续。');
    assert.equal(result.xiaohongshu.platforms.pgy.tabId, 401);
  });
}

function createCredentialDocumentHarness(kindAfterAuthorization) {
  const platform = 'pgy';
  const tabId = 501;
  const entryUrl = accountLogin.XHS_PLATFORM_ENTRY_URLS[platform];
  const loginUrl = 'https://customer.xiaohongshu.com/login?from=pgy';
  const events = [];
  let authorizationCount = 0;
  let document = {
    documentId: 'login-document-old',
    url: loginUrl,
    kind: 'login',
  };

  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    Error,
    Math,
    Number,
    Object,
    Promise,
    String,
    clearTimeout,
    setTimeout,
    XhsAccountLogin: accountLogin,
    chrome: {
      webNavigation: {
        async getAllFrames() {
          return [{
            frameId: 0,
            documentId: document.documentId,
            url: document.url,
          }];
        },
      },
      tabs: {
        async get() {
          return { id: tabId, status: 'complete', url: document.url };
        },
        async sendMessage(_tabId, message, options) {
          const messageType = String(message && message.type || '');
          if (messageType === 'XHS_LOGIN_GET_STATE') {
            events.push({
              type: 'state-read',
              afterAuthorization: authorizationCount > 0,
              documentId: document.documentId,
              kind: document.kind,
              options: copy(options),
            });
            if (options && options.documentId && options.documentId !== document.documentId) {
              throw new Error('消息目标已不是当前 document。');
            }
            return {
              ok: true,
              href: document.url,
              state: { kind: document.kind },
            };
          }
          if (messageType === 'XHS_LOGIN_FILL_PASSWORD') {
            events.push({
              type: 'credential-fill',
              currentDocumentId: document.documentId,
              options: copy(options),
            });
            document = {
              documentId: 'product-document',
              url: entryUrl,
              kind: 'loggedIn',
            };
            return { ok: true };
          }
          throw new Error('未预期的页面消息：' + messageType);
        },
      },
    },
    async ensureXhsLoginContentScript() {},
    async waitTabComplete() {},
    async waitMilliseconds() {},
    async waitMillisecondsWithSignal(_duration, signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
    batchText(value, limit) {
      return String(value == null ? '' : value).trim().slice(0, Number(limit) || 160);
    },
    batchError,
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
  });

  const sendSource = sourceBlock(
    'async function sendTabMessageWithRetry',
    '\nfunction wxtReportRouteDescriptor',
  );
  const loginStateSource = sourceBlock(
    'async function readXhsLoginState',
    '\nasync function ensureXhsPlatformSession',
  );
  vm.runInContext(
    sendSource + '\n' + loginStateSource +
      '\nglobalThis.submitXhsPasswordLoginUnderTest = submitXhsPasswordLogin;',
    context,
    { filename: 'xhs-credential-document-security.js' },
  );

  const authorize = async () => {
    authorizationCount += 1;
    events.push({ type: 'authorization' });
    if (authorizationCount === 1) {
      document = {
        documentId: 'login-document-new',
        url: loginUrl,
        kind: kindAfterAuthorization,
      };
    }
  };

  return { context, events, authorize };
}

test('XHS 明文凭据发送前 fresh re-read login 状态，并绑定导航后的 documentId', async () => {
  const harness = createCredentialDocumentHarness('login');
  await harness.context.submitXhsPasswordLoginUnderTest(501, 'pgy', {
    username: 'fixture@example.test',
    password: 'fixture-password',
  }, {
    assertCredentialAuthorization: harness.authorize,
  });

  const authorizationIndex = harness.events.findIndex((event) => event.type === 'authorization');
  const fillIndex = harness.events.findIndex((event) => event.type === 'credential-fill');
  const freshRead = harness.events.slice(authorizationIndex + 1, fillIndex).find((event) => (
    event.type === 'state-read' &&
    event.afterAuthorization === true &&
    event.kind === 'login' &&
    event.documentId === 'login-document-new'
  ));
  assert.ok(freshRead, '实际发送明文凭据前必须重读新 document，并再次确认 state=login。');
  assert.equal(freshRead.options.documentId, 'login-document-new', '登录状态重读必须绑定 documentId。');

  const fill = harness.events[fillIndex];
  assert.ok(fill, '应向确认后的登录 document 发送凭据。');
  assert.equal(fill.options.documentId, 'login-document-new', '凭据只能发往 fresh login documentId。');
  assert.notEqual(fill.options.documentId, 'login-document-old', '导航后旧 documentId 不得接收凭据。');
});

test('fresh re-read 发现新 document 已进入 verification 时不发送 XHS 明文凭据', async () => {
  const harness = createCredentialDocumentHarness('verification');
  await assert.rejects(
    harness.context.submitXhsPasswordLoginUnderTest(501, 'pgy', {
      username: 'fixture@example.test',
      password: 'fixture-password',
    }, {
      assertCredentialAuthorization: harness.authorize,
    }),
    (error) => error && error.code === 'VERIFICATION_REQUIRED',
  );
  assert.equal(
    harness.events.filter((event) => event.type === 'credential-fill').length,
    0,
    '新 document 不再是 login 时必须 fail closed，不得向旧 frame/document 补发凭据。',
  );
});
