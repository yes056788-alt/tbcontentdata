const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const XhsContract = require('../xhs/contract');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

const backgroundSource = read('background.js');
const platformHelpers = block(
  backgroundSource,
  'function normalizePlatformTaskIds',
  '\nasync function waitTabComplete'
);
const runXhsSource = block(
  backgroundSource,
  'const XHS_TERMINAL_COLLECTION_ERROR_CODES',
  '\nasync function runContentDiagnosisReport'
);
const reportSource = block(
  backgroundSource,
  'async function runContentDiagnosisReport',
  '\nfunction batchText'
);
const resultFailuresSource = block(
  backgroundSource,
  'function resultFailures',
  '\nasync function archiveAccountRun'
);
const archiveSource = block(
  backgroundSource,
  'async function archiveAccountRun',
  '\nasync function saveAccountBatchStatus'
);

function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function createRunXhsHarness(options = {}) {
  const storageReads = [];
  const storageWrites = [];
  const storageRemovals = [];
  const analysisInputs = [];
  const collections = options.collections || {};
  const snapshot = options.snapshot || {
    schema: 'xhsAnalysisSnapshotV1',
    notes: [],
    quality: { decisionReady: false, issues: [] },
  };
  const context = vm.createContext({
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    XhsContract,
    normalizeProjectPlatformTaskIds(value) {
      return Array.isArray(value) ? value.slice() : [];
    },
    normalizeXhsDateRange(value) {
      return value;
    },
    batchText(value, maxLength) {
      return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
    },
    xhsRuntime: {
      run(input) {
        if (typeof options.runtimeRun === 'function') return options.runtimeRun(jsonCopy(input));
        return {
          status: options.collectionStatus || 'partial',
          platforms: collections,
        };
      },
    },
    XhsAnalysis: {
      createXhsAnalysisSnapshot(input) {
        analysisInputs.push(jsonCopy(input));
        return jsonCopy(snapshot);
      },
    },
    XhsMetrics: options.metrics || {
      assertSnapshotWithinLimit() {},
      analysisDetailKeys() { return []; },
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            storageReads.push(jsonCopy(key));
            return {};
          },
          async set(value) {
            storageWrites.push(jsonCopy(value));
          },
          async remove(keys) {
            storageRemovals.push(jsonCopy(keys));
          },
        },
      },
    },
  });
  vm.runInContext(runXhsSource + '\nglobalThis.testRunXhs = runXhsAnalysisTask;', context);
  return {
    run: context.testRunXhs,
    storageReads,
    storageWrites,
    storageRemovals,
    analysisInputs,
  };
}

test('current-session task picker includes three XHS sources and an explicit date range, but batch stays Taobao-only', () => {
  const html = read('web-tool/report.html');
  const current = block(html, 'data-platform-picker="current"', 'id="batchModePanel"');
  const batch = block(html, 'data-platform-picker="batch"', '</fieldset>');
  for (const [id, name] of [
    ['adstar', '淘宝星河'],
    ['pgy', '蒲公英'],
    ['juguang', '聚光'],
  ]) {
    assert.match(current, new RegExp(`value=["']${id}["'][\\s\\S]{0,180}${name}`));
    assert.doesNotMatch(batch, new RegExp(`value=["']${id}["']`));
  }
  assert.match(html, /id="xhsDateFrom"[^>]*type="date"/);
  assert.match(html, /id="xhsDateTo"[^>]*type="date"/);
  assert.match(html, /笔记发布时间/);
  assert.match(html, /Asia\/Shanghai|中国标准时间/);
});

