import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const memberRoles = ["owner", "admin", "operator", "viewer"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const memberStatuses = ["active", "disabled"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const inviteStatuses = ["pending", "accepted", "revoked"] as const;
export type InviteStatus = (typeof inviteStatuses)[number];

const nowMs = sql`(unixepoch() * 1000)`;

// One row per deployment. Keeping the bootstrap claim in its own singleton
// table makes "first authenticated user becomes owner" deterministic even if
// two requests arrive at nearly the same time.
export const workspaceState = sqliteTable("workspace_state", {
  id: integer("id").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

// Append-only replay protection for emergency owner recovery. Only the
// SHA-256 fingerprint is stored; a primary-key conflict aborts the entire
// password/session/audit batch when a code is submitted more than once.
export const ownerRecoveryUses = sqliteTable("owner_recovery_uses", {
  tokenHash: text("token_hash").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    email: text("email").notNull(),
    displayName: text("display_name").notNull().default(""),
    role: text("role", { enum: memberRoles }).notNull(),
    status: text("status", { enum: memberStatuses })
      .notNull()
      .default("active"),
    invitedBy: text("invited_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("members_user_id_unique").on(table.userId),
    uniqueIndex("members_email_unique").on(table.email),
    index("members_role_status_idx").on(table.role, table.status),
    check(
      "members_role_check",
      sql`${table.role} in ('owner', 'admin', 'operator', 'viewer')`,
    ),
    check(
      "members_status_check",
      sql`${table.status} in ('active', 'disabled')`,
    ),
  ],
);

export const localAccounts = sqliteTable(
  "local_accounts",
  {
    memberId: text("member_id").primaryKey(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordIterations: integer("password_iterations")
      .notNull()
      .default(100000),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    passwordChangedAt: integer("password_changed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    uniqueIndex("local_accounts_username_normalized_unique").on(
      table.usernameNormalized,
    ),
    check(
      "local_accounts_iterations_check",
      sql`${table.passwordIterations} = 100000`,
    ),
    check(
      "local_accounts_failed_attempts_check",
      sql`${table.failedLoginAttempts} >= 0`,
    ),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_member_expiry_idx").on(
      table.memberId,
      table.expiresAt,
    ),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: memberRoles }).notNull(),
    status: text("status", { enum: inviteStatuses })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").notNull(),
    acceptedBy: text("accepted_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("invites_email_unique").on(table.email),
    index("invites_status_idx").on(table.status),
    check(
      "invites_role_check",
      sql`${table.role} in ('owner', 'admin', 'operator', 'viewer')`,
    ),
    check(
      "invites_status_check",
      sql`${table.status} in ('pending', 'accepted', 'revoked')`,
    ),
  ],
);

// The encryptedPayload field is copied verbatim from the browser's existing
// PBKDF2/AES-GCM vault record. The server never receives the master password
// and never decrypts this value.
export const sharedVault = sqliteTable("shared_vault", {
  id: integer("id").primaryKey(),
  encryptedPayload: text("encrypted_payload").notNull(),
  payloadBytes: integer("payload_bytes").notNull(),
  revision: integer("revision").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export const sharedDocuments = sqliteTable("shared_documents", {
  key: text("key").primaryKey(),
  jsonPayload: text("json_payload").notNull(),
  payloadBytes: integer("payload_bytes").notNull(),
  revision: integer("revision").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().default(""),
    runMode: text("run_mode").notNull().default(""),
    accountId: text("account_id").notNull().default(""),
    accountName: text("account_name").notNull().default(""),
    usernameMasked: text("username_masked").notNull().default(""),
    accountGroupId: text("account_group_id").notNull().default(""),
    accountGroupName: text("account_group_name").notNull().default(""),
    storeId: text("store_id").notNull().default(""),
    storeName: text("store_name").notNull().default(""),
    storeGroupId: text("store_group_id").notNull().default(""),
    storeGroupName: text("store_group_name").notNull().default(""),
    taskType: text("task_type").notNull().default(""),
    status: text("status").notNull().default(""),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp_ms" }),
    failureCount: integer("failure_count").notNull().default(0),
    blobKey: text("blob_key").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    uniqueIndex("runs_blob_key_unique").on(table.blobKey),
    index("runs_created_at_idx").on(table.createdAt),
    index("runs_store_created_idx").on(table.storeId, table.createdAt),
  ],
);

export const runDeletions = sqliteTable(
  "run_deletions",
  {
    runId: text("run_id").primaryKey(),
    blobKey: text("blob_key"),
    deletedBy: text("deleted_by").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [index("run_deletions_deleted_at_idx").on(table.deletedAt)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorMemberId: text("actor_member_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull().default(""),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_created_idx").on(
      table.actorMemberId,
      table.createdAt,
    ),
  ],
);
