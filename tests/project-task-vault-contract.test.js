const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const accountLogin = require('../xhs/account-login');

const ACCOUNT_VAULT_SESSION_KEY = 'taobaoAccountVaultSessionV1';
const ACCOUNT_VAULT_LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';
const PROJECT_TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
const STORE_RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
const STORE_RUN_KEY_PREFIX = 'taobaoStoreRunV1:';
const USERNAME_SENTINEL = 'VAULT-USERNAME-SENTINEL@example.test';
const PASSWORD_SENTINEL = 'VAULT-PASSWORD-SENTINEL';
const VAULT_SCOPE_ID = 'team:https://tbdata.aizicheng.com';

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'missing source block: ' + startMarker);
  return background.slice(start, end);
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function vaultFixture() {
  return {
    schema: 4,
    stores: [{
      id: 'store-1',
      name: '测试旗舰店',
      groupId: 'group-1',
      credentialBindings: {
        taobaoAccountId: 'taobao-1',
        xiaohongshuAccountId: 'xhs-1',
      },
    }],
    accounts: [
      {
        id: 'taobao-1',
        label: '旗舰店淘宝主账号',
        platform: 'taobao',
        storeId: 'store-1',
        username: USERNAME_SENTINEL,
        password: PASSWORD_SENTINEL,
        roleKeyword: '品牌',
        enabled: true,
      },
      {
        id: 'xhs-1',
        label: '旗舰店小红书账号',
        platform: 'xiaohongshu',
        storeId: 'store-1',
        username: 'XHS-' + USERNAME_SENTINEL,
        password: 'XHS-' + PASSWORD_SENTINEL,
        enabled: true,
      },
    ],
  };
}

