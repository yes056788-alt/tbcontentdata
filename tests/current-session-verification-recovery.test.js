const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const accountLogin = require('../xhs/account-login');

function sourceBlock(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, 'missing source marker: ' + startMarker);
  assert.ok(end > start, 'missing source marker: ' + endMarker);
  return background.slice(start, end);
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cancellationError(reason) {
  if (reason && reason.code === 'PROJECT_TASK_CANCELLED') return reason;
  const error = new Error(reason && reason.message || String(reason || '任务已取消。'));
  error.name = 'AbortError';
  error.code = 'PROJECT_TASK_CANCELLED';
  return error;
}

function createHarness(tabs, options = {}) {
  const createHarnessOptions = options;
  const browserTabs = new Map((Array.isArray(tabs) ? tabs : []).map((tab) => [
    Number(tab.id),
    copy(tab),
  ]));
  const activations = [];
  const navigations = [];
  const stateReads = [];
  const createdTabs = [];
  const verificationWaits = [];
  const waitStarted = deferred();
  let delayCount = 0;
  let nextCreatedTabId = 100;

  const nextState = (platform) => {
    const queues = options.states && typeof options.states === 'object' ? options.states : {};
    const queue = Array.isArray(queues[platform]) ? queues[platform] : null;
    return copy(queue && queue.length ? queue.shift() : { kind: 'verification', frameId: 0 });
  };

  const waitForCancellation = async (signal) => {
    waitStarted.resolve();
    if (signal && signal.aborted) throw cancellationError(signal.reason);
    await new Promise((_resolve, reject) => {
      if (!signal) return;
      signal.addEventListener('abort', () => reject(cancellationError(signal.reason)), {
        once: true,
      });
    });
  };

  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    XHS_PLATFORM_ENTRY_URLS: accountLogin.XHS_PLATFORM_ENTRY_URLS,
    XhsAccountLogin: accountLogin,
    chrome: {
      tabs: {
        async get(tabId) {
          const tab = browserTabs.get(Number(tabId));
          if (!tab) throw new Error('标签页已关闭。');
          return copy(tab);
        },
        async query() {
          return Array.from(browserTabs.values(), copy);
        },
        async create(details) {
          createdTabs.push(copy(details));
          if (options.allowCreateTabs === true) {
            const tab = Object.assign({
              id: nextCreatedTabId,
              status: 'complete',
              url: String(details && details.url || ''),
            }, copy(options.createdTabState) || {}, {
              id: nextCreatedTabId,
            });
            nextCreatedTabId += 1;
            browserTabs.set(tab.id, tab);
            return copy(tab);
          }
          throw new Error('测试不提供可新建的安全产品页。');
        },
        async update(tabId, update) {
          const id = Number(tabId);
          const next = Object.assign({}, browserTabs.get(id) || { id }, copy(update));
          browserTabs.set(id, next);
          if (update && update.active === true) activations.push({ tabId: id, update: copy(update) });
          if (update && update.url) navigations.push({ tabId: id, update: copy(update) });
          return copy(next);
        },
      },
    },
    batchError(code, message, fields) {
      const error = Object.assign(new Error(message), fields || {});
      error.code = code;
      return error;
    },
    normalizeProjectPlatformTaskIds(value) {
      const allowed = ['adstar', 'pgy', 'juguang'];
      return Array.from(new Set(Array.isArray(value) ? value : []))
        .filter((platform) => allowed.includes(platform));
    },
    projectTaskCancellationError: cancellationError,
    throwIfProjectTaskCancelled(signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
    async waitMilliseconds() {
      delayCount += 1;
      if (typeof options.onDelay === 'function') {
        await options.onDelay({ browserTabs, delayCount });
      }
    },
    async waitMillisecondsWithSignal(_duration, signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
      delayCount += 1;
      if (typeof options.onDelay === 'function') {
        await options.onDelay({ browserTabs, delayCount });
      }
      if (signal && signal.aborted) throw cancellationError(signal.reason);
    },
    async waitTabComplete(tabId) {
      if (typeof options.onWaitTabComplete === 'function') {
        await options.onWaitTabComplete({ browserTabs, tabId: Number(tabId) });
      }
    },
    async openOrReuseTab() {
      throw new Error('测试不提供可新建的安全产品页。');
    },
    async prepareXingheTab() {
      throw new Error('测试不提供星河产品页。');
    },
    async queryUniqueXhsLoginTarget(platform) {
      const matches = Array.from(browserTabs.values()).filter((tab) => (
        accountLogin.isPlatformOriginUrl(platform, tab && tab.url)
      ));
      return matches.length === 1 ? copy(matches[0]) : null;
    },
    async readXingheState(tabId, signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
      stateReads.push({ tabId: Number(tabId), platform: 'adstar' });
      return nextState('adstar');
    },
    async waitForXingheState(tabId, _predicate, _timeoutMs, signal) {
      return context.readXingheState(tabId, signal);
    },
    async readXhsLoginState(tabId, platform, signal) {
      if (signal && signal.aborted) throw cancellationError(signal.reason);
      stateReads.push({ tabId: Number(tabId), platform });
      return nextState(platform);
    },
    async waitForXhsLoginState(tabId, platform, _predicate, _timeoutMs, signal) {
      return context.readXhsLoginState(tabId, platform, signal);
    },
    checkXingheBlockingState(state, tabId) {
      if (state && state.kind === 'verification') {
        throw context.batchError('VERIFICATION_REQUIRED', '星河需要人工验证。', { tabId });
      }
    },
    checkXhsLoginBlockingState(state, tabId) {
      if (state && state.kind === 'verification') {
        throw context.batchError('VERIFICATION_REQUIRED', '小红书需要人工验证。', { tabId });
      }
    },
    async waitForProjectVerification(error, options) {
      verificationWaits.push({ error, options });
      await context.chrome.tabs.update(error.tabId, { active: true });
      if (Object.prototype.hasOwnProperty.call(createHarnessOptions, 'verificationResult')) {
        return copy(createHarnessOptions.verificationResult);
      }
      await waitForCancellation(options && options.signal);
    },
  });

  const recoverySource = sourceBlock(
    'function projectVerificationPlatformName',
    '\nasync function prepareProjectPlatformSessions',
  );
  assert.match(
    recoverySource,
    /async function prepareCurrentSessionProjectPlatforms\s*\(/,
    'currentSession must expose a dedicated verification-aware platform preflight helper',
  );
  const waitStub = context.waitForProjectVerification;
  vm.runInContext(
    recoverySource +
      '\nglobalThis.prepareCurrentSessionProjectPlatformsUnderTest = prepareCurrentSessionProjectPlatforms;',
    context,
    { filename: 'current-session-verification-recovery.js' },
  );
  context.waitForProjectVerification = waitStub;

  return {
    activations,
    context,
    createdTabs,
    navigations,
    stateReads,
    verificationWaits,
    waitStarted,
  };
}

