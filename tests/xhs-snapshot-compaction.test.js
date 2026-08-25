const assert = require('node:assert/strict');
const test = require('node:test');

const { createXhsAnalysisSnapshot } = require('../xhs/analysis');
const { MAX_SNAPSHOT_BYTES, assertSnapshotWithinLimit } = require('../xhs/metrics');

const STAR_NOTE_COUNT = 2013;
const STAR_DAILY_FACT_COUNT = 21792;
const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-11',
  timezone: 'Asia/Shanghai',
});

function highCardinalityStarInput() {
  const projectId = 'fictional-project-high-cardinality';
  const orderId = 'fictional-order-high-cardinality';
  const contentRows = [];
  let remaining = STAR_DAILY_FACT_COUNT;
  for (let noteIndex = 0; noteIndex < STAR_NOTE_COUNT; noteIndex += 1) {
    const noteId = `fictional-note-${String(noteIndex).padStart(5, '0')}`;
    const factsForNote = Math.min(11, remaining - (STAR_NOTE_COUNT - noteIndex - 1) * 10);
    remaining -= factsForNote;
    for (let day = 1; day <= factsForNote; day += 1) {
      contentRows.push({
        noteId,
        contentId: noteId,
        listOrderId: orderId,
        projectId,
        theDate: `203001${String(day).padStart(2, '0')}`,
        readUv1d: 100 + day,
        engagementUv1d: 20 + day,
        slrAttrItmSeImpsUv1d: 300 + day,
        slrAttrSlrSeVstUv1d: 40 + day,
        slrAttrSlrVstUv1d: 30 + day,
        slrAttrSlrVstUv1dNew: 10 + day,
        slrAttrItmCltUv1d: 8 + day,
        slrAttrItmCartUv1d: 7 + day,
        slrAttrItmOrdUv1d: 6 + day,
        slrAttrItmOrdUv1dNew: 5 + day,
        slrAttrItmOrdGmv1d: 500 + day,
        slrAttrItmOrdGmv1d1bpOrd: 320 + day,
        slrAttrItmOrdGmv1dNot1bpOrd: 180 + day,
      });
    }
  }
  assert.equal(contentRows.length, STAR_DAILY_FACT_COUNT);

  const summary = {
    readUv1d: 200000,
    engagementUv1d: 40000,
    slrAttrItmSeImpsUv1d: 600000,
    slrAttrSlrSeVstUv1d: 80000,
    slrAttrSlrVstUv1d: 60000,
    slrAttrSlrVstUv1dNew: 20000,
    slrAttrItmCltUv1d: 16000,
    slrAttrItmCartUv1d: 14000,
    slrAttrItmOrdUv1d: 12000,
    slrAttrItmOrdUv1dNew: 10000,
    slrAttrItmOrdGmv1d: 1000000,
    slrAttrItmOrdGmv1d1bpOrd: 640000,
    slrAttrItmOrdGmv1dNot1bpOrd: 360000,
  };
  const project = {
    projectId,
    projectName: '虚构高基数星河项目',
    startTime: '2030-01-01 00:00:00',
    endTime: '2030-01-11 23:59:59',
  };
  const order = {
    orderId,
    projectId,
    orderName: '虚构高基数星河订单',
    startTime: '2030-01-01 00:00:00',
    endTime: '2030-01-11 23:59:59',
  };
  const adstar = {
    schemaVersion: 1,
    platform: 'adstar',
    runId: 'fictional-run-high-cardinality',
    accountKey: 'fictional-adstar-account',
    dateRange: { ...RANGE },
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    identity: { memberId: 'fictional-star-member-size' },
    lists: {
      projects: { status: 'complete', items: [project] },
      orders: { status: 'complete', items: [order] },
    },
    storeSummary: summary,
    nested: [
      {
        type: 'project', id: projectId, name: project.projectName, status: 'complete',
        summary,
        checkpoints: {
          order: { status: 'complete', expectedCount: 1, receivedCount: 1, truncated: false },
        },
        details: { project: [], order: [] },
      },
      {
        type: 'order', id: orderId, projectId, name: order.orderName, status: 'complete',
        summary,
        checkpoints: {
          content: {
            status: 'complete', expectedCount: STAR_NOTE_COUNT,
            receivedCount: STAR_NOTE_COUNT, truncated: false,
          },
        },
        details: { order: [], content: [] },
      },
    ],
    contentRows,
    excluded: { projects: [], orders: [] },
    warnings: [],
    errors: [],
  };
  return {
    runId: adstar.runId,
    storeId: 'fictional-store-high-cardinality',
    selectedPlatforms: ['adstar'],
    dateRange: { ...RANGE },
    generatedAt: '2030-01-12T00:00:00.000Z',
    asOf: '2030-01-11',
    collections: { adstar },
  };
}

test('21,792 Star facts keep V2 note joins and hierarchy below the 8 MiB snapshot gate', () => {
  const snapshot = createXhsAnalysisSnapshot(highCardinalityStarInput());
  const serializedBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  const hierarchyNotes = snapshot.star.projects.flatMap((project) => project.orders)
    .flatMap((order) => order.notes);

  assert.equal(snapshot.notes.length, STAR_NOTE_COUNT);
  assert.equal(new Set(snapshot.notes.map((note) => note.noteId)).size, STAR_NOTE_COUNT);
  assert.equal(hierarchyNotes.length, STAR_NOTE_COUNT);
  assert.equal(snapshot.star.dailyCount, STAR_DAILY_FACT_COUNT);
  assert.equal(snapshot.star.dailyOmitted, true);
  assert.deepEqual(snapshot.star.daily, []);
  assert.ok(snapshot.notes.every((note) => note.task.orderIds.length === 1));
  assert.ok(snapshot.notes.every((note) => !Object.hasOwn(note.task, 'relations')));
  assert.ok(snapshot.notes.every((note) => [10, 11].includes(note.task.relationCount)));
  assert.ok(snapshot.notes.every((note) => (
    note.task.relationSources.length === 1 && note.task.relationSources[0] === 'adstar'
  )));
  assert.ok(serializedBytes < MAX_SNAPSHOT_BYTES,
    `compacted snapshot must stay below 8 MiB, got ${serializedBytes} bytes`);
  assert.doesNotThrow(() => assertSnapshotWithinLimit(snapshot));
});

test('small Star snapshots use the same stable compact daily metadata', () => {
  const input = highCardinalityStarInput();
  input.collections.adstar.contentRows = input.collections.adstar.contentRows.slice(0, 2);
  input.collections.adstar.nested[1].checkpoints.content.expectedCount = 1;
  input.collections.adstar.nested[1].checkpoints.content.receivedCount = 1;
  const snapshot = createXhsAnalysisSnapshot(input);

  assert.equal(snapshot.star.dailyCount, 2);
  assert.equal(snapshot.star.dailyOmitted, true);
  assert.deepEqual(snapshot.star.daily, []);
  assert.equal(snapshot.notes.length, 1);
  assert.equal(snapshot.notes[0].task.relationCount, 2);
  assert.deepEqual(snapshot.notes[0].task.relationSources, ['adstar']);
});

module.exports = {
  STAR_NOTE_COUNT,
  STAR_DAILY_FACT_COUNT,
  highCardinalityStarInput,
};
