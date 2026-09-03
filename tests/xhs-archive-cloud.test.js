const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const XHS_ANALYSIS_KEY = 'xhsAnalysisSnapshotV1';
const XHS_STATUS_KEY = 'xhsCollectionStatusV1';
const XHS_COMMENT_SUMMARY_KEY = 'xhsCommentInsightSummaryV1';
const XHS_KEYS = Object.freeze([XHS_ANALYSIS_KEY, XHS_STATUS_KEY]);
const MAX_XHS_BYTES = 8 * 1024 * 1024;
const MAX_RUN_BYTES = 24 * 1024 * 1024;
const FIXTURE_TIME = Date.parse('2030-03-01T00:00:00.000Z');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function clone(value) {
  return structuredClone(value);
}

function assertContains(source, pattern, message) {
  assert.ok(pattern.test(source), message || `missing ${pattern}`);
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

function fictionalAccount() {
  return {
    id: 'fictional-account-archive-001',
    name: '虚构归档账号',
    platform: 'taobao',
    storeId: 'fictional-store-archive-001',
    storeName: '虚构归档店铺',
    usernameMasked: 'fi***al',
    roleKeyword: '虚构品牌',
    accountGroupId: 'fictional-account-group-001',
    accountGroupName: '虚构账号组',
    storeGroupId: 'fictional-store-group-001',
    storeGroupName: '虚构店铺组',
  };
}

function fictionalAnalysisSnapshot(overrides = {}) {
  return Object.assign({
    schema: XHS_ANALYSIS_KEY,
    schemaVersion: 1,
    runId: 'fictional-xhs-collection-001',
    generatedAt: '2030-03-01T00:10:00.000Z',
    dateRange: {
      from: '2030-02-01',
      to: '2030-02-28',
      timezone: 'Asia/Shanghai',
    },
    accounts: {
      adstar: { accountKeys: ['fictional-adstar-account'] },
      pgy: { accountKeys: ['fictional-pgy-account'] },
      juguang: { accountKeys: ['fictional-juguang-account'] },
    },
    management: {
      noteCount: 1,
      costs: { partnership: 120, juguang: 80, total: 200 },
    },
    quality: { decisionReady: true, issues: [] },
    notes: [{ noteId: 'fictional-note-archive-001', costs: { total: 200 } }],
  }, overrides);
}

function fictionalCollectionStatus(overrides = {}) {
  return Object.assign({
    schemaVersion: 1,
    runId: 'fictional-xhs-collection-001',
    status: 'complete',
    updatedAt: '2030-03-01T00:10:00.000Z',
    platforms: {
      adstar: { status: 'complete', collectedAt: '2030-03-01T00:01:00.000Z' },
      pgy: { status: 'complete', collectedAt: '2030-03-01T00:02:00.000Z' },
      juguang: { status: 'verified_no_spend', collectedAt: '2030-03-01T00:03:00.000Z' },
    },
  }, overrides);
}

function baseRun(runId, snapshots) {
  return {
    schema: 2,
    runId,
    batchId: 'fictional-batch-archive-001',
    taskType: 'report',
    runMode: 'current',
    account: fictionalAccount(),
    startedAt: FIXTURE_TIME,
    finishedAt: FIXTURE_TIME + 60_000,
    updatedAt: FIXTURE_TIME + 60_000,
    xinghe: { state: 'ready', noPermission: false },
    status: 'success',
    failures: [],
    snapshots: snapshots || {},
  };
}

function legacyTaobaoRun(runId = 'store-run-fictional-legacy-taobao-001') {
  return baseRun(runId, {
    businessDefenseSycmTrafficSnapshotV1: {
      savedAt: FIXTURE_TIME,
      storeVisitors: 321,
      shortVideoVisitors: 123,
    },
    gh_channel_snapshot: {
      ts: FIXTURE_TIME,
      rows: [{ channel: '全部', assetCode: 'self', publishedContents: 7 }],
    },
    taobaoContentDiagnosisReportV1: {
      runId: 'fictional-taobao-report-001',
      finishedAt: FIXTURE_TIME,
      results: [],
    },
  });
}

function xhsRun(runId = 'store-run-fictional-xhs-archive-001') {
  return baseRun(runId, {
    [XHS_ANALYSIS_KEY]: fictionalAnalysisSnapshot(),
    [XHS_STATUS_KEY]: fictionalCollectionStatus(),
  });
}

function commentMonitorRun(runId = 'store-run-comment-monitor-fictional-001') {
  const categoryLabels = {
    purchase_motivation: '购买动机',
    product_experience: '产品体验',
    price_promotion: '价格促销',
    fit_compatibility: '规格适配',
    usage_guidance: '使用方法',
    competitor_comparison: '竞品比较',
    shipping_after_sales: '物流售后',
    complaint_risk: '投诉风险',
  };
  const categories = Object.fromEntries(Object.entries(categoryLabels).map(([id, label]) => [
    id,
    {
      label,
      count: id === 'price_promotion' ? 2 : 0,
      evidence: id === 'price_promotion' ? [{
        noteId: 'fictional-note-comment-001',
        commentId: 'fictional-comment-001',
        excerpt: '价格多少?',
      }] : [],
    },
  ]));
  const semanticCategoryCounts = Object.fromEntries(
    [...Object.keys(categoryLabels), 'other'].map((id) => [id, id === 'price_promotion' ? 2 : 0]),
  );
  const run = baseRun(runId, {
    [XHS_COMMENT_SUMMARY_KEY]: {
      schema: 'CommentInsightSummaryV1',
      schemaVersion: 1,
      accountRef: 'a'.repeat(64),
      generatedAt: '2030-03-01T00:10:00.000Z',
      commentCount: 2,
      classifiedCommentCount: 2,
      unclassifiedCommentCount: 0,
      categories,
      noteMetrics: [{
        noteId: 'fictional-note-comment-001',
        title: '虚构评论监测笔记',
        commentCount: 2,
        commentDelta: 1,
        heatScore: 0.8,
      }],
      noteStates: [],
      semantic: {
        status: 'completed', provider: 'qwen', model: 'fictional-model',
        itemCount: 2, classifiedCount: 2, abstainedCount: 0, retryableCount: 0,
        purchaseIntentCount: 1, unresolvedQuestionCount: 1,
        sentimentCounts: { positive: 0, neutral: 2, negative: 0 },
        categoryCounts: semanticCategoryCounts,
      },
    },
  });
  run.schema = 3;
  run.taskType = 'comment_monitor';
  run.account.platform = 'xiaohongshu';
  return run;
}

function searchClassificationArchive() {
  const classification = {
    schema: 'xhsSearchClassificationV2',
    schemaVersion: 2,
    entity: {
      relation: 'generic_category', label: '泛品类', matchedTerm: null,
      source: 'rule', lockedByFact: false,
    },
    topicTags: [{
      id: 'core_category', label: '核心品类', evidence: [], source: 'rule',
    }],
    intents: [{
      id: 'category_exploration', label: '品类探索', isPrimary: true,
      evidence: [], source: 'rule',
    }],
    relevance: { id: 'strong', label: '强相关', source: 'rule' },
    source: 'rule',
    confidenceScore: 0.88,
    needsReview: false,
    reasonCodes: ['RULE_LEGACY_CLASSIFICATION'],
  };
  return {
    schema: 'xhsSearchClassificationArchiveV1',
    schemaVersion: 1,
    status: 'rules_only',
    configRevision: '7',
    profileId: 'home-furnishing-v1',
    engine: {
      rulesetVersion: 'xhs-search-rules-v2', taxonomyVersion: 'xhs-search-taxonomy-v2',
      provider: 'qwen', model: 'qwen3.7-plus-2026-05-26', promptVersion: 'xhs-search-qwen-v1',
    },
    generatedAt: '2030-03-01T00:11:00.000Z',
    entries: [{
      cacheKey: 'xhs-search-classification-v2:0123456789abcdef',
      normalizedKeyword: '护腰床垫',
      scopeKey: 'store:fictional-store-archive-001',
      automatic: classification,
      effective: classification,
      appliedOverrideId: null,
    }],
  };
}

function shardedXhsRun(runId = 'store-run-fictional-xhs-sharded-001') {
  const run = xhsRun(runId);
  const key = 'xhsAnalysisDetailChunkV1:0000';
  run.snapshots[XHS_ANALYSIS_KEY].detailArchive = {
    schema: 'xhsAnalysisDetailManifestV1',
    schemaVersion: 1,
    complete: true,
    chunks: [{ key, index: 0, kind: 'notes', count: 1, bytes: 100, hash: 'fictional' }],
    sections: { notes: { sourceCount: 1, storedCount: 1, omittedCount: 0 } },
  };
  run.snapshots[key] = {
    schema: 'xhsAnalysisDetailChunkV1',
    schemaVersion: 1,
    runId: run.snapshots[XHS_ANALYSIS_KEY].runId,
    index: 0,
    kind: 'notes',
    items: [{ noteId: 'fictional-sharded-note-001' }],
  };
  return run;
}

function createBridgeHarness(initialStorage = {}) {
  const source = read('web-tool-bridge.js');
  const storage = clone(initialStorage);
  const listeners = [];
  const posted = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) { posted.push(message); },
  };
  windowObject.top = windowObject;
  const location = { origin: 'http://127.0.0.1:3400', pathname: '/report-view.html' };
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
          return Object.fromEntries(list.filter((key) => (
            Object.prototype.hasOwnProperty.call(storage, key)
          )).map((key) => [key, storage[key]]));
        },
        async set(patch) { Object.assign(storage, clone(patch)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        },
      },
      onChanged: { addListener() {} },
    },
  };
  const context = vm.createContext({
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
    URL,
    chrome,
    console,
    location,
    window: windowObject,
  });
  vm.runInContext(read('xhs/comment-monitor.js'), context, { filename: 'xhs/comment-monitor.js' });
  vm.runInContext(source, context, { filename: 'web-tool-bridge.js' });

  let sequence = 0;
  async function request(action, payload) {
    const requestId = `fictional-archive-request-${++sequence}`;
    assert.equal(typeof listeners[0], 'function');
    listeners[0]({
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      const response = posted.find((item) => item.requestId === requestId);
      if (response) return response;
    }
    assert.fail(`bridge response timeout for ${action}`);
  }

  return { request, storage };
}

