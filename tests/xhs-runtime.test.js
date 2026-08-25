const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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
  const tabCreates = [];
  const tabRemovals = [];
  const scriptExecutions = [];
  const mutableTabs = typeof tabs === 'function' ? null : clone(tabs);
  let nextTabId = Math.max(100, ...(mutableTabs || []).map((tab) => Number(tab.id) || 0)) + 1;
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
        return clone(typeof tabs === 'function' ? tabs(tabQueries.length) : mutableTabs);
      },
      async create(createProperties) {
        const tab = {
          id: nextTabId,
          url: createProperties.url || 'about:blank',
          status: 'complete',
          active: createProperties.active !== false,
        };
        nextTabId += 1;
        tabCreates.push({ properties: clone(createProperties), tab: clone(tab) });
        if (mutableTabs) mutableTabs.push(tab);
        return clone(tab);
      },
      async update(tabId, update) {
        tabUpdates.push({ tabId, update: clone(update) });
        if (mutableTabs) {
          const tab = mutableTabs.find((entry) => Number(entry.id) === Number(tabId));
          if (tab && update.url) tab.url = update.url;
        }
        return { id: tabId, url: update.url, status: 'complete' };
      },
      async remove(tabIds) {
        const ids = (Array.isArray(tabIds) ? tabIds : [tabIds]).map(Number);
        tabRemovals.push(ids);
        if (mutableTabs) {
          for (let index = mutableTabs.length - 1; index >= 0; index -= 1) {
            if (ids.includes(Number(mutableTabs[index].id))) mutableTabs.splice(index, 1);
          }
        }
      },
    },
    scripting: {
      async executeScript(details) {
        scriptExecutions.push({
          target: clone(details && details.target),
          world: details && details.world,
          args: clone(details && details.args),
          injectImmediately: details && details.injectImmediately === true,
          hasFixedFunction: typeof (details && details.func) === 'function',
        });
        if (typeof options.executeScript === 'function') {
          return options.executeScript(details);
        }
        return [{ result: { ok: true } }];
      },
    },
    fixture: {
      runtimeListeners,
      storageWrites,
      tabQueries,
      tabUpdates,
      tabCreates,
      tabRemovals,
      scriptExecutions,
    },
  };
}

async function executeInjectedFunction(details, document) {
  let clock = 0;
  class FakeDate extends Date {
    static now() {
      return clock;
    }
  }
  const context = vm.createContext({
    Date: FakeDate,
    document,
    Promise,
    setTimeout(resolve, delayMs) {
      clock += Math.max(0, Number(delayMs) || 0);
      resolve();
    },
  });
  const injected = vm.runInContext(`(${details.func.toString()})`, context);
  return [{ result: await injected(...clone(details.args || [])) }];
}

async function executeInjectedFunctionWithRealTimers(details, document) {
  const context = vm.createContext({
    Date,
    document,
    Promise,
    setTimeout,
  });
  const injected = vm.runInContext(`(${details.func.toString()})`, context);
  return [{ result: await injected(...clone(details.args || [])) }];
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
      allowLegacyNavigationFallback: overrides.allowLegacyNavigationFallback !== false,
      transitionTimeoutMs: overrides.transitionTimeoutMs,
      identityProbeTimeoutMs: overrides.identityProbeTimeoutMs,
      monotonicNow: overrides.monotonicNow,
      probeVerification: overrides.probeVerification,
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
  assert.equal(runtimeModule.VERIFICATION_REQUIRED_CODE, 'VERIFICATION_REQUIRED');
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
  assert.equal(
    fixture.dependencies.adstar.pageClient,
    fixture.dependencies.pgy.pageClient,
    'all collectors must share the same runtime-owned recovery client',
  );
  assert.equal(typeof fixture.dependencies.adstar.pageClient.request, 'function');
});

test('runtime creates, pins, and closes isolated temporary Juguang tabs for the collector', async () => {
  const runtimeModule = loadRuntime();
  const identities = new Map();
  const requests = [];
  const pageClient = {
    async request(input) {
      requests.push(clone(input));
      if (input.endpoint === 'accounts.current') return clone(identities.get(Number(input.tabId)));
      if (input.endpoint === 'reports.query') return { servedByTabId: Number(input.tabId) };
      throw new Error(`unexpected fixture endpoint: ${input.endpoint}`);
    },
  };
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        const tabIds = await dependencies.createConcurrentAccountTabs({
          count: 2,
          sourceTabId: input.tabId,
          signal: input.signal,
        });
        assert.equal(tabIds.length, 2);
        const targets = tabIds.map((tabId, index) => ({
          vSellerId: `fixture-child-${index + 1}`,
          advertiserId: 7001 + index,
          accountType: 602,
          name: `虚构临时账户${index + 1}`,
        }));
        for (let index = 0; index < tabIds.length; index += 1) {
          identities.set(Number(tabIds[index]), clone(targets[index]));
          await dependencies.switchAccount({
            tabId: tabIds[index],
            target: targets[index],
            pinnedTabId: true,
            signal: input.signal,
          });
        }
        const report = await dependencies.pageClient.request({
          tabId: tabIds[0],
          platform: 'juguang',
          endpoint: 'reports.query',
          payload: {},
          pinnedTabId: true,
          signal: input.signal,
        });
        assert.equal(report.servedByTabId, tabIds[0],
          'a temporary lane request must not be redirected to the original tab');
        await dependencies.closeConcurrentAccountTabs({ tabIds });
        return completeResult('juguang');
      },
    }),
  };
  const chrome = createFakeChrome([
    { id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
  ]);
  identities.set(13, {
    vSellerId: null, advertiserId: 7000, accountType: 4, name: '虚构主账户',
  });
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-juguang-temporary-tabs',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(chrome.fixture.tabCreates.length, 2);
  assert.deepEqual(chrome.fixture.tabCreates.map((entry) => entry.properties), [
    { url: 'about:blank', active: false },
    { url: 'about:blank', active: false },
  ]);
  assert.deepEqual(chrome.fixture.tabRemovals, [[101, 102]]);
  assert.ok(requests.some((request) => (
    request.endpoint === 'reports.query' && request.tabId === 101
  )));
});

test('runtime rejects every XHS source with an enriched verification signal before collecting when the reader confirms a challenge', async (t) => {
  const runtimeModule = loadRuntime();
  for (const [platform, tabId] of [['adstar', 11], ['pgy', 12], ['juguang', 13]]) {
    await t.test(platform, async () => {
      const probes = [];
      let collectCount = 0;
      const fixture = createRuntimeOptions({
        probeVerification(input) {
          probes.push(clone(input));
          return { kind: 'verification' };
        },
        collectByPlatform(selectedPlatform) {
          collectCount += 1;
          return completeResult(selectedPlatform);
        },
      });
      const runtime = runtimeModule.createXhsRuntime(fixture.options);

      await assert.rejects(
        runtime.run(runInput({
          runId: `fixture-pre-collection-verification-${platform}`,
          platforms: [platform],
        })),
        (error) => {
          assert.equal(error.code, 'VERIFICATION_REQUIRED');
          assert.equal(error.platform, platform);
          assert.equal(error.tabId, tabId);
          assert.equal(error.retryable, false);
          assert.match(error.message, /验证/);
          return true;
        },
      );

      assert.equal(collectCount, 0, '已确认的验证页不得继续调用采集器');
      assert.deepEqual(probes, [{ platform, tabId }]);
    });
  }
});

