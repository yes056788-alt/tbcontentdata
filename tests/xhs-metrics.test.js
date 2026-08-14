const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const EXPECTED_XHS_METRIC_KEYS = Object.freeze([
  'xhs_totalSpend',
  'xhs_kolSpend',
  'xhs_juguangSpend',
  'xhs_kfsRatio',
  'xhs_noteCount',
  'xhs_reportedNoteShare',
  'xhs_unreportedNoteShare',
  'xhs_productSeedingSpend',
  'xhs_seedingDirectSpend',
  'xhs_xingheVisitors',
  'xhs_dmpVisitors',
  'xhs_visitFrequency',
  'xhs_visitCost',
  'xhs_storeGmv',
  'xhs_storeRoi',
  'xhs_taskGmv',
  'xhs_taskRoi',
  'xhs_contentAudienceAsset',
  'xhs_storeAudienceAsset',
  'xhs_contentAudienceShare',
  'xhs_l12Penetration',
  'xhs_l45Penetration',
  'xhs_l45OverL12',
]);

const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});
const GENERATED_AT = '2030-01-08T02:00:00.000Z';
const PGY_COLLECTED_AT = '2030-01-08T01:10:00.000Z';
const JUGUANG_COLLECTED_AT = '2030-01-08T01:20:00.000Z';
const ADSTAR_COLLECTED_AT = '2030-01-08T01:30:00.000Z';
const DMP_COLLECTED_AT = '2030-01-08T01:40:00.000Z';
const MANUAL_UPDATED_AT = '2030-01-08T01:50:00.000Z';

let metricsApi;
let metricsLoadError;
try {
  metricsApi = require('../xhs/metrics');
} catch (error) {
  metricsLoadError = error;
}

function api() {
  if (metricsLoadError) {
    assert.fail(`xhs/metrics.js must expose the T06 metric API: ${metricsLoadError.message}`);
  }
  return metricsApi;
}

function diagnosisXhsKeys() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'diagnosis-spec.js'), 'utf8');
  const windowObject = {};
  vm.runInNewContext(source, { window: windowObject });
  return Array.from(
    windowObject.BusinessDefenseDiagnosisSpec.metrics,
  ).filter((metric) => metric.platform === '小红书').map((metric) => metric.key);
}

function completeAnalysisSnapshot() {
  return {
    schemaVersion: 1,
    runId: 'fixture-xhs-analysis-run',
    generatedAt: GENERATED_AT,
    dateRange: { ...DATE_RANGE },
    accounts: {
      pgy: {
        accountKeys: ['fixture-pgy-account'],
        collectedAt: PGY_COLLECTED_AT,
      },
      juguang: {
        accountKeys: ['fixture-juguang-account-a', 'fixture-juguang-account-b'],
        collectedAt: JUGUANG_COLLECTED_AT,
      },
      adstar: {
        accountKeys: ['fixture-adstar-account'],
        collectedAt: ADSTAR_COLLECTED_AT,
      },
    },
    pgy: {
      reportedNoteCount: 3,
    },
    management: {
      // Deliberately different from PGY's count: the diagnosis metric must use
      // reported PGY notes, not the union of all noteIds in the analysis table.
      noteCount: 99,
      costs: {
        partnership: 120,
        spotlight: 80,
        total: 200,
      },
      starTaskResult: {
        source: 'adstar_store_summary',
        metrics: {
          storeVisitUv: 40,
          gmv: 600,
          seededProductGmv: 240,
          linkedProductGmv: 360,
        },
        roi: 3,
      },
    },
    spotlight: {
      total: { spend: 80 },
      byMarketingObjective: [
        { key: 'product_seeding', spend: 30 },
        { key: 'direct', spend: 50, gmv: 150, roi: 3 },
      ],
    },
    quality: {
      decisionReady: true,
      issues: [],
    },
    actions: [
      { noteId: 'fixture-note-scale', action: 'scale', evidence: ['fixture complete evidence'] },
      { noteId: 'fixture-note-stop', action: 'stop', evidence: ['fixture complete evidence'] },
    ],
  };
}

function dmpExistingValues() {
  const metadata = {
    source: 'DMP自动取数',
    updatedAt: DMP_COLLECTED_AT,
    accountKeys: ['fixture-dmp-account'],
    dateRange: { ...DATE_RANGE },
    mode: 'automatic',
  };
  return {
    xhs_dmpVisitors: { value: 20, ...metadata },
    xhs_contentAudienceAsset: { value: 100, ...metadata },
    xhs_storeAudienceAsset: { value: 400, ...metadata },
    xhs_l12Penetration: { value: 0.2, ...metadata },
    xhs_l45Penetration: { value: 0.4, ...metadata },
  };
}

