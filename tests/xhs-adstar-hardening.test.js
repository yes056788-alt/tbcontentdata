const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createMemoryCache } = require('../xhs/local-cache');
const {
  createAdstarCollector,
  modelPage,
} = require('../xhs/adstar-collector');

const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});

function pageEnvelope(items, options = {}) {
  const pageNo = Number(options.pageNo || 1);
  const pageSize = Number(options.pageSize || 20);
  const totalCount = Number(options.totalCount ?? items.length);
  const totalPages = Number(options.totalPages || Math.max(1, Math.ceil(totalCount / pageSize)));
  const hasNext = options.hasNext === undefined ? pageNo < totalPages : Boolean(options.hasNext);
  return {
    model: {
      result: items,
      pageNo,
      pageSize,
      totalCount,
      totalPages,
      hasNext,
      nextPage: hasNext ? pageNo + 1 : null,
    },
  };
}

function flattenedLength(pages) {
  return Object.values(pages || {}).reduce((count, rows) => count + rows.length, 0);
}

function createScenarioPageClient(options = {}) {
  const calls = [];
  const projectPages = options.projectPages || { 1: [] };
  const orderPages = options.orderPages || { 1: [] };
  const projectTotal = options.projectTotal ?? flattenedLength(projectPages);
  const orderTotal = options.orderTotal ?? flattenedLength(orderPages);
  const projectTotalPages = options.projectTotalPages || Math.max(1, Object.keys(projectPages).length);
  const orderTotalPages = options.orderTotalPages || Math.max(1, Object.keys(orderPages).length);
  const responsePageSize = Number(options.responsePageSize || 20);

  async function request(input) {
    calls.push(structuredClone(input));
    assert.equal(input.platform, 'adstar');
    const payload = input.payload || {};
    const pageNo = Number(payload.pageNo || 1);

    if (typeof options.beforeRequest === 'function') {
      const intercepted = await options.beforeRequest(input);
      if (intercepted !== undefined) return intercepted;
    }

    if (input.endpoint === 'projects.list') {
      return pageEnvelope(projectPages[pageNo] || [], {
        pageNo,
        pageSize: responsePageSize,
        totalCount: projectTotal,
        totalPages: projectTotalPages,
      });
    }

    if (input.endpoint === 'orders.list') {
      return pageEnvelope(orderPages[pageNo] || [], {
        pageNo,
        pageSize: responsePageSize,
        totalCount: orderTotal,
        totalPages: orderTotalPages,
      });
    }

    if (input.endpoint === 'reports.summary') {
      return { model: { readUv1d: 10, engagementUv1d: 2 } };
    }

    if (input.endpoint === 'reports.detail') {
      const rows = typeof options.detailRows === 'function'
        ? options.detailRows(payload)
        : defaultDetailRows(payload);
      return pageEnvelope(rows, {
        pageNo,
        pageSize: Number(payload.pageSize || 20),
        totalCount: rows.length,
        totalPages: 1,
      });
    }

    throw new Error(`Unexpected Star endpoint in fixture: ${input.endpoint}`);
  }

  return { calls, request };
}

function defaultDetailRows(payload) {
  const level = String(payload.level || '');
  const dataBatch = String(payload.dataBatch || '');
  if (level === 'project') {
    return [{
      id: `fixture-${payload.projectId}-${dataBatch}`,
      projectId: payload.projectId,
      ds: '20300104',
    }];
  }
  if (dataBatch === 'content') {
    return [{
      id: `fixture-content-${payload.orderId}`,
      orderId: payload.orderId,
      projectId: payload.ext && payload.ext.projectId,
      contentId: `fixture-note-${payload.orderId}`,
      ds: '20300104',
      readUv1d: 10,
    }];
  }
  return [{
    id: `fixture-order-${payload.orderId}`,
    orderId: payload.orderId,
    projectId: payload.ext && payload.ext.projectId,
    ds: '20300104',
  }];
}

function createCollector(pageClient, cache = createMemoryCache()) {
  return createAdstarCollector({
    pageClient,
    cache,
    now: () => '2030-02-01T00:00:00.000Z',
    retry: { retries: 0 },
  });
}

function collectionOptions(overrides = {}) {
  return Object.assign({
    tabId: 73,
    runId: 'fixture-star-hardening-run',
    accountKey: 'fixture-store-binding',
    dateRange: DATE_RANGE,
    pageSize: 20,
  }, overrides);
}

function inRangeOrder(overrides = {}) {
  return Object.assign({
    orderId: 'fixture-list-order-001',
    buyOrderId: 'fixture-list-order-001',
    settleSeqId: 'fixture-settle-001',
    projectId: 'fixture-project-related',
    orderName: 'fixture order',
    deliveryMode: 88,
    businessMode: 88,
    media: 'RED_BOOK',
    startTime: '2030-01-02',
    endTime: '2030-01-06',
  }, overrides);
}