test('runtime preserves Promise.allSettled before propagating verification confirmed after a collector error', async () => {
  const runtimeModule = loadRuntime();
  const releasePgy = deferred();
  let adstarProbeCount = 0;
  let verificationObserved = false;
  let pgyStarted = false;
  const fixture = createRuntimeOptions({
    probeVerification({ platform, tabId }) {
      if (platform === 'adstar') {
        adstarProbeCount += 1;
        if (adstarProbeCount === 2) {
          verificationObserved = true;
          return { kind: 'verification' };
        }
      }
      assert.equal(tabId, platform === 'adstar' ? 11 : 12);
      return { kind: 'productReady' };
    },
    async collectByPlatform(platform) {
      if (platform === 'adstar') {
        const error = new Error('fixture HTTP 403');
        error.code = 'ADSTAR_API_ERROR';
        error.retryable = false;
        throw error;
      }
      pgyStarted = true;
      await releasePgy.promise;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const running = runtime.run(runInput({ platforms: ['adstar', 'pgy'] }));
  let settled = false;
  running.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  try {
    for (let turn = 0; turn < 30 && (!verificationObserved || !pgyStarted); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(verificationObserved, true, '采集异常后未执行验证状态探针');
    assert.equal(pgyStarted, true, '并行的蒲公英采集未启动');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, '验证信号不得跳过仍在运行的并行平台');
    releasePgy.resolve();
    await assert.rejects(running, (error) => (
      error && error.code === 'VERIFICATION_REQUIRED' &&
      error.platform === 'adstar' && error.tabId === 11 && error.retryable === false
    ));
  } finally {
    releasePgy.resolve();
    await running.catch(() => {});
  }
});

test('runtime probes a non-success collector result and propagates only a confirmed verification state', async () => {
  const runtimeModule = loadRuntime();
  let probeCount = 0;
  const fixture = createRuntimeOptions({
    probeVerification() {
      probeCount += 1;
      return probeCount === 1 ? { kind: 'productReady' } : { kind: 'verification' };
    },
    collectByPlatform(platform) {
      return completeResult(platform, {
        status: 'failed',
        schemaValid: false,
        paginationComplete: false,
        reconciled: false,
        errors: [{ code: 'identity_unavailable', message: 'fixture identity unavailable' }],
      });
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  await assert.rejects(
    runtime.run(runInput({ platforms: ['pgy'] })),
    (error) => error && error.code === 'VERIFICATION_REQUIRED' &&
      error.platform === 'pgy' && error.tabId === 12 && error.retryable === false,
  );
  assert.equal(probeCount, 2);
});

test('runtime keeps a generic 401/403 collection failure when the reader does not confirm verification', async () => {
  const runtimeModule = loadRuntime();
  let probeCount = 0;
  const fixture = createRuntimeOptions({
    probeVerification() {
      probeCount += 1;
      return { kind: 'login' };
    },
    collectByPlatform() {
      const error = new Error('fixture HTTP 403');
      error.code = 'PGY_API_ERROR';
      error.retryable = false;
      throw error;
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['pgy'] }));

  assert.equal(probeCount, 2, '采集前后均应由 reader 做明确状态判定');
  assert.equal(result.status, 'failed');
  assert.equal(result.platforms.pgy.status, 'failed');
  assert.equal(result.platforms.pgy.errors[0].code, 'PGY_API_ERROR');
  assert.equal(result.platforms.pgy.errors[0].retryable, false);
});

test('runtime does not trust a collector-created verification-shaped error without reader confirmation', async () => {
  const runtimeModule = loadRuntime();
  let probeCount = 0;
  const fixture = createRuntimeOptions({
    probeVerification() {
      probeCount += 1;
      return { kind: 'login' };
    },
    collectByPlatform() {
      const error = new Error('fixture unconfirmed verification-shaped failure');
      error.code = 'VERIFICATION_REQUIRED';
      error.platform = 'pgy';
      error.tabId = 12;
      error.retryable = false;
      throw error;
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['pgy'] }));

  assert.equal(probeCount, 2);
  assert.equal(result.status, 'failed');
  assert.equal(result.platforms.pgy.status, 'failed');
  assert.equal(result.platforms.pgy.errors[0].code, 'VERIFICATION_REQUIRED');
  assert.match(result.platforms.pgy.errors[0].message, /unconfirmed/);
});

test('runtime preserves the collection failure when the verification reader cannot return a state', async () => {
  const runtimeModule = loadRuntime();
  let probeCount = 0;
  const fixture = createRuntimeOptions({
    probeVerification() {
      probeCount += 1;
      throw new Error('fixture login state unavailable');
    },
    collectByPlatform() {
      const error = new Error('fixture HTTP 401');
      error.code = 'JUGUANG_API_ERROR';
      error.retryable = false;
      throw error;
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(probeCount, 2);
  assert.equal(result.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'JUGUANG_API_ERROR');
  assert.match(result.platforms.juguang.errors[0].message, /HTTP 401/);
});

test('runtime cancellation wins while a verification probe is pending and releases the active run', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  let probeStarted = false;
  let probeCount = 0;
  let collectCount = 0;
  const fixture = createRuntimeOptions({
    probeVerification() {
      probeCount += 1;
      if (probeCount === 1) {
        probeStarted = true;
        return new Promise(() => {});
      }
      return { kind: 'productReady' };
    },
    collectByPlatform(platform) {
      collectCount += 1;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const controller = new AbortController();
  const first = runtime.run(runInput({
    runId: 'fixture-verification-probe-abort',
    platforms: ['pgy'],
    signal: controller.signal,
  }));

  for (let turn = 0; turn < 30 && !probeStarted; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(probeStarted, true, '运行时未启动验证状态探针');
  controller.abort();
  await assert.rejects(first, (error) => (
    error && (error.name === 'AbortError' || error.code === 'ABORT_ERR') &&
    error.code !== 'VERIFICATION_REQUIRED'
  ));
  assert.equal(collectCount, 0);

  const second = await runtime.run(runInput({
    runId: 'fixture-verification-probe-after-abort',
    platforms: ['pgy'],
  }));
  assert.equal(second.status, 'complete');
  assert.equal(collectCount, 1);
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

test('runtime waits for a new committed Juguang document even when tab metadata already claims complete', async () => {
  const runtimeModule = loadRuntime();
  const main = {
    vSellerId: null,
    advertiserId: 654321,
    accountType: 4,
    name: '虚构聚光原主账户',
  };
  const child = {
    vSellerId: 'fictional-vseller-navigation-lifecycle',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构聚光子账户',
  };
  let current = clone(main);
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-old',
    documentLifecycle: 'active',
    url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  };
  let tabMetadataUrl = currentFrame.url;
  const committedListeners = new Set();
  const switchTriggered = deferred();
  const returnTriggered = deferred();
  const identityCalls = [];
  const chrome = createFakeChrome();
  const originalUpdate = chrome.tabs.update;
  chrome.tabs.update = async (tabId, update) => {
    const result = await originalUpdate(tabId, update);
    tabMetadataUrl = update.url;
    switchTriggered.resolve();
    return result;
  };
  chrome.tabs.get = async (tabId) => {
    assert.equal(tabId, 13);
    return {
      id: tabId,
      status: 'complete',
      url: tabMetadataUrl,
    };
  };
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    if (typeof details.func === 'function') {
      tabMetadataUrl = 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note';
      returnTriggered.resolve();
      throw new Error('Frame removed while the Juguang main-account navigation committed.');
    }
    return originalExecuteScript(details);
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls.push(clone(input));
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const switched = await dependencies.switchAccount({
        tabId: input.tabId,
        target: child,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      assert.equal(switched.vSellerId, child.vSellerId);
      const restored = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(restored.accountType, 4);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const runPromise = runtime.run(runInput({ platforms: ['juguang'] }));

  await switchTriggered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(identityCalls.length, 0, 'target URL + complete metadata must not unlock the old document');
  assert.equal(
    chrome.fixture.scriptExecutions.filter((entry) => entry.target && entry.target.documentIds).length,
    0,
    'bridge injection must wait for the matching committed document',
  );

  emitCommitted({
    tabId: 13, frameId: 1, documentId: 'fixture-doc-child-frame', documentLifecycle: 'active',
    url: tabMetadataUrl,
  });
  emitCommitted({
    tabId: 13, frameId: 0, documentId: 'fixture-doc-old', documentLifecycle: 'active',
    url: tabMetadataUrl,
  });
  emitCommitted({
    tabId: 13, frameId: 0, documentId: 'fixture-doc-wrong-seller', documentLifecycle: 'active',
    url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=fictional-wrong',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(identityCalls.length, 0, 'subframe, old-document, and wrong-account commits must be ignored');

  current = clone(child);
  emitCommitted({
    tabId: 13, frameId: 0, documentId: 'fixture-doc-child', documentLifecycle: 'active',
    url: tabMetadataUrl,
  });
  await returnTriggered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(identityCalls.length, 1, 'only the committed child document may be probed');

  current = clone(main);
  emitCommitted({
    tabId: 13, frameId: 0, documentId: 'fixture-doc-main', documentLifecycle: 'active',
    url: tabMetadataUrl,
  });
  const result = await runPromise;
  assert.equal(result.platforms.juguang.status, 'complete');
  assert.ok(identityCalls.length >= 2);
  assert.ok(identityCalls.every((call) => (
    Number(call.timeoutMs) > 0 && Number(call.timeoutMs) <= 1500
  )), 'post-navigation identity probes must be short and bounded');
  assert.equal(committedListeners.size, 0, 'navigation listeners must always be cleaned up');
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds)
  ));
  assert.deepEqual(documentInjections.map((entry) => ({
    documentIds: entry.target.documentIds,
    world: entry.world,
  })), [
    { documentIds: ['fixture-doc-child'], world: 'MAIN' },
    { documentIds: ['fixture-doc-child'], world: 'ISOLATED' },
    { documentIds: ['fixture-doc-main'], world: 'MAIN' },
    { documentIds: ['fixture-doc-main'], world: 'ISOLATED' },
  ]);
  for (const injection of documentInjections) {
    assert.equal(Object.prototype.hasOwnProperty.call(injection.target, 'frameIds'), false);
  }
});

test('runtime fails closed and removes the Juguang lifecycle listener when no new document commits', async () => {
  const runtimeModule = loadRuntime();
  const target = {
    vSellerId: 'fictional-vseller-no-commit',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构未提交子账户',
  };
  const committedListeners = new Set();
  let identityCalls = 0;
  const chrome = createFakeChrome();
  chrome.tabs.get = async () => ({
    id: 13,
    status: 'complete',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${target.vSellerId}`,
  });
  chrome.webNavigation = {
    async getFrame() {
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-never-replaced',
        documentLifecycle: 'active',
        url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 20,
    pageClient: {
      async request() {
        identityCalls += 1;
        return clone(target);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.switchAccount({
        tabId: input.tabId,
        target,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.match(result.platforms.juguang.errors[0].message, /commit|document|navigation/i);
  assert.equal(identityCalls, 0, 'an uncommitted document must never be probed');
  assert.equal(committedListeners.size, 0, 'timed-out lifecycle listeners must be removed');
  assert.equal(
    chrome.fixture.scriptExecutions.filter((entry) => entry.target && entry.target.documentIds).length,
    0,
  );
});

test('runtime keeps bridge injection inside the Juguang transition budget and requests immediate execution', async () => {
  const runtimeModule = loadRuntime();
  const target = {
    vSellerId: 'fictional-vseller-stalled-injection',
    advertiserId: 123456,
    accountType: 602,
    name: '虚构注入超时子账户',
  };
  const committedListeners = new Set();
  let identityCalls = 0;
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame() {
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-before-stalled-injection',
        documentLifecycle: 'active',
        url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const originalUpdate = chrome.tabs.update;
  chrome.tabs.update = async (tabId, update) => {
    const result = await originalUpdate(tabId, update);
    for (const listener of Array.from(committedListeners)) {
      listener({
        tabId,
        frameId: 0,
        documentId: 'fixture-doc-stalled-injection',
        documentLifecycle: 'active',
        url: update.url,
      });
    }
    return result;
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (details.target && Array.isArray(details.target.documentIds)) {
      return new Promise(() => {});
    }
    return recorded;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 200,
    pageClient: {
      async request() {
        identityCalls += 1;
        return clone(target);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.switchAccount({
        tabId: input.tabId,
        target,
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const startedAt = Date.now();

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.ok(Date.now() - startedAt < 1500, 'a stalled script injection must not escape the transition budget');
  assert.equal(identityCalls, 0);
  assert.equal(committedListeners.size, 0);
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds)
  ));
  assert.equal(documentInjections.length, 1);
  assert.equal(documentInjections[0].injectImmediately, true);
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

test('runtime runs three sources concurrently, waits for every source, and stores only compact output', async () => {
  const runtimeModule = loadRuntime();
  const lifecycle = [];
  const startedPlatforms = new Set();
  const releases = Object.fromEntries([
    'adstar', 'pgy', 'juguang',
  ].map((platform) => [platform, deferred()]));
  let active = 0;
  let maxActive = 0;
  const fixture = createRuntimeOptions({
    collectByPlatform: async (platform) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      lifecycle.push(`start:${platform}`);
      startedPlatforms.add(platform);
      await releases[platform].promise;
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
  const runPromise = runtime.run(runInput());
  let runSettled = false;
  runPromise.then(
    () => { runSettled = true; },
    () => { runSettled = true; },
  );
  let result;

  try {
    for (let turn = 0; turn < 20 && startedPlatforms.size < 3; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const initialStatus = fixture.chrome.fixture.storageWrites
      .find((write) => Object.prototype.hasOwnProperty.call(write, STATUS_KEY))[STATUS_KEY];
    assert.deepEqual(
      Object.fromEntries(Object.entries(initialStatus.platforms).map(([platform, value]) => (
        [platform, value.status]
      ))),
      { adstar: 'running', pgy: 'running', juguang: 'running' },
    );
    assert.deepEqual(
      Array.from(startedPlatforms).sort(),
      ['adstar', 'juguang', 'pgy'],
      'all requested platforms must start before any platform finishes',
    );
    assert.equal(maxActive, 3);

    releases.adstar.resolve();
    releases.pgy.resolve();
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runSettled, false, 'the run must wait for the final platform before aggregation');
    assert.equal(
      fixture.chrome.fixture.storageWrites.some((write) => (
        Object.prototype.hasOwnProperty.call(write, `${RUN_KEY_PREFIX}fixture-xhs-run-001`)
      )),
      false,
      'the compact run archive must not be written before every platform settles',
    );

    releases.juguang.resolve();
    result = await runPromise;
  } finally {
    releases.adstar.resolve();
    releases.pgy.resolve();
    releases.juguang.resolve();
    if (!runSettled) await runPromise;
  }

  assert.deepEqual(
    lifecycle.filter((entry) => entry.startsWith('finish:')).sort(),
    ['finish:adstar', 'finish:juguang', 'finish:pgy'],
  );
  assert.equal(result.status, 'partial');
  assert.equal(result.platforms.adstar.status, 'complete');
  assert.equal(result.platforms.pgy.status, 'partial');
  assert.equal(result.platforms.juguang.status, 'complete');
  assert.deepEqual(Object.keys(result.platforms), ['adstar', 'pgy', 'juguang']);

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

test('runtime keeps collecting parallel sources after one collector fails', async () => {
  const runtimeModule = loadRuntime();
  const startedPlatforms = new Set();
  const releases = {
    pgy: deferred(),
    juguang: deferred(),
  };
  const fixture = createRuntimeOptions({
    collectByPlatform: async (platform) => {
      startedPlatforms.add(platform);
      if (platform === 'adstar') throw new Error('fixture Star collector failure');
      await releases[platform].promise;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const runPromise = runtime.run(runInput());
  let runSettled = false;
  runPromise.then(
    () => { runSettled = true; },
    () => { runSettled = true; },
  );
  let result;

  try {
    for (let turn = 0; turn < 20 && startedPlatforms.size < 3; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(Array.from(startedPlatforms).sort(), ['adstar', 'juguang', 'pgy']);
    assert.equal(runSettled, false, 'one failed source must not short-circuit sources still collecting');
    releases.pgy.resolve();
    releases.juguang.resolve();
    result = await runPromise;
  } finally {
    releases.pgy.resolve();
    releases.juguang.resolve();
    if (!runSettled) await runPromise;
  }

  assert.equal(result.status, 'partial');
  assert.equal(result.platforms.adstar.status, 'failed');
  assert.equal(result.platforms.pgy.status, 'complete');
  assert.equal(result.platforms.juguang.status, 'complete');
});

test('runtime contains one platform discovery failure and preserves successful sibling results', async () => {
  const runtimeModule = loadRuntime();
  const chrome = createFakeChrome();
  const originalQuery = chrome.tabs.query.bind(chrome.tabs);
  let queryCount = 0;
  chrome.tabs.query = async (query) => {
    queryCount += 1;
    if (queryCount === 1) {
      const error = new Error('fixture Star tab discovery transport failure');
      error.code = 'ADSTAR_TAB_DISCOVERY_FAILED';
      error.retryable = true;
      throw error;
    }
    return originalQuery(query);
  };
  const collected = [];
  const fixture = createRuntimeOptions({
    chrome,
    collectByPlatform(platform) {
      collected.push(platform);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput());

  assert.equal(result.status, 'partial');
  assert.deepEqual(collected.sort(), ['juguang', 'pgy']);
  assert.equal(result.platforms.adstar.status, 'failed');
  assert.equal(result.platforms.adstar.errors[0].code, 'ADSTAR_TAB_DISCOVERY_FAILED');
  assert.equal(result.platforms.pgy.status, 'complete');
  assert.equal(result.platforms.juguang.status, 'complete');
  assert.ok(
    Object.hasOwn(chrome.fixture.storageWrites.at(-2), `${RUN_KEY_PREFIX}fixture-xhs-run-001`),
    'partial run with successful siblings must remain archived',
  );
});

test('runtime treats a collector-local AbortError as one platform failure while the run signal remains active', async () => {
  const runtimeModule = loadRuntime();
  const controller = new AbortController();
  const collected = [];
  const fixture = createRuntimeOptions({
    collectByPlatform(platform) {
      collected.push(platform);
      if (platform === 'adstar') {
        const error = new Error('fixture Star request-local timeout abort');
        error.name = 'AbortError';
        error.code = 'ABORT_ERR';
        error.retryable = true;
        throw error;
      }
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ signal: controller.signal }));

  assert.equal(controller.signal.aborted, false);
  assert.equal(result.status, 'partial');
  assert.deepEqual(collected.sort(), ['adstar', 'juguang', 'pgy']);
  assert.equal(result.platforms.adstar.status, 'failed');
  assert.equal(result.platforms.adstar.errors[0].code, 'ABORT_ERR');
  assert.equal(result.platforms.pgy.status, 'complete');
  assert.equal(result.platforms.juguang.status, 'complete');
});

test('parallel platform progress writes are monotonic even when an earlier storage write is delayed', async () => {
  const runtimeModule = loadRuntime();
  const chrome = createFakeChrome();
  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  const firstProgressWriteStarted = deferred();
  const releaseFirstProgressWrite = deferred();
  let gatedProgressWrite = false;
  chrome.storage.local.set = async (value) => {
    const status = value && value[STATUS_KEY];
    const hasFinishedPlatform = status && status.running === true &&
      Object.values(status.platforms || {}).some((platform) => platform.status === 'complete');
    if (!gatedProgressWrite && hasFinishedPlatform) {
      gatedProgressWrite = true;
      firstProgressWriteStarted.resolve();
      await releaseFirstProgressWrite.promise;
    }
    return originalSet(value);
  };
  const releases = Object.fromEntries([
    'adstar', 'pgy', 'juguang',
  ].map((platform) => [platform, deferred()]));
  const startedPlatforms = new Set();
  const fixture = createRuntimeOptions({
    chrome,
    collectByPlatform: async (platform) => {
      startedPlatforms.add(platform);
      await releases[platform].promise;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const runPromise = runtime.run(runInput());

  for (let turn = 0; turn < 20 && startedPlatforms.size < 3; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  try {
    assert.equal(startedPlatforms.size, 3);
    releases.adstar.resolve();
    await firstProgressWriteStarted.promise;
    releases.pgy.resolve();
    releases.juguang.resolve();
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    releases.adstar.resolve();
    releases.pgy.resolve();
    releases.juguang.resolve();
    releaseFirstProgressWrite.resolve();
  }
  await runPromise;

  const completedCounts = chrome.fixture.storageWrites
    .filter((write) => write[STATUS_KEY] && write[STATUS_KEY].running === true)
    .map((write) => Object.values(write[STATUS_KEY].platforms || {})
      .filter((platform) => platform.status === 'complete').length);
  assert.ok(completedCounts.length >= 2);
  assert.ok(completedCounts.every((count, index) => (
    index === 0 || count >= completedCounts[index - 1]
  )), `parallel progress regressed: ${completedCounts.join(' -> ')}`);
});

test('status snapshot preserves safe source time and account labels without account identifiers', async () => {
  const runtimeModule = loadRuntime();
  const identities = {
    adstar: {
      finishedAt: '2030-01-08T00:01:00.000Z',
      identity: { memberId: 'fictional-member-id-private', memberName: '虚构星河品牌' },
    },
    pgy: {
      finishedAt: '2030-01-08T00:02:00.000Z',
      identity: { brandUserId: 'fictional-brand-id-private', brandUserName: '虚构蒲公英品牌' },
    },
    juguang: {
      finishedAt: '2030-01-08T00:03:00.000Z',
      accounts: [{ account: {
        advertiserId: 'fictional-main-advertiser-private',
        accountType: 4,
        brand: { brandUserName: '虚构聚光品牌' },
      } }, { account: {
        advertiserId: 'fictional-child-advertiser-private',
        accountType: 602,
        name: '虚构聚光子账户',
      } }],
    },
  };
  const fixture = createRuntimeOptions({
    collectByPlatform: async (platform) => completeResult(platform, identities[platform]),
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  await runtime.run(runInput());

  const finalStatus = fixture.chrome.fixture.storageWrites
    .filter((write) => Object.prototype.hasOwnProperty.call(write, STATUS_KEY))
    .at(-1)[STATUS_KEY];
  assert.deepEqual(finalStatus.platforms.adstar, {
    status: 'complete',
    collectedAt: '2030-01-08T00:01:00.000Z',
    accountLabel: '虚构星河品牌',
    accountCount: 1,
    warnings: [],
    errors: [],
  });
  assert.equal(finalStatus.platforms.pgy.accountLabel, '虚构蒲公英品牌');
  assert.equal(finalStatus.platforms.juguang.accountLabel, '虚构聚光品牌');
  assert.equal(finalStatus.platforms.juguang.accountCount, 2);
  const serializedStatus = JSON.stringify(finalStatus);
  for (const identifier of [
    'fictional-member-id-private', 'fictional-brand-id-private',
    'fictional-main-advertiser-private', 'fictional-child-advertiser-private',
  ]) {
    assert.equal(serializedStatus.includes(identifier), false, `status leaked account identifier: ${identifier}`);
  }
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

test('runtime accepts a strongly verified Juguang main account after a same-document SPA return even when vSellerId remains in the URL', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-spa-return',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: 'fictional-main-vseller-spa-return',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构原主账户',
  };
  const retainedUrl =
    `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`;
  const committedListeners = new Set();
  let current = clone(child);
  let returnActionClicked = false;
  let identityCalls = 0;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func === 'function') {
        returnActionClicked = true;
        current = clone(main);
        return [{ result: true }];
      }
      return [{ result: { ok: true } }];
    },
  });
  chrome.tabs.get = async (tabId) => ({
    id: tabId,
    status: 'complete',
    url: retainedUrl,
  });
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-spa-return',
        documentLifecycle: 'active',
        url: retainedUrl,
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 500,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(current);
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

  assert.equal(
    result.platforms.juguang.status,
    'complete',
    result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message,
  );
  assert.equal(returnActionClicked, true);
  assert.ok(identityCalls >= 1, 'same-document success must strongly verify accounts.current');
  assert.equal(new URL(retainedUrl).searchParams.get('vSellerId'), child.vSellerId);
  assert.equal(committedListeners.size, 0, 'same-document success must remove the lifecycle listener');
});

test('runtime re-probes a pure-SPA Juguang return when the main identity appears after the first probe batch', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-delayed-main-identity',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: 'fictional-main-vseller-delayed-identity',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构延迟收敛主账户',
  };
  const retainedUrl =
    `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`;
  const committedListeners = new Set();
  let current = clone(child);
  let identityCalls = 0;
  let mainBecameAvailable = false;
  let verifiedAdvertiserId = null;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript() {
      return [{ result: true }];
    },
  });
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-delayed-main-identity',
        documentLifecycle: 'active',
        url: retainedUrl,
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 160,
    bridgeRetry: { attempts: 1, delayMs: 5 },
    wait: (delayMs) => new Promise((resolve) => {
      setTimeout(resolve, Math.max(1, Number(delayMs) || 0));
    }),
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        if (identityCalls === 1) {
          setTimeout(() => {
            current = clone(main);
            mainBecameAvailable = true;
          }, 15);
        }
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      verifiedAdvertiserId = verified.advertiserId;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(mainBecameAvailable, true, 'the main identity must appear before the transition deadline');
  assert.equal(
    result.platforms.juguang.status,
    'complete',
    result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message,
  );
  assert.equal(verifiedAdvertiserId, main.advertiserId);
  assert.ok(identityCalls > 1, 'identity probing must continue beyond the exhausted first batch');
  assert.equal(committedListeners.size, 0, 'delayed same-document success must remove the lifecycle listener');
});

test('runtime rejects a same-document Juguang return when the verified account stays child and removes the lifecycle listener', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-spa-not-returned',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构未切回子账户',
  };
  const retainedUrl =
    `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`;
  const committedListeners = new Set();
  let returnActionClicked = false;
  let identityCalls = 0;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func === 'function') returnActionClicked = true;
      return [{ result: true }];
    },
  });
  chrome.tabs.get = async (tabId) => ({
    id: tabId,
    status: 'complete',
    url: retainedUrl,
  });
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-spa-not-returned',
        documentLifecycle: 'active',
        url: retainedUrl,
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 30,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      throw new Error(`collector must not continue for ${platform}`);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.match(
    result.platforms.juguang.errors[0].message,
    /accountType|identity|main-account|commit|document|navigation/i,
  );
  assert.equal(returnActionClicked, true);
  assert.ok(identityCalls >= 1, 'same-document failure must reject the verified child identity');
  assert.equal(committedListeners.size, 0, 'same-document failure must remove the lifecycle listener');
});

test('runtime rejects a same-document Juguang main identity without advertiserId before the collector continues', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-main-missing-advertiser',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const weakMainIdentity = {
    vSellerId: 'fictional-main-vseller-missing-advertiser',
    accountType: 4,
    name: '虚构缺失广告主标识的主账户',
  };
  const retainedUrl =
    `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`;
  const committedListeners = new Set();
  let current = clone(child);
  let collectorContinued = false;
  let identityCalls = 0;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func === 'function') current = clone(weakMainIdentity);
      return [{ result: true }];
    },
  });
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-main-missing-advertiser',
        documentLifecycle: 'active',
        url: retainedUrl,
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 80,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      collectorContinued = true;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.match(result.platforms.juguang.errors[0].message, /advertiserId|identity|missing/i);
  assert.ok(identityCalls >= 1, 'the same-document result must be strongly verified');
  assert.equal(collectorContinued, false, 'collection must stop after a weak main identity');
  assert.equal(committedListeners.size, 0, 'rejected identity must remove the lifecycle listener');
});

test('runtime waits for a main document committed inside the same-document stability window before accepting identity', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-stability-window',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const oldDocumentMain = {
    vSellerId: 'fictional-old-document-main-vseller',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构旧文档主账户',
  };
  const newDocumentMain = {
    vSellerId: 'fictional-new-document-main-vseller',
    advertiserId: 1002,
    accountType: 4,
    name: '虚构新文档主账户',
  };
  const committedDocumentId = 'fixture-doc-main-inside-stability-window';
  const committedListeners = new Set();
  const identityStages = [];
  let identityStage = 'child';
  let commitScheduled = false;
  let verifiedAdvertiserId = null;
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-before-stability-window',
    documentLifecycle: 'active',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    const result = await originalExecuteScript(details);
    if (typeof details.func === 'function') identityStage = 'old-main';
    return result;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 200,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        if (identityStage === 'old-main') {
          identityStages.push('old-document');
          if (!commitScheduled) {
            commitScheduled = true;
            setTimeout(() => {
              identityStage = 'new-main';
              emitCommitted({
                tabId: 13,
                frameId: 0,
                documentId: committedDocumentId,
                documentLifecycle: 'active',
                url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
              });
            }, 0);
          }
          return clone(oldDocumentMain);
        }
        assert.equal(identityStage, 'new-main');
        const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
          entry.target && Array.isArray(entry.target.documentIds) &&
          entry.target.documentIds.includes(committedDocumentId)
        ));
        assert.deepEqual(
          documentInjections.map((entry) => entry.world),
          ['MAIN', 'ISOLATED'],
          'the new document bridge must be fully recovered before its identity is read',
        );
        identityStages.push('new-document');
        return clone(newDocumentMain);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      verifiedAdvertiserId = verified.advertiserId;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(verifiedAdvertiserId, newDocumentMain.advertiserId);
  assert.deepEqual(identityStages, ['old-document', 'new-document']);
  assert.equal(committedListeners.size, 0, 'stability-window commit must remove the lifecycle listener');
});

test('runtime waits past the fixed stability window for an onBeforeNavigate main document before accepting identity', { timeout: 2500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-before-navigate',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const oldDocumentMain = {
    vSellerId: 'fictional-old-document-main-before-navigate',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构旧文档主账户',
  };
  const newDocumentMain = {
    vSellerId: 'fictional-new-document-main-before-navigate',
    advertiserId: 1002,
    accountType: 4,
    name: '虚构新文档主账户',
  };
  const committedDocumentId = 'fixture-doc-after-before-navigate';
  const beforeNavigateListeners = new Set();
  const committedListeners = new Set();
  const commitDone = deferred();
  const identityStages = [];
  let identityStage = 'child';
  let commitScheduled = false;
  let commitAt = null;
  let resultResolvedAt = null;
  let verifiedAdvertiserId = null;
  let beforeNavigateRegistrations = 0;
  let beforeNavigateEmissions = 0;
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-before-before-navigate',
    documentLifecycle: 'active',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onBeforeNavigate: {
      addListener(listener) {
        beforeNavigateRegistrations += 1;
        beforeNavigateListeners.add(listener);
      },
      removeListener(listener) {
        beforeNavigateListeners.delete(listener);
      },
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitBeforeNavigate = (details) => {
    beforeNavigateEmissions += 1;
    for (const listener of Array.from(beforeNavigateListeners)) listener(clone(details));
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    const result = await originalExecuteScript(details);
    if (typeof details.func === 'function') {
      identityStage = 'old-main';
      emitBeforeNavigate({
        tabId: 13,
        frameId: 0,
        parentFrameId: -1,
        url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${newDocumentMain.vSellerId}`,
      });
    }
    return result;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 1600,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        if (identityStage === 'old-main') {
          identityStages.push('old-document');
          if (!commitScheduled) {
            commitScheduled = true;
            setTimeout(() => {
              identityStage = 'new-main';
              commitAt = Date.now();
              emitCommitted({
                tabId: 13,
                frameId: 0,
                documentId: committedDocumentId,
                documentLifecycle: 'active',
                url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${newDocumentMain.vSellerId}`,
              });
              commitDone.resolve();
            }, 350);
          }
          return clone(oldDocumentMain);
        }
        assert.equal(identityStage, 'new-main');
        const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
          entry.target && Array.isArray(entry.target.documentIds) &&
          entry.target.documentIds.includes(committedDocumentId)
        ));
        assert.deepEqual(
          documentInjections.map((entry) => entry.world),
          ['MAIN', 'ISOLATED'],
          'the pending new document must be fully recovered before its identity is read',
        );
        identityStages.push('new-document');
        return clone(newDocumentMain);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      verifiedAdvertiserId = verified.advertiserId;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));
  resultResolvedAt = Date.now();
  await commitDone.promise;

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(
    verifiedAdvertiserId,
    newDocumentMain.advertiserId,
    'a pending navigation must prevent the old-document main identity from being accepted',
  );
  assert.ok(resultResolvedAt >= commitAt, 'the return must not resolve before the pending document commits');
  assert.deepEqual(identityStages, ['old-document', 'new-document']);
  assert.equal(beforeNavigateEmissions, 1);
  assert.ok(beforeNavigateRegistrations >= 1, 'return-to-main must observe top-frame onBeforeNavigate');
  assert.equal(beforeNavigateListeners.size, 0, 'onBeforeNavigate listeners must be cleaned up');
  assert.equal(committedListeners.size, 0, 'onCommitted listeners must be cleaned up');
});

test('runtime reconciles a completed Juguang main document when onCommitted is missed after onBeforeNavigate', { timeout: 2000 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-missed-commit',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构原主账户',
  };
  const mainUrl = 'https://ad.xiaohongshu.com/aurora/ad/manage/campaign';
  const newDocumentId = 'fixture-doc-main-missed-commit';
  const beforeNavigateListeners = new Set();
  const committedListeners = new Set();
  const observedIdentities = [];
  let beforeNavigateEmissions = 0;
  let currentTab = {
    id: 13,
    status: 'complete',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-child-before-missed-commit',
    documentLifecycle: 'active',
    url: currentTab.url,
  };
  let acceptedIdentity = null;
  const chrome = createFakeChrome();
  chrome.tabs.get = async (tabId) => {
    assert.equal(tabId, 13);
    return clone(currentTab);
  };
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onBeforeNavigate: {
      addListener(listener) {
        beforeNavigateListeners.add(listener);
      },
      removeListener(listener) {
        beforeNavigateListeners.delete(listener);
      },
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitBeforeNavigate = (details) => {
    beforeNavigateEmissions += 1;
    for (const listener of Array.from(beforeNavigateListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    const result = await originalExecuteScript(details);
    if (typeof details.func === 'function') {
      emitBeforeNavigate({
        tabId: 13,
        frameId: 0,
        parentFrameId: -1,
        url: mainUrl,
      });
      currentTab = { id: 13, status: 'complete', url: mainUrl };
      currentFrame = {
        tabId: 13,
        frameId: 0,
        documentId: newDocumentId,
        documentLifecycle: 'active',
        url: mainUrl,
      };
      // Intentionally omit onCommitted: this reproduces the observed browser state.
    }
    return result;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 250,
    bridgeRetry: { attempts: 2, delayMs: 1 },
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
          entry.target && Array.isArray(entry.target.documentIds) &&
          entry.target.documentIds.includes(newDocumentId)
        ));
        const recoveredWorlds = documentInjections.map((entry) => entry.world);
        if (!recoveredWorlds.includes('MAIN') || !recoveredWorlds.includes('ISOLATED')) {
          observedIdentities.push(clone(child));
          return clone(child);
        }
        observedIdentities.push(clone(main));
        return clone(main);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      acceptedIdentity = clone(verified);
      assert.equal(verified.accountType, 4, 'a child account must never be accepted as main');
      assert.equal(
        verified.advertiserId,
        main.advertiserId,
        'the verified main advertiserId must match the recovered document identity',
      );
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(beforeNavigateEmissions, 1);
  assert.equal(currentTab.status, 'complete');
  assert.equal(currentTab.url, mainUrl);
  assert.equal(currentFrame.documentId, newDocumentId);
  assert.equal(
    Boolean(acceptedIdentity && acceptedIdentity.advertiserId === child.advertiserId),
    false,
    'the stale child identity must never be released to the collector',
  );
  assert.equal(beforeNavigateListeners.size, 0, 'missed-commit recovery must clean onBeforeNavigate');
  assert.equal(committedListeners.size, 0, 'missed-commit recovery must clean onCommitted');
  assert.equal(
    result.platforms.juguang.status,
    'complete',
    result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message,
  );
  assert.deepEqual(acceptedIdentity, main);
  assert.ok(observedIdentities.length >= 1, 'the recovered document identity must be verified');
  assert.equal(
    observedIdentities.every((identity) => identity.accountType === 4),
    true,
    'the stale child document must not be queried once the new document is observed',
  );
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds) &&
    entry.target.documentIds.includes(newDocumentId)
  ));
  assert.deepEqual(
    documentInjections.map((entry) => entry.world),
    ['MAIN', 'ISOLATED'],
    'the newly observed main document bridge must be recovered before identity verification',
  );
});

test('runtime verifies a same-document Juguang main identity when a hanging action emits only history state', { timeout: 2000 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-history-only',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构原主账户',
  };
  const baselineDocumentId = 'fixture-doc-history-only-return';
  const mainUrl = 'https://ad.xiaohongshu.com/aurora/ad/manage/campaign';
  const actionDeferred = deferred();
  const historyListeners = new Set();
  const committedListeners = new Set();
  let historyRegistrations = 0;
  let historyEmissions = 0;
  let identityCalls = 0;
  let monotonicClock = 0;
  let current = clone(child);
  let currentTab = {
    id: 13,
    status: 'complete',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: baselineDocumentId,
    documentLifecycle: 'active',
    url: currentTab.url,
  };
  const chrome = createFakeChrome();
  chrome.tabs.get = async (tabId) => {
    assert.equal(tabId, 13);
    return clone(currentTab);
  };
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onHistoryStateUpdated: {
      addListener(listener) {
        historyRegistrations += 1;
        historyListeners.add(listener);
      },
      removeListener(listener) {
        historyListeners.delete(listener);
      },
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitHistoryStateUpdated = (details) => {
    historyEmissions += 1;
    for (const listener of Array.from(historyListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (typeof details.func !== 'function') return recorded;
    current = clone(main);
    currentTab = { id: 13, status: 'complete', url: mainUrl };
    currentFrame = Object.assign({}, currentFrame, { url: mainUrl });
    emitHistoryStateUpdated({
      tabId: 13,
      frameId: 0,
      documentId: baselineDocumentId,
      documentLifecycle: 'active',
      url: mainUrl,
    });
    return actionDeferred.promise;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 250,
    monotonicNow: () => {
      monotonicClock += 10;
      return monotonicClock;
    },
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(verified.accountType, 4, 'history-only return must strongly verify accountType');
      assert.equal(
        verified.advertiserId,
        main.advertiserId,
        'history-only return must strongly verify advertiserId',
      );
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));
  actionDeferred.resolve([{ result: true }]);
  await Promise.resolve();

  assert.equal(historyEmissions, 1);
  assert.equal(currentFrame.documentId, baselineDocumentId, 'history update must stay in one document');
  assert.equal(currentFrame.url, mainUrl);
  assert.equal(historyListeners.size, 0, 'history-state listener must be cleaned up');
  assert.equal(committedListeners.size, 0, 'history-only completion must clean onCommitted');
  assert.equal(
    result.platforms.juguang.status,
    'complete',
    `${result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message}; ` +
      `identityCalls=${identityCalls}`,
  );
  assert.ok(historyRegistrations >= 1, 'return-to-main must observe same-document history updates');
  assert.ok(identityCalls >= 1, 'history-only completion must strongly probe accounts.current');
});

test('runtime reconciles a delayed completed Juguang document when navigation events are missed and the return action hangs', { timeout: 2000 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-delayed-missed-events',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构原主账户',
  };
  const mainUrl = 'https://ad.xiaohongshu.com/aurora/ad/manage/campaign';
  const newDocumentId = 'fixture-doc-main-delayed-missed-events';
  const hangingAction = deferred();
  const beforeNavigateListeners = new Set();
  const historyListeners = new Set();
  const committedListeners = new Set();
  const observedIdentities = [];
  let beforeNavigateRegistrations = 0;
  let beforeNavigateEmissions = 0;
  let historyEmissions = 0;
  let committedEmissions = 0;
  let transitionApplied = false;
  let acceptedIdentity = null;
  let currentTab = {
    id: 13,
    status: 'complete',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-child-before-delayed-missed-events',
    documentLifecycle: 'active',
    url: currentTab.url,
  };
  const chrome = createFakeChrome();
  chrome.tabs.get = async (tabId) => {
    assert.equal(tabId, 13);
    return clone(currentTab);
  };
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onBeforeNavigate: {
      addListener(listener) {
        beforeNavigateRegistrations += 1;
        beforeNavigateListeners.add(listener);
      },
      removeListener(listener) {
        beforeNavigateListeners.delete(listener);
      },
    },
    onHistoryStateUpdated: {
      addListener(listener) {
        historyListeners.add(listener);
      },
      removeListener(listener) {
        historyListeners.delete(listener);
      },
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitBeforeNavigate = (details) => {
    beforeNavigateEmissions += 1;
    for (const listener of Array.from(beforeNavigateListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (typeof details.func !== 'function') return recorded;
    emitBeforeNavigate({
      tabId: 13,
      frameId: 0,
      parentFrameId: -1,
      url: mainUrl,
    });
    setTimeout(() => {
      transitionApplied = true;
      currentTab = { id: 13, status: 'complete', url: mainUrl };
      currentFrame = {
        tabId: 13,
        frameId: 0,
        documentId: newDocumentId,
        documentLifecycle: 'active',
        url: mainUrl,
      };
      // Intentionally emit neither onHistoryStateUpdated nor onCommitted.
    }, 20);
    return hangingAction.promise;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 300,
    bridgeRetry: { attempts: 2, delayMs: 5 },
    wait: (delayMs) => new Promise((resolve) => {
      setTimeout(resolve, Math.max(1, Number(delayMs) || 0));
    }),
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
          entry.target && Array.isArray(entry.target.documentIds) &&
          entry.target.documentIds.includes(newDocumentId)
        ));
        const recoveredWorlds = documentInjections.map((entry) => entry.world);
        if (!recoveredWorlds.includes('MAIN') || !recoveredWorlds.includes('ISOLATED')) {
          observedIdentities.push(clone(child));
          return clone(child);
        }
        observedIdentities.push(clone(main));
        return clone(main);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      acceptedIdentity = clone(verified);
      assert.equal(verified.accountType, 4, 'delayed reconciliation must verify main accountType');
      assert.equal(
        verified.advertiserId,
        main.advertiserId,
        'delayed reconciliation must verify the main advertiserId',
      );
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(transitionApplied, true, 'the browser must reach the delayed new document');
  assert.equal(beforeNavigateEmissions, 1);
  assert.equal(historyEmissions, 0);
  assert.equal(committedEmissions, 0);
  assert.equal(currentTab.status, 'complete');
  assert.equal(currentTab.url, mainUrl);
  assert.equal(currentFrame.documentId, newDocumentId);
  assert.equal(beforeNavigateListeners.size, 0, 'delayed reconciliation must clean onBeforeNavigate');
  assert.equal(historyListeners.size, 0, 'delayed reconciliation must clean onHistoryStateUpdated');
  assert.equal(committedListeners.size, 0, 'delayed reconciliation must clean onCommitted');
  assert.equal(
    result.platforms.juguang.status,
    'complete',
    result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message,
  );
  assert.ok(beforeNavigateRegistrations >= 1, 'the pending navigation must be observed');
  assert.deepEqual(acceptedIdentity, main);
  assert.ok(observedIdentities.length >= 1, 'the recovered document identity must be verified');
  assert.equal(
    observedIdentities.every((identity) => identity.accountType === 4),
    true,
    'the old child identity must not be queried before exact-document bridge recovery',
  );
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds) &&
    entry.target.documentIds.includes(newDocumentId)
  ));
  assert.deepEqual(
    documentInjections.map((entry) => entry.world),
    ['MAIN', 'ISOLATED'],
    'the delayed document must receive exact-document MAIN and ISOLATED injection',
  );
});

test('runtime rejects a transient baseline main identity while a missed-beforeNavigate commit is pending', { timeout: 2000 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-missed-before-navigate',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const transientBaselineMain = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构旧文档临时主账户',
  };
  const committedMain = {
    vSellerId: null,
    advertiserId: 1002,
    accountType: 4,
    name: '虚构新文档主账户',
  };
  const baselineDocumentId = 'fixture-doc-before-missed-before-navigate';
  const committedDocumentId = 'fixture-doc-after-missed-before-navigate';
  const childUrl =
    `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`;
  const mainUrl = 'https://ad.xiaohongshu.com/aurora/ad/manage/campaign';
  const beforeNavigateListeners = new Set();
  const historyListeners = new Set();
  const committedListeners = new Set();
  const commitDone = deferred();
  const observedAdvertiserIds = [];
  let beforeNavigateEmissions = 0;
  let committedEmissions = 0;
  let loadingTabChecks = 0;
  let commitAt = null;
  let resultResolvedAt = null;
  let acceptedAdvertiserId = null;
  let current = clone(child);
  let currentTab = { id: 13, status: 'complete', url: childUrl };
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: baselineDocumentId,
    documentLifecycle: 'active',
    url: childUrl,
  };
  const chrome = createFakeChrome();
  chrome.tabs.get = async (tabId) => {
    assert.equal(tabId, 13);
    if (currentTab.status === 'loading' && currentTab.pendingUrl === mainUrl) {
      loadingTabChecks += 1;
    }
    return clone(currentTab);
  };
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onBeforeNavigate: {
      addListener(listener) {
        beforeNavigateListeners.add(listener);
      },
      removeListener(listener) {
        beforeNavigateListeners.delete(listener);
      },
    },
    onHistoryStateUpdated: {
      addListener(listener) {
        historyListeners.add(listener);
      },
      removeListener(listener) {
        historyListeners.delete(listener);
      },
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    committedEmissions += 1;
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    const result = await originalExecuteScript(details);
    if (typeof details.func !== 'function') return result;
    current = clone(transientBaselineMain);
    currentTab = {
      id: 13,
      status: 'loading',
      url: childUrl,
      pendingUrl: mainUrl,
    };
    setTimeout(() => {
      current = clone(committedMain);
      currentTab = { id: 13, status: 'complete', url: mainUrl };
      commitAt = Date.now();
      emitCommitted({
        tabId: 13,
        frameId: 0,
        documentId: committedDocumentId,
        documentLifecycle: 'active',
        url: mainUrl,
      });
      commitDone.resolve();
    }, 280);
    return result;
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 500,
    bridgeRetry: { attempts: 2, delayMs: 5 },
    wait: (delayMs) => new Promise((resolve) => {
      setTimeout(resolve, Math.max(1, Number(delayMs) || 0));
    }),
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        if (currentFrame.documentId !== committedDocumentId) {
          observedAdvertiserIds.push(transientBaselineMain.advertiserId);
          return clone(transientBaselineMain);
        }
        const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
          entry.target && Array.isArray(entry.target.documentIds) &&
          entry.target.documentIds.includes(committedDocumentId)
        ));
        const recoveredWorlds = documentInjections.map((entry) => entry.world);
        if (!recoveredWorlds.includes('MAIN') || !recoveredWorlds.includes('ISOLATED')) {
          observedAdvertiserIds.push(child.advertiserId);
          return clone(child);
        }
        observedAdvertiserIds.push(committedMain.advertiserId);
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      acceptedAdvertiserId = verified.advertiserId;
      assert.equal(verified.accountType, 4);
      assert.equal(
        verified.advertiserId,
        committedMain.advertiserId,
        'the transient baseline main identity must never be accepted',
      );
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));
  resultResolvedAt = Date.now();
  await commitDone.promise;

  assert.equal(beforeNavigateEmissions, 0, 'the fixture must miss onBeforeNavigate entirely');
  assert.equal(committedEmissions, 1);
  assert.ok(loadingTabChecks >= 1, 'the pendingUrl/loading baseline must be checked before identity');
  assert.ok(resultResolvedAt >= commitAt, 'return-to-main must not resolve before the new document commits');
  assert.equal(
    result.platforms.juguang.status,
    'complete',
    result.platforms.juguang.errors[0] && result.platforms.juguang.errors[0].message,
  );
  assert.equal(acceptedAdvertiserId, committedMain.advertiserId);
  assert.deepEqual(
    observedAdvertiserIds,
    [committedMain.advertiserId],
    'only the committed document identity may be queried and accepted',
  );
  assert.equal(beforeNavigateListeners.size, 0, 'missed onBeforeNavigate listener must be cleaned up');
  assert.equal(historyListeners.size, 0, 'unused history listener must be cleaned up');
  assert.equal(committedListeners.size, 0, 'committed listener must be cleaned up');
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds) &&
    entry.target.documentIds.includes(committedDocumentId)
  ));
  assert.deepEqual(
    documentInjections.map((entry) => entry.world),
    ['MAIN', 'ISOLATED'],
    'the committed document must receive exact-document MAIN and ISOLATED injection',
  );
});

test('runtime accepts a committed Juguang main document whose URL retains vSellerId after strong identity verification', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-hard-navigation',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: 'fictional-main-vseller-retained-after-navigation',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构导航后主账户',
  };
  const committedDocumentId = 'fixture-doc-main-retains-vseller';
  const committedListeners = new Set();
  let current = clone(child);
  let verifiedAdvertiserId = null;
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-before-main-retains-vseller',
    documentLifecycle: 'active',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (typeof details.func !== 'function') return recorded;
    current = clone(main);
    emitCommitted({
      tabId: 13,
      frameId: 0,
      documentId: committedDocumentId,
      documentLifecycle: 'active',
      url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${main.vSellerId}`,
    });
    return new Promise(() => {});
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 100,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        return clone(current);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      verifiedAdvertiserId = verified.advertiserId;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(verifiedAdvertiserId, main.advertiserId);
  assert.equal(new URL(currentFrame.url).searchParams.get('vSellerId'), main.vSellerId);
  assert.equal(committedListeners.size, 0, 'verified hard navigation must remove the lifecycle listener');
  const documentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds)
  ));
  assert.deepEqual(documentInjections.map((entry) => ({
    documentIds: entry.target.documentIds,
    world: entry.world,
  })), [
    { documentIds: [committedDocumentId], world: 'MAIN' },
    { documentIds: [committedDocumentId], world: 'ISOLATED' },
  ]);
});

test('runtime completes a Juguang return within budget when the DOM action hangs but a new main-account document commits', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-hanging-action-commit',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: 'fictional-main-vseller-hanging-action-commit',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构原主账户',
  };
  const committedListeners = new Set();
  let current = clone(child);
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-before-hanging-return-action',
    documentLifecycle: 'active',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  let hangingActionCalls = 0;
  let identityCalls = 0;
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (typeof details.func !== 'function') return recorded;
    hangingActionCalls += 1;
    setTimeout(() => {
      current = clone(main);
      emitCommitted({
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-after-hanging-return-action',
        documentLifecycle: 'active',
        url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
      });
    }, 0);
    return new Promise(() => {});
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 100,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(current);
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
  const startedAt = Date.now();

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.ok(Date.now() - startedAt < 1000, 'the hanging DOM action must not escape the transition budget');
  assert.equal(hangingActionCalls, 1);
  assert.ok(identityCalls >= 1, 'the committed main document must be strongly verified');
  assert.equal(committedListeners.size, 0, 'successful commit must remove the lifecycle listener');
});

test('runtime times out a Juguang return within budget when both the DOM action and document commit hang', { timeout: 1500 }, async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-hanging-action-no-commit',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构未切回子账户',
  };
  const committedListeners = new Set();
  let hangingActionCalls = 0;
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return {
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-hanging-return-no-commit',
        documentLifecycle: 'active',
        url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
      };
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = (details) => {
    const recorded = originalExecuteScript(details);
    if (typeof details.func !== 'function') return recorded;
    hangingActionCalls += 1;
    return new Promise(() => {});
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 50,
    pageClient: {
      async request() {
        return clone(child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      throw new Error(`collector must not continue for ${platform}`);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);
  const startedAt = Date.now();

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.match(
    result.platforms.juguang.errors[0].message,
    /timed out|commit|document|navigation/i,
  );
  assert.ok(Date.now() - startedAt < 1000, 'the double hang must not escape the transition budget');
  assert.equal(hangingActionCalls, 1);
  assert.equal(committedListeners.size, 0, 'timed-out return must remove the lifecycle listener');
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
  const returnToMainExecutions = chrome.fixture.scriptExecutions
    .filter((execution) => execution.hasFixedFunction);
  assert.equal(returnToMainExecutions.length, 1);
  assert.ok(returnToMainExecutions.every((execution) => (
    execution.target.tabId === 13 && execution.target.allFrames !== true && execution.hasFixedFunction
  )), 'the fixed DOM workflow must stay in the target tab top frame');
  assert.ok(pageClientCalls.length >= 1, 'accountType 4 must be verified after the DOM action');
});

test('runtime ignores a mounted but hidden Juguang return action until the account menu is visible', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-hidden-return',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
    brand: { brandUserName: '虚构所属品牌' },
  };
  const main = {
    vSellerId: 'fictional-main-vseller-hidden-return',
    advertiserId: 1001,
    accountType: 4,
    name: '虚构所属品牌',
  };
  let current = clone(child);
  let currentFrame = {
    tabId: 13,
    frameId: 0,
    documentId: 'fixture-doc-hidden-return-child',
    documentLifecycle: 'active',
    url: `https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=${child.vSellerId}`,
  };
  const committedListeners = new Set();
  const clicked = [];
  let menuOpen = false;
  let identityCalls = 0;
  const chrome = createFakeChrome();
  chrome.webNavigation = {
    async getFrame(input) {
      assert.deepEqual(input, { tabId: 13, frameId: 0 });
      return clone(currentFrame);
    },
    onCommitted: {
      addListener(listener) {
        committedListeners.add(listener);
      },
      removeListener(listener) {
        committedListeners.delete(listener);
      },
    },
  };
  const emitCommitted = (details) => {
    currentFrame = Object.assign({}, currentFrame, details);
    for (const listener of Array.from(committedListeners)) listener(clone(details));
  };
  const visibleRect = {
    top: 12, left: 1080, right: 1260, bottom: 44, width: 180, height: 32,
  };
  const hiddenRect = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  };
  const styleView = {
    getComputedStyle(element) {
      return {
        display: 'block',
        visibility: 'visible',
        pointerEvents: element.pointerBlocked ? 'none' : 'auto',
        opacity: '1',
      };
    },
  };
  const ownerDocument = { defaultView: styleView };
  const pointerBlockedReturnAction = {
    textContent: '返回主账户',
    pointerBlocked: true,
    ownerDocument,
    closest() {
      return this;
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return visibleRect;
    },
    click() {
      clicked.push('return:pointer-blocked');
    },
  };
  const returnAction = {
    textContent: '返回主账户',
    ownerDocument,
    closest() {
      return this;
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return menuOpen ? visibleRect : hiddenRect;
    },
    click() {
      clicked.push(menuOpen ? 'return:visible' : 'return:hidden');
      if (!menuOpen) return;
      current = clone(main);
      emitCommitted({
        tabId: 13,
        frameId: 0,
        documentId: 'fixture-doc-hidden-return-main',
        documentLifecycle: 'active',
        url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
      });
    },
  };
  const accountTrigger = {
    textContent: child.name,
    ownerDocument,
    closest() {
      return this;
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return visibleRect;
    },
    click() {
      clicked.push('account-trigger');
      menuOpen = true;
    },
  };
  const document = {
    documentElement: { clientWidth: 1280 },
    querySelectorAll(selector) {
      const value = String(selector);
      if (value.includes('img.avatar')) return [];
      // The real menu subtree stays mounted while closed; only its geometry changes.
      return [pointerBlockedReturnAction, returnAction, accountTrigger];
    },
  };
  const originalExecuteScript = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (details) => {
    if (typeof details.func === 'function') {
      return executeInjectedFunction(details, document);
    }
    return originalExecuteScript(details);
  };
  const fixture = createRuntimeOptions({
    chrome,
    allowLegacyNavigationFallback: false,
    transitionTimeoutMs: 100,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        identityCalls += 1;
        return clone(current);
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
  assert.deepEqual(clicked, ['account-trigger', 'return:visible']);
  assert.equal(identityCalls, 1);
  assert.equal(committedListeners.size, 0);
  const committedDocumentInjections = chrome.fixture.scriptExecutions.filter((entry) => (
    entry.target && Array.isArray(entry.target.documentIds)
  ));
  assert.deepEqual(committedDocumentInjections.map((entry) => ({
    documentIds: entry.target.documentIds,
    world: entry.world,
  })), [
    { documentIds: ['fixture-doc-hidden-return-main'], world: 'MAIN' },
    { documentIds: ['fixture-doc-hidden-return-main'], world: 'ISOLATED' },
  ]);
});

test('runtime executes the Juguang DOM workflow through the exact current account name without clicking near matches', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-exact-trigger',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
    brandUserName: '虚构所属品牌',
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构所属品牌',
  };
  const clicked = [];
  let menuOpen = false;
  let returnedToMain = false;
  const element = (text, onClick, attributes = {}) => ({
    textContent: text,
    closest() {
      return this;
    },
    getBoundingClientRect() {
      return { top: 12, left: 1100, right: 1240, bottom: 44, width: 140, height: 32 };
    },
    getAttribute(name) {
      return attributes[name] || null;
    },
    click() {
      clicked.push(text);
      if (onClick) onClick();
    },
  });
  const nearMatch = element('虚构当前子账户相关设置');
  const exactAccountButton = element(child.name, () => { menuOpen = true; });
  const returnAction = element('返回主账户', () => { returnedToMain = true; });
  const document = {
    querySelectorAll(selector) {
      if (String(selector).includes('span,div')) {
        return menuOpen
          ? [nearMatch, exactAccountButton, returnAction]
          : [nearMatch, exactAccountButton];
      }
      return [nearMatch, exactAccountButton];
    },
  };
  let injectedArgs = null;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func !== 'function') return [{ result: { ok: true } }];
      injectedArgs = clone(details.args);
      return executeInjectedFunction(details, document);
    },
  });
  const fixture = createRuntimeOptions({
    chrome,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        return clone(returnedToMain ? main : child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(verified.accountType, 4);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(injectedArgs.length, 1);
  assert.ok(injectedArgs[0].includes(child.name));
  assert.ok(injectedArgs[0].includes(child.brandUserName));
  assert.equal(JSON.stringify(injectedArgs).includes(child.vSellerId), false);
  assert.deepEqual(clicked, [child.name, '返回主账户']);
  assert.equal(clicked.includes(nearMatch.textContent), false);
});

test('runtime composes the real Juguang brand-account trigger and waits for its asynchronously mounted return action', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-composed-trigger',
    advertiserId: 2001,
    accountType: 602,
    name: '简墨',
    brand: { brandUserName: 'BARF霸弗狗粮' },
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: 'BARF霸弗狗粮',
  };
  const combinedDisplayName = `${child.brand.brandUserName}-${child.name}`;
  const clicked = [];
  let menuMounted = false;
  let returnedToMain = false;
  let menuTimer = null;
  const element = (text, onClick) => ({
    textContent: text,
    closest() {
      return this;
    },
    getBoundingClientRect() {
      return { top: 12, left: 1080, right: 1260, bottom: 44, width: 180, height: 32 };
    },
    getAttribute() {
      return null;
    },
    click() {
      clicked.push(text);
      if (onClick) onClick();
    },
  });
  const combinedAccountButton = element(combinedDisplayName, () => {
    menuTimer = setTimeout(() => { menuMounted = true; }, 150);
  });
  const separateBrandButton = element(child.brand.brandUserName);
  const separateChildButton = element(child.name);
  const nearMatchButton = element(`${combinedDisplayName}相关设置`);
  const returnAction = element('返回主账户', () => { returnedToMain = true; });
  const document = {
    documentElement: { clientWidth: 1280 },
    querySelectorAll(selector) {
      const value = String(selector);
      if (value.includes('img.avatar')) return [];
      if (value.includes('span,div')) {
        return menuMounted
          ? [separateBrandButton, separateChildButton, nearMatchButton, combinedAccountButton, returnAction]
          : [separateBrandButton, separateChildButton, nearMatchButton, combinedAccountButton];
      }
      return [separateBrandButton, separateChildButton, nearMatchButton, combinedAccountButton];
    },
  };
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func !== 'function') return [{ result: { ok: true } }];
      return executeInjectedFunctionWithRealTimers(details, document);
    },
  });
  const fixture = createRuntimeOptions({
    chrome,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        return clone(returnedToMain ? main : child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(verified.accountType, 4, 'post-action identity must still be the verified main account');
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));
  if (menuTimer) clearTimeout(menuTimer);

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.deepEqual(clicked, [combinedDisplayName, '返回主账户']);
  assert.equal(returnedToMain, true);
});

test('runtime skips a hidden exact Juguang account-name trigger and opens the visible header avatar', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-avatar-trigger',
    advertiserId: 2001,
    accountType: 602,
    name: '虚构当前子账户',
  };
  const main = {
    vSellerId: null,
    advertiserId: 1001,
    accountType: 4,
    name: '虚构所属品牌',
  };
  const clicked = [];
  let menuOpen = false;
  let returnedToMain = false;
  const element = (text, onClick, attributes = {}, rect = null) => ({
    textContent: text,
    closest() {
      return this;
    },
    getAttribute(name) {
      return attributes[name] || null;
    },
    getBoundingClientRect() {
      return rect || { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    click() {
      clicked.push(attributes.label || text);
      if (onClick) onClick();
    },
  });
  const headerAvatar = element('', () => { menuOpen = true; }, { label: 'header-avatar' }, {
    x: 1200, y: 12, top: 12, left: 1200, right: 1232, bottom: 44, width: 32, height: 32,
  });
  const unrelatedAvatar = element('', null, { label: 'unrelated-avatar' }, {
    x: 24, y: 12, top: 12, left: 24, right: 56, bottom: 44, width: 32, height: 32,
  });
  const hiddenExactTrigger = element(child.name, null, { label: 'hidden-exact-account-trigger' });
  const returnAction = element('返回主账户', () => { returnedToMain = true; }, {}, {
    x: 1080, y: 48, top: 48, left: 1080, right: 1232, bottom: 80, width: 152, height: 32,
  });
  const document = {
    documentElement: { clientWidth: 1280 },
    querySelectorAll(selector) {
      const value = String(selector);
      if (value.includes('img.avatar')) return [unrelatedAvatar, headerAvatar];
      if (value.includes('span,div')) return menuOpen ? [returnAction] : [];
      if (value.includes('[class*="account"]')) return [hiddenExactTrigger];
      return [];
    },
  };
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript(details) {
      if (typeof details.func !== 'function') return [{ result: { ok: true } }];
      return executeInjectedFunction(details, document);
    },
  });
  const fixture = createRuntimeOptions({
    chrome,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        return clone(returnedToMain ? main : child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      const verified = await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      assert.equal(verified.accountType, 4);
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.deepEqual(clicked, ['header-avatar', '返回主账户']);
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
  assert.equal(
    chrome.fixture.scriptExecutions.filter((execution) => execution.hasFixedFunction).length,
    1,
  );
});

test('runtime verifies the main identity when return navigation destroys the DOM execution result', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-navigation', advertiserId: 2001, accountType: 602,
  };
  const main = {
    vSellerId: null, advertiserId: 1001, accountType: 4,
  };
  let returnedToMain = false;
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript() {
      returnedToMain = true;
      return [];
    },
  });
  const fixture = createRuntimeOptions({
    chrome,
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        return clone(returnedToMain ? main : child);
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
  assert.equal(
    chrome.fixture.scriptExecutions.filter((execution) => execution.hasFixedFunction).length,
    1,
  );
});

test('runtime does not accept a lost DOM execution result while the verified identity stays child', async () => {
  const runtimeModule = loadRuntime();
  const child = {
    vSellerId: 'fictional-child-vseller-not-returned', advertiserId: 2001, accountType: 602,
  };
  const chrome = createFakeChrome(PLATFORM_TABS, {
    executeScript() {
      return [];
    },
  });
  let currentAttempts = 0;
  const fixture = createRuntimeOptions({
    chrome,
    wait: async () => {},
    pageClient: {
      async request(input) {
        assert.equal(input.platform, 'juguang');
        assert.equal(input.endpoint, 'accounts.current');
        currentAttempts += 1;
        return clone(child);
      },
    },
    collectByPlatform: async (platform, input, dependencies) => {
      await dependencies.returnToMainAccount({
        tabId: input.tabId,
        current: child,
      });
      throw new Error(`collector must not continue for ${platform}`);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({ platforms: ['juguang'] }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.match(result.platforms.juguang.errors[0].message, /accountType|identity|main-account/i);
  assert.ok(
    currentAttempts >= 3 && currentAttempts <= 64,
    `same-document identity polling must stay bounded, received ${currentAttempts} probes`,
  );
});

test('runtime resolves each exact-origin tab at parallel start and keeps platform tab state isolated', async () => {
  const runtimeModule = loadRuntime();
  let juguangTabId = 13;
  const queriedTabs = () => [
    PLATFORM_TABS[0],
    PLATFORM_TABS[1],
    {
      id: juguangTabId,
      url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
    },
  ];
  const calls = [];
  const chrome = createFakeChrome(queriedTabs);
  const fixture = createRuntimeOptions({
    chrome,
    collectByPlatform(platform, input) {
      calls.push({ platform, tabId: input.tabId });
      if (platform === 'adstar') juguangTabId = 31;
      return completeResult(platform);
    },
  });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput());

  assert.equal(result.status, 'complete');
  assert.deepEqual(calls, [
    { platform: 'adstar', tabId: 11 },
    { platform: 'pgy', tabId: 12 },
    { platform: 'juguang', tabId: 13 },
  ]);
  assert.equal(chrome.fixture.tabQueries.length, 3, 'each parallel platform must resolve its own exact-origin tab');
  assert.deepEqual(
    chrome.fixture.scriptExecutions
      .filter((entry) => entry.target.tabId === 13)
      .map((entry) => entry.world),
    ['MAIN', 'ISOLATED'],
    'the Juguang tab selected at parallel start must receive both bridge layers before collection',
  );
});

test('runtime recovers one stale receiver on the current unique tab and retries the bridge request once', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let currentTabId = 13;
  const sends = [];
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage(tabId, message) {
      sends.push({ tabId, endpoint: message.endpoint });
      if (sends.length === 1) {
        currentTabId = 31;
        return undefined;
      }
      return {
        channel: 'xhs-page-bridge-v2',
        type: 'XHS_PAGE_RESPONSE',
        requestId: message.requestId,
        platform: message.platform,
        ok: true,
        data: { advertiserId: 1001, accountType: 4 },
      };
    },
  });
  const chrome = createFakeChrome(() => [{
    id: currentTabId,
    url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  }]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        const identity = await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'accounts.current',
          payload: {},
          signal: input.signal,
        });
        assert.equal(identity.advertiserId, 1001);
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-stale-receiver-tab-replaced',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.deepEqual(sends, [
    { tabId: 13, endpoint: 'accounts.current' },
    { tabId: 31, endpoint: 'accounts.current' },
  ]);
  assert.equal(chrome.fixture.tabQueries.length, 2, 'recovery must re-query tabs exactly once');
  assert.deepEqual(
    chrome.fixture.scriptExecutions.map((entry) => entry.target.tabId),
    [13, 13, 31, 31],
    'recovery must reinstall MAIN and ISOLATED bridges only on the newly selected tab',
  );
});

