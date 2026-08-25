const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'diagnosis-popup.js'), 'utf8');
const exportStart = source.indexOf('  async function exportExcel()');
const exportEnd = source.indexOf('\n  async function clearData', exportStart);

assert.ok(exportStart >= 0 && exportEnd > exportStart, 'expected the real workbook exporter');

const createExporter = new Function(
  'currentRows',
  'currentXhsAnalysis',
  'XLSX',
  'flushManualInputs',
  `${source.slice(exportStart, exportEnd)}; return exportExcel;`,
);

function v3Snapshot() {
  return {
    runId: 'fictional-workbook-v3-run',
    storeId: 'fictional-v3-store',
    generatedAt: '2030-04-01T00:00:00.000Z',
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    quality: { decisionReady: true, issues: [] },
    management: {},
    pgy: { noteCount: 4, starTaskNoteCount: 3, overdueNoteCount: 2 },
    spotlight: {
      daily: [
        {
          noteId: 'fictional-seeding-feed-a',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'product_seeding',
          placementType: 'fixture-feed',
          deliveryMode: 0,
          taskStatus: 'in_task',
          spend: 40,
          seedingExternal15: {
            observable: true,
            activeUv: 8,
            platformRate: 0.2,
            platformCost: 999,
          },
        },
        {
          noteId: 'fictional-seeding-feed-b',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'product_seeding',
          placementType: 'fixture-feed',
          deliveryMode: 1,
          taskStatus: 'out_of_task',
          spend: 20,
          seedingExternal15: {
            observable: true,
            activeUv: 7,
            platformRate: 0.5,
            platformCost: 888,
          },
        },
        {
          noteId: 'fictional-seeding-search-missing',
          accountId: 'fictional-ad-account',
          accountName: '虚构广告账户',
          marketingObjective: 'product_seeding',
          placementType: 'fixture-search',
          deliveryMode: 0,
          taskStatus: 'in_task',
          spend: 30,
          seedingExternal15: {
            observable: false,
            activeUv: null,
            platformRate: null,
            platformCost: null,
          },
        },
        {
          noteId: 'fictional-legacy-no-placement',
          accountId: 'fictional-legacy-account',
          accountName: '虚构旧归档账户',
          marketingObjective: 'direct',
          deliveryMode: 0,
          taskStatus: 'in_task',
          spend: 10,
          conversion: { observable: true, storeVisits: 2, orders: 1, gmv: 20 },
        },
      ],
    },
    star: {
      projects: [{
        id: 'fictional-project-1',
        name: '虚构项目',
        status: 'complete',
        costs: { creator: 110, adInTask: 30, total: 140 },
        metrics: { readUv: 100, storeVisitUv: 20 },
        orders: [{
          id: 'fictional-order-1',
          projectId: 'fictional-project-1',
          name: '虚构业务单',
          status: 'complete',
          costs: { creator: 110, adInTask: 30, total: 140 },
          metrics: { readUv: 80, storeVisitUv: 16 },
          notes: [{
            noteId: 'fictional-nested-star-note',
            title: '不应出现在项目任务汇总的笔记',
            publishDate: '2030-01-07',
            costs: { creator: 110, adInTask: 30, total: 140 },
            metrics: { readUv: 80, storeVisitUv: 16 },
          }],
        }],
      }],
      orders: [],
      unassignedNotes: [{
        noteId: 'fictional-unassigned-star-note',
        title: '不应出现在项目任务汇总的待归属笔记',
        publishDate: '2030-01-08',
        projectIds: ['fictional-project-1'],
        candidateOrderIds: ['fictional-order-1'],
        costs: { creator: 20, adInTask: 5, total: 25 },
      }],
    },
    notes: [
      {
        noteId: 'fictional-note-formula',
        title: '批准公式笔记',
        publishDate: '2030-01-05',
        task: { projectIds: ['fictional-project-1'], orderIds: ['fictional-order-1'], intervals: [] },
        pgy: { includedInPeriod: true, coverage: 'complete', metrics: {} },
        costs: {
          periodCreator: 110,
          juguang: 90,
          total: 9999,
          periodTotal: 8888,
          starTaskAligned: 7777,
        },
        juguang: {
          coverage: 'complete',
          total: { spend: 90 },
          inTask: { spend: 30 },
          taskStatuses: [
            { key: 'in_task', spend: 30 },
            { key: 'out_of_task', spend: 60 },
          ],
        },
        star: { metrics: { storeVisitUv: 20 } },
        results: {},
      },
      {
        noteId: 'fictional-note-partial-pgy',
        title: '蒲公英覆盖不完整笔记',
        publishDate: '2030-01-10',
        task: { projectIds: ['fictional-project-1'], orderIds: ['fictional-order-1'], intervals: [] },
        pgy: {
          includedInPeriod: true,
          coverage: 'partial',
          observedCosts: { cooperation: 10, platformFee: 2, total: 12 },
          metrics: {},
        },
        costs: { cooperation: 10, platformFee: 2, juguang: 5 },
        juguang: {
          coverage: 'complete',
          total: { spend: 5 },
          inTask: { spend: 2 },
          outsideTask: { spend: 3 },
          taskStatuses: [
            { key: 'in_task', spend: 2 },
            { key: 'out_of_task', spend: 3 },
          ],
        },
        star: { metrics: { storeVisitUv: 2 } },
        results: {},
      },
      {
        noteId: 'fictional-note-partial-juguang',
        title: '聚光覆盖不完整笔记',
        publishDate: '2030-01-11',
        task: { projectIds: ['fictional-project-1'], orderIds: ['fictional-order-1'], intervals: [] },
        pgy: { includedInPeriod: true, coverage: 'complete', metrics: {} },
        costs: { cooperation: 10, platformFee: 2, periodCreator: 12, juguang: null },
        juguang: {
          coverage: 'partial',
          total: { spend: 50 },
          inTask: { spend: 20 },
          taskStatuses: [
            { key: 'in_task', spend: 20 },
            { key: 'out_of_task', spend: 30 },
          ],
        },
        star: { metrics: { storeVisitUv: 2 } },
        results: {},
      },
      {
        noteId: 'fictional-note-complete-zero-outside',
        title: '完整覆盖且任务期外为零笔记',
        publishDate: '2030-01-12',
        task: { projectIds: ['fictional-project-1'], orderIds: ['fictional-order-1'], intervals: [] },
        pgy: { includedInPeriod: true, coverage: 'complete', metrics: {} },
        costs: { cooperation: 9, platformFee: 1, periodCreator: 10, juguang: 5 },
        juguang: {
          coverage: 'complete',
          total: { spend: 5 },
          inTask: { spend: 5 },
          outsideTask: { spend: 0 },
          taskStatuses: [
            { key: 'in_task', spend: 5 },
            { key: 'out_of_task', spend: 999 },
          ],
        },
        star: { metrics: { storeVisitUv: 3 } },
        results: {},
      },
      {
        noteId: 'fictional-note-partial-alignment',
        title: '任务周期覆盖不完整笔记',
        publishDate: '2030-01-13',
        task: { projectIds: ['fictional-project-1'], orderIds: ['fictional-order-1'], intervals: [] },
        pgy: { includedInPeriod: true, coverage: 'complete', metrics: {} },
        costs: { cooperation: 9, platformFee: 1, periodCreator: 10, juguang: 5 },
        juguang: {
          coverage: 'complete',
          alignmentCoverage: 'partial',
          total: { spend: 5 },
          inTask: { spend: 0 },
          outsideTask: { spend: 0 },
          taskStatuses: [{ key: 'unknown', spend: 5 }],
        },
        star: { metrics: { storeVisitUv: 3 } },
        results: {},
      },
      {
        noteId: 'fictional-note-unknown',
        title: '旧归档未知笔记',
        publishDate: null,
        task: { projectIds: [], orderIds: [], intervals: [] },
        pgy: { metrics: {} },
        costs: { periodCreator: null, juguang: null, total: 0, starTaskAligned: 0 },
        juguang: {
          total: { spend: null },
          inTask: { spend: null },
          taskStatuses: [{ key: 'out_of_task', spend: null }],
        },
        star: { metrics: { storeVisitUv: 0 } },
        results: {},
      },
    ],
    actions: [],
  };
}

