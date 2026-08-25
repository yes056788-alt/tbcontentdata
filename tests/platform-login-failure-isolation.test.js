const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, 'missing source marker: ' + startMarker);
  assert.ok(end > start, 'missing source marker: ' + endMarker);
  return background.slice(start, end);
}

function optionalSourceBlock(startMarker, endMarker) {
  return background.includes(startMarker) ? sourceBlock(startMarker, endMarker) : '';
}

async function settlesWithin(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function loginFailure(platform, message) {
  return Object.assign(new Error(message), {
    code: 'LOGIN_FAILED',
    platform,
  });
}

function cancellationError(reason) {
  if (reason && reason.code === 'PROJECT_TASK_CANCELLED') return reason;
  const error = reason instanceof Error
    ? reason
    : new Error(String(reason || '任务已取消。'));
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}

function assertReady(item, platform) {
  assert.ok(item, platform + ' must preserve a preparation result');
  assert.notEqual(item.ok, false, platform + ' must remain runnable');
  assert.notEqual(item.state, 'failed', platform + ' must remain runnable');
}

function assertFailed(item, platform, messagePattern) {
  assert.ok(item, platform + ' must preserve its isolated failure');
  assert.ok(
    item.ok === false || item.state === 'failed',
    platform + ' must be marked failed without rejecting the whole preparation',
  );
  assert.match(
    String(item.message || item.error || item.reason || ''),
    messagePattern,
    platform + ' must keep the causal login error',
  );
}

function preparedPlatform(result, platform) {
  if (result && result.platforms && result.platforms[platform]) {
    return result.platforms[platform];
  }
  if (platform === 'adstar') return result && result.taobao;
  return result && result.xiaohongshu && result.xiaohongshu.platforms
    ? result.xiaohongshu.platforms[platform]
    : null;
}

function createXhsLoginHarness(failingPlatform, failureFactory) {
  const calls = [];
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
    async ensureXhsPlatformSession(platform) {
      calls.push(platform);
      if (platform === failingPlatform) {
        const failure = typeof failureFactory === 'function'
          ? failureFactory(platform)
          : loginFailure(platform, platform + ' fixture login failed');
        if (failure && typeof failure.then === 'function') return failure;
        throw failure;
      }
      return {
        ok: true,
        state: 'loggedIn',
        platform,
        tabId: platform === 'pgy' ? 21 : 22,
      };
    },
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
  });
  const source = sourceBlock(
    'async function loginXhsAccount',
    '\nconst ACCOUNT_RUN_SNAPSHOT_KEYS',
  );
  const watchdogSource = optionalSourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(
    watchdogSource + source + '\nglobalThis.loginXhsAccountUnderTest = loginXhsAccount;',
    context,
    { filename: 'xhs-login-failure-isolation.js' },
  );
  return { calls, context };
}

for (const scenario of [
  { hanging: 'pgy', surviving: 'juguang' },
  { hanging: 'juguang', surviving: 'pgy' },
]) {
  test(`XHS ${scenario.hanging} 登录准备永不结束时 watchdog 仅标记本平台失败并保留 ${scenario.surviving}`, async () => {
    const harness = createXhsLoginHarness(
      scenario.hanging,
      () => new Promise(() => {}),
    );

    const result = await settlesWithin(
      harness.context.loginXhsAccountUnderTest({}, {
        platforms: ['pgy', 'juguang'],
        sessionPreparationTimeoutMs: {
          pgy: 20,
          juguang: 20,
        },
      }),
      250,
      'XHS 平台登录存在永不 settle 的分支时，整体任务仍未结束。',
    );

    assert.deepEqual(harness.calls.slice().sort(), ['juguang', 'pgy']);
    assertFailed(
      result && result.platforms && result.platforms[scenario.hanging],
      scenario.hanging,
      /登录准备超时/,
    );
    assert.equal(
      result.platforms[scenario.hanging].code,
      'SESSION_PREPARE_TIMEOUT',
      'watchdog 超时必须保留稳定错误码',
    );
    assertReady(
      result && result.platforms && result.platforms[scenario.surviving],
      scenario.surviving,
    );
  });
}

