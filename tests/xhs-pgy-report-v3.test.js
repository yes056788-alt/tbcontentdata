const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');

let reportModelApi;
let reportModelLoadError;
try {
  reportModelApi = require('../xhs/report-model');
} catch (error) {
  reportModelLoadError = error;
}

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-03-31',
  timezone: 'Asia/Shanghai',
});

function reportModel() {
  if (reportModelLoadError) {
    assert.fail(`xhs/report-model.js must expose the PGY v3 report API: ${reportModelLoadError.message}`);
  }
  assert.equal(
    typeof reportModelApi.aggregatePgyFacts,
    'function',
    'XhsReportModel.aggregatePgyFacts must be available to recalculate archived PGY facts'
  );
  return reportModelApi;
}

function pgyFact({
  id,
  publishDate,
  followerCount,
  authorId,
  cooperation,
  platformFee,
  impressions,
  reads,
  interactions,
  taobaoTaskId = null,
  taskEndDate = null,
  spus = [],
  noteUrl = null,
  spuName = null,
  crossDomainProjectName = null,
  taobaoSamplingRatio = null,
  taobao15d = null,
}) {
  return {
    noteId: `fictional-pgy-v3-note-${id}`,
    sourceKey: `fictional-pgy-v3-cooperation-${id}`,
    title: `虚构蒲公英 V3 笔记 ${id}`,
    noteUrl,
    publishDate,
    spuName,
    crossDomainProjectName,
    taobaoSamplingRatio,
    spus,
    taobaoTaskId,
    taskEndDate,
    author: {
      id: authorId || `fictional-pgy-v3-creator-${id}`,
      name: `虚构蒲公英 V3 达人 ${id}`,
      followerCount,
    },
    costs: {
      cooperation,
      platformFee,
      total: cooperation + platformFee,
    },
    metrics: {
      impressions,
      reads,
      interactions,
      taobaoOffsiteActiveUv15d: taobao15d ? taobao15d.taobaoOffsiteActiveUv15d : null,
      taobaoOffsiteActiveCost15d: taobao15d ? taobao15d.taobaoOffsiteActiveCost15d : null,
      taobaoDealUv15d: taobao15d ? taobao15d.taobaoDealUv15d : null,
      taobaoAddCartUv15d: taobao15d ? taobao15d.taobaoAddCartUv15d : null,
      taobaoAddCartRate15d: taobao15d ? taobao15d.taobaoAddCartRate15d : null,
      taobaoPurchaseRate15d: taobao15d ? taobao15d.taobaoPurchaseRate15d : null,
    },
  };
}

