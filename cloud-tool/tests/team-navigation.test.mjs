import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const topbarSource = await readFile(
  new URL("../app/components/team-topbar.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = await readFile(
  new URL("../app/components/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const adminSource = await readFile(
  new URL("../app/components/admin-client.tsx", import.meta.url),
  "utf8",
);
const logoutSource = await readFile(
  new URL("../app/components/logout-button.tsx", import.meta.url),
  "utf8",
);
const legacyNavigationSource = await readFile(
  new URL("../public/cloud-team-navigation.js", import.meta.url),
  "utf8",
);
const authRedirectSources = await Promise.all([
  "admin-client.tsx",
  "dashboard-client.tsx",
  "migration-client.tsx",
  "change-password-client.tsx",
].map((name) => readFile(
  new URL(`../app/components/${name}`, import.meta.url),
  "utf8",
)));
const localWorkspaceSource = await readFile(
  new URL("../../web-tool/index.html", import.meta.url),
  "utf8",
);

test("home and team pages share one complete account navigation", () => {
  assert.match(topbarSource, /href:\s*"\/", label:\s*"首页"/);
  assert.match(topbarSource, /href:\s*"\/workspace\.html", label:\s*"项目管理"/);
  assert.doesNotMatch(topbarSource, /href:\s*"\/collect\.html"|label:\s*"经营取数"/);
  assert.match(topbarSource, /href:\s*"\/report\.html", label:\s*"一键取数"/);
  assert.match(topbarSource, /href:\s*"\/comments\.html", label:\s*"评论监测"/);
  assert.match(topbarSource, /href:\s*"\/accounts\.html", label:\s*"账号库管理"/);
  assert.match(topbarSource, /href:\s*"\/admin", label:\s*"团队管理"/);
  assert.match(topbarSource, /href="\/change-password"/);
  assert.match(topbarSource, />修改密码</);
  assert.match(topbarSource, /<LogoutButton \/>/);
  assert.match(topbarSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.doesNotMatch(topbarSource, /className="brand"[\s\S]{0,160}aria-current=/);
  assert.match(topbarSource, /navigationNode\.scrollLeft\s*=\s*Math\.max/);

  assert.match(dashboardSource, /<TeamTopbar[\s\S]*?activePage="home"/);
  assert.match(adminSource, /<TeamTopbar[\s\S]*?activePage="team"/);
  assert.doesNotMatch(dashboardSource, /<header className="topbar">/);
  assert.doesNotMatch(adminSource, /<header className="topbar">/);
});

test("cloud navigation stays out of the local legacy workspace source", () => {
  assert.doesNotMatch(localWorkspaceSource, /cloud-team-navigation\.css/);
  assert.doesNotMatch(localWorkspaceSource, /href="\/admin">团队管理/);
});

test("every cloud logout locks the active account vault before leaving the session", () => {
  assert.match(
    legacyNavigationSource,
    /TaobaoCloudSync[\s\S]*?lockAccountVault[\s\S]*?\/api\/auth\/logout/,
  );
  assert.match(
    logoutSource,
    /lockAccountVaultSession[\s\S]*?\/api\/auth\/logout/,
  );
  assert.match(legacyNavigationSource, /finally[\s\S]*?location\.replace\('\/login'\)/);
  assert.match(logoutSource, /finally[\s\S]*?window\.location\.replace\("\/login"\)/);
});

test("Next management pages lock the vault before auth redirects", () => {
  for (const source of authRedirectSources) {
    assert.match(source, /lockVaultAndRedirect/);
    assert.match(source, /status\s*===\s*401|status\s*===\s*403/);
  }
});