function createHarness(options = {}) {
  const vault = options.vault || vaultFixture();
  const events = [];
  const localState = {};
  const localWrites = [];
  const localRemovals = [];
  const sessionReads = [];
  const credentialPlans = [];
  const taobaoLogins = [];
  const xhsLogins = [];
  const reportCalls = [];
  const currentSessionPreflights = [];
  const freshAuthorizationCalls = [];
  const verificationWaits = [];
  const activatedTabs = [];
  const taobaoGate = deferred();
  const xhsGate = deferred();
  const reportGate = deferred();
  const verificationGate = options.verificationGate || deferred();
  const verificationGates = options.verificationGates && typeof options.verificationGates === 'object'
    ? options.verificationGates
    : {};
  const collectionVerificationPlatforms = Array.isArray(options.collectionVerificationPlatforms)
    ? options.collectionVerificationPlatforms.slice()
    : [];
  let collectionVerificationStarted = false;
  const vaultLockEpoch = Number.isSafeInteger(options.vaultLockEpoch) ? options.vaultLockEpoch : 7;
  localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY] = vaultLockEpoch;
  const sessionState = options.unlocked === false
    ? {}
    : {
      [ACCOUNT_VAULT_SESSION_KEY]: {
        schema: 5,
        vaultScopeId: options.sessionVaultScopeId || VAULT_SCOPE_ID,
        vaultLockEpoch,
        vault,
        unlockedAt: 1893456000000,
      },
    };
  const loginApi = Object.assign({}, accountLogin, {
    resolveCredentialPlan(vaultValue, request) {
      const plan = accountLogin.resolveCredentialPlan(vaultValue, request);
      credentialPlans.push(plan);
      events.push('credentials:resolved:' + plan.store.id);
      return plan;
    },
  });
  async function assertFreshVaultAuthorization() {
    freshAuthorizationCalls.push(Date.now());
    if (typeof options.authorize === 'function') {
      return options.authorize(freshAuthorizationCalls.length);
    }
    return { checkedAt: Date.now() };
  }

  async function waitForLoginGate(gate, signal) {
    if (!signal) return gate.promise;
    if (signal.aborted) throw signal.reason || new Error('登录准备已取消。');
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => finish(
        reject,
        signal.reason || new Error('登录准备已取消。'),
      );
      signal.addEventListener('abort', onAbort, { once: true });
      gate.promise.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  }

  const context = vm.createContext({
    ACCOUNT_VAULT_SESSION_KEY,
    ACCOUNT_VAULT_LOCK_EPOCH_KEY,
    PROJECT_TASK_STATUS_KEY,
    STORE_RUN_INDEX_KEY,
    STORE_RUN_KEY_PREFIX,
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    XhsAccountLogin: loginApi,
    XhsMetrics: {
      analysisDetailKeys() { return []; },
    },
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    clearTimeout,
    setTimeout,
    chrome: {
      storage: {
        session: {
          async get(key) {
            sessionReads.push(key);
            events.push('session:get:' + key);
            return Object.prototype.hasOwnProperty.call(sessionState, key)
              ? { [key]: copy(sessionState[key]) }
              : {};
          },
          async remove(key) {
            const names = Array.isArray(key) ? key : [key];
            names.forEach((name) => delete sessionState[name]);
          },
        },
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names
              .filter((key) => Object.prototype.hasOwnProperty.call(localState, key))
              .map((key) => [key, copy(localState[key])]));
          },
          async set(value) {
            const saved = copy(value);
            localWrites.push(saved);
            events.push('local:set:' + Object.keys(saved).sort().join(','));
            Object.assign(localState, saved);
          },
          async remove(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            localRemovals.push(names.slice());
            events.push('local:remove:snapshots');
            names.forEach((key) => delete localState[key]);
          },
        },
      },
      tabs: {
        async update(tabId, update) {
          activatedTabs.push({ tabId, update: copy(update) });
          return { id: tabId, ...copy(update) };
        },
      },
    },
    accountVaultFromSession(value, expectedVaultScopeId) {
      if (!value || typeof value !== 'object') return null;
      if (!expectedVaultScopeId) throw new Error('账号库任务必须提供团队工作区范围。');
      if (value.vaultScopeId !== expectedVaultScopeId) {
        throw new Error('账号库属于其他工作区，请刷新并重新解锁。');
      }
      if (value.vault && typeof value.vault === 'object') return value.vault;
      return Array.isArray(value.accounts) ? value : null;
    },
    async readValidatedAccountSession(expectedVaultScopeId) {
      sessionReads.push(ACCOUNT_VAULT_SESSION_KEY);
      events.push('session:get:' + ACCOUNT_VAULT_SESSION_KEY);
      if (options.sessionReadGate) await options.sessionReadGate.promise;
      const session = sessionState[ACCOUNT_VAULT_SESSION_KEY];
      if (!session) return null;
      if (session.vaultScopeId !== expectedVaultScopeId) {
        delete sessionState[ACCOUNT_VAULT_SESSION_KEY];
        throw new Error('账号库属于其他工作区，请刷新并重新解锁。');
      }
      if (session.vaultLockEpoch !== localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) {
        delete sessionState[ACCOUNT_VAULT_SESSION_KEY];
        throw new Error('账号库会话已锁定或失效，请重新解锁。');
      }
      return copy(session);
    },
    batchText(value, limit) {
      return String(value == null ? '' : value).trim().slice(0, Number(limit) || 160);
    },
    sanitizeVaultScopeId(value) {
      const scopeId = String(value == null ? '' : value).trim();
      if (!['team:https://tbdata.aizicheng.com', 'local:tbcontentdata'].includes(scopeId)) {
        throw new Error('账号库工作区范围无效，请刷新页面后重试。');
      }
      return scopeId;
    },
    isProjectTaskCancellation(error, signal) {
      if (options.enableCancellationSemantics !== true) return false;
      return Boolean(error && error.code === 'PROJECT_TASK_CANCELLED') ||
        Boolean(signal && signal.aborted);
    },
    normalizeProjectPlatformTaskIds(value) {
      const allowed = ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'];
      return Array.from(new Set(Array.isArray(value) ? value : [])).filter((item) => allowed.includes(item));
    },
    normalizeXhsDateRange(value, required) {
      return required ? copy(value) : null;
    },
    projectTaskCancellationError(reason) {
      if (options.enableCancellationSemantics !== true) return reason;
      if (reason && reason.code === 'PROJECT_TASK_CANCELLED') return reason;
      const error = new Error(reason && reason.message || String(reason || '任务已取消。'));
      error.name = 'AbortError';
      error.code = 'PROJECT_TASK_CANCELLED';
      return error;
    },
    safeBatchAccount(account) {
      return accountLogin.safeAccountMetadata(account, {
        id: account.storeId,
        name: account.storeName,
        groupId: account.storeGroupId,
        groupName: account.storeGroupName,
      });
    },
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw signal.reason || new Error('任务已取消。');
    },
    async loginXingheAccount(account, loginOptions) {
      taobaoLogins.push({ account, options: loginOptions });
      events.push('login:taobao:start');
      await waitForLoginGate(taobaoGate, loginOptions && loginOptions.signal);
      if (options.taobaoVerificationOnce === true && taobaoLogins.length === 1) {
        events.push('login:taobao:verification');
        // Match the exact terminal text emitted by checkXingheBlockingState.
        // It intentionally has no platform field; prepareProjectPlatformSessions
        // supplies the adstar fallback while preserving the task-owned tabId.
        const error = new Error('星河需要人工验证。');
        error.code = 'VERIFICATION_REQUIRED';
        error.tabId = 11;
        throw error;
      }
      events.push('login:taobao:complete');
      return { state: 'ready', noPermission: false, tabId: 11 };
    },
    async loginXhsAccount(account, loginOptions) {
      xhsLogins.push({ account, options: loginOptions });
      events.push('login:xhs:start');
      await waitForLoginGate(xhsGate, loginOptions && loginOptions.signal);
      if (options.xhsVerificationOnce === true && xhsLogins.length === 1) {
        events.push('login:xhs:verification');
        const error = new Error('蒲公英需要人工安全验证。');
        error.code = 'VERIFICATION_REQUIRED';
        error.platform = options.xhsVerificationPlatform || 'pgy';
        error.tabId = 21;
        throw error;
      }
      if (options.xhsLoginFailureOnce === true && xhsLogins.length === 1) {
        const error = new Error('蒲公英账号或密码错误。');
        error.code = 'LOGIN_FAILED';
        throw error;
      }
      events.push('login:xhs:complete');
      return {
        state: 'loggedIn',
        platforms: {
          pgy: { state: 'ready', tabId: 21 },
          juguang: { state: 'ready', tabId: 22 },
        },
      };
    },
    ensureContentDiagnosisReportTask(reportOptions) {
      reportCalls.push(reportOptions);
      events.push('report:start');
      if (collectionVerificationPlatforms.length && !collectionVerificationStarted) {
        collectionVerificationStarted = true;
        return {
          promise: (async () => {
            for (const platform of collectionVerificationPlatforms) {
              const error = new Error(projectVerificationPlatformNameForTest(platform) + '采集需要人工验证。');
              error.code = 'VERIFICATION_REQUIRED';
              error.platform = platform;
              error.tabId = platform === 'adstar' ? 31 : (platform === 'pgy' ? 32 : 33);
              events.push('report:verification:' + platform);
              if (typeof reportOptions.onVerificationRequired !== 'function') throw error;
              await reportOptions.onVerificationRequired(error);
              events.push('report:verification-resolved:' + platform);
            }
            return reportGate.promise;
          })(),
        };
      }
      return { promise: reportGate.promise };
    },
    async prepareCurrentSessionProjectPlatforms(platforms, preflightOptions) {
      currentSessionPreflights.push({
        platforms: Array.from(platforms || []),
        options: preflightOptions,
      });
      return { taskOwnedTabIds: {}, platforms: {} };
    },
    async waitForProjectVerification(error, waitOptions) {
      const entry = { error, options: waitOptions };
      verificationWaits.push(entry);
      events.push('verification:wait:' + String(waitOptions && waitOptions.platform || ''));
      const signal = waitOptions && waitOptions.signal;
      const platform = String(waitOptions && waitOptions.platform || '');
      const platformGate = verificationGates[platform] || verificationGate;
      if (signal && signal.aborted) {
        throw context.projectTaskCancellationError(signal.reason);
      }
      await context.chrome.tabs.update(error.tabId, { active: true });
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => finish(
          reject,
          context.projectTaskCancellationError(signal && signal.reason),
        );
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        platformGate.promise.then(
          (value) => finish(resolve, value),
          (reason) => finish(reject, reason),
        );
      });
      if (signal && signal.aborted) {
        throw context.projectTaskCancellationError(signal.reason);
      }
      events.push('verification:resolved:' + String(waitOptions && waitOptions.platform || ''));
      return { ok: true };
    },
  });

  const archiveSource = sourceBlock(
    'const ACCOUNT_RUN_SNAPSHOT_KEYS = [',
    '\nasync function saveAccountBatchStatus',
  );
  const projectSource = sourceBlock(
    'async function saveProjectTaskStatus',
    '\nfunction ensureBusinessDefenseAutoCollectTask',
  );
  const verificationChallengeSource = sourceBlock(
    'function projectVerificationChallenge',
    '\nfunction shouldRetryPlatformError',
  );
  const platformSessionWatchdogSource = sourceBlock(
    'const PLATFORM_SESSION_PREPARE_TIMEOUTS_MS',
    '\nasync function loginXhsAccount',
  );
  const currentSessionPreflightStub = context.prepareCurrentSessionProjectPlatforms;
  const waitForProjectVerificationStub = context.waitForProjectVerification;
  vm.runInContext(
    'let projectTaskStatusWriteQueue = Promise.resolve();\n' +
      verificationChallengeSource + '\n' + platformSessionWatchdogSource + '\n' +
      archiveSource + '\n' + projectSource +
      '\nglobalThis.runProjectTaskUnderTest = runProjectTask;',
    context,
    { filename: 'project-task-vault-contract.js' },
  );
  context.prepareCurrentSessionProjectPlatforms = currentSessionPreflightStub;
  context.waitForProjectVerification = waitForProjectVerificationStub;

  return {
    activatedTabs,
    context,
    credentialPlans,
    currentSessionPreflights,
    events,
    freshAuthorizationCalls,
    assertFreshVaultAuthorization,
    localRemovals,
    localState,
    localWrites,
    reportCalls,
    reportGate,
    sessionReads,
    sessionState,
    taobaoGate,
    taobaoLogins,
    verificationGate,
    verificationGates,
    verificationWaits,
    xhsGate,
    xhsLogins,
  };
}

