const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryCache } = require('../xhs/local-cache');
const {
  modelPage,
  reportDeliveryMode,
  orderReportExt,
  overlapsDateRange,
  createAdstarCollector,
} = require('../xhs/adstar-collector');

const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});

const PROJECT_PAGES = Object.freeze({
  1: [
    {
      id: 'fictional-project-001',
      projectName: '虚构项目一',
      startTime: '2030-01-02 00:00:00',
      endTime: '2030-01-06 23:59:59',
    },
    {
      id: 'fictional-project-outside',
      projectName: '虚构范围外项目',
      startTime: '2029-12-01 00:00:00',
      endTime: '2029-12-10 23:59:59',
    },
  ],
  2: [
    {
      id: 'fictional-project-no-date',
      projectName: '虚构无日期项目',
    },
  ],
});

const ORDER_PAGES = Object.freeze({
  1: [
    {
      orderId: 'fictional-order-001',
      orderName: '虚构订单一',
      projectId: 'fictional-project-001',
      settleSeqId: 'fictional-settle-001',
      memberId: 'fictional-member-001',
      memberName: '虚构星河账号一',
      deliveryModeCode: 88,
      media: 'RED_BOOK',
      startTime: '2030-01-03 00:00:00',
      endTime: '2030-01-05 23:59:59',
    },
    {
      orderId: 'fictional-order-outside',
      orderName: '虚构范围外订单',
      projectId: 'fictional-project-outside',
      settleSeqId: 'fictional-settle-outside',
      memberId: 'fictional-member-001',
      memberName: '虚构星河账号一',
      startTime: '2030-02-01 00:00:00',
      endTime: '2030-02-05 23:59:59',
    },
  ],
  2: [
    {
      orderId: 'fictional-order-no-date',
      orderName: '虚构无日期订单',
      projectId: 'fictional-project-no-date',
      settleSeqId: 'fictional-settle-no-date',
      memberId: 'fictional-member-001',
      memberName: '虚构星河账号一',
      reportDeliveryMode: 'fictionalCustomMode',
    },
  ],
});

function modelEnvelope(items, page, totalCount) {
  const totalPages = 2;
  return {
    model: {
      result: items,
      pageNo: page,
      pageSize: 2,
      totalCount,
      totalPages,
      hasNext: page < totalPages,
      nextPage: page < totalPages ? page + 1 : null,
    },
  };
}

function requestPage(payload) {
  return Number(payload.pageNo || payload.page || 1);
}

function unitId(payload) {
  return String(payload.projectId || payload.orderId || payload.id || '');
}

function createFakePageClient(options = {}) {
  const calls = [];
  const failures = new Set(options.failures || []);
  const contentIds = {
    'fictional-order-001': 'fictional-note-001',
    'fictional-order-no-date': 'fictional-note-002',
  };

  async function request(input) {
    const safeInput = structuredClone(input);
    calls.push(safeInput);
    assert.equal(input.platform, 'adstar');
    assert.equal(input.tabId, 73);
    const payload = input.payload || {};

    if (input.endpoint === 'projects.list') {
      const page = requestPage(payload);
      if (options.driftProjects) {
        return {
          model: {
            pageNo: page,
            pageSize: 2,
            totalCount: 0,
            totalPages: 1,
            hasNext: false,
          },
        };
      }
      const projects = (PROJECT_PAGES[page] || []).map((project, index) => {
        const copy = { ...project };
        if (options.projectIdentity) {
          copy.promoteShopMemberId = options.projectIdentity.memberId;
          copy.promoteShopName = options.projectIdentity.memberName;
        }
        if (options.multipleProjectIdentities && page === 2 && index === 0) {
          copy.promoteShopMemberId = 'fictional-member-002';
          copy.promoteShopName = '虚构星河账号二';
        }
        return copy;
      });
      return modelEnvelope(projects, page, 3);
    }

    if (input.endpoint === 'orders.list') {
      const page = requestPage(payload);
      const orders = (ORDER_PAGES[page] || []).map((order) => ({ ...order }));
      if (options.missingOrderIdentity) {
        orders.forEach((order) => {
          delete order.memberId;
          delete order.memberName;
        });
      }
      if (options.multipleOrderIdentities && page === 2 && orders[0]) {
        orders[0].memberId = 'fictional-member-002';
        orders[0].memberName = '虚构星河账号二';
      }
      return modelEnvelope(orders, page, 3);
    }

    if (input.endpoint === 'reports.summary') {
      const level = String(payload.level || '');
      const id = unitId(payload);
      const failureKey = `${level}:${id || 'store'}:summary`;
      if (failures.has(failureKey)) {
        const error = new Error(`fictional nested failure: ${failureKey}`);
        error.retryable = false;
        throw error;
      }
      return {
        model: {
          level,
          id: id || 'fictional-store',
          fee: level === 'store' ? 600 : 120,
          gmv: level === 'store' ? 1500 : 300,
        },
      };
    }

    if (input.endpoint === 'reports.detail') {
      const level = String(payload.level || '');
      const id = unitId(payload);
      const dataBatch = String(payload.dataBatch || '');
      const failureKey = `${level}:${id}:${dataBatch}`;
      if (failures.has(failureKey)) {
        const error = new Error(`fictional nested failure: ${failureKey}`);
        error.retryable = false;
        throw error;
      }

      let row;
      if (level === 'project') {
        row = dataBatch === 'project'
          ? { projectId: id, fee: 120 }
          : { projectId: id, orderId: `fictional-order-for-${id}`, fee: 120 };
      } else if (dataBatch === 'content') {
        row = {
          orderId: id,
          contentId: contentIds[id] || `fictional-note-for-${id}`,
          visitorCount: 30,
          gmv: 300,
          slrAttrItmCltUv1d: 12,
          slrAttrItmOrdGmv1d1bpOrd: 240,
          slrAttrItmOrdGmv1dNot1bpOrd: 60,
        };
      } else {
        row = { orderId: id, fee: 120, gmv: 300 };
      }

      return {
        model: {
          result: [row],
          pageNo: 1,
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
          hasNext: false,
          nextPage: null,
        },
      };
    }

    throw new Error(`unexpected fictional endpoint: ${input.endpoint}`);
  }

  return { calls, request };
}

