const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  stableFingerprint,
  collectPaginated,
  withRetry,
} = require('../xhs/collector-core');
const {
  createMemoryCache,
  createIndexedDbCache,
} = require('../xhs/local-cache');

const localCacheSource = fs.readFileSync(
  path.join(__dirname, '..', 'xhs', 'local-cache.js'),
  'utf8'
);

function fictionalPages() {
  return {
    1: {
      items: [
        { noteId: 'fictional-note-001' },
        { noteId: 'fictional-note-002' },
      ],
      hasNext: true,
      nextPage: 2,
      total: 3,
      pageSize: 2,
    },
    2: {
      items: [{ noteId: 'fictional-note-003' }],
      hasNext: false,
      nextPage: null,
      total: 3,
      pageSize: 2,
    },
  };
}

function collectorOptions(overrides = {}) {
  const pages = overrides.pages || fictionalPages();
  return {
    cache: overrides.cache || createMemoryCache(),
    cacheKey: overrides.cacheKey || 'fictional:pgy:notes:2030-01',
    fingerprint: overrides.fingerprint || stableFingerprint({
      platform: 'pgy',
      dataset: 'notes',
      range: { from: '2030-01-01', to: '2030-01-07' },
      pageSize: 2,
    }),
    maxPages: overrides.maxPages,
    fetchPage: overrides.fetchPage || (async (page) => pages[page]),
    parsePage: overrides.parsePage || ((response) => response),
    onPage: overrides.onPage,
  };
}

test('stableFingerprint ignores object key order while preserving query meaning', () => {
  const first = stableFingerprint({
    platform: 'pgy',
    range: { from: '2030-01-01', to: '2030-01-07' },
    filters: ['fictional-brand-a', 'fictional-brand-b'],
  });
  const reordered = stableFingerprint({
    filters: ['fictional-brand-a', 'fictional-brand-b'],
    range: { to: '2030-01-07', from: '2030-01-01' },
    platform: 'pgy',
  });
  const changed = stableFingerprint({
    platform: 'pgy',
    range: { from: '2030-01-02', to: '2030-01-07' },
    filters: ['fictional-brand-a', 'fictional-brand-b'],
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test('commits each page and resumes from nextPage without accumulating the committed page twice', async () => {
  const cache = createMemoryCache();
  const fetches = [];
  const pages = fictionalPages();
  const base = collectorOptions({
    cache,
    maxPages: 1,
    fetchPage: async (page) => {
      fetches.push(page);
      return pages[page];
    },
  });

  const interruptedRun = await collectPaginated(base);
  assert.equal(interruptedRun.status, 'partial');
  assert.equal(interruptedRun.cacheKey, base.cacheKey);
  assert.equal(interruptedRun.fingerprint, base.fingerprint);
  assert.equal(interruptedRun.nextPage, 2);
  assert.deepEqual(
    interruptedRun.items.map((item) => item.noteId),
    ['fictional-note-001', 'fictional-note-002']
  );

  const resumedRun = await collectPaginated({
    ...base,
    maxPages: undefined,
  });

  assert.deepEqual(fetches, [1, 2], 'restart must fetch page 2 instead of page 1 again');
  assert.equal(resumedRun.status, 'complete');
  assert.equal(resumedRun.nextPage, null);
  assert.equal(resumedRun.receivedCount, 3);
  assert.deepEqual(
    resumedRun.items.map((item) => item.noteId),
    ['fictional-note-001', 'fictional-note-002', 'fictional-note-003']
  );
});

test('rejects resume when the cached fingerprint belongs to a different query', async () => {
  const cache = createMemoryCache();
  const initialFingerprint = stableFingerprint({
    platform: 'pgy',
    range: { from: '2030-01-01', to: '2030-01-07' },
  });
  const changedFingerprint = stableFingerprint({
    platform: 'pgy',
    range: { from: '2030-01-08', to: '2030-01-14' },
  });

  await collectPaginated(collectorOptions({
    cache,
    fingerprint: initialFingerprint,
    maxPages: 1,
  }));

  let changedQueryFetches = 0;
  await assert.rejects(
    collectPaginated(collectorOptions({
      cache,
      fingerprint: changedFingerprint,
      fetchPage: async () => {
        changedQueryFetches += 1;
        return fictionalPages()[1];
      },
    })),
    /fingerprint|query|查询条件/i
  );
  assert.equal(changedQueryFetches, 0, 'mismatched query must be rejected before requesting a page');
});

test('returns partial and truncated when maxPages stops an unfinished collection', async () => {
  const result = await collectPaginated(collectorOptions({ maxPages: 1 }));

  assert.equal(result.status, 'partial');
  assert.equal(result.truncated, true);
  assert.equal(result.nextPage, 2);
  assert.equal(result.receivedCount, 2);
  assert.ok(result.warnings.some((warning) => (
    warning.code === 'truncated_maxPages' || warning.limit === 'maxPages'
  )));
});

test('requestCancel stops collection after the committed page and before the next request', async () => {
  const requestedPages = [];
  const result = await collectPaginated(collectorOptions({
    fetchPage: async (page) => {
      requestedPages.push(page);
      return fictionalPages()[page];
    },
    onPage({ page, requestCancel }) {
      if (page === 1) requestCancel();
    },
  }));

  assert.deepEqual(requestedPages, [1]);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.nextPage, 2);
  assert.equal(result.receivedCount, 2);
  assert.deepEqual(
    result.items.map((item) => item.noteId),
    ['fictional-note-001', 'fictional-note-002']
  );
});

test('withRetry retries retryable failures and returns the eventual value', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error(`fictional retryable failure ${attempts}`);
      error.retryable = true;
      throw error;
    }
    return { ok: true, source: 'fictional-third-attempt' };
  }, {
    retries: 4,
    baseDelayMs: 0,
  });

  assert.deepEqual(result, { ok: true, source: 'fictional-third-attempt' });
  assert.equal(attempts, 3);
});

