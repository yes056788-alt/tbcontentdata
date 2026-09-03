const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const LINGXI_ORIGIN = 'https://idea.xiaohongshu.com';
const LINGXI_MATCH = `${LINGXI_ORIGIN}/*`;
const PAGE_HOOK = 'lingxi-page-hook.js';
const CONTENT_SCRIPT = 'lingxi-content-script.js';
const SYNC_SCRIPT = path.join(root, 'cloud-tool', 'scripts', 'sync-web-tool.mjs');
const PROTECTED_ASSETS_TEST = path.join(
  root,
  'cloud-tool',
  'tests',
  'protected-assets-generation.test.mjs',
);
const CHANNEL = 'xhs-page-bridge-v2';
const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
const PLATFORM = 'lingxi';
const ENDPOINTS = ['listGroups', 'getPortraitPanel', 'buildPortrait'];
const UI_ACTIONS = ['LIST_GROUPS', 'BUILD_PORTRAIT'];
const PANEL_IDS = [
  1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21, 23, 25, 28, 30,
  31, 32, 33,
];
const DEFAULT_GROUP_TYPES = [1, 2, 11, 31, 3, 21];
const OFFICIAL_GROUP_PAGE_SIZE = 20;
const MAX_GROUP_PAGES = 100;

function contentScriptFor(script, world) {
  return manifest.content_scripts.find((entry) => (
    Array.isArray(entry.matches)
      && entry.matches.includes(LINGXI_MATCH)
      && Array.isArray(entry.js)
      && entry.js.includes(script)
      && entry.world === world
  ));
}

