const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SNAPSHOT_SCHEMA,
  createXhsAnalysisSnapshot,
} = require('../xhs/analysis');
const { mapAnalysisSnapshot } = require('../xhs/metrics');

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-10',
  timezone: 'Asia/Shanghai',
});

function clone(value) {
  return structuredClone(value);
}

function pgyNote(sourceKey, cooperation, platformFee, extras = {}) {
  return {
    noteId: 'fictional-note-001',
    sourceKey,
    title: '虚构联表笔记',
    publishDate: '2029-12-01',
    author: { id: 'fictional-creator-001', name: '虚构达人' },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: { impressions: 1000, reads: 250, interactions: 40 },
    ...extras,
  };
}

function juguangRow(accountId, time, marketingTarget, deliveryMode, fee, conversion = {}) {
  return {
    noteId: 'fictional-note-001',
    accountId,
    dimensions: {
      noteId: 'fictional-note-001',
      time,
      marketingTarget,
      deliveryMode,
    },
    metrics: {
      fee,
      impression: fee * 100,
      click: fee * 10,
      interaction: fee * 2,
      externalGoodsOrder15: conversion.orders || 0,
      outClickEnterStoreCnt15d: conversion.storeVisits || 0,
      externalRgmv15: conversion.gmv || 0,
    },
  };
}

