(function initXhsCommentMonitor(root, factory) {
  const api = factory();
  Object.defineProperty(api, 'standaloneSource', {
    value: '(' + factory.toString() + ')()',
    enumerable: false,
  });
  Object.freeze(api);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsCommentMonitor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsCommentMonitorApi() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_TIMEZONE = 'Asia/Shanghai';
  const CUMULATIVE_METRICS = Object.freeze([
    'impressionCount',
    'commentCount',
    'interactionCount',
    'readCount',
    'likeCount',
    'collectCount',
    'shareCount',
  ]);
  const METRIC_ALIASES = Object.freeze({
    impressionCount: Object.freeze(['impressionCount', 'impNum', 'exposureCount', 'exposureNum']),
    commentCount: Object.freeze(['commentCount', 'cmtNum', 'commentNum']),
    interactionCount: Object.freeze(['interactionCount', 'engageNum', 'interactionNum']),
    readCount: Object.freeze(['readCount', 'readNum']),
    likeCount: Object.freeze(['likeCount', 'likeNum']),
    collectCount: Object.freeze(['collectCount', 'favNum', 'favoriteNum', 'collectNum']),
    shareCount: Object.freeze(['shareCount', 'shareNum']),
  });
  const SCHEMAS = Object.freeze({
    profile: 'CommentMonitorProfileV1',
    metricSnapshot: 'PgyNoteMetricSnapshotV2',
    run: 'CommentMonitorRunV1',
    checkpoint: 'CommentCaptureCheckpointV1',
    insight: 'CommentInsightSummaryV1',
    comment: 'XhsNormalizedCommentV1',
    delta: 'PgyNoteMetricDeltaV1',
  });
  const TOPIC_LABELS = Object.freeze({
    purchase_motivation: '购买动机',
    product_experience: '产品体验',
    price_promotion: '价格促销',
    fit_compatibility: '规格适配',
    usage_guidance: '使用方法',
    competitor_comparison: '竞品比较',
    shipping_after_sales: '物流售后',
    complaint_risk: '投诉风险',
  });
  const TOPIC_RULES = Object.freeze({
    purchase_motivation: /(?:种草|想买|准备买|下单|入手|购买|回购|值得买|求链接|哪里买|蹲链接|心动)/iu,
    product_experience: /(?:好用|使用感|效果|体验|质感|口感|味道|舒服|满意|用了|用着|真实感受)/iu,
    price_promotion: /(?:多少钱|价格|到手价|贵不贵|太贵|便宜|优惠|折扣|促销|活动|优惠券|满减|双十一|618)/iu,
    fit_compatibility: /(?:适合|适配|尺寸|尺码|大小|型号|规格|色号|肤质|年龄|体重|斤|兼容|小户型|大户型|人群)/iu,
    usage_guidance: /(?:怎么用|如何用|用法|教程|怎么安装|如何安装|怎么清洗|如何清洗|需要清洗|每天几次|一次多少|怎么搭配|使用方法)/iu,
    competitor_comparison: /(?:对比|比较|区别|竞品|平替|替代|哪个更好|哪个好|还是|\bvs\b)/iu,
    shipping_after_sales: /(?:物流|发货|快递|售后|退货|退款|换货|保修|客服|补发|到货)/iu,
    complaint_risk: /(?:投诉|破损|过敏|踩雷|难用|没用|差评|欺骗|假货|失望|异味|坏了|有问题|不处理|没人理|退不了|退不掉)/iu,
  });
  const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024;
  const ARCHIVE_MAX_NOTES = 2000;
  const ARCHIVE_MAX_EVIDENCE = 24;
  const ARCHIVE_MAX_EVIDENCE_PER_CATEGORY = 3;
  const ARCHIVE_COUNT_FIELDS = Object.freeze([
    'commentCount',
    'classifiedCommentCount',
    'unclassifiedCommentCount',
    'newCommentCount',
    'capturedCommentCount',
    'candidateCount',
    'completedCount',
    'pendingContinuationCount',
    'failureCount',
    'noteCount',
    'newNoteCount',
    'hotNoteCount',
    'negativeFeedbackCount',
    'purchaseConcernCount',
    'unansweredQuestionCount',
  ]);
  const ARCHIVE_METRIC_FIELDS = Object.freeze([
    'impressionCount',
    'commentCount',
    'interactionCount',
    'readCount',
    'likeCount',
    'collectCount',
    'shareCount',
  ]);
  const ARCHIVE_DELTA_FIELDS = Object.freeze([
    'commentDelta',
    'nonCommentInteractionDelta',
    'readDelta',
  ]);
  const ARCHIVE_DATE_FIELDS = Object.freeze([
    'publishedAt',
    'platformUpdatedAt',
    'lastCommentCheckedAt',
    'capturedAt',
    'updatedAt',
  ]);
  const ARCHIVE_CAPTURE_STATUSES = new Set([
    'baseline', 'complete', 'completed', 'continuation', 'failed', 'partial',
    'paused', 'waiting_login', 'waiting_verification', 'needs_login',
    'needs_verification', 'pending', 'running', 'queued',
  ]);
  const ARCHIVE_DISCOVERY_STATUSES = new Set([
    'new_note', 'existing', 'historical_backfill',
  ]);
  const ARCHIVE_REASON_VALUES = new Set([
    'new_note', 'comment_growth', 'hot_top_20pct_due', 'metric_missing',
    'platform_correction', 'continuation',
  ]);
  const SEMANTIC_CATEGORY_IDS = Object.freeze([...Object.keys(TOPIC_LABELS), 'other']);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value, maximumLength) {
    if (value === null || value === undefined) return '';
    const text = String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!text) return '';
    return text.slice(0, maximumLength || 4000);
  }

  function finiteCounter(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return undefined;
    const text = typeof value === 'string' ? value.replace(/[,\s]/gu, '') : value;
    if (text === '') return undefined;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  }

  function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function validTimestamp(value, fallback) {
    const text = cleanText(value, 80);
    if (text && Number.isFinite(Date.parse(text))) return new Date(text).toISOString();
    const fallbackText = cleanText(fallback, 80);
    if (fallbackText && Number.isFinite(Date.parse(fallbackText))) {
      return new Date(fallbackText).toISOString();
    }
    return new Date().toISOString();
  }

  function optionalTimestamp(value) {
    const text = cleanText(value, 80);
    return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : '';
  }

  function cloneObject(value) {
    return isObject(value) ? { ...value } : {};
  }

  function normalizeMonitorProfile(input) {
    const source = isObject(input) ? input : {};
    const requestedTime = cleanText(source.dailyTime, 5);
    const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(requestedTime);
    return {
      schema: SCHEMAS.profile,
      schemaVersion: 1,
      accountKey: cleanText(source.accountKey, 160) || 'unknown',
      storeId: cleanText(source.storeId, 100),
      storeName: cleanText(source.storeName, 120),
      enabled: source.enabled !== false,
      dailyTime: validTime ? requestedTime : '09:00',
      timezone: cleanText(source.timezone, 80) || DEFAULT_TIMEZONE,
      recentLookbackDays: Math.round(boundedNumber(source.recentLookbackDays, 90, 1, 3650)),
      hotRatio: boundedNumber(source.hotRatio, 0.2, 0.01, 1),
      historicalTopRatio: boundedNumber(source.historicalTopRatio, 0.1, 0.01, 1),
      perNoteLimit: Math.round(boundedNumber(
        source.perNoteLimit === undefined ? source.perNoteRoundLimit : source.perNoteLimit,
        500,
        1,
        500,
      )),
      rawRetention: 'local_only',
    };
  }

  function rowMetric(row, key) {
    let maximum;
    for (const alias of METRIC_ALIASES[key] || [key]) {
      const metric = finiteCounter(row[alias]);
      if (metric !== undefined && (maximum === undefined || metric > maximum)) maximum = metric;
    }
    return maximum;
  }

  function aggregateNoteRows(rows) {
    const groups = new Map();
    for (const raw of Array.isArray(rows) ? rows : []) {
      const row = isObject(raw) ? raw : {};
      const noteId = cleanText(row.noteId || row.note_id || row.noteID, 160);
      if (!noteId) continue;
      let target = groups.get(noteId);
      if (!target) {
        target = { noteId, orderIds: [] };
        groups.set(noteId, target);
      }
      const orderId = cleanText(row.orderId || row.order_id, 160);
      if (orderId && !target.orderIds.includes(orderId)) target.orderIds.push(orderId);
      for (const key of CUMULATIVE_METRICS) {
        const metric = rowMetric(row, key);
        if (metric !== undefined && (target[key] === undefined || metric > target[key])) {
          target[key] = metric;
        }
      }
      const title = cleanText(row.title || row.noteTitle || row.note_title, 500);
      if (title) target.title = title;
      const officialUrl = cleanText(row.officialUrl || row.noteUrl || row.note_url, 3000);
      if (officialUrl) target.officialUrl = officialUrl;
      const accountKey = cleanText(row.accountKey, 160);
      if (accountKey) target.accountKey = accountKey;
      const publishedAt = optionalTimestamp(
        row.publishedAt || row.notePublishTime || row.publishTime || row.publish_time,
      );
      if (publishedAt && (!target.publishedAt || Date.parse(publishedAt) < Date.parse(target.publishedAt))) {
        target.publishedAt = publishedAt;
      }
      const platformUpdatedAt = optionalTimestamp(
        row.platformUpdatedAt || row.updatedAt || row.updateTime || row.update_time,
      );
      if (platformUpdatedAt && (
        !target.platformUpdatedAt || Date.parse(platformUpdatedAt) > Date.parse(target.platformUpdatedAt)
      )) {
        target.platformUpdatedAt = platformUpdatedAt;
      }
      const lastCommentCheckedAt = optionalTimestamp(row.lastCommentCheckedAt);
      if (lastCommentCheckedAt && (
        !target.lastCommentCheckedAt || Date.parse(lastCommentCheckedAt) > Date.parse(target.lastCommentCheckedAt)
      )) {
        target.lastCommentCheckedAt = lastCommentCheckedAt;
      }
    }
    return Array.from(groups.values());
  }

  function createMetricSnapshot(input) {
    const source = isObject(input) ? input : {};
    const accountKey = cleanText(source.accountKey, 160) || 'unknown';
    const sharedPlatformUpdatedAt = optionalTimestamp(source.platformUpdatedAt);
    const notes = aggregateNoteRows(source.rows).map((item) => {
      const normalized = {
        ...item,
        accountKey: item.accountKey || accountKey,
      };
      if (!normalized.platformUpdatedAt && sharedPlatformUpdatedAt) {
        normalized.platformUpdatedAt = sharedPlatformUpdatedAt;
      }
      return normalized;
    });
    return {
      schema: SCHEMAS.metricSnapshot,
      schemaVersion: 2,
      accountKey,
      capturedAt: validTimestamp(source.capturedAt),
      notes,
    };
  }

  function discoveryStatus(note, referenceTimestamp) {
    const publishedAt = optionalTimestamp(note && note.publishedAt);
    const platformUpdatedAt = optionalTimestamp(note && note.platformUpdatedAt)
      || optionalTimestamp(referenceTimestamp);
    if (!publishedAt || !platformUpdatedAt) return 'historical_backfill';
    const age = Date.parse(platformUpdatedAt) - Date.parse(publishedAt);
    return age >= 0 && age <= 7 * DAY_MS ? 'new_note' : 'historical_backfill';
  }

  function increment(previousValue, currentValue) {
    if (previousValue === undefined || currentValue === undefined) return null;
    return Math.max(0, currentValue - previousValue);
  }

  function intervalMetadata(previousAt, currentAt) {
    const from = validTimestamp(previousAt);
    const to = validTimestamp(currentAt);
    const elapsed = Math.max(0, Date.parse(to) - Date.parse(from));
    const days = Math.max(1, Math.round(elapsed / DAY_MS));
    const missedDays = Math.max(0, days - 1);
    return {
      from,
      to,
      days,
      missedDays,
      dailyAttribution: missedDays === 0,
      label: missedDays > 0 ? '自上次成功以来增量' : '本次更新增量',
    };
  }

  function computeSnapshotDelta(previousSnapshot, currentSnapshot) {
    const previous = isObject(previousSnapshot) ? previousSnapshot : {};
    const current = isObject(currentSnapshot) ? currentSnapshot : {};
    const previousById = new Map((Array.isArray(previous.notes) ? previous.notes : []).map((item) => [
      cleanText(item && item.noteId, 160), item,
    ]));
    const interval = intervalMetadata(previous.capturedAt, current.capturedAt);
    const notes = [];
    for (const rawCurrent of Array.isArray(current.notes) ? current.notes : []) {
      const currentNote = isObject(rawCurrent) ? rawCurrent : {};
      const noteId = cleanText(currentNote.noteId, 160);
      if (!noteId) continue;
      const previousNote = previousById.get(noteId);
      const corrections = [];
      const missingMetrics = [];
      for (const key of ['commentCount', 'interactionCount', 'readCount']) {
        const before = previousNote ? finiteCounter(previousNote[key]) : undefined;
        const after = finiteCounter(currentNote[key]);
        if (previousNote && (before === undefined || after === undefined)) missingMetrics.push(key);
        if (before !== undefined && after !== undefined && after < before) corrections.push(key);
      }
      const beforeComment = previousNote ? finiteCounter(previousNote.commentCount) : undefined;
      const afterComment = finiteCounter(currentNote.commentCount);
      const beforeInteraction = previousNote ? finiteCounter(previousNote.interactionCount) : undefined;
      const afterInteraction = finiteCounter(currentNote.interactionCount);
      const beforeRead = previousNote ? finiteCounter(previousNote.readCount) : undefined;
      const afterRead = finiteCounter(currentNote.readCount);
      const commentDelta = previousNote ? increment(beforeComment, afterComment) : null;
      const interactionDelta = previousNote ? increment(beforeInteraction, afterInteraction) : null;
      const readDelta = previousNote ? increment(beforeRead, afterRead) : null;
      const nonCommentInteractionDelta = interactionDelta === null || commentDelta === null
        ? null
        : Math.max(0, interactionDelta - commentDelta);
      notes.push({
        ...currentNote,
        accountKey: currentNote.accountKey || current.accountKey || 'unknown',
        discovery: previousNote ? 'existing' : discoveryStatus(currentNote, current.capturedAt),
        commentDelta,
        nonCommentInteractionDelta,
        readDelta,
        corrections,
        missingMetrics,
      });
    }
    return {
      schema: SCHEMAS.delta,
      schemaVersion: 1,
      accountKey: cleanText(current.accountKey, 160) || cleanText(previous.accountKey, 160) || 'unknown',
      interval,
      notes,
    };
  }

  function percentileRanks(items, key) {
    const values = items.map((item) => {
      const value = Number(item[key]);
      return Number.isFinite(value) && value > 0 ? value : 0;
    });
    const sorted = values.slice().sort((left, right) => left - right);
    if (sorted.length <= 1) return values.map((value) => (value > 0 ? 1 : 0));
    return values.map((value) => {
      let first = sorted.indexOf(value);
      let last = sorted.lastIndexOf(value);
      if (first < 0) first = 0;
      if (last < 0) last = first;
      return ((first + last) / 2) / (sorted.length - 1);
    });
  }

  function scoreNoteHeat(deltaNotes, options) {
    const sourceOptions = isObject(options) ? options : {};
    const hotRatio = boundedNumber(sourceOptions.hotRatio, 0.2, 0.01, 1);
    const output = (Array.isArray(deltaNotes) ? deltaNotes : []).map((item) => ({ ...item }));
    const groups = new Map();
    output.forEach((item, index) => {
      const accountKey = cleanText(item.accountKey, 160) || 'unknown';
      if (!groups.has(accountKey)) groups.set(accountKey, []);
      groups.get(accountKey).push({ item, index });
    });
    for (const entries of groups.values()) {
      const items = entries.map((entry) => entry.item);
      const commentRanks = percentileRanks(items, 'commentDelta');
      const interactionRanks = percentileRanks(items, 'nonCommentInteractionDelta');
      const readRanks = percentileRanks(items, 'readDelta');
      entries.forEach((entry, localIndex) => {
        const heatPinned = entry.item.discovery === 'new_note';
        const weighted = commentRanks[localIndex] * 0.5
          + interactionRanks[localIndex] * 0.3
          + readRanks[localIndex] * 0.2;
        entry.item.heatPercentiles = {
          comments: Number(commentRanks[localIndex].toFixed(6)),
          nonCommentInteractions: Number(interactionRanks[localIndex].toFixed(6)),
          reads: Number(readRanks[localIndex].toFixed(6)),
        };
        entry.item.heatPinned = heatPinned;
        entry.item.heatScore = Number((heatPinned ? 1 : weighted).toFixed(6));
        entry.item.heatTop20 = false;
      });
      const active = entries.filter(({ item }) => (
        Number(item.commentDelta) > 0
        || Number(item.nonCommentInteractionDelta) > 0
        || Number(item.readDelta) > 0
        || item.discovery === 'new_note'
      ));
      const topCount = active.length ? Math.max(1, Math.ceil(active.length * hotRatio)) : 0;
      active.sort((left, right) => (
        right.item.heatScore - left.item.heatScore
        || String(left.item.noteId || '').localeCompare(String(right.item.noteId || ''), 'zh-CN')
      ));
      active.slice(0, topCount).forEach(({ item }) => { item.heatTop20 = true; });
    }
    return output;
  }

  function topNoteIds(notes, key, ratio) {
    if (!notes.length) return new Set();
    const count = Math.max(1, Math.ceil(notes.length * ratio));
    return new Set(notes.slice().sort((left, right) => (
      (finiteCounter(right[key]) || 0) - (finiteCounter(left[key]) || 0)
      || String(left.noteId).localeCompare(String(right.noteId), 'zh-CN')
    )).slice(0, count).map((item) => item.noteId));
  }

  function selectInitialCandidates(notes, options) {
    const sourceOptions = isObject(options) ? options : {};
    const asOf = Date.parse(validTimestamp(sourceOptions.asOf));
    const recentLookbackDays = Math.round(boundedNumber(sourceOptions.recentLookbackDays, 90, 1, 3650));
    const historicalTopRatio = boundedNumber(sourceOptions.historicalTopRatio, 0.1, 0.01, 1);
    const normalized = aggregateNoteRows(notes);
    const recentIds = new Set();
    const historical = [];
    for (const item of normalized) {
      const published = Date.parse(optionalTimestamp(item.publishedAt));
      const age = Number.isFinite(published) ? asOf - published : Number.POSITIVE_INFINITY;
      if (age >= 0 && age <= recentLookbackDays * DAY_MS) recentIds.add(item.noteId);
      else historical.push(item);
    }
    const topComments = topNoteIds(historical, 'commentCount', historicalTopRatio);
    const topInteractions = topNoteIds(historical, 'interactionCount', historicalTopRatio);
    const selected = [];
    for (const item of normalized) {
      const reasons = [];
      if (recentIds.has(item.noteId)) reasons.push(`recent_${recentLookbackDays}d`);
      if (topComments.has(item.noteId)) reasons.push('historical_comment_top_10pct');
      if (topInteractions.has(item.noteId)) reasons.push('historical_interaction_top_10pct');
      if (reasons.length) selected.push({ ...item, reasons });
    }
    return selected;
  }

  function isReviewDue(lastCheckedAt, asOf, afterHours) {
    const checked = Date.parse(optionalTimestamp(lastCheckedAt));
    if (!Number.isFinite(checked)) return true;
    return asOf - checked >= afterHours * 60 * 60 * 1000;
  }

  function selectRefreshCandidates(scoredDeltaNotes, options) {
    const sourceOptions = isObject(options) ? options : {};
    const asOf = Date.parse(validTimestamp(sourceOptions.asOf));
    const hotReviewAfterHours = boundedNumber(sourceOptions.hotReviewAfterHours, 24, 1, 24 * 365);
    const selected = [];
    for (const raw of Array.isArray(scoredDeltaNotes) ? scoredDeltaNotes : []) {
      const item = isObject(raw) ? raw : {};
      const noteId = cleanText(item.noteId, 160);
      if (!noteId) continue;
      const reasons = [];
      if (item.discovery === 'new_note') reasons.push('new_note');
      if (Number(item.commentDelta) > 0) reasons.push('comment_growth');
      if (item.heatTop20 === true && isReviewDue(
        item.lastCommentCheckedAt,
        asOf,
        hotReviewAfterHours,
      )) reasons.push('hot_top_20pct_due');
      if (Array.isArray(item.missingMetrics) && item.missingMetrics.length) reasons.push('metric_missing');
      if (Array.isArray(item.corrections) && item.corrections.length) reasons.push('platform_correction');
      if (reasons.length) selected.push({ ...item, reasons });
    }
    return selected;
  }

  function buildRoundRobinQueue(candidates, options) {
    const sourceOptions = isObject(options) ? options : {};
    const perNoteLimit = Math.round(boundedNumber(sourceOptions.perNoteLimit, 500, 1, 500));
    const maxTasks = Math.round(boundedNumber(sourceOptions.maxTasks, 10000, 1, 100000));
    const waiting = [];
    for (const raw of Array.isArray(candidates) ? candidates : []) {
      const item = isObject(raw) ? raw : {};
      const noteId = cleanText(item.noteId, 160);
      const remainingCount = Math.floor(Number(item.remainingCount));
      if (!noteId || !Number.isFinite(remainingCount) || remainingCount <= 0) continue;
      waiting.push({
        noteId,
        remainingCount,
        offset: Math.max(0, Math.floor(Number(item.offset) || 0)),
        checkpoint: cloneObject(item.checkpoint),
      });
    }
    const tasks = [];
    while (waiting.length && tasks.length < maxTasks) {
      const item = waiting.shift();
      const plannedCount = Math.min(perNoteLimit, item.remainingCount);
      const remainingAfter = item.remainingCount - plannedCount;
      tasks.push({
        sequence: tasks.length + 1,
        noteId: item.noteId,
        offset: item.offset,
        limit: perNoteLimit,
        plannedCount,
        checkpoint: cloneObject(item.checkpoint),
        requiresCheckpoint: remainingAfter > 0,
      });
      if (remainingAfter > 0) {
        waiting.push({
          ...item,
          remainingCount: remainingAfter,
          offset: item.offset + plannedCount,
        });
      }
    }
    return tasks;
  }

  function createMonitorRun(input) {
    const source = isObject(input) ? input : {};
    const allowedStatuses = new Set([
      'queued', 'running', 'completed', 'partial', 'paused', 'needs_login', 'needs_verification', 'failed',
    ]);
    const status = allowedStatuses.has(source.status) ? source.status : 'queued';
    return {
      schema: SCHEMAS.run,
      schemaVersion: 1,
      runId: cleanText(source.runId, 160) || `comment-monitor:${Date.now()}`,
      accountKey: cleanText(source.accountKey, 160) || 'unknown',
      trigger: ['daily', 'catch_up', 'manual', 'initial'].includes(source.trigger) ? source.trigger : 'manual',
      status,
      scheduledFor: optionalTimestamp(source.scheduledFor),
      startedAt: optionalTimestamp(source.startedAt),
      finishedAt: optionalTimestamp(source.finishedAt),
      candidateCount: Math.floor(finiteCounter(source.candidateCount) || 0),
      completedCount: Math.floor(finiteCounter(source.completedCount) || 0),
      continuationCount: Math.floor(finiteCounter(source.continuationCount) || 0),
      failureCount: Math.floor(finiteCounter(source.failureCount) || 0),
    };
  }

  function createCaptureCheckpoint(input) {
    const source = isObject(input) ? input : {};
    return {
      schema: SCHEMAS.checkpoint,
      schemaVersion: 1,
      accountKey: cleanText(source.accountKey, 160) || 'unknown',
      noteId: cleanText(source.noteId, 160),
      rootCursor: cleanText(source.rootCursor || source.cursor || source.nextCursor, 1000),
      rootHasMore: source.rootHasMore === true || source.hasMore === true || source.has_more === true,
      subCursors: cloneObject(source.subCursors || source.sub_cursors),
      capturedCount: Math.floor(finiteCounter(source.capturedCount) || 0),
      updatedAt: validTimestamp(source.updatedAt),
    };
  }

  function epochTimestamp(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      const milliseconds = number < 10_000_000_000 ? number * 1000 : number;
      return new Date(milliseconds).toISOString();
    }
    return optionalTimestamp(value);
  }

  function normalizeComment(raw, context) {
    const source = isObject(raw) ? raw : {};
    const scope = isObject(context) ? context : {};
    const user = isObject(source.user_info)
      ? source.user_info
      : isObject(source.userInfo) ? source.userInfo : isObject(source.author) ? source.author : {};
    const commentId = cleanText(source.commentId || source.comment_id || source.id, 240);
    if (!commentId) return null;
    const noteId = cleanText(scope.noteId || source.noteId || source.note_id, 160);
    const parentCommentId = cleanText(
      scope.parentCommentId || source.parentCommentId || source.parent_comment_id || source.target_comment_id,
      240,
    );
    const rootCommentId = cleanText(
      scope.rootCommentId || source.rootCommentId || source.root_comment_id,
      240,
    ) || (parentCommentId || commentId);
    return {
      schema: SCHEMAS.comment,
      schemaVersion: 1,
      accountKey: cleanText(scope.accountKey || source.accountKey, 160) || 'unknown',
      noteId,
      commentId,
      parentCommentId,
      rootCommentId,
      content: cleanText(source.content || source.comment_content || source.text, 5000),
      likeCount: finiteCounter(source.likeCount || source.like_count) || 0,
      createdAt: epochTimestamp(source.createdAt || source.create_time || source.time),
      ipLocation: cleanText(source.ipLocation || source.ip_location, 160),
      author: {
        userId: cleanText(user.userId || user.user_id || user.id, 240),
        nickname: cleanText(user.nickname || user.nickName || user.name, 240),
        avatarUrl: cleanText(user.avatarUrl || user.image || user.avatar, 2000),
      },
      subCommentCount: Math.floor(finiteCounter(
        source.subCommentCount || source.sub_comment_count || source.sub_comment_has_more,
      ) || 0),
    };
  }

  function redactInlinePii(value) {
    return cleanText(value, 5000)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[邮箱]')
      .replace(/(^|[^\d])\s*1[3-9]\d{9}(?!\d)/gu, '$1[手机号]')
      .replace(/(^|[^\d])\s*\d{17}[\dXx](?!\d)/gu, '$1[证件号]')
      .replace(/(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*(?:(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*)?[A-Za-z][A-Za-z0-9_-]{5,19}/giu, '[微信号]');
  }

  function truncateCharacters(value, maximumLength) {
    const text = cleanText(value, Math.max(1, Number(maximumLength) * 2));
    return Array.from(text).slice(0, maximumLength).join('');
  }

  function safeArchiveText(value, maximumLength) {
    return truncateCharacters(redactInlinePii(value), maximumLength);
  }

  function assignArchiveCounter(target, source, key) {
    const value = finiteCounter(source[key]);
    if (value !== undefined) target[key] = value;
  }

  function assignArchiveTimestamp(target, source, key) {
    const value = optionalTimestamp(source[key]);
    if (value) target[key] = value;
  }

  function sanitizeArchiveInterval(value) {
    if (!isObject(value)) return null;
    const output = {};
    assignArchiveTimestamp(output, value, 'from');
    assignArchiveTimestamp(output, value, 'to');
    assignArchiveCounter(output, value, 'days');
    assignArchiveCounter(output, value, 'missedDays');
    if (typeof value.dailyAttribution === 'boolean') {
      output.dailyAttribution = value.dailyAttribution;
    }
    const missedDays = finiteCounter(value.missedDays) || 0;
    output.label = missedDays > 0 ? '自上次成功以来增量' : '本次更新增量';
    return Object.keys(output).length > 1 ? output : null;
  }

  function sanitizeArchiveEvidence(value) {
    const source = isObject(value) ? value : {};
    const excerpt = safeArchiveText(source.excerpt || source.content || source.text, 160);
    if (!excerpt) return null;
    const output = { excerpt };
    const noteId = cleanText(source.noteId || source.note_id, 160);
    const commentId = cleanText(source.commentId || source.comment_id, 240);
    if (noteId) output.noteId = noteId;
    if (commentId) output.commentId = commentId;
    return output;
  }

  function sanitizeArchiveCategories(value) {
    const source = isObject(value) ? value : {};
    const output = {};
    let totalEvidence = 0;
    for (const categoryId of Object.keys(TOPIC_LABELS)) {
      const category = isObject(source[categoryId]) ? source[categoryId] : {};
      const count = finiteCounter(category.count) || 0;
      const evidence = [];
      for (const candidate of Array.isArray(category.evidence) ? category.evidence : []) {
        if (evidence.length >= ARCHIVE_MAX_EVIDENCE_PER_CATEGORY ||
            totalEvidence >= ARCHIVE_MAX_EVIDENCE) break;
        const safe = sanitizeArchiveEvidence(candidate);
        if (!safe) continue;
        evidence.push(safe);
        totalEvidence += 1;
      }
      output[categoryId] = {
        label: TOPIC_LABELS[categoryId],
        count,
        evidence,
      };
    }
    return output;
  }

  function sanitizeArchiveMetric(value) {
    const source = isObject(value) ? value : {};
    const noteId = cleanText(source.noteId || source.note_id, 160);
    if (!noteId) return null;
    const output = { noteId };
    const title = safeArchiveText(source.title || source.noteTitle || source.note_title, 500);
    if (title) output.title = title;
    for (const key of ARCHIVE_DATE_FIELDS) assignArchiveTimestamp(output, source, key);
    for (const key of ARCHIVE_METRIC_FIELDS) assignArchiveCounter(output, source, key);
    for (const key of ARCHIVE_DELTA_FIELDS) {
      if (source[key] === null) output[key] = null;
      else assignArchiveCounter(output, source, key);
    }
    const discovery = cleanText(source.discovery, 40);
    if (ARCHIVE_DISCOVERY_STATUSES.has(discovery)) output.discovery = discovery;
    if (typeof source.heatPinned === 'boolean') output.heatPinned = source.heatPinned;
    if (typeof source.heatTop20 === 'boolean') output.heatTop20 = source.heatTop20;
    const heatScore = Number(source.heatScore);
    if (Number.isFinite(heatScore)) output.heatScore = boundedNumber(heatScore, 0, 0, 1);
    if (isObject(source.heatPercentiles)) {
      const percentiles = {};
      for (const key of ['comments', 'nonCommentInteractions', 'reads']) {
        const number = Number(source.heatPercentiles[key]);
        if (Number.isFinite(number)) percentiles[key] = boundedNumber(number, 0, 0, 1);
      }
      if (Object.keys(percentiles).length) output.heatPercentiles = percentiles;
    }
    const corrections = Array.isArray(source.corrections)
      ? source.corrections.filter((key) => ARCHIVE_METRIC_FIELDS.includes(key)).slice(0, 7)
      : [];
    const missingMetrics = Array.isArray(source.missingMetrics)
      ? source.missingMetrics.filter((key) => ARCHIVE_METRIC_FIELDS.includes(key)).slice(0, 7)
      : [];
    const reasons = Array.isArray(source.reasons)
      ? source.reasons.filter((key) => ARCHIVE_REASON_VALUES.has(key)).slice(0, 6)
      : [];
    if (corrections.length) output.corrections = Array.from(new Set(corrections));
    if (missingMetrics.length) output.missingMetrics = Array.from(new Set(missingMetrics));
    if (reasons.length) output.reasons = Array.from(new Set(reasons));
    const captureStatus = cleanText(source.captureStatus, 40);
    if (ARCHIVE_CAPTURE_STATUSES.has(captureStatus)) output.captureStatus = captureStatus;
    assignArchiveCounter(output, source, 'capturedCount');
    return output;
  }

  function sanitizeArchiveNoteState(value) {
    const source = isObject(value) ? value : {};
    const noteId = cleanText(source.noteId || source.note_id, 160);
    if (!noteId) return null;
    const output = { noteId };
    const title = safeArchiveText(source.title || source.noteTitle || source.note_title, 500);
    if (title) output.title = title;
    const status = cleanText(source.status || source.captureStatus, 40);
    if (ARCHIVE_CAPTURE_STATUSES.has(status)) output.status = status;
    assignArchiveCounter(output, source, 'capturedCount');
    assignArchiveTimestamp(output, source, 'updatedAt');
    return output;
  }

  function semanticAggregateFromItems(items) {
    const categoryCounts = Object.fromEntries(SEMANTIC_CATEGORY_IDS.map((id) => [id, 0]));
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
    const counts = {
      itemCount: 0,
      classifiedCount: 0,
      abstainedCount: 0,
      retryableCount: 0,
      purchaseIntentCount: 0,
      unresolvedQuestionCount: 0,
      sentimentCounts,
      categoryCounts,
    };
    for (const raw of Array.isArray(items) ? items : []) {
      const item = isObject(raw) ? raw : {};
      counts.itemCount += 1;
      if (item.status === 'classified') counts.classifiedCount += 1;
      if (item.status === 'abstained') counts.abstainedCount += 1;
      if (item.retryable === true) counts.retryableCount += 1;
      if (item.purchaseIntent === true) counts.purchaseIntentCount += 1;
      if (item.unresolvedQuestion === true) counts.unresolvedQuestionCount += 1;
      if (Object.hasOwn(sentimentCounts, item.sentiment)) sentimentCounts[item.sentiment] += 1;
      const uniqueCategories = new Set(Array.isArray(item.categoryIds) ? item.categoryIds : []);
      for (const categoryId of uniqueCategories) {
        if (Object.hasOwn(categoryCounts, categoryId)) categoryCounts[categoryId] += 1;
      }
    }
    return counts;
  }

  function semanticCounter(source, derived, key) {
    const value = finiteCounter(source[key]);
    return value === undefined ? derived[key] : value;
  }

  function sanitizeArchiveSemantic(value) {
    if (!isObject(value)) return null;
    const source = value;
    const derived = semanticAggregateFromItems(source.items);
    const output = {};
    for (const [key, maximum] of [
      ['status', 80], ['provider', 80], ['model', 160], ['promptVersion', 80],
      ['taxonomyVersion', 80], ['errorCode', 120],
    ]) {
      const text = cleanText(source[key], maximum);
      if (text) output[key] = text;
    }
    if (!output.status && Array.isArray(source.items)) output.status = 'completed';
    for (const key of [
      'itemCount', 'classifiedCount', 'abstainedCount', 'retryableCount',
      'purchaseIntentCount', 'unresolvedQuestionCount',
    ]) output[key] = semanticCounter(source, derived, key);
    const sourceSentiments = isObject(source.sentimentCounts) ? source.sentimentCounts : {};
    output.sentimentCounts = {};
    for (const key of ['positive', 'neutral', 'negative']) {
      const count = finiteCounter(sourceSentiments[key]);
      output.sentimentCounts[key] = count === undefined ? derived.sentimentCounts[key] : count;
    }
    const sourceCategories = isObject(source.categoryCounts) ? source.categoryCounts : {};
    output.categoryCounts = {};
    for (const key of SEMANTIC_CATEGORY_IDS) {
      const count = finiteCounter(sourceCategories[key]);
      output.categoryCounts[key] = count === undefined ? derived.categoryCounts[key] : count;
    }
    return output;
  }

  function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of String(value)) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x7f) bytes += 1;
      else if (codePoint <= 0x7ff) bytes += 2;
      else if (codePoint <= 0xffff) bytes += 3;
      else bytes += 4;
    }
    return bytes;
  }

  function sanitizeCommentInsightSummaryForArchive(summaryValue, contextValue) {
    const source = isObject(summaryValue) ? summaryValue : {};
    const context = isObject(contextValue) ? contextValue : {};
    const output = {
      schema: SCHEMAS.insight,
      schemaVersion: 1,
    };
    const accountRef = cleanText(context.accountRef, 160);
    const bindingSourceRunId = cleanText(context.bindingSourceRunId, 160);
    if (accountRef) output.accountRef = accountRef;
    if (bindingSourceRunId) output.bindingSourceRunId = bindingSourceRunId;
    assignArchiveTimestamp(output, source, 'generatedAt');
    assignArchiveTimestamp(output, source, 'platformUpdatedAt');
    const interval = sanitizeArchiveInterval(source.interval);
    if (interval) output.interval = interval;
    for (const key of ARCHIVE_COUNT_FIELDS) assignArchiveCounter(output, source, key);
    output.categories = sanitizeArchiveCategories(source.categories);
    output.noteMetrics = (Array.isArray(source.noteMetrics) ? source.noteMetrics : [])
      .slice(0, ARCHIVE_MAX_NOTES)
      .map(sanitizeArchiveMetric)
      .filter(Boolean);
    output.noteStates = (Array.isArray(source.noteStates) ? source.noteStates : [])
      .slice(0, ARCHIVE_MAX_NOTES)
      .map(sanitizeArchiveNoteState)
      .filter(Boolean);
    const semantic = sanitizeArchiveSemantic(source.semantic);
    if (semantic) output.semantic = semantic;
    const json = JSON.stringify(output);
    if (utf8ByteLength(json) > ARCHIVE_MAX_BYTES) {
      const error = new Error('评论洞察归档摘要超过 2MB 安全限制。');
      error.code = 'COMMENT_SUMMARY_ARCHIVE_TOO_LARGE';
      throw error;
    }
    return output;
  }

  function sanitizeCommentForAnalysis(comment) {
    const source = isObject(comment) ? comment : {};
    return {
      accountKey: cleanText(source.accountKey, 160) || 'unknown',
      noteId: cleanText(source.noteId, 160),
      commentId: cleanText(source.commentId || source.comment_id || source.id, 240),
      parentCommentId: cleanText(source.parentCommentId || source.parent_comment_id, 240),
      rootCommentId: cleanText(source.rootCommentId || source.root_comment_id, 240),
      content: redactInlinePii(source.content || source.comment_content || source.text),
      likeCount: finiteCounter(source.likeCount || source.like_count) || 0,
      createdAt: epochTimestamp(source.createdAt || source.create_time || source.time),
    };
  }

  function classifyCommentRules(comment) {
    const source = isObject(comment) ? comment : {};
    const content = redactInlinePii(source.content || source.comment_content || source.text);
    const categories = [];
    for (const category of Object.keys(TOPIC_LABELS)) {
      if (TOPIC_RULES[category].test(content)) categories.push(category);
    }
    return {
      categories,
      labels: categories.map((category) => TOPIC_LABELS[category]),
      source: 'rule',
      content,
    };
  }

  function summarizeCommentInsights(rawComments, options) {
    const sourceOptions = isObject(options) ? options : {};
    const accountKey = cleanText(sourceOptions.accountKey, 160) || 'unknown';
    const defaultNoteId = cleanText(sourceOptions.noteId, 160);
    const evidenceLimit = Math.round(boundedNumber(sourceOptions.evidenceLimit, 3, 1, 20));
    const categories = {};
    for (const [id, label] of Object.entries(TOPIC_LABELS)) {
      categories[id] = { label, count: 0, evidence: [] };
    }
    const seen = new Set();
    let commentCount = 0;
    let classifiedCommentCount = 0;
    for (const raw of Array.isArray(rawComments) ? rawComments : []) {
      const normalized = normalizeComment(raw, {
        accountKey,
        noteId: cleanText(raw && (raw.noteId || raw.note_id), 160) || defaultNoteId,
      });
      if (!normalized) continue;
      const identity = [normalized.accountKey, normalized.noteId, normalized.commentId].join(':');
      if (seen.has(identity)) continue;
      seen.add(identity);
      commentCount += 1;
      const safe = sanitizeCommentForAnalysis(normalized);
      const classification = classifyCommentRules(safe);
      if (classification.categories.length) classifiedCommentCount += 1;
      for (const categoryId of classification.categories) {
        const category = categories[categoryId];
        category.count += 1;
        if (category.evidence.length < evidenceLimit) {
          category.evidence.push({
            accountKey: safe.accountKey,
            noteId: safe.noteId,
            commentId: safe.commentId,
            excerpt: safe.content.slice(0, 160),
          });
        }
      }
    }
    return {
      schema: SCHEMAS.insight,
      schemaVersion: 1,
      accountKey,
      generatedAt: validTimestamp(sourceOptions.generatedAt),
      commentCount,
      classifiedCommentCount,
      unclassifiedCommentCount: commentCount - classifiedCommentCount,
      categories,
    };
  }

  return {
    SCHEMAS,
    TOPIC_LABELS,
    CUMULATIVE_METRICS,
    normalizeMonitorProfile,
    aggregateNoteRows,
    createMetricSnapshot,
    computeSnapshotDelta,
    scoreNoteHeat,
    selectInitialCandidates,
    selectRefreshCandidates,
    buildRoundRobinQueue,
    createMonitorRun,
    createCaptureCheckpoint,
    normalizeComment,
    sanitizeCommentForAnalysis,
    classifyCommentRules,
    summarizeCommentInsights,
    sanitizeCommentInsightSummaryForArchive,
  };
});
