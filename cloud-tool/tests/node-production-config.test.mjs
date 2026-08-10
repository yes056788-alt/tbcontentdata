import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertNodeProductionConfig,
  validateNodeProductionConfig,
} from "../lib/node-production-config.mjs";

const validEnvironment = Object.freeze({
  APP_PUBLIC_ORIGIN: "https://tbdata.aizicheng.com",
  PASSWORD_PEPPER: "mV9$kP2!zQ7@rT4#xW8%jN3&cL6*sD1?fH5+",
  RUN_DATA_KEY: Buffer.from(
    Array.from({ length: 32 }, (_, index) => index + 1),
  ).toString("base64"),
  BOOTSTRAP_TOKEN: "b7F!q2L@w9R#c4T%x8M&k3P*z6V$s1D?",
});

function issueFor(result, name) {
  return result.issues.find((entry) => entry.name === name);
}

test("production Node configuration accepts a real HTTPS origin and strong keys", () => {
  assert.deepEqual(validateNodeProductionConfig(validEnvironment), {
    ready: true,
    issues: [],
  });
  assert.doesNotThrow(() => assertNodeProductionConfig(validEnvironment));
});

test("owner recovery stays disabled by default and startup remains valid after deletion", () => {
  const enabledNames = [
    "OWNER_RECOVERY_TOKEN",
    "OWNER_RECOVERY_TOKEN_HASH",
    "OWNER_RECOVERY_TOKEN_EXPIRES_AT",
  ];
  const removed = { ...validEnvironment };
  enabledNames.forEach((name) => delete removed[name]);
  assert.deepEqual(validateNodeProductionConfig(removed), {
    ready: true,
    issues: [],
  });
});

test("owner recovery accepts either a raw 32-byte base64url code or its hash with a short expiry", () => {
  const code = Buffer.from(
    Array.from({ length: 32 }, (_, index) => index + 31),
  ).toString("base64url");
  const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const hash = createHash("sha256").update(code).digest("hex");
  for (const recovery of [
    { OWNER_RECOVERY_TOKEN: code },
    { OWNER_RECOVERY_TOKEN_HASH: hash },
  ]) {
    assert.deepEqual(
      validateNodeProductionConfig({
        ...validEnvironment,
        ...recovery,
        OWNER_RECOVERY_TOKEN_EXPIRES_AT: expiry,
      }),
      { ready: true, issues: [] },
    );
  }
});

test("owner recovery fails closed for partial, conflicting, weak or long-lived configuration", () => {
  const code = Buffer.alloc(32, 17).toString("base64url");
  const hash = createHash("sha256").update(code).digest("hex");
  const validExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const cases = [
    { OWNER_RECOVERY_TOKEN_HASH: hash },
    { OWNER_RECOVERY_TOKEN_EXPIRES_AT: validExpiry },
    {
      OWNER_RECOVERY_TOKEN: code,
      OWNER_RECOVERY_TOKEN_HASH: hash,
      OWNER_RECOVERY_TOKEN_EXPIRES_AT: validExpiry,
    },
    {
      OWNER_RECOVERY_TOKEN: "not-a-32-byte-base64url-code",
      OWNER_RECOVERY_TOKEN_EXPIRES_AT: validExpiry,
    },
    {
      OWNER_RECOVERY_TOKEN_HASH: hash,
      OWNER_RECOVERY_TOKEN_EXPIRES_AT: new Date(
        Date.now() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    },
  ];
  for (const recovery of cases) {
    const result = validateNodeProductionConfig({
      ...validEnvironment,
      ...recovery,
    });
    assert.equal(result.ready, false, JSON.stringify(recovery));
    assert.ok(
      result.issues.some(({ name }) => name.startsWith("OWNER_RECOVERY_")),
      JSON.stringify(result),
    );
  }
});

test("production Node configuration rejects HTTP and reserved example origins", () => {
  for (const origin of [
    "http://tbdata.aizicheng.com",
    "https://tbdata.example.com",
    "https://localhost",
    "https://tbdata.aizicheng.com/path",
  ]) {
    const result = validateNodeProductionConfig({
      ...validEnvironment,
      APP_PUBLIC_ORIGIN: origin,
    });
    assert.equal(result.ready, false);
    assert.ok(issueFor(result, "APP_PUBLIC_ORIGIN"));
  }
});

test("production Node configuration rejects templates and weak secrets", () => {
  const result = validateNodeProductionConfig({
    APP_PUBLIC_ORIGIN: "https://tbdata.example.com",
    PASSWORD_PEPPER: "replace-with-existing-or-new-random-secret",
    RUN_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    BOOTSTRAP_TOKEN: "replace-with-one-time-bootstrap-secret",
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.issues.map(({ name }) => name)),
    new Set([
      "APP_PUBLIC_ORIGIN",
      "PASSWORD_PEPPER",
      "RUN_DATA_KEY",
      "BOOTSTRAP_TOKEN",
    ]),
  );
});

test("RUN_DATA_KEY must be canonical base64 for a non-trivial 32-byte key", () => {
  for (const key of [
    "not-base64",
    Buffer.alloc(31, 7).toString("base64"),
    Buffer.alloc(32, 7).toString("base64"),
    Buffer.from("12345678123456781234567812345678").toString("base64"),
  ]) {
    const result = validateNodeProductionConfig({
      ...validEnvironment,
      RUN_DATA_KEY: key,
    });
    assert.equal(result.ready, false);
    assert.ok(issueFor(result, "RUN_DATA_KEY"));
  }
});

test("production Node configuration rejects reuse of independent secrets", () => {
  const result = validateNodeProductionConfig({
    ...validEnvironment,
    BOOTSTRAP_TOKEN: validEnvironment.PASSWORD_PEPPER,
  });
  assert.equal(result.ready, false);
  assert.equal(issueFor(result, "BOOTSTRAP_TOKEN")?.code, "REUSED_SECRET");
});

test("the Node start wrapper fails before importing a server and never prints secrets", () => {
  const startScript = fileURLToPath(
    new URL("../scripts/start-node.mjs", import.meta.url),
  );
  const environment = {
    ...process.env,
    ...validEnvironment,
    APP_PUBLIC_ORIGIN: "http://tbdata.aizicheng.com",
    NODE_CONFIG_VALIDATED: "1",
  };
  const result = spawnSync(process.execPath, [startScript], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: environment,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to start the production Node server/);
  assert.match(result.stderr, /APP_PUBLIC_ORIGIN \[HTTPS_ORIGIN_REQUIRED\]/);
  assert.equal(result.stderr.includes(validEnvironment.PASSWORD_PEPPER), false);
  assert.equal(result.stderr.includes(validEnvironment.RUN_DATA_KEY), false);
  assert.equal(result.stderr.includes(validEnvironment.BOOTSTRAP_TOKEN), false);
});
