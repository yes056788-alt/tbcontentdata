const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-03-31',
  timezone: 'Asia/Shanghai',
});

function pgyNote({
  id,
  publishDate,
  followerCount,
  authorId,
  cooperation,
  platformFee,
  impressions,
  reads,
  interactions,
}) {
  return {
    noteId: `fictional-pgy-note-${id}`,
    sourceKey: `fictional-pgy-cooperation-${id}`,
    title: `虚构蒲公英笔记 ${id}`,
    publishDate,
    author: {
      id: authorId || `fictional-creator-${id}`,
      name: `虚构达人 ${id}`,
      followerCount,
    },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: { impressions, reads, interactions },
  };
}

function pgyCollection(notes) {
  return {
    schemaVersion: 1,
    platform: 'pgy',
    runId: 'fictional-pgy-report-v2-run',
    accountKey: 'fictional-pgy-report-v2-account',
    dateRange: { ...RANGE },
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      accountKey: 'fictional-pgy-report-v2-account',
      brandUserId: 'fictional-pgy-brand-v2',
      brandUserName: '虚构蒲公英品牌账户',
    },
    notes,
    reconciliation: {
      reconciled: true,
      expectedCount: notes.length,
      receivedCount: notes.length,
      uniqueCount: new Set(notes.map((note) => note.noteId)).size,
      duplicateCount: 0,
      cooperationCost: notes.reduce((sum, note) => sum + note.costs.cooperation, 0),
      platformFee: notes.reduce((sum, note) => sum + note.costs.platformFee, 0),
      issues: [],
    },
    warnings: [],
    errors: [],
  };
}

function adstarCollection(contentRows) {
  return {
    schemaVersion: 1,
    platform: 'adstar',
    runId: 'fictional-pgy-report-v2-run',
    accountKey: 'fictional-adstar-report-v2-account',
    dateRange: { ...RANGE },
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      memberId: 'fictional-adstar-member-v2',
      memberName: '虚构星河账户',
    },
    lists: {
      projects: { status: 'complete', items: [] },
      orders: { status: 'complete', items: [] },
    },
    storeSummary: {},
    nested: [],
    contentRows,
    excluded: { projects: [], orders: [] },
    warnings: [],
    errors: [],
  };
}

function analysisInput(notes, starNoteIds = []) {
  return {
    runId: 'fictional-pgy-report-v2-run',
    storeId: 'fictional-store-v2',
    selectedPlatforms: ['pgy', 'adstar'],
    dateRange: { ...RANGE },
    generatedAt: '2030-04-20T00:00:00.000Z',
    asOf: '2030-04-20',
    collections: {
      pgy: pgyCollection(notes),
      adstar: adstarCollection(starNoteIds.map((noteId, index) => ({
        noteId,
        contentId: noteId,
        theDate: `203003${String(index + 1).padStart(2, '0')}`,
        readUv1d: 10 + index,
        engagementUv1d: 2 + index,
        slrAttrItmOrdGmv1d: 100 + index,
      }))),
    },
  };
}