function projectVerificationPlatformNameForTest(platform) {
  if (platform === 'adstar') return '星河';
  if (platform === 'pgy') return '蒲公英';
  if (platform === 'juguang') return '聚光';
  return '平台';
}

function vaultExecution(harness, values) {
  return Object.assign({
    assertFreshVaultAuthorization: harness.assertFreshVaultAuthorization,
  }, values || {});
}

function projectPayload(credentialMode) {
  return {
    credentialMode,
    vaultScopeId: credentialMode === 'vault' ? VAULT_SCOPE_ID : '',
    platforms: ['adstar', 'pgy', 'juguang'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    store: {
      id: 'store-1',
      name: '测试旗舰店',
      groupId: 'group-1',
      groupName: '测试分组',
    },
  };
}

test('vault mode resolves the selected store before local mutation and prepares platform logins in parallel', async () => {
  const harness = createHarness();
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-vault-contract',
  }));

  await waitFor(
    () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
    '星河与小红书登录准备未并行启动。',
  );
  assert.equal(harness.reportCalls.length, 0);
  assert.equal(harness.taobaoLogins[0].account.id, 'taobao-1');
  assert.equal(typeof harness.taobaoLogins[0].options.assertCredentialAuthorization, 'function');
  assert.equal(harness.xhsLogins[0].account.id, 'xhs-1');
  assert.equal(typeof harness.xhsLogins[0].options.assertCredentialAuthorization, 'function');
  assert.deepEqual(Array.from(harness.xhsLogins[0].options.platforms), ['pgy', 'juguang']);

  harness.taobaoGate.resolve();
  await waitFor(
    () => harness.events.includes('login:taobao:complete'),
    '星河登录准备未完成。',
  );
  assert.equal(harness.reportCalls.length, 0, '仍需等待小红书登录准备完成。');
  harness.xhsGate.resolve();
  await waitFor(() => harness.reportCalls.length === 1, '登录完成后报告任务未启动。');
  harness.reportGate.resolve({ ok: true, results: [] });
  const result = await running;

  assert.equal(result.ok, true);
  assert.equal(harness.sessionReads.length, 3,
    '预检与每个平台登录边界都必须复核 epoch/scope');
  assert.equal(harness.freshAuthorizationCalls.length, 2,
    '每个平台真正消费明文凭据前都必须实时复核服务端授权');
  assert.equal(harness.credentialPlans[0].store.id, 'store-1');
  assert.equal(harness.credentialPlans[0].routes.pgy.accountId, 'xhs-1');
  assert.equal(
    harness.credentialPlans[0].routes.pgy.accountId,
    harness.credentialPlans[0].routes.juguang.accountId,
  );
  assert.equal(harness.xhsLogins.length, 1);
  assert.ok(harness.events.indexOf('login:xhs:start') < harness.events.indexOf('login:taobao:complete'));
  assert.ok(harness.events.indexOf('login:xhs:complete') < harness.events.indexOf('report:start'));

  const resolvedIndex = harness.events.indexOf('credentials:resolved:store-1');
  const firstLocalMutation = harness.events.findIndex((event) => event.startsWith('local:'));
  assert.ok(resolvedIndex >= 0 && resolvedIndex < firstLocalMutation,
    '账号库凭据预检必须早于 project status 和快照的本地写入。');

  const archiveKey = Object.keys(harness.localState)
    .find((key) => key.startsWith(STORE_RUN_KEY_PREFIX));
  assert.ok(archiveKey);
  const archiveText = JSON.stringify(harness.localState[archiveKey]);
  const statusText = JSON.stringify(harness.localState[PROJECT_TASK_STATUS_KEY]);
  const writesText = JSON.stringify(harness.localWrites);
  for (const sentinel of [USERNAME_SENTINEL, PASSWORD_SENTINEL]) {
    assert.equal(archiveText.includes(sentinel), false, '归档不得落明文凭据。');
    assert.equal(statusText.includes(sentinel), false, 'project status 不得落明文凭据。');
    assert.equal(writesText.includes(sentinel), false, '本地写入不得落明文凭据。');
  }
  assert.equal(harness.localState[archiveKey].account.label, '旗舰店淘宝主账号');
  assert.equal(harness.localState[archiveKey].account.password, undefined);
  assert.equal(harness.localState[archiveKey].account.username, undefined);
});

