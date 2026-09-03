const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sourceBlock(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, 'missing source marker: ' + start);
  assert.ok(to > from, 'missing source marker: ' + end);
  return source.slice(from, to);
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 800;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message || '等待条件超时。');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const platformHelpers = sourceBlock(
  backgroundSource,
  'function waitMilliseconds(duration)',
  '\nasync function waitTabComplete'
);

test('platform retry delay aborts immediately and never starts another attempt', async () => {
  let attempts = 0;
  const controller = new AbortController();
  const context = vm.createContext({
    AbortController,
    DOMException,
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    platformHelpers + '\nglobalThis.testRetry = runPlatformStepWithRetry;',
    context
  );
  const running = context.testRetry({
    async run() {
      attempts += 1;
      throw new Error('临时网络错误');
    },
  }, controller.signal);
  await waitFor(() => attempts === 1);
  controller.abort();
  await assert.rejects(running, (error) => {
    assert.equal(error.code, 'PROJECT_TASK_CANCELLED');
    return true;
  });
  assert.equal(attempts, 1);
});

test('an internal AbortError does not cancel the project when its project signal is still active', async () => {
  let attempts = 0;
  const controller = new AbortController();
  const context = vm.createContext({
    AbortController,
    DOMException,
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    setTimeout(callback) { return setTimeout(callback, 0); },
    clearTimeout,
  });
  vm.runInContext(
    platformHelpers + '\nglobalThis.testRetry = runPlatformStepWithRetry;',
    context
  );
  const result = await context.testRetry({
    async run() {
      attempts += 1;
      if (attempts === 1) throw new DOMException('请求超时', 'AbortError');
      return { ok: true };
    },
  }, controller.signal);
  assert.equal(result.detail.ok, true);
  assert.equal(attempts, 2);
  assert.equal(controller.signal.aborted, false);
});

test('cancelled report suppresses late progress writes and exposes a drain barrier for unfinished collectors', async () => {
  const collectorStarted = deferred();
  const releaseCollector = deferred();
  const writes = [];
  const controller = new AbortController();
  const reportSource = sourceBlock(
    backgroundSource,
    'async function runContentDiagnosisReport(options)',
    '\nfunction batchText'
  );
  const context = vm.createContext({
    AbortController,
    DOMException,
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    setTimeout,
    clearTimeout,
    contentDiagnosisResultMessage() { return ''; },
    sanitizeXhsBindingIssues() { return []; },
    async runBusinessDefenseSycm() {
      collectorStarted.resolve();
      await releaseCollector.promise;
      return { snapshot: { visitors: 1 } };
    },
    async runBusinessDefenseGuanghe() { throw new Error('unexpected guanghe call'); },
    async runBusinessDefenseDmp() { throw new Error('unexpected dmp call'); },
    async prepareContentDiagnosisWxtTab() { throw new Error('unexpected wxt call'); },
    async runContentDiagnosisWxtSection() { throw new Error('unexpected wxt call'); },
    async runXhsAnalysisTask() { throw new Error('unexpected xhs call'); },
    chrome: {
      storage: {
        local: {
          async remove() {},
          async set(value) { writes.push(copy(value)); },
        },
      },
    },
  });
  vm.runInContext(
    platformHelpers + '\n' + reportSource + '\nglobalThis.testRun = runContentDiagnosisReport;',
    context
  );

  const running = context.testRun({ platforms: ['sycm'], signal: controller.signal });
  await collectorStarted.promise;
  controller.abort();
  let cancellation;
  await assert.rejects(running, (error) => {
    cancellation = error;
    assert.equal(error.code, 'PROJECT_TASK_CANCELLED');
    assert.equal(typeof error.drainPromise.then, 'function');
    return true;
  });
  let drained = false;
  cancellation.drainPromise.then(() => { drained = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(drained, false);
  const reportWritesBeforeLateResolve = writes.filter((value) => value['report-status']).length;

  releaseCollector.resolve();
  await cancellation.drainPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(drained, true);
  assert.equal(
    writes.filter((value) => value['report-status']).length,
    reportWritesBeforeLateResolve,
    '取消后延迟返回的采集器不得把报告重新写成运行中。'
  );
});

test('cancelling while the archive write is pending rolls back the exact store run and index entry', async () => {
  const archiveWriteStarted = deferred();
  const releaseArchiveWrite = deferred();
  const controller = new AbortController();
  const state = {
    'store-run-index': [{ runId: 'existing-run', status: 'success' }],
  };
  let blockedArchiveWrite = false;
  const archiveSource = sourceBlock(
    backgroundSource,
    'async function archiveAccountRun',
    '\nasync function saveAccountBatchStatus'
  );
  const context = vm.createContext({
    ACCOUNT_RUN_SNAPSHOT_KEYS: [],
    STORE_RUN_INDEX_KEY: 'store-run-index',
    STORE_RUN_KEY_PREFIX: 'store-run:',
    setTimeout,
    clearTimeout,
    batchText(value, maxLength) {
      return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
    },
    resultFailures() { return []; },
    safeBatchAccount(account) { return copy(account); },
    XhsMetrics: {
      analysisDetailKeys() { return []; },
    },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names
              .filter((key) => Object.prototype.hasOwnProperty.call(state, key))
              .map((key) => [key, copy(state[key])]));
          },
          async set(value) {
            const hasArchive = Object.keys(value).some((key) => key.startsWith('store-run:'));
            if (hasArchive && !blockedArchiveWrite) {
              blockedArchiveWrite = true;
              archiveWriteStarted.resolve();
              await releaseArchiveWrite.promise;
            }
            Object.assign(state, copy(value));
          },
          async remove(key) { delete state[key]; },
        },
      },
    },
  });
  vm.runInContext(
    platformHelpers + '\n' + archiveSource + '\nglobalThis.testArchive = archiveAccountRun;',
    context
  );

  const running = context.testArchive(
    {
      id: 'current-session',
      name: '当前账号',
      storeId: 'fictional-store',
      storeName: '测试店铺',
    },
    'project-task-archive-race',
    Date.now(),
    { state: 'currentSession' },
    null,
    { ok: true, results: [] },
    '',
    { taskType: 'report', runMode: 'current', signal: controller.signal }
  );
  await archiveWriteStarted.promise;
  controller.abort();
  releaseArchiveWrite.resolve();
  await assert.rejects(running, (error) => error.code === 'PROJECT_TASK_CANCELLED');

  assert.deepEqual(state['store-run-index'], [{ runId: 'existing-run', status: 'success' }]);
  assert.deepEqual(
    Object.keys(state).filter((key) => key.startsWith('store-run:')),
    [],
    '取消不得留下已提交的本次店铺运行记录。'
  );
});

