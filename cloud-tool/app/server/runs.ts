import { ApiError, requireObject } from "./http";
import type { runs } from "@/db/schema";

type RunRow = typeof runs.$inferSelect;

const MAX_XHS_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const XHS_DETAIL_KEY_PREFIX = "xhsAnalysisDetailChunkV1:";
const XHS_SNAPSHOT_KEYS = new Set([
  "xhsAnalysisSnapshotV1",
  "xhsCollectionStatusV1",
  "xhsCommentInsightSummaryV1",
]);
const SENSITIVE_RUN_KEYS = new Set([
  "password",
  "masterpassword",
  "authorization",
  "cookie",
  "cookies",
  "token",
  "accesstoken",
  "refreshtoken",
  "signature",
  "sign",
  "secret",
  "xsectoken",
  "tbtoken",
  "apikey",
  "secretkey",
  "sessionid",
  "csrftoken",
]);
const FORBIDDEN_XHS_STATE_KEYS = new Set([
  "raw",
  "rawresponse",
  "rawresponses",
  "rawpayload",
  "rawpages",
  "checkpoint",
  "checkpoints",
  "pages",
  "cache",
  "cachekey",
  "fingerprint",
  "indexeddb",
  "datasets",
]);
const COMMENT_ARCHIVE_SNAPSHOT_KEY = "xhsCommentInsightSummaryV1";
const COMMENT_ARCHIVE_RUN_KEYS = new Set([
  "schema", "runId", "batchId", "taskType", "runMode", "account",
  "startedAt", "finishedAt", "updatedAt", "xinghe", "status", "failures", "snapshots",
]);
const COMMENT_ARCHIVE_ACCOUNT_KEYS = new Set([
  "id", "name", "platform", "storeId", "storeName", "usernameMasked", "roleKeyword",
  "accountGroupId", "accountGroupName", "storeGroupId", "storeGroupName",
]);
const COMMENT_ARCHIVE_COUNT_KEYS = new Set([
  "commentCount", "classifiedCommentCount", "unclassifiedCommentCount", "newCommentCount",
  "capturedCommentCount", "candidateCount", "completedCount", "pendingContinuationCount",
  "failureCount", "noteCount", "newNoteCount", "hotNoteCount", "negativeFeedbackCount",
  "purchaseConcernCount", "unansweredQuestionCount",
]);
const COMMENT_ARCHIVE_CATEGORY_LABELS: Record<string, string> = {
  purchase_motivation: "购买动机",
  product_experience: "产品体验",
  price_promotion: "价格促销",
  fit_compatibility: "规格适配",
  usage_guidance: "使用方法",
  competitor_comparison: "竞品比较",
  shipping_after_sales: "物流售后",
  complaint_risk: "投诉风险",
};
const COMMENT_ARCHIVE_METRIC_COUNT_KEYS = new Set([
  "impressionCount", "commentCount", "interactionCount", "readCount",
  "likeCount", "collectCount", "shareCount", "capturedCount",
]);
const COMMENT_ARCHIVE_METRIC_DELTA_KEYS = new Set([
  "commentDelta", "nonCommentInteractionDelta", "readDelta",
]);
const COMMENT_ARCHIVE_METRIC_DATE_KEYS = new Set([
  "publishedAt", "platformUpdatedAt", "lastCommentCheckedAt", "capturedAt", "updatedAt",
]);
const COMMENT_ARCHIVE_CAPTURE_STATUSES = new Set([
  "baseline", "complete", "completed", "continuation", "failed", "partial", "paused",
  "waiting_login", "waiting_verification", "needs_login", "needs_verification",
  "pending", "running", "queued",
]);
const COMMENT_ARCHIVE_DISCOVERY_STATUSES = new Set([
  "new_note", "existing", "historical_backfill",
]);
const COMMENT_ARCHIVE_REASON_VALUES = new Set([
  "new_note", "comment_growth", "hot_top_20pct_due", "metric_missing",
  "platform_correction", "continuation",
]);
const COMMENT_ARCHIVE_SEMANTIC_CATEGORY_IDS = [
  ...Object.keys(COMMENT_ARCHIVE_CATEGORY_LABELS), "other",
];

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]";
}

