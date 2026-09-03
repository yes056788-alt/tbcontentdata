const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

let monitor;
let loadError;
try {
  monitor = require('../xhs/comment-monitor');
} catch (error) {
  loadError = error;
}

function api() {
  if (loadError) {
    assert.fail(`xhs/comment-monitor.js must expose the comment monitoring API: ${loadError.message}`);
  }
  return monitor;
}

function note(overrides = {}) {
  return {
    noteId: 'note-default',
    title: '默认笔记',
    publishedAt: '2030-03-20T00:00:00.000Z',
    platformUpdatedAt: '2030-04-01T01:00:00.000Z',
    commentCount: 10,
    interactionCount: 100,
    readCount: 1000,
    likeCount: 70,
    collectCount: 20,
    shareCount: 10,
    ...overrides,
  };
}

test('loads as a browser UMD global without CommonJS', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'xhs', 'comment-monitor.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);

  assert.equal(typeof context.XhsCommentMonitor.computeSnapshotDelta, 'function');
  assert.equal(typeof context.XhsCommentMonitor.summarizeCommentInsights, 'function');
  assert.equal(Object.isFrozen(context.XhsCommentMonitor), true);
});

test('exposes stable V1/V2 data contracts and normalizes the 09:00 monitor profile default', () => {
  const result = api().normalizeMonitorProfile({
    accountKey: ' account-a ',
    dailyTime: 'not-a-time',
    enabled: true,
  });

  assert.equal(api().SCHEMAS.profile, 'CommentMonitorProfileV1');
  assert.equal(api().SCHEMAS.metricSnapshot, 'PgyNoteMetricSnapshotV2');
  assert.equal(api().SCHEMAS.run, 'CommentMonitorRunV1');
  assert.equal(api().SCHEMAS.checkpoint, 'CommentCaptureCheckpointV1');
  assert.equal(api().SCHEMAS.insight, 'CommentInsightSummaryV1');
  assert.deepEqual(result, {
    schema: 'CommentMonitorProfileV1',
    schemaVersion: 1,
    accountKey: 'account-a',
    storeId: '',
    storeName: '',
    enabled: true,
    dailyTime: '09:00',
    timezone: 'Asia/Shanghai',
    recentLookbackDays: 90,
    hotRatio: 0.2,
    historicalTopRatio: 0.1,
    perNoteLimit: 500,
    rawRetention: 'local_only',
  });
});

test('aggregates duplicate order rows by noteId and takes the maximum of every cumulative metric', () => {
  const rows = [
    note({
      noteId: 'note-a', orderId: 'order-1', commentCount: 10, interactionCount: 100,
      readCount: 1000, likeCount: 70, collectCount: 20, shareCount: 10,
      officialUrl: 'https://www.xiaohongshu.com/explore/note-a?xsec_token=first',
    }),
    note({
      noteId: 'note-a', orderId: 'order-2', commentCount: 12, interactionCount: 90,
      readCount: 1200, likeCount: 65, collectCount: 25, shareCount: 8,
      officialUrl: 'https://www.xiaohongshu.com/explore/note-a?xsec_token=second',
    }),
    note({ noteId: 'note-b', orderId: 'order-3', commentCount: 2 }),
  ];

  const aggregated = api().aggregateNoteRows(rows);
  const noteA = aggregated.find((item) => item.noteId === 'note-a');

  assert.equal(aggregated.length, 2);
  assert.deepEqual(noteA.orderIds, ['order-1', 'order-2']);
  assert.deepEqual({
    commentCount: noteA.commentCount,
    interactionCount: noteA.interactionCount,
    readCount: noteA.readCount,
    likeCount: noteA.likeCount,
    collectCount: noteA.collectCount,
    shareCount: noteA.shareCount,
  }, {
    commentCount: 12,
    interactionCount: 100,
    readCount: 1200,
    likeCount: 70,
    collectCount: 25,
    shareCount: 10,
  });
  assert.match(noteA.officialUrl, /xsec_token=second$/);
});

