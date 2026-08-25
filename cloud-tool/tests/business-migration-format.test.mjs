import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_MIGRATION_KDF_ITERATIONS,
  BUSINESS_MIGRATION_SUPPORTED_VERSIONS,
  BUSINESS_MIGRATION_VERSION,
  createMigrationHeader,
  deriveMigrationKey,
} from "../lib/business-migration-format.mjs";
import { scanBusinessMigration } from "../scripts/lib/business-migration-import.mjs";
import {
  createFixtureMigration,
  FIXTURE_PASSPHRASE,
  fixtureMigrationSource,
  fixtureRun,
} from "./helpers/business-migration-fixture.mjs";

test("migration KDF stays within the Cloudflare Workers WebCrypto ceiling", async () => {
  assert.equal(BUSINESS_MIGRATION_VERSION, 4);
  assert.deepEqual(BUSINESS_MIGRATION_SUPPORTED_VERSIONS, [2, 3, 4]);
  assert.equal(BUSINESS_MIGRATION_KDF_ITERATIONS, 100_000);
  assert.ok(BUSINESS_MIGRATION_KDF_ITERATIONS <= 100_000);
  const header = createMigrationHeader();
  await assert.doesNotReject(() => deriveMigrationKey(FIXTURE_PASSPHRASE, header));
});

test("current migration format marks deleted vaults while legacy v2/v3 packages remain readable", async () => {
  const deletedPackage = await createFixtureMigration({
    deletedVault: true,
    emptyDirectory: true,
    runs: [],
  });
  const deleted = await scanBusinessMigration(
    fixtureMigrationSource(deletedPackage),
    FIXTURE_PASSPHRASE,
  );
  assert.equal(deleted.header.version, 4);
  assert.equal(deleted.vaultRecord.vault, null);
  assert.equal(deleted.vaultRecord.deleted, true);
  assert.equal(deleted.vaultRecord.revision, 11);

  for (const version of [2, 3]) {
    const legacyPackage = await createFixtureMigration({ version });
    const legacy = await scanBusinessMigration(
      fixtureMigrationSource(legacyPackage),
      FIXTURE_PASSPHRASE,
    );
    assert.equal(legacy.header.version, version);
    assert.equal(legacy.vaultRecord.deleted, false);
    assert.equal(legacy.vaultRecord.vault.schema, 1);
  }
});

test("encrypted package validates and exposes only the intended business records", async () => {
  const packageText = await createFixtureMigration();
  const decoded = await scanBusinessMigration(fixtureMigrationSource(packageText), FIXTURE_PASSPHRASE);
  assert.deepEqual(decoded.manifest.totals, {
    vault: 1,
    directory: 1,
    runs: 2,
    runDeletions: 0,
  });
  assert.equal(decoded.vaultRecord.vault.schema, 1);
  for (const plaintextMarker of [
    "Fixture Store 1",
    "store-run-fixture-1",
    "Fixture Account 1",
    "tb_team_session",
    "PASSWORD_PEPPER",
    FIXTURE_PASSPHRASE,
  ]) {
    assert.equal(packageText.includes(plaintextMarker), false, plaintextMarker);
  }
});

test("wrong passphrases, ciphertext changes, and inconsistent snapshots fail closed", async () => {
  const packageText = await createFixtureMigration();
  await assert.rejects(
    () => scanBusinessMigration(fixtureMigrationSource(packageText), "Wrong-Migration-2026!Passphrase"),
    /incorrect|damaged/i,
  );

  const lines = packageText.trimEnd().split("\n").map((line) => JSON.parse(line));
  const firstRecord = lines[1];
  firstRecord.ciphertext = `${firstRecord.ciphertext[0] === "A" ? "B" : "A"}${firstRecord.ciphertext.slice(1)}`;
  const tampered = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  await assert.rejects(
    () => scanBusinessMigration(fixtureMigrationSource(tampered), FIXTURE_PASSPHRASE),
    /damaged/i,
  );

  const inconsistent = await createFixtureMigration({ consistent: false });
  await assert.rejects(
    () => scanBusinessMigration(fixtureMigrationSource(inconsistent), FIXTURE_PASSPHRASE),
    /inconsistent/i,
  );
});

test("import validation rejects session, cookie, password and environment fields", async () => {
  for (const forbidden of ["session", "cookie", "password", "PASSWORD_PEPPER"]) {
    const packageText = await createFixtureMigration({
      runs: [fixtureRun(1, { run: { [forbidden]: "synthetic-sensitive-value" } })],
    });
    await assert.rejects(
      () => scanBusinessMigration(fixtureMigrationSource(packageText), FIXTURE_PASSPHRASE),
      /forbidden sensitive field/i,
      forbidden,
    );
  }
});
