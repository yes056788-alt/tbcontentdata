const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const exportStart = source.indexOf('  async function exportExcel()');
const exportEnd = source.indexOf('\n  async function clearData', exportStart);

assert.ok(exportStart >= 0 && exportEnd > exportStart, 'expected the real workbook exporter');

const exportSource = source.slice(exportStart, exportEnd);
const createExporter = new Function(
  'currentRows',
  'currentXhsAnalysis',
  'XLSX',
  'flushManualInputs',
  `${exportSource}; return exportExcel;`,
);

const V2_SHEETS = [
  '小红书账户总览',
  '蒲公英月度',
  '蒲公英粉丝量级',
  '聚光分析',
  '星河汇总',
  '星河项目任务',
  '笔记全链路',
];

function reportSnapshot() {
  return {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'fictional-workbook-v2-run',
    storeId: 'fictional-store',
    generatedAt: '2030-04-01T00:00:00.000Z',
    dateRange: { from: '2030-01-01', to: '2030-03-31', timezone: 'Asia/Shanghai' },
    quality: { decisionReady: true, issues: [] },
    management: {
      noteCount: 2,
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
      costs: {
        cooperation: 400,
        platformFee: 40,
        partnership: 440,
        juguang: 90,
        total: 530,
        starTaskAligned: 470,
        juguangInTask: 30,
        juguangOutsideTask: 60,
        juguangUnknownTask: 0,
      },
      starTaskResult: { gmv: 800, roi: 800 / 470 },
      storeResult: {
        metrics: {
          readUv: 1000,
          searchImpressionUv: 300,
          engagementUv: 200,
          storeVisitUv: 200,
          visitRate: 0.2,
          visitCost: 2.35,
          gmv: 2000,
          seededProductGmv: 800,
        },
        gmv: 2000,
        roi: 2000 / 470,
      },
      outsideDirectResult: { spend: 60, gmv: 300, roi: 5 },
      directResult: { spend: 90, gmv: 405, roi: 4.5 },
    },
    pgy: {
      noteCount: 8,
      starTaskNoteCount: 3,
      overdueNoteCount: 2,
      costs: { cooperation: 400, platformFee: 40, total: 440 },
      metrics: {
        impressions: 10000,
        reads: 4000,
        interactions: 600,
        readRate: 0.4,
        engagementRate: 0.15,
      },
      monthly: [
        { month: '2030-01', noteCount: 3 },
        { month: '2030-02', noteCount: 2 },
        { month: '2030-03', noteCount: 3 },
      ],
      followerTiers: [{
        key: '1k_5k',
        label: '1K-5K',
        noteCount: 2,
        authorCount: 1,
        cooperationCost: 200,
        averageCooperationCost: 100,
      }],
    },
    spotlight: {
      byTaskObjective: [
        { taskStatus: 'in_task', marketingObjective: 'direct', spend: 30 },
        { taskStatus: 'outside_task', marketingObjective: 'direct', spend: 60 },
      ],
      daily: [
        {
          noteId: 'fictional-note-a',
          date: '2030-01-02',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'direct',
          deliveryMode: 0,
          taskStatus: 'in_task',
          spend: 30,
          impressions: 9000,
          clicks: 900,
          interactions: 180,
          seedUsers: 90,
          deepSeedUsers: 45,
          conversion: {
            observable: true,
            storeVisits: 30,
            orders: 6,
            gmv: 300,
            platformRoi15: 4.8,
          },
        },
        {
          noteId: 'fictional-note-partial',
          date: '2030-01-03',
          accountId: 'fictional-partial-ad-account',
          accountName: '虚构缺列账户',
          marketingObjective: 'direct',
          deliveryMode: 1,
          taskStatus: 'outside_task',
          spend: 20,
          impressions: 2000,
          clicks: 200,
          interactions: 40,
          seedUsers: 20,
          deepSeedUsers: 10,
          conversion: {
            observable: false,
            storeVisits: 5,
            orders: 1,
            gmv: null,
            platformRoi15: null,
          },
        },
        {
          noteId: 'fictional-note-a-second-day',
          date: '2030-01-04',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'direct',
          deliveryMode: 0,
          taskStatus: 'outside_task',
          spend: 10,
          impressions: 1000,
          clicks: 100,
          interactions: 20,
          seedUsers: 10,
          deepSeedUsers: 5,
          conversion: {
            observable: true,
            storeVisits: 5,
            orders: 1,
            gmv: 50,
            platformRoi15: 4.8,
          },
        },
        {
          noteId: 'fictional-product-seeding-note',
          date: '2030-01-05',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'product_seeding',
          deliveryMode: 0,
          taskStatus: 'outside_task',
          spend: 12,
          impressions: 1200,
          clicks: 120,
          interactions: 24,
          seedUsers: 12,
          deepSeedUsers: 6,
          conversion: {
            observable: false,
            storeVisits: null,
            orders: null,
            gmv: null,
            platformRoi15: null,
          },
        },
        {
          noteId: 'fictional-mixed-complete-note',
          date: '2030-01-06',
          accountId: 'fictional-mixed-ad-account',
          accountName: '虚构部分可用账户',
          marketingObjective: 'direct',
          deliveryMode: 1,
          taskStatus: 'in_task',
          spend: 12,
          impressions: 1200,
          clicks: 120,
          interactions: 24,
          seedUsers: 12,
          deepSeedUsers: 6,
          conversion: {
            observable: true,
            storeVisits: 4,
            orders: 1,
            gmv: 60,
            platformRoi15: 3,
          },
        },
        {
          noteId: 'fictional-mixed-incomplete-note',
          date: '2030-01-07',
          accountId: 'fictional-mixed-ad-account',
          accountName: '虚构部分可用账户',
          marketingObjective: 'direct',
          deliveryMode: 1,
          taskStatus: 'outside_task',
          spend: 8,
          impressions: 800,
          clicks: 80,
          interactions: 16,
          seedUsers: 8,
          deepSeedUsers: 4,
          conversion: {
            observable: false,
            storeVisits: 2,
            orders: 1,
            gmv: null,
            platformRoi15: null,
          },
        },
      ],
    },
    star: {
      store: {
        costs: { total: 470, creator: 440, adInTask: 30 },
        metrics: {
          readUv: 1000,
          searchImpressionUv: 300,
          engagementUv: 200,
          storeVisitUv: 200,
          visitRate: 0.2,
          visitCost: 2.35,
          gmv: 2000,
          seededProductGmv: 800,
        },
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
        id: 'fictional-project-1',
        name: '虚构星河项目',
        status: 'complete',
        costs: { creator: 110, adInTask: 30, total: 140 },
        metrics: { readUv: 700, storeVisitUv: 140, gmv: 1200, seededProductGmv: 500 },
        orders: [{
          id: 'fictional-order-1',
          projectId: 'fictional-project-1',
          name: '虚构星河订单',
          status: 'complete',
          costs: { creator: 110, adInTask: 30, total: 140 },
          metrics: { readUv: 500, storeVisitUv: 100, gmv: 900, seededProductGmv: 400 },
          notes: [{
            noteId: 'fictional-note-a', title: '虚构本期笔记', publishDate: '2030-01-05',
            costs: { creator: 110, adInTask: 30, total: 140 },
            metrics: { readUv: 100, storeVisitUv: 20, gmv: 300, seededProductGmv: 100 },
          }],
        }],
      }],
      orders: [{
        id: 'fictional-order-1',
        projectId: 'fictional-project-1',
        name: '虚构星河订单',
        status: 'complete',
        metrics: { readUv: 500, storeVisitUv: 100, gmv: 900, seededProductGmv: 400 },
      }],
    },
    notes: [
      {
        noteId: 'fictional-note-a',
        title: '虚构本期笔记',
        publishDate: '2030-01-05',
        author: { name: '虚构达人 A', followerCount: 3000 },
        pgy: {
          includedInPeriod: true,
          metrics: { impressions: 100, reads: 50, interactions: 10 },
        },
        costs: {
          cooperation: 100,
          platformFee: 10,
          periodCreator: 110,
          juguang: 30,
          starTaskAligned: 140,
          outsideDirect: 0,
        },
        juguang: { inTask: { spend: 30 } },
        star: { metrics: { readUv: 100, storeVisitUv: 20, gmv: 300 } },
        results: { starTaskGmv: 100, starTaskRoi: 100 / 140 },
      },
      {
        noteId: 'fictional-note-b',
        title: '虚构期外笔记',
        publishDate: '2029-12-15',
        author: { name: '虚构达人 B', followerCount: 20000 },
        pgy: {
          includedInPeriod: false,
          metrics: { impressions: 200, reads: 80, interactions: 12 },
        },
        costs: {
          cooperation: 200,
          platformFee: 20,
          periodCreator: 0,
          juguang: 60,
          starTaskAligned: 0,
          outsideDirect: 60,
        },
        juguang: { inTask: { spend: 0 } },
        star: { metrics: { readUv: 200, storeVisitUv: 30, gmv: 500 } },
        results: { starTaskGmv: 200, starTaskRoi: null, outsideDirectGmv: 300, outsideDirectRoi: 5 },
      },
    ],
    actions: [],
  };
}

