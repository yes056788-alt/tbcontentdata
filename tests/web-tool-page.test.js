const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
assert.doesNotMatch(projectHtml, /id="projectClassification(?:Tab|Panel)"|data-project-view="classification"/);
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
    'pgyClassificationSetup', 'pgyClassificationTemplate',
    'pgyClassificationCustomIndustry', 'pgyClassificationOwnBrandTerms',
    'pgyClassificationOwnProductTerms', 'pgyClassificationCompetitorTerms',
    'pgyClassificationRevisionMeta', 'pgyRulesTitle',
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
for (const template of ['auto', 'pet', 'furniture', 'supplement', 'custom']) {
  assert.match(reportTaskHtml, new RegExp('<option value="' + template + '"'));
}
assert.match(reportTaskHtml, /id="pgyClassificationSetup"[^>]*data-platform-config="pgy"/);
assert.match(reportTaskHtml, /蒲公英搜索词分类设置/);
assert.match(reportTaskHtml, /只影响蒲公英搜索来源词/);
assert.match(reportTaskHtml, /希宝同款分类方式/);
assert.match(reportTaskHtml, /不调用大模型/);
assert.match(reportTaskHtml, /自有品牌词 → 竞品词 → 自有产品词/);
assert.doesNotMatch(reportTaskHtml, /API Key|qwenApiKeyInput|固定模型/);
const currentPickerStart = reportTaskHtml.indexOf('data-platform-picker="current"');
const batchPickerStart = reportTaskHtml.indexOf('data-platform-picker="batch"');
assert.ok(currentPickerStart >= 0 && batchPickerStart > currentPickerStart);
assert.equal((reportTaskHtml.slice(currentPickerStart, batchPickerStart)
  .match(/data-platform-config="pgy"/g) || []).length, 1);
assert.equal((reportTaskHtml.slice(batchPickerStart)
  .match(/data-platform-config="pgy"/g) || []).length, 0);
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
assert.doesNotMatch(projectPage, /classificationForm|CLASSIFICATION_PROFILE_IDS|saveClassificationConfig/);
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
assert.match(taskPage, /persistPgyClassificationBeforeStart/);
assert.match(taskPage, /await persistPgyClassificationBeforeStart\(store, platforms\)/);
assert.match(taskPage, /request\('setProjectDirectory', \{ directory: nextDirectory \}, 45000\)/);
assert.match(taskPage, /semantic:\s*\{ enabled: false \}/);
assert.doesNotMatch(taskPage, /qwenApiKeyInput|qwenApiSettingsBusy|\/api\/qwen-settings/);
assert.match(taskPage, /let pgyClassificationDraftsByStore = new Map\(\)/);
assert.match(taskPage, /function rememberPgyClassificationDraft\(\)/);
assert.match(taskPage, /let currentTaskStarting = false/);
assert.doesNotMatch(server, /qwen-settings|openai-settings|search-keyword-classifications/);
assert.match(taskPage, /startButton\.disabled\s*=\s*[\s\S]{0,180}currentTaskStarting/);
const renderSelectorsSource = taskPage.slice(
  taskPage.indexOf('  function renderSelectors() {'),
  taskPage.indexOf('\n  function renderStoreOptions()', taskPage.indexOf('  function renderSelectors() {')),
);
assert.doesNotMatch(renderSelectorsSource, /new URLSearchParams\(location\.search\)/,
  'the initial store query must not be reapplied on every refresh');
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
assert.match(taskPage, /status\.waitingForLogin\s*\?\s*'\u7b49\u5f85\u767b\u5f55'\s*:\s*'\u7b49\u5f85\u9a8c\u8bc1'/);
assert.match(cloudTaskPage, /status\.waitingForLogin\s*\?\s*'\u7b49\u5f85\u767b\u5f55'\s*:\s*'\u7b49\u5f85\u9a8c\u8bc1'/);
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
assert.match(portalCss, /\.classification-layout/);
assert.match(portalCss, /\.classification-term-grid/);
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
assert.equal(manifest.version, '2.37.52');

const classificationStart = taskPage.indexOf('const CLASSIFICATION_PROFILE_IDS');
const classificationEnd = taskPage.indexOf('\n  function selectedPlatforms', classificationStart);
assert.ok(classificationStart >= 0 && classificationEnd > classificationStart,
  'task page should expose a bounded pure classification config builder');
