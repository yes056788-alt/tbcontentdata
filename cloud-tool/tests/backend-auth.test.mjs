import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createOpaqueSessionToken,
  hashPassword,
  LOGIN_FAILURE_LIMIT,
  LOGIN_LOCK_MILLISECONDS,
  normalizeUsername,
  nextLoginFailureState,
  passwordMeetsPolicy,
  PASSWORD_ITERATIONS,
  SESSION_DURATION_SECONDS,
  sha256Hex,
  verifyPassword,
} from "../app/server/auth-primitives.ts";
import {
  isLocalAccountRole,
  isManagedLocalAccountRole,
  localAccountRoles,
} from "../app/server/local-account-role.ts";

test("normalizes usernames deterministically", () => {
  assert.equal(normalizeUsername("  Ａdmin_01  "), "admin_01");
  assert.equal(normalizeUsername("运营-甲"), "运营-甲");
});

test("enforces the server-side password policy promised by the UI", () => {
  assert.equal(passwordMeetsPolicy("Long-Enough-Value1!"), true);
  assert.equal(passwordMeetsPolicy("LongEnoughOnly"), false);
  assert.equal(passwordMeetsPolicy("12345678901!"), false);
  assert.equal(passwordMeetsPolicy("TwelveChars1!"), false);
});

test("hashes passwords with Worker-compatible PBKDF2-SHA256", async () => {
  const password = "Correct-Horse-100000!";
  const record = await hashPassword(password);
  assert.equal(record.iterations, 100_000);
  assert.equal(PASSWORD_ITERATIONS, 100_000);
  assert.notEqual(record.hash, password);
  assert.equal(
    await verifyPassword(password, record.salt, record.hash, record.iterations),
    true,
  );
  assert.equal(
    await verifyPassword("wrong-password!1", record.salt, record.hash, record.iterations),
    false,
  );
});

test("keeps the deployed PBKDF2 implementation on a fixed compatibility vector", async () => {
  assert.equal(
    await verifyPassword(
      "Correct-Horse-100000!",
      "AAAAAAAAAAAAAAAAAAAAAA==",
      "RDtgW6Pm/A4xllKTqitbshM91btIbTmYC+bFCwtFtcM=",
      100_000,
    ),
    true,
  );

  const [primitivesSource, cryptoSource] = await Promise.all([
    readFile(new URL("../app/server/auth-primitives.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/auth-crypto.ts", import.meta.url), "utf8"),
  ]);
  assert.match(primitivesSource, /deriveBits\(/);
  assert.match(cryptoSource, /PASSWORD_PEPPER/);
  assert.match(cryptoSource, /PASSWORD_AUTH_NOT_CONFIGURED/);
});

test("creates opaque sessions and stores a one-way token hash", async () => {
  const first = createOpaqueSessionToken();
  const second = createOpaqueSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const hash = await sha256Hex(first);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, first);
  assert.equal(SESSION_DURATION_SECONDS, 7 * 24 * 60 * 60);
});

test("keeps login lockout and cookie protections in backend source", async () => {
  assert.equal(LOGIN_FAILURE_LIMIT, 5);
  assert.equal(LOGIN_LOCK_MILLISECONDS, 15 * 60 * 1000);
  const authSource = await readFile(
    new URL("../app/server/auth.ts", import.meta.url),
    "utf8",
  );
  for (const directive of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age="]) {
    assert.match(authSource, new RegExp(directive.replace("-", "\\-")));
  }
  assert.match(authSource, /CROSS_ORIGIN_WRITE_BLOCKED/);
});

test("locks on the fifth failure for fifteen minutes and resets after expiry", () => {
  const now = 1_800_000_000_000;
  let attempts = 0;
  let lockedUntil = null;
  for (let index = 0; index < 5; index += 1) {
    const state = nextLoginFailureState(attempts, lockedUntil, now + index);
    attempts = state.attempts;
    lockedUntil = state.lockedUntilMs;
  }
  assert.equal(attempts, 5);
  assert.equal(lockedUntil, now + 4 + 15 * 60 * 1000);
  const afterExpiry = nextLoginFailureState(5, lockedUntil, lockedUntil + 1);
  assert.deepEqual(afterExpiry, { attempts: 1, lockedUntilMs: null });
});

