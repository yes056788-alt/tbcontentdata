const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const runtimePath = path.join(root, 'xhs', 'runtime.js');
const CONTENT_BRIDGE_FILE = 'xhs-platform-content.js';
const DATE_RANGE = Object.freeze({
  from: '2030-01-01',
  to: '2030-01-07',
  timezone: 'Asia/Shanghai',
});
const PLATFORM_CASES = Object.freeze([
  Object.freeze({
    platform: 'adstar',
    tabId: 711,
    origin: 'https://adstar.alimama.com',
    hookFile: 'adstar-page-hook.js',
    endpoint: 'projects.list',
    responseBody: { success: true, model: { result: [], totalCount: 0 } },
  }),
  Object.freeze({
    platform: 'pgy',
    tabId: 712,
    origin: 'https://pgy.xiaohongshu.com',
    hookFile: 'pgy-page-hook.js',
    endpoint: 'notes.list',
    responseBody: { code: 0, data: { list: [], total: 0, totalPage: 0 } },
  }),
  Object.freeze({
    platform: 'juguang',
    tabId: 713,
    origin: 'https://ad.xiaohongshu.com',
    hookFile: 'juguang-page-hook.js',
    endpoint: 'reports.query',
    responseBody: { code: 0, data: { data: { dataList: [], page: { totalCount: 0 } } } },
  }),
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadRuntime() {
  delete require.cache[runtimePath];
  return require(runtimePath);
}

function completeResult(platform) {
  return {
    schemaVersion: 1,
    platform,
    status: 'complete',
    schemaValid: true,
    paginationComplete: true,
    reconciled: true,
    truncated: false,
    expectedCount: 0,
    receivedCount: 0,
    warnings: [],
    errors: [],
    normalizedRows: [],
  };
}

function createFakeChrome(platformCase, executeScript) {
  const scriptExecutions = [];
  const storageWrites = [];
  return {
    runtime: {
      id: 'fixture-extension-id',
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        async set(value) {
          storageWrites.push(clone(value));
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: platformCase.tabId, url: `${platformCase.origin}/fixture-page` }];
      },
      async update(tabId, update) {
        return { id: tabId, url: update.url };
      },
    },
    scripting: {
      async executeScript(details) {
        scriptExecutions.push(clone(details));
        if (typeof executeScript === 'function') return executeScript(details, scriptExecutions.length);
        return [{ frameId: 0, result: true }];
      },
    },
    fixture: { scriptExecutions, storageWrites },
  };
}

function runInput(platformCase) {
  return {
    runId: `fixture-bridge-recovery-${platformCase.platform}`,
    accountKey: 'fixture-account-key',
    dateRange: DATE_RANGE,
    platforms: [platformCase.platform],
  };
}

function createRuntime(platformCase, options = {}) {
  const chrome = createFakeChrome(platformCase, options.executeScript);
  let collectCount = 0;
  const collectors = {
    [platformCase.platform]: () => ({
      async collect(input) {
        collectCount += 1;
        if (typeof options.collect === 'function') {
          return options.collect(input, chrome.fixture.scriptExecutions);
        }
        return completeResult(platformCase.platform);
      },
    }),
  };
  const runtime = loadRuntime().createXhsRuntime({
    chrome,
    cache: { kind: 'fixture-cache' },
    collectors,
    pageClient: {
      async request() {
        throw new Error('fixture page client must not be reached by this recovery contract');
      },
    },
    now: () => '2030-01-08T00:00:00.000Z',
    wait: async () => {},
  });
  return { chrome, runtime, get collectCount() { return collectCount; } };
}

function assertFixedTopFrameInjection(actual, expected) {
  assert.deepEqual(actual.target, { tabId: expected.tabId, frameIds: [0] });
  assert.equal(actual.target.allFrames, undefined);
  assert.equal(actual.world, expected.world);
  assert.deepEqual(actual.files, [expected.file]);
  assert.equal(actual.func, undefined);
}

function evaluateTwice(filename, origin, includeChromeRuntime) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const runtimeListeners = [];
  const windowListeners = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') windowListeners.push(listener);
    },
    postMessage() {},
  };
  windowObject.window = windowObject;
  windowObject.self = windowObject;
  windowObject.top = windowObject;

  const globals = {
    TextEncoder,
    URL,
    clearTimeout() {},
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    crypto: {
      randomUUID() { return 'fixture-nonce-123456'; },
      getRandomValues(values) { return values.fill(7); },
    },
    document: { cookie: '' },
    location: { href: `${origin}/fixture-page`, origin },
    performance: { getEntriesByType() { return []; } },
    self: windowObject,
    setTimeout() { return 1; },
    top: windowObject,
    window: windowObject,
  };
  if (includeChromeRuntime) {
    globals.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
      },
    };
  }
  const context = vm.createContext(globals);
  vm.runInContext(source, context, { filename: path.join(root, filename) });
  vm.runInContext(source, context, { filename: path.join(root, filename) });
  return { runtimeListeners, windowListeners };
}

