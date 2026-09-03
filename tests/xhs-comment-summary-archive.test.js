const assert = require('node:assert/strict');
const test = require('node:test');

const archiveApi = require('../xhs/comment-summary-archive');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function chromeFixture(initial = {}) {
  const values = clone(initial);
  return {
    storage: {
      local: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => Object.hasOwn(values, key))
            .map((key) => [key, clone(values[key])]));
        },
        async set(patch) { Object.assign(values, clone(patch)); },
      },
    },
    fixture: { values },
  };
}

function sourceRun(runId, storeId, accountKey, updatedAt = 1000) {
  return {
    schema: 2,
    runId,
    account: {
      id: `account-${storeId}`,
      name: `蒲公英 ${storeId}`,
      platform: 'xiaohongshu',
      storeId,
      storeName: `店铺 ${storeId}`,
      usernameMasked: '测**号',
    },
    updatedAt,
    snapshots: {
      xhsAnalysisSnapshotV1: {
        schema: 'xhsAnalysisSnapshotV1',
        storeId,
        accounts: { pgy: { accountKeys: [`pgy:${accountKey}`] } },
      },
    },
  };
}

function storageForRuns(runs) {
  return Object.assign({
    taobaoStoreRunIndexV1: runs.map((run) => ({ runId: run.runId, updatedAt: run.updatedAt })),
  }, Object.fromEntries(runs.map((run) => [`taobaoStoreRunV1:${run.runId}`, run])));
}

function service(chrome, capture = {}) {
  return archiveApi.createCommentSummaryArchiveService({
    chrome,
    model: {
      sanitizeCommentInsightSummaryForArchive(summary, context) {
        capture.summary = clone(summary);
        capture.context = clone(context);
        return {
          schema: 'CommentInsightSummaryV1',
          schemaVersion: 1,
          accountRef: context.accountRef,
          bindingSourceRunId: context.bindingSourceRunId,
          commentCount: Number(summary.commentCount) || 0,
        };
      },
    },
  });
}

test('binds a PGY brand identity to exactly one store and uses its freshest safe account', async () => {
  const older = sourceRun('store-run-source-old', 'store-a', 'brand-1', 1000);
  const newer = sourceRun('store-run-source-new', 'store-a', 'brand-1', 2000);
  newer.account.name = '最新蒲公英账号';
  const chrome = chromeFixture(storageForRuns([older, newer]));

  const binding = await service(chrome).resolveStoreBinding('brand-1');

  assert.equal(binding.status, 'bound');
  assert.equal(binding.storeId, 'store-a');
  assert.equal(binding.sourceRunId, 'store-run-source-new');
  assert.equal(binding.account.name, '最新蒲公英账号');
  assert.equal(JSON.stringify(binding.account).includes('brand-1'), false);
});

test('never guesses when the same PGY identity appears under different stores', async () => {
  const runs = [
    sourceRun('store-run-source-a', 'store-a', 'brand-1', 1000),
    sourceRun('store-run-source-b', 'store-b', 'brand-1', 2000),
  ];
  const chrome = chromeFixture(storageForRuns(runs));

  const result = await service(chrome).persist({ commentCount: 3 }, {
    accountKey: 'brand-1',
    run: { runId: 'comment-monitor-ambiguous', startedAt: 100, finishedAt: 200 },
    state: { status: 'completed' },
  });

  assert.deepEqual(result, { archived: false, reason: 'ambiguous', candidateStoreCount: 2 });
  assert.equal(Object.keys(chrome.fixture.values).some((key) => (
    key === 'taobaoStoreRunV1:store-run-comment-monitor-ambiguous'
  )), false);
});