function commentArchiveHasOnlyKeys(value: unknown, allowedKeys: Set<string>) {
  return isPlainRecord(value) && Object.keys(value).every((key) => allowedKeys.has(key));
}

function commentArchiveText(value: unknown, maximum: number, required = false) {
  return typeof value === "string" && value.length <= maximum && (!required || value.length > 0);
}

function commentArchiveSafeEvidenceText(value: unknown, maximum: number) {
  const normalized = String(value ?? "").normalize("NFKC").trim()
    .replace(/\s+/gu, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[邮箱]")
    .replace(/(^|[^\d])\s*1[3-9]\d{9}(?!\d)/gu, "$1[手机号]")
    .replace(/(^|[^\d])\s*\d{17}[\dXx](?!\d)/gu, "$1[证件号]")
    .replace(/(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*(?:(?:微信号?|微信|vx|wechat)\s*[:：]?[\s_-]*)?[A-Za-z][A-Za-z0-9_-]{5,19}/giu, "[微信号]");
  return Array.from(normalized).slice(0, maximum).join("");
}

function commentArchiveCounter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function commentArchiveTimestamp(value: unknown) {
  return commentArchiveText(value, 80, true) && Number.isFinite(Date.parse(value as string));
}

function commentArchiveOptional(value: unknown, validator: (item: unknown) => boolean) {
  return value === undefined || validator(value);
}

function commentArchiveStringList(value: unknown, allowed: Set<string>, maximumItems: number) {
  return Array.isArray(value) && value.length <= maximumItems &&
    value.every((item) => typeof item === "string" && allowed.has(item)) &&
    new Set(value).size === value.length;
}

function commentArchiveEvidence(value: unknown) {
  const record = asRecord(value);
  return commentArchiveHasOnlyKeys(value, new Set(["excerpt", "noteId", "commentId"])) &&
    commentArchiveText(record.excerpt, 160, true) &&
    record.excerpt === commentArchiveSafeEvidenceText(record.excerpt, 160) &&
    commentArchiveOptional(record.noteId, (item) => commentArchiveText(item, 160, true)) &&
    commentArchiveOptional(record.commentId, (item) => commentArchiveText(item, 240, true));
}

function commentArchiveCategories(value: unknown) {
  const ids = Object.keys(COMMENT_ARCHIVE_CATEGORY_LABELS);
  const record = asRecord(value);
  if (!commentArchiveHasOnlyKeys(value, new Set(ids)) ||
      !ids.every((id) => Object.prototype.hasOwnProperty.call(record, id))) return false;
  let evidenceCount = 0;
  for (const id of ids) {
    const category = asRecord(record[id]);
    if (!commentArchiveHasOnlyKeys(record[id], new Set(["label", "count", "evidence"])) ||
        category.label !== COMMENT_ARCHIVE_CATEGORY_LABELS[id] ||
        !commentArchiveCounter(category.count) || !Array.isArray(category.evidence) ||
        category.evidence.length > 3 || !category.evidence.every(commentArchiveEvidence)) return false;
    evidenceCount += category.evidence.length;
  }
  return evidenceCount <= 24;
}

function commentArchiveMetric(value: unknown) {
  const record = asRecord(value);
  const allowed = new Set([
    "noteId", "title", ...COMMENT_ARCHIVE_METRIC_DATE_KEYS,
    ...COMMENT_ARCHIVE_METRIC_COUNT_KEYS, ...COMMENT_ARCHIVE_METRIC_DELTA_KEYS,
    "discovery", "heatPinned", "heatTop20", "heatScore", "heatPercentiles",
    "corrections", "missingMetrics", "reasons", "captureStatus",
  ]);
  if (!commentArchiveHasOnlyKeys(value, allowed) ||
      !commentArchiveText(record.noteId, 160, true) ||
      !commentArchiveOptional(record.title, (item) => commentArchiveText(item, 500, true))) return false;
  for (const key of COMMENT_ARCHIVE_METRIC_DATE_KEYS) {
    if (!commentArchiveOptional(record[key], commentArchiveTimestamp)) return false;
  }
  for (const key of COMMENT_ARCHIVE_METRIC_COUNT_KEYS) {
    if (!commentArchiveOptional(record[key], commentArchiveCounter)) return false;
  }
  for (const key of COMMENT_ARCHIVE_METRIC_DELTA_KEYS) {
    if (record[key] !== undefined && record[key] !== null && !commentArchiveCounter(record[key])) return false;
  }
  if (!commentArchiveOptional(record.discovery, (item) => (
    typeof item === "string" && COMMENT_ARCHIVE_DISCOVERY_STATUSES.has(item)
  )) || !commentArchiveOptional(record.heatPinned, (item) => typeof item === "boolean") ||
      !commentArchiveOptional(record.heatTop20, (item) => typeof item === "boolean") ||
      !commentArchiveOptional(record.heatScore, (item) => commentArchiveCounter(item) && Number(item) <= 1) ||
      !commentArchiveOptional(record.captureStatus, (item) => (
        typeof item === "string" && COMMENT_ARCHIVE_CAPTURE_STATUSES.has(item)
      ))) return false;
  if (record.heatPercentiles !== undefined) {
    const percentiles = asRecord(record.heatPercentiles);
    const keys = new Set(["comments", "nonCommentInteractions", "reads"]);
    if (!commentArchiveHasOnlyKeys(record.heatPercentiles, keys) ||
        !Object.values(percentiles).every((item) => commentArchiveCounter(item) && Number(item) <= 1)) return false;
  }
  if (!commentArchiveOptional(record.corrections, (item) => commentArchiveStringList(
    item, COMMENT_ARCHIVE_METRIC_COUNT_KEYS, 7
  )) || !commentArchiveOptional(record.missingMetrics, (item) => commentArchiveStringList(
    item, COMMENT_ARCHIVE_METRIC_COUNT_KEYS, 7
  )) || !commentArchiveOptional(record.reasons, (item) => commentArchiveStringList(
    item, COMMENT_ARCHIVE_REASON_VALUES, 6
  ))) return false;
  return true;
}

function commentArchiveNoteState(value: unknown) {
  const record = asRecord(value);
  return commentArchiveHasOnlyKeys(value, new Set([
    "noteId", "title", "status", "capturedCount", "updatedAt",
  ])) && commentArchiveText(record.noteId, 160, true) &&
    commentArchiveOptional(record.title, (item) => commentArchiveText(item, 500, true)) &&
    commentArchiveOptional(record.status, (item) => (
      typeof item === "string" && COMMENT_ARCHIVE_CAPTURE_STATUSES.has(item)
    )) && commentArchiveOptional(record.capturedCount, commentArchiveCounter) &&
    commentArchiveOptional(record.updatedAt, commentArchiveTimestamp);
}

function commentArchiveSemantic(value: unknown) {
  const record = asRecord(value);
  const countKeys = new Set([
    "itemCount", "classifiedCount", "abstainedCount", "retryableCount",
    "purchaseIntentCount", "unresolvedQuestionCount",
  ]);
  const allowed = new Set([
    "status", "provider", "model", "promptVersion", "taxonomyVersion", "errorCode",
    ...countKeys, "sentimentCounts", "categoryCounts",
  ]);
  if (!commentArchiveHasOnlyKeys(value, allowed)) return false;
  for (const [key, maximum] of Object.entries({
    status: 80,
    provider: 80,
    model: 160,
    promptVersion: 80,
    taxonomyVersion: 80,
    errorCode: 120,
  })) {
    if (!commentArchiveOptional(record[key], (item) => commentArchiveText(item, maximum, true))) return false;
  }
  for (const key of countKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || !commentArchiveCounter(record[key])) return false;
  }
  const sentiments = new Set(["positive", "neutral", "negative"]);
  const sentimentCounts = asRecord(record.sentimentCounts);
  if (!commentArchiveHasOnlyKeys(record.sentimentCounts, sentiments) ||
      ![...sentiments].every((key) => commentArchiveCounter(sentimentCounts[key]))) return false;
  const categories = new Set(COMMENT_ARCHIVE_SEMANTIC_CATEGORY_IDS);
  const categoryCounts = asRecord(record.categoryCounts);
  return commentArchiveHasOnlyKeys(record.categoryCounts, categories) &&
    [...categories].every((key) => commentArchiveCounter(categoryCounts[key]));
}

function commentArchiveInterval(value: unknown) {
  const record = asRecord(value);
  return commentArchiveHasOnlyKeys(value, new Set([
    "from", "to", "days", "missedDays", "dailyAttribution", "label",
  ])) && commentArchiveOptional(record.from, commentArchiveTimestamp) &&
    commentArchiveOptional(record.to, commentArchiveTimestamp) &&
    commentArchiveOptional(record.days, commentArchiveCounter) &&
    commentArchiveOptional(record.missedDays, commentArchiveCounter) &&
    commentArchiveOptional(record.dailyAttribution, (item) => typeof item === "boolean") &&
    (record.label === "本次更新增量" || record.label === "自上次成功以来增量");
}

function validCommentArchiveSummary(value: unknown) {
  const record = asRecord(value);
  const allowed = new Set([
    "schema", "schemaVersion", "accountRef", "bindingSourceRunId", "generatedAt",
    "platformUpdatedAt", "interval", ...COMMENT_ARCHIVE_COUNT_KEYS,
    "categories", "noteMetrics", "noteStates", "semantic",
  ]);
  if (!commentArchiveHasOnlyKeys(value, allowed) || record.schema !== "CommentInsightSummaryV1" ||
      record.schemaVersion !== 1 || !/^[0-9a-f]{64}$/u.test(String(record.accountRef ?? "")) ||
      !commentArchiveTimestamp(record.generatedAt) || !commentArchiveCategories(record.categories) ||
      !Array.isArray(record.noteMetrics) || record.noteMetrics.length > 2000 ||
      !record.noteMetrics.every(commentArchiveMetric) || !Array.isArray(record.noteStates) ||
      record.noteStates.length > 2000 || !record.noteStates.every(commentArchiveNoteState)) return false;
  if (!commentArchiveOptional(record.bindingSourceRunId, (item) => commentArchiveText(item, 160, true)) ||
      !commentArchiveOptional(record.platformUpdatedAt, commentArchiveTimestamp) ||
      !commentArchiveOptional(record.interval, commentArchiveInterval) ||
      !commentArchiveOptional(record.semantic, commentArchiveSemantic)) return false;
  for (const key of COMMENT_ARCHIVE_COUNT_KEYS) {
    if (!commentArchiveOptional(record[key], commentArchiveCounter)) return false;
  }
  return true;
}

function validCommentArchiveRun(value: unknown) {
  const run = asRecord(value);
  const snapshots = asRecord(run.snapshots);
  const hasCommentSummary = Object.prototype.hasOwnProperty.call(
    snapshots, COMMENT_ARCHIVE_SNAPSHOT_KEY,
  );
  if (run.taskType !== "comment_monitor") return !hasCommentSummary;
  if (!commentArchiveHasOnlyKeys(value, COMMENT_ARCHIVE_RUN_KEYS) || run.schema !== 3 ||
      !/^store-run-[a-z0-9-]+$/iu.test(String(run.runId ?? "")) ||
      !commentArchiveText(run.batchId, 120, true) || run.runMode !== "current" ||
      (run.status !== "success" && run.status !== "partial") ||
      !commentArchiveCounter(run.startedAt) || !commentArchiveCounter(run.finishedAt) ||
      !commentArchiveCounter(run.updatedAt) || Number(run.startedAt) <= 0 ||
      Number(run.finishedAt) < Number(run.startedAt) ||
      Number(run.updatedAt) < Number(run.finishedAt)) return false;
  const account = asRecord(run.account);
  if (!commentArchiveHasOnlyKeys(run.account, COMMENT_ARCHIVE_ACCOUNT_KEYS) ||
      account.platform !== "xiaohongshu" || !commentArchiveText(account.storeId, 100, true) ||
      !commentArchiveText(account.storeName, 120, true) ||
      !Object.values(account).every((item) => typeof item === "string" && item.length <= 240)) return false;
  const xinghe = asRecord(run.xinghe);
  if (!commentArchiveHasOnlyKeys(run.xinghe, new Set(["state", "noPermission"])) ||
      !commentArchiveText(xinghe.state, 100) || typeof xinghe.noPermission !== "boolean" ||
      !Array.isArray(run.failures) || run.failures.length > 100 ||
      !run.failures.every((item) => commentArchiveText(item, 120, true))) return false;
  return Object.keys(snapshots).length === 1 && hasCommentSummary &&
    validCommentArchiveSummary(snapshots[COMMENT_ARCHIVE_SNAPSHOT_KEY]);
}

function assertCommentArchiveBoundary(value: unknown) {
  if (!validCommentArchiveRun(value)) {
    throw new ApiError(
      400,
      "COMMENT_ARCHIVE_SCHEMA_INVALID",
      "评论监测归档结构不符合脱敏 schema。",
    );
  }
}

function normalizedRunKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSensitiveRunKey(value: unknown) {
  const key = normalizedRunKey(value);
  if (
    SENSITIVE_RUN_KEYS.has(key) ||
    key === "xs" ||
    key === "xsign" ||
    key.includes("authorization") ||
    key.includes("credential")
  ) return true;
  const stems = ["token", "cookie", "cookies", "signature", "password", "secret"];
  const descriptors = ["", "value", "header", "hash", "data", "key", "param", "parameter"];
  return stems.some((stem) =>
    descriptors.some((descriptor) => key.endsWith(stem + descriptor)),
  );
}

function isForbiddenXhsStateKey(value: unknown) {
  const key = normalizedRunKey(value);
  return (
    FORBIDDEN_XHS_STATE_KEYS.has(key) ||
    key.startsWith("raw") ||
    key.startsWith("checkpoint")
  );
}

function isSafeClassificationArchiveCacheKey(value: unknown) {
  return typeof value === "string" &&
    /^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(value);
}

function isXhsDetailSnapshotKey(value: unknown) {
  const key = String(value ?? "");
  return key.startsWith(XHS_DETAIL_KEY_PREFIX) && /^\d{4,6}$/.test(
    key.slice(XHS_DETAIL_KEY_PREFIX.length),
  );
}

function stringContainsCredential(value: unknown) {
  if (typeof value !== "string") return false;
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/i.test(candidate)) return true;
    const assignment = /(?:[?&#]|\b)([a-z0-9_.%-]{1,160})["']?\s*[:=]/gi;
    let match: RegExpExecArray | null;
    while ((match = assignment.exec(candidate))) {
      let key = match[1];
      try {
        key = decodeURIComponent(key);
      } catch {
        key = match[1];
      }
      if (isSensitiveRunKey(key)) return true;
    }
    let decoded = candidate;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      decoded = candidate;
    }
    if (decoded === candidate) break;
    candidate = decoded;
  }
  return false;
}

function containsUrlControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isOfficialPgyNoteUrl(value: unknown, expectedNoteId: unknown) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    typeof expectedNoteId !== "string" ||
    expectedNoteId !== expectedNoteId.trim() ||
    !/^https:\/\/www\.xiaohongshu\.com\/explore\//.test(value) ||
    !/^[a-z0-9_-]{3,128}$/i.test(expectedNoteId) ||
    containsUrlControlCharacter(value)
  ) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const pathMatch = /^\/explore\/([a-z0-9_-]{3,128})$/i.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.xiaohongshu.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !pathMatch ||
    pathMatch[1] !== expectedNoteId
  ) return false;
  const rawQuery = url.search.slice(1);
  const sourceSuffix = "&xsec_source=pc_pgyexport";
  if (
    !rawQuery.startsWith("xsec_token=") ||
    !rawQuery.endsWith(sourceSuffix) ||
    rawQuery.indexOf("&") !== rawQuery.length - sourceSuffix.length
  ) return false;
  const token = String(url.searchParams.get("xsec_token") || "");
  return (
    token.length >= 8 &&
    token.length <= 2048 &&
    !/\s/.test(token) &&
    !containsUrlControlCharacter(token) &&
    url.searchParams.getAll("xsec_token").length === 1 &&
    url.searchParams.getAll("xsec_source").length === 1
  );
}

