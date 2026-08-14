const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const XHS_ANALYSIS_KEY = 'xhsAnalysisSnapshotV1';
const XHS_STATUS_KEY = 'xhsCollectionStatusV1';
const XHS_SNAPSHOT_KEYS = Object.freeze([XHS_ANALYSIS_KEY, XHS_STATUS_KEY]);
const EXPECTED_XHS_METRIC_KEYS = Object.freeze([
  'xhs_totalSpend',
  'xhs_kolSpend',
  'xhs_juguangSpend',
  'xhs_kfsRatio',
  'xhs_noteCount',
  'xhs_reportedNoteShare',
  'xhs_unreportedNoteShare',
  'xhs_productSeedingSpend',
  'xhs_seedingDirectSpend',
  'xhs_xingheVisitors',
  'xhs_dmpVisitors',
  'xhs_visitFrequency',
  'xhs_visitCost',
  'xhs_storeGmv',
  'xhs_storeRoi',
  'xhs_taskGmv',
  'xhs_taskRoi',
  'xhs_contentAudienceAsset',
  'xhs_storeAudienceAsset',
  'xhs_contentAudienceShare',
  'xhs_l12Penetration',
  'xhs_l45Penetration',
  'xhs_l45OverL12',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContains(source, pattern, message) {
  assert.ok(pattern.test(source), message || `missing ${pattern}`);
}

function constantBlock(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `missing ${declaration}`);
  const end = nextDeclaration ? source.indexOf(nextDeclaration, start + declaration.length) : -1;
  assert.ok(end > start, `missing end marker ${nextDeclaration} for ${declaration}`);
  return source.slice(start, end);
}

function createBridgeHarness(initialStorage = {}) {
  const source = read('web-tool-bridge.js');
  const storage = structuredClone(initialStorage);
  const listeners = [];
  const posted = [];
  const reads = [];
  const removals = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      posted.push(message);
    },
  };
  windowObject.top = windowObject;
  const location = { origin: 'http://127.0.0.1:3400', pathname: '/data.html' };
  const chrome = {
    runtime: {
      lastError: null,
      getManifest() { return { version: '99.0.0-fictional' }; },
      sendMessage(_message, callback) { callback({ ok: true }); },
    },
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          reads.push(Array.from(list));
          return Object.fromEntries(list.filter((key) => (
            Object.prototype.hasOwnProperty.call(storage, key)
          )).map((key) => [key, storage[key]]));
        },
        async set(patch) {
          Object.assign(storage, structuredClone(patch));
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          removals.push(Array.from(list));
          for (const key of list) delete storage[key];
        },
      },
      onChanged: { addListener() {} },
    },
  };
  vm.runInNewContext(source, {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    chrome,
    console,
    location,
    window: windowObject,
  }, { filename: 'web-tool-bridge.js' });

  let sequence = 0;
  async function request(action, payload) {
    const requestId = `fictional-xhs-bridge-${++sequence}`;
    const listener = listeners[0];
    assert.equal(typeof listener, 'function', 'bridge message listener');
    listener({
      source: windowObject,
      origin: location.origin,
      data: {
        channel: 'taobao-full-chain-tool-v1',
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      },
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      const response = posted.find((message) => message.requestId === requestId);
      if (response) return response;
    }
    assert.fail(`bridge response timeout: ${action}`);
  }

  return { request, storage, reads, removals };
}

function createReportHarness() {
  const source = read('web-tool/report.js');
  const sideEffectsStart = source.indexOf('  window.TaobaoReportExport = Object.freeze({');
  assert.ok(sideEffectsStart > 0, 'report side-effect marker');
  const instrumented = source.slice(0, sideEffectsStart) + `
  window.__xhsReportTest = Object.freeze({
    setState(value) {
      const state = value && typeof value === 'object' ? value : {};
      xhsStatus = state.status && typeof state.status === 'object' ? state.status : {};
      xhsAnalysis = state.analysis && typeof state.analysis === 'object' ? state.analysis : null;
      reportStatus = state.reportStatus && typeof state.reportStatus === 'object' ? state.reportStatus : {};
    },
    buildXhsMarkup,
    renderXhs,
  });
})();`;
  const elements = new Map([
    ['xhsReport', { innerHTML: '' }],
    ['xhsContext', { textContent: '' }],
  ]);
  const windowObject = {
    addEventListener() {},
    clearTimeout,
    postMessage() {},
    setTimeout,
  };
  windowObject.self = windowObject;
  windowObject.top = windowObject;
  const document = {
    documentElement: { classList: { add() {} } },
    getElementById(id) { return elements.get(id) || null; },
  };
  vm.runInNewContext(instrumented, {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    location: { origin: 'http://127.0.0.1:3400', search: '?builder=1' },
    setTimeout,
    window: windowObject,
  }, { filename: 'web-tool/report.js' });
  return { api: windowObject.__xhsReportTest, elements };
}

