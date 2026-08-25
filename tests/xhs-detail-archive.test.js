const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  MAX_SNAPSHOT_BYTES,
  XHS_DETAIL_CHUNK_ROW_LIMIT,
  analysisDetailKeys,
  assertSnapshotWithinLimit,
  createXhsAnalysisArchiveBundle,
  hydrateXhsAnalysisArchiveBundle,
} = require('../xhs/metrics');

function largeAnalysisSnapshot(rowCount = 5500) {
  const padding = '虚构大容量明细'.repeat(70);
  const pgyFacts = [];
  const spotlightDaily = [];
  const notes = [];
  const hierarchyNotes = [];
  for (let index = 0; index < rowCount; index += 1) {
    const noteId = `fictional-large-note-${String(index).padStart(6, '0')}`;
    pgyFacts.push({
      noteId,
      sourceKey: `fictional-source-${index}`,
      title: `${padding}-${index}`,
      publishDate: '2030-02-01',
      costs: { cooperation: index + 1, platformFee: 1, total: index + 2 },
      metrics: { impressions: index + 100, reads: index + 10, interactions: index + 1 },
    });
    spotlightDaily.push({
      noteId,
      date: '2030-02-01',
      accountId: 'fictional-advertiser-001',
      marketingObjective: 'product_seeding',
      placementType: 'feed',
      taskStatus: 'in_task',
      spend: index + 0.5,
      impressions: index + 100,
      clicks: index + 10,
    });
    notes.push({
      noteId,
      title: `${padding}-${index}`,
      publishDate: '2030-02-01',
      task: { orderIds: ['fictional-order-001'], projectIds: ['fictional-project-001'] },
      costs: { cooperation: index + 1, platformFee: 1, total: index + 2 },
      star: { metrics: { readUv: index + 10, storeVisitUv: index + 1 } },
    });
    hierarchyNotes.push({
      noteId,
      title: `${padding}-${index}`,
      publishDate: '2030-02-01',
      metrics: { readUv: index + 10, storeVisitUv: index + 1 },
      costs: { creator: index + 2, adInTask: 1, total: index + 3 },
    });
  }
  const order = {
    id: 'fictional-order-001',
    projectId: 'fictional-project-001',
    name: '虚构任务',
    metrics: { readUv: 123, storeVisitUv: 45, gmv: 678 },
    costs: { creator: 100, adInTask: 50, total: 150 },
    notes: hierarchyNotes,
  };
  return {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'fictional-large-analysis-run',
    generatedAt: '2030-03-01T00:00:00.000Z',
    dateRange: { from: '2030-02-01', to: '2030-02-28', timezone: 'Asia/Shanghai' },
    pgy: { facts: pgyFacts, costs: { total: 123456 } },
    spotlight: { daily: spotlightDaily, total: { spend: 12345 } },
    star: {
      projects: [{
        id: 'fictional-project-001',
        name: '虚构项目',
        metrics: { readUv: 123, storeVisitUv: 45, gmv: 678 },
        costs: { creator: 100, adInTask: 50, total: 150 },
        orders: [structuredClone(order)],
      }],
      orders: [order],
      unassignedNotes: [],
      store: { metrics: { readUv: 123, storeVisitUv: 45, gmv: 678 } },
    },
    management: { noteCount: rowCount, costs: { total: 123456 } },
    quality: { decisionReady: true, issues: [] },
    actions: notes.map((note) => ({ noteId: note.noteId, action: 'observe', confidence: 'low' })),
    notes,
  };
}

test('an analysis larger than 8 MiB is stored as one safe summary plus <=500-row detail chunks', () => {
  const source = largeAnalysisSnapshot();
  assert.ok(Buffer.byteLength(JSON.stringify(source), 'utf8') >= MAX_SNAPSHOT_BYTES);

  const bundle = createXhsAnalysisArchiveBundle(source);
  const keys = analysisDetailKeys(bundle.snapshot);

  assert.equal(keys.length, Object.keys(bundle.chunks).length);
  assert.equal(bundle.snapshot.detailArchive.complete, true);
  assert.equal(bundle.snapshot.notes.length, 20, 'the safe main snapshot retains the default Top 20 preview');
  assert.equal(bundle.snapshot.pgy.facts.length, 20);
  assert.equal(bundle.snapshot.spotlight.daily.length, 20);
  assert.equal(bundle.snapshot.star.projects[0].orders, undefined,
    'project rows must not clone canonical task rows');
  assert.equal(bundle.snapshot.star.orders[0].notes, undefined,
    'task rows must not clone canonical joined note rows');
  assert.doesNotThrow(() => assertSnapshotWithinLimit(bundle.snapshot));

  for (const [key, chunk] of Object.entries(bundle.chunks)) {
    assert.ok(keys.includes(key));
    assert.ok(chunk.items.length <= XHS_DETAIL_CHUNK_ROW_LIMIT);
    assert.doesNotThrow(() => assertSnapshotWithinLimit(chunk));
  }

  const hydrated = hydrateXhsAnalysisArchiveBundle(bundle.snapshot, bundle.chunks);
  assert.equal(hydrated.pgy.facts.length, source.pgy.facts.length);
  assert.equal(hydrated.spotlight.daily.length, source.spotlight.daily.length);
  assert.equal(hydrated.notes.length, source.notes.length);
  assert.equal(hydrated.actions.length, source.actions.length);
  assert.equal(hydrated.star.projects.length, source.star.projects.length);
  assert.equal(hydrated.star.orders.length, source.star.orders.length);
  assert.equal(hydrated.pgy.facts.at(-1).noteId, source.pgy.facts.at(-1).noteId);
  assert.equal(hydrated.notes.at(-1).title, source.notes.at(-1).title);
  assert.equal(hydrated.star.projects[0].orders, undefined);
  assert.equal(hydrated.star.orders[0].notes, undefined);
  assert.equal(hydrated.detailArchive.load.complete, true);
});

