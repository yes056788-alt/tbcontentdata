const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');
const { normalizeReportRow } = require('../xhs/juguang-collector');

let reportModelApi;
let reportModelLoadError;
try {
  reportModelApi = require('../xhs/report-model');
} catch (error) {
  reportModelLoadError = error;
}

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-04',
  timezone: 'Asia/Shanghai',
});

function reportModel() {
  if (reportModelLoadError) {
    assert.fail(`xhs/report-model.js must expose the Juguang v2 report API: ${reportModelLoadError.message}`);
  }
  assert.equal(typeof reportModelApi.aggregateSpotlight, 'function');
  return reportModelApi;
}

function rawJuguangRow(noteId, date, marketingTarget, deliveryMode, metrics) {
  return {
    noteId,
    dimensions: { noteId, time: date, marketingTarget, deliveryMode },
    metrics: {
      fee: 0,
      impression: 0,
      click: 0,
      interaction: 0,
      iUserNum: 0,
      tiUserNum: 0,
      externalGoodsOrder15: 0,
      outClickEnterStoreCnt15d: 0,
      externalRgmv15: 0,
      externalRoi15: 0,
      ...metrics,
    },
  };
}

function juguangAccount(accountId, accountName, dailyRows, accountPlatformRoi15) {
  const spend = dailyRows.reduce((sum, row) => sum + Number(row.metrics.fee || 0), 0);
  return {
    account: {
      vSellerId: accountId,
      advertiserId: accountId === 'fictional-account-a' ? 3001 : 3002,
      accountType: accountId === 'fictional-account-a' ? 4 : 602,
      name: accountName,
      brand: { brandUserId: 'fictional-brand-001' },
    },
    status: 'complete',
    schemaValid: true,
    truncated: false,
    accountSummary: {
      dimensions: {},
      metrics: { fee: spend, externalRoi15: accountPlatformRoi15 },
    },
    summaryRows: [],
    dailyRows,
    reconciliation: {
      reconciled: true,
      accountSpend: spend,
      summarySpend: spend,
      dailySpend: spend,
      issues: [],
    },
    warnings: [],
    errors: [],
  };
}