function createProjectHarness(options = {}) {
  const state = {};
  const writes = [];
  const archiveCalls = [];
  const rollbackCalls = [];
  const reportRuns = [];
  const createdTabs = [];
  const removedTabs = [];
  const successWriteStarted = deferred();
  const releaseSuccessWrite = deferred();
  let blockedSuccessWrite = false;
  const helpers = sourceBlock(
    backgroundSource,
    'function waitMilliseconds(duration)',
    '\nasync function waitTabComplete'
  );
  const projectFunctions = sourceBlock(
    backgroundSource,
    'function saveProjectTaskStatus',
    '\nchrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n  if (!message || message.type !== \'PROJECT_TASK_CANCEL\') return;'
  );
  const context = vm.createContext({
    AbortController,
    DOMException,
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    PROJECT_TASK_STATUS_KEY: 'taobaoProjectTaskStatusV1',
    CONTENT_DIAGNOSIS_STATUS_KEY: 'taobaoContentDiagnosisReportStatusV1',
    BUSINESS_DEFENSE_XINGHE_URL: 'https://adstar.alimama.com/portal/v2/pages/myAdstar/order/list.htm',
    XHS_PLATFORM_ENTRY_URLS: {
      pgy: 'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
      juguang: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
    },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: { id: 'fictional-extension-id' },
      tabs: {
        async create(details) {
          createdTabs.push(copy(details));
          return { id: 41, status: 'loading', url: details.url };
        },
        async remove(tabId) {
          removedTabs.push(Number(tabId));
        },
      },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names
              .filter((key) => Object.prototype.hasOwnProperty.call(state, key))
              .map((key) => [key, copy(state[key])]));
          },
          async set(value) {
            const projectStatus = value.taobaoProjectTaskStatusV1;
            if (
              options.blockFinalSuccess === true &&
              projectStatus && projectStatus.running === false &&
              projectStatus.status === 'success' &&
              !blockedSuccessWrite
            ) {
              blockedSuccessWrite = true;
              successWriteStarted.resolve();
              await releaseSuccessWrite.promise;
            }
            writes.push(copy(value));
            Object.assign(state, copy(value));
          },
        },
      },
    },
    async clearAccountRunSnapshots() {},
    async archiveAccountRun(...args) {
      archiveCalls.push(args);
      return {
        runId: 'fictional-archive-' + archiveCalls.length,
        status: 'success',
        failureCount: 0,
      };
    },
    async rollbackAccountRunArchive(runId) {
      rollbackCalls.push(runId);
    },
    async runContentDiagnosisReport(options) {
      const gate = deferred();
      const drainGate = deferred();
      const record = { options, gate, drainGate };
      reportRuns.push(record);
      const signal = options && options.signal;
      if (signal && signal.aborted) throw signal.reason;
      if (signal) signal.addEventListener('abort', () => {
        const error = signal.reason;
        error.drainPromise = drainGate.promise;
        gate.reject(error);
      }, { once: true });
      return gate.promise;
    },
    batchText(value, maxLength) {
      return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
    },
    normalizeProjectPlatformTaskIds(value) {
      return Array.isArray(value) ? value.slice() : [];
    },
    normalizeXhsDateRange(value) {
      return value;
    },
    async prepareCurrentSessionProjectPlatforms() {
      return { taskOwnedTabIds: {}, platforms: {} };
    },
  });
  const currentSessionPreflightStub = context.prepareCurrentSessionProjectPlatforms;
  vm.runInContext(
    'let projectTaskPromise = null; let projectTaskExecution = null; let projectTaskStatusWriteQueue = Promise.resolve(); let contentDiagnosisReportPromise = null;\n' +
      helpers + '\n' + projectFunctions +
      '\nglobalThis.testEnsure = ensureProjectTask;' +
      '\nglobalThis.testCancel = requestProjectTaskCancel;' +
      '\nglobalThis.testSave = saveProjectTaskStatus;' +
      '\nglobalThis.testExecution = () => projectTaskExecution;' +
      '\nglobalThis.testContentPromise = () => contentDiagnosisReportPromise;',
    context
  );
  context.prepareCurrentSessionProjectPlatforms = currentSessionPreflightStub;
  return {
    archiveCalls,
    context,
    createdTabs,
    releaseSuccessWrite,
    reportRuns,
    removedTabs,
    rollbackCalls,
    state,
    successWriteStarted,
    writes,
  };
}

