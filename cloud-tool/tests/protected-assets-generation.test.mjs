import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import test from "node:test";

const execFileAsync = promisify(execFile);
const siteRoot = new URL("../", import.meta.url);
const generatedModuleUrl = new URL("../app/server/generated-protected-assets.ts", import.meta.url);
const syncScriptPath = fileURLToPath(new URL("../scripts/sync-web-tool.mjs", import.meta.url));
const protectedFilenames = [
  "workspace.html",
  "accounts.html",
  "report.html",
  "comments.html",
  "data.html",
  "report-view.html",
];
const protectedPageAssets = {
  "workspace.html": ["portal.css", "batch-report-export.js", "project.js"],
  "accounts.html": ["app.css", "accounts.css", "account-vault.js", "accounts.js"],
  "report.html": ["portal.css", "task.js"],
  "comments.html": ["comments.css", "comments.js"],
  "data.html": [
    "app.css", "portal.css", "xlsx.full.min.js", "diagnosis-spec.js",
    "xhs-contract.js", "xhs-metrics.js", "diagnosis-popup.js",
  ],
  "report-view.html": [
    "app.css", "report.css", "portal.css", "xhs-report-model.js", "report.js",
  ],
};
const extensionFilenames = [
  "adstar-page-hook.js",
  "pgy-page-hook.js",
  "juguang-page-hook.js",
  "lingxi-page-hook.js",
  "lingxi-content-script.js",
  "xhs-platform-content.js",
  "xhs/contract.js",
  "xhs/quality.js",
  "xhs/identity.js",
  "xhs/account-login.js",
  "xhs/collector-core.js",
  "xhs/local-cache.js",
  "xhs/page-client.js",
  "xhs/adstar-collector.js",
  "xhs/pgy-export-links.js",
  "xhs/pgy-collector.js",
  "xhs/pgy-comment-inventory.js",
  "xhs/comment-monitor.js",
  "xhs/comment-summary-archive.js",
  "xhs/comment-monitor-runtime.js",
  "xhs/comment-capture-coordinator.js",
  "xhs/juguang-accounts.js",
  "xhs/juguang-collector.js",
  "xhs/runtime.js",
  "xhs/analysis.js",
  "xhs/metrics.js",
  "xhs-comment-page-hook.js",
  "xhs-comment-content.js",
  "xiaohongshu-login-content.js",
  "xinghe-content-script.js",
  "diagnosis-popup.js",
  "rules.js",
  "background.js",
  "dmp-content-script.js",
  "wxt-report-content.js",
  "dmp-crowd-presets.json",
  "wxt-report-trace.js",
  "diagnosis-popup.html",
  "sycm-content-script.js",
  "wxt-report-response-hook.js",
  "web-tool-bridge.js",
  "wxt-report-page-hook.js",
  "manifest.json",
  "dmp-page-hook.js",
  "page-hook.js",
  "content-script.js",
  "diagnosis-spec.js",
  "README_V2.md",
  "vendor/xlsx.full.min.js",
];

function zipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    assert.equal(method, 8, name);
    entries.set(name, inflateRawSync(compressed));
    offset = dataStart + compressedSize;
  }
  return entries;
}

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
    for (const filename of [...protectedFilenames, "collect.html"]) {
      await assert.rejects(access(new URL(`${clientRoot}${filename}`, siteRoot)), filename);
    }
    await assert.rejects(access(new URL(`${clientRoot}downloads`, siteRoot)));
  }

  for (const filename of [
    "app.css",
    "batch-report-export.js",
    "cloud-team-navigation.css",
    "cloud-team-navigation.js",
    "portal.css",
    "project.js",
    "cloud-sync.js",
    "xhs-contract.js",
    "xhs-metrics.js",
    "xhs-report-model.js",
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
  const versionedAssetNames = Array.from(new Set([
    "cloud-sync.js",
    ...Object.values(protectedPageAssets).flat(),
  ]));
  const [navigationStyles, navigationScript, versionedAssets] = await Promise.all([
    readFile(new URL("../public/cloud-team-navigation.css", import.meta.url)),
    readFile(new URL("../public/cloud-team-navigation.js", import.meta.url)),
    Promise.all(versionedAssetNames.map(async (name) => [
      name,
      createHash("sha256")
        .update(await readFile(new URL(`../public/${name}`, import.meta.url)))
        .digest("hex")
        .slice(0, 12),
    ])),
  ]);
  const versionByAsset = Object.fromEntries(versionedAssets);
  const navigationStylesVersion = createHash("sha256")
    .update(navigationStyles)
    .digest("hex")
    .slice(0, 12);
  const navigationScriptVersion = createHash("sha256")
    .update(navigationScript)
    .digest("hex")
    .slice(0, 12);

  assert.deepEqual(Object.keys(generated.LEGACY_PAGE_HTML), protectedFilenames);
  for (const filename of protectedFilenames) {
    const html = generated.LEGACY_PAGE_HTML[filename];
    assert.equal(typeof html, "string");
    assert.match(html, /^<!DOCTYPE html>/);
    assert.ok(html.includes(
      `<script src="/cloud-team-navigation.js?v=${navigationScriptVersion}"></script>`,
    ));
    assert.ok(html.includes(
      `<script src="/cloud-sync.js?v=${versionByAsset["cloud-sync.js"]}"></script>`,
    ));
    assert.ok(html.includes(
      `<link rel="stylesheet" href="/cloud-team-navigation.css?v=${navigationStylesVersion}">`,
    ));
    assert.match(html, /class="(?:portal-topbar|management-topbar|comment-topbar) cloud-team-topbar"/);
    assert.match(html, /class="cloud-team-brand" href="\/"/);
    assert.match(html, /class="cloud-team-nav" aria-label="团队工作台主导航"/);
    for (const [href, label] of [
      ["/", "首页"],
      ["/workspace.html", "项目管理"],
      ["/report.html", "一键取数"],
      ["/comments.html", "评论监测"],
      ["/accounts.html", "账号库管理"],
      ["/admin", "团队管理"],
    ]) {
      assert.match(html, new RegExp(`href="${href.replaceAll(".", "\\.")}"[^>]*>${label}<\\/a>`));
    }
    assert.match(html, /id="cloudTeamAccountName"/);
    assert.match(html, /id="cloudTeamLogout"/);
    const accountActions = html.match(
      /<span class="cloud-team-account-actions">([\s\S]*?)<\/span>\s*<span id="connectionState"/,
    )?.[1];
    assert.ok(accountActions, `${filename} account actions`);
    assert.equal(
      (accountActions.match(/class="cloud-team-account-icon"/g) ?? []).length,
      filename === "accounts.html" ? 3 : 2,
    );
    assert.match(
      accountActions,
      /href="\/change-password"><svg[\s\S]*?<span class="cloud-team-account-button-label">修改密码<\/span><\/a>/,
    );
    assert.match(
      accountActions,
      /id="cloudTeamLogout"[\s\S]*?<svg[\s\S]*?id="cloudTeamLogoutLabel" class="cloud-team-account-button-label">退出登录<\/span><\/button>/,
    );
    assert.equal((html.match(/class="cloud-team-nav-link/g) ?? []).length, 6);
    assert.doesNotMatch(html, /href="\/collect\.html"|>经营取数<\/a>/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.equal((html.match(/cloud-team-navigation\.js/g) ?? []).length, 1);
    assert.equal((html.match(/cloud-sync\.js/g) ?? []).length, 1);
    assert.equal((html.match(/id="connectionState"/g) ?? []).length, 1);
    assert.equal((html.match(/id="extensionVersion"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /class="(?:portal-nav|management-global-nav)"/);
    for (const asset of protectedPageAssets[filename]) {
      assert.ok(
        html.includes(`"/${asset}?v=${versionByAsset[asset]}"`),
        `${filename} must reference the current ${asset} content hash`,
      );
      assert.equal(
        html.includes(`"/${asset}"`),
        false,
        `${filename} must not reference an unversioned ${asset}`,
      );
    }
  }
  assert.doesNotMatch(generated.LEGACY_PAGE_HTML["workspace.html"], /\/index\.html/);
  assert.match(
    generated.LEGACY_PAGE_HTML["workspace.html"],
    /class="cloud-team-nav-link is-active" href="\/workspace\.html" aria-current="page">项目管理/,
  );
  assert.match(
    generated.LEGACY_PAGE_HTML["report.html"],
    /class="cloud-team-nav-link is-active" href="\/report\.html" aria-current="page">一键取数/,
  );
  assert.match(generated.LEGACY_PAGE_HTML["report.html"], /id="batchGroupSelect"/);
  assert.match(generated.LEGACY_PAGE_HTML["report.html"], /id="batchAccountList"/);
  assert.match(generated.LEGACY_PAGE_HTML["report.html"], /id="batchAccountSummary"/);
  assert.match(generated.LEGACY_PAGE_HTML["report.html"], /id="batchSelectAllBtn"[^>]*>全选本组/);
  assert.doesNotMatch(generated.LEGACY_PAGE_HTML["report.html"], /batchScopeType|batchScopeSelect|单个店铺/);
  assert.match(
    generated.LEGACY_PAGE_HTML["comments.html"],
    /class="cloud-team-nav-link is-active" href="\/comments\.html" aria-current="page">评论监测/,
  );
  assert.doesNotMatch(
    generated.LEGACY_PAGE_HTML["workspace.html"],
    /id="projectClassification(?:Tab|Panel)"|data-project-view="classification"/,
  );
  const cloudReportHtml = generated.LEGACY_PAGE_HTML["report.html"];
  const currentPlatformStart = cloudReportHtml.indexOf('data-platform-picker="current"');
  const batchPlatformStart = cloudReportHtml.indexOf('data-platform-picker="batch"');
  assert.ok(currentPlatformStart >= 0 && batchPlatformStart > currentPlatformStart);
  assert.equal(
    (cloudReportHtml.slice(currentPlatformStart, batchPlatformStart)
      .match(/data-platform-config="pgy"/g) ?? []).length,
    1,
  );
  assert.equal(
    (cloudReportHtml.slice(batchPlatformStart).match(/data-platform-config="pgy"/g) ?? []).length,
    0,
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
  assert.match(
    generated.LEGACY_PAGE_HTML["accounts.html"],
    /id="lockVaultBtn"[\s\S]*?<svg[\s\S]*?<span class="cloud-team-account-button-label">锁定账号库<\/span><\/button>/,
  );
  for (const filename of protectedFilenames.filter((name) => name !== "accounts.html")) {
    assert.equal((generated.LEGACY_PAGE_HTML[filename].match(/id="lockVaultBtn"/g) ?? []).length, 0);
  }

  assert.equal(generated.EXTENSION_PACKAGE_VERSION, "2.37.52");
  assert.deepEqual(Array.from(generated.EXTENSION_PACKAGE_FILENAMES), [
    "taobao-data-assistant.zip",
    "taobao-data-assistant-2.37.52.zip",
  ]);
  const archive = Buffer.from(generated.EXTENSION_PACKAGE_BASE64, "base64");
  assert.ok(archive.length > 100_000);
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");
  const packagedEntries = zipEntries(archive);
  assert.deepEqual(Array.from(packagedEntries.keys()), extensionFilenames);
  for (const filename of extensionFilenames) {
    assert.deepEqual(
      packagedEntries.get(filename),
      await readFile(new URL(`../../${filename}`, import.meta.url)),
      `${filename} must match the local extension source byte-for-byte`,
    );
  }

  const source = await readFile(generatedModuleUrl, "utf8");
  assert.equal((source.match(/export const EXTENSION_PACKAGE_BASE64/g) ?? []).length, 1);
});

test("unified legacy navigation preserves embedded and account-sidebar layouts", async () => {
  const navigationStyles = await readFile(
    new URL("../public/cloud-team-navigation.css", import.meta.url),
    "utf8",
  );
  const navigationScript = await readFile(
    new URL("../public/cloud-team-navigation.js", import.meta.url),
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
  assert.match(
    navigationStyles,
    /\.cloud-team-account-button\s*\{[\s\S]*?border:\s*1px solid #b7d8f8;[\s\S]*?background:\s*#f4f9ff;[\s\S]*?font-weight:\s*720;[\s\S]*?line-height:\s*normal;/,
  );
  assert.match(
    navigationStyles,
    /\.cloud-team-account-button svg\s*\{[\s\S]*?width:\s*1\.2em;[\s\S]*?height:\s*1\.2em;[\s\S]*?flex:\s*none;/,
  );
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*520px\)\s*\{[\s\S]*?\.cloud-team-account-actions\s*\{[\s\S]*?padding-left:\s*0;[\s\S]*?border-left:\s*0;[\s\S]*?\.cloud-team-account-button\s*\{[\s\S]*?padding:\s*0 8px;/,
  );
  assert.match(navigationScript, /getElementById\('cloudTeamLogoutLabel'\)/);
  assert.match(navigationScript, /label\.textContent\s*=\s*'正在退出…'/);
  assert.doesNotMatch(navigationScript, /button\.textContent\s*=/);
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
