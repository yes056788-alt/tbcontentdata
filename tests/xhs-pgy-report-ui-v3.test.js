const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const realXhsReportModel = require('../xhs/report-model');
const realXhsContract = require('../xhs/contract');
const { createXhsAnalysisSnapshot } = require('../xhs/analysis');
global.XhsContract = realXhsContract;
const { parseWorkbook } = require('../xhs/pgy-export-links');
const XLSX = require('../vendor/xlsx.full.min.js');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractPgyChangeHandler(source) {
  const marker = '  if (xhsPgyReport) xhsPgyReport.addEventListener("change", ';
  const listenerStart = source.indexOf(marker);
  if (listenerStart < 0) return '() => {}';
  const handlerStart = listenerStart + marker.length;
  const handlerEnd = source.indexOf('\n  });', handlerStart);
  assert.ok(handlerEnd > handlerStart, 'PGY publication-date change-handler marker');
  return source.slice(handlerStart, handlerEnd + 4);
}

function extractPgyClickHandler(source) {
  const marker = '  if (xhsPgyReport) xhsPgyReport.addEventListener("click", ';
  const listenerStart = source.indexOf(marker);
  if (listenerStart < 0) return '() => {}';
  const handlerStart = listenerStart + marker.length;
  const handlerEnd = source.indexOf('\n  });', handlerStart);
  assert.ok(handlerEnd > handlerStart, 'PGY click-handler marker');
  return source.slice(handlerStart, handlerEnd + 4);
}

function createPgyReportHarness() {
  const source = read('web-tool/report.js');
  const sideEffectsStart = source.indexOf('  window.TaobaoReportExport = Object.freeze({');
  assert.ok(sideEffectsStart > 0, 'report side-effect marker');
  const pgyChangeHandler = extractPgyChangeHandler(source);
  const pgyClickHandler = extractPgyClickHandler(source);
  const instrumented = source.slice(0, sideEffectsStart) + `
  const __xhsPgyChangeHandler = ${pgyChangeHandler};
  const __xhsPgyClickHandler = ${pgyClickHandler};
  window.__xhsPgyReportUiV3Test = Object.freeze({
    setState(value) {
      const state = value && typeof value === 'object' ? value : {};
      xhsStatus = state.status && typeof state.status === 'object' ? state.status : {};
      xhsAnalysis = state.analysis && typeof state.analysis === 'object' ? state.analysis : null;
    },
    buildPgyMarkup() {
      return buildXhsMarkup({ platform: 'pgy' });
    },
    changePgyDate(boundary, value) {
      const attributes = {
        'data-xhs-pgy-date': String(boundary || ''),
      };
      const control = {
        value: value == null ? '' : String(value),
        disabled: false,
        closest(selector) {
          return String(selector || '').includes('[data-xhs-pgy-date]') ? this : null;
        },
        matches(selector) {
          return String(selector || '').includes('[data-xhs-pgy-date]');
        },
        hasAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
      };
      __xhsPgyChangeHandler({ target: control });
    },
    changePgySpu(value) {
      const attributes = { 'data-xhs-pgy-spu': '' };
      const control = {
        value: value == null ? '' : String(value),
        disabled: false,
        closest(selector) {
          return String(selector || '').includes('[data-xhs-pgy-spu]') ? this : null;
        },
        matches(selector) {
          return String(selector || '').includes('[data-xhs-pgy-spu]');
        },
        hasAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
      };
      __xhsPgyChangeHandler({ target: control });
    },
    changePgyKeywordFilter(dimension, value) {
      const attributes = { 'data-xhs-pgy-search-filter': String(dimension || '') };
      const control = {
        value: value == null ? '' : String(value),
        disabled: false,
        closest(selector) {
          return String(selector || '').includes('[data-xhs-pgy-search-filter]') ? this : null;
        },
        hasAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
      };
      __xhsPgyChangeHandler({ target: control });
    },
    clickPgyKeywordCategory(dimension, value) {
      const attributes = {
        'data-xhs-pgy-search-filter': String(dimension || ''),
        'data-xhs-pgy-search-value': value == null ? '' : String(value),
      };
      const button = {
        disabled: false,
        closest(selector) {
          return String(selector || '').includes('[data-xhs-pgy-search-value]') ? this : null;
        },
        hasAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
      };
      __xhsPgyClickHandler({ target: button });
    },
  });
})();`;

  const pgyAggregateCalls = [];
  const reportModel = {
    aggregatePgyFacts(input) {
      pgyAggregateCalls.push(structuredClone(input));
      return realXhsReportModel.aggregatePgyFacts(input);
    },
    aggregateSpotlight(input) {
      return {
        groupBy: Array.isArray(input && input.groupBy) ? input.groupBy.slice() : [],
        summary: {
          rowCount: 0,
          noteCount: 0,
          spend: { total: 0, inTask: 0, outsideTask: 0, unknown: 0 },
          impressions: 0,
          clicks: 0,
          interactions: 0,
          seedUsers: 0,
          deepSeedUsers: 0,
          conversion15: {
            observability: 'none', directSpend: 0, storeVisits: null,
            orders: null, gmv: null, calculatedRoi15: null, platformRoi15: null,
          },
        },
        groups: [],
      };
    },
    filterPgySearchKeywords: realXhsReportModel.filterPgySearchKeywords,
    summarizePgySearchKeywords: realXhsReportModel.summarizePgySearchKeywords,
  };
  const windowObject = {
    XhsContract: realXhsContract,
    XhsReportModel: reportModel,
    addEventListener() {},
    clearTimeout,
    postMessage() {},
    setTimeout,
  };
  windowObject.self = windowObject;
  windowObject.top = windowObject;
  const document = {
    documentElement: { classList: { add() {} } },
    getElementById() { return null; },
  };
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2030-04-20T12:00:00.000+08:00']));
    }
    static now() { return new Date('2030-04-20T12:00:00.000+08:00').getTime(); }
  }
  vm.runInNewContext(instrumented, {
    Array,
    Boolean,
    Date: FixedDate,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    location: { origin: 'http://127.0.0.1:3400', search: '?builder=1' },
    setTimeout,
    structuredClone,
    window: windowObject,
  }, { filename: 'web-tool/report.js' });

  return {
    api: windowObject.__xhsPgyReportUiV3Test,
    pgyAggregateCalls,
    clearAggregateCalls() {
      pgyAggregateCalls.length = 0;
    },
  };
}

