import { eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import { revokeMemberSessions } from "@/app/server/auth";
import {
  hashPassword,
  validatePassword,
} from "@/app/server/auth-crypto";
import { requireSession, workspaceManagers } from "@/app/server/authz";
import { isManagedLocalAccountRole } from "@/app/server/local-account-role";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { getDb } from "@/runtime-db";
import { localAccounts, members } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: Request, context: RouteContext) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const { id } = await context.params;
    const memberId = String(id ?? "").trim().slice(0, 120);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const temporaryPassword = validatePassword(
      body.temporaryPassword ?? body.password,
      "temporaryPassword",
    );
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
    return jsonResponse({
      reset: true,
      memberId,
      mustChangePassword: true,
    });
  });
}
