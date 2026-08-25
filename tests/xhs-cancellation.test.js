const assert = require('node:assert/strict');
const test = require('node:test');

const { createPageClient } = require('../xhs/page-client');
const { collectPaginated, stableFingerprint, withRetry } = require('../xhs/collector-core');
const { createMemoryCache } = require('../xhs/local-cache');
const { createPgyCollector } = require('../xhs/pgy-collector');
const { createAdstarCollector } = require('../xhs/adstar-collector');
const { createJuguangCollector } = require('../xhs/juguang-collector');
const { createXhsRuntime, RUN_KEY_PREFIX, STATUS_KEY } = require('../xhs/runtime');

const RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function abortError(message = 'fixture operation aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  error.retryable = false;
  return error;
}

function pendingUntilAbort(signal, started) {
  started.resolve(signal);
  if (!signal || typeof signal.addEventListener !== 'function') {
    return Promise.reject(new Error('collector did not forward AbortSignal'));
  }
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function assertAbort(error) {
  return Boolean(error) && (
    error.name === 'AbortError' || error.code === 'ABORT_ERR' || /abort|cancel/i.test(error.message)
  );
}

test('page client aborts a pending 45-second request immediately', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const client = createPageClient({
    sendMessage() {
      return new Promise(() => {});
    },
  });
  const pending = client.request({
    tabId: 17,
    platform: 'pgy',
    endpoint: 'notes.list',
    payload: {},
    signal: controller.signal,
  });

  controller.abort('fixture user cancelled');
  await assert.rejects(pending, assertAbort);
});

test('collector-core aborts retry backoff and a pending page request', { timeout: 1000 }, async () => {
  const retryController = new AbortController();
  let attempts = 0;
  const retrying = withRetry(async () => {
    attempts += 1;
    const error = new Error('fixture transient failure');
    error.retryable = true;
    throw error;
  }, {
    retries: 5,
    baseDelayMs: 10000,
    maxDelayMs: 10000,
    signal: retryController.signal,
  });
  setTimeout(() => retryController.abort(), 10);
  await assert.rejects(retrying, assertAbort);
  assert.equal(attempts, 1, 'abort during backoff must prevent another retry');

  const pageController = new AbortController();
  const started = deferred();
  const paginated = collectPaginated({
    cache: createMemoryCache(),
    cacheKey: 'fixture:abort:page',
    fingerprint: stableFingerprint({ dataset: 'fixture-abort-page' }),
    signal: pageController.signal,
    fetchPage() {
      return pendingUntilAbort(pageController.signal, started);
    },
    parsePage(response) {
      return response;
    },
  });
  await started.promise;
  pageController.abort();
  await assert.rejects(paginated, assertAbort);
});

test('PGY and Star collectors forward signal and do not convert abort into failed evidence',
  { timeout: 1000 }, async () => {
    for (const fixture of [
      {
        name: 'pgy',
        create(pageClient) {
          return createPgyCollector({ pageClient, cache: createMemoryCache() });
        },
        input: { tabId: 61, runId: 'fixture-pgy-abort', accountKey: 'fixture-pgy', dateRange: RANGE },
      },
      {
        name: 'adstar',
        create(pageClient) {
          return createAdstarCollector({ pageClient, cache: createMemoryCache() });
        },
        input: {
          tabId: 73,
          runId: 'fixture-star-abort',
          accountKey: 'fixture-star',
          verifiedIdentity: 'fixture-star',
          dateRange: RANGE,
        },
      },
    ]) {
      const controller = new AbortController();
      const started = deferred();
      const pageClient = {
        request(input) {
          assert.equal(input.platform, fixture.name);
          return pendingUntilAbort(input.signal, started);
        },
      };
      const pending = fixture.create(pageClient).collect({ ...fixture.input, signal: controller.signal });
      const forwarded = await started.promise;
      assert.equal(forwarded, controller.signal, `${fixture.name} must forward the same signal`);
      controller.abort();
      await assert.rejects(pending, assertAbort, `${fixture.name} must rethrow abort`);
    }
  });

