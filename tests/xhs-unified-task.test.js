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
const bindingObservabilitySource = block(
  backgroundSource,
  'const XHS_BINDING_PLATFORM_NAMES',
  '\nfunction xhsCollectionFailureRetryable'
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

function createRunXhsHarness(options = {}) {
  const storageReads = [];
  const storageWrites = [];
  const analysisInputs = [];
  const bindingInputs = [];
  const collections = options.collections || {};
  const registry = options.registry || {
    schema: 'xhsStoreAccountBindingsV1',
    schemaVersion: 1,
    stores: {},
  };
  const bindingResult = options.bindingResult || {
    registry,
    bindings: {},
    actualIdentities: {},
    issues: [],
    ready: true,
    changed: false,
  };
  const snapshot = options.snapshot || {
    schema: 'xhsAnalysisSnapshotV1',
    notes: [],
    quality: { decisionReady: false, issues: [] },
  };
  const context = vm.createContext({
    XHS_PLATFORM_TASK_IDS: ['adstar', 'pgy', 'juguang'],
    XhsContract,
    XHS_STORE_BINDINGS_KEY: 'xhsStoreAccountBindingsV1',
    XHS_STORE_ACCOUNT_BINDINGS_KEY: 'xhsStoreAccountBindingsV1',
    XHS_BINDINGS_STORAGE_KEY: 'xhsStoreAccountBindingsV1',
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
      async run() {
        return {
          status: options.collectionStatus || 'partial',
          platforms: collections,
        };
      },
    },
    XhsBindings: {
      reconcileStoreBindings(input) {
        bindingInputs.push(jsonCopy(input));
        return jsonCopy(bindingResult);
      },
    },
    XhsAnalysis: {
      createXhsAnalysisSnapshot(input) {
        analysisInputs.push(jsonCopy(input));
        return jsonCopy(snapshot);
      },
    },
    XhsMetrics: {
      assertSnapshotWithinLimit() {},
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            storageReads.push(jsonCopy(key));
            return { xhsStoreAccountBindingsV1: jsonCopy(registry) };
          },
          async set(value) {
            storageWrites.push(jsonCopy(value));
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
    analysisInputs,
    bindingInputs,
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

test('report progress treats the serial three-source XHS pipeline as one top-level step', () => {
  const source = read('web-tool/report.js');
  assert.match(source, /key:\s*['"]xiaohongshu['"]\s*,\s*name:\s*['"][^'"]*小红书/);
  assert.match(source, /section\s*===\s*['"]xiaohongshu['"]\)\s*return\s*['"]xiaohongshu['"]/);
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

test('runXhsAnalysisTask keeps two successful sources when the failed or cancelled source only lacks identity', async () => {
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
      bindingResult: {
        registry: { schema: 'xhsStoreAccountBindingsV1', schemaVersion: 1, stores: {} },
        bindings: {
          adstar: ['adstar:fictional-star-mixed'],
          pgy: ['pgy:fictional-pgy-mixed'],
          juguang: [],
        },
        actualIdentities: {
          adstar: ['adstar:fictional-star-mixed'],
          pgy: ['pgy:fictional-pgy-mixed'],
          juguang: [],
        },
        issues: [{
          severity: 'critical',
          code: 'account_identity_missing',
          platform: 'juguang',
          message: 'fictional unavailable source has no identity',
        }],
        ready: false,
        changed: false,
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

test('runXhsAnalysisTask keeps two successful sources when a partial source identity is missing or ambiguous', async () => {
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
      bindingResult: {
        registry: { schema: 'xhsStoreAccountBindingsV1', schemaVersion: 2, stores: {} },
        bindings: {
          adstar: ['adstar:fictional-star-partial'],
          pgy: ['pgy:fictional-pgy-partial'],
          juguang: [],
        },
        actualIdentities: {
          adstar: ['adstar:fictional-star-partial'],
          pgy: ['pgy:fictional-pgy-partial'],
          juguang: [],
        },
        issues: [{
          severity: 'critical', code, platform: 'juguang', message: `fictional ${code}`,
        }],
        ready: false,
        changed: false,
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

test('runXhsAnalysisTask still blocks real identity mismatches and cross-store collisions', async () => {
  for (const code of ['account_binding_mismatch', 'account_identity_bound_to_other_store']) {
    const harness = createRunXhsHarness({
      collectionStatus: 'complete',
      collections: {
        adstar: { status: 'complete', identity: { memberId: 'fictional-star-blocked' } },
        pgy: { status: 'complete', identity: { brandUserId: 'fictional-pgy-blocked' } },
        juguang: { status: 'complete', accounts: [{ account: { advertiserId: 'fictional-ad-blocked' } }] },
      },
      bindingResult: {
        registry: { schema: 'xhsStoreAccountBindingsV1', schemaVersion: 1, stores: {} },
        bindings: {},
        actualIdentities: {},
        issues: [{ severity: 'critical', code, platform: 'adstar', message: `fictional ${code}` }],
        ready: false,
        changed: false,
      },
      snapshot: {
        schema: 'xhsAnalysisSnapshotV1',
        notes: [],
        quality: { decisionReady: false, issues: [{ severity: 'critical', code, platform: 'adstar' }] },
      },
    });

    const result = await harness.run({
      runId: `fictional-xhs-blocked-${code}`,
      storeId: 'fictional-store-blocked',
      platforms: ['adstar', 'pgy', 'juguang'],
      dateRange: { from: '2030-03-01', to: '2030-03-07', timezone: 'Asia/Shanghai' },
    });

    assert.equal(result.ok, false, `${code} must remain blocking`);
    assert.equal(result.code, 'XHS_ACCOUNT_BINDING_FAILED');
    assert.equal(result.snapshot, null);
    assert.equal(
      harness.storageWrites.some((value) => value.xhsAnalysisSnapshotV1),
      false,
      'a true account conflict must never save the analysis snapshot',
    );
  }
});

test('runXhsAnalysisTask exposes only redacted binding code, platform, and message', async () => {
  const expectedToken = 'pgy:fictional-expected-account-token';
  const actualToken = 'pgy:fictional-actual-account-token';
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: {
      pgy: { status: 'complete', identity: { brandUserId: 'fictional-actual-account-token' } },
    },
    bindingResult: {
      registry: { schema: 'xhsStoreAccountBindingsV1', schemaVersion: 2, stores: {} },
      bindings: { pgy: [expectedToken] },
      actualIdentities: { pgy: [actualToken] },
      issues: [{
        severity: 'critical',
        code: 'account_binding_mismatch',
        platform: 'pgy',
        message: 'advertiserId=fictional-advertiser-id; memberId=fictional-member-id; ' +
          'brandUserId=fictional-brand-user-id; otherStoreId=fictional-other-store-id; ' +
          'Authorization: Bearer fictional-binding-credential',
        expected: [expectedToken],
        actual: [actualToken],
        otherStoreId: 'fictional-other-store-id',
      }, {
        severity: 'critical',
        code: 'memberId=fictional-sensitive-code-id',
        platform: 'pgy',
        message: 'brandUserId=fictional-sensitive-message-id',
      }],
      ready: false,
      changed: false,
    },
    snapshot: {
      schema: 'xhsAnalysisSnapshotV1',
      notes: [],
      quality: { decisionReady: false, issues: [] },
    },
  });

  const result = await harness.run({
    runId: 'fictional-xhs-redacted-binding-issue',
    storeId: 'fictional-store-redacted-binding-issue',
    platforms: ['pgy'],
    dateRange: { from: '2030-03-08', to: '2030-03-14', timezone: 'Asia/Shanghai' },
  });

  assert.equal(result.ok, false, 'the binding mismatch must remain blocking');
  assert.equal(result.code, 'XHS_ACCOUNT_BINDING_FAILED');
  assert.deepEqual(JSON.parse(JSON.stringify(result.bindingIssues)), [{
    code: 'account_binding_mismatch',
    platform: 'pgy',
    message: '当前蒲公英登录账号与所选店铺绑定不一致。',
  }, {
    code: 'account_binding_issue',
    platform: 'pgy',
    message: '账号绑定校验未通过。',
  }]);
  assert.deepEqual(harness.analysisInputs[0].bindingIssues, [{
    severity: 'critical',
    code: 'account_binding_mismatch',
    platform: 'pgy',
    message: '当前蒲公英登录账号与所选店铺绑定不一致。',
  }, {
    severity: 'critical',
    code: 'account_binding_issue',
    platform: 'pgy',
    message: '账号绑定校验未通过。',
  }]);
  const serialized = JSON.stringify({ result, analysisInput: harness.analysisInputs[0].bindingIssues });
  for (const forbidden of [
    expectedToken, actualToken, 'fictional-binding-credential', 'fictional-other-store-id',
    'fictional-advertiser-id', 'fictional-member-id', 'fictional-brand-user-id',
    'fictional-sensitive-code-id', 'fictional-sensitive-message-id',
    '"expected"', '"actual"', '"otherStoreId"',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `binding observability leaked ${forbidden}`);
  }
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
        partial: true,
        message: '三个虚构来源均未完成',
        bindingIssues: [{
          code: 'account_binding_mismatch',
          platform: 'pgy',
          message: 'advertiserId=fictional-report-advertiser; otherStoreId=fictional-report-store; ' +
            'Authorization: Bearer fictional-report-token',
          expected: ['pgy:fictional-report-expected'],
          actual: ['pgy:fictional-report-actual'],
        }],
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
    platformHelpers + '\n' + bindingObservabilitySource + '\n' + reportSource +
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
  assert.deepEqual(JSON.parse(JSON.stringify(xhsResult.bindingIssues)), [{
    code: 'account_binding_mismatch',
    platform: 'pgy',
    message: '当前蒲公英登录账号与所选店铺绑定不一致。',
  }]);
  assert.equal(result.ok, false, 'a report with no successful selected step must return ok false');
  const archivedResult = finalStatus.results.find((item) => item.key === 'xiaohongshu');
  assert.equal(archivedResult.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(archivedResult.bindingIssues)), [{
    code: 'account_binding_mismatch',
    platform: 'pgy',
    message: '当前蒲公英登录账号与所选店铺绑定不一致。',
  }]);
  const archivedSerialized = JSON.stringify(archivedResult);
  for (const forbidden of [
    'fictional-report-token', 'fictional-report-expected', 'fictional-report-actual',
    'fictional-report-advertiser', 'fictional-report-store',
    '"expected"', '"actual"',
  ]) {
    assert.equal(archivedSerialized.includes(forbidden), false, `archived report leaked ${forbidden}`);
  }
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

test('background reconciles and persists real XHS identities instead of trusting collection.accountKey', async () => {
  const bindingResult = {
    registry: {
      schema: 'xhsStoreAccountBindingsV1',
      schemaVersion: 1,
      stores: {
        'fictional-store-binding': {
          platforms: { adstar: ['adstar:fictional-real-member'] },
          updatedAt: '2033-03-31T16:00:00.000Z',
        },
      },
    },
    bindings: { adstar: ['adstar:fictional-real-member'] },
    actualIdentities: { adstar: ['adstar:fictional-real-member'] },
    issues: [],
    ready: true,
    changed: true,
  };
  const harness = createRunXhsHarness({
    collectionStatus: 'complete',
    collections: {
      adstar: {
        status: 'complete',
        accountKey: 'fictional-self-asserted-account-key',
        identity: { memberId: 'fictional-real-member' },
      },
    },
    bindingResult,
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

  assert.equal(harness.bindingInputs.length, 1, 'must call XhsBindings.reconcileStoreBindings');
  assert.ok(harness.storageReads.some((key) => JSON.stringify(key).includes('xhsStoreAccountBindingsV1')));
  assert.ok(harness.storageWrites.some((value) => value.xhsStoreAccountBindingsV1));
  assert.deepEqual(harness.analysisInputs[0].accountBindings, bindingResult.bindings);
  assert.doesNotMatch(
    JSON.stringify(harness.analysisInputs[0].accountBindings),
    /fictional-self-asserted-account-key/,
  );
});

test('background and cloud ZIP load XhsBindings before analysis', () => {
  const imports = block(backgroundSource, 'importScripts(', ');');
  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');

  assert.match(imports, /['"]xhs\/bindings\.js['"]/);
  assert.ok(
    imports.indexOf('xhs/bindings.js') < imports.indexOf('xhs/analysis.js'),
    'XhsBindings must load before XhsAnalysis',
  );
  assert.match(sync, /['"]xhs\/bindings\.js['"]/);
  assert.match(backgroundSource, /['"]xhsStoreAccountBindingsV1['"]/);
  assert.match(runXhsSource, /XhsBindings\.reconcileStoreBindings\s*\(/);
  assert.doesNotMatch(
    runXhsSource,
    /accountBindings\s*\[\s*platform\s*\]\s*=\s*collections\s*\[\s*platform\s*\]\.accountKey/,
  );
});