test('single-store vault task waits for Xinghe verification and resumes the same login before reporting', async () => {
  const harness = createHarness({ taobaoVerificationOnce: true });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-wait-verification',
  }));
  const outcome = running.then(
    (value) => ({ state: 'resolved', value }),
    (error) => ({ state: 'rejected', error }),
  );

  await waitFor(
    () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
    '星河与小红书登录准备未启动。',
  );
  harness.taobaoGate.resolve();
  await waitFor(() => harness.verificationWaits.length === 1, '星河验证未进入等待状态。');
  await waitFor(() => {
    const status = harness.localState[PROJECT_TASK_STATUS_KEY];
    return Boolean(status && status.running === true && status.paused === true);
  }, '单店任务没有保持 running + paused 状态。');

  const waitingStatus = harness.localState[PROJECT_TASK_STATUS_KEY];
  assert.equal(waitingStatus.status, 'waiting_verification');
  assert.match(waitingStatus.phase, /星河.*验证|验证.*星河/);
  assert.equal(harness.verificationWaits[0].error.tabId, 11);
  assert.equal(harness.verificationWaits[0].options.platform, 'adstar');
  assert.equal(harness.reportCalls.length, 0, '人工验证未完成时不得开始取数报告。');

  harness.verificationGate.resolve({ kind: 'loggedIn' });
  await waitFor(() => harness.taobaoLogins.length === 2, '验证完成后星河登录未恢复。');
  assert.equal(harness.taobaoLogins[1].options.resume, true,
    '验证后必须复用已验证会话，不得退出并重提凭据。');

  harness.xhsGate.resolve();
  await waitFor(() => harness.reportCalls.length === 1, '全部登录恢复后取数报告未启动。');
  harness.reportGate.resolve({ ok: true, results: [] });
  const settled = await outcome;

  assert.equal(settled.state, 'resolved');
  assert.equal(settled.value.ok, true);
  assert.notEqual(harness.localState[PROJECT_TASK_STATUS_KEY].paused, true);
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].status, 'success');
});

