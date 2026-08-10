const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const projectHtml = fs.readFileSync(path.join(root, 'web-tool', 'index.html'), 'utf8');
const collectHtml = fs.readFileSync(path.join(root, 'web-tool', 'collect.html'), 'utf8');
const reportTaskHtml = fs.readFileSync(path.join(root, 'web-tool', 'report.html'), 'utf8');
const dataHtml = fs.readFileSync(path.join(root, 'web-tool', 'data.html'), 'utf8');
const reportViewHtml = fs.readFileSync(path.join(root, 'web-tool', 'report-view.html'), 'utf8');
const accountsHtml = fs.readFileSync(path.join(root, 'web-tool', 'accounts.html'), 'utf8');
const portalCss = fs.readFileSync(path.join(root, 'web-tool', 'portal.css'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'web-tool', 'app.css'), 'utf8');
const projectPage = fs.readFileSync(path.join(root, 'web-tool', 'project.js'), 'utf8');
const taskPage = fs.readFileSync(path.join(root, 'web-tool', 'task.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'web-tool', 'server.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

for (const id of [
  'projectTree', 'projectTreeEmpty', 'projectDashboard', 'projectRunRows',
  'projectReportFrame', 'projectDataFrame', 'storeCollectLink', 'storeReportLink', 'connectionState',
  'projectHistoryPicker', 'projectRunSelect',
  'projectExportBtn',
]) {
  assert.match(projectHtml, new RegExp('id="' + id + '"'));
}
assert.doesNotMatch(projectHtml, /masterPassword|vaultGate|unlockVaultBtn/);
assert.match(projectHtml, /aria-current="page">项目管理<\/a>/);
assert.match(projectHtml, /data-project-view="report"/);
assert.match(projectHtml, /data-project-view="data"/);
assert.match(projectHtml, /data-project-view="history"/);

for (const html of [projectHtml, collectHtml, reportTaskHtml, dataHtml, reportViewHtml, accountsHtml]) {
  assert.match(html, />项目管理<\/a>/);
  assert.match(html, />经营取数<\/a>/);
  assert.match(html, />诊断报告<\/a>/);
  assert.match(html, />账号库管理<\/a>/);
}

for (const html of [collectHtml, reportTaskHtml]) {
  for (const id of [
    'taskGroupSelect', 'taskStoreSelect', 'startCurrentTaskBtn', 'taskRunRows',
    'batchSessionNotice', 'batchScopeType', 'batchScopeSelect', 'batchAccountSummary', 'startBatchTaskBtn',
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /data-task-mode="current"/);
  assert.match(html, /data-task-mode="batch"/);
  assert.match(html, /data-platform-picker="current"/);
  assert.match(html, /data-platform-picker="batch"/);
  for (const platform of ['sycm', 'guanghe', 'wxt', 'dmp']) {
    assert.match(html, new RegExp('type="checkbox" value="' + platform + '"'));
  }
  assert.doesNotMatch(html, />返回项目管理<\/a>/);
  assert.doesNotMatch(html, /id="metricRows"|id="reportShell"|id="flowSection"/);
}
assert.match(collectHtml, /data-task-type="collect"/);
assert.match(reportTaskHtml, /data-task-type="report"/);

for (const id of [
  'autoCollectBtn', 'refreshBtn', 'copyBtn', 'exportBtn', 'clearBtn',
  'hint', 'platformProgress', 'runProgressBar', 'taobaoMetricRows', 'xiaohongshuMetricRows',
  'taobaoMetricCount', 'xiaohongshuMetricCount', 'taobaoMetricsPanel', 'xiaohongshuMetricsPanel',
  'taobaoTableTab', 'xiaohongshuTableTab',
]) {
  assert.match(dataHtml, new RegExp('id="' + id + '"'));
}
assert.match(dataHtml, /id="autoCollectBtn"[^>]*hidden/);
assert.match(dataHtml, /原始数据手动填写并自动保存/);
assert.doesNotMatch(dataHtml, /data-filter=/);
assert.doesNotMatch(dataHtml, /id="summary"/);
assert.match(dataHtml, /id="taobaoTableTab"[^>]*aria-selected="true"/);
assert.match(dataHtml, /id="xiaohongshuTableTab"[^>]*aria-selected="false"/);
assert.match(dataHtml, /id="xiaohongshuMetricsPanel"[^>]*hidden/);
assert.match(dataHtml, /data-platform-table="taobao"/);
assert.match(dataHtml, /data-platform-table="xiaohongshu"/);
assert.match(portalCss, /@media \(max-width: 760px\)/);
assert.match(projectPage, /setProjectDirectory/);
assert.match(projectPage, /restoreStoreRun/);
assert.match(projectPage, /let activeView = 'report'/);
assert.match(projectPage, /function runsForView/);
assert.match(projectPage, /projectRunSelect/);
assert.match(projectPage, /function exportActiveView/);
assert.match(projectPage, /exportReportBtn/);
assert.match(projectPage, /exportBtn/);
assert.match(projectPage, /data-project-group/);
assert.match(projectPage, /'\/report-view\.html'/);
assert.match(projectPage, /'\/data\.html'/);
assert.match(projectPage, /'\?embed=1&archive='/);
assert.match(taskPage, /startProjectTask/);
assert.match(taskPage, /startAccountBatchFromSession/);
assert.match(taskPage, /getAccountSessionSummary/);
assert.doesNotMatch(taskPage, /TaobaoAccountVault\.decrypt|batchMasterPassword/);
assert.match(taskPage, /taobaoProjectTaskStatusV1/);
assert.match(taskPage, /\/report-view\.html\?archive=/);
assert.match(taskPage, /\/data\.html\?archive=/);
assert.match(dashboard, /requestWebBridge\('startAutoCollect'/);
assert.match(dashboard, /requestWebBridge\('patchStoreRunManualInput'/);
assert.match(dashboard, /result\.partial \? 'partial'/);
assert.match(dashboard, /部分完成/);
assert.match(appCss, /\.platform-step\.partial/);
assert.match(background, /async function runProjectTask/);
assert.match(background, /PROJECT_TASK_START/);

for (const route of ['/collect.html', '/data.html', '/report-view.html', '/portal.css', '/project.js', '/task.js']) {
  assert.ok(server.includes("['" + route + "'"), 'missing server route ' + route);
}

const bridgeContentScript = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.includes('web-tool-bridge.js')
));
assert.ok(bridgeContentScript);
assert.ok(bridgeContentScript.matches.includes('http://127.0.0.1:3400/*'));
assert.equal(bridgeContentScript.all_frames, true);
assert.match(server, /frame-ancestors 'self'/);
assert.equal(manifest.version, '2.37.3');

console.log('project and task page guards passed');
