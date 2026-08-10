const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf('async function runBusinessDefenseDmp(options)');
const end = source.indexOf('\nasync function runBusinessDefenseAutoCollect', start);
assert.ok(start >= 0 && end > start, 'expected runBusinessDefenseDmp in background.js');
const runnerSource = source.slice(start, end);

function createEnvironment(options) {
  const settings = Array.isArray(options)
    ? { ttPlan: options }
    : (options && typeof options === 'object' ? options : { ttCompletesAt: options });
  const listeners = [];
  const writes = [];
  const buildCalls = new Map();
  let context;

  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'message') return;
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    postMessage(message) {
      Promise.resolve().then(() => {
        const payload = message.payload || {};
        let data;
        if (message.action === 'getTagGroups') {
          data = [{ id: 1, name: '基础画像' }];
        } else if (message.action === 'getTags') {
          data = [
            { id: 'age', tagId: 'age', tagName: '用户年龄' },
            { id: 'consumer', tagId: 'consumer', tagName: '消费能力等级' },
          ];
        } else if (message.action === 'listCrowds') {
          data = {
            list: [
              {
                crowdId: 'tt-crowd',
                crowdName: '淘天内容人群资产',
                coverage: settings.pendingCoverage ? '计算中' : 143793,
              },
              {
                crowdId: 'store-crowd',
                crowdName: '全店人群资产',
                coverage: 200000,
              },
            ],
          };
        } else if (message.action === 'getCrowd') {
          data = {
            crowdId: payload.crowdId,
            crowdName: payload.crowdId === 'tt-crowd' ? '淘天内容人群资产' : '全店人群资产',
            coverage: payload.crowdId === 'tt-crowd' && settings.pendingCoverage ? '计算中' : 200000,
          };
        } else if (message.action === 'buildPortrait') {
          const crowdId = String(payload.crowdId);
          const attempts = (buildCalls.get(crowdId) || 0) + 1;
          buildCalls.set(crowdId, attempts);
          let ageComplete = crowdId !== 'tt-crowd';
          let consumerComplete = crowdId !== 'tt-crowd';
          if (crowdId === 'tt-crowd' && Array.isArray(settings.ttPlan)) {
            const planned = settings.ttPlan[Math.min(attempts - 1, settings.ttPlan.length - 1)] || {};
            ageComplete = Boolean(planned.age);
            consumerComplete = Boolean(planned.consumer);
          } else if (crowdId === 'tt-crowd') {
            ageComplete = attempts >= settings.ttCompletesAt;
            consumerComplete = attempts >= settings.ttCompletesAt;
          }
          data = {
            crowd: {
              crowdId,
              crowdName: payload.crowdName,
              coverage: crowdId === 'tt-crowd'
                ? (settings.pendingCoverage ? '计算中' : 143793)
                : 200000,
            },
            charts: [
              {
                tagName: '用户年龄',
                rows: ageComplete ? [{ optionName: '25-29岁', rate: 35 }] : [],
              },
              {
                tagName: '消费能力等级',
                rows: consumerComplete ? [
                  { optionName: 'L1', rate: 10 },
                  { optionName: 'L2', rate: 20 },
                  { optionName: 'L4', rate: 30 },
                  { optionName: 'L5', rate: 40 },
                ] : [],
              },
            ],
          };
        } else {
          throw new Error('unexpected DMP action: ' + message.action);
        }
        const event = {
          source: windowObject,
          data: {
            type: 'DMP_PORTRAIT_RESPONSE_V2',
            id: message.id,
            ok: true,
            data,
          },
        };
        listeners.slice().forEach((listener) => listener(event));
      });
    },
  };

  context = vm.createContext({
    window: windowObject,
    BUSINESS_DEFENSE_DMP_URL: 'https://dmp.taobao.com/',
    async openOrReuseTab() { return 1; },
    async waitTabComplete() {},
    async reloadPlatformTab() {},
    async waitMilliseconds() {},
    async injectScripts() {},
    async runDmpCrowdPresetAction() {
      return {
        ok: true,
        account: { nick: 'test' },
        results: [
          {
            name: '淘天内容人群资产',
            exists: true,
            crowdId: 'tt-crowd',
            actualName: '淘天内容人群资产',
            coverage: settings.pendingCoverage ? '计算中' : 143793,
          },
          {
            name: '全店人群资产',
            exists: true,
            crowdId: 'store-crowd',
            actualName: '全店人群资产',
            coverage: 200000,
          },
        ],
      };
    },
    chrome: {
      scripting: {
        async executeScript(options) {
          return [{ result: await options.func(...options.args) }];
        },
      },
      storage: {
        local: {
          async set(value) {
            writes.push(structuredClone(value));
          },
        },
      },
    },
    setTimeout(callback, delay) {
      if (Number(delay) < 40000) queueMicrotask(callback);
      return Number(delay);
    },
    clearTimeout() {},
  });

  vm.runInContext(runnerSource + '\nglobalThis.testRun = runBusinessDefenseDmp;', context);
  return { context, writes, buildCalls };
}