const classificationContext = vm.createContext({
  Array,
  Date,
  Math,
  Number,
  Object,
  Set,
  String,
});
vm.runInContext(
  'function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }\n' +
  taskPage.slice(classificationStart, classificationEnd) + '\n' +
  'globalThis.buildConfig = buildStoreClassification; globalThis.parseTerms = parseClassificationTerms;',
  classificationContext,
  { filename: 'task-classification-config.js' },
);

const savedFurnitureConfig = classificationContext.buildConfig({
  schema: 1,
  profileId: 'auto',
  customIndustry: '',
  ownBrandTerms: ['旧品牌'],
  ownProductTerms: [],
  competitorTerms: [],
  manualOverrides: [{
    id: 'manual-1', scopeKey: 'store-1', keyword: '顾家床垫', active: true,
    reason: '人工确认', patch: { entityRelation: 'own_brand' }, updatedAt: 1,
  }],
  revision: 3,
  updatedAt: 1,
  secret: 'must-drop',
}, {
  template: 'furniture',
  customIndustry: '',
  ownBrandTerms: ' 顾家\n顾家，顾家家居 ',
  ownProductTerms: '护腰床垫；深睡床垫 M1',
  competitorTerms: '慕思, 喜临门',
}, 1788048000000);
assert.deepEqual(JSON.parse(JSON.stringify(savedFurnitureConfig)), {
  schema: 1,
  profileId: 'home-furnishing-v1',
  customIndustry: '',
  ownBrandTerms: ['顾家', '顾家家居'],
  ownProductTerms: ['护腰床垫', '深睡床垫 M1'],
  competitorTerms: ['慕思', '喜临门'],
  semantic: { enabled: false },
  manualOverrides: [{
    id: 'manual-1', scopeKey: 'store-1', keyword: '顾家床垫', active: true,
    reason: '人工确认', patch: { entityRelation: 'own_brand' }, updatedAt: 1,
  }],
  revision: 4,
  updatedAt: 1788048000000,
});

const savedCustomConfig = classificationContext.buildConfig({}, {
  template: 'custom',
  customIndustry: ' 户外装备 ',
  ownBrandTerms: '',
  ownProductTerms: '',
  competitorTerms: '',
}, 1788048001000);
assert.equal(savedCustomConfig.profileId, 'cross-industry-generic-v1');
assert.equal(savedCustomConfig.customIndustry, '户外装备');
assert.equal(savedCustomConfig.revision, 1);
assert.equal(savedCustomConfig.updatedAt, 1788048001000);

const cappedTerms = classificationContext.parseTerms(
  Array.from({ length: 205 }, (_, index) => '词' + index).join('\n'),
);
assert.equal(cappedTerms.length, 200);

function verifyClassificationDraftsSurviveStoreSwitches() {
  const formStart = taskPage.indexOf('  function syncPgyClassificationTemplateFields() {');
  const formEnd = taskPage.indexOf('\n  async function persistPgyClassificationBeforeStart', formStart);
  assert.ok(formStart >= 0 && formEnd > formStart, 'classification form helpers should remain extractable');
  const fields = {
    '#pgyClassificationTemplate': { value: 'auto' },
    '#pgyClassificationCustomIndustryField': { hidden: true },
    '#pgyClassificationCustomIndustry': { value: '', required: false },
    '#pgyClassificationTemplateHint': { textContent: '' },
    '#pgyClassificationOwnBrandTerms': { value: '' },
    '#pgyClassificationOwnProductTerms': { value: '' },
    '#pgyClassificationCompetitorTerms': { value: '' },
    '#pgyClassificationRevisionMeta': { textContent: '' },
  };
  const context = vm.createContext({ Array, Date, Map, Math, Number, Object, Set, String });
  vm.runInContext(
    'function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }\n' +
    taskPage.slice(classificationStart, classificationEnd) + '\n' +
    `let pgyClassificationFormStoreId = '';
let pgyClassificationFormDirty = false;
let pgyClassificationDraftsByStore = new Map();
function $(selector) { return fields[selector] || null; }
function formatDate() { return '-'; }
` + taskPage.slice(formStart, formEnd) + `
const storeA = { id: 'store-a', classification: { schema: 1, profileId: 'auto', ownBrandTerms: ['已保存 A'] } };
const storeB = { id: 'store-b', classification: { schema: 1, profileId: 'auto', ownBrandTerms: ['已保存 B'] } };
renderPgyClassificationForm(storeA, true);
fields['#pgyClassificationOwnBrandTerms'].value = '草稿 A';
rememberPgyClassificationDraft();
renderPgyClassificationForm(storeB, true);
fields['#pgyClassificationOwnBrandTerms'].value = '草稿 B';
rememberPgyClassificationDraft();
renderPgyClassificationForm(storeA, true);
globalThis.result = {
  restoredA: fields['#pgyClassificationOwnBrandTerms'].value,
  draftNotice: fields['#pgyClassificationRevisionMeta'].textContent,
};
renderPgyClassificationForm(null, true);
globalThis.result.cleared = fields['#pgyClassificationOwnBrandTerms'].value;
renderPgyClassificationForm(storeB, true);
globalThis.result.restoredB = fields['#pgyClassificationOwnBrandTerms'].value;
`,
    Object.assign(context, { fields }),
    { filename: 'task-classification-drafts.js' },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    restoredA: '草稿 A',
    draftNotice: '有未保存草稿，将在该店铺取数启动前保存',
    cleared: '',
    restoredB: '草稿 B',
  });
}

