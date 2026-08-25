const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-31',
  timezone: 'Asia/Shanghai',
});

function pgyNote(noteId, publishDate, cooperation, platformFee) {
  return {
    noteId,
    sourceKey: `fictional-cooperation-${noteId}`,
    title: `虚构笔记 ${noteId}`,
    publishDate,
    author: { id: `fictional-creator-${noteId}`, name: `虚构达人 ${noteId}` },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: { impressions: 1000, reads: 250, interactions: 40 },
  };
}

function juguangRow(noteId, time, marketingTarget, fee, conversion = {}) {
  return {
    noteId,
    dimensions: {
      noteId,
      time,
      marketingTarget,
      deliveryMode: 'fictional-delivery-mode',
    },
    metrics: {
      fee,
      impression: fee * 100,
      click: fee * 10,
      interaction: fee * 2,
      iUserNum: fee,
      tiUserNum: fee / 2,
      outClickEnterStoreCnt15d: conversion.storeVisits || 0,
      externalGoodsOrder15: conversion.orders || 0,
      externalRgmv15: conversion.gmv || 0,
      externalRoi15: conversion.platformRoi15 || 0,
    },
  };
}

function starContent(noteId, orderId, projectId, date, metrics = {}) {
  return {
    noteId,
    contentId: noteId,
    listOrderId: orderId,
    projectId,
    theDate: date,
    readUv1d: metrics.readUv || 0,
    engagementUv1d: metrics.engagementUv || 0,
    slrAttrSlrVstUv1d: metrics.storeVisitUv || 0,
    slrAttrItmOrdGmv1d: metrics.gmv || 0,
    slrAttrItmOrdGmv1d1bpOrd: metrics.taskGmv || 0,
  };
}

function starSummary(readUv, storeVisitUv, gmv, taskGmv) {
  return {
    readUv1d: readUv,
    engagementUv1d: readUv / 5,
    slrAttrSlrVstUv1d: storeVisitUv,
    slrAttrItmOrdGmv1d: gmv,
    slrAttrItmOrdGmv1d1bpOrd: taskGmv,
  };
}

