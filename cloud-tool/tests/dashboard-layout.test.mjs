import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile(
  new URL("../app/components/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("home keeps one focused hero with the extension download promoted", () => {
  const hero = dashboardSource.match(
    /<section className="hero"[\s\S]*?<\/section>/,
  )?.[0];

  assert.ok(hero, "home hero");
  const install = hero.match(
    /<div className="hero-install"[\s\S]*?<\/div>\s*<div className="trust-row"/,
  )?.[0];

  assert.ok(install, "promoted extension install card");
  assert.match(install, /role="group" aria-labelledby="extension-install-title"/);
  assert.match(
    install,
    /href="\/downloads\/taobao-data-assistant\.zip" download>[\s\S]*?<DownloadIcon \/>[\s\S]*?下载数据助手扩展/,
  );
  assert.equal(
    (dashboardSource.match(/taobao-data-assistant\.zip/g) ?? []).length,
    1,
  );
  assert.ok(hero.indexOf("hero-install") < hero.indexOf("status-console"));
  assert.doesNotMatch(hero, /进入经营工作台|管理团队权限/);
  assert.doesNotMatch(hero, /href="\/workspace\.html"|href="\/admin"/);
});

test("home removes the overview, secondary panels, and redundant data requests", () => {
  assert.doesNotMatch(dashboardSource, /overview-title|团队数据概览|metric-grid/);
  assert.doesNotMatch(dashboardSource, /workspace-content|recent-panel|install-panel/);
  assert.doesNotMatch(dashboardSource, /<footer className="site-footer">/);
  assert.deepEqual(
    [...dashboardSource.matchAll(/getJson\("([^"]+)"\)/g)].map((match) => match[1]).sort(),
    ["/api/session", "/api/vault"],
  );
  assert.doesNotMatch(dashboardSource, /\/api\/runs|\/api\/admin\/members/);
});

test("desktop home fills one viewport while narrow layouts can grow naturally", () => {
  const portalRule = globalStyles.slice(
    globalStyles.indexOf(".portal-page {"),
    globalStyles.indexOf(".topbar {"),
  );
  const heroRule = globalStyles.slice(
    globalStyles.indexOf(".hero {"),
    globalStyles.indexOf(".hero::before"),
  );
  const narrowStart = globalStyles.indexOf("@media (max-width: 780px)");
  const narrowEnd = globalStyles.indexOf("@media (max-width: 520px)", narrowStart);
  const narrowRules = globalStyles.slice(narrowStart, narrowEnd);
  const phoneRules = globalStyles.slice(globalStyles.indexOf("@media (max-width: 520px)"));

  assert.match(
    portalRule,
    /display:\s*flex;[\s\S]*?min-height:\s*100svh;[\s\S]*?flex-direction:\s*column;/,
  );
  assert.match(
    heroRule,
    /min-height:\s*480px;[\s\S]*?flex:\s*1;/,
  );
  assert.match(
    narrowRules,
    /\.hero\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?min-height:\s*auto;/,
  );
  assert.match(
    phoneRules,
    /\.hero-install__button\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?width:\s*100%;/,
  );
});

test("home exposes a compact retry when cloud state cannot be read", () => {
  assert.doesNotMatch(dashboardSource, /Promise\.allSettled/);
  assert.match(dashboardSource, /vaultError instanceof ApiError && vaultError\.status === 401/);
  assert.match(dashboardSource, /error \? "暂时无法确认账号库状态"/);
  assert.match(dashboardSource, /onClick=\{\(\) => void load\(\)\}[\s\S]*?重新连接/);
});