function loadCloudUploadApi() {
  const source = read('web-tool/cloud-sync.js');
  const constants = sourceBlock(source, 'const MAX_API_BYTES', 'const SYNC_KEYS');
  const helpers = sourceBlock(source, 'function isPlainObject', 'function unwrapResponse');
  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Set,
    String,
    URL,
  });
  vm.runInContext(
    constants + '\n' + helpers +
      '\nglobalThis.cloudUploadApi = { sanitizeUploadRun, containsSensitiveRunField };',
    context,
    { filename: 'cloud-sync-upload-policy.js' },
  );
  return context.cloudUploadApi;
}

function loadServerRunApi() {
  const typescript = require(path.join(root, 'cloud-tool', 'node_modules', 'typescript'));
  const source = read('cloud-tool/app/server/runs.ts');
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: 'runs.ts',
  }).outputText;
  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  const moduleObject = { exports: {} };
  vm.runInNewContext(compiled, {
    Array,
    Date,
    Error,
    JSON,
    Number,
    Object,
    TextEncoder,
    Uint8Array,
    URL,
    crypto: globalThis.crypto,
    exports: moduleObject.exports,
    module: moduleObject,
    require(identifier) {
      if (identifier === './http') {
        return {
          ApiError,
          requireObject(value, message) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              throw new ApiError(400, 'INVALID_BODY', message || 'fixture object required');
            }
            return value;
          },
        };
      }
      throw new Error(`unexpected runs.ts dependency: ${identifier}`);
    },
  }, { filename: 'cloud-tool/app/server/runs.ts' });
  return moduleObject.exports;
}

function jsonResponse(body, status = 200) {
  const text = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return text; },
  };
}

