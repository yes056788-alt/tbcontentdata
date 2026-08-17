const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryCache } = require('../xhs/local-cache');
const {
  parsePgyPage,
  normalizePgyNote,
  normalizePgySummary,
  reconcilePgyCollection,
  createPgyCollector,
} = require('../xhs/pgy-collector');

const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});

const FICTIONAL_NOTES = Object.freeze([
  {
    noteId: 'fictional-note-001',
    bizId: 'fictional-cooperation-001',
    noteTitle: '虚构笔记一',
    notePublishTime: '2030-01-02 09:30:00',
    kolId: 'fictional-creator-001',
    kolNickName: '虚构达人一',
    actualConsume: '100',
    totalConsume: '120',
    refundAmount: '20',
    totalPlatformPrice: '10',
    impNum: '1000',
    readNum: '200',
    engageNum: '30',
    noteCover: 'https://media.example/cover?width=320&xsec_token=fictional-xsec&sign=fictional-signature',
    token: 'fictional-row-token',
  },
  {
    noteId: 'fictional-note-002',
    bizId: 'fictional-cooperation-002',
    noteTitle: '虚构笔记二',
    notePublishTime: '2030-01-04 12:00:00',
    kolId: 'fictional-creator-002',
    kolNickName: '虚构达人二',
    actualConsume: null,
    totalConsume: '250',
    refundAmount: '50',
    totalPlatformPrice: '20',
    impNum: '2000',
    readNum: '500',
    engageNum: '80',
  },
  {
    noteId: 'fictional-note-003',
    bizId: 'fictional-cooperation-003',
    noteTitle: '虚构笔记三',
    notePublishTime: '2030-01-07 23:59:00',
    kolId: 'fictional-creator-003',
    kolNickName: '虚构达人三',
    actualConsume: '50',
    totalConsume: '50',
    refundAmount: '0',
    totalPlatformPrice: '5',
    impNum: '500',
    readNum: '100',
    engageNum: '10',
  },
]);

function clone(value) {
  return structuredClone(value);
}

function rawSummary(overrides = {}) {
  return {
    data: {
      total: 3,
      actualConsume: '350',
      totalPlatformPrice: '35',
      ...overrides,
    },
  };
}

function createFakePageClient(options = {}) {
  const calls = [];
  const pageSize = 2;
  let rows = clone(FICTIONAL_NOTES);
  if (options.zero) rows = [];
  if (options.duplicate) rows = [clone(FICTIONAL_NOTES[0]), clone(FICTIONAL_NOTES[1]), clone(FICTIONAL_NOTES[1])];

  async function request(input) {
    calls.push(clone(input));
    assert.equal(input.platform, 'pgy');
    assert.equal(input.tabId, 61);

    if (input.endpoint === 'identity.get') {
      return {
        brandUserId: 'fictional-brand-user-001',
        brandUserName: '虚构品牌账户',
      };
    }

    if (input.endpoint === 'notes.sum') {
      if (options.zero) return rawSummary({ total: 0, actualConsume: '0', totalPlatformPrice: '0' });
      if (options.duplicate) return rawSummary({ total: 3, actualConsume: '300', totalPlatformPrice: '30' });
      return rawSummary(options.summaryOverride || {});
    }

    if (input.endpoint === 'notes.list') {
      const page = Number(input.payload.pageNum || input.payload.page || 1);
      if (options.interruptPage === page) {
        const error = new Error(`fictional page ${page} interruption`);
        error.retryable = false;
        throw error;
      }
      if (options.structureDrift) {
        return { data: { total: 0, totalPage: 1, pageSize } };
      }
      const totalPage = rows.length ? Math.ceil(rows.length / pageSize) : 0;
      return {
        data: {
          list: rows.slice((page - 1) * pageSize, page * pageSize),
          pageNum: page,
          pageSize,
          total: rows.length,
          totalPage,
        },
      };
    }

    throw new Error(`unexpected fictional endpoint: ${input.endpoint}`);
  }

  return { calls, request };
}

