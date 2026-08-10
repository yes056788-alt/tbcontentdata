const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'web-tool', 'report.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');

assert.match(background, /const PLATFORM_RETRY_ATTEMPTS = 5/);
assert.match(background, /filter\(\(step\) => selectedPlatforms\.has\(step\.platform\)\)/);
assert.match(background, /const wxtPipeline = async \(\) =>/);
assert.match(background, /activeKeys\.add\('wxtShortVideo'\)/);
assert.match(background, /executeStep\(steps\.find\(\(step\) => step\.key === 'sycm'\)\)/);
assert.match(background, /executeStep\(steps\.find\(\(step\) => step\.key === 'guanghe'\)\)/);
assert.match(background, /activeSteps:/);
assert.match(background, /waitForCompletion === false/);
assert.match(bridge, /parallelPlatformRuns/);
assert.match(bridge, /waitForCompletion: false/);
assert.match(dashboard, /正在并行读取/);
assert.match(report, /正在并行生成/);

function extractFunction(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'failed to extract ' + startMarker);
  return background.slice(start, end);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + (Number(timeoutMs) || 500);
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待并行任务启动超时。');
    await delay(2);
  }
}
const helperStart = background.indexOf('function normalizePlatformTaskIds');
const helperEnd = background.indexOf('\nasync function waitTabComplete', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const platformHelpers = background.slice(helperStart, helperEnd);

async function verifyAutoCollectParallelism() {
  const events = [];
  const storageWrites = [];
  let releaseRunners;
  const runnersStarted = new Promise((resolve) => { releaseRunners = resolve; });
  const runner = (name) => async () => {
    events.push(name + ':start');
    await runnersStarted;
    events.push(name + ':end');
    return { source: name };
  };
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
    runBusinessDefenseGuanghe: runner('guanghe'),
    runBusinessDefenseSycm: runner('sycm'),
    runBusinessDefenseWxt: runner('wxt'),
    runBusinessDefenseDmp: runner('dmp'),
    async waitMilliseconds(milliseconds) {
      await delay(Math.max(1, Math.round(milliseconds / 200)));
    },
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
  });
  const source = extractFunction(
    'async function runBusinessDefenseAutoCollect(options)',
    '\nfunction contentDiagnosisResultMessage'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runBusinessDefenseAutoCollect;', context);
  const running = context.testRun();
  await waitFor(() => events.filter((event) => event.endsWith(':start')).length === 4, 500);
  assert.deepEqual(
    events.filter((event) => event.endsWith(':start')).sort(),
    ['dmp:start', 'guanghe:start', 'sycm:start', 'wxt:start']
  );
  assert.equal(events.some((event) => event.endsWith(':end')), false);
  assert.equal(events[0], 'sycm:start');
  releaseRunners();
  await running;
  const finalStatus = storageWrites.at(-1)['auto-status'];
  assert.equal(finalStatus.running, false);
  assert.deepEqual(Array.from(finalStatus.activeSteps), []);
  assert.equal(finalStatus.results.length, 4);
}