async function buildWorkbook(snapshot) {
  let captured = null;
  let flushCount = 0;
  const XLSX = {
    utils: {
      book_new() {
        return { sheets: [] };
      },
      json_to_sheet(rows) {
        return { rows, '!ref': `A1:A${Math.max(2, rows.length + 1)}` };
      },
      book_append_sheet(workbook, sheet, name) {
        workbook.sheets.push({ name, sheet });
      },
    },
    writeFile(workbook, filename) {
      captured = { workbook, filename };
    },
  };
  const exporter = createExporter([], snapshot, XLSX, async () => {
    flushCount += 1;
    return true;
  });
  await exporter();
  assert.equal(flushCount, 1, 'export must flush pending manual inputs once');
  assert.ok(captured, 'XLSX.writeFile must receive the generated workbook');
  return captured;
}

function sheetMap(captured) {
  return new Map(captured.workbook.sheets.map((entry) => [entry.name, entry.sheet]));
}

test('real workbook exporter appends all seven XHS V2 sheets with reconciled values and hierarchy', async () => {
  const captured = await buildWorkbook(reportSnapshot());
  const sheets = sheetMap(captured);

  for (const name of V2_SHEETS) {
    assert.ok(sheets.has(name), `missing actual workbook sheet ${name}`);
    assert.deepEqual(sheets.get(name)['!autofilter'], { ref: sheets.get(name)['!ref'] },
      `${name} must expose an Excel autofilter`);
  }

  const overview = sheets.get('小红书账户总览').rows[0];
  assert.equal(overview.总投入, 530);
  assert.equal(overview.达人花费, 440);
  assert.equal(overview.广告花费, 90);
  assert.equal(overview.星河归因投入, 470);
  assert.equal(overview.星河任务笔记数, 3);
  assert.equal(overview.超期笔记数, 2);
  assert.equal(overview.任务期内种草直达消耗, 30);
  assert.equal(overview.任务期外种草直达消耗, 60);

  assert.deepEqual(sheets.get('蒲公英月度').rows.map((row) => [row.月份, row.发布笔记数]), [
    ['2030-01', 3], ['2030-02', 2], ['2030-03', 3],
  ]);
  assert.equal(sheets.get('蒲公英粉丝量级').rows[0].平均合作费用, 100);

  const spotlightRows = sheets.get('聚光分析').rows;
  const spotlight = spotlightRows.find((row) => (
    row.广告账户ID === 'fictional-ad-account' && row.营销诉求 === '种草直达'
  ));
  assert.ok(spotlight);
  assert.equal(spotlight.总消耗, 40);
  assert.equal(spotlight.任务期内消耗, 30);
  assert.equal(spotlight['15日直达消耗'], 40);
  assert.equal(spotlight['15日转化可观测性'], '完整');
  assert.equal(spotlight.外链进店数, 35);
  assert.equal(spotlight['15日成交订单数'], 7);
  assert.equal(spotlight['15日成交GMV'], 350);
  assert.equal(spotlight['15日计算ROI'], 8.75);
  assert.equal(spotlight.平台原始ROI, 4.8);
  const productSeedingSpotlight = spotlightRows.find((row) => (
    row.广告账户ID === 'fictional-ad-account' && row.营销诉求 === '产品种草'
  ));
  assert.ok(productSeedingSpotlight);
  assert.equal(productSeedingSpotlight['15日直达消耗'], 0);
  assert.equal(productSeedingSpotlight['15日转化可观测性'], '不可用');
  assert.equal(productSeedingSpotlight['15日成交GMV'], '—');

  const partiallyObservableSpotlight = spotlightRows.find((row) => (
    row.广告账户ID === 'fictional-mixed-ad-account'
  ));
  assert.ok(partiallyObservableSpotlight);
  assert.equal(partiallyObservableSpotlight.总消耗, 20);
  assert.equal(partiallyObservableSpotlight['15日直达消耗'], 20,
    '不完整直达行的消耗也必须进分母');
  assert.equal(partiallyObservableSpotlight['15日转化可观测性'], '部分不可用');
  assert.equal(partiallyObservableSpotlight.外链进店数, '—');
  assert.equal(partiallyObservableSpotlight['15日成交订单数'], '—');
  assert.equal(partiallyObservableSpotlight['15日成交GMV'], '—');
  assert.equal(partiallyObservableSpotlight['15日计算ROI'], '—');
  assert.equal(partiallyObservableSpotlight.平台原始ROI, '—');

  const unobservableSpotlight = spotlightRows.find((row) => (
    row.广告账户ID === 'fictional-partial-ad-account'
  ));
  assert.ok(unobservableSpotlight);
  assert.equal(unobservableSpotlight['15日直达消耗'], 20);
  assert.equal(unobservableSpotlight['15日转化可观测性'], '不可用');
  assert.equal(unobservableSpotlight.外链进店数, '—');
  assert.equal(unobservableSpotlight['15日成交订单数'], '—');
  assert.equal(unobservableSpotlight['15日成交GMV'], '—');
  assert.equal(unobservableSpotlight['15日计算ROI'], '—');
  assert.equal(unobservableSpotlight.平台原始ROI, '—');

  const starSummary = sheets.get('星河汇总').rows;
  assert.equal(starSummary[0].汇总层级, '全店汇总');
  assert.equal(starSummary[0].GMV, 2000);
  assert.equal(starSummary[1].汇总层级, '星河任务汇总');
  assert.equal(starSummary[1].GMV, 800);

  const units = sheets.get('星河项目任务').rows;
  assert.deepEqual(units.map((row) => row.层级), ['项目', '任务']);
  assert.equal(units[0].项目ID, 'fictional-project-1');
  assert.equal(units[1].任务ID, 'fictional-order-1');
  for (const row of units) {
    assert.equal(row.总花费, 140);
    assert.equal(row.达人花费, 110);
    assert.equal(row.任务期内广告花费, 30);
  }
  for (const row of units) {
    assert.equal(Object.keys(row).some((key) => key.includes('分摊')), false);
  }

  const notes = sheets.get('笔记全链路').rows;
  assert.equal(notes[0].蒲公英计入本期, '是');
  assert.equal(notes[0].本期达人花费, 110);
  assert.equal(notes[1].蒲公英计入本期, '否（期外）');
  assert.equal(notes[1].本期达人花费, 0);
});

