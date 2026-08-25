const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'web-tool-bridge.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const TEAM_SCOPE_ID = 'team:https://tbdata.aizicheng.com';

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function activeSession() {
  return {
    member: { status: 'active', role: 'owner' },
    role: 'owner',
    mustChangePassword: false,
    permissions: {
      canReadVault: true,
      canWriteRuns: true,
    },
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return copy(body); },
  };
}

function createBridgeHarness(fetchImpl) {
  const runtimeListeners = [];
  const fetchCalls = [];
  const runtimeMessages = [];
  const localState = {
    taobaoAccountVaultScopeV1: TEAM_SCOPE_ID,
    taobaoAccountVaultLockEpochV1: 4,
  };
  const windowObject = {
    addEventListener() {},
    postMessage() {},
    confirm() { return true; },
  };
  windowObject.top = windowObject;
  const chromeObject = {
    runtime: {
      id: 'extension-under-test',
      lastError: null,
      getManifest() { return { version: '9.9.9' }; },
      sendMessage(message, callback) {
        runtimeMessages.push(copy(message));
        callback({ ok: true });
      },
      onMessage: {
        addListener(listener) { runtimeListeners.push(listener); },
      },
    },
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.filter((key) => (
            Object.prototype.hasOwnProperty.call(localState, key)
          )).map((key) => [key, copy(localState[key])]));
        },
        async set(value) { Object.assign(localState, copy(value)); },
        async remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete localState[key]);
        },
      },
      onChanged: { addListener() {} },
    },
  };
  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextEncoder,
    URL,
    clearTimeout,
    setTimeout,
    chrome: chromeObject,
    console,
    document: {
      visibilityState: 'visible',
      hasFocus() { return true; },
    },
    async fetch(url, options) {
      fetchCalls.push({ url: String(url), options: Object.assign({}, options) });
      return fetchImpl(url, options);
    },
    location: {
      origin: 'https://tbdata.aizicheng.com',
      hostname: 'tbdata.aizicheng.com',
      pathname: '/report.html',
    },
    window: windowObject,
  });
  vm.runInContext(bridgeSource, context, { filename: 'web-tool-bridge.js' });

  async function challenge(nonce = 'challenge-1234567890') {
    const message = {
      type: 'TEAM_VAULT_START_AUTH_CHALLENGE',
      nonce,
      vaultScopeId: TEAM_SCOPE_ID,
    };
    return new Promise((resolve, reject) => {
      let handled = false;
      for (const listener of runtimeListeners) {
        const keepAlive = listener(message, { id: 'extension-under-test' }, resolve);
        if (keepAlive === true) handled = true;
      }
      if (!handled) reject(new Error('bridge did not register the authorization challenge listener'));
    });
  }

  return { challenge, fetchCalls, runtimeMessages };
}

function createBackgroundHarness(responder) {
  const start = backgroundSource.indexOf('const BUSINESS_DEFENSE_WEB_TOOL_ORIGINS');
  const end = backgroundSource.indexOf('\nasync function syncActionAvailability', start);
  assert.ok(start >= 0 && end > start, 'background live-authorization helpers are missing');
  let plaintextSessionPresent = true;
  let lockCount = 0;
  let challengeCount = 0;
  let runtimeLastError = null;
  const context = vm.createContext({
    Date,
    Error,
    Math,
    Number,
    Object,
    Promise,
    String,
    URL,
    clearTimeout,
    crypto: { randomUUID: () => 'background-challenge-1234567890' },
    setTimeout,
    chrome: {
      runtime: {
        get lastError() { return runtimeLastError; },
      },
      tabs: {
        sendMessage(tabId, message, options, callback) {
          challengeCount += 1;
          Promise.resolve().then(async () => {
            try {
              const value = await responder({ tabId, message: copy(message), options: copy(options) });
              runtimeLastError = value && value.runtimeError
                ? { message: value.runtimeError }
                : null;
              callback(value && value.runtimeError ? undefined : copy(value));
            } finally {
              runtimeLastError = null;
            }
          });
        },
      },
    },
    async lockAccountManagementSession() {
      lockCount += 1;
      plaintextSessionPresent = false;
      return 5;
    },
  });
  vm.runInContext(
    backgroundSource.slice(start, end) +
      '\nglobalThis.enforceAuthorization = enforceFreshVaultTaskAuthorization;',
    context,
    { filename: 'background-live-authorization.js' },
  );
  return {
    context,
    get plaintextSessionPresent() { return plaintextSessionPresent; },
    get lockCount() { return lockCount; },
    get challengeCount() { return challengeCount; },
  };
}