function createCollector(pageClient) {
  return createAdstarCollector({
    pageClient,
    cache: createMemoryCache(),
    now: () => '2030-02-01T00:00:00.000Z',
  });
}

function collectionOptions(overrides = {}) {
  return {
    tabId: 73,
    runId: overrides.runId || 'fictional-adstar-run-001',
    accountKey: 'fictional-adstar-account-001',
    dateRange: DATE_RANGE,
    pageSize: 2,
    maxProjects: overrides.maxProjects,
    maxOrders: overrides.maxOrders,
  };
}

test('modelPage parses valid pagination and rejects missing model.result structure', () => {
  assert.deepEqual(
    modelPage(modelEnvelope([{ id: 'fictional-row-001' }], 1, 3), 1),
    {
      items: [{ id: 'fictional-row-001' }],
      total: 3,
      pageSize: 2,
      hasNext: true,
      nextPage: 2,
    }
  );

  assert.throws(
    () => modelPage({ model: { totalCount: 0, totalPages: 1 } }, 1),
    /model\.result/i
  );
  assert.throws(
    () => modelPage({ data: { result: [] } }, 1),
    /model/i
  );
});

test('report helpers preserve known delivery modes and never disguise unknown numeric modes as all', () => {
  assert.equal(reportDeliveryMode({ deliveryModeCode: 88 }), 'cptSeedDaily');
  assert.equal(
    reportDeliveryMode({ reportDeliveryMode: 'fictionalCustomMode' }),
    'fictionalCustomMode'
  );
  assert.equal(reportDeliveryMode({ deliveryModeCode: 9999 }), 'unknown');

  assert.deepEqual(
    orderReportExt({
      orderId: 'fictional-order-001',
      settleSeqId: 'fictional-settle-001',
      projectId: 'fictional-project-001',
      deliveryModeCode: 88,
      businessMode: 'fictional-business-mode',
      media: 'RED_BOOK',
    }, 'content'),
    {
      settleSeqId: 'fictional-settle-001',
      media: 'RED_BOOK',
      saleType: 1,
      businessMode: 'fictional-business-mode',
      deliveryMode: 'cptSeedDaily',
      projectId: 'fictional-project-001',
      flowType: 'all',
      cycleStr: '15',
      dataBatch: 'content',
    }
  );
});

test('overlapsDateRange includes overlaps, excludes disjoint units, and conservatively includes missing dates', () => {
  assert.equal(overlapsDateRange({
    startTime: '2030-01-02 00:00:00',
    endTime: '2030-01-03 23:59:59',
  }, DATE_RANGE), true);
  assert.equal(overlapsDateRange({
    startTime: '2030-02-01 00:00:00',
    endTime: '2030-02-03 23:59:59',
  }, DATE_RANGE), false);
  assert.equal(overlapsDateRange({ projectName: '虚构缺日期项目' }, DATE_RANGE), true);
});