test('runtime bounds same-tab stale-receiver recovery to one reinjection and one replay', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let sendCount = 0;
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage() {
      sendCount += 1;
      return undefined;
    },
  });
  const chrome = createFakeChrome([
    { id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
  ]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'accounts.current',
          payload: {},
          signal: input.signal,
        });
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-stale-receiver-bounded',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'XHS_PAGE_BRIDGE_UNAVAILABLE');
  assert.equal(sendCount, 2, 'a second missing receiver must surface instead of looping');
  assert.equal(chrome.fixture.tabQueries.length, 2);
  assert.equal(chrome.fixture.scriptExecutions.length, 4);
});

test('runtime fails closed when stale-receiver recovery finds multiple exact-origin tabs', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let receiverFailed = false;
  let sendCount = 0;
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage() {
      sendCount += 1;
      receiverFailed = true;
      return undefined;
    },
  });
  const chrome = createFakeChrome(() => receiverFailed
    ? [
      { id: 31, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
      { id: 32, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/account' },
    ]
    : [{ id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' }]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'accounts.current',
          payload: {},
          signal: input.signal,
        });
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-stale-receiver-ambiguous',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'XHS_PLATFORM_TAB_AMBIGUOUS');
  assert.equal(sendCount, 1, 'an ambiguous replacement must never be guessed or retried');
  assert.equal(chrome.fixture.scriptExecutions.length, 2, 'ambiguous tabs must not receive recovery injection');
});

test('runtime does not recover or duplicate a bridge request rejected by the platform API', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let sendCount = 0;
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage(tabId, message) {
      sendCount += 1;
      return {
        channel: 'xhs-page-bridge-v2',
        type: 'XHS_PAGE_RESPONSE',
        requestId: message.requestId,
        platform: message.platform,
        ok: false,
        code: 'FICTIONAL_JUGUANG_API_DENIED',
        message: 'fictional API returned no response',
        retryable: true,
      };
    },
  });
  const chrome = createFakeChrome([
    { id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
  ]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'reports.query',
          payload: { pageNum: 1 },
          signal: input.signal,
        });
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-api-error-not-recovered',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'FICTIONAL_JUGUANG_API_DENIED');
  assert.equal(sendCount, 1, 'an API response must never be replayed as bridge recovery');
  assert.equal(chrome.fixture.tabQueries.length, 1);
  assert.equal(chrome.fixture.scriptExecutions.length, 2);
});