test('workbook keeps unverified report tasks auditable but excludes all Star note details', async () => {
  const snapshot = reportSnapshot();
  snapshot.star.projects[0].orders.push({
    id: 'project_report:fictional-project-1:internal-only-key',
    projectId: 'fictional-project-1',
    reportOrderId: 'fictional-report-order-7',
    businessIdentityVerified: false,
    source: 'project_report',
    name: '虚构报表订单',
    status: 'partial',
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

  const rows = sheetMap(await buildWorkbook(snapshot)).get('星河项目任务').rows;
  const reportTask = rows.find((row) => row.名称 === '虚构报表订单');
  assert.ok(reportTask);
  assert.equal(reportTask.任务ID, '—');
  assert.equal(reportTask.报表任务标识, 'fictional-report-order-7');
  assert.equal(reportTask.业务任务身份, '未验证');
  assert.equal(JSON.stringify(reportTask).includes('internal-only-key'), false,
    'internal synthetic task IDs must not leak into the workbook');

  const reportNote = rows.find((row) => row.笔记ID === 'fictional-report-note');
  assert.equal(reportNote, undefined);

  const unassigned = rows.find((row) => row.笔记ID === 'fictional-unassigned-note');
  assert.equal(unassigned, undefined);
  assert.ok(rows.every((row) => row.层级 === '项目' || row.层级 === '任务'));
});

test('real workbook exporter infers PGY inclusion and account totals for an older snapshot', async () => {
  const legacy = reportSnapshot();
  delete legacy.management.accountOverview;
  delete legacy.notes[0].pgy.includedInPeriod;
  delete legacy.notes[0].costs.periodCreator;
  delete legacy.notes[1].pgy.includedInPeriod;
  delete legacy.notes[1].costs.periodCreator;

  const sheets = sheetMap(await buildWorkbook(legacy));
  const overview = sheets.get('小红书账户总览').rows[0];
  assert.equal(overview.总投入, 530);
  assert.equal(overview.达人花费, 440);
  assert.equal(overview.广告花费, 90);

  const notes = sheets.get('笔记全链路').rows;
  assert.equal(notes[0].蒲公英计入本期, '是');
  assert.equal(notes[0].本期达人花费, 110);
  assert.equal(notes[1].蒲公英计入本期, '否（期外）');
  assert.equal(notes[1].本期达人花费, 0);
});

test('real workbook exporter preserves an explicitly unavailable Star task note count', async () => {
  const partial = reportSnapshot();
  partial.management.noteCount = 0;
  partial.star.taskSummary = null;

  const sheets = sheetMap(await buildWorkbook(partial));
  const summaryRows = sheets.get('星河汇总').rows;
  assert.equal(summaryRows[0].任务笔记数, '—');
  assert.equal(summaryRows[1].任务笔记数, '—');
});

test('real workbook exporter does not replace explicit V2 Star nulls with legacy management values', async () => {
  const partial = reportSnapshot();
  partial.star.store = {
    costs: { total: null, creator: null, adInTask: null },
    metrics: {
      readUv: null,
      searchImpressionUv: null,
      engagementUv: null,
      storeVisitUv: null,
      visitRate: null,
      visitCost: null,
      gmv: null,
      seededProductGmv: null,
    },
    storeRoi: null,
    taskRoi: null,
  };
  partial.star.taskSummary = {
    activeNoteCount: null,
    gmv: null,
    costs: { total: null, creator: null, adInTask: null },
    roi: null,
  };

  const rows = sheetMap(await buildWorkbook(partial)).get('星河汇总').rows;
  for (const key of [
    '任务笔记数', '总花费', '达人花费', '广告花费', '阅读UV', '搜索曝光UV',
    '互动UV', '进店UV', '进店率', '进店成本', 'GMV', '全店ROI', '任务ROI',
  ]) {
    assert.equal(rows[0][key], '—', `store ${key} must preserve explicit null`);
  }
  for (const key of ['任务笔记数', '总花费', '达人花费', '广告花费', 'GMV', '任务ROI']) {
    assert.equal(rows[1][key], '—', `task ${key} must preserve explicit null`);
  }
});

test('real workbook exporter uses legacy management Star values only when V2 fields are absent', async () => {
  const legacy = reportSnapshot();
  delete legacy.star.store;
  delete legacy.star.taskSummary;

  const rows = sheetMap(await buildWorkbook(legacy)).get('星河汇总').rows;
  assert.equal(rows[0].任务笔记数, 2);
  assert.equal(rows[0].总花费, 470);
  assert.equal(rows[0].阅读UV, 1000);
  assert.equal(rows[0].GMV, 2000);
  assert.equal(rows[0].全店ROI, 2000 / 470);
  assert.equal(rows[1].任务笔记数, 2);
  assert.equal(rows[1].总花费, 470);
  assert.equal(rows[1].GMV, 800);
  assert.equal(rows[1].任务ROI, 800 / 470);
});