function pgyFact(
  id,
  publishDate,
  cooperation,
  platformFee,
  metrics,
  followerCount,
  taobaoTaskId,
  taskEndDate,
) {
  return {
    noteId: `fictional-pgy-ui-v3-note-${id}`,
    sourceKey: `fictional-pgy-ui-v3-cooperation-${id}`,
    title: `虚构蒲公英 UI V3 笔记 ${id}`,
    publishDate,
    taobaoTaskId,
    taskEndDate,
    author: {
      id: `fictional-pgy-ui-v3-creator-${id}`,
      name: `虚构蒲公英 UI V3 达人 ${id}`,
      followerCount,
    },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: { ...metrics },
  };
}

function pgyFacts() {
  const facts = [
    pgyFact('jan', '2030-01-05', 100, 10, {
      impressions: 100, reads: 40, interactions: 10,
    }, 4999, 'fictional-taobao-task-jan', '2030-01-31'),
    pgyFact('feb', '2030-02-10', 200, 20, {
      impressions: 200, reads: 100, interactions: 20,
    }, 5000, 'fictional-taobao-task-feb', '2030-05-31'),
    pgyFact('after', '2030-04-01', 900, 90, {
      impressions: 9000, reads: 900, interactions: 90,
    }, 500000, 'fictional-taobao-task-after', '2030-04-20'),
  ];
  facts[0].spuName = '虚构 SPU A';
  facts[0].crossDomainProjectName = '虚构跨域项目 A';
  facts[0].noteUrl = 'https://www.xiaohongshu.com/explore/fictional-pgy-ui-v3-note-jan?xsec_token=fictional-default&xsec_source=pc_pgyexport';
  facts[0].taobaoSamplingRatio = 0.5;
  facts[0].searchKeywordFetchStatus = 'complete';
  facts[0].searchKeywords = [
    { keyword: '虚构共享搜索词', impressions: 100, reads: 20, clickRate: 0.2 },
    { keyword: '虚构小众搜索词', impressions: 80, reads: 8, clickRate: 0.1 },
  ];
  Object.assign(facts[0].metrics, {
    taobaoOffsiteActiveUv15d: 10,
    taobaoOffsiteActiveCost15d: 11,
    taobaoDealUv15d: 2,
    taobaoAddCartUv15d: 5,
    taobaoAddCartRate15d: 0.99,
    taobaoPurchaseRate15d: 0.88,
  });
  facts[1].spuName = '虚构 SPU B';
  facts[1].crossDomainProjectName = '虚构跨域项目 B';
  facts[1].taobaoSamplingRatio = 0.25;
  facts[1].searchKeywordFetchStatus = 'complete';
  facts[1].searchKeywords = [
    { keyword: '虚构共享搜索词', impressions: 300, reads: 90, clickRate: 0.3 },
    { keyword: '虚构品类搜索词', impressions: 60, reads: 12, clickRate: 0.2 },
  ];
  Object.assign(facts[1].metrics, {
    taobaoOffsiteActiveUv15d: 20,
    taobaoOffsiteActiveCost15d: 2.75,
    taobaoDealUv15d: 4,
    taobaoAddCartUv15d: 5,
    taobaoAddCartRate15d: 0.77,
    taobaoPurchaseRate15d: 0.66,
  });
  facts[2].searchKeywordFetchStatus = 'complete';
  facts[2].searchKeywords = [
    { keyword: '这是筛选区间外的搜索词', impressions: 9000, reads: 900, clickRate: 0.1 },
  ];
  return facts;
}

