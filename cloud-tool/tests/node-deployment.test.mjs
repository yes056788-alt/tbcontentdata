import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ECS compose exposes only a loopback app port", async () => {
  const compose = await source("../docker-compose.ecs.yml");
  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:-3401\}:3000/);
  assert.doesNotMatch(compose, /(?:^|\s)nginx:/m);
  assert.doesNotMatch(compose, /["'](?:80|443):(?:80|443)["']/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /taobao-business-data/);
});

test("host Nginx remains the TLS owner and proxies to loopback", async () => {
  const nginx = await source("../deploy/nginx/tbdata-host.conf.example");
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3401/);
  assert.match(nginx, /ssl_certificate /);
  assert.doesNotMatch(nginx, /server app:3000/);
});

test("production image contains the offline migration importer", async () => {
  const dockerfile = await source("../Dockerfile");
  for (const required of [
    "scripts/import-business-migration.mjs",
    "scripts/lib/",
    "lib/business-migration-format.mjs",
    "node_modules/drizzle-orm/",
    "drizzle/",
  ]) {
    assert.match(dockerfile, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("production image uses the validated startup wrapper and readiness endpoint", async () => {
  const dockerfile = await source("../Dockerfile");
  assert.match(dockerfile, /CMD \["node", "scripts\/start-node\.mjs"\]/);
  assert.match(dockerfile, /127\.0\.0\.1:3000\/api\/health/);
  assert.match(dockerfile, /DEPLOY_TARGET=node/);
  assert.doesNotMatch(dockerfile, /^COPY \. \.\/$/m);
  assert.match(dockerfile, /^COPY cloud-tool\/ \.\/cloud-tool\/$/m);
  assert.match(dockerfile, /^COPY web-tool\/ \.\/web-tool\/$/m);
});

test("Docker context excludes credentials and every persistence artifact", async () => {
  const dockerignore = await source("../../.dockerignore");
  for (const required of [
    "cloud-tool/.env.*",
    "cloud-tool/.git/",
    "cloud-tool/.data/**",
    "**/*.sqlite",
    "**/*.sqlite-wal",
    "**/*.sqlite-shm",
    "**/objects/**",
    "**/*.tbmig",
    "**/backup/**",
    "**/backups/**",
    "**/*.pem",
    "**/*.key",
  ]) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(required),
      `${required} must be excluded from the Docker build context`,
    );
  }
  assert.equal(
    dockerignore
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#")),
    "*",
  );
});

test("Docker allow-list contains every root input used by extension packaging", async () => {
  const dockerfile = await source("../Dockerfile");
  const dockerignore = await source("../../.dockerignore");
  const buildInputs = [
    "adstar-page-hook.js",
    "pgy-page-hook.js",
    "juguang-page-hook.js",
    "xhs-platform-content.js",
    "manifest.json",
    "README_V2.md",
    "diagnosis-popup.html",
    "diagnosis-popup.js",
    "diagnosis-spec.js",
    "background.js",
    "content-script.js",
    "dmp-content-script.js",
    "dmp-crowd-presets.json",
    "dmp-page-hook.js",
    "page-hook.js",
    "rules.js",
    "sycm-content-script.js",
    "web-tool-bridge.js",
    "xinghe-content-script.js",
    "wxt-report-content.js",
    "wxt-report-page-hook.js",
    "wxt-report-response-hook.js",
    "wxt-report-trace.js",
  ];
  for (const filename of buildInputs) {
    assert.ok(dockerfile.includes(filename), `${filename} must be copied`);
    assert.ok(
      dockerignore.split(/\r?\n/).includes(`!${filename}`),
      `${filename} must be included by .dockerignore`,
    );
  }
  assert.match(dockerfile, /^COPY xhs\/ \.\/xhs\/$/m);
  for (const directory of ["cloud-tool", "web-tool", "xhs"]) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(`!${directory}/`),
      `${directory}/ must be included by .dockerignore`,
    );
    assert.ok(
      dockerignore.split(/\r?\n/).includes(`!${directory}/**`),
      `${directory}/** must be included by .dockerignore`,
    );
  }
  assert.ok(dockerignore.includes("!vendor/xlsx.full.min.js"));
});