function createCollector(pageClient) {
  return createPgyCollector({
    pageClient,
    cache: createMemoryCache(),
    now: () => '2030-02-01T00:00:00.000Z',
  });
}

function collectionOptions(runId) {
  return {
    tabId: 61,
    runId: runId || 'fictional-pgy-run-001',
    accountKey: 'fictional-pgy-account-001',
    dateRange: DATE_RANGE,
    pageSize: 2,
  };
}

test('parsePgyPage accepts a real paginated shape and rejects missing data.list', () => {
  assert.deepEqual(parsePgyPage({
    data: {
      list: [{ noteId: 'fictional-note-001' }],
      pageNum: 1,
      pageSize: 20,
      total: 21,
      totalPage: 2,
    },
  }, 1), {
    items: [{ noteId: 'fictional-note-001' }],
    total: 21,
    pageSize: 20,
    hasNext: true,
    nextPage: 2,
  });

  assert.throws(
    () => parsePgyPage({ data: { total: 0, totalPage: 0, pageSize: 20 } }, 1),
    /data\.list/i
  );
  assert.throws(() => parsePgyPage({}, 1), /data/i);
});

test('normalizes note identity, publish date, cooperation cost, service fee, and sanitized fields', () => {
  const input = clone(FICTIONAL_NOTES[0]);
  input.rawBusinessPayload = { marker: 'fictional-raw-business-payload' };
  input.unusedDecoration = 'fictional-unused-decoration';
  const normalized = normalizePgyNote(input);

  assert.equal(normalized.noteId, 'fictional-note-001');
  assert.equal(normalized.sourceKey, 'fictional-cooperation-001');
  assert.equal(normalized.title, '虚构笔记一');
  assert.equal(normalized.publishDate, '2030-01-02');
  assert.deepEqual(normalized.author, {
    id: 'fictional-creator-001',
    name: '虚构达人一',
  });
  assert.deepEqual(normalized.costs, {
    cooperation: 100,
    platformFee: 10,
    total: 110,
  });
  assert.deepEqual(normalized.metrics, {
    impressions: 1000,
    reads: 200,
    interactions: 30,
  });
  assert.deepEqual(Object.keys(normalized).sort(), [
    'author', 'costs', 'metrics', 'noteId', 'publishDate', 'sourceKey', 'title',
  ]);

  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(
    serialized,
    /fictional-xsec|fictional-signature|fictional-row-token|xsec_token|sign=|fictional-raw-business-payload|fictional-unused-decoration/
  );
});

test('falls back to totalConsume minus refundAmount when actualConsume is missing', () => {
  const normalized = normalizePgyNote(clone(FICTIONAL_NOTES[1]));
  assert.deepEqual(normalized.costs, {
    cooperation: 200,
    platformFee: 20,
    total: 220,
  });
});

test('normalizes sum data and reconciles total rows, unique notes, and both cost components', () => {
  const summary = normalizePgySummary(rawSummary());
  const notes = FICTIONAL_NOTES.map((row) => normalizePgyNote(clone(row)));
  const reconciliation = reconcilePgyCollection({ summary, notes });

  assert.deepEqual(summary, {
    expectedCount: 3,
    cooperationCost: 350,
    platformFee: 35,
    totalCost: 385,
  });
  assert.equal(reconciliation.reconciled, true);
  assert.equal(reconciliation.expectedCount, 3);
  assert.equal(reconciliation.receivedCount, 3);
  assert.equal(reconciliation.uniqueCount, 3);
  assert.equal(reconciliation.duplicateCount, 0);
  assert.equal(reconciliation.cooperationCost, 350);
  assert.equal(reconciliation.platformFee, 35);
  assert.deepEqual(reconciliation.issues, []);

  const mismatch = reconcilePgyCollection({
    summary: { ...summary, cooperationCost: 999 },
    notes,
  });
  assert.equal(mismatch.reconciled, false);
  assert.ok(mismatch.issues.some((issue) => issue.code === 'cooperation_cost_mismatch'));
});