function createCloudEnvironment(options) {
  const source = read('web-tool/cloud-sync.js');
  const listeners = [];
  const posted = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) {
      posted.push(message);
      Promise.resolve().then(() => options.bridge(message)).then((data) => {
        listeners.forEach((listener) => listener({
          source: windowObject,
          origin: options.origin,
          data: {
            channel: 'taobao-full-chain-tool-v1',
            type: 'response',
            requestId: message.requestId,
            ok: true,
            data,
          },
        }));
      }).catch((error) => {
        listeners.forEach((listener) => listener({
          source: windowObject,
          origin: options.origin,
          data: {
            channel: 'taobao-full-chain-tool-v1',
            type: 'response',
            requestId: message.requestId,
            ok: false,
            message: error.message,
          },
        }));
      });
    },
    dispatchEvent() {},
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
  };
  windowObject.top = windowObject;
  const location = {
    origin: options.origin,
    hostname: new URL(options.origin).hostname,
  };
  vm.runInNewContext(source, {
    Array,
    Date,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    URL,
    clearTimeout,
    console,
    fetch: options.fetch,
    location,
    setTimeout,
    window: windowObject,
  }, { filename: 'web-tool/cloud-sync.js' });
  return { windowObject, posted };
}

function createRunSyncScenario({ localRuns, remoteRuns, inspectPost }) {
  const localMap = new Map(localRuns.map((run) => [run.runId, clone(run)]));
  const remoteMap = new Map(remoteRuns.map((run) => [run.runId, clone(run)]));
  const imported = [];
  const uploads = [];
  const runIndex = localRuns.map((run) => ({
    runId: run.runId,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  }));

  const bridge = async (message) => {
    if (message.action === 'ping') return { connected: true, capabilities: ['cloudSync'] };
    if (message.action === 'bindAccountVaultScope') {
      return {
        bound: true,
        vaultScopeId: 'team:https://fictional-cloud.example',
        vaultLockEpoch: 0,
        legacyAvailable: false,
      };
    }
    if (message.action === 'getStorage') {
      return message.payload.keys.includes('taobaoStoreRunIndexV1')
        ? { taobaoStoreRunIndexV1: runIndex }
        : {};
    }
    if (message.action === 'listStoreRuns') return { runs: runIndex };
    if (message.action === 'getStoreRun') return { run: clone(localMap.get(message.payload.runId)) };
    if (message.action === 'importStoreRun') {
      const run = clone(message.payload.run);
      imported.push(run);
      localMap.set(run.runId, run);
      return { imported: true, runId: run.runId };
    }
    throw new Error(`unexpected fictional bridge action: ${message.action}`);
  };

  const fetch = async (input, init) => {
    const url = new URL(input);
    const method = init && init.method || 'GET';
    if (url.pathname === '/api/session') {
      return jsonResponse({
        role: 'owner',
        permissions: {
          canReadVault: true,
          canWriteVault: true,
          canWriteDirectory: true,
          canWriteRuns: true,
          canReadRuns: true,
        },
      });
    }
    if (url.pathname === '/api/vault' && method === 'GET') {
      return jsonResponse({ vault: null, revision: 0 });
    }
    if (url.pathname === '/api/directory' && method === 'GET') {
      return jsonResponse({ directory: null, revision: 0 });
    }
    if (url.pathname === '/api/runs' && method === 'GET') {
      return jsonResponse({
        runs: Array.from(remoteMap.values(), (run) => ({
          runId: run.runId,
          finishedAt: run.finishedAt,
          updatedAt: run.updatedAt,
        })),
      });
    }
    if (url.pathname === '/api/runs' && method === 'POST') {
      const body = JSON.parse(init.body);
      if (inspectPost) inspectPost(body, init.body);
      uploads.push(body.run);
      remoteMap.set(body.run.runId, clone(body.run));
      return jsonResponse({ stored: true }, 201);
    }
    if (url.pathname.startsWith('/api/runs/') && method === 'GET') {
      const runId = decodeURIComponent(url.pathname.slice('/api/runs/'.length));
      return remoteMap.has(runId)
        ? jsonResponse({ run: clone(remoteMap.get(runId)) })
        : jsonResponse({ message: 'fictional run not found' }, 404);
    }
    return jsonResponse({ message: `unexpected fictional endpoint ${method} ${url.pathname}` }, 404);
  };

  return { bridge, fetch, imported, uploads, localMap, remoteMap };
}

function zipEntryNames(bytes) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

test('account archives and bridge allowlists include compact XHS snapshots but never raw run/cache state', () => {
  const background = read('background.js');
  const bridge = read('web-tool-bridge.js');
  const accountKeys = sourceBlock(
    background,
    'const ACCOUNT_RUN_SNAPSHOT_KEYS = [',
    '\n\nasync function clearAccountRunSnapshots',
  );
  const archiveKeys = sourceBlock(bridge, 'const ARCHIVE_SNAPSHOT_KEYS = new Set([', 'const TEAM_DASHBOARD_ORIGINS');
  const readableKeys = sourceBlock(bridge, 'const READABLE_KEYS = new Set([', 'const CLEARABLE_KEYS');
  const clearableKeys = sourceBlock(bridge, 'const CLEARABLE_KEYS = new Set([', 'const MANUAL_KEYS');

  for (const key of XHS_KEYS) {
    assertContains(accountKeys, new RegExp(`['"]${key}['"]`), `${key} account archive`);
    assertContains(archiveKeys, new RegExp(`['"]${key}['"]`), `${key} bridge archive`);
    assertContains(readableKeys, new RegExp(`['"]${key}['"]`), `${key} bridge read`);
    assertContains(clearableKeys, new RegExp(`['"]${key}['"]`), `${key} bridge clear`);
  }
  for (const forbidden of ['xhsCollectionRunV1:', 'indexedDB', 'checkpoint', 'rawPages']) {
    assert.equal(accountKeys.includes(forbidden), false, `${forbidden} must stay out of account archives`);
  }
});

