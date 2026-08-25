const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const xinghe = fs.readFileSync(path.join(root, 'xinghe-content-script.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web-tool', 'accounts.html'), 'utf8');
const page = fs.readFileSync(path.join(root, 'web-tool', 'accounts.js'), 'utf8');
const taskPage = fs.readFileSync(path.join(root, 'web-tool', 'task.js'), 'utf8');
const collectHtml = fs.readFileSync(path.join(root, 'web-tool', 'collect.html'), 'utf8');
const reportHtml = fs.readFileSync(path.join(root, 'web-tool', 'report.html'), 'utf8');
const vaultSource = fs.readFileSync(path.join(root, 'web-tool', 'account-vault.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'web-tool', 'server.mjs'), 'utf8');

assert.equal(manifest.version, '2.37.37');
assert.ok(manifest.host_permissions.includes('https://oapi.dingtalk.com/*'));
assert.ok(manifest.content_scripts.some((entry) => (
  entry.matches.includes('*://adstar.alimama.com/*') && entry.js.includes('xinghe-content-script.js')
)));
const xingheManifestEntry = manifest.content_scripts.find((entry) => entry.js.includes('xinghe-content-script.js'));
assert.equal(xingheManifestEntry.all_frames, true);
assert.ok(xingheManifestEntry.matches.includes('*://login.taobao.com/*'));

for (const id of [
  'vaultGate', 'vaultWorkspace', 'storeGroupForm', 'storeGroupList', 'storeGroupFilter',
    'accountRows', 'accountSearch', 'accountDialog', 'accountPlatform', 'accountStoreName', 'accountStoreGroupSelect',
  'notificationForm', 'dingWebhook',
]) {
  assert.match(html, new RegExp('id="' + id + '"'));
}
for (const taskHtml of [reportHtml]) {
  for (const id of [
    'batchSessionNotice', 'batchSetupPanel', 'batchGroupSelect', 'batchAccountList',
    'batchAccountSummary', 'batchSelectAllBtn', 'batchClearSelectionBtn',
    'startBatchTaskBtn', 'resumeBatchTaskBtn', 'cancelBatchTaskBtn',
  ]) assert.match(taskHtml, new RegExp('id="' + id + '"'));
  assert.doesNotMatch(taskHtml, /batchScopeType|batchScopeSelect|单个店铺/);
  assert.doesNotMatch(taskHtml, /batchMasterPassword|unlockBatchVaultBtn|src="\/account-vault\.js"/);
}
assert.match(collectHtml, /http-equiv="refresh" content="0; url=\/report\.html"/);
assert.doesNotMatch(collectHtml, /startCurrentTaskBtn|startBatchTaskBtn|data-task-type="collect"/);
assert.match(server, /'\/accounts\.html'/);
assert.match(server, /'\/account-vault\.js'/);
assert.match(taskPage, /request\('startAccountBatchFromSession'/);
assert.match(taskPage, /request\('cancelAccountBatch'/);
assert.match(taskPage, /request\('getAccountSessionSummary'/);
assert.doesNotMatch(taskPage, /TaobaoAccountVault\.decrypt|batchMasterPassword/);
assert.match(page, /request\('setProjectDirectory'/);
assert.match(page, /request\('setAccountSession', \{[\s\S]*vault: snapshot,[\s\S]*vaultLockEpoch/);
assert.match(page, /request\('getAccountManagementSession'/);
assert.match(page, /request\('encryptAccountVaultFromSession'/);
assert.match(page, /request\('lockAccountVault'/);
assert.match(page, /TaobaoAccountVault\.encryptForSession\(snapshot, password\)/);
assert.match(page, /schema: 4/);
assert.match(page, /needsVaultMigration/);
assert.match(page, /resolveStoreForAccount/);
assert.match(page, /data-add-account-group/);
assert.match(page, /normalizeAccountPlatform/);
assert.doesNotMatch(html, /id="accountName"|id="addAccountBtn"/);
assert.doesNotMatch(html, /management-sidebar|data-management-view|id="batchTaskType"|id="historyRows"/);
assert.doesNotMatch(page, /startAccountBatch|restoreStoreRun|activeView/);
assert.doesNotMatch(page, /localStorage|sessionStorage/);
assert.doesNotMatch(taskPage, /localStorage|sessionStorage/);

assert.match(vaultSource, /PBKDF2/);
assert.match(vaultSource, /AES-GCM/);
assert.match(vaultSource, /310000/);
assert.doesNotMatch(vaultSource, /localStorage|sessionStorage/);

assert.match(bridge, /sanitizeEncryptedVault/);
assert.match(bridge, /ACCOUNT_SESSION_SET/);
assert.match(bridge, /ACCOUNT_SESSION_GET_SUMMARY/);
assert.match(bridge, /ACCOUNT_SESSION_GET_MANAGEMENT/);
assert.doesNotMatch(bridge, /masterPassword/);
assert.match(bridge, /ACCOUNT_BATCH_START_FROM_SESSION/);
assert.match(bridge, /restoreStoreRun/);
assert.match(bridge, /STORE_RUN_KEY_PREFIX/);
assert.match(bridge, /sanitizeProjectTask/);
assert.match(bridge, /sanitizePlatformTasks/);
assert.match(bridge, /normalizeAccountPlatform/);
assert.match(background, /const PLATFORM_RETRY_ATTEMPTS = 5/);
assert.match(background, /normalizeBatchAccountPlatform/);
assert.match(bridge, /storeId: cleanText\(item\.storeId/);
assert.match(background, /async function loginXingheAccount/);
assert.match(background, /if \(!resume && \(!state \|\| state\.kind !== 'login'\)\)/);
assert.match(background, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
assert.match(background, /chrome\.webNavigation\.getAllFrames/);
assert.match(background, /allFrames: true/);
assert.match(background, /frameId: Number\(state\.frameId\) \|\| 0/);
assert.match(background, /async function runAccountBatch/);
assert.match(background, /chrome\.storage\.session\.set/);
assert.match(background, /prepareAccountBatchFromSession/);
assert.match(background, /summarizeAccountSession/);
assert.match(background, /ACCOUNT_SESSION_MUTATION_TYPES/);
assert.match(background, /isAccountManagementWebToolSender/);
assert.match(background, /VERIFICATION_REQUIRED/);
assert.match(background, /let loginPageSince = null/);
assert.match(background, /Date\.now\(\) - loginPageSince >= 15000/);
assert.match(background, /\\u6301\\u7eed\\u505c\\u7559\\u5728\\u5bc6\\u7801\\u9875/);
assert.match(background, /sendDingTalkNotification/);
assert.match(background, /archiveAccountRun/);
assert.match(background, /taskType/);
assert.match(background, /runMode/);
assert.match(background, /storeId: safeAccount\.storeId/);
assert.match(background, /noPermission: Boolean/);
assert.doesNotMatch(background, /await ensureBusinessDefenseAutoCollectTask\(\{ platforms \}\)\.promise/);
assert.match(background, /await ensureContentDiagnosisReportTask\(\{ platforms, signal \}\)\.promise/);
assert.match(background, /const hasNextAccount = index \+ 1 < accounts\.length/);
assert.match(xinghe, /kind: 'rolePicker'/);
assert.match(xinghe, /kind: 'noPermission'/);
assert.match(xinghe, /function xingheAccessRestriction/);
assert.match(xinghe, /accessReason: accessRestriction/);
assert.match(xinghe, /kind: 'verification'/);
assert.match(xinghe, /type === 'XINGHE_FILL_LOGIN'/);
assert.match(xinghe, /type === 'XINGHE_LOGOUT'/);
assert.doesNotMatch(xinghe, /window\.top !== window/);

async function verifyVaultRoundTrip() {
  const windowObject = {};
  windowObject.top = windowObject;
  const context = vm.createContext({
    window: windowObject,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    Date,
    JSON,
    Uint8Array,
    String,
    Error,
  });
  vm.runInContext(vaultSource, context, { filename: 'account-vault.js' });
  const payload = {
    accounts: [{ username: 'private-user', password: 'private-password' }],
    notification: { secret: 'SEC-private' },
  };
  const record = await windowObject.TaobaoAccountVault.encrypt(payload, 'master-password-123');
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /private-user|private-password|SEC-private/);
  const decrypted = await windowObject.TaobaoAccountVault.decrypt(record, 'master-password-123');
  assert.deepEqual(JSON.parse(JSON.stringify(decrypted)), payload);
  const opened = await windowObject.TaobaoAccountVault.open(record, 'master-password-123');
  assert.deepEqual(JSON.parse(JSON.stringify(opened.value)), payload);
  assert.match(opened.sessionKey, /^[A-Za-z0-9+/]{43}=$/);
  await assert.rejects(
    windowObject.TaobaoAccountVault.decrypt(record, 'wrong-password'),
    /主密码错误/
  );
}

async function verifyXingheFrameSelection() {
  const start = background.indexOf('async function readXingheState');
  const end = background.indexOf('\nasync function waitForXingheState', start);
  assert.ok(start >= 0 && end > start);
  const frameStates = new Map([
    [0, { kind: 'sessionPending' }],
    [7, { kind: 'login' }],
  ]);
  const context = vm.createContext({
    ensureXingheContentScript: async () => {},
    async sendTabMessageWithRetry(tabId, message, timeoutMs, options) {
      return { ok: true, state: frameStates.get(options.frameId) };
    },
    chrome: {
      webNavigation: {
        async getAllFrames() { return [{ frameId: 0 }, { frameId: 7 }]; },
      },
      tabs: {
        async sendMessage(tabId, message, options) {
          return { ok: true, state: frameStates.get(options.frameId) };
        },
      },
    },
    Promise,
    Number,
    Object,
    Array,
    Error,
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.readState = readXingheState;', context);
  const login = await context.readState(1);
  assert.equal(login.kind, 'login');
  assert.equal(login.frameId, 7);
  frameStates.set(0, { kind: 'noPermission' });
  let authenticated = await context.readState(1);
  assert.equal(authenticated.kind, 'noPermission');
  assert.equal(authenticated.frameId, 0);
  frameStates.set(7, { kind: 'loginError' });
  authenticated = await context.readState(1);
  assert.equal(authenticated.kind, 'noPermission');
  assert.equal(authenticated.frameId, 0);
  frameStates.set(0, { kind: 'loggedIn' });
  authenticated = await context.readState(1);
  assert.equal(authenticated.kind, 'loggedIn');
  assert.equal(authenticated.frameId, 0);
  frameStates.set(0, { kind: 'sessionPending' });
  const childError = await context.readState(1);
  assert.equal(childError.kind, 'loginError');
  assert.equal(childError.frameId, 7);
  frameStates.set(0, { kind: 'rolePicker', roleCount: 0 });
  frameStates.set(7, { kind: 'noPermission' });
  const childRestriction = await context.readState(1);
  assert.equal(childRestriction.kind, 'noPermission');
  assert.equal(childRestriction.frameId, 7);
  frameStates.set(0, { kind: 'rolePicker', roleCount: 1 });
  const realRolePicker = await context.readState(1);
  assert.equal(realRolePicker.kind, 'rolePicker');
  assert.equal(realRolePicker.frameId, 0);
}

function verifyXingheAccessRestriction() {
  const start = xinghe.indexOf('function xingheAccessRestriction');
  const end = xinghe.indexOf('\n\n  async function fillLogin', start);
  assert.ok(start >= 0 && end > start);
  const model = {
    text: '',
    error: '',
    inputs: { account: null, password: null },
    roles: [],
    verification: false,
  };
  const context = vm.createContext({
    model,
    location: { pathname: '/portal/v2/pages/role/picker/index.htm' },
    document: { readyState: 'complete' },
  });
  vm.runInContext(`
    function bodyText() { return model.text; }
    function loginInputs() { return model.inputs; }
    function roleButtons() { return model.roles; }
    function loginError() { return model.error; }
    function verificationVisible() { return model.verification; }
    function accountHint() { return ''; }
    function visibleElements() { return []; }
    function findClickable() { return null; }
  ` + xinghe.slice(start, end) + `
    globalThis.readPageState = pageState;
    globalThis.readAccessRestriction = xingheAccessRestriction;
  `, context, { filename: 'xinghe-state-model.js' });

  assert.equal(context.readAccessRestriction('淘宝星河账号登录。还未注册账号？免费注册'), '');

  model.text = '您当前未注册星河账号，请选择以下身份进行注册，立即注册/查看进度';
  model.error = '登录失败：您当前未注册星河账号';
  let state = context.readPageState();
  assert.equal(state.kind, 'noPermission');
  assert.equal(state.accessReason, 'unregistered');
  assert.match(state.message, /保留淘宝登录态/);

  model.text = '子账号未授权，请先使用主账号在千牛平台进行授权';
  model.error = '';
  state = context.readPageState();
  assert.equal(state.kind, 'noPermission');
  assert.equal(state.accessReason, 'noPermission');

  model.text = '当前账号无权限';
  state = context.readPageState();
  assert.equal(state.kind, 'noPermission');

  model.text = '淘宝星河：您当前账号未注册身份';
  state = context.readPageState();
  assert.equal(state.kind, 'noPermission');
  assert.equal(state.accessReason, 'unregistered');

  model.text = '淘宝星河：抱歉，您无权访问';
  state = context.readPageState();
  assert.equal(state.kind, 'noPermission');

  model.text = '淘宝星河账号登录。温馨提示：子账号未授权时请联系主账号。还未注册账号？免费注册';
  model.inputs = { account: {}, password: {} };
  state = context.readPageState();
  assert.equal(state.kind, 'login');

  model.error = '账号或密码错误';
  state = context.readPageState();
  assert.equal(state.kind, 'loginError');

  model.inputs = { account: null, password: null };
  model.roles = [{}];
  model.error = '';
  model.text = '淘宝星河身份选择。帮助：子账号未授权时请联系主账号。';
  state = context.readPageState();
  assert.equal(state.kind, 'rolePicker');

  model.roles = [];
  model.text = '账号登录';
  model.error = '账号不存在 LOGIN-USERNAME-SENTINEL@example.test LOGIN-PASSWORD-SENTINEL';
  state = context.readPageState();
  assert.equal(state.kind, 'loginError');
  assert.equal(state.message, '星河账号或密码错误。');
  assert.doesNotMatch(JSON.stringify(state), /LOGIN-USERNAME-SENTINEL|LOGIN-PASSWORD-SENTINEL/);
}

async function verifyXingheNoPermissionLoginFlow() {
  const start = background.indexOf('function checkXingheBlockingState');
  const end = background.indexOf('\n\nconst ACCOUNT_RUN_SNAPSHOT_KEYS', start);
  assert.ok(start >= 0 && end > start);
  const runtime = { states: [], logoutCalls: 0, messages: [], messageResponse: { ok: true } };
  const context = vm.createContext({
    runtime,
    Boolean,
    Date,
    Number,
    Object,
    Error,
    async prepareXingheTab() { return 41; },
    async waitForXingheState() { return runtime.states.shift(); },
    async resolveXinghePendingState(tabId, state) { return state; },
    async logoutXinghe() { runtime.logoutCalls += 1; },
    async waitMilliseconds() {},
    async sendTabMessageWithRetry(tabId, message) {
      runtime.messages.push(message);
      return runtime.messageResponse;
    },
    batchError(code, message, extra) {
      const error = new Error(message);
      error.code = code;
      return Object.assign(error, extra || {});
    },
    projectTaskCancellationError(reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason || '任务已取消。'));
      error.name = 'AbortError';
      error.code = 'PROJECT_TASK_CANCELLED';
      return error;
    },
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.login = loginXingheAccount;', context, {
    filename: 'xinghe-login-flow.js',
  });
  const account = { username: 'account', password: 'password', roleKeyword: '品牌' };
  const loginOptions = (resume) => ({
    resume,
    async assertCredentialAuthorization() {},
  });

  runtime.states = [{ kind: 'login', frameId: 0 }, { kind: 'noPermission', frameId: 0 }];
  let result = await context.login(account, loginOptions(false));
  assert.equal(result.state, 'noPermission');
  assert.equal(result.noPermission, true);
  assert.equal(runtime.logoutCalls, 0);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['XINGHE_FILL_LOGIN']);

  runtime.states = [
    { kind: 'noPermission', frameId: 0 },
    { kind: 'login', frameId: 0 },
    { kind: 'noPermission', frameId: 0 },
  ];
  runtime.logoutCalls = 0;
  runtime.messages = [];
  result = await context.login(account, loginOptions(false));
  assert.equal(result.noPermission, true);
  assert.equal(runtime.logoutCalls, 1);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['XINGHE_FILL_LOGIN']);

  runtime.states = [{ kind: 'noPermission', frameId: 0 }];
  runtime.logoutCalls = 0;
  runtime.messages = [];
  result = await context.login(account, loginOptions(true));
  assert.equal(result.noPermission, true);
  assert.equal(runtime.logoutCalls, 0);
  assert.equal(runtime.messages.length, 0);

  runtime.states = [{
    kind: 'loginError',
    frameId: 0,
    message: '账号不存在 LOGIN-USERNAME-SENTINEL@example.test LOGIN-PASSWORD-SENTINEL',
  }];
  await assert.rejects(
    context.login(account, loginOptions(false)),
    (error) => error && error.code === 'LOGIN_FAILED' &&
      error.message === '星河账号或密码错误。' &&
      !/LOGIN-USERNAME-SENTINEL|LOGIN-PASSWORD-SENTINEL/.test(error.message),
  );

  runtime.states = [{ kind: 'login', frameId: 0 }];
  runtime.messageResponse = {
    ok: false,
    message: '表单失败 LOGIN-USERNAME-SENTINEL@example.test LOGIN-PASSWORD-SENTINEL',
  };
  await assert.rejects(
    context.login(account, loginOptions(false)),
    (error) => error && error.code === 'LOGIN_FORM_FAILED' &&
      error.message === '星河账号密码表单提交失败。' &&
      !/LOGIN-USERNAME-SENTINEL|LOGIN-PASSWORD-SENTINEL/.test(error.message),
  );
}

async function verifyAbortableDingTalkNotification() {
  const start = background.indexOf('async function signedDingTalkWebhook');
  const end = background.indexOf('\n\nasync function ensureXingheContentScript', start);
  assert.ok(start >= 0 && end > start, 'DingTalk notification source block is missing');
  const runtime = { fetchOptions: null, respond: false };
  const context = vm.createContext({
    runtime,
    URL,
    Date,
    Error,
    Number,
    Object,
    Promise,
    String,
    JSON,
    Uint8Array,
    TextEncoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    crypto: webcrypto,
    sanitizeNotificationConfig(value) { return value || {}; },
    projectTaskCancellationError(reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason || '任务已取消。'));
      error.name = 'AbortError';
      error.code = 'PROJECT_TASK_CANCELLED';
      return error;
    },
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw context.projectTaskCancellationError(signal.reason);
    },
    raceWithProjectTaskSignal(promise, signal) {
      context.throwIfProjectTaskCancelled(signal);
      if (!signal) return Promise.resolve(promise);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(context.projectTaskCancellationError(signal.reason));
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => {
          signal.removeEventListener('abort', onAbort);
        });
      });
    },
    fetch(url, options) {
      runtime.fetchOptions = options;
      if (runtime.respond) {
        return Promise.resolve({
          ok: true,
          status: 200,
          async json() { return { errcode: 0 }; },
        });
      }
      return new Promise((resolve, reject) => {
        if (options && options.signal) {
          options.signal.addEventListener('abort', () => {
            reject(context.projectTaskCancellationError(options.signal.reason));
          }, { once: true });
        }
      });
    },
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.sendNotice = sendDingTalkNotification;', context, {
    filename: 'abortable-dingtalk-notification.js',
  });
  const controller = new AbortController();
  const pending = context.sendNotice(
    { webhook: 'https://example.test/dingtalk' },
    '需要人工验证',
    { signal: controller.signal },
  ).then(
    () => ({ state: 'resolved' }),
    (error) => ({ state: 'rejected', error }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('账号库已锁定。'));
  const settled = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 80)),
  ]);
  assert.equal(settled.state, 'rejected', 'DingTalk pending fetch must abort within 80ms');
  assert.equal(settled.error && settled.error.code, 'PROJECT_TASK_CANCELLED');
  assert.equal(runtime.fetchOptions && runtime.fetchOptions.signal, controller.signal,
    'DingTalk fetch must receive the batch AbortSignal');
  runtime.respond = true;
  const legacyResult = await context.sendNotice(
    { webhook: 'https://example.test/dingtalk' },
    '普通非批任务提醒',
  );
  assert.equal(legacyResult.ok, true, 'existing two-argument notification callers must remain compatible');
  assert.equal(runtime.fetchOptions.signal, undefined);
}

async function verifyAccountBatchContinuesAfterXingheRestriction() {
  const start = background.indexOf('async function runAccountBatch');
  const end = background.indexOf('\n\nasync function saveProjectTaskStatus', start);
  assert.ok(start >= 0 && end > start);
  const usernameSentinel = 'STATUS-USERNAME-SENTINEL';
  const passwordSentinel = 'STATUS-PASSWORD-SENTINEL';
  const runtime = {
    events: [], archives: [], statuses: [], canonicalEpoch: 1, lockAfterFirst: false,
    authorizationCalls: 0, authorizationFailAt: Number.POSITIVE_INFINITY,
    loginSignals: [], loginAuthorizationCallbacks: [], reportSignals: [], archiveSignals: [], notificationSignals: [], prepareSignals: [],
    loginError: null, reportGate: null, archiveGate: null,
    notificationPending: false, statusGate: null, statusGatePhase: '',
  };
  const context = vm.createContext({
    runtime,
    accountBatchCancelRequested: false,
    sanitizeBatchAccount(account) { return account; },
    normalizePlatformTaskIds(platforms) { return Array.from(platforms || []); },
    sanitizeVaultScopeId(value) {
      if (value !== 'team:https://tbdata.aizicheng.com') throw new Error('账号库工作区范围无效。');
      return value;
    },
    async assertVaultCredentialGeneration(scopeId, epoch) {
      if (scopeId !== 'team:https://tbdata.aizicheng.com' || epoch !== runtime.canonicalEpoch) {
        throw new Error('账号库已锁定，请重新解锁。');
      }
    },
    sanitizeNotificationConfig(notification) { return notification || {}; },
    batchText(value) { return String(value || ''); },
    safeBatchAccount(account) {
      return {
        id: account.id,
        label: account.label,
        name: account.label,
        platform: account.platform,
        storeId: account.storeId || '',
        storeName: account.storeName,
        usernameMasked: '***',
      };
    },
    async saveAccountBatchStatus(status) {
      runtime.events.push('status:' + status.phase);
      runtime.statuses.push(JSON.parse(JSON.stringify(status)));
      if (runtime.statusGate && status.phase === runtime.statusGatePhase) await runtime.statusGate;
      return status;
    },
    async clearAccountRunSnapshots() {
      runtime.events.push('clear');
    },
    async loginXingheAccount(account, options) {
      runtime.events.push('login:' + account.id);
      runtime.loginSignals.push(options && options.signal);
      runtime.loginAuthorizationCallbacks.push(options && options.assertCredentialAuthorization);
      if (runtime.loginError) throw runtime.loginError;
      return { tabId: 41, state: 'noPermission', noPermission: true };
    },
    ensureContentDiagnosisReportTask(options) {
      runtime.events.push('report:' + Array.from(options.platforms).join(','));
      runtime.reportSignals.push(options.signal);
      return { promise: runtime.reportGate || Promise.resolve({ ok: true, results: [] }) };
    },
    async archiveAccountRun(account, batchId, startedAt, loginResult, autoResult, reportResult, failureMessage, options) {
      runtime.events.push('archive:' + account.id);
      runtime.archiveSignals.push(options && options.signal);
      if (runtime.archiveGate) await runtime.archiveGate;
      runtime.archives.push({
        account: context.safeBatchAccount(account),
        loginResult,
        failureMessage,
        options,
      });
      if (runtime.lockAfterFirst && account.id === 'account-1') {
        runtime.canonicalEpoch += 1;
        context.accountBatchCancelRequested = true;
      }
      return { status: 'success', runId: 'run-' + account.id, failureCount: 0 };
    },
    async rollbackAccountRunArchive(runId) {
      runtime.events.push('rollback:' + runId);
      runtime.archives = runtime.archives.filter((archive) => 'run-' + archive.account.id !== runId);
    },
    async logoutXinghe() { runtime.events.push('logout'); },
    async waitMilliseconds() {},
    async prepareXingheTab(signal) {
      runtime.prepareSignals.push(signal);
      return 41;
    },
    async sendDingTalkNotification(config, text, options) {
      const signal = options && options.signal;
      runtime.events.push('notify');
      runtime.notificationSignals.push(signal);
      if (!runtime.notificationPending) return { ok: true };
      return new Promise((resolve, reject) => {
        if (!signal) return;
        const onAbort = () => reject(context.projectTaskCancellationError(signal.reason));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    maskedAccountName() { return '***'; },
    batchError(code, message, extra) {
      const error = new Error(message);
      error.code = code;
      return Object.assign(error, extra || {});
    },
    projectTaskCancellationError(reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason || '任务已取消。'));
      error.name = 'AbortError';
      error.code = 'PROJECT_TASK_CANCELLED';
      return error;
    },
    isProjectTaskCancellation(error, signal) {
      return Boolean(error && (error.code === 'PROJECT_TASK_CANCELLED' ||
        (error.name === 'AbortError' && signal && signal.aborted)));
    },
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw context.projectTaskCancellationError(signal.reason);
    },
    chrome: {
      storage: { local: { async get() { return {}; } } },
      tabs: { async update() {} },
    },
    Array,
    Date,
    Math,
    Number,
    Object,
    String,
    Error,
    Promise,
    AbortController,
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.runBatch = runAccountBatch;', context, {
    filename: 'account-batch-flow.js',
  });
  const batchExecution = (signal) => ({
    ...(signal ? { signal } : {}),
    async assertFreshVaultAuthorization() {
      runtime.authorizationCalls += 1;
      if (runtime.authorizationCalls >= runtime.authorizationFailAt) {
        context.accountBatchCancelRequested = true;
        throw context.projectTaskCancellationError('团队成员已停用。');
      }
      return { checkedAt: Date.now() };
    },
  });
  const result = await context.runBatch({
    taskType: 'collect',
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm', 'wxt'],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
        username: usernameSentinel + '-1', password: passwordSentinel + '-1',
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeName: '店铺二',
        username: usernameSentinel + '-2', password: passwordSentinel + '-2',
      },
    ],
  }, batchExecution());
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.deepEqual(runtime.events.filter((event) => /^(login|collect|report|archive|logout)/.test(event)), [
    'login:account-1',
    'report:sycm,wxt',
    'archive:account-1',
    'logout',
    'login:account-2',
    'report:sycm,wxt',
    'archive:account-2',
  ]);
  assert.equal(runtime.archives.length, 2);
  assert.equal(runtime.authorizationCalls, 2,
    '每个账号登录消费明文凭据前必须实时复核服务端授权');
  assert.ok(runtime.loginAuthorizationCallbacks.every((callback) => typeof callback === 'function'),
    '批任务必须把实时授权闭包继续传到实际密码提交器');
  runtime.archives.forEach((archive) => {
    assert.equal(archive.loginResult.noPermission, true);
    assert.equal(archive.failureMessage, '');
    assert.equal(archive.options.taskType, 'report');
  });
  const persisted = JSON.stringify({ statuses: runtime.statuses, archives: runtime.archives });
  assert.doesNotMatch(persisted, /STATUS-(?:USERNAME|PASSWORD)-SENTINEL/);

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.canonicalEpoch = 1;
  runtime.authorizationCalls = 0;
  runtime.authorizationFailAt = 2;
  context.accountBatchCancelRequested = false;
  const revokedBetweenAccounts = await context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
        username: usernameSentinel + '-1', password: passwordSentinel + '-1',
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeName: '店铺二',
        username: usernameSentinel + '-2', password: passwordSentinel + '-2',
      },
    ],
  }, batchExecution());
  assert.equal(revokedBetweenAccounts.cancelled, true);
  assert.equal(runtime.authorizationCalls, 2);
  assert.deepEqual(runtime.events.filter((event) => event.startsWith('login:')), ['login:account-1'],
    '服务端撤权后不得把已复制的第二个账号明文凭据交给登录器');
  runtime.authorizationFailAt = Number.POSITIVE_INFINITY;

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.canonicalEpoch = 1;
  runtime.lockAfterFirst = true;
  context.accountBatchCancelRequested = false;
  const cancelled = await context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
        username: usernameSentinel + '-1', password: passwordSentinel + '-1',
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeName: '店铺二',
        username: usernameSentinel + '-2', password: passwordSentinel + '-2',
      },
    ],
  }, batchExecution());
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(runtime.events.filter((event) => event.startsWith('login:')), ['login:account-1'],
    '退出锁定后不得进入第二个账号登录边界');
  assert.equal(cancelled.results.length, 0);
  assert.equal(runtime.archives.length, 0, '锁定后刚完成的迟到归档必须回滚');
  assert.doesNotMatch(JSON.stringify({ statuses: runtime.statuses, archives: runtime.archives }),
    /STATUS-(?:USERNAME|PASSWORD)-SENTINEL/);

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.loginSignals = [];
  runtime.reportSignals = [];
  let resolveDelayedReport;
  const delayedReport = new Promise((resolve) => { resolveDelayedReport = resolve; });
  runtime.reportGate = delayedReport;
  runtime.canonicalEpoch = 1;
  context.accountBatchCancelRequested = false;
  const controller = new AbortController();
  const lockedWhileReporting = context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
        username: usernameSentinel + '-1', password: passwordSentinel + '-1',
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeName: '店铺二',
        username: usernameSentinel + '-2', password: passwordSentinel + '-2',
      },
    ],
  }, batchExecution(controller.signal));
  while (!runtime.events.includes('report:sycm')) await new Promise((resolve) => setImmediate(resolve));
  context.accountBatchCancelRequested = true;
  controller.abort(new Error('账号库已锁定，任务已安全停止。'));
  runtime.events.push('lock');
  // Simulate a collector that resolves after cancellation; the late result must
  // still be rejected at the vault generation boundary and never archived.
  resolveDelayedReport({ ok: true, results: [] });
  const lockedResult = await lockedWhileReporting;
  runtime.reportGate = null;
  assert.equal(lockedResult.cancelled, true);
  assert.deepEqual(runtime.events.filter((event) => event.startsWith('login:')), ['login:account-1']);
  assert.equal(runtime.archives.length, 0, '锁定后迟到的报告结果不得归档');
  assert.equal(runtime.loginSignals[0], controller.signal, '账号登录必须接收 vault 批任务取消信号');
  assert.equal(runtime.reportSignals[0], controller.signal, '报告任务必须接收 vault 批任务取消信号');

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.archiveSignals = [];
  runtime.loginError = Object.assign(new Error('普通登录失败'), { code: 'LOGIN_FAILED' });
  let resolveDelayedFailureArchive;
  runtime.archiveGate = new Promise((resolve) => { resolveDelayedFailureArchive = resolve; });
  runtime.canonicalEpoch = 1;
  context.accountBatchCancelRequested = false;
  const failureController = new AbortController();
  const lockedDuringFailureArchive = context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
        username: usernameSentinel + '-1', password: passwordSentinel + '-1',
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeName: '店铺二',
        username: usernameSentinel + '-2', password: passwordSentinel + '-2',
      },
    ],
  }, batchExecution(failureController.signal));
  while (!runtime.events.includes('archive:account-1')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  context.accountBatchCancelRequested = true;
  runtime.canonicalEpoch += 1;
  failureController.abort(new Error('账号库已锁定，任务已安全停止。'));
  resolveDelayedFailureArchive();
  const failureLockedResult = await lockedDuringFailureArchive;
  runtime.archiveGate = null;
  runtime.loginError = null;
  assert.equal(failureLockedResult.cancelled, true);
  assert.deepEqual(runtime.events.filter((event) => event.startsWith('login:')), ['login:account-1'],
    '普通登录失败归档竞态后不得继续使用已复制明文登录账号二');
  assert.equal(failureLockedResult.results.length, 0,
    '锁定后普通登录失败的迟到结果不得进入批任务结果');
  assert.equal(runtime.archives.length, 0, '锁定后普通登录失败的迟到归档必须回滚');
  assert.equal(runtime.archiveSignals[0], failureController.signal,
    '普通登录失败归档必须接收 vault 批任务取消信号');

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.canonicalEpoch = 1;
  context.accountBatchCancelRequested = false;
  let resolveCleanupStatus;
  runtime.statusGatePhase = '清理上一账号数据';
  runtime.statusGate = new Promise((resolve) => { resolveCleanupStatus = resolve; });
  const cleanupController = new AbortController();
  const lockedBeforeCleanup = context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [{
      id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
      username: usernameSentinel + '-1', password: passwordSentinel + '-1',
    }],
  }, batchExecution(cleanupController.signal));
  while (!runtime.events.includes('status:清理上一账号数据')) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  context.accountBatchCancelRequested = true;
  runtime.canonicalEpoch += 1;
  cleanupController.abort(new Error('账号库已锁定，任务已安全停止。'));
  resolveCleanupStatus();
  const cleanupLockedResult = await lockedBeforeCleanup;
  runtime.statusGate = null;
  runtime.statusGatePhase = '';
  assert.equal(cleanupLockedResult.cancelled, true);
  assert.equal(runtime.events.includes('clear'), false,
    '锁定发生在清理状态写入期间时，不得继续清除其他任务快照');
  assert.equal(runtime.events.some((event) => event.startsWith('login:')), false);

  runtime.events = [];
  runtime.archives = [];
  runtime.statuses = [];
  runtime.notificationSignals = [];
  runtime.prepareSignals = [];
  runtime.canonicalEpoch = 1;
  runtime.notificationPending = true;
  runtime.loginError = Object.assign(new Error('需要人工验证'), { code: 'VERIFICATION_REQUIRED' });
  context.accountBatchCancelRequested = false;
  const verificationController = new AbortController();
  const lockedDuringNotification = context.runBatch({
    vaultScopeId: 'team:https://tbdata.aizicheng.com',
    vaultLockEpoch: 1,
    platforms: ['sycm'],
    accounts: [{
      id: 'account-1', label: '一号店主账号', platform: 'taobao', storeName: '店铺一',
      username: usernameSentinel + '-1', password: passwordSentinel + '-1',
    }],
  }, batchExecution(verificationController.signal));
  while (!runtime.events.includes('notify')) await new Promise((resolve) => setImmediate(resolve));
  context.accountBatchCancelRequested = true;
  runtime.canonicalEpoch += 1;
  verificationController.abort(new Error('账号库已锁定，任务已安全停止。'));
  const notificationSettled = await Promise.race([
    lockedDuringNotification.then(
      (value) => ({ state: 'resolved', value }),
      (error) => ({ state: 'rejected', error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ state: 'timeout' }), 80)),
  ]);
  runtime.notificationPending = false;
  runtime.loginError = null;
  assert.notEqual(notificationSettled.state, 'timeout',
    'pending DingTalk notification must let the batch cancel within 80ms');
  assert.equal(notificationSettled.state === 'rejected'
    ? notificationSettled.error && notificationSettled.error.code === 'PROJECT_TASK_CANCELLED'
    : notificationSettled.value && notificationSettled.value.cancelled, true);
  assert.equal(runtime.statuses.some((status) => status.paused === true), false,
    '锁定后绝不能写入迟到的 paused 状态');
  assert.equal(runtime.notificationSignals[0], verificationController.signal,
    '人工验证提醒必须接收 vault 批任务取消信号');
  assert.equal(runtime.prepareSignals[0], verificationController.signal,
    '人工验证分支重新准备星河页必须接收 vault 批任务取消信号');
}

