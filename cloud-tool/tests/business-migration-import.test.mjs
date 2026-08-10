import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  createFileMigrationObjectStore,
  createMigrationFileSource,
  importBusinessMigration,
  openMigrationDatabase,
} from "../scripts/lib/business-migration-import.mjs";
import {
  createFixtureMigration,
  FIXTURE_PASSPHRASE,
  FIXTURE_RUN_DATA_KEY,
  fixtureMigrationSource,
} from "./helpers/business-migration-fixture.mjs";

const RUN_AAD = new TextEncoder().encode("taobao-shared-run-v1");

async function decryptStoredRun(stored) {
  const envelope = JSON.parse(stored);
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(FIXTURE_RUN_DATA_KEY, "base64"),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Buffer.from(envelope.iv, "base64"),
      additionalData: RUN_AAD,
    },
    key,
    Buffer.from(envelope.ciphertext, "base64"),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

test("dry-run validates every record without opening a migration target", async () => {
  const packageText = await createFixtureMigration();
  const result = await importBusinessMigration({
    source: fixtureMigrationSource(packageText),
    passphrase: FIXTURE_PASSPHRASE,
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.imported, { vault: 1, directory: 1, runs: 2 });
});

test("file source parses NDJSON incrementally and can be reopened for the import pass", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "tbmig-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const packagePath = resolve(root, "fixture.tbmig");
  await writeFile(packagePath, await createFixtureMigration(), { mode: 0o600 });
  const source = await createMigrationFileSource(packagePath);
  const first = await importBusinessMigration({
    source,
    passphrase: FIXTURE_PASSPHRASE,
    dryRun: true,
  });
  const second = await importBusinessMigration({
    source,
    passphrase: FIXTURE_PASSPHRASE,
    dryRun: true,
  });
  assert.equal(first.manifest.catalogSha256, second.manifest.catalogSha256);
  assert.deepEqual(first.imported, { vault: 1, directory: 1, runs: 2 });
});

test("Node importer initializes SQLite, re-encrypts runs, and never imports auth state", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "tbmig-import-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = resolve(root, "team.sqlite");
  const objectsPath = resolve(root, "objects");
  const migrationsPath = resolve(import.meta.dirname, "..", "drizzle");
  const packageText = await createFixtureMigration();
  const database = openMigrationDatabase(databasePath, migrationsPath);
  context.after(() => database.close());

  const result = await importBusinessMigration({
    source: fixtureMigrationSource(packageText),
    passphrase: FIXTURE_PASSPHRASE,
    database,
    objectStore: createFileMigrationObjectStore(objectsPath),
    runDataKey: FIXTURE_RUN_DATA_KEY,
  });
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.imported, { vault: 1, directory: 1, runs: 2 });

  assert.equal(database.prepare("SELECT count(*) AS count FROM shared_vault").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM shared_documents").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM runs").get().count, 2);
  for (const table of ["members", "local_accounts", "auth_sessions", "invites", "audit_logs", "owner_recovery_uses"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(database.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get().count, 4);

  const objectPath = resolve(objectsPath, "runs", "store-run-fixture-1.json");
  const stored = await readFile(objectPath, "utf8");
  assert.equal(stored.includes("Fixture Store 1"), false);
  assert.equal(stored.includes("store-run-fixture-1"), false);
  const run = await decryptStoredRun(stored);
  assert.equal(run.runId, "store-run-fixture-1");

  await assert.rejects(
    () => importBusinessMigration({
      source: fixtureMigrationSource(packageText),
      passphrase: FIXTURE_PASSPHRASE,
      database,
      objectStore: createFileMigrationObjectStore(objectsPath),
      runDataKey: FIXTURE_RUN_DATA_KEY,
    }),
    /not empty/i,
  );
});

test("Node importer can reuse the CLI dry-run fingerprint for the write pass", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "tbmig-cli-two-pass-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const packagePath = resolve(root, "fixture.tbmig");
  const databasePath = resolve(root, "team.sqlite");
  const objectsPath = resolve(root, "objects");
  const migrationsPath = resolve(import.meta.dirname, "..", "drizzle");
  await writeFile(packagePath, await createFixtureMigration(), { mode: 0o600 });
  const source = await createMigrationFileSource(packagePath);

  const verified = await importBusinessMigration({
    source,
    passphrase: FIXTURE_PASSPHRASE,
    dryRun: true,
  });
  assert.match(verified.packageSha256, /^[a-f0-9]{64}$/);

  const database = openMigrationDatabase(databasePath, migrationsPath);
  context.after(() => database.close());
  const result = await importBusinessMigration({
    source,
    passphrase: FIXTURE_PASSPHRASE,
    verified,
    database,
    objectStore: createFileMigrationObjectStore(objectsPath),
    runDataKey: FIXTURE_RUN_DATA_KEY,
  });

  assert.equal(result.dryRun, false);
  assert.deepEqual(result.imported, { vault: 1, directory: 1, runs: 2 });
  assert.equal(database.prepare("SELECT count(*) AS count FROM shared_vault").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM shared_documents").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM runs").get().count, 2);
});