test('reconciles only a one-sided platform-fee truncation gap below the per-row yuan bound', () => {
  const notes = [
    normalizePgyNote({
      noteId: 'fictional-rounding-note-001',
      bizId: 'fictional-rounding-order-001',
      actualConsume: 259,
      totalPlatformPrice: 25,
    }),
    normalizePgyNote({
      noteId: 'fictional-rounding-note-002',
      bizId: 'fictional-rounding-order-002',
      actualConsume: 169,
      totalPlatformPrice: 16,
    }),
  ];
  const reconciliation = reconcilePgyCollection({
    summary: {
      expectedCount: 2,
      cooperationCost: 428,
      platformFee: 42,
    },
    notes,
  });

  assert.equal(reconciliation.reconciled, true);
  assert.deepEqual(reconciliation.issues, []);
  assert.deepEqual(reconciliation.platformFeeDiagnostics, {
    expected: 42,
    actual: 41,
    difference: 1,
    tolerance: 2,
    feeBearingCount: 2,
    reconciliation: 'per_row_yuan_truncation',
  });
  assert.deepEqual(reconciliation.warnings, [{
    code: 'platform_fee_rounding_reconciled',
    message: 'PGY summary platform fee 42 exceeds the note-row total 41 by 1; accepted because 2 fee-bearing rows permit a one-sided truncation gap strictly below 2 yuan.',
    expected: 42,
    actual: 41,
    difference: 1,
    tolerance: 2,
    feeBearingCount: 2,
  }]);
});

test('keeps reverse and out-of-bound platform-fee differences as blocking mismatches', () => {
  const notes = [
    normalizePgyNote({
      noteId: 'fictional-strict-note-001',
      bizId: 'fictional-strict-order-001',
      actualConsume: 100,
      totalPlatformPrice: 10,
    }),
    normalizePgyNote({
      noteId: 'fictional-strict-note-002',
      bizId: 'fictional-strict-order-002',
      actualConsume: 200,
      totalPlatformPrice: 20,
    }),
  ];

  const reverse = reconcilePgyCollection({
    summary: { expectedCount: 2, cooperationCost: 300, platformFee: 29 },
    notes,
  });
  const reverseIssue = reverse.issues.find((issue) => issue.code === 'platform_fee_mismatch');
  assert.equal(reverse.reconciled, false);
  assert.deepEqual(reverseIssue, {
    code: 'platform_fee_mismatch',
    message: 'PGY platform fee mismatch: summary 29, note rows 30, difference -1, allowed one-sided truncation gap must be at least 0 and strictly below 2 yuan across 2 fee-bearing rows.',
    expected: 29,
    actual: 30,
    difference: -1,
    tolerance: 2,
    feeBearingCount: 2,
  });

  const outOfBound = reconcilePgyCollection({
    summary: { expectedCount: 2, cooperationCost: 300, platformFee: 32 },
    notes,
  });
  const outOfBoundIssue = outOfBound.issues.find((issue) => issue.code === 'platform_fee_mismatch');
  assert.equal(outOfBound.reconciled, false);
  assert.equal(outOfBoundIssue.difference, 2);
  assert.equal(outOfBoundIssue.tolerance, 2);
  assert.match(outOfBoundIssue.message, /strictly below 2 yuan/i);
});

