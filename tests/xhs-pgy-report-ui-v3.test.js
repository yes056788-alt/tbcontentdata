const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const realXhsReportModel = require('../xhs/report-model');

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

function createPgyReportHarness() {
  const source = read('web-tool/report.js');
  const sideEffectsStart = source.indexOf('  window.TaobaoReportExport = Object.freeze({');
  assert.ok(sideEffectsStart > 0, 'report side-effect marker');
  const pgyChangeHandler = extractPgyChangeHandler(source);
  const instrumented = source.slice(0, sideEffectsStart) + `
  const __xhsPgyChangeHandler = ${pgyChangeHandler};
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
  };
  const windowObject = {
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
  facts[0].noteUrl = 'https://www.xiaohongshu.com/explore/fictional-pgy-ui-v3-note-jan';
  facts[0].taobaoSamplingRatio = 0.5;
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
  Object.assign(facts[1].metrics, {
    taobaoOffsiteActiveUv15d: 20,
    taobaoOffsiteActiveCost15d: 2.75,
    taobaoDealUv15d: 4,
    taobaoAddCartUv15d: 5,
    taobaoAddCartRate15d: 0.77,
    taobaoPurchaseRate15d: 0.66,
  });
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

test('PGY note analysis is a clickable drilldown sourced from PGY facts and filterable by cross-domain project', () => {
  const harness = createPgyReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: pgySnapshot() });

  const panel = pgyPanel(harness.api.buildPgyMarkup());
  assert.match(panel, /<button[^>]*data-xhs-pgy-note-toggle[^>]*aria-expanded="false"[^>]*>[\s\S]*笔记分析/);
  assert.match(panel, /<select[^>]*data-xhs-pgy-project[^>]*>[\s\S]*虚构跨域项目 A[\s\S]*虚构跨域项目 B/);
  assert.match(panel, /data-xhs-pgy-note-id="fictional-pgy-ui-v3-note-jan"/);
  assert.match(panel, /href="https:\/\/www\.xiaohongshu\.com\/explore\/fictional-pgy-ui-v3-note-jan"/);
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
