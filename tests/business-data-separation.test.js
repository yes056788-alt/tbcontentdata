const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dataHtml = fs.readFileSync(path.join(root, 'web-tool', 'data.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const specSource = fs.readFileSync(path.join(root, 'diagnosis-spec.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

assert.match(dataHtml, /id="taobaoMetricRows"/);
assert.match(dataHtml, /id="xiaohongshuMetricRows"/);
assert.match(dataHtml, /淘宝经营数据/);
assert.match(dataHtml, /小红书经营数据/);
assert.match(dataHtml, /百分比可填写“30”或“30%”/);
assert.doesNotMatch(dataHtml, /id="summary"/);
assert.match(dataHtml, /id="taobaoTableTab"[^>]*aria-selected="true"/);
assert.match(dataHtml, /id="xiaohongshuTableTab"[^>]*aria-selected="false"/);
assert.match(dataHtml, /id="xiaohongshuMetricsPanel"[^>]*hidden/);
assert.match(dashboard, /let activePlatformTable = 'taobao'/);
assert.match(dashboard, /function renderPlatformTableSelection/);

const tableSelectionStart = dashboard.indexOf('function renderPlatformTableSelection');
const tableSelectionEnd = dashboard.indexOf('\n  function rowMarkup', tableSelectionStart);
assert.ok(tableSelectionStart >= 0 && tableSelectionEnd > tableSelectionStart);
const tablePanels = {
  taobaoMetricsPanel: { hidden: false },
  xiaohongshuMetricsPanel: { hidden: true },
};
const tableTabs = ['taobao', 'xiaohongshu'].map((platform) => {
  const attributes = { 'data-platform-table': platform };
  const classes = new Set(platform === 'taobao' ? ['active'] : []);
  return {
    tabIndex: platform === 'taobao' ? 0 : -1,
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    getAttribute: (name) => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    attributes,
    classes,
  };
});
const tableContext = vm.createContext({
  document: {
    getElementById: (id) => tablePanels[id] || null,
    querySelectorAll: () => tableTabs,
    querySelector: () => null,
  },
});
vm.runInContext(
  "let activePlatformTable = 'taobao';\n" +
  dashboard.slice(tableSelectionStart, tableSelectionEnd) + '\n' +
  'globalThis.renderSelection = renderPlatformTableSelection; globalThis.selectTable = selectPlatformTable;',
  tableContext
);
tableContext.renderSelection();
assert.equal(tablePanels.taobaoMetricsPanel.hidden, false);
assert.equal(tablePanels.xiaohongshuMetricsPanel.hidden, true);
tableContext.selectTable('xiaohongshu', false);
assert.equal(tablePanels.taobaoMetricsPanel.hidden, true);
assert.equal(tablePanels.xiaohongshuMetricsPanel.hidden, false);
assert.equal(tableTabs[0].attributes['aria-selected'], 'false');
assert.equal(tableTabs[1].attributes['aria-selected'], 'true');

const context = vm.createContext({ window: {} });
vm.runInContext(specSource, context, { filename: 'diagnosis-spec.js' });
const xiaohongshuMetrics = context.window.BusinessDefenseDiagnosisSpec.metrics
  .filter((metric) => metric.platform === '小红书');
const manualMetrics = xiaohongshuMetrics.filter((metric) => metric.collect === 'manual');
const formulaMetrics = xiaohongshuMetrics.filter((metric) => metric.collect === 'formula');

assert.equal(xiaohongshuMetrics.length, 23);
assert.equal(manualMetrics.length, 15);
assert.equal(formulaMetrics.length, 8);
for (const key of [
  'xhs_dmpVisitors',
  'xhs_contentAudienceAsset',
  'xhs_storeAudienceAsset',
  'xhs_l12Penetration',
  'xhs_l45Penetration',
]) {
  assert.ok(manualMetrics.some((metric) => metric.key === key), key + ' should be manual');
  assert.match(bridge, new RegExp("'" + key + "'"));
}

const bridgeManualStart = bridge.indexOf('const MANUAL_KEYS = new Set');
const bridgeManualEnd = bridge.indexOf('\n  const VERSION', bridgeManualStart);
assert.ok(bridgeManualStart >= 0 && bridgeManualEnd > bridgeManualStart);
const bridgeContext = vm.createContext({});
vm.runInContext(
  bridge.slice(bridgeManualStart, bridgeManualEnd) +
  '\nglobalThis.manualKeys = Array.from(MANUAL_KEYS);',
  bridgeContext
);
assert.deepEqual(
  Array.from(bridgeContext.manualKeys).sort(),
  Array.from(manualMetrics, (metric) => metric.key).sort()
);

const collectDmpStart = dashboard.indexOf('function collectDmp');
const collectDmpEnd = dashboard.indexOf('\n  function collectSycm', collectDmpStart);
assert.ok(collectDmpStart >= 0 && collectDmpEnd > collectDmpStart);
const collectDmp = dashboard.slice(collectDmpStart, collectDmpEnd);
assert.doesNotMatch(collectDmp, /xhs_/);

assert.match(dashboard, /if \(isManualMetric\(row\)\)/);
assert.match(dashboard, /requestWebBridge\('getStoreRun', \{ runId: ARCHIVE_RUN_ID \}\)/);
assert.match(dashboard, /patchStoreRunManualInput/);
assert.match(dashboard, /navigator\.locks\.request/);
assert.match(bridge, /'storeRunManualInputs'/);
assert.match(dashboard, /appendSheet\('淘天', '淘宝经营数据'\)/);
assert.match(dashboard, /appendSheet\('小红书', '小红书手填数据'\)/);
assert.match(dashboard, /async function copyTable\(\)[\s\S]*await flushManualInputs\(\)/);
assert.match(dashboard, /async function exportExcel\(\)[\s\S]*await flushManualInputs\(\)/);
assert.match(bridge, /businessDefenseManualInputsV1:[\s\S]*manualInputs/);
assert.match(background, /ACCOUNT_RUN_SNAPSHOT_KEYS = \[[\s\S]*businessDefenseManualInputsV1/);
assert.match(background, /runBusinessDefenseDmp\(\{ includeXiaohongshu: false \}\)/);

const asNumberStart = dashboard.indexOf('function asNumber');
const asNumberEnd = dashboard.indexOf('\n  function divide', asNumberStart);
const normalizeStart = dashboard.indexOf('function normalizeManualInput');
const normalizeEnd = dashboard.indexOf('\n  function bindManualInputs', normalizeStart);
assert.ok(asNumberStart >= 0 && asNumberEnd > asNumberStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
const inputContext = vm.createContext({});
vm.runInContext(
  'const PERCENT_MANUAL_KEYS = new Set(["xhs_l12Penetration"]);\n' +
  'const INTEGER_MANUAL_KEYS = new Set(["xhs_dmpVisitors"]);\n' +
  dashboard.slice(asNumberStart, asNumberEnd) + '\n' +
  dashboard.slice(normalizeStart, normalizeEnd) + '\n' +
  'globalThis.normalize = normalizeManualInput;',
  inputContext
);
assert.equal(inputContext.normalize('xhs_l12Penetration', '30'), '30%');
assert.equal(inputContext.normalize('xhs_l12Penetration', '30%'), '30%');
assert.equal(inputContext.normalize('xhs_l12Penetration', '30％'), '30%');
assert.equal(inputContext.normalize('xhs_l12Penetration', '0.3'), '30%');
assert.throws(() => inputContext.normalize('xhs_l12Penetration', '101'), /100%/);
assert.throws(() => inputContext.normalize('xhs_dmpVisitors', '30%'), /百分号/);
assert.throws(() => inputContext.normalize('xhs_dmpVisitors', '1.5'), /整数/);

const formulaHelpersStart = dashboard.indexOf('function asNumber');
const formulaHelpersEnd = dashboard.indexOf('\n  function normalizeText', formulaHelpersStart);
const collectManualStart = dashboard.indexOf('function collectManual');
const formulasEnd = dashboard.indexOf('\n  function formatValue', collectManualStart);
assert.ok(formulaHelpersStart >= 0 && formulaHelpersEnd > formulaHelpersStart);
assert.ok(collectManualStart >= 0 && formulasEnd > collectManualStart);
const formulaContext = vm.createContext({});
vm.runInContext(
  'const MANUAL_KEYS = new Set(' + JSON.stringify(Array.from(manualMetrics, (metric) => metric.key)) + ');\n' +
  'const PERCENT_MANUAL_KEYS = new Set(["xhs_reportedNoteShare", "xhs_unreportedNoteShare", "xhs_l12Penetration", "xhs_l45Penetration"]);\n' +
  'const INTEGER_MANUAL_KEYS = new Set(["xhs_xingheVisitors", "xhs_dmpVisitors", "xhs_noteCount", "xhs_contentAudienceAsset", "xhs_storeAudienceAsset"]);\n' +
  dashboard.slice(formulaHelpersStart, formulaHelpersEnd) + '\n' +
  dashboard.slice(normalizeStart, normalizeEnd) + '\n' +
  dashboard.slice(collectManualStart, formulasEnd) + '\n' +
  'globalThis.collect = collectManual; globalThis.compute = computeFormulas;',
  formulaContext
);
const values = {};
formulaContext.collect(values, {
  xhs_kolSpend: '100',
  xhs_juguangSpend: '300',
  xhs_xingheVisitors: '100',
  xhs_dmpVisitors: '50',
  xhs_storeGmv: '800',
  xhs_taskGmv: '400',
  xhs_contentAudienceAsset: '300',
  xhs_storeAudienceAsset: '600',
  xhs_l12Penetration: '20',
  xhs_l45Penetration: '0.4',
});
formulaContext.compute(values);
assert.equal(values.xhs_totalSpend.value, 400);
assert.equal(values.xhs_kfsRatio.value, '100:300');
assert.equal(values.xhs_visitFrequency.value, 2);
assert.equal(values.xhs_visitCost.value, 4);
assert.equal(values.xhs_storeRoi.value, 2);
assert.equal(values.xhs_taskRoi.value, 1);
assert.equal(values.xhs_contentAudienceShare.value, 0.5);
assert.equal(values.xhs_l45OverL12.value, 2);

console.log('business data separation guards passed');
