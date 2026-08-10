import { ApiError } from "./http";
import { normalizeEmail } from "./authz";
import { isManagedLocalAccountRole } from "./local-account-role";
import type { MemberRole, MemberStatus } from "@/db/schema";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: unknown) {
  const email = normalizeEmail(String(value ?? ""));
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, "INVALID_EMAIL", "请输入有效的登录邮箱。");
  }
  return email;
}

export function validateManagedRole(
  value: unknown,
  defaultRole?: MemberRole,
): "admin" {
  const role = value === undefined ? defaultRole : value;
  if (!isManagedLocalAccountRole(role)) {
    throw new ApiError(
      400,
      "LOCAL_ACCOUNT_ROLE_UNSUPPORTED",
      "当前版本仅支持管理员账号，role 必须为 admin。",
    );
  }
  return role;
}

export function validateMemberStatus(
  value: unknown,
): MemberStatus | undefined {
  if (value === undefined) return undefined;
  if (value !== "active" && value !== "disabled") {
    throw new ApiError(
      400,
      "INVALID_STATUS",
      "成员状态必须是 active 或 disabled。",
    );
  }
  return value;
}
