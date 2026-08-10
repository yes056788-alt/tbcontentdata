import { desc, eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import { revokeMemberSessions } from "@/app/server/auth";
import {
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
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
  validateEmail,
  validateManagedRole,
  validateMemberStatus,
} from "@/app/server/member-admin";
import { getDb } from "@/runtime-db";
import { localAccounts, members } from "@/db/schema";

type MemberRow = {
  member: typeof members.$inferSelect;
  account: typeof localAccounts.$inferSelect | null;
};

function publicMember(row: MemberRow) {
  return {
    id: row.member.id,
    userId: row.member.id,
    username: row.account?.username ?? null,
    email: row.member.email.endsWith("@local.invalid")
      ? null
      : row.member.email,
    displayName: row.member.displayName,
    name: row.member.displayName,
    role: row.member.role,
    status: row.member.status,
    mustChangePassword: row.account?.mustChangePassword ?? null,
    failedLoginAttempts: row.account?.failedLoginAttempts ?? null,
    lockedUntil: row.account?.lockedUntil ?? null,
    createdAt: row.member.createdAt,
    updatedAt: row.member.updatedAt,
    lastSeenAt: row.member.lastSeenAt,
  };
}

async function rowByMemberId(memberId: string): Promise<MemberRow | null> {
  const [row] = await getDb()
    .select({ member: members, account: localAccounts })
    .from(members)
    .leftJoin(localAccounts, eq(localAccounts.memberId, members.id))
    .where(eq(members.id, memberId))
    .limit(1);
  return row ?? null;
}

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, workspaceManagers);
    const rows = await getDb()
      .select({ member: members, account: localAccounts })
      .from(members)
      .leftJoin(localAccounts, eq(localAccounts.memberId, members.id))
      .orderBy(desc(members.createdAt), desc(members.id));
    return jsonResponse({
      members: rows.map(publicMember),
      invites: [],
    });
  });
}

export async function POST(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const username = validateUsername(body.username);
    const temporaryPassword = validatePassword(
      body.temporaryPassword ?? body.password,
      "temporaryPassword",
    );
    const role = validateManagedRole(body.role, "admin");
    const displayName = String(body.displayName ?? username.username)
      .trim()
      .slice(0, 200) || username.username;
    const generatedMemberId = crypto.randomUUID();
    const email =
      body.email === undefined || body.email === ""
        ? `${generatedMemberId}@local.invalid`
        : validateEmail(body.email);
    const db = getDb();
    const [existingUsername] = await db
      .select({ memberId: localAccounts.memberId })
      .from(localAccounts)
      .where(eq(localAccounts.usernameNormalized, username.normalized))
      .limit(1);
    if (existingUsername) {
      throw new ApiError(409, "USERNAME_EXISTS", "该用户名已存在。");
    }
    const [existingEmailMember] = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);
    if (existingEmailMember) {
      const [existingCredential] = await db
        .select({ memberId: localAccounts.memberId })
        .from(localAccounts)
        .where(eq(localAccounts.memberId, existingEmailMember.id))
        .limit(1);
      if (existingCredential) {
        throw new ApiError(409, "EMAIL_EXISTS", "该邮箱已有本地登录账号。");
      }
      if (existingEmailMember.role === "owner") {
        throw new ApiError(
          409,
          "OWNER_CREDENTIAL_REQUIRED",
          "所有者账号必须通过首次初始化流程绑定。",
        );
      }
    }

    const memberId = existingEmailMember?.id ?? generatedMemberId;

    const password = await hashPassword(temporaryPassword);
    const now = new Date();
    try {
      const accountInsert = db.insert(localAccounts).values({
          memberId,
          username: username.username,
          usernameNormalized: username.normalized,
          passwordSalt: password.salt,
          passwordHash: password.hash,
          passwordIterations: password.iterations,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      if (existingEmailMember) {
        await db.batch([
          db
            .update(members)
            .set({
              userId: null,
              displayName,
              role,
              status: "active",
              invitedBy: session.member.id,
              updatedAt: now,
            })
            .where(eq(members.id, memberId)),
          accountInsert,
        ]);
      } else {
        await db.batch([
          db.insert(members).values({
            id: memberId,
            userId: null,
            email,
            displayName,
            role,
            status: "active",
            invitedBy: session.member.id,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: null,
          }),
          accountInsert,
        ]);
      }
    } catch (error) {
      const [winner] = await db
        .select({ memberId: localAccounts.memberId })
        .from(localAccounts)
        .where(eq(localAccounts.usernameNormalized, username.normalized))
        .limit(1);
      if (winner) {
        throw new ApiError(409, "USERNAME_EXISTS", "该用户名已存在。");
      }
      throw error;
    }
    const created = await rowByMemberId(memberId);
    if (!created) {
      throw new ApiError(500, "MEMBER_CREATE_FAILED", "成员创建失败。");
    }
    await writeAudit(
      session,
      existingEmailMember ? "member.local_account_bound" : "member.created",
      "member",
      memberId,
      {
      role,
      status: "active",
      mustChangePassword: true,
      },
    );
    return jsonResponse({ member: publicMember(created), invite: null }, 201);
  });
}

export async function PATCH(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const id = typeof body.id === "string" ? body.id.trim().slice(0, 120) : "";
    const normalizedUsername =
      body.username === undefined
        ? ""
        : normalizeUsername(String(body.username));
    const email = body.email === undefined ? "" : validateEmail(body.email);
    let target: MemberRow | null = null;
    if (id) {
      target = await rowByMemberId(id);
    } else if (normalizedUsername) {
      const [account] = await getDb()
        .select({ memberId: localAccounts.memberId })
        .from(localAccounts)
        .where(eq(localAccounts.usernameNormalized, normalizedUsername))
        .limit(1);
      if (account) target = await rowByMemberId(account.memberId);
    } else if (email) {
      const [member] = await getDb()
        .select({ id: members.id })
        .from(members)
        .where(eq(members.email, email))
        .limit(1);
      if (member) target = await rowByMemberId(member.id);
    } else {
      throw new ApiError(
        400,
        "MEMBER_SELECTOR_REQUIRED",
        "请提供成员 id、用户名或邮箱。",
      );
    }
    if (!target) {
      throw new ApiError(404, "MEMBER_NOT_FOUND", "未找到成员。");
    }
    if (target.member.role === "owner") {
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
    if (
      target.member.id === session.member.id &&
      requestedStatus === "disabled"
    ) {
      throw new ApiError(409, "SELF_DISABLE_BLOCKED", "不能停用自己的账号。");
    }

    const now = new Date();
    await getDb()
      .update(members)
      .set({
        ...(requestedRole ? { role: requestedRole } : {}),
        ...(requestedStatus ? { status: requestedStatus } : {}),
        updatedAt: now,
      })
      .where(eq(members.id, target.member.id));
    if (requestedStatus === "disabled") {
      await revokeMemberSessions(target.member.id);
    }
    const updated = await rowByMemberId(target.member.id);
    if (!updated) {
      throw new ApiError(500, "MEMBER_UPDATE_FAILED", "成员更新失败。");
    }
    await writeAudit(session, "member.updated", "member", updated.member.id, {
      role: updated.member.role,
      status: updated.member.status,
    });
    return jsonResponse({ member: publicMember(updated), invite: null });
  });
}