function pgySnapshot() {
  return {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'fictional-pgy-ui-v3-run',
    generatedAt: '2030-04-20T00:02:00.000Z',
    asOf: '2030-04-20',
    // Deliberately different: PGY controls must prefer pgy.defaultDateRange.
    dateRange: { from: '2029-01-01', to: '2029-12-31', timezone: 'Asia/Shanghai' },
    selectedPlatforms: ['pgy'],
    quality: { decisionReady: true, issues: [] },
    accounts: {},
    management: { costs: {}, accountOverview: {} },
    pgy: {
      collectionScope: 'all_available',
      defaultDateRange: {
        from: '2030-01-01', to: '2030-03-31', timezone: 'Asia/Shanghai',
      },
      latestPublishDate: '2030-04-01',
      collectedAt: '2030-04-20T00:01:00.000Z',
      facts: pgyFacts(),
      // Stale values prove that the viewer derives the visible summary from facts.
      noteCount: 77,
      reportedNoteCount: 77,
      starTaskNoteCount: 33,
      overdueNoteCount: 55,
      costs: { cooperation: 7000, platformFee: 700, total: 7700 },
      metrics: {
        impressions: 7777, reads: 777, interactions: 77,
        readRate: 0.1, engagementRate: 0.1,
      },
      monthly: [{ month: '1999-01', noteCount: 77 }],
      followerTiers: [],
    },
    spotlight: { daily: [] },
    star: {},
    notes: [],
    actions: [],
  };
}

function collectionStatus() {
  return {
    status: 'complete',
    platforms: {
      pgy: { status: 'complete', collectedAt: '2030-04-20T00:01:00.000Z' },
    },
  };
}

function pgyPanel(markup) {
  const start = markup.indexOf('data-xhs-panel="pgy-analysis"');
  assert.ok(start >= 0, 'missing PGY report panel');
  return markup.slice(start);
}

function assertPgySearchMetricCards(markup, expected) {
  assert.match(markup,
    /<div(?=[^>]*class="[^"]*xhs-pgy-search-metrics[^"]*")(?=[^>]*data-xhs-pgy-search-metrics)[^>]*>/,
    '搜索来源区块必须展示独立的汇总指标卡容器');
  const cards = [
    ['keywordCount', '总搜索词数', expected.keywordCount],
    ['noteCount', '笔记数', expected.noteCount],
    ['impressions', '曝光量', expected.impressions],
    ['reads', '阅读量', expected.reads],
    ['clickRate', '点击率', expected.clickRate],
  ];
  for (const [key, label, value] of cards) {
    assert.match(markup, new RegExp(
      `<div[^>]*class="[^"]*xhs-metric-card[^"]*"[^>]*>[\\s\\S]*?` +
      `<span>${label}</span>[\\s\\S]*?` +
      `<[^>]*data-xhs-pgy-search-metric="${key}"[^>]*>${value}</[^>]+>[\\s\\S]*?</div>`,
    ), `搜索来源汇总指标卡 ${label} 应显示筛选后口径`);
  }
}

test('PGY facts default to pgy.defaultDateRange and render the locally aggregated summary', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.equal(harness.pgyAggregateCalls.length, 1,
    'rendering an all-available snapshot must delegate to the shared PGY model');
  const call = harness.pgyAggregateCalls[0];
  assert.deepEqual(call.dateRange, { from: '2030-01-01', to: '2030-03-31' });
  assert.equal(call.asOf, '2030-04-20');
  assert.equal(Object.prototype.hasOwnProperty.call(call, 'starNoteIds'), false,
    'PGY task membership must not depend on a Star intersection');
  assert.deepEqual(call.facts.map((fact) => fact.noteId), [
    'fictional-pgy-ui-v3-note-jan',
    'fictional-pgy-ui-v3-note-feb',
    'fictional-pgy-ui-v3-note-after',
  ]);
  assert.match(panel, /时间筛选内笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /合作金额[\s\S]*?<strong>¥300<\/strong>/);
  assert.match(panel, /达人花费[\s\S]*?<strong>¥330<\/strong>/);
  assert.match(panel, /曝光量[\s\S]*?<strong>300<\/strong>/);
  assert.doesNotMatch(panel, /¥7,?700|7,?777/,
    'stale archived aggregates must not override facts-derived values');
});

test('PGY report renders labelled publication-date controls initialized from defaultDateRange', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.match(panel,
    /<label[^>]*>[\s\S]*?<span>发布日期从<\/span>[\s\S]*?<input[^>]*data-xhs-pgy-date="from"[^>]*value="2030-01-01"[^>]*>[\s\S]*?<\/label>/);
  assert.match(panel,
    /<label[^>]*>[\s\S]*?<span>发布日期至<\/span>[\s\S]*?<input[^>]*data-xhs-pgy-date="to"[^>]*value="2030-03-31"[^>]*>[\s\S]*?<\/label>/);
  assert.match(panel,
    /<label[^>]*>[\s\S]*?<span>SPU 筛选<\/span>[\s\S]*?<select[^>]*data-xhs-pgy-spu[^>]*>[\s\S]*?虚构 SPU A[\s\S]*?虚构 SPU B/);
  assert.match(panel, /超期判定日期：今日 2030-04-20；任务结束日期早于今日即计为超期。/);
});

test('changing the selected PGY SPU recomputes the archived facts locally', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });
  harness.api.buildPgyMarkup();
  harness.clearAggregateCalls();

  harness.api.changePgySpu('虚构 SPU B');
  const panel = pgyPanel(harness.api.buildPgyMarkup());

  assert.equal(harness.pgyAggregateCalls.length, 1);
  assert.equal(harness.pgyAggregateCalls[0].spuName, '虚构 SPU B');
  assert.match(panel, /data-xhs-pgy-spu[^>]*>[\s\S]*?<option value="虚构 SPU B" selected>虚构 SPU B<\/option>/);
  assert.match(panel, /时间筛选内笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /达人花费[\s\S]*?<strong>¥220<\/strong>/);
});