verifyClassificationDraftsSurviveStoreSwitches();

async function verifyClassificationSaveFlow() {
  const saveStart = taskPage.indexOf('async function persistPgyClassificationBeforeStart');
  const saveEnd = taskPage.indexOf('\n  function statusInfo', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'preflight classification save handler');
  const fixedNow = 1788048002000;
  const harness = vm.createContext({
    Array,
    Date: class FixedDate extends Date { static now() { return fixedNow; } },
    Math,
    Number,
    Object,
    Set,
    String,
  });
  vm.runInContext(
    'function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }\n' +
    taskPage.slice(classificationStart, classificationEnd) + '\n' +
    `let pgyClassificationSaving = false;
let pgyClassificationFormStoreId = 'store-1';
let pgyClassificationFormDirty = true;
let pgyClassificationDraftsByStore = new Map();
let selectedStoreId = 'store-1';
let directory = {
  schema: 1,
  storeGroups: [{ id: 'group-1', name: '默认组' }],
  stores: [{
    id: 'store-1', name: '家具店', groupId: 'group-1',
    classification: {
      schema: 1, profileId: 'auto', customIndustry: '',
      ownBrandTerms: [], ownProductTerms: [], competitorTerms: [],
      manualOverrides: [{ id: 'manual-1', keyword: '顾家床垫', patch: { entityRelation: 'own_brand' } }],
      revision: 7, updatedAt: 1,
    },
  }],
  updatedAt: 1,
};
const captured = [];
const notices = [];
let activeDraft = {
  template: 'supplement', customIndustry: '', ownBrandTerms: '品牌 A',
  ownProductTerms: '鱼油', competitorTerms: '竞品 B',
};
function $(selector) { return { focus() {} }; }
function storeById(id) { return directory.stores.find((store) => store.id === id) || null; }
function pgyClassificationDraft() {
  return activeDraft;
}
function request(action, payload, timeoutMs) { captured.push({ action, payload, timeoutMs }); return Promise.resolve({ saved: true }); }
function renderPgyClassificationForm() {}
function renderPgyClassificationSetup() {}
function setNotice(message, tone) { notices.push({ message, tone }); }
` + taskPage.slice(saveStart, saveEnd) + `
globalThis.saveConfig = () => persistPgyClassificationBeforeStart(storeById('store-1'), ['pgy']);
globalThis.skipConfig = () => persistPgyClassificationBeforeStart(storeById('store-1'), ['sycm']);
globalThis.state = {
  captured, notices,
  setDraft(value) { activeDraft = value; },
  get directory() { return directory; },
};`,
    harness,
    { filename: 'task-classification-save.js' },
  );

  await harness.saveConfig();
  const state = harness.state;
  assert.equal(state.captured.length, 1);
  assert.equal(state.captured[0].action, 'setProjectDirectory');
  assert.equal(state.captured[0].timeoutMs, 45000);
  const saved = JSON.parse(JSON.stringify(state.captured[0].payload.directory));
  assert.equal(saved.stores[0].classification.profileId, 'health-supplements-v1');
  assert.equal(saved.stores[0].classification.revision, 8);
  assert.equal(saved.stores[0].classification.updatedAt, fixedNow);
  assert.deepEqual(saved.stores[0].classification.manualOverrides, [
    { id: 'manual-1', keyword: '顾家床垫', patch: { entityRelation: 'own_brand' } },
  ]);
  assert.equal(state.directory.updatedAt, fixedNow);
  assert.equal(state.notices[0].tone, 'success');

  await harness.saveConfig();
  assert.equal(state.captured.length, 1, 'unchanged configuration must not increment the revision');
  await harness.skipConfig();
  assert.equal(state.captured.length, 1, 'non-PGY collection must not persist classification');
  state.setDraft({
    template: 'custom', customIndustry: '   ', ownBrandTerms: '',
    ownProductTerms: '', competitorTerms: '',
  });
  await assert.rejects(() => harness.saveConfig(), /请填写行业名称/);
  assert.equal(state.captured.length, 1, 'invalid custom industry must not be saved');
}