test('single-store vault task resumes the same direct Xiaohongshu product login after verification', async () => {
  const harness = createHarness({
    xhsVerificationOnce: true,
    xhsVerificationPlatform: 'pgy',
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-wait-pgy-verification',
  }));

  await waitFor(
    () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
    '星河与小红书登录准备未启动。',
  );
  harness.xhsGate.resolve();
  await waitFor(() => harness.verificationWaits.length === 1, '蒲公英验证未进入等待状态。');
  await waitFor(() => {
    const status = harness.localState[PROJECT_TASK_STATUS_KEY];
    return Boolean(status && status.paused === true && status.verificationPlatforms.includes('pgy'));
  }, '单店任务未标记正在等待蒲公英验证。');
  assert.equal(harness.verificationWaits[0].options.platform, 'pgy');
  assert.equal(harness.verificationWaits[0].error.tabId, 21);

  harness.verificationGate.resolve({ kind: 'productReady' });
  await waitFor(() => harness.xhsLogins.length === 2, '蒲公英验证完成后登录未恢复。');
  assert.equal(harness.xhsLogins[1].options.resume, true,
    '小红书验证后必须复用当前平台会话，不得再走强制退出登录。');

  harness.taobaoGate.resolve();
  await waitFor(() => harness.reportCalls.length === 1, '全部登录恢复后取数报告未启动。');
  harness.reportGate.resolve({ ok: true, results: [] });
  const result = await running;
  assert.equal(result.ok, true);
  assert.notEqual(harness.localState[PROJECT_TASK_STATUS_KEY].paused, true);
});