test('real-shaped projects without dates are scoped by related order projectId and ambiguity is reported', async () => {
  const pageClient = createScenarioPageClient({
    projectPages: {
      1: [
        { id: 'fixture-project-related', projectName: 'related', gmtCreate: '2029-12-01 10:00:00' },
        { id: 'fixture-project-without-related-order', projectName: 'ambiguous', gmtCreate: '2029-11-01 10:00:00' },
      ],
    },
    orderPages: { 1: [inRangeOrder()] },
  });

  const result = await createCollector(pageClient).collect(collectionOptions());
  const collectedProjects = result.nested
    .filter((unit) => unit.type === 'project')
    .map((unit) => unit.id);

  assert.deepEqual(collectedProjects, ['fixture-project-related']);
  assert.ok(result.excluded.projects.some((project) => (
    project.id === 'fixture-project-without-related-order'
  )));
  const ambiguity = result.warnings.find((warning) => (
    warning.unitId === 'fixture-project-without-related-order'
  ));
  assert.ok(ambiguity, 'a no-date project without a related order must be traceable');
  assert.match(`${ambiguity.code || ''} ${ambiguity.message || ''}`, /date|scope|unknown|ambiguous/i);
});

test('modelPage rejects a response whose pageNo does not match the requested page', () => {
  assert.throws(
    () => modelPage(pageEnvelope([{ id: 'fixture-row-from-page-one' }], {
      pageNo: 1,
      pageSize: 1,
      totalCount: 2,
      totalPages: 2,
      hasNext: false,
    }), 2),
    /pageNo|page number|requested page|mismatch/i,
  );
});

test('duplicate project rows across pages cannot reconcile to a complete collection', async () => {
  const duplicateProject = {
    id: 'fixture-duplicate-project',
    projectName: 'duplicate',
    startTime: '2030-01-01',
    endTime: '2030-01-07',
  };
  const pageClient = createScenarioPageClient({
    projectPages: { 1: [duplicateProject], 2: [duplicateProject] },
    projectTotal: 2,
    projectTotalPages: 2,
    orderPages: { 1: [] },
    responsePageSize: 1,
  });

  const result = await createCollector(pageClient).collect(collectionOptions({ pageSize: 1 }));

  assert.notEqual(result.status, 'complete');
  assert.equal(result.reconciled, false);
  assert.match(JSON.stringify([...(result.errors || []), ...(result.warnings || [])]), /duplicate/i);
});

test('a non-empty content detail page without contentId or noteId makes schema and order partial', async () => {
  const pageClient = createScenarioPageClient({
    projectPages: { 1: [] },
    orderPages: { 1: [inRangeOrder()] },
    detailRows(payload) {
      if (payload.level === 'order' && payload.dataBatch === 'content') {
        return [{
          id: 'fixture-content-row-without-note-id',
          orderId: 'fixture-settle-001',
          projectId: 'fixture-project-related',
          ds: '20300104',
          readUv1d: 5,
        }];
      }
      return defaultDetailRows(payload);
    },
  });

  const result = await createCollector(pageClient).collect(collectionOptions());
  const order = result.nested.find((unit) => unit.type === 'order');

  assert.equal(result.status, 'partial');
  assert.equal(result.schemaValid, false);
  assert.equal(order.status, 'partial');
  assert.match(JSON.stringify(result.errors), /contentId|noteId|content id/i);
});

test('null and empty maxPages mean unlimited rather than truncating after page one', async (t) => {
  for (const [label, maxPages] of [['null', null], ['empty string', '']]) {
    await t.test(label, async () => {
      const pageClient = createScenarioPageClient({
        projectPages: {
          1: [{ id: `fixture-outside-${label}-1`, startTime: '2029-01-01', endTime: '2029-01-02' }],
          2: [{ id: `fixture-outside-${label}-2`, startTime: '2029-02-01', endTime: '2029-02-02' }],
        },
        projectTotal: 2,
        projectTotalPages: 2,
        orderPages: { 1: [] },
        responsePageSize: 1,
      });

      const result = await createCollector(pageClient).collect(collectionOptions({
        runId: `fixture-max-pages-${label}`,
        pageSize: 1,
        maxPages,
      }));

      assert.equal(result.lists.projects.status, 'complete');
      assert.equal(result.lists.projects.pageCount, 2);
      assert.equal(result.lists.projects.truncated, false);
      assert.deepEqual(
        pageClient.calls
          .filter((call) => call.endpoint === 'projects.list')
          .map((call) => Number(call.payload.pageNo)),
        [1, 2],
      );
    });
  }
});

