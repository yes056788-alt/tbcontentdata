import { ApiError } from "./http";
import { runtimeValue } from "./runtime-config";

export {
  createOpaqueSessionToken,
  LOGIN_FAILURE_LIMIT,
  LOGIN_LOCK_MILLISECONDS,
  normalizeUsername,
  nextLoginFailureState,
  passwordMeetsPolicy,
  PASSWORD_ITERATIONS,
  secureTextEqual,
  SESSION_DURATION_SECONDS,
  sha256Hex,
} from "./auth-primitives";

import {
  hashPassword as hashPasswordPrimitive,
  normalizeUsername,
  passwordMeetsPolicy,
  verifyPassword as verifyPasswordPrimitive,
} from "./auth-primitives";

function credentialPassword(value: string) {
  const pepper = runtimeValue("PASSWORD_PEPPER");
  if (!pepper || pepper.length < 32) {
    throw new ApiError(
      503,
      "PASSWORD_AUTH_NOT_CONFIGURED",
      "账号密码服务尚未完成安全配置，请联系管理员。",
    );
  }
  return `${value}\u0000${pepper}`;
}

export function hashPassword(password: string) {
  return hashPasswordPrimitive(credentialPassword(password));
}

export function verifyPassword(
  password: string,
  saltBase64: string,
  expectedHashBase64: string,
  iterations: number,
) {
  return verifyPasswordPrimitive(
    credentialPassword(password),
    saltBase64,
    expectedHashBase64,
    iterations,
  );
}

export function validateUsername(value: unknown) {
  const username = String(value ?? "").normalize("NFKC").trim();
  const normalized = normalizeUsername(username);
  const length = Array.from(normalized).length;
  if (
    length < 3 ||
    length > 64 ||
    !/^[\p{L}\p{N}._-]+$/u.test(normalized)
  ) {
    throw new ApiError(
      400,
      "INVALID_USERNAME",
      "用户名需为 3–64 位字母、数字、中文、点、下划线或连字符。",
    );
  }
  return { username, normalized };
}

export function validatePassword(value: unknown, field = "password") {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_PASSWORD", `${field} 必须是字符串。`);
  }
  if (!passwordMeetsPolicy(value)) {
    throw new ApiError(
      400,
      "INVALID_PASSWORD",
      `${field} 需为 16–256 位，且包含字母、数字和特殊字符。`,
    );
  }
  return value;
}