test('XHS 真实任务取消在平台并发启动后仍保持全局抛出', async () => {
  const harness = createXhsLoginHarness('pgy', () => cancellationError('用户取消任务。'));

  await assert.rejects(
    harness.context.loginXhsAccountUnderTest({}, { platforms: ['pgy', 'juguang'] }),
    (error) => error && error.code === 'PROJECT_TASK_CANCELLED',
  );
  assert.deepEqual(
    harness.calls.slice().sort(),
    ['juguang', 'pgy'],
    '全局取消不得退化并发启动语义',
  );
});

for (const scenario of [
  { failing: 'pgy', surviving: 'juguang', message: /pgy fixture login failed/ },
  { failing: 'juguang', surviving: 'pgy', message: /juguang fixture login failed/ },
]) {
  test(`XHS ${scenario.failing} 登录失败不阻断 ${scenario.surviving} 登录准备`, async () => {
    const harness = createXhsLoginHarness(scenario.failing);
    let result;

    await assert.doesNotReject(async () => {
      result = await harness.context.loginXhsAccountUnderTest({}, {
        platforms: ['pgy', 'juguang'],
      });
    });

    assert.deepEqual(
      harness.calls.slice().sort(),
      ['juguang', 'pgy'],
      '两个产品登录都必须独立尝试',
    );
    assertFailed(result && result.platforms && result.platforms[scenario.failing],
      scenario.failing, scenario.message);
    assertReady(result && result.platforms && result.platforms[scenario.surviving],
      scenario.surviving);
  });
}

test('XHS 蒲公英和聚光在任一登录结果落定前均已启动，普通失败仅归属对应平台', async () => {
  const calls = [];
  const controls = new Map();
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
    ensureXhsPlatformSession(platform) {
      calls.push(platform);
      return new Promise((resolve, reject) => {
        controls.set(platform, { resolve, reject });
      });
    },
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
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
  vm.runInContext(
    watchdogSource + source + '\nglobalThis.loginXhsAccountUnderTest = loginXhsAccount;',
    context,
    { filename: 'xhs-login-parallel-start-isolation.js' },
  );

  const loginPromise = context.loginXhsAccountUnderTest({}, {
    platforms: ['pgy', 'juguang'],
  });
  await Promise.resolve();

  let launchFailure = null;
  try {
    assert.deepEqual(
      calls.slice().sort(),
      ['juguang', 'pgy'],
      '两个平台必须在任一登录 Promise resolve/reject 前都已启动',
    );
  } catch (error) {
    launchFailure = error;
  }

  controls.get('pgy').reject(loginFailure('pgy', 'pgy parallel fixture login failed'));
  for (let turn = 0; turn < 8 && !controls.has('juguang'); turn += 1) {
    await Promise.resolve();
  }
  assert.ok(controls.has('juguang'), '普通平台失败后仍必须尝试另一平台');
  controls.get('juguang').resolve({
    ok: true,
    state: 'loggedIn',
    platform: 'juguang',
    tabId: 22,
  });

  const result = await loginPromise;
  assertFailed(result && result.platforms && result.platforms.pgy,
    'pgy', /pgy parallel fixture login failed/);
  assertReady(result && result.platforms && result.platforms.juguang, 'juguang');
  if (launchFailure) throw launchFailure;
});

