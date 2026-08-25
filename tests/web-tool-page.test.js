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
const cloudProjectPage = fs.readFileSync(path.join(root, 'cloud-tool', 'public', 'project.js'), 'utf8');
const cloudTaskPage = fs.readFileSync(path.join(root, 'cloud-tool', 'public', 'task.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'web-tool', 'server.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

for (const id of [
  'projectTree', 'projectTreeEmpty', 'projectDashboard', 'projectRunRows',
  'projectReportFrame', 'projectDataFrame', 'storeReportLink', 'connectionState',
  'projectHistoryPicker', 'projectRunSelect',
  'projectExportBtn', 'openBatchExportBtn', 'batchExportDialog', 'batchExportList',
  'batchExportGroupSelect', 'startBatchExportBtn', 'batchReportBuilderFrame',
]) {
  assert.match(projectHtml, new RegExp('id="' + id + '"'));
}
assert.doesNotMatch(projectHtml, /masterPassword|vaultGate|unlockVaultBtn/);
assert.match(projectHtml, /aria-current="page">项目管理<\/a>/);
assert.match(projectHtml, /data-project-view="report"/);
assert.match(projectHtml, /data-project-view="data"/);
assert.match(projectHtml, /data-project-view="history"/);
assert.match(projectHtml, />当前店铺历史报告</);
assert.match(projectHtml, />按店铺分组</);
assert.match(projectHtml, />每店最新可用报告</);
assert.match(projectHtml, />组内全部历史（最多 50 份）</);
assert.match(projectHtml, /src="\/batch-report-export\.js"/);

for (const html of [projectHtml, reportTaskHtml, dataHtml, reportViewHtml, accountsHtml]) {
  assert.match(html, />项目管理<\/a>/);
  assert.match(html, />一键取数<\/a>/);
  assert.doesNotMatch(html, /href="\/collect\.html"/);
  assert.match(html, />账号库管理<\/a>/);
}

for (const html of [reportTaskHtml]) {
  for (const id of [
    'taskGroupSelect', 'taskStoreSelect', 'startCurrentTaskBtn', 'cancelCurrentTaskBtn', 'taskRunRows',
    'batchSessionNotice', 'batchGroupSelect', 'batchAccountList', 'batchAccountSummary',
    'batchSelectAllBtn', 'batchClearSelectionBtn', 'startBatchTaskBtn',
    'juguangConcurrentTabs',
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.doesNotMatch(html, /batchScopeType|batchScopeSelect|单个店铺/);
  assert.match(html, /选择组内账号/);
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
assert.match(collectHtml, /http-equiv="refresh" content="0; url=\/report\.html"/);
assert.doesNotMatch(collectHtml, /data-task-type="collect"|startCurrentTaskBtn|startBatchTaskBtn/);
assert.match(reportTaskHtml, /data-task-type="report"/);
assert.match(reportTaskHtml, /<h1>一键取数<\/h1>/);
assert.match(reportTaskHtml, />开始一键取数<\/button>/);
assert.match(reportTaskHtml, />开始批量一键取数<\/button>/);
assert.match(reportTaskHtml, /人工完成验证后任务自动继续/);
assert.match(reportTaskHtml, /所选平台同时启动取数/);
assert.match(reportTaskHtml, /任一平台的普通失败只影响该平台/);
assert.match(reportTaskHtml, /id="juguangConcurrentTabs"[\s\S]*?单标签安全扫描（默认）/);
assert.match(reportTaskHtml, /value="2">2 标签并发（先自检）/);
assert.match(reportTaskHtml, /value="3">3 标签并发（先自检）/);

for (const id of [
  'refreshBtn', 'copyBtn', 'exportBtn', 'clearBtn',
  'hint', 'platformProgress', 'runProgressBar', 'taobaoMetricRows', 'xiaohongshuMetricRows',
  'taobaoMetricCount', 'xiaohongshuMetricCount', 'taobaoMetricsPanel', 'xiaohongshuMetricsPanel',
  'taobaoTableTab', 'xiaohongshuTableTab',
]) {
  assert.match(dataHtml, new RegExp('id="' + id + '"'));
}
assert.doesNotMatch(dataHtml, /autoCollectBtn|startAutoCollect/);
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
assert.doesNotMatch(projectPage, /request\('restoreStoreRun'/);
assert.match(projectPage, /['"]getStoreRun['"]/);
assert.match(projectPage, /let activeView = 'report'/);
assert.match(projectPage, /function runsForView/);
assert.match(projectPage, /value === 'report'\) return \['一键取数', true, true\]/);
assert.doesNotMatch(projectPage, /storeCollectLink/);
assert.match(projectPage, /projectRunSelect/);
assert.match(projectPage, /function exportActiveView/);
assert.match(projectPage, /function startBatchExport/);
assert.match(projectPage, /TaobaoReportExport/);
assert.match(projectPage, /createStoredZip/);
assert.match(projectPage, /function deleteStoreRun\(runId\)/);
assert.match(projectPage, /cloudSync\.deleteRun\(runId\)/);
assert.match(cloudProjectPage, /cloudSync\.deleteRun\(runId\)/);
assert.match(projectPage, /exportReportBtn/);
assert.match(projectPage, /exportBtn/);
assert.match(projectPage, /data-project-group/);
assert.match(projectPage, /'\/report-view\.html'/);
assert.match(projectPage, /'\/data\.html'/);
assert.match(projectPage, /'\?embed=1&archive='/);
assert.match(taskPage, /startProjectTask/);
assert.match(taskPage, /concurrentAccountTabs:\s*platforms\.includes\('juguang'\)/);
assert.match(cloudTaskPage, /concurrentAccountTabs:\s*platforms\.includes\('juguang'\)/);
assert.match(taskPage, /cancelProjectTask/);
assert.match(taskPage, /cancelCurrentTaskBtn/);
assert.match(taskPage, /status\.cancelled\s*\?\s*'\u5df2\u53d6\u6d88'/);
assert.match(taskPage, /cancelButton\.hidden\s*=\s*!\(active \|\| cancelling\)/);
assert.match(taskPage, /cancelButton\.disabled\s*=\s*!connected \|\| cancelling/);
assert.match(taskPage, /cancelButton\.textContent\s*=\s*cancelling\s*\?\s*'\u6b63\u5728\u53d6\u6d88'/);
assert.match(taskPage, /status\.waitingForVerification \|\| status\.paused/);
assert.match(taskPage, /const terminal = Boolean\(status && status\.running !== true/);
assert.match(taskPage, /status && status\.running === true && !terminal/);
assert.match(taskPage, /waitingForVerification\s*\?\s*'\u7b49\u5f85\u9a8c\u8bc1'/);
assert.match(taskPage, /status\.pauseReason \|\| status\.error \|\| status\.phase/);
assert.match(taskPage, /terminal\s*\?\s*\(status\.error \|\| status\.phase/);
assert.match(taskPage, /taskId:\s*status\.taskId/);
assert.match(taskPage, /function deleteStoreRun\(runId\)/);
assert.match(taskPage, /cloudSync\.deleteRun\(runId\)/);
assert.match(cloudTaskPage, /cloudSync\.deleteRun\(runId\)/);
assert.doesNotMatch(taskPage, /cancelProjectTask[\s\S]{0,240}confirmed\s*:/);
assert.match(taskPage, /startAccountBatchFromSession/);
assert.match(taskPage, /getAccountSessionSummary/);
assert.match(taskPage, /let selectedBatchAccountIds = new Set\(\)/);
assert.match(taskPage, /accountBatchMultiSelect/);
assert.match(taskPage, /let accountSession = \{[\s\S]*?accounts: \[\]/);
assert.match(taskPage, /accountSession\.schema < 2/);
assert.match(taskPage, /当前数据助手版本过旧/);
assert.match(taskPage, /账号明细同步不完整/);
assert.match(taskPage, /taobao-data-assistant\.zip/);
assert.match(taskPage, /accountIds: selectedBatchAccountIdList\(\)/);
assert.match(taskPage, /batchSelectionLocked/);
assert.match(taskPage, /input\.disabled = running \|\| paused/);
assert.doesNotMatch(taskPage, /activeMode === 'batch' \|\|/);
assert.doesNotMatch(taskPage, /TaobaoAccountVault\.decrypt|batchMasterPassword/);
assert.match(taskPage, /taobaoProjectTaskStatusV1/);
assert.match(taskPage, /const taskType = 'report'/);
assert.match(taskPage, /\/report-view\.html\?archive=/);
assert.doesNotMatch(taskPage, /taskType === 'report'\s*\?/);
assert.match(portalCss, /\.batch-account-list[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(portalCss, /\.batch-account-option:has\(input:focus-visible\)/);
assert.match(portalCss, /@media \(max-width: 460px\)[\s\S]*?\.task-actions \{[\s\S]*?flex-wrap: wrap/);
assert.doesNotMatch(dashboard, /requestWebBridge\('startAutoCollect'|BUSINESS_DEFENSE_AUTO_COLLECT/);
assert.match(dashboard, /taobaoContentDiagnosisReportStatusV1/);
assert.match(dashboard, /dataTableStatusFromReport/);
assert.match(dashboard, /requestWebBridge\('patchStoreRunManualInput'/);
assert.match(dashboard, /result\.partial \? 'partial'/);
assert.match(dashboard, /部分完成/);
assert.match(appCss, /\.platform-step\.partial/);
assert.match(background, /async function runProjectTask/);
assert.match(background, /PROJECT_TASK_START/);
assert.match(background, /concurrentAccountTabs:\s*source\.concurrentAccountTabs/);
assert.match(bridge, /concurrentAccountTabs:\s*platforms\.includes\('juguang'\)/);

for (const route of ['/data.html', '/report-view.html', '/portal.css', '/batch-report-export.js', '/project.js', '/task.js']) {
  assert.ok(server.includes("['" + route + "'"), 'missing server route ' + route);
}
assert.match(server, /url\.pathname === '\/collect\.html'[\s\S]*?writeHead\(307[\s\S]*?'Location': '\/report\.html' \+ url\.search/);

const bridgeContentScript = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.includes('web-tool-bridge.js')
));
assert.ok(bridgeContentScript);
assert.ok(bridgeContentScript.matches.includes('http://127.0.0.1:3400/*'));
assert.equal(bridgeContentScript.all_frames, true);
assert.match(server, /frame-ancestors 'self'/);
assert.equal(manifest.version, '2.37.34');

console.log('project and task page guards passed');
