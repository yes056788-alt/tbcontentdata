import {
  appendMigrationCatalogHash,
  BUSINESS_MIGRATION_CATALOG_ALGORITHM,
  BUSINESS_MIGRATION_CATALOG_SEED,
  createMigrationHeader,
  deriveMigrationKey,
  encodeMigrationLine,
  encryptMigrationRecord,
} from "../../lib/business-migration-format.mjs";

export const FIXTURE_PASSPHRASE = "Fixture-Migration-2026!Strong";
export const FIXTURE_RUN_DATA_KEY = Buffer.alloc(32, 7).toString("base64");

export function fixtureMigrationSource(text) {
  return {
    async *openLines() {
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf("\n", offset);
        const end = newline === -1 ? text.length : newline;
        yield text.slice(offset, end).replace(/\r$/, "");
        offset = newline === -1 ? text.length : newline + 1;
      }
    },
  };
}

export function fixtureRun(index = 1, overrides = {}) {
  const runId = `store-run-fixture-${index}`;
  const updatedAt = 1_786_291_200_000 + index;
  return {
    run: {
      runId,
      taskType: "report",
      status: "completed",
      updatedAt,
      metrics: [{ label: "synthetic", value: index }],
      ...(overrides.run ?? {}),
    },
    metadata: {
      runId,
      batchId: `fixture-batch-${index}`,
      taskType: "report",
      runMode: "batch",
      accountId: `fixture-account-${index}`,
      accountName: `Fixture Account ${index}`,
      usernameMasked: "f***e",
      accountGroupId: "fixture-account-group",
      accountGroupName: "Fixture Account Group",
      storeId: `fixture-store-${index}`,
      storeName: `Fixture Store ${index}`,
      storeGroupId: "fixture-store-group",
      storeGroupName: "Fixture Store Group",
      startedAt: updatedAt - 2_000,
      finishedAt: updatedAt - 1_000,
      updatedAt,
      sourceCreatedAt: updatedAt - 3_000,
      sourceRecordUpdatedAt: updatedAt + 1_000,
      status: "completed",
      failureCount: 0,
      ...(overrides.metadata ?? {}),
    },
  };
}

export async function createFixtureMigration(options = {}) {
  const header = createMigrationHeader(
    new Date("2026-08-09T00:00:00.000Z"),
    options.version,
  );
  const key = await deriveMigrationKey(options.passphrase || FIXTURE_PASSPHRASE, header);
  const envelopes = [];
  let catalogSha256 = BUSINESS_MIGRATION_CATALOG_SEED;
  let index = 0;
  const append = async (kind, name, value) => {
    const encrypted = await encryptMigrationRecord(key, header, { index, kind, name }, value);
    envelopes.push(encrypted.envelope);
    catalogSha256 = await appendMigrationCatalogHash(catalogSha256, encrypted.summary);
    index += 1;
  };

  const vaultDeleted = options.deletedVault === true;
  const vaultAbsent = options.emptyVault === true;
  const vaultRevision = vaultDeleted ? 11 : vaultAbsent ? 0 : 4;
  const vaultUpdatedAt = vaultDeleted
    ? "2026-08-09T00:00:11.000Z"
    : vaultAbsent
      ? null
      : "2026-08-09T00:00:00.000Z";
  await append("vault", "vault.json", {
    vault: vaultDeleted || vaultAbsent ? null : {
      schema: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 310_000,
        salt: Buffer.alloc(16, 1).toString("base64"),
      },
      cipher: {
        name: "AES-GCM",
        iv: Buffer.alloc(12, 2).toString("base64"),
        data: Buffer.alloc(32, 3).toString("base64"),
      },
      updatedAt: 1_786_291_200_000,
    },
    ...(header.version >= 4 ? { deleted: vaultDeleted } : {}),
    revision: vaultRevision,
    updatedAt: vaultUpdatedAt,
  });
  await append("directory", "directory.json", {
    directory: options.emptyDirectory ? null : {
      schema: 1,
      storeGroups: [{ id: "fixture-store-group", name: "Fixture Store Group" }],
      stores: [{ id: "fixture-store-1", name: "Fixture Store 1", groupId: "fixture-store-group" }],
      updatedAt: 1_786_291_200_000,
    },
    revision: options.emptyDirectory ? 0 : 6,
    updatedAt: options.emptyDirectory ? null : "2026-08-09T00:00:00.000Z",
  });
  const runs = [...(options.runs || [fixtureRun(1), fixtureRun(2)])].sort((left, right) =>
    String(left.metadata?.runId ?? left.run?.runId ?? "")
      .localeCompare(String(right.metadata?.runId ?? right.run?.runId ?? "")),
  );
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    await append("run", `runs/${String(runIndex + 1).padStart(8, "0")}.json`, runs[runIndex]);
  }
  const manifest = {
    format: header.format,
    version: header.version,
    createdAt: header.createdAt,
    completedAt: "2026-08-09T00:01:00.000Z",
    consistent: options.consistent !== false,
    catalog: {
      algorithm: BUSINESS_MIGRATION_CATALOG_ALGORITHM,
      records: index,
      sha256: catalogSha256,
    },
    catalogSha256,
    totals: {
      vault: vaultDeleted || vaultAbsent ? 0 : 1,
      directory: options.emptyDirectory ? 0 : 1,
      runs: runs.length,
      runDeletions: 0,
    },
    sourceRevisions: {
      vault: vaultRevision,
      directory: options.emptyDirectory ? 0 : 6,
    },
  };
  const encryptedManifest = await encryptMigrationRecord(
    key,
    header,
    { index, kind: "manifest", name: "manifest.json" },
    manifest,
  );
  return [header, ...envelopes, encryptedManifest.envelope].map(encodeMigrationLine).join("");
}