test('verified Star identity isolates cached rows even when runId and store binding are reused', async () => {
  const cache = createMemoryCache();
  const clientA = createScenarioPageClient({
    projectPages: {
      1: [{ id: 'fixture-account-a-project', startTime: '2029-01-01', endTime: '2029-01-02' }],
    },
    orderPages: { 1: [] },
  });
  const sharedOptions = collectionOptions({
    runId: 'fixture-shared-run-id',
    accountKey: 'fixture-shared-store-binding',
  });
  await createCollector(clientA, cache).collect(Object.assign({}, sharedOptions, {
    verifiedIdentity: 'fixture-star-identity-a',
  }));

  const clientB = createScenarioPageClient({
    projectPages: {
      1: [{ id: 'fixture-account-b-project', startTime: '2029-01-01', endTime: '2029-01-02' }],
    },
    orderPages: { 1: [] },
  });
  const resultB = await createCollector(clientB, cache).collect(Object.assign({}, sharedOptions, {
    verifiedIdentity: 'fixture-star-identity-b',
  }));

  assert.deepEqual(
    resultB.lists.projects.items.map((project) => project.id),
    ['fixture-account-b-project'],
  );
  assert.ok(
    clientB.calls.some((call) => call.endpoint === 'projects.list'),
    'a different verified identity must not reuse the first identity cache',
  );
});

test('tokenized URLs echoed in Star errors are redacted before returning collection evidence', async () => {
  const tokenizedUrl = 'https://adstar.alimama.com/api/one/order/list?_tb_token_=fixture-star-secret&bizCode=adstar';
  const pageClient = createScenarioPageClient({
    async beforeRequest(input) {
      if (input.endpoint !== 'projects.list') return undefined;
      const error = new Error(`Star request failed: url=${tokenizedUrl}`);
      error.retryable = false;
      throw error;
    },
  });

  const result = await createCollector(pageClient).collect(collectionOptions({
    runId: 'fixture-token-error-run',
  }));
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('fixture-star-secret'), false);
  assert.equal(serialized.includes('_tb_token_'), false);
});

function createIdentityDetailClient() {
  return createScenarioPageClient({
    projectPages: { 1: [] },
    orderPages: {
      1: [inRangeOrder({
        orderId: 'fixture-list-order-identity',
        buyOrderId: 'fixture-list-order-identity',
        settleSeqId: 'fixture-report-order-identity',
      })],
    },
    detailRows(payload) {
      if (payload.level === 'order' && payload.dataBatch === 'content') {
        return [{
          _source: { responseUrl: 'fixture large source metadata' },
          id: 'fixture-content-row-identity',
          orderId: 'fixture-report-order-identity',
          projectId: 'fixture-project-related',
          contentId: 'fixture-note-identity',
          ds: '20300104',
          readUv1d: 42,
          slrAttrItmOrdGmv1d: 99,
          rowMd5: 'fixture-row-hash',
          shardKey: 'fixture-shard-key',
          contentUrl: 'https://www.xiaohongshu.com/explore/fixture-note-identity?xsec_token=fixture-xsec-secret',
          ext: 'fixture-large-opaque-source-field'.repeat(100),
        }];
      }
      return defaultDetailRows(payload);
    },
  });
}

test('detail normalization preserves list order, report order and settlement identities separately', async () => {
  const result = await createCollector(createIdentityDetailClient()).collect(collectionOptions({
    runId: 'fixture-order-identities-run',
  }));
  const order = result.nested.find((unit) => unit.type === 'order');
  const content = order.details.content[0];

  assert.equal(content.listOrderId, 'fixture-list-order-identity');
  assert.equal(content.reportOrderId, 'fixture-report-order-identity');
  assert.equal(content.settleSeqId, 'fixture-report-order-identity');
});

test('contentRows is a compact analysis projection rather than a duplicate of source detail rows', async () => {
  const result = await createCollector(createIdentityDetailClient()).collect(collectionOptions({
    runId: 'fixture-content-projection-run',
  }));
  const content = result.contentRows[0];

  assert.equal(content.noteId, 'fixture-note-identity');
  assert.equal(content.contentId, 'fixture-note-identity');
  assert.equal(content.readUv1d, 42);
  assert.equal(content.slrAttrItmOrdGmv1d, 99);
  for (const sourceOnlyField of ['_source', 'ext', 'contentUrl', 'rowMd5', 'shardKey']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(content, sourceOnlyField),
      false,
      `contentRows must omit source-only field: ${sourceOnlyField}`,
    );
  }
});

test('background instantiates the Star collector instead of only importing its file', () => {
  const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'),
    'utf8',
  );
  assert.equal(
    /XhsAdstarCollector\s*\.\s*createAdstarCollector\s*\(/.test(backgroundSource),
    true,
    'background must create a runnable Star collector for the extension workflow',
  );
});
