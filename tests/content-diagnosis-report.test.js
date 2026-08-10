const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const taskHtml = fs.readFileSync(path.join(root, 'web-tool', 'report.html'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web-tool', 'report-view.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web-tool', 'report.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'web-tool', 'report.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'web-tool', 'server.mjs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const wxt = fs.readFileSync(path.join(root, 'wxt-report-content.js'), 'utf8');

assert.match(taskHtml, /<h2>报告取数设置<\/h2>/);
assert.match(taskHtml, /data-task-mode="current"/);
assert.match(taskHtml, /data-task-mode="batch"/);
assert.doesNotMatch(taskHtml, /id="flowSection"|id="reportSteps"/);

for (const id of [
  'generateReportBtn', 'refreshReportBtn', 'exportReportBtn', 'clearReportBtn',
  'reportProgressBar', 'reportSteps', 'reportIndex', 'emptyReport', 'flowSection',
  'guangheSection', 'wxtSection', 'shortVideoSection', 'dmpSection', 'dmpReport',
  'flowContext', 'flowReport', 'guangheContext', 'guangheReport',
  'wxtMarketingMount', 'wxtShortVideoMount', 'dmpContext',
]) {
  assert.match(html, new RegExp('id="' + id + '"'));
}

assert.match(html, /id="generateReportBtn"[^>]*hidden/);
assert.match(html, /data-guanghe-view="channel"/);
assert.match(html, /data-guanghe-view="asset"/);
assert.match(html, /href="\/report\.html"/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /\.report-steps[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
assert.match(css, /\.dmp-data-cell/);
assert.match(css, /\.report-step\.partial/);
assert.match(server, /'\/report-view\.html'/);
assert.match(server, /'\/report\.js'/);
assert.match(server, /\['\/report-view\.html', '\/data\.html'\]\.includes\(url\.pathname\)/);
assert.match(server, /style-src 'self' 'unsafe-inline'/);

assert.match(page, /startContentDiagnosisReport/);
assert.match(page, /taobaoContentDiagnosisReportStatusV1/);
assert.match(page, /taobaoContentDiagnosisWxtReportV1/);
assert.match(page, /buildGuangheMarkup\('channel', true\)/);
assert.match(page, /buildGuangheMarkup\('asset', true\)/);
assert.match(page, /<th colspan="3">内容查看人数<\/th>/);
assert.match(page, /<th colspan="2">商品点击人数<\/th>/);
assert.match(page, /<th colspan="2">商品加购人数<\/th>/);
assert.match(page, /<th colspan="2">种草成交人数<\/th>/);
assert.match(page, /<th colspan="3">价值<\/th>/);
assert.match(page, /内容指标来自光合/);
assert.match(page, /function buildDmpMarkup\(\)/);
assert.match(page, /消费能力等级/);
assert.match(page, /result\.partial \? 'partial'/);
assert.match(page, /部分完成/);
assert.match(page, /部分章节数据不完整/);
assert.match(page, /五章节合并导出/);
assert.match(page, /function exportReport\(\)/);
assert.match(page, /max-width:1120px/);
assert.match(page, /function normalizeWxtMarketingMarkup\(markup\)/);
assert.match(page, /function normalizeWxtShortVideoMarkup\(markup\)/);
assert.match(page, /WXT_CHART_LAYOUT_OVERRIDES/);
assert.match(page, /WXT_TABLE_LAYOUT_OVERRIDES/);
assert.match(page, /GUANGHE_EXPORT_STYLES/);
assert.match(page, /\['光合曝光点击率', '3%'\]/);
assert.match(page, /function guangheIsHighest\(row, peerRows, getter\)/);
assert.match(page, /class="guanghe-best"/);
assert.match(css, /\.guanghe-best-tag/);
assert.match(css, /background: #315fbd/);
assert.doesNotMatch(html, /<h2>万相台营销报告<\/h2>/);
assert.doesNotMatch(html, /<h2>短视频诊断<\/h2>/);
assert.match(page, /DMP_CROWDS/);
const flowMarkup = page.match(/function buildFlowMarkup\(\) \{([\s\S]*?)\n  \}\n\n  function findGuangheRow/);
assert.ok(flowMarkup, 'expected flow report renderer');
assert.doesNotMatch(flowMarkup[1], /diagnosis-kpis/);

assert.match(bridge, /startContentDiagnosisReport/);
assert.match(bridge, /BUSINESS_DEFENSE_GENERATE_CONTENT_REPORT/);
assert.match(bridge, /projectTasks/);
assert.match(background, /runBusinessDefenseGuanghe\(\{ metricsOnly: false \}\)/);
assert.match(background, /CONTENT_DIAGNOSIS_WXT_SHORT_URL/);
assert.match(background, /WXT_GENERATE_MARKETING_REPORT_SNAPSHOT/);
assert.match(background, /WXT_GENERATE_SHORT_VIDEO_REPORT_SNAPSHOT/);
assert.match(background, /key: 'dmp'/);
assert.match(background, /requestedTags: \['年龄', '消费能力等级'\]/);
const guangheSyncStart = background.indexOf("if (!message || message.type !== 'WXT_SYNC_GUANGHE_CONTENT') return;");
assert.ok(guangheSyncStart >= 0, 'expected Guanghe sync listener');
const guangheSyncBlock = background.slice(guangheSyncStart);
assert.match(guangheSyncBlock, /active: false/);
assert.doesNotMatch(guangheSyncBlock, /active: true/);
assert.match(wxt, /markup: reportMarkup\(data\)/);
assert.match(wxt, /markup: shortVideoDiagnosisMarkup\(data\)/);
assert.match(wxt, /function overallDiagnosisMarkup/);
assert.match(wxt, /光合免费流量 \+ 万相台付费效果/);
assert.match(wxt, /function buildShortVideoDiagnosticModel/);
assert.match(wxt, /核心诊断/);
assert.match(wxt, /数据证据/);
assert.match(wxt, /可能原因/);
assert.match(wxt, /综合置信度/);
assert.match(wxt, /账户级付费诊断/);
assert.match(wxt, /ROI 达标计划/);
assert.match(wxt, /ROI 达标作品/);
assert.match(wxt, /function roiBenchmarkStats/);
assert.match(wxt, /function paidMetricRoi/);
assert.match(wxt, /ratio\(source\.alipayInshopAmt, source\.charge\)/);
assert.match(wxt, /达标线参考账户整体 ROI/);
assert.match(wxt, /账户内相对标准，不等同于利润达标/);
assert.match(wxt, /光合五率使用固定参考值/);
assert.match(wxt, /本账号同期同层级中位数/);
assert.match(wxt, /作品ID ' \+ textOrDash\(item\.id\)/);
assert.match(wxt, /商品ID ' \+ textOrDash\(item\.id\)/);
assert.doesNotMatch(wxt, /textOrDash\(item\.name \|\| item\.id\)/);
assert.doesNotMatch(wxt, /textOrDash\(item\.productName \|\| item\.id\)/);
assert.match(wxt, /function paidSampleConfidence/);
assert.match(wxt, /样本置信度/);
assert.match(wxt, /const DIAGNOSIS_MIN_SPEND = 200/);
assert.match(wxt, /function meetsDiagnosisSpend/);
assert.match(wxt, /诊断样本门槛为累计花费/);
assert.match(wxt, /账户级汇总使用全量数据/);
assert.match(wxt, /样本不足，暂不诊断/);
assert.match(wxt, /max-width: 1280px/);
assert.match(wxt, /一级场景花费构成/);
assert.match(wxt, /二级场景花费汇总/);
assert.match(wxt, /grid-template-columns: minmax\(120px, 148px\) minmax\(0, 1fr\)/);
assert.match(wxt, /function guangheGoalHeader\(label, key\)/);
assert.match(wxt, /wxt-goal-reference/);
assert.match(wxt, /\.wxt-linked-table th:nth-child\(2\), \.wxt-linked-table td:nth-child\(2\)/);
assert.match(wxt, /left: 118px/);
const diagnosisContent = wxt.match(/function shortVideoDiagnosisContent\(data, attributionKey, attributionName\) \{([\s\S]*?)\n  \}\n\n  function requestWarningsMarkup/);
assert.ok(diagnosisContent, 'expected short-video diagnosis renderer');
const diagnosisOrder = [
  'actionListMarkup(data, diagnosis, attributionKey)',
  'deliveryDiagnosisMarkup(diagnosis)',
  "diagnosisTableMarkup('计划诊断'",
  "paidSummaryTableMarkup(data, attributionKey, 'product')",
  "paidSummaryTableMarkup(data, attributionKey, 'video')",
].map((marker) => diagnosisContent[1].indexOf(marker));
assert.ok(diagnosisOrder.every((index) => index >= 0), 'expected all short-video diagnosis sections');
assert.deepEqual(diagnosisOrder.slice().sort((left, right) => left - right), diagnosisOrder);

console.log('content diagnosis task and viewer guards passed');
