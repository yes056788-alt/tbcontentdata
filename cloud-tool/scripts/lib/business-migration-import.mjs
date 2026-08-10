import { createHash, randomBytes, webcrypto } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { link, lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  appendMigrationCatalogHash,
  BUSINESS_MIGRATION_CATALOG_ALGORITHM,
  BUSINESS_MIGRATION_CATALOG_SEED,
  BUSINESS_MIGRATION_FORMAT,
  BUSINESS_MIGRATION_MAX_LINE_BYTES,
  BUSINESS_MIGRATION_VERSION,
  decryptMigrationRecord,
  deriveMigrationKey,
  parseMigrationLine,
  sha256HexText,
  validateMigrationHeader,
} from "../../lib/business-migration-format.mjs";

const RUN_AAD = new TextEncoder().encode("taobao-shared-run-v1");
const RUN_LIMIT_BYTES = 24 * 1024 * 1024;
const IMPORT_ACTOR = "business-migration-import";
const PACKAGE_DIGEST_SEED = "f".repeat(64);
const FORBIDDEN_DATA_KEYS = new Set([
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "environment",
  "env",
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

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function optionalObject(value, label) {
  return value === null ? null : plainObject(value, label);
}

function safeInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return number;
}

function timestampMs(value, label, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  const time = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  if (!Number.isSafeInteger(time) || time <= 0 || time >= 4_102_444_800_000) {
    throw new Error(`${label} is invalid.`);
  }
  return time;
}

function base64Bytes(value, label, maximumLength) {
  if (typeof value !== "string" || value.length < 4 || value.length > maximumLength ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} is invalid base64.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.toString("base64") !== value) {
    throw new Error(`${label} is invalid base64.`);
  }
  return bytes;
}

function cleanText(value, maximumLength) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function forbiddenKey(key) {
  return FORBIDDEN_DATA_KEYS.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function assertNoSensitiveFields(value, label, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64) throw new Error(`${label} is nested too deeply.`);
  budget.nodes += 1;
  if (budget.nodes > 2_000_000) throw new Error(`${label} is too complex.`);
  if (Array.isArray(value)) {
    value.forEach((child) => assertNoSensitiveFields(child, label, depth + 1, budget));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey(key)) {
      throw new Error(`${label} contains a forbidden sensitive field.`);
    }
    assertNoSensitiveFields(child, label, depth + 1, budget);
  }
}

function canonicalVault(recordValue) {
  const record = plainObject(recordValue, "Vault ciphertext");
  const kdf = plainObject(record.kdf, "Vault KDF");
  const cipher = plainObject(record.cipher, "Vault cipher");
  const iterations = safeInteger(kdf.iterations, "Vault KDF iterations", 100_000, 2_000_000);
  if (record.schema !== 1 || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" ||
      cipher.name !== "AES-GCM") {
    throw new Error("Vault ciphertext format is unsupported.");
  }
  const salt = base64Bytes(kdf.salt, "Vault salt", 256);
  const iv = base64Bytes(cipher.iv, "Vault IV", 256);
  const data = base64Bytes(cipher.data, "Vault ciphertext", 2_700_000);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || data.byteLength < 16) {
    throw new Error("Vault ciphertext dimensions are invalid.");
  }
  return {
    schema: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: kdf.salt },
    cipher: { name: "AES-GCM", iv: cipher.iv, data: cipher.data },
    updatedAt: timestampMs(record.updatedAt, "Vault updatedAt"),
  };
}

function canonicalVaultRecord(value) {
  const record = plainObject(value, "Vault migration record");
  const revision = safeInteger(record.revision, "Vault revision");
  const vault = optionalObject(record.vault, "Vault ciphertext");
  return {
    vault: vault ? canonicalVault(vault) : null,
    revision,
    updatedAt: vault ? timestampMs(record.updatedAt, "Vault record updatedAt") : null,
  };
}