test('PGY report exposes the six requested 15-day Taobao fields with totals-derived cost and rates', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  for (const label of [
    '淘宝站外活跃行为UV(15天)', '淘宝站外活跃成本(15天)', '淘宝成交UV(15天)',
    '淘宝加购UV(15天)', '淘宝加购率(15天)', '淘宝购买率(15天)',
  ]) assert.ok(panel.includes(label), `missing PGY metric: ${label}`);
  assert.match(panel, /淘宝站外活跃行为UV\(15天\)[\s\S]*?<strong>30<\/strong>/);
  assert.match(panel, /淘宝站外活跃成本\(15天\)[\s\S]*?<strong>¥4\.4<\/strong>/);
  assert.match(panel, /淘宝加购率\(15天\)[\s\S]*?<strong>21\.43%<\/strong>/);
  assert.match(panel, /淘宝购买率\(15天\)[\s\S]*?<strong>14\.29%<\/strong>/);
});

test('PGY report aggregates current facts into a TOP search-source table and shows fetched-note coverage', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  const empty = pgyFact('search-empty', '2030-03-10', 0, 0, {
    impressions: 0, reads: 0, interactions: 0,
  }, 5000, null, null);
  empty.searchKeywordFetchStatus = 'empty';
  empty.searchKeywords = [];
  const failed = pgyFact('search-failed', '2030-03-11', 0, 0, {
    impressions: 0, reads: 0, interactions: 0,
  }, 5000, null, null);
  failed.searchKeywordFetchStatus = 'failed';
  failed.searchKeywords = [];
  snapshot.pgy.facts.push(empty, failed);
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const searchStart = panel.indexOf('搜索来源关键词（全部词）');
  assert.ok(searchStart >= 0, 'missing PGY TOP search-source table');
  const searchMarkup = panel.slice(searchStart);
  for (const label of ['关键词', '曝光', '阅读', '点击率']) {
    assert.ok(searchMarkup.includes(label), `missing PGY search-source column: ${label}`);
  }
  assert.match(searchMarkup,
    /<tr[^>]*>[\s\S]*?<t[dh][^>]*>虚构共享搜索词<\/t[dh]>[\s\S]*?<td[^>]*>400<\/td>[\s\S]*?<td[^>]*>110<\/td>[\s\S]*?<td[^>]*>27\.5%<\/td>[\s\S]*?<\/tr>/,
    'the same keyword must sum impressions and reads, then derive click rate from the totals');
  assert.match(searchMarkup, /搜索词采集覆盖[\s\S]{0,100}3\s*\/\s*4/,
    'complete and empty fetches count as covered; failed fetches do not');
  assert.ok(
    searchMarkup.indexOf('虚构共享搜索词') < searchMarkup.indexOf('虚构小众搜索词'),
    'TOP keywords must be ordered by aggregated impressions',
  );
  assert.doesNotMatch(searchMarkup, /这是筛选区间外的搜索词/);

  harness.api.changePgyDate('from', '2030-01-01');
  harness.api.changePgyDate('to', '2030-01-31');
  const january = pgyPanel(harness.api.buildPgyMarkup());
  const januarySearch = january.slice(january.indexOf('搜索来源关键词（全部词）'));
  assert.match(januarySearch,
    /<tr[^>]*>[\s\S]*?<t[dh][^>]*>虚构共享搜索词<\/t[dh]>[\s\S]*?<td[^>]*>100<\/td>[\s\S]*?<td[^>]*>20<\/td>[\s\S]*?<td[^>]*>20%<\/td>[\s\S]*?<\/tr>/,
    'changing the PGY fact filter must also recompute the search-source table locally');
  assert.match(januarySearch, /搜索词采集覆盖[\s\S]{0,100}1\s*\/\s*1/);
});

test('PGY keyword rows show collected search heat and render missing heat as a dash', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.pgy.facts = [snapshot.pgy.facts[0]];
  snapshot.pgy.facts[0].searchKeywordFetchStatus = 'complete';
  snapshot.pgy.facts[0].searchKeywords = [
    { keyword: '虚构有搜索热度词', searchScore: 8765, impressions: 90, reads: 18 },
    { keyword: '虚构缺失搜索热度词', impressions: 80, reads: 8765 },
  ];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const searchMarkup = panel.slice(panel.indexOf('搜索来源关键词（全部词）'));
  assert.match(searchMarkup, /<th>搜索热度<\/th>/,
    '搜索来源词明细必须增加搜索热度列');
  assert.match(searchMarkup,
    /data-xhs-pgy-search-keyword="虚构有搜索热度词"[^>]*><th[^>]*>虚构有搜索热度词<\/th><td>8,765<\/td>/,
    '已采集的 searchScore 应作为搜索热度显示');
  assert.match(searchMarkup,
    /data-xhs-pgy-search-keyword="虚构缺失搜索热度词"[^>]*><th[^>]*>虚构缺失搜索热度词<\/th><td>-<\/td>/,
    '搜索热度缺失必须显示 -，不得用同行阅读量代替');
});

