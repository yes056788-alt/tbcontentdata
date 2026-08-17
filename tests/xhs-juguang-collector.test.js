const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryCache } = require('../xhs/local-cache');
const {
  normalizeCurrentAccount,
  normalizeListedAccount,
  verifyAccount,
} = require('../xhs/juguang-accounts');
const {
  ATTRIBUTION,
  parseJuguangPage,
  normalizeReportRow,
  normalizeReportTotal,
  reconcileJuguangSpend,
  createJuguangCollector,
} = require('../xhs/juguang-collector');

const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-03',
  timezone: 'Asia/Shanghai',
});

const ACCOUNTS = Object.freeze([
  {
    vSellerId: 'fictional-main-vseller',
    name: '虚构聚光主账户',
    advertiserId: 1001,
    accountType: 4,
  },
  {
    vSellerId: 'fictional-child-spend',
    name: '虚构有消耗子账户',
    advertiserId: 2001,
    accountType: 602,
  },
  {
    vSellerId: 'fictional-child-zero',
    name: '虚构零消耗子账户',
    advertiserId: 2002,
    accountType: 602,
  },
]);

const ACCOUNT_DATA = Object.freeze({
  'fictional-main-vseller': {
    fee: 100,
    summary: [
      ['fictional-note-main-001', 40],
      ['fictional-note-main-002', 35],
      ['fictional-note-main-003', 25],
    ],
    daily: [
      ['2030-01-01', 'fictional-note-main-001', 4, 0, 30],
      ['2030-01-02', 'fictional-note-main-001', 13, 1, 10],
      ['2030-01-02', 'fictional-note-main-002', 4, 1, 35],
      ['2030-01-03', 'fictional-note-main-003', 13, 0, 25],
    ],
  },
  'fictional-child-spend': {
    fee: 200,
    summary: [
      ['fictional-note-child-001', 120],
      ['fictional-note-child-002', 80],
    ],
    daily: [
      ['2030-01-01', 'fictional-note-child-001', 4, 0, 70],
      ['2030-01-02', 'fictional-note-child-001', 13, 1, 50],
      ['2030-01-03', 'fictional-note-child-002', 13, 1, 80],
    ],
  },
  'fictional-child-zero': {
    fee: 0,
    summary: [],
    daily: [],
  },
});

function clone(value) {
  return structuredClone(value);
}

function reportRow(noteId, fee, dimensions = {}) {
  return {
    noteId,
    noteTitle: `虚构素材-${noteId}`,
    ...dimensions,
    dataValueJson: JSON.stringify({
      noteId,
      fee: String(fee),
      impression: String(fee * 100),
      click: String(fee * 10),
      externalRgmv15: String(fee * 3),
    }),
  };
}

function reportEnvelope(rows, page, pageSize, totalFee) {
  const totalPage = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  return {
    data: {
      dataList: rows.slice((page - 1) * pageSize, page * pageSize),
      page: {
        pageIndex: page,
        pageSize,
        totalCount: rows.length,
        totalPage,
      },
      totalData: {
        dataValueJson: JSON.stringify({ fee: String(totalFee) }),
      },
      unsupportedColumns: [],
    },
  };
}

function accountFromTarget(payload) {
  const target = payload.target || payload.account || payload;
  return ACCOUNTS.find((account) => (
    account.vSellerId === target.vSellerId ||
    Number(account.advertiserId) === Number(target.advertiserId)
  ));
}

