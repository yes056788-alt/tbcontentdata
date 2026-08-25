import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "@/runtime-db";
import {
  authSessions,
  localAccounts,
  members,
  memberRoles,
  type MemberRole,
} from "@/db/schema";
import { assertSameOrigin, sessionTokenFromRequest } from "./auth";
import { sha256Hex } from "./auth-crypto";
import { ApiError } from "./http";
import { isLocalAccountRole } from "./local-account-role";

export type MemberRecord = typeof members.$inferSelect;
export type LocalAccountRecord = typeof localAccounts.$inferSelect;
export type AuthSessionRecord = typeof authSessions.$inferSelect;

export type AppSession = {
  user: {
    id: string;
    userId: string;
    username: string;
    email: string;
    displayName: string;
  };
  member: MemberRecord;
  account: LocalAccountRecord;
  session: AuthSessionRecord;
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isMemberRole(value: unknown): value is MemberRole {
  return (
    typeof value === "string" &&
    (memberRoles as readonly string[]).includes(value)
  );
}

export function permissionsForRole(role: MemberRole) {
  const managesWorkspace = role === "owner" || role === "admin";
  const operates = managesWorkspace || role === "operator";
  return {
    manageMembers: managesWorkspace,
    readVault: operates,
    writeVault: managesWorkspace,
    readRuns: true,
    writeRuns: operates,
    deleteRuns: managesWorkspace,
    readAudit: managesWorkspace,
    canReadVault: operates,
    canWriteVault: managesWorkspace,
    canWriteDirectory: managesWorkspace,
    canReadRuns: true,
    canWriteRuns: operates,
    canDeleteRuns: managesWorkspace,
  };
}

type SessionOptions = {
  allowPasswordChangeRequired?: boolean;
};

export async function requireSession(
  request: Request,
  allowedRoles: readonly MemberRole[] = memberRoles,
  options: SessionOptions = {},
): Promise<AppSession> {
  assertSameOrigin(request);
  const token = sessionTokenFromRequest(request);
  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "请先登录后再访问。", {
      loginPath: "/api/auth/login",
    });
  }
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const db = getDb();
  const [row] = await db
    .select({
      session: authSessions,
      member: members,
      account: localAccounts,
    })
    .from(authSessions)
    .innerJoin(members, eq(members.id, authSessions.memberId))
    .innerJoin(localAccounts, eq(localAccounts.memberId, members.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ApiError(401, "SESSION_INVALID", "登录会话已失效，请重新登录。", {
      loginPath: "/api/auth/login",
    });
  }
  if (row.member.status !== "active") {
    throw new ApiError(403, "MEMBER_DISABLED", "当前成员权限已被停用。");
  }
  if (!isLocalAccountRole(row.member.role)) {
    throw new ApiError(
      403,
      "LOCAL_ACCOUNT_ROLE_UNSUPPORTED",
      "当前版本仅支持所有者或管理员登录，请联系管理员调整角色。",
    );
  }
  if (
    row.account.mustChangePassword &&
    !options.allowPasswordChangeRequired
  ) {
    throw new ApiError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "首次登录必须先修改临时密码。",
      { changePasswordPath: "/api/auth/change-password" },
    );
  }
  if (!allowedRoles.includes(row.member.role)) {
    throw new ApiError(403, "INSUFFICIENT_ROLE", "当前角色无权执行此操作。", {
      role: row.member.role,
    });
  }

  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  if (row.session.lastSeenAt < staleBefore) {
    await Promise.all([
      db
        .update(authSessions)
        .set({ lastSeenAt: now })
        .where(
          and(
            eq(authSessions.id, row.session.id),
            lt(authSessions.lastSeenAt, staleBefore),
          ),
        ),
      db
        .update(members)
        .set({ lastSeenAt: now })
        .where(eq(members.id, row.member.id)),
    ]);
  }

  return {
    user: {
      id: row.member.id,
      userId: row.member.id,
      username: row.account.username,
      email: row.member.email,
      displayName: row.member.displayName || row.account.username,
    },
    member: row.member,
    account: row.account,
    session: row.session,
  };
}

export const workspaceManagers: readonly MemberRole[] = ["owner", "admin"];
export const vaultReaders: readonly MemberRole[] = [
  "owner",
  "admin",
  "operator",
];
export const runWriters: readonly MemberRole[] = [
  "owner",
  "admin",
  "operator",
];
