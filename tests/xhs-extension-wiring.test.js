const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const syncSource = fs.readFileSync(
  path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs'),
  'utf8',
);

const platformWiring = [
  {
    name: '淘宝星河',
    match: 'https://adstar.alimama.com/*',
    pageHook: 'adstar-page-hook.js',
  },
  {
    name: '蒲公英',
    match: 'https://pgy.xiaohongshu.com/*',
    pageHook: 'pgy-page-hook.js',
  },
  {
    name: '聚光',
    match: 'https://ad.xiaohongshu.com/*',
    pageHook: 'juguang-page-hook.js',
  },
];

const isolatedBridge = 'xhs-platform-content.js';
const backgroundModules = [
  'xhs/identity.js',
  'xhs/collector-core.js',
  'xhs/local-cache.js',
  'xhs/page-client.js',
];
const extensionResources = [
  isolatedBridge,
  ...platformWiring.map((platform) => platform.pageHook),
  ...backgroundModules,
];

function contentScriptFor(match, script, world) {
  return manifest.content_scripts.find((entry) => (
    Array.isArray(entry.matches)
      && entry.matches.includes(match)
      && Array.isArray(entry.js)
      && entry.js.includes(script)
      && (world === 'ISOLATED' ? entry.world !== 'MAIN' : entry.world === world)
  ));
}

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

test('manifest grants each XHS platform an exact host permission', () => {
  for (const platform of platformWiring) {
    assert.ok(
      manifest.host_permissions.includes(platform.match),
      `${platform.name} 缺少精确 host permission：${platform.match}`,
    );
  }

  assert.equal(
    manifest.host_permissions.some((pattern) => pattern.includes('*.xiaohongshu.com')),
    false,
    '小红书平台权限不得退化为 *.xiaohongshu.com 通配授权',
  );
});

test('manifest wires a MAIN page hook and isolated bridge on every exact platform host', () => {
  for (const platform of platformWiring) {
    const pageHookEntry = contentScriptFor(platform.match, platform.pageHook, 'MAIN');
    assert.ok(pageHookEntry, `${platform.name} 缺少 MAIN page hook：${platform.pageHook}`);
    assert.equal(pageHookEntry.run_at, 'document_start', `${platform.name} page hook 必须尽早安装`);

    const bridgeEntry = contentScriptFor(platform.match, isolatedBridge, 'ISOLATED');
    assert.ok(bridgeEntry, `${platform.name} 缺少 ISOLATED content bridge：${isolatedBridge}`);
    assert.equal(bridgeEntry.run_at, 'document_start', `${platform.name} content bridge 必须尽早安装`);
  }
});

test('every XHS script referenced by the target wiring exists locally', () => {
  for (const resource of extensionResources) {
    assert.equal(
      fs.existsSync(path.join(root, resource)),
      true,
      `扩展引用了不存在的本地资源：${resource}`,
    );
  }
});

test('cloud extension ZIP resource list explicitly includes every XHS script', () => {
  for (const resource of extensionResources) {
    assert.ok(
      quotedLiteralPattern(resource).test(syncSource),
      `sync-web-tool.mjs 的 ZIP 资源清单缺少：${resource}`,
    );
  }
});

test('background loads independent XHS modules without copying platform API paths', () => {
  assert.ok(
    /importScripts\s*\(/.test(backgroundSource),
    'background 必须通过 importScripts 加载独立 XHS 模块',
  );
  for (const modulePath of backgroundModules) {
    assert.ok(
      quotedLiteralPattern(modulePath).test(backgroundSource),
      `background 未加载独立模块：${modulePath}`,
    );
  }

  assert.equal(
    /\/api\/(?:solar|leona|one|report|edith)\//.test(backgroundSource),
    false,
    '平台 API path 应封装在 XHS adapter/page hook，不得复制进 background.js',
  );
});
