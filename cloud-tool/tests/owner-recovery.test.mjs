import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalRecoveryTokenHash,
  OWNER_RECOVERY_CODE_MAX_LENGTH,
  OWNER_RECOVERY_CODE_MIN_LENGTH,
  recoveryCodeMatchesHash,
  recoverySecretMeetsPolicy,
} from "../app/server/owner-recovery-primitives.ts";
import { sha256Hex } from "../app/server/auth-primitives.ts";

const recoveryCode = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index + 41),
).toString("base64url");

test("accepts only canonical 32-byte base64url recovery codes and compares their SHA-256 in constant time", async () => {
  assert.equal(recoveryCode.length, 43);
  assert.equal(OWNER_RECOVERY_CODE_MIN_LENGTH, 43);
  assert.equal(OWNER_RECOVERY_CODE_MAX_LENGTH, 43);
  assert.equal(recoverySecretMeetsPolicy(recoveryCode), true);
  for (const invalid of [
    recoveryCode.slice(0, 42),
    `${recoveryCode}=`,
    "A".repeat(43),
    "not-a-recovery-code",
  ]) {
    assert.equal(recoverySecretMeetsPolicy(invalid), false, invalid);
  }
  const hash = await sha256Hex(recoveryCode);
  assert.equal(canonicalRecoveryTokenHash(hash.toUpperCase()), hash);
  assert.equal(await recoveryCodeMatchesHash(recoveryCode, hash), true);
  assert.equal(
    await recoveryCodeMatchesHash(
      Buffer.alloc(32, 99).toString("base64url"),
      hash,
    ),
    false,
  );
});

test("owner recovery requires admin plus deployment code and commits replay marker, temporary password, revocation and audit atomically", async () => {
  const [route, resetRoute, runtime, audit] = await Promise.all([
    readFile(new URL("../app/api/auth/owner-recovery/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/members/[id]/reset-password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/owner-recovery.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/audit.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireSession\(request, \["admin"\]\)/);
  assert.match(route, /verifyOwnerRecoveryCode\(body\.recoveryCode\)/);
  assert.match(runtime, /OWNER_RECOVERY_TOKEN_HASH/);
  assert.match(runtime, /OWNER_RECOVERY_TOKEN/);
  assert.match(runtime, /OWNER_RECOVERY_TOKEN_EXPIRES_AT/);
  assert.match(runtime, /recoveryCodeMatchesHash/);
  assert.match(runtime, /60 \* 60 \* 1000/);
  assert.match(resetRoute, /OWNER_PASSWORD_RESET_BLOCKED/);

  const batch = route.slice(route.indexOf("await db.batch(["));
  assert.match(batch, /db\.insert\(ownerRecoveryUses\)/);
  assert.match(batch, /mustChangePassword: true/);
  assert.match(batch, /changes\(\) <> 1/);
  assert.match(batch, /db\.insert\(ownerRecoveryUses\)\.select\(sql`/);
  assert.doesNotMatch(batch, /db\.run\(sql`/);
  assert.match(batch, /update\(authSessions\)/);
  assert.match(batch, /db\.insert\(auditLogs\)/);
  assert.doesNotMatch(route, /verifyPassword/);
  assert.doesNotMatch(route, /writeAudit/);
  assert.match(audit, /export function auditRecord/);
  assert.doesNotMatch(batch, /recoveryCode|newPassword|confirmPassword/);
});

test("replay protection is append-only migration state with valid Drizzle metadata", async () => {
  const [migration, journalText, priorText, snapshotText, schema] = await Promise.all([
    readFile(new URL("../drizzle/0003_owner_recovery_uses.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/0002_snapshot.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/0003_snapshot.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  const journal = JSON.parse(journalText);
  const prior = JSON.parse(priorText);
  const snapshot = JSON.parse(snapshotText);
  assert.match(migration, /CREATE TABLE `owner_recovery_uses`/);
  assert.match(migration, /`token_hash` text PRIMARY KEY NOT NULL/);
  assert.match(schema, /ownerRecoveryUses = sqliteTable\("owner_recovery_uses"/);
  assert.equal(journal.entries.at(-1).tag, "0003_owner_recovery_uses");
  assert.equal(snapshot.prevId, prior.id);
  assert.ok(snapshot.tables.owner_recovery_uses);
  assert.equal(snapshot.tables.owner_recovery_uses.columns.token_hash.primaryKey, true);
  assert.equal(prior.tables.owner_recovery_uses, undefined);
});

test("recovery form keeps secrets memory-only, never accepts a URL code, and never reveals either password field", async () => {
  const [client, page, config] = await Promise.all([
    readFile(new URL("../app/components/owner-recovery-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/owner-recovery/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(client, /localStorage|sessionStorage|searchParams|location\.href/);
  assert.doesNotMatch(client, /showPassword|EyeIcon|EyeOffIcon|type=\{/);
  assert.match(client, /id="owner-recovery-code"[\s\S]*?type="password"/);
  assert.match(client, /id="owner-recovery-password"[\s\S]*?type="password"/);
  assert.match(client, /id="owner-recovery-confirm"[\s\S]*?type="password"/);
  assert.match(client, /setRecoveryCode\(""\)[\s\S]*?requestJson\("\/api\/auth\/owner-recovery"/);
  assert.match(client, /finally \{[\s\S]*?setRecoveryCode\(""\)/);
  assert.match(page, /session\.member\.role !== "admin"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(config, /source: "\/owner-recovery"[\s\S]*?no-store/);
});
