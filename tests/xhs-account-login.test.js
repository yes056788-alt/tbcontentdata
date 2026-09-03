const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const accountsPage = fs.readFileSync(path.join(root, 'web-tool', 'accounts.js'), 'utf8');
const accountsHtml = fs.readFileSync(path.join(root, 'web-tool', 'accounts.html'), 'utf8');
const taskPage = fs.readFileSync(path.join(root, 'web-tool', 'task.js'), 'utf8');
const reportHtml = fs.readFileSync(path.join(root, 'web-tool', 'report.html'), 'utf8');

const accountLogin = require('../xhs/account-login');
const loginPage = require('../xiaohongshu-login-content');

function fixtureElement(options = {}) {
  const listeners = [];
  return {
    type: options.type || 'text',
    name: options.name || '',
    id: options.id || '',
    placeholder: options.placeholder || '',
    value: options.value || '',
    textContent: options.text || '',
    innerText: options.text || '',
    disabled: false,
    clicked: false,
    offsetParent: {},
    getAttribute(name) {
      if (name === 'aria-label') return options.ariaLabel || '';
      if (name === 'role') return options.role || '';
      return '';
    },
    getBoundingClientRect() { return { width: 120, height: 32 }; },
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    dispatchEvent(event) {
      listeners.filter((item) => item.type === event.type).forEach((item) => item.listener(event));
      return true;
    },
    click() { this.clicked = true; },
  };
}

function fixtureDocument({ inputs = [], clickables = [], challenges = [], errors = [], bodyText = '' } = {}) {
  return {
    readyState: 'complete',
    body: { innerText: bodyText, textContent: bodyText },
    querySelectorAll(selector) {
      if (selector === 'input') return inputs;
      if (selector.includes('input') && selector.includes('button')) return inputs.concat(clickables);
      if (selector.includes('captcha') || selector.includes('slider')) return challenges;
      if (selector.includes('[role="alert"]') || selector.includes('[class*="error"')) return errors;
      if (selector.includes('button') || selector.includes('[role="button"]') || selector.includes('a')) return clickables;
      return [];
    },
  };
}

function vaultFixture(overrides = {}) {
  return Object.assign({
    schema: 4,
    stores: [{
      id: 'store-1',
      name: '测试旗舰店',
      credentialBindings: {
        taobaoAccountId: 'tb-1',
        xiaohongshuAccountId: 'xhs-1',
      },
    }],
    accounts: [
      {
        id: 'tb-1', storeId: 'store-1', platform: 'taobao', enabled: true,
        label: '淘宝主账号', username: 'private-taobao@example.test', password: 'taobao-secret', roleKeyword: '品牌',
      },
      {
        id: 'xhs-1', storeId: 'store-1', platform: 'xiaohongshu', enabled: true,
        label: '小红书品牌号', username: 'private-xhs@example.test', password: 'xhs-secret',
      },
    ],
  }, overrides);
}

test('vault credential plan maps Xinghe to Taobao and PGY/Juguang to one XHS account', () => {
  const plan = accountLogin.resolveCredentialPlan(vaultFixture(), {
    storeId: 'store-1',
    platforms: ['sycm', 'adstar', 'pgy', 'juguang'],
  });
  assert.equal(plan.accounts.taobao.id, 'tb-1');
  assert.equal(plan.accounts.xiaohongshu.id, 'xhs-1');
  assert.equal(plan.routes.adstar.accountType, 'taobao');
  assert.equal(plan.routes.pgy.accountType, 'xiaohongshu');
  assert.equal(plan.routes.juguang.accountType, 'xiaohongshu');
  assert.equal(plan.routes.pgy.accountId, plan.routes.juguang.accountId);
});

