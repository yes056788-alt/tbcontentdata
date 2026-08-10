const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'failed to extract ' + startMarker);
  return background.slice(start, end);
}

const platformHelpers = extractBetween(
  'function normalizePlatformTaskIds',
  '\nasync function waitTabComplete'
);
const autoCollectSource = extractBetween(
  'async function runBusinessDefenseAutoCollect(options)',
  '\nfunction contentDiagnosisResultMessage'
);
const reportSource = extractBetween(
  'async function runContentDiagnosisReport(options)',
  '\nfunction batchText'
);
const resultFailuresSource = extractBetween(
  'function resultFailures(result)',
  '\nasync function archiveAccountRun'
);

async function verifyAutoCollectPartialPropagation() {
  const storageWrites = [];
  let dmpCalls = 0;
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async set(value) {
            storageWrites.push(structuredClone(value));
          },
        },
      },
    },
    BUSINESS_DEFENSE_AUTO_STATUS_KEY: 'auto-status',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    async runBusinessDefenseGuanghe() {
      throw new Error('unselected guanghe runner should not run');
    },
    async runBusinessDefenseSycm() {
      throw new Error('unselected sycm runner should not run');
    },
    async runBusinessDefenseWxt() {
      throw new Error('unselected wxt runner should not run');
    },
    async runBusinessDefenseDmp() {
      dmpCalls += 1;
      return {
        ok: true,
        partial: true,
        source: 'DMP已有人群包',
        count: 1,
        missingCrowds: ['淘天内容人群资产'],
        warnings: ['人群规模仍在计算：淘天内容人群资产'],
      };
    },
    async waitMilliseconds() {},
  });

  vm.runInContext(
    platformHelpers + '\n' + autoCollectSource +
      '\nglobalThis.testRun = runBusinessDefenseAutoCollect;',
    context
  );

  const result = await context.testRun({ platforms: ['dmp'] });
  const dmp = Array.from(result.results).find((item) => item.name === 'DMP人群资产画像');
  const finalStatus = storageWrites.at(-1)['auto-status'];
  const persistedDmp = Array.from(finalStatus.results)
    .find((item) => item.name === 'DMP人群资产画像');

  assert.equal(dmpCalls, 1, 'partial result must not trigger a platform retry');
  assert.equal(dmp.ok, true, 'usable partial data remains a successful platform call');
  assert.equal(dmp.partial, true, 'auto-collect step must preserve detail.partial');
  assert.equal(result.partial, true, 'auto-collect return must aggregate step partial');
  assert.equal(finalStatus.running, false);
  assert.equal(finalStatus.partial, true, 'final auto-collect status must preserve partial');
  assert.equal(persistedDmp.partial, true, 'persisted auto-collect step must preserve partial');
}

async function verifyReportPartialPropagation() {
  const storageWrites = [];
  let dmpCalls = 0;
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async remove() {},
          async set(value) {
            storageWrites.push(structuredClone(value));
          },
        },
      },
    },
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    contentDiagnosisResultMessage(detail) {
      return detail && detail.source || '';
    },
    async runBusinessDefenseSycm() {
      throw new Error('unselected sycm runner should not run');
    },
    async runBusinessDefenseGuanghe() {
      throw new Error('unselected guanghe runner should not run');
    },
    async prepareContentDiagnosisWxtTab() {
      throw new Error('unselected wxt runner should not run');
    },
    async runContentDiagnosisWxtSection() {
      throw new Error('unselected wxt runner should not run');
    },
    async runBusinessDefenseDmp() {
      dmpCalls += 1;
      return {
        ok: true,
        partial: true,
        source: 'DMP已有人群包',
        count: 1,
        missingCrowds: ['淘天内容人群资产'],
        warnings: ['人群规模仍在计算：淘天内容人群资产'],
        snapshot: {
          schema: 2,
          partial: true,
          results: [{ role: 'store', crowd: { coverage: 100 } }],
        },
      };
    },
    async waitMilliseconds() {},
  });

  vm.runInContext(
    platformHelpers + '\n' + reportSource +
      '\nglobalThis.testRun = runContentDiagnosisReport;',
    context
  );

  const result = await context.testRun({ platforms: ['dmp'] });
  const dmp = Array.from(result.results).find((item) => item.key === 'dmp');
  const finalStatus = storageWrites.at(-1)['report-status'];
  const persistedDmp = Array.from(finalStatus.results).find((item) => item.key === 'dmp');

  assert.equal(dmpCalls, 1, 'partial report result must not trigger a platform retry');
  assert.equal(dmp.ok, true, 'usable partial report data remains a successful step');
  assert.equal(dmp.partial, true, 'report step must preserve detail.partial');
  assert.equal(result.partial, true, 'report return must aggregate step partial');
  assert.equal(finalStatus.running, false);
  assert.equal(finalStatus.partial, true, 'final report status must preserve partial');
  assert.equal(persistedDmp.partial, true, 'persisted report step must preserve partial');
}

function verifyArchiveIssueCollection() {
  const context = vm.createContext({});
  vm.runInContext(
    resultFailuresSource + '\nglobalThis.testResultFailures = resultFailures;',
    context
  );

  const issues = Array.from(context.testResultFailures({
    ok: true,
    partial: true,
    results: [
      {
        name: 'DMP人群资产画像',
        ok: true,
        partial: true,
        message: '待创建：淘天内容人群资产',
      },
      { name: '生意参谋流量指标', ok: true, message: '已完成' },
    ],
  }));
  assert.equal(issues.length, 1, 'partial platform step must count as one archive issue');
  assert.match(issues[0], /DMP人群资产画像/);
  assert.match(issues[0], /淘天内容人群资产/);

  const failures = Array.from(context.testResultFailures({
    results: [{ name: '万相台内容投放', ok: false, message: '接口失败' }],
  }));
  assert.equal(failures.length, 1, 'existing failed-step collection must remain compatible');
  assert.match(failures[0], /接口失败/);
}

Promise.all([
  verifyAutoCollectPartialPropagation(),
  verifyReportPartialPropagation(),
]).then(() => {
  verifyArchiveIssueCollection();
  console.log('partial status propagation guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