test('PGY search report renders sheba taxonomy comparisons and keyword-to-note drilldowns', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.pgy.facts[0].noteUrl = 'https://www.xiaohongshu.com/explore/fictional-pgy-ui-v3-note-jan?xsec_token=fictional-a&xsec_source=pc_pgyexport';
  snapshot.pgy.facts[0].searchKeywords = [
    { keyword: '希宝主食罐头推荐', impressions: 100, reads: 20, clickRate: 0.2 },
    { keyword: '猫砂盆推荐', impressions: 50, reads: 5, clickRate: 0.1 },
  ];
  snapshot.pgy.facts[1].noteUrl = 'https://www.xiaohongshu.com/explore/fictional-pgy-ui-v3-note-feb?xsec_token=fictional-b&xsec_source=pc_pgyexport';
  snapshot.pgy.facts[1].searchKeywords = [
    { keyword: '希宝主食罐头推荐', impressions: 300, reads: 90, clickRate: 0.3 },
  ];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const searchMarkup = panel.slice(panel.indexOf('搜索来源关键词（全部词）'));
  assert.match(searchMarkup, /分类标准与规则口径\s*·\s*sheba-cat-food-v1/);
  for (const heading of ['按商业分类', '按品类相关度', '按搜索意图']) {
    assert.ok(searchMarkup.includes(heading), `missing keyword comparison: ${heading}`);
  }
  for (const column of ['商业分类', '品类相关度', '搜索意图', '置信度', '贡献笔记']) {
    assert.ok(searchMarkup.includes(column), `missing classified keyword column: ${column}`);
  }
  assert.match(searchMarkup,
    /希宝主食罐头推荐[\s\S]*?自有品牌词[\s\S]*?强相关[\s\S]*?对比评估/);
  assert.match(searchMarkup, /<summary>查看 2 篇<\/summary>/);
  assert.match(searchMarkup, /data-xhs-pgy-search-note-id="fictional-pgy-ui-v3-note-jan"/);
  assert.match(searchMarkup, /data-xhs-pgy-search-note-id="fictional-pgy-ui-v3-note-feb"/);
  assert.match(searchMarkup,
    /href="https:\/\/www\.xiaohongshu\.com\/explore\/fictional-pgy-ui-v3-note-jan\?xsec_token=fictional-a&amp;xsec_source=pc_pgyexport"/);
  assert.match(searchMarkup,
    /按商业分类[\s\S]*?自有品牌词[\s\S]*?400[\s\S]*?110[\s\S]*?27\.5%/,
    'dimension summary must calculate weighted click rate from summed reads and impressions');
});

test('official PGY workbook hyperlinks survive noteId backfill and render only as safe note drilldowns', () => {
  const validNoteId = 'fictional-pgy-workbook-link-valid';
  const bareNoteId = 'fictional-pgy-workbook-link-bare';
  const hostileNoteId = 'fictional-pgy-workbook-link-hostile';
  const validUrl = 'https://www.xiaohongshu.com/explore/' + validNoteId +
    '?xsec_token=official-workbook-' + validNoteId + '&xsec_source=pc_pgyexport';
  const bareUrl = 'https://www.xiaohongshu.com/explore/' + bareNoteId;
  const hostileUrl = 'https://attacker.example/explore/' + hostileNoteId +
    '?xsec_token=hostile-workbook-token&xsec_source=pc_pgyexport';
  const sheet = XLSX.utils.aoa_to_sheet([
    ['笔记标题', '笔记链接'],
    ['合法官方链接笔记', '查看笔记'],
    ['裸链接笔记', '查看笔记'],
    ['恶意域名笔记', '查看笔记'],
  ]);
  sheet.B2.l = { Target: validUrl, Tooltip: '查看笔记' };
  sheet.B3.l = { Target: bareUrl, Tooltip: '查看笔记' };
  sheet.B4.l = { Target: hostileUrl, Tooltip: '查看笔记' };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '笔记报告');
  const workbookBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const parsed = parseWorkbook(workbookBuffer, XLSX, [
    validNoteId, bareNoteId, hostileNoteId,
  ]);
  const parsedLinks = new Map(parsed.links);

  const notes = [
    {
      noteId: validNoteId,
      sourceKey: 'fictional-pgy-workbook-source-valid',
      title: '合法官方链接笔记',
      noteUrl: parsedLinks.get(validNoteId) || null,
      keyword: '合法官方链接搜索词',
    },
    {
      noteId: bareNoteId,
      sourceKey: 'fictional-pgy-workbook-source-bare',
      title: '裸链接笔记',
      noteUrl: bareUrl,
      keyword: '裸链接搜索词',
    },
    {
      noteId: hostileNoteId,
      sourceKey: 'fictional-pgy-workbook-source-hostile',
      title: '恶意域名笔记',
      noteUrl: hostileUrl,
      keyword: '恶意链接搜索词',
    },
  ].map((note, index) => ({
    ...note,
    publishDate: '2030-01-0' + (index + 2),
    searchKeywordFetchStatus: 'complete',
    searchKeywords: [{
      keyword: note.keyword,
      impressions: 100 - index * 10,
      reads: 20 - index * 2,
      clickRate: 0.2,
    }],
    author: {
      id: 'fictional-pgy-workbook-author-' + (index + 1),
      name: '虚构达人 ' + (index + 1),
      followerCount: 5000,
    },
    costs: { cooperation: 100, platformFee: 10, total: 110 },
    metrics: { impressions: 1000, reads: 200, interactions: 20 },
  }));
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-workbook-link-run',
    storeId: 'fictional-pgy-workbook-link-store',
    selectedPlatforms: ['pgy'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    generatedAt: '2030-02-01T00:00:00.000Z',
    asOf: '2030-02-01',
    collections: {
      pgy: {
        schemaVersion: 1,
        platform: 'pgy',
        runId: 'fictional-pgy-workbook-link-run',
        accountKey: 'fictional-pgy-workbook-link-account',
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
        dateBasis: 'note_publish_time',
        collectionScope: 'all_available',
        latestPublishDate: '2030-01-04',
        startedAt: '2030-02-01T00:00:00.000Z',
        finishedAt: '2030-02-01T00:01:00.000Z',
        status: 'complete',
        schemaValid: true,
        paginationComplete: true,
        reconciled: true,
        truncated: false,
        identity: { accountKey: 'fictional-pgy-workbook-link-account' },
        notes,
        reconciliation: { reconciled: true },
        warnings: [],
        errors: [],
      },
    },
  });
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const expectedAnchor = '<a class="xhs-note-detail-link" href="' +
    validUrl.replace('&', '&amp;') +
    '" target="_blank" rel="noopener noreferrer">合法官方链接笔记</a>';

  assert.equal(panel.split(expectedAnchor).length - 1, 2,
    '合法官方导出链接必须同时在笔记分析和搜索词贡献笔记中可点击');
  assert.equal(snapshot.pgy.facts.find((fact) => fact.noteId === validNoteId).noteUrl, validUrl,
    '官方链接必须经 analysis contract 和 report model 完整传播');
  assert.deepEqual(parsed.links, [[validNoteId, validUrl]],
    '解析器必须从 XLSX 超链接关系回填 noteId，且拒绝裸链接和非官方域名');
  assert.doesNotMatch(panel, /attacker\.example/,
    '不得使用采集数据中的非官方域名');
  for (const [noteId, title] of [
    [bareNoteId, '裸链接笔记'],
    [hostileNoteId, '恶意域名笔记'],
  ]) {
    assert.doesNotMatch(panel, new RegExp(
      '<a class="xhs-note-detail-link"[^>]*>' + title + '</a>'
    ), title + ' 缺少蒲公英签名时必须保持不可点击');
    assert.match(panel, new RegExp(title), title + ' 的标题仍应保留');
  }
  assert.match(panel, /data-xhs-pgy-link-coverage[^>]*>笔记链接仅 1 \/ 3 可用/,
    '报告必须明确提示官方签名链接缺失，而不是生成会跳转 404 的裸链接');
});

