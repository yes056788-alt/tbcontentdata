const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'xinghe-content-script.js'), 'utf8');

function createStateReader({
  pathname,
  text,
  title = '',
  inputs = { account: null, password: null },
}) {
  const start = source.indexOf('function xingheAccessRestriction');
  const end = source.indexOf('\n\n  async function fillLogin', start);
  assert.ok(start >= 0 && end > start, '星河状态检测源码边界应保持可提取');

  const model = {
    text,
    error: '',
    inputs,
    roles: [],
    verification: false,
  };
  const context = vm.createContext({
    model,
    location: { origin: 'https://adstar.alimama.com', pathname },
    document: { readyState: 'complete', title },
  });
  vm.runInContext(`
    function normalize(value) {
      return String(value || '').normalize('NFKC').replace(/\\s+/g, '').toLowerCase();
    }
    function bodyText() { return model.text; }
    function loginInputs() { return model.inputs; }
    function roleButtons() { return model.roles; }
    function loginError() { return model.error; }
    function verificationVisible() { return model.verification; }
    function accountHint() { return ''; }
    function visibleElements() { return []; }
    function findClickable() { return null; }
  ` + source.slice(start, end) + `
    globalThis.readPageState = pageState;
  `, context, { filename: 'xinghe-current-session-state-model.js' });
  return context.readPageState;
}

test('星河新版首页未展开账号菜单时仍确认当前 Chrome 登录会话', () => {
  const readState = createStateReader({
    pathname: '/portal/v2/pages/home/index.htm',
    text: '淘宝星河 首页 我的星河 数据洞察 活动招商 权益中心 ' +
      '财务管理 策略中心 账户管理 营销中心 发布订单 ' +
      '账户余额 14,617.75 已结算金额 梦想家 ID：59347366',
  });

  assert.equal(readState().kind, 'loggedIn');
});

test('星河产品骨架没有账号会话证据时不得误判为已登录', () => {
  const readState = createStateReader({
    pathname: '/portal/v2/pages/home/index.htm',
    text: '淘宝星河 我的星河 数据洞察 营销中心 ' +
      '页面正在加载，请稍候应用内容加载完成后继续操作。' +
      '这里只是静态产品介绍与帮助文案，不包含当前账号、身份标识或可用的业务数据。',
  });

  assert.equal(readState().kind, 'sessionPending');
});

test('登录表单优先于同页残留的星河产品文案', () => {
  const readState = createStateReader({
    pathname: '/portal/v2/pages/home/index.htm',
    text: '淘宝星河 我的星河 数据洞察 营销中心 ID：59347366 密码登录',
    inputs: { account: {}, password: {} },
  });

  assert.equal(readState().kind, 'login');
});