function underwaterManualInput(value = 2) {
  return {
    value,
    updatedAt: MANUAL_UPDATED_AT,
    accountKeys: ['fixture-manual-owner'],
    dateRange: { ...DATE_RANGE },
  };
}

function mapComplete(overrides = {}) {
  return api().mapAnalysisSnapshot({
    analysisSnapshot: overrides.analysisSnapshot || completeAnalysisSnapshot(),
    existingValues: overrides.existingValues || dmpExistingValues(),
    manualInputs: Object.assign({
      xhs_unreportedNoteCount: underwaterManualInput(2),
    }, overrides.manualInputs || {}),
  });
}

test('diagnosis contract contains the expected 23 XHS metric keys', () => {
  assert.deepEqual(diagnosisXhsKeys(), EXPECTED_XHS_METRIC_KEYS);
});

test('xhs/metrics.js exposes the stable T06 mapping and snapshot-size API', () => {
  const metrics = api();
  assert.deepEqual(metrics.XHS_METRIC_KEYS, EXPECTED_XHS_METRIC_KEYS);
  assert.equal(metrics.MAX_SNAPSHOT_BYTES, 8 * 1024 * 1024);
  assert.equal(typeof metrics.mapAnalysisSnapshot, 'function');
  assert.equal(typeof metrics.assertSnapshotWithinLimit, 'function');
});

test('complete analysis automatically maps all 23 existing diagnosis keys and formulas', () => {
  const result = mapComplete();
  const values = result.values;

  assert.deepEqual(Object.keys(values), EXPECTED_XHS_METRIC_KEYS);
  assert.equal(values.xhs_kolSpend.value, 120);
  assert.equal(values.xhs_juguangSpend.value, 80);
  assert.equal(values.xhs_totalSpend.value, 200);
  assert.equal(values.xhs_kfsRatio.value, '120:80');
  assert.equal(values.xhs_productSeedingSpend.value, 30);
  assert.equal(values.xhs_seedingDirectSpend.value, 50);

  assert.equal(result.inputs.xhs_reportedNoteCount.value, 3);
  assert.equal(result.inputs.xhs_unreportedNoteCount.value, 2);
  assert.equal(values.xhs_noteCount.value, 5);
  assert.equal(values.xhs_reportedNoteShare.value, 0.6);
  assert.equal(values.xhs_unreportedNoteShare.value, 0.4);

  assert.equal(values.xhs_xingheVisitors.value, 40);
  assert.equal(values.xhs_dmpVisitors.value, 20);
  assert.equal(values.xhs_visitFrequency.value, 2);
  assert.equal(values.xhs_visitCost.value, 5);
  assert.equal(values.xhs_storeGmv.value, 600);
  assert.equal(values.xhs_storeRoi.value, 3);
  assert.equal(values.xhs_taskGmv.value, 240);
  assert.equal(values.xhs_taskRoi.value, 1.2);

  assert.equal(values.xhs_contentAudienceAsset.value, 100);
  assert.equal(values.xhs_storeAudienceAsset.value, 400);
  assert.equal(values.xhs_contentAudienceShare.value, 0.25);
  assert.equal(values.xhs_l12Penetration.value, 0.2);
  assert.equal(values.xhs_l45Penetration.value, 0.4);
  assert.equal(values.xhs_l45OverL12.value, 2);
});

