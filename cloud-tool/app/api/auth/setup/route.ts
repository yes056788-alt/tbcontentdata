import { eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import {
  assertSameOrigin,
  createSession,
  sessionCookie,
  verifyBootstrapToken,
} from "@/app/server/auth";
import {
  hashPassword,
  validatePassword,
  validateUsername,
} from "@/app/server/auth-crypto";
import { permissionsForRole, type AppSession } from "@/app/server/authz";
import { validateEmail } from "@/app/server/member-admin";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { getDb } from "@/runtime-db";
import { localAccounts, members, workspaceState } from "@/db/schema";

const WORKSPACE_ROW_ID = 1;

function localEmail(memberId: string) {
  return `${memberId}@local.invalid`;
}

export async function GET() {
  return withApiErrors(async () => {
    const [account] = await getDb().select().from(localAccounts).limit(1);
    return jsonResponse({ setupRequired: !account });
  });
}

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    await verifyBootstrapToken(body.bootstrapToken ?? body.token);
    const username = validateUsername(body.username);
    const password = validatePassword(body.password);
    const displayName = String(body.displayName ?? username.username)
      .trim()
      .slice(0, 200) || username.username;
    const db = getDb();
    const [existingAccount] = await db.select().from(localAccounts).limit(1);
    if (existingAccount) {
      throw new ApiError(
        409,
        "SETUP_ALREADY_COMPLETED",
        "工作区本地账号已经初始化。",
      );
    }

    const [state] = await db
      .select()
      .from(workspaceState)
      .where(eq(workspaceState.id, WORKSPACE_ROW_ID))
      .limit(1);
    const [existingOwner] = state
      ? await db
          .select()
          .from(members)
          .where(eq(members.id, state.ownerMemberId))
          .limit(1)
      : await db
          .select()
          .from(members)
          .where(eq(members.role, "owner"))
          .limit(1);
    const memberId = state?.ownerMemberId ?? existingOwner?.id ?? crypto.randomUUID();
    const email =
      body.email === undefined || body.email === ""
        ? localEmail(memberId)
        : validateEmail(body.email);
    const [emailOwner] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, email))
      .limit(1);
    if (emailOwner && emailOwner.id !== memberId) {
      throw new ApiError(409, "EMAIL_EXISTS", "该邮箱已被其他成员使用。");
    }
    const passwordRecord = await hashPassword(password);
    const now = new Date();
    const accountValues = {
      memberId,
      username: username.username,
      usernameNormalized: username.normalized,
      passwordSalt: passwordRecord.salt,
      passwordHash: passwordRecord.hash,
      passwordIterations: passwordRecord.iterations,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    } as const;
    const memberValues = {
      id: memberId,
      userId: null,
      email,
      displayName,
      role: "owner" as const,
      status: "active" as const,
      invitedBy: null,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };

    try {
      if (state && existingOwner) {
        await db.batch([
          db
            .update(members)
            .set({
              userId: null,
              email: memberValues.email,
              displayName,
              role: "owner",
              status: "active",
              updatedAt: now,
              lastSeenAt: now,
            })
            .where(eq(members.id, memberId)),
          db.insert(localAccounts).values(accountValues),
        ]);
      } else if (state) {
        await db.batch([
          db.insert(members).values(memberValues),
          db.insert(localAccounts).values(accountValues),
        ]);
      } else if (existingOwner) {
        await db.batch([
          db.insert(workspaceState).values({
            id: WORKSPACE_ROW_ID,
            ownerMemberId: memberId,
            createdAt: now,
            updatedAt: now,
          }),
          db
            .update(members)
            .set({
              userId: null,
              email: memberValues.email,
              displayName,
              role: "owner",
              status: "active",
              updatedAt: now,
              lastSeenAt: now,
            })
            .where(eq(members.id, memberId)),
          db.insert(localAccounts).values(accountValues),
        ]);
      } else {
        await db.batch([
          db.insert(workspaceState).values({
            id: WORKSPACE_ROW_ID,
            ownerMemberId: memberId,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(members).values(memberValues),
          db.insert(localAccounts).values(accountValues),
        ]);
      }
    } catch (error) {
      const [winner] = await db.select().from(localAccounts).limit(1);
      if (winner) {
        throw new ApiError(
          409,
          "SETUP_ALREADY_COMPLETED",
          "工作区本地账号已经初始化。",
        );
      }
      throw error;
    }

    const [[member], [account]] = await Promise.all([
      db.select().from(members).where(eq(members.id, memberId)).limit(1),
      db
        .select()
        .from(localAccounts)
        .where(eq(localAccounts.memberId, memberId))
        .limit(1),
    ]);
    if (!member || !account) {
      throw new ApiError(500, "SETUP_FAILED", "工作区初始化失败。");
    }
    const createdSession = await createSession(memberId);
    const session: AppSession = {
      user: {
        id: memberId,
        userId: memberId,
        username: account.username,
        email: member.email,
        displayName: member.displayName,
      },
      member,
      account,
      session: createdSession.record,
    };
    await writeAudit(session, "auth.setup", "workspace", "default", {
      role: "owner",
      status: "active",
    });
    return jsonResponse(
      {
        user: session.user,
        member: {
          id: member.id,
          username: account.username,
          displayName: member.displayName,
          role: member.role,
          status: member.status,
        },
        role: member.role,
        mustChangePassword: false,
        permissions: permissionsForRole(member.role),
      },
      201,
      { "Set-Cookie": sessionCookie(createdSession.token) },
    );
  });
}
