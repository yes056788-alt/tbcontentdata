const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');
const { aggregateSpotlight } = require('../xhs/report-model');

const RANGE = Object.freeze({
  from: '2030-02-01',
  to: '2030-02-03',
  timezone: 'Asia/Shanghai',
});

const COMPLETE_SEEDING_EXTERNAL = Object.freeze({
  outSideSellerPv15d: 10,
  outSideSellerPvRate15dNew: 0.25,
  outSideSellerPvfee15d: 4,
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rawJuguangRow({
  noteId,
  date = '2030-02-01',
  marketingTarget = 4,
  placementType,
  deliveryMode,
  spend = 0,
  seedingExternal,
  directConversion,
}) {
  const dimensions = { noteId, time: date, marketingTarget };
  if (placementType !== undefined) dimensions.placementType = placementType;
  if (deliveryMode !== undefined) dimensions.deliveryMode = deliveryMode;

  const metrics = {
    fee: spend,
    impression: spend * 10,
    click: spend,
    interaction: spend / 2,
    iUserNum: spend / 4,
    tiUserNum: spend / 8,
  };
  if (seedingExternal) Object.assign(metrics, seedingExternal);
  if (directConversion) Object.assign(metrics, directConversion);

  return { noteId, dimensions, metrics };
}

function analysisSnapshot(dailyRows) {
  const spend = dailyRows.reduce((sum, row) => sum + Number(row.metrics.fee || 0), 0);
  return createXhsAnalysisSnapshot({
    runId: 'fictional-juguang-v3-run',
    storeId: 'fictional-store-v3',
    selectedPlatforms: ['juguang'],
    generatedAt: '2030-02-04T08:00:00.000Z',
    asOf: '2030-02-04',
    dateRange: { ...RANGE },
    collections: {
      juguang: {
        schemaVersion: 1,
        platform: 'juguang',
        runId: 'fictional-juguang-v3-run',
        accountKey: 'fictional-juguang-v3-account',
        dateRange: { ...RANGE },
        status: 'complete',
        truncated: false,
        accounts: [{
          account: {
            vSellerId: 'fictional-juguang-v3-account',
            advertiserId: 93001,
            accountType: 4,
            name: '虚构聚光 V3 账户',
          },
          status: 'complete',
          schemaValid: true,
          truncated: false,
          accountSummary: { dimensions: {}, metrics: { fee: spend } },
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
        }],
        attribution: {
          basis: 'conversion_time',
          dataCaliber: 0,
          windowDays: 15,
          splitColumns: ['marketingTarget', 'placement'],
        },
        warnings: [],
        errors: [],
      },
    },
  });
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

function pickSeedingExternal(summary) {
  const value = summary.seedingExternal15;
  assert.ok(value, 'summary must expose product-seeding 15-day external behavior');
  return {
    observability: value.observability,
    seedingSpend: value.seedingSpend,
    activeUv: value.activeUv,
    calculatedCost: value.calculatedCost,
  };
}

test('analysis keeps real placementType and all three 15-day product-seeding external facts', () => {
  const snapshot = analysisSnapshot([
    rawJuguangRow({
      noteId: 'fictional-note-fact',
      placementType: 'fixture-feed',
      spend: 40,
      seedingExternal: {
        outSideSellerPv15d: 8,
        outSideSellerPvRate15dNew: 0.2,
        outSideSellerPvfee15d: 5,
      },
    }),
  ]);

  assert.equal(snapshot.spotlight.daily.length, 1);
  assert.deepEqual(snapshot.spotlight.daily[0].seedingExternal15, {
    observable: true,
    activeUv: 8,
    platformRate: 0.2,
    platformCost: 5,
  });
  assert.equal(snapshot.spotlight.daily[0].placementType, 'fixture-feed');
});

test('aggregateSpotlight filters and groups by the raw placementType without guessing labels', () => {
  const snapshot = analysisSnapshot([
    rawJuguangRow({
      noteId: 'fictional-note-feed-a',
      date: '2030-02-01',
      placementType: 'fixture-feed',
      spend: 40,
      seedingExternal: { ...COMPLETE_SEEDING_EXTERNAL },
    }),
    rawJuguangRow({
      noteId: 'fictional-note-feed-b',
      date: '2030-02-02',
      placementType: 'fixture-feed',
      spend: 20,
      seedingExternal: {
        outSideSellerPv15d: 5,
        outSideSellerPvRate15dNew: 0.5,
        outSideSellerPvfee15d: 999,
      },
    }),
    rawJuguangRow({
      noteId: 'fictional-note-search',
      date: '2030-02-03',
      placementType: 'fixture-search',
      spend: 30,
      seedingExternal: {
        outSideSellerPv15d: 10,
        outSideSellerPvRate15dNew: 0.3,
        outSideSellerPvfee15d: 3,
      },
    }),
  ]);

  const result = aggregateSpotlight({
    rows: snapshot.spotlight.daily,
    groupBy: ['account', 'marketingObjective', 'placementType'],
    filters: {
      accountIds: [],
      marketingObjectives: [],
      placementTypes: ['fixture-feed'],
    },
  });

  assert.deepEqual(result.groupBy, ['account', 'marketingObjective', 'placementType']);
  assert.equal(result.summary.spend.total, 60, 'the placement filter must exclude search spend');
  assert.deepEqual(pickSeedingExternal(result.summary), {
    observability: 'observable',
    seedingSpend: 60,
    activeUv: 15,
    calculatedCost: 4,
  }, 'cost must be recomputed as aggregate spend / aggregate UV, not averaged from platform cost');

  const placement = findNode(result.groups, [
    'fictional-juguang-v3-account',
    'product_seeding',
    'fixture-feed',
  ]);
  assert.equal(placement.dimension, 'placementType');
  assert.equal(placement.label, 'fixture-feed', 'unknown placement enums must be displayed raw');
  assert.deepEqual(pickSeedingExternal(placement.summary), {
    observability: 'observable',
    seedingSpend: 60,
    activeUv: 15,
    calculatedCost: 4,
  });
});

for (const missingField of [
  'outSideSellerPv15d',
  'outSideSellerPvRate15dNew',
  'outSideSellerPvfee15d',
]) {
  test(`a missing ${missingField} makes the product-seeding aggregate partial instead of zero`, () => {
    const incomplete = { ...COMPLETE_SEEDING_EXTERNAL };
    delete incomplete[missingField];
    const snapshot = analysisSnapshot([
      rawJuguangRow({
        noteId: 'fictional-note-complete',
        placementType: 'fixture-feed',
        spend: 40,
        seedingExternal: { ...COMPLETE_SEEDING_EXTERNAL },
      }),
      rawJuguangRow({
        noteId: `fictional-note-missing-${missingField}`,
        date: '2030-02-02',
        placementType: 'fixture-feed',
        spend: 20,
        seedingExternal: incomplete,
      }),
    ]);

    const incompleteFact = snapshot.spotlight.daily.find((row) => (
      row.noteId === `fictional-note-missing-${missingField}`
    ));
    assert.ok(incompleteFact.seedingExternal15,
      'analysis must retain an explicit external-behavior fact even when one source field is missing');
    assert.equal(incompleteFact.seedingExternal15.observable, false);
    const result = aggregateSpotlight({
      rows: snapshot.spotlight.daily,
      groupBy: ['marketingObjective'],
      filters: {},
    });
    assert.deepEqual(pickSeedingExternal(result.summary), {
      observability: 'partial',
      seedingSpend: 60,
      activeUv: null,
      calculatedCost: null,
    });
  });
}

test('a complete zero-UV product-seeding aggregate keeps zero UV but leaves cost unknown', () => {
  const snapshot = analysisSnapshot([
    rawJuguangRow({
      noteId: 'fictional-note-zero-uv',
      placementType: 'fixture-feed',
      spend: 40,
      seedingExternal: {
        outSideSellerPv15d: 0,
        outSideSellerPvRate15dNew: 0,
        outSideSellerPvfee15d: 0,
      },
    }),
  ]);

  const result = aggregateSpotlight({
    rows: snapshot.spotlight.daily,
    groupBy: ['marketingObjective'],
    filters: {},
  });
  assert.deepEqual(pickSeedingExternal(result.summary), {
    observability: 'observable',
    seedingSpend: 40,
    activeUv: 0,
    calculatedCost: null,
  });
});

test('direct rows never contribute external UV or downgrade complete product-seeding behavior', () => {
  const snapshot = analysisSnapshot([
    rawJuguangRow({
      noteId: 'fictional-note-seeding',
      placementType: 'fixture-feed',
      spend: 20,
      seedingExternal: {
        outSideSellerPv15d: 4,
        outSideSellerPvRate15dNew: 0.4,
        outSideSellerPvfee15d: 5,
      },
    }),
    rawJuguangRow({
      noteId: 'fictional-note-direct',
      date: '2030-02-02',
      marketingTarget: 13,
      placementType: 'fixture-feed',
      spend: 80,
      seedingExternal: {
        outSideSellerPv15d: 999,
        outSideSellerPvRate15dNew: 0.99,
        outSideSellerPvfee15d: 0.01,
      },
      directConversion: {
        outClickEnterStoreCnt15d: 8,
        externalGoodsOrder15: 2,
        externalRgmv15: 160,
        externalRoi15: 2,
      },
    }),
  ]);

  const result = aggregateSpotlight({
    rows: snapshot.spotlight.daily,
    groupBy: ['marketingObjective'],
    filters: {},
  });
  assert.deepEqual(pickSeedingExternal(result.summary), {
    observability: 'observable',
    seedingSpend: 20,
    activeUv: 4,
    calculatedCost: 5,
  });

  const direct = findNode(result.groups, ['direct']);
  assert.deepEqual(pickSeedingExternal(direct.summary), {
    observability: 'none',
    seedingSpend: 0,
    activeUv: null,
    calculatedCost: null,
  });
  assert.equal(direct.summary.conversion15.directSpend, 80);
  assert.equal(direct.summary.conversion15.calculatedRoi15, 2,
    'the existing direct 15-day conversion contract must remain intact');
});

test('legacy deliveryMode 0/1 never masquerades as placementType in analysis or grouping', () => {
  for (const deliveryMode of [0, 1]) {
    const snapshot = analysisSnapshot([
      rawJuguangRow({
        noteId: `fictional-legacy-mode-${deliveryMode}`,
        deliveryMode,
        spend: 10,
        seedingExternal: { ...COMPLETE_SEEDING_EXTERNAL },
      }),
    ]);
    const fact = snapshot.spotlight.daily[0];
    assert.equal(fact.placementType, null,
      `legacy deliveryMode=${deliveryMode} must remain an explicitly missing placement`);
    assert.equal(hasOwn(fact, 'deliveryMode'), true,
      'the legacy value may be preserved for compatibility, but not relabeled');

    const grouped = aggregateSpotlight({
      rows: snapshot.spotlight.daily,
      groupBy: ['placementType'],
      filters: { placementTypes: [] },
    });
    assert.equal(grouped.groups.length, 1);
    assert.equal(grouped.groups[0].key, 'unknown');
    assert.equal(grouped.groups[0].label, '未知投放位置');
  }
});
