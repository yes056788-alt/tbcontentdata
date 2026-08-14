const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const projectSource = fs.readFileSync(path.join(root, 'web-tool', 'project.js'), 'utf8');
const dataTableSource = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');

function evaluateFunctionSlice(source, startMarker, endMarker, exportsSource) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, startMarker);
  const context = vm.createContext({ Array, Boolean, Object, Set, String });
  vm.runInContext(source.slice(start, end) + exportsSource, context);
  return context;
}

const projectContext = evaluateFunctionSlice(
  projectSource,
  'function taskTypeInfo',
  '\n  function projectGroups',
  '\nglobalThis.taskTypeInfo = taskTypeInfo;',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(projectContext.taskTypeInfo('report'))),
  ['一键取数', true, true],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(projectContext.taskTypeInfo('collect'))),
  ['历史经营取数', true, false],
);

const statusContext = evaluateFunctionSlice(
  dataTableSource,
  'function hasTaskStatus',
  '\n  async function loadRows',
  '\nglobalThis.dataTableStatusFromReport = dataTableStatusFromReport;',
);
const mapped = JSON.parse(JSON.stringify(statusContext.dataTableStatusFromReport({
  running: false,
  finishedAt: 100,
  results: [
    { key: 'sycm', name: '生意参谋流量诊断', ok: true },
    { key: 'guanghe', name: '光合渠道与资产诊断', ok: true },
    { key: 'wxtMarketing', name: '万相台营销场景报告', ok: true },
    { key: 'wxtShortVideo', name: '万相台短视频诊断', ok: true },
    { key: 'dmp', name: '内容人群画像诊断', ok: true },
  ],
})));
assert.equal(mapped.total, 4);
assert.deepEqual(mapped.results.map((item) => item.name), [
  '光合内容指标',
  '生意参谋流量指标',
  '万相台内容投放',
  'DMP人群资产画像',
]);
assert.ok(mapped.results.every((item) => item.ok && !item.partial));

const projectTaskStart = backgroundSource.indexOf('async function runProjectTask');
const projectTaskEnd = backgroundSource.indexOf('\nfunction ensureBusinessDefenseAutoCollectTask', projectTaskStart);
const projectTaskSource = backgroundSource.slice(projectTaskStart, projectTaskEnd);
assert.match(projectTaskSource, /const taskType = 'report'/);
assert.match(projectTaskSource, /ensureContentDiagnosisReportTask\(\{[\s\S]*platforms,[\s\S]*dateRange,[\s\S]*storeId/);
assert.doesNotMatch(projectTaskSource, /ensureBusinessDefenseAutoCollectTask/);
for (const snapshotKey of [
  'businessDefenseSycmTrafficSnapshotV1',
  'gh_channel_snapshot',
  'wxtBusinessDefenseReportV1',
  'dmpPortraitSnapshotV1',
  'taobaoContentDiagnosisReportV1',
]) {
  assert.match(backgroundSource, new RegExp("'" + snapshotKey + "'"));
}

assert.match(bridgeSource, /function sanitizeSessionBatchRequest[\s\S]*?taskType: 'report'/);
assert.match(bridgeSource, /accountBatchMultiSelect/);
assert.match(bridgeSource, /function sanitizeSessionBatchRequest[\s\S]*?const accountIds = Array\.from\(new Set/);
assert.match(bridgeSource, /function sanitizeProjectTask[\s\S]*?taskType: 'report'/);
assert.doesNotMatch(bridgeSource, /TEAM_WORKBENCH_PATHS[\s\S]*?'\/collect\.html'/);
assert.doesNotMatch(bridgeSource, /startAutoCollect|startContentDiagnosisReport/);
assert.match(bridgeSource, /function requireOneClickTaskPage[\s\S]*?location\.pathname !== '\/report\.html'/);
assert.doesNotMatch(dataTableSource, /autoCollectBtn|BUSINESS_DEFENSE_AUTO_COLLECT|startAutoCollect/);
assert.match(backgroundSource, /const taskType = 'report'/);
assert.match(backgroundSource, /function isOneClickWebToolSender[\s\S]*?url\.pathname === '\/report\.html'/);
assert.match(backgroundSource, /独立取数入口已停用/);
assert.match(backgroundSource, /淘宝经营数据助手 · 请从团队网页“一键取数”发起任务/);
assert.doesNotMatch(backgroundSource, /请在生意参谋流量页使用/);
const retiredListenerStart = backgroundSource.indexOf("'BUSINESS_DEFENSE_AUTO_COLLECT',", projectTaskStart);
const retiredListenerEnd = backgroundSource.indexOf("const allowedTypes = [", retiredListenerStart);
assert.ok(retiredListenerStart >= 0 && retiredListenerEnd > retiredListenerStart);
const retiredListenerSource = backgroundSource.slice(retiredListenerStart, retiredListenerEnd);
assert.match(retiredListenerSource, /ok: false/);
assert.doesNotMatch(retiredListenerSource, /ensureBusinessDefenseAutoCollectTask|ensureContentDiagnosisReportTask/);

console.log('unified one-click collection guards passed');
