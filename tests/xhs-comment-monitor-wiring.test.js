const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function contentScriptFor(manifest, filename) {
  return (manifest.content_scripts || []).find((entry) => (
    Array.isArray(entry.js) && entry.js.includes(filename)
  ));
}

test('extension wires the independent comment monitor runtime and page-owned API capture', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const background = read('background.js');

  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  assert.ok(manifest.host_permissions.includes('https://www.xiaohongshu.com/*'));

  const pageHook = contentScriptFor(manifest, 'xhs-comment-page-hook.js');
  const contentBridge = contentScriptFor(manifest, 'xhs-comment-content.js');
  assert.ok(pageHook, 'MAIN-world comment hook must be declared');
  assert.equal(pageHook.world, 'MAIN');
  assert.equal(pageHook.run_at, 'document_start');
  assert.ok(contentBridge, 'isolated comment bridge must be declared');
  assert.notEqual(contentBridge.world, 'MAIN');

  assert.match(background, /['"]xhs\/comment-monitor\.js['"]/);
  assert.match(background, /['"]xhs\/comment-summary-archive\.js['"]/);
  assert.match(background, /['"]xhs\/comment-monitor-runtime\.js['"]/);
  assert.match(background, /XhsCommentMonitorRuntime\.createCommentMonitorRuntime/);
  assert.match(background, /createPageClient\(\{[\s\S]*recoverBridge:\s*recoverXhsPageBridge/,
    'direct comment-monitor inventory requests must recover a stale PGY page receiver');
  assert.match(background, /async function recoverXhsPageBridge\(/);
  assert.match(background, /prepareCurrentSessionProjectPlatforms\(\['pgy'\]/,
    'comment monitor must open a fresh PGY task page and reuse the current Chrome session');
  assert.match(background, /persistSummary:\s*\(summary, context\)/);
  assert.match(background, /commentMonitorRuntime\.register\(\)/);
});

test('comment monitor is a first-class workbench page with a trusted bridge and local routes', () => {
  const indexHtml = read('web-tool/index.html');
  const reportHtml = read('web-tool/report.html');
  const accountsHtml = read('web-tool/accounts.html');
  const server = read('web-tool/server.mjs');
  const bridge = read('web-tool-bridge.js');

  for (const html of [indexHtml, reportHtml, accountsHtml]) {
    assert.match(html, /href="\/comments\.html"/);
    assert.match(html, />评论监测</);
  }
  assert.match(server, /['"]\/comments\.html['"]/);
  assert.match(server, /['"]\/comments\.js['"]/);
  assert.match(server, /['"]\/comments\.css['"]/);

  assert.match(bridge, /['"]commentMonitor['"]/);
  assert.match(bridge, /\/comments\.html/);
  assert.match(bridge, /PROJECT_DIRECTORY_KEY/);
  assert.match(bridge, /selectedCommentMonitorStore/);
  assert.match(bridge, /storeId:\s*selection\.store\.id/);
  for (const action of [
    'getCommentMonitorState',
    'configureCommentMonitor',
    'runCommentMonitorNow',
    'queryCommentMonitorComments',
    'exportCommentMonitorRaw',
  ]) {
    assert.match(bridge, new RegExp(`['"]${action}['"]`));
  }
});

test('cloud build publishes the comment monitor without archiving raw comments', () => {
  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');
  const cloudSync = read('web-tool/cloud-sync.js');
  const background = read('background.js');
  const bridge = read('web-tool-bridge.js');
  const project = read('web-tool/project.js');

  for (const asset of ['comments.html', 'comments.js', 'comments.css']) {
    assert.match(sync, new RegExp(`['"]${asset.replace('.', '\\.') }['"]`));
  }
  assert.match(sync, /['"]xhs\/comment-monitor\.js['"]/);
  assert.match(sync, /['"]xhs\/comment-summary-archive\.js['"]/);
  assert.match(cloudSync, /['"]xhsCommentInsightSummaryV1['"]/);
  assert.doesNotMatch(cloudSync, /xhsCommentRaw|commentMonitorRaw|rawComments/);
  const accountArchiveKeys = background.slice(
    background.indexOf('const ACCOUNT_RUN_SNAPSHOT_KEYS = ['),
    background.indexOf('async function clearAccountRunSnapshots')
  );
  assert.doesNotMatch(accountArchiveKeys, /xhsCommentInsightSummaryV1|xhsCommentCaptureCheckpointsV1/);
  assert.match(bridge, /key !== COMMENT_ARCHIVE_SNAPSHOT_KEY/,
    'restoring a report history must not replace the live comment summary');
  assert.match(project, /comment_monitor['"]\) return \[['"]评论监测['"], false, false\]/);
});