function analysisInput() {
  const accountA = juguangAccount('fictional-account-a', '虚构聚光账户 A', [
    rawJuguangRow('fictional-note-a', '2029-12-31', 13, 0, {
      fee: 999, impression: 9990, click: 999, interaction: 99,
      iUserNum: 99, tiUserNum: 19, outClickEnterStoreCnt15d: 99,
      externalGoodsOrder15: 9, externalRgmv15: 999, externalRoi15: 1,
    }),
    rawJuguangRow('fictional-note-a', '2030-01-01', 4, 0, {
      fee: 10, impression: 100, click: 10, interaction: 5,
      iUserNum: 7, tiUserNum: 2,
    }),
    rawJuguangRow('fictional-note-a', '2030-01-02', 13, 0, {
      fee: 20, impression: 200, click: 20, interaction: 10,
      iUserNum: 8, tiUserNum: 3, outClickEnterStoreCnt15d: 4,
      externalGoodsOrder15: 1, externalRgmv15: 60, externalRoi15: 3,
    }),
    rawJuguangRow('fictional-note-a', '2030-01-03', 4, 1, {
      fee: 30, impression: 300, click: 30, interaction: 15,
      iUserNum: 9, tiUserNum: 4,
    }),
    rawJuguangRow('fictional-note-a', '2030-01-04', 13, 1, {
      fee: 40, impression: 400, click: 40, interaction: 20,
      iUserNum: 10, tiUserNum: 5, outClickEnterStoreCnt15d: 8,
      externalGoodsOrder15: 2, externalRgmv15: 100, externalRoi15: 2.5,
    }),
    rawJuguangRow('fictional-note-a', '2030-01-05', 13, 1, {
      fee: 888, impression: 8880, click: 888, interaction: 88,
      iUserNum: 88, tiUserNum: 18, outClickEnterStoreCnt15d: 88,
      externalGoodsOrder15: 8, externalRgmv15: 888, externalRoi15: 1,
    }),
  ], 2.67);

  const accountB = juguangAccount('fictional-account-b', '虚构聚光账户 B', [
    rawJuguangRow('fictional-note-b', '2030-01-02', 13, 0, {
      fee: 50, impression: 500, click: 50, interaction: 25,
      iUserNum: 11, tiUserNum: 6, outClickEnterStoreCnt15d: 10,
      externalGoodsOrder15: 3, externalRgmv15: 200, externalRoi15: 4,
    }),
    rawJuguangRow('fictional-note-c', '2030-01-03', 13, 0, {
      fee: 5, impression: 50, click: 5, interaction: 2,
      iUserNum: 1, tiUserNum: 1, outClickEnterStoreCnt15d: 1,
      externalGoodsOrder15: 0, externalRgmv15: 10, externalRoi15: 2,
    }),
  ], 3.82);

  return {
    runId: 'fictional-juguang-report-v2-run',
    storeId: 'fictional-store-001',
    selectedPlatforms: ['juguang', 'adstar'],
    generatedAt: '2030-01-05T08:00:00.000Z',
    asOf: '2030-01-05',
    dateRange: { ...RANGE },
    collections: {
      juguang: {
        schemaVersion: 1,
        platform: 'juguang',
        runId: 'fictional-juguang-report-v2-run',
        accountKey: 'fictional-juguang-group',
        dateRange: { ...RANGE },
        status: 'complete',
        truncated: false,
        initialAccount: accountA.account,
        restoredAccount: accountA.account,
        accounts: [accountA, accountB],
        attribution: {
          basis: 'conversion_time',
          dataCaliber: 0,
          windowDays: 15,
          splitColumns: ['marketingTarget', 'deliveryMode'],
        },
        warnings: [],
        errors: [],
      },
      adstar: {
        schemaVersion: 1,
        platform: 'adstar',
        runId: 'fictional-juguang-report-v2-run',
        accountKey: 'fictional-star-account',
        dateRange: { ...RANGE },
        status: 'complete',
        schemaValid: true,
        paginationComplete: true,
        reconciled: true,
        truncated: false,
        identity: { memberId: 'fictional-star-member', memberName: '虚构星河账户' },
        lists: {
          projects: { status: 'complete', items: [] },
          orders: {
            status: 'complete',
            items: [{
              orderId: 'fictional-order-a',
              projectId: 'fictional-project-a',
              startTime: '2030-01-02 00:00:00',
              endTime: '2030-01-03 23:59:59',
            }],
          },
        },
        // note-a has a valid task interval. note-c is known to Star but has no
        // valid interval, so its Juguang rows must remain in the unknown bucket.
        contentRows: [
          {
            noteId: 'fictional-note-a', listOrderId: 'fictional-order-a',
            projectId: 'fictional-project-a', theDate: '20300102',
          },
          {
            noteId: 'fictional-note-c', reportOrderId: 'fictional-order-missing',
            projectId: 'fictional-project-missing', theDate: '20300103',
          },
        ],
        storeSummary: {},
        nested: [],
        warnings: [],
        errors: [],
      },
    },
  };
}

function inRangeDailyRows() {
  return createXhsAnalysisSnapshot(analysisInput()).spotlight.daily.filter((row) => (
    row.date >= RANGE.from && row.date <= RANGE.to
  ));
}

function pickSpend(summary) {
  return {
    total: summary.spend.total,
    inTask: summary.spend.inTask,
    outsideTask: summary.spend.outsideTask,
    unknown: summary.spend.unknown,
  };
}

function pickDelivery(summary) {
  return {
    impressions: summary.impressions,
    clicks: summary.clicks,
    interactions: summary.interactions,
    seedUsers: summary.seedUsers,
    deepSeedUsers: summary.deepSeedUsers,
  };
}

function pickConversion(summary) {
  const value = summary.conversion15;
  return {
    observability: value.observability,
    directSpend: value.directSpend,
    storeVisits: value.storeVisits,
    orders: value.orders,
    gmv: value.gmv,
    calculatedRoi15: value.calculatedRoi15,
  };
}

function findNode(groups, keys) {
  let nodes = groups;
  let node = null;
  for (const key of keys) {
    node = nodes.find((candidate) => candidate.key === key);
    assert.ok(node, `missing recursive group ${JSON.stringify(keys)}`);
    nodes = Array.isArray(node.children) ? node.children : [];
  }
  return node;
}

test('Juguang collector keeps the platform externalRoi15 value as a numeric metric', () => {
  const row = normalizeReportRow({
    noteId: 'fictional-note-roi',
    time: '2030-01-02',
    marketingTarget: 13,
    deliveryMode: 0,
    dataValueJson: JSON.stringify({
      fee: '20.00',
      externalRgmv15: '65.00',
      externalRoi15: '3.25',
    }),
  });

  assert.equal(row.metrics.externalRoi15, 3.25);
});

