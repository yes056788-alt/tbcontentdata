import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createNodePersistence } from "../db/node.ts";
import { auditLogs, sharedVault } from "../db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function vaultRow(id, revision, encryptedPayload = "SENSITIVE_CIPHERTEXT") {
  const now = new Date();
  return {
    id,
    encryptedPayload,
    payloadBytes: Buffer.byteLength(encryptedPayload),
    revision,
    updatedBy: "member-owner",
    createdAt: now,
    updatedAt: now,
  };
}

function deletionAudit(revision) {
  return {
    id: crypto.randomUUID(),
    actorMemberId: "member-owner",
    actorEmail: "owner@example.invalid",
    action: "vault.deleted",
    targetType: "shared_vault",
    targetId: "shared",
    metadataJson: JSON.stringify({ revision }),
  };
}

async function withPersistence(operation) {
  const root = await mkdtemp(join(tmpdir(), "tbdata-vault-deletion-"));
  const persistence = createNodePersistence({
    databasePath: join(root, "team.sqlite"),
    runsRoot: join(root, "objects"),
    migrationsFolder,
  });
  try {
    return await operation(persistence.db);
  } finally {
    persistence.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("DELETE /api/vault is manager-only, revision-guarded, and never feeds ciphertext to audit", async () => {
  const source = await readFile(
    new URL("../app/api/vault/route.ts", import.meta.url),
    "utf8",
  );
  const deleteOffset = source.indexOf("export async function DELETE");
  assert.notEqual(deleteOffset, -1, "vault route must export DELETE");
  const deletionSource = source.slice(deleteOffset);
  assert.match(deletionSource, /requireSession\(request, workspaceManagers\)/);
  assert.match(deletionSource, /parseExpectedRevision\(\s*request,/);
  assert.match(deletionSource, /"vault\.deleted"/);
  assert.match(deletionSource, /"shared_vault"/);
  assert.match(deletionSource, /deleteSharedVaultAtRevision/);
  assert.doesNotMatch(deletionSource, /encryptedPayload|body\.vault|validateEncryptedVault/);
  assert.match(source, /isSharedVaultTombstonePayload/);
  assert.match(
    source,
    /isSharedVaultTombstonePayload\(row\.encryptedPayload\)[\s\S]*?vault:\s*null,[\s\S]*?deleted:\s*true,[\s\S]*?tombstone:\s*true,[\s\S]*?revision:\s*row\.revision/,
  );
  assert.match(source, /body\.recreate === true/);
  assert.match(source, /saveSharedVaultAtRevision/);
});

test("vault deletion reuses the shared If-Match and expectedRevision precondition parser", async () => {
  const source = await readFile(
    new URL("../app/server/revisions.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /request\.headers\.get\("if-match"\)/);
  assert.match(source, /parseInteger\(bodyValue, "expectedRevision"/);
  assert.match(source, /MAX_EXPECTED_REVISION\s*=\s*Number\.MAX_SAFE_INTEGER\s*-\s*1/);
  assert.match(source, /max:\s*MAX_EXPECTED_REVISION/);
  assert.match(source, /428,\s*"REVISION_REQUIRED"/);
  assert.match(source, /400,\s*"REVISION_MISMATCH"/);
});

test("matching deletion tombstones only shared vault id 1 and commits a ciphertext-free audit atomically", async () => {
  const {
    deleteSharedVaultAtRevision,
    SHARED_VAULT_TOMBSTONE_PAYLOAD,
  } = await import(
    "../app/server/vault-deletion.ts"
  );
  await withPersistence(async (db) => {
    await db.insert(sharedVault).values([
      vaultRow(1, 7),
      vaultRow(2, 3, "DECOY_CIPHERTEXT"),
    ]);

    const result = await deleteSharedVaultAtRevision(
      db,
      7,
      deletionAudit(8),
    );

    assert.deepEqual(result, {
      deleted: true,
      alreadyDeleted: false,
      previousRevision: 7,
      revision: 8,
    });
    const [tombstone] = await db
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, 1));
    assert.equal(tombstone?.revision, 8);
    assert.equal(tombstone?.encryptedPayload, SHARED_VAULT_TOMBSTONE_PAYLOAD);
    assert.equal(
      (await db.select().from(sharedVault).where(eq(sharedVault.id, 2)))[0]?.revision,
      3,
    );
    const audit = await db.select().from(auditLogs);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "vault.deleted");
    assert.equal(audit[0]?.targetType, "shared_vault");
    assert.deepEqual(JSON.parse(audit[0]?.metadataJson), { revision: 8 });
    assert.doesNotMatch(audit[0]?.metadataJson, /CIPHERTEXT|encrypted|cipher/i);

    const repeated = await deleteSharedVaultAtRevision(
      db,
      7,
      deletionAudit(8),
    );
    assert.deepEqual(repeated, {
      deleted: true,
      alreadyDeleted: true,
      previousRevision: null,
      revision: 8,
    });
    assert.equal((await db.select().from(auditLogs)).length, 1);
  });
});

test("deleting an absent vault creates a durable tombstone instead of leaving remote null revivable", async () => {
  const {
    deleteSharedVaultAtRevision,
    saveSharedVaultAtRevision,
    SHARED_VAULT_TOMBSTONE_PAYLOAD,
  } = await import("../app/server/vault-deletion.ts");
  await withPersistence(async (db) => {
    const result = await deleteSharedVaultAtRevision(
      db,
      0,
      deletionAudit(1),
    );
    assert.deepEqual(result, {
      deleted: true,
      alreadyDeleted: false,
      previousRevision: 0,
      revision: 1,
    });
    const [row] = await db
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, 1));
    assert.equal(row?.encryptedPayload, SHARED_VAULT_TOMBSTONE_PAYLOAD);
    assert.equal(row?.revision, 1);

    const recreated = await saveSharedVaultAtRevision(db, {
      encryptedPayload: "NEW_ENCRYPTED_VAULT",
      payloadBytes: Buffer.byteLength("NEW_ENCRYPTED_VAULT"),
      expectedRevision: result.revision,
      updatedBy: "member-owner",
      recreate: true,
      now: new Date(),
    });
    assert.equal(recreated.revision, 2);
  });
});

test("deleting an absent vault rejects a forged nonzero revision without writing or auditing", async () => {
  const { deleteSharedVaultAtRevision } = await import(
    "../app/server/vault-deletion.ts"
  );
  await withPersistence(async (db) => {
    await assert.rejects(
      deleteSharedVaultAtRevision(db, 7, deletionAudit(8)),
      (error) =>
        error?.status === 409 &&
        error?.code === "REVISION_CONFLICT" &&
        error?.details?.currentRevision === 0,
    );
    assert.equal((await db.select().from(sharedVault)).length, 0);
    assert.equal((await db.select().from(auditLogs)).length, 0);
  });
});

test("vault mutations reject revision exhaustion before emitting an unusable successor", async () => {
  const { deleteSharedVaultAtRevision } = await import(
    "../app/server/vault-deletion.ts"
  );
  await withPersistence(async (db) => {
    const terminalPrecondition = Number.MAX_SAFE_INTEGER - 1;
    await db.insert(sharedVault).values(vaultRow(
      1,
      terminalPrecondition,
      "ACTIVE_NEAR_REVISION_LIMIT",
    ));
    await assert.rejects(
      deleteSharedVaultAtRevision(
        db,
        terminalPrecondition,
        deletionAudit(Number.MAX_SAFE_INTEGER),
      ),
      (error) =>
        error?.status === 409 &&
        error?.code === "REVISION_EXHAUSTED" &&
        error?.details?.currentRevision === terminalPrecondition,
    );
    const [current] = await db.select().from(sharedVault);
    assert.equal(current?.revision, terminalPrecondition);
    assert.equal(current?.encryptedPayload, "ACTIVE_NEAR_REVISION_LIMIT");
    assert.equal((await db.select().from(auditLogs)).length, 0);
  });
});

test("ordinary saves cannot revive a tombstone; explicit matching recreate can", async () => {
  const {
    saveSharedVaultAtRevision,
    SHARED_VAULT_TOMBSTONE_PAYLOAD,
  } = await import("../app/server/vault-deletion.ts");
  await withPersistence(async (db) => {
    await db.insert(sharedVault).values(vaultRow(
      1,
      8,
      SHARED_VAULT_TOMBSTONE_PAYLOAD,
    ));
    const nextPayload = "NEW_ENCRYPTED_VAULT";
    const input = {
      encryptedPayload: nextPayload,
      payloadBytes: Buffer.byteLength(nextPayload),
      expectedRevision: 8,
      updatedBy: "member-owner",
      recreate: false,
      now: new Date(),
    };

    await assert.rejects(
      saveSharedVaultAtRevision(db, input),
      (error) =>
        error?.status === 409 && error?.code === "VAULT_RECREATE_REQUIRED",
    );
    assert.equal(
      (await db.select().from(sharedVault).where(eq(sharedVault.id, 1)))[0]
        ?.encryptedPayload,
      SHARED_VAULT_TOMBSTONE_PAYLOAD,
    );

    const recreated = await saveSharedVaultAtRevision(db, {
      ...input,
      recreate: true,
    });
    assert.equal(recreated.revision, 9);
    assert.equal(recreated.encryptedPayload, nextPayload);
  });
});

test("a stale deletion loses to a concurrent vault update without deleting or auditing it", async () => {
  const { deleteSharedVaultAtRevision } = await import(
    "../app/server/vault-deletion.ts"
  );
  await withPersistence(async (db) => {
    await db.insert(sharedVault).values(vaultRow(1, 8, "UPDATED_CIPHERTEXT"));

    await assert.rejects(
      deleteSharedVaultAtRevision(db, 7, deletionAudit(7)),
      (error) =>
        error?.status === 409 &&
        error?.code === "REVISION_CONFLICT" &&
        error?.details?.currentRevision === 8,
    );

    const [current] = await db
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, 1));
    assert.equal(current?.revision, 8);
    assert.equal(current?.encryptedPayload, "UPDATED_CIPHERTEXT");
    assert.equal((await db.select().from(auditLogs)).length, 0);
  });
});

test("an audit failure rolls the tombstone write back", async () => {
  const { deleteSharedVaultAtRevision } = await import(
    "../app/server/vault-deletion.ts"
  );
  await withPersistence(async (db) => {
    await db.insert(sharedVault).values(vaultRow(1, 7));
    const audit = deletionAudit(8);
    await db.insert(auditLogs).values(audit);

    await assert.rejects(deleteSharedVaultAtRevision(db, 7, audit));

    const [current] = await db
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, 1));
    assert.equal(current?.revision, 7);
    assert.equal(current?.encryptedPayload, "SENSITIVE_CIPHERTEXT");
    assert.equal((await db.select().from(auditLogs)).length, 1);
  });
});
