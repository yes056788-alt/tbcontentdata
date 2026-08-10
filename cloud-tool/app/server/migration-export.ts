import { asc, eq, gt } from "drizzle-orm";
import {
  appendMigrationCatalogHash,
  BUSINESS_MIGRATION_CATALOG_ALGORITHM,
  BUSINESS_MIGRATION_CATALOG_SEED,
  createMigrationHeader,
  deriveMigrationKey,
  encodeMigrationLine,
  encryptMigrationRecord,
  sha256HexText,
  validateMigrationPassphrase,
} from "@/lib/business-migration-format.mjs";
import { getDb, getRunsBucket } from "@/runtime-db";
import { runs, sharedDocuments, sharedVault } from "@/db/schema";
import { validateDirectory } from "./directory";
import { decryptRunPayload } from "./run-crypto";
import { extractRunMetadata, serializeRunMetadata, sha256Hex } from "./runs";
import { validateEncryptedVault } from "./vault";

const VAULT_ROW_ID = 1;
const DIRECTORY_KEY = "project_directory";
const encoder = new TextEncoder();
export const MIGRATION_RUN_PAGE_SIZE = 64;
export const MIGRATION_RUN_BODY_LIMIT_BYTES = 24 * 1024 * 1024;
const MIGRATION_SOURCE_OBJECT_LIMIT_BYTES = 40 * 1024 * 1024;
const MIGRATION_FORBIDDEN_KEYS = new Set([
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "env",
  "environment",
  "masterpassword",
  "password",
  "passwordpepper",
  "passwd",
  "refreshtoken",
  "rundatakey",
  "secret",
  "session",
  "sessionid",
  "token",
  "accesstoken",
]);

type RunRow = typeof runs.$inferSelect;
type MigrationRecordKind = "vault" | "directory" | "run" | "manifest";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalMigrationVault(value: unknown) {
  const vault = validateEncryptedVault(value);
  const kdf = asRecord(vault.kdf);
  const cipher = asRecord(vault.cipher);
  return {
    schema: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: kdf.iterations,
      salt: kdf.salt,
    },
    cipher: {
      name: "AES-GCM",
      iv: cipher.iv,
      data: cipher.data,
    },
    updatedAt: vault.updatedAt,
  };
}

function assertMigrationSafeRun(
  value: unknown,
  depth = 0,
  budget = { nodes: 0 },
) {
  if (depth > 64) throw new Error("Migration source run is nested too deeply.");
  budget.nodes += 1;
  if (budget.nodes > 2_000_000) throw new Error("Migration source run is too complex.");
  if (Array.isArray(value)) {
    value.forEach((child) => assertMigrationSafeRun(child, depth + 1, budget));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (MIGRATION_FORBIDDEN_KEYS.has(normalized)) {
      throw new Error("Migration source run contains a forbidden sensitive field.");
    }
    assertMigrationSafeRun(child, depth + 1, budget);
  }
}

function timeMs(value: Date | null) {
  return value ? value.getTime() : 0;
}

function snapshotRun(row: RunRow) {
  return {
    id: row.id,
    sourceUpdatedAt: timeMs(row.sourceUpdatedAt),
    payloadBytes: row.payloadBytes,
    payloadSha256: row.payloadSha256,
    updatedAt: timeMs(row.updatedAt),
  };
}

async function* pagedRunRows(): AsyncGenerator<RunRow> {
  let cursor = "";
  while (true) {
    const query = getDb()
      .select()
      .from(runs)
      .orderBy(asc(runs.id))
      .limit(MIGRATION_RUN_PAGE_SIZE);
    const page = cursor
      ? await query.where(gt(runs.id, cursor))
      : await query;
    if (!page.length) return;
    for (const row of page) {
      if (row.id <= cursor) throw new Error("Migration run pagination did not advance.");
      cursor = row.id;
      yield row;
    }
    if (page.length < MIGRATION_RUN_PAGE_SIZE) return;
  }
}

async function snapshotSeed(vaultRevision: number, directoryRevision: number) {
  return sha256HexText(JSON.stringify({
    format: "taobao-business-source-snapshot",
    version: 1,
    vaultRevision,
    directoryRevision,
  }));
}

async function appendSnapshotHash(previous: string, row: RunRow) {
  return sha256HexText(`${previous}\n${JSON.stringify(snapshotRun(row))}`);
}

async function scanRunSnapshot(vaultRevision: number, directoryRevision: number) {
  let sha256 = await snapshotSeed(vaultRevision, directoryRevision);
  let count = 0;
  for await (const row of pagedRunRows()) {
    sha256 = await appendSnapshotHash(sha256, row);
    count += 1;
  }
  return { sha256, count };
}

async function currentDocuments() {
  const db = getDb();
  const [vaultRows, directoryRows] = await Promise.all([
    db.select().from(sharedVault).where(eq(sharedVault.id, VAULT_ROW_ID)).limit(1),
    db.select().from(sharedDocuments).where(eq(sharedDocuments.key, DIRECTORY_KEY)).limit(1),
  ]);
  return { vault: vaultRows[0], directory: directoryRows[0] };
}

function migrationRunMetadata(row: RunRow) {
  return {
    ...serializeRunMetadata(row),
    sourceCreatedAt: timeMs(row.createdAt),
    sourceRecordUpdatedAt: timeMs(row.updatedAt),
  };
}