function verifyVaultMigration() {
  const idStart = page.indexOf('function id');
  const helperEnd = page.indexOf('\n  function setNotice', idStart);
  const groupStart = page.indexOf('function cleanGroup');
  const groupEnd = page.indexOf('\n  function syncProjectDirectory', groupStart);
  assert.ok(idStart >= 0 && helperEnd > idStart && groupStart >= 0 && groupEnd > groupStart);
  let sequence = 0;
  const context = vm.createContext({
    crypto: { randomUUID() { sequence += 1; return 'migration-' + sequence; } },
    Date,
    String,
    Number,
    Array,
    Set,
    Map,
  });
  const source = page.slice(idStart, helperEnd) + page.slice(groupStart, groupEnd) +
    '\nglobalThis.normalize = normalizeVault; globalThis.needsMigration = needsVaultMigration;';
  vm.runInContext(source, context, { filename: 'accounts-model.js' });
  const legacy = {
    schema: 1,
    accountGroups: [{ id: 'account-group-1', name: '品牌账号' }],
    storeGroups: [{ id: 'store-group-1', name: '经营攻防第十期' }],
    accounts: [
      { id: 'account-1', name: '主账号', storeName: '测试旗舰店', username: 'user-1', password: 'pass-1' },
      { id: 'account-2', name: '子账号', storeName: '测试旗舰店', username: 'user-2', password: 'pass-2', storeGroupId: 'store-group-1' },
      { id: 'account-3', platform: 'xiaohongshu', storeName: '测试旗舰店', username: 'xhs-user', password: 'xhs-pass' },
    ],
  };
  assert.equal(context.needsMigration(legacy), true);
  const migrated = context.normalize(legacy);
  assert.equal(migrated.schema, 4);
  assert.equal(migrated.stores.length, 1);
  assert.equal(migrated.stores[0].groupId, 'store-group-1');
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.stores[0].credentialBindings)), {
    taobaoAccountId: '',
    xiaohongshuAccountId: 'account-3',
  });
  assert.equal(migrated.accounts.length, 3);
  assert.equal(migrated.accounts[0].storeId, migrated.accounts[1].storeId);
  assert.equal(migrated.accounts[0].platform, 'taobao');
  assert.equal(migrated.accounts[2].platform, 'xiaohongshu');
  assert.equal(migrated.accounts[2].label, '小红书账号');
  assert.equal(migrated.accounts[2].name, '小红书账号');
  assert.doesNotMatch(migrated.accounts[2].label, /xhs-user/);
  assert.equal(context.needsMigration(migrated), false);

  const strict = context.normalize({
    schema: 4,
    stores: [{
      id: 'strict-store', name: '严格店铺',
      credentialBindings: { taobaoAccountId: 'strict-taobao', xiaohongshuAccountId: '' },
    }],
    accounts: [
      {
        id: 'strict-taobao', label: '严格淘宝账号', platform: 'taobao', storeId: 'strict-store',
        username: 'strict-user', password: 'strict-pass', enabled: true,
      },
      {
        id: 'invalid-case', label: '大小写错误平台', platform: 'Taobao', storeId: 'strict-store',
        username: 'case-user', password: 'case-pass', enabled: true,
      },
      {
        id: 'invalid-missing', label: '缺失平台', storeId: 'strict-store',
        username: 'missing-user', password: 'missing-pass', enabled: true,
      },
    ],
  });
  assert.deepEqual(Array.from(strict.accounts, (account) => account.id), ['strict-taobao']);
  assert.equal(strict.stores[0].credentialBindings.taobaoAccountId, 'strict-taobao');
}

