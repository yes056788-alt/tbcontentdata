import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../app/components/vault-session-lock.ts", import.meta.url);

function windowHarness(options = {}) {
  const listeners = new Map();
  const messages = [];
  const redirects = [];
  const windowObject = {
    location: {
      origin: "https://tbdata.aizicheng.com",
      replace(path) { redirects.push(path); },
    },
    TaobaoCloudSync: options.cloudSync,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
      options.onPostMessage?.(message, targetOrigin, dispatch);
    },
    setTimeout,
    clearTimeout,
  };
  function dispatch(data, overrides = {}) {
    for (const listener of listeners.get("message") ?? []) {
      listener({
        source: overrides.source ?? windowObject,
        origin: overrides.origin ?? windowObject.location.origin,
        data,
      });
    }
  }
  return { windowObject, messages, redirects, dispatch };
}

async function loadModule(harness) {
  globalThis.window = harness.windowObject;
  return import(`${moduleUrl.href}?test=${Date.now()}-${Math.random()}`);
}

test("vault lock uses the cloud synchronizer when it is available", async () => {
  let calls = 0;
  const harness = windowHarness({
    cloudSync: {
      async lockAccountVault() {
        calls += 1;
        return { ok: true, locked: true };
      },
    },
  });
  const api = await loadModule(harness);
  assert.equal(await api.lockAccountVaultSession(), true);
  assert.equal(calls, 1);
  assert.equal(harness.messages.length, 0);
});

test("vault lock validates a real extension bridge response", async () => {
  const harness = windowHarness({
    onPostMessage(message, _targetOrigin, dispatch) {
      queueMicrotask(() => {
        dispatch({
          channel: "taobao-full-chain-tool-v1",
          type: "response",
          requestId: message.requestId,
          ok: true,
          data: { locked: true, vaultLockEpoch: 4 },
        });
      });
    },
  });
  const api = await loadModule(harness);
  assert.equal(await api.lockAccountVaultSession(50), true);
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].message.action, "lockAccountVault");
  assert.equal(harness.messages[0].targetOrigin, harness.windowObject.location.origin);
});

test("auth redirect waits for the lock attempt and still leaves when the bridge is absent", async () => {
  const harness = windowHarness();
  const api = await loadModule(harness);
  const result = await api.lockVaultAndRedirect("/login?next=%2Fadmin", 5);
  assert.equal(result.locked, false);
  assert.deepEqual(harness.redirects, ["/login?next=%2Fadmin"]);
});