async function verifyTransientEmptyRowsRecover() {
  const environment = createEnvironment(3);
  const result = await environment.context.testRun({ includeXiaohongshu: false });
  const tt = result.snapshot.results.find((item) => item.role === 'tt');

  assert.equal(environment.buildCalls.get('tt-crowd'), 3);
  assert.equal(environment.buildCalls.get('store-crowd'), 1);
  assert.equal(tt.portraitAttempts, 3);
  assert.ok(tt.charts.every((chart) => chart.rows.length > 0));
  assert.equal(result.partial, false, 'a recovered portrait should finish successfully');
}

async function verifyPersistentEmptyRowsStayPartial() {
  const environment = createEnvironment(Number.POSITIVE_INFINITY);
  const result = await environment.context.testRun({ includeXiaohongshu: false });
  const tt = result.snapshot.results.find((item) => item.role === 'tt');

  assert.equal(environment.buildCalls.get('tt-crowd'), 3);
  assert.equal(tt.portraitAttempts, 3);
  assert.ok(tt.charts.every((chart) => chart.rows.length === 0));
  assert.equal(result.ok, true, 'usable crowd size should remain available');
  assert.equal(result.partial, true, 'exhausted portrait retries must be marked partial');
  assert.match(result.warnings.join('。'), /已尝试3次/);
  assert.equal(environment.writes.at(-1).dmpPortraitSnapshotV1.partial, true);
}

async function verifyComplementaryRetriesAreMerged() {
  const environment = createEnvironment([
    { age: true, consumer: false },
    { age: false, consumer: true },
  ]);
  const result = await environment.context.testRun({ includeXiaohongshu: false });
  const tt = result.snapshot.results.find((item) => item.role === 'tt');

  assert.equal(environment.buildCalls.get('tt-crowd'), 2);
  assert.equal(tt.portraitAttempts, 2);
  assert.ok(tt.charts.every((chart) => chart.rows.length > 0));
  assert.equal(result.partial, false, 'complementary successful charts should be merged');
}

async function verifyPendingCoverageStaysPartial() {
  const environment = createEnvironment({ ttCompletesAt: 1, pendingCoverage: true });
  const result = await environment.context.testRun({ includeXiaohongshu: false });

  assert.equal(result.ok, true, 'complete portraits remain usable while size is pending');
  assert.equal(result.partial, true, 'a pending crowd size must never be reported as complete');
  assert.match(result.warnings.join('。'), /人群规模仍在计算：淘天内容人群资产/);
  assert.equal(environment.writes.at(-1).dmpPortraitSnapshotV1.partial, true);
}

Promise.all([
  verifyTransientEmptyRowsRecover(),
  verifyPersistentEmptyRowsStayPartial(),
  verifyComplementaryRetriesAreMerged(),
  verifyPendingCoverageStaysPartial(),
]).then(() => {
  console.log('dmp portrait retry behavior passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