test('runtime fails closed instead of replaying a data endpoint on a replacement tab from another account', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let currentTabId = 13;
  let observedReport = null;
  const sends = [];
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage(tabId, message) {
      sends.push({ tabId, endpoint: message.endpoint });
      if (message.endpoint === 'accounts.current') {
        return {
          channel: 'xhs-page-bridge-v2',
          type: 'XHS_PAGE_RESPONSE',
          requestId: message.requestId,
          platform: message.platform,
          ok: true,
          data: {
            accountMarker: 'fictional-original-account',
            advertiserId: 1001,
            accountType: 4,
          },
        };
      }
      if (tabId === 13) {
        currentTabId = 31;
        return undefined;
      }
      return {
        channel: 'xhs-page-bridge-v2',
        type: 'XHS_PAGE_RESPONSE',
        requestId: message.requestId,
        platform: message.platform,
        ok: true,
        data: {
          accountMarker: 'fictional-other-account',
          data: { dataList: [{ noteId: 'fictional-cross-account-note', fee: 9999 }] },
        },
      };
    },
  });
  const chrome = createFakeChrome(() => [{
    id: currentTabId,
    url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  }]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        const identity = await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'accounts.current',
          payload: {},
          signal: input.signal,
        });
        assert.equal(identity.accountMarker, 'fictional-original-account');
        observedReport = await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'reports.query',
          payload: { pageNum: 2 },
          signal: input.signal,
        });
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-cross-account-data-tab-replacement',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'failed');
  assert.equal(result.platforms.juguang.errors[0].code, 'XHS_PLATFORM_TAB_CHANGED');
  assert.equal(observedReport, null, 'another account response must never reach the collector');
  assert.deepEqual(sends, [
    { tabId: 13, endpoint: 'accounts.current' },
    { tabId: 13, endpoint: 'reports.query' },
  ]);
  assert.equal(chrome.fixture.tabQueries.length, 2, 'the replacement may be inspected but not selected');
  assert.equal(chrome.fixture.scriptExecutions.length, 2, 'the other account tab must not be injected');
});