test('currentSession waits on an explicitly task-owned challenge tab and cancellation aborts the wait', async () => {
  const harness = createHarness([{
    id: 41,
    status: 'complete',
    url: 'https://customer.xiaohongshu.com/login',
  }]);
  const controller = new AbortController();
  const statusWrites = [];

  const running = harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
    ['pgy'],
    {
      signal: controller.signal,
      taskOwnedTabIds: { pgy: 41 },
      async onVerificationWaiting(details) {
        const waiting = Array.isArray(details && details.waitingPlatforms)
          ? Array.from(details.waitingPlatforms)
          : [];
        statusWrites.push({
          running: true,
          paused: true,
          waitingForVerification: true,
          verificationPlatforms: waiting,
          status: 'waiting_verification',
          pauseReason: String(details && details.message || ''),
        });
      },
      async onVerificationResolved() {
        throw new Error('取消前不应把验证标记为已完成。');
      },
    },
  );

  await harness.waitStarted.promise;
  assert.deepEqual(statusWrites, [{
    running: true,
    paused: true,
    waitingForVerification: true,
    verificationPlatforms: ['pgy'],
    status: 'waiting_verification',
    pauseReason: '蒲公英登录需要人工验证，请在已打开的页面完成，任务会自动继续。',
  }]);
  assert.deepEqual(harness.stateReads, [{ tabId: 41, platform: 'pgy' }]);
  assert.equal(harness.verificationWaits.length, 1);
  assert.equal(harness.verificationWaits[0].error.tabId, 41);
  assert.equal(harness.verificationWaits[0].options.platform, 'pgy');
  assert.equal(harness.verificationWaits[0].options.signal, controller.signal);
  assert.deepEqual(harness.activations, [{ tabId: 41, update: { active: true } }]);

  controller.abort(cancellationError('用户取消任务。'));
  await assert.rejects(running, (error) => error && error.code === 'PROJECT_TASK_CANCELLED');
});

