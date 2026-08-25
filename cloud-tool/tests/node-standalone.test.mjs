import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverPath = join(root, "dist", "standalone", "server.js");
const validatedServerPath = join(root, "scripts", "start-node.mjs");

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
      // The server may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`standalone server did not become ready\n${logs.join("")}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function startServer(origin, dataRoot, logs, options = {}) {
  const url = new URL(origin);
  const environment = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: url.port,
    APP_DATA_DIR: dataRoot,
    MIGRATIONS_PATH: join(root, "drizzle"),
    APP_PUBLIC_ORIGIN: options.publicOrigin ?? origin,
    PASSWORD_PEPPER: "node-test-pepper-0123456789-abcdefghijklmnopqrstuvwxyz",
    RUN_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    BOOTSTRAP_TOKEN: "node-test-bootstrap-0123456789abcdef",
    NODE_CONFIG_VALIDATED: "",
  };
  if (options.publicOrigin === null) delete environment.APP_PUBLIC_ORIGIN;
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (value) => logs.push(String(value)));
  child.stderr.on("data", (value) => logs.push(String(value)));
  return child;
}

async function runObjectFiles(dataRoot, runId) {
  const names = await readdir(join(dataRoot, "objects", "runs"));
  return names.filter(
    (name) => name === `${runId}.json` || name.startsWith(`${runId}--`),
  );
}

function startValidatedServer(port, dataRoot, logs) {
  const child = spawn(process.execPath, [validatedServerPath], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_DATA_DIR: dataRoot,
      MIGRATIONS_PATH: join(root, "drizzle"),
      APP_PUBLIC_ORIGIN: "https://tbdata.aizicheng.com",
      PASSWORD_PEPPER: "mV9$kP2!zQ7@rT4#xW8%jN3&cL6*sD1?fH5+",
      RUN_DATA_KEY: Buffer.from(
        Array.from({ length: 32 }, (_, index) => index + 1),
      ).toString("base64"),
      BOOTSTRAP_TOKEN: "b7F!q2L@w9R#c4T%x8M&k3P*z6V$s1D?",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (value) => logs.push(String(value)));
  child.stderr.on("data", (value) => logs.push(String(value)));
  return child;
}

const standaloneMissing = !existsSync(serverPath);

test(
  "validated Node startup reports persistence readiness",
  { skip: standaloneMissing && "run npm run build:node first" },
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "tbdata-node-health-"));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const logs = [];
    const child = startValidatedServer(port, dataRoot, logs);
    try {
      await waitUntilReady(origin, child, logs);
      const health = await fetch(`${origin}/api/health`);
      const healthText = await health.text();
      assert.equal(health.status, 200, healthText);
      assert.deepEqual(JSON.parse(healthText), {
        status: "ok",
        ready: true,
        platform: "node",
      });

      const anonymousLegacy = await fetch(
        `${origin}/workspace.html?store=store-node-proxy`,
        {
          redirect: "manual",
          headers: {
            "x-forwarded-host": "untrusted-proxy.invalid",
            "x-forwarded-proto": "http",
          },
        },
      );
      assert.equal(anonymousLegacy.status, 307);
      assert.equal(
        anonymousLegacy.headers.get("location"),
        "https://tbdata.aizicheng.com/login?next=%2Fworkspace.html%3Fstore%3Dstore-node-proxy",
      );
    } finally {
      await stop(child);
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);

test(
  "standalone legacy redirects honor forwarded HTTPS without a configured origin",
  { skip: standaloneMissing && "run npm run build:node first" },
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "tbdata-node-forwarded-"));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const logs = [];
    const child = startServer(origin, dataRoot, logs, { publicOrigin: null });
    try {
      await waitUntilReady(origin, child, logs);
      const anonymousLegacy = await fetch(
        `${origin}/report-view.html?run=run-node-proxy`,
        {
          redirect: "manual",
          headers: {
            "x-forwarded-host": "tbdata.forwarded.example",
            "x-forwarded-proto": "https,http",
          },
        },
      );
      assert.equal(anonymousLegacy.status, 307);
      assert.equal(
        anonymousLegacy.headers.get("location"),
        "https://tbdata.forwarded.example/login?next=%2Freport-view.html%3Frun%3Drun-node-proxy",
      );
    } finally {
      await stop(child);
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);