function fictionalAnalysisSnapshot() {
  return {
    schema: XHS_ANALYSIS_KEY,
    schemaVersion: 1,
    runId: 'fictional-xhs-analysis-run-001',
    generatedAt: '2030-02-01T00:00:00.000Z',
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    quality: { decisionReady: true, issues: [] },
    management: { costs: { partnership: 120, juguang: 80, total: 200 } },
    notes: [{ noteId: 'fictional-note-001', costs: { total: 200 } }],
  };
}

function fictionalCollectionStatus() {
  return {
    schemaVersion: 1,
    runId: 'fictional-xhs-analysis-run-001',
    status: 'complete',
    updatedAt: '2030-02-01T00:00:00.000Z',
    platforms: {
      adstar: { status: 'complete', collectedAt: '2030-02-01T00:00:00.000Z' },
      pgy: { status: 'complete', collectedAt: '2030-02-01T00:01:00.000Z' },
      juguang: { status: 'verified_no_spend', collectedAt: '2030-02-01T00:02:00.000Z' },
    },
  };
}

test('web bridge reads both compact XHS snapshots and rejects no requested XHS key', async () => {
  const fixtures = {
    [XHS_ANALYSIS_KEY]: fictionalAnalysisSnapshot(),
    [XHS_STATUS_KEY]: fictionalCollectionStatus(),
  };
  const harness = createBridgeHarness(fixtures);
  const response = await harness.request('getStorage', {
    keys: [...XHS_SNAPSHOT_KEYS, 'fictionalPrivateStorageKey'],
  });

  assert.equal(response.ok, true, response.message);
  assert.deepEqual(Array.from(harness.reads.at(-1)).sort(), [...XHS_SNAPSHOT_KEYS].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), fixtures);
});

test('web bridge clears both XHS snapshots without widening the clear allowlist', async () => {
  const harness = createBridgeHarness({
    [XHS_ANALYSIS_KEY]: fictionalAnalysisSnapshot(),
    [XHS_STATUS_KEY]: fictionalCollectionStatus(),
    fictionalPrivateStorageKey: { shouldRemain: true },
  });
  const response = await harness.request('clearStorage', {
    keys: [...XHS_SNAPSHOT_KEYS, 'fictionalPrivateStorageKey'],
  });

  assert.equal(response.ok, true, response.message);
  assert.deepEqual(Array.from(response.data.cleared).sort(), [...XHS_SNAPSHOT_KEYS].sort());
  assert.deepEqual(Array.from(harness.removals.at(-1)).sort(), [...XHS_SNAPSHOT_KEYS].sort());
  assert.equal(harness.storage[XHS_ANALYSIS_KEY], undefined);
  assert.equal(harness.storage[XHS_STATUS_KEY], undefined);
  assert.deepEqual(harness.storage.fictionalPrivateStorageKey, { shouldRemain: true });
});

test('store-run import and account-run archiving retain both XHS snapshots', async () => {
  const harness = createBridgeHarness();
  const runId = 'store-run-fictional-xhs-001';
  const startedAt = Date.parse('2030-02-01T00:00:00.000Z');
  const run = {
    schema: 2,
    runId,
    batchId: 'fictional-batch-001',
    taskType: 'report',
    runMode: 'current',
    account: {
      id: 'fictional-account-001',
      name: '虚构品牌账号',
      platform: 'taobao',
      storeId: 'fictional-store-001',
      storeName: '虚构测试店铺',
      usernameMasked: 'fi***al',
    },
    startedAt,
    finishedAt: startedAt + 60_000,
    updatedAt: startedAt + 60_000,
    xinghe: { state: 'ready', noPermission: false },
    status: 'success',
    failures: [],
    snapshots: {
      [XHS_ANALYSIS_KEY]: fictionalAnalysisSnapshot(),
      [XHS_STATUS_KEY]: fictionalCollectionStatus(),
      fictionalUnexpectedSnapshot: { note: 'fictional-safe-value-that-must-be-dropped' },
    },
  };
  const response = await harness.request('importStoreRun', { runId, run });

  assert.equal(response.ok, true, response.message);
  const archived = harness.storage[`taobaoStoreRunV1:${runId}`];
  assert.deepEqual(
    Object.keys(archived.snapshots).sort(),
    [...XHS_SNAPSHOT_KEYS].sort(),
  );
  assert.deepEqual(archived.snapshots[XHS_ANALYSIS_KEY], run.snapshots[XHS_ANALYSIS_KEY]);
  assert.deepEqual(archived.snapshots[XHS_STATUS_KEY], run.snapshots[XHS_STATUS_KEY]);

  const background = read('background.js');
  const archiveKeys = constantBlock(
    background,
    'const ACCOUNT_RUN_SNAPSHOT_KEYS = [',
    '\n\nasync function clearAccountRunSnapshots',
  );
  for (const key of XHS_SNAPSHOT_KEYS) {
    assertContains(archiveKeys, new RegExp(`['"]${key}['"]`), `${key} account archive key`);
  }
});