test("migration stores only session token hashes", async () => {
  const migration = await readFile(
    new URL("../drizzle/0001_swift_dreaming_celestial.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
  assert.match(migration, /`token_hash` text NOT NULL/);
  assert.doesNotMatch(migration, /`token` text NOT NULL/);
  assert.match(migration, /CREATE TABLE `local_accounts`/);
  assert.match(migration, /`must_change_password` integer/);
});

test("applies the Worker-compatible password migration and accepts new credentials", async () => {
  const migrations = await Promise.all(
    [
      "../drizzle/0000_open_lifeguard.sql",
      "../drizzle/0001_swift_dreaming_celestial.sql",
      "../drizzle/0002_absent_ken_ellis.sql",
      "../drizzle/0003_owner_recovery_uses.sql",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const database = new DatabaseSync(":memory:");
  try {
    migrations.forEach((migration) => database.exec(migration));
    assert.ok(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'owner_recovery_uses'")
        .get(),
    );
    database.exec(`
      INSERT INTO members (id, email, display_name, role, status)
      VALUES ('owner-1', 'owner@local.invalid', 'Owner', 'owner', 'active');
      INSERT INTO local_accounts (
        member_id, username, username_normalized, password_salt,
        password_hash, password_iterations, must_change_password
      ) VALUES (
        'owner-1', 'owner', 'owner', 'AAAAAAAAAAAAAAAAAAAAAA==',
        'RDtgW6Pm/A4xllKTqitbshM91btIbTmYC+bFCwtFtcM=', 100000, 0
      );
    `);
    const row = database
      .prepare(
        "SELECT password_iterations AS iterations, must_change_password AS mustChange FROM local_accounts WHERE member_id = ?",
      )
      .get("owner-1");
    assert.equal(row?.iterations, 100_000);
    assert.equal(row?.mustChange, 0);
  } finally {
    database.close();
  }
});

test("first release only issues owner and admin local sessions", async () => {
  assert.deepEqual(localAccountRoles, ["owner", "admin"]);
  assert.equal(isLocalAccountRole("owner"), true);
  assert.equal(isLocalAccountRole("admin"), true);
  assert.equal(isLocalAccountRole("operator"), false);
  assert.equal(isLocalAccountRole("viewer"), false);
  assert.equal(isManagedLocalAccountRole("admin"), true);
  assert.equal(isManagedLocalAccountRole("operator"), false);

  const [authSource, authzSource, memberAdminSource] = await Promise.all([
    readFile(new URL("../app/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/authz.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/member-admin.ts", import.meta.url), "utf8"),
  ]);
  assert.match(authSource, /if \(!isLocalAccountRole\(member\.role\)\)/);
  assert.match(authzSource, /if \(!isLocalAccountRole\(row\.member\.role\)\)/);
  assert.match(memberAdminSource, /当前版本仅支持管理员账号/);
  assert.match(memberAdminSource, /LOCAL_ACCOUNT_ROLE_UNSUPPORTED/);
});

test("member credential APIs reject lower roles", async () => {
  const [membersSource, memberSource, resetSource] = await Promise.all([
    readFile(new URL("../app/api/admin/members/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/members/[id]/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/admin/members/[id]/reset-password/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(membersSource, /validateManagedRole\(body\.role, "admin"\)/);
  assert.match(memberSource, /validateManagedRole\(body\.role\)/);
  assert.match(memberSource, /isManagedLocalAccountRole\(row\.member\.role\)/);
  assert.match(resetSource, /isManagedLocalAccountRole\(row\.member\.role\)/);
  assert.ok(
    membersSource.lastIndexOf('target.member.role === "owner"') <
      membersSource.lastIndexOf("validateManagedRole(body.role)"),
  );
  assert.ok(
    memberSource.lastIndexOf('row.member.role === "owner"') <
      memberSource.lastIndexOf("validateManagedRole(body.role)"),
  );
});