function canonicalDirectoryRecord(value) {
  const record = plainObject(value, "Directory migration record");
  const revision = safeInteger(record.revision, "Directory revision");
  const directory = optionalObject(record.directory, "Directory");
  if (directory) assertNoSensitiveFields(directory, "Directory");
  return {
    directory,
    revision,
    updatedAt: directory ? timestampMs(record.updatedAt, "Directory record updatedAt") : null,
  };
}

function validRunId(value) {
  const runId = cleanText(value, 120);
  if (!/^store-run-[a-z0-9-]+$/i.test(runId)) {
    throw new Error("Run identifier is invalid.");
  }
  return runId;
}

function optionalTimestamp(value, label) {
  return value === undefined || value === null || value === ""
    ? null
    : timestampMs(value, label, { nullable: true });
}

function canonicalRunRecord(value, name) {
  if (!/^runs\/\d{8}\.json$/.test(name)) {
    throw new Error("Run migration record name is invalid.");
  }
  const record = plainObject(value, "Run migration record");
  const run = plainObject(record.run, "Run body");
  const metadata = plainObject(record.metadata, "Run metadata");
  assertNoSensitiveFields(run, "Run body");
  assertNoSensitiveFields(metadata, "Run metadata");
  const runId = validRunId(metadata.runId ?? run.runId);
  if (run.runId !== undefined && validRunId(run.runId) !== runId) {
    throw new Error("Run body and metadata identifiers do not match.");
  }
  const payload = JSON.stringify(run);
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  if (!payloadBytes || payloadBytes > RUN_LIMIT_BYTES) {
    throw new Error("Run body exceeds the 24MB import limit.");
  }
  const sourceUpdatedAt = timestampMs(
    metadata.updatedAt ?? run.updatedAt ?? metadata.finishedAt ?? run.finishedAt,
    "Run source updatedAt",
  );
  const sourceCreatedAt = optionalTimestamp(metadata.sourceCreatedAt, "Run source createdAt") ?? sourceUpdatedAt;
  const sourceRecordUpdatedAt = optionalTimestamp(
    metadata.sourceRecordUpdatedAt,
    "Run source record updatedAt",
  ) ?? sourceUpdatedAt;
  return {
    run,
    payload,
    payloadBytes,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    metadata: {
      id: runId,
      batchId: cleanText(metadata.batchId ?? run.batchId, 120),
      runMode: cleanText(metadata.runMode ?? run.runMode, 40),
      accountId: cleanText(metadata.accountId, 120),
      accountName: cleanText(metadata.accountName, 200),
      usernameMasked: cleanText(metadata.usernameMasked, 160),
      accountGroupId: cleanText(metadata.accountGroupId, 120),
      accountGroupName: cleanText(metadata.accountGroupName, 200),
      storeId: cleanText(metadata.storeId, 120),
      storeName: cleanText(metadata.storeName, 200),
      storeGroupId: cleanText(metadata.storeGroupId, 120),
      storeGroupName: cleanText(metadata.storeGroupName, 200),
      taskType: cleanText(metadata.taskType ?? run.taskType, 40),
      status: cleanText(metadata.status ?? run.status, 40),
      startedAt: optionalTimestamp(metadata.startedAt ?? run.startedAt, "Run startedAt"),
      finishedAt: optionalTimestamp(metadata.finishedAt ?? run.finishedAt, "Run finishedAt"),
      sourceUpdatedAt,
      failureCount: safeInteger(metadata.failureCount ?? 0, "Run failure count", 0, 100_000),
      sourceCreatedAt,
      sourceRecordUpdatedAt,
    },
  };
}