function reportFacts() {
  return [
    pgyFact({
      id: 'before', publishDate: '2029-12-31', followerCount: 4999,
      taobaoTaskId: 'fictional-taobao-task-before', taskEndDate: '2029-12-30',
      cooperation: 800, platformFee: 80, impressions: 8000, reads: 800, interactions: 80,
    }),
    pgyFact({
      id: 'below-1k-start-boundary', publishDate: '2030-01-01', followerCount: 999,
      taobaoTaskId: 'fictional-taobao-task-start-boundary',
      cooperation: 10, platformFee: 100, impressions: 100, reads: 10, interactions: 1,
    }),
    pgyFact({
      id: '1k', publishDate: '2030-01-15', followerCount: 1000,
      authorId: 'fictional-pgy-v3-repeat-creator',
      taobaoTaskId: 'fictional-taobao-task-1k', taskEndDate: '2030-01-31',
      cooperation: 20, platformFee: 200, impressions: 100, reads: 90, interactions: 9,
    }),
    pgyFact({
      id: '4999-repeat', publishDate: '2030-01-20', followerCount: 4999,
      authorId: 'fictional-pgy-v3-repeat-creator',
      cooperation: 25, platformFee: 250, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyFact({
      id: '5k', publishDate: '2030-01-31', followerCount: 5000,
      taobaoTaskId: 'fictional-taobao-task-5k', taskEndDate: '2030-04-20',
      cooperation: 30, platformFee: 300, impressions: 200, reads: 100, interactions: 20,
    }),
    pgyFact({
      id: '10k', publishDate: '2030-03-01', followerCount: 10000,
      cooperation: 40, platformFee: 400, impressions: 200, reads: 50, interactions: 5,
    }),
    pgyFact({
      id: '100k', publishDate: '2030-03-15', followerCount: 100000,
      taobaoTaskId: 'fictional-taobao-task-100k', taskEndDate: '2030-03-31',
      cooperation: 50, platformFee: 500, impressions: 100, reads: 50, interactions: 5,
    }),
    pgyFact({
      id: 'unknown-followers', publishDate: '2030-03-20', followerCount: null,
      cooperation: 70, platformFee: 700, impressions: 0, reads: 0, interactions: 0,
    }),
    pgyFact({
      id: '500k-end-boundary', publishDate: '2030-03-31', followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-500k', taskEndDate: '2030-04-21',
      cooperation: 60, platformFee: 600, impressions: 300, reads: 100, interactions: 20,
    }),
    pgyFact({
      id: 'after', publishDate: '2030-04-01', followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-after', taskEndDate: '2030-01-01',
      cooperation: 900, platformFee: 90, impressions: 9000, reads: 900, interactions: 90,
    }),
    pgyFact({
      id: 'invalid-date', publishDate: null, followerCount: 500000,
      taobaoTaskId: 'fictional-taobao-task-invalid-date', taskEndDate: '2030-01-01',
      cooperation: 1000, platformFee: 100, impressions: 10000, reads: 1000, interactions: 100,
    }),
    pgyFact({
      id: 'missing-date', publishDate: null, followerCount: 500000,
      cooperation: 1100, platformFee: 110, impressions: 11000, reads: 1100, interactions: 110,
    }),
  ];
}

function aggregateFixture() {
  return reportModel().aggregatePgyFacts({
    facts: reportFacts(),
    dateRange: RANGE,
    asOf: '2030-04-20',
  });
}

function pgyCollection(facts) {
  return {
    schemaVersion: 1,
    platform: 'pgy',
    runId: 'fictional-pgy-v3-run',
    accountKey: 'fictional-pgy-v3-account',
    dateRange: { ...RANGE },
    dateBasis: 'note_publish_time',
    collectionScope: 'all_available',
    latestPublishDate: '2030-04-01',
    startedAt: '2030-04-20T00:00:00.000Z',
    finishedAt: '2030-04-20T00:01:00.000Z',
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: {
      accountKey: 'fictional-pgy-v3-account',
      brandUserId: 'fictional-pgy-v3-brand-user',
      brandUserName: '虚构蒲公英 V3 品牌账户',
    },
    notes: facts.map((fact) => ({
      ...structuredClone(fact),
      rawBusinessResponse: `fictional-large-raw-response-${fact.noteId}`,
    })),
    reconciliation: {
      reconciled: true,
      expectedCount: facts.length,
      receivedCount: facts.length,
      uniqueCount: facts.length,
      duplicateCount: 0,
      cooperationCost: facts.reduce((sum, fact) => sum + fact.costs.cooperation, 0),
      platformFee: facts.reduce((sum, fact) => sum + fact.costs.platformFee, 0),
      issues: [],
    },
    warnings: [],
    errors: [],
  };
}

test('analysis archives every all-available PGY row as compact facts while keeping the task range as the default aggregate', () => {
  const facts = reportFacts();
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-v3-run',
    storeId: 'fictional-pgy-v3-store',
    selectedPlatforms: ['pgy'],
    dateRange: { ...RANGE },
    generatedAt: '2030-04-20T00:02:00.000Z',
    asOf: '2030-04-20',
    collections: { pgy: pgyCollection(facts) },
  });

  assert.equal(snapshot.pgy.collectionScope, 'all_available');
  assert.deepEqual(snapshot.pgy.facts, facts);
  assert.equal(snapshot.pgy.noteCount, 8, 'the default summary still uses the task publication range');
  assert.deepEqual(snapshot.pgy.costs, {
    cooperation: 305,
    platformFee: 3050,
    total: 3355,
  });
  assert.doesNotMatch(JSON.stringify(snapshot.pgy.facts), /fictional-large-raw-response/);
});

test('PGY overdue notes compare task end dates with the current report date, never the collection date', () => {
  const facts = [pgyFact({
    id: 'collection-date', publishDate: '2030-01-15', followerCount: 5000,
    cooperation: 10, platformFee: 1, impressions: 100, reads: 10, interactions: 1,
    taskEndDate: '2030-04-20',
  })];
  const collection = pgyCollection(facts);
  collection.finishedAt = '2030-04-21T00:30:00.000Z';
  const snapshot = createXhsAnalysisSnapshot({
    runId: 'fictional-pgy-collection-date-run',
    storeId: 'fictional-pgy-collection-date-store',
    selectedPlatforms: ['pgy'],
    dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
    generatedAt: '2030-04-20T12:00:00.000Z',
    collections: { pgy: collection },
  });

  assert.equal(snapshot.pgy.asOf, '2030-04-20');
  assert.equal(snapshot.pgy.overdueNoteCount, 0,
    'collection completion time must not advance the overdue cutoff beyond the current report date');
});