test('task client sends the XHS date range and all current-session selections through the existing project task', () => {
  const source = read('web-tool/task.js');
  const current = block(source, 'async function startCurrentTask', '\n  async function');
  assert.match(current, /selectedPlatforms\(['"]current['"]\)/);
  assert.match(current, /xhsDateFrom/);
  assert.match(current, /xhsDateTo/);
  assert.match(current, /timezone\s*:\s*['"]Asia\/Shanghai['"]/);
  assert.match(current, /startProjectTask/);
  assert.match(current, /dateRange/);
});

test('bridge accepts XHS platform ids only for current project tasks', () => {
  const source = read('web-tool-bridge.js');
  assert.match(source, /const XHS_PLATFORM_TASK_IDS\s*=\s*\[[^\]]*['"]adstar['"][^\]]*['"]pgy['"][^\]]*['"]juguang['"]/s);
  const batch = block(source, 'function sanitizeBatchPayload', 'function sanitizePlatformTasks');
  assert.doesNotMatch(batch, /XHS_PLATFORM_TASK_IDS/);
  const project = block(source, 'function sanitizeProjectTask', '\n  function ');
  assert.match(project, /sanitizeProjectPlatformTasks/);
  assert.match(project, /dateRange/);
});

test('background one-click report runs selected XHS sources, creates a gated analysis snapshot, and archives it', () => {
  const source = read('background.js');
  assert.match(source, /['"]xhs\/analysis\.js['"]/);
  assert.match(source, /['"]xhs\/metrics\.js['"]/);
  assert.match(source, /async function runXhsAnalysisTask\s*\(/);
  assert.match(source, /XhsAnalysis\.createXhsAnalysisSnapshot\s*\(/);
  assert.match(source, /XhsMetrics\.assertSnapshotWithinLimit\s*\(/);
  assert.match(source, /xhsAnalysisSnapshotV1/);
  assert.match(source, /normalizeProjectPlatformTaskIds/);
  const projectTask = block(source, 'async function runProjectTask', '\nasync function ');
  assert.match(projectTask, /dateRange/);
  assert.match(projectTask, /ensureContentDiagnosisReportTask\s*\(\s*\{[^}]*dateRange/s);
});

test('runXhsAnalysisTask waits for all three sources before analysis', async () => {
  const collectionReady = deferred();
  const collections = {
    adstar: { status: 'complete', identity: { memberId: 'fixture-star' } },
    pgy: { status: 'complete', identity: { brandUserId: 'fixture-pgy' } },
    juguang: {
      status: 'complete',
      accounts: [{ account: { advertiserId: 1001, accountType: 4 } }],
    },
  };
  const harness = createRunXhsHarness({
    runtimeRun() {
      return collectionReady.promise;
    },
  });
  const pending = harness.run({
    runId: 'fixture-parallel-join',
    storeId: 'fixture-store',
    dateRange: { from: '2030-01-01', to: '2030-01-07', timezone: 'Asia/Shanghai' },
    platforms: ['adstar', 'pgy', 'juguang'],
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.analysisInputs.length, 0);

  collectionReady.resolve({ status: 'complete', platforms: collections });
  await pending;

  assert.equal(harness.analysisInputs.length, 1);
  assert.deepEqual(
    Object.keys(harness.analysisInputs[0].collections),
    ['adstar', 'pgy', 'juguang'],
  );
});

test('report progress treats the parallel three-source XHS pipeline as one top-level step', () => {
  const source = read('web-tool/report.js');
  assert.match(source, /key:\s*['"]xiaohongshu['"]\s*,\s*name:\s*['"][^'"]*小红书/);
  assert.match(source, /XHS_REPORT_SECTION_KEYS\.includes\(section\)[^\n]*return\s*['"]xiaohongshu['"]/);
});

test('runXhsAnalysisTask returns ok false when every requested source failed or was cancelled', async () => {
  const harness = createRunXhsHarness({
    collectionStatus: 'failed',
    collections: {
      adstar: { status: 'failed', errors: [{ code: 'fictional-star-failure' }] },
      pgy: { status: 'cancelled', errors: [{ code: 'fictional-pgy-cancelled' }] },
      juguang: { status: 'failed', errors: [{ code: 'fictional-juguang-failure' }] },
    },
  });

  const result = await harness.run({
    runId: 'fictional-xhs-all-failed-run',
    storeId: 'fictional-store-all-failed',
    platforms: ['adstar', 'pgy', 'juguang'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
  });

  assert.equal(result.ok, false, 'all failed/cancelled XHS work must fail the top-level step');
});

test('runXhsAnalysisTask marks terminal platform failures as non-retryable', async (t) => {
  for (const testCase of [
    { platform: 'adstar', error: { code: 'XHS_PLATFORM_TAB_MISSING' } },
    { platform: 'adstar', error: { code: 'XHS_PLATFORM_TAB_AMBIGUOUS' } },
    { platform: 'adstar', error: { code: 'XHS_COLLECTOR_UNAVAILABLE' } },
    { platform: 'pgy', error: { code: 'identity_unavailable' } },
    { platform: 'pgy', error: { code: 'summary_invalid' } },
    { platform: 'pgy', error: { code: 'schema_invalid' } },
    { platform: 'juguang', error: { code: 'report_schema_invalid' } },
    { platform: 'juguang', error: { code: 'account_identity_mismatch' } },
    { platform: 'adstar', error: { code: 'fictional-explicit-terminal', retryable: false } },
  ]) {
    await t.test(testCase.error.code, async () => {
      const harness = createRunXhsHarness({
        collectionStatus: 'failed',
        collections: {
          [testCase.platform]: { status: 'failed', errors: [testCase.error] },
        },
      });

      const result = await harness.run({
        runId: `fictional-xhs-terminal-${testCase.error.code}`,
        storeId: 'fictional-store-terminal',
        platforms: [testCase.platform],
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, 'XHS_COLLECTION_FAILED');
      assert.equal(result.retryable, false);
    });
  }
});

test('runXhsAnalysisTask keeps a purely transient all-failed collection retryable', async () => {
  const harness = createRunXhsHarness({
    collectionStatus: 'failed',
    collections: {
      adstar: {
        status: 'failed',
        errors: [{ code: 'ADSTAR_NETWORK_ERROR', retryable: true }],
      },
      pgy: {
        status: 'failed',
        errors: [{ code: 'PGY_TIMEOUT', retryable: true }],
      },
      juguang: {
        status: 'failed',
        errors: [{ code: 'JUGUANG_NETWORK_ERROR', retryable: true }],
      },
    },
  });

  const result = await harness.run({
    runId: 'fictional-xhs-transient-all-failed',
    storeId: 'fictional-store-transient',
    platforms: ['adstar', 'pgy', 'juguang'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'XHS_COLLECTION_FAILED');
  assert.equal(result.retryable, true);
});

test('runXhsAnalysisTask keeps two successful sources when the third source failed or was cancelled', async () => {
  for (const unavailableStatus of ['failed', 'cancelled']) {
    const snapshot = {
      schema: 'xhsAnalysisSnapshotV1',
      notes: [{ noteId: `fictional-note-${unavailableStatus}` }],
      quality: {
        decisionReady: false,
        issues: [{
          severity: 'critical',
          code: 'account_identity_missing',
          platform: 'juguang',
          message: 'fictional unavailable source has no identity',
        }],
      },
    };
    const harness = createRunXhsHarness({
      collectionStatus: 'partial',
      collections: {
        adstar: { status: 'complete', identity: { memberId: 'fictional-star-mixed' } },
        pgy: { status: 'complete', identity: { brandUserId: 'fictional-pgy-mixed' } },
        juguang: { status: unavailableStatus, errors: [{ code: 'fictional-juguang-unavailable' }] },
      },
      snapshot,
    });

    const result = await harness.run({
      runId: `fictional-xhs-mixed-${unavailableStatus}`,
      storeId: 'fictional-store-mixed-success',
      platforms: ['adstar', 'pgy', 'juguang'],
      dateRange: { from: '2030-02-01', to: '2030-02-07', timezone: 'Asia/Shanghai' },
    });

    assert.equal(result.ok, true, `${unavailableStatus} missing identity must not discard two successful sources`);
    assert.equal(result.partial, true);
    assert.equal(result.code, '');
    assert.deepEqual(result.snapshot, snapshot);
    assert.ok(
      harness.storageWrites.some((value) => value.xhsAnalysisSnapshotV1),
      'the partial analysis snapshot must be saved',
    );
  }
});

test('runXhsAnalysisTask keeps two successful sources when the third source is partial', async () => {
  for (const code of ['account_identity_missing', 'account_identity_ambiguous']) {
    const snapshot = {
      schema: 'xhsAnalysisSnapshotV1',
      notes: [{ noteId: `fictional-note-${code}` }],
      quality: {
        decisionReady: false,
        issues: [{
          severity: 'critical',
          code,
          platform: 'juguang',
          message: `fictional partial source ${code}`,
        }],
      },
    };
    const harness = createRunXhsHarness({
      collectionStatus: 'partial',
      collections: {
        adstar: { status: 'complete', identity: { memberId: 'fictional-star-partial' } },
        pgy: { status: 'complete', identity: { brandUserId: 'fictional-pgy-partial' } },
        juguang: {
          status: 'partial',
          errors: [
            { code: 'account_switch_failed' },
            { code: 'account_restore_failed' },
          ],
        },
      },
      snapshot,
    });

    const result = await harness.run({
      runId: `fictional-xhs-partial-${code}`,
      storeId: 'fictional-store-partial-source',
      platforms: ['adstar', 'pgy', 'juguang'],
      dateRange: { from: '2030-02-08', to: '2030-02-14', timezone: 'Asia/Shanghai' },
    });

    assert.equal(result.ok, true, `${code} must not discard two successful sources`);
    assert.equal(result.partial, true, code);
    assert.equal(result.code, '', code);
    assert.deepEqual(result.snapshot, snapshot, code);
    assert.ok(
      harness.storageWrites.some((value) => value.xhsAnalysisSnapshotV1),
      `${code} partial analysis snapshot must be saved`,
    );
  }
});

test('runXhsAnalysisTask archives successful collections without a store identity binding gate', async () => {
  const snapshot = {
    schema: 'xhsAnalysisSnapshotV1',
    notes: [{ noteId: 'fictional-note-unbound' }],
    quality: { decisionReady: true, issues: [] },
  };
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: {
      adstar: { status: 'complete', identity: { memberId: 'fictional-star-unbound' } },
      pgy: { status: 'complete', identity: { brandUserId: 'fictional-pgy-unbound' } },
      juguang: {
        status: 'complete',
        accounts: [{ account: { advertiserId: 'fictional-juguang-unbound', accountType: 4 } }],
      },
    },
    snapshot,
  });

  const result = await harness.run({
    runId: 'fictional-xhs-unbound-run',
    storeId: 'fictional-store-unbound',
    platforms: ['adstar', 'pgy', 'juguang'],
    dateRange: { from: '2030-03-08', to: '2030-03-14', timezone: 'Asia/Shanghai' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, '');
  assert.deepEqual(result.snapshot, snapshot);
  assert.ok(harness.storageWrites.some((value) => value.xhsAnalysisSnapshotV1));
  assert.equal(Object.hasOwn(harness.analysisInputs[0], 'accountBindings'), false);
  assert.equal(Object.hasOwn(harness.analysisInputs[0], 'bindingIssues'), false);
});

test('runXhsAnalysisTask anchors analysis asOf to the requested dateRange.to', async () => {
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: {
      adstar: { status: 'complete', identity: { memberId: 'fictional-star-asof' } },
    },
    snapshot: {
      schema: 'xhsAnalysisSnapshotV1',
      notes: [],
      quality: { decisionReady: true, issues: [] },
    },
  });
  const dateRange = { from: '2031-04-01', to: '2031-04-09', timezone: 'Asia/Shanghai' };

  await harness.run({
    runId: 'fictional-xhs-asof-run',
    storeId: 'fictional-store-asof',
    platforms: ['adstar'],
    dateRange,
  });

  assert.equal(harness.analysisInputs.length, 1);
  assert.equal(harness.analysisInputs[0].asOf, dateRange.to);
});

test('runXhsAnalysisTask falls back to detail shards when the full analysis exceeds 8 MiB', async () => {
  const fullSnapshot = {
    schema: 'xhsAnalysisSnapshotV1',
    notes: [{ noteId: 'fictional-large-note' }],
    quality: { decisionReady: true, issues: [] },
  };
  const compactSnapshot = {
    schema: 'xhsAnalysisSnapshotV1',
    notes: [{ noteId: 'fictional-large-note' }],
    quality: { decisionReady: true, issues: [] },
    detailArchive: {
      schema: 'xhsAnalysisDetailManifestV1',
      complete: true,
      sections: { notes: { sourceCount: 501 } },
      chunks: [{ key: 'xhsAnalysisDetailChunkV1:0000' }],
    },
  };
  const detailChunk = {
    schema: 'xhsAnalysisDetailChunkV1',
    kind: 'notes',
    items: [{ noteId: 'fictional-large-note' }],
  };
  let gateCalls = 0;
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: { adstar: { status: 'complete' } },
    snapshot: fullSnapshot,
    metrics: {
      assertSnapshotWithinLimit(value) {
        gateCalls += 1;
        if (value === value && gateCalls === 1) {
          const error = new Error('fictional 8 MiB overflow');
          error.code = 'XHS_SNAPSHOT_SIZE_LIMIT';
          throw error;
        }
      },
      createXhsAnalysisArchiveBundle() {
        return {
          snapshot: compactSnapshot,
          chunks: { 'xhsAnalysisDetailChunkV1:0000': detailChunk },
        };
      },
      analysisDetailKeys() { return []; },
    },
  });

  const result = await harness.run({
    runId: 'fictional-large-sharded-run',
    storeId: 'fictional-large-sharded-store',
    platforms: ['adstar'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.noteCount, 501);
  assert.deepEqual(result.snapshot, compactSnapshot);
  assert.ok(harness.storageWrites.some((write) => (
    write.xhsAnalysisSnapshotV1 && write['xhsAnalysisDetailChunkV1:0000']
  )));
  assert.equal(gateCalls, 2, 'the compact summary is checked again before storage');
});

test('report executeStep preserves a returned detail.ok false instead of manufacturing success', async () => {
  const storageWrites = [];
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async remove() {},
          async set(value) {
            storageWrites.push(jsonCopy(value));
          },
        },
      },
    },
    CONTENT_DIAGNOSIS_STATUS_KEY: 'fictional-report-status',
    CONTENT_DIAGNOSIS_REPORT_KEY: 'fictional-report-data',
    CONTENT_DIAGNOSIS_WXT_KEY: 'fictional-report-wxt',
    PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    XhsContract,
    REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
    PLATFORM_RETRY_ATTEMPTS: 1,
    contentDiagnosisResultMessage(detail) {
      return detail && detail.message || '';
    },
    async runXhsAnalysisTask() {
      return {
        ok: false,
        code: 'XHS_COLLECTION_FAILED',
        partial: true,
        message: '三个虚构来源均未完成',
        snapshot: null,
      };
    },
    async runBusinessDefenseSycm() { throw new Error('unselected sycm'); },
    async runBusinessDefenseGuanghe() { throw new Error('unselected guanghe'); },
    async prepareContentDiagnosisWxtTab() { throw new Error('unselected wxt'); },
    async runContentDiagnosisWxtSection() { throw new Error('unselected wxt'); },
    async runBusinessDefenseDmp() { throw new Error('unselected dmp'); },
    async waitMilliseconds() {},
  });
  vm.runInContext(
    platformHelpers + '\n' + reportSource +
      '\nglobalThis.testRunReport = runContentDiagnosisReport;',
    context
  );

  const result = await context.testRunReport({
    storeId: 'fictional-store-report-failure',
    platforms: ['adstar', 'pgy', 'juguang'],
    dateRange: { from: '2032-02-01', to: '2032-02-29', timezone: 'Asia/Shanghai' },
  });
  const xhsResult = Array.from(result.results).find((item) => item.key === 'xiaohongshu');
  const finalStatus = storageWrites.at(-1)['fictional-report-status'];

  assert.equal(xhsResult.ok, false);
  assert.equal(xhsResult.code, 'XHS_COLLECTION_FAILED');
  assert.equal(Object.hasOwn(xhsResult, 'bindingIssues'), false);
  assert.equal(result.ok, false, 'a report with no successful selected step must return ok false');
  const archivedResult = finalStatus.results.find((item) => item.key === 'xiaohongshu');
  assert.equal(archivedResult.ok, false);
  assert.equal(archivedResult.code, 'XHS_COLLECTION_FAILED');
  assert.equal(Object.hasOwn(archivedResult, 'bindingIssues'), false);
});

test('archive status is failed when every selected step failed without an outer exception', async () => {
  const storageWrites = [];
  const context = vm.createContext({
    ACCOUNT_RUN_SNAPSHOT_KEYS: ['xhsAnalysisSnapshotV1', 'xhsCollectionStatusV1'],
    STORE_RUN_INDEX_KEY: 'fictional-store-run-index',
    STORE_RUN_KEY_PREFIX: 'fictional-store-run:',
    safeBatchAccount(account) {
      return jsonCopy(account);
    },
    XhsMetrics: {
      analysisDetailKeys() { return []; },
    },
    chrome: {
      storage: {
        local: {
          async get() {
            return { 'fictional-store-run-index': [] };
          },
          async set(value) {
            storageWrites.push(jsonCopy(value));
          },
        },
      },
    },
  });
  vm.runInContext(
    resultFailuresSource + '\n' + archiveSource +
      '\nglobalThis.testArchive = archiveAccountRun;',
    context
  );

  const entry = await context.testArchive(
    { id: 'fictional-account', name: '虚构账号', storeId: 'fictional-store', storeName: '虚构店铺' },
    'fictional-batch',
    1_900_000_000_000,
    { state: 'currentSession', noPermission: false },
    null,
    {
      ok: false,
      partial: true,
      results: [{ key: 'xiaohongshu', name: '小红书三平台全链路', ok: false, message: '虚构来源均失败' }],
    },
    '',
    { taskType: 'report', runMode: 'current' }
  );
  const storedRecord = storageWrites.at(-1)['fictional-store-run:' + entry.runId];

  assert.equal(entry.status, 'failed');
  assert.equal(storedRecord.status, 'failed');
});

test('local history archive keeps every XHS detail shard instead of applying the cloud size gate', async () => {
  const detailKeys = ['xhsAnalysisDetailChunkV1:0000', 'xhsAnalysisDetailChunkV1:0001'];
  const analysis = {
    schema: 'xhsAnalysisSnapshotV1',
    runId: 'fictional-complete-local-history-run',
    quality: { decisionReady: true, issues: [] },
    detailArchive: {
      schema: 'xhsAnalysisDetailManifestV1',
      complete: true,
      chunks: detailKeys.map((key, index) => ({ key, index, kind: index ? 'notes' : 'pgyFacts' })),
    },
  };
  const storageWrites = [];
  const stored = {
    xhsAnalysisSnapshotV1: analysis,
    xhsCollectionStatusV1: { status: 'complete' },
    [detailKeys[0]]: {
      schema: 'xhsAnalysisDetailChunkV1',
      items: [{ id: 'pgy-complete', padding: 'x'.repeat(2048) }],
    },
    [detailKeys[1]]: {
      schema: 'xhsAnalysisDetailChunkV1',
      items: [{ id: 'note-complete', padding: 'y'.repeat(2048) }],
    },
    'fictional-store-run-index': [],
  };
  const context = vm.createContext({
    ACCOUNT_RUN_SNAPSHOT_KEYS: ['xhsAnalysisSnapshotV1', 'xhsCollectionStatusV1'],
    STORE_RUN_INDEX_KEY: 'fictional-store-run-index',
    STORE_RUN_KEY_PREFIX: 'fictional-store-run:',
    safeBatchAccount(account) { return jsonCopy(account); },
    XhsMetrics: { analysisDetailKeys() { return detailKeys; } },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            return Object.fromEntries(keys.filter((key) => Object.hasOwn(stored, key))
              .map((key) => [key, jsonCopy(stored[key])]));
          },
          async set(value) { storageWrites.push(jsonCopy(value)); },
        },
      },
    },
  });
  vm.runInContext(
    resultFailuresSource + '\n' + archiveSource +
      '\nglobalThis.testArchive = archiveAccountRun;',
    context
  );

  const entry = await context.testArchive(
    { id: 'fictional-account', name: '虚构账号', storeId: 'fictional-store', storeName: '虚构店铺' },
    'fictional-batch',
    1_900_000_000_000,
    { state: 'currentSession', noPermission: false },
    { ok: true, results: [] },
    { ok: true, results: [] },
    '',
    { taskType: 'both', runMode: 'current', maxArchiveBytes: 1024 }
  );
  const record = storageWrites.at(-1)['fictional-store-run:' + entry.runId];

  assert.equal(record.status, 'success');
  assert.equal(record.snapshots.xhsAnalysisSnapshotV1.detailArchive.complete, true);
  assert.deepEqual(Object.keys(record.snapshots).filter((key) => key.startsWith('xhsAnalysisDetailChunkV1:')),
    detailKeys);
});

test('background does not read, write, or pass legacy store identity bindings', async () => {
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: {
      adstar: {
        status: 'complete',
        accountKey: 'fictional-self-asserted-account-key',
        identity: { memberId: 'fictional-real-member' },
      },
    },
    snapshot: {
      schema: 'xhsAnalysisSnapshotV1',
      notes: [],
      quality: { decisionReady: true, issues: [] },
    },
  });

  await harness.run({
    runId: 'fictional-xhs-binding-run',
    storeId: 'fictional-store-binding',
    platforms: ['adstar'],
    dateRange: { from: '2033-03-01', to: '2033-03-31', timezone: 'Asia/Shanghai' },
  });

  assert.equal(harness.storageReads.length, 1,
    'the previous compact snapshot is read only to remove stale detail shards');
  assert.ok(harness.storageWrites.some((value) => value.xhsAnalysisSnapshotV1));
  assert.equal(Object.hasOwn(harness.analysisInputs[0], 'accountBindings'), false);
  assert.equal(Object.hasOwn(harness.analysisInputs[0], 'bindingIssues'), false);
});

test('background and cloud ZIP load XhsIdentity before analysis', () => {
  const imports = block(backgroundSource, 'importScripts(', ');');
  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');

  assert.match(imports, /['"]xhs\/identity\.js['"]/);
  assert.ok(
    imports.indexOf('xhs/identity.js') < imports.indexOf('xhs/analysis.js'),
    'XhsIdentity must load before XhsAnalysis',
  );
  assert.match(sync, /['"]xhs\/identity\.js['"]/);
  assert.doesNotMatch(backgroundSource, /xhsStoreAccountBindingsV1|XhsBindings/);
  assert.doesNotMatch(runXhsSource, /accountBindings|bindingIssues/);
});