function validateManifest(value, header, catalogSha256, recordCount, counts, revisions) {
  const manifest = plainObject(value, "Migration manifest");
  if (manifest.format !== BUSINESS_MIGRATION_FORMAT ||
      manifest.version !== BUSINESS_MIGRATION_VERSION ||
      manifest.createdAt !== header.createdAt ||
      manifest.consistent !== true ||
      !Number.isFinite(Date.parse(String(manifest.completedAt)))) {
    throw new Error("Migration manifest is unsupported, incomplete, or inconsistent.");
  }
  const catalog = plainObject(manifest.catalog, "Migration manifest catalog");
  if (catalog.algorithm !== BUSINESS_MIGRATION_CATALOG_ALGORITHM ||
      safeInteger(catalog.records, "Migration catalog record count", 2, 1_000_002) !== recordCount ||
      typeof catalog.sha256 !== "string" || catalog.sha256 !== catalogSha256 ||
      manifest.catalogSha256 !== catalogSha256) {
    throw new Error("Migration manifest catalog integrity check failed.");
  }
  const totals = plainObject(manifest.totals, "Migration manifest totals");
  if (safeInteger(totals.vault, "Vault total", 0, 1) !== counts.vault ||
      safeInteger(totals.directory, "Directory total", 0, 1) !== counts.directory ||
      safeInteger(totals.runs, "Run total", 0, 1_000_000) !== counts.runs) {
    throw new Error("Migration manifest totals do not match the package.");
  }
  const sourceRevisions = plainObject(manifest.sourceRevisions, "Migration source revisions");
  if (safeInteger(sourceRevisions.vault, "Vault source revision") !== revisions.vault ||
      safeInteger(sourceRevisions.directory, "Directory source revision") !== revisions.directory) {
    throw new Error("Migration source revisions do not match the package.");
  }
  return {
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt,
    catalogSha256,
    totals: { ...counts },
  };
}

function migrationSource(options) {
  if (options.source && typeof options.source.openLines === "function") return options.source;
  throw new Error("A streaming migration source is required.");
}

export async function scanBusinessMigration(source, passphrase, options = {}) {
  let header;
  let key;
  let lineNumber = 0;
  let expectedIndex = 0;
  let catalogSha256 = BUSINESS_MIGRATION_CATALOG_SEED;
  let packageSha256 = PACKAGE_DIGEST_SEED;
  let manifest;
  let vaultRecord;
  let directoryRecord;
  let runCount = 0;
  let previousRunId = "";

  for await (const rawLine of source.openLines()) {
    lineNumber += 1;
    packageSha256 = await sha256HexText(`${packageSha256}\n${rawLine}`);
    const parsed = parseMigrationLine(rawLine, lineNumber);
    if (lineNumber === 1) {
      header = validateMigrationHeader(parsed);
      key = await deriveMigrationKey(passphrase, header);
      continue;
    }
    if (!header || !key || manifest) {
      throw new Error("Migration manifest must be the final record.");
    }
    const decrypted = await decryptMigrationRecord(key, header, parsed);
    if (decrypted.descriptor.index !== expectedIndex) {
      throw new Error("Migration record ordering is invalid.");
    }
    if (decrypted.descriptor.kind === "vault") {
      if (expectedIndex !== 0 || vaultRecord || decrypted.descriptor.name !== "vault.json") {
        throw new Error("Migration package has an invalid vault record.");
      }
      vaultRecord = canonicalVaultRecord(decrypted.value);
      await options.onRecord?.({ kind: "vault", record: vaultRecord });
    } else if (decrypted.descriptor.kind === "directory") {
      if (expectedIndex !== 1 || directoryRecord || decrypted.descriptor.name !== "directory.json") {
        throw new Error("Migration package has an invalid directory record.");
      }
      directoryRecord = canonicalDirectoryRecord(decrypted.value);
      await options.onRecord?.({ kind: "directory", record: directoryRecord });
    } else if (decrypted.descriptor.kind === "run") {
      if (!vaultRecord || !directoryRecord ||
          decrypted.descriptor.name !== `runs/${String(runCount + 1).padStart(8, "0")}.json`) {
        throw new Error("Migration package has an invalid run record ordering.");
      }
      const runRecord = canonicalRunRecord(decrypted.value, decrypted.descriptor.name);
      if (runRecord.metadata.id <= previousRunId) {
        throw new Error("Migration run identifiers are duplicated or not strictly ordered.");
      }
      previousRunId = runRecord.metadata.id;
      runCount += 1;
      await options.onRecord?.({ kind: "run", record: runRecord });
    } else if (decrypted.descriptor.kind === "manifest") {
      if (!vaultRecord || !directoryRecord || decrypted.descriptor.name !== "manifest.json") {
        throw new Error("Migration package has an invalid manifest record.");
      }
      const counts = {
        vault: vaultRecord.vault ? 1 : 0,
        directory: directoryRecord.directory ? 1 : 0,
        runs: runCount,
      };
      manifest = validateManifest(
        decrypted.value,
        header,
        catalogSha256,
        expectedIndex,
        counts,
        { vault: vaultRecord.revision, directory: directoryRecord.revision },
      );
      expectedIndex += 1;
      continue;
    } else {
      throw new Error("Migration record kind is invalid.");
    }
    catalogSha256 = await appendMigrationCatalogHash(catalogSha256, decrypted.summary);
    expectedIndex += 1;
  }

  if (!header || !vaultRecord || !directoryRecord || !manifest || lineNumber < 4) {
    throw new Error("Migration package is missing required records.");
  }
  return { header, manifest, vaultRecord, directoryRecord, packageSha256 };
}

