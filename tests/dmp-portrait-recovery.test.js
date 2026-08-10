const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dmp-page-hook.js'), 'utf8');

function extractNamedFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `expected ${name} in dmp-page-hook.js`);

  const start = match.index;
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1, `expected a body for ${name}`);

  let depth = 0;
  let mode = 'code';
  let quote = '';
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        index += 1;
      }
      continue;
    }
    if (mode === 'string') {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        mode = 'code';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      mode = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      mode = 'string';
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`could not extract ${name} from dmp-page-hook.js`);
}

const context = vm.createContext({
  async getCrowd() {
    return { crowdId: 'tt', crowdName: '淘天内容人群资产', crowdNum: '', coverNum: '12.3万' };
  },
  chartPayload() { return {}; },
  async dmpRequestWithServiceFallback(pathname) {
    if (pathname.includes('consumer')) throw new Error('消费能力接口暂时异常');
    return { list: [], result: { rows: [{ optionName: '25-29岁', optionNum: 0, rate: 0 }] } };
  },
  extractData(value) { return value; },
});
vm.runInContext(
  [
    extractNamedFunction('findFirstArray'),
    extractNamedFunction('chartRowsFromData'),
    extractNamedFunction('isUsableCoverageValue'),
    extractNamedFunction('coverageFrom'),
    extractNamedFunction('normalizeChart'),
    extractNamedFunction('buildPortrait'),
    'globalThis.chartRowsFromData = chartRowsFromData;',
    'globalThis.normalizeChart = normalizeChart;',
    'globalThis.coverageFrom = coverageFrom;',
    'globalThis.buildPortrait = buildPortrait;',
  ].join('\n'),
  context
);

function chartRowsFromData(data) {
  return JSON.parse(JSON.stringify(context.chartRowsFromData(data)));
}

const fallbackRow = { optionName: 'fallback', rate: 0.25 };
const fullRow = { optionName: 'full', rate: 0.75 };
const rootRow = { optionName: 'root', rate: 0.5 };
const nestedRow = { optionName: 'nested', rate: 0.4 };

assert.deepEqual(
  chartRowsFromData({ chartDataFull: [], chartData: [fallbackRow] }),
  [fallbackRow],
  'empty chartDataFull arrays should fall back to chartData'
);

assert.deepEqual(
  chartRowsFromData({ chartDataFull: { rows: [] }, chartData: { rows: [fallbackRow] } }),
  [fallbackRow],
  'chartDataFull with empty rows should fall back to chartData rows'
);

assert.deepEqual(
  chartRowsFromData({ chartDataFull: { rows: [fullRow] }, chartData: [fallbackRow] }),
  [fullRow],
  'non-empty chartDataFull should take precedence over chartData'
);

assert.deepEqual(
  chartRowsFromData([rootRow]),
  [rootRow],
  'root arrays should remain supported'
);

assert.deepEqual(
  chartRowsFromData({ result: { rows: [nestedRow] } }),
  [nestedRow],
  'nested rows should remain supported'
);

assert.deepEqual(
  chartRowsFromData({
    chartDataFull: { rows: [] },
    chartData: [],
    list: [],
    result: { rows: [] },
  }),
  [],
  'all-empty candidates should return an empty array'
);

assert.deepEqual(
  chartRowsFromData({ list: [], result: { rows: [nestedRow] } }),
  [nestedRow],
  'an empty list must not mask non-empty nested result rows'
);

assert.equal(context.coverageFrom('', '计算中', '12.3万'), '12.3万');
assert.equal(context.coverageFrom('', '计算中', null), '计算中');

const normalized = JSON.parse(JSON.stringify(context.normalizeChart(
  { id: 'age', tagName: '用户年龄' },
  { chartData: [{ optionName: '25-29岁', optionNum: 0, rate: null, tgi: 0, ctrIndex: 0, ppcIndex: 0 }] }
)));
assert.equal(normalized.rows[0].optionNum, 0, 'zero counts must remain zero');
assert.equal(normalized.rows[0].rate, '', 'missing rates must not become zero percent');
assert.equal(normalized.rows[0].tgi, 0, 'zero indexes must remain zero');
assert.equal(normalized.rows[0].ctrIndex, 0, 'zero CTR indexes must remain zero');
assert.equal(normalized.rows[0].ppcIndex, 0, 'zero PPC indexes must remain zero');

async function verifyPartialTagFailureIsPreserved() {
  const result = await context.buildPortrait({
    crowdId: 'tt',
    crowdName: '淘天内容人群资产',
    tags: [
      { id: 'age', tagName: '用户年龄' },
      { id: 'consumer', tagName: '消费能力等级' },
    ],
  });
  const charts = Array.from(result.charts);
  assert.equal(charts.length, 2);
  assert.equal(charts[0].rows.length, 1, 'the successful tag response must be preserved');
  assert.equal(charts[1].rows.length, 0, 'the failed tag should return an empty placeholder');
  assert.match(charts[1].error, /暂时异常/);
  assert.equal(result.coverage, undefined);
  assert.equal(result.crowd.coverage, '12.3万');
  assert.equal(result.warnings.length, 1);
}

verifyPartialTagFailureIsPreserved().then(() => {
  console.log('dmp portrait recovery guards passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