test('aggregatePgyFacts applies an inclusive publication-date range and recomputes costs and KPIs', () => {
  const result = aggregateFixture();

  assert.equal(result.noteCount, 8);
  assert.equal(result.reportedNoteCount, 8);
  assert.equal(result.starTaskNoteCount, 5);
  assert.equal(result.overdueNoteCount, 2);
  assert.deepEqual(result.excluded, { invalidPublishDate: 2, outsideRange: 2 });
  assert.deepEqual(result.costs, {
    cooperation: 305,
    platformFee: 3050,
    total: 3355,
  });
  assert.deepEqual(result.metrics, {
    impressions: 1000,
    reads: 400,
    interactions: 60,
    readRate: 0.4,
    engagementRate: 0.15,
  });
});

test('aggregatePgyFacts derives task and overdue counts from PGY facts inside the selected publication range', () => {
  const january = reportModel().aggregatePgyFacts({
    facts: reportFacts(),
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-04-20',
  });

  assert.equal(january.noteCount, 4);
  assert.equal(january.starTaskNoteCount, 3,
    'a canonical taobaoTaskId is direct task membership evidence');
  assert.equal(january.overdueNoteCount, 1,
    'only taskEndDate values strictly before asOf are overdue');
});

test('aggregatePgyFacts does not count the official missing-task marker as a Taobao task ID', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [pgyFact({
      id: 'missing-task-marker',
      publishDate: '2030-01-20',
      taobaoTaskId: '-',
    })],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-04-20',
  });

  assert.equal(result.starTaskNoteCount, 0);
});

test('aggregatePgyFacts filters only by the official PGY spuName while retaining all name choices', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [
      pgyFact({
        id: 'spu-a', publishDate: '2030-01-05', followerCount: 5000,
        cooperation: 100, platformFee: 10, impressions: 100, reads: 50, interactions: 10,
        spuName: '虚构 SPU A',
        spus: [{ id: 'same-id-must-not-drive-filter', name: '旧别名 A' }],
      }),
      pgyFact({
        id: 'spu-b', publishDate: '2030-01-06', followerCount: 5000,
        cooperation: 200, platformFee: 20, impressions: 200, reads: 100, interactions: 20,
        spuName: '虚构 SPU B',
        spus: [{ id: 'same-id-must-not-drive-filter', name: '旧别名 B' }],
      }),
    ],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    spuName: '虚构 SPU B',
    asOf: '2030-01-31',
  });

  assert.equal(result.selectedSpuName, '虚构 SPU B');
  assert.equal(result.noteCount, 1);
  assert.equal(result.costs.total, 220);
  assert.deepEqual(result.spuOptions, ['虚构 SPU A', '虚构 SPU B']);
});

test('aggregatePgyFacts sums PGY 15-day Taobao volumes and recalculates cost and rates from totals', () => {
  const result = reportModel().aggregatePgyFacts({
    facts: [
      pgyFact({
        id: 'taobao-15-a', publishDate: '2030-01-05', followerCount: 5000,
        cooperation: 100, platformFee: 10, impressions: 100, reads: 100, interactions: 10,
        taobaoSamplingRatio: 0.5,
        taobao15d: {
          taobaoOffsiteActiveUv15d: 10,
          taobaoOffsiteActiveCost15d: 11,
          taobaoDealUv15d: 2,
          taobaoAddCartUv15d: 5,
          taobaoAddCartRate15d: 0.99,
          taobaoPurchaseRate15d: 0.88,
        },
      }),
      pgyFact({
        id: 'taobao-15-b', publishDate: '2030-01-06', followerCount: 5000,
        cooperation: 200, platformFee: 20, impressions: 200, reads: 100, interactions: 20,
        taobaoSamplingRatio: 0.25,
        taobao15d: {
          taobaoOffsiteActiveUv15d: 20,
          taobaoOffsiteActiveCost15d: 2.75,
          taobaoDealUv15d: 4,
          taobaoAddCartUv15d: 5,
          taobaoAddCartRate15d: 0.77,
          taobaoPurchaseRate15d: 0.66,
        },
      }),
    ],
    dateRange: { from: '2030-01-01', to: '2030-01-31' },
    asOf: '2030-02-01',
  });

  assert.deepEqual(result.taobao15d, {
    offsiteActiveUv: 30,
    offsiteActiveCost: 4.4,
    dealUv: 6,
    addCartUv: 10,
    addCartRate: 0.15,
    purchaseRate: 0.1,
  });
});

test('aggregatePgyFacts zero-fills publication months for the selected closed interval', () => {
  assert.deepEqual(aggregateFixture().monthly, [
    { month: '2030-01', noteCount: 4 },
    { month: '2030-02', noteCount: 0 },
    { month: '2030-03', noteCount: 4 },
  ]);
});

test('aggregatePgyFacts recalculates follower tiers from cooperation cost only', () => {
  const result = aggregateFixture();

  assert.deepEqual(result.followerTiers, [
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
  assert.deepEqual(result.followerTierExcluded, {
    below1k: { noteCount: 1, authorCount: 1 },
    unknown: { noteCount: 1, authorCount: 1 },
  });
});
