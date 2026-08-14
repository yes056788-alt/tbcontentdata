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

test('XHS report retries isolate collector cache identity by attempt-specific run id', () => {
  const from = source.indexOf('async function runContentDiagnosisReport');
  const to = source.indexOf('\nfunction batchText', from);
  assert.ok(from >= 0 && to > from, 'report runner must remain extractable');
  const report = source.slice(from, to);
  assert.match(report, /key:\s*['"]xiaohongshu['"][\s\S]*?run:\s*async\s*\(attempt\)/);
  assert.match(report, /runId:\s*runId\s*\+\s*['"]-xhs-attempt-['"]\s*\+\s*attempt/);
});
