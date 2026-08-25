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

function createReportHarness(options) {
  const config = options && typeof options === 'object' ? options : {};
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
      reportData = state.reportData && typeof state.reportData === 'object' ? state.reportData : null;
    },
    buildXhsMarkup,
    sectionHasData,
    sectionError,
    applyArchiveRun,
    renderXhsPlatform,
    renderXhs,
    buildExportReportDocument,
  });
})();`;
  const elements = new Map([
    ['xhsReport', { innerHTML: '' }],
    ['xhsContext', { textContent: '' }],
    ['adstarReport', { innerHTML: '' }],
    ['pgyReport', { innerHTML: '' }],
    ['juguangReport', { innerHTML: '' }],
    ['adstarContext', { textContent: '' }],
    ['pgyContext', { textContent: '' }],
    ['juguangContext', { textContent: '' }],
  ]);
  if (config.platformMountsOnly) {
    elements.delete('xhsReport');
    elements.delete('xhsContext');
  }
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
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
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
    running: false,
    status: 'complete',
    requestedPlatforms: ['adstar', 'pgy', 'juguang'],
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

test('report viewer exposes one top-level report per XHS platform from the shared snapshots', () => {
  const html = read('web-tool/report-view.html');
  const page = read('web-tool/report.js');

  for (const [platform, name] of [
    ['adstar', '淘宝星河'],
    ['pgy', '蒲公英'],
    ['juguang', '聚光'],
  ]) {
    assertContains(html, new RegExp(`data-section=["']${platform}["']`), `missing ${name} report tab`);
    assertContains(
      html,
      new RegExp(`data-report-section=["']${platform}["']`),
      `missing ${name} report section`,
    );
    assertContains(page, new RegExp(`key:\\s*["']${platform}["']`), `${name} export section`);
  }
  assert.doesNotMatch(html, /data-section="xiaohongshu"/);
  for (const key of XHS_SNAPSHOT_KEYS) assertContains(page, new RegExp(key), `report storage key ${key}`);
  assertContains(
    page,
    /clear\.disabled\s*=\s*!bridgeConnected\s*\|\|\s*\([^;]*!xhsAnalysis[^;]*Object\.keys\(xhsStatus/s,
    'an XHS-only report must keep the clear button enabled',
  );
});

test('each XHS platform report renders only its platform body from the joined analysis', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: fictionalCollectionStatus(),
    analysis: fictionalAnalysisSnapshot(),
  });

  const expectedPanels = {
    adstar: ['account-overview', 'star-analysis', 'note-join'],
    pgy: ['pgy-analysis'],
    juguang: ['juguang-analysis'],
  };
  for (const [platform, included] of Object.entries(expectedPanels)) {
    const markup = harness.api.buildXhsMarkup({ platform });
    for (const panel of included) assert.match(markup, new RegExp(`data-xhs-panel=["']${panel}["']`));
    for (const panel of Object.values(expectedPanels).flat().filter((value) => !included.includes(value))) {
      assert.doesNotMatch(markup, new RegExp(`data-xhs-panel=["']${panel}["']`));
    }
  }
});

test('XHS platform reports stay hidden until the shared status and analysis belong to the same settled run', () => {
  const harness = createReportHarness();
  const analysis = fictionalAnalysisSnapshot();
  harness.api.setState({
    status: {
      runId: 'fictional-new-run',
      running: true,
      status: 'running',
      platforms: {
        adstar: { status: 'complete' },
        pgy: { status: 'complete' },
        juguang: { status: 'running' },
      },
    },
    analysis,
  });

  for (const platform of ['adstar', 'pgy', 'juguang']) {
    assert.equal(harness.api.sectionHasData(platform), false, `${platform} must wait for the shared join`);
  }

  harness.api.setState({
    status: fictionalCollectionStatus(),
    analysis,
  });
  for (const platform of ['adstar', 'pgy', 'juguang']) {
    assert.equal(harness.api.sectionHasData(platform), true, `${platform} must publish with the settled run`);
  }
});