function createFakePageClient(options = {}) {
  const calls = [];
  const events = [];
  let current = clone(options.initialAccount || ACCOUNTS[0]);
  let activeReports = 0;
  let maxActiveReports = 0;

  async function request(input) {
    calls.push({ ...clone(input), accountAtCall: current.vSellerId });
    assert.equal(input.platform, 'juguang');
    assert.equal(input.tabId, 81);

    if (input.endpoint === 'accounts.current') {
      events.push(`current:${current.vSellerId}`);
      return clone(options.mainIdentityWithoutVSeller && current.accountType === 4
        ? { ...current, vSellerId: null }
        : current);
    }

    if (input.endpoint === 'accounts.list') {
      events.push('list');
      const accounts = options.childListIsScoped && current.accountType === 602
        ? [current]
        : ACCOUNTS;
      return { accounts: clone(accounts), total: accounts.length };
    }

    if (input.endpoint === 'accounts.switch') {
      const target = accountFromTarget(input.payload || {});
      if (!target) throw new Error('fictional target account not found');
      events.push(`switch:${target.vSellerId}`);
      if (options.switchFailure === target.vSellerId) {
        const error = new Error(`fictional switch failure: ${target.vSellerId}`);
        error.retryable = false;
        throw error;
      }
      current = clone(target);
      if (options.identityMismatch === target.vSellerId) {
        current.advertiserId = 9999;
      }
      return { switched: true };
    }

    if (input.endpoint === 'reports.query') {
      const payload = input.payload || {};
      const originalAccount = ACCOUNTS.find((account) => (
        account.vSellerId === current.vSellerId
      ));
      const data = ACCOUNT_DATA[current.vSellerId];
      if (!originalAccount || !data) throw new Error('report requested for unverified fictional account');

      activeReports += 1;
      maxActiveReports = Math.max(maxActiveReports, activeReports);
      events.push(`report:${current.vSellerId}:${payload.dataSource}:${payload.timeUnit}`);
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const page = Number(payload.pageNum || payload.page || 1);
        const pageSize = Number(payload.pageSize || 2);

        if (
          options.interrupt &&
          options.interrupt.account === current.vSellerId &&
          options.interrupt.dataset === (payload.timeUnit === 'DAY' ? 'daily' : payload.dataSource) &&
          options.interrupt.page === page
        ) {
          const error = new Error(`fictional ${options.interrupt.dataset} page ${page} interruption`);
          error.retryable = false;
          throw error;
        }

        if (
          options.schemaDrift === current.vSellerId &&
          payload.dataSource === 'note' &&
          payload.timeUnit === 'SUMMARY'
        ) {
          return {
            data: {
              totalData: { dataValueJson: JSON.stringify({ fee: String(data.fee) }) },
            },
          };
        }

        if (payload.dataSource === 'account') {
          return reportEnvelope([
            { dataValueJson: JSON.stringify({ fee: String(data.fee) }) },
          ], 1, 1, data.fee);
        }

        if (payload.dataSource === 'note' && payload.timeUnit === 'SUMMARY') {
          const rows = data.summary.map(([noteId, fee]) => reportRow(noteId, fee));
          return reportEnvelope(rows, page, pageSize, data.fee);
        }

        if (payload.dataSource === 'note' && payload.timeUnit === 'DAY') {
          const rows = data.daily.map(([time, noteId, marketingTarget, deliveryMode, fee]) => (
            reportRow(noteId, fee, { time, marketingTarget, deliveryMode })
          ));
          return reportEnvelope(rows, page, pageSize, data.fee);
        }
      } finally {
        activeReports -= 1;
      }
    }

    throw new Error(`unexpected fictional endpoint: ${input.endpoint}`);
  }

  return {
    calls,
    events,
    request,
    getCurrent: () => clone(current),
    setCurrent: (account) => { current = clone(account); },
    getMaxActiveReports: () => maxActiveReports,
  };
}

function createReportMutationClient(dataset, targetAccount, mutateResponse) {
  const pageClient = createFakePageClient();
  const request = pageClient.request;
  pageClient.request = async (input) => {
    const accountAtCall = pageClient.getCurrent().vSellerId;
    const response = await request(input);
    const payload = input && input.payload || {};
    const actualDataset = payload.dataSource === 'account'
      ? 'account'
      : payload.timeUnit === 'DAY' ? 'daily' : 'summary';
    if (
      input.endpoint === 'reports.query' &&
      accountAtCall === targetAccount &&
      actualDataset === dataset
    ) {
      const changed = clone(response);
      mutateResponse(changed);
      return changed;
    }
    return response;
  };
  return pageClient;
}

function createCollector(pageClient, dependencies = {}) {
  return createJuguangCollector({
    pageClient,
    cache: createMemoryCache(),
    now: () => '2030-02-01T00:00:00.000Z',
    ...dependencies,
  });
}

