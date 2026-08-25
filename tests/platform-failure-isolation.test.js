const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `failed to extract ${startMarker}`);
  return background.slice(start, end);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withTimeout(promise, message) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

const helperSource = sourceBlock(
  'function normalizePlatformTaskIds',
  '\nasync function waitTabComplete',
);
const reportSource = sourceBlock(
  'async function runContentDiagnosisReport(options)',
  '\nfunction batchText',
);
const ensureSource = sourceBlock(
  'function ensureContentDiagnosisReportTask(options)',
  '\nfunction ensureAccountBatchTask',
);

async function runFailureScenario(failingKey) {
  const events = [];
  const localState = {};
  const delayedStarts = deferred();
  const successfulRuns = deferred();
  const failurePersisted = deferred();

  const startSuccessfulRun = async (key, result) => {
    events.push(`${key}:start`);
    await successfulRuns.promise;
    events.push(`${key}:complete`);
    return result;
  };
  const startRun = async (key, result) => {
    events.push(`${key}:start`);
    if (key === failingKey) {
      events.push(`${key}:failed`);
      const error = new Error(`${key} fixture terminal failure`);
      error.code = `${key.toUpperCase()}_FIXTURE_FAILURE`;
      error.retryable = false;
      throw error;
    }
    return startSuccessfulRun(key, result);
  };

  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get(key) {
            return { [key]: localState[key] };
          },
          async remove(key) {
            delete localState[key];
          },
          async set(value) {
            const copy = structuredClone(value);
            Object.assign(localState, copy);
            const status = copy['report-status'];
            if (
              status && Array.isArray(status.results) &&
              status.results.some((item) => item.key === failingKey && item.ok === false)
            ) {
              failurePersisted.resolve();
            }
          },
        },
      },
    },
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    contentDiagnosisResultMessage: () => '',
    async waitMilliseconds() {
      await delayedStarts.promise;
    },
    async runBusinessDefenseSycm() {
      return startRun('sycm', { snapshot: { schema: 1 } });
    },
    async runBusinessDefenseGuanghe() {
      return startRun('guanghe', {
        source: 'fixture-guanghe',
        snapshot: { schema: 9, rows: [] },
      });
    },
    async runBusinessDefenseDmp() {
      return startRun('dmp', {
        source: 'fixture-dmp',
        snapshot: { schema: 2, results: [] },
      });
    },
    async prepareContentDiagnosisWxtTab(section) {
      events.push(`wxt:${section}:start`);
      if (section === 'marketing') await successfulRuns.promise;
      return 71;
    },
    async runContentDiagnosisWxtSection(tabId, runId, section) {
      events.push(`wxt:${section}:complete`);
      return { ok: true };
    },
    async runXhsAnalysisTask() {
      return startRun('xiaohongshu', {
        ok: true,
        snapshot: { schema: 'xhsAnalysisSnapshotV1' },
      });
    },
    structuredClone,
  });

  vm.runInContext(
    helperSource + '\n' + reportSource + '\n' + ensureSource +
      '\nlet contentDiagnosisReportPromise = null;' +
      '\nglobalThis.testEnsure = ensureContentDiagnosisReportTask;',
    context,
  );

  const ensured = context.testEnsure({
    platforms: ['sycm', 'guanghe', 'wxt', 'dmp', 'pgy'],
    storeId: 'fixture-store-failure-isolation',
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
  });
  assert.equal(ensured.started, true);

  let parallelStartError = null;
  try {
    await withTimeout(
      failurePersisted.promise,
      `${failingKey} failure was not persisted`,
    );
    const topLevelStarts = events
      .filter((event) => event.endsWith(':start'))
      .map((event) => event.replace(/:marketing:start$/, '').replace(/:start$/, ''));
    try {
      assert.deepEqual(
        Array.from(new Set(topLevelStarts)).sort(),
        ['dmp', 'guanghe', 'sycm', 'wxt', 'xiaohongshu'],
        `${failingKey} failure must not settle before every selected top-level platform has started`,
      );
    } catch (error) {
      parallelStartError = error;
    }
  } finally {
    delayedStarts.resolve();
    successfulRuns.resolve();
  }

  const result = await withTimeout(
    ensured.promise,
    `${failingKey} failure prevented survivor platforms from completing`,
  );
  const finalStatus = localState['report-status'];
  const finalReport = localState['report-data'];
  assert.equal(result.ok, true, `${failingKey} failure must preserve successful sibling results`);
  assert.equal(result.partial, true);
  assert.equal(finalStatus.running, false);
  assert.ok(Number(finalStatus.finishedAt) > 0);
  assert.equal(finalReport.finishedAt, finalStatus.finishedAt);
  assert.equal(finalStatus.results.find((item) => item.key === failingKey).ok, false);
  assert.equal(
    finalStatus.results
      .filter((item) => !item.skipped && item.key !== failingKey)
      .every((item) => item.ok === true),
    true,
    `${failingKey} failure must not poison sibling platform results`,
  );
  assert.ok(events.includes('guanghe:complete'));
  assert.ok(events.includes('dmp:complete'));
  assert.ok(events.includes('wxt:shortVideo:complete'));
  if (failingKey !== 'xiaohongshu') assert.ok(events.includes('xiaohongshu:complete'));
  if (failingKey !== 'sycm') assert.ok(events.includes('sycm:complete'));

  if (parallelStartError) throw parallelStartError;
}

test('a fast Taobao or XHS failure cannot delay, cancel, or block archival of sibling platforms', async () => {
  for (const failingKey of ['sycm', 'xiaohongshu']) {
    await runFailureScenario(failingKey);
  }
});