test('bridge get/import preserves legacy Taobao archives and opens compact XHS archives', async () => {
  const legacy = legacyTaobaoRun();
  const xhs = xhsRun();
  const harness = createBridgeHarness({
    [`taobaoStoreRunV1:${legacy.runId}`]: legacy,
    [`taobaoStoreRunV1:${xhs.runId}`]: xhs,
  });

  const legacyResponse = await harness.request('getStoreRun', { runId: legacy.runId });
  const xhsResponse = await harness.request('getStoreRun', { runId: xhs.runId });
  assert.equal(legacyResponse.ok, true, legacyResponse.message);
  assert.deepEqual(JSON.parse(JSON.stringify(legacyResponse.data.run)), legacy);
  assert.equal(xhsResponse.ok, true, xhsResponse.message);
  assert.deepEqual(JSON.parse(JSON.stringify(xhsResponse.data.run)), xhs);

  const importedId = 'store-run-fictional-xhs-import-001';
  const importedRun = xhsRun(importedId);
  const imported = await harness.request('importStoreRun', { runId: importedId, run: importedRun });
  assert.equal(imported.ok, true, imported.message);
  assert.deepEqual(
    Object.keys(harness.storage[`taobaoStoreRunV1:${importedId}`].snapshots).sort(),
    [...XHS_KEYS].sort(),
  );
});

test('comment monitor archives import safely and report restore never replaces the live comment account', async () => {
  const run = commentMonitorRun();
  const commentModel = require('../xhs/comment-monitor');
  assert.deepEqual(
    commentModel.sanitizeCommentInsightSummaryForArchive(
      run.snapshots[XHS_COMMENT_SUMMARY_KEY],
      { accountRef: 'a'.repeat(64) },
    ),
    run.snapshots[XHS_COMMENT_SUMMARY_KEY],
    'the safe archive fixture must already be in the canonical deidentified schema',
  );
  const liveSummary = { schema: 'CommentInsightSummaryV1', accountRef: 'live-account' };
  const liveSearch = fictionalAnalysisSnapshot({ runId: 'live-search-run' });
  const harness = createBridgeHarness({
    xhsCommentInsightSummaryV1: liveSummary,
    xhsAnalysisSnapshotV1: liveSearch,
  });

  const imported = await harness.request('importStoreRun', { runId: run.runId, run });
  const restored = await harness.request('restoreStoreRun', { runId: run.runId });

  assert.equal(imported.ok, true, imported.message);
  assert.equal(restored.ok, false);
  assert.match(restored.message, /评论监测|不能恢复|独立/i);
  assert.equal(harness.storage[`taobaoStoreRunV1:${run.runId}`].taskType, 'comment_monitor');
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.storage.xhsCommentInsightSummaryV1)),
    liveSummary,
    'switching ordinary project history must not overwrite the live comment dashboard',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.storage.xhsAnalysisSnapshotV1)),
    liveSearch,
    'a comment history restore request must not clear the independent live search snapshot',
  );
});

test('comment monitor archive boundaries reject re-keyed raw comments and mixed run payloads', async () => {
  const cloudApi = loadCloudUploadApi();
  const serverApi = loadServerRunApi();
  const fixtures = [];

  const nestedComments = commentMonitorRun('store-run-comment-monitor-schema-comments');
  nestedComments.snapshots[XHS_COMMENT_SUMMARY_KEY].comments = [{
    content: '完整原始评论',
    author: { nickname: '真实昵称' },
  }];
  fixtures.push(nestedComments);

  const topLevelComments = commentMonitorRun('store-run-comment-monitor-schema-top-level');
  topLevelComments.comments = [{ content: '完整原始评论' }];
  fixtures.push(topLevelComments);

  const mixedSnapshots = commentMonitorRun('store-run-comment-monitor-schema-mixed');
  mixedSnapshots.snapshots[XHS_ANALYSIS_KEY] = fictionalAnalysisSnapshot();
  fixtures.push(mixedSnapshots);

  const unredactedEvidence = commentMonitorRun('store-run-comment-monitor-schema-pii');
  unredactedEvidence.snapshots[XHS_COMMENT_SUMMARY_KEY]
    .categories.price_promotion.evidence[0].excerpt = '请联系 13800138000';
  fixtures.push(unredactedEvidence);

  for (const run of fixtures) {
    assert.throws(
      () => cloudApi.sanitizeUploadRun(run, run.runId),
      /评论监测|schema|结构|字段|快照/i,
    );
    assert.throws(
      () => serverApi.assertRunPayloadSafe(run),
      /评论监测|schema|结构|字段|快照/i,
    );
    const harness = createBridgeHarness();
    const imported = await harness.request('importStoreRun', { runId: run.runId, run });
    assert.equal(imported.ok, false);
    assert.match(imported.message, /评论监测|schema|结构|字段|快照/i);
    assert.equal(harness.storage[`taobaoStoreRunV1:${run.runId}`], undefined);
  }
});

test('detail shard keys survive bridge import/read/clear and both cloud size guards', async () => {
  const run = shardedXhsRun();
  const detailKey = 'xhsAnalysisDetailChunkV1:0000';
  const harness = createBridgeHarness();
  const imported = await harness.request('importStoreRun', { runId: run.runId, run });

  assert.equal(imported.ok, true, imported.message);
  assert.deepEqual(
    harness.storage[`taobaoStoreRunV1:${run.runId}`].snapshots[detailKey],
    run.snapshots[detailKey]
  );

  const liveHarness = createBridgeHarness({
    [XHS_ANALYSIS_KEY]: run.snapshots[XHS_ANALYSIS_KEY],
    [detailKey]: run.snapshots[detailKey],
  });
  const readResponse = await liveHarness.request('getStorage', { keys: [detailKey] });
  assert.equal(readResponse.ok, true, readResponse.message);
  assert.deepEqual(JSON.parse(JSON.stringify(readResponse.data[detailKey])), run.snapshots[detailKey]);
  const clearResponse = await liveHarness.request('clearStorage', { keys: [XHS_ANALYSIS_KEY] });
  assert.equal(clearResponse.ok, true, clearResponse.message);
  assert.equal(liveHarness.storage[XHS_ANALYSIS_KEY], undefined);
  assert.equal(liveHarness.storage[detailKey], undefined);

  assert.deepEqual(loadCloudUploadApi().sanitizeUploadRun(run, run.runId), run);
  assert.doesNotThrow(() => loadServerRunApi().assertRunPayloadSafe(run));

  const oversized = shardedXhsRun('store-run-fictional-xhs-sharded-oversized-001');
  oversized.snapshots[detailKey].oversizedFixture = 'x'.repeat(MAX_XHS_BYTES + 1);
  assert.throws(
    () => loadCloudUploadApi().sanitizeUploadRun(oversized, oversized.runId),
    /8\s*MB|小红书.*超过/i
  );
  assert.throws(
    () => loadServerRunApi().assertRunPayloadSafe(oversized),
    (error) => error && error.code === 'XHS_SNAPSHOT_TOO_LARGE'
  );
});

