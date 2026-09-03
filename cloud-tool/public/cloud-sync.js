(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const VAULT_KEY = 'taobaoAccountVaultV1';
  const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const MAX_API_BYTES = 28 * 1024 * 1024;
  const MAX_SESSION_BYTES = 128 * 1024;
  const MAX_RUN_BYTES = 24 * 1024 * 1024;
  const MAX_XHS_SNAPSHOT_BYTES = 8 * 1024 * 1024;
  const XHS_DETAIL_KEY_PREFIX = 'xhsAnalysisDetailChunkV1:';
  const XHS_SNAPSHOT_KEYS = new Set([
    'xhsAnalysisSnapshotV1', 'xhsCollectionStatusV1', 'xhsCommentInsightSummaryV1',
  ]);
  const SENSITIVE_RUN_KEYS = new Set([
    'password', 'masterpassword', 'authorization', 'cookie', 'cookies',
    'token', 'accesstoken', 'refreshtoken', 'signature', 'sign', 'secret',
    'xsectoken', 'tbtoken', 'apikey', 'secretkey', 'sessionid', 'csrftoken',
  ]);
  const FORBIDDEN_XHS_STATE_KEYS = new Set([
    'raw', 'rawresponse', 'rawresponses', 'rawpayload', 'rawpages',
    'checkpoint', 'checkpoints', 'pages', 'cache', 'cachekey', 'fingerprint',
    'indexeddb', 'datasets',
  ]);
  const COMMENT_ARCHIVE_SNAPSHOT_KEY = 'xhsCommentInsightSummaryV1';
  const COMMENT_ARCHIVE_RUN_KEYS = new Set([
    'schema', 'runId', 'batchId', 'taskType', 'runMode', 'account',
    'startedAt', 'finishedAt', 'updatedAt', 'xinghe', 'status', 'failures', 'snapshots',
  ]);
  const COMMENT_ARCHIVE_ACCOUNT_KEYS = new Set([
    'id', 'name', 'platform', 'storeId', 'storeName', 'usernameMasked', 'roleKeyword',
    'accountGroupId', 'accountGroupName', 'storeGroupId', 'storeGroupName',
  ]);
  const COMMENT_ARCHIVE_COUNT_KEYS = new Set([
    'commentCount', 'classifiedCommentCount', 'unclassifiedCommentCount', 'newCommentCount',
    'capturedCommentCount', 'candidateCount', 'completedCount', 'pendingContinuationCount',
    'failureCount', 'noteCount', 'newNoteCount', 'hotNoteCount', 'negativeFeedbackCount',
    'purchaseConcernCount', 'unansweredQuestionCount',
  ]);
  const COMMENT_ARCHIVE_CATEGORY_LABELS = Object.freeze({
    purchase_motivation: '购买动机', product_experience: '产品体验',
    price_promotion: '价格促销', fit_compatibility: '规格适配',
    usage_guidance: '使用方法', competitor_comparison: '竞品比较',
    shipping_after_sales: '物流售后', complaint_risk: '投诉风险',
  });
  const COMMENT_ARCHIVE_METRIC_COUNT_KEYS = new Set([
    'impressionCount', 'commentCount', 'interactionCount', 'readCount',
    'likeCount', 'collectCount', 'shareCount', 'capturedCount',
  ]);
  const COMMENT_ARCHIVE_METRIC_DELTA_KEYS = new Set([
    'commentDelta', 'nonCommentInteractionDelta', 'readDelta',
  ]);
  const COMMENT_ARCHIVE_METRIC_DATE_KEYS = new Set([
    'publishedAt', 'platformUpdatedAt', 'lastCommentCheckedAt', 'capturedAt', 'updatedAt',
  ]);
  const COMMENT_ARCHIVE_CAPTURE_STATUSES = new Set([
    'baseline', 'complete', 'completed', 'continuation', 'failed', 'partial', 'paused',
    'waiting_login', 'waiting_verification', 'needs_login', 'needs_verification',
    'pending', 'running', 'queued',
  ]);
  const COMMENT_ARCHIVE_DISCOVERY_STATUSES = new Set([
    'new_note', 'existing', 'historical_backfill',
  ]);
  const COMMENT_ARCHIVE_REASON_VALUES = new Set([
    'new_note', 'comment_growth', 'hot_top_20pct_due', 'metric_missing',
    'platform_correction', 'continuation',
  ]);
  const COMMENT_ARCHIVE_SEMANTIC_CATEGORY_IDS = Object.freeze([
    ...Object.keys(COMMENT_ARCHIVE_CATEGORY_LABELS), 'other',
  ]);
  const SYNC_KEYS = new Set([VAULT_KEY, DIRECTORY_KEY, RUN_INDEX_KEY]);
  const TEAM_ORIGIN = 'https://tbdata.aizicheng.com';
  const TEAM_VAULT_SCOPE_ID = 'team:https://tbdata.aizicheng.com';
  const TEAM_SESSION_HEARTBEAT_MS = 30000;
  const TEAM_SESSION_HEARTBEAT_TIMEOUT_MS = 8000;
  const TEAM_VAULT_LOCK_RETRY_INITIAL_MS = 1000;
  const TEAM_VAULT_LOCK_RETRY_MAX_MS = 30000;
  const pendingBridgeRequests = new Map();
  const pendingRunDeletions = new Map();
  const state = {
    enabled: false,
    connected: false,
    syncing: false,
    lastSyncedAt: 0,
    lastError: '',
    canDeleteRuns: false,
    permissions: null,
    role: '',
    vaultScopeId: '',
    vaultLockEpoch: 0,
    legacyAvailable: false,
    remoteVaultExists: false,
    remoteVaultRevision: 0,
    remoteVaultDeleted: false,
    conflicts: [],
  };
  let stopped = false;
  let started = false;
  let startPromise = null;
  let syncPromise = null;
  let rerunRequested = false;
  let syncTimer = 0;
  let teamSessionHeartbeatTimer = 0;
  let teamSessionHeartbeatPromise = null;
  let teamSessionHeartbeatController = null;
  let teamSessionHeartbeatRevoked = false;
  let teamVaultLockRetryTimer = 0;
  let teamVaultLockRetryPromise = null;
  let teamVaultLockRetryFailures = 0;
  let vaultAuthEpoch = 0;
  let legacyMigrationPromise = null;
  let vaultMutationPromise = null;
  let appliedVaultTombstoneRevision = -1;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]';
  }

  function commentArchiveHasOnlyKeys(value, allowedKeys) {
    return isPlainObject(value) && Object.keys(value).every((key) => allowedKeys.has(key));
  }

  function commentArchiveText(value, maximum, required) {
    return typeof value === 'string' && value.length <= maximum && (!required || value.length > 0);
  }

  function commentArchiveSafeEvidenceText(value, maximum) {
    const normalized = String(value == null ? '' : value).normalize('NFKC').trim()
      .replace(/\s+/gu, ' ')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[邮箱]')
      .replace(/(^|[^\d])\s*1[3-9]\d{9}(?!\d)/gu, '$1[手机号]')
      .replace(/(^|[^\d])\s*\d{17}[\dXx](?!\d)/gu, '$1[证件号]')
      .replace(/(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*(?:(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*)?[A-Za-z][A-Za-z0-9_-]{5,19}/giu, '[微信号]');
    return Array.from(normalized).slice(0, maximum).join('');
  }

  function commentArchiveCounter(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function commentArchiveTimestamp(value) {
    return commentArchiveText(value, 80, true) && Number.isFinite(Date.parse(value));
  }

  function commentArchiveOptional(value, validator) {
    return value === undefined || validator(value);
  }

  function commentArchiveStringList(value, allowed, maximumItems) {
    return Array.isArray(value) && value.length <= maximumItems &&
      value.every((item) => typeof item === 'string' && allowed.has(item)) &&
      new Set(value).size === value.length;
  }

  function commentArchiveEvidence(value) {
    const allowed = new Set(['excerpt', 'noteId', 'commentId']);
    return commentArchiveHasOnlyKeys(value, allowed) &&
      commentArchiveText(value.excerpt, 160, true) &&
      value.excerpt === commentArchiveSafeEvidenceText(value.excerpt, 160) &&
      commentArchiveOptional(value.noteId, (item) => commentArchiveText(item, 160, true)) &&
      commentArchiveOptional(value.commentId, (item) => commentArchiveText(item, 240, true));
  }

  function commentArchiveCategories(value) {
    const ids = Object.keys(COMMENT_ARCHIVE_CATEGORY_LABELS);
    if (!commentArchiveHasOnlyKeys(value, new Set(ids)) ||
        !ids.every((id) => Object.prototype.hasOwnProperty.call(value, id))) return false;
    let evidenceCount = 0;
    for (const id of ids) {
      const category = value[id];
      if (!commentArchiveHasOnlyKeys(category, new Set(['label', 'count', 'evidence'])) ||
          category.label !== COMMENT_ARCHIVE_CATEGORY_LABELS[id] ||
          !commentArchiveCounter(category.count) || !Array.isArray(category.evidence) ||
          category.evidence.length > 3 || !category.evidence.every(commentArchiveEvidence)) return false;
      evidenceCount += category.evidence.length;
    }
    return evidenceCount <= 24;
  }

  function commentArchiveMetric(value) {
    const allowed = new Set([
      'noteId', 'title', ...COMMENT_ARCHIVE_METRIC_DATE_KEYS,
      ...COMMENT_ARCHIVE_METRIC_COUNT_KEYS, ...COMMENT_ARCHIVE_METRIC_DELTA_KEYS,
      'discovery', 'heatPinned', 'heatTop20', 'heatScore', 'heatPercentiles',
      'corrections', 'missingMetrics', 'reasons', 'captureStatus',
    ]);
    if (!commentArchiveHasOnlyKeys(value, allowed) ||
        !commentArchiveText(value.noteId, 160, true) ||
        !commentArchiveOptional(value.title, (item) => commentArchiveText(item, 500, true))) return false;
    for (const key of COMMENT_ARCHIVE_METRIC_DATE_KEYS) {
      if (!commentArchiveOptional(value[key], commentArchiveTimestamp)) return false;
    }
    for (const key of COMMENT_ARCHIVE_METRIC_COUNT_KEYS) {
      if (!commentArchiveOptional(value[key], commentArchiveCounter)) return false;
    }
    for (const key of COMMENT_ARCHIVE_METRIC_DELTA_KEYS) {
      if (value[key] !== undefined && value[key] !== null && !commentArchiveCounter(value[key])) return false;
    }
    if (!commentArchiveOptional(value.discovery, (item) => COMMENT_ARCHIVE_DISCOVERY_STATUSES.has(item)) ||
        !commentArchiveOptional(value.heatPinned, (item) => typeof item === 'boolean') ||
        !commentArchiveOptional(value.heatTop20, (item) => typeof item === 'boolean') ||
        !commentArchiveOptional(value.heatScore, (item) => commentArchiveCounter(item) && item <= 1) ||
        !commentArchiveOptional(value.captureStatus, (item) => COMMENT_ARCHIVE_CAPTURE_STATUSES.has(item))) return false;
    if (value.heatPercentiles !== undefined) {
      const allowedPercentiles = new Set(['comments', 'nonCommentInteractions', 'reads']);
      if (!commentArchiveHasOnlyKeys(value.heatPercentiles, allowedPercentiles) ||
          !Object.values(value.heatPercentiles).every((item) => commentArchiveCounter(item) && item <= 1)) return false;
    }
    if (!commentArchiveOptional(value.corrections, (item) => commentArchiveStringList(
      item, COMMENT_ARCHIVE_METRIC_COUNT_KEYS, 7
    )) || !commentArchiveOptional(value.missingMetrics, (item) => commentArchiveStringList(
      item, COMMENT_ARCHIVE_METRIC_COUNT_KEYS, 7
    )) || !commentArchiveOptional(value.reasons, (item) => commentArchiveStringList(
      item, COMMENT_ARCHIVE_REASON_VALUES, 6
    ))) return false;
    return true;
  }

  function commentArchiveNoteState(value) {
    const allowed = new Set(['noteId', 'title', 'status', 'capturedCount', 'updatedAt']);
    return commentArchiveHasOnlyKeys(value, allowed) &&
      commentArchiveText(value.noteId, 160, true) &&
      commentArchiveOptional(value.title, (item) => commentArchiveText(item, 500, true)) &&
      commentArchiveOptional(value.status, (item) => COMMENT_ARCHIVE_CAPTURE_STATUSES.has(item)) &&
      commentArchiveOptional(value.capturedCount, commentArchiveCounter) &&
      commentArchiveOptional(value.updatedAt, commentArchiveTimestamp);
  }

  function commentArchiveSemantic(value) {
    const countKeys = new Set([
      'itemCount', 'classifiedCount', 'abstainedCount', 'retryableCount',
      'purchaseIntentCount', 'unresolvedQuestionCount',
    ]);
    const allowed = new Set([
      'status', 'provider', 'model', 'promptVersion', 'taxonomyVersion', 'errorCode',
      ...countKeys, 'sentimentCounts', 'categoryCounts',
    ]);
    if (!commentArchiveHasOnlyKeys(value, allowed)) return false;
    for (const [key, maximum] of Object.entries({
      status: 80, provider: 80, model: 160, promptVersion: 80, taxonomyVersion: 80, errorCode: 120,
    })) {
      if (!commentArchiveOptional(value[key], (item) => commentArchiveText(item, maximum, true))) return false;
    }
    for (const key of countKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || !commentArchiveCounter(value[key])) return false;
    }
    const sentiments = new Set(['positive', 'neutral', 'negative']);
    if (!commentArchiveHasOnlyKeys(value.sentimentCounts, sentiments) ||
        ![...sentiments].every((key) => commentArchiveCounter(value.sentimentCounts[key]))) return false;
    const categories = new Set(COMMENT_ARCHIVE_SEMANTIC_CATEGORY_IDS);
    return commentArchiveHasOnlyKeys(value.categoryCounts, categories) &&
      [...categories].every((key) => commentArchiveCounter(value.categoryCounts[key]));
  }

  function commentArchiveInterval(value) {
    const allowed = new Set(['from', 'to', 'days', 'missedDays', 'dailyAttribution', 'label']);
    return commentArchiveHasOnlyKeys(value, allowed) &&
      commentArchiveOptional(value.from, commentArchiveTimestamp) &&
      commentArchiveOptional(value.to, commentArchiveTimestamp) &&
      commentArchiveOptional(value.days, commentArchiveCounter) &&
      commentArchiveOptional(value.missedDays, commentArchiveCounter) &&
      commentArchiveOptional(value.dailyAttribution, (item) => typeof item === 'boolean') &&
      ['本次更新增量', '自上次成功以来增量'].includes(value.label);
  }

  function validCommentArchiveSummary(value) {
    const allowed = new Set([
      'schema', 'schemaVersion', 'accountRef', 'bindingSourceRunId', 'generatedAt',
      'platformUpdatedAt', 'interval', ...COMMENT_ARCHIVE_COUNT_KEYS,
      'categories', 'noteMetrics', 'noteStates', 'semantic',
    ]);
    if (!commentArchiveHasOnlyKeys(value, allowed) || value.schema !== 'CommentInsightSummaryV1' ||
        value.schemaVersion !== 1 || !/^[0-9a-f]{64}$/u.test(value.accountRef) ||
        !commentArchiveTimestamp(value.generatedAt) || !commentArchiveCategories(value.categories) ||
        !Array.isArray(value.noteMetrics) || value.noteMetrics.length > 2000 ||
        !value.noteMetrics.every(commentArchiveMetric) || !Array.isArray(value.noteStates) ||
        value.noteStates.length > 2000 || !value.noteStates.every(commentArchiveNoteState)) return false;
    if (!commentArchiveOptional(value.bindingSourceRunId, (item) => commentArchiveText(item, 160, true)) ||
        !commentArchiveOptional(value.platformUpdatedAt, commentArchiveTimestamp) ||
        !commentArchiveOptional(value.interval, commentArchiveInterval) ||
        !commentArchiveOptional(value.semantic, commentArchiveSemantic)) return false;
    for (const key of COMMENT_ARCHIVE_COUNT_KEYS) {
      if (!commentArchiveOptional(value[key], commentArchiveCounter)) return false;
    }
    return true;
  }

  function validCommentArchiveRun(value) {
    const snapshots = isPlainObject(value && value.snapshots) ? value.snapshots : {};
    const hasCommentSummary = Object.prototype.hasOwnProperty.call(snapshots, COMMENT_ARCHIVE_SNAPSHOT_KEY);
    if (!value || value.taskType !== 'comment_monitor') return !hasCommentSummary;
    if (!commentArchiveHasOnlyKeys(value, COMMENT_ARCHIVE_RUN_KEYS) || value.schema !== 3 ||
        !/^store-run-[a-z0-9-]+$/iu.test(value.runId || '') ||
        !commentArchiveText(value.batchId, 120, true) || value.runMode !== 'current' ||
        !['success', 'partial'].includes(value.status) ||
        !commentArchiveCounter(value.startedAt) || !commentArchiveCounter(value.finishedAt) ||
        !commentArchiveCounter(value.updatedAt) || value.finishedAt < value.startedAt ||
        value.updatedAt < value.finishedAt) return false;
    if (!commentArchiveHasOnlyKeys(value.account, COMMENT_ARCHIVE_ACCOUNT_KEYS) ||
        value.account.platform !== 'xiaohongshu' ||
        !commentArchiveText(value.account.storeId, 100, true) ||
        !commentArchiveText(value.account.storeName, 120, true) ||
        !Object.values(value.account).every((item) => typeof item === 'string' && item.length <= 240)) return false;
    if (!commentArchiveHasOnlyKeys(value.xinghe, new Set(['state', 'noPermission'])) ||
        !commentArchiveText(value.xinghe.state, 100, false) ||
        typeof value.xinghe.noPermission !== 'boolean' || !Array.isArray(value.failures) ||
        value.failures.length > 100 ||
        !value.failures.every((item) => commentArchiveText(item, 120, true))) return false;
    return Object.keys(snapshots).length === 1 && hasCommentSummary &&
      validCommentArchiveSummary(snapshots[COMMENT_ARCHIVE_SNAPSHOT_KEY]);
  }

  function assertCommentArchiveBoundary(value) {
    if (!validCommentArchiveRun(value)) {
      throw new Error('评论监测归档结构不符合脱敏 schema，已拒绝同步。');
    }
  }

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
  }

  function validBase64(value, maxLength) {
    const text = cleanText(value, maxLength);
    return text && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : '';
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 4102444800000 ? number : 0;
  }

  function revision(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function utf8ByteLength(value, limit) {
    const text = String(value || '');
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
          text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > limit) return bytes;
    }
    return bytes;
  }

  function safeJson(value, maxBytes, label) {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new Error(label + '不是可同步的 JSON 数据。');
    }
    if (!serialized || utf8ByteLength(serialized, maxBytes) > maxBytes) {
      throw new Error(label + '超过 ' + Math.floor(maxBytes / 1024 / 1024) + 'MB 安全限制。');
    }
    return { serialized, value: JSON.parse(serialized) };
  }

  function sanitizeVaultRecord(value) {
    if (!isPlainObject(value)) return null;
    const kdf = isPlainObject(value.kdf) ? value.kdf : {};
    const cipher = isPlainObject(value.cipher) ? value.cipher : {};
    const iterations = Number(kdf.iterations);
    const salt = validBase64(kdf.salt, 200);
    const iv = validBase64(cipher.iv, 200);
    const data = validBase64(cipher.data, 8 * 1024 * 1024);
    if (Number(value.schema) !== 1 || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' ||
        cipher.name !== 'AES-GCM' || !Number.isInteger(iterations) || iterations < 150000 ||
        iterations > 1000000 || !salt || !iv || !data || !timestamp(value.updatedAt)) return null;
    return {
      schema: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
      cipher: { name: 'AES-GCM', iv, data },
      updatedAt: timestamp(value.updatedAt),
    };
  }

  function classificationInteger(value, maxValue) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return Math.min(parsed, maxValue == null ? Number.MAX_SAFE_INTEGER : maxValue);
  }

  function classificationText(value, maxLength) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim().slice(0, maxLength)
      : '';
  }

  function classificationTerms(value, maxItems, maxLength) {
    const seen = new Set();
    const result = [];
    (Array.isArray(value) ? value : []).slice(0, maxItems).some((raw) => {
      const term = classificationText(raw, maxLength);
      const key = term.toLowerCase();
      if (term && !seen.has(key)) {
        seen.add(key);
        result.push(term);
      }
      return result.length >= maxItems;
    });
    return result;
  }

  function highestPriorityClassificationTerm(value, priority) {
    const candidates = classificationTerms(value, 20, 80);
    return priority.find((item) => candidates.includes(item)) || candidates[0] || '';
  }

  function sanitizeClassificationPatch(value, legacy) {
    const patch = isPlainObject(value) ? value : {};
    const old = isPlainObject(legacy) ? legacy : {};
    const topicTagsExplicit = Array.isArray(patch.topicTagIds);
    const entityRelation = classificationText(
      patch.entityRelation == null ? old.commercialCategory : patch.entityRelation,
      80
    );
    const topicTagId = highestPriorityClassificationTerm(
      patch.topicTagIds == null ? old.topicTagIds : patch.topicTagIds,
      [
        'safety_adverse_effect', 'need_pain_point', 'core_category', 'usage_scenario',
        'adjacent_category', 'industry_interest', 'unrelated',
      ]
    );
    const prioritizedIntentId = highestPriorityClassificationTerm(
      patch.intentIds == null ? old.secondaryIntents : patch.intentIds,
      [
        'purchase_decision', 'comparison', 'problem_solving', 'usage',
        'brand_product_lookup', 'category_exploration', 'interest_browsing', 'unclear',
      ]
    );
    let primaryIntentId = classificationText(
      patch.primaryIntentId == null ? (old.primaryIntent || old.intent) : patch.primaryIntentId,
      80
    );
    if (!primaryIntentId) primaryIntentId = prioritizedIntentId;
    const topicTagIds = topicTagId ? [topicTagId] : [];
    const intentIds = primaryIntentId ? [primaryIntentId] : [];
    const relevance = classificationText(
      patch.relevance == null ? old.relevance : patch.relevance,
      80
    );
    return Object.assign(
      {},
      entityRelation ? { entityRelation } : {},
      topicTagIds.length || topicTagsExplicit ? { topicTagIds } : {},
      intentIds.length ? { intentIds } : {},
      primaryIntentId ? { primaryIntentId } : {},
      relevance ? { relevance } : {}
    );
  }

  function sanitizeClassificationOverride(value) {
    const item = isPlainObject(value) ? value : {};
    const keyword = classificationText(item.keyword || item.normalizedKeyword, 160);
    const keywordKey = classificationText(item.keywordKey, 240);
    const normalizedKeyword = classificationText(item.normalizedKeyword, 160);
    const overrideId = classificationText(item.id || keywordKey || normalizedKeyword || keyword, 96);
    if (!overrideId || !keyword) return null;
    return Object.assign({
      id: overrideId,
      scopeKey: classificationText(item.scopeKey, 160),
      keyword,
    }, keywordKey ? { keywordKey } : {}, normalizedKeyword ? { normalizedKeyword } : {}, {
      active: item.active !== false,
      reason: classificationText(item.reason, 160),
      patch: sanitizeClassificationPatch(item.patch, item),
      updatedAt: classificationInteger(item.updatedAt),
    });
  }

  function sanitizeStoreClassification(value) {
    if (!isPlainObject(value) || Number(value.schema) !== 1) return null;
    const overrideIds = new Set();
    const manualOverrides = [];
    (Array.isArray(value.manualOverrides) ? value.manualOverrides : [])
      .slice(0, 500).some((raw) => {
        const item = sanitizeClassificationOverride(raw);
        if (item && !overrideIds.has(item.id)) {
          overrideIds.add(item.id);
          manualOverrides.push(item);
        }
        return manualOverrides.length >= 500;
      });
    return {
      schema: 1,
      profileId: classificationText(value.profileId, 96),
      customIndustry: classificationText(value.customIndustry, 120),
      ownBrandTerms: classificationTerms(value.ownBrandTerms, 200, 64),
      ownProductTerms: classificationTerms(value.ownProductTerms, 200, 64),
      competitorTerms: classificationTerms(value.competitorTerms, 200, 64),
      manualOverrides,
      revision: classificationInteger(value.revision, 2147483647),
      updatedAt: classificationInteger(value.updatedAt),
    };
  }

  function sanitizeDirectory(value) {
    if (!isPlainObject(value) || Number(value.schema) !== 1 || !timestamp(value.updatedAt)) return null;
    const groupIds = new Set();
    const storeGroups = (Array.isArray(value.storeGroups) ? value.storeGroups : []).slice(0, 300).map((raw) => {
      const group = isPlainObject(raw) ? raw : {};
      const id = cleanText(group.id, 100);
      const name = cleanText(group.name, 80);
      if (!id || !name || groupIds.has(id)) return null;
      groupIds.add(id);
      return { id, name };
    }).filter(Boolean);
    const storeIds = new Set();
    const stores = (Array.isArray(value.stores) ? value.stores : []).slice(0, 1000).map((raw) => {
      const store = isPlainObject(raw) ? raw : {};
      const id = cleanText(store.id, 100);
      const name = cleanText(store.name, 120);
      if (!id || !name || storeIds.has(id)) return null;
      storeIds.add(id);
      const classification = sanitizeStoreClassification(store.classification);
      return Object.assign({
        id,
        name,
        groupId: groupIds.has(store.groupId) ? store.groupId : '',
        createdAt: cleanText(store.createdAt, 80),
        updatedAt: cleanText(store.updatedAt, 80),
      }, classification ? { classification } : {});
    }).filter(Boolean);
    return {
      schema: 1,
      storeGroups,
      stores,
      updatedAt: timestamp(value.updatedAt),
    };
  }

  function sanitizeRunId(value) {
    const runId = cleanText(value, 120);
    return /^store-run-[a-z0-9-]+$/i.test(runId) ? runId : '';
  }

  function runFreshness(value) {
    const source = isPlainObject(value) ? value : {};
    return timestamp(source.updatedAt) || timestamp(source.finishedAt) || timestamp(source.startedAt);
  }

  function sanitizeRunMetadata(value) {
    if (!isPlainObject(value)) return null;
    const runId = sanitizeRunId(value.runId);
    if (!runId) return null;
    return {
      runId,
      updatedAt: runFreshness(value),
      finishedAt: timestamp(value.finishedAt),
    };
  }

  function normalizedRunKey(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isSensitiveRunKey(value) {
    const key = normalizedRunKey(value);
    if (SENSITIVE_RUN_KEYS.has(key) || key === 'xs' || key === 'xsign' ||
        key.includes('authorization') || key.includes('credential')) return true;
    const stems = ['token', 'cookie', 'cookies', 'signature', 'password', 'secret'];
    const descriptors = ['', 'value', 'header', 'hash', 'data', 'key', 'param', 'parameter'];
    return stems.some((stem) => descriptors.some((descriptor) => key.endsWith(stem + descriptor)));
  }

  function isForbiddenXhsStateKey(value) {
    const key = normalizedRunKey(value);
    return FORBIDDEN_XHS_STATE_KEYS.has(key) || key.startsWith('raw') ||
      key.startsWith('checkpoint');
  }

  function containsSignedCredentialUrl(value) {
    if (typeof value !== 'string') return false;
    let candidate = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/i.test(candidate)) return true;
      const assignment = /(?:[?&#]|\b)([a-z0-9_.%-]{1,160})["']?\s*[:=]/gi;
      let match;
      while ((match = assignment.exec(candidate))) {
        let key = match[1];
        try { key = decodeURIComponent(key); } catch (error) {}
        if (isSensitiveRunKey(key)) return true;
      }
      let decoded = candidate;
      try { decoded = decodeURIComponent(candidate); } catch (error) {}
      if (decoded === candidate) break;
      candidate = decoded;
    }
    return false;
  }

  function containsUrlControlCharacter(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function isOfficialPgyNoteUrl(value, expectedNoteId) {
    if (typeof value !== 'string' || value !== value.trim() ||
        typeof expectedNoteId !== 'string' || expectedNoteId !== expectedNoteId.trim() ||
        !/^https:\/\/www\.xiaohongshu\.com\/explore\//.test(value) ||
        !/^[a-z0-9_-]{3,128}$/i.test(expectedNoteId) ||
        containsUrlControlCharacter(value)) return false;
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      return false;
    }
    const pathMatch = /^\/explore\/([a-z0-9_-]{3,128})$/i.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port ||
        url.username || url.password || url.hash || !pathMatch || pathMatch[1] !== expectedNoteId) {
      return false;
    }
    const rawQuery = url.search.slice(1);
    const sourceSuffix = '&xsec_source=pc_pgyexport';
    if (!rawQuery.startsWith('xsec_token=') || !rawQuery.endsWith(sourceSuffix) ||
        rawQuery.indexOf('&') !== rawQuery.length - sourceSuffix.length) return false;
    const token = String(url.searchParams.get('xsec_token') || '');
    return token.length >= 8 && token.length <= 2048 && !/\s/.test(token) &&
      !containsUrlControlCharacter(token) &&
      url.searchParams.getAll('xsec_token').length === 1 &&
      url.searchParams.getAll('xsec_source').length === 1;
  }

  function containsSensitiveRunField(value, seen, depth) {
    if (containsSignedCredentialUrl(value)) return true;
    if (!value || typeof value !== 'object') return false;
    if (Number(depth) > 64) return true;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveRunKey(key)) return true;
      if (key === 'noteUrl' && Object.prototype.hasOwnProperty.call(value, 'noteId') &&
          isOfficialPgyNoteUrl(child, value.noteId)) continue;
      if (containsSensitiveRunField(child, visited, Number(depth || 0) + 1)) return true;
    }
    return false;
  }

  function isSafeClassificationArchiveCacheKey(value) {
    return typeof value === 'string' &&
      /^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(value);
  }

  function containsForbiddenXhsState(value, seen, depth, context) {
    if (!value || typeof value !== 'object') return false;
    if (Number(depth) > 64) return true;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) {
      const itemContext = context === 'classificationEntries' ? 'classificationEntry' : '';
      return value.some((child) => containsForbiddenXhsState(
        child, visited, Number(depth || 0) + 1, itemContext
      ));
    }
    const classificationArchive = value.schema === 'xhsSearchClassificationArchiveV1' &&
      Number(value.schemaVersion) === 1 && Array.isArray(value.entries);
    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenXhsStateKey(key)) {
        if (normalizedRunKey(key) === 'cachekey' && context === 'classificationEntry' &&
            isSafeClassificationArchiveCacheKey(child)) continue;
        return true;
      }
      const childContext = classificationArchive && key === 'entries'
        ? 'classificationEntries'
        : '';
      if (containsForbiddenXhsState(
        child, visited, Number(depth || 0) + 1, childContext
      )) return true;
    }
    return false;
  }

  function isXhsDetailSnapshotKey(value) {
    const key = String(value == null ? '' : value);
    return key.startsWith(XHS_DETAIL_KEY_PREFIX) && /^\d{4,6}$/.test(
      key.slice(XHS_DETAIL_KEY_PREFIX.length)
    );
  }

  function assertXhsSnapshotsSafe(snapshots) {
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (!XHS_SNAPSHOT_KEYS.has(key) && !isXhsDetailSnapshotKey(key)) continue;
      let serialized = '';
      try {
        serialized = JSON.stringify(snapshot);
      } catch (error) {
        throw new Error('小红书快照不是可同步的 JSON 数据。');
      }
      if (!serialized || utf8ByteLength(serialized, MAX_XHS_SNAPSHOT_BYTES) >= MAX_XHS_SNAPSHOT_BYTES) {
        throw new Error('小红书快照超过 8MB 安全限制。');
      }
      if (containsForbiddenXhsState(snapshot)) {
        throw new Error('小红书快照包含不应上传的 raw/checkpoint 原始分页状态。');
      }
    }
  }

  function sanitizeUploadRun(value, expectedRunId) {
    if (!isPlainObject(value) || containsSensitiveRunField(value)) {
      throw new Error('本地历史归档无效或包含不应上传的敏感凭据或签名链接。');
    }
    const cloned = safeJson(value, MAX_RUN_BYTES, '本地历史归档').value;
    const runId = sanitizeRunId(cloned.runId);
    if (!runId || runId !== expectedRunId) throw new Error('本地历史归档编号不一致。');
    if (!isPlainObject(cloned.snapshots) || !isPlainObject(cloned.account)) {
      throw new Error('本地历史归档结构无效。');
    }
    assertCommentArchiveBoundary(cloned);
    assertXhsSnapshotsSafe(cloned.snapshots);
    return cloned;
  }

  function unwrapResponse(value) {
    return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  }

  function envelope(value, field) {
    const source = unwrapResponse(value);
    const object = isPlainObject(source) ? source : {};
    const record = Object.prototype.hasOwnProperty.call(object, field)
      ? object[field]
      : (Object.prototype.hasOwnProperty.call(object, 'record') ? object.record : null);
    return {
      record,
      revision: revision(object.revision == null ? object.version : object.revision),
      updatedAt: timestamp(object.updatedAt) || timestamp(record && record.updatedAt),
      deleted: object.deleted === true || object.tombstone === true,
    };
  }

  function emit(type, detail) {
    Object.assign(state, detail || {});
    if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('taobao-cloud-sync', {
        detail: Object.assign({ type }, getState()),
      }));
    }
  }

  function getState() {
    return {
      enabled: state.enabled,
      connected: state.connected,
      syncing: state.syncing,
      lastSyncedAt: state.lastSyncedAt,
      lastError: state.lastError,
      role: state.role,
      vaultScopeId: state.vaultScopeId,
      vaultLockEpoch: state.vaultLockEpoch,
      legacyAvailable: state.legacyAvailable === true,
      remoteVaultExists: state.remoteVaultExists === true,
      remoteVaultRevision: revision(state.remoteVaultRevision),
      remoteVaultDeleted: state.remoteVaultDeleted === true,
      canDeleteRuns: Boolean(state.canDeleteRuns),
      permissions: state.permissions,
      conflicts: state.conflicts.slice(),
    };
  }

  function requestBridge(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'cloud-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pendingBridgeRequests.delete(requestId);
        reject(new Error('云同步连接数据助手超时。'));
      }, Number(timeoutMs) || 30000);
      pendingBridgeRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({
        channel: CHANNEL,
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      }, location.origin);
    });
  }

  async function requestJson(path, options, maxBytes) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error('云同步只允许访问当前站点。');
    const request = Object.assign({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }, options || {});
    request.headers = Object.assign({ Accept: 'application/json' }, request.headers || {});
    if (request.body && typeof request.body !== 'string') {
      const body = safeJson(request.body, maxBytes || MAX_API_BYTES, '云同步请求').serialized;
      request.body = body;
      request.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url.toString(), request);
    const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
    const limit = Number(maxBytes) || MAX_API_BYTES;
    if (declaredLength > limit) throw new Error('云端返回数据超过安全限制。');
    const text = await response.text();
    if (utf8ByteLength(text, limit) > limit) throw new Error('云端返回数据超过安全限制。');
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new Error('云端返回了无效 JSON。');
      }
    }
    if (!response.ok) {
      const nestedError = isPlainObject(body && body.error) ? body.error : {};
      const error = new Error(cleanText(body && (
        body.message || nestedError.message || (typeof body.error === 'string' ? body.error : '')
      ), 500) ||
        ('云同步请求失败（' + response.status + '）。'));
      error.status = response.status;
      error.response = body;
      throw error;
    }
    return body;
  }

  function rolePermissions(sessionValue) {
    const source = unwrapResponse(sessionValue);
    const session = isPlainObject(source) ? source : {};
    const member = isPlainObject(session.member) ? session.member : {};
    const role = cleanText(session.role || member.role || (session.user && session.user.role), 30).toLowerCase();
    if (!['owner', 'admin', 'operator', 'viewer'].includes(role)) {
      throw new Error('当前用户尚未获得网页工具权限。');
    }
    const permissions = isPlainObject(session.permissions) ? session.permissions : {};
    const canDelete = permissions.canDeleteRuns == null ? permissions.deleteRuns : permissions.canDeleteRuns;
    const privileged = role === 'owner' || role === 'admin';
    const operative = privileged || role === 'operator';
    return {
      role,
      canReadVault: permissions.canReadVault == null ? operative : permissions.canReadVault === true,
      canWriteVault: permissions.canWriteVault == null ? privileged : permissions.canWriteVault === true,
      canWriteDirectory: permissions.canWriteDirectory == null ? operative : permissions.canWriteDirectory === true,
      canWriteRuns: permissions.canWriteRuns == null ? operative : permissions.canWriteRuns === true,
      canDeleteRuns: canDelete == null ? privileged : canDelete === true,
      canReadRuns: permissions.canReadRuns !== false,
    };
  }

  function sanitizeVaultScopeId(value) {
    const scopeId = cleanText(value, 220);
    if (!/^(?:team:https:\/\/[a-z0-9.-]+(?::\d+)?|local:[a-z0-9.-]+)$/i.test(scopeId)) {
      throw new Error('账号库工作区范围无效，请刷新页面后重试。');
    }
    return scopeId;
  }

  async function lockAccountVault() {
    vaultAuthEpoch += 1;
    try {
      const response = await requestBridge('lockAccountVault', {}, 10000);
      if (!response || response.ok === false) {
        throw new Error(response && response.message || '账号库会话锁定失败。');
      }
      const vaultLockEpoch = Math.max(0, Number(response.vaultLockEpoch) || 0);
      state.vaultLockEpoch = vaultLockEpoch;
      return { ok: true, locked: true, vaultLockEpoch };
    } finally {
      emit('vault-locked', {
        vaultScopeId: '',
        connected: false,
        syncing: false,
        permissions: null,
        role: '',
        canDeleteRuns: false,
      });
    }
  }

  function clearTeamVaultLockRetryTimer() {
    clearTimeout(teamVaultLockRetryTimer);
    teamVaultLockRetryTimer = 0;
  }

  function scheduleTeamVaultLockRetry() {
    if (stopped || teamVaultLockRetryTimer || teamVaultLockRetryPromise) return;
    const exponent = Math.max(0, Math.min(teamVaultLockRetryFailures - 1, 5));
    const delay = Math.min(
      TEAM_VAULT_LOCK_RETRY_MAX_MS,
      TEAM_VAULT_LOCK_RETRY_INITIAL_MS * Math.pow(2, exponent)
    );
    teamVaultLockRetryTimer = setTimeout(() => {
      teamVaultLockRetryTimer = 0;
      lockRevokedTeamVault().catch(() => {});
    }, delay);
  }

  function lockRevokedTeamVault() {
    if (stopped) return Promise.resolve({ ok: true, skipped: true });
    if (teamVaultLockRetryPromise) return teamVaultLockRetryPromise;
    let locked = false;
    const attempt = lockAccountVault()
      .then((result) => {
        locked = true;
        teamVaultLockRetryFailures = 0;
        clearTeamVaultLockRetryTimer();
        return result;
      })
      .finally(() => {
        if (teamVaultLockRetryPromise === attempt) teamVaultLockRetryPromise = null;
        if (!locked && !stopped) {
          teamVaultLockRetryFailures += 1;
          scheduleTeamVaultLockRetry();
        }
      });
    teamVaultLockRetryPromise = attempt;
    return attempt;
  }

  function assertActiveTeamVaultSession(value) {
    const source = unwrapResponse(value);
    const session = isPlainObject(source) ? source : {};
    const member = isPlainObject(session.member) ? session.member : {};
    const role = cleanText(session.role, 30).toLowerCase();
    const memberRole = cleanText(member.role, 30).toLowerCase();
    const permissions = isPlainObject(session.permissions) ? session.permissions : {};
    if (member.status !== 'active' || session.mustChangePassword !== false ||
        !['owner', 'admin', 'operator'].includes(role) || memberRole !== role ||
        permissions.canReadVault !== true || permissions.canWriteRuns !== true) {
      throw new Error('团队登录或账号库权限已失效。');
    }
    return session;
  }

  function teamSessionHeartbeatEnabled() {
    return !stopped && state.enabled && !teamSessionHeartbeatRevoked &&
      location.origin === TEAM_ORIGIN && state.vaultScopeId === TEAM_VAULT_SCOPE_ID;
  }

  function clearTeamSessionHeartbeatTimer() {
    clearTimeout(teamSessionHeartbeatTimer);
    teamSessionHeartbeatTimer = 0;
  }

  function scheduleTeamSessionHeartbeat() {
    clearTeamSessionHeartbeatTimer();
    if (!teamSessionHeartbeatEnabled()) return;
    teamSessionHeartbeatTimer = setTimeout(() => {
      teamSessionHeartbeatTimer = 0;
      revalidateTeamSession().catch(() => {});
    }, TEAM_SESSION_HEARTBEAT_MS);
  }

  function revalidateTeamSession() {
    if (!teamSessionHeartbeatEnabled()) {
      return Promise.resolve({ ok: true, skipped: true });
    }
    if (teamSessionHeartbeatPromise) return teamSessionHeartbeatPromise;
    teamSessionHeartbeatPromise = (async () => {
      let timeout = 0;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      teamSessionHeartbeatController = controller;
      if (controller) {
        timeout = setTimeout(() => {
          controller.abort(new Error('团队登录状态确认超时。'));
        }, TEAM_SESSION_HEARTBEAT_TIMEOUT_MS);
      }
      try {
        const requestOptions = controller ? { signal: controller.signal } : {};
        assertActiveTeamVaultSession(
          await requestJson('/api/session', requestOptions, MAX_SESSION_BYTES)
        );
        return { ok: true, checkedAt: Date.now() };
      } catch (error) {
        if (stopped) return { ok: true, skipped: true };
        teamSessionHeartbeatRevoked = true;
        clearTeamSessionHeartbeatTimer();
        await lockRevokedTeamVault().catch(() => {});
        throw error;
      } finally {
        clearTimeout(timeout);
        if (teamSessionHeartbeatController === controller) teamSessionHeartbeatController = null;
      }
    })().finally(() => {
      teamSessionHeartbeatPromise = null;
      if (teamSessionHeartbeatEnabled()) scheduleTeamSessionHeartbeat();
    });
    return teamSessionHeartbeatPromise;
  }

  async function guardedRecordSync(config, permissions, conflicts) {
    const stored = await requestBridge('getStorage', { keys: [config.storageKey] }, 30000);
    const local = config.sanitize(stored && stored[config.storageKey]);
    const remoteResponse = await requestJson(config.apiPath);
    const remoteEnvelope = envelope(remoteResponse, config.field);
    if (typeof config.onRemoteEnvelope === 'function') {
      config.onRemoteEnvelope(remoteEnvelope);
    }
    const remote = config.sanitize(remoteEnvelope.record);
    if (remoteEnvelope.deleted) {
      if (remoteEnvelope.record != null) throw new Error('云端' + config.label + '删除标记格式无效。');
      if (typeof config.onRemoteDeleted === 'function') {
        await config.onRemoteDeleted(remoteEnvelope, local);
      }
      return 'deleted';
    }
    if (!remote) {
      if (remoteEnvelope.record != null) throw new Error('云端' + config.label + '格式无效。');
      if (local && config.canWrite(permissions)) {
        try {
          await requestJson(config.apiPath, {
            method: 'PUT',
            body: {
              [config.field]: local,
              expectedRevision: remoteEnvelope.revision,
            },
          });
          return 'uploaded';
        } catch (error) {
          if (error.status !== 409) throw error;
          conflicts.push(config.field + ':remote-created');
          return 'conflict';
        }
      }
      return 'empty';
    }
    if (!local) {
      const setPayload = typeof config.setPayload === 'function'
        ? config.setPayload(remoteEnvelope)
        : (config.setPayload || {});
      await requestBridge(config.setAction, Object.assign(
        { [config.field]: remote },
        setPayload
      ), 45000);
      return 'downloaded';
    }
    const localJson = JSON.stringify(local);
    const remoteJson = JSON.stringify(remote);
    if (localJson === remoteJson) return 'same';
    const localUpdatedAt = timestamp(local.updatedAt);
    const remoteUpdatedAt = timestamp(remote.updatedAt) || remoteEnvelope.updatedAt;
    if (localUpdatedAt > remoteUpdatedAt && config.canWrite(permissions)) {
      try {
        await requestJson(config.apiPath, {
          method: 'PUT',
          body: {
            [config.field]: local,
            expectedRevision: remoteEnvelope.revision,
          },
        });
        return 'uploaded';
      } catch (error) {
        if (error.status !== 409) throw error;
        conflicts.push(config.field + ':revision');
        return 'conflict';
      }
    }
    if (remoteUpdatedAt > localUpdatedAt) {
      const latestStored = await requestBridge('getStorage', { keys: [config.storageKey] }, 30000);
      const latestLocal = config.sanitize(latestStored && latestStored[config.storageKey]);
      if (!latestLocal || JSON.stringify(latestLocal) !== localJson) {
        conflicts.push(config.field + ':local-changed');
        return 'conflict';
      }
      const setPayload = typeof config.setPayload === 'function'
        ? config.setPayload(remoteEnvelope)
        : (config.setPayload || {});
      await requestBridge(config.setAction, Object.assign(
        { [config.field]: remote },
        setPayload
      ), 45000);
      return 'downloaded';
    }
    conflicts.push(config.field + ':same-timestamp');
    return 'conflict';
  }

  function updateRemoteVaultState(remoteEnvelope, legacyAvailable) {
    const remote = sanitizeVaultRecord(remoteEnvelope && remoteEnvelope.record);
    const detail = {
      remoteVaultExists: Boolean(remote),
      remoteVaultRevision: revision(remoteEnvelope && remoteEnvelope.revision),
      remoteVaultDeleted: Boolean(remoteEnvelope && remoteEnvelope.deleted),
    };
    if (legacyAvailable != null) detail.legacyAvailable = legacyAvailable === true;
    Object.assign(state, detail);
    return remote;
  }

  async function applyRemoteVaultTombstone(remoteEnvelope, vaultLockEpoch) {
    const tombstoneRevision = revision(remoteEnvelope && remoteEnvelope.revision);
    if (!remoteEnvelope || remoteEnvelope.deleted !== true || tombstoneRevision < 1) {
      throw new Error('云端账号库删除标记无效。');
    }
    if (appliedVaultTombstoneRevision === tombstoneRevision) {
      return {
        applied: false,
        alreadyApplied: true,
        vaultLockEpoch: state.vaultLockEpoch,
      };
    }
    let response;
    try {
      response = await requestBridge('applyAccountVaultTombstone', {
        vaultLockEpoch,
        revision: tombstoneRevision,
      }, 30000);
    } catch (error) {
      // The server tombstone is already authoritative. Clear page-held
      // plaintext immediately even if the extension bridge needs a later sync
      // to finish deleting its scoped ciphertext/session.
      emit('vault-tombstoned', {
        connected: true,
        remoteVaultExists: false,
        remoteVaultRevision: tombstoneRevision,
        remoteVaultDeleted: true,
      });
      const failure = new Error('团队账号库已在云端删除，但本机锁定尚未完成；请保持页面打开后重试同步。');
      failure.cause = error;
      throw failure;
    }
    if (response && response.stale === true) {
      throw new Error('账号库在应用删除标记时已出现更新版本，请重新同步。');
    }
    if (!response || response.applied !== true) {
      emit('vault-tombstoned', {
        connected: true,
        remoteVaultExists: false,
        remoteVaultRevision: tombstoneRevision,
        remoteVaultDeleted: true,
      });
      throw new Error(response && response.message || '本机账号库删除标记应用失败。');
    }
    const nextEpoch = Number(response.vaultLockEpoch);
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= Number(vaultLockEpoch)) {
      throw new Error('本机账号库锁定版本无效。');
    }
    appliedVaultTombstoneRevision = tombstoneRevision;
    state.vaultLockEpoch = nextEpoch;
    emit('vault-tombstoned', {
      connected: true,
      vaultLockEpoch: nextEpoch,
      remoteVaultExists: false,
      remoteVaultRevision: tombstoneRevision,
      remoteVaultDeleted: true,
    });
    return {
      applied: true,
      vaultLockEpoch: nextEpoch,
      revision: tombstoneRevision,
    };
  }

  async function downloadRemoteVault(remote, vaultLockEpoch, remoteRevision) {
    const safeRemote = sanitizeVaultRecord(remote);
    if (!safeRemote) throw new Error('云端账号库密文格式无效。');
    await requestBridge('setAccountVault', {
      vault: safeRemote,
      vaultLockEpoch,
      remoteRevision: revision(remoteRevision),
      serverConfirmed: true,
    }, 45000);
    return safeRemote;
  }

  async function performLegacyAccountVaultMigration(input) {
    if (!state.enabled || stopped) throw new Error('服务器云同步未启用。');
    const source = isPlainObject(input) ? input : {};
    const fingerprint = cleanText(source.fingerprint, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('旧账号库校验标识无效。');
    const requestedEpoch = Number(source.vaultLockEpoch);
    if (!Number.isSafeInteger(requestedEpoch) || requestedEpoch < 0) {
      throw new Error('账号库锁定版本无效，请刷新后重试。');
    }

    const sessionResponse = await requestJson('/api/session');
    const permissions = rolePermissions(sessionResponse);
    if (!permissions.canReadVault || !permissions.canWriteVault) {
      throw new Error('当前团队角色无权迁移账号库。');
    }
    const binding = await requestBridge('bindAccountVaultScope', {}, 30000);
    const vaultScopeId = sanitizeVaultScopeId(binding && binding.vaultScopeId);
    const vaultLockEpoch = Number(binding && binding.vaultLockEpoch);
    if (vaultScopeId !== 'team:https://tbdata.aizicheng.com') {
      throw new Error('旧账号库只能迁移到已登录的在线团队工作区。');
    }
    if (!Number.isSafeInteger(vaultLockEpoch) || vaultLockEpoch !== requestedEpoch) {
      throw new Error('账号库已在其他页面锁定，请重新验证主密码。');
    }
    if (!binding || binding.legacyAvailable !== true) {
      throw new Error('未找到可迁移的升级前本机账号库。');
    }

    const prepared = await requestBridge('getLegacyAccountVault', {}, 30000);
    const preparedFingerprint = cleanText(prepared && prepared.fingerprint, 64).toLowerCase();
    if (!prepared || prepared.legacyAvailable !== true || preparedFingerprint !== fingerprint ||
        sanitizeVaultScopeId(prepared.vaultScopeId) !== vaultScopeId ||
        Number(prepared.vaultLockEpoch) !== vaultLockEpoch) {
      throw new Error('旧账号库已变化，请重新验证主密码。');
    }
    const legacyVault = sanitizeVaultRecord(prepared.legacyVault);
    if (!legacyVault) throw new Error('旧账号库密文格式无效。');

    const remoteResponse = await requestJson('/api/vault');
    let remoteEnvelope = envelope(remoteResponse, 'vault');
    let remote = updateRemoteVaultState(remoteEnvelope, true);
    if (remoteEnvelope.deleted) {
      throw new Error('团队账号库已删除，禁止用升级前密文覆盖删除标记。');
    }
    if (remoteEnvelope.record != null && !remote) {
      throw new Error('云端账号库密文格式无效。');
    }
    if (remote) {
      await downloadRemoteVault(remote, vaultLockEpoch, remoteEnvelope.revision);
      emit('vault-migration-conflict', {
        connected: true,
        role: permissions.role,
        permissions,
        vaultScopeId,
        vaultLockEpoch,
        legacyAvailable: true,
      });
      return {
        migrated: false,
        reason: 'remote-exists',
        downloaded: true,
        revision: remoteEnvelope.revision,
      };
    }
    if (remoteEnvelope.revision !== 0) {
      throw new Error('云端账号库状态已变化，未执行迁移。');
    }

    let savedResponse;
    try {
      savedResponse = await requestJson('/api/vault', {
        method: 'PUT',
        body: { vault: legacyVault, expectedRevision: 0 },
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const latestResponse = await requestJson('/api/vault');
      remoteEnvelope = envelope(latestResponse, 'vault');
      remote = updateRemoteVaultState(remoteEnvelope, true);
      if (remoteEnvelope.deleted) {
        throw new Error('团队账号库已删除，旧密文已保留在本机。');
      }
      if (remoteEnvelope.record != null && !remote) {
        throw new Error('云端账号库密文格式无效。');
      }
      if (remote) await downloadRemoteVault(remote, vaultLockEpoch, remoteEnvelope.revision);
      scheduleSync(100);
      emit('vault-migration-conflict', {
        connected: true,
        role: permissions.role,
        permissions,
        vaultScopeId,
        vaultLockEpoch,
        legacyAvailable: true,
      });
      return {
        migrated: false,
        reason: 'conflict',
        downloaded: Boolean(remote),
        revision: remoteEnvelope.revision,
      };
    }

    const savedEnvelope = envelope(savedResponse, 'vault');
    const savedVault = updateRemoteVaultState(savedEnvelope, true);
    if (!savedVault || JSON.stringify(savedVault) !== JSON.stringify(legacyVault)) {
      throw new Error('云端未返回本次迁移的完整密文，本机旧库未移动。');
    }
    await requestBridge('commitLegacyAccountVault', {
      fingerprint,
      vaultLockEpoch,
      remoteRevision: savedEnvelope.revision,
      serverConfirmed: true,
    }, 45000);
    emit('vault-migration-complete', {
      connected: true,
      role: permissions.role,
      permissions,
      vaultScopeId,
      vaultLockEpoch,
      legacyAvailable: false,
      remoteVaultExists: true,
      remoteVaultRevision: savedEnvelope.revision,
      remoteVaultDeleted: false,
      lastSyncedAt: Date.now(),
      lastError: '',
    });
    return {
      migrated: true,
      revision: savedEnvelope.revision,
      vaultScopeId,
      vaultLockEpoch,
    };
  }

  function migrateLegacyAccountVault(input) {
    if (legacyMigrationPromise) return legacyMigrationPromise;
    legacyMigrationPromise = runAccountVaultMutation(
      () => performLegacyAccountVaultMigration(input),
    ).finally(() => {
      legacyMigrationPromise = null;
    });
    return legacyMigrationPromise;
  }

  async function prepareAccountVaultMutation() {
    if (!state.enabled || stopped) throw new Error('服务器云同步未启用。');
    const sessionResponse = await requestJson('/api/session');
    const permissions = rolePermissions(sessionResponse);
    if (!permissions.canReadVault || !permissions.canWriteVault ||
        !['owner', 'admin'].includes(permissions.role)) {
      throw new Error('只有团队所有者或管理员可以重置账号库。');
    }
    const binding = await requestBridge('bindAccountVaultScope', {}, 30000);
    const vaultScopeId = sanitizeVaultScopeId(binding && binding.vaultScopeId);
    const vaultLockEpoch = Number(binding && binding.vaultLockEpoch);
    if (!vaultScopeId.startsWith('team:')) {
      throw new Error('当前不是在线团队账号库，不能执行团队重置。');
    }
    if (!Number.isSafeInteger(vaultLockEpoch) || vaultLockEpoch < 0) {
      throw new Error('账号库锁定版本无效，请刷新页面后重试。');
    }
    Object.assign(state, {
      connected: true,
      role: permissions.role,
      permissions,
      vaultScopeId,
      vaultLockEpoch,
    });
    return { permissions, vaultScopeId, vaultLockEpoch };
  }

  function runAccountVaultMutation(operation) {
    if (vaultMutationPromise) {
      return Promise.reject(new Error('另一个账号库重置或重建操作正在进行。'));
    }
    const activeSync = syncPromise;
    const task = (async () => {
      if (activeSync) await activeSync;
      return operation();
    })();
    vaultMutationPromise = task;
    return task.finally(() => {
      if (vaultMutationPromise === task) vaultMutationPromise = null;
      scheduleSync(100);
    });
  }

  function deleteAccountVault() {
    return runAccountVaultMutation(async () => {
      const context = await prepareAccountVaultMutation();
      const currentResponse = await requestJson('/api/vault');
      const currentEnvelope = envelope(currentResponse, 'vault');
      updateRemoteVaultState(currentEnvelope, state.legacyAvailable);
      if (currentEnvelope.record != null && !sanitizeVaultRecord(currentEnvelope.record)) {
        throw new Error('云端账号库密文格式无效。');
      }

      let deletedEnvelope = currentEnvelope;
      if (!currentEnvelope.deleted) {
        let deletedResponse;
        try {
          deletedResponse = await requestJson('/api/vault', {
            method: 'DELETE',
            body: { expectedRevision: currentEnvelope.revision },
          }, 10000);
        } catch (error) {
          if (error && [400, 401, 403, 409, 428].includes(error.status)) throw error;
          try {
            const reconciled = await requestJson('/api/vault');
            const reconciledEnvelope = envelope(reconciled, 'vault');
            if (!reconciledEnvelope.deleted) throw error;
            deletedResponse = reconciled;
          } catch (reconcileError) {
            throw error;
          }
        }
        deletedEnvelope = envelope(deletedResponse, 'vault');
        if (!deletedEnvelope.deleted || deletedEnvelope.revision < 1) {
          throw new Error('服务器未返回有效的账号库删除标记。');
        }
      }

      updateRemoteVaultState(deletedEnvelope, state.legacyAvailable);
      const local = await applyRemoteVaultTombstone(
        deletedEnvelope,
        context.vaultLockEpoch,
      );
      return {
        deleted: true,
        revision: deletedEnvelope.revision,
        vaultScopeId: context.vaultScopeId,
        vaultLockEpoch: local.vaultLockEpoch,
      };
    });
  }

  function recreateAccountVault(value) {
    const vault = sanitizeVaultRecord(value);
    if (!vault) return Promise.reject(new Error('新账号库密文格式无效。'));
    return runAccountVaultMutation(async () => {
      const context = await prepareAccountVaultMutation();
      const currentResponse = await requestJson('/api/vault');
      const currentEnvelope = envelope(currentResponse, 'vault');
      updateRemoteVaultState(currentEnvelope, state.legacyAvailable);
      if (!currentEnvelope.deleted || currentEnvelope.record != null || currentEnvelope.revision < 1) {
        throw new Error('团队账号库当前不是已删除状态，请先同步最新版本。');
      }
      let savedResponse;
      try {
        savedResponse = await requestJson('/api/vault', {
          method: 'PUT',
          body: {
            vault,
            expectedRevision: currentEnvelope.revision,
            recreate: true,
          },
        });
      } catch (error) {
        if (error && [400, 401, 403, 409, 428].includes(error.status)) throw error;
        try {
          const reconciled = await requestJson('/api/vault');
          const reconciledEnvelope = envelope(reconciled, 'vault');
          const reconciledVault = sanitizeVaultRecord(reconciledEnvelope.record);
          if (reconciledEnvelope.deleted || !reconciledVault ||
              JSON.stringify(reconciledVault) !== JSON.stringify(vault) ||
              reconciledEnvelope.revision <= currentEnvelope.revision) {
            throw error;
          }
          savedResponse = reconciled;
        } catch (reconcileError) {
          throw error;
        }
      }
      const savedEnvelope = envelope(savedResponse, 'vault');
      const savedVault = sanitizeVaultRecord(savedEnvelope.record);
      if (savedEnvelope.deleted || !savedVault ||
          JSON.stringify(savedVault) !== JSON.stringify(vault)) {
        throw new Error('服务器未返回本次重建的完整账号库密文。');
      }
      await requestBridge('setAccountVault', {
        vault: savedVault,
        vaultLockEpoch: context.vaultLockEpoch,
        remoteRevision: savedEnvelope.revision,
        serverConfirmed: true,
      }, 45000);
      appliedVaultTombstoneRevision = -1;
      updateRemoteVaultState(savedEnvelope, state.legacyAvailable);
      emit('vault-recreated', {
        connected: true,
        vaultScopeId: context.vaultScopeId,
        vaultLockEpoch: context.vaultLockEpoch,
        remoteVaultExists: true,
        remoteVaultRevision: savedEnvelope.revision,
        remoteVaultDeleted: false,
      });
      return {
        recreated: true,
        vault: savedVault,
        revision: savedEnvelope.revision,
        vaultScopeId: context.vaultScopeId,
        vaultLockEpoch: context.vaultLockEpoch,
      };
    });
  }

  async function syncRuns(permissions, conflicts) {
    if (!permissions.canReadRuns) return { uploaded: 0, downloaded: 0 };
    const localResponse = await requestBridge('listStoreRuns', {}, 30000);
    const allLocalItems = (Array.isArray(localResponse && localResponse.runs) ? localResponse.runs : [])
      .slice(0, 1000).map(sanitizeRunMetadata).filter(Boolean);
    const remoteResponse = unwrapResponse(await requestJson('/api/runs'));
    const remoteArray = Array.isArray(remoteResponse)
      ? remoteResponse
      : (Array.isArray(remoteResponse && remoteResponse.runs) ? remoteResponse.runs
        : (Array.isArray(remoteResponse && remoteResponse.items) ? remoteResponse.items : []));
    const remoteItems = remoteArray.slice(0, 1000).map(sanitizeRunMetadata).filter(Boolean);
    const deletedRunIds = new Set(
      (Array.isArray(remoteResponse && remoteResponse.deletedRunIds)
        ? remoteResponse.deletedRunIds : []).map(sanitizeRunId).filter(Boolean)
    );
    let deleted = 0;
    for (const metadata of allLocalItems) {
      if (!deletedRunIds.has(metadata.runId)) continue;
      await requestBridge('deleteStoreRun', { runId: metadata.runId }, 30000);
      deleted += 1;
    }
    const localItems = allLocalItems.filter((metadata) => !deletedRunIds.has(metadata.runId));
    const localMap = new Map(localItems.map((item) => [item.runId, item]));
    const remoteMap = new Map(remoteItems.map((item) => [item.runId, item]));
    let uploaded = 0;
    let downloaded = 0;
    if (permissions.canWriteRuns) {
      for (const metadata of localItems) {
        if (remoteMap.has(metadata.runId) || pendingRunDeletions.has(metadata.runId)) continue;
        const full = await requestBridge('getStoreRun', { runId: metadata.runId }, 45000);
        if (pendingRunDeletions.has(metadata.runId)) continue;
        if (!full || !full.run) continue;
        const run = sanitizeUploadRun(full.run, metadata.runId);
        try {
          await requestJson('/api/runs', {
            method: 'POST',
            body: { run, metadata, expectedAbsent: true },
          }, MAX_API_BYTES);
          uploaded += 1;
        } catch (error) {
          if (error.status === 410) {
            await requestBridge('deleteStoreRun', { runId: metadata.runId }, 30000);
            deleted += 1;
            continue;
          }
          if (error.status !== 409) throw error;
          conflicts.push('run:' + metadata.runId + ':remote-created');
        }
      }
    }
    for (const metadata of remoteItems) {
      if (localMap.has(metadata.runId) || pendingRunDeletions.has(metadata.runId)) continue;
      const response = unwrapResponse(await requestJson('/api/runs/' + encodeURIComponent(metadata.runId), {}, MAX_API_BYTES));
      if (pendingRunDeletions.has(metadata.runId)) continue;
      const run = isPlainObject(response) && Object.prototype.hasOwnProperty.call(response, 'run')
        ? response.run
        : response;
      if (!isPlainObject(run) || sanitizeRunId(run.runId) !== metadata.runId) {
        throw new Error('云端历史归档编号不一致。');
      }
      const result = await requestBridge('importStoreRun', { runId: metadata.runId, run }, 60000);
      if (result && result.imported) downloaded += 1;
      else if (result && result.reason === 'local-newer-or-equal') {
        conflicts.push('run:' + metadata.runId + ':local-newer');
      }
    }
    return Object.assign({ uploaded, downloaded }, deleted ? { deleted } : {});
  }

  function deleteRun(value) {
    const runId = sanitizeRunId(value);
    if (!runId) return Promise.reject(new Error('店铺归档编号无效。'));
    if (!state.enabled || stopped) return Promise.reject(new Error('服务器云同步未启用。'));
    if (pendingRunDeletions.has(runId)) return pendingRunDeletions.get(runId);

    const operation = (async () => {
      if (!state.permissions || !state.permissions.canDeleteRuns) {
        const sessionResponse = await requestJson('/api/session');
        state.permissions = rolePermissions(sessionResponse);
        state.canDeleteRuns = state.permissions.canDeleteRuns;
      }
      if (!state.permissions.canDeleteRuns) {
        throw new Error('当前账号无权限删除运行记录。');
      }
      if (syncPromise) await syncPromise.catch(() => null);
      try {
        await requestJson('/api/runs/' + encodeURIComponent(runId), { method: 'DELETE' });
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error;
      }
      let localDeleted = true;
      try {
        await requestBridge('deleteStoreRun', { runId }, 30000);
      } catch (error) {
        // The server tombstone is authoritative.  Keeping the remote delete
        // successful prevents a transient extension/bridge failure from
        // making the UI claim that a logically deleted report still exists;
        // the next sync will retry removing the stale local copy.
        localDeleted = false;
      }
      return { deleted: true, runId, localDeleted };
    })().finally(() => {
      pendingRunDeletions.delete(runId);
      scheduleSync(100);
    });
    pendingRunDeletions.set(runId, operation);
    return operation;
  }

  async function performSync() {
    const syncVaultAuthEpoch = vaultAuthEpoch;
    emit('sync-start', { syncing: true, lastError: '', conflicts: [] });
    const conflicts = [];
    try {
      const sessionResponse = await requestJson('/api/session');
      if (syncVaultAuthEpoch !== vaultAuthEpoch) throw new Error('云端登录状态已变化，请重新同步。');
      const permissions = rolePermissions(sessionResponse);
      const binding = await requestBridge('bindAccountVaultScope', {}, 30000);
      const vaultScopeId = sanitizeVaultScopeId(binding && binding.vaultScopeId);
      const vaultLockEpoch = Number(binding && binding.vaultLockEpoch);
      if (!Number.isSafeInteger(vaultLockEpoch) || vaultLockEpoch < 0) {
        throw new Error('账号库锁定版本无效，请刷新页面后重试。');
      }
      if (syncVaultAuthEpoch !== vaultAuthEpoch) throw new Error('云端登录状态已变化，请重新同步。');
      state.role = permissions.role;
      state.vaultScopeId = vaultScopeId;
      state.vaultLockEpoch = vaultLockEpoch;
      state.legacyAvailable = binding && binding.legacyAvailable === true;
      state.permissions = permissions;
      state.canDeleteRuns = permissions.canDeleteRuns;
      if (permissions.canReadVault) {
        await guardedRecordSync({
          storageKey: VAULT_KEY,
          apiPath: '/api/vault',
          field: 'vault',
          label: '账号库密文',
          sanitize: sanitizeVaultRecord,
          setAction: 'setAccountVault',
          setPayload: (remoteEnvelope) => ({
            vaultLockEpoch: state.vaultLockEpoch,
            remoteRevision: remoteEnvelope.revision,
            serverConfirmed: true,
          }),
          canWrite: (value) => value.canWriteVault,
          onRemoteEnvelope: (remoteEnvelope) => {
            updateRemoteVaultState(remoteEnvelope, binding && binding.legacyAvailable === true);
          },
          onRemoteDeleted: (remoteEnvelope) => (
            applyRemoteVaultTombstone(remoteEnvelope, state.vaultLockEpoch)
          ),
        }, permissions, conflicts);
        if (syncVaultAuthEpoch !== vaultAuthEpoch) throw new Error('云端登录状态已变化，请重新同步。');
      }
      await guardedRecordSync({
        storageKey: DIRECTORY_KEY,
        apiPath: '/api/directory',
        field: 'directory',
        label: '项目目录',
        sanitize: sanitizeDirectory,
        setAction: 'setProjectDirectory',
        canWrite: (value) => value.canWriteDirectory,
      }, permissions, conflicts);
      const runs = await syncRuns(permissions, conflicts);
      if (syncVaultAuthEpoch !== vaultAuthEpoch) throw new Error('云端登录状态已变化，请重新同步。');
      emit('sync-complete', {
        connected: true,
        syncing: false,
        lastSyncedAt: Date.now(),
        lastError: '',
        role: permissions.role,
        vaultScopeId,
        vaultLockEpoch: state.vaultLockEpoch,
        legacyAvailable: state.legacyAvailable,
        remoteVaultExists: state.remoteVaultExists,
        remoteVaultRevision: state.remoteVaultRevision,
        remoteVaultDeleted: state.remoteVaultDeleted,
        conflicts,
        runs,
      });
      teamSessionHeartbeatRevoked = false;
      scheduleTeamSessionHeartbeat();
      return {
        ok: true, role: permissions.role, vaultScopeId,
        vaultLockEpoch: state.vaultLockEpoch,
        legacyAvailable: state.legacyAvailable,
        remoteVaultExists: state.remoteVaultExists,
        remoteVaultRevision: state.remoteVaultRevision,
        remoteVaultDeleted: state.remoteVaultDeleted,
        conflicts: conflicts.slice(), runs,
      };
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        await lockAccountVault().catch(() => {});
      }
      emit('sync-error', {
        syncing: false,
        lastError: error && error.message ? error.message : String(error),
        conflicts,
      });
      throw error;
    }
  }

  function scheduleSync(delayMs) {
    if (stopped || !state.enabled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow().catch(() => {});
    }, Number(delayMs) || 1000);
  }

  function syncNow() {
    if (!state.enabled || stopped) return Promise.resolve({ ok: true, skipped: true });
    if (vaultMutationPromise) {
      rerunRequested = true;
      return vaultMutationPromise.then(() => ({ ok: true, deferred: true }));
    }
    if (syncPromise) {
      rerunRequested = true;
      return syncPromise;
    }
    syncPromise = performSync().finally(() => {
      syncPromise = null;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleSync(100);
      }
    });
    return syncPromise;
  }

  async function start() {
    if (!state.enabled || stopped) return { ok: true, skipped: true };
    if (started && state.connected) return syncNow();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      started = true;
      const ping = await requestBridge('ping', {}, 8000);
      if (!ping || ping.connected !== true || !Array.isArray(ping.capabilities) ||
          !ping.capabilities.includes('cloudSync')) {
        throw new Error('当前数据助手版本不支持云同步。');
      }
      emit('connected', { connected: true });
      return syncNow();
    })();
    try {
      return await startPromise;
    } catch (error) {
      started = false;
      throw error;
    } finally {
      startPromise = null;
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(syncTimer);
    clearTeamSessionHeartbeatTimer();
    clearTeamVaultLockRetryTimer();
    if (teamSessionHeartbeatController) {
      teamSessionHeartbeatController.abort(new Error('云同步已停止。'));
      teamSessionHeartbeatController = null;
    }
    for (const pending of pendingBridgeRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('云同步已停止。'));
    }
    pendingBridgeRequests.clear();
    emit('stopped', { syncing: false });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === 'response' && pendingBridgeRequests.has(message.requestId)) {
      const pending = pendingBridgeRequests.get(message.requestId);
      pendingBridgeRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.message || '数据助手请求失败。'));
      return;
    }
    if (message.type === 'storageChanged' && Array.isArray(message.keys) &&
        message.keys.some((key) => SYNC_KEYS.has(key))) scheduleSync(1200);
  });

  window.addEventListener('focus', () => {
    if (teamSessionHeartbeatEnabled()) revalidateTeamSession().catch(() => {});
  });
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && teamSessionHeartbeatEnabled()) {
        revalidateTeamSession().catch(() => {});
      }
    });
  }

  let topLevel = false;
  try {
    topLevel = window.top === window;
  } catch (error) {
    topLevel = false;
  }
  // cloud-sync.js is injected only into server-rendered pages.  Hostname is
  // not a deployment signal: the standalone Node server is commonly opened
  // through localhost/127.0.0.1 as well.  Embedded report/data viewers stay
  // disabled so they cannot start a second synchronizer.
  state.enabled = topLevel;
  let readyPromise = Promise.resolve({ ok: true, skipped: true });
  const publicApi = {
    start,
    syncNow,
    migrateLegacyAccountVault,
    deleteAccountVault,
    recreateAccountVault,
    deleteRun,
    lockAccountVault,
    stop,
    getState,
    get ready() { return readyPromise; },
  };
  window.TaobaoCloudSync = Object.freeze(publicApi);
  if (state.enabled) {
    readyPromise = start().catch((error) => ({
      ok: false,
      message: error && error.message ? error.message : String(error),
    }));
  }
})();