test('Juguang abort skips slow account restoration and forwards signal to account requests',
  { timeout: 1000 }, async () => {
    const controller = new AbortController();
    const reportStarted = deferred();
    const main = { vSellerId: 'fixture-main', advertiserId: 1001, accountType: 4, name: '虚构主账户' };
    const child = { vSellerId: 'fixture-child', advertiserId: 2001, accountType: 602, name: '虚构子账户' };
    let current = child;
    let switchCalls = 0;
    const pageClient = {
      async request(input) {
        assert.equal(input.signal, controller.signal);
        if (input.endpoint === 'accounts.current') return { ...current };
        if (input.endpoint === 'accounts.list') return { accounts: [main, child], total: 2 };
        if (input.endpoint === 'reports.query') {
          return pendingUntilAbort(input.signal, reportStarted);
        }
        throw new Error(`unexpected endpoint ${input.endpoint}`);
      },
    };
    const collector = createJuguangCollector({
      pageClient,
      cache: createMemoryCache(),
      async returnToMainAccount(input) {
        assert.equal(input.signal, controller.signal);
        current = main;
        return { ...main };
      },
      async switchAccount(input) {
        assert.equal(input.signal, controller.signal);
        switchCalls += 1;
        current = input.target;
        return { ...current };
      },
    });

    const pending = collector.collect({
      tabId: 81,
      runId: 'fixture-juguang-abort',
      accountKey: 'fixture-juguang',
      dateRange: RANGE,
      signal: controller.signal,
    });
    await reportStarted.promise;
    controller.abort();
    await assert.rejects(pending, assertAbort);
    assert.equal(switchCalls, 0, 'abort must not start the finally account-restore transition');
  });

function runtimeChrome(tabs, navigation, storageOptions = {}) {
  const storageWrites = [];
  const storageState = structuredClone(storageOptions.initial || {});
  let storageReads = 0;
  return {
    runtime: { id: 'fixture-extension', onMessage: { addListener() {} } },
    storage: {
      local: {
        async get(key) {
          storageReads += 1;
          const snapshot = structuredClone(storageState);
          if (typeof storageOptions.beforeGetReturn === 'function') {
            await storageOptions.beforeGetReturn({ key, snapshot, storageState, storageReads });
          }
          if (typeof key === 'string') return { [key]: snapshot[key] };
          return snapshot;
        },
        async set(value) {
          const safe = structuredClone(value);
          if (typeof storageOptions.beforeSet === 'function') {
            await storageOptions.beforeSet({ value: safe, storageState, storageWrites });
          }
          Object.assign(storageState, safe);
          storageWrites.push(safe);
        },
        async remove(key) {
          const keys = Array.isArray(key) ? key : [key];
          for (const entry of keys) delete storageState[entry];
        },
      },
    },
    tabs: {
      async query() { return structuredClone(tabs); },
      async update() { return new Promise(() => {}); },
    },
    scripting: { async executeScript() { return [{ result: true }]; } },
    webNavigation: navigation,
    fixture: { storageState, storageWrites },
  };
}

function completePlatform(platform) {
  return {
    platform,
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    receivedCount: 1,
    warnings: [],
    errors: [],
  };
}

test('runtime cancellation writes terminal cancelled status and releases the active run',
  { timeout: 1500 }, async () => {
    const chrome = runtimeChrome([
      { id: 61, url: 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage' },
    ]);
    const firstStarted = deferred();
    let calls = 0;
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('unused'); } },
      cache: createMemoryCache(),
      collectors: {
        pgy: () => ({
          collect(input) {
            calls += 1;
            if (calls > 1) return completePlatform('pgy');
            firstStarted.resolve(input.signal);
            return new Promise(() => {});
          },
        }),
      },
      allowLegacyNavigationFallback: true,
    });
    const controller = new AbortController();
    const first = runtime.run({
      runId: 'fixture-runtime-abort-1',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['pgy'],
      signal: controller.signal,
    });
    await firstStarted.promise;
    controller.abort();
    await assert.rejects(first, assertAbort);

    const latestStatus = chrome.fixture.storageWrites
      .filter((write) => write[STATUS_KEY])
      .at(-1)[STATUS_KEY];
    assert.equal(latestStatus.running, false);
    assert.equal(latestStatus.status, 'cancelled');

    const second = await runtime.run({
      runId: 'fixture-runtime-abort-2',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['pgy'],
    });
    assert.equal(second.status, 'complete', 'a new run must start immediately after abort settles');
  });

