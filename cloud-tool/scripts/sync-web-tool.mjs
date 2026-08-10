import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const extensionRoot = resolve(siteRoot, "..");
const webToolRoot = resolve(extensionRoot, "web-tool");
const publicRoot = resolve(siteRoot, "public");
const distClientRoot = resolve(siteRoot, "dist/client");
const generatedAssetsPath = resolve(siteRoot, "app/server/generated-protected-assets.ts");
const cloudNavigationStylesheet = "/cloud-team-navigation.css";
const cloudNavigationScript = "/cloud-team-navigation.js";

const publicWebFiles = [
  "account-vault.js",
  "accounts.css",
  "accounts.js",
  "app.css",
  "portal.css",
  "project.js",
  "report.css",
  "report.js",
  "task.js",
];

const protectedHtmlSources = [
  ["workspace.html", "index.html"],
  ["accounts.html", "accounts.html"],
  ["collect.html", "collect.html"],
  ["report.html", "report.html"],
  ["data.html", "data.html"],
  ["report-view.html", "report-view.html"],
];

await Promise.all([
  mkdir(publicRoot, { recursive: true }),
  mkdir(dirname(generatedAssetsPath), { recursive: true }),
]);

await Promise.all([
  removeProtectedClientAssets(publicRoot),
  removeProtectedClientAssets(distClientRoot),
]);

for (const name of publicWebFiles) {
  await copyFile(resolve(webToolRoot, name), resolve(publicRoot, name));
}

const legacyPageHtml = {};
for (const [publicName, sourceName] of protectedHtmlSources) {
  const html = await readFile(resolve(webToolRoot, sourceName), "utf8");
  legacyPageHtml[publicName] = prepareHtml(html, publicName);
}

await Promise.all([
  copyFile(resolve(extensionRoot, "diagnosis-popup.js"), resolve(publicRoot, "diagnosis-popup.js")),
  copyFile(resolve(extensionRoot, "diagnosis-spec.js"), resolve(publicRoot, "diagnosis-spec.js")),
  copyFile(resolve(extensionRoot, "vendor/xlsx.full.min.js"), resolve(publicRoot, "xlsx.full.min.js")),
  copyFile(resolve(webToolRoot, "cloud-sync.js"), resolve(publicRoot, "cloud-sync.js")),
]);

function prepareHtml(input, filename) {
  const normalized = input.replace(/^<!doctype html>/i, "<!DOCTYPE html>");
  const rewritten = addCloudTeamNavigation(
    normalized.replaceAll('/index.html', '/workspace.html'),
    filename,
  )
    .replace(/\s*<script src="\/cloud-team-navigation\.js"><\/script>\s*/g, "\n")
    .replace(/\s*<script src="\/cloud-sync\.js"><\/script>\s*/g, "\n");
  const cloudScript = `  <script src="${cloudNavigationScript}"></script>\n` +
    '  <script src="/cloud-sync.js"></script>\n';
  const firstScript = rewritten.indexOf('  <script ');
  if (firstScript >= 0) {
    return rewritten.slice(0, firstScript) + cloudScript + rewritten.slice(firstScript);
  }
  return rewritten.replace('</body>', cloudScript + '</body>');
}

