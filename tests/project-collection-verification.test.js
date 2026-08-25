const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'missing source block: ' + startMarker);
  return background.slice(start, end);
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message || '等待条件超时。');
}

function verificationError(values) {
  const source = values && typeof values === 'object' ? values : {};
  const error = new Error(source.message || '蒲公英需要人工安全验证。');
  error.code = source.code || 'VERIFICATION_REQUIRED';
  if (source.platform !== null) error.platform = source.platform || 'pgy';
  if (source.tabId !== null) error.tabId = source.tabId || 77;
  if (source.retryable !== undefined) error.retryable = source.retryable;
  return error;
}

function createReportHarness(options = {}) {
  const writes = [];
  const sycmCalls = [];
  const xhsCalls = [];
  const verificationCalls = [];
  const verificationGate = options.verificationGate || deferred();
  let xhsCallCount = 0;
  const context = vm.createContext({
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
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    setTimeout(callback) { return setTimeout(callback, 0); },
    clearTimeout,
    contentDiagnosisResultMessage() { return ''; },
    async runBusinessDefenseSycm() {
      sycmCalls.push(Date.now());
      if (options.sycmGate) await options.sycmGate.promise;
      return { ok: true, snapshot: { visitors: 1 } };
    },
    async runBusinessDefenseGuanghe() { throw new Error('unexpected guanghe call'); },
    async runBusinessDefenseDmp() { throw new Error('unexpected dmp call'); },
    async prepareContentDiagnosisWxtTab() { throw new Error('unexpected wxt call'); },
    async runContentDiagnosisWxtSection() { throw new Error('unexpected wxt call'); },
    async runXhsAnalysisTask(runOptions) {
      xhsCallCount += 1;
      xhsCalls.push(copy(runOptions));
      if (typeof options.runXhs === 'function') {
        return options.runXhs(xhsCallCount, runOptions);
      }
      if (xhsCallCount === 1) throw verificationError();
      return {
        ok: true,
        partial: false,
        platforms: ['pgy'],
        snapshot: { schema: 1, notes: [], quality: { issues: [] } },
      };
    },
    chrome: {
      storage: {
        local: {
          async remove() {},
          async set(value) { writes.push(copy(value)); },
        },
      },
    },
  });

  const platformHelpers = sourceBlock(
    'function waitMilliseconds(duration)',
    '\nasync function waitTabComplete',
  );
  const reportSource = sourceBlock(
    'async function runContentDiagnosisReport(options)',
    '\nfunction batchText',
  );
  vm.runInContext(
    platformHelpers + '\n' + reportSource + '\nglobalThis.runReportUnderTest = runContentDiagnosisReport;',
    context,
    { filename: 'project-collection-verification.js' },
  );

  const onVerificationRequired = async (error) => {
    verificationCalls.push(error);
    if (options.cancelAwareSignal) {
      const signal = options.cancelAwareSignal;
      if (signal.aborted) throw context.projectTaskCancellationError(signal.reason);
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          reject(context.projectTaskCancellationError(signal.reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        verificationGate.promise.then((value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        }, reject);
      });
      return;
    }
    await verificationGate.promise;
  };

  return {
    context,
    onVerificationRequired,
    sycmCalls,
    verificationCalls,
    verificationGate,
    writes,
    xhsCalls,
  };
}