function reportV2Input() {
  const pgy = {
    schemaVersion: 1,
    platform: 'pgy',
    runId: 'fictional-report-v2-run',
    accountKey: 'fictional-pgy-account',
    dateRange: structuredClone(RANGE),
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      accountKey: 'fictional-pgy-account',
      brandUserId: 'fictional-brand-user',
      brandUserName: '虚构蒲公英账户',
    },
    notes: [
      // In-period and present in Star: included in both the join and period creator spend.
      pgyNote('fictional-note-a', '2030-01-05', 100, 10),
      // Out-of-period but present in Star: retained in the join, excluded from period spend.
      pgyNote('fictional-note-b', '2029-12-15', 200, 20),
      // In-period but absent from Star: included in creator spend, excluded from the joined note root.
      pgyNote('fictional-note-c', '2030-01-10', 300, 30),
    ],
    reconciliation: {
      reconciled: true,
      expectedCount: 3,
      receivedCount: 3,
      uniqueCount: 3,
      duplicateCount: 0,
      cooperationCost: 600,
      platformFee: 60,
      issues: [],
    },
    warnings: [],
    errors: [],
  };

  const dailyRows = [
    // In task x product seeding = 10 + 50 = 60.
    juguangRow('fictional-note-a', '2030-01-05', 4, 10),
    juguangRow('fictional-note-b', '2030-01-16', 4, 50),
    // In task x direct = 20; 15-day GMV = 80.
    juguangRow('fictional-note-a', '2030-01-06', 13, 20, {
      storeVisits: 8, orders: 2, gmv: 80, platformRoi15: 4,
    }),
    // Outside task x product seeding = 30 + 70 = 100.
    juguangRow('fictional-note-a', '2030-01-12', 4, 30),
    juguangRow('fictional-note-c', '2030-01-20', 4, 70),
    // Outside task x direct = 40 + 60 + 80 = 180; 15-day GMV = 540.
    juguangRow('fictional-note-a', '2030-01-13', 13, 40, {
      storeVisits: 20, orders: 4, gmv: 200, platformRoi15: 5,
    }),
    juguangRow('fictional-note-b', '2030-01-25', 13, 60, {
      storeVisits: 18, orders: 3, gmv: 180, platformRoi15: 3,
    }),
    juguangRow('fictional-note-c', '2030-01-26', 13, 80, {
      storeVisits: 16, orders: 4, gmv: 160, platformRoi15: 2,
    }),
    // The note is known to Star, but its linked order has no interval; both dimensions stay unknown.
    juguangRow('fictional-note-u', '2030-01-18', 'fictional-unknown-objective', 90),
  ];
  const juguangAccount = {
    account: {
      vSellerId: 'fictional-advertiser',
      advertiserId: 3001,
      accountType: 4,
      name: '虚构聚光账户',
      brand: { brandUserId: 'fictional-juguang-brand' },
    },
    status: 'complete',
    schemaValid: true,
    truncated: false,
    accountSummary: { metrics: { fee: 450 } },
    summaryRows: [],
    dailyRows,
    reconciliation: {
      reconciled: true,
      accountSpend: 450,
      summarySpend: 450,
      dailySpend: 450,
      issues: [],
    },
    warnings: [],
    errors: [],
  };
  const juguang = {
    schemaVersion: 1,
    platform: 'juguang',
    runId: 'fictional-report-v2-run',
    accountKey: 'fictional-juguang-group',
    dateRange: structuredClone(RANGE),
    status: 'complete',
    truncated: false,
    initialAccount: structuredClone(juguangAccount.account),
    restoredAccount: structuredClone(juguangAccount.account),
    accounts: [juguangAccount],
    attribution: {
      basis: 'conversion_time', dataCaliber: 0, windowDays: 15,
      splitColumns: ['marketingTarget', 'deliveryMode'],
    },
    warnings: [],
    errors: [],
  };

  const projects = [
    {
      id: 'fictional-project-1', projectId: 'fictional-project-1',
      projectName: '虚构项目一', promoteShopMemberId: 'fictional-star-member',
      promoteShopName: '虚构星河店铺', startTime: '2030-01-01', endTime: '2030-01-31',
    },
    {
      id: 'fictional-project-2', projectId: 'fictional-project-2',
      projectName: '虚构项目二', promoteShopMemberId: 'fictional-star-member',
      promoteShopName: '虚构星河店铺', startTime: '2030-01-01', endTime: '2030-01-31',
    },
  ];
  const orders = [
    {
      orderId: 'fictional-order-1', projectId: 'fictional-project-1',
      orderName: '虚构订单一', settleSeqId: 'fictional-settle-1',
      startTime: '2030-01-01', endTime: '2030-01-10',
    },
    {
      orderId: 'fictional-order-2', projectId: 'fictional-project-1',
      orderName: '虚构订单二', settleSeqId: 'fictional-settle-2',
      startTime: '2030-01-15', endTime: '2030-01-20',
    },
    {
      orderId: 'fictional-order-u', projectId: 'fictional-project-2',
      orderName: '虚构无周期订单', settleSeqId: 'fictional-settle-u',
    },
    {
      orderId: 'fictional-order-x', projectId: 'fictional-project-2',
      orderName: '虚构期外订单', settleSeqId: 'fictional-settle-x',
      startTime: '2030-02-01', endTime: '2030-02-05',
    },
  ];
  const nested = [
    {
      type: 'project', id: 'fictional-project-1', name: '虚构项目一', status: 'complete',
      summary: starSummary(1000, 100, 1000, 400), details: { project: [], order: [] },
    },
    {
      type: 'project', id: 'fictional-project-2', name: '虚构项目二', status: 'complete',
      summary: starSummary(400, 50, 500, 200), details: { project: [], order: [] },
    },
    {
      type: 'order', id: 'fictional-order-1', projectId: 'fictional-project-1',
      name: '虚构订单一', status: 'complete',
      summary: starSummary(700, 80, 700, 300), details: { order: [], content: [] },
    },
    {
      type: 'order', id: 'fictional-order-2', projectId: 'fictional-project-1',
      name: '虚构订单二', status: 'complete',
      summary: starSummary(600, 60, 500, 200), details: { order: [], content: [] },
    },
    {
      type: 'order', id: 'fictional-order-u', projectId: 'fictional-project-2',
      name: '虚构无周期订单', status: 'complete',
      summary: starSummary(200, 20, 200, 100), details: { order: [], content: [] },
    },
  ];
  const adstar = {
    schemaVersion: 1,
    platform: 'adstar',
    runId: 'fictional-report-v2-run',
    accountKey: 'fictional-adstar-account',
    dateRange: structuredClone(RANGE),
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: { memberId: 'fictional-star-member', memberName: '虚构星河店铺' },
    lists: {
      projects: { status: 'complete', items: projects },
      orders: { status: 'complete', items: orders },
    },
    storeSummary: starSummary(1000, 200, 2000, 800),
    nested,
    contentRows: [
      starContent('fictional-note-a', 'fictional-order-1', 'fictional-project-1', '20300105', {
        readUv: 100, storeVisitUv: 20, gmv: 300, taskGmv: 100,
      }),
      starContent('fictional-note-b', 'fictional-order-2', 'fictional-project-1', '20300116', {
        readUv: 120, storeVisitUv: 30, gmv: 500, taskGmv: 200,
      }),
      starContent('fictional-note-u', 'fictional-order-u', 'fictional-project-2', '20300118', {
        readUv: 30, storeVisitUv: 5, gmv: 100, taskGmv: 50,
      }),
      // Must not enter the note root because its Star metric day is outside RANGE.
      starContent('fictional-note-x', 'fictional-order-x', 'fictional-project-2', '20300202', {
        readUv: 999, storeVisitUv: 999, gmv: 999, taskGmv: 999,
      }),
    ],
    excluded: { projects: [], orders: [] },
    warnings: [],
    errors: [],
  };

  return {
    runId: 'fictional-report-v2-run',
    storeId: 'fictional-store',
    dateRange: structuredClone(RANGE),
    generatedAt: '2030-02-01T00:00:00.000Z',
    asOf: '2030-01-31',
    collections: { pgy, juguang, adstar },
  };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${actual} to equal ${expected}`);
}

test('uses in-range Star data as the joined-note root while period-filtering PGY spend by publish date', () => {
  const snapshot = createXhsAnalysisSnapshot(reportV2Input());

  assert.deepEqual(snapshot.notes.map((note) => note.noteId).sort(), [
    'fictional-note-a',
    'fictional-note-b',
    'fictional-note-u',
  ]);
  const inPeriod = snapshot.notes.find((note) => note.noteId === 'fictional-note-a');
  const outsidePeriod = snapshot.notes.find((note) => note.noteId === 'fictional-note-b');
  assert.equal(inPeriod.pgy.includedInPeriod, true);
  assert.equal(outsidePeriod.pgy.includedInPeriod, false);
  assert.equal(outsidePeriod.costs.cooperation, 200, '期外蒲公英仍可用于笔记联表展示');
  assert.equal(snapshot.management.costs.cooperation, 400);
  assert.equal(snapshot.management.costs.platformFee, 40);
  assert.equal(snapshot.management.costs.partnership, 440, '期间达人费只统计发布日期落在 RANGE 的蒲公英笔记');
  assert.equal(inPeriod.results.starTaskGmv, 100, '笔记任务 GMV 必须使用 seededProductGmv');
});

test('builds reconciled account spend, task-objective buckets, and three distinct ROI formulas', () => {
  const snapshot = createXhsAnalysisSnapshot(reportV2Input());
  const overview = snapshot.management.accountOverview;

  assert.deepEqual({
    totalSpend: overview.totalSpend,
    creatorSpend: overview.creatorSpend,
    adSpend: overview.adSpend,
    starAlignedSpend: overview.starAlignedSpend,
    taskAdSpend: overview.taskAdSpend,
    outsideTaskAdSpend: overview.outsideTaskAdSpend,
    unknownTaskAdSpend: overview.unknownTaskAdSpend,
  }, {
    totalSpend: 890,
    creatorSpend: 440,
    adSpend: 450,
    starAlignedSpend: null,
    taskAdSpend: 80,
    outsideTaskAdSpend: 280,
    unknownTaskAdSpend: 90,
  });
  assert.equal(overview.taskRoi, null,
    'unknown task-period spend must keep Star-aligned ROI unavailable');
  closeTo(overview.outsideDirectRoi, 540 / 180);
  closeTo(overview.directRoi, 620 / 200);

  const buckets = snapshot.spotlight.byTaskObjective;
  const spend = (taskStatus, marketingObjective) => {
    const row = buckets.find((item) => (
      item.taskStatus === taskStatus && item.marketingObjective === marketingObjective
    ));
    assert.ok(row, `missing ${taskStatus} x ${marketingObjective} bucket`);
    return row.spend;
  };
  assert.equal(spend('in_task', 'product_seeding'), 60);
  assert.equal(spend('in_task', 'direct'), 20);
  assert.equal(spend('outside_task', 'product_seeding'), 100);
  assert.equal(spend('outside_task', 'direct'), 180);
  assert.equal(spend('unknown', 'unknown'), 90);
  assert.equal(buckets.reduce((sum, row) => sum + row.spend, 0), overview.adSpend,
    '任务状态×营销诉求的全部实际桶必须与账户广告花费对账');
});

test('uses native Star summaries, derives store/task KPIs, and nests orders without cost allocation', () => {
  const snapshot = createXhsAnalysisSnapshot(reportV2Input());

  assert.deepEqual(snapshot.star.store.costs, {
    total: null,
    creator: 440,
    adInTask: null,
  });
  assert.equal(snapshot.star.store.metrics.readUv, 1000);
  assert.equal(snapshot.star.store.metrics.storeVisitUv, 200);
  closeTo(snapshot.star.store.metrics.visitRate, 200 / 1000);
  assert.equal(snapshot.star.store.metrics.visitCost, null);
  assert.equal(snapshot.star.store.storeRoi, null);
  assert.equal(snapshot.star.store.taskRoi, null);

  assert.deepEqual(snapshot.star.taskSummary.costs, snapshot.star.store.costs);
  assert.equal(snapshot.star.taskSummary.activeNoteCount, 3);
  assert.equal(snapshot.star.taskSummary.gmv, 800, '星河任务汇总 GMV 必须使用 seededProductGmv');
  assert.equal(snapshot.star.taskSummary.roi, null);

  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  assert.equal(project.metrics.readUv, 1000,
    '项目 UV 必须使用项目原生 summary，不能把订单 700 + 600 相加');
  assert.deepEqual(project.orders.map((order) => order.id), [
    'fictional-order-1',
    'fictional-order-2',
  ]);
  for (const unit of [project, ...project.orders]) {
    assert.equal(Object.hasOwn(unit, 'allocatedCost'), false);
    assert.equal(Object.hasOwn(unit, 'roi'), false);
  }
});

test('rolls real note costs through order and project hierarchy when publish date selects one candidate', () => {
  const input = reportV2Input();
  input.collections.adstar.contentRows.push(
    starContent('fictional-note-a', 'fictional-order-2', 'fictional-project-1', '20300116', {
      readUv: 10,
      storeVisitUv: 2,
      gmv: 20,
      taskGmv: 5,
    }),
  );

  const snapshot = createXhsAnalysisSnapshot(input);
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  const order1 = project.orders.find((item) => item.id === 'fictional-order-1');
  const order2 = project.orders.find((item) => item.id === 'fictional-order-2');

  assert.deepEqual(project.costs, { creator: 110, adInTask: 80, total: 190 });
  assert.deepEqual(order1.costs, { creator: 110, adInTask: 30, total: 140 });
  assert.deepEqual(order2.costs, { creator: 0, adInTask: 50, total: 50 });
  assert.deepEqual(order1.notes.map((note) => note.noteId), ['fictional-note-a']);
  assert.deepEqual(order2.notes.map((note) => note.noteId), ['fictional-note-b']);

  const placements = snapshot.star.projects.flatMap((item) => item.orders).flatMap((order) => (
    order.notes.map((note) => ({ projectId: order.projectId, orderId: order.id, note }))
  )).filter((item) => item.note.noteId === 'fictional-note-a');
  assert.equal(placements.length, 1, '同笔记多订单关联时成本只能归属一次');
  assert.equal(placements[0].orderId, 'fictional-order-1',
    '发布日仅命中一个候选订单周期时，归属该订单');
  assert.deepEqual(placements[0].note.ownership, {
    projectId: 'fictional-project-1',
    orderId: 'fictional-order-1',
    candidateOrderIds: ['fictional-order-1', 'fictional-order-2'],
    rule: 'unique_publish_date_interval',
  });
  assert.deepEqual(placements[0].note.costs, { creator: 110, adInTask: 30, total: 140 });

  assert.equal(project.metrics.readUv, 1000, '项目层仍保留星河原生汇总指标');
  assert.equal(order1.metrics.readUv, 700, '订单层仍保留星河原生汇总指标');
  assert.equal(placements[0].note.metrics.readUv, 110, '笔记层保留去重后的星河原生指标');
  for (const unit of [project, order1, order2]) {
    assert.equal(Object.hasOwn(unit, 'allocatedCost'), false, '层级成本不得回退为均摊成本');
  }
});

test('treats a fully reconciled non-owner relation as zero after one shared note gets a unique owner', () => {
  const input = reportV2Input();
  input.collections.adstar.contentRows = input.collections.adstar.contentRows.filter((row) => (
    row.noteId !== 'fictional-note-b'
  ));
  input.collections.adstar.contentRows.push(
    starContent('fictional-note-a', 'fictional-order-2', 'fictional-project-1', '20300105', {
      readUv: 10, storeVisitUv: 2, gmv: 20, taskGmv: 5,
    }),
  );
  const secondUnit = input.collections.adstar.nested.find((unit) => (
    unit.id === 'fictional-order-2'
  ));
  secondUnit.checkpoints = {
    content: {
      status: 'complete', expectedCount: 1, receivedCount: 1, truncated: false,
    },
  };

  const snapshot = createXhsAnalysisSnapshot(input);
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  const order1 = project.orders.find((item) => item.id === 'fictional-order-1');
  const order2 = project.orders.find((item) => item.id === 'fictional-order-2');

  assert.deepEqual(order1.notes.map((note) => note.noteId), ['fictional-note-a']);
  assert.deepEqual(order2.notes, []);
  assert.deepEqual(order2.costs, { creator: 0, adInTask: 0, total: 0 },
    '同一笔记已唯一归属另一候选订单时，完整的非归属关系不得毒化项目成本');
  assert.equal(order2.costCoverage, 'complete');
  assert.deepEqual(project.costs, order1.costs);
});

test('keeps duplicated store summaries as real objects instead of circular sanitizer markers', () => {
  const snapshot = createXhsAnalysisSnapshot(reportV2Input());

  assert.equal(typeof snapshot.management.starTaskResult.metrics, 'object');
  assert.equal(typeof snapshot.management.storeResult.metrics, 'object');
  assert.equal(typeof snapshot.star.store.metrics, 'object');
  assert.deepEqual(snapshot.management.storeResult.metrics, snapshot.management.starTaskResult.metrics);
  assert.deepEqual(snapshot.star.store.metrics, snapshot.management.starTaskResult.metrics);
});

test('excludes content rows without any valid Star metric from the joined-note root', () => {
  const input = reportV2Input();
  input.collections.adstar.contentRows.push({
    noteId: 'fictional-note-empty',
    contentId: 'fictional-note-empty',
    listOrderId: 'fictional-order-1',
    projectId: 'fictional-project-1',
    theDate: '20300107',
  });
  input.collections.adstar.contentRows.push(
    starContent('fictional-note-outside', 'fictional-order-1', 'fictional-project-1', '20300202', {
      readUv: 999, storeVisitUv: 999, gmv: 999, taskGmv: 999,
    }),
  );

  const snapshot = createXhsAnalysisSnapshot(input);
  assert.equal(snapshot.notes.some((note) => note.noteId === 'fictional-note-empty'), false);
  assert.equal(snapshot.notes.some((note) => note.noteId === 'fictional-note-outside'), false);
  assert.equal(snapshot.star.taskSummary.activeNoteCount, 3);
  const order = snapshot.star.orders.find((item) => item.id === 'fictional-order-1');
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  assert.deepEqual(order.costs, { creator: 110, adInTask: 30, total: 140 });
  assert.deepEqual(project.costs, { creator: 110, adInTask: 80, total: 190 },
    '期外或无指标原始行不属于有效关系事实，不得污染层级成本覆盖');
});

test('keeps unobserved Star note metrics null instead of manufacturing zeroes', () => {
  const input = reportV2Input();
  const row = input.collections.adstar.contentRows.find((item) => (
    item.noteId === 'fictional-note-a'
  ));
  delete row.engagementUv1d;
  delete row.slrAttrSlrVstUv1d;
  delete row.slrAttrItmOrdGmv1d;
  delete row.slrAttrItmOrdGmv1d1bpOrd;

  const snapshot = createXhsAnalysisSnapshot(input);
  const note = snapshot.notes.find((item) => item.noteId === 'fictional-note-a');
  const hierarchyNote = snapshot.star.orders.flatMap((order) => order.notes)
    .find((item) => item.noteId === 'fictional-note-a');

  assert.equal(note.star.metrics.readUv, 100);
  assert.equal(note.star.metrics.engagementUv, null);
  assert.equal(note.star.metrics.storeVisitUv, null);
  assert.equal(note.star.metrics.gmv, null);
  assert.equal(note.star.metrics.seededProductGmv, null);
  assert.equal(hierarchyNote.metrics.gmv, null);
});

test('does not let PGY-only task dates classify a note without a Star fact as in-task spend', () => {
  const input = reportV2Input();
  const pgyOnly = input.collections.pgy.notes.find((note) => note.noteId === 'fictional-note-c');
  pgyOnly.taskStartTime = '2030-01-01 00:00:00';
  pgyOnly.taskEndTime = '2030-01-31 23:59:59';

  const snapshot = createXhsAnalysisSnapshot(input);
  const rows = snapshot.spotlight.daily.filter((row) => row.noteId === 'fictional-note-c');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.taskStatus === 'no_task'));
  assert.equal(snapshot.management.accountOverview.taskAdSpend, 80);
});

test('keeps note task cost and outside-direct ROI unknown when Star coverage is partial', () => {
  const input = reportV2Input();
  input.collections.adstar.status = 'partial';
  input.collections.adstar.errors = [{
    code: 'fictional_nested_unit_incomplete',
    message: '虚构星河嵌套单元未完整',
  }];

  const snapshot = createXhsAnalysisSnapshot(input);
  const note = snapshot.notes.find((item) => item.noteId === 'fictional-note-a');
  assert.equal(note.costs.juguang, 100, '已采集的聚光总消耗仍可观测');
  assert.equal(note.costs.starTaskAligned, null);
  assert.equal(note.costs.outsideDirect, null);
  assert.equal(note.results.starTaskRoi, null);
  assert.equal(note.results.outsideDirectGmv, null);
  assert.equal(note.results.outsideDirectRoi, null);

  const noteRows = snapshot.spotlight.daily.filter((row) => row.noteId === 'fictional-note-a');
  assert.ok(noteRows.some((row) => row.date === '2030-01-05' && row.taskStatus === 'in_task'),
    '命中已知订单区间是可保留的任务内证据');
  assert.ok(noteRows.some((row) => row.date === '2030-01-12' && row.taskStatus === 'unknown'),
    '星河不完整时不能把未命中已知区间的日期判为任务外');
});

test('uses project and order lists as the hierarchy skeleton when nested facts are missing or failed', () => {
  const input = reportV2Input();
  input.collections.adstar.excluded.orders = [{
    id: 'fictional-order-x', reason: 'outside_date_range',
  }];
  input.collections.adstar.nested = input.collections.adstar.nested.filter((unit) => (
    unit.id === 'fictional-project-1' || unit.id === 'fictional-project-2' ||
    unit.id === 'fictional-order-1' || unit.id === 'fictional-order-2'
  ));
  const failedProject = input.collections.adstar.nested.find((unit) => (
    unit.id === 'fictional-project-2'
  ));
  failedProject.status = 'failed';
  failedProject.summary = null;
  const failedOrder = input.collections.adstar.nested.find((unit) => (
    unit.id === 'fictional-order-2'
  ));
  failedOrder.status = 'failed';
  failedOrder.summary = null;

  const snapshot = createXhsAnalysisSnapshot(input);

  assert.deepEqual(snapshot.star.projects.map((project) => project.id), [
    'fictional-project-1',
    'fictional-project-2',
  ]);
  assert.deepEqual(snapshot.star.orders.map((order) => order.id), [
    'fictional-order-1',
    'fictional-order-2',
    'fictional-order-u',
  ], '列表里的期内订单即使没有 nested 单元也不能消失，明确排除的期外订单不得进入');

  const project2 = snapshot.star.projects.find((project) => project.id === 'fictional-project-2');
  const failed = snapshot.star.orders.find((order) => order.id === 'fictional-order-2');
  const missing = snapshot.star.orders.find((order) => order.id === 'fictional-order-u');
  assert.equal(project2.status, 'failed');
  assert.equal(project2.metrics, null);
  assert.equal(project2.coverage, 'partial');
  assert.deepEqual(project2.orders.map((order) => order.id), [
    'fictional-order-u',
  ]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.metrics, null);
  assert.equal(failed.coverage, 'partial');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.metrics, null);
  assert.equal(missing.coverage, 'partial');
  assert.equal(missing.costs, null, '未知笔记覆盖不能制造 0 成本');
  assert.equal(project2.costs, null, '任一订单成本未知时项目成本必须未知');
});

test('only emits zero order cost when an empty content checkpoint explicitly reconciles to zero', () => {
  const unknownInput = reportV2Input();
  unknownInput.collections.adstar.contentRows = unknownInput.collections.adstar.contentRows.filter((row) => (
    row.listOrderId !== 'fictional-order-1'
  ));

  const unknownSnapshot = createXhsAnalysisSnapshot(unknownInput);
  const unknownOrder = unknownSnapshot.star.orders.find((order) => order.id === 'fictional-order-1');
  const unknownProject = unknownSnapshot.star.projects.find((project) => (
    project.id === 'fictional-project-1'
  ));
  assert.deepEqual(unknownOrder.notes, []);
  assert.equal(unknownOrder.costs, null);
  assert.equal(unknownOrder.costCoverage, 'partial');
  assert.equal(unknownProject.costs, null);

  const zeroInput = reportV2Input();
  zeroInput.collections.adstar.contentRows = zeroInput.collections.adstar.contentRows.filter((row) => (
    row.listOrderId !== 'fictional-order-1'
  ));
  const zeroUnit = zeroInput.collections.adstar.nested.find((unit) => (
    unit.id === 'fictional-order-1'
  ));
  zeroUnit.checkpoints = {
    content: {
      status: 'complete', expectedCount: 0, receivedCount: 0, truncated: false,
    },
  };

  const zeroSnapshot = createXhsAnalysisSnapshot(zeroInput);
  const zeroOrder = zeroSnapshot.star.orders.find((order) => order.id === 'fictional-order-1');
  const zeroProject = zeroSnapshot.star.projects.find((project) => (
    project.id === 'fictional-project-1'
  ));
  assert.deepEqual(zeroOrder.costs, { creator: 0, adInTask: 0, total: 0 });
  assert.equal(zeroOrder.costCoverage, 'complete');
  assert.deepEqual(zeroProject.costs, { creator: 0, adInTask: 50, total: 50 });
});

test('leaves a note unassigned when multiple candidate order periods remain ambiguous', () => {
  const input = reportV2Input();
  const secondOrder = input.collections.adstar.lists.orders.items.find((order) => (
    order.orderId === 'fictional-order-2'
  ));
  secondOrder.startTime = '2030-01-01';
  secondOrder.endTime = '2030-01-10';
  input.collections.adstar.contentRows.push(
    starContent('fictional-note-a', 'fictional-order-2', 'fictional-project-1', '20300105', {
      readUv: 10, storeVisitUv: 2, gmv: 20, taskGmv: 5,
    }),
  );

  const snapshot = createXhsAnalysisSnapshot(input);
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  const ambiguous = snapshot.star.unassignedNotes.find((note) => (
    note.noteId === 'fictional-note-a'
  ));

  assert.ok(ambiguous);
  assert.equal(ambiguous.reason, 'ambiguous_order_relation');
  assert.deepEqual(ambiguous.candidateOrderIds, [
    'fictional-order-1',
    'fictional-order-2',
  ]);
  assert.equal(project.orders.some((order) => (
    order.notes.some((note) => note.noteId === 'fictional-note-a')
  )), false, '歧义笔记不能按最早日期或订单 ID 强行归属');
  assert.equal(project.costs, null, '歧义笔记可能属于候选订单，项目成本必须保持未知');
  assert.ok(project.orders.every((order) => order.costs === null));

  const issue = snapshot.quality.issues.find((item) => (
    item.code === 'adstar_note_order_ambiguous'
  ));
  assert.ok(issue, '歧义关系必须进入安全覆盖问题');
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.message.includes('fictional-order'), false, '质量问题 message 不得泄露真实 ID');
  assert.equal(snapshot.quality.decisionReady, false);
});

test('turns collector project-report fallback rows into unverified report-order skeletons without fake business IDs', () => {
  const input = reportV2Input();
  const pgy = input.collections.pgy.notes.find((note) => note.noteId === 'fictional-note-a');
  pgy.taskStartTime = '2030-01-01 00:00:00';
  pgy.taskEndTime = '2030-01-10 23:59:59';
  const adstar = input.collections.adstar;
  adstar.lists.projects.items = adstar.lists.projects.items.filter((project) => (
    project.projectId === 'fictional-project-1'
  ));
  adstar.lists.orders.items = [];
  adstar.nested = [{
    type: 'project',
    id: 'fictional-project-1',
    name: '虚构项目一',
    status: 'complete',
    summary: starSummary(1000, 100, 1000, 400),
    details: {
      project: [],
      order: [{
        ds: '20300105',
        projectId: 'fictional-project-1',
        reportOrderId: 'fictional-report-order-1',
        noteId: 'fictional-note-a',
        contentId: 'fictional-note-a',
        readUv1d: 100,
      }],
    },
    checkpoints: {
      order: {
        status: 'complete', expectedCount: 1, receivedCount: 1, truncated: false,
      },
    },
    warnings: [],
    errors: [],
  }];
  adstar.contentRows = [{
    ds: '20300105',
    projectId: 'fictional-project-1',
    reportOrderId: 'fictional-report-order-1',
    noteId: 'fictional-note-a',
    contentId: 'fictional-note-a',
    readUv1d: 100,
    engagementUv1d: 20,
    slrAttrSlrVstUv1d: 10,
    slrAttrItmOrdGmv1d: 80,
    slrAttrItmOrdGmv1d1bpOrd: 30,
  }];

  const snapshot = createXhsAnalysisSnapshot(input);
  const project = snapshot.star.projects[0];
  const reportOrder = project.orders[0];

  assert.equal(snapshot.star.orders.length, 1);
  assert.equal(reportOrder.source, 'project_report');
  assert.equal(reportOrder.businessIdentityVerified, false);
  assert.equal(reportOrder.reportOrderId, 'fictional-report-order-1');
  assert.notEqual(reportOrder.id, reportOrder.reportOrderId,
    '报告 orderId 只能作为报表关系标识，不能冒充真实业务订单 ID');
  assert.equal(reportOrder.coverage, 'partial');
  assert.equal(reportOrder.costs, null);
  assert.deepEqual(reportOrder.notes.map((note) => note.noteId), ['fictional-note-a']);
  assert.equal(reportOrder.notes[0].metrics.readUv, 100);
  assert.equal(reportOrder.notes[0].costs, null,
    '报告订单身份未验证时不得把笔记成本归入该订单');
  const joinedNote = snapshot.notes.find((note) => note.noteId === 'fictional-note-a');
  assert.deepEqual(joinedNote.task.intervals, [],
    '项目报表订单没有真实业务订单周期，蒲公英任务日期不得替代星河周期');
  assert.ok(snapshot.spotlight.daily.filter((row) => row.noteId === 'fictional-note-a')
    .every((row) => row.taskStatus === 'unknown'));
  assert.equal(project.costs, null);
  assert.ok(snapshot.quality.issues.some((issue) => (
    issue.code === 'adstar_report_order_unverified'
  )));
});

test('keeps report-order identity separate when its raw value collides with a real business order ID', () => {
  const input = reportV2Input();
  const adstar = input.collections.adstar;
  adstar.lists.orders.items = adstar.lists.orders.items.filter((order) => (
    order.projectId === 'fictional-project-1'
  ));
  adstar.nested = adstar.nested.filter((unit) => (
    unit.type === 'project' || unit.projectId === 'fictional-project-1'
  ));
  const project2 = adstar.nested.find((unit) => unit.id === 'fictional-project-2');
  project2.details.order = [{
    ds: '20300118',
    projectId: 'fictional-project-2',
    reportOrderId: 'fictional-order-1',
    noteId: 'fictional-note-u',
    contentId: 'fictional-note-u',
    readUv1d: 30,
  }];
  project2.checkpoints = {
    order: {
      status: 'complete', expectedCount: 1, receivedCount: 1, truncated: false,
    },
  };
  adstar.contentRows = adstar.contentRows.filter((row) => row.noteId !== 'fictional-note-u');
  adstar.contentRows.push({
    ds: '20300118',
    projectId: 'fictional-project-2',
    reportOrderId: 'fictional-order-1',
    noteId: 'fictional-note-u',
    contentId: 'fictional-note-u',
    readUv1d: 30,
    engagementUv1d: 6,
    slrAttrSlrVstUv1d: 5,
    slrAttrItmOrdGmv1d: 100,
    slrAttrItmOrdGmv1d1bpOrd: 50,
  });

  const snapshot = createXhsAnalysisSnapshot(input);
  const note = snapshot.notes.find((item) => item.noteId === 'fictional-note-u');
  const businessOrder = snapshot.star.orders.find((order) => order.id === 'fictional-order-1');
  const reportOrder = snapshot.star.projects.find((project) => (
    project.id === 'fictional-project-2'
  )).orders[0];

  assert.deepEqual(note.task.orderIds, [], 'reportOrderId 不得进入真实业务订单 ID 集合');
  assert.deepEqual(note.task.reportOrderIds, ['fictional-order-1']);
  assert.deepEqual(note.task.intervals, [], 'reportOrderId 碰撞时不得借用真实订单周期');
  assert.equal(businessOrder.notes.some((item) => item.noteId === 'fictional-note-u'), false);
  assert.equal(reportOrder.source, 'project_report');
  assert.equal(reportOrder.businessIdentityVerified, false);
  assert.notEqual(reportOrder.id, 'fictional-order-1');
  assert.deepEqual(reportOrder.notes.map((item) => item.noteId), ['fictional-note-u']);
  assert.equal(reportOrder.costs, null);
});

test('keeps unmatched project-report notes visible beside verified orders in the same project', () => {
  const input = reportV2Input();
  const adstar = input.collections.adstar;
  const projectUnit = adstar.nested.find((unit) => unit.id === 'fictional-project-1');
  projectUnit.details.order = [{
    ds: '20300107',
    projectId: 'fictional-project-1',
    reportOrderId: 'fictional-report-order-extra',
    noteId: 'fictional-note-extra',
    contentId: 'fictional-note-extra',
    readUv1d: 40,
  }];
  projectUnit.checkpoints = {
    order: {
      status: 'complete', expectedCount: 1, receivedCount: 1, truncated: false,
    },
  };
  adstar.contentRows.push({
    ds: '20300107',
    projectId: 'fictional-project-1',
    reportOrderId: 'fictional-report-order-extra',
    noteId: 'fictional-note-extra',
    contentId: 'fictional-note-extra',
    readUv1d: 40,
    engagementUv1d: 8,
    slrAttrItmOrdGmv1d: 60,
  });

  const snapshot = createXhsAnalysisSnapshot(input);
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  const reportOrder = project.orders.find((order) => order.source === 'project_report');

  assert.ok(reportOrder, '同项目已有真实订单时，未被真实内容覆盖的项目报表关系仍要保留');
  assert.equal(reportOrder.businessIdentityVerified, false);
  assert.deepEqual(reportOrder.notes.map((note) => note.noteId), ['fictional-note-extra']);
  assert.equal(reportOrder.costs, null);
  assert.equal(project.costs, null);
});

test('exposes missing order relations as a safe unassigned bucket and nulls the affected project cost', () => {
  const input = reportV2Input();
  const starRow = input.collections.adstar.contentRows.find((row) => (
    row.noteId === 'fictional-note-a'
  ));
  starRow.listOrderId = 'fictional-missing-order';
  starRow.projectId = 'fictional-project-1';

  const snapshot = createXhsAnalysisSnapshot(input);
  const unassigned = snapshot.star.unassignedNotes.find((note) => (
    note.noteId === 'fictional-note-a'
  ));
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');
  const issue = snapshot.quality.issues.find((item) => (
    item.code === 'adstar_note_order_relation_missing'
  ));

  assert.deepEqual(unassigned, {
    noteId: 'fictional-note-a',
    title: '虚构笔记 fictional-note-a',
    publishDate: '2030-01-05',
    projectIds: ['fictional-project-1'],
    candidateOrderIds: [],
    reason: 'order_relation_missing',
    costs: { creator: 110, adInTask: 0, total: null },
    includedInHierarchy: false,
  });
  assert.equal(project.costs, null);
  assert.ok(issue);
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.message.includes('fictional-missing-order'), false);
  assert.equal(snapshot.quality.decisionReady, false);
});

test('keeps hierarchy financials unknown when PGY coverage is partial instead of filling missing creator cost with zero', () => {
  const input = reportV2Input();
  input.collections.pgy.status = 'partial';
  input.collections.pgy.notes = [];
  input.collections.pgy.errors = [{
    code: 'fictional_pgy_partial', message: '虚构蒲公英未采集完',
  }];

  const snapshot = createXhsAnalysisSnapshot(input);
  const note = snapshot.notes.find((item) => item.noteId === 'fictional-note-a');
  const order = snapshot.star.orders.find((item) => item.id === 'fictional-order-1');
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');

  assert.equal(note.costs.cooperation, null);
  assert.equal(note.costs.periodCreator, null);
  assert.equal(note.costs.starTaskAligned, null);
  assert.equal(snapshot.management.costs.partnership, null);
  assert.equal(snapshot.management.costs.starTaskAligned, null);
  assert.equal(order.costs, null);
  assert.equal(project.costs, null);
});

test('keeps hierarchy financials unknown when Juguang coverage is partial even if observed rows have spend', () => {
  const input = reportV2Input();
  input.collections.juguang.status = 'partial';
  input.collections.juguang.accounts[0].status = 'partial';
  input.collections.juguang.errors = [{
    code: 'fictional_juguang_partial', message: '虚构聚光未采集完',
  }];

  const snapshot = createXhsAnalysisSnapshot(input);
  const note = snapshot.notes.find((item) => item.noteId === 'fictional-note-a');
  const order = snapshot.star.orders.find((item) => item.id === 'fictional-order-1');
  const project = snapshot.star.projects.find((item) => item.id === 'fictional-project-1');

  assert.equal(note.costs.juguang, null);
  assert.equal(note.costs.periodTotal, null);
  assert.equal(note.costs.starTaskAligned, null);
  assert.equal(snapshot.management.costs.juguang, null);
  assert.equal(snapshot.management.costs.total, null);
  assert.equal(snapshot.management.costs.starTaskAligned, null);
  assert.equal(order.costs, null);
  assert.equal(project.costs, null);
  assert.ok(note.juguang && note.juguang.total.spend > 0,
    '可保留已观测明细用于排障，但不能将其声明为完整财务值');
});
