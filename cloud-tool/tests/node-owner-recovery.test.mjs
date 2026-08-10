import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverPath = join(root, "dist", "standalone", "server.js");
const standaloneMissing = !existsSync(serverPath);

function recoveryCode(seed) {
  return Buffer.from(
    Array.from({ length: 32 }, (_, index) => (seed + index * 17) % 256),
  ).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitUntilReady(origin, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`standalone server exited early\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${origin}/api/auth/status`);
      if (response.ok) return;
    } catch {
      // Server is still binding its loopback port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`standalone server did not become ready\n${logs.join("")}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function startServer(origin, dataRoot, logs, recovery = null) {
  const url = new URL(origin);
  const recoveryEnvironment = recovery
    ? {
        ...(recovery.kind === "hash"
          ? { OWNER_RECOVERY_TOKEN_HASH: sha256(recovery.code) }
          : { OWNER_RECOVERY_TOKEN: recovery.code }),
        OWNER_RECOVERY_TOKEN_EXPIRES_AT: new Date(
          Date.now() + 30 * 60 * 1000,
        ).toISOString(),
      }
    : {};
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: url.port,
      APP_DATA_DIR: dataRoot,
      MIGRATIONS_PATH: join(root, "drizzle"),
      APP_PUBLIC_ORIGIN: origin,
      PASSWORD_PEPPER: "node-recovery-pepper-0123456789-abcdefghijklmnopqrstuvwxyz",
      RUN_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      BOOTSTRAP_TOKEN: "node-recovery-bootstrap-0123456789abcdef",
      NODE_CONFIG_VALIDATED: "",
      OWNER_RECOVERY_TOKEN: "",
      OWNER_RECOVERY_TOKEN_HASH: "",
      OWNER_RECOVERY_TOKEN_EXPIRES_AT: "",
      ...recoveryEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (value) => logs.push(String(value)));
  child.stderr.on("data", (value) => logs.push(String(value)));
  return child;
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