function completeInput() {
  const largeRawPayload = 'fictional-raw-payload-marker-'.repeat(12000);
  const pgy = {
    schemaVersion: 1,
    platform: 'pgy',
    runId: 'fictional-run-001',
    accountKey: 'fictional-pgy-account',
    dateRange: clone(RANGE),
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      accountKey: 'fictional-pgy-account',
      brandUserId: 'fictional-brand-user-001',
      brandUserName: '虚构品牌账户',
    },
    notes: [
      pgyNote('fictional-cooperation-001', 100, 10, {
        source: {
          rawPayload: largeRawPayload,
          signedUrl: 'https://media.example/note?noteId=fictional-note-001&xsec_token=fictional-xsec&sign=fictional-signature',
          cookie: 'fictional-cookie',
        },
      }),
      pgyNote('fictional-cooperation-002', 50, 5),
    ],
    reconciliation: {
      reconciled: true,
      expectedCount: 2,
      receivedCount: 2,
      uniqueCount: 1,
      duplicateCount: 0,
      cooperationCost: 150,
      platformFee: 15,
      issues: [],
    },
    warnings: [],
    errors: [],
  };

  const accountA = {
    account: {
      vSellerId: 'fictional-advertiser-a',
      advertiserId: 3001,
      accountType: 4,
      name: '虚构聚光账户 A',
      brand: { brandUserId: 'fictional-juguang-brand-001' },
    },
    status: 'complete',
    schemaValid: true,
    truncated: false,
    accountSummary: { metrics: { fee: 60 } },
    summaryRows: [juguangRow('fictional-advertiser-a', null, null, null, 60)],
    dailyRows: [
      juguangRow('fictional-advertiser-a', '2030-01-03', 4, 0, 20),
      juguangRow('fictional-advertiser-a', '2030-01-04', 13, 1, 20, {
        orders: 1, storeVisits: 5, gmv: 60,
      }),
      juguangRow('fictional-advertiser-a', '2030-01-08', 13, 1, 20, {
        orders: 2, storeVisits: 10, gmv: 100,
      }),
    ],
    reconciliation: {
      reconciled: true,
      accountSpend: 60,
      summarySpend: 60,
      dailySpend: 60,
      issues: [],
    },
    warnings: [],
    errors: [],
  };
  const accountB = {
    account: {
      vSellerId: 'fictional-advertiser-b',
      advertiserId: 3002,
      accountType: 602,
      name: '虚构聚光账户 B',
      brand: { brandUserId: 'fictional-juguang-brand-001' },
    },
    status: 'complete',
    schemaValid: true,
    truncated: false,
    accountSummary: { metrics: { fee: 40 } },
    summaryRows: [juguangRow('fictional-advertiser-b', null, null, null, 40)],
    dailyRows: [
      juguangRow('fictional-advertiser-b', '2030-01-05', 13, 0, 10, {
        orders: 1, storeVisits: 3, gmv: 30,
      }),
      {
        ...juguangRow('fictional-advertiser-b', '2030-01-09', 4, 1, 30),
        rawResponse: {
          token: 'fictional-juguang-token',
          bytes: largeRawPayload,
        },
      },
    ],
    reconciliation: {
      reconciled: true,
      accountSpend: 40,
      summarySpend: 40,
      dailySpend: 40,
      issues: [],
    },
    warnings: [],
    errors: [],
  };
  const juguang = {
    schemaVersion: 1,
    platform: 'juguang',
    runId: 'fictional-run-001',
    accountKey: 'fictional-juguang-account-group',
    dateRange: clone(RANGE),
    status: 'complete',
    truncated: false,
    initialAccount: clone(accountA.account),
    restoredAccount: clone(accountA.account),
    accounts: [accountA, accountB],
    attribution: {
      basis: 'conversion_time',
      dataCaliber: 0,
      windowDays: 15,
      splitColumns: ['marketingTarget', 'deliveryMode'],
    },
    warnings: [],
    errors: [],
  };

  const projects = [
    {
      id: 'fictional-project-001',
      projectId: 'fictional-project-001',
      projectName: '虚构星河项目一',
      startTime: '2030-01-02 00:00:00',
      endTime: '2030-01-05 23:59:59',
    },
    {
      id: 'fictional-project-002',
      projectId: 'fictional-project-002',
      projectName: '虚构星河项目二',
      startTime: '2030-01-04 00:00:00',
      endTime: '2030-01-06 23:59:59',
    },
  ];
  const orders = [
    {
      orderId: 'fictional-order-001',
      projectId: 'fictional-project-001',
      orderName: '虚构星河订单一',
      settleSeqId: 'fictional-settle-001',
      startTime: '2030-01-02 00:00:00',
      endTime: '2030-01-05 23:59:59',
    },
    {
      orderId: 'fictional-order-002',
      projectId: 'fictional-project-002',
      orderName: '虚构星河订单二',
      settleSeqId: 'fictional-settle-002',
      startTime: '2030-01-04 00:00:00',
      endTime: '2030-01-06 23:59:59',
    },
  ];
  const contentRows = [
    {
      noteId: 'fictional-note-001',
      contentId: 'fictional-note-001',
      listOrderId: 'fictional-order-001',
      projectId: 'fictional-project-001',
      theDate: '20300103',
      readUv1d: 100,
      engagementUv1d: 20,
      slrAttrSlrVstUv1d: 40,
      slrAttrItmOrdGmv1d: 300,
      slrAttrItmCltUv1d: 12,
      slrAttrItmOrdGmv1d1bpOrd: 240,
      slrAttrItmOrdGmv1dNot1bpOrd: 60,
      rawPayload: largeRawPayload,
    },
    {
      noteId: 'fictional-note-001',
      contentId: 'fictional-note-001',
      listOrderId: 'fictional-order-002',
      projectId: 'fictional-project-002',
      theDate: '20300103',
      readUv1d: 90,
      engagementUv1d: 18,
      slrAttrSlrVstUv1d: 35,
      slrAttrItmOrdGmv1d: 250,
      signedUrl: 'https://star.example/content?_tb_token_=fictional-tb-token&signature=fictional-signature',
    },
    {
      noteId: 'fictional-note-001',
      contentId: 'fictional-note-001',
      listOrderId: 'fictional-order-002',
      projectId: 'fictional-project-002',
      theDate: '20300105',
      readUv1d: 50,
      engagementUv1d: 10,
      slrAttrSlrVstUv1d: 20,
      slrAttrItmOrdGmv1d: 200,
    },
  ];
  const adstar = {
    schemaVersion: 1,
    platform: 'adstar',
    runId: 'fictional-run-001',
    accountKey: 'fictional-adstar-account',
    dateRange: clone(RANGE),
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      memberId: 'fictional-star-member-001',
      memberName: '虚构星河账号',
    },
    lists: {
      projects: { status: 'complete', items: projects },
      orders: { status: 'complete', items: orders },
    },
    storeSummary: {
      readUv1d: 150,
      engagementUv1d: 30,
      slrAttrSlrVstUv1d: 60,
      slrAttrItmOrdGmv1d: 500,
    },
    nested: [
      {
        type: 'project', id: 'fictional-project-001', name: '虚构星河项目一', status: 'complete',
        summary: { slrAttrItmOrdGmv1d: 300 }, details: { project: [], order: [] },
      },
      {
        type: 'project', id: 'fictional-project-002', name: '虚构星河项目二', status: 'complete',
        summary: { slrAttrItmOrdGmv1d: 200 }, details: { project: [], order: [] },
      },
      {
        type: 'order', id: 'fictional-order-001', name: '虚构星河订单一',
        projectId: 'fictional-project-001', status: 'complete',
        summary: { slrAttrItmOrdGmv1d: 300 }, details: { order: [], content: [] },
      },
      {
        type: 'order', id: 'fictional-order-002', name: '虚构星河订单二',
        projectId: 'fictional-project-002', status: 'complete',
        summary: { slrAttrItmOrdGmv1d: 200 }, details: { order: [], content: [] },
      },
    ],
    contentRows,
    excluded: { projects: [], orders: [] },
    warnings: [],
    errors: [],
  };

  return {
    runId: 'fictional-run-001',
    storeId: 'fictional-store-001',
    dateRange: clone(RANGE),
    accountBindings: {
      pgy: ['pgy:fictional-brand-user-001'],
      juguang: [
        'juguang:fictional-juguang-brand-001:3001:4:main',
      ],
      adstar: ['adstar:fictional-star-member-001'],
    },
    generatedAt: '2030-02-01T00:00:00.000Z',
    asOf: '2030-01-30',
    targetRoi: 2,
    collections: { pgy, juguang, adstar },
  };
}