test('PGY search keyword tables expose linked dimension filters and recompute every first-row total', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.pgy.facts = [snapshot.pgy.facts[0], snapshot.pgy.facts[1]];
  snapshot.pgy.facts[0].title = '希宝主食罐头选购与猫砂盆推荐';
  snapshot.pgy.facts[0].spuName = '希宝主食罐头';
  snapshot.pgy.facts[0].searchKeywords = [
    { keyword: '希宝主食罐头推荐', impressions: 100, reads: 20, clickRate: 0.2 },
    { keyword: '猫砂盆推荐', impressions: 50, reads: 5, clickRate: 0.1 },
  ];
  snapshot.pgy.facts[1].title = '希宝主食罐头购买攻略';
  snapshot.pgy.facts[1].spuName = '希宝主食罐头';
  snapshot.pgy.facts[1].searchKeywords = [
    { keyword: '希宝主食罐头哪里买', impressions: 60, reads: 15, clickRate: 0.25 },
  ];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  let searchMarkup = pgyPanel(harness.api.buildPgyMarkup());
  searchMarkup = searchMarkup.slice(searchMarkup.indexOf('搜索来源关键词'));
  assertPgySearchMetricCards(searchMarkup, {
    keywordCount: '3', noteCount: '2', impressions: '210', reads: '40', clickRate: '19.05%',
  });
  for (const dimension of ['commercialCategory', 'relevance', 'intent']) {
    assert.match(searchMarkup, new RegExp(
      `<select[^>]*data-xhs-pgy-search-filter="${dimension}"[^>]*aria-label="[^"]+"`,
    ), `missing accessible table-header filter for ${dimension}`);
    assert.match(searchMarkup, new RegExp(
      `<tbody[^>]*data-xhs-export-pgy-search-summary-body="${dimension}"[^>]*>` +
      `<tr class="xhs-total-row"[^>]*data-xhs-pgy-search-total="${dimension}"`,
    ), `the ${dimension} comparison must start with its aggregate row`);
  }
  assert.match(searchMarkup,
    /<tbody[^>]*data-xhs-export-pgy-search-body[^>]*><tr class="xhs-total-row"[^>]*data-xhs-pgy-search-total="keywords"/,
    'the keyword table must start with its aggregate row');
  assert.match(searchMarkup,
    /data-xhs-pgy-search-total="keywords"[\s\S]*?210[\s\S]*?40[\s\S]*?19\.05%/,
    'the unfiltered total must sum impressions and reads before deriving weighted click rate');
  assert.match(searchMarkup,
    /<button[^>]*data-xhs-pgy-search-filter="commercialCategory"[^>]*data-xhs-pgy-search-value="自有品牌词"[^>]*aria-pressed="false"/,
    'comparison labels must be actionable filter buttons');

  harness.api.clickPgyKeywordCategory('commercialCategory', '自有品牌词');
  searchMarkup = pgyPanel(harness.api.buildPgyMarkup());
  searchMarkup = searchMarkup.slice(searchMarkup.indexOf('搜索来源关键词'));
  assert.match(searchMarkup,
    /data-xhs-pgy-search-filter="commercialCategory"[^>]*>[\s\S]*?<option value="自有品牌词" selected>/,
    'clicking a comparison label must synchronize the table-header select');
  assert.match(searchMarkup,
    /data-xhs-pgy-search-value="自有品牌词"[^>]*aria-pressed="true"/);
  assert.match(searchMarkup,
    /data-xhs-pgy-search-total="keywords"[\s\S]*?160[\s\S]*?35[\s\S]*?21\.88%/,
    'category filtering must recompute the aggregate instead of only hiding rows');
  assertPgySearchMetricCards(searchMarkup, {
    keywordCount: '2', noteCount: '2', impressions: '160', reads: '35', clickRate: '21.88%',
  });
  assert.doesNotMatch(searchMarkup, /data-xhs-pgy-search-keyword="猫砂盆推荐"/);

  harness.api.changePgyKeywordFilter('intent', '对比评估');
  searchMarkup = pgyPanel(harness.api.buildPgyMarkup());
  searchMarkup = searchMarkup.slice(searchMarkup.indexOf('搜索来源关键词'));
  assert.match(searchMarkup, /data-xhs-pgy-search-keyword="希宝主食罐头推荐"/);
  assert.doesNotMatch(searchMarkup, /data-xhs-pgy-search-keyword="希宝主食罐头哪里买"/,
    'header filters must combine with category clicks using AND semantics');
  assert.match(searchMarkup,
    /data-xhs-pgy-search-total="keywords"[\s\S]*?100[\s\S]*?20[\s\S]*?20%/);
  assertPgySearchMetricCards(searchMarkup, {
    keywordCount: '1', noteCount: '1', impressions: '100', reads: '20', clickRate: '20%',
  });
});