test('analysis locally applies the inclusive date range to Juguang daily rows', () => {
  const snapshot = createXhsAnalysisSnapshot(analysisInput());
  const daily = snapshot.spotlight.daily;

  assert.equal(daily.length, 6, 'rows outside the selected range must be removed locally');
  assert.ok(daily.every((row) => row.date >= RANGE.from && row.date <= RANGE.to));
  assert.equal(daily.some((row) => row.spend === 999 || row.spend === 888), false);
});

test('analysis keeps platform ROI on direct daily rows and keeps product-seeding conversion unobservable', () => {
  const daily = createXhsAnalysisSnapshot(analysisInput()).spotlight.daily;

  const direct = daily.find((row) => (
    row.accountId === 'fictional-account-a' && row.date === '2030-01-02'
  ));
  assert.equal(direct.conversion.observable, true);
  assert.equal(direct.conversion.platformRoi15, 3);

  const productSeeding = daily.find((row) => (
    row.accountId === 'fictional-account-a' && row.date === '2030-01-03'
  ));
  assert.equal(productSeeding.marketingObjective, 'product_seeding');
  assert.equal(productSeeding.conversion.observable, false);
  assert.equal(productSeeding.conversion.storeVisits, null);
  assert.equal(productSeeding.conversion.orders, null);
  assert.equal(productSeeding.conversion.gmv, null);
});

test('does not manufacture zero 15-day conversions when a direct row omits required fields', () => {
  const input = analysisInput();
  const row = input.collections.juguang.accounts[0].dailyRows.find((item) => (
    item.dimensions.time === '2030-01-02'
  ));
  delete row.metrics.outClickEnterStoreCnt15d;
  delete row.metrics.externalGoodsOrder15;
  delete row.metrics.externalRgmv15;

  const snapshot = createXhsAnalysisSnapshot(input);
  const normalized = snapshot.spotlight.daily.find((item) => (
    item.accountId === 'fictional-account-a' && item.date === '2030-01-02'
  ));
  assert.equal(normalized.conversion.observable, false);
  assert.equal(normalized.conversion.storeVisits, null);
  assert.equal(normalized.conversion.orders, null);
  assert.equal(normalized.conversion.gmv, null);
});

test('keeps management and note direct ROI unknown when any direct fact lacks 15-day fields', () => {
  const input = analysisInput();
  const incompleteOutsideTask = input.collections.juguang.accounts[0].dailyRows.find((item) => (
    item.dimensions.time === '2030-01-04'
  ));
  delete incompleteOutsideTask.metrics.outClickEnterStoreCnt15d;
  delete incompleteOutsideTask.metrics.externalGoodsOrder15;
  delete incompleteOutsideTask.metrics.externalRgmv15;
  input.collections.adstar.contentRows[0].readUv1d = 1;

  const snapshot = createXhsAnalysisSnapshot(input);
  const joinedNote = snapshot.notes.find((note) => note.noteId === 'fictional-note-a');
  const directGroup = snapshot.spotlight.byMarketingObjective.find((group) => group.key === 'direct');

  assert.equal(snapshot.management.directResult.spend, 115,
    'all direct spend remains in the denominator even when one conversion fact is unavailable');
  assert.equal(snapshot.management.directResult.gmv, null);
  assert.equal(snapshot.management.directResult.roi, null);
  assert.equal(snapshot.management.accountOverview.directRoi, null);
  assert.equal(snapshot.management.outsideDirectResult.spend, 90);
  assert.equal(snapshot.management.outsideDirectResult.gmv, null);
  assert.equal(snapshot.management.accountOverview.outsideDirectRoi, null);
  assert.ok(joinedNote);
  assert.equal(joinedNote.results.outsideDirectGmv, null);
  assert.equal(joinedNote.results.outsideDirectRoi, null);
  assert.equal(directGroup.directSpend, 115);
  assert.equal(directGroup.gmv, null);
  assert.equal(directGroup.roi, null);
});