function noteFrom(snapshot) {
  return snapshot.notes.find((note) => note.noteId === 'fictional-note-001');
}

test('merges three sources by noteId and aggregates multi-cooperation and multi-advertiser costs', () => {
  const snapshot = createXhsAnalysisSnapshot(completeInput());
  const note = noteFrom(snapshot);

  assert.equal(SNAPSHOT_SCHEMA, 'xhsAnalysisSnapshotV1');
  assert.equal(snapshot.schema, 'xhsAnalysisSnapshotV1');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.quality.decisionReady, true);
  assert.equal(snapshot.notes.length, 1);
  assert.equal(note.pgy.sourceCount, 2);
  assert.deepEqual(note.juguang.accountIds, [
    'fictional-advertiser-a',
    'fictional-advertiser-b',
  ]);
  assert.deepEqual(note.costs, {
    cooperation: 150,
    platformFee: 15,
    juguang: 100,
    total: 265,
    starTaskAligned: 215,
    outsideDirect: 20,
  });
  assert.deepEqual(snapshot.management.costs, {
    cooperation: 150,
    platformFee: 15,
    partnership: 165,
    juguang: 100,
    total: 265,
    starTaskAligned: 215,
    outsideDirect: 20,
  });
});

test('merges overlapping Star order intervals, de-duplicates same-note same-day GMV, and separates task-period results', () => {
  const snapshot = createXhsAnalysisSnapshot(completeInput());
  const note = noteFrom(snapshot);

  assert.deepEqual(note.task.intervals, [{ start: '2030-01-02', end: '2030-01-06' }]);
  assert.deepEqual(note.task.orderIds, ['fictional-order-001', 'fictional-order-002']);
  assert.deepEqual(note.task.projectIds, ['fictional-project-001', 'fictional-project-002']);
  assert.equal(note.star.metrics.gmv, 500, 'same note/date across two orders must use max, then sum dates');
  assert.equal(note.star.metrics.favoriteUv, 12);
  assert.equal(note.star.metrics.seededProductGmv, 240);
  assert.equal(note.star.metrics.linkedProductGmv, 60);
  assert.equal(note.juguang.inTask.spend, 50);
  assert.equal(note.juguang.outsideDirect.spend, 20);
  assert.equal(note.results.starTaskGmv, 500);
  assert.ok(Math.abs(note.results.starTaskRoi - (500 / 215)) < 1e-12);
  assert.equal(note.results.outsideDirectGmv, 100);
  assert.equal(note.results.outsideDirectRoi, 5);
  assert.equal(snapshot.management.starTaskResult.gmv, 500);
  assert.ok(Math.abs(snapshot.management.starTaskResult.roi - (500 / 215)) < 1e-12);
  assert.equal(typeof snapshot.management.starTaskResult.metrics, 'object');
  assert.equal(typeof snapshot.star.store.metrics, 'object');
  assert.deepEqual(snapshot.star.store.metrics, snapshot.management.starTaskResult.metrics,
    'shared Star metrics must remain real objects rather than a false circular marker');
  assert.deepEqual(snapshot.management.outsideDirectResult, {
    attributionBasis: 'conversion_time',
    attributionWindowDays: 15,
    spend: 20,
    storeVisits: 10,
    orders: 2,
    gmv: 100,
    roi: 5,
  });
  assert.equal(snapshot.management.combinedGmv, undefined, 'Star and outside-direct GMV must not be added');

  assert.deepEqual(snapshot.star.orders.map((item) => item.id), [
    'fictional-order-001', 'fictional-order-002',
  ]);
  assert.deepEqual(snapshot.star.projects.map((item) => item.id), [
    'fictional-project-001', 'fictional-project-002',
  ]);
  assert.ok(snapshot.star.orders.every((item) => item.allocatedCost === 107.5));
  assert.ok(snapshot.star.projects.every((item) => item.allocatedCost === 107.5));
  assert.equal(snapshot.spotlight.daily.length, 5, 'compact Juguang daily rows remain exportable');
  assert.equal(snapshot.star.daily.length, 2, 'same-note same-day Star rows remain de-duplicated for export');
  assert.ok(snapshot.spotlight.daily.every((row) => row.noteId && row.date && row.accountId));
  assert.ok(snapshot.star.daily.every((row) => row.noteId && row.date && row.metrics));
});