test('every mapped value carries source, time, account, date range and precedence mode', () => {
  const result = mapComplete();
  const entries = [
    ...Object.entries(result.values),
    ...Object.entries(result.inputs),
  ];

  for (const [key, item] of entries) {
    assert.equal(typeof item.source, 'string', `${key} source`);
    assert.ok(item.source, `${key} source must not be empty`);
    assert.match(item.updatedAt, /^\d{4}-\d{2}-\d{2}T/, `${key} updatedAt`);
    assert.ok(Array.isArray(item.accountKeys), `${key} accountKeys`);
    assert.ok(item.accountKeys.length > 0, `${key} accountKeys must be traceable`);
    assert.deepEqual(item.dateRange, DATE_RANGE, `${key} dateRange`);
    assert.ok([
      'automatic',
      'formula',
      'manual_fallback',
      'manual_override',
      'preserved',
    ].includes(item.mode), `${key} mode: ${item.mode}`);
  }

  assert.match(result.values.xhs_kolSpend.source, /pgy|蒲公英/i);
  assert.deepEqual(result.values.xhs_kolSpend.accountKeys, ['fixture-pgy-account']);
  assert.equal(result.values.xhs_kolSpend.updatedAt, PGY_COLLECTED_AT);
  assert.match(result.values.xhs_juguangSpend.source, /juguang|聚光/i);
  assert.deepEqual(result.values.xhs_juguangSpend.accountKeys, [
    'fixture-juguang-account-a',
    'fixture-juguang-account-b',
  ]);
  assert.match(result.values.xhs_xingheVisitors.source, /adstar|星河/i);
  assert.deepEqual(result.values.xhs_xingheVisitors.accountKeys, ['fixture-adstar-account']);
});

test('automatic values beat legacy manual values, including a verified automatic zero', () => {
  const automaticWins = mapComplete({
    manualInputs: {
      xhs_kolSpend: 999,
      xhs_juguangSpend: 999,
      xhs_noteCount: 999,
    },
  });
  assert.equal(automaticWins.values.xhs_kolSpend.value, 120);
  assert.equal(automaticWins.values.xhs_juguangSpend.value, 80);
  assert.equal(automaticWins.values.xhs_noteCount.value, 5);
  assert.equal(automaticWins.values.xhs_kolSpend.mode, 'automatic');

  const zeroSnapshot = completeAnalysisSnapshot();
  zeroSnapshot.management.costs.partnership = 0;
  zeroSnapshot.management.costs.total = 80;
  const zeroWins = mapComplete({
    analysisSnapshot: zeroSnapshot,
    manualInputs: { xhs_kolSpend: 999 },
  });
  assert.equal(zeroWins.values.xhs_kolSpend.value, 0);
  assert.equal(zeroWins.values.xhs_kolSpend.mode, 'automatic');
});

test('manual input is a fallback for missing automation and only manualOverride can replace automation', () => {
  const missingSnapshot = completeAnalysisSnapshot();
  missingSnapshot.management.costs.partnership = null;
  missingSnapshot.management.costs.total = null;
  const fallback = mapComplete({
    analysisSnapshot: missingSnapshot,
    manualInputs: {
      xhs_kolSpend: {
        value: 321,
        updatedAt: MANUAL_UPDATED_AT,
        accountKeys: ['fixture-manual-owner'],
        dateRange: { ...DATE_RANGE },
      },
    },
  });
  assert.equal(fallback.values.xhs_kolSpend.value, 321);
  assert.equal(fallback.values.xhs_kolSpend.mode, 'manual_fallback');
  assert.match(fallback.values.xhs_kolSpend.source, /手填|manual/i);

  const explicitOverride = mapComplete({
    manualInputs: {
      xhs_kolSpend: {
        value: 654,
        manualOverride: true,
        updatedAt: MANUAL_UPDATED_AT,
        accountKeys: ['fixture-manual-owner'],
        dateRange: { ...DATE_RANGE },
      },
    },
  });
  assert.equal(explicitOverride.values.xhs_kolSpend.value, 654);
  assert.equal(explicitOverride.values.xhs_kolSpend.mode, 'manual_override');
  assert.match(explicitOverride.values.xhs_kolSpend.source, /覆盖|override/i);
});

test('reported note count comes from PGY while underwater count remains an explicit manual input', () => {
  const withoutUnderwater = api().mapAnalysisSnapshot({
    analysisSnapshot: completeAnalysisSnapshot(),
    existingValues: dmpExistingValues(),
    manualInputs: {},
  });

  assert.equal(withoutUnderwater.inputs.xhs_reportedNoteCount.value, 3);
  assert.equal(withoutUnderwater.inputs.xhs_unreportedNoteCount, undefined);
  assert.equal(withoutUnderwater.values.xhs_noteCount, undefined);
  assert.equal(withoutUnderwater.values.xhs_reportedNoteShare, undefined);
  assert.equal(withoutUnderwater.values.xhs_unreportedNoteShare, undefined);

  const explicitZero = mapComplete({
    manualInputs: { xhs_unreportedNoteCount: underwaterManualInput(0) },
  });
  assert.equal(explicitZero.values.xhs_noteCount.value, 3);
  assert.equal(explicitZero.values.xhs_reportedNoteShare.value, 1);
  assert.equal(explicitZero.values.xhs_unreportedNoteShare.value, 0);
});