test('collects complete lists and all required nested data only for date-related projects and orders', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions());

  assert.equal(result.platform, 'adstar');
  assert.equal(result.status, 'complete');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.identity, {
    memberId: 'fictional-member-001',
    memberName: '虚构星河账号一',
  });
  assert.equal(result.lists.projects.items.length, 3);
  assert.equal(result.lists.orders.items.length, 3);
  assert.equal(result.storeSummary.id, 'fictional-store');

  const projectUnits = result.nested.filter((unit) => unit.type === 'project');
  const orderUnits = result.nested.filter((unit) => unit.type === 'order');
  assert.deepEqual(
    projectUnits.map((unit) => unit.id),
    ['fictional-project-001', 'fictional-project-no-date']
  );
  assert.deepEqual(
    orderUnits.map((unit) => unit.id),
    ['fictional-order-001', 'fictional-order-no-date']
  );
  assert.ok(projectUnits.every((unit) => (
    unit.status === 'complete' &&
    unit.summary &&
    unit.checkpoints.summary.status === 'complete' &&
    /^xhs-v1-/.test(unit.checkpoints.summary.fingerprint) &&
    /^xhs-v1-/.test(unit.checkpoints.project.fingerprint) &&
    /^xhs-v1-/.test(unit.checkpoints.order.fingerprint) &&
    unit.details.project.length === 1 &&
    unit.details.order.length === 1
  )));
  assert.ok(orderUnits.every((unit) => (
    unit.status === 'complete' &&
    unit.summary &&
    unit.checkpoints.summary.status === 'complete' &&
    /^xhs-v1-/.test(unit.checkpoints.order.fingerprint) &&
    /^xhs-v1-/.test(unit.checkpoints.content.fingerprint) &&
    unit.details.order.length === 1 &&
    unit.details.content.length === 1
  )));
  assert.deepEqual(
    result.contentRows.map((row) => ({ contentId: row.contentId, noteId: row.noteId })),
    [
      { contentId: 'fictional-note-001', noteId: 'fictional-note-001' },
      { contentId: 'fictional-note-002', noteId: 'fictional-note-002' },
    ]
  );
  assert.deepEqual(
    {
      favoriteUv: result.contentRows[0].slrAttrItmCltUv1d,
      seededProductGmv: result.contentRows[0].slrAttrItmOrdGmv1d1bpOrd,
      linkedProductGmv: result.contentRows[0].slrAttrItmOrdGmv1dNot1bpOrd,
    },
    { favoriteUv: 12, seededProductGmv: 240, linkedProductGmv: 60 },
    '星河真实接口的收藏/任务商品 GMV/连带 GMV 必须进入分析投影',
  );
  assert.deepEqual(
    result.excluded.projects.map((item) => item.id),
    ['fictional-project-outside']
  );
  assert.deepEqual(
    result.excluded.orders.map((item) => item.id),
    ['fictional-order-outside']
  );

  const projectListPages = pageClient.calls
    .filter((call) => call.endpoint === 'projects.list')
    .map((call) => requestPage(call.payload));
  const orderListPages = pageClient.calls
    .filter((call) => call.endpoint === 'orders.list')
    .map((call) => requestPage(call.payload));
  assert.deepEqual(projectListPages, [1, 2]);
  assert.deepEqual(orderListPages, [1, 2]);

  const excludedNestedCalls = pageClient.calls.filter((call) => (
    call.endpoint.startsWith('reports.') &&
    ['fictional-project-outside', 'fictional-order-outside'].includes(unitId(call.payload))
  ));
  assert.deepEqual(excludedNestedCalls, []);
});

test('warns and leaves identity empty when Star order rows have no member identity', async () => {
  const pageClient = createFakePageClient({ missingOrderIdentity: true });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-missing-account-identity',
  }));

  assert.equal(result.identity, null);
  const warning = result.warnings.find((item) => item.code === 'adstar_account_identity_missing');
  assert.ok(warning);
  assert.equal(warning.missingMemberIdCount, 3);
  assert.equal(warning.orderCount, 3);
});

test('uses the unique promoted shop identity when real-shaped Star orders omit memberId', async () => {
  const pageClient = createFakePageClient({
    missingOrderIdentity: true,
    projectIdentity: {
      memberId: 'fictional-project-member-001',
      memberName: '虚构项目推广店铺',
    },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-project-account-identity',
  }));

  assert.deepEqual(result.identity, {
    memberId: 'fictional-project-member-001',
    memberName: '虚构项目推广店铺',
  });
  assert.equal(result.status, 'complete');
  assert.equal(
    result.warnings.some((item) => item.code === 'adstar_account_identity_missing'),
    false,
  );
});