async function verifyReportParallelism() {
  const events = [];
  const storageWrites = [];
  let releaseInitialSteps;
  const initialStepsStarted = new Promise((resolve) => { releaseInitialSteps = resolve; });
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
    contentDiagnosisResultMessage: () => '',
    async runBusinessDefenseSycm() {
      events.push('sycm:start');
      await initialStepsStarted;
      events.push('sycm:end');
      return { snapshot: { storeVisitors: 1 } };
    },
    async runBusinessDefenseGuanghe() {
      events.push('guanghe:start');
      await initialStepsStarted;
      events.push('guanghe:end');
      return { source: 'guanghe', snapshot: { schema: 9, rows: [] } };
    },
    async runBusinessDefenseDmp() {
      events.push('dmp:start');
      await initialStepsStarted;
      events.push('dmp:end');
      return { source: 'dmp', snapshot: { schema: 2, results: [] } };
    },
    async prepareContentDiagnosisWxtTab(section) {
      events.push('wxt:' + section + ':prepare');
      return 1;
    },
    async runContentDiagnosisWxtSection(tabId, runId, section) {
      events.push('wxt:' + section + ':start');
      if (section === 'marketing') await initialStepsStarted;
      else await delay(2);
      events.push('wxt:' + section + ':end');
      return { ok: true };
    },
    async waitMilliseconds(milliseconds) {
      await delay(Math.max(1, Math.round(milliseconds / 200)));
    },
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
  });
  const source = extractFunction(
    'async function runContentDiagnosisReport(options)',
    '\nfunction batchText'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runContentDiagnosisReport;', context);
  const running = context.testRun();
  await waitFor(() => (
    events.includes('sycm:start') &&
    events.includes('guanghe:start') &&
    events.includes('dmp:start') &&
    events.includes('wxt:marketing:start')
  ), 500);
  assert.ok(events.includes('sycm:start'));
  assert.ok(events.includes('guanghe:start'));
  assert.ok(events.includes('dmp:start'));
  assert.ok(events.includes('wxt:marketing:start'));
  assert.equal(events.some((event) => event.endsWith(':end')), false);
  releaseInitialSteps();
  assert.equal(events.some((event) => event.endsWith(':end')), false);
  await running;
  assert.ok(events.indexOf('wxt:marketing:end') < events.indexOf('wxt:shortVideo:start'));
  const finalStatus = storageWrites.at(-1)['report-status'];
  assert.equal(finalStatus.running, false);
  assert.deepEqual(Array.from(finalStatus.activeSteps), []);
  assert.equal(finalStatus.results.length, 5);
}

async function verifyTransientRetry() {
  let sycmCalls = 0;
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async set() {},
        },
      },
    },
    BUSINESS_DEFENSE_AUTO_STATUS_KEY: 'auto-status',
    async runBusinessDefenseGuanghe() { return { source: 'guanghe' }; },
    async runBusinessDefenseSycm() {
      sycmCalls += 1;
      if (sycmCalls === 1) throw new Error('页面加载超时。');
      return { source: 'sycm' };
    },
    async runBusinessDefenseWxt() { return { source: 'wxt' }; },
    async runBusinessDefenseDmp() { return { source: 'dmp' }; },
    async waitMilliseconds() {},
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
  });
  const source = extractFunction(
    'async function runBusinessDefenseAutoCollect(options)',
    '\nfunction contentDiagnosisResultMessage'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runBusinessDefenseAutoCollect;', context);
  const result = await context.testRun();
  assert.equal(sycmCalls, 2);
  const sycm = Array.from(result.results).find((item) => item.name === '生意参谋流量指标');
  assert.equal(sycm.ok, true);
}

