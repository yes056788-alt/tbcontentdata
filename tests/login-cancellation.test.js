const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const xhsLoginContent = fs.readFileSync(path.join(root, 'xiaohongshu-login-content.js'), 'utf8');

function messageHelperHarness(sendMessage, options = {}) {
  const start = background.indexOf('async function sendTabMessageWithRetry');
  const end = background.indexOf('\nfunction wxtReportRouteDescriptor', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  let now = 0;
  class FakeDate extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    Array,
    Date: options.fakeClock ? FakeDate : Date,
    Error,
    Promise,
    chrome: {
      tabs: {
        async sendMessage(...args) {
          calls.push(args);
          return sendMessage(...args);
        },
      },
    },
    throwIfProjectTaskCancelled(signal) {
      if (!signal || !signal.aborted) return;
      const error = new Error('任务已取消。');
      error.code = 'PROJECT_TASK_CANCELLED';
      throw error;
    },
    raceWithProjectTaskSignal(promise, signal) {
      if (!signal) return Promise.resolve(promise);
      if (signal.aborted) {
        const error = new Error('任务已取消。');
        error.code = 'PROJECT_TASK_CANCELLED';
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => {
          const error = new Error('任务已取消。');
          error.code = 'PROJECT_TASK_CANCELLED';
          finish(reject, error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        );
      });
    },
    async waitMilliseconds(milliseconds) {
      if (options.fakeClock) now += Math.max(0, Number(milliseconds) || 0);
    },
    async waitMillisecondsWithSignal(ms, signal) {
      if (signal && signal.aborted) {
        const error = new Error('任务已取消。');
        error.code = 'PROJECT_TASK_CANCELLED';
        throw error;
      }
      if (options.fakeClock) now += Math.max(0, Number(ms) || 0);
    },
  });
  vm.runInContext(
    background.slice(start, end) + '\nglobalThis.sendWithRetry = sendTabMessageWithRetry;',
    context,
    { filename: 'login-message-cancellation.js' },
  );
  return { calls, context };
}

