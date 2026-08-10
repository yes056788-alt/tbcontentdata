import { eq } from "drizzle-orm";
import { writeAudit } from "@/app/server/audit";
import {
  createSession,
  revokeMemberSessions,
  sessionCookie,
} from "@/app/server/auth";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/app/server/auth-crypto";
import { requireSession } from "@/app/server/authz";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { getDb } from "@/runtime-db";
import { localAccounts } from "@/db/schema";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, undefined, {
      allowPasswordChangeRequired: true,
    });
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = validatePassword(body.newPassword, "newPassword");
    const currentValid = await verifyPassword(
      currentPassword,
      session.account.passwordSalt,
      session.account.passwordHash,
      session.account.passwordIterations,
    );
    if (!currentValid) {
      throw new ApiError(401, "INVALID_CURRENT_PASSWORD", "当前密码错误。");
    }
    // The verified current plaintext is available in this request, so an
    // exact comparison avoids a redundant PBKDF2 run. A theoretical hash
    // collision is irrelevant to the user-visible "same password" rule.
    if (newPassword === currentPassword) {
      throw new ApiError(400, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同。");
    }

    const password = await hashPassword(newPassword);
    const now = new Date();
    await getDb()
      .update(localAccounts)
      .set({
        passwordSalt: password.salt,
        passwordHash: password.hash,
        passwordIterations: password.iterations,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(localAccounts.memberId, session.member.id));
    await revokeMemberSessions(session.member.id);
    const replacement = await createSession(session.member.id);
    await writeAudit(session, "auth.password_changed", "member", session.member.id, {
      role: session.member.role,
      status: session.member.status,
    });
    return jsonResponse(
      { changed: true, mustChangePassword: false },
      200,
      { "Set-Cookie": sessionCookie(replacement.token) },
    );
  });
}