test('maps the real PGY inventory aliases before aggregation so daily metrics are not lost', () => {
  const aggregated = api().aggregateNoteRows([{
    noteId: 'note-real-shape',
    noteTitle: '真实蒲公英笔记',
    notePublishTime: '2030-03-30',
    impNum: '12,000',
    readNum: 3200,
    engageNum: 450,
    cmtNum: 32,
    likeNum: 300,
    favNum: 90,
    shareNum: 28,
  }]);

  assert.deepEqual(aggregated[0], {
    noteId: 'note-real-shape',
    orderIds: [],
    impressionCount: 12000,
    readCount: 3200,
    interactionCount: 450,
    commentCount: 32,
    likeCount: 300,
    collectCount: 90,
    shareCount: 28,
    title: '真实蒲公英笔记',
    publishedAt: '2030-03-30T00:00:00.000Z',
  });
});

test('computes adjacent-snapshot increments, records corrections, and uses interval wording after missed days', () => {
  const previous = api().createMetricSnapshot({
    accountKey: 'account-a',
    capturedAt: '2030-08-01T01:00:00.000Z',
    rows: [
      note({ noteId: 'growth', commentCount: 10, interactionCount: 100, readCount: 1000 }),
      note({ noteId: 'corrected', commentCount: 10, interactionCount: 50, readCount: 500 }),
    ],
  });
  const current = api().createMetricSnapshot({
    accountKey: 'account-a',
    capturedAt: '2030-08-04T01:00:00.000Z',
    rows: [
      note({ noteId: 'growth', commentCount: 13, interactionCount: 108, readCount: 1060 }),
      note({ noteId: 'corrected', commentCount: 8, interactionCount: 45, readCount: undefined }),
      note({
        noteId: 'fresh', publishedAt: '2030-08-01T00:00:00.000Z',
        platformUpdatedAt: '2030-08-04T00:00:00.000Z', commentCount: 1,
      }),
      note({
        noteId: 'backfill', publishedAt: '2030-06-01T00:00:00.000Z',
        platformUpdatedAt: '2030-08-04T00:00:00.000Z', commentCount: 30,
      }),
    ],
  });

  const delta = api().computeSnapshotDelta(previous, current);
  const growth = delta.notes.find((item) => item.noteId === 'growth');
  const corrected = delta.notes.find((item) => item.noteId === 'corrected');
  const fresh = delta.notes.find((item) => item.noteId === 'fresh');
  const backfill = delta.notes.find((item) => item.noteId === 'backfill');

  assert.deepEqual(delta.interval, {
    from: '2030-08-01T01:00:00.000Z',
    to: '2030-08-04T01:00:00.000Z',
    days: 3,
    missedDays: 2,
    dailyAttribution: false,
    label: '自上次成功以来增量',
  });
  assert.deepEqual({
    commentDelta: growth.commentDelta,
    nonCommentInteractionDelta: growth.nonCommentInteractionDelta,
    readDelta: growth.readDelta,
  }, { commentDelta: 3, nonCommentInteractionDelta: 5, readDelta: 60 });
  assert.equal(corrected.commentDelta, 0);
  assert.equal(corrected.nonCommentInteractionDelta, 0);
  assert.equal(corrected.readDelta, null);
  assert.deepEqual(corrected.corrections.sort(), ['commentCount', 'interactionCount']);
  assert.deepEqual(corrected.missingMetrics, ['readCount']);
  assert.equal(fresh.discovery, 'new_note');
  assert.equal(backfill.discovery, 'historical_backfill');
  assert.equal(fresh.commentDelta, null, 'a first observation must not fabricate a daily increment');
});