test('keeps task status and outside-task ROI unknown when Star coverage is unavailable', () => {
  const input = analysisInput();
  input.selectedPlatforms = ['juguang'];
  input.collections = { juguang: input.collections.juguang };

  const snapshot = createXhsAnalysisSnapshot(input);
  assert.ok(snapshot.spotlight.daily.every((row) => row.taskStatus === 'unknown'));
  assert.equal(snapshot.management.accountOverview.taskAdSpend, null);
  assert.equal(snapshot.management.accountOverview.outsideTaskAdSpend, null);
  assert.equal(snapshot.management.accountOverview.unknownTaskAdSpend, 155);
  assert.equal(snapshot.management.accountOverview.starAlignedSpend, null);
  assert.equal(snapshot.management.costs.starTaskAligned, null);
  assert.equal(snapshot.management.noteCount, null,
    'Star is the joined-note root, so its unavailable count must remain unknown');
  assert.equal(snapshot.management.accountOverview.outsideDirectRoi, null);
});

test('aggregateSpotlight filters independently and returns all required metrics for a single dimension', () => {
  const daily = inRangeDailyRows();
  const result = reportModel().aggregateSpotlight({
    rows: daily,
    groupBy: ['marketingObjective'],
    filters: {
      accountIds: ['fictional-account-a'],
      marketingObjectives: [],
      deliveryModes: [0],
    },
  });

  assert.deepEqual(result.groupBy, ['marketingObjective']);
  assert.deepEqual(pickSpend(result.summary), {
    total: 30, inTask: 20, outsideTask: 10, unknown: 0,
  });
  assert.deepEqual(pickDelivery(result.summary), {
    impressions: 300, clicks: 30, interactions: 15, seedUsers: 15, deepSeedUsers: 5,
  });
  assert.deepEqual(pickConversion(result.summary), {
    observability: 'observable',
    directSpend: 20,
    storeVisits: 4,
    orders: 1,
    gmv: 60,
    calculatedRoi15: 3,
  }, 'product-seeding rows must not downgrade complete direct conversion facts');
  assert.equal(result.summary.conversion15.platformRoi15, 3,
    'an exact direct platform ROI survives alongside structurally unobservable product-seeding rows');

  const direct = findNode(result.groups, ['direct']);
  assert.equal(direct.dimension, 'marketingObjective');
  assert.equal(direct.label, '种草直达');
  assert.equal(direct.level, 1);
  assert.deepEqual(pickSpend(direct.summary), {
    total: 20, inTask: 20, outsideTask: 0, unknown: 0,
  });
  assert.deepEqual(pickConversion(direct.summary), {
    observability: 'observable',
    directSpend: 20,
    storeVisits: 4,
    orders: 1,
    gmv: 60,
    calculatedRoi15: 3,
  });
  assert.equal(direct.summary.conversion15.platformRoi15, 3,
    'a single platform fact may expose its exact original ROI');

  const productSeeding = findNode(result.groups, ['product_seeding']);
  assert.equal(productSeeding.label, '产品种草');
  assert.deepEqual(pickConversion(productSeeding.summary), {
    observability: 'unobservable',
    directSpend: 0,
    storeVisits: null,
    orders: null,
    gmv: null,
    calculatedRoi15: null,
  });
});

test('aggregateSpotlight honors ordered 1-3 dimension grouping and reconciles task spend buckets', () => {
  const daily = inRangeDailyRows();
  const result = reportModel().aggregateSpotlight({
    rows: daily,
    groupBy: ['account', 'marketingObjective', 'deliveryMode'],
    filters: {},
  });

  assert.deepEqual(result.groupBy, ['account', 'marketingObjective', 'deliveryMode']);
  assert.deepEqual(pickSpend(result.summary), {
    total: 155, inTask: 50, outsideTask: 100, unknown: 5,
  });
  assert.equal(
    result.summary.spend.total,
    result.summary.spend.inTask + result.summary.spend.outsideTask + result.summary.spend.unknown,
  );
  assert.deepEqual(pickDelivery(result.summary), {
    impressions: 1550,
    clicks: 155,
    interactions: 77,
    seedUsers: 46,
    deepSeedUsers: 21,
  });
  assert.deepEqual(pickConversion(result.summary), {
    observability: 'observable',
    directSpend: 115,
    storeVisits: 23,
    orders: 6,
    gmv: 370,
    calculatedRoi15: 370 / 115,
  });

  const accountA = findNode(result.groups, ['fictional-account-a']);
  assert.equal(accountA.dimension, 'account');
  assert.equal(accountA.label, '虚构聚光账户 A');
  assert.equal(accountA.level, 1);
  assert.deepEqual(pickSpend(accountA.summary), {
    total: 100, inTask: 50, outsideTask: 50, unknown: 0,
  });

  const direct = findNode(result.groups, ['fictional-account-a', 'direct']);
  assert.equal(direct.dimension, 'marketingObjective');
  assert.equal(direct.level, 2);
  assert.deepEqual(pickConversion(direct.summary), {
    observability: 'observable',
    directSpend: 60,
    storeVisits: 12,
    orders: 3,
    gmv: 160,
    calculatedRoi15: 160 / 60,
  });
  assert.ok(
    direct.summary.conversion15.platformRoi15 == null,
    'platform ROI is non-additive and must not be averaged across 3.0 and 2.5',
  );
  assert.notEqual(direct.summary.conversion15.platformRoi15, (3 + 2.5) / 2);

  const manual = findNode(result.groups, ['fictional-account-a', 'direct', 0]);
  assert.equal(manual.dimension, 'deliveryMode');
  assert.equal(manual.label, '手动投放');
  assert.equal(manual.level, 3);
  assert.deepEqual(pickSpend(manual.summary), {
    total: 20, inTask: 20, outsideTask: 0, unknown: 0,
  });
  assert.equal(manual.summary.conversion15.platformRoi15, 3);
});

