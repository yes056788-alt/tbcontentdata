#!/usr/bin/env node

import { resolve } from "node:path";
import {
  createFileMigrationObjectStore,
  createMigrationFileSource,
  importBusinessMigration,
  openMigrationDatabase,
} from "./lib/business-migration-import.mjs";

function usage() {
  return `Usage:
  TB_MIGRATION_PASSPHRASE='...' node scripts/import-business-migration.mjs \\
    --package /secure/path/export.tbmig [--dry-run]

  TB_MIGRATION_PASSPHRASE='...' RUN_DATA_KEY='base64-32-byte-key' \\
    node scripts/import-business-migration.mjs \\
    --package /secure/path/export.tbmig \\
    [--sqlite .data/team.sqlite] [--objects .data/objects] [--migrations drizzle] \\
    [--recreate-vault]

The migration passphrase and RUN_DATA_KEY are accepted only through environment
variables so they do not appear in shell history as command-line arguments.
The importer accepts v2/v3/v4 packages; current exports use v4 so a shared-vault
deletion tombstone and its revision survive a same-origin migration.
The importer refuses to overwrite non-empty business tables or run objects.
--recreate-vault is required to replace a durable shared-vault tombstone.`;
}

function parseArguments(argv) {
  const options = { dryRun: false, recreateVault: false };
  const valueOptions = new Set(["--package", "--sqlite", "--objects", "--migrations"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--recreate-vault") {
      options.recreateVault = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!valueOptions.has(argument) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    const key = argument.slice(2);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${argument}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.package) throw new Error("--package is required.\n\n" + usage());
  const passphrase = String(process.env.TB_MIGRATION_PASSPHRASE ?? "");
  if (!passphrase) {
    throw new Error("TB_MIGRATION_PASSPHRASE is required and is never accepted as a command-line argument.");
  }
  const source = await createMigrationFileSource(options.package);

  // Always finish every cryptographic, schema, consistency and sensitive-field
  // check before the importer opens or creates the target SQLite database.
  const verified = await importBusinessMigration({ source, passphrase, dryRun: true });
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "dry-run",
      formatVersion: verified.manifest.version,
      createdAt: verified.manifest.createdAt,
      catalogSha256: verified.manifest.catalogSha256,
      records: verified.imported,
    }, null, 2)}\n`);
    return;
  }

  const runDataKey = String(process.env.RUN_DATA_KEY ?? "");
  if (!runDataKey) throw new Error("RUN_DATA_KEY is required for a real import.");
  const databasePath = resolve(options.sqlite || process.env.DATABASE_PATH || ".data/team.sqlite");
  const objectsPath = resolve(options.objects || process.env.RUNS_PATH || ".data/objects");
  const migrationsPath = resolve(options.migrations || process.env.MIGRATIONS_PATH || "drizzle");
  const database = openMigrationDatabase(databasePath, migrationsPath);
  try {
    const result = await importBusinessMigration({
      source,
      passphrase,
      verified,
      database,
      objectStore: createFileMigrationObjectStore(objectsPath),
      runDataKey,
      recreateVault: options.recreateVault,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "import",
      formatVersion: result.manifest.version,
      createdAt: result.manifest.createdAt,
      catalogSha256: result.manifest.catalogSha256,
      records: result.imported,
      databasePath,
      objectsPath,
    }, null, 2)}\n`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Business migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
