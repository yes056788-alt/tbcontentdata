const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web-tool', 'cloud-sync.js'), 'utf8');
const TEAM_ORIGIN = 'https://tbdata.aizicheng.com';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function jsonResponse(body, status = 200) {
  const text = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return String(Buffer.byteLength(text)); } },
    async text() { return text; },
  };
}

function activeSession() {
  return {
    member: { status: 'active', role: 'owner' },
    role: 'owner',
    mustChangePassword: false,
    permissions: {
      canReadVault: true,
      canWriteVault: true,
      canWriteDirectory: true,
      canReadRuns: true,
      canWriteRuns: true,
      canDeleteRuns: true,
    },
  };
}

function createFakeClock(startAt = 1893456000000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map();
  class FakeDate extends Date {
    static now() { return now; }
  }
  function setTimeoutFake(callback, delay) {
    const id = nextId++;
    timers.set(id, { callback, dueAt: now + Math.max(0, Number(delay) || 0) });
    return id;
  }
  function clearTimeoutFake(id) { timers.delete(id); }
  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].dueAt;
      due[1].callback();
      await flush();
    }
    now = target;
    await flush();
  }
  return { Date: FakeDate, advance, clearTimeout: clearTimeoutFake, setTimeout: setTimeoutFake };
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function createHarness(options = {}) {
  const origin = options.origin || TEAM_ORIGIN;
  const clock = createFakeClock();
  const listeners = new Map();
  const bridgeCalls = [];
  const httpCalls = [];
  const cloudEvents = [];
  let remainingLockFailures = Math.max(0, Number(options.lockFailures) || 0);
  let backgroundPlaintextPresent = true;
  let sessionMode = 'active';
  let documentVisibility = 'visible';

  function addListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  }
  function dispatch(type, event = {}) {
    (listeners.get(type) || []).slice().forEach((listener) => listener(event));
  }

  const windowObject = {
    addEventListener: addListener,
    dispatchEvent(event) {
      cloudEvents.push(clone(event.detail));
      dispatch(event.type, event);
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    postMessage(message, targetOrigin) {
      assert.equal(targetOrigin, origin);
      bridgeCalls.push(clone(message));
      queueMicrotask(() => {
        let data = {};
        let error = null;
        try {
          if (message.action === 'ping') data = { connected: true, capabilities: ['cloudSync'] };
          else if (message.action === 'bindAccountVaultScope') data = {
            bound: true,
            vaultScopeId: origin === TEAM_ORIGIN
              ? 'team:https://tbdata.aizicheng.com'
              : 'local:tbcontentdata',
            vaultLockEpoch: 0,
          };
          else if (message.action === 'getStorage') data = {};
          else if (message.action === 'listStoreRuns') data = { runs: [] };
          else if (message.action === 'lockAccountVault') {
            if (remainingLockFailures > 0) {
              remainingLockFailures -= 1;
              throw new Error('bridge temporarily unavailable');
            }
            backgroundPlaintextPresent = false;
            data = {
              ok: true,
              locked: true,
              vaultLockEpoch: 1,
            };
          }
          else throw new Error('unexpected bridge action: ' + message.action);
        } catch (caught) {
          error = caught;
        }
        dispatch('message', {
          source: windowObject,
          origin,
          data: {
            channel: 'taobao-full-chain-tool-v1',
            type: 'response',
            requestId: message.requestId,
            ok: !error,
            data,
            message: error && error.message,
          },
        });
      });
    },
  };
  windowObject.top = windowObject;

  const documentObject = {
    addEventListener: addListener,
    get visibilityState() { return documentVisibility; },
  };
  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    httpCalls.push({ method, pathname: url.pathname });
    if (url.pathname === '/api/session') {
      if (sessionMode === 'network-error') throw new Error('network unavailable');
      if (sessionMode === 'disabled') {
        return jsonResponse({ error: { code: 'MEMBER_DISABLED' } }, 403);
      }
      return jsonResponse(activeSession());
    }
    if (url.pathname === '/api/vault') return jsonResponse({ vault: null, revision: 0 });
    if (url.pathname === '/api/directory') return jsonResponse({ directory: null, revision: 0 });
    if (url.pathname === '/api/runs') return jsonResponse({ runs: [] });
    return jsonResponse({ error: { message: 'unexpected endpoint' } }, 500);
  }

  const context = vm.createContext({
    AbortController,
    Array,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    Date: clock.Date,
    clearTimeout: clock.clearTimeout,
    console,
    document: documentObject,
    fetch,
    location: { origin, hostname: new URL(origin).hostname },
    queueMicrotask,
    setTimeout: clock.setTimeout,
    window: windowObject,
  });
  vm.runInContext(source, context, { filename: 'cloud-sync.js' });

  return {
    bridgeCalls,
    clock,
    cloudEvents,
    httpCalls,
    windowObject,
    isBackgroundPlaintextPresent() { return backgroundPlaintextPresent; },
    dispatchFocus() { dispatch('focus', {}); },
    setSessionMode(value) { sessionMode = value; },
    setVisibility(value) { documentVisibility = value; dispatch('visibilitychange', {}); },
  };
}

