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

function createVaultLoginHarness(platform, reuseExistingTab) {
  const entryUrl = accountLogin.XHS_PLATFORM_ENTRY_URLS[platform];
  const events = [];
  const tabId = reuseExistingTab ? 81 : 82;
  const tabs = new Map(reuseExistingTab ? [[tabId, {
    id: tabId,
    status: 'complete',
    url: entryUrl,
  }]] : []);

  const context = vm.createContext({
    Error,
    Number,
    Object,
    Promise,
    String,
    XHS_PLATFORM_ENTRY_URLS: accountLogin.XHS_PLATFORM_ENTRY_URLS,
    XhsAccountLogin: accountLogin,
    chrome: {
      tabs: {
        async get(id) {
          const tab = tabs.get(Number(id));
          if (!tab) throw new Error('标签页已关闭。');
          return copy(tab);
        },
        async create(details) {
          events.push({ type: 'create', tabId, url: String(details && details.url || '') });
          const tab = { id: tabId, status: 'complete', url: details.url };
          tabs.set(tabId, tab);
          return copy(tab);
        },
        async update(id, update) {
          const existing = tabs.get(Number(id)) || { id: Number(id), status: 'complete' };
          const next = Object.assign({}, existing, copy(update));
          tabs.set(Number(id), next);
          if (update && update.url) {
            events.push({ type: 'update', tabId: Number(id), url: String(update.url) });
          }
          return copy(next);
        },
      },
    },
    async queryUniqueXhsLoginTarget() {
      return reuseExistingTab ? copy(tabs.get(tabId)) : null;
    },
    async waitTabComplete() {},
    async confirmXhsPlatformSession() { return null; },
    async submitXhsPasswordLogin(id, selectedPlatform) {
      return { tabId: Number(id), platform: selectedPlatform, state: 'loggedIn' };
    },
    throwIfProjectTaskCancelled() {},
  });

  const loginSource = sourceBlock(
    'async function ensureXhsPlatformSession',
    '\nasync function loginXhsAccount',
  );
  vm.runInContext(
    loginSource + '\nglobalThis.ensureXhsPlatformSessionUnderTest = ensureXhsPlatformSession;',
    context,
    { filename: 'xhs-direct-official-navigation.js' },
  );
  return { context, entryUrl, events };
}

function assertDirectOfficialNavigation(platform, events) {
  const name = platform === 'pgy' ? '蒲公英' : '聚光';
  const directTarget = accountLogin.XHS_PLATFORM_ENTRY_URLS[platform];
  assert.ok(events.length > 0, name + '登录没有打开任何目标页。');
  assert.ok(
    events[0].url === directTarget,
    name + '必须从自己的官方产品入口开始，' +
      '不得先打开共享/普通小红书页：' + events[0].url,
  );
  for (const event of events) {
    assert.doesNotMatch(
      event.url,
      /^https:\/\/(?:www|customer|passport)\.xiaohongshu\.com(?:\/|$)/i,
      name + '不得由扩展显式' + (event.type === 'create' ? '新建' : '导航到') +
        '普通小红书或共享登录网页。',
    );
  }
}

for (const platform of ['pgy', 'juguang']) {
  const name = platform === 'pgy' ? '蒲公英' : '聚光';

  test(`vault 自动登录在无现有页时直接新建${name}官方登录/产品入口`, async () => {
    const harness = createVaultLoginHarness(platform, false);
    await harness.context.ensureXhsPlatformSessionUnderTest(platform, {
      username: 'fixture@example.test',
      password: 'fixture-password',
    }, {});
    assertDirectOfficialNavigation(platform, harness.events);
  });

  test(`vault 自动登录复用${name}页时不改导到普通小红书网页`, async () => {
    const harness = createVaultLoginHarness(platform, true);
    await harness.context.ensureXhsPlatformSessionUnderTest(platform, {
      username: 'fixture@example.test',
      password: 'fixture-password',
    }, {});
    assertDirectOfficialNavigation(platform, harness.events);
  });
}
