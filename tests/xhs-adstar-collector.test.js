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

function singlePageEnvelope(items) {
  return {
    model: {
      result: items,
      pageNo: 1,
      pageSize: 20,
      totalCount: items.length,
      totalPages: 1,
      hasNext: false,
      nextPage: null,
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
  let activeOrderSummaries = 0;
  let maxActiveOrderSummaries = 0;
  const contentIds = Object.assign({
    'fictional-order-001': 'fictional-note-001',
    'fictional-order-no-date': 'fictional-note-002',
  }, options.contentIds || {});

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
      const memberType = Number(payload.memberType);
      if (memberType === 5 && Number(options.manyOrderCount) > 0) {
        const count = Math.floor(Number(options.manyOrderCount));
        return singlePageEnvelope(Array.from({ length: count }, (_unused, index) => ({
          orderId: `fictional-concurrent-order-${String(index + 1).padStart(3, '0')}`,
          orderName: `虚构并发任务${index + 1}`,
          projectId: 'fictional-project-001',
          settleSeqId: `fictional-concurrent-settle-${String(index + 1).padStart(3, '0')}`,
          memberId: 'fictional-member-001',
          memberName: '虚构星河账号一',
          deliveryModeCode: 88,
          media: 'RED_BOOK',
          startTime: '2030-01-03 00:00:00',
          endTime: '2030-01-05 23:59:59',
        })));
      }
      if (options.noOrders || (memberType === 5 && options.agencyOnlyOrders)) {
        return singlePageEnvelope([]);
      }
      if (memberType === 6 && options.agencyOnlyOrders) {
        return singlePageEnvelope([{
          orderId: 'fictional-agency-order-001',
          orderName: '虚构代理商订单',
          projectId: 'fictional-project-no-date',
          settleSeqId: 'fictional-agency-settle-001',
          memberId: 'fictional-agency-member-999',
          memberName: '虚构代理商账号',
          deliveryModeCode: 88,
          media: 'RED_BOOK',
          startTime: '2030-01-03 00:00:00',
          endTime: '2030-01-05 23:59:59',
        }]);
      }
      if (memberType === 6 && options.conflictingMemberTypeOrder) {
        return singlePageEnvelope([{
          ...ORDER_PAGES[1][0],
          projectId: 'fictional-project-no-date',
          settleSeqId: 'fictional-conflicting-settle-001',
        }]);
      }
      if (memberType === 6) return singlePageEnvelope([]);
      const page = requestPage(payload);
      const orders = (ORDER_PAGES[page] || []).map((order) => ({
        ...order,
        ...(options.sameProjectOrders && order.orderId === 'fictional-order-no-date'
          ? { projectId: 'fictional-project-001' }
          : {}),
      }));
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
      if (level === 'order' && Number(options.orderSummaryDelayMs) > 0) {
        activeOrderSummaries += 1;
        maxActiveOrderSummaries = Math.max(maxActiveOrderSummaries, activeOrderSummaries);
        try {
          await new Promise((resolve) => setTimeout(resolve, Number(options.orderSummaryDelayMs)));
        } finally {
          activeOrderSummaries -= 1;
        }
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
          : {
            projectId: id,
            orderId: options.projectReportOrderIds && options.projectReportOrderIds[id] ||
              `fictional-order-for-${id}`,
            fee: 120,
            ...(options.projectOrderContentIds && options.projectOrderContentIds[id]
              ? {
                contentId: options.projectOrderContentIds[id],
                ds: '20300104',
                readUv1d: 31,
                engagementUv1d: 7,
                slrAttrItmOrdGmv1d: 88,
              }
              : {}),
          };
      } else if (dataBatch === 'content') {
        row = {
          orderId: id,
          contentId: contentIds[id] || `fictional-note-for-${id}`,
          ds: '20300104',
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

  return {
    calls,
    request,
    getMaxActiveOrderSummaries: () => maxActiveOrderSummaries,
  };
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
  assert.deepEqual(orderListPages, [1, 2, 1]);

  const excludedNestedCalls = pageClient.calls.filter((call) => (
    call.endpoint.startsWith('reports.') &&
    ['fictional-project-outside', 'fictional-order-outside'].includes(unitId(call.payload))
  ));
  assert.deepEqual(excludedNestedCalls, []);
});

test('collects Star tasks with the default four-way limit while preserving task order', async () => {
  const pageClient = createFakePageClient({
    manyOrderCount: 8,
    orderSummaryDelayMs: 15,
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-four-way-tasks',
  }));

  assert.equal(pageClient.getMaxActiveOrderSummaries(), 4,
    'task collection must default to four concurrent task units');
  assert.deepEqual(
    result.nested.filter((unit) => unit.type === 'order').map((unit) => unit.id),
    Array.from({ length: 8 }, (_unused, index) => (
      `fictional-concurrent-order-${String(index + 1).padStart(3, '0')}`
    )),
    'bounded concurrency must not reorder task output',
  );
});

test('collects brand-self and agency orders in isolated paginated sources and merges their totals', async () => {
  const pageClient = createFakePageClient({
    agencyOnlyOrders: true,
    projectIdentity: {
      memberId: 'fictional-promoted-shop-001',
      memberName: '虚构推广店铺',
    },
    projectOrderContentIds: {
      'fictional-project-no-date': 'fictional-note-for-fictional-agency-order-001',
    },
    projectReportOrderIds: {
      'fictional-project-no-date': 'fictional-agency-settle-001',
    },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-agency-member-type',
  }));

  assert.equal(result.status, 'complete');
  assert.deepEqual(
    pageClient.calls
      .filter((call) => call.endpoint === 'orders.list')
      .map((call) => Number(call.payload.memberType)),
    [5, 6],
  );
  assert.deepEqual(result.lists.orders.items.map((order) => order.orderId), [
    'fictional-agency-order-001',
  ]);
  assert.equal(result.lists.orders.expectedCount, 1);
  assert.equal(result.lists.orders.receivedCount, 1);
  assert.equal(result.lists.orders.pageCount, 2);
  assert.equal(result.lists.orders.status, 'complete');
  assert.equal(result.lists.orders.truncated, false);
  assert.deepEqual(result.lists.orders.sources.map((source) => source.memberType), [5, 6]);
  assert.equal(new Set(result.lists.orders.sources.map((source) => source.cacheKey)).size, 2);
  assert.equal(new Set(result.lists.orders.sources.map((source) => source.fingerprint)).size, 2);
  assert.deepEqual(result.identity, {
    memberId: 'fictional-promoted-shop-001',
    memberName: '虚构推广店铺',
  }, 'agency memberId/memberName are the agent identity and must not conflict with promoted-shop identity');
  assert.ok(result.nested.some((unit) => (
    unit.type === 'order' && unit.id === 'fictional-agency-order-001'
  )));
  const agencyContentRows = result.contentRows.filter((row) => (
    row.noteId === 'fictional-note-for-fictional-agency-order-001'
  ));
  assert.equal(agencyContentRows.length, 1);
  assert.equal(agencyContentRows[0].listOrderId, 'fictional-agency-order-001');
});

test('fails closed when member-type order lists repeat an orderId with conflicting data', async () => {
  const pageClient = createFakePageClient({ conflictingMemberTypeOrder: true });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-member-type-conflict',
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.schemaValid, false);
  const conflict = result.errors.find((error) => error.code === 'ADSTAR_ORDER_ID_CONFLICT');
  assert.ok(conflict);
  assert.equal(conflict.stage, 'orders.merge');
  assert.equal(conflict.memberType, 6);
  assert.equal(Object.hasOwn(conflict, 'orderId'), false, 'merge diagnostics must not expose order IDs');
  assert.deepEqual(
    pageClient.calls
      .filter((call) => call.endpoint === 'orders.list')
      .map((call) => Number(call.payload.memberType)),
    [5, 5, 6],
    'type 5 must finish pagination before the independently cached type 6 list is reconciled',
  );
  assert.equal(
    pageClient.calls.some((call) => call.endpoint.startsWith('reports.')),
    false,
    'conflicting list identity must stop before nested report collection',
  );
});