async function workbookFor(snapshot) {
  let captured = null;
  const XLSX = {
    utils: {
      book_new: () => ({ sheets: [] }),
      json_to_sheet: (rows) => ({ rows, '!ref': `A1:A${Math.max(2, rows.length + 1)}` }),
      book_append_sheet(workbook, sheet, name) { workbook.sheets.push({ name, sheet }); },
    },
    writeFile(workbook, filename) { captured = { workbook, filename }; },
  };
  const exporter = createExporter([], snapshot, XLSX, async () => true);
  await exporter();
  assert.ok(captured, 'workbook must be written');
  return new Map(captured.workbook.sheets.map(({ name, sheet }) => [name, sheet]));
}

test('workbook groups Juguang by real placementType and recomputes product-seeding external cost', async () => {
  const rows = (await workbookFor(v3Snapshot())).get('聚光分析').rows;
  const feed = rows.find((row) => row.营销诉求 === '产品种草' && row.投放位置 === 'fixture-feed');
  const missing = rows.find((row) => row.营销诉求 === '产品种草' && row.投放位置 === 'fixture-search');
  const legacy = rows.find((row) => row.广告账户ID === 'fictional-legacy-account');

  assert.ok(feed, 'missing placement group');
  assert.equal(feed.总消耗, 60);
  assert.equal(feed['15日站外活跃UV'], 15);
  assert.equal(feed['15日站外行为成本'], 4,
    'cost must be aggregate product-seeding spend / aggregate active UV');
  assert.ok(missing, 'missing incomplete placement group');
  assert.equal(missing['15日站外活跃UV'], '—');
  assert.equal(missing['15日站外行为成本'], '—');
  assert.equal(legacy.投放位置, '—', 'legacy deliveryMode must not masquerade as placementType');
  assert.equal(Object.prototype.hasOwnProperty.call(feed, '投放模式'), false);
});

