const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateResponseEnvelope,
} = require('../xhs/contract');
const {
  derivePlatformStatus,
  evaluateDecisionReadiness,
} = require('../xhs/quality');

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});

function completePlatform(platform) {
  return derivePlatformStatus({
    platform,
    accountKey: `fictional-${platform}-account`,
    dateRange: RANGE,
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    receivedCount: 2,
    truncation: {},
    nested: [],
    errors: [],
  });
}

test('validates the paginated response envelope used by each XHS platform', () => {
  const fixtures = [
    {
      platform: 'pgy',
      dataset: 'notes',
      response: {
        data: {
          list: [{ noteId: 'fictional-pgy-note-001' }],
          pageNum: 1,
          pageSize: 20,
          total: 1,
          totalPage: 1,
        },
      },
    },
    {
      platform: 'juguang',
      dataset: 'notes',
      response: {
        data: {
          dataList: [{ noteId: 'fictional-juguang-note-001' }],
          page: {
            pageNum: 1,
            pageSize: 20,
            totalCount: 1,
            totalPage: 1,
          },
        },
      },
    },
    {
      platform: 'adstar',
      dataset: 'orders',
      response: {
        model: {
          result: [{ orderId: 'fictional-order-001' }],
          pageNo: 1,
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
          hasNext: false,
        },
      },
    },
  ];

  for (const fixture of fixtures) {
    const result = validateResponseEnvelope(fixture);
    assert.equal(result.valid, true, `${fixture.platform} fixture should be valid`);
    assert.deepEqual(result.issues, []);
  }
});

test('rejects structure drift instead of treating missing list or page fields as an empty success', () => {
  const malformed = [
    {
      platform: 'pgy',
      dataset: 'notes',
      response: { data: { total: 0, totalPage: 0, pageSize: 20 } },
      expectedIssue: 'list',
    },
    {
      platform: 'juguang',
      dataset: 'notes',
      response: { data: { dataList: [] } },
      expectedIssue: 'page',
    },
    {
      platform: 'adstar',
      dataset: 'orders',
      response: { data: { result: [] } },
      expectedIssue: 'model',
    },
  ];

  for (const fixture of malformed) {
    const result = validateResponseEnvelope(fixture);
    assert.equal(result.valid, false, `${fixture.platform} drift must be rejected`);
    assert.match(
      result.issues.map((issue) => issue.path || issue.code || issue.message).join(' '),
      new RegExp(fixture.expectedIssue, 'i')
    );
  }
});

test('derives complete, partial, failed, and verified_no_spend states from collection evidence', () => {
  assert.equal(completePlatform('pgy').status, 'complete');

  const partial = derivePlatformStatus({
    platform: 'juguang',
    accountKey: 'fictional-juguang-account',
    dateRange: RANGE,
    schemaValid: true,
    paginationComplete: false,
    reconciled: false,
    receivedCount: 3,
    truncation: {},
    nested: [],
    errors: [{ code: 'fictional_page_interruption', message: '虚构分页中断' }],
  });
  assert.equal(partial.status, 'partial');

  const failed = derivePlatformStatus({
    platform: 'pgy',
    accountKey: 'fictional-pgy-account',
    dateRange: RANGE,
    schemaValid: false,
    paginationComplete: false,
    reconciled: false,
    receivedCount: 0,
    truncation: {},
    nested: [],
    errors: [{ code: 'fictional_schema_drift', message: '虚构结构漂移' }],
  });
  assert.equal(failed.status, 'failed');

  const noSpend = derivePlatformStatus({
    platform: 'juguang',
    accountKey: 'fictional-zero-spend-account',
    dateRange: RANGE,
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    receivedCount: 0,
    zeroSpendVerified: true,
    truncation: {},
    nested: [],
    errors: [],
  });
  assert.equal(noSpend.status, 'verified_no_spend');
});

test('marks every artificial maxPages, maxOrders, or maxProjects truncation as partial', () => {
  for (const limit of ['maxPages', 'maxOrders', 'maxProjects']) {
    const result = derivePlatformStatus({
      platform: 'adstar',
      accountKey: 'fictional-adstar-account',
      dateRange: RANGE,
      schemaValid: true,
      paginationComplete: true,
      reconciled: true,
      receivedCount: 5,
      truncation: { [limit]: true },
      nested: [],
      errors: [],
    });

    assert.equal(result.status, 'partial', `${limit} truncation must be partial`);
    assert.equal(result.truncated, true);
    assert.ok(result.warnings.some((warning) => (
      warning.code === `truncated_${limit}` || warning.limit === limit
    )));
  }
});

test('marks adstar partial when any required nested project or order unit fails', () => {
  const result = derivePlatformStatus({
    platform: 'adstar',
    accountKey: 'fictional-adstar-account',
    dateRange: RANGE,
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    receivedCount: 6,
    truncation: {},
    nested: [
      { type: 'project', id: 'fictional-project-001', status: 'complete' },
      { type: 'order', id: 'fictional-order-001', status: 'failed' },
    ],
    errors: [],
  });

  assert.equal(result.status, 'partial');
  assert.ok(result.errors.some((error) => (
    error.code === 'nested_unit_incomplete' && error.unitId === 'fictional-order-001'
  )));
});

test('sets decisionReady only when all three required platforms are complete', () => {
  const complete = evaluateDecisionReadiness({
    pgy: completePlatform('pgy'),
    juguang: completePlatform('juguang'),
    adstar: completePlatform('adstar'),
  });
  assert.equal(complete.decisionReady, true);
  assert.deepEqual(complete.issues, []);

  const withPartial = evaluateDecisionReadiness({
    pgy: completePlatform('pgy'),
    juguang: derivePlatformStatus({
      platform: 'juguang',
      accountKey: 'fictional-juguang-account',
      dateRange: RANGE,
      schemaValid: true,
      paginationComplete: false,
      reconciled: false,
      receivedCount: 1,
      truncation: { maxPages: true },
      nested: [],
      errors: [],
    }),
    adstar: completePlatform('adstar'),
  });
  assert.equal(withPartial.decisionReady, false);
  assert.ok(withPartial.issues.some((issue) => (
    issue.severity === 'critical' && issue.platform === 'juguang'
  )));

  const missingPlatform = evaluateDecisionReadiness({
    pgy: completePlatform('pgy'),
    adstar: completePlatform('adstar'),
  });
  assert.equal(missingPlatform.decisionReady, false);
  assert.ok(missingPlatform.issues.some((issue) => (
    issue.severity === 'critical' && issue.platform === 'juguang'
  )));
});

test('accepts a verified zero-spend platform as complete evidence for decision readiness', () => {
  const verifiedNoSpend = derivePlatformStatus({
    platform: 'juguang',
    accountKey: 'fictional-zero-spend-account',
    dateRange: RANGE,
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    receivedCount: 0,
    zeroSpendVerified: true,
    truncation: {},
    nested: [],
    errors: [],
  });

  const result = evaluateDecisionReadiness({
    pgy: completePlatform('pgy'),
    juguang: verifiedNoSpend,
    adstar: completePlatform('adstar'),
  });
  assert.equal(result.decisionReady, true);
  assert.deepEqual(result.issues, []);
});