test('PGY search report renders furniture profile copy without pet-only terminology', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.pgy.facts = [snapshot.pgy.facts[0]];
  snapshot.pgy.facts[0].title = '小户型家具与护腰床垫选购';
  snapshot.pgy.facts[0].spuName = '护腰床垫';
  snapshot.pgy.facts[0].searchKeywordFetchStatus = 'complete';
  snapshot.pgy.facts[0].searchKeywords = [
    { keyword: '护腰床垫怎么选', impressions: 100, reads: 20, clickRate: 0.2 },
    { keyword: '小户型沙发推荐', impressions: 50, reads: 10, clickRate: 0.2 },
  ];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const searchMarkup = panel.slice(panel.indexOf('搜索来源关键词（全部词）'));
  assert.match(searchMarkup, /home-furnishing-v1/);
  assert.match(searchMarkup, /家具家居行业分类标准/);
  assert.doesNotMatch(searchMarkup, /泛宠物|养宠场景|使用\/喂养/);
});

test('PGY report labels an all-failed search-keyword scope as unavailable instead of empty', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  const failed = pgyFact('search-all-failed', '2030-01-12', 0, 0, {
    impressions: 0, reads: 0, interactions: 0,
  }, 5000, null, null);
  failed.searchKeywordFetchStatus = 'failed';
  failed.searchKeywords = [];
  snapshot.pgy.facts = [failed];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  const searchMarkup = panel.slice(panel.indexOf('搜索来源关键词（全部词）'));
  assert.match(searchMarkup, /搜索词采集覆盖[\s\S]{0,100}0\s*\/\s*1/);
  assert.match(searchMarkup, /搜索词请求均失败/);
  assert.doesNotMatch(searchMarkup, />当前筛选范围暂无搜索关键词数据。</);
});

test('PGY note analysis is a clickable drilldown sourced from PGY facts and filterable by cross-domain project', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.match(panel, /<button[^>]*data-xhs-pgy-note-toggle[^>]*aria-expanded="false"[^>]*>[\s\S]*笔记分析/);
  assert.match(panel, /<select[^>]*data-xhs-pgy-project[^>]*>[\s\S]*虚构跨域项目 A[\s\S]*虚构跨域项目 B/);
  assert.match(panel, /data-xhs-pgy-note-id="fictional-pgy-ui-v3-note-jan"/);
  assert.match(panel,
    /href="https:\/\/www\.xiaohongshu\.com\/explore\/fictional-pgy-ui-v3-note-jan\?xsec_token=fictional-default&amp;xsec_source=pc_pgyexport"/);
  assert.match(panel, /<tr class="xhs-total-row"[^>]*data-xhs-pgy-note-total/,
    'PGY note table must include a total row');
});