async function runPayload(row: RunRow, request: Request) {
  if (!Number.isSafeInteger(row.payloadBytes) || row.payloadBytes <= 0 ||
      row.payloadBytes > MIGRATION_RUN_BODY_LIMIT_BYTES) {
    throw new Error("Migration source run body exceeds the bounded record limit.");
  }
  const object = await getRunsBucket().get(row.blobKey);
  if (!object) throw new Error("Migration source run body is unavailable.");
  const objectSize = "size" in object ? Number(object.size) : Number.NaN;
  if (Number.isFinite(objectSize) && objectSize > MIGRATION_SOURCE_OBJECT_LIMIT_BYTES) {
    throw new Error("Migration source run object exceeds the bounded object limit.");
  }
  const plaintext = await decryptRunPayload(await object.text(), request);
  if (encoder.encode(plaintext).byteLength > MIGRATION_RUN_BODY_LIMIT_BYTES ||
      (await sha256Hex(plaintext)) !== row.payloadSha256) {
    throw new Error("Migration source run body failed its integrity check.");
  }
  let run: unknown;
  try {
    run = JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error("Migration source run body is invalid JSON.");
  }
  const extracted = extractRunMetadata(run, migrationRunMetadata(row));
  if (extracted.id !== row.id) {
    throw new Error("Migration source run identifier is inconsistent.");
  }
  assertMigrationSafeRun(run);
  return run;
}

async function* businessMigrationLines(request: Request, passphrase: string) {
  const startedAt = new Date();
  const header = createMigrationHeader(startedAt);
  const key = await deriveMigrationKey(passphrase, header);
  const source = await currentDocuments();
  const sourceVaultRevision = source.vault?.revision ?? 0;
  const sourceDirectoryRevision = source.directory?.revision ?? 0;
  const initialSnapshot = await scanRunSnapshot(sourceVaultRevision, sourceDirectoryRevision);
  let exportSnapshotSha256 = await snapshotSeed(sourceVaultRevision, sourceDirectoryRevision);
  let catalogSha256 = BUSINESS_MIGRATION_CATALOG_SEED;
  let index = 0;
  let exportedRuns = 0;

  const encryptedLine = async (
    kind: MigrationRecordKind,
    name: string,
    value: unknown,
  ) => {
    const encrypted = await encryptMigrationRecord(
      key,
      header,
      { index, kind, name },
      value,
    );
    if (kind !== "manifest") {
      catalogSha256 = await appendMigrationCatalogHash(catalogSha256, encrypted.summary);
    }
    index += 1;
    return encodeMigrationLine(encrypted.envelope);
  };

  yield encodeMigrationLine(header);
  yield await encryptedLine("vault", "vault.json", {
    vault: source.vault
      ? canonicalMigrationVault(JSON.parse(source.vault.encryptedPayload) as unknown)
      : null,
    revision: sourceVaultRevision,
    updatedAt: source.vault?.updatedAt ?? null,
  });
  yield await encryptedLine("directory", "directory.json", {
    directory: source.directory
      ? validateDirectory(JSON.parse(source.directory.jsonPayload) as unknown)
      : null,
    revision: sourceDirectoryRevision,
    updatedAt: source.directory?.updatedAt ?? null,
  });
  for await (const row of pagedRunRows()) {
    exportSnapshotSha256 = await appendSnapshotHash(exportSnapshotSha256, row);
    exportedRuns += 1;
    yield await encryptedLine(
      "run",
      `runs/${String(exportedRuns).padStart(8, "0")}.json`,
      { run: await runPayload(row, request), metadata: migrationRunMetadata(row) },
    );
  }

  const completedDocuments = await currentDocuments();
  const completedVaultRevision = completedDocuments.vault?.revision ?? 0;
  const completedDirectoryRevision = completedDocuments.directory?.revision ?? 0;
  const completedSnapshot = await scanRunSnapshot(
    completedVaultRevision,
    completedDirectoryRevision,
  );
  const consistent = completedVaultRevision === sourceVaultRevision &&
    completedDirectoryRevision === sourceDirectoryRevision &&
    initialSnapshot.count === exportedRuns &&
    completedSnapshot.count === exportedRuns &&
    initialSnapshot.sha256 === exportSnapshotSha256 &&
    completedSnapshot.sha256 === exportSnapshotSha256;
  const manifest = {
    format: header.format,
    version: header.version,
    createdAt: header.createdAt,
    completedAt: new Date().toISOString(),
    consistent,
    catalog: {
      algorithm: BUSINESS_MIGRATION_CATALOG_ALGORITHM,
      records: index,
      sha256: catalogSha256,
    },
    // Kept as a top-level alias so operator output remains familiar while the
    // v2 manifest no longer embeds an unbounded entries array.
    catalogSha256,
    totals: {
      vault: source.vault ? 1 : 0,
      directory: source.directory ? 1 : 0,
      runs: exportedRuns,
    },
    sourceRevisions: {
      vault: sourceVaultRevision,
      directory: sourceDirectoryRevision,
    },
  };
  yield await encryptedLine("manifest", "manifest.json", manifest);
}

export async function createBusinessMigrationStream(
  request: Request,
  passphraseValue: unknown,
) {
  const passphrase = validateMigrationPassphrase(passphraseValue);
  const iterator = businessMigrationLines(request, passphrase);
  let pulling = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pulling) return;
      pulling = true;
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        console.error(
          "Business migration export failed",
          error instanceof Error ? error.name : typeof error,
        );
        controller.error(new Error("Business migration export failed."));
      } finally {
        pulling = false;
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export function businessMigrationFilename(now = new Date()) {
  return `taobao-business-migration-${now.toISOString().replace(/[:.]/g, "-")}.tbmig`;
}