function decodeRunDataKey(value) {
  const encoded = String(value ?? "").trim();
  const bytes = base64Bytes(encoded, "RUN_DATA_KEY", 128);
  if (bytes.byteLength !== 32) {
    throw new Error("RUN_DATA_KEY must be base64 for exactly 32 bytes.");
  }
  return bytes;
}

async function prepareRunEncryptionKey(runDataKey) {
  const raw = decodeRunDataKey(runDataKey);
  return webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
}

async function encryptRunPayload(plaintext, key) {
  const iv = randomBytes(12);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: RUN_AAD },
    key,
    new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({
    version: 1,
    algorithm: "AES-GCM",
    iv: iv.toString("base64"),
    ciphertext: Buffer.from(encrypted).toString("base64"),
  });
}

function targetBusinessCounts(database) {
  const row = database.prepare(`
    SELECT
      (SELECT count(*) FROM shared_vault) AS vault_count,
      (SELECT count(*) FROM shared_documents) AS directory_count,
      (SELECT count(*) FROM runs) AS run_count
  `).get();
  return {
    vault: Number(row.vault_count),
    directory: Number(row.directory_count),
    runs: Number(row.run_count),
  };
}

function assertEmptyBusinessTarget(database) {
  const counts = targetBusinessCounts(database);
  if (counts.vault || counts.directory || counts.runs) {
    throw new Error("Target business tables are not empty; import refuses to overwrite existing data.");
  }
}