test('a shared Xiaohongshu login-origin tab is never guessed as PGY without platform provenance', async () => {
  const harness = createHarness([{
    id: 77,
    status: 'complete',
    url: 'https://passport.xiaohongshu.com/login',
  }]);

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(['pgy'], {
    signal: new AbortController().signal,
    taskOwnedTabIds: {},
    async onVerificationWaiting() {
      throw new Error('无归属证据的共享登录页不得进入等待状态。');
    },
  });
  assert.equal(result.platforms.pgy.state, 'failed');

  assert.deepEqual(
    harness.stateReads.filter((read) => read.tabId === 77),
    [],
    '共享 customer/passport 登录域本身不能证明属于蒲公英还是聚光。',
  );
  assert.deepEqual(
    harness.activations.filter((entry) => entry.tabId === 77),
    [],
    '不得激活无平台归属证据的共享登录页。',
  );
  assert.deepEqual(
    harness.navigations.filter((entry) => entry.tabId === 77),
    [],
    '不得将可能属于其他任务的共享登录页改导到蒲公英。',
  );
});

test('task-owned tab trust is revalidated after a loading tab finishes redirecting', async () => {
  const harness = createHarness([{
    id: 52,
    status: 'loading',
    url: 'https://pgy.xiaohongshu.com/solar/pre-trade/blogger-note',
  }], {
    states: { pgy: [{ kind: 'productReady', frameId: 0 }] },
    async onWaitTabComplete({ browserTabs, tabId }) {
      browserTabs.set(tabId, {
        id: tabId,
        status: 'complete',
        url: 'https://attacker.example.test/fake-pgy',
      });
    },
  });

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(['pgy'], {
    signal: new AbortController().signal,
    taskOwnedTabIds: { pgy: 52 },
  });
  assert.equal(result.platforms.pgy.state, 'failed');
  assert.match(result.platforms.pgy.message, /任务标签页已离开官方平台/);
  assert.equal(result.platforms.pgy.tabId, 52);
  assert.deepEqual(harness.stateReads, [], '重定向后的非官方页面不得进入登录状态读取。');
});

test('fresh PGY task tab accepts its official pending URL before the first navigation commits', async () => {
  const entryUrl = accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy;
  const harness = createHarness([], {
    allowCreateTabs: true,
    createdTabState: {
      status: 'loading',
      url: '',
      pendingUrl: entryUrl,
    },
    states: {
      pgy: [
        { kind: 'productReady', frameId: 0 },
        { kind: 'productReady', frameId: 0 },
      ],
    },
    async onWaitTabComplete({ browserTabs, tabId }) {
      browserTabs.set(tabId, {
        id: tabId,
        status: 'complete',
        url: entryUrl,
      });
    },
  });

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
    ['pgy'],
    {
      signal: new AbortController().signal,
      taskOwnedTabIds: {},
    },
  );

  assert.equal(
    result.platforms.pgy.ok,
    true,
    result.platforms.pgy.message || '官方蒲公英 pendingUrl 不应被判定为离开官方平台。',
  );
  assert.equal(result.platforms.pgy.tabId, 100);
  assert.deepEqual(harness.createdTabs, [{ url: entryUrl, active: false }]);
  assert.deepEqual(harness.stateReads, [
    { tabId: 100, platform: 'pgy' },
    { tabId: 100, platform: 'pgy' },
  ]);
});

