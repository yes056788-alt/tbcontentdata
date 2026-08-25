const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function helperSource() {
  const start = background.indexOf('async function waitForProjectVerification');
  const end = background.indexOf('\nasync function prepareProjectPlatformSessions', start);
  assert.ok(start >= 0 && end > start,
    'background.js must define waitForProjectVerification immediately before prepareProjectPlatformSessions');
  return background.slice(start, end);
}

function cancellationError(reason) {
  if (reason && reason.code === 'PROJECT_TASK_CANCELLED') return reason;
  const error = new Error(reason && reason.message || String(reason || '任务已取消。'));
  error.name = 'AbortError';
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}

function createHarness() {
  const releaseChallenge = deferred();
  const waitStarted = deferred();
  const activations = [];
  const xingheWaits = [];
  const xhsWaits = [];
  const xingheStates = [
    { kind: 'verification', frameId: 0 },
    { kind: 'loading', frameId: 0 },
    { kind: 'loggedIn', frameId: 0 },
  ];
  const xhsStates = [
    { kind: 'verification', frameId: 0 },
    { kind: 'loading', frameId: 0 },
    { kind: 'productReady', frameId: 0 },
  ];

  const waitUntilReleased = async (signal) => {
    waitStarted.resolve();
    if (signal && signal.aborted) throw cancellationError(signal.reason);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, cancellationError(signal && signal.reason));
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      releaseChallenge.promise.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
    if (signal && signal.aborted) throw cancellationError(signal.reason);
  };

  const readStateSequence = async (states, signal, predicate) => {
    waitStarted.resolve();
    while (states.length) {
      const state = states.shift();
      if (!states.length) await waitUntilReleased(signal);
      if (!predicate || predicate(state)) return state;
    }
    throw new Error('验证状态序列已耗尽。');
  };

  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    Number,
    Object,
    Promise,
    String,
    chrome: {
      tabs: {
        async update(tabId, update) {
          activations.push({ tabId, update: { ...update } });
          return { id: tabId, ...update };
        },
      },
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
    async waitMilliseconds() {},
    async waitMillisecondsWithSignal(duration, signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
    async waitForXingheState(tabId, predicate, timeoutMs, signal) {
      xingheWaits.push({ tabId, predicate, timeoutMs, signal });
      return readStateSequence(xingheStates, signal, predicate);
    },
    async waitForXhsLoginState(tabId, platform, predicate, timeoutMs, signal) {
      xhsWaits.push({ tabId, platform, predicate, timeoutMs, signal });
      return readStateSequence(xhsStates, signal, predicate);
    },
  });
  vm.runInContext(
    helperSource() + '\nglobalThis.waitForProjectVerificationUnderTest = waitForProjectVerification;',
    context,
    { filename: 'project-verification-wait.js' },
  );

  return {
    activations,
    context,
    releaseChallenge,
    waitStarted,
    xhsWaits,
    xingheWaits,
  };
}

test('Xinghe verification wait activates the challenge tab and resolves only after verification clears', async () => {
  const harness = createHarness();
  const controller = new AbortController();
  const waiting = harness.context.waitForProjectVerificationUnderTest(Object.assign(
    new Error('星河需要人工安全验证。'),
    { code: 'VERIFICATION_REQUIRED', tabId: 41 },
  ), {
    platform: 'adstar',
    signal: controller.signal,
  });

  await harness.waitStarted.promise;
  assert.deepEqual(harness.activations, [{ tabId: 41, update: { active: true } }]);
  assert.ok(harness.xingheWaits.length >= 1);
  assert.equal(harness.xhsWaits.length, 0);
  assert.equal(harness.xingheWaits[0].signal, controller.signal);

  harness.releaseChallenge.resolve();
  const state = await waiting;
  assert.equal(state.kind, 'loggedIn');
});

for (const platform of ['pgy', 'juguang']) {
  test(`${platform} verification wait uses the matching Xiaohongshu platform state reader`, async () => {
    const harness = createHarness();
    const waiting = harness.context.waitForProjectVerificationUnderTest(Object.assign(
      new Error('小红书登录需要人工安全验证。'),
      { code: 'VERIFICATION_REQUIRED', tabId: 51 },
    ), {
      platform,
      signal: new AbortController().signal,
    });

    await harness.waitStarted.promise;
    assert.deepEqual(harness.activations, [{ tabId: 51, update: { active: true } }]);
    assert.equal(harness.xingheWaits.length, 0);
    assert.ok(harness.xhsWaits.length >= 1);
    assert.equal(harness.xhsWaits[0].platform, platform);

    harness.releaseChallenge.resolve();
    const state = await waiting;
    assert.equal(state.kind, 'productReady');
  });
}

test('cancelling a project task aborts an active verification wait', async () => {
  const harness = createHarness();
  const controller = new AbortController();
  const waiting = harness.context.waitForProjectVerificationUnderTest(Object.assign(
    new Error('星河需要人工安全验证。'),
    { code: 'VERIFICATION_REQUIRED', tabId: 61 },
  ), {
    platform: 'adstar',
    signal: controller.signal,
  });

  await harness.waitStarted.promise;
  const reason = cancellationError('用户取消任务。');
  controller.abort(reason);
  await assert.rejects(waiting, (error) => error && error.code === 'PROJECT_TASK_CANCELLED');
  assert.ok(harness.xingheWaits.length >= 1);
});

test('verification wait rejects unrelated errors and unsupported platforms before activating a tab', async () => {
  const harness = createHarness();
  const unrelated = Object.assign(new Error('星河账号或密码错误。'), {
    code: 'LOGIN_FAILED',
    tabId: 71,
  });
  await assert.rejects(
    harness.context.waitForProjectVerificationUnderTest(unrelated, { platform: 'adstar' }),
    (error) => error === unrelated,
  );
  await assert.rejects(
    harness.context.waitForProjectVerificationUnderTest(Object.assign(
      new Error('需要验证。'),
      { code: 'VERIFICATION_REQUIRED', tabId: 72 },
    ), { platform: 'unknown' }),
  );
  assert.equal(harness.activations.length, 0);
  assert.equal(harness.xingheWaits.length, 0);
  assert.equal(harness.xhsWaits.length, 0);
});