async function evaluateLegacyAndCurrentHook(platformCase) {
  const currentSource = fs.readFileSync(path.join(root, platformCase.hookFile), 'utf8');
  const windowListeners = [];
  const posted = [];
  const requests = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.status = 0;
      this.responseText = '';
      requests.push(this);
    }

    open(method, url) {
      this.method = String(method || '').toUpperCase();
      this.url = String(url || '');
    }

    setRequestHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    }

    send(body) {
      this.body = body;
      this.status = 200;
      this.responseText = JSON.stringify(platformCase.responseBody);
      queueMicrotask(() => {
        if (typeof this.onload === 'function') this.onload();
      });
    }
  }

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') windowListeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.window = windowObject;
  windowObject.self = windowObject;
  windowObject.top = windowObject;

  const context = vm.createContext({
    TextEncoder,
    URL,
    XMLHttpRequest: FakeXMLHttpRequest,
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
    decodeURIComponent,
    document: { cookie: '_tb_token_=fixture-migration-token' },
    location: { href: `${platformCase.origin}/fixture-page`, origin: platformCase.origin },
    performance: { getEntriesByType() { return []; } },
    queueMicrotask,
    self: windowObject,
    top: windowObject,
    window: windowObject,
  });

  const legacySource = `
    (function installLegacyUnguardedV1Hook() {
      window.addEventListener('message', function onLegacyV1Message(event) {
        var message = event.data;
        if (event.source !== window || event.origin !== ${JSON.stringify(platformCase.origin)}) return;
        if (!message || message.channel !== 'xhs-page-bridge-v1') return;
        if (message.type !== 'XHS_PAGE_REQUEST' || message.platform !== ${JSON.stringify(platformCase.platform)}) return;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/fixture-legacy-v1');
        xhr.onload = function legacyResponse() {
          window.postMessage({
            channel: 'xhs-page-bridge-v1',
            type: 'XHS_PAGE_RESPONSE',
            platform: message.platform,
            requestId: message.requestId,
            nonce: message.nonce,
            ok: true,
            data: {},
          }, ${JSON.stringify(platformCase.origin)});
        };
        xhr.send('{}');
      });
    })();
  `;
  vm.runInContext(legacySource, context, { filename: 'legacy-xhs-page-hook-v1.js' });
  vm.runInContext(currentSource, context, { filename: path.join(root, platformCase.hookFile) });
  vm.runInContext(currentSource, context, { filename: path.join(root, platformCase.hookFile) });

  const request = {
    channel: 'xhs-page-bridge-v2',
    type: 'XHS_PAGE_REQUEST',
    platform: platformCase.platform,
    endpoint: platformCase.endpoint,
    requestId: `fixture-migration-${platformCase.platform}`,
    nonce: 'fixture-migration-nonce',
    payload: platformCase.platform === 'adstar'
      ? { pageNo: 1, pageSize: 20 }
      : { pageNum: 1, pageSize: 20 },
  };
  const event = { source: windowObject, origin: platformCase.origin, data: request };
  for (const listener of windowListeners) listener(event);
  await new Promise((resolve) => setImmediate(resolve));
  return { posted, requests, windowListeners };
}

test('runtime deterministically reinstalls each platform bridge in the top frame before collecting', async (t) => {
  for (const platformCase of PLATFORM_CASES) {
    await t.test(platformCase.platform, async () => {
      let executionsSeenByCollector = null;
      const fixture = createRuntime(platformCase, {
        collect(input, executions) {
          assert.equal(input.tabId, platformCase.tabId);
          executionsSeenByCollector = clone(executions);
          return completeResult(platformCase.platform);
        },
      });

      const result = await fixture.runtime.run(runInput(platformCase));

      assert.equal(result.status, 'complete');
      assert.equal(fixture.collectCount, 1);
      assert.equal(fixture.chrome.fixture.scriptExecutions.length, 2);
      assert.deepEqual(
        executionsSeenByCollector,
        fixture.chrome.fixture.scriptExecutions,
        'both bridge layers must finish before the collector starts',
      );
      assertFixedTopFrameInjection(fixture.chrome.fixture.scriptExecutions[0], {
        tabId: platformCase.tabId,
        world: 'MAIN',
        file: platformCase.hookFile,
      });
      assertFixedTopFrameInjection(fixture.chrome.fixture.scriptExecutions[1], {
        tabId: platformCase.tabId,
        world: 'ISOLATED',
        file: CONTENT_BRIDGE_FILE,
      });
    });
  }
});

