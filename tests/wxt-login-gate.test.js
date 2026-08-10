const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const helperStart = background.indexOf('function wxtReportRouteDescriptor');
const helperEnd = background.indexOf('\nasync function inspectGuangheAccess', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helperSource = background.slice(helperStart, helperEnd);

assert.match(background, /await ensureWxtBackendReady\(tabId, BUSINESS_DEFENSE_WXT_URL, 75000\)/);
assert.match(background, /await ensureWxtBackendReady\(tabId, targetUrl, 75000\)/);
assert.match(background, /await ensureWxtBackendReady\(tabId, businessDefenseWxtShortVideoUrl/);
assert.match(background, /error && error\.retryable === false/);
assert.match(background, /\^WXT_LOGIN_GATE_/);

function element(label, options) {
  const source = options || {};
  return {
    innerText: label,
    textContent: label,
    value: source.value || '',
    disabled: source.disabled === true,
    clicks: 0,
    getAttribute(name) {
      if (name === 'aria-disabled') return source.ariaDisabled ? 'true' : null;
      return null;
    },
    getBoundingClientRect() {
      return source.hidden ? { width: 0, height: 0 } : { width: 240, height: 48 };
    },
    click() { this.clicks += 1; },
  };
}

function createContext() {
  let clock = 0;
  const runtime = {
    frameBatches: [],
    clickCalls: 0,
    updates: [],
    updateTimes: [],
    onUpdate: null,
    elements: [],
    bodyText: '欢迎登录',
  };
  runtime.now = () => clock;
  const context = vm.createContext({
    runtime,
    URL,
    URLSearchParams,
    Error,
    Number,
    String,
    Array,
    Set,
    Object,
    Math,
    Promise,
    Date: { now: () => clock },
    location: {
      href: 'https://one.alimama.com/indexbp.html#!/login/index',
      hash: '#!/login/index',
    },
    document: {
      body: {
        get innerText() { return runtime.bodyText; },
        get textContent() { return runtime.bodyText; },
      },
      querySelectorAll() { return runtime.elements; },
    },
    getComputedStyle() {
      return { display: 'block', visibility: 'visible', opacity: '1' };
    },
    chrome: {
      tabs: {
        async get() { return { id: 7, status: 'complete', url: '' }; },
        async update(tabId, update) {
          runtime.updates.push(update.url);
          runtime.updateTimes.push(clock);
          if (typeof runtime.onUpdate === 'function') runtime.onUpdate(update.url);
          return { id: tabId, status: 'complete', url: update.url };
        },
      },
      scripting: {
        async executeScript(details) {
          if (details.target && Array.isArray(details.target.frameIds)) {
            runtime.clickCalls += 1;
            return [{ frameId: details.target.frameIds[0], result: { clicked: true } }];
          }
          const next = runtime.frameBatches.length
            ? runtime.frameBatches.shift()
            : [{ frameId: 0, result: {
              href: 'https://one.alimama.com/indexbp.html#!/login/index',
              loginRoute: true,
              welcomeLogin: true,
              gateVisible: true,
              entryFound: false,
              candidateCount: 0,
            } }];
          return next;
        },
      },
    },
    async waitMilliseconds(duration) { clock += Number(duration) || 0; },
    async waitTabComplete() {},
  });
  vm.runInContext(helperSource + `
    globalThis.inspectFrame = inspectWxtBackendFrame;
    globalThis.ensureReady = ensureWxtBackendReady;
    globalThis.targetReached = wxtTargetRouteReached;
  `, context, { filename: 'wxt-login-gate-helpers.js' });
  return { context, runtime };
}

function verifyDomSelection() {
  const { context, runtime } = createContext();
  const entry = element(' 进入 后台 ');
  runtime.elements = [
    entry,
    element('进入后台说明'),
    element('进入后台', { hidden: true }),
    element('进入后台', { disabled: true }),
    element('进入后台', { ariaDisabled: true }),
    element('进入万相台无界版'),
    element('退出账户'),
  ];
  let state = context.inspectFrame(true);
  assert.equal(state.entryFound, true);
  assert.equal(state.candidateCount, 1);
  assert.equal(state.clicked, true);
  assert.equal(entry.clicks, 1);

  const first = element('进入后台');
  const second = element('进入后台');
  runtime.elements = [first, second];
  state = context.inspectFrame(true);
  assert.equal(state.entryFound, false);
  assert.equal(state.candidateCount, 2);
  assert.equal(state.clicked, false);
  assert.equal(first.clicks + second.clicks, 0);

  context.location.hash = '#!/report/account?rptType=account';
  runtime.bodyText = '万相台报表';
  runtime.elements = [element('进入后台')];
  state = context.inspectFrame(true);
  assert.equal(state.gateVisible, false);
  assert.equal(state.clicked, false);
}

async function verifyGateClickAndRedirect() {
  const { context, runtime } = createContext();
  const target = 'https://one.alimama.com/indexbp.html#!/report/account?rptType=account';
  const gate = { frameId: 4, result: {
    href: 'https://one.alimama.com/login-frame',
    loginRoute: true,
    welcomeLogin: true,
    gateVisible: true,
    entryFound: true,
    candidateCount: 1,
  } };
  const ready = { frameId: 0, result: {
    href: target,
    loginRoute: false,
    welcomeLogin: false,
    gateVisible: false,
    entryFound: false,
    candidateCount: 0,
  } };
  runtime.frameBatches = [[gate], [ready], [ready], [ready]];
  const result = await context.ensureReady(7, target, 10000);
  assert.equal(result.ok, true);
  assert.equal(result.clicked, true);
  assert.equal(runtime.clickCalls, 1);
  assert.deepEqual(runtime.updates, []);
}

async function verifyAlreadyReadyAndAmbiguousFailure() {
  const { context, runtime } = createContext();
  const target = 'https://one.alimama.com/indexbp.html#!/report/short_video_migrate?rptType=short_video_migrate&bizCode=onebpShortVideo';
  const ready = { frameId: 0, result: {
    href: target,
    loginRoute: false,
    welcomeLogin: false,
    gateVisible: false,
    entryFound: false,
    candidateCount: 0,
  } };
  runtime.frameBatches = [[ready], [ready], [ready]];
  const result = await context.ensureReady(7, target, 10000);
  assert.equal(result.clicked, false);
  assert.equal(runtime.clickCalls, 0);
  assert.equal(context.targetReached(target, target), true);

  const datedTarget = target + '&startTime=2026-07-09&endTime=2026-08-07';
  const wrongDate = target + '&startTime=2026-06-09&endTime=2026-07-08';
  assert.equal(context.targetReached(wrongDate, datedTarget), false);

  const ambiguousContext = createContext();
  ambiguousContext.runtime.frameBatches = [[{ frameId: 0, result: {
    href: 'https://one.alimama.com/indexbp.html#!/login/index',
    loginRoute: true,
    welcomeLogin: true,
    gateVisible: true,
    entryFound: false,
    candidateCount: 2,
  } }]];
  await assert.rejects(
    ambiguousContext.context.ensureReady(7, target, 10000),
    (error) => error && error.code === 'WXT_LOGIN_GATE_AMBIGUOUS' && error.retryable === false
  );
}

async function verifyCrossFrameGateAndStaleChildSafety() {
  const split = createContext();
  const target = 'https://one.alimama.com/indexbp.html#!/report/account?rptType=account';
  const shell = { frameId: 0, result: {
    href: 'https://one.alimama.com/indexbp.html#!/login/index',
    hostname: 'one.alimama.com',
    gateVisible: true,
    candidateCount: 0,
  } };
  const childEntry = { frameId: 7, result: {
    href: 'https://one.alimama.com/login-entry-frame',
    hostname: 'one.alimama.com',
    gateVisible: false,
    entryFound: true,
    candidateCount: 1,
  } };
  const ready = { frameId: 0, result: {
    href: target,
    hostname: 'one.alimama.com',
    gateVisible: false,
    candidateCount: 0,
  } };
  split.runtime.frameBatches = [[shell, childEntry], [ready], [ready], [ready]];
  const result = await split.context.ensureReady(7, target, 10000);
  assert.equal(result.ok, true);
  assert.equal(split.runtime.clickCalls, 1);

  const stale = createContext();
  const staleChild = { frameId: 9, result: {
    href: 'https://one.alimama.com/old-login-frame',
    hostname: 'one.alimama.com',
    gateVisible: true,
    entryFound: true,
    candidateCount: 1,
  } };
  stale.runtime.frameBatches = [
    [ready, staleChild],
    [ready, staleChild],
    [ready, staleChild],
  ];
  const staleResult = await stale.context.ensureReady(7, target, 10000);
  assert.equal(staleResult.ok, true);
  assert.equal(stale.runtime.clickCalls, 0);

  const untrusted = createContext();
  const untrustedEntry = { frameId: 11, result: {
    href: 'https://example.com/untrusted-frame',
    hostname: 'example.com',
    gateVisible: false,
    entryFound: true,
    candidateCount: 1,
  } };
  untrusted.runtime.frameBatches = [[shell, untrustedEntry]];
  await assert.rejects(
    untrusted.context.ensureReady(7, target, 10000),
    (error) => error && error.code === 'WXT_LOGIN_GATE_TIMEOUT'
  );
  assert.equal(untrusted.runtime.clickCalls, 0);
}

async function verifyStableHashFinalCheckAndNavigationGrace() {
  const target = 'https://one.alimama.com/indexbp.html#!/report/short_video_migrate?' +
    'rptType=short_video_migrate&bizCode=onebpShortVideo&startTime=2026-07-09&endTime=2026-08-07';
  const ready = (suffix) => ({ frameId: 0, result: {
    href: target + (suffix || ''),
    hostname: 'one.alimama.com',
    gateVisible: false,
    candidateCount: 0,
  } });
  const changed = createContext();
  changed.runtime.frameBatches = [
    [ready('&view=one')],
    [ready('&view=two')],
    [ready('&view=two')],
    [ready('&view=two')],
  ];
  const changedResult = await changed.context.ensureReady(7, target, 10000);
  assert.equal(changedResult.ok, true);

  const finalRecheck = createContext();
  const home = { frameId: 0, result: {
    href: 'https://one.alimama.com/indexbp.html#!/home',
    hostname: 'one.alimama.com',
    gateVisible: false,
    candidateCount: 0,
  } };
  finalRecheck.runtime.frameBatches = [
    [ready()], [ready()], [home], [ready()], [ready()], [ready()],
  ];
  const rechecked = await finalRecheck.context.ensureReady(7, target, 10000);
  assert.equal(rechecked.ok, true);

  const intermediate = createContext();
  const gate = { frameId: 0, result: {
    href: 'https://one.alimama.com/indexbp.html#!/login/index',
    hostname: 'one.alimama.com',
    gateVisible: true,
    entryFound: true,
    candidateCount: 1,
  } };
  intermediate.runtime.frameBatches = [[gate]];
  for (let index = 0; index < 24; index += 1) intermediate.runtime.frameBatches.push([home]);
  intermediate.runtime.onUpdate = () => {
    intermediate.runtime.frameBatches = [[ready()], [ready()], [ready()]];
  };
  const navigated = await intermediate.context.ensureReady(7, target, 20000);
  assert.equal(navigated.ok, true);
  assert.deepEqual(intermediate.runtime.updates, [target]);
  assert.ok(intermediate.runtime.updateTimes[0] >= 10000, 'SSO redirect must receive a grace period');

  const slowRedirect = createContext();
  const persistentGate = { frameId: 0, result: {
    href: 'https://one.alimama.com/indexbp.html#!/login/index',
    hostname: 'one.alimama.com',
    gateVisible: true,
    entryFound: true,
    candidateCount: 1,
  } };
  slowRedirect.runtime.frameBatches = [[persistentGate]];
  for (let index = 0; index < 14; index += 1) {
    slowRedirect.runtime.frameBatches.push([persistentGate]);
  }
  slowRedirect.runtime.frameBatches.push([ready()], [ready()], [ready()]);
  const slowResult = await slowRedirect.context.ensureReady(7, target, 20000);
  assert.equal(slowResult.ok, true);
  assert.equal(slowRedirect.runtime.clickCalls, 1);
}

async function verifyGateTimeoutIsBounded() {
  const { context, runtime } = createContext();
  const target = 'https://one.alimama.com/indexbp.html#!/report/account?rptType=account';
  await assert.rejects(
    context.ensureReady(7, target, 10000),
    (error) => error && error.code === 'WXT_LOGIN_GATE_TIMEOUT' && error.retryable === false
  );
  assert.equal(runtime.clickCalls, 0);
  assert.deepEqual(runtime.updates, []);
  assert.ok(runtime.now() <= 10600, 'gate timeout should remain bounded');
}

Promise.all([
  verifyGateClickAndRedirect(),
  verifyAlreadyReadyAndAmbiguousFailure(),
  verifyCrossFrameGateAndStaleChildSafety(),
  verifyStableHashFinalCheckAndNavigationGrace(),
  verifyGateTimeoutIsBounded(),
]).then(() => {
  verifyDomSelection();
  console.log('wxt login gate guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
