import { eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import { revokeMemberSessions } from "@/app/server/auth";
import {
  hashPassword,
  validatePassword,
} from "@/app/server/auth-crypto";
import { requireSession, workspaceManagers } from "@/app/server/authz";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import {
  validateManagedRole,
  validateMemberStatus,
} from "@/app/server/member-admin";
import { isManagedLocalAccountRole } from "@/app/server/local-account-role";
import { getDb } from "@/runtime-db";
import { localAccounts, members } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

function publicMember(
  member: typeof members.$inferSelect,
  account: typeof localAccounts.$inferSelect,
) {
  return {
    id: member.id,
    userId: member.id,
    username: account.username,
    email: member.email.endsWith("@local.invalid") ? null : member.email,
    name: member.displayName,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    mustChangePassword: account.mustChangePassword,
    failedLoginAttempts: account.failedLoginAttempts,
    lockedUntil: account.lockedUntil,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    lastSeenAt: member.lastSeenAt,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const params = await context.params;
    const memberId = String(params.id ?? "").trim().slice(0, 120);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const db = getDb();
    const [row] = await db
      .select({ member: members, account: localAccounts })
      .from(members)
      .innerJoin(localAccounts, eq(localAccounts.memberId, members.id))
      .where(eq(members.id, memberId))
      .limit(1);
    if (!row) {
      throw new ApiError(404, "MEMBER_NOT_FOUND", "未找到成员账号。");
    }

    if (body.resetPassword !== undefined || body.temporaryPassword !== undefined) {
      if (row.member.role === "owner") {
        throw new ApiError(
          409,
          "OWNER_PASSWORD_RESET_BLOCKED",
          "所有者请通过修改密码接口更新自己的密码。",
        );
      }
      if (!isManagedLocalAccountRole(row.member.role)) {
        throw new ApiError(
          409,
          "LOCAL_ACCOUNT_ROLE_UNSUPPORTED",
          "请先将该成员角色调整为 admin，再重置登录密码。",
        );
      }
      if (row.member.id === session.member.id) {
        throw new ApiError(
          409,
          "SELF_PASSWORD_RESET_BLOCKED",
          "请通过修改密码接口更新自己的密码。",
        );
      }
      const temporaryPassword = validatePassword(
        body.resetPassword ?? body.temporaryPassword,
        "resetPassword",
      );
      const password = await hashPassword(temporaryPassword);
      const now = new Date();
      await db
        .update(localAccounts)
        .set({
          passwordSalt: password.salt,
          passwordHash: password.hash,
          passwordIterations: password.iterations,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(localAccounts.memberId, memberId));
      await revokeMemberSessions(memberId);
      await writeAudit(session, "member.password_reset", "member", memberId, {
        role: row.member.role,
        status: row.member.status,
        mustChangePassword: true,
      });
      const account = {
        ...row.account,
        passwordSalt: password.salt,
        passwordHash: password.hash,
        passwordIterations: password.iterations,
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now,
        updatedAt: now,
      };
      return jsonResponse({
        reset: true,
        member: publicMember(row.member, account),
      });
    }

    if (row.member.role === "owner") {
      throw new ApiError(
        409,
        "OWNER_IMMUTABLE",
        "工作区所有者不能被停用或降级。",
      );
    }
    const requestedRole =
      body.role === undefined ? undefined : validateManagedRole(body.role);
    const requestedStatus = validateMemberStatus(body.status);
    if (!requestedRole && !requestedStatus) {
      throw new ApiError(400, "NO_CHANGES", "请提供需要更新的角色或状态。");
    }
    if (row.member.id === session.member.id && requestedStatus === "disabled") {
      throw new ApiError(409, "SELF_DISABLE_BLOCKED", "不能停用自己的账号。");
    }
    const now = new Date();
    const [updated] = await db
      .update(members)
      .set({
        ...(requestedRole ? { role: requestedRole } : {}),
        ...(requestedStatus ? { status: requestedStatus } : {}),
        updatedAt: now,
      })
      .where(eq(members.id, memberId))
      .returning();
    if (!updated) {
      throw new ApiError(500, "MEMBER_UPDATE_FAILED", "成员更新失败。");
    }
    if (requestedStatus === "disabled") await revokeMemberSessions(memberId);
    await writeAudit(session, "member.updated", "member", memberId, {
      role: updated.role,
      status: updated.status,
    });
    return jsonResponse({ member: publicMember(updated, row.account) });
  });
}
