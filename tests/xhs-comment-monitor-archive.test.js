const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../xhs/comment-monitor');

function allKeys(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((item) => allKeys(item, output));
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    output.push(key);
    allKeys(item, output);
  }
  return output;
}

test('archive projection is deidentified, bounded, and keeps only safe aggregate evidence', () => {
  const categoryFixtures = Object.fromEntries(Object.keys(model.TOPIC_LABELS).map((categoryId) => [
    categoryId,
    {
      label: '不可信标签',
      count: 8,
      evidence: Array.from({ length: 5 }, (_, index) => ({
        accountKey: 'account-secret',
        noteId: `note-${categoryId}-${index}`,
        commentId: `comment-${categoryId}-${index}`,
        excerpt: `联系 buyer@example.com 或 13800138000，微信 wechat:secret_${index} ${'证'.repeat(220)}`,
        author: { nickname: '小王' },
        ipLocation: '上海',
        raw: '原始评论',
      })),
    },
  ]));
  categoryFixtures.injected = {
    count: 999,
    evidence: [{ excerpt: '不应归档', userId: 'user-secret' }],
  };
  const metric = {
    noteId: 'note-safe',
    title: '联系 13800138000 咨询这篇笔记',
    publishedAt: '2030-01-01T01:00:00.000Z',
    platformUpdatedAt: '2030-01-02T01:00:00.000Z',
    lastCommentCheckedAt: '2030-01-03T01:00:00.000Z',
    impressionCount: 1000,
    commentCount: 8,
    interactionCount: 50,
    readCount: 300,
    likeCount: 30,
    collectCount: 10,
    shareCount: 2,
    commentDelta: 3,
    nonCommentInteractionDelta: 4,
    readDelta: 80,
    discovery: 'new_note',
    heatPinned: true,
    heatTop20: true,
    heatScore: 0.95,
    heatPercentiles: { comments: 1, nonCommentInteractions: 0.8, reads: 0.7, injected: 1 },
    corrections: ['commentCount', 'accountKey'],
    missingMetrics: ['readCount', 'raw'],
    reasons: ['new_note', 'comment_growth', 'arbitrary'],
    captureStatus: 'continuation',
    capturedCount: 500,
    accountKey: 'account-secret',
    brandUserId: 'brand-user-secret',
    officialUrl: 'https://www.xiaohongshu.com/explore/note-safe?xsec_token=secret',
    orderIds: ['order-secret'],
    author: { userId: 'user-secret' },
    ipLocation: '上海',
    raw: { content: '原文' },
    page: 3,
    cursor: 'cursor-secret',
    checkpoint: { cursor: 'checkpoint-secret' },
    cache: { key: 'cache-secret' },
  };
  const noteState = {
    noteId: 'note-safe',
    title: '评论抓取状态',
    status: 'continuation',
    capturedCount: 500,
    updatedAt: '2030-01-03T01:00:00.000Z',
    officialUrl: 'https://www.xiaohongshu.com/explore/note-safe?xsec_token=secret',
    accountKey: 'account-secret',
    checkpoint: { cursor: 'checkpoint-secret' },
  };
  const summary = {
    schema: 'hostile-schema',
    schemaVersion: 999,
    accountKey: 'account-secret',
    brandUserId: 'brand-user-secret',
    generatedAt: '2030-01-03T01:00:00.000Z',
    platformUpdatedAt: '2030-01-03T00:55:00.000Z',
    interval: {
      from: '2030-01-02T01:00:00.000Z',
      to: '2030-01-03T01:00:00.000Z',
      days: 1,
      missedDays: 0,
      dailyAttribution: true,
      label: '不可信文案 13800138000',
      cursor: 'cursor-secret',
    },
    commentCount: 24,
    classifiedCommentCount: 20,
    unclassifiedCommentCount: 4,
    categories: categoryFixtures,
    noteMetrics: Array.from({ length: 2005 }, (_, index) => (
      index === 0 ? metric : { noteId: `metric-${index}`, readCount: index }
    )),
    noteStates: Array.from({ length: 2005 }, (_, index) => (
      index === 0 ? noteState : { noteId: `state-${index}`, status: 'baseline' }
    )),
    semantic: {
      schema: 'xhsCommentSemanticBatchResponseV1',
      schemaVersion: 1,
      status: 'completed',
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'comment-monitor-v1',
      taxonomyVersion: 'comment-topics-v1',
      requestId: 'request-secret',
      items: [
        {
          itemId: 'comment-1',
          status: 'classified',
          retryable: false,
          categoryIds: ['purchase_motivation', 'price_promotion'],
          sentiment: 'positive',
          purchaseIntent: true,
          unresolvedQuestion: false,
          rationale: '包含个人信息 13800138000',
        },
        {
          itemId: 'comment-2',
          status: 'classified',
          retryable: false,
          categoryIds: ['complaint_risk'],
          sentiment: 'negative',
          purchaseIntent: false,
          unresolvedQuestion: true,
          rationale: '不应保留',
        },
        {
          itemId: 'comment-3',
          status: 'abstained',
          retryable: true,
          categoryIds: ['other'],
          sentiment: 'neutral',
          purchaseIntent: false,
          unresolvedQuestion: false,
          rationale: '不应保留',
        },
      ],
    },
    raw: [{ content: '完整原文' }],
    page: 9,
    cursor: 'root-cursor-secret',
    checkpoint: { subCursors: { c1: 'secret' } },
    cache: { key: 'secret' },
  };

  const safe = model.sanitizeCommentInsightSummaryForArchive(summary, {
    accountRef: 'sha256-account-reference',
    bindingSourceRunId: 'store-run-source-1',
    brandUserId: 'context-brand-user-secret',
  });

  assert.equal(safe.schema, 'CommentInsightSummaryV1');
  assert.equal(safe.schemaVersion, 1);
  assert.equal(safe.accountRef, 'sha256-account-reference');
  assert.equal(safe.bindingSourceRunId, 'store-run-source-1');
  assert.equal(safe.noteMetrics.length, 2000);
  assert.equal(safe.noteStates.length, 2000);
  assert.equal(safe.interval.label, '本次更新增量');
  assert.deepEqual(Object.keys(safe.noteMetrics[0]).sort(), [
    'captureStatus', 'capturedCount', 'collectCount', 'commentCount', 'commentDelta',
    'corrections', 'discovery', 'heatPercentiles', 'heatPinned', 'heatScore',
    'heatTop20', 'impressionCount', 'interactionCount', 'lastCommentCheckedAt',
    'likeCount', 'missingMetrics', 'nonCommentInteractionDelta', 'noteId',
    'platformUpdatedAt', 'publishedAt', 'readCount', 'readDelta', 'reasons',
    'shareCount', 'title',
  ].sort());
  assert.deepEqual(safe.noteStates[0], {
    noteId: 'note-safe',
    title: '评论抓取状态',
    status: 'continuation',
    capturedCount: 500,
    updatedAt: '2030-01-03T01:00:00.000Z',
  });
  assert.match(safe.noteMetrics[0].title, /\[手机号\]/u);

  const evidence = Object.values(safe.categories).flatMap((category) => category.evidence);
  assert.equal(evidence.length, 24);
  assert.ok(Object.values(safe.categories).every((category) => category.evidence.length <= 3));
  assert.ok(evidence.every((item) => Array.from(item.excerpt).length <= 160));
  assert.equal(Object.hasOwn(safe.categories, 'injected'), false);

  assert.equal(safe.semantic.itemCount, 3);
  assert.equal(safe.semantic.classifiedCount, 2);
  assert.equal(safe.semantic.abstainedCount, 1);
  assert.equal(safe.semantic.retryableCount, 1);
  assert.equal(safe.semantic.purchaseIntentCount, 1);
  assert.equal(safe.semantic.unresolvedQuestionCount, 1);
  assert.deepEqual(safe.semantic.sentimentCounts, { positive: 1, neutral: 1, negative: 1 });
  assert.equal(safe.semantic.categoryCounts.purchase_motivation, 1);
  assert.equal(safe.semantic.categoryCounts.price_promotion, 1);
  assert.equal(safe.semantic.categoryCounts.complaint_risk, 1);
  assert.equal(Object.hasOwn(safe.semantic, 'items'), false);

  const forbiddenKeys = new Set([
    'accountKey', 'brandUserId', 'author', 'user', 'userId', 'ip', 'ipLocation',
    'raw', 'page', 'cursor', 'checkpoint', 'cache', 'orderIds', 'officialUrl',
    'requestId', 'itemId', 'rationale',
  ]);
  assert.deepEqual(allKeys(safe).filter((key) => forbiddenKeys.has(key)), []);
  const json = JSON.stringify(safe);
  assert.doesNotMatch(json, /account-secret|brand-user-secret|user-secret|order-secret|cursor-secret/u);
  assert.doesNotMatch(json, /13800138000|buyer@example\.com|secret_\d/u);
  assert.ok(Buffer.byteLength(json, 'utf8') <= 2 * 1024 * 1024);
});

test('archive projection rejects a projected payload over the 2MB safety limit', () => {
  const largeTitle = '测'.repeat(700);
  const summary = {
    generatedAt: '2030-01-03T01:00:00.000Z',
    categories: {},
    noteMetrics: Array.from({ length: 2000 }, (_, index) => ({
      noteId: `metric-${index}`,
      title: largeTitle,
      readCount: index,
    })),
    noteStates: Array.from({ length: 2000 }, (_, index) => ({
      noteId: `state-${index}`,
      title: largeTitle,
      status: 'baseline',
    })),
  };

  assert.throws(
    () => model.sanitizeCommentInsightSummaryForArchive(summary),
    (error) => error && error.code === 'COMMENT_SUMMARY_ARCHIVE_TOO_LARGE',
  );
});