test('aggregateSpotlight nulls partial direct conversions without letting product-seeding rows poison direct ROI', () => {
  const rows = inRangeDailyRows().map((row) => ({
    ...row,
    conversion: { ...row.conversion },
  }));
  const incomplete = rows.find((row) => (
    row.accountId === 'fictional-account-a' && row.date === '2030-01-04'
  ));
  incomplete.conversion = {
    observable: false,
    storeVisits: null,
    orders: null,
    gmv: null,
    platformRoi15: incomplete.conversion.platformRoi15,
  };

  const partial = reportModel().aggregateSpotlight({
    rows,
    groupBy: ['marketingObjective'],
    filters: { accountIds: ['fictional-account-a'] },
  });
  const partialDirect = findNode(partial.groups, ['direct']);
  const productSeeding = findNode(partial.groups, ['product_seeding']);

  assert.deepEqual(pickConversion(partialDirect.summary), {
    observability: 'partial',
    directSpend: 60,
    storeVisits: null,
    orders: null,
    gmv: null,
    calculatedRoi15: null,
  });
  assert.deepEqual(pickConversion(productSeeding.summary), {
    observability: 'unobservable',
    directSpend: 0,
    storeVisits: null,
    orders: null,
    gmv: null,
    calculatedRoi15: null,
  });

  const otherDirect = rows.find((row) => (
    row.accountId === 'fictional-account-a' && row.date === '2030-01-02'
  ));
  otherDirect.conversion = {
    observable: false,
    storeVisits: null,
    orders: null,
    gmv: null,
    platformRoi15: otherDirect.conversion.platformRoi15,
  };
  const unobservable = reportModel().aggregateSpotlight({
    rows,
    groupBy: ['marketingObjective'],
    filters: { accountIds: ['fictional-account-a'] },
  });
  assert.deepEqual(pickConversion(findNode(unobservable.groups, ['direct']).summary), {
    observability: 'unobservable',
    directSpend: 60,
    storeVisits: null,
    orders: null,
    gmv: null,
    calculatedRoi15: null,
  });
});

test('aggregateSpotlight keeps unknown task spend separate from task-outside spend', () => {
  const daily = inRangeDailyRows();
  const result = reportModel().aggregateSpotlight({
    rows: daily,
    groupBy: ['account'],
    filters: { accountIds: ['fictional-account-b'] },
  });

  assert.deepEqual(pickSpend(result.summary), {
    total: 55, inTask: 0, outsideTask: 50, unknown: 5,
  });
  const accountB = findNode(result.groups, ['fictional-account-b']);
  assert.deepEqual(pickSpend(accountB.summary), {
    total: 55, inTask: 0, outsideTask: 50, unknown: 5,
  });
});

test('aggregateSpotlight rejects missing, duplicate, oversized, and non-allowlisted dimensions', () => {
  const aggregateSpotlight = reportModel().aggregateSpotlight;
  const rows = inRangeDailyRows();

  for (const groupBy of [
    [],
    ['account', 'account'],
    ['account', 'marketingObjective', 'deliveryMode', 'account'],
    ['account', '__proto__'],
  ]) {
    assert.throws(
      () => aggregateSpotlight({ rows, groupBy, filters: {} }),
      /groupBy|dimension|allowlist|1-3|duplicate/i,
      `must reject groupBy=${JSON.stringify(groupBy)}`,
    );
  }
});