test('PGY and Juguang enter their official products directly without a consumer-site login step', () => {
  assert.equal(
    accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy,
    'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
  );
  assert.equal(
    accountLogin.XHS_PLATFORM_ENTRY_URLS.juguang,
    'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  );
  assert.doesNotMatch(
    JSON.stringify(accountLogin.XHS_PLATFORM_ENTRY_URLS),
    /www\.xiaohongshu\.com|\/explore(?:[/?"']|$)/,
  );
  assert.doesNotMatch(background, /XhsAccountLogin\.xhsLoginUrl|XHS_SHARED_LOGOUT_URL/);
  assert.match(reportHtml, /蒲公英\s*\+\s*聚光用小红书账号分别直登/);
  assert.match(reportHtml, /不先登录普通小红书网页/);
});

test('product pages are safe entry points but never receive vault credentials directly', async () => {
  for (const href of [
    'https://pgy.xiaohongshu.com/solar/post-trade/content-manage',
    'https://ad.xiaohongshu.com/aurora/ad/manage/campaign',
  ]) {
    const url = new URL(href);
    const email = fixtureElement({ name: 'email', placeholder: '邮箱' });
    const password = fixtureElement({ type: 'password', name: 'password', placeholder: '密码' });
    const submit = fixtureElement({ text: '登录' });
    const result = await loginPage.fillPasswordLogin({
      document: fixtureDocument({
        inputs: [email, password],
        clickables: [submit],
        bodyText: '账号登录 邮箱 密码 登录',
      }),
      location: { href, origin: url.origin, pathname: url.pathname },
    }, {
      username: 'direct-login@example.test',
      password: 'direct-login-secret',
    });
    assert.equal(result.code, 'XHS_LOGIN_ORIGIN_UNTRUSTED', href);
    assert.equal(email.value, '');
    assert.equal(password.value, '');
    assert.equal(submit.clicked, false);
  }

  const deniedEmail = fixtureElement({ name: 'email', placeholder: '邮箱' });
  const deniedPassword = fixtureElement({ type: 'password', name: 'password', placeholder: '密码' });
  const denied = await loginPage.fillPasswordLogin({
    document: fixtureDocument({ inputs: [deniedEmail, deniedPassword], bodyText: '账号登录' }),
    location: {
      href: 'https://pgy.xiaohongshu.com.evil.test/login',
      origin: 'https://pgy.xiaohongshu.com.evil.test',
      pathname: '/login',
    },
  }, {
    username: 'must-not-send@example.test',
    password: 'must-not-send-secret',
  });
  assert.equal(denied.code, 'XHS_LOGIN_ORIGIN_UNTRUSTED');
  assert.equal(deniedEmail.value, '');
  assert.equal(deniedPassword.value, '');
});

test('credential routing fails closed for missing, disabled, cross-store, and wrong-platform bindings', () => {
  const missing = vaultFixture();
  missing.stores[0].credentialBindings.xiaohongshuAccountId = '';
  assert.throws(() => accountLogin.resolveCredentialPlan(missing, {
    storeId: 'store-1', platforms: ['pgy'],
  }), /小红书登录账号/);

  const disabled = vaultFixture();
  disabled.accounts[1].enabled = false;
  assert.throws(() => accountLogin.resolveCredentialPlan(disabled, {
    storeId: 'store-1', platforms: ['juguang'],
  }), /停用|不可用/);

  const crossStore = vaultFixture();
  crossStore.accounts[1].storeId = 'store-2';
  assert.throws(() => accountLogin.resolveCredentialPlan(crossStore, {
    storeId: 'store-1', platforms: ['pgy'],
  }), /不属于所选店铺/);

  const wrongPlatform = vaultFixture();
  wrongPlatform.accounts[1].platform = 'taobao';
  assert.throws(() => accountLogin.resolveCredentialPlan(wrongPlatform, {
    storeId: 'store-1', platforms: ['pgy'],
  }), /平台类型/);

  assert.throws(() => accountLogin.resolveCredentialPlan(vaultFixture(), {
    storeId: 'store-1', platforms: ['unknown-platform'],
  }), /不支持的平台/);
});

test('safe account metadata never contains the login username or password', () => {
  const source = vaultFixture().accounts[0];
  const safe = accountLogin.safeAccountMetadata(source, { storeName: '测试旗舰店' });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /private-taobao|taobao-secret/);
  assert.equal(safe.label, '淘宝主账号');

  const legacy = accountLogin.safeAccountMetadata(Object.assign({}, source, {
    label: '',
    name: source.username,
  }), { storeName: '测试旗舰店' });
  assert.doesNotMatch(JSON.stringify(legacy), /private-taobao/);
  assert.match(legacy.label, /淘宝账号/);

  assert.equal(accountLogin.safeAccountLabel({
    platform: 'xiaohongshu',
    label: '小红书运营号',
    username: '',
    password: 'empty-username-secret',
  }), '小红书运营号');

  const passwordAsLabel = accountLogin.safeAccountMetadata({
    id: 'xhs-empty-user',
    platform: 'xiaohongshu',
    storeId: 'store-1',
    label: 'empty-username-secret',
    username: '',
    password: 'empty-username-secret',
  }, { id: 'store-1', name: '测试旗舰店' });
  assert.doesNotMatch(JSON.stringify(passwordAsLabel), /empty-username-secret/);
  assert.equal(passwordAsLabel.label, '小红书账号');

  const credentialInMetadata = accountLogin.safeAccountMetadata({
    id: 'account-private-login-sentinel',
    platform: 'taobao',
    storeId: 'store-private-login-sentinel',
    label: '安全展示名',
    username: 'private-login-sentinel',
    password: 'private-password-sentinel',
    roleKeyword: '品牌-private-password-sentinel',
    accountGroupId: 'group-private-login-sentinel',
    accountGroupName: '分组 private-login-sentinel',
    storeGroupId: 'store-group-private-password-sentinel',
    storeGroupName: '店铺组 private-password-sentinel',
  }, {
    id: 'store-private-login-sentinel',
    name: '店铺 private-login-sentinel',
    groupId: 'store-group-private-password-sentinel',
    groupName: '店铺组 private-password-sentinel',
  });
  const metadataJson = JSON.stringify(credentialInMetadata);
  assert.doesNotMatch(metadataJson, /private-login-sentinel|private-password-sentinel/);
  assert.equal(credentialInMetadata.storeName, '未命名店铺');
  assert.equal(credentialInMetadata.accountGroupName, '未分组');
  assert.equal(credentialInMetadata.storeGroupName, '未分组');
  assert.equal(credentialInMetadata.roleKeyword, '品牌');
});

test('XHS login page adapter detects current official email/password form and submits without logging secrets', async () => {
  const email = fixtureElement({ name: 'email', placeholder: '邮箱' });
  const password = fixtureElement({ type: 'password', name: 'password', placeholder: '密码' });
  const submit = fixtureElement({ text: '登录' });
  const document = fixtureDocument({ inputs: [email, password], clickables: [submit], bodyText: '账号登录 邮箱 密码 登录' });
  const state = loginPage.detectPageState({
    document,
    location: { href: 'https://customer.xiaohongshu.com/login', origin: 'https://customer.xiaohongshu.com', pathname: '/login' },
  });
  assert.equal(state.kind, 'login');
  const result = await loginPage.fillPasswordLogin({
    document,
    location: { href: 'https://customer.xiaohongshu.com/login', origin: 'https://customer.xiaohongshu.com', pathname: '/login' },
  }, {
    username: 'private-xhs@example.test',
    password: 'xhs-secret',
  });
  assert.equal(result.ok, true);
  assert.equal(email.value, 'private-xhs@example.test');
  assert.equal(password.value, 'xhs-secret');
  assert.equal(submit.clicked, true);
  assert.doesNotMatch(JSON.stringify(result), /private-xhs|xhs-secret/);
});

test('XHS login page adapter pauses on verification and recognizes exact product origins', () => {
  const challenge = fixtureElement({ text: '请完成安全验证' });
  const challengeDocument = fixtureDocument({ challenges: [challenge], bodyText: '请完成安全验证' });
  assert.equal(loginPage.detectPageState({
    document: challengeDocument,
    location: { href: 'https://customer.xiaohongshu.com/login', origin: 'https://customer.xiaohongshu.com', pathname: '/login' },
  }).kind, 'verification');

  for (const [href, bodyText] of [
    ['https://pgy.xiaohongshu.com/microapp/creativity/inspire', '小红书蒲公英 内容合作 创意中心 数据中心 当前账号 退出登录'],
    ['https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note', '小红书聚光 广告投放 账户管理 数据中心 当前账号 退出登录'],
  ]) {
    const url = new URL(href);
    assert.equal(loginPage.detectPageState({
      document: fixtureDocument({
        clickables: [fixtureElement({ text: '登录' })],
        bodyText,
      }),
      location: { href, origin: url.origin, pathname: url.pathname },
    }).kind, 'loggedIn', '真实账号或退出登录证据必须优先于同时存在的通用登录入口。');
    assert.notEqual(loginPage.detectPageState({
      document: fixtureDocument({ bodyText: '' }),
      location: { href, origin: url.origin, pathname: url.pathname },
    }).kind, 'loggedIn', '精确产品 URL 的空白或骨架页不能被当成已登录');
  }

  const productLoginOverlay = fixtureDocument({
    inputs: [
      fixtureElement({ name: 'email', placeholder: '邮箱' }),
      fixtureElement({ type: 'password', name: 'password', placeholder: '密码' }),
    ],
    bodyText: '账号登录 邮箱 密码 登录',
  });
  assert.equal(loginPage.detectPageState({
    document: productLoginOverlay,
    location: {
      href: 'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
      origin: 'https://pgy.xiaohongshu.com',
      pathname: '/microapp/creativity/inspire',
    },
  }).kind, 'login', '产品 URL 可识别登录遮罩，但明文写入仍由独立 origin 门禁拒绝');
});

test('official login origins require strong account-password-submit evidence before credential fill', async () => {
  const genericText = fixtureElement({ name: 'description', placeholder: '备注' });
  const genericPassword = fixtureElement({ type: 'password', name: 'confirm', placeholder: '确认密码' });
  const unrelatedSubmit = fixtureElement({ text: '保存' });
  const document = fixtureDocument({
    inputs: [genericText, genericPassword],
    clickables: [unrelatedSubmit],
    bodyText: '安全设置 修改密码 保存',
  });
  assert.notEqual(loginPage.detectPageState({
    document,
    location: {
      href: 'https://customer.xiaohongshu.com/security/password',
      origin: 'https://customer.xiaohongshu.com',
      pathname: '/security/password',
    },
  }).kind, 'login');
  const result = await loginPage.fillPasswordLogin({
    document,
    location: {
      href: 'https://customer.xiaohongshu.com/security/password',
      origin: 'https://customer.xiaohongshu.com',
      pathname: '/security/password',
    },
  }, {
    username: 'must-not-fill@example.test',
    password: 'must-not-fill-secret',
  });
  assert.equal(result.code, 'XHS_LOGIN_FORM_UNAVAILABLE');
  assert.equal(genericText.value, '');
  assert.equal(genericPassword.value, '');
  assert.equal(unrelatedSubmit.clicked, false);
});

test('official login origin remains loading while its async login shell has not mounted a form', () => {
  const document = fixtureDocument({ bodyText: '小红书商业平台 正在加载登录组件' });
  assert.equal(document.readyState, 'complete', '文档加载完成不代表异步登录组件已经挂载。');
  const state = loginPage.detectPageState({
    document,
    location: {
      href: 'https://customer.xiaohongshu.com/login',
      origin: 'https://customer.xiaohongshu.com',
      pathname: '/login',
    },
  });
  assert.equal(state.kind, 'loading');
});

test('XHS state reader preserves a legitimate PGY top-frame loading observation', async () => {
  const start = background.indexOf('async function ensureXhsLoginContentScript');
  const end = background.indexOf('\nasync function waitForXhsLoginState', start);
  assert.ok(start >= 0 && end > start, 'background login-state reader source must remain available');

  const href = accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy;
  const context = vm.createContext({
    Array,
    Error,
    Number,
    Object,
    Promise,
    String,
    XhsAccountLogin: accountLogin,
    chrome: {
      webNavigation: {
        async getAllFrames() {
          return [{ frameId: 0, documentId: 'fixture-pgy-loading-document', url: href }];
        },
      },
      tabs: {
        async get() { return { id: 701, status: 'complete', url: href }; },
      },
    },
    async injectScripts() {},
    async sendTabMessageWithRetry() {
      return {
        ok: true,
        href,
        state: { kind: 'loading', message: '小红书平台页面正在加载或等待登录态确认。' },
      };
    },
    batchText(value, limit) {
      return String(value == null ? '' : value).trim().slice(0, Number(limit) || 160);
    },
  });
  vm.runInContext(
    background.slice(start, end) + '\nglobalThis.readXhsLoginStateUnderTest = readXhsLoginState;',
    context,
    { filename: 'xhs-login-state-reader.js' },
  );

  const state = await context.readXhsLoginStateUnderTest(701, 'pgy');

  assert.equal(state.kind, 'loading');
  assert.equal(state.frameId, 0);
  assert.equal(state.documentId, 'fixture-pgy-loading-document');
  assert.equal(state.href, href);
});

test('reinjecting the XHS login reader in one isolated document stays idempotent', async () => {
  const source = fs.readFileSync(path.join(root, 'xiaohongshu-login-content.js'), 'utf8');
  const runtimeListeners = [];
  const activeRuntimeListeners = new Set();
  const document = fixtureDocument({
    bodyText: '内容广场 - 小红书蒲公英 内容合作 创意中心',
  });
  document.title = '内容广场 - 小红书蒲公英';
  const context = vm.createContext({
    URL,
    clearTimeout,
    chrome: {
      runtime: {
        id: 'fixture-extension',
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
            activeRuntimeListeners.add(listener);
          },
          hasListener(listener) { return activeRuntimeListeners.has(listener); },
        },
      },
    },
    document,
    location: {
      href: accountLogin.XHS_PLATFORM_ENTRY_URLS.pgy,
      origin: 'https://pgy.xiaohongshu.com',
      pathname: '/microapp/creativity/inspire',
    },
    setTimeout,
  });

  vm.runInContext(source, context, { filename: 'xiaohongshu-login-content.js:first' });
  vm.runInContext(source, context, { filename: 'xiaohongshu-login-content.js:reinjected' });

  const responses = [];
  for (const listener of runtimeListeners) {
    listener(
      { type: 'XHS_LOGIN_GET_STATE' },
      { id: 'fixture-extension' },
      (response) => responses.push(response),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual({
    listenerCount: runtimeListeners.length,
    responseCount: responses.length,
  }, {
    listenerCount: 1,
    responseCount: 1,
  });
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].state.kind, 'productReady');

  activeRuntimeListeners.clear();
  vm.runInContext(source, context, { filename: 'xiaohongshu-login-content.js:runtime-reloaded' });
  const reloadedResponses = [];
  for (const listener of activeRuntimeListeners) {
    listener(
      { type: 'XHS_LOGIN_GET_STATE' },
      { id: 'fixture-extension' },
      (response) => reloadedResponses.push(response),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(activeRuntimeListeners.size, 1);
  assert.equal(reloadedResponses.length, 1);
  assert.equal(reloadedResponses[0].state.kind, 'productReady');
});

test('live PGY content plaza shell is product-ready but never proof of login', () => {
  const href = 'https://pgy.xiaohongshu.com/microapp/creativity/inspire';
  const document = fixtureDocument({ bodyText: '内容广场 - 小红书蒲公英' });
  document.title = '内容广场 - 小红书蒲公英';

  const state = loginPage.detectPageState({
    document,
    location: {
      href,
      origin: 'https://pgy.xiaohongshu.com',
      pathname: '/microapp/creativity/inspire',
    },
  });

  assert.equal(state.kind, 'productReady');
  assert.notEqual(state.kind, 'loggedIn', '产品壳只允许继续做 API 身份校验，不能单凭标题确认登录。');
});

for (const fixture of [
  {
    name: '蒲公英',
    href: 'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
    bodyText: '蒲公英 创意中心',
  },
  {
    name: '聚光',
    href: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
    bodyText: '聚光 数据中心',
  },
]) {
  test(`${fixture.name} static product shell without session evidence is not logged in`, () => {
    const url = new URL(fixture.href);
    const state = loginPage.detectPageState({
      document: fixtureDocument({ bodyText: fixture.bodyText }),
      location: { href: fixture.href, origin: url.origin, pathname: url.pathname },
    });
    assert.notEqual(
      state.kind,
      'loggedIn',
      `${fixture.name}仅有产品名和静态导航文案，没有账号、退出或业务应用证据，不得确认为已登录。`,
    );
  });
}

for (const fixture of [
  {
    name: '蒲公英',
    href: 'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
    bodyText: '蒲公英 创意中心 账号登录',
    loginLabel: '账号登录',
  },
  {
    name: '聚光',
    href: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
    bodyText: '聚光 数据中心 登录',
    loginLabel: '登录',
  },
]) {
  test(`${fixture.name} product shell with a visible login entry remains an account-login entry`, () => {
    const url = new URL(fixture.href);
    const state = loginPage.detectPageState({
      document: fixtureDocument({
        clickables: [fixtureElement({ text: fixture.loginLabel })],
        bodyText: fixture.bodyText,
      }),
      location: { href: fixture.href, origin: url.origin, pathname: url.pathname },
    });
    assert.equal(
      state.kind,
      'entry',
      `${fixture.name}产品应用壳同时露出登录入口时，应进入账号登录流程，不得先返回 productReady 或确认为已有登录会话。`,
    );
    assert.notEqual(state.kind, 'loggedIn');
  });
}

test('ordinary SMS-code login copy is not treated as an active verification challenge', () => {
  const smsLogin = fixtureElement({ text: '短信验证码登录' });
  const accountLoginButton = fixtureElement({ text: '账号登录' });
  const document = fixtureDocument({
    clickables: [smsLogin, accountLoginButton],
    bodyText: '手机号登录 短信验证码登录 获取短信验证码 账号登录',
  });
  const state = loginPage.detectPageState({
    document,
    location: {
      href: 'https://customer.xiaohongshu.com/login',
      origin: 'https://customer.xiaohongshu.com',
      pathname: '/login',
    },
  });
  assert.equal(state.kind, 'entry');
});

test('known platform tabs may read login state on any exact HTTPS product-origin path', () => {
  const allowed = [
    ['pgy', 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage?tab=notes#ready'],
    ['pgy', 'https://pgy.xiaohongshu.com/microapp/arbitrary/runtime/path'],
    ['juguang', 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note?vSellerId=fixture'],
    ['juguang', 'https://ad.xiaohongshu.com/arbitrary/runtime/path'],
  ];
  for (const [platform, href] of allowed) {
    assert.equal(accountLogin.isAllowedPlatformDocumentUrl(platform, href), true, href);
    assert.equal(accountLogin.isAllowedDocumentUrl(href), true, href);
  }

  for (const platform of ['pgy', 'juguang']) {
    assert.equal(accountLogin.isAllowedPlatformDocumentUrl(
      platform,
      'https://customer.xiaohongshu.com/login?redirect=fixture',
    ), true, '共享 customer 登录 origin 规则应保持不变');
    assert.equal(accountLogin.isAllowedPlatformDocumentUrl(
      platform,
      'https://passport.xiaohongshu.com/login?redirect=fixture',
    ), true, '共享 passport 登录 origin 规则应保持不变');
  }

  assert.equal(accountLogin.isExpectedPlatformUrl(
    'pgy',
    'https://pgy.xiaohongshu.com/solar/post-trade/content-manage',
  ), false, '放宽状态读取不得放宽登录终态门禁');
  assert.equal(accountLogin.isExpectedPlatformUrl(
    'juguang',
    'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  ), true, '聚光登录终态必须与正式采集页一致');
});

test('known platform state reads reject cross-origin, HTTP, userinfo, and lookalike URLs', () => {
  const denied = [
    ['pgy', 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note'],
    ['juguang', 'https://pgy.xiaohongshu.com/solar/post-trade/content-manage'],
    ['pgy', 'http://pgy.xiaohongshu.com/solar/post-trade/content-manage'],
    ['juguang', 'http://ad.xiaohongshu.com/aurora/ad/datareports-basic/note'],
    ['pgy', 'https://reader@pgy.xiaohongshu.com/solar/post-trade/content-manage'],
    ['juguang', 'https://reader:secret@ad.xiaohongshu.com/aurora/ad/datareports-basic/note'],
    ['pgy', 'https://evil.pgy.xiaohongshu.com/solar/post-trade/content-manage'],
    ['juguang', 'https://ad.xiaohongshu.com.evil.test/aurora/ad/datareports-basic/note'],
    ['pgy', 'https://pgy.xiaohongshu.com@evil.test/solar/post-trade/content-manage'],
  ];
  for (const [platform, href] of denied) {
    assert.equal(accountLogin.isAllowedPlatformDocumentUrl(platform, href), false, href);
  }
  assert.equal(accountLogin.isAllowedPlatformDocumentUrl(
    'unknown',
    'https://pgy.xiaohongshu.com/solar/post-trade/content-manage',
  ), false);
  assert.equal(accountLogin.isAllowedDocumentUrl(
    'https://reader@pgy.xiaohongshu.com/solar/post-trade/content-manage',
  ), false);
  assert.equal(accountLogin.isAllowedDocumentUrl(
    'http://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  ), false);
});

test('login adapter fails closed outside exact official origins and exact terminal target routes', async () => {
  assert.equal(accountLogin.isAllowedLoginUrl('https://customer.xiaohongshu.com/login'), true);
  assert.equal(accountLogin.isAllowedLoginUrl('https://passport.xiaohongshu.com/login'), true);
  assert.equal(accountLogin.isAllowedLoginUrl('http://customer.xiaohongshu.com/login'), false);
  assert.equal(accountLogin.isAllowedLoginUrl('https://customer.xiaohongshu.com.evil.test/login'), false);

  assert.equal(accountLogin.isExpectedPlatformUrl(
    'pgy',
    'https://pgy.xiaohongshu.com/microapp/creativity/inspire?from=login#ready'
  ), true);
  assert.equal(accountLogin.isExpectedPlatformUrl(
    'pgy',
    'https://pgy.xiaohongshu.com/microapp/unrelated'
  ), false);
  assert.equal(accountLogin.isExpectedPlatformUrl(
    'juguang',
    'https://ad.xiaohongshu.com.evil.test/aurora/ad/tools/newKeywordTool'
  ), false);

  const email = fixtureElement({ name: 'email', placeholder: '邮箱' });
  const password = fixtureElement({ type: 'password', name: 'password', placeholder: '密码' });
  const submit = fixtureElement({ text: '登录' });
  const result = await loginPage.fillPasswordLogin({
    document: fixtureDocument({ inputs: [email, password], clickables: [submit] }),
    location: {
      href: 'https://customer.xiaohongshu.com.evil.test/login',
      origin: 'https://customer.xiaohongshu.com.evil.test',
      pathname: '/login',
    },
  }, {
    username: 'must-not-be-filled@example.test',
    password: 'must-not-be-filled-secret',
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'XHS_LOGIN_ORIGIN_UNTRUSTED',
    message: '小红书登录页地址不在允许范围内。',
  });
  assert.equal(email.value, '');
  assert.equal(password.value, '');
});

test('page-derived login errors never return credential text', () => {
  const email = fixtureElement({ name: 'email', placeholder: '邮箱' });
  const password = fixtureElement({ type: 'password', name: 'password', placeholder: '密码' });
  const error = fixtureElement({
    text: '账号或密码错误 private-xhs@example.test xhs-secret',
  });
  const state = loginPage.detectPageState({
    document: fixtureDocument({
      inputs: [email, password],
      errors: [error],
      bodyText: '账号登录 邮箱 密码',
    }),
    location: {
      href: 'https://customer.xiaohongshu.com/login',
      origin: 'https://customer.xiaohongshu.com',
      pathname: '/login',
    },
  });
  assert.equal(state.kind, 'loginError');
  assert.doesNotMatch(JSON.stringify(state), /private-xhs|xhs-secret/);
  assert.equal(state.message, '小红书账号或密码错误。');
});

test('extension wiring and project orchestration expose explicit vault login mode', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.host_permissions.includes('https://customer.xiaohongshu.com/*'));
  assert.ok(manifest.host_permissions.includes('https://passport.xiaohongshu.com/*'));
  assert.equal(manifest.host_permissions.includes('https://*.xiaohongshu.com/*'), false);
  const loginEntry = manifest.content_scripts.find((entry) => entry.js.includes('xiaohongshu-login-content.js'));
  assert.ok(loginEntry);
  assert.ok(loginEntry.matches.includes('https://customer.xiaohongshu.com/*'));
  assert.ok(loginEntry.matches.includes('https://passport.xiaohongshu.com/*'));
  assert.match(background, /XhsAccountLogin\.resolveCredentialPlan/);
  assert.match(background, /XhsAccountLogin\.isExpectedPlatformUrl/);
  assert.match(background, /confirmXhsPlatformSession/);
  assert.match(background, /XhsAccountLogin\.isAllowedDocumentUrl/);
  assert.match(background, /prepareProjectPlatformSessions/);
  const prepareIndex = background.indexOf('await prepareProjectPlatformSessions');
  const reportIndex = background.indexOf('await ensureContentDiagnosisReportTask', prepareIndex);
  assert.ok(prepareIndex >= 0 && reportIndex > prepareIndex,
    '账号库登录准备必须先于一键取数报告。');
  assert.match(reportHtml, /value="vault"[^>]*checked/);
  assert.match(reportHtml, /value="currentSession"/);
  assert.match(taskPage, /credentialMode/);
});

test('vault schema and account UI provide explicit per-store defaults shared by PGY and Juguang', () => {
  assert.match(accountsPage, /schema:\s*4/);
  assert.match(accountsPage, /credentialBindings/);
  assert.match(accountsHtml, /id="defaultCredentialField"/);
  assert.match(accountsHtml, /蒲公英\s*\+\s*聚光共用/);
  assert.doesNotMatch(accountsHtml, /pgyPassword|juguangPassword/);
});