function jsonRequest(origin, pathname, { method = "GET", cookie = "", body } = {}) {
  return fetch(`${origin}${pathname}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { origin }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: {} };
  }
}

async function login(origin, username, password) {
  const response = await jsonRequest(origin, "/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  const payload = await responseJson(response);
  return { response, ...payload, cookie: cookieFrom(response) };
}

async function recover(origin, adminCookie, code, password) {
  const response = await jsonRequest(origin, "/api/auth/owner-recovery", {
    method: "POST",
    cookie: adminCookie,
    body: {
      recoveryCode: code,
      newPassword: password,
      confirmPassword: password,
    },
  });
  const payload = await responseJson(response);
  return { response, ...payload };
}

async function changePassword(origin, cookie, currentPassword, newPassword) {
  const response = await jsonRequest(origin, "/api/auth/change-password", {
    method: "POST",
    cookie,
    body: { currentPassword, newPassword },
  });
  const payload = await responseJson(response);
  return { response, ...payload, cookie: cookieFrom(response) };
}

test(
  "owner recovery is atomic, one-time across A-B-A rotation, concurrent-safe, audited, and removable",
  { skip: standaloneMissing && "run npm run build:node first", timeout: 90_000 },
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "tbdata-owner-recovery-"));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const logs = [];
    const codeA = recoveryCode(11);
    const codeB = recoveryCode(29);
    const codeC = recoveryCode(47);
    const codeD = recoveryCode(83);
    let child = startServer(origin, dataRoot, logs, { code: codeA, kind: "raw" });
    let database;
    try {
      await waitUntilReady(origin, child, logs);
      const initialOwnerPassword = "Owner-Initial-Password-2026!";
      const setup = await jsonRequest(origin, "/api/auth/setup", {
        method: "POST",
        body: {
          bootstrapToken: "node-recovery-bootstrap-0123456789abcdef",
          username: "recoveryowner",
          displayName: "Recovery Owner",
          password: initialOwnerPassword,
        },
      });
      const setupPayload = await responseJson(setup);
      assert.equal(setup.status, 201, setupPayload.text);
      const ownerId = setupPayload.body.member.id;
      const initialOwnerCookie = cookieFrom(setup);
      assert.ok(initialOwnerCookie);

      const adminTemporaryPassword = "Admin-Temporary-Password-2026!";
      const createdAdmin = await jsonRequest(origin, "/api/admin/members", {
        method: "POST",
        cookie: initialOwnerCookie,
        body: {
          username: "recoveryadmin",
          displayName: "Recovery Admin",
          role: "admin",
          temporaryPassword: adminTemporaryPassword,
        },
      });
      assert.equal(createdAdmin.status, 201, (await responseJson(createdAdmin)).text);
      const adminLogin = await login(
        origin,
        "recoveryadmin",
        adminTemporaryPassword,
      );
      assert.equal(adminLogin.response.status, 200, adminLogin.text);
      const adminPrivatePassword = "Admin-Private-Password-2026!";
      const changedAdmin = await changePassword(
        origin,
        adminLogin.cookie,
        adminTemporaryPassword,
        adminPrivatePassword,
      );
      assert.equal(changedAdmin.response.status, 200, changedAdmin.text);
      const adminCookie = changedAdmin.cookie;
      assert.ok(adminCookie);

      const ordinaryReset = await jsonRequest(
        origin,
        `/api/admin/members/${encodeURIComponent(ownerId)}/reset-password`,
        {
          method: "POST",
          cookie: adminCookie,
          body: { temporaryPassword: "Blocked-Owner-Reset-2026!" },
        },
      );
      assert.equal(ordinaryReset.status, 409, (await responseJson(ordinaryReset)).text);

      const wrongCode = recoveryCode(101);
      const invalid = await recover(
        origin,
        adminCookie,
        wrongCode,
        "Wrong-Code-Password-2026!",
      );
      assert.equal(invalid.response.status, 401, invalid.text);

      const temporaryA = "Owner-Temporary-A-2026!";
      const recoveredA = await recover(origin, adminCookie, codeA, temporaryA);
      assert.equal(recoveredA.response.status, 200, recoveredA.text);
      assert.equal(recoveredA.body.mustChangePassword, true);
      const revokedInitial = await jsonRequest(origin, "/api/session", {
        cookie: initialOwnerCookie,
      });
      assert.equal(revokedInitial.status, 401, (await responseJson(revokedInitial)).text);
      assert.equal((await login(origin, "recoveryowner", initialOwnerPassword)).response.status, 401);
      const ownerLoginA = await login(origin, "recoveryowner", temporaryA);
      assert.equal(ownerLoginA.response.status, 200, ownerLoginA.text);
      assert.equal(ownerLoginA.body.mustChangePassword, true);
      const forcedChangePage = await jsonRequest(origin, "/", {
        cookie: ownerLoginA.cookie,
      });
      assert.ok([302, 307].includes(forcedChangePage.status));
      assert.equal(forcedChangePage.headers.get("location"), "/change-password");
      const privateA = "Owner-Private-A-After-Recovery-2026!";
      const changedOwnerA = await changePassword(
        origin,
        ownerLoginA.cookie,
        temporaryA,
        privateA,
      );
      assert.equal(changedOwnerA.response.status, 200, changedOwnerA.text);
      let ownerCookie = changedOwnerA.cookie;

      const adminAfterA = await jsonRequest(origin, "/api/session", {
        cookie: adminCookie,
      });
      const adminAfterAPayload = await responseJson(adminAfterA);
      assert.equal(adminAfterA.status, 200, adminAfterAPayload.text);
      assert.equal(adminAfterAPayload.body.member.role, "admin");

      await stop(child);
      child = startServer(origin, dataRoot, logs, { code: codeB, kind: "hash" });
      await waitUntilReady(origin, child, logs);
      const temporaryB = "Owner-Temporary-B-2026!";
      const recoveredB = await recover(origin, adminCookie, codeB, temporaryB);
      assert.equal(recoveredB.response.status, 200, recoveredB.text);
      assert.equal(
        (await jsonRequest(origin, "/api/session", { cookie: ownerCookie })).status,
        401,
      );

      await stop(child);
      child = startServer(origin, dataRoot, logs, { code: codeA, kind: "raw" });
      await waitUntilReady(origin, child, logs);
      const replayPassword = "Must-Not-Win-Replay-A-2026!";
      const replayA = await recover(origin, adminCookie, codeA, replayPassword);
      assert.equal(replayA.response.status, 409, replayA.text);
      assert.equal((await login(origin, "recoveryowner", replayPassword)).response.status, 401);
      const ownerLoginB = await login(origin, "recoveryowner", temporaryB);
      assert.equal(ownerLoginB.response.status, 200, ownerLoginB.text);
      const privateB = "Owner-Private-B-After-Recovery-2026!";
      const changedOwnerB = await changePassword(
        origin,
        ownerLoginB.cookie,
        temporaryB,
        privateB,
      );
      assert.equal(changedOwnerB.response.status, 200, changedOwnerB.text);
      ownerCookie = changedOwnerB.cookie;

      await stop(child);
      child = startServer(origin, dataRoot, logs, { code: codeC, kind: "hash" });
      await waitUntilReady(origin, child, logs);
      const concurrentPasswords = [
        "Owner-Concurrent-Left-2026!",
        "Owner-Concurrent-Right-2026!",
      ];
      const concurrent = await Promise.all(
        concurrentPasswords.map((password) =>
          recover(origin, adminCookie, codeC, password),
        ),
      );
      assert.deepEqual(
        concurrent.map(({ response }) => response.status).sort((a, b) => a - b),
        [200, 409],
        JSON.stringify(concurrent.map(({ response, text }) => ({ status: response.status, text }))),
      );
      const winningIndex = concurrent.findIndex(({ response }) => response.status === 200);
      const losingIndex = winningIndex === 0 ? 1 : 0;
      assert.equal(
        (await login(origin, "recoveryowner", concurrentPasswords[losingIndex])).response.status,
        401,
      );
      const concurrentOwnerLogin = await login(
        origin,
        "recoveryowner",
        concurrentPasswords[winningIndex],
      );
      assert.equal(concurrentOwnerLogin.response.status, 200, concurrentOwnerLogin.text);
      const privateC = "Owner-Private-C-After-Recovery-2026!";
      const changedOwnerC = await changePassword(
        origin,
        concurrentOwnerLogin.cookie,
        concurrentPasswords[winningIndex],
        privateC,
      );
      assert.equal(changedOwnerC.response.status, 200, changedOwnerC.text);
      ownerCookie = changedOwnerC.cookie;

      await stop(child);
      child = startServer(origin, dataRoot, logs, { code: codeD, kind: "raw" });
      await waitUntilReady(origin, child, logs);
      database = new DatabaseSync(join(dataRoot, "team.sqlite"));
      database.exec("PRAGMA busy_timeout = 5000");
      const auditCountBefore = database
        .prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'auth.owner_password_recovered'")
        .get().count;
      database.exec(`
        CREATE TRIGGER fail_owner_recovery_audit
        BEFORE INSERT ON audit_logs
        WHEN NEW.action = 'auth.owner_password_recovered'
        BEGIN
          SELECT RAISE(FAIL, 'forced owner recovery audit failure');
        END
      `);
      const temporaryD = "Owner-Temporary-D-2026!";
      const failedAudit = await recover(origin, adminCookie, codeD, temporaryD);
      assert.equal(failedAudit.response.status, 500, failedAudit.text);
      assert.equal(
        (await jsonRequest(origin, "/api/session", { cookie: ownerCookie })).status,
        200,
      );
      assert.equal(
        database
          .prepare("SELECT count(*) AS count FROM owner_recovery_uses WHERE token_hash = ?")
          .get(sha256(codeD)).count,
        0,
      );
      assert.equal(
        database
          .prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'auth.owner_password_recovered'")
          .get().count,
        auditCountBefore,
      );
      database.exec("DROP TRIGGER fail_owner_recovery_audit");
      const recoveredD = await recover(origin, adminCookie, codeD, temporaryD);
      assert.equal(recoveredD.response.status, 200, recoveredD.text);
      assert.equal(
        (await jsonRequest(origin, "/api/session", { cookie: ownerCookie })).status,
        401,
      );
      const ownerLoginD = await login(origin, "recoveryowner", temporaryD);
      assert.equal(ownerLoginD.response.status, 200, ownerLoginD.text);
      assert.equal(ownerLoginD.body.mustChangePassword, true);

      const auditResponse = await jsonRequest(origin, "/api/admin/audit?limit=100", {
        cookie: adminCookie,
      });
      const auditPayload = await responseJson(auditResponse);
      assert.equal(auditResponse.status, 200, auditPayload.text);
      const recoveryAudits = auditPayload.body.audit.filter(
        ({ action }) => action === "auth.owner_password_recovered",
      );
      assert.equal(recoveryAudits.length, 4);
      assert.equal(recoveryAudits.every(({ actorMemberId }) => actorMemberId !== ownerId), true);
      for (const secret of [
        codeA,
        codeB,
        codeC,
        codeD,
        temporaryA,
        temporaryB,
        temporaryD,
        privateA,
        privateB,
        privateC,
      ]) {
        assert.equal(auditPayload.text.includes(secret), false);
      }
      assert.equal(
        database.prepare("SELECT role FROM members WHERE id = ?").get(
          adminAfterAPayload.body.member.id,
        ).role,
        "admin",
      );
      database.close();
      database = undefined;

      await stop(child);
      child = startServer(origin, dataRoot, logs, null);
      await waitUntilReady(origin, child, logs);
      const disabledRecovery = await recover(
        origin,
        adminCookie,
        codeD,
        "Disabled-Recovery-Must-Not-Run-2026!",
      );
      assert.equal(disabledRecovery.response.status, 503, disabledRecovery.text);
      assert.equal(disabledRecovery.body.error.code, "OWNER_RECOVERY_NOT_CONFIGURED");
    } finally {
      database?.close();
      await stop(child);
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);