test('bridge rejects an XHS snapshot at the 8MB gate before the 24MB run gate', async () => {
  const runId = 'store-run-fictional-xhs-eight-mb-001';
  const run = xhsRun(runId);
  run.snapshots[XHS_ANALYSIS_KEY].oversizedFixture = 'x'.repeat(MAX_XHS_BYTES + 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(run), 'utf8') < MAX_RUN_BYTES);
  const harness = createBridgeHarness();
  const response = await harness.request('importStoreRun', { runId, run });

  assert.equal(response.ok, false);
  assert.match(response.message, /8\s*MB|小红书.*超过|XHS.*too large/i);
  assert.equal(harness.storage[`taobaoStoreRunV1:${runId}`], undefined);
});

test('bridge import rejects recursive XHS secrets, raw pages and checkpoint state', async () => {
  const runId = 'store-run-fictional-xhs-unsafe-import-001';
  const run = xhsRun(runId);
  run.snapshots[XHS_ANALYSIS_KEY].nestedFixture = {
    level: {
      authorization: 'fictional-bridge-authorization',
      rawResponse: { cookie: 'fictional-bridge-cookie' },
      checkpoint: { cacheKey: 'fictional-bridge-cache-key', nextPage: 4 },
      sourceUrl:
        'https://fictional.invalid/note?xsec_token=fictional-bridge-url-secret&sign=fictional-bridge-signature',
    },
  };
  const harness = createBridgeHarness();
  const response = await harness.request('importStoreRun', { runId, run });

  assert.equal(response.ok, false);
  assert.match(response.message, /敏感|secret|credential|raw|checkpoint|原始|断点|不应导入/i);
  assert.equal(harness.storage[`taobaoStoreRunV1:${runId}`], undefined);
});

test('all archive guards reject alternate credential, signature and raw-state spellings', async () => {
  const cloudApi = loadCloudUploadApi();
  const serverApi = loadServerRunApi();
  const unsafeFixtures = [
    { apiToken: 'fictional-alternate-api-token' },
    { credential: 'fictional-alternate-credential' },
    { tokenValue: 'fictional-token-value' },
    { cookieHeader: 'fictional-cookie-header' },
    { signatureValue: 'fictional-signature-value' },
    { passwordHash: 'fictional-password-hash' },
    { secretValue: 'fictional-secret-value' },
    { message: 'request failed; Authorization: Bearer fictional-bearer-credential' },
    { reportUrl: 'https://fictional-user:fictional-password@fictional.invalid/report?noteId=fictional-note' },
    { reportUrl: 'https://ad.xiaohongshu.com/fictional?x-s=fictional-xs-signature&page=1' },
    { reportUrl: 'https://ad.xiaohongshu.com/fictional?x%2Ds=fictional-encoded-signature&page=1' },
    {
      reportUrl:
        'https://fictional.invalid/redirect?target=https%3A%2F%2Fad.xiaohongshu.com%2Ffictional%3Fx%252Ds%3Dfictional-nested-signature',
    },
    { rawData: { marker: 'fictional-raw-data' } },
    { rawBody: { marker: 'fictional-raw-body' } },
  ];

  for (const [index, unsafe] of unsafeFixtures.entries()) {
    const runId = `store-run-fictional-alternate-unsafe-${index}`;
    const run = xhsRun(runId);
    run.snapshots[XHS_ANALYSIS_KEY].nestedFixture = { level: unsafe };

    const harness = createBridgeHarness();
    const response = await harness.request('importStoreRun', { runId, run });
    assert.equal(response.ok, false, `bridge accepted unsafe fixture ${index}`);
    assert.equal(harness.storage[`taobaoStoreRunV1:${runId}`], undefined);
    assert.throws(
      () => cloudApi.sanitizeUploadRun(run, runId),
      /敏感|credential|签名|raw|原始|不应上传/i,
      `cloud upload accepted unsafe fixture ${index}`,
    );
    assert.throws(
      () => serverApi.assertRunPayloadSafe(run),
      /敏感|credential|签名|raw|原始|不应上传/i,
      `server accepted unsafe fixture ${index}`,
    );
  }

  const safeRunId = 'store-run-fictional-safe-secretary-title';
  const safeRun = xhsRun(safeRunId);
  safeRun.snapshots[XHS_ANALYSIS_KEY].notes[0].title =
    'secretary=fictional campaign role; cookie policy and token metrics are safe prose';
  const safeHarness = createBridgeHarness();
  const safeResponse = await safeHarness.request('importStoreRun', { runId: safeRunId, run: safeRun });
  assert.equal(safeResponse.ok, true, safeResponse.message);
  assert.doesNotThrow(() => cloudApi.sanitizeUploadRun(safeRun, safeRunId));
  assert.doesNotThrow(() => serverApi.assertRunPayloadSafe(safeRun));
});

