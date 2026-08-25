const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryCache } = require('../xhs/local-cache');
const {
  parsePgyPage,
  normalizePgyProject,
  normalizePgyNote,
  normalizePgySummary,
  applyPgyTaskEndDates,
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
    thirdProjectId: 'fictional-pgy-project-001',
    starData: { thirdBriefId: '  fictional-taobao-task-001  ' },
    thirdBriefEndTime: '2030-01-31 23:59:59',
    kolId: 'fictional-creator-001',
    kolNickName: '虚构达人一',
    kolFanNum: 4999,
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
  let interruptedAttempts = 0;
  let rows = clone(FICTIONAL_NOTES);
  if (options.zero) rows = [];
  if (options.duplicate) rows = [clone(FICTIONAL_NOTES[0]), clone(FICTIONAL_NOTES[1]), clone(FICTIONAL_NOTES[1])];
  if (options.missingDirectTaskEnd && rows[0]) rows[0].thirdBriefEndTime = null;

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
      const shouldInterrupt = options.interruptPage === page && (
        options.interruptAttempts == null || interruptedAttempts < Number(options.interruptAttempts)
      );
      if (shouldInterrupt) {
        interruptedAttempts += 1;
        const error = new Error(options.interruptMessage || `fictional page ${page} interruption`);
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

    if (input.endpoint === 'projects.list') {
      if (options.projectFailure) {
        const error = new Error('fictional PGY project task metadata failure');
        error.retryable = false;
        throw error;
      }
      return {
        data: {
          list: [{
            projectId: options.unmatchedProject
              ? 'fictional-pgy-project-unmatched'
              : 'fictional-pgy-project-001',
            projectName: '虚构蒲公英跨域项目',
            taobaoBriefId: 'fictional-pgy-brief-001',
            taobaoBriefEndTime: '20300131',
          }],
          pageNum: 1,
          pageSize: 30,
          total: 1,
          totalPage: 1,
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
  input.spuId = 'fictional-spu-001';
  input.spuName = '虚构 SPU 一';
  input.thirdProjectName = '虚构跨域项目一';
  input.starData = {
    ...input.starData,
    dataTransRatio: 0.25,
    intoStoreUv: 40,
    intoStoreCost: 27.5,
    taobaoDealUv: 8,
    taobaoAddCartUv: 12,
    taobaoAddCartRatio: 0.24,
    taobaoDealRatio: 0.16,
  };
  const normalized = normalizePgyNote(input);

  assert.equal(normalized.noteId, 'fictional-note-001');
  assert.equal(normalized.sourceKey, 'fictional-cooperation-001');
  assert.equal(normalized.title, '虚构笔记一');
  assert.equal(normalized.noteUrl, 'https://www.xiaohongshu.com/explore/fictional-note-001');
  assert.equal(normalized.publishDate, '2030-01-02');
  assert.equal(normalized.taobaoTaskId, 'fictional-taobao-task-001');
  assert.equal(normalized.taskEndDate, '2030-01-31');
  assert.equal(normalized.spuName, '虚构 SPU 一');
  assert.equal(normalized.crossDomainProjectName, '虚构跨域项目一');
  assert.equal(normalized.taobaoSamplingRatio, 0.25);
  assert.deepEqual(normalized.spus, [{ id: 'fictional-spu-001', name: '虚构 SPU 一' }]);
  assert.deepEqual(normalized.author, {
    id: 'fictional-creator-001',
    name: '虚构达人一',
    followerCount: 4999,
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
    taobaoOffsiteActiveUv15d: 40,
    taobaoOffsiteActiveCost15d: 27.5,
    taobaoDealUv15d: 8,
    taobaoAddCartUv15d: 12,
    taobaoAddCartRate15d: 0.24,
    taobaoPurchaseRate15d: 0.16,
  });
  assert.deepEqual(Object.keys(normalized).sort(), [
    'author', 'costs', 'crossDomainProjectId', 'crossDomainProjectName', 'metrics', 'noteId', 'noteUrl', 'publishDate',
    'sourceKey', 'spuName', 'spus', 'taobaoSamplingRatio', 'taobaoTaskId', 'taskEndDate', 'title',
  ]);

  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(
    serialized,
    /fictional-xsec|fictional-signature|fictional-row-token|xsec_token|sign=|fictional-raw-business-payload|fictional-unused-decoration/
  );
});

test('backfills note task end dates from the PGY cross-domain project task fields', () => {
  const notes = [normalizePgyNote({
    noteId: 'fictional-pgy-project-note-001',
    thirdProjectId: 'fictional-pgy-project-001',
    starData: { thirdBriefId: 'fictional-taobao-task-001' },
    thirdBriefEndTime: null,
  })];
  const projects = [normalizePgyProject({
    projectId: 'fictional-pgy-project-001',
    projectName: '虚构蒲公英跨域项目',
    taobaoBriefId: 'fictional-pgy-brief-001',
    taobaoBriefEndTime: '20300131',
  })];

  const result = applyPgyTaskEndDates(notes, projects);

  assert.equal(result.notes[0].taskEndDate, '2030-01-31');
  assert.equal(result.coverage.taskNoteCount, 1);
  assert.equal(result.coverage.matchedTaskEndCount, 1);
  assert.equal(result.coverage.missingTaskEndCount, 0);
  assert.equal(result.coverage.projectCount, 1);
});

test('uses only the official direct spuName field for the canonical PGY SPU filter', () => {
  const normalized = normalizePgyNote({
    noteId: 'fictional-direct-spu-name-note',
    spuName: '虚构官方 SPU 名称',
    spuInfo: { spuId: 'fictional-nested-spu', spuName: '不应作为筛选口径的嵌套名称' },
  });

  assert.equal(normalized.spuName, '虚构官方 SPU 名称');
});

test('normalizes PGY SPU list aliases and drops display placeholders', () => {
  const normalized = normalizePgyNote({
    noteId: 'fictional-spu-list-note',
    spuList: [
      { id: 'fictional-spu-a', name: '虚构 SPU A' },
      { id: 'fictional-spu-a', name: '虚构 SPU A' },
      { spuId: '-', spuName: '--' },
      { spuId: 'fictional-spu-b', spuName: '虚构 SPU B' },
    ],
  });

  assert.deepEqual(normalized.spus, [
    { id: 'fictional-spu-a', name: '虚构 SPU A' },
    { id: 'fictional-spu-b', name: '虚构 SPU B' },
  ]);
});

test('falls back to totalConsume minus refundAmount when actualConsume is missing', () => {
  const normalized = normalizePgyNote(clone(FICTIONAL_NOTES[1]));
  assert.deepEqual(normalized.costs, {
    cooperation: 200,
    platformFee: 20,
    total: 220,
  });
});

test('treats the official missing-task display marker as no Taobao task identity', () => {
  const normalized = normalizePgyNote({
    noteId: 'fictional-note-no-taobao-task',
    thirdBriefId: ' - ',
    thirdBriefEndTime: '-',
  });

  assert.equal(normalized.taobaoTaskId, null);
  assert.equal(normalized.taskEndDate, null);
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

test('collects identity, sum, and every list page without applying the task date range upstream', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions());

  assert.equal(result.platform, 'pgy');
  assert.equal(result.status, 'complete');
  assert.equal(result.schemaValid, true);
  assert.equal(result.empty, false);
  assert.equal(result.dateBasis, 'note_publish_time');
  assert.deepEqual(
    result.dateRange,
    DATE_RANGE,
    'the original task range remains metadata for downstream cross-platform analysis'
  );
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
    assert.equal(call.payload.startTime, '', 'notes.list must request all available publication dates');
    assert.equal(call.payload.endTime, '', 'notes.list must request all available publication dates');
    assert.equal(call.payload.pageSize, 2);
    assert.deepEqual(call.payload.brandUserIds, ['fictional-brand-user-001']);
  }
  const sumCall = pageClient.calls.find((call) => call.endpoint === 'notes.sum');
  assert.equal(sumCall.payload.startTime, '', 'notes.sum must cover the same all-history scope');
  assert.equal(sumCall.payload.endTime, '', 'notes.sum must cover the same all-history scope');
  const projectCalls = pageClient.calls.filter((call) => call.endpoint === 'projects.list');
  assert.deepEqual(projectCalls.map((call) => call.payload.pageNum), [1]);
  assert.equal(result.taskDateCoverage.source, 'pgy_cross_domain_project');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /fictional-xsec|fictional-signature|fictional-row-token|xsec_token|sign=/
  );
});

test('labels the completed collection as an all-available snapshot with auditable time evidence', async () => {
  const result = await createCollector(createFakePageClient())
    .collect(collectionOptions('fictional-pgy-run-all-available'));

  assert.equal(result.collectionScope, 'all_available');
  assert.equal(result.latestPublishDate, '2030-01-07');
  assert.equal(result.finishedAt, '2030-02-01T00:00:00.000Z');
});

test('marks PGY partial instead of reporting zero overdue when task metadata cannot be collected', async () => {
  const result = await createCollector(createFakePageClient({
    projectFailure: true,
    missingDirectTaskEnd: true,
  })).collect(collectionOptions('fictional-pgy-run-task-metadata-failed'));

  assert.equal(result.status, 'partial');
  assert.equal(result.paginationComplete, false);
  assert.equal(result.taskDateCoverage.taskNoteCount, 1);
  assert.equal(result.taskDateCoverage.matchedTaskEndCount, 0);
  assert.equal(result.taskDateCoverage.missingTaskEndCount, 1);
  assert.ok(result.errors.some((error) => error.code === 'pgy_task_metadata_incomplete'));
});

test('marks PGY partial when complete project pagination still cannot resolve a task end date', async () => {
  const result = await createCollector(createFakePageClient({
    unmatchedProject: true,
    missingDirectTaskEnd: true,
  })).collect(collectionOptions('fictional-pgy-run-task-date-unmatched'));

  assert.equal(result.status, 'partial');
  assert.equal(result.paginationComplete, true);
  assert.equal(result.taskDateCoverage.missingTaskEndCount, 1);
  assert.ok(result.errors.some((error) => (
    error.code === 'pgy_task_end_date_missing' && error.count === 1
  )));
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

test('resumes from the committed PGY page after a transient searchContentNote interruption', async () => {
  const pageClient = createFakePageClient({
    interruptPage: 2,
    interruptAttempts: 1,
    interruptMessage: 'searchContentNote error: fictional transient gateway failure',
  });
  const result = await createPgyCollector({
    pageClient,
    cache: createMemoryCache(),
    now: () => '2030-02-01T00:00:00.000Z',
    paginationResumeBaseDelayMs: 0,
  }).collect(collectionOptions('fictional-pgy-run-resumed'));

  assert.equal(result.status, 'complete');
  assert.equal(result.paginationComplete, true);
  assert.equal(result.receivedCount, 3);
  assert.equal(result.paginationResumeCount, 1);
  assert.ok(result.warnings.some((warning) => warning.code === 'pagination_resumed'));
  assert.deepEqual(
    pageClient.calls.filter((call) => call.endpoint === 'notes.list')
      .map((call) => Number(call.payload.pageNum || call.payload.page)),
    [1, 2, 2],
    'the second attempt must resume at page 2 instead of restarting page 1'
  );
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