test('runtime may reinstall and replay a data endpoint once when the unique tab id is unchanged', async () => {
  const runtimeModule = loadRuntime();
  const { createPageClient } = require(path.join(root, 'xhs', 'page-client.js'));
  let sendCount = 0;
  const pageClient = createPageClient({
    timeoutMs: 100,
    async sendMessage(tabId, message) {
      sendCount += 1;
      if (sendCount === 1) return undefined;
      return {
        channel: 'xhs-page-bridge-v2',
        type: 'XHS_PAGE_RESPONSE',
        requestId: message.requestId,
        platform: message.platform,
        ok: true,
        data: { data: { dataList: [], page: { totalCount: 0 } } },
      };
    },
  });
  const chrome = createFakeChrome([
    { id: 13, url: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note' },
  ]);
  const collectors = {
    juguang: (dependencies) => ({
      async collect(input) {
        await dependencies.pageClient.request({
          tabId: input.tabId,
          platform: 'juguang',
          endpoint: 'reports.query',
          payload: { pageNum: 1 },
          signal: input.signal,
        });
        return completeResult('juguang');
      },
    }),
  };
  const fixture = createRuntimeOptions({ chrome, collectors, pageClient });
  const runtime = runtimeModule.createXhsRuntime(fixture.options);

  const result = await runtime.run(runInput({
    runId: 'fixture-same-tab-data-bridge-recovery',
    platforms: ['juguang'],
  }));

  assert.equal(result.platforms.juguang.status, 'complete');
  assert.equal(sendCount, 2);
  assert.equal(chrome.fixture.tabQueries.length, 2);
  assert.equal(chrome.fixture.scriptExecutions.length, 4);
});