test('archive guards allow only noteId-matched official PGY export noteUrl values', async () => {
  const noteId = 'fictional-note-archive-001';
  const token = 'fictional-pgy-export-token-001';
  const officialUrl =
    `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${token}&xsec_source=pc_pgyexport`;
  const cloudApi = loadCloudUploadApi();
  const serverApi = loadServerRunApi();
  const safeRunId = 'store-run-fictional-pgy-official-link-001';
  const safeRun = xhsRun(safeRunId);
  safeRun.snapshots[XHS_ANALYSIS_KEY].notes[0].noteUrl = officialUrl;
  safeRun.snapshots[XHS_ANALYSIS_KEY].searchKeywords = [{
    keyword: '虚构猫粮推荐',
    notes: [{ noteId, noteUrl: officialUrl }],
  }];

  const safeHarness = createBridgeHarness();
  const safeResponse = await safeHarness.request('importStoreRun', { runId: safeRunId, run: safeRun });
  assert.equal(safeResponse.ok, true, safeResponse.message);
  assert.equal(
    safeHarness.storage[`taobaoStoreRunV1:${safeRunId}`]
      .snapshots[XHS_ANALYSIS_KEY].notes[0].noteUrl,
    officialUrl,
  );
  assert.doesNotThrow(() => cloudApi.sanitizeUploadRun(safeRun, safeRunId));
  assert.doesNotThrow(() => serverApi.assertRunPayloadSafe(safeRun));

  const unsafeFixtures = [
    {
      label: 'mismatched sibling noteId',
      value: { noteId: 'fictional-note-archive-002', noteUrl: officialUrl },
    },
    {
      label: 'signed URL outside noteUrl',
      value: { noteId, sourceUrl: officialUrl },
    },
    {
      label: 'missing sibling noteId',
      value: { noteUrl: officialUrl },
    },
    {
      label: 'wrong URL noteId',
      value: {
        noteId,
        noteUrl: officialUrl.replace(`/explore/${noteId}`, '/explore/fictional-note-archive-002'),
      },
    },
    {
      label: 'wrong export source',
      value: { noteId, noteUrl: officialUrl.replace('pc_pgyexport', 'pc_search') },
    },
    {
      label: 'extra query parameter',
      value: { noteId, noteUrl: `${officialUrl}&redirect=1` },
    },
    {
      label: 'duplicate token parameter',
      value: {
        noteId,
        noteUrl: officialUrl.replace('&xsec_source=', `&xsec_token=${token}&xsec_source=`),
      },
    },
    {
      label: 'reordered parameters',
      value: {
        noteId,
        noteUrl:
          `https://www.xiaohongshu.com/explore/${noteId}?xsec_source=pc_pgyexport&xsec_token=${token}`,
      },
    },
    {
      label: 'non-official host',
      value: { noteId, noteUrl: officialUrl.replace('www.xiaohongshu.com', 'www.xiaohongshu.com.invalid') },
    },
    {
      label: 'non-default port',
      value: { noteId, noteUrl: officialUrl.replace('www.xiaohongshu.com', 'www.xiaohongshu.com:8443') },
    },
    {
      label: 'trailing path slash',
      value: { noteId, noteUrl: officialUrl.replace(`/${noteId}?`, `/${noteId}/?`) },
    },
    {
      label: 'additional sensitive sibling',
      value: { noteId, noteUrl: officialUrl, accessToken: 'fictional-other-secret' },
    },
  ];

  for (const [index, fixture] of unsafeFixtures.entries()) {
    const runId = `store-run-fictional-pgy-link-rejected-${index}`;
    const run = xhsRun(runId);
    run.snapshots[XHS_ANALYSIS_KEY].nestedFixture = { level: fixture.value };
    const harness = createBridgeHarness();
    const response = await harness.request('importStoreRun', { runId, run });
    assert.equal(response.ok, false, `bridge accepted ${fixture.label}`);
    assert.equal(harness.storage[`taobaoStoreRunV1:${runId}`], undefined);
    assert.throws(
      () => cloudApi.sanitizeUploadRun(run, runId),
      /sensitive|credential|token|敏感|签名|不应上传/i,
      `cloud upload accepted ${fixture.label}`,
    );
    assert.throws(
      () => serverApi.assertRunPayloadSafe(run),
      /sensitive|credential|token|敏感|签名/i,
      `server accepted ${fixture.label}`,
    );
  }
});

test('bridge keeps the independent 24MB whole-run gate', async () => {
  const runId = 'store-run-fictional-whole-run-too-large-001';
  const run = legacyTaobaoRun(runId);
  run.snapshots.gh_channel_snapshot.fixturePadding = 'x'.repeat(MAX_RUN_BYTES + 1024);
  const harness = createBridgeHarness();
  const response = await harness.request('importStoreRun', { runId, run });

  assert.equal(response.ok, false);
  assert.match(response.message, /24\s*MB|安全限制/);
  assert.equal(harness.storage[`taobaoStoreRunV1:${runId}`], undefined);
});

test('cloud upload policy accepts safe legacy and XHS runs and enforces both size gates', () => {
  const api = loadCloudUploadApi();
  const legacy = legacyTaobaoRun();
  const xhs = xhsRun();
  assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeUploadRun(legacy, legacy.runId))), legacy);
  assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeUploadRun(xhs, xhs.runId))), xhs);
  const comments = commentMonitorRun();
  assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeUploadRun(comments, comments.runId))), comments);

  const oversizedXhs = xhsRun('store-run-fictional-cloud-xhs-eight-mb-001');
  oversizedXhs.snapshots[XHS_ANALYSIS_KEY].fixturePadding = 'x'.repeat(MAX_XHS_BYTES + 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedXhs), 'utf8') < MAX_RUN_BYTES);
  assert.throws(
    () => api.sanitizeUploadRun(oversizedXhs, oversizedXhs.runId),
    /8\s*MB|小红书.*超过|XHS.*too large/i,
  );

  const oversizedRun = legacyTaobaoRun('store-run-fictional-cloud-24-mb-001');
  oversizedRun.snapshots.gh_channel_snapshot.fixturePadding = 'x'.repeat(MAX_RUN_BYTES + 1024);
  assert.throws(
    () => api.sanitizeUploadRun(oversizedRun, oversizedRun.runId),
    /24\s*MB|安全限制/,
  );
});

test('comment monitor archives round-trip through cloud while raw and checkpoint state remains blocked', async () => {
  const local = commentMonitorRun('store-run-comment-monitor-local-001');
  const remote = commentMonitorRun('store-run-comment-monitor-remote-001');
  remote.updatedAt += 120_000;
  remote.finishedAt += 120_000;
  const scenario = createRunSyncScenario({ localRuns: [local], remoteRuns: [remote] });
  const environment = createCloudEnvironment({
    origin: 'https://fictional-cloud.example',
    bridge: scenario.bridge,
    fetch: scenario.fetch,
  });

  const result = await environment.windowObject.TaobaoCloudSync.ready;
  environment.windowObject.TaobaoCloudSync.stop();

  assert.equal(result.ok, true, result.message);
  assert.equal(scenario.uploads.length, 1);
  assert.deepEqual(Object.keys(scenario.uploads[0].snapshots), [XHS_COMMENT_SUMMARY_KEY]);
  assert.equal(scenario.imported.length, 1);
  assert.equal(scenario.imported[0].taskType, 'comment_monitor');

  for (const [index, unsafe] of [
    { raw: [{ content: 'must-stay-local' }] },
    { checkpoint: { cursor: 'must-stay-local' } },
    { pages: [{ commentId: 'must-stay-local' }] },
  ].entries()) {
    const run = commentMonitorRun(`store-run-comment-monitor-unsafe-${index}`);
    run.snapshots[XHS_COMMENT_SUMMARY_KEY].unsafe = unsafe;
    assert.throws(
      () => loadCloudUploadApi().sanitizeUploadRun(run, run.runId),
      /raw|checkpoint|page|cache|原始|分页|不应上传|schema|结构/i,
    );
    assert.throws(
      () => loadServerRunApi().assertRunPayloadSafe(run),
      /raw|checkpoint|page|cache|原始|分页|不应上传|schema|结构/i,
    );
  }
});