test('fresh PGY task tab rejects an external pending navigation before reading login state', async () => {
  const harness = createHarness([], {
    allowCreateTabs: true,
    createdTabState: {
      status: 'loading',
      url: '',
      pendingUrl: 'https://attacker.example.test/fake-pgy',
    },
    async onWaitTabComplete({ browserTabs, tabId }) {
      browserTabs.set(tabId, {
        id: tabId,
        status: 'complete',
        url: 'https://attacker.example.test/fake-pgy',
      });
    },
  });

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
    ['pgy'],
    {
      signal: new AbortController().signal,
      taskOwnedTabIds: {},
    },
  );

  assert.equal(result.platforms.pgy.state, 'failed');
  assert.match(result.platforms.pgy.message, /任务标签页已离开官方平台/);
  assert.equal(result.platforms.pgy.tabId, 100);
  assert.deepEqual(harness.stateReads, [], '外站 pendingUrl 不得进入登录状态读取。');
});

test('verification resolution waits for the same task-owned tab to return to every product origin', async () => {
  const cases = [
    {
      platform: 'adstar',
      loginUrl: 'https://login.taobao.com/member/login.jhtml',
      productUrl: 'https://adstar.alimama.com/index.htm',
      terminalKind: 'loggedIn',
    },
    {
      platform: 'pgy',
      loginUrl: 'https://customer.xiaohongshu.com/login',
      productUrl: 'https://pgy.xiaohongshu.com/solar/pre-trade/blogger-note?source=test',
      terminalKind: 'productReady',
    },
    {
      platform: 'juguang',
      loginUrl: 'https://passport.xiaohongshu.com/login',
      productUrl: 'https://ad.xiaohongshu.com/aurora/ad/manage/campaign',
      terminalKind: 'productReady',
    },
  ];

  for (const [index, item] of cases.entries()) {
    const tabId = 60 + index;
    const states = {
      [item.platform]: [
        { kind: 'verification', frameId: 0 },
        { kind: item.terminalKind, frameId: 0 },
      ],
    };
    let redirected = false;
    const harness = createHarness([{
      id: tabId,
      status: 'complete',
      url: item.loginUrl,
    }], {
      states,
      verificationResult: { kind: 'loggedIn', frameId: 0 },
      async onDelay({ browserTabs }) {
        if (redirected) return;
        redirected = true;
        browserTabs.set(tabId, {
          id: tabId,
          status: 'complete',
          url: item.productUrl,
        });
      },
    });

    const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
      [item.platform],
      {
        signal: new AbortController().signal,
        taskOwnedTabIds: { [item.platform]: tabId },
      },
    );

    assert.equal(redirected, true, item.platform + ' must wait for its product origin');
    assert.equal(result.platforms[item.platform].state, item.terminalKind);
    assert.deepEqual(harness.stateReads, [
      { tabId, platform: item.platform },
      { tabId, platform: item.platform },
    ], item.platform + ' must re-read state after returning to the product origin');
  }
});

test('currentSession preflight creates PGY and Juguang at their exact official product entries', async () => {
  const harness = createHarness([
    {
      id: 91,
      status: 'complete',
      url: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy,
    },
    {
      id: 92,
      status: 'complete',
      url: accountLogin.XHS_PLATFORM_ENTRY_URLS.juguang,
    },
  ], {
    allowCreateTabs: true,
    states: {
      pgy: [
        { kind: 'productReady', frameId: 0 },
        { kind: 'productReady', frameId: 0 },
      ],
      juguang: [
        { kind: 'productReady', frameId: 0 },
        { kind: 'productReady', frameId: 0 },
      ],
    },
  });

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
    ['pgy', 'juguang'],
    {
      signal: new AbortController().signal,
      taskOwnedTabIds: {},
    },
  );

  assert.deepEqual(harness.createdTabs, [
    { url: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy, active: false },
    { url: accountLogin.XHS_PLATFORM_ENTRY_URLS.juguang, active: false },
  ]);
  assert.equal(result.platforms.pgy.tabId, 100);
  assert.equal(result.platforms.juguang.tabId, 101);
  assert.deepEqual(
    harness.stateReads.map((entry) => entry.tabId),
    [100, 100, 101, 101],
    '每次预检必须只读取本次新建页，不得复用已有产品页。',
  );
  assert.doesNotMatch(
    JSON.stringify({ created: harness.createdTabs, navigated: harness.navigations }),
    /www\.xiaohongshu\.com|\/explore(?:[/?"']|$)/i,
  );
});

test('currentSession activates its fresh PGY tab and continues automatically after manual login', async () => {
  const loginWaits = [];
  const loginResolutions = [];
  const harness = createHarness([], {
    allowCreateTabs: true,
    states: {
      pgy: [
        { kind: 'login', frameId: 0 },
        { kind: 'productReady', frameId: 0 },
        { kind: 'productReady', frameId: 0 },
      ],
    },
  });

  const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
    ['pgy'],
    {
      signal: new AbortController().signal,
      taskOwnedTabIds: {},
      async onLoginWaiting(details) {
        loginWaits.push(copy(details));
      },
      async onLoginResolved(details) {
        loginResolutions.push(copy(details));
      },
    },
  );

  assert.equal(result.platforms.pgy.ok, true);
  assert.equal(result.platforms.pgy.tabId, 100);
  assert.deepEqual(harness.createdTabs, [{
    url: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy,
    active: false,
  }]);
  assert.deepEqual(harness.activations, [{ tabId: 100, update: { active: true } }]);
  assert.equal(loginWaits.length, 1);
  assert.equal(loginWaits[0].platform, 'pgy');
  assert.match(loginWaits[0].message, /登录.*继续/);
  assert.deepEqual(loginResolutions, [{ platform: 'pgy', waitingPlatforms: [] }]);
});