function createRuntimeAccountDependencies(pageClient, options = {}) {
  const switches = [];
  const returns = [];
  return {
    switches,
    returns,
    dependencies: {
      async switchAccount(input) {
        const target = accountFromTarget(input && input.target || {});
        if (!target) throw new Error('fictional runtime target account not found');
        switches.push(clone(target));
        pageClient.events.push(`runtime-switch:${target.vSellerId}`);
        if (target.accountType === 4) {
          throw new Error('main account must use the injected returnToMainAccount DOM workflow');
        }
        pageClient.setCurrent(target);
      },
      async returnToMainAccount(input) {
        returns.push(clone(input));
        pageClient.events.push('return-main');
        if (options.returnFailure) throw new Error('fictional return-to-main failure');
        pageClient.setCurrent(ACCOUNTS[0]);
        return clone(ACCOUNTS[0]);
      },
    },
  };
}

function collectionOptions(overrides = {}) {
  return {
    tabId: 81,
    runId: overrides.runId || 'fictional-juguang-run-001',
    accountKey: 'fictional-juguang-account-group',
    dateRange: DATE_RANGE,
    pageSize: 2,
    maxPages: overrides.maxPages,
  };
}

test('normalizes account shapes and strongly verifies advertiserId, accountType, and child vSellerId', () => {
  assert.deepEqual(normalizeCurrentAccount({
    advertiserId: 2001,
    accountType: 602,
    brand: { brandUserName: '虚构品牌' },
    subAccount: {
      agentSubAccountId: 'fictional-child-spend',
      agentSubAccountName: '虚构有消耗子账户',
    },
  }), {
    vSellerId: 'fictional-child-spend',
    name: '虚构有消耗子账户',
    advertiserId: 2001,
    accountType: 602,
    brand: { brandUserName: '虚构品牌' },
    agent: null,
    subAccount: {
      agentSubAccountId: 'fictional-child-spend',
      agentSubAccountName: '虚构有消耗子账户',
    },
  });
  assert.equal(normalizeListedAccount({
    virtualSellerId: 'fictional-child-spend',
    advertiserId: 2001,
    accountType: 602,
    owner: { name: '虚构有消耗子账户' },
  }).name, '虚构有消耗子账户');

  assert.equal(verifyAccount(clone(ACCOUNTS[1]), clone(ACCOUNTS[1])).verified.advertiserId, 2001);
  assert.throws(
    () => verifyAccount({ ...ACCOUNTS[1], advertiserId: 9999 }, ACCOUNTS[1]),
    /advertiserId.*mismatch|账户.*不匹配/i
  );
  assert.throws(
    () => verifyAccount({ ...ACCOUNTS[1], accountType: 4 }, ACCOUNTS[1]),
    /accountType.*mismatch|账户.*不匹配/i
  );
  assert.throws(
    () => verifyAccount({ ...ACCOUNTS[1], vSellerId: 'fictional-wrong-vseller' }, ACCOUNTS[1]),
    /vSellerId.*mismatch|账户.*不匹配/i
  );
});

test('normalizes flat page-hook brand identity into the canonical account brand', () => {
  const expectedBrand = {
    brandUserId: 'fictional-flat-brand-id',
    brandUserName: '虚构扁平品牌',
  };
  const flatIdentity = {
    advertiserId: 1001,
    accountType: 4,
    brandUserId: expectedBrand.brandUserId,
    brandUserName: expectedBrand.brandUserName,
    name: '虚构主账户',
    vSellerId: null,
  };

  assert.deepEqual(normalizeListedAccount(flatIdentity).brand, expectedBrand);
  assert.deepEqual(normalizeCurrentAccount(flatIdentity).brand, expectedBrand);
});

