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

function createReportHarness(options) {
  const config = options && typeof options === 'object' ? options : {};
  const source = read('web-tool/report.js');
  const sideEffectsStart = source.indexOf('  window.TaobaoReportExport = Object.freeze({');
  assert.ok(sideEffectsStart > 0, 'report side-effect marker');
  const changeListenerMarker = '  if (xhsJuguangReport) xhsJuguangReport.addEventListener("change", ';
  const changeListenerStart = source.indexOf(changeListenerMarker);
  const changeHandlerStart = changeListenerStart + changeListenerMarker.length;
  const changeHandlerEnd = source.indexOf('\n  });\n\n  render();', changeHandlerStart);
  assert.ok(changeListenerStart > sideEffectsStart && changeHandlerEnd > changeHandlerStart,
    'Juguang change-handler marker');
  const changeHandlerExpression = source.slice(changeHandlerStart, changeHandlerEnd + 4);
  const instrumented = source.slice(0, sideEffectsStart) + `
  const __xhsJuguangChangeHandler = ${changeHandlerExpression};
  window.__xhsReportUiV2Test = Object.freeze({
    setState(value) {
      const state = value && typeof value === 'object' ? value : {};
      xhsStatus = state.status && typeof state.status === 'object' ? state.status : {};
      xhsAnalysis = state.analysis && typeof state.analysis === 'object' ? state.analysis : null;
    },
    setActiveSection(value) {
      activeSection = String(value || 'flow');
    },
    setJuguangState(value) {
      const state = value && typeof value === 'object' ? value : {};
      if (state.mode === 'single' || state.mode === 'multi') xhsJuguangMode = state.mode;
      if (Array.isArray(state.groupBy)) xhsJuguangGroupBy = state.groupBy.slice();
      if (state.filters && typeof state.filters === 'object') {
        xhsJuguangFilters = {
          accountIds: Array.isArray(state.filters.accountIds) ? state.filters.accountIds.slice() : [],
          marketingObjectives: Array.isArray(state.filters.marketingObjectives)
            ? state.filters.marketingObjectives.slice() : [],
          placementTypes: Array.isArray(state.filters.placementTypes) ? state.filters.placementTypes.slice() : [],
        };
      }
    },
    changeJuguangControl(value) {
      const state = value && typeof value === 'object' ? value : {};
      const attribute = String(state.attribute || '');
      const attributes = Object.create(null);
      if (attribute) attributes[attribute] = String(state.attributeValue || '');
      const control = {
        value: state.value == null ? '' : String(state.value),
        checked: state.checked === true,
        closest() { return this; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name); },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
      };
      __xhsJuguangChangeHandler({ target: control });
    },
    getJuguangState() {
      return {
        mode: xhsJuguangMode,
        groupBy: xhsJuguangGroupBy.slice(),
        filters: {
          accountIds: xhsJuguangFilters.accountIds.slice(),
          marketingObjectives: xhsJuguangFilters.marketingObjectives.slice(),
          placementTypes: Array.isArray(xhsJuguangFilters.placementTypes)
            ? xhsJuguangFilters.placementTypes.slice() : [],
        },
      };
    },
    buildXhsMarkup,
    buildExportReportDocument,
  });
})();`;
  const aggregateCalls = [];
  const reportModel = {
    standaloneSource: realXhsReportModel.standaloneSource,
    aggregateSpotlight(input) {
      aggregateCalls.push(structuredClone(input));
      return {
        groupBy: Array.isArray(input && input.groupBy) ? input.groupBy : [],
        summary: {
          spend: { total: 97, inTask: 30, outsideTask: 60, unknown: 7 },
          impressions: 9000,
          clicks: 900,
          interactions: 180,
          seedUsers: 90,
          deepSeedUsers: 45,
          seedingExternal15: {
            observability: 'observable', seedingSpend: 30, activeUv: 6, calculatedCost: 5,
          },
          conversion15: {
            observability: 'observable', directSpend: 60, storeVisits: 30,
            orders: 6, gmv: 300, calculatedRoi15: 5, platformRoi15: null,
          },
        },
        groups: [{
          dimension: 'account', key: 'fictional-ad-account', label: '虚构广告账户', level: 1,
          summary: {
            spend: { total: 97, inTask: 30, outsideTask: 60, unknown: 7 },
            impressions: 9000, clicks: 900, interactions: 180,
            seedUsers: 90, deepSeedUsers: 45,
            seedingExternal15: {
              observability: 'observable', seedingSpend: 30, activeUv: 6, calculatedCost: 5,
            },
            conversion15: {
              observability: 'observable', directSpend: 60, storeVisits: 30,
              orders: 6, gmv: 300, calculatedRoi15: 5, platformRoi15: 4.8,
            },
          },
          children: [],
        }],
      };
    },
  };
  const windowObject = {
    XhsReportModel: Object.prototype.hasOwnProperty.call(config, 'reportModel')
      ? config.reportModel
      : reportModel,
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
  vm.runInNewContext(instrumented, {
    Array,
    Boolean,
    Date,
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
  return { api: windowObject.__xhsReportUiV2Test, aggregateCalls };
}

function uiSnapshot() {
  const starMetrics = {
    readUv: 1000,
    engagementUv: 200,
    storeVisitUv: 200,
    visitRate: 0.2,
    visitCost: 2.6,
    gmv: 2000,
    seededProductGmv: 800,
  };
  return {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'fictional-ui-v2-run',
    generatedAt: '2030-04-01T00:00:00.000Z',
    dateRange: { from: '2030-01-01', to: '2030-03-31', timezone: 'Asia/Shanghai' },
    quality: { decisionReady: true, issues: [] },
    accounts: {},
    management: {
      costs: {
        cooperation: 400, platformFee: 40, partnership: 440,
        juguang: 90, total: 530, starTaskAligned: 470,
      },
      accountOverview: {
        totalSpend: 530,
        creatorSpend: 440,
        adSpend: 90,
        starAlignedSpend: 470,
        taskAdSpend: 30,
        outsideTaskAdSpend: 60,
        unknownTaskAdSpend: 0,
        taskRoi: 800 / 470,
        outsideDirectRoi: 5,
        directRoi: 4.5,
      },
    },
    pgy: {
      noteCount: 8,
      starTaskNoteCount: 3,
      costs: { cooperation: 400, platformFee: 40, total: 440 },
      metrics: {
        impressions: 10000, reads: 4000, interactions: 600,
        readRate: 0.4, engagementRate: 0.15,
      },
      monthly: [
        { month: '2030-01', noteCount: 3 },
        { month: '2030-02', noteCount: 2 },
        { month: '2030-03', noteCount: 3 },
      ],
      followerTiers: [
        { key: '1k_5k', label: '1K-5K', noteCount: 2, averageCooperationCost: 100 },
        { key: '5k_10k', label: '5K-1W', noteCount: 1, averageCooperationCost: 200 },
        { key: '10k_100k', label: '1W-10W', noteCount: 2, averageCooperationCost: 300 },
        { key: '100k_500k', label: '10W-50W', noteCount: 2, averageCooperationCost: 400 },
        { key: '500k_plus', label: '50W+', noteCount: 1, averageCooperationCost: 500 },
      ],
    },
    spotlight: {
      daily: [{
        noteId: 'fictional-note-a', date: '2030-01-02',
        accountId: 'fictional-ad-account', accountName: '虚构广告账户',
        marketingObjective: 'direct', placementType: 'fixture-feed',
        deliveryMode: 'fictional-mode', taskStatus: 'in_task',
        spend: 90, impressions: 9000, clicks: 900, interactions: 180,
        seedUsers: 90, deepSeedUsers: 45,
        conversion: { observable: true, storeVisits: 30, orders: 6, gmv: 300, platformRoi15: 4.8 },
        seedingExternal15: {
          observable: false, activeUv: null, platformRate: null, platformCost: null,
        },
      }],
    },
    star: {
      store: {
        costs: { total: 470, creator: 440, adInTask: 30 },
        metrics: starMetrics,
        storeRoi: 2000 / 470,
        taskRoi: 800 / 470,
      },
      taskSummary: {
        activeNoteCount: 3,
        gmv: 800,
        costs: { total: 470, creator: 440, adInTask: 30 },
        roi: 800 / 470,
      },
      projects: [{
        id: 'fictional-project-1', name: '虚构星河项目', status: 'complete',
        metrics: { readUv: 700, storeVisitUv: 140, gmv: 1200, seededProductGmv: 500 },
        orders: [{
          id: 'fictional-order-1', name: '虚构星河订单', status: 'complete',
          metrics: { readUv: 500, storeVisitUv: 100, gmv: 900, seededProductGmv: 400 },
        }],
      }],
    },
    notes: [
      {
        noteId: 'fictional-note-a', title: '虚构本期笔记', publishDate: '2030-01-05',
        pgy: { includedInPeriod: true, metrics: { impressions: 100, reads: 50, interactions: 10 } },
        costs: { cooperation: 100, platformFee: 10, juguang: 30, total: 140 },
        results: { starTaskGmv: 100, starTaskRoi: 100 / 140 },
      },
      {
        noteId: 'fictional-note-b', title: '虚构期外发布笔记', publishDate: '2029-12-15',
        pgy: { includedInPeriod: false, metrics: { impressions: 200, reads: 80, interactions: 12 } },
        costs: { cooperation: 200, platformFee: 20, juguang: 60, total: 280 },
        results: { starTaskGmv: 200, starTaskRoi: 200 / 280 },
      },
    ],
    actions: [],
  };
}

function collectionStatus() {
  return {
    status: 'complete',
    platforms: {
      adstar: { status: 'complete', collectedAt: '2030-04-01T00:00:00.000Z' },
      pgy: { status: 'complete', collectedAt: '2030-04-01T00:01:00.000Z' },
      juguang: { status: 'complete', collectedAt: '2030-04-01T00:02:00.000Z' },
    },
  };
}

function multiLevelJuguangSnapshot() {
  const snapshot = uiSnapshot();
  snapshot.spotlight = {
    daily: [
      {
        noteId: 'fictional-note-a1', date: '2030-01-02',
        accountId: 'fictional-account-a', accountName: '虚构聚光账户 A',
        marketingObjective: 'direct', placementType: 'fixture-feed', deliveryMode: 0,
        taskStatus: 'in_task',
        spend: 30, impressions: 3000, clicks: 300, interactions: 60,
        seedUsers: 30, deepSeedUsers: 15,
        conversion: { observable: true, storeVisits: 12, orders: 3, gmv: 120, platformRoi15: 4 },
        seedingExternal15: {
          observable: false, activeUv: null, platformRate: null, platformCost: null,
        },
      },
      {
        noteId: 'fictional-note-a2', date: '2030-01-03',
        accountId: 'fictional-account-a', accountName: '虚构聚光账户 A',
        marketingObjective: 'direct', placementType: 'fixture-search', deliveryMode: 1,
        taskStatus: 'out_of_task',
        spend: 20, impressions: 2000, clicks: 200, interactions: 40,
        seedUsers: 20, deepSeedUsers: 10,
        conversion: { observable: true, storeVisits: 8, orders: 2, gmv: 80, platformRoi15: 4 },
        seedingExternal15: {
          observable: false, activeUv: null, platformRate: null, platformCost: null,
        },
      },
      {
        noteId: 'fictional-note-a3', date: '2030-01-04',
        accountId: 'fictional-account-a', accountName: '虚构聚光账户 A',
        marketingObjective: 'product_seeding', placementType: 'fixture-feed', deliveryMode: 0,
        taskStatus: 'unknown',
        spend: 5, impressions: 500, clicks: 50, interactions: 10,
        seedUsers: 5, deepSeedUsers: 2,
        conversion: { observable: false, storeVisits: null, orders: null, gmv: null, platformRoi15: null },
        seedingExternal15: { observable: true, activeUv: 1, platformRate: 0.2, platformCost: 5 },
      },
      {
        noteId: 'fictional-note-b1', date: '2030-01-05',
        accountId: 'fictional-account-b', accountName: '虚构聚光账户 B',
        marketingObjective: 'direct', placementType: 'fixture-search', deliveryMode: 1,
        taskStatus: 'out_of_task',
        spend: 40, impressions: 4000, clicks: 400, interactions: 80,
        seedUsers: 40, deepSeedUsers: 20,
        conversion: { observable: true, storeVisits: 16, orders: 4, gmv: 160, platformRoi15: 4 },
        seedingExternal15: {
          observable: false, activeUv: null, platformRate: null, platformCost: null,
        },
      },
    ],
    byAccount: [
      { key: 'fictional-account-a', label: '虚构聚光账户 A', platformRoi15: null },
      { key: 'fictional-account-b', label: '虚构聚光账户 B', platformRoi15: 4 },
    ],
  };
  return snapshot;
}

function juguangPanel(markup) {
  return markup.slice(
    markup.indexOf('data-xhs-panel="juguang-analysis"'),
    markup.indexOf('data-xhs-panel="star-analysis"'),
  );
}

function juguangTreeRows(panel) {
  return [...panel.matchAll(/<tr data-xhs-juguang-level="(\d+)">([\s\S]*?)<\/tr>/g)].map((match) => ({
    level: Number(match[1]),
    html: match[0],
  }));
}

function stripMarkup(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function juguangTotalValues(panel) {
  const headerMatch = panel.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  const totalMatch = panel.match(/<tr class="xhs-total-row">([\s\S]*?)<\/tr>/);
  assert.ok(headerMatch, 'missing Juguang table headers');
  assert.ok(totalMatch, 'missing Juguang filtered-total row');
  const headers = [...headerMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((match) => stripMarkup(match[1]));
  const cells = [...totalMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
    .map((match) => stripMarkup(match[1]));
  assert.equal(cells.length, headers.length, 'Juguang total cells must align with table headers');
  return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
}

function seedingMetricsSnapshot() {
  const snapshot = multiLevelJuguangSnapshot();
  const seeding = snapshot.spotlight.daily.find((row) => (
    row.marketingObjective === 'product_seeding'
  ));
  seeding.spend = 50;
  seeding.impressions = 5000;
  seeding.clicks = 500;
  seeding.interactions = 100;
  seeding.seedUsers = 50;
  seeding.deepSeedUsers = 25;
  seeding.seedingExternal15 = {
    observable: true,
    activeUv: 7,
    platformRate: 0.35,
    platformCost: 999,
  };
  return snapshot;
}

test('report viewer loads the pure XHS report model before report.js', () => {
  const html = read('web-tool/report-view.html');
  const modelIndex = html.indexOf('/xhs-report-model.js');
  const reportIndex = html.indexOf('/report.js');

  assert.ok(modelIndex >= 0, 'report-view must load /xhs-report-model.js');
  assert.ok(reportIndex > modelIndex, 'xhs-report-model.js must load before report.js');
});

test('VM report contract renders all V2 chapters, accessible PGY charts, Juguang controls and nested Star units', () => {
  const harness = createReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: uiSnapshot() });
  const markup = harness.api.buildXhsMarkup();

  for (const panel of [
    'account-overview', 'pgy-analysis', 'juguang-analysis', 'star-analysis', 'note-join',
  ]) {
    assert.match(markup, new RegExp(`data-xhs-panel=["']${panel}["']`), `missing ${panel}`);
  }
  for (const label of [
    '账户总览', '总投入', '达人花费', '广告花费',
    '蒲公英分析', '时间筛选内笔记数', '星河任务笔记数',
    '按月发布笔记', '达人粉丝量级',
    '聚光投放分析', '星河全店汇总', '星河任务汇总',
    '星河项目', '虚构星河订单', '笔记全链路',
  ]) assert.ok(markup.includes(label), `missing report label: ${label}`);

  assert.match(markup, /class=["'][^"']*xhs-bar-chart[^"']*["']/);
  assert.match(markup, /(?:role=["'](?:img|list)["']|<figure)[\s\S]*1K-5K/,
    'follower-tier chart must expose a semantic chart/list container');
  assert.match(markup, /1K-5K[\s\S]*平均合作费用/);
  assert.match(markup, /2030-01[\s\S]*2030-02[\s\S]*2030-03/);

  for (const filter of ['account', 'marketingObjective', 'placementType']) {
    assert.match(markup, new RegExp(`data-xhs-juguang-filter=["']${filter}["']`),
      `missing Juguang ${filter} filter`);
  }
  assert.match(markup, /data-xhs-juguang-mode=["'][^"']*["'][\s\S]*(?:single|单层)/);
  assert.match(markup, /data-xhs-juguang-mode=["'][^"']*["'][\s\S]*(?:multi|多层)/);
  assert.match(markup, /data-xhs-juguang-group-by=/);
  assert.match(markup, /任务期按笔记关联的星河任务起止日期逐日判定/,
    'the report must explain the task-period rule next to Juguang analysis');
  assert.ok(harness.aggregateCalls.length > 0, 'report must delegate Juguang aggregation to XhsReportModel');

  const projectIndex = markup.indexOf('fictional-project-1');
  const orderIndex = markup.indexOf('fictional-order-1');
  assert.ok(projectIndex >= 0 && orderIndex > projectIndex, 'Star orders must render inside/after their project');
  assert.equal(markup.includes('分摊成本'), false, 'project/order report must never render allocated cost');
  assert.match(markup, /data-pgy-included-in-period=["']false["'][\s\S]{0,300}期外/,
    'joined notes must visibly mark PGY rows excluded from period spend');
});

test('report source exposes keyboard-friendly placement grouping and all required Juguang metrics', () => {
  const source = read('web-tool/report.js');

  assert.match(source, /XhsReportModel[\s\S]*aggregateSpotlight|aggregateSpotlight[\s\S]*XhsReportModel/);
  assert.match(source, /data-xhs-juguang-(?:filter|group-by|mode)/);
  assert.match(source, /addEventListener\(["']change["']/);
  assert.match(source, /aria-label|<label/);
  for (const metric of [
    '总消耗', '任务期内消耗', '任务期外消耗', '任务周期未知消耗',
    '曝光', '点击', '互动', '新增种草人群', '新增深度种草人群',
    '产品种草15日站外活跃UV', '站外行为成本',
    '外链进店数', '15日成交订单数', '15日成交 GMV', '平台原始 ROI',
  ]) assert.ok(source.includes(metric), `missing Juguang metric: ${metric}`);
  assert.match(source, /colspan=["']17["']/,
    'an empty Juguang result must span the dimension plus sixteen metrics');
});

test('Juguang table reconciles total spend across in-task, outside-task and unknown-task buckets', () => {
  const harness = createReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: uiSnapshot() });
  const markup = harness.api.buildXhsMarkup();

  assert.match(markup,
    /任务期外消耗<\/th><th>任务周期未知消耗<\/th><th>曝光/,
    'unknown task spend must be a visible column next to the other task buckets');
  assert.match(markup,
    /筛选后总计[\s\S]*?¥97[\s\S]*?¥30[\s\S]*?¥60[\s\S]*?¥7/,
    'the displayed total must reconcile as 30 + 60 + 7 = 97');
});

test('switching from a single objective view back to multi restores the real three-level hierarchy', () => {
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  harness.api.setState({ status: collectionStatus(), analysis: multiLevelJuguangSnapshot() });

  harness.api.changeJuguangControl({
    attribute: 'data-xhs-juguang-mode',
    attributeValue: 'selector',
    value: 'single',
  });
  harness.api.changeJuguangControl({
    attribute: 'data-xhs-juguang-group-by',
    attributeValue: 'marketingObjective',
    checked: true,
  });
  harness.api.changeJuguangControl({
    attribute: 'data-xhs-juguang-mode',
    attributeValue: 'selector',
    value: 'multi',
  });

  const state = harness.api.getJuguangState();
  assert.equal(state.mode, 'multi');
  assert.deepEqual([...state.groupBy], ['account', 'marketingObjective', 'placementType'],
    'multi mode must not retain the previous single marketing-objective dimension');
});

test('multi-level Juguang renders account > objective > placement spend and reconciles after filtering', () => {
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  harness.api.setState({ status: collectionStatus(), analysis: multiLevelJuguangSnapshot() });
  harness.api.setJuguangState({
    mode: 'multi',
    groupBy: ['account', 'marketingObjective', 'placementType'],
    filters: {
      accountIds: ['fictional-account-a'],
      marketingObjectives: [],
      placementTypes: [],
    },
  });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const rows = juguangTreeRows(panel);
  assert.deepEqual(rows.map((row) => row.level), [1, 2, 3, 3, 2, 3],
    'filtered hierarchy must remain visibly indented across all three selected dimensions');
  const account = rows.find((row) => row.level === 1 && row.html.includes('虚构聚光账户 A'));
  const direct = rows.find((row) => row.level === 2 && row.html.includes('种草直达'));
  const feedDirect = rows.find((row) => row.level === 3 && row.html.includes('fixture-feed') &&
    /<td>¥30<\/td><td>¥30<\/td>/.test(row.html));
  assert.ok(account, 'missing account-level row');
  assert.ok(direct, 'missing objective-level row');
  assert.ok(feedDirect, 'missing placement-level row');
  assert.match(account.html, /<td>¥55<\/td><td>¥30<\/td><td>¥20<\/td><td>¥5<\/td>/,
    'account spend must reconcile as 55 = 30 in-task + 20 outside-task + 5 unknown');
  assert.match(direct.html, /<td>¥50<\/td><td>¥30<\/td><td>¥20<\/td><td>¥0<\/td>/,
    'objective spend buckets must be populated at level 2');
  assert.match(feedDirect.html, /<td>¥30<\/td><td>¥30<\/td><td>¥0<\/td><td>¥0<\/td>/,
    'placement spend buckets must be populated at level 3');
  assert.match(panel,
    /筛选后总计<\/th><td>¥55<\/td><td>¥30<\/td><td>¥20<\/td><td>¥5<\/td>/,
    'filtered total must reconcile to the visible account subtree');
});

test('Juguang defaults to account > objective > placement and exposes only the real placement control', () => {
  const calls = [];
  const harness = createReportHarness({
    reportModel: {
      aggregateSpotlight(input) {
        calls.push(structuredClone(input));
        return realXhsReportModel.aggregateSpotlight(input);
      },
    },
  });
  harness.api.setState({ status: collectionStatus(), analysis: multiLevelJuguangSnapshot() });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const state = harness.api.getJuguangState();
  assert.deepEqual([...state.groupBy], ['account', 'marketingObjective', 'placementType']);
  assert.match(panel, /账户 → 营销诉求 → 投放位置/);
  assert.match(panel, /data-xhs-juguang-filter="placementType"/);
  assert.match(panel, /data-xhs-juguang-filter="placementType"[\s\S]{0,300}<option value="fixture-feed">fixture-feed<\/option>/);
  assert.match(panel, /data-xhs-juguang-filter="placementType"[\s\S]{0,400}<option value="fixture-search">fixture-search<\/option>/);
  assert.match(panel, /data-xhs-juguang-group-by="placementType"[^>]*checked[^>]*>[\s\S]{0,80}<span>投放位置<\/span>/);
  assert.doesNotMatch(panel, /data-xhs-juguang-(?:filter|group-by)="deliveryMode"|按投放模式筛选/);
  assert.deepEqual([...calls.at(-1).groupBy], ['account', 'marketingObjective', 'placementType']);
  assert.equal(Object.prototype.hasOwnProperty.call(calls.at(-1).filters, 'deliveryModes'), false,
    'the legacy delivery-mode filter must not leak into the new UI model request');
});

test('changing the placement filter updates state, model input, and the rendered filtered total', () => {
  const calls = [];
  const harness = createReportHarness({
    reportModel: {
      aggregateSpotlight(input) {
        calls.push(structuredClone(input));
        return realXhsReportModel.aggregateSpotlight(input);
      },
    },
  });
  harness.api.setState({ status: collectionStatus(), analysis: multiLevelJuguangSnapshot() });

  harness.api.changeJuguangControl({
    attribute: 'data-xhs-juguang-filter',
    attributeValue: 'placementType',
    value: 'fixture-feed',
  });
  assert.deepEqual([...harness.api.getJuguangState().filters.placementTypes], ['fixture-feed']);

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const input = calls.at(-1);
  assert.deepEqual([...input.filters.placementTypes], ['fixture-feed']);
  assert.equal(Object.prototype.hasOwnProperty.call(input.filters, 'deliveryModes'), false);
  assert.equal(juguangTotalValues(panel)['总消耗'], '¥35',
    'fixture-feed must retain only the 30 direct spend and 5 product-seeding spend');
});

test('Juguang table displays aggregate product-seeding 15-day external UV and recalculated cost', () => {
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  harness.api.setState({ status: collectionStatus(), analysis: seedingMetricsSnapshot() });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const values = juguangTotalValues(panel);
  assert.equal(values['产品种草15日站外活跃UV'], '7');
  assert.equal(values['站外行为成本'], '¥7.14',
    'the UI must render 50 / 7 instead of the fictional platform cost 999');
});

test('partial product-seeding external facts render unknown UV/cost with a visible explanation', () => {
  const snapshot = seedingMetricsSnapshot();
  snapshot.spotlight.daily.push({
    noteId: 'fictional-note-seeding-partial',
    date: '2030-01-05',
    accountId: 'fictional-account-a',
    accountName: '虚构聚光账户 A',
    marketingObjective: 'product_seeding',
    placementType: 'fixture-search',
    deliveryMode: 1,
    taskStatus: 'unknown',
    spend: 10,
    impressions: 1000,
    clicks: 100,
    interactions: 20,
    seedUsers: 10,
    deepSeedUsers: 5,
    conversion: {
      observable: false, storeVisits: null, orders: null, gmv: null, platformRoi15: null,
    },
    seedingExternal15: {
      observable: false, activeUv: null, platformRate: 0.1, platformCost: 10,
    },
  });
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const values = juguangTotalValues(panel);
  assert.equal(values['产品种草15日站外活跃UV'], '—');
  assert.equal(values['站外行为成本'], '—');
  assert.match(panel, /产品种草[\s\S]{0,100}(?:部分|缺少|不完整)[\s\S]{0,100}(?:未知|不可用|重新取数)/,
    'partial offsite facts need a visible reason for the dashes');
});

test('zero product-seeding external UV renders zero UV, unknown cost, and a zero-denominator note', () => {
  const snapshot = seedingMetricsSnapshot();
  const seeding = snapshot.spotlight.daily.find((row) => (
    row.marketingObjective === 'product_seeding'
  ));
  seeding.seedingExternal15 = {
    observable: true,
    activeUv: 0,
    platformRate: 0,
    platformCost: 0,
  };
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  const values = juguangTotalValues(panel);
  assert.equal(values['产品种草15日站外活跃UV'], '0');
  assert.equal(values['站外行为成本'], '—');
  assert.match(panel, /站外活跃\s*UV[\s\S]{0,60}(?:为\s*0|零分母)[\s\S]{0,80}(?:无法计算|不可用)/,
    'zero UV must explain why the calculated cost is unavailable');
});

test('legacy daily rows with only deliveryMode do not masquerade as placement and disable the new dimension', () => {
  const snapshot = multiLevelJuguangSnapshot();
  snapshot.spotlight.daily.forEach((row) => {
    row.placementType = null;
    delete row.seedingExternal15;
  });
  snapshot.spotlight.byDeliveryMode = [
    { key: 0, spend: 35 },
    { key: 1, spend: 60 },
  ];
  const calls = [];
  const harness = createReportHarness({
    reportModel: {
      aggregateSpotlight(input) {
        calls.push(structuredClone(input));
        return realXhsReportModel.aggregateSpotlight(input);
      },
    },
  });
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  assert.match(panel, /旧归档[\s\S]{0,100}(?:真实)?投放位置[\s\S]{0,100}(?:不可用|缺少|重新取数)/);
  assert.match(panel, /data-xhs-juguang-filter="placementType"[^>]*\sdisabled(?:\s|>)/);
  assert.match(panel, /data-xhs-juguang-group-by="placementType"[^>]*\sdisabled(?:\s|>)/);
  assert.doesNotMatch(panel, /手动投放|自动投放|data-xhs-juguang-(?:filter|group-by)="deliveryMode"/);
  assert.equal(calls.at(-1).groupBy.includes('deliveryMode'), false);
  assert.equal(calls.at(-1).groupBy.includes('placementType'), false,
    'an unavailable dimension must not create a fake all-unknown placement level');
});

test('Star renders project and task summaries without nesting note details', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  const project = snapshot.star.projects[0];
  const order = project.orders[0];
  project.costs = { creator: 110, adInTask: 30, total: 140 };
  order.costs = { creator: 110, adInTask: 30, total: 140 };
  order.notes = [{
    noteId: 'fictional-note-a',
    title: '虚构本期笔记',
    publishDate: '2030-01-05',
    metrics: { readUv: 100, storeVisitUv: 20, gmv: 300, seededProductGmv: 100 },
    costs: { creator: 110, adInTask: 30, total: 140 },
    ownership: {
      projectId: project.id,
      orderId: order.id,
      candidateOrderIds: [order.id],
      rule: 'publish_date_interval_then_order_start_then_order_id',
    },
  }];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const markup = harness.api.buildXhsMarkup();
  const projectIndex = markup.indexOf(`data-xhs-star-project="${project.id}"`);
  const taskIndex = markup.indexOf(`data-xhs-star-task="${order.id}"`);
  const notePanelIndex = markup.indexOf('data-xhs-panel="note-join"');
  assert.ok(taskIndex >= 0 && projectIndex > taskIndex && notePanelIndex > projectIndex,
    '任务报表应位于任务汇总下并先于项目汇总，同时保留现有业务身份');
  const starPanel = markup.slice(markup.indexOf('data-xhs-panel="star-analysis"'), notePanelIndex);
  assert.match(starPanel, /星河任务汇总[\s\S]*?data-xhs-star-toggle="task"[\s\S]*?项目汇总/);
  assert.match(starPanel, /项目汇总[\s\S]*?默认展示项目级汇总数据/);
  for (const amount of ['¥140', '¥110', '¥30']) {
    assert.match(starPanel, new RegExp(amount.replace('¥', '¥')));
  }
  assert.doesNotMatch(markup.slice(projectIndex, notePanelIndex),
    /data-xhs-star-note=|fictional-note-a|虚构本期笔记/,
    'project/task summaries must not embed note detail nodes');
  assert.doesNotMatch(markup, /分摊花费|分摊成本|allocatedCost/);
});

test('legacy flat Star orders are attached to their project by projectId', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  const project = snapshot.star.projects[0];
  const order = project.orders[0];
  order.projectId = project.id;
  project.orders = [];
  snapshot.star.orders = [order];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const markup = harness.api.buildXhsMarkup();
  const projectIndex = markup.indexOf(`data-xhs-star-project="${project.id}"`);
  const orderIndex = markup.indexOf(`data-xhs-star-task="${order.id}"`);
  assert.ok(orderIndex >= 0 && projectIndex > orderIndex,
    'a legacy top-level order must be available under task summary before its matching project summary');
  assert.match(markup, new RegExp(`data-xhs-star-project="${project.id}"[\\s\\S]*?<td>1<\\/td>`),
    'the project-level summary must count the flattened task once');
});

test('legacy Juguang without daily facts explains that multi-level and task-period analysis are unavailable', () => {
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  const snapshot = uiSnapshot();
  snapshot.spotlight = {
    daily: [],
    total: { spend: 70, impressions: 7000, clicks: 700, interactions: 140 },
    byAccount: [{ key: 'fictional-account-a', label: '虚构聚光账户 A', spend: 70 }],
    byMarketingObjective: [{ key: 'direct', spend: 70, impressions: 7000, clicks: 700, interactions: 140 }],
    byDeliveryMode: [{ key: 0, spend: 70, impressions: 7000, clicks: 700, interactions: 140 }],
  };
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  harness.api.setJuguangState({
    mode: 'multi',
    groupBy: ['account', 'marketingObjective', 'placementType'],
  });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  assert.match(panel, /旧归档缺少聚光逐日明细，无法进行多层分析和任务周期拆分；请重新取数。/,
    'legacy marginal summaries must not masquerade as an operational multi-level tree');
  assert.match(panel, /data-xhs-juguang-mode="selector"[^>]*\sdisabled(?:\s|>)/,
    'multi-level mode must be disabled when the required daily facts are absent');
});

test('daily Juguang fails closed with a visible warning when the report model asset is unavailable', () => {
  const harness = createReportHarness({ reportModel: null });
  harness.api.setState({ status: collectionStatus(), analysis: multiLevelJuguangSnapshot() });

  const panel = juguangPanel(harness.api.buildXhsMarkup());
  assert.match(panel, /聚光多层分析模型未加载，请刷新报告页或联系管理员检查网页资源部署。/);
  assert.match(panel, /data-xhs-juguang-mode="selector"[^>]*\sdisabled(?:\s|>)/,
    'missing report model must not silently expose a fake multi-level selector');
  assert.doesNotMatch(panel, /data-xhs-juguang-level="2"|data-xhs-juguang-level="3"/);
});

test('missing Juguang source renders unknown while a real zero-spend summary stays zero', () => {
  const harness = createReportHarness();
  const missing = uiSnapshot();
  missing.spotlight = { total: null, daily: [], byMarketingObjective: [] };
  harness.api.setState({ status: collectionStatus(), analysis: missing });
  const missingMarkup = harness.api.buildXhsMarkup();
  const missingPanel = missingMarkup.slice(
    missingMarkup.indexOf('data-xhs-panel="juguang-analysis"'),
    missingMarkup.indexOf('data-xhs-panel="star-analysis"'),
  );
  assert.doesNotMatch(missingPanel, /¥0(?:\.00)?/,
    'a failed or unselected Juguang source must not be rendered as zero spend');
  assert.match(missingPanel, /筛选后总计[\s\S]*?—/);

  const verifiedZero = uiSnapshot();
  verifiedZero.spotlight = {
    total: {
      spend: 0,
      impressions: 0,
      clicks: 0,
      interactions: 0,
      seedUsers: 0,
      deepSeedUsers: 0,
      storeVisits: null,
      orders: null,
      gmv: null,
      roi: null,
    },
    daily: [],
    byMarketingObjective: [],
  };
  harness.api.setState({ status: collectionStatus(), analysis: verifiedZero });
  const zeroMarkup = harness.api.buildXhsMarkup();
  const zeroPanel = zeroMarkup.slice(
    zeroMarkup.indexOf('data-xhs-panel="juguang-analysis"'),
    zeroMarkup.indexOf('data-xhs-panel="star-analysis"'),
  );
  assert.match(zeroPanel, /筛选后总计[\s\S]*?¥0/,
    'a real summary with spend=0 must remain a numeric zero');
});

test('Star summary nulls stay unknown while note totals use the approved cost formula', () => {
  const harness = createReportHarness();
  const explicitNulls = uiSnapshot();
  explicitNulls.management.accountOverview = {
    totalSpend: null,
    creatorSpend: null,
    adSpend: null,
    starAlignedSpend: null,
    taskRoi: null,
    outsideDirectRoi: null,
    directRoi: null,
  };
  explicitNulls.management.costs = {
    total: 777777,
    partnership: 666666,
    juguang: 555555,
    starTaskAligned: 444444,
  };
  explicitNulls.management.noteCount = 99;
  explicitNulls.management.starTaskResult = {
    metrics: { readUv: 9999, storeVisitUv: 999, gmv: 99999 },
    gmv: 99999,
    roi: 99,
  };
  explicitNulls.management.storeResult = {
    metrics: { readUv: 8888, storeVisitUv: 888, gmv: 88888 },
    gmv: 88888,
    roi: 88,
  };
  explicitNulls.star.store = {
    costs: null,
    metrics: null,
    storeRoi: null,
    taskRoi: null,
  };
  explicitNulls.star.taskSummary = {
    activeNoteCount: null,
    costs: null,
    gmv: null,
    roi: null,
  };
  explicitNulls.notes[0].costs.starTaskAligned = null;
  harness.api.setState({ status: collectionStatus(), analysis: explicitNulls });
  const nullMarkup = harness.api.buildXhsMarkup();
  const accountPanel = nullMarkup.slice(
    nullMarkup.indexOf('data-xhs-panel="account-overview"'),
    nullMarkup.indexOf('data-xhs-panel="pgy-analysis"'),
  );
  assert.doesNotMatch(accountPanel, /777,?777|666,?666|555,?555|444,?444/,
    'explicit V2 account-overview nulls must not fall through to legacy costs');
  assert.doesNotMatch(accountPanel, /星河归因投入|广告花费拆分/,
    '账户证据区不再重复全店投入与投放拆分');
  const starPanel = nullMarkup.slice(
    nullMarkup.indexOf('data-xhs-panel="star-analysis"'),
    nullMarkup.indexOf('data-xhs-panel="note-join"'),
  );
  assert.doesNotMatch(starPanel, /99,?999|88,?888|>99<|>88</,
    'explicit V2 nulls must not fall through to legacy management values');
  assert.match(starPanel, /星河归因投入<\/span><strong>—<\/strong>/);
  assert.match(starPanel, /任务笔记数<\/span><strong>—<\/strong>/);
  assert.match(starPanel, /任务GMV<\/span><strong>—<\/strong>/);
  const notePanel = nullMarkup.slice(nullMarkup.indexOf('data-xhs-panel="note-join"'));
  assert.match(notePanel,
    /虚构本期笔记[\s\S]*?<td>¥110<\/td><td>¥30<\/td><td>¥140<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/,
    'total spend must be period creator 110 + all Juguang 30, while unavailable period buckets stay unknown');
  assert.doesNotMatch(notePanel, /444,?444/,
    'the note browser must not reuse the obsolete Star-aligned aggregate as its total-spend formula');

  const missingTask = uiSnapshot();
  missingTask.management.noteCount = 0;
  delete missingTask.star.taskSummary;
  harness.api.setState({ status: collectionStatus(), analysis: missingTask });
  const missingTaskMarkup = harness.api.buildXhsMarkup();
  const missingTaskPanel = missingTaskMarkup.slice(
    missingTaskMarkup.indexOf('data-xhs-panel="star-analysis"'),
    missingTaskMarkup.indexOf('data-xhs-panel="note-join"'),
  );
  assert.match(missingTaskPanel, />— 篇任务笔记<\/span>/,
    'an absent taskSummary is unknown, not management.noteCount=0');
  assert.doesNotMatch(missingTaskPanel, />0 篇任务笔记<\/span>/);
});

test('filtered account groups never label the whole-account original ROI as a subset ROI', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  snapshot.spotlight.byAccount = [{
    key: 'fictional-ad-account',
    label: '虚构广告账户',
    platformRoi15: 9.9,
  }];
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  harness.api.setJuguangState({
    groupBy: ['account'],
    filters: {
      accountIds: [],
      marketingObjectives: ['direct'],
      placementTypes: [],
    },
  });

  const markup = harness.api.buildXhsMarkup();
  const panel = markup.slice(
    markup.indexOf('data-xhs-panel="juguang-analysis"'),
    markup.indexOf('data-xhs-panel="star-analysis"'),
  );
  assert.doesNotMatch(panel, /9\.90/,
    '9.9 is the whole-account ROI and is invalid after filtering to a marketing-objective subset');
  assert.match(panel, /4\.80/,
    'the filtered node may only show the exact original ROI retained by its own summary');
});

test('PGY legacy spend keeps full creator cost while period cost follows the explicit inclusion state', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  snapshot.notes.push({
    noteId: 'fictional-note-unknown',
    title: '虚构旧归档口径未知笔记',
    publishDate: '2030-01-06',
    pgy: { metrics: {} },
    costs: { cooperation: 300, platformFee: 30, juguang: 0, total: 330 },
    results: {},
  });
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  const markup = harness.api.buildXhsMarkup();
  const panel = markup.slice(markup.indexOf('data-xhs-panel="note-join"'));
  const rowFor = (title) => {
    const titleIndex = panel.indexOf(title);
    assert.ok(titleIndex >= 0, `missing note row: ${title}`);
    const rowStart = panel.lastIndexOf('<tr', titleIndex);
    const rowEnd = panel.indexOf('</tr>', titleIndex);
    assert.ok(rowStart >= 0 && rowEnd > titleIndex, `invalid note row: ${title}`);
    return panel.slice(rowStart, rowEnd + '</tr>'.length);
  };

  assert.match(rowFor('虚构本期笔记'),
    /<\/small><\/td><td>—<\/td><td>¥110<\/td><td>¥30<\/td>/,
    'included=true may reconstruct creator spend from cooperation plus platform fee');
  assert.match(rowFor('虚构期外发布笔记'),
    /<\/small><\/td><td>—<\/td><td>¥220<\/td><td>¥60<\/td>/,
    'included=false must retain full creator spend even though period creator spend is zero');
  assert.match(rowFor('虚构旧归档口径未知笔记'),
    /<\/small><\/td><td>—<\/td><td>¥330<\/td><td>¥0<\/td>/,
    'creator spend remains observable even when period inclusion is unknown');
});

test('standalone HTML export keeps Juguang controls interactive with the complete offline payload', () => {
  const harness = createReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: uiSnapshot() });

  const onlineMarkup = harness.api.buildXhsMarkup();
  assert.doesNotMatch(onlineMarkup, /导出静态视图/);
  assert.doesNotMatch(onlineMarkup, /data-xhs-juguang-(?:mode|filter|group-by)=[^>]*\sdisabled(?:\s|>)/);

  const exported = harness.api.buildExportReportDocument({
    finishedAt: Date.parse('2030-04-01T00:00:00.000Z'),
  }).html;
  const xhsPanel = exported.slice(exported.indexOf('data-xhs-panel="juguang-analysis"'));
  assert.doesNotMatch(xhsPanel, /导出静态视图/);
  const controls = [...xhsPanel.matchAll(
    /<(?:select|input)\b[^>]*data-xhs-juguang-(?:mode|filter|group-by)=[^>]*>/g,
  )].map((match) => match[0]);
  assert.ok(controls.length >= 7, 'expected mode, three filters and three grouping controls');
  controls.forEach((control) => assert.doesNotMatch(control, /\sdisabled(?:\s|>)/,
    `exported control must remain interactive: ${control}`));
  assert.match(exported, /id="xhs-export-snapshot"/);
  assert.match(exported, /"schema":"xhsInteractiveExportV1"/);
  assert.match(exported, /window\.XhsReportModel=/);
  assert.match(exported, /data-xhs-export-juguang-body/);
  assert.match(exported, /function renderJuguang\(/);
  assert.match(exported, /role="status"[^>]*data-xhs-export-filter-status="juguang"/);
  assert.match(exported, /\.xhs-unit-costs\s*\{/,
    'standalone export must style rolled-up Star costs');
  assert.match(exported, /\.xhs-note-node\s*\{/,
    'standalone export must preserve the project > order > note hierarchy styling');
});

test('standalone HTML export keeps the XHS web disclosures folded and clickable', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  snapshot.pgy.facts = [{
    noteId: 'fictional-export-pgy-note',
    title: '虚构导出蒲公英笔记',
    publishDate: '2030-01-05',
    crossDomainProjectName: '虚构跨域项目',
    spuName: '虚构 SPU',
    costs: { cooperation: 100, platformFee: 10, total: 110 },
    metrics: {},
  }];
  const seedNote = snapshot.notes[0] || {};
  snapshot.notes = Array.from({ length: 22 }, (_, index) => ({
    ...seedNote,
    noteId: `fictional-export-note-${index + 1}`,
    title: `虚构导出笔记 ${index + 1}`,
    noteUrl: `https://www.xiaohongshu.com/explore/fictional-export-note-${index + 1}`,
  }));
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const exported = harness.api.buildExportReportDocument({
    finishedAt: Date.parse('2030-04-01T00:00:00.000Z'),
  }).html;

  const pgyToggle = exported.match(/<button[^>]*data-xhs-pgy-note-toggle[^>]*>/);
  assert.ok(pgyToggle, '导出报告应保留蒲公英笔记分析按钮');
  assert.match(pgyToggle[0], /aria-expanded="false"/);
  assert.match(pgyToggle[0], /aria-controls="xhsPgyNoteAnalysis"/);
  assert.doesNotMatch(pgyToggle[0], /\sdisabled(?:\s|>)/);
  assert.match(exported, /id="xhsPgyNoteAnalysis" hidden/);
  for (const [kind, target] of [['task', 'xhsStarTaskReport'], ['project', 'xhsStarProjectReport']]) {
    const starToggle = exported.match(new RegExp(`<button[^>]*data-xhs-star-toggle="${kind}"[^>]*>`));
    assert.ok(starToggle, `导出报告应保留星河 ${kind} 披露按钮`);
    assert.match(starToggle[0], /aria-expanded="false"/);
    assert.match(starToggle[0], new RegExp(`aria-controls="${target}"`));
    assert.doesNotMatch(starToggle[0], /\sdisabled(?:\s|>)/);
    assert.match(exported, new RegExp(`id="${target}" hidden`));
  }
  const noteToggle = exported.match(/<button[^>]*data-xhs-note-toggle[^>]*>/);
  assert.ok(noteToggle, '导出报告应保留笔记 Top20 查看更多按钮');
  assert.match(noteToggle[0], /aria-expanded="false"/);
  assert.match(noteToggle[0], /aria-controls="xhsNoteFullPathTable"/);
  assert.doesNotMatch(noteToggle[0], /\sdisabled(?:\s|>)/);
  assert.equal((exported.match(/<tr[^>]*data-xhs-export-note-overflow/g) || []).length, 2,
    'Top20 之外的笔记应保留在导出文档并默认折叠');
  assert.match(exported,
    /href="https:\/\/www\.xiaohongshu\.com\/explore\/fictional-export-note-1" target="_blank" rel="noopener noreferrer"/);
  assert.match(exported, /querySelectorAll\("\[data-xhs-pgy-note-toggle\]"\)/);
  assert.match(exported, /querySelectorAll\("\[data-xhs-star-toggle\]"\)/);
  assert.match(exported, /querySelectorAll\("\[data-xhs-note-toggle\]"\)/);
});

test('standalone HTML export enables PGY dates and Star full-path filters over every hydrated row', () => {
  const harness = createReportHarness({ reportModel: realXhsReportModel });
  const snapshot = uiSnapshot();
  snapshot.pgy.defaultDateRange = { from: '2030-01-01', to: '2030-01-31' };
  snapshot.pgy.facts = [
    {
      noteId: 'fictional-export-pgy-january', title: '虚构一月笔记', publishDate: '2030-01-05',
      spuName: '虚构 SPU A', crossDomainProjectName: '虚构跨域项目 A',
      costs: { cooperation: 100, platformFee: 10, total: 110 }, metrics: {},
    },
    {
      noteId: 'fictional-export-pgy-february', title: '虚构二月笔记', publishDate: '2030-02-05',
      spuName: '虚构 SPU B', crossDomainProjectName: '虚构跨域项目 B',
      costs: { cooperation: 200, platformFee: 20, total: 220 }, metrics: {},
    },
  ];
  snapshot.spotlight.daily = Array.from({ length: 27 }, (_, index) => ({
    date: `2030-01-${String(index + 1).padStart(2, '0')}`,
    accountId: 'fictional-account-a', accountName: '虚构聚光账户 A',
    marketingObjective: index % 2 ? 'direct' : 'product_seeding',
    placementType: index % 2 ? 'fixture-search' : 'fixture-feed', spend: index + 1,
  }));
  const seedNote = snapshot.notes[0] || {};
  snapshot.notes = Array.from({ length: 45 }, (_, index) => ({
    ...seedNote,
    noteId: `fictional-complete-export-note-${index + 1}`,
    title: `虚构完整快照笔记 ${index + 1}`,
    publishDate: index < 20 ? '2030-01-05' : '2030-02-05',
  }));
  harness.api.setState({ status: collectionStatus(), analysis: snapshot });

  const exported = harness.api.buildExportReportDocument({
    finishedAt: Date.parse('2030-04-01T00:00:00.000Z'),
  }).html;
  const payloadMatch = exported.match(/<script[^>]*id="xhs-export-snapshot"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(payloadMatch, '导出报告必须携带完整离线筛选快照');
  const payload = JSON.parse(payloadMatch[1]);
  assert.equal(payload.pgy.facts.length, 2,
    '默认一月视图不能删除二月蒲公英事实');
  assert.equal(payload.spotlight.daily.length, 27);
  assert.equal((exported.match(/<tr[^>]*data-xhs-export-note-row/g) || []).length, 45,
    '星河 Top20 只控制初始可见行，不能截断导出快照');
  for (const control of exported.match(/<(?:select|input)[^>]*(?:data-xhs-pgy-(?:spu|date)|data-xhs-note-(?:filter|date))[^>]*>/g) || []) {
    assert.doesNotMatch(control, /\sdisabled(?:\s|>)/);
  }
  assert.match(exported, /function renderPgy\(/);
  assert.match(exported, /function applyNoteFilters\(/);
});

test('legacy xiaohongshu active section opens the first available platform report in exported HTML', () => {
  const harness = createReportHarness();
  harness.api.setState({ status: collectionStatus(), analysis: uiSnapshot() });
  harness.api.setActiveSection('xiaohongshu');

  const exported = harness.api.buildExportReportDocument({
    finishedAt: Date.parse('2030-04-01T00:00:00.000Z'),
  }).html;
  assert.match(exported, /class="export-tab active has-data"[^>]*id="export-tab-adstar"/);
  assert.match(exported, /data-export-panel="adstar"(?![^>]*hidden)/);
  for (const platform of ['pgy', 'juguang']) {
    assert.match(exported, new RegExp(`data-export-panel="${platform}"[^>]* hidden`));
  }
});

test('Star report excludes unverified project-report orders that duplicate business tasks', () => {
  const harness = createReportHarness();
  const snapshot = uiSnapshot();
  snapshot.star.projects[0].orders.push({
    id: 'project_report:fictional-project-1:internal-only-key',
    projectId: 'fictional-project-1',
    reportOrderId: 'fictional-report-order-7',
    businessIdentityVerified: false,
    source: 'project_report',
    name: '虚构报表订单',
    status: 'partial',
    coverage: 'partial',
    metrics: null,
    costs: null,
    notes: [{
      noteId: 'fictional-report-note',
      title: '虚构报表关系笔记',
      publishDate: '2030-01-08',
      costs: null,
      metrics: null,
    }],
  });
  snapshot.star.unassignedNotes = [{
    noteId: 'fictional-unassigned-note',
    title: '虚构待归属笔记',
    publishDate: '2030-01-09',
    projectIds: ['fictional-project-1'],
    candidateOrderIds: ['fictional-order-1', 'fictional-order-2'],
    reason: 'ambiguous_order_relation',
    costs: { creator: 120, adInTask: 30, total: 150 },
    includedInHierarchy: false,
  }];

  harness.api.setState({ status: collectionStatus(), analysis: snapshot });
  const markup = harness.api.buildXhsMarkup();
  const panel = markup.slice(
    markup.indexOf('data-xhs-panel="star-analysis"'),
    markup.indexOf('data-xhs-panel="note-join"'),
  );

  assert.doesNotMatch(panel, /project_report:fictional-project-1:internal-only-key/,
    'internal synthetic identifiers must never be presented as business task IDs');
  assert.doesNotMatch(panel, /报表任务标识（未验证）|fictional-report-order-7|虚构报表订单|部分完成/,
    '未验证项目报表订单与真实订单重复，不进入任务汇总、筛选或明细');
  assert.match(panel, /data-xhs-star-task="fictional-order-1"/,
    '已验证的真实任务必须继续展示');
  assert.doesNotMatch(panel,
    /data-xhs-star-note=|fictional-report-note|虚构报表关系笔记|fictional-unassigned-note|虚构待归属笔记/,
    'verified and unverified task summaries must not embed assigned or unassigned note details');
});

test('report CSS provides responsive and accessible chart/tree/control styles', () => {
  const css = read('web-tool/report.css');

  for (const selector of [
    '.xhs-bar-chart', '.xhs-bar-row', '.xhs-bar-track', '.xhs-bar-fill',
    '.xhs-chart-value', '.xhs-project-tree', '.xhs-control-grid', '.xhs-sr-only',
  ]) assert.ok(css.includes(selector), `missing CSS selector ${selector}`);
  assert.match(css, /@media\s*\(max-width:[^)]+\)[\s\S]*\.xhs-(?:bar-chart|bar-row|control-grid)/,
    'XHS visualizations and controls must adapt at a narrow breakpoint');
  assert.match(css, /\.xhs-sr-only\s*\{[\s\S]*?(?:clip|position\s*:\s*absolute)/,
    'screen-reader-only chart data must remain available to assistive technology');
});

test('workbook export adds the seven V2 XHS sheets and their governing fields', () => {
  const source = read('diagnosis-popup.js');

  for (const sheet of [
    '小红书账户总览', '蒲公英月度', '蒲公英粉丝量级', '聚光分析',
    '星河汇总', '星河项目任务', '笔记全链路',
  ]) assert.ok(source.includes(sheet), `missing workbook sheet: ${sheet}`);
  for (const field of [
    '总投入', '达人花费', '广告花费', '星河归因投入',
    '任务ROI', '任务外直达ROI', '直达ROI',
    '月份', '发布笔记数', '粉丝量级', '平均合作费用',
    '任务期内消耗', '任务期外消耗', '投放位置', '15日站外活跃UV', '15日站外行为成本',
    '平台原始ROI', '全店ROI', '进店成本', '任务期内花费', '任务期外花费', '蒲公英计入本期',
  ]) assert.ok(source.includes(field), `missing workbook field: ${field}`);
  assert.equal(source.includes('分摊成本'), false,
    'workbook project/order export must not retain allocated-cost columns');
});