function insertVaultRecord(database, vaultRecord) {
  const now = Date.now();
  if (vaultRecord.vault) {
    const payload = JSON.stringify(vaultRecord.vault);
    database.prepare(`
      INSERT INTO shared_vault
        (id, encrypted_payload, payload_bytes, revision, updated_by, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      payload,
      Buffer.byteLength(payload),
      vaultRecord.revision,
      IMPORT_ACTOR,
      vaultRecord.updatedAt ?? now,
      vaultRecord.updatedAt ?? now,
    );
  }
}

function insertDirectoryRecord(database, directoryRecord) {
  const now = Date.now();
  if (directoryRecord.directory) {
    const payload = JSON.stringify(directoryRecord.directory);
    database.prepare(`
      INSERT INTO shared_documents
        (key, json_payload, payload_bytes, revision, updated_by, created_at, updated_at)
      VALUES ('project_directory', ?, ?, ?, ?, ?, ?)
    `).run(
      payload,
      Buffer.byteLength(payload),
      directoryRecord.revision,
      IMPORT_ACTOR,
      directoryRecord.updatedAt ?? now,
      directoryRecord.updatedAt ?? now,
    );
  }
}

function prepareRunInsert(database) {
  return database.prepare(`
    INSERT INTO runs (
      id, batch_id, run_mode, account_id, account_name, username_masked,
      account_group_id, account_group_name, store_id, store_name,
      store_group_id, store_group_name, task_type, status, started_at,
      finished_at, source_updated_at, failure_count, blob_key, payload_bytes,
      payload_sha256, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
}

function insertRunRecord(insertRun, entry) {
  const metadata = entry.metadata;
  insertRun.run(
    metadata.id,
    metadata.batchId,
    metadata.runMode,
    metadata.accountId,
    metadata.accountName,
    metadata.usernameMasked,
    metadata.accountGroupId,
    metadata.accountGroupName,
    metadata.storeId,
    metadata.storeName,
    metadata.storeGroupId,
    metadata.storeGroupName,
    metadata.taskType,
    metadata.status,
    metadata.startedAt,
    metadata.finishedAt,
    metadata.sourceUpdatedAt,
    metadata.failureCount,
    `runs/${metadata.id}.json`,
    entry.payloadBytes,
    entry.payloadSha256,
    IMPORT_ACTOR,
    metadata.sourceCreatedAt,
    metadata.sourceRecordUpdatedAt,
  );
}

async function cleanupImportedRunObjects(database, objectStore, untrackedKey) {
  if (untrackedKey) await objectStore.delete(untrackedKey).catch(() => {});
  const page = database.prepare(`
    SELECT blob_key FROM runs
    WHERE blob_key > ?
    ORDER BY blob_key
    LIMIT 256
  `);
  let cursor = "";
  while (true) {
    const rows = page.all(cursor);
    if (!rows.length) return;
    for (const row of rows) {
      const key = String(row.blob_key ?? "");
      if (!key || key <= cursor) throw new Error("Migration cleanup pagination did not advance.");
      await objectStore.delete(key).catch(() => {});
      cursor = key;
    }
  }
}

export async function importBusinessMigration(options) {
  const source = migrationSource(options);
  const verified = options.verified ?? await scanBusinessMigration(source, options.passphrase);
  if (options.dryRun) {
    return {
      dryRun: true,
      manifest: verified.manifest,
      packageSha256: verified.packageSha256,
      imported: verified.manifest.totals,
    };
  }
  if (!options.database || !options.objectStore) {
    throw new Error("Migration target database and object store are required.");
  }
  assertEmptyBusinessTarget(options.database);
  const runEncryptionKey = await prepareRunEncryptionKey(options.runDataKey);
  const insertRun = prepareRunInsert(options.database);
  let untrackedKey = "";
  let transactionOpen = false;
  try {
    options.database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertEmptyBusinessTarget(options.database);
    const imported = await scanBusinessMigration(source, options.passphrase, {
      async onRecord({ kind, record }) {
        if (kind === "vault") {
          insertVaultRecord(options.database, record);
        } else if (kind === "directory") {
          insertDirectoryRecord(options.database, record);
        } else {
          const key = `runs/${record.metadata.id}.json`;
          untrackedKey = key;
          const encrypted = await encryptRunPayload(record.payload, runEncryptionKey);
          await options.objectStore.put(key, encrypted, {
            contentType: "application/vnd.taobao.run+encrypted",
            sha256: record.payloadSha256,
            payloadBytes: String(record.payloadBytes),
          });
          insertRunRecord(insertRun, record);
          untrackedKey = "";
        }
      },
    });
    if (imported.packageSha256 !== verified.packageSha256 ||
        imported.manifest.catalogSha256 !== verified.manifest.catalogSha256 ||
        imported.manifest.createdAt !== verified.manifest.createdAt) {
      throw new Error("Migration package changed between validation and import.");
    }
    options.database.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        await cleanupImportedRunObjects(options.database, options.objectStore, untrackedKey);
      } catch {
        // Preserve the validation/import failure; any leftover object is still
        // encrypted and unreferenced after the database rollback.
      } finally {
        options.database.exec("ROLLBACK");
      }
    }
    throw error;
  }
  return { dryRun: false, manifest: verified.manifest, imported: verified.manifest.totals };
}

function userTableNames(database) {
  return database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> '__drizzle_migrations'
    ORDER BY name
  `).all().map((row) => String(row.name ?? "")).filter(Boolean);
}

export function applyTargetMigrations(database, migrationsFolder) {
  const folder = resolve(migrationsFolder);
  if (!existsSync(resolve(folder, "meta", "_journal.json"))) {
    throw new Error(`Target migration files are unavailable at ${folder}.`);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC NOT NULL UNIQUE
    )
  `);
  const appliedRows = database.prepare(
    "SELECT hash, created_at FROM __drizzle_migrations",
  ).all();
  if (!appliedRows.length && userTableNames(database).length) {
    throw new Error("Target SQLite has tables but no trusted migration ledger.");
  }
  const applied = new Map(appliedRows.map((row) => [Number(row.created_at), String(row.hash)]));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  for (const migration of migrations) {
    const knownHash = applied.get(migration.folderMillis);
    if (knownHash && knownHash !== migration.hash) {
      throw new Error(`Target migration checksum mismatch for ${migration.folderMillis}.`);
    }
  }
  const insertMigration = database.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const migration of migrations) {
    if (applied.has(migration.folderMillis)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.sql) {
        if (statement.trim()) database.exec(statement);
      }
      insertMigration.run(migration.hash, migration.folderMillis);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function missing(error) {
  return error?.code === "ENOENT";
}

export function createFileMigrationObjectStore(rootValue) {
  const root = resolve(rootValue);
  mkdirSync(resolve(root, "runs"), { recursive: true, mode: 0o700 });

  async function objectPath(key) {
    if (!/^runs\/store-run-[a-z0-9-]+\.json$/i.test(key)) {
      throw new Error("Invalid target run object key.");
    }
    const rootPath = await realpath(root);
    const runDirectory = resolve(root, "runs");
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const parent = await realpath(runDirectory);
    if (parent !== rootPath && !parent.startsWith(`${rootPath}${sep}`)) {
      throw new Error("Target run object directory escapes its configured root.");
    }
    return resolve(parent, basename(key));
  }

  return {
    async put(key, value) {
      const target = await objectPath(key);
      try {
        await lstat(target);
        throw new Error(`Target run object already exists for ${key}.`);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      const temporary = resolve(dirname(target), `.${basename(target)}.${randomBytes(12).toString("hex")}.tmp`);
      try {
        await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
        await link(temporary, target);
      } finally {
        await unlink(temporary).catch((error) => {
          if (!missing(error)) throw error;
        });
      }
    },
    async delete(key) {
      const target = await objectPath(key);
      await unlink(target).catch((error) => {
        if (!missing(error)) throw error;
      });
    },
  };
}

export function openMigrationDatabase(databasePath, migrationsFolder) {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(resolvedPath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  try {
    applyTargetMigrations(database, migrationsFolder);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function* boundedFileLines(path) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts = [];
  let bufferedBytes = 0;
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  for await (const chunkValue of stream) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline === -1 ? chunk.length : newline;
      const slice = chunk.subarray(start, end);
      if (slice.length) {
        bufferedBytes += slice.length;
        if (bufferedBytes > BUSINESS_MIGRATION_MAX_LINE_BYTES) {
          stream.destroy();
          throw new Error("Migration line exceeds the bounded 40MB input limit.");
        }
        parts.push(slice);
      }
      if (newline === -1) break;
      const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts, bufferedBytes);
      const content = bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
      yield decoder.decode(content);
      parts.length = 0;
      bufferedBytes = 0;
      start = newline + 1;
    }
  }
  if (bufferedBytes) {
    const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts, bufferedBytes);
    const content = bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
    yield decoder.decode(content);
  }
}

export async function createMigrationFileSource(pathValue) {
  const path = resolve(pathValue);
  const expected = await lstat(path);
  if (!expected.isFile() || expected.isSymbolicLink()) {
    throw new Error("Migration package must be a regular, non-symlink file.");
  }
  return {
    path,
    async *openLines() {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || !sameFile(expected, before)) {
        throw new Error("Migration package changed after it was selected.");
      }
      yield* boundedFileLines(path);
      const after = await lstat(path);
      if (!sameFile(before, after)) {
        throw new Error("Migration package changed while it was being read.");
      }
    },
  };
}
