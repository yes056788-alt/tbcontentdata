import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_QWEN_MODEL,
  QWEN_CREDENTIAL_VERSION_HEADER,
  assertQwenCredentialVersionMatches,
  clearQwenApiKeyCookie,
  createQwenApiKeyCookie,
  createQwenCredentialVersion,
  qwenApiKeyFromRequest,
  withQwenCredentialVersionHeader,
} from "../app/server/qwen-api-key-cookie.ts";

const API_KEY = "sk-test-cloud-qwen-key-that-must-never-leak";
const SUBJECT = "member-fixture-1";
const ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

function cookiePair(setCookie) {
  return String(setCookie).split(";")[0];
}

test("cloud Qwen API cookie is encrypted with a random IV and hardened attributes", async () => {
  const setCookie = await createQwenApiKeyCookie(API_KEY, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_000,
  });
  const secondCookie = await createQwenApiKeyCookie(API_KEY, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_000,
  });
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.doesNotMatch(setCookie, /Domain=/i);
  assert.doesNotMatch(setCookie, new RegExp(API_KEY));
  assert.notEqual(cookiePair(setCookie), cookiePair(secondCookie));

  const clearCookie = clearQwenApiKeyCookie();
  assert.match(clearCookie, /Max-Age=0/);
  assert.match(clearCookie, /Path=\/api/);
  assert.match(clearCookie, /HttpOnly/);
  assert.match(clearCookie, /Secure/);
  assert.match(clearCookie, /SameSite=Strict/);
});

test("cloud Qwen API cookie parser distinguishes absent, valid and invalid states", async () => {
  const setCookie = await createQwenApiKeyCookie(API_KEY, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_000,
  });
  const request = new Request("https://tbdata.example.com/api/search-keyword-classifications", {
    headers: { Cookie: cookiePair(setCookie) },
  });
  assert.deepEqual(await qwenApiKeyFromRequest(new Request(request.url), SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), { state: "absent" });
  assert.deepEqual(await qwenApiKeyFromRequest(request, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), {
    state: "valid",
    apiKey: API_KEY,
    expiresAt: 1_802_592_000,
  });
  assert.deepEqual(await qwenApiKeyFromRequest(request, "member-fixture-2", {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), { state: "invalid" });
  const tamperedRequest = new Request(request.url, {
    headers: { Cookie: cookiePair(setCookie) + "tampered" },
  });
  assert.deepEqual(await qwenApiKeyFromRequest(tamperedRequest, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), { state: "invalid" });
  assert.deepEqual(await qwenApiKeyFromRequest(tamperedRequest, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), { state: "invalid" });
  assert.deepEqual(await qwenApiKeyFromRequest(new Request(request.url, {
    headers: { Cookie: `${cookiePair(setCookie)}; ${cookiePair(setCookie)}` },
  }), SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_001,
  }), { state: "invalid" });
  assert.deepEqual(await qwenApiKeyFromRequest(request, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_802_592_000,
  }), { state: "invalid" });
  assert.equal(DEFAULT_QWEN_MODEL, "qwen3.7-plus-2026-05-26");
});

test("cloud Qwen API cookie rejects unsafe key values and separated-key decryption", async () => {
  for (const apiKey of [
    "short",
    " leading-space-key",
    "internal space key",
    "x".repeat(513),
  ]) {
    await assert.rejects(
      createQwenApiKeyCookie(apiKey, SUBJECT, { encryptionKey: ENCRYPTION_KEY }),
      (error) => error?.code === "INVALID_QWEN_API_KEY" && error?.status === 400,
    );
  }

  const maximumCookie = await createQwenApiKeyCookie("x".repeat(512), SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
  });
  assert.ok(maximumCookie.length < 4_096);

  const setCookie = await createQwenApiKeyCookie(API_KEY, SUBJECT, {
    encryptionKey: ENCRYPTION_KEY,
    nowSeconds: 1_800_000_000,
  });
  const wrongRootKey = Buffer.alloc(32, 12).toString("base64");
  assert.deepEqual(await qwenApiKeyFromRequest(new Request(
    "https://tbdata.example.com/api/search-keyword-classifications",
    { headers: { Cookie: cookiePair(setCookie) } },
  ), SUBJECT, {
    encryptionKey: wrongRootKey,
    nowSeconds: 1_800_000_001,
  }), { state: "invalid" });
});

