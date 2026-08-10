import { ApiError, requireObject } from "./http";
import type { runs } from "@/db/schema";

type RunRow = typeof runs.$inferSelect;

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertNoPasswords(value: unknown, depth = 0) {
  if (depth > 64) {
    throw new ApiError(400, "RUN_TOO_DEEP", "历史归档嵌套层级过深。");
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoPasswords(item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKey === "password" || normalizedKey === "masterpassword") {
      throw new ApiError(
        400,
        "RUN_CONTAINS_PASSWORD",
        "历史归档不能包含密码字段。",
      );
    }
    assertNoPasswords(child, depth + 1);
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
  assertNoPasswords(run);
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