async function verifyClassificationPrecedesCollection() {
  const start = taskPage.indexOf('  async function startCurrentTask() {');
  const end = taskPage.indexOf('\n  async function cancelCurrentTask()', start);
  assert.ok(start >= 0 && end > start, 'startCurrentTask should remain extractable');
  const source = taskPage.slice(start, end);

  function createHarness(saveFails, deferSave) {
    const actions = [];
    let releaseSave = () => {};
    const saveGate = deferSave ? new Promise((resolve) => { releaseSave = resolve; }) : Promise.resolve();
    const controls = {
      '#xhsDateFrom': { value: '2030-01-01' },
      '#xhsDateTo': { value: '2030-01-31' },
      '#juguangConcurrentTabs': { value: '' },
    };
    const context = vm.createContext({
      taskType: 'report',
      selectedStoreId: 'store-1',
      connected: true,
      accountSession: { unlocked: true },
      taskStatus: null,
      currentTaskStarting: false,
      storeById() { return { id: 'store-1', name: '蒲公英店铺', groupId: 'group-1' }; },
      selectedPlatforms() { return ['pgy']; },
      selectedCredentialMode() { return 'currentSession'; },
      validatePlatformCapabilities() {},
      groupName() { return '默认组'; },
      $(selector) { return controls[selector]; },
      window: { confirm() { return true; } },
      renderStatus() {},
      setNotice() {},
      setTimeout() {},
      refresh() {},
      async request(action, payload, timeoutMs) {
        actions.push({ action, payload, timeoutMs });
        if (action === 'setProjectDirectory' && saveFails) throw new Error('分类配置保存失败');
        if (action === 'setProjectDirectory') await saveGate;
        return { ok: true };
      },
      async persistPgyClassificationBeforeStart(store) {
        return context.request('setProjectDirectory', { directory: { stores: [store] } }, 45000);
      },
    });
    vm.runInContext(source + '\nglobalThis.runStartCurrentTask = startCurrentTask;', context,
      { filename: 'task-start-current-classification.js' });
    return { actions, context, releaseSave };
  }

  const success = createHarness(false);
  await success.context.runStartCurrentTask();
  assert.deepEqual(success.actions.map((entry) => entry.action), [
    'setProjectDirectory', 'startProjectTask',
  ]);

  const failed = createHarness(true);
  await assert.rejects(() => failed.context.runStartCurrentTask(), /分类配置保存失败/);
  assert.deepEqual(failed.actions.map((entry) => entry.action), ['setProjectDirectory']);
  assert.equal(failed.context.taskStatus, null);

  const slow = createHarness(false, true);
  const firstStart = slow.context.runStartCurrentTask();
  const duplicateStart = slow.context.runStartCurrentTask();
  await Promise.resolve();
  assert.equal(slow.actions.filter((entry) => entry.action === 'setProjectDirectory').length, 1,
    'a slow preflight save must latch the whole current-task start flow');
  slow.releaseSave();
  await Promise.all([firstStart, duplicateStart]);
  assert.equal(slow.actions.filter((entry) => entry.action === 'startProjectTask').length, 1,
    'double-clicking start must submit only one collection task');
}

Promise.all([verifyClassificationSaveFlow(), verifyClassificationPrecedesCollection()]).then(() => {
  console.log('project and task page guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