function sender(origin = 'https://tbdata.aizicheng.com') {
  return {
    url: origin + '/report.html',
    tab: { id: 19, url: origin + '/report.html' },
    frameId: 0,
  };
}

test('trusted bridge performs a no-store same-origin session check and returns no credential token', async () => {
  const harness = createBridgeHarness(async () => response(200, activeSession()));
  const result = await harness.challenge();

  assert.equal(result.ok, true);
  assert.equal(result.nonce, 'challenge-1234567890');
  assert.equal(result.vaultScopeId, TEAM_SCOPE_ID);
  assert.equal(Number.isSafeInteger(result.checkedAt), true);
  assert.equal('token' in result, false);
  assert.equal('cookie' in result, false);
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].url, 'https://tbdata.aizicheng.com/api/session');
  assert.equal(harness.fetchCalls[0].options.credentials, 'same-origin');
  assert.equal(harness.fetchCalls[0].options.cache, 'no-store');
  assert.equal(harness.fetchCalls[0].options.redirect, 'error');
});

test('trusted bridge fails closed for disabled or unauthorized members', async (t) => {
  for (const sessionPayload of [
    Object.assign(activeSession(), { member: { status: 'disabled', role: 'owner' } }),
    Object.assign(activeSession(), {
      role: 'viewer',
      member: { status: 'active', role: 'viewer' },
      permissions: { canReadVault: false, canWriteRuns: false },
    }),
  ]) {
    await t.test(sessionPayload.role || sessionPayload.member.status, async () => {
      const harness = createBridgeHarness(async () => response(200, sessionPayload));
      const result = await harness.challenge();
      assert.equal(result.ok, false);
      assert.equal(result.nonce, 'challenge-1234567890');
      assert.equal(result.checkedAt, undefined);
    });
  }
});

test('trusted bridge rejects malformed password-change state and contradictory roles', async (t) => {
  const malformedSessions = [
    (() => { const value = activeSession(); delete value.mustChangePassword; return value; })(),
    Object.assign(activeSession(), { mustChangePassword: null }),
    Object.assign(activeSession(), { mustChangePassword: 'false' }),
    Object.assign(activeSession(), { member: { status: 'active', role: 'operator' } }),
  ];
  for (const sessionPayload of malformedSessions) {
    await t.test(JSON.stringify(sessionPayload), async () => {
      const harness = createBridgeHarness(async () => response(200, sessionPayload));
      const result = await harness.challenge();
      assert.equal(result.ok, false);
      assert.equal(result.checkedAt, undefined);
    });
  }
});

test('disabled server session locks plaintext before a vault task can call login', async () => {
  const bridge = createBridgeHarness(async () => response(403, {
    error: { code: 'MEMBER_DISABLED' },
  }));
  const background = createBackgroundHarness(async ({ message }) => bridge.challenge(message.nonce));
  let loginCalls = 0;

  await assert.rejects(
    (async () => {
      await background.context.enforceAuthorization(
        { source: 'business-defense-web-tool' },
        sender(),
        TEAM_SCOPE_ID,
      );
      loginCalls += 1;
    })(),
    /登录|授权|锁定|失效/,
  );
  assert.equal(background.plaintextSessionPresent, false);
  assert.equal(background.lockCount, 1);
  assert.equal(loginCalls, 0);
  assert.equal(bridge.runtimeMessages.some((message) => (
    message.type === 'PROJECT_TASK_START' || message.type === 'ACCOUNT_BATCH_START_FROM_SESSION'
  )), false);
});

test('unreachable authorization network fails closed and clears plaintext', async () => {
  const bridge = createBridgeHarness(async () => {
    throw new Error('network unavailable');
  });
  const background = createBackgroundHarness(async ({ message }) => bridge.challenge(message.nonce));

  await assert.rejects(
    background.context.enforceAuthorization(
      { source: 'business-defense-web-tool' },
      sender(),
      TEAM_SCOPE_ID,
    ),
    /登录|授权|锁定|失效/,
  );
  assert.equal(background.plaintextSessionPresent, false);
  assert.equal(background.lockCount, 1);
});