test('cloud upload policy recursively rejects credentials and signed URL parameters', () => {
  const api = loadCloudUploadApi();
  const unsafeFixtures = [
    { authorization: 'fictional-authorization-must-not-upload' },
    { cookie: 'fictional-cookie-must-not-upload' },
    { token: 'fictional-token-must-not-upload' },
    { accessToken: 'fictional-access-token-must-not-upload' },
    { refresh_token: 'fictional-refresh-token-must-not-upload' },
    { signature: 'fictional-signature-must-not-upload' },
    { secret: 'fictional-secret-must-not-upload' },
    {
      diagnosticUrl:
        'https://fictional.invalid/report?noteId=fictional-note&xsec_token=fictional-url-secret&sign=fictional-signature',
    },
  ];
  for (const [index, unsafe] of unsafeFixtures.entries()) {
    const run = xhsRun(`store-run-fictional-cloud-secret-${index}`);
    run.snapshots[XHS_STATUS_KEY].platforms.pgy.nested = { level: { unsafe } };
    assert.throws(
      () => api.sanitizeUploadRun(run, run.runId),
      /敏感|secret|credential|token|cookie|签名|不应上传/i,
      `unsafe fixture ${index}`,
    );
  }
});

test('cloud upload policy rejects raw pages and checkpoint metadata inside XHS snapshots', () => {
  const api = loadCloudUploadApi();
  for (const [index, unsafe] of [
    { raw: { body: 'fictional-raw-page-must-not-upload' } },
    { rawResponse: { rows: ['fictional-raw-response-must-not-upload'] } },
    { checkpoint: { nextPage: 7, cacheKey: 'fictional-cache-key' } },
    { checkpoints: [{ page: 2, fingerprint: 'fictional-fingerprint' }] },
    { pages: [{ marker: 'fictional-indexed-page' }] },
  ].entries()) {
    const run = xhsRun(`store-run-fictional-cloud-raw-${index}`);
    run.snapshots[XHS_ANALYSIS_KEY].nestedFixture = { level: unsafe };
    assert.throws(
      () => api.sanitizeUploadRun(run, run.runId),
      /raw|checkpoint|page|cache|原始|断点|分页|不应上传/i,
      `raw/checkpoint fixture ${index}`,
    );
  }
});

test('classification archive permits only its compact schema-scoped hash cache key', async () => {
  const run = xhsRun('store-run-fictional-classification-cache-001');
  run.snapshots[XHS_ANALYSIS_KEY].pgy = {
    searchClassification: searchClassificationArchive(),
  };
  const cloudApi = loadCloudUploadApi();
  const serverApi = loadServerRunApi();
  assert.doesNotThrow(() => cloudApi.sanitizeUploadRun(run, run.runId));
  assert.doesNotThrow(() => serverApi.assertRunPayloadSafe(run));
  const bridge = createBridgeHarness();
  const imported = await bridge.request('importStoreRun', { runId: run.runId, run });
  assert.equal(imported.ok, true, imported.message);

  for (const [index, mutate] of [
    (snapshot) => { snapshot.nestedFixture = { cacheKey: 'xhs-search-classification-v2:0123456789abcdef' }; },
    (snapshot) => {
      snapshot.pgy.searchClassification.entries[0].cacheKey = 'fictional-raw-cache-key';
    },
  ].entries()) {
    const unsafe = clone(run);
    unsafe.runId = `store-run-fictional-classification-cache-unsafe-${index}`;
    mutate(unsafe.snapshots[XHS_ANALYSIS_KEY]);
    assert.throws(() => cloudApi.sanitizeUploadRun(unsafe, unsafe.runId), /cache|raw|checkpoint|原始/i);
    assert.throws(() => serverApi.assertRunPayloadSafe(unsafe), /cache|raw|checkpoint|原始/i);
    const rejected = await createBridgeHarness().request('importStoreRun', {
      runId: unsafe.runId,
      run: unsafe,
    });
    assert.equal(rejected.ok, false);
  }
});

test('cloud sync round-trip uploads legacy/XHS archives and imports an XHS archive intact', async () => {
  const legacy = legacyTaobaoRun('store-run-fictional-cloud-legacy-local-001');
  const localXhs = xhsRun('store-run-fictional-cloud-xhs-local-001');
  const remoteXhs = xhsRun('store-run-fictional-cloud-xhs-remote-001');
  remoteXhs.updatedAt += 120_000;
  remoteXhs.finishedAt += 120_000;
  const scenario = createRunSyncScenario({
    localRuns: [legacy, localXhs],
    remoteRuns: [remoteXhs],
  });
  const environment = createCloudEnvironment({
    origin: 'https://fictional-cloud.example',
    bridge: scenario.bridge,
    fetch: scenario.fetch,
  });

  const result = await environment.windowObject.TaobaoCloudSync.ready;
  environment.windowObject.TaobaoCloudSync.stop();
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(JSON.parse(JSON.stringify(result.runs)), { uploaded: 2, downloaded: 1 });
  assert.deepEqual(
    scenario.uploads.map((run) => run.runId).sort(),
    [legacy.runId, localXhs.runId].sort(),
  );
  assert.equal(Object.keys(scenario.uploads.find((run) => run.runId === legacy.runId).snapshots)
    .some((key) => key.startsWith('xhs')), false);
  assert.deepEqual(
    Object.keys(scenario.uploads.find((run) => run.runId === localXhs.runId).snapshots).sort(),
    [...XHS_KEYS].sort(),
  );
  assert.equal(scenario.imported.length, 1);
  assert.equal(scenario.imported[0].runId, remoteXhs.runId);
  assert.deepEqual(Object.keys(scenario.imported[0].snapshots).sort(), [...XHS_KEYS].sort());
});