test("Qwen credential versions are stable, opaque and domain-separated from cookie encryption", async () => {
  const options = { encryptionKey: ENCRYPTION_KEY };
  const cookieVersion = await createQwenCredentialVersion(
    "tool-cookie",
    API_KEY,
    options,
  );
  const repeatedVersion = await createQwenCredentialVersion(
    "tool-cookie",
    API_KEY,
    options,
  );
  const environmentVersion = await createQwenCredentialVersion(
    "server-environment",
    API_KEY,
    options,
  );
  const changedKeyVersion = await createQwenCredentialVersion(
    "tool-cookie",
    `${API_KEY}-rotated`,
    options,
  );
  const changedRootVersion = await createQwenCredentialVersion(
    "tool-cookie",
    API_KEY,
    { encryptionKey: Buffer.alloc(32, 12).toString("base64") },
  );

  assert.equal(cookieVersion, repeatedVersion);
  assert.match(cookieVersion, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(cookieVersion.includes(API_KEY), false);
  assert.notEqual(cookieVersion, environmentVersion);
  assert.notEqual(cookieVersion, changedKeyVersion);
  assert.notEqual(cookieVersion, changedRootVersion);
});

test("credential version pin accepts the first batch and rejects malformed or changed pins", async () => {
  const version = await createQwenCredentialVersion(
    "tool-cookie",
    API_KEY,
    { encryptionKey: ENCRYPTION_KEY },
  );

  assert.doesNotThrow(() => assertQwenCredentialVersionMatches(null, version));
  assert.doesNotThrow(() => assertQwenCredentialVersionMatches(version, version));
  for (const presented of ["", "not/base64url", "short", "A".repeat(22)]) {
    assert.throws(
      () => assertQwenCredentialVersionMatches(presented, version),
      (error) =>
        error?.status === 409 && error?.code === "MODEL_CREDENTIAL_CHANGED",
      presented,
    );
  }
});

test("credential version response header is attached to both success and upstream errors", async () => {
  const version = await createQwenCredentialVersion(
    "server-environment",
    API_KEY,
    { encryptionKey: ENCRYPTION_KEY },
  );
  for (const response of [
    Response.json({ ok: true }),
    Response.json(
      { error: { code: "QWEN_UNAVAILABLE", message: "upstream unavailable" } },
      { status: 502 },
    ),
  ]) {
    const pinned = withQwenCredentialVersionHeader(response, version);
    assert.equal(pinned.status, response.status);
    assert.equal(pinned.headers.get(QWEN_CREDENTIAL_VERSION_HEADER), version);
    assert.deepEqual(await pinned.json(), await response.clone().json());
  }
});

test("Qwen settings routes enforce auth, same-origin writes and never echo the API Key", async () => {
  const cookieModule = await readFile(
    new URL("../app/server/qwen-api-key-cookie.ts", import.meta.url),
    "utf8",
  );
  const settingsRoute = await readFile(
    new URL("../app/api/qwen-settings/route.ts", import.meta.url),
    "utf8",
  );
  const classifyRoute = await readFile(
    new URL("../app/api/search-keyword-classifications/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(settingsRoute, /requireSession\(request,\s*runWriters\)/);
  assert.match(settingsRoute, /readJsonBody<unknown>\(request,\s*8_192\)/);
  assert.match(settingsRoute, /createQwenApiKeyCookie/);
  assert.match(settingsRoute, /clearQwenApiKeyCookie/);
  assert.match(settingsRoute, /Object\.keys\(body\)/);
  assert.doesNotMatch(settingsRoute, /jsonResponse\(\s*\{[^}]*apiKey/s);
  assert.match(settingsRoute, /managedByTool/);
  assert.match(settingsRoute, /needsReentry:\s*true/);
  assert.doesNotMatch(settingsRoute, /cookieState\.state\s*===\s*"invalid"[\s\S]{0,240}Set-Cookie/);
  assert.match(cookieModule, /name:\s*"HKDF"/);
  assert.match(cookieModule, /HKDF_INFO/);
  assert.match(cookieModule, /HKDF_CREDENTIAL_VERSION_INFO/);
  assert.match(cookieModule, /name:\s*"HMAC"/);
  assert.match(cookieModule, /additionalData\(subject,\s*expiresAt\)/);
  assert.match(classifyRoute, /qwenApiKeyFromRequest/);
  assert.match(classifyRoute, /cookieState\.state\s*===\s*"absent"/);
  assert.match(classifyRoute, /cookieState\.state\s*===\s*"invalid"/);
  assert.doesNotMatch(classifyRoute, /clearQwenApiKeyCookie|Set-Cookie/);
  assert.match(classifyRoute, /DEFAULT_QWEN_MODEL/);
  assert.doesNotMatch(classifyRoute, /runtimeValue\("QWEN_MODEL"\)/);
  assert.doesNotMatch(classifyRoute, /\?\?/);
  assert.match(classifyRoute, /createQwenCredentialVersion/);
  assert.match(classifyRoute, /assertQwenCredentialVersionMatches/);
  assert.match(classifyRoute, /withQwenCredentialVersionHeader/);
  assert.match(classifyRoute, /QWEN_CREDENTIAL_VERSION_HEADER/);
  assert.ok(
    classifyRoute.indexOf("assertQwenCredentialVersionMatches") <
      classifyRoute.lastIndexOf("classifySearchKeywordsWithQwen"),
  );
  assert.ok(
    classifyRoute.indexOf('cookieState.state === "invalid"') <
      classifyRoute.indexOf('runtimeValue("DASHSCOPE_API_KEY")'),
  );
});