test('a new parent report never publishes the previous XHS run while its own XHS phase is pending', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: fictionalCollectionStatus(),
    analysis: fictionalAnalysisSnapshot(),
    reportStatus: {
      running: true,
      runId: 'fictional-parent-report-new',
      platforms: ['adstar', 'pgy', 'juguang'],
      results: [],
    },
    reportData: {
      runId: 'fictional-parent-report-new',
      platforms: ['adstar', 'pgy', 'juguang'],
      xiaohongshu: null,
      results: [],
    },
  });

  for (const platform of ['adstar', 'pgy', 'juguang']) {
    assert.equal(harness.api.sectionHasData(platform), false, `${platform} leaked the previous run`);
    assert.equal(harness.api.sectionError(platform), '', `${platform} leaked a previous-run failure`);
  }
});

test('the shared publish gate requires every requested XHS platform to have a terminal state', () => {
  const harness = createReportHarness();
  const status = fictionalCollectionStatus();
  delete status.platforms.juguang;
  harness.api.setState({ status, analysis: fictionalAnalysisSnapshot() });

  for (const platform of ['adstar', 'pgy', 'juguang']) {
    assert.equal(harness.api.sectionHasData(platform), false, `${platform} published before Juguang settled`);
  }
});

test('runId-less legacy XHS snapshots are accepted only inside an immutable archive', () => {
  const liveHarness = createReportHarness();
  const status = fictionalCollectionStatus();
  const analysis = fictionalAnalysisSnapshot();
  delete status.runId;
  delete analysis.runId;
  const parentStatus = {
    running: false,
    runId: 'fictional-legacy-parent',
    platforms: ['adstar', 'pgy', 'juguang'],
  };
  const parentReport = {
    runId: 'fictional-legacy-parent',
    platforms: ['adstar', 'pgy', 'juguang'],
    xiaohongshu: null,
  };
  liveHarness.api.setState({
    status,
    analysis,
    reportStatus: parentStatus,
    reportData: parentReport,
  });
  assert.equal(liveHarness.api.sectionHasData('adstar'), false);

  const archiveHarness = createReportHarness();
  archiveHarness.api.applyArchiveRun({
    runId: 'fictional-legacy-store-run',
    snapshots: {
      taobaoContentDiagnosisReportStatusV1: parentStatus,
      taobaoContentDiagnosisReportV1: parentReport,
      [XHS_STATUS_KEY]: status,
      [XHS_ANALYSIS_KEY]: analysis,
    },
  });
  for (const platform of ['adstar', 'pgy', 'juguang']) {
    assert.equal(archiveHarness.api.sectionHasData(platform), true, `${platform} legacy archive was rejected`);
  }
});

test('a current collection failure is not hidden by a stale analysis snapshot', () => {
  const harness = createReportHarness();
  const parentRunId = 'fictional-parent-collection-failure';
  const status = fictionalCollectionStatus();
  status.runId = `${parentRunId}-xhs-attempt-1`;
  harness.api.setState({
    status,
    analysis: fictionalAnalysisSnapshot(),
    reportData: {
      runId: parentRunId,
      platforms: ['adstar', 'pgy', 'juguang'],
      xiaohongshu: null,
    },
    reportStatus: {
      running: false,
      runId: parentRunId,
      platforms: ['adstar', 'pgy', 'juguang'],
      results: [{
        key: 'xiaohongshu',
        ok: false,
        code: 'XHS_COLLECTION_FAILED',
        message: '所选小红书平台均未成功返回。',
      }],
    },
  });

  assert.equal(harness.api.sectionHasData('pgy'), false);
  assert.match(harness.api.sectionError('pgy'), /所选小红书平台均未成功返回/);
});