test('finishing the later of two simultaneous verifications reactivates the remaining challenge tab', async () => {
  const adstarVerificationGate = deferred();
  const pgyVerificationGate = deferred();
  const harness = createHarness({
    taobaoVerificationOnce: true,
    xhsVerificationOnce: true,
    xhsVerificationPlatform: 'pgy',
    verificationGates: {
      adstar: adstarVerificationGate,
      pgy: pgyVerificationGate,
    },
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-two-verifications',
  }));

  try {
    await waitFor(
      () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
      '星河与小红书登录准备未启动。',
    );

    harness.taobaoGate.resolve();
    await waitFor(
      () => harness.verificationWaits.some((item) => item.options.platform === 'adstar'),
      '星河未先进入人工验证等待。',
    );
    harness.xhsGate.resolve();
    await waitFor(() => harness.verificationWaits.length === 2, '蒲公英未进入并行验证等待。');
    await waitFor(() => {
      const status = harness.localState[PROJECT_TASK_STATUS_KEY];
      return Boolean(status && status.verificationPlatforms.length === 2);
    }, '任务状态未同时记录两个待验证平台。');
    assert.deepEqual(
      harness.activatedTabs.map((item) => item.tabId),
      [11, 21],
      '后进入验证的蒲公英页面应成为当前可见挑战页。',
    );

    pgyVerificationGate.resolve({ kind: 'productReady' });
    await waitFor(() => harness.xhsLogins.length === 2, '蒲公英验证完成后登录未恢复。');
    assert.deepEqual(
      harness.activatedTabs.map((item) => item.tabId),
      [11, 21, 11],
      '蒲公英验证完成后，应自动重新激活仍在等待的星河验证页。',
    );
  } finally {
    adstarVerificationGate.resolve({ kind: 'loggedIn' });
    pgyVerificationGate.resolve({ kind: 'productReady' });
    harness.taobaoGate.resolve();
    harness.xhsGate.resolve();
    harness.reportGate.resolve({ ok: true, results: [] });
    await running.catch(() => {});
  }
});

test('cancelling a single-store task while verification is pending aborts the wait without reporting', async () => {
  const harness = createHarness({
    taobaoVerificationOnce: true,
    enableCancellationSemantics: true,
  });
  const controller = new AbortController();
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-cancel-verification',
    signal: controller.signal,
  }));

  await waitFor(
    () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
    '星河与小红书登录准备未启动。',
  );
  harness.taobaoGate.resolve();
  await waitFor(() => harness.verificationWaits.length === 1, '星河验证未进入等待状态。');
  await waitFor(() => {
    const status = harness.localState[PROJECT_TASK_STATUS_KEY];
    return Boolean(status && status.running === true && status.paused === true);
  }, '取消前任务未进入等待验证状态。');

  const cancellation = new Error('用户取消了等待验证的任务。');
  cancellation.name = 'AbortError';
  cancellation.code = 'PROJECT_TASK_CANCELLED';
  controller.abort(cancellation);
  const result = await running;

  assert.equal(result.cancelled, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(harness.taobaoLogins.length, 1, '取消后不得再次尝试登录。');
  assert.equal(harness.reportCalls.length, 0);
  assert.equal(Object.keys(harness.localState).some((key) => key.startsWith(STORE_RUN_KEY_PREFIX)), false,
    '取消等待不得归档半成品。');
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].running, false);
  assert.notEqual(harness.localState[PROJECT_TASK_STATUS_KEY].paused, true);
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].status, 'cancelled');
});

test('a preflight credential plan still revalidates the lock generation at each login boundary', async () => {
  const harness = createHarness();
  const plan = accountLogin.resolveCredentialPlan(vaultFixture(), {
    storeId: 'store-1',
    platforms: ['adstar', 'pgy', 'juguang'],
  });
  plan.vaultScopeId = VAULT_SCOPE_ID;
  plan.vaultLockEpoch = 7;
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-preflight-plan',
    credentialPlan: plan,
  }));

  await waitFor(() => harness.taobaoLogins.length === 1, '预检后星河登录未启动。');
  harness.taobaoGate.resolve();
  await waitFor(() => harness.xhsLogins.length === 1, '预检后小红书登录未启动。');
  harness.xhsGate.resolve();
  await waitFor(() => harness.reportCalls.length === 1, '预检后报告任务未启动。');
  harness.reportGate.resolve({ ok: true, results: [] });
  const result = await running;

  assert.equal(result.ok, true);
  assert.equal(harness.sessionReads.length, 2);
  assert.equal(harness.taobaoLogins[0].account.id, 'taobao-1');
  assert.equal(harness.xhsLogins[0].account.id, 'xhs-1');
});

test('server revocation at either parallel login boundary aborts every plaintext credential use', async () => {
  const harness = createHarness({
    authorize(callNumber) {
      if (callNumber >= 2) throw new Error('团队成员已停用。');
      return { checkedAt: Date.now() };
    },
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-live-revocation',
  }));
  await assert.rejects(running, /停用/);

  assert.equal(harness.freshAuthorizationCalls.length, 2);
  assert.equal(harness.taobaoLogins.length, 0,
    '任一并行授权边界撤权后不得把淘宝明文凭据交给登录器');
  assert.equal(harness.xhsLogins.length, 0,
    '任一并行授权边界撤权后不得把小红书明文凭据交给登录器');
  assert.equal(harness.reportCalls.length, 0);
});