async function verifyPlatformSelectionAndFiveAttempts() {
  let sycmCalls = 0;
  let unexpectedCalls = 0;
  const context = vm.createContext({
    chrome: { storage: { local: { async set() {} } } },
    BUSINESS_DEFENSE_AUTO_STATUS_KEY: 'auto-status',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    async runBusinessDefenseSycm() {
      sycmCalls += 1;
      throw new Error('接口异常。');
    },
    async runBusinessDefenseGuanghe() { unexpectedCalls += 1; },
    async runBusinessDefenseWxt() { unexpectedCalls += 1; },
    async runBusinessDefenseDmp() { unexpectedCalls += 1; },
    async waitMilliseconds() {},
  });
  const source = extractFunction(
    'async function runBusinessDefenseAutoCollect(options)',
    '\nfunction contentDiagnosisResultMessage'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runBusinessDefenseAutoCollect;', context);
  const result = await context.testRun({ platforms: ['sycm'] });
  assert.equal(sycmCalls, 5);
  assert.equal(unexpectedCalls, 0);
  assert.equal(Array.from(result.results).filter((item) => item.skipped).length, 3);
  assert.match(Array.from(result.results).find((item) => item.name === '生意参谋流量指标').message, /尝试 5 次/);
}

async function verifyNonRetryableStopsOnce() {
  let wxtCalls = 0;
  const context = vm.createContext({
    chrome: { storage: { local: { async set() {} } } },
    BUSINESS_DEFENSE_AUTO_STATUS_KEY: 'auto-status',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    async runBusinessDefenseSycm() {},
    async runBusinessDefenseGuanghe() {},
    async runBusinessDefenseDmp() {},
    async runBusinessDefenseWxt() {
      wxtCalls += 1;
      const error = new Error('万相台登录确认未完成。');
      error.code = 'WXT_LOGIN_GATE_TIMEOUT';
      error.retryable = false;
      throw error;
    },
    async waitMilliseconds() {},
  });
  const source = extractFunction(
    'async function runBusinessDefenseAutoCollect(options)',
    '\nfunction contentDiagnosisResultMessage'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runBusinessDefenseAutoCollect;', context);
  const result = await context.testRun({ platforms: ['wxt'] });
  assert.equal(wxtCalls, 1);
  const wxt = Array.from(result.results).find((item) => item.name === '万相台内容投放');
  assert.equal(wxt.ok, false);
  assert.match(wxt.message, /登录确认未完成/);
}

async function verifyReportGateFailureSkipsSecondWait() {
  let prepareCalls = 0;
  let sectionCalls = 0;
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async remove() {},
          async set() {},
        },
      },
    },
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    contentDiagnosisResultMessage: () => '',
    async runBusinessDefenseSycm() {},
    async runBusinessDefenseGuanghe() {},
    async runBusinessDefenseDmp() {},
    async prepareContentDiagnosisWxtTab() {
      prepareCalls += 1;
      const error = new Error('万相台登录确认未完成。');
      error.code = 'WXT_LOGIN_GATE_TIMEOUT';
      error.retryable = false;
      throw error;
    },
    async runContentDiagnosisWxtSection() { sectionCalls += 1; },
    async waitMilliseconds() {},
  });
  const source = extractFunction(
    'async function runContentDiagnosisReport(options)',
    '\nfunction batchText'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runContentDiagnosisReport;', context);
  const result = await context.testRun({ platforms: ['wxt'] });
  assert.equal(prepareCalls, 1);
  assert.equal(sectionCalls, 0);
  const marketing = Array.from(result.results).find((item) => item.key === 'wxtMarketing');
  const shortVideo = Array.from(result.results).find((item) => item.key === 'wxtShortVideo');
  assert.equal(marketing.ok, false);
  assert.equal(shortVideo.ok, false);
  assert.equal(shortVideo.code, 'WXT_LOGIN_GATE_TIMEOUT');
  assert.match(shortVideo.message, /已跳过重复等待/);
}

async function verifyGateCodeSurvivesEarlierTransientRetry() {
  let prepareCalls = 0;
  const context = vm.createContext({
    chrome: { storage: { local: { async remove() {}, async set() {} } } },
    CONTENT_DIAGNOSIS_STATUS_KEY: 'report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'report-wxt',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    PLATFORM_RETRY_ATTEMPTS: 5,
    contentDiagnosisResultMessage: () => '',
    async runBusinessDefenseSycm() {},
    async runBusinessDefenseGuanghe() {},
    async runBusinessDefenseDmp() {},
    async prepareContentDiagnosisWxtTab() {
      prepareCalls += 1;
      if (prepareCalls === 1) throw new Error('页面瞬时加载失败。');
      const error = new Error('万相台登录确认未完成。');
      error.code = 'WXT_LOGIN_GATE_TIMEOUT';
      error.retryable = false;
      throw error;
    },
    async runContentDiagnosisWxtSection() {
      throw new Error('登录门槛失败后不应执行报表抓取。');
    },
    async waitMilliseconds() {},
  });
  const source = extractFunction(
    'async function runContentDiagnosisReport(options)',
    '\nfunction batchText'
  );
  vm.runInContext(platformHelpers + '\n' + source + '\nglobalThis.testRun = runContentDiagnosisReport;', context);
  const result = await context.testRun({ platforms: ['wxt'] });
  assert.equal(prepareCalls, 2);
  const marketing = Array.from(result.results).find((item) => item.key === 'wxtMarketing');
  const shortVideo = Array.from(result.results).find((item) => item.key === 'wxtShortVideo');
  assert.equal(marketing.code, 'WXT_LOGIN_GATE_TIMEOUT');
  assert.equal(shortVideo.code, 'WXT_LOGIN_GATE_TIMEOUT');
  assert.match(shortVideo.message, /已跳过重复等待/);
}

Promise.all([
  verifyAutoCollectParallelism(),
  verifyReportParallelism(),
  verifyTransientRetry(),
  verifyPlatformSelectionAndFiveAttempts(),
  verifyNonRetryableStopsOnce(),
  verifyReportGateFailureSkipsSecondWait(),
  verifyGateCodeSurvivesEarlierTransientRetry(),
]).then(() => {
  console.log('parallel orchestration guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
