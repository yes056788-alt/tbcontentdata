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

function createHarness(options = {}) {
  const calls = [];
  const context = vm.createContext({
    AbortController,
    clearTimeout,
    setTimeout,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw signal.reason || new Error('任务已取消。');
    },
    async ensureXhsPlatformSession(platform) {
      calls.push({ type: 'ensure', platform });
      if (options.verificationPlatform === platform) {
        const error = new Error('需要人工验证。');
        error.code = 'VERIFICATION_REQUIRED';
        error.tabId = 27;
        throw error;
      }
      return { state: 'loggedIn', tabId: platform === 'pgy' ? 21 : 22 };
    },
  });
  const source = sourceBlock(
    'async function loginXhsAccount',
    '\nconst ACCOUNT_RUN_SNAPSHOT_KEYS',
  );
  const watchdogSource = sourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(watchdogSource + source +
    '\nglobalThis.loginXhsAccountUnderTest = loginXhsAccount;', context, {
    filename: 'xhs-login-resume.js',
  });
  return { calls, context };
}

test('normal XHS login opens both official products directly', async () => {
  const harness = createHarness();
  const result = await harness.context.loginXhsAccountUnderTest({}, {
    platforms: ['pgy', 'juguang'],
  });
  assert.equal(result.state, 'loggedIn');
  assert.deepEqual(harness.calls, [
    { type: 'ensure', platform: 'pgy' },
    { type: 'ensure', platform: 'juguang' },
  ]);
});

test('verification resume continues through the same direct product sessions', async () => {
  const harness = createHarness();
  const result = await harness.context.loginXhsAccountUnderTest({}, {
    platforms: ['pgy', 'juguang'],
    resume: true,
  });
  assert.equal(result.state, 'loggedIn');
  assert.deepEqual(harness.calls, [
    { type: 'ensure', platform: 'pgy' },
    { type: 'ensure', platform: 'juguang' },
  ]);
});

test('XHS verification errors are annotated with the product that owns the challenge tab', async () => {
  const harness = createHarness({ verificationPlatform: 'pgy' });
  await assert.rejects(
    harness.context.loginXhsAccountUnderTest({}, { platforms: ['pgy', 'juguang'] }),
    (error) => error && error.code === 'VERIFICATION_REQUIRED' &&
      error.platform === 'pgy' && error.tabId === 27,
  );
});

test('XHS 一端进入验证时先停止并发登录操作，再向上层暂停任务', async () => {
  let siblingStarted = false;
  let siblingCancelled = false;
  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Error,
    Number,
    Object,
    Promise,
    Set,
    String,
    clearTimeout,
    setTimeout,
    throwIfProjectTaskCancelled(signal) {
      if (!signal || !signal.aborted) return;
      const error = new Error(String(signal.reason && signal.reason.message || '任务已取消。'));
      error.code = 'PROJECT_TASK_CANCELLED';
      throw error;
    },
    async ensureXhsPlatformSession(platform, account, options) {
      if (platform === 'pgy') {
        await Promise.resolve();
        const error = new Error('需要人工验证。');
        error.code = 'VERIFICATION_REQUIRED';
        error.tabId = 27;
        throw error;
      }
      siblingStarted = true;
      return new Promise((resolve, reject) => {
        const signal = options && options.signal;
        if (!signal) return;
        const cancel = () => {
          siblingCancelled = true;
          const error = new Error('并发登录已暂停。');
          error.code = 'PROJECT_TASK_CANCELLED';
          reject(error);
        };
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
      });
    },
  });
  const source = sourceBlock(
    'async function loginXhsAccount',
    '\nconst ACCOUNT_RUN_SNAPSHOT_KEYS',
  );
  const watchdogSource = sourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(watchdogSource + source +
    '\nglobalThis.loginXhsAccountUnderTest = loginXhsAccount;', context, {
    filename: 'xhs-login-verification-parallel-pause.js',
  });

  await assert.rejects(
    context.loginXhsAccountUnderTest({}, { platforms: ['pgy', 'juguang'] }),
    (error) => error && error.code === 'VERIFICATION_REQUIRED' && error.platform === 'pgy',
  );
  assert.equal(siblingStarted, true);
  assert.equal(siblingCancelled, true,
    '验证暂停前必须取消另一个正在进行的密码操作，不得留在后台继续。');
});