test('XHS 验证码错误立即抢占永不 settle 的兄弟平台并保持 VERIFICATION_REQUIRED', async () => {
  const calls = [];
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
    async ensureXhsPlatformSession(platform) {
      calls.push(platform);
      if (platform === 'pgy') {
        const error = new Error('蒲公英需要人工验证。');
        error.code = 'VERIFICATION_REQUIRED';
        error.tabId = 27;
        throw error;
      }
      return new Promise(() => {});
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
  });
  const watchdogSource = sourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  const source = sourceBlock(
    'async function loginXhsAccount',
    '\nconst ACCOUNT_RUN_SNAPSHOT_KEYS',
  );
  vm.runInContext(
    watchdogSource + source + '\nglobalThis.loginXhsAccountUnderTest = loginXhsAccount;',
    context,
    { filename: 'xhs-login-verification-hung-sibling.js' },
  );

  await settlesWithin(assert.rejects(
    context.loginXhsAccountUnderTest({}, { platforms: ['pgy', 'juguang'] }),
    (error) => error && error.code === 'VERIFICATION_REQUIRED' &&
      error.platform === 'pgy' && error.tabId === 27,
  ), 250, '验证码错误未能抢占永不 settle 的兄弟平台。');
  assert.deepEqual(calls.slice().sort(), ['juguang', 'pgy']);
});

function createPreparationHarness(failingFamily) {
  const calls = [];
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
    chrome: {
      tabs: {
        async update(tabId, update) {
          return { id: tabId, ...update };
        },
      },
    },
    async assertVaultCredentialGeneration() {},
    async loginXingheAccount() {
      calls.push('adstar');
      if (failingFamily === 'taobao-timeout') {
        return new Promise(() => {});
      }
      if (failingFamily === 'authorization') {
        throw cancellationError('账号库授权已失效。');
      }
      if (failingFamily === 'taobao') {
        throw loginFailure('adstar', '星河 fixture 登录失败');
      }
      return { ok: true, state: 'loggedIn', noPermission: false, tabId: 11 };
    },
    async loginXhsAccount() {
      calls.push('xiaohongshu');
      if (failingFamily === 'xiaohongshu') {
        throw loginFailure('pgy', '蒲公英 fixture 登录失败');
      }
      return {
        state: 'loggedIn',
        platforms: {
          pgy: { ok: true, state: 'loggedIn', tabId: 21 },
          juguang: { ok: true, state: 'loggedIn', tabId: 22 },
        },
      };
    },
    async waitForProjectVerification() {
      throw new Error('普通登录失败不应进入验证等待。');
    },
    projectVerificationPlatformName(platform) {
      return platform === 'adstar' ? '星河' : (platform === 'pgy' ? '蒲公英' : '聚光');
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
  });
  const source = sourceBlock(
    'async function prepareProjectPlatformSessions',
    '\nasync function runProjectTask',
  );
  const watchdogSource = optionalSourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(
    watchdogSource + source +
      '\nglobalThis.prepareProjectPlatformSessionsUnderTest = prepareProjectPlatformSessions;',
    context,
    { filename: 'platform-preparation-failure-isolation.js' },
  );
  return { calls, context };
}

function credentialPlan() {
  return {
    vaultScopeId: 'local:test-vault',
    vaultLockEpoch: 7,
    platforms: ['adstar', 'pgy', 'juguang'],
    accounts: {
      taobao: { username: 'taobao-fixture', password: 'taobao-password' },
      xiaohongshu: { username: 'xhs-fixture', password: 'xhs-password' },
    },
  };
}

test('星河登录失败作为平台结果返回，不 abort 蒲公英和聚光准备', async () => {
  const harness = createPreparationHarness('taobao');
  let result;

  await assert.doesNotReject(async () => {
    result = await harness.context.prepareProjectPlatformSessionsUnderTest(credentialPlan(), {
      async assertFreshVaultAuthorization() {},
    });
  });

  assert.deepEqual(harness.calls.slice().sort(), ['adstar', 'xiaohongshu']);
  assertFailed(preparedPlatform(result, 'adstar'), 'adstar', /星河 fixture 登录失败/);
  assertReady(preparedPlatform(result, 'pgy'), 'pgy');
  assertReady(preparedPlatform(result, 'juguang'), 'juguang');
});