function verifyAccountSessionSelection() {
  const start = background.indexOf('function batchText');
  const end = background.indexOf('\nfunction bytesToBase64', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    Date,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    URL,
    Error,
    normalizePlatformTaskIds(value) {
      const allowed = ['sycm', 'guanghe', 'wxt', 'dmp'];
      if (value === undefined || value === null) return allowed;
      return Array.from(new Set(value.filter((item) => allowed.includes(item))));
    },
  });
  vm.runInContext(background.slice(start, end) + `
    globalThis.sanitizeSession = sanitizeAccountSessionVault;
    globalThis.sanitizeManagementSession = sanitizeAccountManagementSession;
    globalThis.managementSession = accountManagementSession;
    globalThis.vaultFromSession = accountVaultFromSession;
    globalThis.summarizeSession = summarizeAccountSession;
    globalThis.prepareBatch = prepareAccountBatchFromSession;
  `, context, { filename: 'account-session-model.js' });
  const vault = context.sanitizeSession({
    schema: 4,
    accountGroups: [{ id: 'ag-1', name: '主账号' }],
    storeGroups: [{ id: 'sg-1', name: '华东店铺' }],
    stores: [
      {
        id: 'store-1', name: '一号店', groupId: 'sg-1',
        credentialBindings: { taobaoAccountId: 'account-1', xiaohongshuAccountId: 'account-4' },
      },
      {
        id: 'store-3', name: '三号店', groupId: 'sg-1',
        credentialBindings: { taobaoAccountId: 'account-5', xiaohongshuAccountId: '' },
      },
      {
        id: 'store-2', name: '二号店', groupId: '',
        credentialBindings: { taobaoAccountId: 'account-2', xiaohongshuAccountId: 'account-invalid' },
      },
    ],
    accounts: [
      {
        id: 'account-1', label: '一号店主账号', platform: 'taobao', storeId: 'store-1',
        username: 'user-1', password: 'pass-1', enabled: true,
      },
      {
        id: 'account-5', label: '三号店主账号', platform: 'taobao', storeId: 'store-3',
        username: 'user-5', password: 'pass-5', enabled: true,
      },
      {
        id: 'account-2', label: '二号店主账号', platform: 'taobao', storeId: 'store-2',
        username: 'user-2', password: 'pass-2', enabled: true,
      },
      {
        id: 'account-3', label: '一号店停用账号', platform: 'taobao', storeId: 'store-1',
        username: 'user-3', password: 'pass-3', enabled: false,
      },
      {
        id: 'account-4', label: '一号店小红书账号', platform: 'xiaohongshu', storeId: 'store-1',
        username: 'xhs-user', password: 'xhs-pass', enabled: true,
      },
      {
        id: 'account-invalid', label: '无效平台账号', platform: 'other', storeId: 'store-2',
        username: 'invalid-user', password: 'invalid-pass', enabled: true,
      },
    ],
    notification: {},
  });
  assert.equal(vault.schema, 4);
  assert.deepEqual(Array.from(vault.accounts, (account) => account.id), [
    'account-1', 'account-5', 'account-2', 'account-3', 'account-4',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(vault.stores[0].credentialBindings)), {
    taobaoAccountId: 'account-1',
    xiaohongshuAccountId: 'account-4',
  });
  assert.equal(vault.stores[2].credentialBindings.xiaohongshuAccountId, '');
  assert.equal(vault.accounts[0].label, '一号店主账号');
  const summary = JSON.parse(JSON.stringify(context.summarizeSession(vault)));
  assert.equal(summary.schema, 2);
  assert.equal(summary.unlocked, true);
  assert.equal(summary.totalEnabledAccounts, 3);
  assert.equal(summary.storeGroups[0].enabledAccountCount, 2);
  assert.equal(summary.ungroupedAccountCount, 1);
  assert.deepEqual(summary.accounts.map((account) => account.id), ['account-1', 'account-5', 'account-2']);
  assert.deepEqual(summary.accounts.map((account) => account.usernameMasked), ['us****1', 'us****5', 'us****2']);
  assert.doesNotMatch(JSON.stringify(summary), /user-1|pass-1|pass-5/);

  const masterPasswordSentinel = 'MASTER-PASSWORD-RECOVERY-SENTINEL';
  const vaultFingerprint = 'b'.repeat(64);
  const vaultSessionKey = 'B'.repeat(43) + '=';
  const managementRecord = context.sanitizeManagementSession({
    vault,
    vaultScopeId: 'local:tbcontentdata',
    vaultLockEpoch: 4,
    vaultFingerprint,
    vaultSessionKey,
    masterPassword: masterPasswordSentinel,
  });
  assert.equal(managementRecord.schema, 6);
  assert.equal(managementRecord.vaultScopeId, 'local:tbcontentdata');
  assert.equal(managementRecord.vaultLockEpoch, 4);
  assert.equal(managementRecord.masterPassword, undefined);
  const recoveredManagement = context.managementSession(
    managementRecord,
    'local:tbcontentdata',
    vaultFingerprint,
  );
  assert.equal(recoveredManagement.vaultSessionKey, vaultSessionKey);
  assert.equal(recoveredManagement.vault.accounts[0].password, 'pass-1');
  assert.equal(context.managementSession(
    managementRecord,
    'local:tbcontentdata',
    'c'.repeat(64),
  ), null);
  assert.equal(context.summarizeSession(managementRecord).totalEnabledAccounts, 3);
  assert.doesNotMatch(
    JSON.stringify(context.summarizeSession(managementRecord)),
    /MASTER-PASSWORD-RECOVERY-SENTINEL|BBBBBBBB|user-1|pass-1/
  );
  assert.equal(context.vaultFromSession(managementRecord).stores.length, 3);
  assert.throws(() => context.vaultFromSession(
    managementRecord,
    'team:https://tbdata.aizicheng.com',
  ), /其他工作区/);

  const groupBatch = context.prepareBatch(vault, {
    taskType: 'collect',
    selection: { type: 'storeGroup', id: 'sg-1', accountIds: ['account-5', 'account-1', 'account-5'] },
  });
  assert.deepEqual(Array.from(groupBatch.accounts, (item) => item.id), ['account-5', 'account-1']);
  assert.equal(groupBatch.accounts[1].password, 'pass-1');
  assert.equal(groupBatch.selection.name, '华东店铺');
  assert.deepEqual(Array.from(groupBatch.selection.accountIds), ['account-5', 'account-1']);
  assert.equal(groupBatch.taskType, 'report');
  assert.deepEqual(Array.from(groupBatch.platforms), ['sycm', 'guanghe', 'wxt', 'dmp']);

  assert.throws(() => context.prepareBatch(vault, {
    selection: { type: 'storeGroup', id: 'sg-1', accountIds: [] },
  }), /至少选择一个组内账号/);
  assert.throws(() => context.prepareBatch(vault, {
    selection: { type: 'storeGroup', id: 'sg-1', accountIds: ['account-2'] },
  }), /不属于当前店铺分组/);
  assert.throws(() => context.prepareBatch(vault, {
    selection: { type: 'storeGroup', id: 'sg-1', accountIds: ['account-3'] },
  }), /被停用/);
  assert.throws(() => context.prepareBatch(vault, {
    selection: {
      type: 'storeGroup',
      id: 'sg-1',
      accountIds: Array.from({ length: 101 }, (_, index) => 'account-' + index),
    },
  }), /最多选择 100/);

  const resumed = context.prepareBatch(vault, { taskType: 'collect', resume: true }, {
    paused: true,
    taskType: 'report',
    accountIds: ['account-1'],
    resumeIndex: 0,
    batchId: 'batch-1',
    startedAt: 123,
    selection: { type: 'storeGroup', id: 'sg-1', name: '华东店铺' },
    platforms: ['sycm', 'wxt'],
  });
  assert.equal(resumed.resume, true);
  assert.equal(resumed.batchId, 'batch-1');
  assert.deepEqual(Array.from(resumed.accounts, (item) => item.id), ['account-1']);
  assert.deepEqual(Array.from(resumed.platforms), ['sycm', 'wxt']);

  const pausedStatus = {
    paused: true,
    taskType: 'report',
    accountIds: ['account-1'],
    resumeIndex: 0,
    batchId: 'batch-1',
    startedAt: 123,
    selection: { type: 'storeGroup', id: 'sg-1', name: '华东店铺' },
    platforms: ['sycm'],
  };
  vault.accounts[0].enabled = false;
  assert.throws(() => context.prepareBatch(vault, { resume: true }, pausedStatus), /账号库发生变化/);
  vault.accounts[0].enabled = true;
  vault.stores[0].groupId = '';
  assert.throws(() => context.prepareBatch(vault, { resume: true }, pausedStatus), /账号库发生变化/);
  vault.stores[0].groupId = 'sg-1';
  const legacyStoreResume = context.prepareBatch(vault, { resume: true }, {
    ...pausedStatus,
    selection: { type: 'store', id: 'store-1', name: '一号店' },
  });
  assert.deepEqual(Array.from(legacyStoreResume.accounts, (item) => item.id), ['account-1']);
  assert.throws(() => context.prepareBatch(vault, { resume: true }, {
    ...pausedStatus,
    accountIds: Array.from({ length: 101 }, (_, index) => 'account-' + index),
  }), /超过 100/);
}

Promise.all([
  verifyVaultRoundTrip(),
  verifyXingheFrameSelection(),
  verifyXingheAccessRestriction(),
  verifyXingheNoPermissionLoginFlow(),
  verifyAbortableDingTalkNotification(),
  verifyAccountBatchContinuesAfterXingheRestriction(),
  verifyVaultMigration(),
  verifyAccountSessionSelection(),
]).then(() => {
  console.log('account batch and encrypted vault guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
