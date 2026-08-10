import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public login shell and protects the team portal", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /淘宝经营数据/);
  assert.match(html, /登录团队工作台/);
  assert.match(html, /无需 ChatGPT 账号/);
  assert.match(html, /login-username/);
  assert.doesNotMatch(html, /cloud-sync\.js/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/);

  const protectedResponse = await render();
  assert.equal(protectedResponse.status, 302);
  assert.equal(new URL(protectedResponse.headers.get("location")).pathname, "/login");
});

test("declares cloud persistence, local authentication, protected APIs, sync assets, and security headers", async () => {
  const [hosting, layout, homePage, nextConfig, cloudSync, bridge, authSource, workerSource, workerConfig] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/cloud-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../../web-tool-bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../app/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
  ]);

  const config = JSON.parse(hosting);
  assert.equal(config.d1, "DB");
  assert.equal(config.r2, "RUNS");
  assert.ok(typeof config.project_id === "string" && config.project_id.length > 10);
  assert.match(layout, /social-preview\.png/);
  assert.doesNotMatch(layout, /cloud-sync\.js/);
  assert.match(homePage, /cloud-sync\.js/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /frame-ancestors 'self'/);
  assert.match(cloudSync, /\/api\/vault/);
  assert.match(cloudSync, /\/api\/runs/);
  assert.doesNotMatch(cloudSync, /masterPassword\s*:/);
  assert.match(bridge, /importStoreRun/);
  assert.match(bridge, /MAX_IMPORTED_RUN_BYTES/);
  assert.match(authSource, /tb_team_session/);
  assert.match(authSource, /HttpOnly/);
  assert.match(workerSource, /must_change_password = 0/);
  assert.doesNotMatch(`${authSource}\n${workerSource}`, /signin-with-chatgpt|oai-authenticated-user/i);
  const builtWorkerConfig = JSON.parse(workerConfig);
  assert.equal(builtWorkerConfig.assets?.binding, "ASSETS");
  assert.equal(builtWorkerConfig.assets?.run_worker_first, true);

  await Promise.all([
    access(new URL("../app/api/session/route.ts", import.meta.url)),
    access(new URL("../app/api/auth/login/route.ts", import.meta.url)),
    access(new URL("../app/api/auth/setup/route.ts", import.meta.url)),
    access(new URL("../app/api/auth/change-password/route.ts", import.meta.url)),
    access(new URL("../app/api/auth/owner-recovery/route.ts", import.meta.url)),
    access(new URL("../app/api/admin/members/route.ts", import.meta.url)),
    access(new URL("../app/api/vault/route.ts", import.meta.url)),
    access(new URL("../app/api/directory/route.ts", import.meta.url)),
    access(new URL("../app/api/runs/route.ts", import.meta.url)),
    access(new URL("../app/server/generated-protected-assets.ts", import.meta.url)),
    access(new URL("../public/social-preview.png", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../public/workspace.html", import.meta.url)));
  await assert.rejects(access(new URL("../app/chatgpt-auth.ts", import.meta.url)));
});
