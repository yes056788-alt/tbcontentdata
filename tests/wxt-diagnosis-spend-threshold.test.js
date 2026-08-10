const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let source = fs.readFileSync(path.join(root, 'wxt-report-content.js'), 'utf8');
source = source.replace(
  "  ensureButton();\n  window.addEventListener('hashchange', ensureButton);",
  '  window.__diagnosisTest = { shortVideoDiagnosisMarkup };',
);

const testWindow = {
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  postMessage() {},
};
const context = {
  location: { hostname: 'one.alimama.com', hash: '' },
  window: testWindow,
  document: {},
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      getManifest: () => ({ version: '2.36.4' }),
      sendMessage() {},
    },
    storage: { local: { get() {}, set() {} } },
  },
  XLSX: {},
  console,
  setTimeout,
  clearTimeout,
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
  Blob: function Blob() {},
};

vm.runInNewContext(source, context);
assert.ok(testWindow.__diagnosisTest, 'expected diagnosis renderer test hook');

const organic = {
  organicExpoPv: 10000,
  organicConsumePv: 5000,
  organicClickPv: 400,
  organicValidConsumePv: 2500,
  organicDwellTime: 35000,
  organicBigClick: 300,
  organicSmallClick: 80,
  organicSeedAmount: 3000,
  organicSeedOrderCount: 20,
};
const plans = [
  {
    campaignId: 'PLAN-LOW',
    campaignName: '小额偶发成交计划',
    solutionName: '小额异常组合',
    optimizationTarget: '成交',
    bidMode: '最大化拿量',
    charge: 0.5,
    adPv: 20,
    click: 1,
    alipayInshopNum: 1,
    alipayInshopAmt: 210.165,
    roi: 420.33,
  },
  {
    campaignId: 'PLAN-GOOD',
    campaignName: '有效高投产计划',
    solutionName: '有效组合',
    optimizationTarget: '成交',
    bidMode: '控成本',
    charge: 300,
    adPv: 30000,
    click: 900,
    alipayInshopNum: 50,
    alipayInshopAmt: 600,
    roi: 2,
  },
  {
    campaignId: 'PLAN-BOUNDARY',
    campaignName: '门槛计划',
    solutionName: '门槛组合',
    optimizationTarget: '访问',
    bidMode: '控成本',
    charge: 200,
    adPv: 20000,
    click: 500,
    alipayInshopNum: 15,
    alipayInshopAmt: 200,
    roi: 1,
  },
];
const videos = [
  {
    ...plans[0],
    videoId: 'VIDEO-LOW',
    videoInfo: '小额异常作品',
    productIds: ['PRODUCT-LOW'],
    productNames: { 'PRODUCT-LOW': '小额异常商品' },
    guangheMatched: true,
    guangheMatchName: '已匹配',
    guangheMetrics: organic,
  },
  {
    ...plans[1],
    videoId: 'VIDEO-GOOD',
    videoInfo: '有效作品',
    productIds: ['PRODUCT-GOOD'],
    productNames: { 'PRODUCT-GOOD': '有效商品' },
    guangheMatched: true,
    guangheMatchName: '已匹配',
    guangheMetrics: organic,
  },
  {
    ...plans[2],
    videoId: 'VIDEO-BOUNDARY',
    videoInfo: '门槛作品',
    productIds: ['PRODUCT-BOUNDARY'],
    productNames: { 'PRODUCT-BOUNDARY': '门槛商品' },
    guangheMatched: true,
    guangheMatchName: '已匹配',
    guangheMetrics: organic,
  },
];
const data = {
  startTime: '2026-07-09',
  endTime: '2026-08-07',
  plan: { click: { rows: plans }, display: { rows: plans } },
  video: { click: { rows: videos }, display: { rows: videos } },
  guangheLink: {
    available: true,
    matchedVideoIds: 3,
    totalVideoIds: 3,
    productCount: 3,
    fetchedAt: Date.now(),
  },
  requestWarnings: [],
};

const markup = testWindow.__diagnosisTest.shortVideoDiagnosisMarkup(data);

assert.match(source, /const DIAGNOSIS_MIN_SPEND = 200/);
assert.match(markup, /诊断样本门槛为累计花费 ≥ ¥200/);
assert.match(markup, /参与诊断计划<\/span><strong>2<\/strong>/);
assert.match(markup, /点击归因诊断花费<\/span><strong>¥500\.00<\/strong>/);
assert.match(markup, /账户总花费<\/span><strong>¥500\.50<\/strong>/);
assert.match(markup, /账户总成交金额<\/span><strong>¥1,010\.17<\/strong>/);
assert.match(markup, /账户整体 ROI<\/span><strong>2\.02<\/strong>/);
assert.match(markup, /ROI 达标计划<\/span><strong>0\/2<\/strong>/);
assert.match(markup, /已排除花费低于 ¥200 的低样本：计划 1、商品 1、作品 1/);
assert.match(markup, /PLAN-BOUNDARY/);
assert.match(markup, /VIDEO-BOUNDARY/);
assert.match(markup, /PRODUCT-BOUNDARY/);
assert.match(markup, /样本不足，暂不诊断/);
assert.match(markup, /PLAN-LOW/);
assert.match(markup, /VIDEO-LOW/);
assert.match(markup, /PRODUCT-LOW/);
assert.match(markup, /¥0\.50/);
assert.doesNotMatch(markup, /ROI 420\.33/);

console.log('wxt diagnosis spend threshold guards passed');
