import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("auth-gate-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const TOKEN = "A".repeat(43);

function assets() {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const contentType = pathname.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : pathname.endsWith(".png")
          ? "image/png"
          : "text/html; charset=utf-8";
      return new Response(`asset:${pathname}`, {
        status: 200,
        headers: { "content-type": contentType },
      });
    },
  };
}

function d1Session(result, capture = {}) {
  return {
    prepare(sql) {
      capture.sql = sql;
      return {
        bind(...values) {
          capture.values = values;
          return this;
        },
        async first() {
          if (result instanceof Error) throw result;
          return result;
        },
      };
    },
  };
}

function env(db) {
  return {
    ASSETS: assets(),
    DB: db,
    RUNS: {},
    IMAGES: {
      input() {
        throw new Error("image optimizer not used in these tests");
      },
    },
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

async function fetchPath(pathname, options = {}, database = d1Session(null)) {
  return worker.fetch(
    new Request(`https://team.example${pathname}`, options),
    env(database),
    ctx,
  );
}

test("redirects protected pages, business assets, admin, and downloads", async () => {
  for (const pathname of [
    "/",
    "/workspace.html?store=store-1",
    "/accounts.html",
    "/admin",
    "/owner-recovery",
    "/downloads/taobao-data-assistant.zip",
    "/portal.css",
  ]) {
    const response = await fetchPath(pathname);
    assert.equal(response.status, 302, pathname);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/login", pathname);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    if (pathname !== "/") {
      assert.equal(location.searchParams.get("next"), pathname, pathname);
    }
  }
});

test("keeps login flows and their static assets public", async () => {
  for (const pathname of [
    "/login",
    "/setup/",
    "/change-password",
    "/_next/static/chunks/login.js",
    "/assets/login.css",
    "/favicon.svg",
    "/social-preview.png",
  ]) {
    const response = await fetchPath(pathname);
    assert.notEqual(response.status, 302, pathname);
    const redirect = response.headers.get("location");
    if (redirect) assert.notEqual(new URL(redirect, "https://team.example").pathname, "/login", pathname);
  }
});

test("validates the opaque cookie against an active owner or admin", async () => {
  const capture = {};
  const response = await fetchPath(
    "/portal.css",
    { headers: { cookie: `tb_team_session=${TOKEN}` } },
    d1Session({ id: "session-1" }, capture),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("vary") ?? "", /cookie/i);
  assert.match(capture.sql, /from auth_sessions s/i);
  assert.match(capture.sql, /inner join local_accounts a/i);
  assert.match(capture.sql, /inner join members m/i);
  assert.match(capture.sql, /s\.revoked_at is null/i);
  assert.match(capture.sql, /s\.expires_at > \?2/i);
  assert.match(capture.sql, /a\.must_change_password = 0/i);
  assert.match(capture.sql, /m\.status = 'active'/i);
  assert.match(capture.sql, /m\.role in \('owner', 'admin'\)/i);
  assert.equal(
    capture.values[0],
    createHash("sha256").update(TOKEN).digest("hex"),
  );
  assert.ok(Number.isFinite(capture.values[1]));
});

test("fails closed for invalid, duplicate, expired, or unavailable sessions", async () => {
  const invalid = await fetchPath("/workspace.html", {
    headers: { cookie: "tb_team_session=short" },
  });
  assert.equal(invalid.status, 302);

  const duplicate = await fetchPath("/workspace.html", {
    headers: { cookie: `tb_team_session=${TOKEN}; tb_team_session=${TOKEN}` },
  });
  assert.equal(duplicate.status, 302);

  const expired = await fetchPath(
    "/workspace.html",
    { headers: { cookie: `tb_team_session=${TOKEN}` } },
    d1Session(null),
  );
  assert.equal(expired.status, 302);

  const unavailable = await fetchPath(
    "/workspace.html",
    { headers: { cookie: `tb_team_session=${TOKEN}` } },
    d1Session(new Error("no such table: auth_sessions")),
  );
  assert.equal(unavailable.status, 302);
});

test("leaves API authorization to route handlers", async () => {
  const response = await fetchPath("/api/not-a-route");
  assert.notEqual(response.status, 302);
  assert.equal(response.headers.get("location"), null);
});