test('one failed XHS source only blocks its own platform report after the shared join', () => {
  const harness = createReportHarness();
  const analysis = fictionalAnalysisSnapshot();
  const status = fictionalCollectionStatus();
  status.status = 'partial';
  status.running = false;
  status.platforms.pgy = {
    status: 'failed',
    errors: [{ code: 'PGY_REPORT_FAILED', message: '蒲公英分页证据不完整' }],
  };
  harness.api.setState({ status, analysis });

  assert.equal(harness.api.sectionHasData('adstar'), true);
  assert.equal(harness.api.sectionHasData('pgy'), false);
  assert.equal(harness.api.sectionHasData('juguang'), true);

  harness.api.renderXhsPlatform('adstar');
  harness.api.renderXhsPlatform('pgy');
  harness.api.renderXhsPlatform('juguang');
  const starMarkup = harness.elements.get('adstarReport').innerHTML;
  const pgyMarkup = harness.elements.get('pgyReport').innerHTML;
  const juguangMarkup = harness.elements.get('juguangReport').innerHTML;
  assert.match(starMarkup, /data-xhs-panel="star-analysis"/);
  assert.doesNotMatch(starMarkup, /data-xhs-panel="pgy-analysis"|data-xhs-panel="juguang-analysis"/);
  assert.match(pgyMarkup, /data-xhs-platform="pgy"[\s\S]*PGY_REPORT_FAILED[\s\S]*蒲公英分页证据不完整/);
  assert.doesNotMatch(pgyMarkup, /data-xhs-platform="adstar"|data-xhs-platform="juguang"/);
  assert.match(juguangMarkup, /data-xhs-panel="juguang-analysis"/);
  assert.doesNotMatch(juguangMarkup, /data-xhs-panel="pgy-analysis"|data-xhs-panel="star-analysis"/);
});

test('the production three-mount renderer populates each XHS platform report independently', () => {
  const harness = createReportHarness({ platformMountsOnly: true });
  harness.api.setState({
    status: fictionalCollectionStatus(),
    analysis: fictionalAnalysisSnapshot(),
  });

  harness.api.renderXhs();
  assert.match(harness.elements.get('adstarReport').innerHTML, /data-xhs-panel="star-analysis"/);
  assert.match(harness.elements.get('pgyReport').innerHTML, /data-xhs-panel="pgy-analysis"/);
  assert.match(harness.elements.get('juguangReport').innerHTML, /data-xhs-panel="juguang-analysis"/);
});

test('a failed XHS platform keeps redacted diagnostics in the standalone eight-section export', () => {
  const harness = createReportHarness();
  const analysis = fictionalAnalysisSnapshot();
  const status = fictionalCollectionStatus();
  status.status = 'partial';
  status.platforms.pgy = {
    status: 'failed',
    errors: [{ code: 'PGY_ARCHIVE_FAILED', message: '蒲公英分页证据不完整' }],
  };
  harness.api.setState({ status, analysis });

  const exported = harness.api.buildExportReportDocument({
    finishedAt: Date.parse('2030-02-01T00:00:00.000Z'),
  }).html;
  const pgyPanel = exported.slice(
    exported.indexOf('data-export-panel="pgy"'),
    exported.indexOf('data-export-panel="juguang"'),
  );
  assert.match(pgyPanel, /data-xhs-platform="pgy"/);
  assert.match(pgyPanel, /PGY_ARCHIVE_FAILED[\s\S]*蒲公英分页证据不完整/);
  assert.match(pgyPanel, /<details class="xhs-source-diagnostics">/);
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
  assertContains(combined, /星河项目[^\n]*项目任务|店铺\s*→\s*项目\s*→\s*任务/,
    'XHS report must show Star project/task summary layers');
  assertContains(combined, /按营销诉求筛选|账户\s*→\s*营销诉求\s*→\s*投放位置/,
    'XHS report must show the Juguang objective dimension inside its configurable hierarchy');
});

test('static Juguang report header names the real placement dimension', () => {
  const page = read('web-tool/report-view.html');
  assert.match(page, /账户\s*→\s*营销诉求\s*→\s*投放位置/);
  assert.doesNotMatch(page, /投放模式/);
});