test('cloud sync never emits a POST when local XHS archive contains secrets/raw/checkpoints', async () => {
  const unsafe = xhsRun('store-run-fictional-cloud-never-upload-001');
  unsafe.snapshots[XHS_ANALYSIS_KEY].nestedFixture = {
    authorization: 'fictional-auth-never-upload',
    rawResponse: { cookie: 'fictional-cookie-never-upload' },
    checkpoint: { cacheKey: 'fictional-cache-never-upload', nextPage: 9 },
    signedUrl:
      'https://fictional.invalid/note?xsec_token=fictional-url-never-upload&signature=fictional-signature-never-upload',
  };
  const postedBodies = [];
  const scenario = createRunSyncScenario({
    localRuns: [unsafe],
    remoteRuns: [],
    inspectPost(_body, serialized) { postedBodies.push(serialized); },
  });
  const environment = createCloudEnvironment({
    origin: 'https://fictional-cloud.example',
    bridge: scenario.bridge,
    fetch: scenario.fetch,
  });

  const result = await environment.windowObject.TaobaoCloudSync.ready;
  environment.windowObject.TaobaoCloudSync.stop();
  assert.equal(result.ok, false);
  assert.match(result.message, /敏感|secret|credential|raw|checkpoint|不应上传/i);
  assert.equal(scenario.uploads.length, 0);
  assert.equal(postedBodies.length, 0);
});

test('cloud server run guard is recursive, size-aware, and accepts legacy/XHS compact archives', () => {
  const server = loadServerRunApi();
  assert.equal(typeof server.assertRunPayloadSafe, 'function', 'runs.ts must export assertRunPayloadSafe');
  assert.doesNotThrow(() => server.assertRunPayloadSafe(legacyTaobaoRun()));
  assert.doesNotThrow(() => server.assertRunPayloadSafe(xhsRun()));

  const oversized = xhsRun('store-run-fictional-server-eight-mb-001');
  oversized.snapshots[XHS_ANALYSIS_KEY].fixturePadding = 'x'.repeat(MAX_XHS_BYTES + 1024);
  assert.throws(
    () => server.assertRunPayloadSafe(oversized),
    /8\s*MB|小红书.*超过|XHS.*too large/i,
  );

  const unsafe = xhsRun('store-run-fictional-server-secret-001');
  unsafe.snapshots[XHS_STATUS_KEY].nestedFixture = {
    level: {
      token: 'fictional-server-token',
      raw: { marker: 'fictional-server-raw' },
      checkpoint: { nextPage: 2 },
    },
  };
  assert.throws(
    () => server.assertRunPayloadSafe(unsafe),
    /敏感|secret|token|raw|checkpoint|原始|断点/i,
  );
});

test('cloud server validates run payloads on both POST import and GET export', () => {
  const runsSource = read('cloud-tool/app/server/runs.ts');
  const postRoute = read('cloud-tool/app/api/runs/route.ts');
  const getRoute = read('cloud-tool/app/api/runs/[id]/route.ts');

  assertContains(runsSource, /export function assertRunPayloadSafe\s*\(/, 'missing exported recursive run guard');
  assertContains(
    runsSource,
    /function extractRunMetadata[\s\S]*?assertRunPayloadSafe\s*\(run\)/,
    'POST metadata extraction must validate the complete run',
  );
  assert.ok(
    postRoute.indexOf('extractRunMetadata(body.run') < postRoute.indexOf('JSON.stringify(body.run)'),
    'server must validate before serializing/storing the run',
  );
  const parsedIndex = getRoute.indexOf('JSON.parse(text)');
  const guardIndex = getRoute.indexOf('assertRunPayloadSafe(run)', parsedIndex);
  const responseIndex = getRoute.indexOf('jsonResponse({ run', parsedIndex);
  assert.ok(parsedIndex >= 0 && guardIndex > parsedIndex && responseIndex > guardIndex,
    'server GET must validate decrypted run before export');
  assertContains(postRoute, /24 \* 1024 \* 1024/, 'server POST must retain the 24MB whole-run gate');
});

test('cloud public assets and generated extension ZIP contain every XHS archive dependency', () => {
  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');
  const requiredZipEntries = [
    'xhs/contract.js',
    'xhs/quality.js',
    'xhs/collector-core.js',
    'xhs/local-cache.js',
    'xhs/page-client.js',
    'xhs/adstar-collector.js',
    'xhs/pgy-collector.js',
    'xhs/juguang-accounts.js',
    'xhs/juguang-collector.js',
    'xhs/runtime.js',
    'xhs/analysis.js',
    'xhs/metrics.js',
  ];
  for (const entry of requiredZipEntries) {
    assertContains(sync, new RegExp(`['"]${entry.replace('/', '\\/')}['"]`), `sync ZIP list ${entry}`);
  }
  assertContains(sync, /['"]xhs-metrics\.js['"]/, 'public XHS mapper manifest');
  assert.equal(read('cloud-tool/public/cloud-sync.js'), read('web-tool/cloud-sync.js'));
  const localMapper = path.join(root, 'xhs', 'metrics.js');
  const publicMapper = path.join(root, 'cloud-tool', 'public', 'xhs-metrics.js');
  assert.ok(fs.existsSync(localMapper), 'local XHS mapper must exist');
  assert.ok(fs.existsSync(publicMapper), 'cloud public XHS mapper must exist');
  assert.equal(fs.readFileSync(publicMapper, 'utf8'), fs.readFileSync(localMapper, 'utf8'));

  const generated = read('cloud-tool/app/server/generated-protected-assets.ts');
  const base64Match = generated.match(/EXTENSION_PACKAGE_BASE64\s*=\s*("[A-Za-z0-9+/=]+")/);
  assert.ok(base64Match, 'generated extension package payload');
  const names = zipEntryNames(Buffer.from(JSON.parse(base64Match[1]), 'base64'));
  for (const entry of requiredZipEntries) {
    assert.ok(names.includes(entry), `generated extension ZIP missing ${entry}`);
  }
});
