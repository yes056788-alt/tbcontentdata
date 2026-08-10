import { ApiError, requireObject } from "./http";

const FORBIDDEN_KEYS = new Set([
  "account",
  "accounts",
  "password",
  "passwd",
  "secret",
  "token",
  "cookie",
  "cookies",
  "webhook",
  "masterpassword",
]);

function assertNoSecrets(value: unknown, depth = 0) {
  if (depth > 8) {
    throw new ApiError(400, "INVALID_DIRECTORY", "项目目录嵌套层级过深。");
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoSecrets(item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new ApiError(
        400,
        "DIRECTORY_CONTAINS_SECRET",
        `项目目录不能包含敏感字段 ${key}。`,
      );
    }
    assertNoSecrets(child, depth + 1);
  }
}

export function validateDirectory(value: unknown): Record<string, unknown> {
  const directory = requireObject(value, "directory 必须是 JSON 对象。");
  if (
    directory.schema !== undefined &&
    (!Number.isSafeInteger(directory.schema) || Number(directory.schema) < 1)
  ) {
    throw new ApiError(400, "INVALID_DIRECTORY", "directory.schema 无效。");
  }
  assertNoSecrets(directory);
  return directory;
}