test(
  "standalone Node server protects pages and survives a restart",
  { skip: standaloneMissing && "run npm run build:node first" },
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "tbdata-node-server-"));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const logs = [];
    let child = startServer(origin, dataRoot, logs);
    try {
      await waitUntilReady(origin, child, logs);
      const unvalidatedHealth = await fetch(`${origin}/api/health`);
      assert.equal(unvalidatedHealth.status, 503);
      assert.deepEqual(await unvalidatedHealth.json(), {
        status: "not_ready",
        ready: false,
        platform: "node",
        reason: "production_configuration_not_validated",
      });
      const anonymous = await fetch(`${origin}/`, { redirect: "manual" });
      assert.equal(anonymous.status, 307);
      assert.equal(anonymous.headers.get("location"), "/login?next=%2F");

      const blockedSetup = await fetch(`${origin}/api/auth/setup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.invalid",
        },
        body: JSON.stringify({}),
      });
      assert.equal(blockedSetup.status, 403);

      const password = "Standalone-Node-Password-2026!";
      const setup = await fetch(`${origin}/api/auth/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          bootstrapToken: "node-test-bootstrap-0123456789abcdef",
          username: "nodeowner",
          displayName: "Node Owner",
          password,
        }),
      });
      assert.equal(setup.status, 201, await setup.text());
      const cookie = setup.headers.get("set-cookie")?.split(";", 1)[0];
      assert.ok(cookie?.startsWith("tb_team_session="));

      const authenticated = await fetch(`${origin}/`, {
        headers: { cookie },
        redirect: "manual",
      });
      assert.equal(authenticated.status, 200);

      const runId = "store-run-node-standalone";
      const now = new Date().toISOString();
      const saved = await fetch(`${origin}/api/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie,
        },
        body: JSON.stringify({
          run: {
            runId,
            marker: "base",
            startedAt: now,
            finishedAt: now,
            updatedAt: now,
            status: "success",
            account: { id: "node-test", name: "Node test" },
            failures: [],
          },
        }),
      });
      assert.equal(saved.status, 201, await saved.text());
      const initialObjects = await runObjectFiles(dataRoot, runId);
      assert.equal(initialObjects.length, 1);
      assert.match(
        initialObjects[0],
        /^store-run-node-standalone--[a-f0-9]{64}--[a-f0-9-]{36}\.json$/,
      );

      // A failed DB write must leave the existing row/body pair intact and
      // remove only this request's unique, unreferenced version object.
      const database = new DatabaseSync(join(dataRoot, "team.sqlite"));
      database.exec(`
        CREATE TRIGGER fail_test_run_update
        BEFORE UPDATE ON runs
        WHEN NEW.id = 'store-run-node-standalone'
        BEGIN
          SELECT RAISE(FAIL, 'forced run update failure');
        END
      `);
      try {
        const failed = await fetch(`${origin}/api/runs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            cookie,
          },
          body: JSON.stringify({
            run: {
              runId,
              marker: "must-not-commit",
              updatedAt: new Date(Date.parse(now) + 1_000).toISOString(),
              status: "success",
              failures: [],
            },
          }),
        });
        assert.equal(failed.status, 500, await failed.text());
      } finally {
        database.exec("DROP TRIGGER fail_test_run_update");
        database.close();
      }
      const afterFailure = await fetch(`${origin}/api/runs/${runId}`, {
        headers: { cookie },
      });
      const afterFailureBody = await afterFailure.json();
      assert.equal(afterFailure.status, 200);
      assert.equal(afterFailureBody.run.marker, "base");
      assert.deepEqual(await runObjectFiles(dataRoot, runId), initialObjects);

      const replacementMarker = "newer-version";
      const replacement = await fetch(`${origin}/api/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie,
        },
        body: JSON.stringify({
          run: {
            runId,
            marker: replacementMarker,
            updatedAt: new Date(Date.parse(now) + 1_500).toISOString(),
            status: "success",
            failures: [],
          },
        }),
      });
      assert.equal(replacement.status, 200, await replacement.text());
      const replacementObjects = await runObjectFiles(dataRoot, runId);
      assert.equal(replacementObjects.length, 1);
      assert.notDeepEqual(replacementObjects, initialObjects);
      const replaced = await fetch(`${origin}/api/runs/${runId}`, {
        headers: { cookie },
      });
      assert.equal(replaced.status, 200);
      assert.equal((await replaced.json()).run.marker, replacementMarker);

      // Two create-if-absent requests for the same runId may upload in
      // parallel, but exactly one DB row/body pair wins and the losing unique
      // object is cleaned without ever overwriting the winner.
      const concurrentRunId = "store-run-node-concurrent";
      const concurrentUpdatedAt = new Date(Date.parse(now) + 2_000).toISOString();
      const concurrentBodies = ["left", "right"].map((marker) =>
        JSON.stringify({
          expectedAbsent: true,
          run: {
            runId: concurrentRunId,
            marker,
            padding: marker.repeat(256 * 1024),
            updatedAt: concurrentUpdatedAt,
            status: "success",
            failures: [],
          },
        }),
      );
      const concurrentResponses = await Promise.all(
        concurrentBodies.map((body) =>
          fetch(`${origin}/api/runs`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin,
              cookie,
            },
            body,
          }),
        ),
      );
      const concurrentResults = await Promise.all(
        concurrentResponses.map(async (response) => ({
          status: response.status,
          text: await response.text(),
        })),
      );
      assert.deepEqual(
        concurrentResults.map(({ status }) => status).sort((a, b) => a - b),
        [201, 409],
        JSON.stringify(concurrentResults),
      );
      const concurrentRestored = await fetch(
        `${origin}/api/runs/${concurrentRunId}`,
        { headers: { cookie } },
      );
      const concurrentRestoredBody = await concurrentRestored.json();
      assert.equal(concurrentRestored.status, 200);
      assert.ok(["left", "right"].includes(concurrentRestoredBody.run.marker));
      assert.equal(
        concurrentRestoredBody.run.padding,
        concurrentRestoredBody.run.marker.repeat(256 * 1024),
      );
      assert.equal(
        (await runObjectFiles(dataRoot, concurrentRunId)).length,
        1,
      );

      await stop(child);
      child = startServer(origin, dataRoot, logs);
      await waitUntilReady(origin, child, logs);
      const login = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ username: "nodeowner", password }),
      });
      assert.equal(login.status, 200, await login.text());
      const restartedCookie = login.headers
        .get("set-cookie")
        ?.split(";", 1)[0];
      assert.ok(restartedCookie);
      const restored = await fetch(`${origin}/api/runs/${runId}`, {
        headers: { cookie: restartedCookie },
      });
      const restoredText = await restored.text();
      assert.equal(restored.status, 200, restoredText);
      const restoredBody = JSON.parse(restoredText);
      assert.equal(restoredBody.run.runId, runId);
      assert.equal(restoredBody.run.marker, replacementMarker);

      const deleted = await fetch(`${origin}/api/runs/${runId}`, {
        method: "DELETE",
        headers: { origin, cookie: restartedCookie },
      });
      assert.equal(deleted.status, 200, await deleted.text());
      assert.deepEqual(await runObjectFiles(dataRoot, runId), []);

      const missingAfterDelete = await fetch(`${origin}/api/runs/${runId}`, {
        headers: { cookie: restartedCookie },
      });
      assert.equal(missingAfterDelete.status, 404);

      const runList = await fetch(`${origin}/api/runs`, {
        headers: { cookie: restartedCookie },
      });
      assert.equal(runList.status, 200);
      const runListBody = await runList.json();
      assert.equal(runListBody.runs.some((item) => item.runId === runId), false);
      assert.ok(runListBody.deletedRunIds.includes(runId));

      const staleReupload = await fetch(`${origin}/api/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: restartedCookie,
        },
        body: JSON.stringify({
          expectedAbsent: true,
          run: {
            runId,
            marker: "stale-client-copy",
            updatedAt: new Date(Date.parse(now) + 3_000).toISOString(),
            status: "success",
            failures: [],
          },
        }),
      });
      assert.equal(staleReupload.status, 410, await staleReupload.text());
      assert.deepEqual(await runObjectFiles(dataRoot, runId), []);

      const deletedDatabase = new DatabaseSync(join(dataRoot, "team.sqlite"));
      try {
        assert.equal(
          deletedDatabase.prepare("SELECT count(*) AS count FROM runs WHERE id = ?").get(runId).count,
          0,
        );
        assert.equal(
          deletedDatabase.prepare("SELECT count(*) AS count FROM run_deletions WHERE run_id = ?").get(runId).count,
          1,
        );
        assert.equal(
          deletedDatabase.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'run.deleted' AND target_id = ?").get(runId).count,
          1,
        );
      } finally {
        deletedDatabase.close();
      }

      const serverBundle = await readFile(
        join(root, "dist", "standalone", "dist", "server", "index.js"),
        "utf8",
      );
      assert.doesNotMatch(serverBundle, /cloudflare:workers/);
    } finally {
      await stop(child);
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);
