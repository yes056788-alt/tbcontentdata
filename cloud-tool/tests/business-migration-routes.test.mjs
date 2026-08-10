import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("migration export and pagination endpoints are owner-only", async () => {
  const exportRoute = await source("../app/api/admin/migration/export/route.ts");
  const runsRoute = await source("../app/api/admin/migration/runs/route.ts");
  assert.match(exportRoute, /requireSession\(request, \["owner"\]\)/);
  assert.match(runsRoute, /requireSession\(request, \["owner"\]\)/);
  assert.match(runsRoute, /nextCursor/);
  assert.match(runsRoute, /\.limit\(limit \+ 1\)/);
  assert.doesNotMatch(exportRoute, /localAccounts|authSessions|PASSWORD_PEPPER/);
});

test("migration package is encrypted, manifested, and explicitly excludes sensitive sources", async () => {
  const exportSource = await source("../app/server/migration-export.ts");
  assert.match(exportSource, /encryptMigrationRecord/);
  assert.match(exportSource, /catalogSha256/);
  assert.match(exportSource, /pagedRunRows/);
  assert.match(exportSource, /\.limit\(MIGRATION_RUN_PAGE_SIZE\)/);
  assert.match(exportSource, /async pull\(controller\)/);
  assert.match(exportSource, /for await \(const row of pagedRunRows\(\)\)/);
  assert.match(exportSource, /const consistent =/);
  assert.match(exportSource, /assertMigrationSafeRun/);
  assert.doesNotMatch(exportSource, /summaries\s*=\s*\[|runRows\s*[:,=]/);
  assert.doesNotMatch(exportSource, /authSessions|localAccounts|members|process\.env/);
});

test("browser and CLI keep migration packages streaming instead of materializing them", async () => {
  const client = await source("../app/components/migration-client.tsx");
  const importer = await source("../scripts/lib/business-migration-import.mjs");
  const cli = await source("../scripts/import-business-migration.mjs");
  assert.match(client, /response\.body\.pipeTo\(writable\)/);
  assert.doesNotMatch(client, /response\.blob\(|createObjectURL/);
  assert.match(importer, /createReadStream/);
  assert.match(importer, /boundedFileLines/);
  assert.match(importer, /for await \(const rawLine of source\.openLines\(\)\)/);
  assert.doesNotMatch(importer, /readFile\(|parseMigrationLines|runs\.push\(/);
  assert.match(cli, /createMigrationFileSource/);
  assert.doesNotMatch(cli, /readMigrationPackage|packageText/);
});

test("migration page is server-gated and protected responses are no-store", async () => {
  const page = await source("../app/migration/page.tsx");
  const config = await source("../next.config.ts");
  const adminClient = await source("../app/components/admin-client.tsx");
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /await requireProtectedPage\("\/migration"\)/);
  assert.match(config, /source: "\/migration"[\s\S]*?Cache-Control[\s\S]*?no-store/);
  assert.match(adminClient, /isOwner[\s\S]*?href="\/migration"/);
});

test("CLI accepts migration secrets only from environment variables", async () => {
  const cli = await source("../scripts/import-business-migration.mjs");
  assert.match(cli, /process\.env\.TB_MIGRATION_PASSPHRASE/);
  assert.match(cli, /process\.env\.RUN_DATA_KEY/);
  assert.doesNotMatch(cli, /--passphrase|--run-data-key/);
  assert.match(cli, /dryRun: true/);
});