test('collection verification waits and retries only the XHS report step', async () => {
  const harness = createReportHarness();
  const running = harness.context.runReportUnderTest({
    platforms: ['sycm', 'pgy'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    onVerificationRequired: harness.onVerificationRequired,
  });

  const observed = await Promise.race([
    waitFor(() => harness.verificationCalls.length === 1).then(() => 'waiting'),
    running.then(() => 'completed'),
  ]);
  assert.equal(observed, 'waiting', '结构化验证必须进入人工等待，不能落入普通平台重试。');
  assert.equal(harness.sycmCalls.length, 1);
  assert.equal(harness.xhsCalls.length, 1);
  assert.equal(harness.verificationCalls[0].platform, 'pgy');
  assert.equal(harness.verificationCalls[0].tabId, 77);

  harness.verificationGate.resolve({ kind: 'productReady' });
  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(harness.sycmCalls.length, 1, '人工验证后不得重跑已完成的淘宝任务。');
  assert.equal(harness.xhsCalls.length, 2, '人工验证后只重启小红书报告 step。');
  assert.notEqual(
    harness.xhsCalls[0].runId,
    harness.xhsCalls[1].runId,
    '局部重跑必须使用新的 XHS runId，避免复用失败尝试的缓存。',
  );
});

test('verification metadata survives an earlier transient XHS retry', async () => {
  const harness = createReportHarness({
    runXhs(callNumber) {
      if (callNumber === 1) throw new Error('临时网络错误。');
      if (callNumber === 2) throw verificationError({ platform: 'juguang', tabId: 88 });
      return {
        ok: true,
        partial: false,
        platforms: ['juguang'],
        snapshot: { schema: 1, notes: [], quality: { issues: [] } },
      };
    },
  });
  const running = harness.context.runReportUnderTest({
    platforms: ['juguang'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    onVerificationRequired: harness.onVerificationRequired,
  });

  const observed = await Promise.race([
    waitFor(() => harness.verificationCalls.length === 1).then(() => 'waiting'),
    running.then(() => 'completed'),
  ]);
  assert.equal(observed, 'waiting');
  assert.equal(harness.xhsCalls.length, 2);
  assert.equal(harness.verificationCalls[0].platform, 'juguang');
  assert.equal(harness.verificationCalls[0].tabId, 88);

  harness.verificationGate.resolve({ kind: 'productReady' });
  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(harness.xhsCalls.length, 3);
});

test('sentinel-shaped generic errors do not enter verification waiting', async () => {
  const harness = createReportHarness({
    runXhs() {
      throw verificationError({ platform: null, tabId: null, retryable: false });
    },
  });
  const result = await harness.context.runReportUnderTest({
    platforms: ['sycm', 'pgy'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    onVerificationRequired: harness.onVerificationRequired,
  });

  assert.equal(harness.verificationCalls.length, 0);
  assert.equal(harness.xhsCalls.length, 1);
  assert.equal(result.partial, true);
  const xhsResult = result.results.find((item) => item.key === 'xiaohongshu');
  assert.equal(xhsResult.ok, false);
});

test('a standalone report without a verification handler fails closed', async () => {
  const harness = createReportHarness({
    runXhs() { throw verificationError({ message: '蒲公英验证码未完成。' }); },
  });
  const result = await harness.context.runReportUnderTest({
    platforms: ['pgy'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
  });

  assert.equal(harness.verificationCalls.length, 0);
  assert.equal(harness.xhsCalls.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.results.find((item) => item.key === 'xiaohongshu').code, 'VERIFICATION_REQUIRED');
});

test('a non-cancellation verification wait failure is contained to XHS and drains parallel Taobao work', async () => {
  const sycmGate = deferred();
  const harness = createReportHarness({ sycmGate });
  const running = harness.context.runReportUnderTest({
    platforms: ['sycm', 'pgy'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    onVerificationRequired: harness.onVerificationRequired,
  });
  const outcome = running.then(
    (value) => ({ state: 'resolved', value }),
    (error) => ({ state: 'rejected', error }),
  );

  await waitFor(() => harness.verificationCalls.length === 1, '采集验证未进入等待。');
  harness.verificationGate.reject(new Error('验证页面状态连续读取失败。'));
  const early = await Promise.race([
    outcome,
    new Promise((resolve) => setTimeout(() => resolve({ state: 'pending' }), 0)),
  ]);
  assert.equal(early.state, 'pending', '必须等待并行的淘宝读取完成后才结束报告。');

  sycmGate.resolve();
  const final = await outcome;
  assert.equal(final.state, 'resolved');
  assert.equal(final.value.partial, true);
  assert.equal(harness.sycmCalls.length, 1);
  assert.equal(harness.xhsCalls.length, 1, '等待器失败后不得重启小红书采集。');
  const xhsResult = final.value.results.find((item) => item.key === 'xiaohongshu');
  assert.equal(xhsResult.ok, false);
  assert.match(xhsResult.message, /验证页面状态连续读取失败/);
});

test('cancelling during collection verification aborts without restarting XHS', async () => {
  const controller = new AbortController();
  const harness = createReportHarness({ cancelAwareSignal: controller.signal });
  const running = harness.context.runReportUnderTest({
    platforms: ['pgy'],
    storeId: 'store-1',
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    signal: controller.signal,
    onVerificationRequired: harness.onVerificationRequired,
  });

  await waitFor(() => harness.verificationCalls.length === 1, '采集验证未进入等待。');
  controller.abort(contextCancellation('用户取消采集验证等待。'));
  await assert.rejects(running, (error) => {
    assert.equal(error.code, 'PROJECT_TASK_CANCELLED');
    assert.equal(typeof error.drainPromise.then, 'function');
    return true;
  });
  assert.equal(harness.xhsCalls.length, 1, '取消后不得重启小红书采集。');
});

function contextCancellation(message) {
  const error = new Error(message || '任务已取消。');
  error.name = 'AbortError';
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}