test('local detail sharding preserves every section when the combined detail exceeds 22 MiB', () => {
  const padding = '本地完整分片'.repeat(48 * 1024);
  const rows = (kind) => Array.from({ length: 7 }, (_, index) => ({
    id: `${kind}-${index}`,
    noteId: `fictional-${kind}-note-${index}`,
    projectId: kind === 'star-order' ? 'fictional-large-project' : undefined,
    padding,
  }));
  const source = {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'fictional-over-22-mib-local-run',
    generatedAt: '2030-03-01T00:00:00.000Z',
    pgy: { facts: rows('pgy') },
    spotlight: { daily: rows('spotlight') },
    star: {
      projects: rows('star-project'),
      orders: rows('star-order'),
      unassignedNotes: rows('star-unassigned'),
    },
    actions: rows('action'),
    notes: rows('joined'),
    quality: { decisionReady: true, issues: [] },
  };

  const bundle = createXhsAnalysisArchiveBundle(source);
  assert.ok(bundle.snapshot.detailArchive.detailBytes > 22 * 1024 * 1024,
    'the fixture must exercise the former combined-detail limit');
  assert.equal(bundle.snapshot.detailArchive.complete, true);
  for (const section of Object.values(bundle.snapshot.detailArchive.sections)) {
    assert.equal(section.omittedCount, 0);
    assert.equal(section.storedCount, section.sourceCount);
  }

  const hydrated = hydrateXhsAnalysisArchiveBundle(bundle.snapshot, bundle.chunks);
  assert.equal(hydrated.detailArchive.load.complete, true);
  assert.equal(hydrated.pgy.facts.length, source.pgy.facts.length);
  assert.equal(hydrated.spotlight.daily.length, source.spotlight.daily.length);
  assert.equal(hydrated.star.projects.length, source.star.projects.length);
  assert.equal(hydrated.star.orders.length, source.star.orders.length);
  assert.equal(hydrated.notes.length, source.notes.length,
    'SPU filtering must receive the complete joined-note dataset');
});

test('a missing detail chunk keeps the summary usable and marks only detail loading partial', () => {
  const source = largeAnalysisSnapshot(700);
  const bundle = createXhsAnalysisArchiveBundle(source);
  const chunks = { ...bundle.chunks };
  delete chunks[analysisDetailKeys(bundle.snapshot)[0]];

  const hydrated = hydrateXhsAnalysisArchiveBundle(bundle.snapshot, chunks);

  assert.equal(hydrated.schema, 'xhsAnalysisSnapshotV1');
  assert.equal(hydrated.detailArchive.load.complete, false);
  assert.ok(hydrated.detailArchive.load.missingKeys.length >= 1);
  assert.ok(hydrated.pgy.facts.length >= 20, 'the Top 20 preview remains available');
  assert.deepEqual(hydrated.management, source.management);
});

test('the report viewer validates and hydrates the same detail manifest format', () => {
  const source = largeAnalysisSnapshot(520);
  const bundle = createXhsAnalysisArchiveBundle(source);
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'report.js'), 'utf8');
  const start = reportSource.indexOf('  function isXhsDetailKey');
  const end = reportSource.indexOf('\n  let bridgeConnected', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    Array,
    JSON,
    Math,
    Number,
    Object,
    String,
    TextEncoder,
  });
  vm.runInContext(
    `const XHS_DETAIL_KEY_PREFIX = 'xhsAnalysisDetailChunkV1:';\n` +
      reportSource.slice(start, end) +
      '\nglobalThis.testHydrateXhsDetails = hydrateXhsDetails;',
    context
  );

  const hydrated = context.testHydrateXhsDetails(bundle.snapshot, bundle.chunks);
  assert.equal(hydrated.notes.length, source.notes.length);
  assert.equal(hydrated.pgy.facts.length, source.pgy.facts.length);
  assert.equal(hydrated.spotlight.daily.length, source.spotlight.daily.length);
  assert.equal(hydrated.detailArchive.load.complete, true);
});