test('collects identity, sum, and every list page using note publish time as the range basis', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions());

  assert.equal(result.platform, 'pgy');
  assert.equal(result.status, 'complete');
  assert.equal(result.schemaValid, true);
  assert.equal(result.empty, false);
  assert.equal(result.dateBasis, 'note_publish_time');
  assert.deepEqual(result.identity, {
    accountKey: 'fictional-pgy-account-001',
    brandUserId: 'fictional-brand-user-001',
    brandUserName: '虚构品牌账户',
  });
  assert.equal(result.notes.length, 3);
  assert.equal(result.summary.expectedCount, 3);
  assert.equal(result.reconciliation.reconciled, true);
  assert.deepEqual(result.errors, []);

  const listCalls = pageClient.calls.filter((call) => call.endpoint === 'notes.list');
  assert.deepEqual(
    listCalls.map((call) => Number(call.payload.pageNum || call.payload.page)),
    [1, 2]
  );
  for (const call of listCalls) {
    assert.equal(call.payload.startTime, DATE_RANGE.from);
    assert.equal(call.payload.endTime, DATE_RANGE.to);
    assert.equal(call.payload.pageSize, 2);
    assert.deepEqual(call.payload.brandUserIds, ['fictional-brand-user-001']);
  }
  const sumCall = pageClient.calls.find((call) => call.endpoint === 'notes.sum');
  assert.equal(sumCall.payload.startTime, DATE_RANGE.from);
  assert.equal(sumCall.payload.endTime, DATE_RANGE.to);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /fictional-xsec|fictional-signature|fictional-row-token|xsec_token|sign=/
  );
});

test('propagates an explainable platform-fee truncation warning without degrading collection status', async () => {
  const pageClient = createFakePageClient({
    summaryOverride: { totalPlatformPrice: '36' },
  });
  const result = await createCollector(pageClient)
    .collect(collectionOptions('fictional-pgy-run-fee-rounding'));

  assert.equal(result.status, 'complete');
  assert.equal(result.reconciliation.reconciled, true);
  assert.deepEqual(result.reconciliation.issues, []);
  assert.ok(result.warnings.some((warning) => (
    warning.code === 'platform_fee_rounding_reconciled' &&
    warning.expected === 36 &&
    warning.actual === 35 &&
    warning.difference === 1 &&
    warning.tolerance === 3 &&
    warning.feeBearingCount === 3 &&
    /accepted/i.test(warning.message)
  )));
});

test('distinguishes a verified zero-result collection from schema or request failure', async () => {
  const emptyResult = await createCollector(createFakePageClient({ zero: true }))
    .collect(collectionOptions('fictional-pgy-run-empty'));
  assert.equal(emptyResult.status, 'complete');
  assert.equal(emptyResult.schemaValid, true);
  assert.equal(emptyResult.empty, true);
  assert.deepEqual(emptyResult.notes, []);
  assert.equal(emptyResult.reconciliation.reconciled, true);

  const driftResult = await createCollector(createFakePageClient({ structureDrift: true }))
    .collect(collectionOptions('fictional-pgy-run-drift'));
  assert.equal(driftResult.status, 'failed');
  assert.equal(driftResult.schemaValid, false);
  assert.equal(driftResult.empty, false);
  assert.ok(driftResult.errors.some((error) => /data\.list/i.test(error.message)));
});

test('returns partial with committed rows when a later list page is interrupted', async () => {
  const result = await createCollector(createFakePageClient({ interruptPage: 2 }))
    .collect(collectionOptions('fictional-pgy-run-interrupted'));

  assert.equal(result.status, 'partial');
  assert.equal(result.schemaValid, true);
  assert.equal(result.receivedCount, 2);
  assert.equal(result.expectedCount, 3);
  assert.equal(result.reconciliation.reconciled, false);
  assert.ok(result.errors.some((error) => (
    error.code === 'pagination_incomplete' && /fictional page 2 interruption/.test(error.message)
  )));
});

test('marks exact duplicate source rows and resulting count/cost mismatch as partial', async () => {
  const result = await createCollector(createFakePageClient({ duplicate: true }))
    .collect(collectionOptions('fictional-pgy-run-duplicate'));

  assert.equal(result.status, 'partial');
  assert.equal(result.reconciliation.reconciled, false);
  assert.equal(result.reconciliation.receivedCount, 3);
  assert.equal(result.reconciliation.uniqueCount, 2);
  assert.equal(result.reconciliation.duplicateCount, 1);
  assert.ok(result.reconciliation.issues.some((issue) => (
    issue.code === 'duplicate_source_row' || issue.code === 'duplicate_note_id'
  )));
  assert.ok(result.reconciliation.issues.some((issue) => (
    issue.code === 'cooperation_cost_mismatch' || issue.code === 'platform_fee_mismatch'
  )));
});