function reportFixtureNotes() {
  return [
    pgyNote({
      id: 'below-range', publishDate: '2029-12-31', followerCount: 4999,
      cooperation: 800, platformFee: 80, impressions: 8000, reads: 800, interactions: 80,
    }),
    pgyNote({
      id: 'below-1k', publishDate: '2030-01-01', followerCount: 999,
      cooperation: 10, platformFee: 100, impressions: 100, reads: 10, interactions: 1,
    }),
    pgyNote({
      id: '1k', publishDate: '2030-01-15', followerCount: 1000,
      cooperation: 20, platformFee: 200, impressions: 100, reads: 90, interactions: 9,
    }),
    pgyNote({
      id: '4999-repeat', publishDate: '2030-01-20', followerCount: 4999,
      authorId: 'fictional-creator-1k',
      cooperation: 25, platformFee: 250, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyNote({
      id: '5k', publishDate: '2030-01-31', followerCount: 5000,
      cooperation: 30, platformFee: 300, impressions: 200, reads: 100, interactions: 20,
    }),
    pgyNote({
      id: '10k', publishDate: '2030-03-01', followerCount: 10000,
      cooperation: 40, platformFee: 400, impressions: 200, reads: 50, interactions: 5,
    }),
    pgyNote({
      id: '100k', publishDate: '2030-03-15', followerCount: 100000,
      cooperation: 50, platformFee: 500, impressions: 100, reads: 50, interactions: 5,
    }),
    pgyNote({
      id: 'unknown-followers', publishDate: '2030-03-20', followerCount: null,
      cooperation: 70, platformFee: 700, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyNote({
      id: '500k', publishDate: '2030-03-31 23:59:59', followerCount: 500000,
      cooperation: 60, platformFee: 600, impressions: 300, reads: 100, interactions: 20,
    }),
    pgyNote({
      id: 'above-range', publishDate: '2030-04-01', followerCount: 500000,
      cooperation: 900, platformFee: 90, impressions: 9000, reads: 900, interactions: 90,
    }),
    pgyNote({
      id: 'invalid-date', publishDate: 'not-a-date', followerCount: 500000,
      cooperation: 1000, platformFee: 100, impressions: 10000, reads: 1000, interactions: 100,
    }),
    pgyNote({
      id: 'missing-date', publishDate: null, followerCount: 500000,
      cooperation: 1100, platformFee: 110, impressions: 11000, reads: 1100, interactions: 110,
    }),
  ];
}

test('PGY V2 filters account-history rows by the inclusive publish-date range and recomputes period totals', () => {
  const snapshot = createXhsAnalysisSnapshot(analysisInput(reportFixtureNotes()));

  assert.equal(snapshot.pgy.noteCount, 8);
  assert.equal(snapshot.pgy.reportedNoteCount, 8);
  assert.equal(snapshot.notes.length, 0, 'the joined-note table is rooted in selected-range Star rows');
  assert.deepEqual(snapshot.pgy.costs, {
    cooperation: 305,
    platformFee: 3050,
    total: 3355,
  });
  assert.equal(snapshot.management.costs.cooperation, 305);
  assert.equal(snapshot.management.costs.platformFee, 3050);
  assert.equal(snapshot.management.costs.partnership, 3355);
  assert.deepEqual(snapshot.pgy.metrics, {
    impressions: 1000,
    reads: 400,
    interactions: 60,
    readRate: 0.4,
    engagementRate: 0.15,
  });
});

test('PGY V2 zero-fills publish months and assigns follower-tier boundaries without charging platform fees', () => {
  const snapshot = createXhsAnalysisSnapshot(analysisInput(reportFixtureNotes()));

  assert.deepEqual(snapshot.pgy.monthly, [
    { month: '2030-01', noteCount: 4 },
    { month: '2030-02', noteCount: 0 },
    { month: '2030-03', noteCount: 4 },
  ]);

  assert.deepEqual(snapshot.pgy.followerTiers, [
    {
      key: '1k_5k', label: '1K-5K', noteCount: 2, authorCount: 1,
      cooperationCost: 45, averageCooperationCost: 22.5,
    },
    {
      key: '5k_10k', label: '5K-1W', noteCount: 1, authorCount: 1,
      cooperationCost: 30, averageCooperationCost: 30,
    },
    {
      key: '10k_100k', label: '1W-10W', noteCount: 1, authorCount: 1,
      cooperationCost: 40, averageCooperationCost: 40,
    },
    {
      key: '100k_500k', label: '10W-50W', noteCount: 1, authorCount: 1,
      cooperationCost: 50, averageCooperationCost: 50,
    },
    {
      key: '500k_plus', label: '50W+', noteCount: 1, authorCount: 1,
      cooperationCost: 60, averageCooperationCost: 60,
    },
  ]);
  assert.deepEqual(snapshot.pgy.followerTierExcluded, {
    below1k: { noteCount: 1, authorCount: 1 },
    unknown: { noteCount: 1, authorCount: 1 },
  });
});

test('PGY V2 counts task notes directly from PGY Taobao task IDs', () => {
  const notes = reportFixtureNotes();
  notes.find((note) => note.noteId === 'fictional-pgy-note-1k').taobaoTaskId =
    'fictional-taobao-task-1k';
  notes.find((note) => note.noteId === 'fictional-pgy-note-500k').taobaoTaskId =
    'fictional-taobao-task-500k';
  const snapshot = createXhsAnalysisSnapshot(analysisInput(notes, [
    'fictional-pgy-note-1k',
    'fictional-pgy-note-500k',
    'fictional-pgy-note-above-range',
    'fictional-star-only-note',
  ]));

  assert.equal(snapshot.pgy.starTaskNoteCount, 2);
});

test('keeps PGY task note count available when Star was not selected', () => {
  const input = analysisInput(reportFixtureNotes());
  input.collections.pgy.notes.find((note) => note.noteId === 'fictional-pgy-note-1k').taobaoTaskId =
    'fictional-taobao-task-pgy-only';
  input.selectedPlatforms = ['pgy'];
  input.collections = { pgy: input.collections.pgy };

  const snapshot = createXhsAnalysisSnapshot(input);
  assert.equal(snapshot.pgy.starTaskNoteCount, 1);
});