test('parses report pages and normalizes string-packed metrics without hiding schema drift', () => {
  const response = reportEnvelope([
    reportRow('fictional-note-001', 12, { time: '2030-01-01', marketingTarget: 4, deliveryMode: 0 }),
  ], 1, 20, 12);
  const parsed = parseJuguangPage(response, 1);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.hasNext, false);
  assert.equal(parsed.totalData.metrics.fee, 12);

  const row = normalizeReportRow(response.data.dataList[0]);
  assert.equal(row.noteId, 'fictional-note-001');
  assert.equal(row.dimensions.marketingTarget, 4);
  assert.equal(row.dimensions.deliveryMode, 0);
  assert.equal(row.metrics.fee, 12);
  assert.equal(normalizeReportTotal(response.data).metrics.fee, 12);

  assert.throws(
    () => parseJuguangPage({ data: { dataList: [] } }, 1),
    /data\.page/i
  );
  assert.throws(
    () => parseJuguangPage({ data: { page: { totalCount: 0, totalPage: 0 } } }, 1),
    /data\.dataList/i
  );
});

test('parses the real one-based pageIndex used by account, summary, and daily reports', () => {
  for (const dataset of ['account', 'summary', 'daily']) {
    const response = reportEnvelope([
      reportRow(`fictional-${dataset}-note-001`, 12),
    ], 1, 20, 12);

    const parsed = parseJuguangPage(response, 1);
    assert.equal(parsed.items.length, 1, dataset);
    assert.equal(parsed.total, 1, dataset);
    assert.equal(parsed.pageSize, 20, dataset);
    assert.equal(parsed.hasNext, false, dataset);
  }

  const empty = reportEnvelope([], 1, 20, 0);
  const parsedEmpty = parseJuguangPage(empty, 1);
  assert.equal(parsedEmpty.total, 0);
  assert.equal(parsedEmpty.hasNext, false);

  const compatiblePageNum = reportEnvelope([], 1, 20, 0);
  compatiblePageNum.data.page.pageNum = compatiblePageNum.data.page.pageIndex;
  delete compatiblePageNum.data.page.pageIndex;
  assert.equal(parseJuguangPage(compatiblePageNum, 1).hasNext, false);

  const conflictingAliases = reportEnvelope([], 1, 20, 0);
  conflictingAliases.data.page.pageNum = 2;
  assert.throws(
    () => parseJuguangPage(conflictingAliases, 1),
    /pageIndex.*pageNum|conflict|mismatch/i,
  );

  const missingIndex = reportEnvelope([], 1, 20, 0);
  delete missingIndex.data.page.pageIndex;
  assert.throws(
    () => parseJuguangPage(missingIndex, 1),
    /pageIndex|pageNum/i,
  );

  const mismatchedIndex = reportEnvelope([], 2, 20, 0);
  assert.throws(
    () => parseJuguangPage(mismatchedIndex, 1),
    (error) => error.schemaInvalid === true && /page mismatch/i.test(error.message),
  );

  const inconsistentTotal = reportEnvelope([], 1, 20, 0);
  inconsistentTotal.data.page.totalPage = 1;
  assert.throws(
    () => parseJuguangPage(inconsistentTotal, 1),
    (error) => error.schemaInvalid === true && /pagination is inconsistent/i.test(error.message),
  );

  const undocumentedListAlias = reportEnvelope([], 1, 20, 0);
  undocumentedListAlias.data.list = undocumentedListAlias.data.dataList;
  delete undocumentedListAlias.data.dataList;
  assert.throws(
    () => parseJuguangPage(undocumentedListAlias, 1),
    /data\.dataList/i,
  );
});

test('invalid or missing account fee is a schema failure, never verified no spend', async (t) => {
  for (const scenario of [
    { name: 'placeholder fee', metrics: { fee: '--' } },
    { name: 'null fee', metrics: { fee: null } },
    { name: 'blank fee', metrics: { fee: '' } },
    { name: 'missing fee', metrics: {} },
  ]) {
    await t.test(scenario.name, async () => {
      const pageClient = createReportMutationClient(
        'account',
        'fictional-child-zero',
        (response) => {
          response.data.totalData.dataValueJson = JSON.stringify(scenario.metrics);
        }
      );
      const result = await createCollector(pageClient).collect(collectionOptions({
        runId: `fictional-juguang-invalid-fee-${scenario.name.replace(/\s+/g, '-')}`,
      }));
      const account = result.accounts.find((unit) => (
        unit.account.vSellerId === 'fictional-child-zero'
      ));

      assert.notEqual(account.status, 'verified_no_spend');
      assert.equal(account.status, 'failed');
      assert.equal(account.schemaValid, false);
      assert.ok(account.errors.some((error) => (
        error.code === 'report_schema_invalid' && /fee/i.test(error.message)
      )));
    });
  }
});