test('scores heat inside each account with 50/30/20 percentiles and marks only the highest quintile', () => {
  const scored = api().scoreNoteHeat([
    { accountKey: 'account-a', noteId: 'a', commentDelta: 0, nonCommentInteractionDelta: 0, readDelta: 40 },
    { accountKey: 'account-a', noteId: 'b', commentDelta: 1, nonCommentInteractionDelta: 2, readDelta: 30 },
    { accountKey: 'account-a', noteId: 'c', commentDelta: 2, nonCommentInteractionDelta: 4, readDelta: 20 },
    { accountKey: 'account-a', noteId: 'd', commentDelta: 3, nonCommentInteractionDelta: 6, readDelta: 10 },
    { accountKey: 'account-a', noteId: 'e', commentDelta: 4, nonCommentInteractionDelta: 8, readDelta: 0 },
  ]);

  assert.deepEqual(scored.map((item) => [item.noteId, item.heatScore]), [
    ['a', 0.2], ['b', 0.35], ['c', 0.5], ['d', 0.65], ['e', 0.8],
  ]);
  assert.deepEqual(scored.filter((item) => item.heatTop20).map((item) => item.noteId), ['e']);
});

test('initial monitoring includes all recent 90-day notes plus the union of historical comment and interaction top deciles', () => {
  const rows = [
    note({ noteId: 'recent-a', publishedAt: '2030-03-10T00:00:00.000Z' }),
    note({ noteId: 'recent-b', publishedAt: '2030-01-10T00:00:00.000Z' }),
  ];
  for (let index = 0; index < 10; index += 1) {
    rows.push(note({
      noteId: `history-${index}`,
      publishedAt: '2029-01-01T00:00:00.000Z',
      commentCount: index === 9 ? 999 : index,
      interactionCount: index === 8 ? 8888 : index,
    }));
  }

  const selected = api().selectInitialCandidates(rows, {
    asOf: '2030-04-01T00:00:00.000Z',
    recentLookbackDays: 90,
    historicalTopRatio: 0.1,
  });

  assert.deepEqual(selected.map((item) => item.noteId).sort(), [
    'history-8', 'history-9', 'recent-a', 'recent-b',
  ]);
  assert.deepEqual(
    selected.find((item) => item.noteId === 'history-8').reasons,
    ['historical_interaction_top_10pct'],
  );
});

test('refresh candidates cover new notes, comment growth, due hot notes, missing metrics and platform corrections', () => {
  const selected = api().selectRefreshCandidates([
    { noteId: 'new', discovery: 'new_note', commentDelta: null, heatTop20: false },
    { noteId: 'commented', discovery: 'existing', commentDelta: 2, heatTop20: false },
    {
      noteId: 'hot-due', discovery: 'existing', commentDelta: 0, heatTop20: true,
      lastCommentCheckedAt: '2030-04-01T00:00:00.000Z',
    },
    {
      noteId: 'hot-not-due', discovery: 'existing', commentDelta: 0, heatTop20: true,
      lastCommentCheckedAt: '2030-04-02T18:00:00.000Z',
    },
    { noteId: 'missing', discovery: 'existing', commentDelta: 0, missingMetrics: ['readCount'] },
    { noteId: 'corrected', discovery: 'existing', commentDelta: 0, corrections: ['commentCount'] },
    { noteId: 'cold', discovery: 'existing', commentDelta: 0, heatTop20: false },
  ], {
    asOf: '2030-04-03T00:00:00.000Z',
    hotReviewAfterHours: 24,
  });

  assert.deepEqual(selected.map((item) => item.noteId), [
    'new', 'commented', 'hot-due', 'missing', 'corrected',
  ]);
  assert.deepEqual(selected.find((item) => item.noteId === 'new').reasons, ['new_note']);
  assert.deepEqual(selected.find((item) => item.noteId === 'missing').reasons, ['metric_missing']);
  assert.deepEqual(selected.find((item) => item.noteId === 'corrected').reasons, ['platform_correction']);
});

