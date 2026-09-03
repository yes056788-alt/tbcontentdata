(function initXhsCommentSummaryArchive(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsCommentSummaryArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const STORE_RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const STORE_RUN_KEY_PREFIX = 'taobaoStoreRunV1:';
  const CURRENT_XHS_ANALYSIS_KEY = 'xhsAnalysisSnapshotV1';
  const PROJECT_DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const COMMENT_SUMMARY_KEY = 'xhsCommentInsightSummaryV1';
  const MAX_RUNS = 1000;

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function text(value, maximum) {
    return String(value == null ? '' : value).trim().slice(0, Number(maximum) || 500);
  }

  function validRunId(value) {
    const runId = text(value, 120);
    return /^store-run-[a-z0-9-]+$/i.test(runId) ? runId : '';
  }

  function time(value) {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0 && direct < 4102444800000) return direct;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function freshness(value) {
    const source = object(value);
    return time(source.updatedAt) || time(source.finishedAt) || time(source.startedAt);
  }

  function pgyIdentityToken(accountKey) {
    const value = text(accountKey, 160);
    return value ? `pgy:${value}` : '';
  }

  function analysisMatchesAccount(snapshotValue, accountKey, expectedStoreId) {
    const snapshot = object(snapshotValue);
    const accounts = object(snapshot.accounts);
    const pgy = object(accounts.pgy);
    const token = pgyIdentityToken(accountKey);
    if (snapshot.schema !== CURRENT_XHS_ANALYSIS_KEY || !token ||
        !Array.isArray(pgy.accountKeys) || !pgy.accountKeys.includes(token)) return false;
    const snapshotStoreId = text(snapshot.storeId, 100);
    return !expectedStoreId || !snapshotStoreId || snapshotStoreId === expectedStoreId;
  }

  function safeAccount(value, fallback) {
    const source = object(value);
    const defaults = object(fallback);
    const storeId = text(source.storeId || defaults.storeId, 100);
    const storeName = text(source.storeName || defaults.storeName, 120);
    if (!storeId || !storeName) return null;
    return {
      id: text(source.id, 100) || `comment-monitor-${storeId}`,
      name: text(source.name, 100) || '蒲公英评论监测',
      platform: 'xiaohongshu',
      storeId,
      storeName,
      usernameMasked: text(source.usernameMasked, 240),
      roleKeyword: text(source.roleKeyword, 80),
      accountGroupId: text(source.accountGroupId, 100),
      accountGroupName: text(source.accountGroupName, 100),
      storeGroupId: text(source.storeGroupId || defaults.storeGroupId, 100),
      storeGroupName: text(source.storeGroupName || defaults.storeGroupName, 100),
    };
  }

  function directoryStore(directoryValue, storeId) {
    const directory = object(directoryValue);
    const stores = Array.isArray(directory.stores) ? directory.stores : [];
    const store = stores.find((item) => text(item && item.id, 100) === storeId);
    if (!store) return null;
    const groups = Array.isArray(directory.storeGroups) ? directory.storeGroups : [];
    const groupId = text(store.groupId, 100);
    const group = groups.find((item) => text(item && item.id, 100) === groupId);
    return {
      storeId,
      storeName: text(store.name, 120),
      storeGroupId: groupId,
      storeGroupName: text(group && group.name, 100),
    };
  }

  async function resolveStoreBinding(chromeApi, accountKey) {
    const initial = await chromeApi.storage.local.get([
      STORE_RUN_INDEX_KEY, CURRENT_XHS_ANALYSIS_KEY, PROJECT_DIRECTORY_KEY,
    ]);
    const index = Array.isArray(initial[STORE_RUN_INDEX_KEY])
      ? initial[STORE_RUN_INDEX_KEY].slice(0, MAX_RUNS)
      : [];
    const runIds = Array.from(new Set(index.map((item) => validRunId(item && item.runId))
      .filter(Boolean)));
    const runKeys = runIds.map((runId) => STORE_RUN_KEY_PREFIX + runId);
    const storedRuns = runKeys.length ? await chromeApi.storage.local.get(runKeys) : {};
    const byStore = new Map();

    for (const runId of runIds) {
      const run = object(storedRuns[STORE_RUN_KEY_PREFIX + runId]);
      const account = object(run.account);
      const storeId = text(account.storeId, 100);
      const snapshots = object(run.snapshots);
      if (!storeId || !analysisMatchesAccount(
        snapshots[CURRENT_XHS_ANALYSIS_KEY], accountKey, storeId
      )) continue;
      const safe = safeAccount(account);
      if (!safe) continue;
      const candidate = { storeId, account: safe, sourceRunId: runId, freshness: freshness(run) };
      const previous = byStore.get(storeId);
      if (!previous || candidate.freshness > previous.freshness) byStore.set(storeId, candidate);
    }

    const current = object(initial[CURRENT_XHS_ANALYSIS_KEY]);
    const currentStoreId = text(current.storeId, 100);
    if (currentStoreId && analysisMatchesAccount(current, accountKey, currentStoreId)) {
      const directory = directoryStore(initial[PROJECT_DIRECTORY_KEY], currentStoreId);
      const safe = directory && safeAccount(null, directory);
      if (safe && !byStore.has(currentStoreId)) {
        byStore.set(currentStoreId, {
          storeId: currentStoreId,
          account: safe,
          sourceRunId: text(current.runId, 120),
          freshness: time(current.generatedAt),
        });
      }
    }

    const candidates = Array.from(byStore.values());
    if (!candidates.length) return { status: 'unbound', candidateStoreIds: [] };
    if (candidates.length > 1) {
      return { status: 'ambiguous', candidateStoreIds: candidates.map((item) => item.storeId).sort() };
    }
    return Object.assign({ status: 'bound', candidateStoreIds: [candidates[0].storeId] }, candidates[0]);
  }

  async function resolveSelectedStoreBinding(chromeApi, profileValue) {
    const profile = object(profileValue);
    const storeId = text(profile.storeId, 100);
    if (!storeId) return null;
    const stored = await chromeApi.storage.local.get([PROJECT_DIRECTORY_KEY]);
    const directory = directoryStore(stored[PROJECT_DIRECTORY_KEY], storeId);
    const account = directory && safeAccount(null, directory);
    if (!account) return { status: 'unbound', candidateStoreIds: [] };
    return {
      status: 'bound',
      storeId,
      account,
      sourceRunId: 'comment-monitor-store-selection',
      candidateStoreIds: [storeId],
    };
  }

  async function sha256Hex(value) {
    if (!globalThis.crypto || !globalThis.crypto.subtle || typeof TextEncoder !== 'function') {
      const error = new Error('当前环境不支持脱敏摘要。');
      error.code = 'COMMENT_SUMMARY_HASH_UNAVAILABLE';
      throw error;
    }
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(String(value || ''))
    );
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
  }

  function stableFailures(stateValue) {
    const state = object(stateValue);
    const values = [];
    const append = (value) => {
      const code = text(value, 120).replace(/[^A-Za-z0-9_.:-]/g, '_');
      if (code && !values.includes(code)) values.push(code);
    };
    append(state.errorCode);
    for (const failure of Array.isArray(state.failures) ? state.failures : []) {
      append(failure && failure.code);
      if (values.length >= 100) break;
    }
    return values;
  }

  function indexEntry(record) {
    const account = record.account;
    return {
      runId: record.runId,
      batchId: record.batchId,
      taskType: record.taskType,
      runMode: record.runMode,
      accountId: account.id,
      accountName: account.name,
      storeId: account.storeId,
      storeName: account.storeName,
      usernameMasked: account.usernameMasked,
      accountGroupId: account.accountGroupId,
      accountGroupName: account.accountGroupName,
      storeGroupId: account.storeGroupId,
      storeGroupName: account.storeGroupName,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      updatedAt: record.updatedAt,
      status: record.status,
      failureCount: record.failures.length,
    };
  }

  function createCommentSummaryArchiveService(options) {
    const settings = object(options);
    const chromeApi = settings.chrome;
    const model = settings.model;
    if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
      throw new Error('Comment summary archive requires Chrome local storage.');
    }
    if (!model || typeof model.sanitizeCommentInsightSummaryForArchive !== 'function') {
      throw new Error('Comment summary archive sanitizer is required.');
    }

    async function persist(summary, contextValue) {
      const context = object(contextValue);
      const accountKey = text(context.accountKey, 160);
      const monitorRun = object(context.run);
      const monitorRunId = text(monitorRun.runId, 100);
      const archiveRunId = validRunId(`store-run-${monitorRunId}`);
      if (!accountKey || !archiveRunId) {
        return { archived: false, reason: 'invalid_context' };
      }
      const binding = await resolveSelectedStoreBinding(chromeApi, context.profile) ||
        await resolveStoreBinding(chromeApi, accountKey);
      if (binding.status !== 'bound') {
        return {
          archived: false,
          reason: binding.status,
          candidateStoreCount: binding.candidateStoreIds.length,
        };
      }
      const accountRef = await sha256Hex(
        `comment-summary-v1\u0000${binding.storeId}\u0000${accountKey}`
      );
      const safeSummary = model.sanitizeCommentInsightSummaryForArchive(summary, {
        accountRef,
        bindingSourceRunId: binding.sourceRunId,
      });
      const startedAt = time(monitorRun.startedAt) || time(context.state && context.state.startedAt) || Date.now();
      const finishedAt = Math.max(
        startedAt,
        time(monitorRun.finishedAt) || time(context.state && context.state.finishedAt) || Date.now()
      );
      const failures = stableFailures(context.state);
      const record = {
        schema: 3,
        runId: archiveRunId,
        batchId: monitorRunId,
        taskType: 'comment_monitor',
        runMode: 'current',
        account: binding.account,
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
        xinghe: { state: '', noPermission: false },
        status: context.state && context.state.status === 'completed' ? 'success' : 'partial',
        failures,
        snapshots: { [COMMENT_SUMMARY_KEY]: safeSummary },
      };
      const runKey = STORE_RUN_KEY_PREFIX + archiveRunId;
      const stored = await chromeApi.storage.local.get([runKey, STORE_RUN_INDEX_KEY]);
      if (stored[runKey]) {
        return { archived: true, idempotent: true, runId: archiveRunId, storeId: binding.storeId };
      }
      const index = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
      await chromeApi.storage.local.set({
        [runKey]: record,
        [STORE_RUN_INDEX_KEY]: [indexEntry(record)].concat(index.filter((item) => (
          item && item.runId !== archiveRunId
        ))).slice(0, MAX_RUNS),
      });
      return { archived: true, runId: archiveRunId, storeId: binding.storeId };
    }

    return { persist, resolveStoreBinding: (accountKey) => resolveStoreBinding(chromeApi, accountKey) };
  }

  return Object.freeze({
    STORE_RUN_INDEX_KEY,
    STORE_RUN_KEY_PREFIX,
    CURRENT_XHS_ANALYSIS_KEY,
    COMMENT_SUMMARY_KEY,
    pgyIdentityToken,
    analysisMatchesAccount,
    resolveStoreBinding,
    createCommentSummaryArchiveService,
  });
});
