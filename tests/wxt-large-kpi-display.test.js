const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'wxt-report-content.js'), 'utf8');
const reportPage = fs.readFileSync(path.join(root, 'web-tool', 'report.js'), 'utf8');

const markupStart = content.indexOf('  function reportMarkup(data)');
const markupEnd = content.indexOf('\n  function reportStyles()', markupStart);
assert.ok(markupStart >= 0 && markupEnd > markupStart);

const context = vm.createContext({
  formatMoney(value) {
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },
  formatInteger(value) { return Number(value).toLocaleString('en-US'); },
  formatDecimal(value) { return Number(value).toFixed(2); },
  escapeHtml(value) { return String(value); },
  pieChartMarkup() { return ''; },
  spendChartEntries() { return []; },
  marketingChartEntries() { return []; },
  detailTableMarkup() { return ''; },
});
vm.runInContext(
  content.slice(markupStart, markupEnd) + '\nglobalThis.renderReportMarkup = reportMarkup;',
  context,
  { filename: 'wxt-report-markup.js' }
);

const markup = context.renderReportMarkup({
  startTime: '2026-07-09',
  endTime: '2026-08-07',
  spendSummary: { totalCharge: 1212442.13 },
  marketingTotal: {
    adPv: 26829054,
    click: 1534264,
    alipayInshopNum: 128167,
    roi: 7.74,
  },
});

assert.match(markup, /<strong title="¥1,212,442\.13">¥1,212,442\.13<\/strong>/);
assert.match(content, /\.wxt-kpi-strip > div \{[\s\S]*?container-type: inline-size;/);
assert.match(content, /\.wxt-kpi-strip strong \{[\s\S]*?font-size: clamp\(16px, 10\.5cqw, 22px\);/);
assert.match(content, /\.wxt-kpi-strip strong \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?text-overflow: clip;/);
assert.doesNotMatch(content, /\.wxt-kpi-strip strong \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);

assert.match(reportPage, /const WXT_KPI_LAYOUT_OVERRIDES =/);
assert.match(reportPage, /\.wxt-kpi-strip strong\{min-width:0!important;overflow:visible!important/);
assert.match(reportPage, /white-space:normal!important;overflow-wrap:anywhere!important;text-overflow:clip!important/);
assert.equal(
  (reportPage.match(/WXT_KPI_LAYOUT_OVERRIDES \+/g) || []).length,
  2,
  'embedded view and exported report must both override legacy archived KPI ellipsis styles'
);

console.log('wxt large KPI display guards passed');