test('archives one immutable deidentified comment run and keeps raw state out of project history', async () => {
  const source = sourceRun('store-run-source-a', 'store-a', 'brand-1', 1000);
  source.account.password = 'must-not-copy';
  const chrome = chromeFixture(storageForRuns([source]));
  const capture = {};
  const archive = service(chrome, capture);
  const input = { commentCount: 7, raw: [{ content: 'must-stay-local' }] };
  const context = {
    accountKey: 'brand-1',
    run: {
      runId: 'comment-monitor-run-1',
      startedAt: '2030-01-01T00:00:00.000Z',
      finishedAt: '2030-01-01T00:01:00.000Z',
    },
    state: { status: 'completed', failures: [] },
  };

  const first = await archive.persist(input, context);
  const second = await archive.persist({ commentCount: 99 }, context);
  const run = chrome.fixture.values['taobaoStoreRunV1:store-run-comment-monitor-run-1'];

  assert.equal(first.archived, true);
  assert.equal(second.idempotent, true);
  assert.equal(run.taskType, 'comment_monitor');
  assert.equal(run.status, 'success');
  assert.deepEqual(Object.keys(run.snapshots), ['xhsCommentInsightSummaryV1']);
  assert.equal(run.snapshots.xhsCommentInsightSummaryV1.commentCount, 7,
    'the same monitor run remains immutable');
  assert.match(run.snapshots.xhsCommentInsightSummaryV1.accountRef, /^[a-f0-9]{64}$/);
  assert.equal(run.snapshots.xhsCommentInsightSummaryV1.accountRef.includes('brand-1'), false);
  assert.equal(run.snapshots.xhsCommentInsightSummaryV1.bindingSourceRunId, 'store-run-source-a');
  assert.equal(JSON.stringify(run).includes('must-stay-local'), false);
  assert.equal(JSON.stringify(run).includes('must-not-copy'), false);
  assert.equal(chrome.fixture.values.taobaoStoreRunIndexV1[0].taskType, 'comment_monitor');
});

test('can bind the current XHS snapshot through the project directory before a history run exists', async () => {
  const chrome = chromeFixture({
    taobaoStoreRunIndexV1: [],
    xhsAnalysisSnapshotV1: {
      schema: 'xhsAnalysisSnapshotV1',
      runId: 'xhs-current-1',
      storeId: 'store-current',
      generatedAt: '2030-01-01T00:00:00.000Z',
      accounts: { pgy: { accountKeys: ['pgy:brand-current'] } },
    },
    taobaoProjectDirectoryV1: {
      stores: [{ id: 'store-current', name: '当前店铺', groupId: 'group-a' }],
      storeGroups: [{ id: 'group-a', name: '当前分组' }],
    },
  });

  const binding = await service(chrome).resolveStoreBinding('brand-current');

  assert.equal(binding.status, 'bound');
  assert.equal(binding.account.storeName, '当前店铺');
  assert.equal(binding.account.storeGroupName, '当前分组');
});

test('uses the explicitly selected project store without requiring a previous analysis run', async () => {
  const chrome = chromeFixture({
    taobaoStoreRunIndexV1: [],
    taobaoProjectDirectoryV1: {
      stores: [{ id: 'store-selected', name: '选中的店铺', groupId: 'group-a' }],
      storeGroups: [{ id: 'group-a', name: '品牌组' }],
    },
  });

  const result = await service(chrome).persist({ commentCount: 5 }, {
    accountKey: 'current-chrome-session',
    profile: { storeId: 'store-selected', storeName: '来自页面的名称' },
    run: { runId: 'comment-monitor-selected', startedAt: 100, finishedAt: 200 },
    state: { status: 'completed' },
  });
  const archived = chrome.fixture.values[
    'taobaoStoreRunV1:store-run-comment-monitor-selected'
  ];

  assert.equal(result.archived, true);
  assert.equal(result.storeId, 'store-selected');
  assert.equal(archived.account.storeName, '选中的店铺');
  assert.equal(archived.account.storeGroupName, '品牌组');
  assert.equal(archived.snapshots.xhsCommentInsightSummaryV1.bindingSourceRunId,
    'comment-monitor-store-selection');
});