function count(calls, pathname) {
  return calls.filter((call) => call.pathname === pathname).length;
}

test('30-second production heartbeat locks vault memory on server revocation without syncing runs', async () => {
  const harness = createHarness();
  const ready = await harness.windowObject.TaobaoCloudSync.ready;
  assert.equal(ready.ok, true, ready.message);
  const initialSessions = count(harness.httpCalls, '/api/session');
  const initialRuns = count(harness.httpCalls, '/api/runs');
  harness.setSessionMode('disabled');

  await harness.clock.advance(30000);

  assert.equal(count(harness.httpCalls, '/api/session'), initialSessions + 1);
  assert.equal(count(harness.httpCalls, '/api/runs'), initialRuns,
    'heartbeat must not trigger a full runs synchronization');
  assert.equal(harness.bridgeCalls.filter((call) => call.action === 'lockAccountVault').length, 1);
  assert.ok(harness.cloudEvents.some((event) => event && event.type === 'vault-locked'));
  harness.windowObject.TaobaoCloudSync.stop();
});

test('focus and visible transitions immediately revalidate and network failure locks fail-closed', async (t) => {
  for (const trigger of ['focus', 'visible']) {
    await t.test(trigger, async () => {
      const harness = createHarness();
      await harness.windowObject.TaobaoCloudSync.ready;
      const initialSessions = count(harness.httpCalls, '/api/session');
      harness.setSessionMode('network-error');
      if (trigger === 'focus') harness.dispatchFocus();
      else {
        harness.setVisibility('hidden');
        harness.setVisibility('visible');
      }
      await flush();

      assert.equal(count(harness.httpCalls, '/api/session'), initialSessions + 1);
      assert.equal(harness.bridgeCalls.filter((call) => call.action === 'lockAccountVault').length, 1);
      harness.windowObject.TaobaoCloudSync.stop();
    });
  }
});

test('revoked team vault retries a failed bridge lock until background plaintext is cleared', async () => {
  const harness = createHarness({ lockFailures: 2 });
  await harness.windowObject.TaobaoCloudSync.ready;
  harness.setSessionMode('disabled');

  await harness.clock.advance(30000);

  const lockCalls = () => harness.bridgeCalls.filter(
    (call) => call.action === 'lockAccountVault'
  ).length;
  assert.equal(lockCalls(), 1);
  assert.equal(harness.isBackgroundPlaintextPresent(), true);

  await harness.clock.advance(999);
  assert.equal(lockCalls(), 1, 'first retry must be rate-limited');
  await harness.clock.advance(1);
  assert.equal(lockCalls(), 2);
  assert.equal(harness.isBackgroundPlaintextPresent(), true);

  await harness.clock.advance(1999);
  assert.equal(lockCalls(), 2, 'failed retries must back off');
  await harness.clock.advance(1);
  assert.equal(lockCalls(), 3);
  assert.equal(harness.isBackgroundPlaintextPresent(), false);

  await harness.clock.advance(60000);
  assert.equal(lockCalls(), 3, 'successful lock must stop retrying');
  harness.windowObject.TaobaoCloudSync.stop();
});

test('stopping cloud sync cancels a pending revoked-vault lock retry', async () => {
  const harness = createHarness({ lockFailures: 100 });
  await harness.windowObject.TaobaoCloudSync.ready;
  harness.setSessionMode('network-error');

  await harness.clock.advance(30000);
  const lockCallsBeforeStop = harness.bridgeCalls.filter(
    (call) => call.action === 'lockAccountVault'
  ).length;
  assert.equal(lockCallsBeforeStop, 1);

  harness.windowObject.TaobaoCloudSync.stop();
  await harness.clock.advance(120000);

  assert.equal(harness.bridgeCalls.filter(
    (call) => call.action === 'lockAccountVault'
  ).length, lockCallsBeforeStop);
});

test('local development never starts the production session heartbeat', async () => {
  const harness = createHarness({ origin: 'http://127.0.0.1:3400' });
  await harness.windowObject.TaobaoCloudSync.ready;
  const initialSessions = count(harness.httpCalls, '/api/session');
  harness.setSessionMode('network-error');
  harness.dispatchFocus();
  harness.setVisibility('hidden');
  harness.setVisibility('visible');
  await harness.clock.advance(60000);

  assert.equal(count(harness.httpCalls, '/api/session'), initialSessions);
  assert.equal(harness.bridgeCalls.some((call) => call.action === 'lockAccountVault'), false);
  harness.windowObject.TaobaoCloudSync.stop();
});