test('collects date-scoped project reports when order lists are empty and safely projects project-order content', async () => {
  const pageClient = createFakePageClient({
    noOrders: true,
    projectOrderContentIds: {
      'fictional-project-no-date': 'fictional-project-note-001',
    },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-project-fallback',
  }));

  assert.equal(result.lists.orders.items.length, 0);
  assert.deepEqual(
    result.nested.filter((unit) => unit.type === 'project').map((unit) => unit.id),
    ['fictional-project-001', 'fictional-project-no-date'],
  );
  assert.equal(result.nested.some((unit) => unit.type === 'order'), false);
  assert.deepEqual(result.contentRows, [{
    ds: '20300104',
    projectId: 'fictional-project-no-date',
    reportOrderId: 'fictional-order-for-fictional-project-no-date',
    noteId: 'fictional-project-note-001',
    contentId: 'fictional-project-note-001',
    readUv1d: 31,
    engagementUv1d: 7,
    slrAttrItmOrdGmv1d: 88,
  }]);
  assert.ok(pageClient.calls.some((call) => (
    call.endpoint === 'reports.summary' &&
    call.payload.level === 'project' &&
    call.payload.projectId === 'fictional-project-no-date' &&
    call.payload.startTime === '2030-01-01 00:00:00' &&
    call.payload.endTime === '2030-01-07 23:59:59'
  )));
  assert.ok(pageClient.calls.some((call) => (
    call.endpoint === 'reports.detail' &&
    call.payload.level === 'project' &&
    call.payload.projectId === 'fictional-project-no-date' &&
    call.payload.dataBatch === 'order' &&
    call.payload.startTime === '2030-01-01 00:00:00' &&
    call.payload.endTime === '2030-01-07 23:59:59'
  )));
});

test('preserves separate order relations when the same note appears in multiple Star orders', async () => {
  const sharedNoteId = 'fictional-shared-note-001';
  const pageClient = createFakePageClient({
    sameProjectOrders: true,
    contentIds: {
      'fictional-order-001': sharedNoteId,
      'fictional-order-no-date': sharedNoteId,
    },
  });
  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fictional-adstar-run-shared-note-relations',
  }));

  const relations = result.contentRows
    .filter((row) => row.noteId === sharedNoteId)
    .map((row) => row.listOrderId)
    .sort();
  assert.deepEqual(relations, ['fictional-order-001', 'fictional-order-no-date']);
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
    [1, 2, 1]
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