test('conflicting project and order member identities are ambiguous and never trusted', async () => {
  const pageClient = createFakePageClient({
    projectIdentity: {
      memberId: 'fictional-project-member-conflict',
      memberName: '虚构冲突推广店铺',
    },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-cross-source-identity-conflict',
  }));

  assert.equal(result.identity, null);
  assert.equal(result.status, 'partial');
  const warning = result.warnings.find((item) => item.code === 'adstar_account_identity_ambiguous');
  assert.ok(warning);
  assert.equal(warning.identityCount, 2);
  assert.doesNotMatch(
    JSON.stringify(warning),
    /fictional-project-member-conflict|fictional-member-001|虚构冲突推广店铺/,
  );
});

test('multiple promoted-shop identities stay ambiguous when orders expose no memberId', async () => {
  const pageClient = createFakePageClient({
    missingOrderIdentity: true,
    projectIdentity: {
      memberId: 'fictional-project-member-001',
      memberName: '虚构项目推广店铺一',
    },
    multipleProjectIdentities: true,
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-project-identity-ambiguous',
  }));

  assert.equal(result.identity, null);
  assert.equal(result.status, 'partial');
  const warning = result.warnings.find((item) => item.code === 'adstar_account_identity_ambiguous');
  assert.ok(warning);
  assert.equal(warning.identityCount, 2);
});

test('multiple Star member identities are ambiguous and can never produce complete status', async () => {
  const pageClient = createFakePageClient({ multipleOrderIdentities: true });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-ambiguous-account-identity',
  }));

  assert.equal(result.identity, null);
  assert.equal(result.status, 'partial');
  const warning = result.warnings.find((item) => item.code === 'adstar_account_identity_ambiguous');
  assert.ok(warning);
  assert.equal(warning.identityCount, 2);
  assert.equal(warning.identities, undefined);
  assert.doesNotMatch(JSON.stringify(warning), /fictional-member|\u865a构星河账号/);
});

test('marks maxProjects and maxOrders limits as partial truncation after full list pagination', async () => {
  const pageClient = createFakePageClient();
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-truncated',
    maxProjects: 1,
    maxOrders: 1,
  }));

  assert.equal(result.status, 'partial');
  assert.equal(result.truncated, true);
  assert.equal(result.lists.projects.items.length, 3);
  assert.equal(result.lists.orders.items.length, 3);
  assert.equal(result.nested.filter((unit) => unit.type === 'project').length, 1);
  assert.equal(result.nested.filter((unit) => unit.type === 'order').length, 1);
  assert.ok(result.warnings.some((warning) => (
    warning.code === 'truncated_maxProjects' || warning.limit === 'maxProjects'
  )));
  assert.ok(result.warnings.some((warning) => (
    warning.code === 'truncated_maxOrders' || warning.limit === 'maxOrders'
  )));

  assert.deepEqual(
    pageClient.calls.filter((call) => call.endpoint === 'projects.list')
      .map((call) => requestPage(call.payload)),
    [1, 2]
  );
  assert.deepEqual(
    pageClient.calls.filter((call) => call.endpoint === 'orders.list')
      .map((call) => requestPage(call.payload)),
    [1, 2]
  );
});

test('continues remaining nested units after one API failure and returns a traceable partial result', async () => {
  const pageClient = createFakePageClient({
    failures: ['order:fictional-order-001:content'],
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-nested-failure',
  }));

  assert.equal(result.status, 'partial');
  assert.equal(result.truncated, false);
  assert.ok(result.errors.some((error) => (
    error.code === 'nested_unit_incomplete' &&
    error.unitType === 'order' &&
    error.unitId === 'fictional-order-001' &&
    /fictional nested failure/.test(error.message)
  )));
  const failedOrder = result.nested.find((unit) => (
    unit.type === 'order' && unit.id === 'fictional-order-001'
  ));
  const laterOrder = result.nested.find((unit) => (
    unit.type === 'order' && unit.id === 'fictional-order-no-date'
  ));
  assert.notEqual(failedOrder.status, 'complete');
  assert.equal(laterOrder.status, 'complete');
  assert.ok(pageClient.calls.some((call) => (
    call.endpoint === 'reports.detail' &&
    call.payload.level === 'order' &&
    call.payload.orderId === 'fictional-order-no-date' &&
    call.payload.dataBatch === 'content'
  )), 'collector must continue to the later order after one nested failure');
});

test('returns failed rather than a false success when a list response loses model.result', async () => {
  const pageClient = createFakePageClient({ driftProjects: true });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-schema-drift',
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.schemaValid, false);
  assert.ok(result.errors.some((error) => /model\.result/i.test(error.message)));
  assert.notEqual(result.status, 'complete');
});