test('background accepts only its current fresh challenge response and local dev remains compatible', async () => {
  const success = createBackgroundHarness(async ({ message }) => ({
    ok: true,
    nonce: message.nonce,
    vaultScopeId: TEAM_SCOPE_ID,
    checkedAt: Date.now(),
  }));
  await success.context.enforceAuthorization(
    { source: 'business-defense-web-tool' },
    sender(),
    TEAM_SCOPE_ID,
  );
  assert.equal(success.lockCount, 0);
  assert.equal(success.challengeCount, 1);

  const replay = createBackgroundHarness(async ({ message }) => ({
    ok: true,
    nonce: message.nonce + '-replayed',
    vaultScopeId: TEAM_SCOPE_ID,
    checkedAt: Date.now(),
  }));
  await assert.rejects(
    replay.context.enforceAuthorization(
      { source: 'business-defense-web-tool' },
      sender(),
      TEAM_SCOPE_ID,
    ),
  );
  assert.equal(replay.lockCount, 1);

  const local = createBackgroundHarness(async () => {
    throw new Error('local development must not call the cloud authorization endpoint');
  });
  await local.context.enforceAuthorization(
    { source: 'business-defense-web-tool' },
    sender('http://127.0.0.1:3400'),
    'local:tbcontentdata',
  );
  assert.equal(local.challengeCount, 0);
  assert.equal(local.lockCount, 0);
});

test('background binds the authorization challenge to the initiating document when available', async () => {
  let messageOptions = null;
  const harness = createBackgroundHarness(async ({ message, options }) => {
    messageOptions = options;
    return {
      ok: true,
      nonce: message.nonce,
      vaultScopeId: TEAM_SCOPE_ID,
      checkedAt: Date.now(),
    };
  });
  const initiatingSender = sender();
  initiatingSender.documentId = 'document-live-authorization-1';
  await harness.context.enforceAuthorization(
    { source: 'business-defense-web-tool' },
    initiatingSender,
    TEAM_SCOPE_ID,
  );
  assert.deepEqual(messageOptions, { documentId: 'document-live-authorization-1' });
});

test('both vault start handlers enforce live authorization before reading credentials', () => {
  const projectStart = backgroundSource.indexOf("if (!message || message.type !== 'PROJECT_TASK_START') return;");
  const projectEnd = backgroundSource.indexOf("if (!message || ![\n    'BUSINESS_DEFENSE_AUTO_COLLECT'", projectStart);
  const projectHandler = backgroundSource.slice(projectStart, projectEnd);
  assert.match(projectHandler, /await enforceFreshVaultTaskAuthorization\(/);
  assert.ok(
    projectHandler.indexOf('await enforceFreshVaultTaskAuthorization(') <
      projectHandler.indexOf('await preflightProjectTaskCredentials('),
    'project authorization must happen before credential preflight',
  );

  const batchStart = backgroundSource.indexOf("if (message.type === 'ACCOUNT_BATCH_START_FROM_SESSION') {");
  const batchHandler = backgroundSource.slice(batchStart, batchStart + 1400);
  assert.match(batchHandler, /await enforceFreshVaultTaskAuthorization\(/);
  assert.ok(
    batchHandler.indexOf('await enforceFreshVaultTaskAuthorization(') <
      batchHandler.indexOf('readValidatedAccountSession('),
    'batch authorization must happen before plaintext session reads',
  );

  const sessionSet = backgroundSource.indexOf("if (message.type === 'ACCOUNT_SESSION_SET') {");
  const sessionSetHandler = backgroundSource.slice(sessionSet, sessionSet + 600);
  assert.match(sessionSetHandler, /await enforceFreshVaultTaskAuthorization\(/);
  assert.ok(
    sessionSetHandler.indexOf('await enforceFreshVaultTaskAuthorization(') <
      sessionSetHandler.indexOf('setAccountManagementSession('),
    'a stale accounts page must be reauthorized before it can restore plaintext',
  );

  const dingTalkTest = backgroundSource.indexOf("if (message.type === 'ACCOUNT_BATCH_TEST_DINGTALK') {");
  const dingTalkHandler = backgroundSource.slice(dingTalkTest, dingTalkTest + 650);
  assert.ok(dingTalkTest >= 0);
  assert.match(dingTalkHandler, /await enforceFreshVaultTaskAuthorization\(/);
  assert.ok(
    dingTalkHandler.indexOf('await enforceFreshVaultTaskAuthorization(') <
      dingTalkHandler.indexOf('sendDingTalkNotification('),
    'DingTalk secret testing must be reauthorized before consuming the secret',
  );
});
