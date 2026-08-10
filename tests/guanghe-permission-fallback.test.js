const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const pageHook = fs.readFileSync(path.join(__dirname, '..', 'page-hook.js'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');

const fallbackStart = background.indexOf('async function runBusinessDefenseGuanghe(');
const fallbackEnd = background.indexOf('async function runBusinessDefenseSycm()', fallbackStart);
const fallbackFlow = background.slice(fallbackStart, fallbackEnd);

assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart);
assert.ok(manifest.host_permissions.includes('https://xstore.insights.1688.com/*'));
assert.ok(!manifest.host_permissions.some((pattern) => pattern.includes('*.1688.com')));
const pageHookEntry = manifest.content_scripts.find((entry) => entry.js.includes('page-hook.js'));
const contentEntry = manifest.content_scripts.find((entry) => entry.js.includes('content-script.js'));
for (const entry of [pageHookEntry, contentEntry]) {
  assert.ok(entry);
  assert.equal(entry.all_frames, true);
  assert.ok(entry.matches.includes('https://xstore.insights.1688.com/*'));
  assert.ok(entry.matches.includes('*://web.taobao.com/s-guanghe-creator/asset-overview*'));
}
assert.match(background, /async function clickGuangheMenuItem/);
assert.match(background, /async function waitForGuangheAssetOverview/);
assert.match(background, /async function waitForGuangheCollectorReady/);
assert.match(background, /const useFrameCollector = isSycmMirror \|\| hasGuangheDataFrame/);
assert.match(background, /s-guanghe-creator\/asset-overview/);
assert.match(background, /GUANGHE_FRAME_PERMISSION_MISSING/);
assert.match(background, /frameIds: \[frame\.frameId\]/);
assert.match(background, /settingsRecovery && role === 'settings'/);
assert.match(background, /preferredFrameId: readyFrame\.frameId/);
assert.match(background, /typeof window\.__ghFetchChannelDiagnosis === 'function'/);
assert.match(fallbackFlow, /clickGuangheMenuItem\(tabId, '内容数据', 15000\)/);
assert.match(fallbackFlow, /clickGuangheMenuItem\(tabId, '资产总览', 15000\)/);
assert.match(fallbackFlow, /waitForGuangheAssetOverview\(tabId, 30000\)/);
assert.match(fallbackFlow, /runGuangheCollectorOnTab\([\s\S]*?'淘宝光合（设置→内容数据→资产总览）'[\s\S]*?options[\s\S]*?\)/);
assert.doesNotMatch(fallbackFlow, /chrome\.tabs\.update\([^;]*BUSINESS_DEFENSE_GH_URL/);
assert.doesNotMatch(background, /BUSINESS_DEFENSE_GH_DATA_URL/);
assert.doesNotMatch(background, /runBusinessDefenseGuangheFromDataPage/);
assert.doesNotMatch(background, /BUSINESS_DEFENSE_SYCM_CONTENT_URL/);
assert.match(pageHook, /isSycmContentMirror/);
assert.match(pageHook, /isGuangheDataPage/);
assert.match(pageHook, /isGuangheSettingsApp/);
assert.match(pageHook, /if \(event\.source !== window\) return;/);
assert.match(content, /IS_SYCM_CONTENT_MIRROR/);
assert.match(content, /IS_GUANGHE_DATA_PAGE/);
assert.match(content, /IS_GUANGHE_SETTINGS_APP/);
assert.match(content, /if \(event\.source !== window\) return;/);

const retryStart = background.indexOf('function shouldRetryPlatformError(');
const retryEnd = background.indexOf('async function runPlatformStepWithRetry(', retryStart);
const retrySandbox = {};
vm.runInNewContext(
  background.slice(retryStart, retryEnd) + '\nthis.shouldRetryPlatformError = shouldRetryPlatformError;',
  retrySandbox
);
assert.equal(retrySandbox.shouldRetryPlatformError(
  new Error('Cannot access contents of url. Extension manifest must request permission to access this host.')
), false);

const roleStart = background.indexOf('function guangheFrameRole(');
const roleEnd = background.indexOf('function sortGuangheFrames(', roleStart);
const roleSandbox = { URL };
vm.runInNewContext(`
  const GUANGHE_SETTINGS_HOST = 'xstore.insights.1688.com';
  const GUANGHE_DATA_PATH = '/s-guanghe-creator/asset-overview';
  const SYCM_CONTENT_ANALYSIS_PATH = '/xsite/contentanalysis/overview_new_v2';
  ${background.slice(roleStart, roleEnd)}
  this.guangheFrameRole = guangheFrameRole;
`, roleSandbox);
assert.equal(roleSandbox.guangheFrameRole(
  'https://xstore.insights.1688.com/index.html?at_iframe=1'
), 'settings');
assert.equal(roleSandbox.guangheFrameRole(
  'https://web.taobao.com/s-guanghe-creator/asset-overview'
), 'asset');
assert.equal(roleSandbox.guangheFrameRole('https://example.com/asset-overview'), '');

async function verifyCollectorTargetsReadyFrame() {
  const collectorStart = background.indexOf('async function runGuangheCollectorOnTab(');
  const collectorEnd = background.indexOf('async function runBusinessDefenseGuanghe(', collectorStart);
  const roleAndSortEnd = background.indexOf('function isGuangheFramePermissionError(', roleStart);
  assert.ok(collectorStart >= 0 && collectorEnd > collectorStart);
  const runtime = {
    frames: [],
    successFrameId: 0,
    injections: [],
    messages: [],
    readyChecks: [],
  };
  const snapshot = {
    seedingGmvShare: 0.25,
    rows: [{
      channel: '全部',
      assetCode: 'self',
      publishedContents: 12,
      publicContents: 10,
    }],
  };
  const sandbox = {
    URL,
    runtime,
    GUANGHE_SETTINGS_HOST: 'xstore.insights.1688.com',
    GUANGHE_DATA_PATH: '/s-guanghe-creator/asset-overview',
    SYCM_CONTENT_ANALYSIS_PATH: '/xsite/contentanalysis/overview_new_v2',
    async waitTabComplete() {},
    async injectScripts(tabId, scripts) {
      runtime.injections.push({ tabId, scripts });
    },
    async waitForGuangheCollectorReady(tabId, frameId) {
      runtime.readyChecks.push(frameId);
      return true;
    },
    async sendSycmFrameMessage(tabId, frameId) {
      runtime.messages.push(frameId);
      return frameId === runtime.successFrameId ? { ok: true, snapshot } : null;
    },
    async sendTabMessageWithRetry() {
      throw new Error('frame collector should be used');
    },
    isGuangheFramePermissionError() { return false; },
    guangheFramePermissionError(error) { return error; },
    chrome: {
      tabs: {
        async get() {
          return { url: 'https://creator.guanghe.taobao.com/page/unify/asset-overview' };
        },
      },
      webNavigation: {
        async getAllFrames() { return runtime.frames; },
      },
      storage: {
        local: {
          async get() { return { gh_channel_snapshot: snapshot }; },
          async set() {},
        },
      },
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(`
    ${background.slice(roleStart, roleAndSortEnd)}
    ${background.slice(collectorStart, collectorEnd)}
    this.runCollector = runGuangheCollectorOnTab;
  `, context);

  runtime.frames = [
    { frameId: 0, url: 'https://creator.guanghe.taobao.com/page/unify/asset-overview' },
    { frameId: 3, url: 'https://xstore.insights.1688.com/index.html?shell=1' },
    { frameId: 7, url: 'https://xstore.insights.1688.com/index.html?asset=1' },
    { frameId: 11, url: 'https://example.com/asset-overview' },
  ];
  runtime.successFrameId = 7;
  const xstoreResult = await context.runCollector(
    42,
    '淘宝光合（设置→内容数据→资产总览）',
    { metricsOnly: true, preferredFrameId: 7 }
  );
  assert.equal(xstoreResult.ok, true);
  assert.deepEqual(runtime.messages, [7]);
  assert.deepEqual(runtime.readyChecks, [7]);
  assert.ok(runtime.injections.every((call) => (
    call.scripts.every((script) => Array.from(script.frameIds || []).join(',') === '7')
  )));

  runtime.injections = [];
  runtime.messages = [];
  runtime.readyChecks = [];
  runtime.frames = [
    { frameId: 0, url: 'https://creator.guanghe.taobao.com/page/unify/asset-overview' },
    { frameId: 4, url: 'https://xstore.insights.1688.com/index.html?shell=1' },
    { frameId: 9, url: 'https://web.taobao.com/s-guanghe-creator/asset-overview' },
  ];
  runtime.successFrameId = 9;
  const legacyResult = await context.runCollector(
    42,
    '淘宝光合（设置→内容数据→资产总览）',
    { metricsOnly: true, preferredFrameId: 9 }
  );
  assert.equal(legacyResult.ok, true);
  assert.deepEqual(runtime.messages, [9]);
  assert.deepEqual(runtime.readyChecks, [9]);
}

async function verifyCollectorWaitsForMainHook() {
  const readyStart = background.indexOf('async function waitForGuangheCollectorReady(');
  const readyEnd = background.indexOf('async function runGuangheCollectorOnTab(', readyStart);
  let now = 0;
  let checks = 0;
  const context = vm.createContext({
    Date: { now: () => now },
    async waitMilliseconds(duration) { now += duration; },
    isGuangheFramePermissionError() { return false; },
    guangheFramePermissionError(error) { return error; },
    chrome: {
      scripting: {
        async executeScript(details) {
          checks += 1;
          assert.deepEqual(Array.from(details.target.frameIds), [7]);
          assert.equal(details.world, 'MAIN');
          return [{ result: checks >= 3 }];
        },
      },
    },
  });
  vm.runInContext(
    background.slice(readyStart, readyEnd) + '\nthis.waitReady = waitForGuangheCollectorReady;',
    context
  );
  assert.equal(await context.waitReady(42, 7, 5000), true);
  assert.equal(checks, 3);
  assert.equal(now, 800);
}

Promise.all([
  verifyCollectorTargetsReadyFrame(),
  verifyCollectorWaitsForMainHook(),
]).then(() => {
  console.log('guanghe permission fallback guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
