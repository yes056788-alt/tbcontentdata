import { eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import { createSession, assertSameOrigin, sessionCookie } from "@/app/server/auth";
import {
  LOGIN_FAILURE_LIMIT,
  nextLoginFailureState,
  normalizeUsername,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from "@/app/server/auth-crypto";
import { permissionsForRole, type AppSession } from "@/app/server/authz";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { getDb } from "@/runtime-db";
import { localAccounts, members } from "@/db/schema";

const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const DUMMY_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const username = normalizeUsername(String(body.username ?? ""));
    const password = typeof body.password === "string" ? body.password : "";
    if (username.length > 128 || password.length > 256) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误。");
    }
    const db = getDb();
    const [row] = await db
      .select({ account: localAccounts, member: members })
      .from(localAccounts)
      .innerJoin(members, eq(members.id, localAccounts.memberId))
      .where(eq(localAccounts.usernameNormalized, username))
      .limit(1);
    const now = new Date();
    if (row?.account.lockedUntil && row.account.lockedUntil > now) {
      throw new ApiError(423, "ACCOUNT_LOCKED", "登录失败次数过多，请稍后再试。", {
        retryAfterSeconds: Math.ceil(
          (row.account.lockedUntil.getTime() - now.getTime()) / 1000,
        ),
      });
    }
    const valid = row
      ? await verifyPassword(
          password,
          row.account.passwordSalt,
          row.account.passwordHash,
          row.account.passwordIterations,
        )
      : await verifyPassword(
          password,
          DUMMY_SALT,
          DUMMY_HASH,
          PASSWORD_ITERATIONS,
        );
    if (!row) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误。");
    }
    if (!valid) {
      const failure = nextLoginFailureState(
        row.account.failedLoginAttempts,
        row.account.lockedUntil?.getTime() ?? null,
        now.getTime(),
      );
      const attempts = failure.attempts;
      const lockedUntil = failure.lockedUntilMs
        ? new Date(failure.lockedUntilMs)
        : null;
      await db
        .update(localAccounts)
        .set({
          failedLoginAttempts: attempts,
          lockedUntil,
          updatedAt: now,
        })
        .where(eq(localAccounts.memberId, row.account.memberId));
      if (lockedUntil) {
        throw new ApiError(
          423,
          "ACCOUNT_LOCKED",
          "登录失败次数过多，账号已锁定 15 分钟。",
          { retryAfterSeconds: 15 * 60 },
        );
      }
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误。", {
        remainingAttempts: LOGIN_FAILURE_LIMIT - attempts,
      });
    }
    if (row.member.status !== "active") {
      throw new ApiError(403, "MEMBER_DISABLED", "当前成员权限已被停用。");
    }

    await db
      .update(localAccounts)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(localAccounts.memberId, row.account.memberId));
    const createdSession = await createSession(row.member.id);
    const account = {
      ...row.account,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    };
    const session: AppSession = {
      user: {
        id: row.member.id,
        userId: row.member.id,
        username: account.username,
        email: row.member.email,
        displayName: row.member.displayName || account.username,
      },
      member: row.member,
      account,
      session: createdSession.record,
    };
    await writeAudit(session, "auth.login", "member", row.member.id, {
      role: row.member.role,
      status: row.member.status,
    });
    return jsonResponse(
      {
        user: session.user,
        member: {
          id: row.member.id,
          username: account.username,
          displayName: row.member.displayName,
          role: row.member.role,
          status: row.member.status,
        },
        role: row.member.role,
        mustChangePassword: account.mustChangePassword,
        permissions: permissionsForRole(row.member.role),
      },
      200,
      { "Set-Cookie": sessionCookie(createdSession.token) },
    );
  });
}
