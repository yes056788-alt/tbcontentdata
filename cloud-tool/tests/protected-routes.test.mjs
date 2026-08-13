import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const LEGACY_ROUTES = [
  "workspace.html",
  "accounts.html",
  "report.html",
  "data.html",
  "report-view.html",
];

test("every legacy HTML path is an explicit authenticated route", async () => {
  for (const filename of LEGACY_ROUTES) {
    const routeUrl = new URL(`../app/${filename}/route.ts`, import.meta.url);
    await access(routeUrl);
    const source = await readFile(routeUrl, "utf8");
    assert.match(source, /await requireSession\(request\)/, filename);
    assert.match(source, new RegExp(`legacyHtmlResponse\\("${filename.replace(".", "\\.")}"`));
    assert.match(source, /export const GET = respond/);
    assert.match(source, /export const HEAD = respond/);
  }
});

test("retired collection path authenticates and redirects to one-click collection", async () => {
  const source = await readFile(
    new URL("../app/collect.html/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /await requireSession\(request\)/);
  assert.match(source, /status:\s*307/);
  assert.match(source, /Location:\s*`\/report\.html\$\{new URL\(request\.url\)\.search\}`/);
  assert.doesNotMatch(source, /legacyHtmlResponse\("collect\.html"/);
  assert.match(source, /export const GET = respond/);
  assert.match(source, /export const HEAD = respond/);
});

test("legacy responses are no-store and carry browser security headers", async () => {
  const source = await readFile(
    new URL("../app/server/protected-assets.ts", import.meta.url),
    "utf8",
  );
  for (const header of [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]) {
    assert.match(source, new RegExp(header));
  }
  assert.match(source, /NO_STORE_HEADERS/);
  assert.match(source, /\/login\?next=/);
  assert.match(source, /PASSWORD_CHANGE_REQUIRED/);
});

test("report and data viewers allow their required inline styles only", async () => {
  const { legacyContentSecurityPolicy } = await import(
    "../app/server/legacy-csp.ts"
  );
  for (const filename of ["report-view.html", "data.html"]) {
    const policy = legacyContentSecurityPolicy(filename);
    assert.match(policy, /style-src 'self' 'unsafe-inline'/, filename);
    assert.match(policy, /script-src 'self'(?:;|$)/, filename);
  }
  for (const filename of [
    "workspace.html",
    "accounts.html",
    "report.html",
  ]) {
    const policy = legacyContentSecurityPolicy(filename);
    assert.match(policy, /style-src 'self'(?:;|$)/, filename);
    assert.doesNotMatch(policy, /style-src[^;]*'unsafe-inline'/, filename);
  }
  const source = await readFile(
    new URL("../app/server/protected-assets.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /legacyContentSecurityPolicy\(filename\)/);
});

test("download route authenticates before applying the generated whitelist", async () => {
  const routeSource = await readFile(
    new URL("../app/downloads/[filename]/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    routeSource.indexOf("await requireSession(request)") <
      routeSource.lastIndexOf("extensionDownloadResponse("),
  );
  const generated = await import(
    "../app/server/generated-protected-assets.ts"
  );
  assert.deepEqual(
    Object.keys(generated.LEGACY_PAGE_HTML).sort(),
    [...LEGACY_ROUTES].sort(),
  );
  for (const html of Object.values(generated.LEGACY_PAGE_HTML)) {
    assert.match(html, /^<!doctype html>/i);
  }
  assert.equal(new Set(generated.EXTENSION_PACKAGE_FILENAMES).size, 2);
  assert.ok(
    generated.EXTENSION_PACKAGE_FILENAMES.some((name) =>
      name.includes(generated.EXTENSION_PACKAGE_VERSION)
    ),
  );
  const zip = Buffer.from(generated.EXTENSION_PACKAGE_BASE64, "base64");
  assert.ok(zip.byteLength > 1_000);
  assert.equal(zip.subarray(0, 2).toString("ascii"), "PK");
});