test('an already-cancelled login task never sends credentials to a page', async () => {
  const harness = messageHelperHarness(async () => ({ ok: true }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    harness.context.sendWithRetry(11, {
      type: 'XHS_LOGIN_FILL_PASSWORD',
      username: 'CANCEL-USERNAME-SENTINEL',
      password: 'CANCEL-PASSWORD-SENTINEL',
    }, 15000, { frameId: 0 }, controller.signal),
    /\u4efb\u52a1\u5df2\u53d6\u6d88/,
  );
  assert.equal(harness.calls.length, 0);
});

test('a credential retry reauthorizes before every physical send and blocks after revocation', async () => {
  let authorizationChecks = 0;
  let revoked = false;
  const harness = messageHelperHarness(async () => {
    revoked = true;
    throw new Error('Could not establish connection. Receiving end does not exist.');
  }, { fakeClock: true });

  await assert.rejects(
    harness.context.sendWithRetry(13, {
      type: 'XINGHE_FILL_LOGIN',
      username: 'RETRY-USERNAME-SENTINEL',
      password: 'RETRY-PASSWORD-SENTINEL',
    }, 5000, { frameId: 0 }, null, async () => {
      authorizationChecks += 1;
      if (revoked) throw new Error('团队成员已停用。');
    }),
    /停用/,
  );

  assert.equal(authorizationChecks, 2,
    '第二次尝试必须重新校验服务端授权。');
  const plaintextSends = harness.calls.filter((call) => (
    call[1] && call[1].type === 'XINGHE_FILL_LOGIN' &&
    call[1].password === 'RETRY-PASSWORD-SENTINEL'
  ));
  assert.equal(plaintextSends.length, 1,
    '首发失败后撤权，不得第二次发送明文密码。');
});

test('cancellation while a page message is pending rejects before login can continue', async () => {
  const harness = messageHelperHarness(() => new Promise(() => {}));
  const controller = new AbortController();
  const running = harness.context.sendWithRetry(12, {
    type: 'XHS_LOGIN_OPEN_ACCOUNT',
  }, 15000, { frameId: 0 }, controller.signal);
  while (!harness.calls.length) await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  const outcome = await Promise.race([
    running.then(
      () => ({ status: 'resolved' }),
      (error) => ({ status: 'rejected', error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 80)),
  ]);
  assert.equal(outcome.status, 'rejected',
    'abort 必须在页面消息永不回包时仍立即 reject。');
  assert.equal(outcome.error && outcome.error.code, 'PROJECT_TASK_CANCELLED');
  assert.equal(harness.calls.length, 2, '取消时只能追加一条页面操作取消消息。');
  assert.equal(harness.calls[0][1].type, 'XHS_LOGIN_OPEN_ACCOUNT');
  assert.equal(harness.calls[1][1].type, 'XHS_LOGIN_CANCEL');
  assert.ok(harness.calls[0][1].operationId);
  assert.equal(harness.calls[1][1].operationId, harness.calls[0][1].operationId,
    '取消消息必须精确绑定未回包的登录操作。');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.calls.map((call) => call[1].type), [
    'XHS_LOGIN_OPEN_ACCOUNT',
    'XHS_LOGIN_CANCEL',
  ], '取消后不得重试或继续到密码提交步骤。');
});

test('XHS content script cancel protocol stops a pending password-login operation',
  { timeout: 1000 }, async () => {
    let listener = null;
    const accountInput = {
      type: 'email', name: 'email', id: '', placeholder: '邮箱', value: '', disabled: false,
      offsetParent: {}, getAttribute() { return ''; },
      dispatchEvent() { return true; }, getBoundingClientRect() { return { width: 120, height: 32 }; },
    };
    const passwordInput = {
      type: 'password', name: 'password', id: '', placeholder: '密码', value: '', disabled: false,
      offsetParent: {}, getAttribute() { return ''; },
      dispatchEvent() { return true; }, getBoundingClientRect() { return { width: 120, height: 32 }; },
    };
    const accountMode = {
      textContent: '账号登录', innerText: '账号登录', disabled: false, offsetParent: {}, clicked: false,
      getAttribute() { return ''; },
      click() {
        this.clicked = true;
        this.textContent = '';
        this.innerText = '';
      },
      getBoundingClientRect() { return { width: 120, height: 32 }; },
    };
    const submit = {
      textContent: '登录', innerText: '登录', disabled: false, offsetParent: {}, clicked: false,
      getAttribute() { return ''; }, click() { this.clicked = true; },
      getBoundingClientRect() { return { width: 120, height: 32 }; },
    };
    const document = {
      readyState: 'complete',
      body: { innerText: '账号登录 邮箱 密码', textContent: '账号登录 邮箱 密码' },
      querySelectorAll(selector) {
        if (selector === 'input') return [accountInput, passwordInput];
        if (selector.includes('button') || selector.includes('[role="button"]') || selector.includes('a')) {
          return [accountMode, submit];
        }
        return [];
      },
    };
    const context = vm.createContext({
      URL,
      module: { exports: {} },
      exports: {},
      document,
      location: {
        href: 'https://customer.xiaohongshu.com/login',
        origin: 'https://customer.xiaohongshu.com',
        pathname: '/login',
      },
      chrome: {
        runtime: {
          id: 'fixture-extension',
          onMessage: { addListener(callback) { listener = callback; } },
        },
      },
      setTimeout,
      clearTimeout,
    });
    vm.runInContext(xhsLoginContent, context, { filename: 'xiaohongshu-login-content.js' });
    assert.equal(typeof listener, 'function');

    const dispatch = (message) => new Promise((resolve) => {
      listener(message, { id: 'fixture-extension' }, resolve);
    });
    const pendingFill = dispatch({
      type: 'XHS_LOGIN_FILL_PASSWORD',
      operationId: 'fixture-login-operation',
      username: 'CANCEL-USERNAME-SENTINEL',
      password: 'CANCEL-PASSWORD-SENTINEL',
    });
    while (!accountMode.clicked) await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelResult = await dispatch({
      type: 'XHS_LOGIN_CANCEL',
      operationId: 'fixture-login-operation',
    });
    const fillResult = await pendingFill;

    assert.equal(cancelResult && cancelResult.ok, true,
      '内容脚本必须明确接收并确认 XHS_LOGIN_CANCEL。');
    assert.equal(fillResult && fillResult.ok, false,
      '被取消的密码登录不得报告提交成功。');
    assert.equal(accountInput.value, '');
    assert.equal(passwordInput.value, '');
    assert.equal(submit.clicked, false, '取消后不得继续点击登录。');
  });

test('both password login adapters pass the shared project AbortSignal into page messaging', () => {
  assert.match(
    background,
    /type: 'XINGHE_FILL_LOGIN'[\s\S]{0,300}\}, signal, authorizeCredentialSend\);/,
  );
  assert.match(
    background,
    /type: 'XHS_LOGIN_FILL_PASSWORD'[\s\S]{0,420}\}, 15000, credentialTarget, signal, authorizeCredentialSend\);/,
  );
});
