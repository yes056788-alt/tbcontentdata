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

assert.equal(manifest.version, '2.37.3');
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
for (const taskHtml of [collectHtml, reportHtml]) {
  for (const id of [
    'batchSessionNotice', 'batchSetupPanel', 'batchScopeType', 'batchScopeSelect',
    'batchAccountSummary', 'startBatchTaskBtn', 'resumeBatchTaskBtn', 'cancelBatchTaskBtn',
  ]) assert.match(taskHtml, new RegExp('id="' + id + '"'));
  assert.doesNotMatch(taskHtml, /batchMasterPassword|unlockBatchVaultBtn|src="\/account-vault\.js"/);
}
assert.match(server, /'\/accounts\.html'/);
assert.match(server, /'\/account-vault\.js'/);
assert.match(taskPage, /request\('startAccountBatchFromSession'/);
assert.match(taskPage, /request\('cancelAccountBatch'/);
assert.match(taskPage, /request\('getAccountSessionSummary'/);
assert.doesNotMatch(taskPage, /TaobaoAccountVault\.decrypt|batchMasterPassword/);
assert.match(page, /request\('setProjectDirectory'/);
assert.match(page, /request\('setAccountSession'/);
assert.match(page, /request\('getAccountManagementSession'/);
assert.match(page, /request\('clearAccountSession'/);
assert.match(page, /masterPassword/);
assert.match(page, /schema: 3/);
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
assert.match(background, /await ensureBusinessDefenseAutoCollectTask\(\{ platforms \}\)\.promise/);
assert.match(background, /await ensureContentDiagnosisReportTask\(\{ platforms \}\)\.promise/);
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
  model.error = '账号或密码错误';
  state = context.readPageState();
  assert.equal(state.kind, 'loginError');
}

async function verifyXingheNoPermissionLoginFlow() {
  const start = background.indexOf('function checkXingheBlockingState');
  const end = background.indexOf('\n\nconst ACCOUNT_RUN_SNAPSHOT_KEYS', start);
  assert.ok(start >= 0 && end > start);
  const runtime = { states: [], logoutCalls: 0, messages: [] };
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
      return { ok: true };
    },
    batchError(code, message, extra) {
      const error = new Error(message);
      error.code = code;
      return Object.assign(error, extra || {});
    },
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.login = loginXingheAccount;', context, {
    filename: 'xinghe-login-flow.js',
  });
  const account = { username: 'account', password: 'password', roleKeyword: '品牌' };

  runtime.states = [{ kind: 'login', frameId: 0 }, { kind: 'noPermission', frameId: 0 }];
  let result = await context.login(account, { resume: false });
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
  result = await context.login(account, { resume: false });
  assert.equal(result.noPermission, true);
  assert.equal(runtime.logoutCalls, 1);
  assert.deepEqual(runtime.messages.map((message) => message.type), ['XINGHE_FILL_LOGIN']);

  runtime.states = [{ kind: 'noPermission', frameId: 0 }];
  runtime.logoutCalls = 0;
  runtime.messages = [];
  result = await context.login(account, { resume: true });
  assert.equal(result.noPermission, true);
  assert.equal(runtime.logoutCalls, 0);
  assert.equal(runtime.messages.length, 0);
}

async function verifyAccountBatchContinuesAfterXingheRestriction() {
  const start = background.indexOf('async function runAccountBatch');
  const end = background.indexOf('\n\nasync function saveProjectTaskStatus', start);
  assert.ok(start >= 0 && end > start);
  const runtime = { events: [], archives: [] };
  const context = vm.createContext({
    runtime,
    accountBatchCancelRequested: false,
    sanitizeBatchAccount(account) { return account; },
    normalizePlatformTaskIds(platforms) { return Array.from(platforms || []); },
    sanitizeNotificationConfig(notification) { return notification || {}; },
    batchText(value) { return String(value || ''); },
    safeBatchAccount(account) { return Object.assign({}, account, { usernameMasked: '***' }); },
    async saveAccountBatchStatus(status) {
      runtime.events.push('status:' + status.phase);
      return status;
    },
    async clearAccountRunSnapshots() { runtime.events.push('clear'); },
    async loginXingheAccount(account) {
      runtime.events.push('login:' + account.id);
      return { tabId: 41, state: 'noPermission', noPermission: true };
    },
    ensureBusinessDefenseAutoCollectTask(options) {
      runtime.events.push('collect:' + Array.from(options.platforms).join(','));
      return { promise: Promise.resolve({ ok: true, results: [] }) };
    },
    ensureContentDiagnosisReportTask(options) {
      runtime.events.push('report:' + Array.from(options.platforms).join(','));
      return { promise: Promise.resolve({ ok: true, results: [] }) };
    },
    async archiveAccountRun(account, batchId, startedAt, loginResult, autoResult, reportResult, failureMessage, options) {
      runtime.events.push('archive:' + account.id);
      runtime.archives.push({ loginResult, failureMessage, options });
      return { status: 'success', runId: 'run-' + account.id, failureCount: 0 };
    },
    async logoutXinghe() { runtime.events.push('logout'); },
    async waitMilliseconds() {},
    async prepareXingheTab() { return 41; },
    async sendDingTalkNotification() { return { ok: true }; },
    maskedAccountName() { return '***'; },
    batchError(code, message, extra) {
      const error = new Error(message);
      error.code = code;
      return Object.assign(error, extra || {});
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
  });
  vm.runInContext(background.slice(start, end) + '\nglobalThis.runBatch = runAccountBatch;', context, {
    filename: 'account-batch-flow.js',
  });
  const result = await context.runBatch({
    taskType: 'both',
    platforms: ['sycm', 'wxt'],
    accounts: [
      { id: 'account-1', platform: 'taobao', storeName: '店铺一', username: 'one' },
      { id: 'account-2', platform: 'taobao', storeName: '店铺二', username: 'two' },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.deepEqual(runtime.events.filter((event) => /^(login|collect|report|archive|logout)/.test(event)), [
    'login:account-1',
    'collect:sycm,wxt',
    'report:sycm,wxt',
    'archive:account-1',
    'logout',
    'login:account-2',
    'collect:sycm,wxt',
    'report:sycm,wxt',
    'archive:account-2',
  ]);
  assert.equal(runtime.archives.length, 2);
  runtime.archives.forEach((archive) => {
    assert.equal(archive.loginResult.noPermission, true);
    assert.equal(archive.failureMessage, '');
    assert.equal(archive.options.taskType, 'both');
  });
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
  assert.equal(migrated.schema, 3);
  assert.equal(migrated.stores.length, 1);
  assert.equal(migrated.stores[0].groupId, 'store-group-1');
  assert.equal(migrated.accounts.length, 3);
  assert.equal(migrated.accounts[0].storeId, migrated.accounts[1].storeId);
  assert.equal(migrated.accounts[0].platform, 'taobao');
  assert.equal(migrated.accounts[2].platform, 'xiaohongshu');
  assert.equal(migrated.accounts[2].name, 'xhs-user');
  assert.equal(context.needsMigration(migrated), false);
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
    accountGroups: [{ id: 'ag-1', name: '主账号' }],
    storeGroups: [{ id: 'sg-1', name: '华东店铺' }],
    stores: [
      { id: 'store-1', name: '一号店', groupId: 'sg-1' },
      { id: 'store-2', name: '二号店', groupId: '' },
    ],
    accounts: [
      { id: 'account-1', name: '一号店账号', storeId: 'store-1', username: 'user-1', password: 'pass-1', enabled: true },
      { id: 'account-2', name: '二号店账号', storeId: 'store-2', username: 'user-2', password: 'pass-2', enabled: true },
      { id: 'account-3', name: '停用账号', storeId: 'store-1', username: 'user-3', password: 'pass-3', enabled: false },
      { id: 'account-4', platform: 'xiaohongshu', storeId: 'store-1', username: 'xhs-user', password: 'xhs-pass', enabled: true },
    ],
    notification: {},
  });
  const summary = JSON.parse(JSON.stringify(context.summarizeSession(vault)));
  assert.equal(summary.unlocked, true);
  assert.equal(summary.totalEnabledAccounts, 2);
  assert.equal(summary.storeGroups[0].enabledAccountCount, 1);
  assert.equal(summary.ungroupedAccountCount, 1);
  assert.doesNotMatch(JSON.stringify(summary), /user-1|pass-1/);

  const managementRecord = context.sanitizeManagementSession({
    vault,
    masterPassword: 'master-password-123',
  });
  const restoredManagement = context.managementSession(managementRecord);
  assert.equal(restoredManagement.masterPassword, 'master-password-123');
  assert.equal(restoredManagement.vault.accounts[0].username, 'user-1');
  assert.equal(restoredManagement.vault.accounts[3].platform, 'xiaohongshu');
  assert.equal(context.summarizeSession(managementRecord).totalEnabledAccounts, 2);
  assert.doesNotMatch(JSON.stringify(context.summarizeSession(managementRecord)), /master-password|user-1|pass-1/);
  assert.equal(context.vaultFromSession(managementRecord).stores.length, 2);

  const groupBatch = context.prepareBatch(vault, {
    taskType: 'collect',
    selection: { type: 'storeGroup', id: 'sg-1' },
  });
  assert.deepEqual(Array.from(groupBatch.accounts, (item) => item.id), ['account-1']);
  assert.equal(groupBatch.accounts[0].password, 'pass-1');
  assert.equal(groupBatch.selection.name, '华东店铺');
  assert.deepEqual(Array.from(groupBatch.platforms), ['sycm', 'guanghe', 'wxt', 'dmp']);

  const storeBatch = context.prepareBatch(vault, {
    taskType: 'report',
    selection: { type: 'store', id: 'store-2' },
  });
  assert.deepEqual(Array.from(storeBatch.accounts, (item) => item.id), ['account-2']);
  assert.equal(storeBatch.taskType, 'report');
  assert.deepEqual(Array.from(storeBatch.platforms), ['sycm', 'guanghe', 'wxt', 'dmp']);

  const resumed = context.prepareBatch(vault, { taskType: 'collect', resume: true }, {
    paused: true,
    taskType: 'collect',
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
}

Promise.all([
  verifyVaultRoundTrip(),
  verifyXingheFrameSelection(),
  verifyXingheAccessRestriction(),
  verifyXingheNoPermissionLoginFlow(),
  verifyAccountBatchContinuesAfterXingheRestriction(),
  verifyVaultMigration(),
  verifyAccountSessionSelection(),
]).then(() => {
  console.log('account batch and encrypted vault guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
