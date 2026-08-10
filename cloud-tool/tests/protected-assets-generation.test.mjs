import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const siteRoot = new URL("../", import.meta.url);
const generatedModuleUrl = new URL("../app/server/generated-protected-assets.ts", import.meta.url);
const syncScriptPath = fileURLToPath(new URL("../scripts/sync-web-tool.mjs", import.meta.url));
const protectedFilenames = [
  "workspace.html",
  "accounts.html",
  "collect.html",
  "report.html",
  "data.html",
  "report-view.html",
];

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), root);
    if (entry.isDirectory()) files.push(...await listFiles(url));
    else files.push(url);
  }
  return files;
}

test("keeps protected HTML and extension packages out of static client roots", async () => {
  for (const clientRoot of ["public/", "dist/client/"]) {
    for (const filename of protectedFilenames) {
      await assert.rejects(access(new URL(`${clientRoot}${filename}`, siteRoot)), filename);
    }
    await assert.rejects(access(new URL(`${clientRoot}downloads`, siteRoot)));
  }

  for (const filename of [
    "app.css",
    "cloud-team-navigation.css",
    "cloud-team-navigation.js",
    "portal.css",
    "project.js",
    "cloud-sync.js",
  ]) {
    await access(new URL(`public/${filename}`, siteRoot));
  }

  const clientFiles = await listFiles(new URL("dist/client/", siteRoot));
  for (const file of clientFiles) {
    const basename = file.pathname.slice(file.pathname.lastIndexOf("/") + 1);
    assert.equal(protectedFilenames.includes(basename), false, file.pathname);
    assert.doesNotMatch(basename, /^taobao-data-assistant(?:-\d+\.\d+\.\d+)?\.zip$/);
    const contents = await readFile(file);
    assert.equal(contents.includes("EXTENSION_PACKAGE_BASE64"), false, file.pathname);
    assert.equal(contents.includes("<title>项目管理 - 淘宝经营数据</title>"), false, file.pathname);
  }
});

test("generates the exact protected page and download allowlists around one ZIP", async () => {
  const importUrl = new URL(generatedModuleUrl);
  importUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const generated = await import(importUrl.href);

  assert.deepEqual(Object.keys(generated.LEGACY_PAGE_HTML), protectedFilenames);
  for (const filename of protectedFilenames) {
    const html = generated.LEGACY_PAGE_HTML[filename];
    assert.equal(typeof html, "string");
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<script src="\/cloud-team-navigation\.js"><\/script>/);
    assert.match(html, /<script src="\/cloud-sync\.js"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="\/cloud-team-navigation\.css">/);
    assert.match(html, /class="(?:portal-topbar|management-topbar) cloud-team-topbar"/);
    assert.match(html, /class="cloud-team-brand" href="\/"/);
    assert.match(html, /class="cloud-team-nav" aria-label="团队工作台主导航"/);
    for (const [href, label] of [
      ["/", "首页"],
      ["/workspace.html", "项目管理"],
      ["/collect.html", "经营取数"],
      ["/report.html", "诊断报告"],
      ["/accounts.html", "账号库管理"],
      ["/admin", "团队管理"],
    ]) {
      assert.match(html, new RegExp(`href="${href.replaceAll(".", "\\.")}"[^>]*>${label}<\\/a>`));
    }
    assert.match(html, /id="cloudTeamAccountName"/);
    assert.match(html, /id="cloudTeamLogout"/);
    assert.equal((html.match(/class="cloud-team-nav-link/g) ?? []).length, 6);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.equal((html.match(/cloud-team-navigation\.js/g) ?? []).length, 1);
    assert.equal((html.match(/cloud-sync\.js/g) ?? []).length, 1);
    assert.equal((html.match(/id="connectionState"/g) ?? []).length, 1);
    assert.equal((html.match(/id="extensionVersion"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /class="(?:portal-nav|management-global-nav)"/);
  }
  assert.doesNotMatch(generated.LEGACY_PAGE_HTML["workspace.html"], /\/index\.html/);
  assert.match(
    generated.LEGACY_PAGE_HTML["workspace.html"],
    /class="cloud-team-nav-link is-active" href="\/workspace\.html" aria-current="page">项目管理/,
  );
  assert.match(
    generated.LEGACY_PAGE_HTML["collect.html"],
    /class="cloud-team-nav-link is-active" href="\/collect\.html" aria-current="page">经营取数/,
  );
  assert.match(
    generated.LEGACY_PAGE_HTML["report.html"],
    /class="cloud-team-nav-link is-active" href="\/report\.html" aria-current="page">诊断报告/,
  );
  assert.match(
    generated.LEGACY_PAGE_HTML["accounts.html"],
    /class="cloud-team-nav-link is-active" href="\/accounts\.html" aria-current="page">账号库管理/,
  );
  for (const filename of ["data.html", "report-view.html"]) {
    assert.match(
      generated.LEGACY_PAGE_HTML[filename],
      /class="cloud-team-nav-link is-active" href="\/workspace\.html" aria-current="page">项目管理/,
    );
  }
  assert.equal(
    (generated.LEGACY_PAGE_HTML["accounts.html"].match(/id="lockVaultBtn"/g) ?? []).length,
    1,
  );
  for (const filename of protectedFilenames.filter((name) => name !== "accounts.html")) {
    assert.equal((generated.LEGACY_PAGE_HTML[filename].match(/id="lockVaultBtn"/g) ?? []).length, 0);
  }

  assert.equal(generated.EXTENSION_PACKAGE_VERSION, "2.37.3");
  assert.deepEqual(Array.from(generated.EXTENSION_PACKAGE_FILENAMES), [
    "taobao-data-assistant.zip",
    "taobao-data-assistant-2.37.3.zip",
  ]);
  const archive = Buffer.from(generated.EXTENSION_PACKAGE_BASE64, "base64");
  assert.ok(archive.length > 100_000);
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");

  const source = await readFile(generatedModuleUrl, "utf8");
  assert.equal((source.match(/export const EXTENSION_PACKAGE_BASE64/g) ?? []).length, 1);
});

test("unified legacy navigation preserves embedded and account-sidebar layouts", async () => {
  const navigationStyles = await readFile(
    new URL("../public/cloud-team-navigation.css", import.meta.url),
    "utf8",
  );
  assert.match(
    navigationStyles,
    /html\.embedded-view \.cloud-team-topbar\s*\{[\s\S]*?display:\s*none\s*!important/,
  );
  assert.match(
    navigationStyles,
    /\.management-sidebar\s*\{[\s\S]*?top:\s*var\(--cloud-team-topbar-height\)\s*!important/,
  );
});

test("protected asset generation is byte-for-byte deterministic", async () => {
  await execFileAsync(process.execPath, [syncScriptPath], {
    cwd: fileURLToPath(siteRoot),
  });
  const first = await readFile(generatedModuleUrl);
  await execFileAsync(process.execPath, [syncScriptPath], {
    cwd: fileURLToPath(siteRoot),
  });
  const second = await readFile(generatedModuleUrl);

  assert.equal(
    createHash("sha256").update(first).digest("hex"),
    createHash("sha256").update(second).digest("hex"),
  );
  assert.deepEqual(first, second);
});