function addCloudTeamNavigation(input, filename) {
  const headerPattern = /<header class="(portal-topbar|management-topbar)">[\s\S]*?<\/header>/;
  const match = input.match(headerPattern);
  if (!match) return input;
  const withStylesheet = input.replace(
    "</head>",
    `  <link rel="stylesheet" href="${cloudNavigationStylesheet}">\n</head>`,
  );
  const activePage = filename === "collect.html" ? "collect"
    : filename === "report.html" ? "report"
      : filename === "accounts.html" ? "accounts"
        : "projects";
  const navigation = [
    ["home", "/", "首页"],
    ["projects", "/workspace.html", "项目管理"],
    ["collect", "/collect.html", "经营取数"],
    ["report", "/report.html", "诊断报告"],
    ["accounts", "/accounts.html", "账号库管理"],
    ["team", "/admin", "团队管理"],
  ].map(([id, href, label]) => {
    const active = id === activePage;
    return `      <a class="cloud-team-nav-link${active ? " is-active" : ""}" href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("\n");
  const lockVaultButton = filename === "accounts.html"
    ? '        <button id="lockVaultBtn" class="cloud-team-account-button" type="button" hidden>锁定账号库</button>\n'
    : "";
  const header = `<header class="${match[1]} cloud-team-topbar">
    <a class="cloud-team-brand" href="/" aria-label="淘宝经营数据团队工作台首页">
      <span class="cloud-team-brand-mark" aria-hidden="true">TB</span>
      <span><strong>淘宝经营数据</strong><small>全链路经营工作台</small></span>
    </a>
    <nav class="cloud-team-nav" aria-label="团队工作台主导航">
${navigation}
    </nav>
    <div class="cloud-team-account">
      <span id="cloudTeamAvatar" class="cloud-team-avatar" aria-hidden="true">用</span>
      <span class="cloud-team-account-copy"><strong id="cloudTeamAccountName">正在识别…</strong><small id="cloudTeamAccountRole">团队账号</small></span>
      <span class="cloud-team-account-actions">
${lockVaultButton}        <a class="cloud-team-account-button" href="/change-password">修改密码</a>
        <button id="cloudTeamLogout" class="cloud-team-account-button" type="button">退出登录</button>
      </span>
      <span id="connectionState" class="connection-state connecting" hidden>正在连接数据助手</span>
      <span id="extensionVersion" hidden></span>
    </div>
  </header>`;
  return withStylesheet.replace(headerPattern, header);
}

async function removeProtectedClientAssets(root) {
  await Promise.all([
    ...protectedHtmlSources.map(([name]) => rm(resolve(root, name), { force: true })),
    rm(resolve(root, "downloads"), { recursive: true, force: true }),
  ]);
}

async function buildExtensionPackage() {
  const manifest = JSON.parse(await readFile(resolve(extensionRoot, "manifest.json"), "utf8"));
  const version = String(manifest.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Extension manifest version is invalid.");
  const files = [
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
  const entries = [];
  for (const name of files) {
    entries.push({ name, data: await readFile(resolve(extensionRoot, name)) });
  }
  return {
    archive: createZip(entries),
    filenames: [
      "taobao-data-assistant.zip",
      `taobao-data-assistant-${version}.zip`,
    ],
    version,
  };
}

function renderProtectedAssetsModule(htmlByFilename, extensionPackage) {
  const htmlEntries = protectedHtmlSources.map(([name]) =>
    `  ${javascriptString(name)}: ${javascriptString(htmlByFilename[name])},`
  ).join("\n");
  const filenames = extensionPackage.filenames
    .map((name) => `  ${javascriptString(name)},`)
    .join("\n");
  return `// Generated by scripts/sync-web-tool.mjs. Do not edit by hand.

export const LEGACY_PAGE_HTML = Object.freeze({
${htmlEntries}
});

export const EXTENSION_PACKAGE_BASE64 = ${javascriptString(extensionPackage.archive.toString("base64"))};

export const EXTENSION_PACKAGE_VERSION = ${javascriptString(extensionPackage.version)};

export const EXTENSION_PACKAGE_FILENAMES = Object.freeze([
${filenames}
]);
`;
}

function javascriptString(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosTimestamp(new Date("2026-08-08T00:00:00Z"));
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function dosTimestamp(value) {
  const year = Math.max(1980, value.getUTCFullYear());
  return {
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const extensionPackage = await buildExtensionPackage();
const generatedAssetsTempPath = `${generatedAssetsPath}.${process.pid}.tmp`;
await writeFile(
  generatedAssetsTempPath,
  renderProtectedAssetsModule(legacyPageHtml, extensionPackage),
  "utf8",
);
await rename(generatedAssetsTempPath, generatedAssetsPath);