test('unsupported non-fee columns in account, summary, or daily reports downgrade the account to partial', async (t) => {
  for (const dataset of ['account', 'summary', 'daily']) {
    await t.test(dataset, async () => {
      const targetAccount = dataset === 'account'
        ? 'fictional-child-zero'
        : 'fictional-main-vseller';
      const pageClient = createReportMutationClient(dataset, targetAccount, (response) => {
        response.data.unsupportedColumns = ['impression'];
      });
      const result = await createCollector(pageClient).collect(collectionOptions({
        runId: `fictional-juguang-unsupported-${dataset}`,
      }));
      const account = result.accounts.find((unit) => unit.account.vSellerId === targetAccount);

      assert.equal(result.status, 'partial');
      assert.equal(account.status, 'partial');
      assert.equal(account.schemaValid, true);
      assert.ok(account.warnings.some((warning) => (
        warning.code === 'unsupported_columns' &&
        warning.dataset === dataset &&
        warning.columns.includes('impression')
      )));
    });
  }
});

test('unsupported fee in account, summary, or daily reports is a schema failure', async (t) => {
  for (const dataset of ['account', 'summary', 'daily']) {
    await t.test(dataset, async () => {
      const targetAccount = dataset === 'account'
        ? 'fictional-child-zero'
        : 'fictional-main-vseller';
      const pageClient = createReportMutationClient(dataset, targetAccount, (response) => {
        response.data.unsupportedColumns = ['fee'];
      });
      const result = await createCollector(pageClient).collect(collectionOptions({
        runId: `fictional-juguang-unsupported-fee-${dataset}`,
      }));
      const account = result.accounts.find((unit) => unit.account.vSellerId === targetAccount);

      assert.equal(account.status, 'failed');
      assert.equal(account.schemaValid, false);
      assert.ok(account.errors.some((error) => (
        error.code === 'report_schema_invalid' &&
        /fee/i.test(error.message) &&
        /unsupported/i.test(error.message)
      )));
    });
  }
});

test('reconciles account, period-note, and daily spend within the one-percent gate', () => {
  const matched = reconcileJuguangSpend({
    accountSpend: 300,
    summaryRows: [{ metrics: { fee: 100 } }, { metrics: { fee: 200 } }],
    dailyRows: [{ metrics: { fee: 120 } }, { metrics: { fee: 180 } }],
  });
  assert.equal(matched.reconciled, true);
  assert.equal(matched.summarySpend, 300);
  assert.equal(matched.dailySpend, 300);
  assert.deepEqual(matched.issues, []);

  const mismatch = reconcileJuguangSpend({
    accountSpend: 300,
    summaryRows: [{ metrics: { fee: 300 } }],
    dailyRows: [{ metrics: { fee: 250 } }],
  });
  assert.equal(mismatch.reconciled, false);
  assert.ok(mismatch.issues.some((issue) => issue.code === 'daily_spend_mismatch'));
});