test('an ordinary currentSession preflight failure is isolated to its XHS platform', async () => {
  const platforms = ['adstar', 'pgy', 'juguang'];
  const tabs = [
    { id: 81, status: 'complete', url: 'https://adstar.alimama.com/index.htm' },
    { id: 82, status: 'complete', url: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy },
    { id: 83, status: 'complete', url: accountLogin.XHS_PLATFORM_ENTRY_URLS.juguang },
  ];
  const tabIds = { adstar: 81, pgy: 82, juguang: 83 };

  for (const failingPlatform of platforms) {
    const states = {
      adstar: failingPlatform === 'adstar'
        ? [{ kind: 'unsupported', frameId: 0 }]
        : [{ kind: 'loggedIn', frameId: 0 }, { kind: 'loggedIn', frameId: 0 }],
      pgy: failingPlatform === 'pgy'
        ? [{ kind: 'unsupported', frameId: 0 }]
        : [{ kind: 'productReady', frameId: 0 }, { kind: 'productReady', frameId: 0 }],
      juguang: failingPlatform === 'juguang'
        ? [{ kind: 'unsupported', frameId: 0 }]
        : [{ kind: 'productReady', frameId: 0 }, { kind: 'productReady', frameId: 0 }],
    };
    const harness = createHarness(tabs, { states });

    const result = await harness.context.prepareCurrentSessionProjectPlatformsUnderTest(
      platforms,
      {
        signal: new AbortController().signal,
        taskOwnedTabIds: tabIds,
      },
    );

    assert.equal(result.platforms[failingPlatform].ok, false);
    assert.equal(result.platforms[failingPlatform].state, 'failed');
    assert.equal(result.platforms[failingPlatform].tabId, tabIds[failingPlatform]);
    assert.match(result.platforms[failingPlatform].message, /当前未登录/);
    for (const sibling of platforms.filter((platform) => platform !== failingPlatform)) {
      assert.equal(result.platforms[sibling].ok, true,
        `${failingPlatform} failure must not poison ${sibling}`);
      assert.notEqual(result.platforms[sibling].state, 'failed');
    }
    assert.deepEqual(
      Array.from(new Set(harness.stateReads.map((entry) => entry.platform))).sort(),
      platforms.slice().sort(),
      `${failingPlatform} failure must not prevent either sibling preflight`,
    );
  }
});

test('runProjectTask performs currentSession verification preflight before collection', () => {
  const runSource = sourceBlock(
    'async function runProjectTask',
    '\nfunction ensureBusinessDefenseAutoCollectTask',
  );
  const preflightIndex = runSource.indexOf('prepareCurrentSessionProjectPlatforms');
  const reportIndex = runSource.indexOf('ensureContentDiagnosisReportTask');
  assert.ok(preflightIndex >= 0, 'currentSession must call its verification-aware platform preflight');
  assert.ok(reportIndex > preflightIndex,
    'currentSession verification preflight must complete before report collection starts');
  assert.match(
    runSource.slice(preflightIndex, reportIndex),
    /onVerificationWaiting/,
    'the currentSession preflight must feed the existing project waiting-status contract',
  );
});