test('workbook account overview exports PGY task and overdue note counts', async () => {
  const overview = (await workbookFor(v3Snapshot())).get('小红书账户总览').rows[0];
  assert.equal(overview.星河任务笔记数, 3);
  assert.equal(overview.超期笔记数, 2);
});

test('workbook calls Star orders tasks while preserving their archived identity', async () => {
  const sheets = await workbookFor(v3Snapshot());
  assert.equal(sheets.has('星河项目订单'), false);
  const rows = sheets.get('星河项目任务').rows;
  const task = rows.find((row) => row.层级 === '任务');

  assert.ok(task, 'missing task summary');
  assert.equal(task.任务ID, 'fictional-order-1');
  assert.equal(task.业务任务身份, '已验证');
  assert.equal(Object.keys(task).some((key) => key.includes('订单')), false);
  assert.deepEqual(rows.map((row) => row.层级), ['项目', '任务']);
  assert.equal(JSON.stringify(rows).includes('fictional-nested-star-note'), false);
  assert.equal(JSON.stringify(rows).includes('fictional-unassigned-star-note'), false);
  assert.ok(sheets.get('笔记全链路').rows.some((row) => (
    row.笔记ID === 'fictional-note-formula'
  )), 'independent note explorer must remain available');
});

test('workbook note table derives approved costs and keeps unavailable legacy facts unknown', async () => {
  const rows = (await workbookFor(v3Snapshot())).get('笔记全链路').rows;
  const formula = rows.find((row) => row.笔记ID === 'fictional-note-formula');
  const unknown = rows.find((row) => row.笔记ID === 'fictional-note-unknown');

  assert.equal(formula.总花费, 200);
  assert.equal(formula.任务期内花费, 140);
  assert.equal(formula.任务期外花费, 60);
  assert.equal(formula.进店成本, 7);
  assert.notEqual(formula.总花费, 9999);
  assert.notEqual(formula.任务期内花费, 8888);
  assert.notEqual(formula.任务期内花费, 7777);
  for (const key of ['总花费', '任务期内花费', '任务期外花费', '进店成本']) {
    assert.equal(unknown[key], '—', `${key} must not turn unavailable facts into zero`);
  }
});

test('workbook note costs honor partial source coverage and preserve an explicit complete zero', async () => {
  const rows = (await workbookFor(v3Snapshot())).get('笔记全链路').rows;
  const partialPgy = rows.find((row) => row.笔记ID === 'fictional-note-partial-pgy');
  const partialJuguang = rows.find((row) => row.笔记ID === 'fictional-note-partial-juguang');
  const completeZero = rows.find((row) => row.笔记ID === 'fictional-note-complete-zero-outside');
  const partialAlignment = rows.find((row) => row.笔记ID === 'fictional-note-partial-alignment');

  assert.equal(partialPgy.合作实付, '—');
  assert.equal(partialPgy.平台服务费, '—');
  assert.equal(partialPgy.本期达人花费, '—');
  assert.equal(partialPgy.广告花费, 5);
  assert.equal(partialPgy.任务期内广告花费, 2);
  assert.equal(partialPgy.任务期外花费, 3);
  for (const key of ['总花费', '任务期内花费', '进店成本']) {
    assert.equal(partialPgy[key], '—', `${key} must stay unknown while PGY is partial`);
  }

  assert.equal(partialJuguang.本期达人花费, 12);
  for (const key of [
    '广告花费', '任务期内广告花费', '任务期外花费',
    '总花费', '任务期内花费', '进店成本',
  ]) {
    assert.equal(partialJuguang[key], '—',
      `${key} must not be reconstructed from observed Juguang buckets while coverage is partial`);
  }

  assert.equal(completeZero.总花费, 15);
  assert.equal(completeZero.任务期内花费, 15);
  assert.equal(completeZero.任务期外花费, 0,
    'an explicit zero from a complete outside-task bucket must remain numeric zero');
  assert.equal(completeZero.进店成本, 5);

  assert.equal(partialAlignment.本期达人花费, 10);
  assert.equal(partialAlignment.广告花费, 5);
  assert.equal(partialAlignment.总花费, 15);
  for (const key of ['任务期内广告花费', '任务期外花费', '任务期内花费', '进店成本']) {
    assert.equal(partialAlignment[key], '—',
      `${key} must stay unknown while Star task-period alignment is partial`);
  }
});