test('discovers accounts, collects them sequentially, verifies zero spend, and restores the initial account', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions());

  assert.equal(result.platform, 'juguang');
  assert.equal(result.status, 'complete');
  assert.equal(result.truncated, false);
  assert.equal(result.initialAccount.vSellerId, 'fictional-main-vseller');
  assert.equal(result.restoredAccount.vSellerId, 'fictional-main-vseller');
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
  assert.equal(pageClient.getMaxActiveReports(), 1, 'advertiser accounts must be collected sequentially');
  assert.deepEqual(result.accounts.map((account) => account.account.vSellerId), [
    'fictional-main-vseller',
    'fictional-child-spend',
    'fictional-child-zero',
  ]);
  assert.deepEqual(result.accounts.map((account) => account.status), [
    'complete',
    'complete',
    'verified_no_spend',
  ]);

  for (const accountResult of result.accounts.slice(0, 2)) {
    assert.equal(accountResult.reconciliation.reconciled, true);
    assert.ok(accountResult.summaryRows.length > 0);
    assert.ok(accountResult.dailyRows.length > 0);
    assert.ok(accountResult.dailyRows.every((row) => (
      row.dimensions.time &&
      [4, 13].includes(row.dimensions.marketingTarget) &&
      [0, 1].includes(row.dimensions.deliveryMode)
    )));
  }
  assert.deepEqual(result.accounts[2].summaryRows, []);
  assert.deepEqual(result.accounts[2].dailyRows, []);

  assert.equal(result.attribution.basis, 'conversion_time');
  assert.equal(result.attribution.dataCaliber, 0);
  assert.equal(result.attribution.windowDays, 15);
  assert.deepEqual(result.attribution.splitColumns, ['marketingTarget', 'deliveryMode']);
  assert.equal(ATTRIBUTION.windowDays, 15);

  const reportCalls = pageClient.calls.filter((call) => call.endpoint === 'reports.query');
  assert.ok(reportCalls.every((call) => (
    call.payload.startDate === DATE_RANGE.from &&
    call.payload.endDate === DATE_RANGE.to &&
    call.payload.dataCaliber === 0
  )));
  const dailyCalls = reportCalls.filter((call) => call.payload.timeUnit === 'DAY');
  assert.ok(dailyCalls.every((call) => (
    JSON.stringify(call.payload.splitColumns) === JSON.stringify(['marketingTarget', 'deliveryMode'])
  )));
  assert.equal(reportCalls.filter((call) => (
    call.accountAtCall === 'fictional-child-zero' && call.payload.dataSource === 'note'
  )).length, 0, 'zero-spend account must skip empty note pagination');
});

test('starting from a child returns to verified main before discovery and restores the original child in finally', async () => {
  const pageClient = createFakePageClient({
    initialAccount: ACCOUNTS[1],
    childListIsScoped: true,
    mainIdentityWithoutVSeller: true,
  });
  const runtimeAccounts = createRuntimeAccountDependencies(pageClient);
  const result = await createCollector(pageClient, runtimeAccounts.dependencies).collect(collectionOptions({
    runId: 'fictional-juguang-run-started-in-child',
  }));

  assert.equal(result.status, 'complete');
  assert.ok(runtimeAccounts.returns.length >= 1, 'child discovery must use returnToMainAccount');
  const returnIndex = pageClient.events.indexOf('return-main');
  const listIndex = pageClient.events.indexOf('list');
  assert.ok(returnIndex >= 0 && returnIndex < listIndex,
    'account listing must happen only after the return-to-main workflow');
  assert.deepEqual(result.accounts.map((unit) => unit.account.vSellerId), [
    'fictional-main-vseller',
    'fictional-child-spend',
    'fictional-child-zero',
  ]);
  assert.equal(result.initialAccount.vSellerId, 'fictional-child-spend');
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-child-spend');
  assert.equal(runtimeAccounts.switches.at(-1).vSellerId, 'fictional-child-spend',
    'finally must navigate back to the original child account');
});

test('a main identity without vSellerId resolves to the listed account and is collected exactly once', async () => {
  const pageClient = createFakePageClient({
    initialAccount: ACCOUNTS[0],
    mainIdentityWithoutVSeller: true,
  });
  const runtimeAccounts = createRuntimeAccountDependencies(pageClient);
  const result = await createCollector(pageClient, runtimeAccounts.dependencies).collect(collectionOptions({
    runId: 'fictional-juguang-run-main-without-vseller',
  }));

  const mainUnits = result.accounts.filter((unit) => Number(unit.account.advertiserId) === 1001);
  assert.equal(result.status, 'complete');
  assert.equal(mainUnits.length, 1, 'the current and listed main account must be canonicalized before dedupe');
  assert.equal(result.accounts.length, 3);
  assert.equal(new Set(result.accounts.map((unit) => unit.account.vSellerId)).size, 3);
  assert.equal(runtimeAccounts.switches.some((account) => account.accountType === 4), false,
    'main-account transitions must not use child URL navigation');
  assert.equal(runtimeAccounts.returns.length, 1,
    'the DOM return workflow is only needed after the collector actually leaves the main account');
  assert.equal(pageClient.getCurrent().accountType, 4);
});