function assertNoRunCredentials(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
) {
  if (depth > 64) {
    throw new ApiError(400, "RUN_TOO_DEEP", "历史归档嵌套层级过深。");
  }
  if (stringContainsCredential(value)) {
    throw new ApiError(
      400,
      "RUN_CONTAINS_SECRET",
      "历史归档包含敏感凭据或签名链接。",
    );
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item) => assertNoRunCredentials(item, depth + 1, seen));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveRunKey(key)) {
      throw new ApiError(
        400,
        "RUN_CONTAINS_SECRET",
        "历史归档包含敏感凭据或签名链接。",
      );
    }
    if (
      key === "noteUrl" &&
      Object.prototype.hasOwnProperty.call(value, "noteId") &&
      isOfficialPgyNoteUrl(child, (value as Record<string, unknown>).noteId)
    ) continue;
    assertNoRunCredentials(child, depth + 1, seen);
  }
}

function assertNoXhsRawState(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  context = "",
) {
  if (depth > 64) {
    throw new ApiError(400, "RUN_TOO_DEEP", "历史归档嵌套层级过深。");
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    const itemContext = context === "classificationEntries" ? "classificationEntry" : "";
    value.forEach((item) => assertNoXhsRawState(item, depth + 1, seen, itemContext));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const classificationArchive = record.schema === "xhsSearchClassificationArchiveV1" &&
    Number(record.schemaVersion) === 1 && Array.isArray(record.entries);
  for (const [key, child] of Object.entries(record)) {
    if (isForbiddenXhsStateKey(key)) {
      if (normalizedRunKey(key) === "cachekey" && context === "classificationEntry" &&
          isSafeClassificationArchiveCacheKey(child)) continue;
      throw new ApiError(
        400,
        "RUN_CONTAINS_XHS_RAW_STATE",
        "小红书快照包含不应上传的 raw/checkpoint 原始分页状态。",
      );
    }
    const childContext = classificationArchive && key === "entries"
      ? "classificationEntries"
      : "";
    assertNoXhsRawState(child, depth + 1, seen, childContext);
  }
}

export function assertRunPayloadSafe(value: unknown) {
  assertNoRunCredentials(value);
  assertCommentArchiveBoundary(value);
  const snapshots = asRecord(asRecord(value).snapshots);
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!XHS_SNAPSHOT_KEYS.has(key) && !isXhsDetailSnapshotKey(key)) continue;
    let serialized = "";
    try {
      serialized = JSON.stringify(snapshot);
    } catch {
      throw new ApiError(
        400,
        "XHS_SNAPSHOT_INVALID",
        "小红书快照不是可存储的 JSON 数据。",
      );
    }
    if (
      !serialized ||
      new TextEncoder().encode(serialized).byteLength >=
        MAX_XHS_SNAPSHOT_BYTES
    ) {
      throw new ApiError(
        413,
        "XHS_SNAPSHOT_TOO_LARGE",
        "小红书快照超过 8MB 安全限制。",
      );
    }
    assertNoXhsRawState(snapshot);
  }
}