function quotedLiteralPattern(value) {
  return new RegExp(`['"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function readRequiredScript(filename) {
  const filenamePath = path.join(root, filename);
  assert.equal(fs.existsSync(filenamePath), true, `缺少灵犀扩展脚本：${filename}`);
  return fs.readFileSync(filenamePath, 'utf8');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function evaluateLingxiContent() {
  const source = readRequiredScript(CONTENT_SCRIPT);
  const posted = [];
  const messageListeners = [];
  const shadowListeners = new Map();
  const timeoutDelays = [];
  let uuidSequence = 0;
  const shadow = {
    innerHTML: '',
    addEventListener(type, listener) {
      shadowListeners.set(type, listener);
    },
  };
  const documentElement = { appendChild() {} };
  const document = {
    body: documentElement,
    documentElement,
    getElementById() { return null; },
    createElement(tagName) {
      if (tagName === 'div') {
        return {
          attachShadow() { return shadow; },
          id: '',
          shadowRoot: null,
        };
      }
      return {
        click() {},
        remove() {},
        style: {},
      };
    },
  };
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.top = windowObject;
  windowObject.window = windowObject;
  const context = vm.createContext({
    Blob,
    Date,
    Map,
    Object,
    Promise,
    Set,
    String,
    URL,
    Uint32Array,
    clearTimeout() {},
    console: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
    crypto: {
      randomUUID() {
        uuidSequence += 1;
        return `fixture-uuid-${uuidSequence}`;
      },
    },
    document,
    location: {
      href: `${LINGXI_ORIGIN}/idea/creativity/audience/list`,
      origin: LINGXI_ORIGIN,
    },
    setTimeout(_callback, delay) {
      timeoutDelays.push(delay);
      return timeoutDelays.length;
    },
    window: windowObject,
  });
  vm.runInContext(source, context, { filename: CONTENT_SCRIPT });

  function click(action) {
    const button = {
      getAttribute(name) { return name === 'data-action' ? action : null; },
    };
    shadowListeners.get('click')({
      target: {
        closest() { return button; },
      },
    });
  }

  function select(groupId, checked = true) {
    shadowListeners.get('change')({
      target: {
        checked,
        getAttribute(name) { return name === 'data-group-id' ? groupId : null; },
        matches() { return true; },
      },
    });
  }

  async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function respond(postedEntry, data) {
    const request = postedEntry.message;
    for (const listener of messageListeners) {
      listener({
        data: {
          channel: CHANNEL,
          type: RESPONSE_TYPE,
          platform: PLATFORM,
          requestId: request.requestId,
          nonce: request.nonce,
          ok: true,
          data,
        },
        origin: LINGXI_ORIGIN,
        source: windowObject,
      });
    }
    await settle();
  }

  return { click, posted, respond, select, shadow, timeoutDelays };
}

function declaredPanelIds(source) {
  const declarations = Array.from(source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s*;/g,
  )).filter((match) => /panel[\w$]*ids?/i.test(match[1]));
  const candidates = declarations.map((match) => (
    Array.from(match[2].matchAll(/\b\d+\b/g), (entry) => Number(entry[0]))
  ));
  return candidates.sort((left, right) => right.length - left.length)[0] || [];
}

function assertBridgeLiterals(source, filename) {
  for (const value of [LINGXI_ORIGIN, CHANNEL, REQUEST_TYPE, RESPONSE_TYPE, PLATFORM]) {
    assert.match(
      source,
      quotedLiteralPattern(value),
      `${filename} 缺少桥接契约字面量：${value}`,
    );
  }
}

test('manifest grants the exact Lingxi host permission', () => {
  assert.ok(
    manifest.host_permissions.includes(LINGXI_MATCH),
    `灵犀缺少精确 host permission：${LINGXI_MATCH}`,
  );
});

test('manifest injects the Lingxi MAIN hook at document_start', () => {
  const entry = contentScriptFor(PAGE_HOOK, 'MAIN');
  assert.ok(entry, `灵犀缺少 MAIN page hook：${PAGE_HOOK}`);
  assert.equal(entry.run_at, 'document_start', '灵犀 page hook 必须在 document_start 注入');
});

test('manifest injects the Lingxi ISOLATED UI at document_idle', () => {
  const entry = contentScriptFor(CONTENT_SCRIPT, 'ISOLATED');
  assert.ok(entry, `灵犀缺少 ISOLATED content script：${CONTENT_SCRIPT}`);
  assert.equal(entry.run_at, 'document_idle', '灵犀 UI 必须在 document_idle 注入');
});

test('Lingxi wiring references two local extension scripts', () => {
  for (const filename of [PAGE_HOOK, CONTENT_SCRIPT]) {
    assert.equal(
      fs.existsSync(path.join(root, filename)),
      true,
      `manifest 引用了不存在的灵犀脚本：${filename}`,
    );
  }
});

test('cloud extension package includes both Lingxi scripts', () => {
  for (const buildFile of [SYNC_SCRIPT, PROTECTED_ASSETS_TEST]) {
    const source = fs.readFileSync(buildFile, 'utf8');
    for (const filename of [PAGE_HOOK, CONTENT_SCRIPT]) {
      assert.match(
        source,
        quotedLiteralPattern(filename),
        `${path.relative(root, buildFile)} 缺少灵犀打包文件：${filename}`,
      );
    }
  }
});

test('Lingxi scripts share the XHS bridge protocol and exact platform identity', () => {
  assertBridgeLiterals(readRequiredScript(PAGE_HOOK), PAGE_HOOK);
  assertBridgeLiterals(readRequiredScript(CONTENT_SCRIPT), CONTENT_SCRIPT);
});

test('Lingxi page hook allowlists the three portrait endpoints', () => {
  const source = readRequiredScript(PAGE_HOOK);
  for (const endpoint of ENDPOINTS) {
    assert.match(
      source,
      quotedLiteralPattern(endpoint),
      `${PAGE_HOOK} 缺少 endpoint：${endpoint}`,
    );
  }
});

test('Lingxi content UI maps list and build actions to the portrait endpoints', () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  for (const action of UI_ACTIONS) {
    assert.match(source, quotedLiteralPattern(action), `灵犀 UI 缺少 action：${action}`);
  }
  for (const endpoint of ENDPOINTS) {
    assert.match(source, quotedLiteralPattern(endpoint), `灵犀 UI 未接入 endpoint：${endpoint}`);
  }
});

test('Lingxi content UI pins responses to the exact origin and request nonce', () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  assert.match(
    source,
    /event\.source\s*!==\s*window/,
    '灵犀 UI 必须拒绝非当前 window 发出的桥接响应',
  );
  assert.match(
    source,
    /event\.origin\s*!==\s*(?:LINGXI_ORIGIN|['"]https:\/\/idea\.xiaohongshu\.com['"])/,
    '灵犀 UI 必须严格校验 idea.xiaohongshu.com origin',
  );
  assert.match(
    source,
    /(?:message|data)\.nonce\s*!==\s*[A-Za-z_$][\w$]*(?:\.nonce)?/,
    '灵犀 UI 必须拒绝 nonce 不匹配的桥接响应',
  );
  assert.match(
    source,
    /postMessage\s*\([\s\S]{0,500}?,\s*(?:LINGXI_ORIGIN|['"]https:\/\/idea\.xiaohongshu\.com['"])\s*\)/,
    '灵犀 UI postMessage 必须使用精确 targetOrigin',
  );
  assert.doesNotMatch(
    source,
    /postMessage\s*\([\s\S]{0,500}?,\s*['"]\*['"]\s*\)/,
    '灵犀 UI 不得向 * 广播桥接请求',
  );
});

test('Lingxi portrait collection covers all 23 known panelIds exactly once', () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  assert.deepEqual(
    declaredPanelIds(source),
    PANEL_IDS,
    '灵犀画像 panelId 清单必须完整且不得重复',
  );
});

test('Lingxi content UI sends the exact official configuration for all 23 panels', async () => {
  const evaluated = evaluateLingxiContent();
  evaluated.click('load');
  assert.equal(evaluated.posted.length, 1);
  await evaluated.respond(evaluated.posted[0], {
    list: [{ groupId: 'group-1', groupName: '测试人群' }],
    total: 1,
  });
  evaluated.select('group-1');
  evaluated.click('build');

  assert.equal(evaluated.posted.length, 2);
  assert.equal(evaluated.posted[1].message.endpoint, 'buildPortrait');
  assert.deepEqual(plain(evaluated.posted[1].message.payload.panels), [
    {
      panelId: 1,
      panelName: '预测性别',
      page: 1,
      pageSize: 10,
      filterField: [{ fieldValues: ['男', '女'], fieldCn: '预测性别', fieldEn: 'sex' }],
    },
    { panelId: 2, panelName: '预测年龄', page: 1, pageSize: 10 },
    { panelId: 3, panelName: '婚恋状态', page: 1, pageSize: 1000 },
    { panelId: 4, panelName: '母婴阶段', page: 1, pageSize: 1000 },
    {
      panelId: 5,
      panelName: '地域分布-省份/区域/城市',
      page: 1,
      pageSize: 30,
      filterField: [{ fieldValues: ['province'], fieldCn: '地域等级', fieldEn: 'flatOption' }],
    },
    {
      panelId: 8,
      panelName: '城市等级',
      page: 1,
      pageSize: 10,
      filterField: [{
        fieldValues: ['新一线城市', '二线城市', '三线城市', '一线城市', '四线城市', '五线城市'],
        fieldCn: '城市等级',
        fieldEn: 'cityLevel',
      }],
    },
    { panelId: 9, panelName: '用户小区档次', page: 1, pageSize: 10 },
    { panelId: 10, panelName: '消费水平', page: 1, pageSize: 10 },
    { panelId: 11, panelName: '固定资产', page: 1, pageSize: 1000 },
    {
      panelId: 12,
      panelName: '品牌及 SPU 偏好-品牌【需下钻】',
      page: 1,
      pageSize: 1000,
      orderField: ['tgi', 'brandCode'],
      orderType: 'desc',
    },
    { panelId: 13, panelName: '品牌及 SPU 偏好-SPU', page: 1, pageSize: 1000 },
    { panelId: 14, panelName: '手机价格', page: 1, pageSize: 10 },
    { panelId: 15, panelName: '手机品牌及型号-手机品牌偏好【需下钻】', page: 1, pageSize: 10 },
    { panelId: 16, panelName: '手机品牌及型号-手机型号偏好', page: 1, pageSize: 10 },
    { panelId: 17, panelName: '内容兴趣偏好-XX 级类目', page: 1, pageSize: 300 },
    {
      panelId: 21,
      panelName: '内容关键词偏好【商业/社区类目】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 23,
      panelName: '搜索词偏好【商业/社区类目】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 25,
      panelName: '热点关注偏好【品牌/通用】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 28,
      panelName: '内容 KOL 偏好 - 概览【标签/粉丝量】',
      page: 1,
      pageSize: 10,
      filterField: [{ fieldValues: ['kolTag'], fieldCn: 'kol筛选【粉丝量/标签】', fieldEn: 'flatOption' }],
    },
    { panelId: 30, panelName: '内容 KOL 偏好 - 明细【标签/粉丝量】', page: 1, pageSize: 300 },
    {
      panelId: 31,
      panelName: '二十大生活方式',
      page: 1,
      pageSize: 100,
      orderField: ['tgi'],
      orderType: 'desc',
    },
    { panelId: 32, panelName: '行业品类偏好-XX 级类目', page: 1, pageSize: 100 },
    {
      panelId: 33,
      panelName: '消费金额',
      page: 1,
      pageSize: 10,
      filterField: [{ fieldValues: ['全部'], fieldCn: '事件类型筛选', fieldEn: 'flatOption' }],
    },
  ]);
});

test('Lingxi content UI uses public-host list defaults and paginates all 439 groups', async () => {
  const evaluated = evaluateLingxiContent();
  const pages = [
    [...Array.from({ length: 19 }, (_, index) => index + 1), 1],
    ...Array.from({ length: 21 }, (_, pageIndex) => (
      Array.from({ length: 20 }, (_, index) => pageIndex * 20 + index + 20)
    )),
  ];
  evaluated.click('load');
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const entry = evaluated.posted[pageIndex];
    assert.ok(entry, `缺少第 ${pageIndex + 1} 页请求`);
    assert.equal(entry.message.endpoint, 'listGroups');
    assert.equal(entry.message.payload.pageNum, pageIndex + 1);
    assert.equal(entry.message.payload.pageSize, OFFICIAL_GROUP_PAGE_SIZE);
    assert.deepEqual(plain(entry.message.payload.types), DEFAULT_GROUP_TYPES);
    assert.equal(entry.message.payload.dmpFlag, 5);
    assert.equal('isHistory' in entry.message.payload, false);
    await evaluated.respond(entry, {
      list: pages[pageIndex].map((id) => ({ groupId: `group-${id}`, groupName: `人群 ${id}` })),
      total: 439,
    });
  }

  assert.equal(evaluated.posted.length, pages.length, '达到服务端 total 后不应继续请求');
  assert.match(evaluated.shadow.innerHTML, /已加载 439 个人群/);
  assert.equal(
    Array.from(evaluated.shadow.innerHTML.matchAll(/data-group-id="group-1"/g)).length,
    1,
    '跨页重复 groupId 必须去重',
  );
});

test('Lingxi content UI trusts total when the server caps pages below the requested pageSize', async () => {
  const evaluated = evaluateLingxiContent();
  const pages = [
    Array.from({ length: 20 }, (_, index) => index + 1),
    Array.from({ length: 20 }, (_, index) => index + 21),
    Array.from({ length: 5 }, (_, index) => index + 41),
  ];
  evaluated.click('load');
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const entry = evaluated.posted[pageIndex];
    assert.ok(entry, `服务端限流时缺少第 ${pageIndex + 1} 页请求`);
    await evaluated.respond(entry, {
      list: pages[pageIndex].map((id) => ({
        groupId: `capped-${id}`,
        groupName: `限流人群 ${id}`,
        groupSize: 111,
        displayInfo: { coveredNum: id === 1 ? 888 : id },
      })),
      total: 45,
    });
  }

  assert.equal(evaluated.posted.length, 3, '达到可信 total 后必须停止');
  assert.match(evaluated.shadow.innerHTML, /已加载 45 个人群/);
  assert.match(evaluated.shadow.innerHTML, /data-group-id="capped-1"[\s\S]*?888 人/);
  assert.doesNotMatch(evaluated.shadow.innerHTML, /data-group-id="capped-1"[\s\S]*?111 人/);
});

test('Lingxi content UI caps pagination when the server reports an unbounded total', async () => {
  const evaluated = evaluateLingxiContent();
  evaluated.click('load');
  for (let pageIndex = 0; pageIndex < MAX_GROUP_PAGES; pageIndex += 1) {
    const entry = evaluated.posted[pageIndex];
    assert.ok(entry, `缺少受控分页的第 ${pageIndex + 1} 页请求`);
    await evaluated.respond(entry, {
      list: Array.from({ length: OFFICIAL_GROUP_PAGE_SIZE }, (_, index) => ({
        groupId: `group-${pageIndex}-${index}`,
        groupName: `人群 ${pageIndex}-${index}`,
      })),
      total: Number.MAX_SAFE_INTEGER,
    });
  }
  assert.equal(evaluated.posted.length, MAX_GROUP_PAGES, '异常 total 不得导致无限翻页');
});

test('Lingxi content UI gives batch builds five minutes while single endpoints stay at 45 seconds', async () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  assert.match(source, /\blistGroups\s*:\s*45000\b/);
  assert.match(source, /\bgetPortraitPanel\s*:\s*45000\b/);
  assert.match(source, /\bbuildPortrait\s*:\s*300000\b/);

  const evaluated = evaluateLingxiContent();
  evaluated.click('load');
  assert.equal(evaluated.timeoutDelays.at(-1), 45000);
  await evaluated.respond(evaluated.posted[0], {
    list: [{ groupId: 'group-timeout', groupName: '超时测试人群' }],
    total: 1,
  });
  evaluated.select('group-timeout');
  evaluated.click('build');
  assert.equal(evaluated.timeoutDelays.at(-1), 300000);
});

test('Lingxi portrait UI exposes CSV and JSON exports', () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  assert.match(source, /导出\s*CSV/i, '灵犀画像 UI 缺少 CSV 导出入口');
  assert.match(source, /导出\s*JSON/i, '灵犀画像 UI 缺少 JSON 导出入口');
  assert.match(source, /['"][^'"]*\.csv['"]/i, '灵犀画像缺少 .csv 下载文件名');
  assert.match(source, /['"][^'"]*\.json['"]/i, '灵犀画像缺少 .json 下载文件名');
});

test('Lingxi content UI never reads browser credential stores', () => {
  const source = readRequiredScript(CONTENT_SCRIPT);
  assert.doesNotMatch(source, /\bdocument\s*\.\s*cookie\b/, '灵犀 UI 不得读取 document.cookie');
  assert.doesNotMatch(source, /\b(?:window\s*\.\s*)?localStorage\b/, '灵犀 UI 不得读取 localStorage');
  assert.doesNotMatch(source, /\b(?:window\s*\.\s*)?sessionStorage\b/, '灵犀 UI 不得读取 sessionStorage');
});
