import { and, eq, ne, sql } from "drizzle-orm";
import type { AppDb } from "@/runtime-db";
import { auditLogs, sharedVault } from "../../db/schema.ts";
import {
  isSharedVaultTombstonePayload,
  SHARED_VAULT_TOMBSTONE_PAYLOAD,
} from "../../lib/shared-vault-tombstone.mjs";
import { ApiError } from "./http.ts";

export const SHARED_VAULT_ROW_ID = 1;
const MAX_MUTABLE_SHARED_VAULT_REVISION = Number.MAX_SAFE_INTEGER - 1;
export {
  isSharedVaultTombstonePayload,
  SHARED_VAULT_TOMBSTONE_PAYLOAD,
};

type VaultDeletionAudit = {
  id: string;
  actorMemberId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  metadataJson: string;
  createdAt?: Date;
};

export type VaultDeletionResult = {
  deleted: true;
  alreadyDeleted: boolean;
  previousRevision: number | null;
  revision: number;
};

type VaultSaveInput = {
  encryptedPayload: string;
  payloadBytes: number;
  expectedRevision: number;
  updatedBy: string;
  recreate: boolean;
  now: Date;
};

function nextSharedVaultRevision(expectedRevision: number) {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= MAX_MUTABLE_SHARED_VAULT_REVISION
  ) {
    throw new ApiError(
      409,
      "REVISION_EXHAUSTED",
      "账号库版本号已达到安全上限，请联系管理员迁移数据后重试。",
      { currentRevision: expectedRevision },
    );
  }
  return expectedRevision + 1;
}

/**
 * Replaces the singleton vault with a durable tombstone and appends its audit
 * record in one transaction. The revision predicate is part of the upsert, so
 * a concurrent PUT can never be removed after advancing to a newer revision.
 */
export async function deleteSharedVaultAtRevision(
  db: AppDb,
  expectedRevision: number,
  audit: VaultDeletionAudit,
): Promise<VaultDeletionResult> {
  const auditCreatedAt = audit.createdAt ?? new Date();
  const nextRevision = nextSharedVaultRevision(expectedRevision);
  const tombstoneBytes = new TextEncoder().encode(
    SHARED_VAULT_TOMBSTONE_PAYLOAD,
  ).byteLength;
  const tombstoneValues = {
    encryptedPayload: SHARED_VAULT_TOMBSTONE_PAYLOAD,
    payloadBytes: tombstoneBytes,
    revision: nextRevision,
    updatedBy: audit.actorMemberId,
    updatedAt: auditCreatedAt,
  };
  const tombstoneMutation = expectedRevision === 0
    ? db
        .insert(sharedVault)
        .values({
          id: SHARED_VAULT_ROW_ID,
          ...tombstoneValues,
          createdAt: auditCreatedAt,
        })
        .onConflictDoUpdate({
          target: sharedVault.id,
          set: tombstoneValues,
          where: and(
            eq(sharedVault.revision, expectedRevision),
            ne(sharedVault.encryptedPayload, SHARED_VAULT_TOMBSTONE_PAYLOAD),
          ),
        })
        .returning({ revision: sharedVault.revision })
    : db
        .update(sharedVault)
        .set(tombstoneValues)
        .where(
          and(
            eq(sharedVault.id, SHARED_VAULT_ROW_ID),
            eq(sharedVault.revision, expectedRevision),
            ne(sharedVault.encryptedPayload, SHARED_VAULT_TOMBSTONE_PAYLOAD),
          ),
        )
        .returning({ revision: sharedVault.revision });
  const [tombstonedRows, , currentRows] = await db.batch([
    tombstoneMutation,
    // SQLite changes() observes the immediately preceding conditional
    // tombstone upsert. Therefore the audit row exists iff this transaction
    // changed the vault state; failures roll the tombstone and audit back.
    db.insert(auditLogs).select(sql`
      SELECT
        ${audit.id},
        ${audit.actorMemberId},
        ${audit.actorEmail},
        ${audit.action},
        ${audit.targetType},
        ${audit.targetId},
        ${audit.metadataJson},
        ${auditCreatedAt.getTime()}
      WHERE changes() = 1
    `),
    // Reading the current row in the same batch gives one linearized outcome:
    // newly tombstoned, already tombstoned, or a conflicting active revision.
    db
      .select({
        revision: sharedVault.revision,
        encryptedPayload: sharedVault.encryptedPayload,
      })
      .from(sharedVault)
      .where(eq(sharedVault.id, SHARED_VAULT_ROW_ID))
      .limit(1),
  ]);

  const tombstoned = tombstonedRows[0];
  if (tombstoned) {
    return {
      deleted: true,
      alreadyDeleted: false,
      previousRevision: expectedRevision,
      revision: tombstoned.revision,
    };
  }

  const current = currentRows[0];
  if (current && isSharedVaultTombstonePayload(current.encryptedPayload)) {
    return {
      deleted: true,
      alreadyDeleted: true,
      previousRevision: null,
      revision: current.revision,
    };
  }
  if (current) {
    throw new ApiError(
      409,
      "REVISION_CONFLICT",
      "账号库已被其他成员更新，请同步最新版本后重试。",
      { currentRevision: current.revision },
    );
  }

  throw new ApiError(
    409,
    "REVISION_CONFLICT",
    "账号库已被其他成员更新，请同步最新版本后重试。",
    { currentRevision: 0 },
  );
}

