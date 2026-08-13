const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const origins = [
  'https://tbdata.aizicheng.com',
];
const retiredHostedOrigin = ['https://taobao-business-team', 'sunset-camel-1085', 'chatgpt', 'site'].join('.');

assert.equal(manifest.version, '2.37.4');
const bridgeScript = manifest.content_scripts.find((item) =>
  Array.isArray(item.js) && item.js.includes('web-tool-bridge.js')
);
assert.ok(bridgeScript);
assert.match(background, /BUSINESS_DEFENSE_WEB_TOOL_ORIGINS/);
for (const origin of origins) {
  const pattern = origin + '/*';
  const escapedOrigin = new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  assert.ok(manifest.host_permissions.includes(pattern), origin);
  assert.ok(bridgeScript.matches.includes(pattern), origin);
  assert.match(bridge, escapedOrigin, origin);
  assert.match(background, escapedOrigin, origin);
}
assert.doesNotMatch(JSON.stringify(manifest), /\*:\/\/\*\.chatgpt\.site|https:\/\/\*\.chatgpt\.site/);
assert.doesNotMatch(JSON.stringify(manifest), /\*:\/\/\*\.aizicheng\.com|https:\/\/\*\.aizicheng\.com/);
assert.ok(!manifest.host_permissions.includes(retiredHostedOrigin + '/*'));
assert.ok(!bridgeScript.matches.includes(retiredHostedOrigin + '/*'));
assert.ok(!bridge.includes(retiredHostedOrigin));
assert.ok(!background.includes(retiredHostedOrigin));

function evaluateBridge(origin, pathname) {
  const posted = [];
  const listeners = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(message) { posted.push(message); },
  };
  windowObject.top = windowObject;
  const context = {
    console,
    location: { origin, pathname },
    window: windowObject,
    chrome: {
      runtime: {
        getManifest() { return { version: manifest.version }; },
        sendMessage() { throw new Error('not called during initialization'); },
      },
      storage: {
        local: {},
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(bridge, context, { filename: 'web-tool-bridge.js' });
  return { windowObject, posted, listeners };
}

for (const origin of origins) {
  for (const pathname of [
    '/login', '/setup', '/change-password', '/admin',
    '/collect.html',
    '/_next/static/chunks/login.js', '/downloads/taobao-data-assistant.zip',
  ]) {
    const evaluated = evaluateBridge(origin, pathname);
    assert.equal(evaluated.windowObject.__taobaoFullChainBridgeV1, undefined, origin + pathname);
    assert.equal(evaluated.posted.length, 0, origin + pathname);
    assert.equal(evaluated.listeners.length, 0, origin + pathname);
  }

  for (const pathname of [
    '/', '/workspace.html', '/accounts.html',
    '/report.html', '/data.html', '/report-view.html',
  ]) {
    const evaluated = evaluateBridge(origin, pathname);
    assert.equal(evaluated.windowObject.__taobaoFullChainBridgeV1, true, origin + pathname);
    assert.ok(evaluated.posted.some((message) => message.type === 'ready'), origin + pathname);
    assert.equal(evaluated.listeners.length, 1, origin + pathname);
  }
}

const retiredBridge = evaluateBridge(retiredHostedOrigin, '/');
assert.equal(retiredBridge.windowObject.__taobaoFullChainBridgeV1, undefined);
assert.equal(retiredBridge.posted.length, 0);
assert.equal(retiredBridge.listeners.length, 0);

const generatedAssetsPath = path.join(root, 'cloud-tool', 'app', 'server', 'generated-protected-assets.ts');
assert.ok(fs.existsSync(generatedAssetsPath));
const generatedAssets = fs.readFileSync(generatedAssetsPath, 'utf8');
assert.match(generatedAssets, /export const LEGACY_PAGE_HTML/);
assert.match(generatedAssets, /export const EXTENSION_PACKAGE_BASE64/);
const generatedVersion = generatedAssets.match(/export const EXTENSION_PACKAGE_VERSION = "(\d+\.\d+\.\d+)"/);
assert.ok(generatedVersion);
assert.match(generatedAssets, /"workspace\.html"/);
assert.doesNotMatch(generatedAssets, /"collect\.html"\s*:/);
assert.match(generatedAssets, /"taobao-data-assistant\.zip"/);
assert.ok(generatedAssets.includes(`"taobao-data-assistant-${generatedVersion[1]}.zip"`));
for (const name of [
  'workspace.html', 'accounts.html', 'collect.html',
  'report.html', 'data.html', 'report-view.html',
]) {
  assert.equal(fs.existsSync(path.join(root, 'cloud-tool', 'public', name)), false, name);
  assert.equal(fs.existsSync(path.join(root, 'cloud-tool', 'dist', 'client', name)), false, name);
}
assert.equal(fs.existsSync(path.join(root, 'cloud-tool', 'public', 'downloads')), false);
assert.equal(fs.existsSync(path.join(root, 'cloud-tool', 'dist', 'client', 'downloads')), false);

console.log('cloud deployment origin guards passed');