function validPayload(storeId = 'fictional-store') {
  return {
    credentialMode: 'currentSession',
    store: { id: storeId, name: '测试店铺' },
    platforms: ['adstar'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
  };
}

test('current project cancellation reaches a cancelled terminal state, never archives, and allows a new task', async () => {
  const harness = createProjectHarness();
  const first = harness.context.testEnsure(validPayload('fictional-first'));
  await waitFor(() => harness.reportRuns.length === 1, '首个报告任务未启动。');
  assert.equal(harness.reportRuns[0].options.signal instanceof AbortSignal, true);

  const cancel = await harness.context.testCancel({ taskId: first.taskId });
  assert.equal(cancel.ok, true);
  assert.equal(cancel.cancelling, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const draining = harness.state.taobaoProjectTaskStatusV1;
  assert.equal(draining.taskId, first.taskId);
  assert.equal(draining.running, true);
  assert.equal(draining.cancelling, true);
  assert.equal(draining.cancelled, false);
  assert.equal(draining.status, 'cancelling');
  assert.equal(draining.phase, '安全停止中');
  assert.notEqual(harness.context.testExecution(), null,
    '未结束的底层读取仍应占有执行权，防止新任务被旧写入污染。');
  const blocked = harness.context.testEnsure(validPayload('fictional-too-early'));
  assert.equal(blocked.started, false);
  assert.equal(blocked.taskId, first.taskId);
  assert.deepEqual(harness.removedTabs, [], '采集 drain 完成前不得关闭任务标签页。');
  harness.reportRuns[0].drainGate.resolve();
  const result = await first.promise;
  assert.equal(result.cancelled, true);
  assert.deepEqual(harness.removedTabs, [41],
    '必须先排空采集，再关闭本次任务创建的标签页。');
  await waitFor(() => harness.context.testExecution() === null, '取消后未释放任务执行权。');

  const terminal = harness.state.taobaoProjectTaskStatusV1;
  assert.equal(terminal.taskId, first.taskId);
  assert.equal(terminal.running, false);
  assert.equal(terminal.cancelling, false);
  assert.equal(terminal.cancelled, true);
  assert.equal(terminal.status, 'cancelled');
  assert.equal(harness.archiveCalls.length, 0);

  const second = harness.context.testEnsure(validPayload('fictional-second'));
  assert.equal(second.started, true);
  assert.notEqual(second.taskId, first.taskId);
  await waitFor(() => harness.reportRuns.length === 2, '第二个报告任务未启动。');
  await harness.context.testCancel({ taskId: second.taskId });
  harness.reportRuns[1].drainGate.resolve();
  await second.promise;
});

test('cancelling during the pending success-status write ends cancelled and rolls back the archive', async () => {
  const harness = createProjectHarness({ blockFinalSuccess: true });
  const launch = harness.context.testEnsure(validPayload('fictional-final-write-race'));
  await waitFor(() => harness.reportRuns.length === 1);
  harness.reportRuns[0].gate.resolve({ ok: true, partial: false, results: [] });
  await harness.successWriteStarted.promise;

  const cancellation = harness.context.testCancel({ taskId: launch.taskId });
  assert.equal(
    harness.reportRuns[0].options.signal.aborted,
    true,
    '取消必须先同步中断执行权，不能被正在排队的成功状态写入阻塞。'
  );
  harness.releaseSuccessWrite.resolve();

  const [cancelResult, taskResult] = await Promise.all([cancellation, launch.promise]);
  assert.equal(cancelResult.ok, true);
  assert.equal(taskResult.cancelled, true);
  await waitFor(() => harness.state.taobaoProjectTaskStatusV1.status === 'cancelled');
  const terminal = harness.state.taobaoProjectTaskStatusV1;
  assert.equal(terminal.running, false);
  assert.equal(terminal.cancelling, false);
  assert.equal(terminal.cancelled, true);
  assert.deepEqual(harness.rollbackCalls, ['fictional-archive-1']);
});

test('a stale project task id cannot cancel the newer execution or overwrite its status', async () => {
  const harness = createProjectHarness();
  const current = harness.context.testEnsure(validPayload('fictional-current'));
  await waitFor(() => harness.reportRuns.length === 1);

  const staleCancel = await harness.context.testCancel({ taskId: 'project-task-stale' });
  assert.equal(staleCancel.ok, false);
  assert.equal(harness.reportRuns[0].options.signal.aborted, false);

  const lateWrite = await harness.context.testSave({
    taskId: 'project-task-stale',
    running: true,
    phase: '旧任务延迟写入',
  }, 'project-task-stale');
  assert.equal(lateWrite.saved, false);
  assert.equal(harness.state.taobaoProjectTaskStatusV1.taskId, current.taskId);

  await harness.context.testCancel({ taskId: current.taskId });
  harness.reportRuns[0].drainGate.resolve();
  await current.promise;
});

test('project cancellation requires extension-confirmed visible one-click sender', () => {
  const block = sourceBlock(
    backgroundSource,
    'function isTrustedProjectTaskCancelSender',
    '\nasync function requestProjectTaskCancel'
  );
  const context = vm.createContext({
    chrome: { runtime: { id: 'fictional-extension-id' } },
    isOneClickWebToolSender(message, sender) {
      return message && message.source === 'business-defense-web-tool' &&
        sender && sender.url === 'http://127.0.0.1:3400/report.html';
    },
  });
  vm.runInContext(block + '\nglobalThis.testTrusted = isTrustedProjectTaskCancelSender;', context);
  const sender = {
    id: 'fictional-extension-id',
    url: 'http://127.0.0.1:3400/report.html',
  };
  const message = {
    type: 'PROJECT_TASK_CANCEL',
    source: 'business-defense-web-tool',
    confirmedByExtension: true,
  };
  assert.equal(context.testTrusted(message, sender), true);
  assert.equal(context.testTrusted({ ...message, confirmedByExtension: false }, sender), false);
  assert.equal(context.testTrusted(message, { ...sender, id: 'other-extension' }), false);
  assert.equal(context.testTrusted(message, { ...sender, url: 'http://127.0.0.1:3400/accounts.html' }), false);
  assert.match(backgroundSource, /message\.type !== 'PROJECT_TASK_CANCEL'/);
});

test('a failed task clears stale verification-wait fields from its terminal status', async () => {
  const ensureSource = sourceBlock(
    backgroundSource,
    'function ensureProjectTask(payload, launchOptions)',
    '\nfunction isTrustedProjectTaskCancelSender'
  );
  const state = {};
  const writes = [];
  const failure = new Error('蒲公英账号或密码错误。');
  failure.code = 'LOGIN_FAILED';
  const context = vm.createContext({
    AbortController,
    PROJECT_TASK_STATUS_KEY: 'taobaoProjectTaskStatusV1',
    createProjectTaskId() { return 'project-task-terminal-failure'; },
    async runProjectTask(payload, execution) {
      state.taobaoProjectTaskStatusV1 = {
        taskId: execution.taskId,
        running: true,
        paused: true,
        waitingForVerification: true,
        verificationPlatforms: ['pgy'],
        pauseReason: '仍在等待蒲公英人工验证。',
      };
      await Promise.resolve();
      throw failure;
    },
    isProjectTaskCancellation() { return false; },
    batchText(value, maxLength) {
      return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
    },
    async saveProjectTaskStatus(value) {
      const saved = copy(value);
      writes.push(saved);
      state.taobaoProjectTaskStatusV1 = saved;
    },
    chrome: {
      storage: {
        local: {
          async get() {
            return { taobaoProjectTaskStatusV1: copy(state.taobaoProjectTaskStatusV1) };
          },
        },
      },
    },
  });
  vm.runInContext(
    'let projectTaskPromise = null; let projectTaskExecution = null;\n' +
      ensureSource + '\nglobalThis.testEnsure = ensureProjectTask;',
    context
  );

  const launch = context.testEnsure({ credentialMode: 'vault' }, {});
  await assert.rejects(launch.promise, /蒲公英账号或密码错误/);
  await waitFor(() => writes.some((status) => status.status === 'failed'));
  const terminal = state.taobaoProjectTaskStatusV1;
  assert.equal(terminal.running, false);
  assert.equal(terminal.paused, false);
  assert.equal(terminal.waitingForVerification, false);
  assert.deepEqual(terminal.verificationPlatforms, []);
  assert.equal(terminal.pauseReason, '');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.error, '蒲公英账号或密码错误。');
});

test('startup recovery marks an interrupted project task cancelled instead of completed', async () => {
  const startupRecovery = sourceBlock(
    backgroundSource,
    'function startupStatusRecoveryMatches',
    '\nfunction isSensitiveTraceKey'
  );
  const state = {
    taobaoProjectTaskStatusV1: {
      taskId: 'project-task-before-reload',
      running: true,
      paused: true,
      waitingForVerification: true,
      verificationPlatforms: ['pgy'],
      pauseReason: '等待蒲公英验证。',
      phase: '一键取数',
    },
  };
  const context = vm.createContext({
    CONTENT_DIAGNOSIS_STATUS_KEY: 'taobaoContentDiagnosisReportStatusV1',
    PROJECT_TASK_STATUS_KEY: 'taobaoProjectTaskStatusV1',
    contentDiagnosisReportPromise: null,
    projectTaskPromise: null,
    projectTaskExecution: null,
    projectTaskStatusWriteQueue: Promise.resolve(),
    chrome: {
      storage: {
        local: {
          async get() { return copy(state); },
          async set(value) { Object.assign(state, copy(value)); },
        },
      },
    },
  });
  vm.runInContext(
    startupRecovery +
      '\nglobalThis.testRecoverProject = recoverProjectTaskStartupStatus;' +
      '\nglobalThis.testRecoverContent = recoverContentDiagnosisStartupStatus;',
    context
  );
  await context.testRecoverProject();
  assert.equal(state.taobaoProjectTaskStatusV1.cancelled, true);
  assert.equal(state.taobaoProjectTaskStatusV1.cancelling, false);
  assert.equal(state.taobaoProjectTaskStatusV1.status, 'cancelled');
  assert.equal(state.taobaoProjectTaskStatusV1.paused, false);
  assert.equal(state.taobaoProjectTaskStatusV1.waitingForVerification, false);
  assert.deepEqual(state.taobaoProjectTaskStatusV1.verificationPlatforms, []);
  assert.equal(state.taobaoProjectTaskStatusV1.pauseReason, '');
});

test('startup recovery rechecks revisions and project start waits for both stale-status recoveries', async () => {
  const startupRecovery = sourceBlock(
    backgroundSource,
    'function startupStatusRecoveryMatches',
    '\nfunction isSensitiveTraceKey'
  );
  const projectSecondGetStarted = deferred();
  const contentSecondGetStarted = deferred();
  const releaseSecondGets = deferred();
  const state = {
    taobaoProjectTaskStatusV1: {
      taskId: 'project-task-old',
      running: true,
      startedAt: 100,
    },
    taobaoContentDiagnosisReportStatusV1: {
      runId: 'report-old',
      running: true,
      startedAt: 100,
    },
  };
  const getCounts = new Map();
  const context = vm.createContext({
    CONTENT_DIAGNOSIS_STATUS_KEY: 'taobaoContentDiagnosisReportStatusV1',
    PROJECT_TASK_STATUS_KEY: 'taobaoProjectTaskStatusV1',
    contentDiagnosisReportPromise: null,
    projectTaskPromise: null,
    projectTaskExecution: null,
    projectTaskStatusWriteQueue: Promise.resolve(),
    chrome: {
      storage: {
        local: {
          async get(key) {
            const count = (getCounts.get(key) || 0) + 1;
            getCounts.set(key, count);
            if (count === 2) {
              if (key === 'taobaoProjectTaskStatusV1') projectSecondGetStarted.resolve();
              if (key === 'taobaoContentDiagnosisReportStatusV1') contentSecondGetStarted.resolve();
              await releaseSecondGets.promise;
            }
            return { [key]: copy(state[key]) };
          },
          async set(value) { Object.assign(state, copy(value)); },
        },
      },
    },
  });
  vm.runInContext(
    startupRecovery +
      '\nglobalThis.testRecoverProject = recoverProjectTaskStartupStatus;' +
      '\nglobalThis.testRecoverContent = recoverContentDiagnosisStartupStatus;',
    context
  );
  const projectRecovery = context.testRecoverProject();
  const contentRecovery = context.testRecoverContent();
  await Promise.all([projectSecondGetStarted.promise, contentSecondGetStarted.promise]);

  state.taobaoProjectTaskStatusV1 = {
    taskId: 'project-task-new',
    running: true,
    startedAt: 200,
  };
  state.taobaoContentDiagnosisReportStatusV1 = {
    runId: 'report-new',
    running: true,
    startedAt: 200,
  };
  releaseSecondGets.resolve();
  await Promise.all([projectRecovery, contentRecovery]);
  assert.equal(state.taobaoProjectTaskStatusV1.taskId, 'project-task-new');
  assert.equal(state.taobaoProjectTaskStatusV1.running, true);
  assert.equal(state.taobaoContentDiagnosisReportStatusV1.runId, 'report-new');
  assert.equal(state.taobaoContentDiagnosisReportStatusV1.running, true);

  const startListener = sourceBlock(
    backgroundSource,
    "if (!message || message.type !== 'PROJECT_TASK_START') return;",
    "\nchrome.runtime.onMessage.addListener((message, sender, sendResponse) => {\n  if (!message || !["
  );
  const awaitRecovery = startListener.indexOf('projectTaskStartupRecoveryPromise');
  const launch = startListener.indexOf('ensureProjectTask(message.payload || {}, {');
  assert.ok(awaitRecovery >= 0 && launch > awaitRecovery,
    '项目任务启动必须等待项目与报告的启动恢复完成。');
});