test('XHS source cards prefer safe status account labels when analysis is unavailable', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: {
      status: 'partial',
      platforms: {
        adstar: {
          status: 'complete',
          collectedAt: '2030-02-01T00:00:00.000Z',
          accountLabel: '虚构星河品牌',
          accountCount: 1,
        },
        pgy: { status: 'failed' },
        juguang: { status: 'failed' },
      },
    },
    analysis: null,
  });

  harness.api.renderXhs();
  const markup = harness.elements.get('xhsReport').innerHTML;
  const adstarCard = markup.match(/<article[^>]*data-xhs-platform="adstar"[\s\S]*?<\/article>/);
  assert.ok(adstarCard, 'missing Adstar source card');
  assert.match(adstarCard[0], /2030\/2\/1[\s\S]*虚构星河品牌/);
  assert.doesNotMatch(adstarCard[0], /账号待识别/);
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

test('failed XHS collection is not marked generated and shows its generic failure', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: {
      status: 'complete',
      platforms: {
        adstar: { status: 'complete' },
        pgy: { status: 'complete' },
        juguang: { status: 'complete' },
      },
    },
    analysis: null,
    reportStatus: {
      results: [{
        key: 'xiaohongshu',
        name: '小红书三平台全链路',
        ok: false,
        code: 'XHS_COLLECTION_FAILED',
        message: '所选小红书平台均未成功返回。',
      }],
    },
  });

  assert.equal(
    harness.api.sectionHasData('xiaohongshu'),
    false,
    'collection status without an analysis snapshot must not produce an “已生成” section badge',
  );
  const error = harness.api.sectionError('xiaohongshu');
  assert.match(error, /所选小红书平台均未成功返回/);

  harness.api.renderXhs();
  const markup = harness.elements.get('xhsReport').innerHTML;
  assert.match(markup, /所选小红书平台均未成功返回/);
});

test('XHS failed and partial source cards expose only folded redacted code and message diagnostics', () => {
  const liveHarness = createReportHarness();
  liveHarness.api.setState({
    status: {
      status: 'failed',
      platforms: {
        adstar: {
          status: 'failed',
          errors: [{
            code: 'XHS_PLATFORM_TAB_MISSING',
            message: '请刷新平台页 https://adstar.example.invalid/report?access_token=fictional-url-secret',
            raw: 'fictional-raw-secret',
            headers: { Authorization: 'Bearer fictional-header-secret' },
            requestUrl: 'https://adstar.example.invalid/private',
          }],
        },
        pgy: {
          status: 'partial',
          warnings: [{
            code: 'pagination_incomplete',
            message: '分页中断，token=fictional-message-secret，请稍后重试',
            rawBody: 'fictional-warning-raw-secret',
          }],
        },
        juguang: {
          status: 'complete',
          errors: [{ code: 'must_not_render', message: 'fictional-complete-source-secret' }],
          warnings: [{
            code: 'platform_fee_rounding_reconciled',
            message: '汇总 42，明细 41，差额 1，严格容差 2 元。',
          }],
        },
      },
    },
    analysis: null,
  });

  liveHarness.api.renderXhs();
  const liveMarkup = liveHarness.elements.get('xhsReport').innerHTML;
  assert.match(liveMarkup, /data-xhs-platform="adstar"[\s\S]*XHS_PLATFORM_TAB_MISSING[\s\S]*请刷新平台页/);
  assert.match(liveMarkup, /data-xhs-platform="pgy"[\s\S]*pagination_incomplete[\s\S]*分页中断/);
  assert.match(
    liveMarkup,
    /data-xhs-platform="juguang"[\s\S]*platform_fee_rounding_reconciled[\s\S]*汇总 42，明细 41/,
    'ready sources must retain folded non-blocking reconciliation evidence',
  );
  assert.match(liveMarkup, /<details class="xhs-source-diagnostics">\s*<summary>/);
  assert.doesNotMatch(liveMarkup, /<details[^>]*\sopen(?:\s|>)/, 'technical details must be folded by default');
  for (const secret of [
    'https://adstar.example.invalid', 'access_token', 'fictional-url-secret',
    'token=', 'fictional-message-secret', 'fictional-raw-secret',
    'Authorization', 'fictional-header-secret', 'requestUrl',
    'fictional-warning-raw-secret', 'must_not_render', 'fictional-complete-source-secret',
  ]) {
    assert.equal(liveMarkup.includes(secret), false, `report leaked ${secret}`);
  }

  const archiveHarness = createReportHarness();
  archiveHarness.api.applyArchiveRun({
    runId: 'fictional-archived-xhs-failure',
    snapshots: {
      [XHS_STATUS_KEY]: {
        status: 'partial',
        platforms: {
          adstar: { status: 'complete' },
          pgy: {
            status: 'partial',
            warnings: [{ code: 'archived_page_gap', message: '归档分页证据不完整' }],
          },
          juguang: { status: 'failed', errors: [{ code: 'archived_account_missing', message: '归档账号未识别' }] },
        },
      },
    },
  });
  archiveHarness.api.renderXhs();
  const archiveMarkup = archiveHarness.elements.get('xhsReport').innerHTML;
  assert.match(archiveMarkup, /archived_page_gap[\s\S]*归档分页证据不完整/);
  assert.match(archiveMarkup, /archived_account_missing[\s\S]*归档账号未识别/);
});