test('星河登录准备永不结束时 watchdog 标记星河失败且蒲公英和聚光仍成功', async () => {
  const harness = createPreparationHarness('taobao-timeout');

  const result = await settlesWithin(
    harness.context.prepareProjectPlatformSessionsUnderTest(credentialPlan(), {
      async assertFreshVaultAuthorization() {},
      sessionPreparationTimeoutMs: {
        adstar: 20,
        pgy: 20,
        juguang: 20,
      },
    }),
    250,
    '星河登录存在永不 settle 的分支时，平台准备整体仍未结束。',
  );

  assert.deepEqual(harness.calls.slice().sort(), ['adstar', 'xiaohongshu']);
  assertFailed(preparedPlatform(result, 'adstar'), 'adstar', /登录准备超时/);
  assert.equal(preparedPlatform(result, 'adstar').code, 'SESSION_PREPARE_TIMEOUT');
  assertReady(preparedPlatform(result, 'pgy'), 'pgy');
  assertReady(preparedPlatform(result, 'juguang'), 'juguang');
});

for (const scenario of [
  { hangingAuthorizationCall: 1, hangingFamily: 'adstar', survivingFamily: 'xiaohongshu' },
  { hangingAuthorizationCall: 2, hangingFamily: 'xiaohongshu', survivingFamily: 'adstar' },
]) {
  test(`${scenario.hangingFamily} 授权读取永不结束时 watchdog 仍启动 ${scenario.survivingFamily}`, async () => {
    const harness = createPreparationHarness('none');
    let authorizationCalls = 0;

    const result = await settlesWithin(
      harness.context.prepareProjectPlatformSessionsUnderTest(credentialPlan(), {
        async assertFreshVaultAuthorization() {
          authorizationCalls += 1;
          if (authorizationCalls === scenario.hangingAuthorizationCall) {
            return new Promise(() => {});
          }
        },
        sessionPreparationTimeoutMs: {
          adstar: 20,
          pgy: 20,
          juguang: 20,
        },
      }),
      250,
      '账号库授权读取永不 settle 时，平台准备整体仍未结束。',
    );

    assert.equal(authorizationCalls, 2, '两个 family 授权边界必须并行尝试');
    if (scenario.hangingFamily === 'adstar') {
      assertFailed(preparedPlatform(result, 'adstar'), 'adstar', /登录准备超时/);
      assertReady(preparedPlatform(result, 'pgy'), 'pgy');
      assertReady(preparedPlatform(result, 'juguang'), 'juguang');
      assert.deepEqual(harness.calls, ['xiaohongshu']);
    } else {
      assertReady(preparedPlatform(result, 'adstar'), 'adstar');
      assertFailed(preparedPlatform(result, 'pgy'), 'pgy', /登录准备超时/);
      assertFailed(preparedPlatform(result, 'juguang'), 'juguang', /登录准备超时/);
      assert.deepEqual(harness.calls, ['adstar']);
    }
  });
}

test('小红书登录失败作为平台结果返回，不 abort 星河准备', async () => {
  const harness = createPreparationHarness('xiaohongshu');
  let result;

  await assert.doesNotReject(async () => {
    result = await harness.context.prepareProjectPlatformSessionsUnderTest(credentialPlan(), {
      async assertFreshVaultAuthorization() {},
    });
  });

  assert.deepEqual(harness.calls.slice().sort(), ['adstar', 'xiaohongshu']);
  assertReady(preparedPlatform(result, 'adstar'), 'adstar');
  assertFailed(preparedPlatform(result, 'pgy'), 'pgy', /蒲公英 fixture 登录失败/);
});

test('账号库授权失效仍作为全局安全中止抛出', async () => {
  const harness = createPreparationHarness('authorization');

  await assert.rejects(
    harness.context.prepareProjectPlatformSessionsUnderTest(credentialPlan(), {
      async assertFreshVaultAuthorization() {},
    }),
    (error) => error && error.code === 'PROJECT_TASK_CANCELLED' && /授权.*失效/.test(error.message),
  );
});