test('withRetry does not retry an error explicitly marked retryable=false', async () => {
  let attempts = 0;
  const fatalError = new Error('fictional non-retryable failure');
  fatalError.retryable = false;

  await assert.rejects(
    withRetry(async () => {
      attempts += 1;
      throw fatalError;
    }, {
      retries: 4,
      baseDelayMs: 0,
    }),
    (error) => error === fatalError
  );
  assert.equal(attempts, 1);
});

test('createIndexedDbCache reports a clear error when IndexedDB is unavailable', () => {
  assert.throws(
    () => createIndexedDbCache({ indexedDB: undefined }),
    /IndexedDB.+(?:required|unavailable|不可用|必须)/i
  );
});

test('IndexedDB cache declares the required stores, page index, and atomic page commit', () => {
  assert.match(localCacheSource, /createObjectStore\(\s*['"]runs['"]/);
  assert.match(localCacheSource, /createObjectStore\(\s*['"]pages['"]/);
  assert.match(localCacheSource, /createObjectStore\(\s*['"]datasets['"]/);
  assert.match(
    localCacheSource,
    /createIndex\(\s*['"]cacheKey['"]\s*,\s*['"]cacheKey['"]/
  );

  const commitStart = localCacheSource.search(/(?:async\s+)?commitPage\s*\(/);
  assert.ok(commitStart >= 0, 'IndexedDB cache must declare commitPage');
  const nextMethod = localCacheSource.slice(commitStart + 1).search(/\n\s*(?:async\s+)?[a-zA-Z]+\s*\(/);
  const commitEnd = nextMethod >= 0
    ? commitStart + 1 + nextMethod
    : localCacheSource.length;
  const commitSource = localCacheSource.slice(commitStart, commitEnd);

  assert.match(
    commitSource,
    /transaction\(\s*\[(?=[^\]]*['"]pages['"])(?=[^\]]*['"]datasets['"])[^\]]+\]\s*,\s*['"]readwrite['"]\s*\)/,
    'commitPage must atomically write pages and datasets in one readwrite transaction'
  );
});