test('XHS automation never overwrites preserved DMP diagnosis values', () => {
  const analysisSnapshot = completeAnalysisSnapshot();
  analysisSnapshot.metricValues = {
    xhs_dmpVisitors: 9999,
    xhs_contentAudienceAsset: 9999,
    xhs_storeAudienceAsset: 9999,
    xhs_l12Penetration: 0.99,
    xhs_l45Penetration: 0.99,
  };
  const existingValues = dmpExistingValues();
  const result = mapComplete({ analysisSnapshot, existingValues });

  for (const key of Object.keys(existingValues)) {
    assert.equal(result.values[key].value, existingValues[key].value, key);
    assert.equal(result.values[key].source, 'DMP自动取数', `${key} source`);
    assert.equal(result.values[key].updatedAt, DMP_COLLECTED_AT, `${key} updatedAt`);
    assert.deepEqual(result.values[key].accountKeys, ['fixture-dmp-account'], `${key} account`);
    assert.equal(result.values[key].mode, 'preserved', `${key} mode`);
  }
});

test('decisionReady false suppresses scale and stop conclusions even if upstream actions contain them', () => {
  const partialSnapshot = completeAnalysisSnapshot();
  partialSnapshot.quality = {
    decisionReady: false,
    issues: [{
      severity: 'critical',
      code: 'juguang_partial',
      message: 'fixture partial collection',
    }],
  };
  partialSnapshot.actions = [
    { noteId: 'fixture-note-scale', action: 'scale', evidence: ['should be gated'] },
    { noteId: 'fixture-note-stop', action: 'stop', evidence: ['should be gated'] },
  ];

  const result = mapComplete({ analysisSnapshot: partialSnapshot });

  assert.equal(result.decisionReady, false);
  assert.ok(result.issues.some((issue) => issue.code === 'juguang_partial'));
  assert.ok(result.actions.every((item) => ['observe', 'refill'].includes(item.action)));
  assert.equal(result.actions.some((item) => ['scale', 'stop'].includes(item.action)), false);
});

test('mapping strips sensitive fields and raw source payloads and remains below the 8 MB archive gate', () => {
  const snapshot = completeAnalysisSnapshot();
  snapshot.accounts.pgy.diagnosticUrl =
    'https://pgy.xiaohongshu.com/report?xsec_token=fixture-xsec-secret';
  snapshot.accounts.juguang.authorization = 'fixture-authorization-secret';
  snapshot.accounts.adstar.cookie = 'fixture-cookie-secret';
  snapshot.debugMessage =
    'failed url=https://adstar.alimama.com/api?_tb_token_=fixture-star-secret&bizCode=adstar';
  snapshot.rawResponses = [{
    marker: 'fixture-raw-response-must-not-be-archived',
    payload: 'x'.repeat(256 * 1024),
  }];
  snapshot.notes = [{
    noteId: 'fixture-note-sensitive',
    signedUrl: 'https://www.xiaohongshu.com/explore/fixture?xsec_token=fixture-note-secret',
    raw: 'fixture-raw-note-must-not-be-mapped',
  }];

  const result = mapComplete({ analysisSnapshot: snapshot });
  const serialized = JSON.stringify(result);

  for (const forbidden of [
    'fixture-xsec-secret',
    'fixture-authorization-secret',
    'fixture-cookie-secret',
    'fixture-star-secret',
    'fixture-note-secret',
    'fixture-raw-response-must-not-be-archived',
    'fixture-raw-note-must-not-be-mapped',
    '_tb_token_',
    'xsec_token',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `sensitive mapping output: ${forbidden}`);
  }
  assert.ok(Buffer.byteLength(serialized, 'utf8') < api().MAX_SNAPSHOT_BYTES);
  assert.doesNotThrow(() => api().assertSnapshotWithinLimit(result));
});

test('the archive size guard rejects snapshots at or above 8 MB', () => {
  const metrics = api();
  const oversized = {
    schemaVersion: 1,
    payload: 'x'.repeat((8 * 1024 * 1024) + 1024),
  };
  assert.throws(
    () => metrics.assertSnapshotWithinLimit(oversized),
    /8\s*MB|too large|snapshot.*limit/i,
  );
});