/**
 * Saves an encrypted vault while treating the tombstone as an authorization
 * boundary. Ordinary synchronization can update a live vault or create the
 * first vault, but only an explicit, revision-matched recreate may replace a
 * tombstone.
 */
export async function saveSharedVaultAtRevision(
  db: AppDb,
  input: VaultSaveInput,
): Promise<typeof sharedVault.$inferSelect> {
  const nextRevision = nextSharedVaultRevision(input.expectedRevision);
  let saved: typeof sharedVault.$inferSelect | undefined;

  if (input.expectedRevision === 0 && !input.recreate) {
    [saved] = await db
      .insert(sharedVault)
      .values({
        id: SHARED_VAULT_ROW_ID,
        encryptedPayload: input.encryptedPayload,
        payloadBytes: input.payloadBytes,
        revision: nextRevision,
        updatedBy: input.updatedBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
  } else {
    [saved] = await db
      .update(sharedVault)
      .set({
        encryptedPayload: input.encryptedPayload,
        payloadBytes: input.payloadBytes,
        revision: nextRevision,
        updatedBy: input.updatedBy,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sharedVault.id, SHARED_VAULT_ROW_ID),
          eq(sharedVault.revision, input.expectedRevision),
          input.recreate
            ? eq(
                sharedVault.encryptedPayload,
                SHARED_VAULT_TOMBSTONE_PAYLOAD,
              )
            : ne(
                sharedVault.encryptedPayload,
                SHARED_VAULT_TOMBSTONE_PAYLOAD,
              ),
        ),
      )
      .returning();
  }

  if (saved) return saved;

  const [current] = await db
    .select({
      revision: sharedVault.revision,
      encryptedPayload: sharedVault.encryptedPayload,
    })
    .from(sharedVault)
    .where(eq(sharedVault.id, SHARED_VAULT_ROW_ID))
    .limit(1);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new ApiError(
      409,
      "REVISION_CONFLICT",
      "账号库已被其他成员更新，请同步最新版本后重试。",
      { currentRevision },
    );
  }
  if (current && isSharedVaultTombstonePayload(current.encryptedPayload)) {
    throw new ApiError(
      409,
      "VAULT_RECREATE_REQUIRED",
      "团队账号库已删除；只有显式新建账号库才能覆盖删除标记。",
      { currentRevision },
    );
  }
  if (input.recreate) {
    throw new ApiError(
      409,
      "VAULT_NOT_DELETED",
      "团队账号库当前不是已删除状态，不能执行重建。",
      { currentRevision },
    );
  }
  throw new ApiError(
    409,
    "REVISION_CONFLICT",
    "账号库状态已变化，请同步最新版本后重试。",
    { currentRevision },
  );
}