test('runtime cancellation closes every in-flight parallel platform as cancelled',
  { timeout: 1500 }, async () => {
    const chrome = runtimeChrome([
      { id: 60, url: 'https://adstar.alimama.com/portal/v2/pages/myAdstar/order/list.htm' },
      { id: 61, url: 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage' },
      { id: 62, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
    ]);
    const startedSignals = new Map();
    const collectors = Object.fromEntries(['adstar', 'pgy', 'juguang'].map((platform) => [
      platform,
      () => ({
        collect(input) {
          startedSignals.set(platform, input.signal);
          return pendingUntilAbort(input.signal, { resolve() {} });
        },
      }),
    ]));
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('unused'); } },
      cache: createMemoryCache(),
      collectors,
      allowLegacyNavigationFallback: true,
    });
    const controller = new AbortController();
    const runId = 'fixture-runtime-parallel-abort';
    const pending = runtime.run({
      runId,
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['adstar', 'pgy', 'juguang'],
      signal: controller.signal,
    });

    for (let turn = 0; turn < 20 && startedSignals.size < 3; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    try {
      assert.deepEqual(Array.from(startedSignals.keys()).sort(), ['adstar', 'juguang', 'pgy']);
    } catch (error) {
      controller.abort();
      await pending.catch(() => {});
      throw error;
    }

    controller.abort();
    await assert.rejects(pending, assertAbort);

    assert.ok(Array.from(startedSignals.values()).every((signal) => signal === controller.signal));
    const latestStatus = chrome.fixture.storageWrites
      .filter((write) => write[STATUS_KEY])
      .at(-1)[STATUS_KEY];
    assert.equal(latestStatus.running, false);
    assert.equal(latestStatus.status, 'cancelled');
    assert.deepEqual(
      Object.fromEntries(Object.entries(latestStatus.platforms).map(([platform, value]) => (
        [platform, value.status]
      ))),
      { adstar: 'cancelled', pgy: 'cancelled', juguang: 'cancelled' },
    );
    assert.equal(Object.hasOwn(chrome.fixture.storageState, `${RUN_KEY_PREFIX}${runId}`), false);
  });

