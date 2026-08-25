import { ApiError, requireObject } from "./http";
import type { runs } from "@/db/schema";

type RunRow = typeof runs.$inferSelect;

const MAX_XHS_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const XHS_DETAIL_KEY_PREFIX = "xhsAnalysisDetailChunkV1:";
const XHS_SNAPSHOT_KEYS = new Set([
  "xhsAnalysisSnapshotV1",
  "xhsCollectionStatusV1",
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

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
    assertNoRunCredentials(child, depth + 1, seen);
  }
}

function assertNoXhsRawState(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
) {
  if (depth > 64) {
    throw new ApiError(400, "RUN_TOO_DEEP", "历史归档嵌套层级过深。");
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item) => assertNoXhsRawState(item, depth + 1, seen));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenXhsStateKey(key)) {
      throw new ApiError(
        400,
        "RUN_CONTAINS_XHS_RAW_STATE",
        "小红书快照包含不应上传的 raw/checkpoint 原始分页状态。",
      );
    }
    assertNoXhsRawState(child, depth + 1, seen);
  }
}

export function assertRunPayloadSafe(value: unknown) {
  assertNoRunCredentials(value);
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