test('a failed child-to-main transition cannot be reported as a complete one-account collection', async () => {
  const pageClient = createFakePageClient({
    initialAccount: ACCOUNTS[1],
    childListIsScoped: true,
  });
  const runtimeAccounts = createRuntimeAccountDependencies(pageClient, { returnFailure: true });
  const result = await createCollector(pageClient, runtimeAccounts.dependencies).collect(collectionOptions({
    runId: 'fictional-juguang-run-return-main-failed',
  }));

  assert.notEqual(result.status, 'complete');
  assert.ok(['partial', 'failed'].includes(result.status));
  assert.equal(runtimeAccounts.returns.length, 1);
  assert.equal(pageClient.calls.some((call) => call.endpoint === 'accounts.list'), false,
    'a child-scoped list must not be mistaken for the full advertiser list');
  assert.ok(result.errors.some((error) => (
    error.code === 'account_discovery_failed' || error.code === 'account_restore_failed'
  )));
});

test('marks schema drift in one advertiser partial, continues later accounts, and restores initial identity', async () => {
  const pageClient = createFakePageClient({ schemaDrift: 'fictional-child-spend' });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-juguang-run-drift',
  }));

  assert.equal(result.status, 'partial');
  const drifted = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-spend');
  const later = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-zero');
  assert.notEqual(drifted.status, 'complete');
  assert.equal(drifted.schemaValid, false);
  assert.ok(drifted.errors.some((error) => /data\.dataList|data\.page/i.test(error.message)));
  assert.equal(later.status, 'verified_no_spend');
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
});

test('blocks report requests for an account whose post-switch identity does not match the target', async () => {
  const pageClient = createFakePageClient({ identityMismatch: 'fictional-child-spend' });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-juguang-run-mismatch',
  }));

  assert.equal(result.status, 'partial');
  const mismatched = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-spend');
  assert.equal(mismatched.status, 'failed');
  assert.ok(mismatched.errors.some((error) => error.code === 'account_identity_mismatch'));
  assert.equal(pageClient.calls.filter((call) => (
    call.endpoint === 'reports.query' && call.accountAtCall === 'fictional-child-spend'
  )).length, 0);
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
});

test('records a switch failure, continues the remaining account, and restores the initial account', async () => {
  const pageClient = createFakePageClient({ switchFailure: 'fictional-child-spend' });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-juguang-run-switch-failure',
  }));

  assert.equal(result.status, 'partial');
  const failed = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-spend');
  const later = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-zero');
  assert.equal(failed.status, 'failed');
  assert.ok(failed.errors.some((error) => error.code === 'account_switch_failed'));
  assert.equal(later.status, 'verified_no_spend');
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
});

test('marks a later-page interruption partial while preserving other advertiser results', async () => {
  const pageClient = createFakePageClient({
    interrupt: { account: 'fictional-child-spend', dataset: 'daily', page: 2 },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-juguang-run-interruption',
  }));

  assert.equal(result.status, 'partial');
  const interrupted = result.accounts.find((item) => item.account.vSellerId === 'fictional-child-spend');
  assert.equal(interrupted.status, 'partial');
  assert.ok(interrupted.errors.some((error) => (
    error.code === 'pagination_incomplete' && /page 2 interruption/.test(error.message)
  )));
  assert.equal(
    result.accounts.find((item) => item.account.vSellerId === 'fictional-child-zero').status,
    'verified_no_spend'
  );
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
});

test('marks an artificial maxPages cutoff partial and truncated', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-juguang-run-limited',
    maxPages: 1,
  }));

  assert.equal(result.status, 'partial');
  assert.equal(result.truncated, true);
  assert.ok(result.warnings.some((warning) => (
    warning.code === 'truncated_maxPages' || warning.limit === 'maxPages'
  )));
  assert.ok(result.accounts.some((account) => account.status === 'partial' && account.truncated));
  assert.equal(pageClient.getCurrent().vSellerId, 'fictional-main-vseller');
});