test('runtime abort during either terminal write rolls back its archive and releases the run',
  { timeout: 2000 }, async () => {
    for (const terminalWrite of ['archive', 'status']) {
      const runId = `fixture-terminal-${terminalWrite}-abort`;
      const runKey = `${RUN_KEY_PREFIX}${runId}`;
      const writeReached = deferred();
      const releaseWrite = deferred();
      let gated = false;
      const chrome = runtimeChrome([
        { id: 61, url: 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage' },
      ], undefined, {
        beforeSet({ value }) {
          if (gated) return undefined;
          const isTarget = terminalWrite === 'archive'
            ? Object.hasOwn(value, runKey)
            : value[STATUS_KEY] && value[STATUS_KEY].running === false &&
              value[STATUS_KEY].status === 'complete';
          if (!isTarget) return undefined;
          gated = true;
          writeReached.resolve();
          return releaseWrite.promise;
        },
      });
      const runtime = createXhsRuntime({
        chrome,
        pageClient: { request() { throw new Error('unused'); } },
        cache: createMemoryCache(),
        collectors: {
          pgy: () => ({ collect() { return completePlatform('pgy'); } }),
        },
        allowLegacyNavigationFallback: true,
      });
      const controller = new AbortController();
      const pending = runtime.run({
        runId,
        accountKey: 'fixture-store',
        dateRange: RANGE,
        platforms: ['pgy'],
        signal: controller.signal,
      });

      await writeReached.promise;
      controller.abort();
      releaseWrite.resolve();
      await assert.rejects(pending, assertAbort);

      assert.equal(Object.hasOwn(chrome.fixture.storageState, runKey), false,
        `${terminalWrite} abort must not leave a completed run archive`);
      assert.equal(chrome.fixture.storageState[STATUS_KEY].running, false);
      assert.equal(chrome.fixture.storageState[STATUS_KEY].status, 'cancelled');

      const next = await runtime.run({
        runId: `${runId}-next`,
        accountKey: 'fixture-store',
        dateRange: RANGE,
        platforms: ['pgy'],
      });
      assert.equal(next.status, 'complete', `${terminalWrite} abort must release activeRunPromise`);
    }
  });

test('aborting a Juguang tabs.update keeps run ownership until the raw mutation settles',
  { timeout: 1500 }, async () => {
    const committed = new Set();
    const beforeNavigate = new Set();
    const event = (listeners) => ({
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    });
    const chrome = runtimeChrome([
      { id: 81, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
    ], {
      async getFrame() {
        return { documentId: 'fixture-before-abort' };
      },
      onCommitted: event(committed),
      onBeforeNavigate: event(beforeNavigate),
    });
    const rawUpdate = deferred();
    chrome.tabs.update = () => rawUpdate.promise;
    const transitionStarted = deferred();
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('identity probe must not run after abort'); } },
      cache: createMemoryCache(),
      collectors: {
        juguang: (dependencies) => ({
          async collect(input) {
            transitionStarted.resolve();
            await dependencies.switchAccount({
              tabId: input.tabId,
              target: { vSellerId: 'fixture-child', advertiserId: 2001, accountType: 602 },
              signal: input.signal,
            });
            return completePlatform('juguang');
          },
        }),
      },
      allowLegacyNavigationFallback: false,
      transitionTimeoutMs: 10000,
    });
    const controller = new AbortController();
    const pending = runtime.run({
      runId: 'fixture-juguang-transition-abort',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['juguang'],
      signal: controller.signal,
    });
    await transitionStarted.promise;
    while (committed.size === 0 || beforeNavigate.size === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controller.abort();
    await assert.rejects(pending, assertAbort);
    assert.equal(committed.size, 0);
    assert.equal(beforeNavigate.size, 0);
    assert.equal(chrome.fixture.storageState[STATUS_KEY].status, 'cancelled');

    const nextController = new AbortController();
    nextController.abort();
    const blocked = await runtime.run({
      runId: 'fixture-juguang-transition-overlap',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['juguang'],
      signal: nextController.signal,
    }).then(() => false, (error) => error && error.code === 'XHS_RUN_ACTIVE');
    rawUpdate.resolve({ id: 81 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(blocked, true, 'a late tabs.update must retain exclusive run ownership');

    const afterDrain = await runtime.run({
      runId: 'fixture-juguang-transition-after-drain',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['pgy'],
    });
    assert.notEqual(afterDrain.status, 'running');
  });

test('aborting return-to-main keeps run ownership until raw executeScript settles',
  { timeout: 1500 }, async () => {
    const committed = new Set();
    const beforeNavigate = new Set();
    const event = (listeners) => ({
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
    });
    const chrome = runtimeChrome([
      { id: 81, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=child' },
    ], {
      async getFrame() { return { documentId: 'fixture-return-before-abort' }; },
      onCommitted: event(committed),
      onBeforeNavigate: event(beforeNavigate),
    });
    const rawReturnAction = deferred();
    const returnActionStarted = deferred();
    const originalExecuteScript = chrome.scripting.executeScript;
    chrome.scripting.executeScript = (details) => {
      if (!details.func) return originalExecuteScript(details);
      returnActionStarted.resolve();
      return rawReturnAction.promise;
    };
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('identity probe must not run after abort'); } },
      cache: createMemoryCache(),
      collectors: {
        juguang: (dependencies) => ({
          collect(input) {
            return dependencies.returnToMainAccount({
              tabId: input.tabId,
              current: {
                vSellerId: 'child', advertiserId: 2001, accountType: 602,
                name: '虚构子账户',
              },
              signal: input.signal,
            });
          },
        }),
      },
      allowLegacyNavigationFallback: false,
      transitionTimeoutMs: 10000,
    });
    const controller = new AbortController();
    const pending = runtime.run({
      runId: 'fixture-return-main-abort',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['juguang'],
      signal: controller.signal,
    });
    await returnActionStarted.promise;
    controller.abort();
    await assert.rejects(pending, assertAbort);
    assert.equal(committed.size, 0);
    assert.equal(beforeNavigate.size, 0);
    assert.equal(chrome.fixture.storageState[STATUS_KEY].status, 'cancelled');

    const nextController = new AbortController();
    nextController.abort();
    const blocked = await runtime.run({
      runId: 'fixture-return-main-overlap',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['juguang'],
      signal: nextController.signal,
    }).then(() => false, (error) => error && error.code === 'XHS_RUN_ACTIVE');
    rawReturnAction.resolve([{ result: true }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(blocked, true, 'a late return-main action must retain exclusive run ownership');

    const afterDrain = await runtime.run({
      runId: 'fixture-return-main-after-drain',
      accountKey: 'fixture-store',
      dateRange: RANGE,
      platforms: ['pgy'],
    });
    assert.notEqual(afterDrain.status, 'running');
  });