test('changing PGY publication dates recalculates archived facts locally through aggregatePgyFacts', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });
  harness.api.buildPgyMarkup();
  harness.clearAggregateCalls();

  harness.api.changePgyDate('from', '2030-02-01');
  harness.api.changePgyDate('to', '2030-02-28');
  const panel = pgyPanel(harness.api.buildPgyMarkup());

  assert.equal(harness.pgyAggregateCalls.length, 1);
  assert.deepEqual(harness.pgyAggregateCalls[0].dateRange, {
    from: '2030-02-01',
    to: '2030-02-28',
  });
  assert.match(panel, /data-xhs-pgy-date="from"[^>]*value="2030-02-01"/);
  assert.match(panel, /data-xhs-pgy-date="to"[^>]*value="2030-02-28"/);
  assert.match(panel, /时间筛选内笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>0<\/strong>/);
  assert.match(panel, /达人花费[\s\S]*?<strong>¥220<\/strong>/);
  assert.match(panel, /曝光量[\s\S]*?<strong>200<\/strong>/);
});

test('PGY date recalculation uses Taobao task facts instead of archived Star note intersections', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.selectedPlatforms = ['pgy', 'adstar'];
  snapshot.star.coverage = 'complete';
  snapshot.notes = [{ noteId: 'fictional-star-only-note-that-must-not-affect-pgy' }];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  harness.api.buildPgyMarkup();
  harness.clearAggregateCalls();

  harness.api.changePgyDate('from', '2030-01-01');
  harness.api.changePgyDate('to', '2030-01-31');
  const panel = pgyPanel(harness.api.buildPgyMarkup());

  assert.equal(Object.prototype.hasOwnProperty.call(
    harness.pgyAggregateCalls[0], 'starNoteIds'
  ), false);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>1<\/strong>/);
});

test('PGY partial coverage keeps costs unknown while still allowing local fact filtering', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.pgy.coverage = 'partial';
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.match(panel, /时间筛选内笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(panel, /合作金额[\s\S]*?<strong>—<\/strong>/);
  assert.match(panel, /平台服务费[\s\S]*?<strong>—<\/strong>/);
  assert.match(panel, /达人花费[\s\S]*?<strong>—<\/strong>/);
  assert.doesNotMatch(panel, /¥330/,
    'partial archived facts are observations, not a complete payable-cost total');
});

test('PGY task and overdue counts remain available when the selected Star source failed', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.selectedPlatforms = ['pgy', 'adstar'];
  snapshot.star.coverage = 'unavailable';
  snapshot.notes = [];
  snapshot.pgy.starTaskNoteCount = null;
  snapshot.pgy.overdueNoteCount = null;
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.equal(Object.prototype.hasOwnProperty.call(harness.pgyAggregateCalls[0], 'starNoteIds'), false);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>1<\/strong>/);
});

test('PGY task and overdue counts remain fact-derived while Star coverage is partial', () => {
  const harness = createPgyReportHarness();
  const snapshot = pgySnapshot();
  snapshot.selectedPlatforms = ['pgy', 'adstar'];
  snapshot.star.coverage = 'partial';
  snapshot.notes = [{ noteId: 'fictional-pgy-ui-v3-note-jan' }];
  snapshot.pgy.starTaskNoteCount = null;
  snapshot.pgy.overdueNoteCount = null;
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.equal(Object.prototype.hasOwnProperty.call(harness.pgyAggregateCalls[0], 'starNoteIds'), false);
  assert.match(panel, /星河任务笔记数[\s\S]*?<strong>2<\/strong>/);
  assert.match(panel, /超期笔记数[\s\S]*?<strong>1<\/strong>/);
});

test('an intermediate inverted PGY range keeps both controls enabled so the user can finish editing', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });
  harness.api.buildPgyMarkup();

  harness.api.changePgyDate('from', '2030-04-01');
  const intermediate = pgyPanel(harness.api.buildPgyMarkup());
  for (const boundary of ['from', 'to']) {
    const control = intermediate.match(new RegExp(
      `<input[^>]*data-xhs-pgy-date="${boundary}"[^>]*>`,
    ));
    assert.ok(control, `missing editable PGY ${boundary} control`);
    assert.doesNotMatch(control[0], /\sdisabled(?:\s|>)/,
      'a temporary invalid interval must not trap the user in a disabled state');
  }

  harness.api.changePgyDate('to', '2030-04-30');
  const completed = pgyPanel(harness.api.buildPgyMarkup());
  assert.match(completed, /时间筛选内笔记数[\s\S]*?<strong>1<\/strong>/);
  assert.match(completed, /达人花费[\s\S]*?<strong>¥990<\/strong>/);
});

test('legacy PGY archives without facts keep their summary but disable date filtering without platform refetch', () => {
  const harness = createPgyReportHarness();
  const legacy = pgySnapshot();
  delete legacy.pgy.facts;
  delete legacy.pgy.collectionScope;
  harness.api.setState({ status: collectionStatus(), analysis: legacy });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.equal(harness.pgyAggregateCalls.length, 0,
    'a legacy summary must not be passed off as fact-level data');
  assert.match(panel, /旧归档缺少蒲公英笔记事实，发布日期筛选已禁用；报告页不会重新请求平台。/);
  for (const boundary of ['from', 'to']) {
    const control = panel.match(new RegExp(
      `<input[^>]*data-xhs-pgy-date="${boundary}"[^>]*>`,
    ));
    assert.ok(control, `missing disabled legacy PGY ${boundary} control`);
    assert.match(control[0], /\sdisabled(?:\s|>)/);
    assert.match(control[0], /aria-disabled="true"/);
  }
  assert.match(panel, /时间筛选内笔记数[\s\S]*?<strong>77<\/strong>/,
    'old archives must continue showing their stored aggregate');
});