test('report viewer adds one top-level XHS chapter backed by analysis and collection snapshots', () => {
  const html = read('web-tool/report-view.html');
  const page = read('web-tool/report.js');

  assertContains(html, /data-section="xiaohongshu"/, 'missing top-level XHS report tab');
  assertContains(html, /data-report-section="xiaohongshu"/, 'missing top-level XHS report section');
  assertContains(html, /<h2>[^<]*小红书[^<]*<\/h2>/, 'missing XHS report heading');
  for (const key of XHS_SNAPSHOT_KEYS) assertContains(page, new RegExp(key), `report storage key ${key}`);
  assertContains(page, /section\s*===\s*['"]xiaohongshu['"]/, 'sectionHasData must support XHS');
  assertContains(page, /key:\s*['"]xiaohongshu['"]/, 'report/export section list must include XHS');
  assertContains(
    page,
    /clear\.disabled\s*=\s*!bridgeConnected\s*\|\|\s*\([^;]*!xhsAnalysis[^;]*Object\.keys\(xhsStatus/s,
    'an XHS-only report must keep the clear button enabled',
  );
});

test('XHS report chapter shows three source states, quality gate and source timestamps', () => {
  const combined = read('web-tool/report-view.html') + '\n' + read('web-tool/report.js');
  for (const [platform, label] of [
    ['adstar', '淘宝星河'],
    ['pgy', '蒲公英'],
    ['juguang', '聚光'],
  ]) {
    const forward = new RegExp(`${platform}[\\s\\S]{0,400}${label}`);
    const backward = new RegExp(`${label}[\\s\\S]{0,400}${platform}`);
    assert.ok(forward.test(combined) || backward.test(combined), `${label} must map to ${platform}`);
  }
  assertContains(combined, /decisionReady/, 'XHS report must expose the decision readiness gate');
  assertContains(combined, /数据质量/, 'XHS report must label data quality');
  assertContains(combined, /来源时间|采集时间|数据时间/, 'XHS report must label source time');
  assertContains(combined, /generatedAt|collectedAt|updatedAt/, 'XHS report must render a source timestamp');
  assertContains(combined, /星河项目[^\n]*订单|项目 \/ 订单/, 'XHS report must show Star project/order layers');
  assertContains(combined, /聚光营销诉求/, 'XHS report must show Juguang objective breakdown');
});

test('XHS report renders an explicit failure instead of a report body for terminal status without analysis', () => {
  for (const [status, expected] of [
    ['failed', /失败/],
    ['partial', /部分|不完整|证据不足/],
  ]) {
    const harness = createReportHarness();
    harness.api.setState({
      status: {
        status,
        platforms: {
          adstar: { status },
          pgy: { status: 'failed' },
          juguang: { status: 'failed' },
        },
      },
      analysis: null,
    });

    harness.api.renderXhs();
    const markup = harness.elements.get('xhsReport').innerHTML;
    assert.match(markup, /class="section-error"/, `${status} must render the error state`);
    assert.match(markup, expected, `${status} must explain the terminal state`);
    assert.doesNotMatch(markup, /三平台账号、日期、分页和对账均已通过/);
  }
});

test('XHS report never claims all quality checks passed when decisionReady is false and issues are empty', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: fictionalCollectionStatus(),
    analysis: {
      ...fictionalAnalysisSnapshot(),
      quality: { decisionReady: false, issues: [] },
    },
  });

  const markup = harness.api.buildXhsMarkup();
  assert.match(markup, /质量证据不足|未达到经营决策门槛|需补数/);
  assert.doesNotMatch(markup, /三平台账号、日期、分页和对账均已通过/);
});

test('diagnosis page consumes the XHS mapper for all 23 existing metrics, then retains manual override', () => {
  const dataHtml = read('web-tool/data.html');
  const popupHtml = read('diagnosis-popup.html');
  const dashboard = read('diagnosis-popup.js');
  const specSource = read('diagnosis-spec.js');
  const context = vm.createContext({ window: {} });
  vm.runInContext(specSource, context, { filename: 'diagnosis-spec.js' });
  const xhsMetrics = Array.from(context.window.BusinessDefenseDiagnosisSpec.metrics)
    .filter((metric) => metric.platform === '小红书');

  assert.deepEqual(xhsMetrics.map((metric) => metric.key), EXPECTED_XHS_METRIC_KEYS);
  assertContains(dataHtml, /<script src="\/xhs-metrics\.js"><\/script>/, 'web diagnosis must load XHS mapper');
  assertContains(popupHtml, /<script src="xhs\/metrics\.js"><\/script>/, 'extension popup must load XHS mapper');
  assert.ok(
    dataHtml.indexOf('/xhs-metrics.js') < dataHtml.indexOf('/diagnosis-popup.js'),
    'web mapper must load before diagnosis-popup.js',
  );
  assert.ok(
    popupHtml.indexOf('xhs/metrics.js') < popupHtml.indexOf('diagnosis-popup.js'),
    'extension mapper must load before diagnosis-popup.js',
  );
  for (const key of XHS_SNAPSHOT_KEYS) assertContains(dashboard, new RegExp(key), `diagnosis storage key ${key}`);
  assertContains(dashboard, /XhsMetrics\.mapAnalysisSnapshot\s*\(/, 'diagnosis must invoke XHS metric mapper');
  assertContains(dashboard, /analysisSnapshot\s*:/, 'diagnosis must pass the analysis snapshot');
  assertContains(dashboard, /manualInputs\s*:/, 'diagnosis must pass manual override values');

  const loadRows = constantBlock(
    dashboard,
    'async function loadRows()',
    '\n  function renderPlatformProgress',
  );
  const automaticIndex = loadRows.indexOf('mapAnalysisSnapshot');
  const manualIndex = loadRows.indexOf('collectManual', automaticIndex + 1);
  assert.ok(automaticIndex >= 0, 'loadRows must map the automatic XHS snapshot');
  assert.ok(manualIndex > automaticIndex, 'manual values must remain the final explicit override');
});

test('both interactive report export and workbook export include XHS analysis data', () => {
  const report = read('web-tool/report.js');
  const dashboard = read('diagnosis-popup.js');
  const exportStart = report.indexOf('function buildExportReportDocument');
  const exportEnd = report.indexOf('\n  function buildExportFromArchive', exportStart);
  assert.ok(exportStart >= 0 && exportEnd > exportStart, 'report export builder');
  const reportExport = report.slice(exportStart, exportEnd);

  assertContains(reportExport, /key:\s*['"]xiaohongshu['"]/, 'interactive export must include XHS section');
  assertContains(reportExport, /小红书/, 'interactive export must label the XHS section');
  assertContains(dashboard, /小红书经营数据/, 'workbook must include an XHS operating-data sheet');
  for (const sheetName of [
    '小红书管理汇总', '小红书笔记联表', '小红书项目订单',
    '小红书聚光日报', '小红书星河明细', '小红书质量说明',
  ]) {
    assertContains(dashboard, new RegExp(sheetName), `workbook must include ${sheetName}`);
  }
  assert.doesNotMatch(dashboard, /appendSheet\('小红书',\s*'小红书手填数据'\)/);
});

test('local and cloud resource manifests carry the same XHS viewer and mapper assets', () => {
  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');
  for (const extensionAsset of ['xhs/analysis.js', 'xhs/metrics.js']) {
    assertContains(sync, new RegExp(`['"]${extensionAsset.replace('/', '\\/')}['"]`), extensionAsset);
  }
  assertContains(sync, /['"]xhs-metrics\.js['"]/, 'cloud versioned assets must include XHS mapper');
  assertContains(
    sync,
    /copyFile\([\s\S]{0,200}xhs\/metrics\.js[\s\S]{0,200}xhs-metrics\.js/,
    'cloud sync must copy the extension mapper to the public asset name',
  );

  for (const [localPath, cloudPath] of [
    ['web-tool/report.js', 'cloud-tool/public/report.js'],
    ['diagnosis-popup.js', 'cloud-tool/public/diagnosis-popup.js'],
    ['diagnosis-spec.js', 'cloud-tool/public/diagnosis-spec.js'],
  ]) {
    assert.equal(read(cloudPath), read(localPath), `${cloudPath} must mirror ${localPath}`);
  }

  const mapperLocal = path.join(root, 'xhs', 'metrics.js');
  const mapperCloud = path.join(root, 'cloud-tool', 'public', 'xhs-metrics.js');
  assert.ok(fs.existsSync(mapperLocal), 'missing local xhs/metrics.js');
  assert.ok(fs.existsSync(mapperCloud), 'missing cloud public xhs-metrics.js');
  assert.equal(fs.readFileSync(mapperCloud, 'utf8'), fs.readFileSync(mapperLocal, 'utf8'));
});