test('an ordinary Xiaohongshu login failure does not cancel the Taobao branch or reporting', async () => {
  const harness = createHarness({
    enableCancellationSemantics: true,
    xhsLoginFailureOnce: true,
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-parallel-causal-error',
  }));

  await waitFor(
    () => harness.taobaoLogins.length === 1 && harness.xhsLogins.length === 1,
    '并行登录准备未启动。',
  );
  harness.xhsGate.resolve();
  await waitFor(
    () => harness.events.includes('login:xhs:start'),
    '小红书登录失败分支未返回。',
  );
  assert.equal(harness.taobaoLogins[0].options.signal.aborted, false,
    '普通平台登录失败不得 abort 淘宝兄弟分支。');
  harness.taobaoGate.resolve();
  await waitFor(() => harness.reportCalls.length === 1, '其他平台可运行时报告任务未启动。');
  assert.deepEqual(
    Array.from(harness.reportCalls[0].platforms),
    ['adstar', 'pgy', 'juguang'],
    '取数阶段应继续让各收集器独立返回成功或失败。',
  );
  harness.reportGate.resolve({ ok: true, partial: true, results: [] });
  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(harness.xhsLogins.length, 1, '普通登录失败不应重试整个项目任务。');
});

test('vault mode rejects a different workspace scope before any local mutation', async () => {
  const harness = createHarness({ sessionVaultScopeId: VAULT_SCOPE_ID });
  const payload = projectPayload('vault');
  payload.vaultScopeId = 'local:tbcontentdata';
  await assert.rejects(
    harness.context.runProjectTaskUnderTest(payload, vaultExecution(harness, {
      taskId: 'project-task-wrong-workspace',
    })),
    /其他工作区|工作区范围/,
  );
  assert.deepEqual(harness.sessionReads, [ACCOUNT_VAULT_SESSION_KEY]);
  assert.equal(harness.localWrites.length, 0);
  assert.equal(harness.localRemovals.length, 0);
  assert.equal(harness.taobaoLogins.length, 0);
  assert.equal(harness.xhsLogins.length, 0);
  assert.equal(harness.reportCalls.length, 0);
});

test('vault preflight failure leaves project status and report snapshots untouched', async () => {
  const harness = createHarness({ unlocked: false });
  await assert.rejects(
    harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
      taskId: 'project-task-locked-vault',
    })),
    /账号库尚未在本次 Chrome 会话解锁/,
  );
  assert.deepEqual(harness.sessionReads, [ACCOUNT_VAULT_SESSION_KEY]);
  assert.equal(harness.localWrites.length, 0);
  assert.equal(harness.localRemovals.length, 0);
  assert.deepEqual(harness.localState, { [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: 7 });
  assert.equal(harness.taobaoLogins.length, 0);
  assert.equal(harness.xhsLogins.length, 0);
  assert.equal(harness.reportCalls.length, 0);
});

test('locking while credential preflight is pending prevents every vault login and local mutation', async () => {
  const sessionReadGate = deferred();
  const harness = createHarness({ sessionReadGate });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('vault'), vaultExecution(harness, {
    taskId: 'project-task-lock-during-preflight',
  }));
  await waitFor(() => harness.sessionReads.length === 1, '凭据预检未启动。');
  harness.localState[ACCOUNT_VAULT_LOCK_EPOCH_KEY] = 8;
  delete harness.sessionState[ACCOUNT_VAULT_SESSION_KEY];
  sessionReadGate.resolve();

  await assert.rejects(running, /解锁|尚未/);
  assert.equal(harness.taobaoLogins.length, 0);
  assert.equal(harness.xhsLogins.length, 0);
  assert.equal(harness.localWrites.length, 0);
  assert.equal(harness.localRemovals.length, 0);
});

test('currentSession mode skips vault reads and login preparation', async () => {
  const harness = createHarness();
  const running = harness.context.runProjectTaskUnderTest(projectPayload('currentSession'), {
    taskId: 'project-task-current-session-contract',
  });
  await waitFor(() => harness.reportCalls.length === 1, '当前会话报告任务未启动。');
  harness.reportGate.resolve({ ok: true, results: [] });
  const result = await running;

  assert.equal(result.ok, true);
  assert.equal(harness.sessionReads.length, 0);
  assert.equal(harness.credentialPlans.length, 0);
  assert.equal(harness.taobaoLogins.length, 0);
  assert.equal(harness.xhsLogins.length, 0);
  assert.equal(harness.reportCalls.length, 1);
  assert.deepEqual(Array.from(harness.reportCalls[0].platforms), ['adstar', 'pgy', 'juguang']);
});