function firstValue(...values: unknown[]) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function timestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(String(value));
  const time = date.getTime();
  if (!Number.isFinite(time) || time <= 0 || time >= 4_102_444_800_000) {
    return null;
  }
  return date;
}

function safeCount(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return fallback;
  return Math.min(number, 100_000);
}

export function validateRunId(value: unknown) {
  const runId = cleanText(value, 120);
  if (!/^store-run-[a-z0-9-]+$/i.test(runId)) {
    throw new ApiError(400, "INVALID_RUN_ID", "店铺归档编号无效。");
  }
  return runId;
}

export function extractRunMetadata(runValue: unknown, metadataValue: unknown) {
  const run = requireObject(runValue, "run 必须是 JSON 对象。");
  assertRunPayloadSafe(run);
  const metadata = asRecord(metadataValue);
  const account = asRecord(run.account);
  const runId = validateRunId(firstValue(metadata.runId, run.runId));
  const startedAt = timestamp(firstValue(metadata.startedAt, run.startedAt));
  const finishedAt = timestamp(firstValue(metadata.finishedAt, run.finishedAt));
  const sourceUpdatedAt =
    timestamp(firstValue(metadata.updatedAt, run.updatedAt)) ??
    finishedAt ??
    startedAt ??
    new Date();
  const failures = Array.isArray(run.failures) ? run.failures : [];

  return {
    id: runId,
    batchId: cleanText(firstValue(metadata.batchId, run.batchId), 120),
    runMode: cleanText(firstValue(metadata.runMode, run.runMode), 40),
    accountId: cleanText(firstValue(metadata.accountId, account.id), 120),
    accountName: cleanText(firstValue(metadata.accountName, account.name), 200),
    usernameMasked: cleanText(
      firstValue(metadata.usernameMasked, account.usernameMasked),
      160,
    ),
    accountGroupId: cleanText(
      firstValue(metadata.accountGroupId, account.accountGroupId),
      120,
    ),
    accountGroupName: cleanText(
      firstValue(metadata.accountGroupName, account.accountGroupName),
      200,
    ),
    storeId: cleanText(firstValue(metadata.storeId, account.storeId), 120),
    storeName: cleanText(firstValue(metadata.storeName, account.storeName), 200),
    storeGroupId: cleanText(
      firstValue(metadata.storeGroupId, account.storeGroupId),
      120,
    ),
    storeGroupName: cleanText(
      firstValue(metadata.storeGroupName, account.storeGroupName),
      200,
    ),
    taskType: cleanText(firstValue(metadata.taskType, run.taskType), 40),
    status: cleanText(firstValue(metadata.status, run.status), 40),
    startedAt,
    finishedAt,
    sourceUpdatedAt,
    failureCount: safeCount(metadata.failureCount, failures.length),
  };
}

function timeMs(value: Date | null) {
  return value ? value.getTime() : 0;
}

export function serializeRunMetadata(row: RunRow) {
  return {
    runId: row.id,
    batchId: row.batchId,
    taskType: row.taskType,
    runMode: row.runMode,
    accountId: row.accountId,
    accountName: row.accountName,
    storeId: row.storeId,
    storeName: row.storeName,
    usernameMasked: row.usernameMasked,
    accountGroupId: row.accountGroupId,
    accountGroupName: row.accountGroupName,
    storeGroupId: row.storeGroupId,
    storeGroupName: row.storeGroupName,
    startedAt: timeMs(row.startedAt),
    finishedAt: timeMs(row.finishedAt),
    updatedAt:
      timeMs(row.sourceUpdatedAt) ||
      timeMs(row.finishedAt) ||
      timeMs(row.updatedAt),
    status: row.status,
    failureCount: row.failureCount,
    payloadBytes: row.payloadBytes,
  };
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
