const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

test('platform retry forwards a stable attempt number to the collector step', async () => {
  const from = source.indexOf('function normalizePlatformTaskIds');
  const to = source.indexOf('\nasync function waitTabComplete', from);
  assert.ok(from >= 0 && to > from, 'retry helper must remain extractable');
  const context = vm.createContext({
    PLATFORM_TASK_IDS: ['sycm'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 3,
    async waitMilliseconds() {},
  });
  vm.runInContext(
    source.slice(from, to) + '\nglobalThis.retryForTest = runPlatformStepWithRetry;',
    context,
  );

  const seen = [];
  const result = await context.retryForTest({
    async run(attempt) {
      seen.push(attempt);
      if (attempt === 1) throw new Error('fictional transient failure');
      return { runId: `fictional-xhs-attempt-${attempt}` };
    },
  });

  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.attempts, 2);
  assert.equal(result.detail.runId, 'fictional-xhs-attempt-2');
});

test('platform retry exhausts transient returned XHS collection failures and preserves the last detail', async () => {
  const from = source.indexOf('function normalizePlatformTaskIds');
  const to = source.indexOf('\nasync function waitTabComplete', from);
  assert.ok(from >= 0 && to > from, 'retry helper must remain extractable');
  const context = vm.createContext({
    PLATFORM_TASK_IDS: ['sycm'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 3,
    async waitMilliseconds() {},
  });
  vm.runInContext(
    source.slice(from, to) + '\nglobalThis.retryForTest = runPlatformStepWithRetry;',
    context,
  );

  const attempts = [];
  const returnedDetails = [1, 2, 3].map((attempt) => ({
    ok: false,
    code: 'XHS_COLLECTION_FAILED',
    warning: `fictional transient XHS failure ${attempt}`,
  }));
  const result = await context.retryForTest({
    async run(attempt) {
      attempts.push(attempt);
      return returnedDetails[attempt - 1];
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(result.attempts, 3);
  assert.equal(result.detail, returnedDetails[2], 'the final failed detail remains reportable');
});

test('platform retry does not retry returned XHS account, structure, or explicitly terminal failures', async () => {
  const from = source.indexOf('function normalizePlatformTaskIds');
  const to = source.indexOf('\nasync function waitTabComplete', from);
  assert.ok(from >= 0 && to > from, 'retry helper must remain extractable');
  const context = vm.createContext({
    PLATFORM_TASK_IDS: ['sycm'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 3,
    async waitMilliseconds() {},
  });
  vm.runInContext(
    source.slice(from, to) + '\nglobalThis.retryForTest = runPlatformStepWithRetry;',
    context,
  );

  for (const detail of [
    { ok: false, code: 'XHS_ACCOUNT_BINDING_FAILED' },
    { ok: false, code: 'XHS_ANALYSIS_STRUCTURE_INVALID' },
    { ok: false, code: 'XHS_COLLECTION_FAILED', retryable: false },
  ]) {
    const attempts = [];
    const result = await context.retryForTest({
      async run(attempt) {
        attempts.push(attempt);
        return detail;
      },
    });

    assert.deepEqual(attempts, [1], `${detail.code} must remain terminal`);
    assert.equal(result.attempts, 1);
    assert.equal(result.detail, detail);
  }
});

test('a returned transient failure never masks a later terminal thrown error', async () => {
  const from = source.indexOf('function normalizePlatformTaskIds');
  const to = source.indexOf('\nasync function waitTabComplete', from);
  assert.ok(from >= 0 && to > from, 'retry helper must remain extractable');
  const context = vm.createContext({
    PLATFORM_TASK_IDS: ['sycm'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 3,
    async waitMilliseconds() {},
  });
  vm.runInContext(
    source.slice(from, to) + '\nglobalThis.retryForTest = runPlatformStepWithRetry;',
    context,
  );

  const attempts = [];
  await assert.rejects(
    context.retryForTest({
      async run(attempt) {
        attempts.push(attempt);
        if (attempt === 1) {
          return { ok: false, code: 'XHS_COLLECTION_FAILED', retryable: true };
        }
        const error = new Error('fictional terminal permission failure');
        error.code = 'XHS_PERMISSION_DENIED';
        error.retryable = false;
        throw error;
      },
    }),
    (error) => error && error.code === 'XHS_PERMISSION_DENIED' &&
      /terminal permission failure/.test(error.message),
  );
  assert.deepEqual(attempts, [1, 2]);
});

test('a returned transient failure never masks the final thrown error after retries exhaust', async () => {
  const from = source.indexOf('function normalizePlatformTaskIds');
  const to = source.indexOf('\nasync function waitTabComplete', from);
  assert.ok(from >= 0 && to > from, 'retry helper must remain extractable');
  const context = vm.createContext({
    PLATFORM_TASK_IDS: ['sycm'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 3,
    async waitMilliseconds() {},
  });
  vm.runInContext(
    source.slice(from, to) + '\nglobalThis.retryForTest = runPlatformStepWithRetry;',
    context,
  );

  const attempts = [];
  await assert.rejects(
    context.retryForTest({
      async run(attempt) {
        attempts.push(attempt);
        if (attempt === 1) {
          return { ok: false, code: 'XHS_COLLECTION_FAILED', retryable: true };
        }
        const error = new Error(`fictional transient throw ${attempt}`);
        error.code = 'XHS_TRANSIENT_THROW';
        throw error;
      },
    }),
    (error) => error && error.code === 'XHS_TRANSIENT_THROW' &&
      /fictional transient throw 3/.test(error.message),
  );
  assert.deepEqual(attempts, [1, 2, 3]);
});

test('XHS report retries isolate collector cache identity by attempt-specific run id', () => {
  const from = source.indexOf('async function runContentDiagnosisReport');
  const to = source.indexOf('\nfunction batchText', from);
  assert.ok(from >= 0 && to > from, 'report runner must remain extractable');
  const report = source.slice(from, to);
  assert.match(report, /key:\s*['"]xiaohongshu['"][\s\S]*?run:\s*async\s*\(attempt\)/);
  assert.match(report, /runId:\s*runId\s*\+\s*['"]-xhs-attempt-['"]\s*\+\s*attempt/);
});