test('runtime startup closes a stale running status without erasing safe completed platform state',
  async () => {
    const chrome = runtimeChrome([], undefined, {
      initial: {
        [STATUS_KEY]: {
          schemaVersion: 1,
          runId: 'fixture-stale-run',
          running: true,
          status: 'running',
          startedAt: '2030-01-01T00:00:00.000Z',
          updatedAt: '2030-01-01T00:01:00.000Z',
          requestedPlatforms: ['pgy', 'adstar'],
          platforms: {
            pgy: { status: 'running', accountLabel: '虚构蒲公英账户' },
            adstar: { status: 'complete', accountLabel: '虚构星河账户' },
          },
          rawResponse: 'fixture secret must not survive compaction',
        },
      },
    });
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('unused'); } },
      cache: createMemoryCache(),
      collectors: {},
      now: () => '2030-01-02T00:00:00.000Z',
    });

    await runtime.register();

    const recovered = chrome.fixture.storageState[STATUS_KEY];
    assert.equal(recovered.runId, 'fixture-stale-run');
    assert.equal(recovered.running, false);
    assert.equal(recovered.status, 'cancelled');
    assert.equal(recovered.finishedAt, '2030-01-02T00:00:00.000Z');
    assert.equal(recovered.updatedAt, '2030-01-02T00:00:00.000Z');
    assert.equal(recovered.platforms.pgy.status, 'cancelled');
    assert.equal(recovered.platforms.adstar.status, 'complete');
    assert.ok(recovered.errors.some((error) => error.code === 'XHS_RUN_INTERRUPTED'));
    assert.equal(Object.hasOwn(recovered, 'rawResponse'), false);
  });

test('startup recovery does not overwrite a newer status observed during its confirmation read',
  async () => {
    const stale = {
      schemaVersion: 1,
      runId: 'fixture-old-run',
      running: true,
      status: 'running',
      startedAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:01:00.000Z',
      requestedPlatforms: ['pgy'],
      platforms: { pgy: { status: 'running' } },
    };
    const newer = {
      ...stale,
      runId: 'fixture-newer-run',
      updatedAt: '2030-01-01T00:02:00.000Z',
    };
    const chrome = runtimeChrome([], undefined, {
      initial: { [STATUS_KEY]: stale },
      beforeGetReturn({ snapshot, storageState, storageReads }) {
        if (storageReads !== 2) return;
        snapshot[STATUS_KEY] = structuredClone(newer);
        storageState[STATUS_KEY] = structuredClone(newer);
      },
    });
    const runtime = createXhsRuntime({
      chrome,
      pageClient: { request() { throw new Error('unused'); } },
      cache: createMemoryCache(),
      collectors: {},
      now: () => '2030-01-02T00:00:00.000Z',
    });

    await runtime.register();

    assert.equal(chrome.fixture.storageState[STATUS_KEY].runId, 'fixture-newer-run');
    assert.equal(chrome.fixture.storageState[STATUS_KEY].running, true);
    assert.equal(chrome.fixture.storageWrites.length, 0);
  });
