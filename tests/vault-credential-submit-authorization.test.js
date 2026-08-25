const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'missing source block: ' + startMarker);
  return background.slice(start, end);
}

function cancellationError(reason) {
  const error = reason instanceof Error ? reason : new Error(String(reason || '任务已取消。'));
  error.name = 'AbortError';
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}

test('Xinghe reauthorizes after navigation wait and before sending plaintext credentials', async () => {
  let releaseNavigation;
  const navigation = new Promise((resolve) => { releaseNavigation = resolve; });
  const sent = [];
  let authorizationCalls = 0;
  const context = vm.createContext({
    Boolean,
    Date,
    Error,
    Number,
    Promise,
    async prepareXingheTab() { return 41; },
    async waitForXingheState() {
      await navigation;
      return { kind: 'login', frameId: 0 };
    },
    async resolveXinghePendingState(tabId, state) { return state; },
    checkXingheBlockingState() {},
    async logoutXinghe() {},
    async waitMilliseconds() {},
    async waitMillisecondsWithSignal() {},
    async sendTabMessageWithRetry(tabId, message, timeoutMs, messageOptions, signal, beforeEachSend) {
      if (beforeEachSend) await beforeEachSend();
      sent.push(message);
      throw new Error('明文凭据已被发送。');
    },
    batchError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled() {},
  });
  vm.runInContext(
    sourceBlock('async function loginXingheAccount', '\nasync function queryUniqueXhsLoginTarget') +
      '\nglobalThis.loginUnderTest = loginXingheAccount;',
    context,
    { filename: 'xinghe-submit-live-authorization.js' },
  );

  const running = context.loginUnderTest({
    username: 'XINGHE-PLAINTEXT-USERNAME',
    password: 'XINGHE-PLAINTEXT-PASSWORD',
  }, {
    resume: false,
    async assertCredentialAuthorization() {
      authorizationCalls += 1;
      throw cancellationError('团队成员已停用。');
    },
  });
  releaseNavigation();

  await assert.rejects(running, /停用/);
  assert.equal(authorizationCalls, 1);
  assert.equal(sent.length, 0, '撤权后不得发出 XINGHE_FILL_LOGIN 明文消息');
});

test('XHS reauthorizes after login-form wait and before sending plaintext credentials', async () => {
  let releaseLoginForm;
  const loginForm = new Promise((resolve) => { releaseLoginForm = resolve; });
  const sent = [];
  let authorizationCalls = 0;
  const context = vm.createContext({
    Date,
    Error,
    Promise,
    async waitForXhsLoginState() {
      await loginForm;
      return { kind: 'login', frameId: 0 };
    },
    checkXhsLoginBlockingState() {},
    async confirmXhsPlatformSession() { return null; },
    async readXhsLoginState() { return { kind: 'login', frameId: 0 }; },
    async sendTabMessageWithRetry(tabId, message, timeoutMs, messageOptions, signal, beforeEachSend) {
      if (beforeEachSend) await beforeEachSend();
      sent.push(message);
      throw new Error('明文凭据已被发送。');
    },
    batchError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled() {},
    waitMilliseconds() { return Promise.resolve(); },
    waitMillisecondsWithSignal() { return Promise.resolve(); },
    chrome: { tabs: { async get() { return { url: 'https://pgy.xiaohongshu.com/' }; } } },
    XhsAccountLogin: { isExpectedPlatformUrl() { return true; } },
  });
  vm.runInContext(
    sourceBlock('async function submitXhsPasswordLogin', '\nasync function ensureXhsPlatformSession') +
      '\nglobalThis.submitUnderTest = submitXhsPasswordLogin;',
    context,
    { filename: 'xhs-submit-live-authorization.js' },
  );

  const running = context.submitUnderTest(51, 'pgy', {
    username: 'XHS-PLAINTEXT-USERNAME',
    password: 'XHS-PLAINTEXT-PASSWORD',
  }, {
    async assertCredentialAuthorization() {
      authorizationCalls += 1;
      throw cancellationError('团队成员已停用。');
    },
  });
  releaseLoginForm();

  await assert.rejects(running, /停用/);
  assert.equal(authorizationCalls, 1);
  assert.equal(sent.length, 0, '撤权后不得发出 XHS_LOGIN_FILL_PASSWORD 明文消息');
});