test('builds a 500-comment per-note round-robin plan without starving later candidates', () => {
  const tasks = api().buildRoundRobinQueue([
    { noteId: 'a', remainingCount: 1200, checkpoint: { rootCursor: 'a-start' } },
    { noteId: 'b', remainingCount: 600, checkpoint: { rootCursor: 'b-start' } },
    { noteId: 'c', remainingCount: 100, checkpoint: { rootCursor: 'c-start' } },
  ], { perNoteLimit: 500 });

  assert.deepEqual(tasks.map((task) => task.noteId), ['a', 'b', 'c', 'a', 'b', 'a']);
  assert.deepEqual(tasks.map((task) => task.limit), [500, 500, 500, 500, 500, 500],
    'the API page limit stays at 500 even when the platform cumulative count is stale or smaller');
  assert.deepEqual(tasks.map((task) => task.plannedCount), [500, 500, 100, 500, 100, 200]);
  assert.ok(tasks.every((task) => task.limit <= 500));
  assert.deepEqual(tasks[0].checkpoint, { rootCursor: 'a-start' });
  assert.equal(tasks[0].requiresCheckpoint, true);
});

test('normalizes comments, strips identity and inline PII before analysis, and classifies the eight rule topics', () => {
  const normalized = api().normalizeComment({
    id: 'comment-1',
    content: '想买，加我手机 13800138000，邮箱 buyer@example.com',
    like_count: '7',
    ip_location: '上海',
    create_time: 1900000000,
    user_info: { user_id: 'user-secret', nickname: '小红薯用户', image: 'https://img.example/a.jpg' },
  }, { accountKey: 'account-a', noteId: 'note-a' });
  const safe = api().sanitizeCommentForAnalysis(normalized);

  assert.equal(normalized.commentId, 'comment-1');
  assert.equal(normalized.likeCount, 7);
  assert.equal(normalized.author.nickname, '小红薯用户');
  assert.equal(Object.hasOwn(safe, 'author'), false);
  assert.equal(Object.hasOwn(safe, 'ipLocation'), false);
  assert.doesNotMatch(safe.content, /13800138000|buyer@example\.com|user-secret|小红薯用户/);
  assert.match(safe.content, /\[手机号\]|\[邮箱\]/);

  const fixtures = [
    ['看完已经种草，准备下单', 'purchase_motivation'],
    ['用了一个月，效果和质感都不错', 'product_experience'],
    ['多少钱，双十一有优惠券吗', 'price_promotion'],
    ['这个型号适合120斤的人吗', 'fit_compatibility'],
    ['每天怎么用，需要清洗吗', 'usage_guidance'],
    ['和其他牌子对比哪个更好', 'competitor_comparison'],
    ['物流太慢了，退货客服没人理', 'shipping_after_sales'],
    ['收到就是破损的，太失望了要投诉', 'complaint_risk'],
  ];
  for (const [content, category] of fixtures) {
    assert.ok(api().classifyCommentRules({ content }).categories.includes(category), content);
  }
});

test('summarizes de-duplicated comments with traceable, PII-safe evidence references', () => {
  const comments = [
    { id: 'c1', content: '已经种草想下单，手机13800138000', user_info: { nickname: '小王' } },
    { id: 'c1', content: '已经种草想下单，手机13800138000', user_info: { nickname: '小王' } },
    { id: 'c2', content: '尺寸适合小户型吗' },
    { id: 'c3', content: '破损了，退货客服也不处理，我要投诉' },
  ];

  const summary = api().summarizeCommentInsights(comments, {
    accountKey: 'account-a',
    noteId: 'note-a',
    generatedAt: '2030-04-01T01:00:00.000Z',
    evidenceLimit: 2,
  });

  assert.equal(summary.schema, 'CommentInsightSummaryV1');
  assert.equal(summary.commentCount, 3);
  assert.equal(summary.categories.purchase_motivation.count, 1);
  assert.equal(summary.categories.fit_compatibility.count, 1);
  assert.equal(summary.categories.complaint_risk.count, 1);
  assert.deepEqual(summary.categories.purchase_motivation.evidence[0], {
    accountKey: 'account-a',
    noteId: 'note-a',
    commentId: 'c1',
    excerpt: '已经种草想下单,手机[手机号]',
  });
  assert.doesNotMatch(JSON.stringify(summary), /13800138000|小王/);
});