test('currentSession collection verification waits sequentially and then completes the same report task', async () => {
  const adstarGate = deferred();
  const pgyGate = deferred();
  const harness = createHarness({
    collectionVerificationPlatforms: ['adstar', 'pgy'],
    verificationGates: { adstar: adstarGate, pgy: pgyGate },
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('currentSession'), {
    taskId: 'project-task-current-session-collection-verification',
  });

  await waitFor(() => harness.verificationWaits.length === 1, '星河采集验证未进入等待。');
  let status = harness.localState[PROJECT_TASK_STATUS_KEY];
  assert.equal(status.running, true);
  assert.equal(status.paused, true);
  assert.deepEqual(Array.from(status.verificationPlatforms), ['adstar']);
  assert.equal(harness.verificationWaits[0].error.tabId, 31);
  assert.equal(harness.reportCalls.length, 1, '等待验证时不得重启整个报告任务。');

  adstarGate.resolve({ kind: 'loggedIn' });
  await waitFor(() => harness.verificationWaits.length === 2, '蒲公英采集验证未继续进入等待。');
  status = harness.localState[PROJECT_TASK_STATUS_KEY];
  assert.equal(status.running, true);
  assert.equal(status.paused, true);
  assert.deepEqual(Array.from(status.verificationPlatforms), ['pgy']);
  assert.equal(harness.verificationWaits[1].error.tabId, 32);

  pgyGate.resolve({ kind: 'productReady' });
  harness.reportGate.resolve({ ok: true, results: [] });
  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(harness.reportCalls.length, 1);
  assert.equal(harness.taobaoLogins.length, 0);
  assert.equal(harness.xhsLogins.length, 0);
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].status, 'success');
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].waitingForVerification, false);
});

test('cancelling currentSession while collection verification waits never resumes or archives', async () => {
  const controller = new AbortController();
  const harness = createHarness({
    collectionVerificationPlatforms: ['juguang'],
    enableCancellationSemantics: true,
  });
  const running = harness.context.runProjectTaskUnderTest(projectPayload('currentSession'), {
    taskId: 'project-task-cancel-current-session-collection-verification',
    signal: controller.signal,
  });

  await waitFor(() => harness.verificationWaits.length === 1, '聚光采集验证未进入等待。');
  const reason = new Error('用户取消采集阶段验证等待。');
  reason.name = 'AbortError';
  reason.code = 'PROJECT_TASK_CANCELLED';
  controller.abort(reason);
  const result = await running;

  assert.equal(result.cancelled, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(harness.reportCalls.length, 1);
  assert.equal(harness.events.includes('report:verification-resolved:juguang'), false);
  assert.equal(Object.keys(harness.localState).some((key) => key.startsWith(STORE_RUN_KEY_PREFIX)), false);
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].waitingForVerification, false);
  assert.equal(harness.localState[PROJECT_TASK_STATUS_KEY].status, 'cancelled');
});

test('missing or invalid credential mode fails closed before any task mutation', async (t) => {
  for (const credentialMode of [undefined, '', 'legacy-default']) {
    await t.test(String(credentialMode), async () => {
      const harness = createHarness();
      await assert.rejects(
        harness.context.runProjectTaskUnderTest(projectPayload(credentialMode), {
          taskId: 'project-task-invalid-credential-mode',
        }),
        /登录方式/,
      );
      assert.equal(harness.sessionReads.length, 0);
      assert.equal(harness.localWrites.length, 0);
      assert.equal(harness.localRemovals.length, 0);
      assert.equal(harness.taobaoLogins.length, 0);
      assert.equal(harness.xhsLogins.length, 0);
      assert.equal(harness.reportCalls.length, 0);
    });
  }
});

test('PROJECT_TASK_START awaits credential preflight before acknowledging a new launch', () => {
  const start = background.indexOf("if (!message || message.type !== 'PROJECT_TASK_START') return;");
  const end = background.indexOf("if (!message || ![\n    'BUSINESS_DEFENSE_AUTO_COLLECT'", start);
  assert.ok(start >= 0 && end > start);
  const handler = background.slice(start, end);
  assert.match(handler, /await preflightProjectTaskCredentials\(message\.payload \|\| \{\}\)/);
  assert.match(handler, /ensureProjectTask\(message\.payload \|\| \{\}, \{[\s\S]*credentialPlan,[\s\S]*assertFreshVaultAuthorization/);
});
