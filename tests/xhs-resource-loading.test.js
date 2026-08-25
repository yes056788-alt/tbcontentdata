const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
  return source.slice(start, end);
}

test('local web server exposes browser-facing XHS modules from the extension source', () => {
  const source = read('web-tool/server.mjs');

  assert.match(
    source,
    /['"]\/xhs-contract\.js['"]\s*,\s*\{\s*path:\s*join\(extensionRoot,\s*['"]xhs['"],\s*['"]contract\.js['"]\),\s*type:\s*['"]text\/javascript; charset=utf-8['"]\s*\}/,
  );
  assert.match(
    source,
    /['"]\/xhs-metrics\.js['"]\s*,\s*\{\s*path:\s*join\(extensionRoot,\s*['"]xhs['"],\s*['"]metrics\.js['"]\),\s*type:\s*['"]text\/javascript; charset=utf-8['"]\s*\}/,
  );
  assert.match(
    source,
    /['"]\/xhs-report-model\.js['"]\s*,\s*\{\s*path:\s*join\(extensionRoot,\s*['"]xhs['"],\s*['"]report-model\.js['"]\),\s*type:\s*['"]text\/javascript; charset=utf-8['"]\s*\}/,
  );
});

test('cloud sync copies and versions all browser-facing XHS modules', () => {
  const source = read('cloud-tool/scripts/sync-web-tool.mjs');
  const copyBlock = section(source, 'await Promise.all([', 'const versionedWebAssets');
  const versionedBlock = section(source, 'const versionedWebAssets', 'const legacyPageHtml');

  assert.match(
    copyBlock,
    /copyFile\(resolve\(extensionRoot,\s*['"]xhs\/contract\.js['"]\),\s*resolve\(publicRoot,\s*['"]xhs-contract\.js['"]\)\)/,
  );
  assert.match(
    copyBlock,
    /copyFile\(resolve\(extensionRoot,\s*['"]xhs\/metrics\.js['"]\),\s*resolve\(publicRoot,\s*['"]xhs-metrics\.js['"]\)\)/,
  );
  assert.match(
    copyBlock,
    /copyFile\(resolve\(extensionRoot,\s*['"]xhs\/report-model\.js['"]\),\s*resolve\(publicRoot,\s*['"]xhs-report-model\.js['"]\)\)/,
  );
  assert.match(versionedBlock, /['"]xhs-contract\.js['"]/);
  assert.match(versionedBlock, /['"]xhs-metrics\.js['"]/);
  assert.match(versionedBlock, /['"]xhs-report-model\.js['"]/);
});

test('cloud extension ZIP keeps the complete existing XHS runtime module set', () => {
  const source = read('cloud-tool/scripts/sync-web-tool.mjs');
  const zipFiles = section(source, 'const files = [', '];\n  const entries');

  for (const modulePath of [
    'xhs/contract.js',
    'xhs/identity.js',
    'xhs/analysis.js',
    'xhs/metrics.js',
    'xhs/runtime.js',
  ]) {
    assert.match(zipFiles, new RegExp(`['"]${modulePath.replace('/', '\\/')}['"]`), modulePath);
  }
});