test('runtime recovers a stale post-reload page before the collector reaches the bridge', async (t) => {
  for (const platformCase of PLATFORM_CASES) {
    await t.test(platformCase.platform, async () => {
      let mainHookReady = false;
      let isolatedReceiverReady = false;
      const fixture = createRuntime(platformCase, {
        executeScript(details) {
          if (details.world === 'MAIN' && details.files[0] === platformCase.hookFile) {
            mainHookReady = true;
          }
          if (details.world === 'ISOLATED' && details.files[0] === CONTENT_BRIDGE_FILE) {
            isolatedReceiverReady = true;
          }
          return [{ frameId: 0, result: true }];
        },
        collect() {
          if (!mainHookReady || !isolatedReceiverReady) {
            throw new Error('fixture stale page bridge was not recovered before collection');
          }
          return completeResult(platformCase.platform);
        },
      });

      const result = await fixture.runtime.run(runInput(platformCase));

      assert.equal(result.status, 'complete');
      assert.equal(result.platforms[platformCase.platform].status, 'complete');
      assert.equal(fixture.collectCount, 1);
    });
  }
});

test('runtime reports a stable recovery code and never collects when either bridge injection fails', async (t) => {
  for (const platformCase of PLATFORM_CASES) {
    for (const failedLayer of [1, 2]) {
      await t.test(`${platformCase.platform}:layer-${failedLayer}`, async () => {
        const fixture = createRuntime(platformCase, {
          executeScript(details, executionNumber) {
            if (executionNumber === failedLayer) {
              throw new Error(`fixture ${details.world} bridge injection failed`);
            }
            return [{ frameId: 0, result: true }];
          },
        });

        const result = await fixture.runtime.run(runInput(platformCase));
        const platformResult = result.platforms[platformCase.platform];

        assert.equal(result.status, 'failed');
        assert.equal(platformResult.status, 'failed');
        assert.equal(platformResult.errors[0].code, 'XHS_PAGE_BRIDGE_RECOVERY_FAILED');
        assert.match(platformResult.errors[0].message, /bridge|桥接|注入/i);
        assert.equal(fixture.collectCount, 0);
        assert.equal(fixture.chrome.fixture.scriptExecutions.length, failedLayer);
      });
    }
  }
});

test('reinjecting MAIN hooks and the isolated receiver is idempotent and does not duplicate listeners', () => {
  for (const platformCase of PLATFORM_CASES) {
    const mainWorld = evaluateTwice(platformCase.hookFile, platformCase.origin, false);
    assert.equal(mainWorld.windowListeners.length, 1, `${platformCase.platform} MAIN listener`);

    const isolatedWorld = evaluateTwice(CONTENT_BRIDGE_FILE, platformCase.origin, true);
    assert.equal(isolatedWorld.runtimeListeners.length, 1, `${platformCase.platform} runtime listener`);
    assert.equal(isolatedWorld.windowListeners.length, 1, `${platformCase.platform} window listener`);
  }
});

test('v2 requests ignore a resident unguarded v1 hook and produce exactly one XHR and response', async (t) => {
  const pageClient = require(path.join(root, 'xhs', 'page-client.js'));
  assert.equal(pageClient.CHANNEL, 'xhs-page-bridge-v2');

  for (const platformCase of PLATFORM_CASES) {
    await t.test(platformCase.platform, async () => {
      const migration = await evaluateLegacyAndCurrentHook(platformCase);

      assert.equal(migration.windowListeners.length, 2, 'one legacy listener plus one guarded v2 listener');
      assert.equal(migration.requests.length, 1, 'the resident v1 hook must ignore the v2 request');
      assert.equal(migration.posted.length, 1, 'the v2 hook must return exactly one response');
      assert.equal(migration.posted[0].message.channel, 'xhs-page-bridge-v2');
      assert.equal(migration.posted[0].message.requestId, `fixture-migration-${platformCase.platform}`);
    });
  }
});
