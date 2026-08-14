const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const runtimeResource = 'xhs/runtime.js';
const runtimePath = path.join(root, runtimeResource);
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const syncSource = fs.readFileSync(
  path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs'),
  'utf8',
);

const MESSAGE_TYPE = 'XHS_COLLECTION_START';
const STATUS_KEY = 'xhsCollectionStatusV1';
const RUN_KEY_PREFIX = 'xhsCollectionRunV1:';
const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});
const PLATFORM_TABS = Object.freeze([
  { id: 11, url: 'https://adstar.alimama.com/portal/v2/pages/myAdstar/order/list.htm' },
  { id: 12, url: 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage' },
  { id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
]);

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function importedWorkerScripts(source) {
  const match = source.match(/importScripts\s*\(([\s\S]*?)\)\s*;/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+\.js)['"]/g), (entry) => entry[1]);
}

function loadRuntime() {
  delete require.cache[runtimePath];
  return require(runtimePath);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function createFakeChrome(tabs = PLATFORM_TABS, options = {}) {
  const storageWrites = [];
  const runtimeListeners = [];
  const tabQueries = [];
  const tabUpdates = [];
  const scriptExecutions = [];
  return {
    runtime: {
      id: 'fixture-extension-id',
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
    storage: {
      local: {
        async set(value) {
          storageWrites.push(clone(value));
        },
      },
    },
    tabs: {
      async query(query) {
        tabQueries.push(clone(query));
        return clone(tabs);
      },
      async update(tabId, update) {
        tabUpdates.push({ tabId, update: clone(update) });
        return { id: tabId, url: update.url };
      },
    },
    scripting: {
      async executeScript(details) {
        scriptExecutions.push({
          target: clone(details && details.target),
          world: details && details.world,
          args: clone(details && details.args),
          hasFixedFunction: typeof (details && details.func) === 'function',
        });
        if (typeof options.executeScript === 'function') {
          return options.executeScript(details);
        }
        return [{ result: { ok: true } }];
      },
    },
    fixture: { runtimeListeners, storageWrites, tabQueries, tabUpdates, scriptExecutions },
  };
}

function allowedSender(overrides = {}) {
  return Object.assign({
    id: 'fixture-extension-id',
    url: 'https://tbdata.aizicheng.com/report.html',
    tab: {
      id: 101,
      url: 'https://tbdata.aizicheng.com/report.html',
    },
  }, overrides);
}

function runInput(overrides = {}) {
  return Object.assign({
    runId: 'fixture-xhs-run-001',
    accountKey: 'fixture-store-account-001',
    dateRange: DATE_RANGE,
    platforms: ['adstar', 'pgy', 'juguang'],
  }, overrides);
}

function completeResult(platform, extra = {}) {
  return Object.assign({
    schemaVersion: 1,
    platform,
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    expectedCount: 1,
    receivedCount: 1,
    warnings: [],
    errors: [],
    summary: { spend: 12.34 },
    normalizedRows: [{ noteId: `fictional-${platform}-note-001` }],
  }, extra);
}

function createCollectorFactories(collectByPlatform, dependencySink = {}) {
  return Object.fromEntries(['adstar', 'pgy', 'juguang'].map((platform) => [
    platform,
    (dependencies) => {
      dependencySink[platform] = dependencies;
      return {
        collect(input) {
          return collectByPlatform(platform, input, dependencies);
        },
      };
    },
  ]));
}

function createRuntimeOptions(overrides = {}) {
  const chrome = overrides.chrome || createFakeChrome();
  const cache = overrides.cache || {
    kind: 'fixture-indexeddb-cache',
    rawPages: ['fixture-indexeddb-secret-must-not-persist'],
  };
  const pageClient = overrides.pageClient || {
    async request() {
      throw new Error('pageClient should only be used by a collector or account switch');
    },
  };
  const collectByPlatform = overrides.collectByPlatform || ((platform) => (
    completeResult(platform)
  ));
  const dependencies = overrides.dependencies || {};
  return {
    chrome,
    options: {
      chrome,
      pageClient,
      cache,
      collectors: overrides.collectors || createCollectorFactories(collectByPlatform, dependencies),
      now: overrides.now || (() => '2030-01-08T00:00:00.000Z'),
      createRunId: overrides.createRunId || (() => 'fixture-generated-run-id'),
      wait: overrides.wait || (async () => {}),
      bridgeRetry: overrides.bridgeRetry || { attempts: 3, delayMs: 1 },
    },
    cache,
    dependencies,
  };
}

test('the standalone XHS runtime exists and exports the stable entry contract', () => {
  assert.equal(fs.existsSync(runtimePath), true, `缺少后台运行时：${runtimeResource}`);
  const runtimeModule = loadRuntime();
  assert.equal(runtimeModule.MESSAGE_TYPE, MESSAGE_TYPE);
  assert.equal(runtimeModule.STATUS_KEY, STATUS_KEY);
  assert.equal(runtimeModule.RUN_KEY_PREFIX, RUN_KEY_PREFIX);
  assert.equal(typeof runtimeModule.createXhsRuntime, 'function');
});

test('background loads, instantiates, and registers the XHS runtime', () => {
  assert.ok(importedWorkerScripts(backgroundSource).includes(runtimeResource));
  assert.match(backgroundSource, /XhsRuntime\.createXhsRuntime\s*\(/);
  assert.match(backgroundSource, /\.register\s*\(\s*\)/);
});

test('cloud extension ZIP explicitly packages the XHS runtime', () => {
  assert.ok(
    quotedLiteralPattern(runtimeResource).test(syncSource),
    `sync-web-tool.mjs 的 ZIP 资源清单缺少：${runtimeResource}`,
  );
});

test('runtime rejects unrelated message types and non-workbench senders', async () => {
  const runtimeModule = loadRuntime();
  let collectCount = 0;
  const fixture = createRuntimeOptions({
    collectByPlatform(platform) {
      collectCount += 1;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const unrelated = await runtime.handleMessage(
    { type: 'UNRELATED_MESSAGE', payload: runInput({ platforms: ['adstar'] }) },
    allowedSender(),
  );
  assert.deepEqual(unrelated, { handled: false });

  for (const sender of [
    allowedSender({ id: 'another-extension' }),
    allowedSender({ url: 'https://evil.tbdata.aizicheng.com/report.html' }),
    allowedSender({ url: 'https://tbdata.aizicheng.com/data.html' }),
    allowedSender({ url: 'https://tbdata.aizicheng.com.evil.example/report.html' }),
  ]) {
    const denied = await runtime.handleMessage(
      { type: MESSAGE_TYPE, payload: runInput({ platforms: ['adstar'] }) },
      sender,
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'XHS_SENDER_DENIED');
  }
  assert.equal(collectCount, 0);
  assert.equal(fixture.chrome.fixture.storageWrites.length, 0);
});

test('runtime register exposes the guarded message entry through chrome.runtime', () => {
  const runtimeModule = loadRuntime();
  const fixture = createRuntimeOptions();
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  runtime.register();
  assert.equal(fixture.chrome.fixture.runtimeListeners.length, 1);

  let response;
  const keepOpen = fixture.chrome.fixture.runtimeListeners[0](
    { type: MESSAGE_TYPE, payload: runInput({ platforms: ['adstar'] }) },
    allowedSender(),
    (value) => { response = value; },
  );
  assert.equal(keepOpen, true);
  assert.equal(response, undefined);
});

test('runtime discovers exact platform origins and reports a missing login tab without collecting', async () => {
  const runtimeModule = loadRuntime();
  let collectCount = 0;
  const chrome = createFakeChrome([
    { id: 91, url: 'https://evil.pgy.xiaohongshu.com/solar/post-trade/content-manage' },
    { id: 92, url: 'http://pgy.xiaohongshu.com/solar/post-trade/content-manage' },
    { id: 93, url: 'https://pgy.xiaohongshu.com.evil.example/fixture' },
  ]);
  const fixture = createRuntimeOptions({
    chrome,
    collectByPlatform(platform) {
      collectCount += 1;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const result = await runtime.run(runInput({ platforms: ['pgy'] }));

  assert.equal(collectCount, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.platforms.pgy.status, 'failed');
  assert.equal(result.platforms.pgy.errors[0].code, 'XHS_PLATFORM_TAB_MISSING');
  assert.match(result.platforms.pgy.errors[0].message, /蒲公英/);
  assert.match(result.platforms.pgy.errors[0].message, /https:\/\/pgy\.xiaohongshu\.com/);
});

test('runtime refuses ambiguous duplicate exact-origin tabs for every XHS platform', async (t) => {
  const runtimeModule = loadRuntime();
  const cases = [
    {
      platform: 'adstar',
      name: '淘宝星河',
      origin: 'https://adstar.alimama.com',
      nearOrigin: 'https://evil.adstar.alimama.com',
    },
    {
      platform: 'pgy',
      name: '蒲公英',
      origin: 'https://pgy.xiaohongshu.com',
      nearOrigin: 'https://evil.pgy.xiaohongshu.com',
    },
    {
      platform: 'juguang',
      name: '聚光',
      origin: 'https://ad.xiaohongshu.com',
      nearOrigin: 'https://evil.ad.xiaohongshu.com',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.platform, async () => {
      let collectCount = 0;
      const chrome = createFakeChrome([
        { id: 201, url: `${entry.origin}/fixture/first` },
        { id: 202, url: `${entry.origin}/fixture/second` },
        { id: 203, url: `${entry.nearOrigin}/fixture/not-exact` },
      ]);
      const fixture = createRuntimeOptions({
        chrome,
        collectByPlatform(platform) {
          collectCount += 1;
          return completeResult(platform);
        },
      });
      const runtime = runtimeModule.createXhsRuntime(fixture.options);

      const result = await runtime.run(runInput({
        runId: `fixture-ambiguous-${entry.platform}`,
        platforms: [entry.platform],
      }));

      assert.equal(collectCount, 0, 'ambiguous tabs must not reach a collector');
      assert.equal(result.status, 'failed');
      assert.equal(result.platforms[entry.platform].status, 'failed');
      assert.equal(
        result.platforms[entry.platform].errors[0].code,
        'XHS_PLATFORM_TAB_AMBIGUOUS',
      );
      assert.match(result.platforms[entry.platform].errors[0].message, new RegExp(entry.name));
      assert.match(result.platforms[entry.platform].errors[0].message, /关闭.*重复.*标签/);
    });
  }
});

test('runtime invokes adstar and pgy collectors with their exact tabs and shared run scope', async () => {
  const runtimeModule = loadRuntime();
  const calls = [];
  const fixture = createRuntimeOptions({
    collectByPlatform(platform, input) {
      calls.push({ platform, input: clone(input) });
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const result = await runtime.run(runInput({ platforms: ['adstar', 'pgy'] }));

  assert.equal(result.status, 'complete');
  assert.deepEqual(calls.map((call) => call.platform), ['adstar', 'pgy']);
  assert.deepEqual(calls.map((call) => call.input.tabId), [11, 12]);
  for (const call of calls) {
    assert.equal(call.input.runId, 'fixture-xhs-run-001');
    assert.equal(call.input.accountKey, 'fixture-store-account-001');
    assert.deepEqual(call.input.dateRange, DATE_RANGE);
  }
  assert.equal(fixture.dependencies.adstar.cache, fixture.cache);
  assert.equal(fixture.dependencies.pgy.cache, fixture.cache);
  assert.equal(fixture.dependencies.adstar.pageClient, fixture.options.pageClient);
  assert.equal(fixture.dependencies.pgy.pageClient, fixture.options.pageClient);
});

test('runtime gives juguang a real tabs.update switch, waits for its bridge, and strongly verifies identity', async () => {
  const runtimeModule = loadRuntime();
  const target = {
    vSellerId: 'fictional-vseller-001',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构聚光子账户',
  };
  let currentAttempts = 0;
  let waitCalls = 0;
  const pageClient = {
    async request(input) {
      assert.equal(input.platform, 'juguang');
      assert.equal(input.endpoint, 'accounts.current');
      currentAttempts += 1;
      if (currentAttempts === 1) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return clone(target);
    },
  };
  const fixture = createRuntimeOptions({
    pageClient,
    wait: async () => { waitCalls += 1; },
    collectByPlatform: async (platform, input, dependencies) => {
      assert.equal(platform, 'juguang');
      await dependencies.switchAccount({
        tabId: input.tabId,
        target,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      return completeResult('juguang');
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(fixture.chrome.fixture.tabUpdates.length, 1);
  const update = fixture.chrome.fixture.tabUpdates[0];
  const url = new URL(update.update.url);
  assert.equal(update.tabId, 13);
  assert.equal(url.origin, 'https://ad.xiaohongshu.com');
  assert.equal(url.pathname, '/aurora/ad/datareports-basic/note');
  assert.equal(url.searchParams.get('vSellerId'), target.vSellerId);
  assert.equal(currentAttempts, 2);
  assert.equal(waitCalls, 1);
});

test('runtime retries a stale Juguang identity after child-account navigation until the target appears', async () => {
  const runtimeModule = loadRuntime();
  const previous = {
    vSellerId: null,
    advertiserId: 654321,
    accountType: 4,
    name: '虚构聚光原主账户',
  };
  const target = {
    vSellerId: 'fictional-vseller-stale-switch-target',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构聚光目标子账户',
  };
  let currentAttempts = 0;
  let waitCalls = 0;
  const fixture = createRuntimeOptions({
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        currentAttempts += 1;
        return clone(currentAttempts === 1 ? previous : target);
      },
    },
    wait: async () => { waitCalls += 1; },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.switchAccount({
        tabId: input.tabId,
        target,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      assert.equal(verified.vSellerId, target.vSellerId);
      assert.equal(verified.advertiserId, target.advertiserId);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(currentAttempts, 2);
  assert.equal(waitCalls, 1);
});

test('runtime marks juguang failed when post-navigation account identity does not match', async () => {
  const runtimeModule = loadRuntime();
  const target = {
    vSellerId: 'fictional-vseller-expected',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构目标账户',
  };
  const fixture = createRuntimeOptions({
    pageClient: {
      async request() {
        return Object.assign({}, target, { vSellerId: 'fictional-vseller-wrong' });
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.switchAccount({
        tabId: input.tabId,
        target,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      throw new Error('collector must not continue after an identity mismatch');
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.status, 'failed');
  assert.equal(result.platforms.juguang.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'XHS_COLLECTION_FAILED');
  assert.match(result.platforms.juguang.errors[0].message, /vSellerId|identity|账户/i);
});

test('runtime runs three sources serially, propagates partial independently, and stores only compact output', async () => {
  const runtimeModule = loadRuntime();
  const lifecycle = [];
  let active = 0;
  let maxActive = 0;
  const fixture = createRuntimeOptions({
    collectByPlatform: async (platform) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      lifecycle.push(`start:${platform}`);
      await new Promise((resolve) => setImmediate(resolve));
      lifecycle.push(`finish:${platform}`);
      active -= 1;
      const status = platform === 'pgy' ? 'partial' : 'complete';
      return completeResult(platform, {
        status,
        rawData: { marker: 'fixture-raw-data-prefix-must-not-persist' },
        rawBody: { marker: 'fixture-raw-body-prefix-must-not-persist' },
        checkpointMeta: { marker: 'fixture-checkpoint-meta-prefix-must-not-persist' },
        qualityEvidence: {
          safeMetric: 7,
          rawPayload: { marker: 'fixture-nested-raw-prefix-must-not-persist' },
          checkpointState: { marker: 'fixture-nested-checkpoint-prefix-must-not-persist' },
        },
        raw: {
          cookie: 'fixture-raw-cookie-must-not-persist',
          response: { pages: ['fixture-raw-page-must-not-persist'] },
        },
        indexedDb: fixture && fixture.cache,
        pages: [{ rows: ['fixture-page-array-must-not-persist'] }],
        checkpoint: {
          cacheKey: `xhs:fixture:${platform}:raw-pages`,
          fingerprint: 'fixture-cache-fingerprint',
          status,
          receivedCount: 1,
        },
        errors: status === 'partial'
          ? [{ code: 'fixture_partial', message: '虚构蒲公英分页中断' }]
          : [],
      });
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const result = await runtime.run(runInput());

  assert.equal(maxActive, 1);
  assert.deepEqual(lifecycle, [
    'start:adstar', 'finish:adstar',
    'start:pgy', 'finish:pgy',
    'start:juguang', 'finish:juguang',
  ]);
  assert.equal(result.status, 'partial');
  assert.equal(result.platforms.adstar.status, 'complete');
  assert.equal(result.platforms.pgy.status, 'partial');
  assert.equal(result.platforms.juguang.status, 'complete');

  const statusWrites = fixture.chrome.fixture.storageWrites
    .filter((write) => Object.prototype.hasOwnProperty.call(write, STATUS_KEY));
  assert.ok(statusWrites.length >= 2);
  const finalStatus = statusWrites.at(-1)[STATUS_KEY];
  assert.equal(finalStatus.running, false);
  assert.equal(finalStatus.status, 'partial');
  assert.equal(finalStatus.runId, 'fixture-xhs-run-001');
  assert.equal(finalStatus.platforms.pgy.status, 'partial');

  const runWrite = fixture.chrome.fixture.storageWrites.find((write) => (
    Object.prototype.hasOwnProperty.call(write, `${RUN_KEY_PREFIX}fixture-xhs-run-001`)
  ));
  assert.ok(runWrite, '缺少紧凑临时运行写入');
  const compactRun = runWrite[`${RUN_KEY_PREFIX}fixture-xhs-run-001`];
  assert.equal(compactRun.platforms.pgy.status, 'partial');
  assert.deepEqual(compactRun.platforms.adstar.normalizedRows, [
    { noteId: 'fictional-adstar-note-001' },
  ]);
  const serializedStorage = JSON.stringify(fixture.chrome.fixture.storageWrites);
  for (const forbidden of [
    'fixture-indexeddb-secret-must-not-persist',
    'fixture-raw-cookie-must-not-persist',
    'fixture-raw-page-must-not-persist',
    'fixture-page-array-must-not-persist',
    'fixture-cache-fingerprint',
    'fixture-raw-data-prefix-must-not-persist',
    'fixture-raw-body-prefix-must-not-persist',
    'fixture-checkpoint-meta-prefix-must-not-persist',
    'fixture-nested-raw-prefix-must-not-persist',
    'fixture-nested-checkpoint-prefix-must-not-persist',
  ]) {
    assert.equal(serializedStorage.includes(forbidden), false, `chrome.storage 泄露：${forbidden}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(compactRun.platforms.pgy, 'raw'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compactRun.platforms.pgy, 'pages'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compactRun.platforms.pgy, 'indexedDb'), false);
  assert.deepEqual(compactRun.platforms.pgy.qualityEvidence, { safeMetric: 7 });
});

test('runtime rejects a concurrent second run before it can invoke another collector', async () => {
  const runtimeModule = loadRuntime();
  const firstCollectorStarted = deferred();
  const releaseFirstCollector = deferred();
  let collectCount = 0;
  const fixture = createRuntimeOptions({
    collectByPlatform: async (platform) => {
      collectCount += 1;
      if (collectCount === 1) {
        firstCollectorStarted.resolve();
        await releaseFirstCollector.promise;
      }
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const firstResponsePromise = runtime.handleMessage(
    { type: MESSAGE_TYPE, payload: runInput({ runId: 'fixture-active-run-001', platforms: ['adstar'] }) },
    allowedSender(),
  );
  await firstCollectorStarted.promise;
  const secondResponse = await runtime.handleMessage(
    { type: MESSAGE_TYPE, payload: runInput({ runId: 'fixture-overlapping-run-002', platforms: ['adstar'] }) },
    allowedSender(),
  );
  releaseFirstCollector.resolve();
  const firstResponse = await firstResponsePromise;

  assert.equal(firstResponse.ok, true);
  assert.equal(secondResponse.ok, false);
  assert.equal(secondResponse.code, 'XHS_RUN_ACTIVE');
  assert.equal(collectCount, 1, 'the rejected run must not reach a collector');
});

test('runtime never publishes complete while requested platform work is still running', async () => {
  const runtimeModule = loadRuntime();
  const fixture = createRuntimeOptions();
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  await runtime.run(runInput());

  const statuses = fixture.chrome.fixture.storageWrites
    .filter((write) => Object.prototype.hasOwnProperty.call(write, STATUS_KEY))
    .map((write) => write[STATUS_KEY]);
  const inFlightStatuses = statuses.filter((status) => status.running === true);
  assert.ok(inFlightStatuses.length >= 2, 'the run should publish observable progress');
  assert.ok(inFlightStatuses.every((status) => status.status !== 'complete'),
    'complete is terminal and must not be published before all requested platforms finish');
  assert.equal(statuses.at(-1).running, false);
  assert.equal(statuses.at(-1).status, 'complete');
});

test('runtime finalizes a started run as failed when an outer orchestration dependency throws', async () => {
  const runtimeModule = loadRuntime();
  const chrome = createFakeChrome();
  chrome.tabs.query = async () => {
    throw new Error('fictional tabs query failure');
  };
  const fixture = createRuntimeOptions({ chrome });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  try {
    await runtime.run(runInput({ platforms: ['adstar'] }));
  } catch (error) {}

  const statuses = fixture.chrome.fixture.storageWrites
    .filter((write) => Object.prototype.hasOwnProperty.call(write, STATUS_KEY))
    .map((write) => write[STATUS_KEY]);
  assert.ok(statuses.length >= 2, 'a started run must publish a terminal status even on outer failure');
  assert.equal(statuses.at(-1).running, false);
  assert.equal(statuses.at(-1).status, 'failed');
});

test('runtime handleMessage redacts tokenized errors from outer run failures', async () => {
  const runtimeModule = loadRuntime();
  const secret = 'fictional-handle-secret-must-not-leak';
  const chrome = createFakeChrome();
  chrome.tabs.query = async () => {
    throw new Error(`failed https://example.invalid/api?advertiserId=42&access_token=${secret}`);
  };
  const fixture = createRuntimeOptions({ chrome });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const response = await runtime.handleMessage(
    { type: MESSAGE_TYPE, payload: runInput({ platforms: ['adstar'] }) },
    allowedSender(),
  );
  const serialized = JSON.stringify(response);

  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('access_token'), false);
});

test('runtime register redacts tokenized errors even when guarded dispatch itself rejects', async () => {
  const runtimeModule = loadRuntime();
  const secret = 'fictional-register-secret-must-not-leak';
  const fixture = createRuntimeOptions();
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  runtime.register();
  Object.defineProperty(fixture.chrome.runtime, 'id', {
    configurable: true,
    get() {
      throw new Error(`dispatch failed https://example.invalid/api?access_token=${secret}`);
    },
  });

  const response = await new Promise((resolve) => {
    const keepOpen = fixture.chrome.fixture.runtimeListeners[0](
      { type: MESSAGE_TYPE, payload: runInput({ platforms: ['adstar'] }) },
      allowedSender(),
      resolve,
    );
    assert.equal(keepOpen, true);
  });
  const serialized = JSON.stringify(response);

  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('access_token'), false);
});

test('runtime injects a fixed DOM return-to-main workflow and verifies Juguang accountType 4', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller', advertiserId: 2001, accountType: 602,
  };
  const main = {
    vSellerId: null, advertiserId: 1001, accountType: 4,
  };
  let returnedToMain = false;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript() {
      returnedToMain = true;
      return [{ result: true }];
    },
  });
  const pageClientCalls = [];
  const pageClient = {
    async request(input) {
      pageClientCalls.push(clone(input));
      assert.equal(input.platform, 'juguang');
      assert.equal(input.endpoint, 'accounts.current');
      return clone(returnedToMain ? main : child);
    },
  };
  let dependencyType = 'missing';
  const fixture = createRuntimeOptions({
    chrome,
    pageClient,
    collectByPlatform: async (platform, input, dependencies) => {
      dependencyType = typeof dependencies.returnToMainAccount;
      if (dependencyType === 'function') {
        const verified = await dependencies.returnToMainAccount({
          tabId: input.tabId,
          current: child,
        });
        assert.equal(verified.accountType, 4);
        assert.equal(verified.advertiserId, 1001);
      }
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.status, 'complete');
  assert.equal(dependencyType, 'function');
  assert.ok(chrome.fixture.scriptExecutions.length >= 1);
  assert.ok(chrome.fixture.scriptExecutions.every((execution) => (
    execution.target.tabId === 13 && execution.target.allFrames !== true && execution.hasFixedFunction
  )), 'the fixed DOM workflow must stay in the target tab top frame');
  assert.ok(pageClientCalls.length >= 1, 'accountType 4 must be verified after the DOM action');
});

test('runtime retries a stale child identity after returning to the Juguang main account', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-stale-return', advertiserId: 2001, accountType: 602,
  };
  const main = {
    vSellerId: null, advertiserId: 1001, accountType: 4,
  };
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript() {
      return [{ result: true }];
    },
  });
  let currentAttempts = 0;
  let waitCalls = 0;
  const fixture = createRuntimeOptions({
    chrome,
    wait: async () => { waitCalls += 1; },
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        currentAttempts += 1;
        return clone(currentAttempts === 1 ? child : main);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(verified.accountType, 4);
      assert.equal(verified.advertiserId, main.advertiserId);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(currentAttempts, 2);
  assert.equal(waitCalls, 1);
  assert.equal(chrome.fixture.scriptExecutions.length, 1);
});
