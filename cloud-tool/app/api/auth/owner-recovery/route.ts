import { and, eq, isNull, sql } from "drizzle-orm";
import { auditRecord } from "@/app/server/audit";
import {
  hashPassword,
  secureTextEqual,
  validatePassword,
} from "@/app/server/auth-crypto";
import { requireSession } from "@/app/server/authz";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { verifyOwnerRecoveryCode } from "@/app/server/owner-recovery";
import { getDb } from "@/runtime-db";
import {
  auditLogs,
  authSessions,
  localAccounts,
  members,
  ownerRecoveryUses,
  workspaceState,
} from "@/db/schema";

const WORKSPACE_ROW_ID = 1;

function usedRecoveryCodeError() {
  return new ApiError(
    409,
    "OWNER_RECOVERY_CODE_USED",
    "该所有者恢复码已经使用；请让部署管理员生成新的短期恢复码。",
  );
}

export async function POST(request: Request) {
  return withApiErrors(async () => {
    // An admin session is necessary but deliberately insufficient: the
    // separately managed, short-lived deployment recovery code is required.
    const session = await requireSession(request, ["admin"]);
    const body = requireObject(await readJsonBody<unknown>(request, 100_000));
    const recovery = await verifyOwnerRecoveryCode(body.recoveryCode);
    const newPassword = validatePassword(body.newPassword, "newPassword");
    if (
      typeof body.confirmPassword !== "string" ||
      !(await secureTextEqual(newPassword, body.confirmPassword))
    ) {
      throw new ApiError(
        400,
        "PASSWORD_CONFIRMATION_MISMATCH",
        "两次输入的新密码不一致。",
      );
    }

    const db = getDb();
    const [alreadyUsed] = await db
      .select({ tokenHash: ownerRecoveryUses.tokenHash })
      .from(ownerRecoveryUses)
      .where(eq(ownerRecoveryUses.tokenHash, recovery.tokenHash))
      .limit(1);
    if (alreadyUsed) throw usedRecoveryCodeError();

    const [target] = await db
      .select({
        state: workspaceState,
        member: members,
        account: localAccounts,
      })
      .from(workspaceState)
      .innerJoin(members, eq(members.id, workspaceState.ownerMemberId))
      .innerJoin(localAccounts, eq(localAccounts.memberId, members.id))
      .where(
        and(
          eq(workspaceState.id, WORKSPACE_ROW_ID),
          eq(members.role, "owner"),
          eq(members.status, "active"),
        ),
      )
      .limit(1);
    if (!target) {
      throw new ApiError(
        409,
        "OWNER_ACCOUNT_INCONSISTENT",
        "工作区所有者账号状态异常，无法安全恢复。",
      );
    }

    // A recovery password is temporary. On the owner's next login the normal
    // current-password flow forces an immediate private rotation, so the admin
    // who helped recover the account does not retain the lasting credential.
    const password = await hashPassword(newPassword);
    const now = new Date();
    try {
      await db.batch([
        // The hash primary key is the transaction's one-time claim. A replay
        // aborts this whole batch before any password or session change.
        db.insert(ownerRecoveryUses).values({
          tokenHash: recovery.tokenHash,
          ownerMemberId: target.state.ownerMemberId,
          usedAt: now,
        }),
        db
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
          .where(eq(localAccounts.memberId, target.state.ownerMemberId)),
        // SQLite changes() observes the immediately preceding owner-account
        // update. If it changed anything other than the one singleton row,
        // this conditional duplicate insert raises a primary-key error and
        // rolls back the marker, password, revocation and audit together.
        // D1 batch() accepts prepared query builders. Calling db.run() here
        // would eagerly create a Promise and the Cloudflare driver rejects it.
        db.insert(ownerRecoveryUses).select(sql`
          SELECT ${recovery.tokenHash}, ${target.state.ownerMemberId}, ${now.getTime()}
          WHERE changes() <> 1
        `),
        db
          .update(authSessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(authSessions.memberId, target.state.ownerMemberId),
              isNull(authSessions.revokedAt),
            ),
          ),
        db.insert(auditLogs).values(
          auditRecord(
            session,
            "auth.owner_password_recovered",
            "member",
            target.state.ownerMemberId,
            {
              role: target.member.role,
              status: target.member.status,
              mustChangePassword: true,
            },
          ),
        ),
      ]);
    } catch (error) {
      // Map both an ordinary replay and the loser of a concurrent race to a
      // stable client error. Any unrelated failure is still surfaced through
      // the generic API error boundary without leaking database details.
      const [usedAfterFailure] = await db
        .select({ tokenHash: ownerRecoveryUses.tokenHash })
        .from(ownerRecoveryUses)
        .where(eq(ownerRecoveryUses.tokenHash, recovery.tokenHash))
        .limit(1);
      if (usedAfterFailure) throw usedRecoveryCodeError();
      throw error;
    }

    return jsonResponse({ recovered: true, mustChangePassword: true });
  });
}
