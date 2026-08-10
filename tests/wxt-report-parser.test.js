const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'wxt-report-page-hook.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(
  /\n\}\)\(\);\s*$/,
  '\n  window.__wxtParserTest = { safeNumber, safeMetricRecord, summaryMetricRecord, visibleShortVideoPotentialRatio, safeShortVideoDetailRecord, backfillShortVideoConfig };\n})();\n'
);

class FakeXMLHttpRequest {
  open() {}
  send() {}
  setRequestHeader() {}
}

const windowObject = {
  addEventListener() {},
  postMessage() {},
};
const potentialRatioCombinedNode = {
  innerText: '引导访问潜客占比 69.10%',
  parentElement: null,
};
const context = {
  URL,
  URLSearchParams,
  XMLHttpRequest: FakeXMLHttpRequest,
  clearTimeout,
  console,
  document: {
    querySelectorAll() {
      return [potentialRatioCombinedNode];
    },
  },
  location: {
    hostname: 'one.alimama.com',
    href: 'https://one.alimama.com/indexbp.html#!/report/account',
    origin: 'https://one.alimama.com',
  },
  setTimeout,
  window: windowObject,
};
vm.runInNewContext(source, context, { filename: sourcePath });

const parser = windowObject.__wxtParserTest;
assert.ok(parser, 'parser test API should be exposed in the VM fixture');

const nested = parser.summaryMetricRecord({
  totalData: [{
    metrics: {
      displayRoi: { currentValue: '2.50' },
      potentialUvRate: { value: '18.5%' },
      transactionAmt: { absolute: '1.25万' },
      cost: { value: '5,000' },
    },
  }],
});
assert.equal(nested.roi, 2.5);
assert.equal(nested.inshopPotentialUvRate, 0.185);
assert.equal(nested.alipayInshopAmt, 12500);
assert.equal(nested.charge, 5000);

const descriptors = parser.summaryMetricRecord({
  list: [{
    indicators: [
      { metricKey: 'displayRoi', value: '3.10' },
      { metricKey: 'potentialCustomerRate', value: '23%' },
      { metricKey: 'potentialCustomerUv', value: '230' },
      { metricKey: 'shopVisitUv', value: '1,000' },
    ],
  }],
});
assert.equal(descriptors.roi, 3.1);
assert.equal(descriptors.inshopPotentialUvRate, 0.23);
assert.equal(descriptors.inshopPotentialUv, 230);
assert.equal(descriptors.inshopUv, 1000);

const alternatePotentialFields = parser.summaryMetricRecord({
  summary: {
    guideVisitPotentialRate: { currentValue: '41.6%' },
    guideVisitPotentialUv: { value: '416' },
    guideVisitUv: { value: '1,000' },
  },
});
assert.ok(Math.abs(alternatePotentialFields.inshopPotentialUvRate - 0.416) < 1e-12);
assert.equal(alternatePotentialFields.inshopPotentialUv, 416);
assert.equal(alternatePotentialFields.inshopUv, 1000);
assert.ok(Math.abs(parser.visibleShortVideoPotentialRatio() - 0.691) < 1e-12);

const scene = parser.safeMetricRecord({
  sceneLabel: { text: '超级短视频' },
  metricData: {
    alipayInshopAmt: { metricValue: 9600 },
    charge: { metricValue: 3200 },
  },
}, true);
assert.equal(scene.scene1Name, '超级短视频');
assert.equal(scene.roi, 3);

const deeplyNestedScene = parser.safeMetricRecord({
  dimensions: {
    scene: {
      scene1Name: { absolute: '超级短视频' },
    },
  },
  metricData: {
    roi: { currentValue: '4.20' },
  },
}, true);
assert.equal(deeplyNestedScene.scene1Name, '超级短视频');
assert.equal(deeplyNestedScene.roi, 4.2);

const derivedDisplayMetrics = parser.safeMetricRecord({
  metricData: {
    adPv: { currentValue: '1,000' },
    click: { currentValue: '100' },
    cartInshopNum: { currentValue: '20' },
    alipayInshopNum: { currentValue: '10' },
  },
}, false);
assert.equal(derivedDisplayMetrics.ctr, 0.1);
assert.equal(derivedDisplayMetrics.cartRate, 0.2);
assert.equal(derivedDisplayMetrics.cvr, 0.1);

const nestedConfig = parser.safeShortVideoDetailRecord({
  dimensions: {
    campaign: {
      campaignId: { absolute: '13544605615' },
      campaignName: { text: '短视频拉新计划' },
      shortVideoPromotionScene: { label: '全店拉新' },
      shortVideoOptimizeTarget: { name: '促进成交' },
      shortVideoBidType: { text: '控成本出价' },
    },
  },
});
assert.equal(nestedConfig.campaignId, '13544605615');
assert.equal(nestedConfig.campaignName, '短视频拉新计划');
assert.equal(nestedConfig.solutionName, '全店拉新');
assert.equal(nestedConfig.optimizationTarget, '促进成交');
assert.equal(nestedConfig.bidMode, '控成本出价');

const configBlocks = {
  plan: {
    click: { rows: [{ campaignId: 'plan-1', campaignName: '计划一' }] },
    display: { rows: [{ campaignId: 'plan-1', campaignName: '计划一' }] },
  },
  video: {
    click: {
      rows: [{
        campaignId: 'plan-1',
        campaignName: '计划一',
        solutionName: '全店拉新',
        optimizationTarget: '促进成交',
        bidMode: '控成本出价',
      }],
    },
    display: { rows: [] },
  },
};
parser.backfillShortVideoConfig(configBlocks);
assert.equal(configBlocks.plan.click.rows[0].solutionName, '全店拉新');
assert.equal(configBlocks.plan.display.rows[0].optimizationTarget, '促进成交');
assert.equal(configBlocks.plan.display.rows[0].bidMode, '控成本出价');

assert.match(source, /buildShortVideoBody\(startTime, endTime, 'display'\)/);
assert.match(source, /const SHORT_VIDEO_ACCOUNT_FIELDS = MARKETING_FIELDS\.slice\(\)/);
assert.match(source, /backfillShortVideoConfig\(result\)/);
assert.doesNotMatch(source, /activateNativeShortVideoRoute/);
assert.doesNotMatch(source, /businessDefense:\s*message\.reportKind === 'businessDefense'/);

console.log('wxt report parser fixtures passed');