test('blocks decision actions when any required source is partial', () => {
  const input = completeInput();
  input.collections.juguang.status = 'partial';
  input.collections.juguang.accounts[1].status = 'partial';
  input.collections.juguang.errors.push({ code: 'pagination_incomplete', message: '虚构分页未完成' });
  const snapshot = createXhsAnalysisSnapshot(input);

  assert.equal(snapshot.quality.decisionReady, false);
  assert.ok(snapshot.quality.issues.some((issue) => (
    issue.severity === 'critical' && issue.platform === 'juguang'
  )));
  assert.ok(snapshot.actions.length > 0);
  assert.ok(snapshot.actions.every((action) => ['collect_more', 'observe'].includes(action.action)));
  assert.ok(snapshot.actions.every((action) => (
    !['scale', 'stop', 'optimize'].includes(action.action)
  )));
});

test('a selected but failed source stays unknown instead of manufacturing automatic zero spend', () => {
  const input = completeInput();
  input.collections.juguang = {
    platform: 'juguang',
    runId: input.runId,
    dateRange: clone(RANGE),
    status: 'failed',
    accounts: [],
    warnings: [],
    errors: [{ code: 'fictional-juguang-unavailable' }],
  };
  const snapshot = createXhsAnalysisSnapshot(input);
  const note = noteFrom(snapshot);

  assert.equal(snapshot.quality.decisionReady, false);
  assert.equal(snapshot.management.costs.partnership, 165, 'successful PGY cost remains available');
  assert.equal(snapshot.management.costs.juguang, null);
  assert.equal(snapshot.management.costs.total, null);
  assert.equal(snapshot.management.costs.starTaskAligned, null);
  assert.equal(snapshot.management.costs.outsideDirect, null);
  assert.equal(snapshot.spotlight.total, null);
  assert.deepEqual(snapshot.spotlight.daily, []);
  assert.equal(note.costs.juguang, null);
  assert.equal(note.costs.total, null);
  assert.equal(note.costs.starTaskAligned, null);
  assert.equal(note.costs.outsideDirect, null);
  assert.equal(note.results.starTaskRoi, null);
  assert.equal(note.results.outsideDirectRoi, null);

  const mapped = mapAnalysisSnapshot({
    analysisSnapshot: snapshot,
    manualInputs: { xhs_juguangSpend: 456 },
  });
  assert.equal(mapped.values.xhs_juguangSpend.value, 456);
  assert.equal(mapped.values.xhs_juguangSpend.mode, 'manual_fallback');
});

test('a selected source subset never manufactures automatic zeroes for unselected platforms', () => {
  const input = completeInput();
  input.selectedPlatforms = ['adstar'];
  input.collections = { adstar: input.collections.adstar };
  input.accountBindings = { adstar: input.accountBindings.adstar };
  const snapshot = createXhsAnalysisSnapshot(input);

  assert.equal(snapshot.quality.decisionReady, false);
  assert.equal(snapshot.pgy.reportedNoteCount, null);
  assert.equal(snapshot.management.costs.partnership, null);
  assert.equal(snapshot.management.costs.juguang, null);
  assert.equal(snapshot.management.costs.total, null);

  const mapped = mapAnalysisSnapshot({
    analysisSnapshot: snapshot,
    manualInputs: {
      xhs_kolSpend: 123,
      xhs_juguangSpend: 456,
      xhs_reportedNoteCount: 7,
    },
  });
  assert.equal(mapped.values.xhs_kolSpend.value, 123);
  assert.equal(mapped.values.xhs_kolSpend.mode, 'manual_fallback');
  assert.equal(mapped.values.xhs_juguangSpend.value, 456);
  assert.equal(mapped.values.xhs_juguangSpend.mode, 'manual_fallback');
  assert.equal(mapped.inputs.xhs_reportedNoteCount.value, 7);
  assert.equal(mapped.inputs.xhs_reportedNoteCount.mode, 'manual_fallback');
});