test('XHS diagnostics redact credential aliases from code and message while preserving safe explanations', () => {
  const harness = createReportHarness();
  harness.api.setState({
    status: {
      status: 'failed',
      platforms: {
        adstar: {
          status: 'failed',
          errors: [
            {
              code: 'XHS_TOKEN_EXPIRED',
              message: '登录会话已过期，请刷新页面后重试',
            },
            {
              code: 'UPSTREAM_sessionId=fictional-code-session',
              message: 'clientSecret=fictional-message-client-secret；普通说明保留',
            },
            {
              code: 'X-S:fictional-code-xs',
              message: 'xsign=fictional-message-xsign，签名失败请重试',
            },
            {
              code: 'Bearer fictional-code-bearer',
              message: 'Authorization: Bearer fictional-message-bearer；请重新登录',
            },
            {
              code: 'https://api.example.invalid/private?sign=fictional-code-url-sign',
              message: '签名请求 https://api.example.invalid/private?X-S=fictional-message-url-sign，保留结论',
            },
            {
              code: 'headers={Authorization:Bearer fictional-code-header}',
              message: 'raw=fictional-message-raw payload；requestUrl=https://api.example.invalid/private；安全提示保留',
            },
          ],
        },
        pgy: { status: 'complete' },
        juguang: { status: 'complete' },
      },
    },
    analysis: null,
  });

  harness.api.renderXhs();
  const markup = harness.elements.get('xhsReport').innerHTML;

  assert.match(markup, /XHS_TOKEN_EXPIRED[\s\S]*登录会话已过期，请刷新页面后重试/);
  assert.match(markup, /<code>unknown_error<\/code>/, 'fully redacted error codes must use the safe fallback');
  for (const safeText of ['普通说明保留', '签名失败请重试', '请重新登录', '保留结论', '安全提示保留']) {
    assert.equal(markup.includes(safeText), true, `report removed safe explanation: ${safeText}`);
  }
  for (const leakedText of [
    'sessionId', 'clientSecret', 'xsign', 'X-S:', 'Bearer',
    'fictional-code-session', 'fictional-message-client-secret',
    'fictional-code-xs', 'fictional-message-xsign',
    'fictional-code-bearer', 'fictional-message-bearer',
    'fictional-code-url-sign', 'fictional-message-url-sign',
    'headers=', 'fictional-code-header', 'raw=', 'fictional-message-raw',
    'requestUrl=', 'https://api.example.invalid',
  ]) {
    assert.equal(markup.includes(leakedText), false, `report leaked ${leakedText}`);
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

  for (const [platform, name] of [['adstar', '淘宝星河'], ['pgy', '蒲公英'], ['juguang', '聚光']]) {
    assertContains(reportExport, new RegExp(`key:\\s*['"]${platform}['"]`), `interactive export ${name}`);
    assertContains(reportExport, new RegExp(name), `interactive export must label ${name}`);
  }
  assertContains(dashboard, /小红书经营数据/, 'workbook must include an XHS operating-data sheet');
  for (const sheetName of [
    '小红书账户总览', '蒲公英月度', '蒲公英粉丝量级', '聚光分析',
    '星河汇总', '星河项目任务', '笔记全链路', '小红书质量说明',
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