test('rejects mismatched date ranges and account bindings at the analysis gate', () => {
  const dateMismatch = completeInput();
  dateMismatch.collections.adstar.dateRange = {
    ...clone(RANGE),
    from: '2030-01-02',
  };
  const dateSnapshot = createXhsAnalysisSnapshot(dateMismatch);
  assert.equal(dateSnapshot.quality.decisionReady, false);
  assert.ok(dateSnapshot.quality.issues.some((issue) => (
    issue.code === 'date_range_mismatch' && issue.platform === 'adstar'
  )));

  const accountMismatch = completeInput();
  accountMismatch.collections.pgy.identity.brandUserId = 'fictional-wrong-brand-user';
  const accountSnapshot = createXhsAnalysisSnapshot(accountMismatch);
  assert.equal(accountSnapshot.quality.decisionReady, false);
  assert.ok(accountSnapshot.quality.issues.some((issue) => (
    issue.code === 'account_binding_mismatch' && issue.platform === 'pgy'
  )));
});

test('deduplicates quality issues by code and platform while preserving distinct issue keys', () => {
  const input = completeInput();
  input.collections.pgy.identity.brandUserId = 'fictional-wrong-brand-user';
  input.bindingIssues = [
    {
      severity: 'critical',
      code: 'account_binding_mismatch',
      platform: 'pgy',
      message: 'Binding reconciliation already rejected the PGY account.',
    },
    {
      severity: 'critical',
      code: 'account_binding_mismatch',
      platform: 'adstar',
      message: 'The same code on another platform remains distinct.',
    },
    {
      severity: 'critical',
      code: 'account_identity_bound_to_other_store',
      platform: 'pgy',
      message: 'A different code on the same platform remains distinct.',
    },
  ];

  const snapshot = createXhsAnalysisSnapshot(input);
  const issueKeys = snapshot.quality.issues.map((issue) => `${issue.code}:${issue.platform}`);

  assert.equal(issueKeys.filter((key) => key === 'account_binding_mismatch:pgy').length, 1);
  assert.ok(issueKeys.includes('account_binding_mismatch:adstar'));
  assert.ok(issueKeys.includes('account_identity_bound_to_other_store:pgy'));
});

test('keeps the highest severity when duplicate quality issues share a code and platform', () => {
  const input = completeInput();
  input.collections.pgy.identity.brandUserId = 'fictional-wrong-brand-user';
  input.bindingIssues = [{
    severity: 'warning',
    code: 'account_binding_mismatch',
    platform: 'pgy',
    message: 'An earlier non-blocking observation must not hide the binding gate.',
  }];

  const snapshot = createXhsAnalysisSnapshot(input);
  const matches = snapshot.quality.issues.filter((issue) => (
    issue.code === 'account_binding_mismatch' && issue.platform === 'pgy'
  ));

  assert.equal(matches.length, 1);
  assert.equal(matches[0].severity, 'critical');
  assert.equal(snapshot.quality.decisionReady, false);
});

test('projects only compact analysis fields and excludes signed URLs, credentials, and raw payloads', () => {
  const input = completeInput();
  const snapshot = createXhsAnalysisSnapshot(input);
  const serialized = JSON.stringify(snapshot);

  assert.doesNotMatch(
    serialized,
    /fictional-xsec|fictional-signature|fictional-cookie|fictional-juguang-token|fictional-tb-token/
  );
  assert.doesNotMatch(serialized, /xsec_token|_tb_token_|rawPayload|rawResponse|signedUrl/);
  assert.ok(serialized.length < 100000, `fixture snapshot should stay compact, got ${serialized.length} bytes`);
  assert.match(input.collections.pgy.notes[0].source.rawPayload, /fictional-raw-payload-marker/,
    'pure analysis must not mutate source collections');
});
