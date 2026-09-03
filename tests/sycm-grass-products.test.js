const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'sycm-content-script.js'), 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, 'expected function ' + name);
  const end = content.indexOf('\n  }\n', start);
  assert.notEqual(end, -1, 'expected end of function ' + name);
  return content.slice(start, end + 4);
}

function extractAsyncFunction(name) {
  const marker = 'async function ' + name + '(';
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, 'expected async function ' + name);
  const end = content.indexOf('\n  }\n', start);
  assert.notEqual(end, -1, 'expected end of async function ' + name);
  return content.slice(start, end + 4);
}

const featureStart = content.indexOf('function normalizeGrassProductText(');
const featureEnd = content.indexOf('async function runTrafficDiagnosis(', featureStart);
assert.ok(featureStart > 0 && featureEnd > featureStart, 'expected isolated grass product feature block');
const feature = content.slice(featureStart, featureEnd);
const virtualCollectorStart = feature.indexOf('async function collectCompleteGrassProductPage(');
const virtualCollectorEnd = feature.indexOf('async function waitForGrassProductPage(', virtualCollectorStart);
const virtualCollector = feature.slice(virtualCollectorStart, virtualCollectorEnd);

assert.match(content, /const GRASS_PRODUCT_MAX_AUTO_PAGES = 30;/);
assert.match(content, /const GRASS_PRODUCT_MAX_ROWS = 10000;/);
assert.match(content, /const GRASS_PRODUCT_MAX_TEXT_CHARS = 20000000;/);
assert.match(content, /const GRASS_PRODUCT_MIN_DELAY_MS = 3200;/);
assert.match(content, /const GRASS_PRODUCT_MAX_DELAY_MS = 4800;/);
assert.match(content, /const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;/);
assert.match(content, /const GRASS_PRODUCT_PAGE_STABLE_READS = 5;/);
assert.match(content, /const GRASS_PRODUCT_SCROLL_STABLE_READS = 3;/);
assert.match(content, /const GRASS_PRODUCT_SCROLL_STEP_RATIO = 0\.65;/);
assert.match(feature, /\.row\.header-font/);
assert.match(feature, /\.row\.body-font/);
assert.match(feature, /\.scroll-y-container/);
assert.match(feature, /!cell\.classList\.contains\('hide-column'\)/);
assert.match(feature, /replace\(\/\\\.0\+\$\/, ''\)/);
assert.match(feature, /\/\^\\d\{6,24\}\$\//);
assert.match(feature, /await sleep\(grassProductDelay\(\)\);[\s\S]*nextButton\.click\(\);/);
assert.match(feature, /操作频繁/);
assert.match(feature, /访问受限/);
assert.match(feature, /验证码/);
assert.match(feature, /function readGrassProductSelectedFieldCount\(/);
assert.match(feature, /function readGrassProductLabeledFilters\(/);
assert.match(feature, /function readGrassProductStatusMetadata\(/);
assert.match(feature, /fieldCoverageComplete = selectedFieldCount > 0/);
assert.match(feature, /cell\.querySelectorAll\([\s\S]*\[aria-sort\]/);
assert.match(feature, /move-up\|move-down/);
assert.match(feature, /paginationAuthoritative/);
assert.match(feature, /assertGrassProductPaginationReady\(firstPage\)/);
assert.match(feature, /await collectCompleteGrassProductPage\(1, firstPage\.fingerprint\)/);
assert.match(feature, /!firstPage\.fieldCoverageComplete/);
assert.match(feature, /allowPartialFields = window\.confirm\(/);
assert.match(feature, /缺失列在页面 DOM 中没有数据/);
assert.match(feature, /所有商品行已采集/);
assert.match(feature, /const delayedRiskMessage = grassProductRiskMessage\(\)/);
assert.match(feature, /beforeClick\.fingerprint !== page\.fingerprint/);
assert.match(feature, /findGrassProductPagination\(tableRoot\)/);
assert.match(feature, /setGrassProductScrollerPosition\(scroller, originalTop, originalLeft\)/);
assert.match(feature, /rows: grassProductRowsFromOrdinalMap\(ordinalRows, expectedCount\)/);
assert.match(feature, /previousUncoveredSignature/);
assert.match(feature, /grassProductWindowCoversScrollTarget\(page, clampedTarget\)/);
assert.match(feature, /new MutationObserver\(/);
assert.match(feature, /renderGate\.hasChanged\(\)/);
assert.match(feature, /renderGate\.semanticCoverage\(\)/);
assert.match(feature, /positions\.concat\(positions\.slice\(\)\.reverse\(\)\)/);
assert.match(feature, /grassProductWindowContentSignature\(beforeClick\)/);
assert.match(feature, /contentSignature !== previousWindowContentSignature/);
assert.doesNotMatch(feature, /signature &&\s*windowContentChanged &&/);
assert.match(feature, /grassProductCanonicalPageSignature\(priorPage\)/);
assert.match(feature, /grassProductCollection\.pages/);
assert.match(feature, /preservedSharedIdentityCount \+= sharedIdentityCount/);
assert.match(feature, /CSV 不会自动去重/);
assert.match(feature, /quietFor >= GRASS_PRODUCT_PAGE_QUIET_MS/);
assert.match(feature, /grassProductRowsHaveCompleteValues\(page\)/);
assert.match(feature, /page\.restoredWindowSignature !== grassProductWindowSignature\(pagePreview\)/);
assert.match(feature, /renderGate\.disconnect\(\)/);
assert.ok(virtualCollectorStart > 0 && virtualCollectorEnd > virtualCollectorStart);
assert.doesNotMatch(virtualCollector, /nextButton|\.click\s*\(|\bfetch\s*\(|XMLHttpRequest/);
assert.ok(
  feature.indexOf('allowPartialFields = window.confirm(') < feature.indexOf('let page = await collectCompleteGrassProductPage(1'),
  'partial-field confirmation must happen before the first virtual-table scroll'
);
assert.doesNotMatch(feature, /seenRows/);
assert.doesNotMatch(feature, /\bfetch\s*\(/);
assert.doesNotMatch(feature, /XMLHttpRequest/);
assert.doesNotMatch(feature, /chrome\.webRequest/);
assert.doesNotMatch(feature, /cookie|authorization|requestBody/i);

test('empty collector status reuses authoritative pagination already visible in the page DOM', () => {
  const statusSandbox = {
    grassProductCollection: {
      headers: [],
      totalExpected: 0,
      pageSize: 0,
      pageCountExpected: 0,
      selectedFieldCount: 0,
    },
    readGrassProductPageIdentity: () => ({
      headers: Array.from({ length: 12 }, (_, index) => '字段' + index),
      totalExpected: 300,
      pageSize: 100,
      pageCountExpected: 3,
      selectedFieldCount: 14,
    }),
  };
  vm.runInNewContext(extractFunction('readGrassProductStatusMetadata'), statusSandbox);
  assert.deepEqual(
    JSON.parse(JSON.stringify(statusSandbox.readGrassProductStatusMetadata())),
    {
      headers: Array.from({ length: 12 }, (_, index) => '字段' + index),
      totalExpected: 300,
      pageSize: 100,
      pageCountExpected: 3,
      selectedFieldCount: 14,
    }
  );
});

const sandbox = {};
vm.runInNewContext([
  'const GRASS_PRODUCT_SCROLL_STEP_RATIO = 0.65;',
  extractFunction('normalizeGrassProductText'),
  extractFunction('grassProductCells'),
  extractFunction('readGrassProductCell'),
  extractFunction('findGrassProductScroller'),
  extractFunction('readGrassProductWindow'),
  extractFunction('readGrassProductSelectedFieldCount'),
  extractFunction('grassProductRowSignature'),
  extractFunction('grassProductRowIdentitySignature'),
  extractFunction('grassProductPageSignature'),
  extractFunction('grassProductWindowSignature'),
  extractFunction('grassProductWindowContentSignature'),
  extractFunction('grassProductCanonicalPageSignature'),
  extractFunction('grassProductSharedIdentityCount'),
  extractFunction('grassProductExpectedRowCount'),
  extractFunction('assertGrassProductCrossPageIdentityReady'),
  extractFunction('mergeGrassProductOrdinalRows'),
  extractFunction('grassProductRowsFromOrdinalMap'),
  extractFunction('validateCompleteGrassProductWindowRows'),
  extractFunction('grassProductScrollPositions'),
  extractFunction('grassProductWindowCoversScrollTarget'),
  extractFunction('grassProductPageHasExpectedRows'),
  extractFunction('grassProductRowsHaveCompleteValues'),
  extractFunction('assertGrassProductPaginationReady'),
  extractFunction('assertGrassProductPageReady'),
  extractFunction('protectGrassProductCsvValue'),
  extractFunction('grassProductCsvCell'),
].join('\n'), sandbox);

const visibleCell = {
  classList: { contains: (name) => name === 'table-cell' },
};
const hiddenCell = {
  classList: { contains: (name) => name === 'table-cell' || name === 'hide-column' },
};
assert.deepEqual(
  Array.from(sandbox.grassProductCells({ children: [visibleCell, hiddenCell] })),
  [visibleCell],
  'fixed-column duplicate must be ignored'
);

const rawElement = {
  innerText: '4.49万',
  textContent: '4.49万',
  getAttribute: (name) => name === 'title' ? '44,900' : '',
};
const cell = {
  innerText: '4.49万',
  textContent: '4.49万',
  getAttribute: () => '',
  querySelector: (selector) => selector === '.cell-rawData' ? rawElement : null,
};
assert.equal(sandbox.readGrassProductCell(cell), '44,900', 'exact title value should beat abbreviated display text');

function fakeTableCell(value) {
  return {
    classList: { contains: (name) => name === 'table-cell' },
    getAttribute: (name) => name === 'title' ? value : null,
    querySelector: () => null,
    innerText: value,
    textContent: value,
  };
}

function firstWindowContentSignature(page, rowCount) {
  return page.rows.slice(0, rowCount)
    .map((row) => row.values.join('\u001f'))
    .join('\u001e');
}
const fakeScroller = {
  scrollTop: 610,
  scrollLeft: 0,
  scrollHeight: 3232,
  clientHeight: 470,
  getBoundingClientRect: () => ({ top: 100, bottom: 570 }),
};
function fakeProductRow(rawOrdinal) {
  const top = 100 - fakeScroller.scrollTop + (rawOrdinal * 32);
  return {
    children: [fakeTableCell('100001'), fakeTableCell('相同行'), fakeTableCell('9')],
    closest: (selector) => selector === '.scroll-y-container' ? fakeScroller : null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ top, bottom: top + 30, height: 30 }),
  };
}
const geometryRows = [fakeProductRow(20), fakeProductRow(21)];
fakeScroller.querySelectorAll = (selector) => selector === '.row.body-font' ? geometryRows : [];
const fakeTableRoot = {
  querySelector: (selector) => selector === '.row.body-font' ? geometryRows[0] : null,
  querySelectorAll: (selector) => selector === '.row.body-font' ? geometryRows : [],
  contains: (element) => element === fakeScroller,
};
const geometryWindow = sandbox.readGrassProductWindow(
  fakeTableRoot,
  ['商品id', '商品标题', '成交UV']
);
assert.deepEqual(Array.from(geometryWindow.rows, (row) => row.rawOrdinal), [20, 21]);
assert.equal(geometryWindow.rows.length, 2, 'identical values at distinct geometric positions must both remain');

test('scroller ties prefer the pane whose rows cover the complete product columns', () => {
  const canonicalScroller = {};
  const fixedScroller = {};
  const makePaneRow = (scroller, values) => ({
    children: values.map(fakeTableCell),
    closest: (selector) => selector === '.scroll-y-container' ? scroller : null,
  });
  const canonicalRows = Array.from({ length: 20 }, (_, index) => makePaneRow(canonicalScroller, [
    String(200001 + index),
    '完整商品第' + (index + 1) + '行',
    String(index),
  ]));
  const fixedRows = Array.from({ length: 20 }, (_, index) => makePaneRow(fixedScroller, [
    String(200001 + index),
    '固定列第' + (index + 1) + '行',
  ]));
  const tiedTableRoot = {
    querySelectorAll: (selector) => selector === '.row.body-font'
      ? fixedRows.concat(canonicalRows)
      : [],
    contains: (element) => element === canonicalScroller || element === fixedScroller,
  };
  assert.equal(
    sandbox.findGrassProductScroller(tiedTableRoot, 3),
    canonicalScroller,
    'equal row counts must be broken by complete visible column coverage'
  );
});

sandbox.document = { body: { innerText: '商品颗粒数据 已选字段(14)' } };
assert.equal(sandbox.readGrassProductSelectedFieldCount(), 14);
sandbox.document = { body: { innerText: '商品颗粒数据' } };
assert.equal(sandbox.readGrassProductSelectedFieldCount(), 0);

const oldRows = [{ values: ['100001', '旧页商品'] }];
const newRows = [{ values: ['100002', '新页商品'] }];
assert.equal(
  sandbox.grassProductPageSignature({ pageNo: 1, rows: oldRows }),
  sandbox.grassProductPageSignature({ pageNo: 2, rows: oldRows }),
  'a page-number-only update must not make stale rows look new'
);
assert.notEqual(
  sandbox.grassProductPageSignature({ pageNo: 1, rows: oldRows }),
  sandbox.grassProductPageSignature({ pageNo: 2, rows: newRows }),
  'newly rendered row data must change the page signature'
);
assert.equal(
  sandbox.grassProductWindowSignature({ rows: [
    { rawOrdinal: 2, values: ['2'] },
    { rawOrdinal: 1, values: ['1'] },
  ] }),
  sandbox.grassProductWindowSignature({ rows: [
    { rawOrdinal: 1, values: ['1'] },
    { rawOrdinal: 2, values: ['2'] },
  ] }),
  'virtual row node order must not create a false window change'
);
const completedRows = Array.from({ length: 6 }, (_, index) => ({
  values: [String(index + 1), '旧页第' + (index + 1) + '行'],
}));
assert.equal(sandbox.grassProductSharedIdentityCount({
  rows: [
    { rawOrdinal: 1, values: completedRows[0].values.concat('4.49万') },
    { rawOrdinal: 2, values: ['200002', '新页商品', '9'] },
  ],
}, { rows: completedRows }), 1, '交叉页的同一商品id+标题应只按稳定身份计数');
assert.equal(sandbox.grassProductSharedIdentityCount({
  rows: completedRows.slice(0, 3).map((row) => ({ values: row.values.concat('4.49万') })),
}, { rows: completedRows }), 3, '指标缩写不能让旧页商品身份逃过检查');
assert.equal(sandbox.grassProductRowIdentitySignature({
  values: ['100001.000', 'A &amp;amp; B'],
}), sandbox.grassProductRowIdentitySignature({
  values: ['100001', 'A & B'],
}), '实体编码和id小数尾巴不应改变商品稳定身份');
const previousHundred = {
  pageNo: 1,
  rows: Array.from({ length: 100 }, (_, index) => ({
    values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
  })),
};
const firstWindowNewRestOld = {
  pageNo: 2,
  rows: previousHundred.rows.map((row, index) => ({
    values: index < 20 ? [String(200001 + index), '新页第' + (index + 1) + '行', String(index)] : row.values,
  })),
};
assert.equal(
  sandbox.assertGrassProductCrossPageIdentityReady(firstWindowNewRestOld, previousHundred),
  80,
  '稳定的合法重复与稳定残影在 DOM-only 下不可区分，重复数量只能作为遥测'
);
assert.equal(sandbox.assertGrassProductCrossPageIdentityReady({
  pageNo: 2,
  rows: [{ values: previousHundred.rows[0].values }, { values: ['200002', '新页商品', '2'] }],
}, previousHundred), 1, '完整页复验仍允许一条合法跨页重复');
const fourStableDuplicates = {
  pageNo: 2,
  pageSize: 100,
  totalExpected: 200,
  paginationAuthoritative: true,
  rows: Array.from({ length: 100 }, (_, index) => ({
    values: index < 4
      ? previousHundred.rows[96 + index].values.slice()
      : [String(300001 + index), '第2页第' + (index + 1) + '行', String(index)],
  })),
};
assert.equal(
  sandbox.assertGrassProductCrossPageIdentityReady(fourStableDuplicates, previousHundred),
  4,
  '完整复扫稳定的跨页重复应按页面真实DOM保留'
);
const sixStableDuplicates = {
  ...fourStableDuplicates,
  rows: Array.from({ length: 100 }, (_, index) => ({
    values: index < 6
      ? previousHundred.rows[94 + index].values.slice()
      : [String(350001 + index), '第2页语义刷新商品' + (index + 1), String(index)],
  })),
};
assert.equal(
  sandbox.assertGrassProductCrossPageIdentityReady(sixStableDuplicates, previousHundred),
  6,
  '商品身份数量不再参与页面准入'
);
const hundredSameIdentitiesWithNewMetrics = {
  pageNo: 2,
  rows: previousHundred.rows.map((row, index) => ({
    values: [row.values[0], row.values[1], String(1000 + index)],
  })),
};
assert.equal(
  sandbox.assertGrassProductCrossPageIdentityReady(hundredSameIdentitiesWithNewMetrics, previousHundred),
  100,
  '即使100个商品身份都重复，只要完整行快照不同也必须原样保留'
);
assert.throws(
  () => sandbox.assertGrassProductCrossPageIdentityReady({
    ...sixStableDuplicates,
    rows: previousHundred.rows.map((row) => ({ values: row.values.slice() })),
  }, previousHundred),
  /完整内容与已采集第 1 页相同或仅顺序不同/,
  '整页有序全值完全相同仍必须拒绝'
);
assert.throws(
  () => sandbox.assertGrassProductCrossPageIdentityReady({
    ...sixStableDuplicates,
    rows: previousHundred.rows.slice().reverse().map((row) => ({ values: row.values.slice() })),
  }, previousHundred),
  /相同或仅顺序不同/,
  '整页旧数据即使重排也必须拒绝'
);
const twentyRowStaleBlock = {
  pageNo: 2,
  pageSize: 100,
  totalExpected: 200,
  paginationAuthoritative: true,
  rows: Array.from({ length: 100 }, (_, index) => ({
    values: index >= 40 && index < 60
      ? previousHundred.rows[index].values.slice()
      : [String(400001 + index), '第2页新商品' + (index + 1), String(index)],
  })),
};
assert.equal(
  sandbox.assertGrassProductCrossPageIdentityReady(twentyRowStaleBlock, previousHundred),
  20,
  '只要完整快照不是历史页回放，重复行必须原样保留'
);
const historicalReplay = { ...previousHundred, pageNo: 5 };
const pageSixteen = {
  pageNo: 16,
  rows: previousHundred.rows.map((row, index) => ({
    values: [String(800001 + index), '第16页商品' + (index + 1), row.values[2]],
  })),
};
assert.throws(
  () => sandbox.assertGrassProductCrossPageIdentityReady(
    { ...historicalReplay, pageNo: 17 },
    pageSixteen,
    [historicalReplay, pageSixteen]
  ),
  /已采集第 5 页相同或仅顺序不同/,
  '非相邻历史页回放必须在保存前拒绝'
);
assert.equal(sandbox.grassProductPageHasExpectedRows({
  pageNo: 2,
  pageSize: 20,
  totalExpected: 41,
  paginationAuthoritative: true,
  rows: Array.from({ length: 20 }, () => ({ values: ['1'] })),
}), true);
assert.equal(sandbox.grassProductPageHasExpectedRows({
  pageNo: 3,
  pageSize: 20,
  totalExpected: 41,
  paginationAuthoritative: true,
  rows: Array.from({ length: 2 }, () => ({ values: ['1'] })),
}), false, 'partially rendered last page must not be accepted');
assert.equal(sandbox.grassProductPageHasExpectedRows({
  pageNo: 3,
  pageSize: 20,
  totalExpected: 41,
  paginationAuthoritative: true,
  rows: [{ values: ['1'] }],
}), true, 'complete last page should be accepted');
assert.equal(sandbox.grassProductPageHasExpectedRows({
  pageNo: 1,
  pageSize: 20,
  totalExpected: 20,
  paginationAuthoritative: false,
  rows: Array.from({ length: 20 }, () => ({ values: ['1'] })),
}), false, 'missing authoritative pagination must never be marked complete');
assert.equal(sandbox.grassProductExpectedRowCount({
  pageNo: 6,
  pageSize: 100,
  totalExpected: 591,
  paginationAuthoritative: true,
}), 91, 'last page should use its remaining authoritative row count');
assert.equal(sandbox.grassProductExpectedRowCount({
  pageNo: 26,
  pageSize: 100,
  totalExpected: 2525,
  paginationAuthoritative: true,
}), 25, 'the screenshot dataset must finish with exactly 25 rows on page 26');
assert.equal(sandbox.grassProductRowsHaveCompleteValues({
  headers: ['商品id', '商品标题', '搜索曝光UV'],
  rows: [{ values: ['100001', '商品', '44,900'] }],
}), true);
assert.equal(sandbox.grassProductRowsHaveCompleteValues({
  headers: ['商品id', '商品标题', '搜索曝光UV'],
  rows: [{ values: ['100001', '商品', '4.49万'] }],
}), false, '精确 title 未渲染时的缩写指标不能入库');
assert.throws(() => sandbox.assertGrassProductPageReady({
  paginationAuthoritative: false,
  rows: [{ values: ['1'] }],
}), /权威/);
assert.throws(() => sandbox.assertGrassProductPageReady({
  pageNo: 1,
  pageSize: 20,
  totalExpected: 20,
  paginationAuthoritative: true,
  rows: Array.from({ length: 19 }, () => ({ values: ['1'] })),
}), /不一致/);

const ordinalRows = new Map();
sandbox.mergeGrassProductOrdinalRows(ordinalRows, [
  { rawOrdinal: 1, values: ['100001', '完全相同行'] },
  { rawOrdinal: 2, values: ['100001', '完全相同行'] },
], 1, 4);
sandbox.mergeGrassProductOrdinalRows(ordinalRows, [
  { rawOrdinal: 2, values: ['100001', '完全相同行'] },
  { rawOrdinal: 3, values: ['100003', '第三行'] },
  { rawOrdinal: 4, values: ['100004', '第四行'] },
], 1, 4);
assert.equal(ordinalRows.size, 4, 'overlap should merge by ordinal, while identical values at distinct ordinals remain');
assert.deepEqual(
  Array.from(sandbox.grassProductRowsFromOrdinalMap(ordinalRows, 4), (row) => Array.from(row.values)),
  [
    ['100001', '完全相同行'],
    ['100001', '完全相同行'],
    ['100003', '第三行'],
    ['100004', '第四行'],
  ]
);
assert.throws(() => sandbox.mergeGrassProductOrdinalRows(ordinalRows, [
  { rawOrdinal: 2, values: ['100002', '滚动后变值'] },
], 1, 4), /同一行位置/);
assert.throws(() => sandbox.mergeGrassProductOrdinalRows(new Map(), [
  { rawOrdinal: 1, values: ['100001', '第一行'] },
  { rawOrdinal: 3, values: ['100003', '第三行'] },
], 1, 4), /不连续/);
assert.throws(() => sandbox.grassProductRowsFromOrdinalMap(new Map([
  [1, { values: ['100001', '第一行'] }],
]), 2), /缺少第 2 行/);
assert.throws(() => sandbox.validateCompleteGrassProductWindowRows([
  { rawOrdinal: 1, values: ['100001', '第一行'] },
  { rawOrdinal: 1, values: ['100002', '重复行号'] },
], 2), /不连续/, 'exact row count must not bypass duplicate-ordinal validation');

const hundredRows = new Map();
const repeatedValues = ['100050', '允许不同位置完全相同'];
[1, 16, 31, 46, 61, 74].forEach((start) => {
  const end = Math.min(100, start + 26);
  const windowRows = [];
  for (let ordinal = start; ordinal <= end; ordinal += 1) {
    const values = ordinal === 50 || ordinal === 51
      ? repeatedValues
      : [String(100000 + ordinal), '第' + ordinal + '行'];
    windowRows.push({ rawOrdinal: ordinal, values });
  }
  sandbox.mergeGrassProductOrdinalRows(hundredRows, windowRows, 1, 100);
});
assert.equal(sandbox.grassProductRowsFromOrdinalMap(hundredRows, 100).length, 100);
assert.deepEqual(Array.from(hundredRows.get(50).values), Array.from(hundredRows.get(51).values));

const scrollPositions = Array.from(sandbox.grassProductScrollPositions({ clientHeight: 470, scrollHeight: 3232 }));
assert.equal(scrollPositions[0], 0);
assert.equal(scrollPositions.at(-1), 2762);
assert.ok(scrollPositions.every((value, index) => index === 0 || value > scrollPositions[index - 1]));
const topWindow = {
  rows: Array.from({ length: 26 }, (_, index) => ({ rawOrdinal: index + 1, values: ['1'] })),
  windowRowHeight: 32,
  windowScrollHeight: 3232,
  windowClientHeight: 470,
};
assert.equal(sandbox.grassProductWindowCoversScrollTarget(topWindow, 305), true);
assert.equal(
  sandbox.grassProductWindowCoversScrollTarget(topWindow, 915),
  false,
  'a stale mounted window must not be accepted after the target moves outside its covered content range'
);

assert.equal(sandbox.protectGrassProductCsvValue('=2+2'), "'=2+2");
assert.equal(sandbox.protectGrassProductCsvValue('+cmd'), "'+cmd");
assert.equal(sandbox.protectGrassProductCsvValue('@SUM(A1:A2)'), "'@SUM(A1:A2)");
assert.equal(sandbox.protectGrassProductCsvValue(' \t=2+2'), "' \t=2+2");
assert.equal(sandbox.protectGrassProductCsvValue('-12.50'), '-12.50');
assert.equal(sandbox.grassProductCsvCell('1234567890123', true), '"\'1234567890123"');
assert.equal(sandbox.grassProductCsvCell('a"b', false), '"a""b"');
assert.equal(sandbox.grassProductCsvCell('a,b', false), '"a,b"');

test('virtual-window settle rejects stale mounted rows until the target range is rendered', async () => {
  let clock = 0;
  let reads = 0;
  const scroller = { isConnected: true };
  const rootNode = {};
  const page = (start) => ({
    pageNo: 1,
    fingerprint: 'fp',
    rows: Array.from({ length: 26 }, (_, index) => ({
      rawOrdinal: start + index,
      values: [String(100000 + start + index), '第' + (start + index) + '行'],
    })),
    windowRowHeight: 32,
    windowHasViewportRows: true,
    windowScrollTop: 915,
    windowScrollHeight: 3232,
    windowClientHeight: 470,
  });
  const stalePage = page(1);
  const freshPage = page(23);
  const asyncSandbox = {
    Date: { now: () => { clock += 10; return clock; } },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return reads <= 3 ? stalePage : freshPage;
    },
    findGrassProductHeaderRow: () => ({}),
    findGrassProductTableRoot: () => rootNode,
    findGrassProductScroller: () => scroller,
    sleep: async () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_SCROLL_POLL_MS = 120;',
    'const GRASS_PRODUCT_SCROLL_STABLE_READS = 3;',
    'const GRASS_PRODUCT_SCROLL_SETTLE_TIMEOUT_MS = 3000;',
    extractFunction('grassProductCells'),
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowCoversScrollTarget'),
    extractAsyncFunction('waitForGrassProductWindow'),
  ].join('\n'), asyncSandbox);
  const previousSignature = asyncSandbox.grassProductWindowSignature(stalePage);
  const result = await asyncSandbox.waitForGrassProductWindow(
    scroller,
    915,
    1,
    'fp',
    3232,
    previousSignature
  );
  assert.equal(result.rows[0].rawOrdinal, 23);
  assert.equal(reads, 6, 'three stale reads must not satisfy the three-read stability gate');
});

test('page transition waits past a transient mixed window before accepting the stable page', async () => {
  let clock = 0;
  let reads = 0;
  const previousPage = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行'],
    })),
  };
  const windowPage = (start, isNew) => ({
    headers: ['商品id', '商品标题'],
    pageNo: 2,
    fingerprint: 'fp',
    rows: Array.from({ length: 26 }, (_, index) => ({
      rawOrdinal: start + index,
      values: isNew
        ? [String(200001 + index), '新页第' + (index + 1) + '行']
        : previousPage.rows[start + index - 1].values,
    })),
  });
  const transitionSandbox = {
    Date: { now: () => { clock += 10; return clock; } },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      if (reads <= 3) {
        const mixedPage = windowPage(74, false);
        mixedPage.rows[0] = { rawOrdinal: 74, values: ['200001', '仅首行已更新'] };
        return mixedPage;
      }
      return windowPage(1, true);
    },
    sleep: async () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), transitionSandbox);
  const result = await transitionSandbox.waitForGrassProductPage(
    2,
    'fp',
    previousPage,
    { hasChanged: () => true, coverage: () => 1, quietFor: () => 2000, version: () => 1 },
    firstWindowContentSignature(previousPage, 26)
  );
  assert.equal(result.rows[0].values[0], '200001');
  assert.equal(reads, 8, 'a partially refreshed window must not satisfy the five-read stability gate');
});

test('page transition waits past a whole-window intermediate render and preserves a legal duplicate row', async () => {
  let clock = 0;
  let reads = 0;
  const previousPage = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', '9'],
    })),
  };
  const transitionalPage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    fingerprint: 'fp',
    rows: previousPage.rows.slice(0, 26).map((row, index) => ({
      rawOrdinal: index + 1,
      values: [row.values[0], row.values[1], ''],
    })),
  };
  const finalPage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    fingerprint: 'fp',
    rows: Array.from({ length: 26 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: index === 0
        ? previousPage.rows[0].values
        : [String(200001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  };
  const transitionSandbox = {
    Date: { now: () => { clock += 10; return clock; } },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return reads <= 7 ? transitionalPage : finalPage;
    },
    sleep: async () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), transitionSandbox);
  const result = await transitionSandbox.waitForGrassProductPage(
    2,
    'fp',
    previousPage,
    {
      hasChanged: () => true,
      coverage: () => 25 / 26,
      quietFor: () => 2000,
      version: () => reads <= 7 ? 1 : 2,
    },
    firstWindowContentSignature(previousPage, 26)
  );
  assert.equal(result.rows[0].values[0], previousPage.rows[0].values[0]);
  assert.equal(result.rows[1].values[0], '200002');
  assert.equal(reads, 12, 'an empty-metric intermediate render must remain ineligible even beyond five stable reads');
});

test('render gate requires complete row refresh coverage and disconnects cleanly', () => {
  const rowLayer = {};
  const rows = Array.from({ length: 20 }, (_, index) => ({
    children: [String(100001 + index), '旧行' + (index + 1), String(index)].map(fakeTableCell),
    parentElement: rowLayer,
    closest(selector) {
      return selector === '.row.body-font' ? this : null;
    },
  }));
  const headerRow = { children: ['商品id', '商品标题', '成交UV'].map(fakeTableCell) };
  const tableRoot = { querySelectorAll: () => rows };
  let observerCallback = null;
  let observedTarget = null;
  let observedOptions = null;
  let disconnects = 0;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe(target, options) {
      observedTarget = target;
      observedOptions = options;
    }
    disconnect() {
      disconnects += 1;
    }
  }
  const gateSandbox = {
    MutationObserver: FakeMutationObserver,
    findGrassProductHeaderRow: () => headerRow,
    findGrassProductTableRoot: () => tableRoot,
    findGrassProductScroller: () => null,
  };
  vm.runInNewContext([
    extractFunction('grassProductCells'),
    extractFunction('normalizeGrassProductText'),
    extractFunction('readGrassProductCell'),
    extractFunction('createGrassProductRenderGate'),
  ].join('\n'), gateSandbox);
  const gate = gateSandbox.createGrassProductRenderGate();
  assert.equal(gate.hasChanged(), false);
  assert.equal(observedTarget, rowLayer);
  assert.deepEqual(Array.from(observedOptions.attributeFilter), ['title']);
  observerCallback([{ target: rows[0], addedNodes: [], removedNodes: [] }]);
  assert.equal(gate.hasChanged(), true);
  assert.equal(gate.coverage(), 0.05);
  rows.slice(1, 16).forEach((row) => {
    observerCallback([{ target: row, addedNodes: [], removedNodes: [] }]);
  });
  assert.equal(gate.coverage(), 0.8);
  rows.slice(16).forEach((row) => {
    observerCallback([{ target: row, addedNodes: [], removedNodes: [] }]);
  });
  assert.equal(gate.coverage(), 1);
  assert.equal(gate.semanticCoverage(), 0, 'mutation coverage alone must not claim row-value refresh');
  rows.forEach((row, index) => {
    row.children = [String(200001 + index), '新行' + (index + 1), String(index + 1)].map(fakeTableCell);
  });
  assert.equal(gate.semanticCoverage(), 1, 'all visible slots changed their complete row values');
  assert.equal(gate.version(), 20);
  gate.disconnect();
  assert.equal(disconnects, 1);
});

test('real render gate accepts page 4 with fourteen shared identities and 85 percent slot-value change', async () => {
  let clock = 100;
  const canonicalLayer = {};
  const mirrorLayer = {};
  const canonicalScroller = {
    querySelectorAll: () => canonicalRows,
  };
  const makeRow = (layer, scroller, values) => ({
    children: values.map(fakeTableCell),
    parentElement: layer,
    closest(selector) {
      if (selector === '.row.body-font') return this;
      if (selector === '.scroll-y-container') return scroller;
      return null;
    },
  });
  const canonicalRows = Array.from({ length: 26 }, (_, index) => makeRow(
    canonicalLayer,
    canonicalScroller,
    [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)]
  ));
  const mirrorRows = Array.from({ length: 26 }, (_, index) => makeRow(
    mirrorLayer,
    null,
    [String(100001 + index), '固定列第' + (index + 1) + '行', String(index)]
  ));
  const headerRow = {
    children: ['商品id', '商品标题', '成交UV'].map(fakeTableCell),
  };
  const tableRoot = { querySelectorAll: () => canonicalRows.concat(mirrorRows) };
  let observerCallback = null;
  let observedTarget = null;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe(target) {
      observedTarget = target;
    }
    disconnect() {}
  }
  const gateSandbox = {
    Date: { now: () => clock },
    MutationObserver: FakeMutationObserver,
    findGrassProductHeaderRow: () => headerRow,
    findGrassProductTableRoot: () => tableRoot,
    findGrassProductScroller: () => canonicalScroller,
  };
  vm.runInNewContext([
    extractFunction('grassProductCells'),
    extractFunction('normalizeGrassProductText'),
    extractFunction('readGrassProductCell'),
    extractFunction('createGrassProductRenderGate'),
  ].join('\n'), gateSandbox);
  const gate = gateSandbox.createGrassProductRenderGate();
  assert.equal(observedTarget, canonicalLayer, 'only the canonical virtual row layer should be observed');
  const previousPage = {
    pageNo: 3,
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
    })),
  };
  const candidatePage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 4,
    pageSize: 100,
    totalExpected: 2685,
    pageCountExpected: 27,
    paginationAuthoritative: true,
    fingerprint: 'fp',
    rows: Array.from({ length: 26 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: index < 4
        ? previousPage.rows[index].values.slice()
        : index < 14
          ? previousPage.rows[86 + index].values.slice()
          : [String(200001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  };
  canonicalRows.forEach((row, index) => {
    row.children = candidatePage.rows[index].values.map(fakeTableCell);
    observerCallback([{ target: row, addedNodes: [], removedNodes: [] }]);
  });
  assert.equal(
    gate.coverage(),
    1,
    'fixed-column or mirror rows outside the canonical scroller must not dilute refresh coverage'
  );
  assert.equal(gate.semanticCoverage(), 22 / 26, 'four slots keep equal values while twenty-two change');
  let reads = 0;
  Object.assign(gateSandbox, {
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return candidatePage;
    },
    sleep: async (milliseconds) => { clock += milliseconds; },
  });
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractFunction('grassProductPageHasExpectedRows'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), gateSandbox);
  assert.equal(gateSandbox.grassProductExpectedRowCount(candidatePage), 100);
  assert.equal(gateSandbox.grassProductSharedIdentityCount(candidatePage, previousPage), 14);
  assert.equal(
    gateSandbox.grassProductPageHasExpectedRows(candidatePage),
    false,
    'the 26-row transition preview is not yet the completed 100-row page'
  );
  clock = 2100;
  const result = await gateSandbox.waitForGrassProductPage(
    4,
    'fp',
    previousPage,
    gate,
    firstWindowContentSignature(previousPage, 26)
  );
  assert.equal(result.rows.length, 26);
  assert.equal(result.pageSize, 100);
  assert.equal(reads, 5, 'five stable DOM reads should hand the virtual window to the full-page scanner');
});

function makeSharedPartialPreviewFixture(sharedCount) {
  let clock = 0;
  let reads = 0;
  const previousPage = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
    })),
  };
  const candidatePage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    pageSize: 100,
    totalExpected: 200,
    pageCountExpected: 2,
    paginationAuthoritative: true,
    fingerprint: 'fp',
    rows: Array.from({ length: 26 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: index < sharedCount
        ? previousPage.rows[100 - sharedCount + index].values.slice()
        : [String(300001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  };
  const transitionSandbox = {
    Date: { now: () => clock },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return candidatePage;
    },
    sleep: async (milliseconds) => { clock += milliseconds; },
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), transitionSandbox);
  return {
    candidatePage,
    previousPage,
    reads: () => reads,
    wait: (renderGate) => transitionSandbox.waitForGrassProductPage(
      2,
      'fp',
      previousPage,
      renderGate,
      firstWindowContentSignature(previousPage, 26)
    ),
  };
}

test('non-100 percent render telemetry does not block a changed stable window', async () => {
  const fixture = makeSharedPartialPreviewFixture(4);
  const result = await fixture.wait({
    hasChanged: () => true,
    coverage: () => 25 / 26,
    semanticCoverage: () => 25 / 26,
    quietFor: () => 2000,
  });
  assert.equal(result.rows.length, 26);
});

test('changed row content can settle even when virtual-row mutation telemetry is silent', async () => {
  const fixture = makeSharedPartialPreviewFixture(4);
  const result = await fixture.wait({
    hasChanged: () => false,
    coverage: () => 0,
    semanticCoverage: () => 1,
    quietFor: () => 0,
  });
  assert.equal(result.rows.length, 26);
});

test('an identical first 26-row window can proceed to scan rows 27-100 after a render epoch', async () => {
  const fixture = makeSharedPartialPreviewFixture(0);
  fixture.candidatePage.rows = fixture.previousPage.rows.slice(0, 26).map((row, index) => ({
    rawOrdinal: index + 1,
    values: row.values.slice(),
  }));
  const result = await fixture.wait({
    hasChanged: () => true,
    coverage: () => 1,
    semanticCoverage: () => 0,
    quietFor: () => 2000,
  });
  assert.equal(result.rows.length, 26);
});

test('a complete render refresh allows six shared identities to proceed to the full-page scanner', async () => {
  const fixture = makeSharedPartialPreviewFixture(6);
  const result = await fixture.wait({
    hasChanged: () => true,
    coverage: () => 1,
    semanticCoverage: () => 1,
    quietFor: () => 2000,
  });
  assert.equal(result.rows.length, 26);
  assert.equal(result.transitionSemanticRenderCoverage, 1);
});

test('page 4 style overlap proceeds when fourteen identities overlap and four slots keep equal values', async () => {
  const fixture = makeSharedPartialPreviewFixture(14);
  const result = await fixture.wait({
    hasChanged: () => true,
    coverage: () => 1,
    semanticCoverage: () => 22 / 26,
    quietFor: () => 2000,
  });
  assert.equal(result.rows.length, 26);
});

test('all twenty-five transitions in a twenty-six-page run ignore overlap and telemetry percentages', async () => {
  const overlaps = [0, 1, 4, 6, 14, 20, 25, 26];
  for (let transition = 0; transition < 25; transition += 1) {
    const fixture = makeSharedPartialPreviewFixture(overlaps[transition % overlaps.length]);
    const result = await fixture.wait({
      hasChanged: () => transition % 3 !== 0,
      coverage: () => (transition % 27) / 26,
      semanticCoverage: () => ((transition * 7) % 27) / 26,
      quietFor: () => transition % 3 === 0 ? 0 : 2000,
    });
    assert.equal(result.rows.length, 26, 'transition ' + (transition + 1) + ' should reach the full-page scanner');
  }
});

test('stable signatures can settle a fully refreshed partial overlap despite continuing harmless mutations', async () => {
  const fixture = makeSharedPartialPreviewFixture(4);
  const result = await fixture.wait({
    hasChanged: () => true,
    coverage: () => 1,
    semanticCoverage: () => 1,
    quietFor: () => 0,
  });
  assert.equal(result.rows.length, 26);
  assert.equal(fixture.reads(), 7, '1800ms of stable row signatures should settle on the seventh 300ms read');
});

test('page transition accepts a stable all-new window when virtual rows are silently reused', async () => {
  let clock = 0;
  let reads = 0;
  const previousPage = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
    })),
  };
  const candidatePage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    pageSize: 100,
    totalExpected: 2685,
    pageCountExpected: 27,
    paginationAuthoritative: true,
    fingerprint: 'fp',
    rows: Array.from({ length: 20 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: [String(200001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  };
  const silentReuseSandbox = {
    Date: { now: () => clock },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return candidatePage;
    },
    sleep: async (milliseconds) => { clock += milliseconds; },
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), silentReuseSandbox);
  const silentRenderGate = {
    hasChanged: () => false,
    coverage: () => 0,
    quietFor: () => 0,
    version: () => 0,
  };
  const result = await silentReuseSandbox.waitForGrassProductPage(
    2,
    'fp',
    previousPage,
    silentRenderGate,
    firstWindowContentSignature(previousPage, 20)
  );
  assert.equal(result.pageNo, 2);
  assert.equal(result.rows.length, 20);
  assert.ok(clock < 20000, 'strong stable DOM evidence must resolve before the timeout');
  assert.ok(reads >= 5, 'silent reuse still requires repeated stable reads');
});

test('page transition accepts stable duplicate identities without a numeric overlap budget', async () => {
  let clock = 0;
  let reads = 0;
  const previousPage = {
    rows: Array.from({ length: 100 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
    })),
  };
  const candidatePage = {
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    pageSize: 100,
    totalExpected: 200,
    pageCountExpected: 2,
    paginationAuthoritative: true,
    fingerprint: 'fp',
    rows: Array.from({ length: 100 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: index < 4
        ? previousPage.rows[96 + index].values.slice()
        : [String(300001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  };
  const transitionSandbox = {
    Date: { now: () => { clock += 10; return clock; } },
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: () => {
      reads += 1;
      return candidatePage;
    },
    sleep: async () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), transitionSandbox);
  const result = await transitionSandbox.waitForGrassProductPage(
    2,
    'fp',
    previousPage,
    {
      hasChanged: () => true,
      coverage: () => 0.96,
      quietFor: () => 2000,
    },
    firstWindowContentSignature(previousPage, 100)
  );
  assert.equal(result.rows.length, 100);
  assert.equal(reads, 5);
});

function makeRealRenderGateTransitionFixture(candidatePageFactory) {
  let clock = 100;
  let observerCallback = null;
  const oldLayer = {};
  const makeDomRow = (layer) => ({
    parentElement: layer,
    closest(selector) {
      return selector === '.row.body-font' ? this : null;
    },
  });
  const originalDomRows = Array.from({ length: 20 }, () => makeDomRow(oldLayer));
  let currentDomRows = originalDomRows;
  const tableRoot = { querySelectorAll: () => currentDomRows };
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  }
  const previousPage = {
    pageNo: 1,
    rows: Array.from({ length: 20 }, (_, index) => ({
      values: [String(100001 + index), '旧页第' + (index + 1) + '行', String(index)],
    })),
  };
  const sandbox = {
    Date: { now: () => clock },
    MutationObserver: FakeMutationObserver,
    grassProductCollection: { stopRequested: false },
    grassProductRiskMessage: () => '',
    findGrassProductHeaderRow: () => ({}),
    findGrassProductTableRoot: () => tableRoot,
    findGrassProductScroller: () => null,
    readCurrentGrassProductPage: () => candidatePageFactory(previousPage),
    sleep: async (milliseconds) => { clock += milliseconds; },
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_PAGE_TIMEOUT_MS = 20000;',
    'const GRASS_PRODUCT_PAGE_QUIET_MS = 1800;',
    'const GRASS_PRODUCT_PAGE_STABLE_READS = 5;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductCanonicalPageSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('assertGrassProductCrossPageIdentityReady'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractFunction('grassProductCells'),
    extractFunction('normalizeGrassProductText'),
    extractFunction('readGrassProductCell'),
    extractFunction('createGrassProductRenderGate'),
    extractAsyncFunction('waitForGrassProductPage'),
  ].join('\n'), sandbox);
  return {
    sandbox,
    previousPage,
    originalDomRows,
    mutateRows(rows) {
      rows.forEach((row) => observerCallback([{ target: row, addedNodes: [], removedNodes: [] }]));
    },
    replaceLayer() {
      const newLayer = {};
      currentDomRows = Array.from({ length: 20 }, () => makeDomRow(newLayer));
    },
    advance(milliseconds) {
      clock += milliseconds;
    },
  };
}

test('real render gate permits one identical reused row only after every other slot refreshes', async () => {
  const fixture = makeRealRenderGateTransitionFixture((previousPage) => ({
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    fingerprint: 'fp',
    rows: Array.from({ length: 20 }, (_, index) => ({
      rawOrdinal: index + 1,
      values: index === 0
        ? previousPage.rows[0].values
        : [String(200001 + index), '新页第' + (index + 1) + '行', String(index)],
    })),
  }));
  const gate = fixture.sandbox.createGrassProductRenderGate();
  fixture.mutateRows(fixture.originalDomRows.slice(1));
  fixture.advance(1900);
  assert.equal(gate.coverage(), 0.95);
  const result = await fixture.sandbox.waitForGrassProductPage(
    2,
    'fp',
    fixture.previousPage,
    gate,
    firstWindowContentSignature(fixture.previousPage, 20)
  );
  assert.equal(result.rows[0].values[0], fixture.previousPage.rows[0].values[0]);
  assert.equal(result.rows[1].values[0], '200002');
});

test('an unchanged replaced layer can reach the scanner but is rejected before page commit', async () => {
  const fixture = makeRealRenderGateTransitionFixture((previousPage) => ({
    headers: ['商品id', '商品标题', '成交UV'],
    pageNo: 2,
    fingerprint: 'fp',
    rows: previousPage.rows.map((row, index) => ({
      rawOrdinal: index + 1,
      values: row.values,
    })),
  }));
  const gate = fixture.sandbox.createGrassProductRenderGate();
  fixture.replaceLayer();
  assert.equal(gate.coverage(), 1, '整层替换只是渲染证据，不能单独证明数据正确');
  const preview = await fixture.sandbox.waitForGrassProductPage(
    2,
    'fp',
    fixture.previousPage,
    gate,
    firstWindowContentSignature(fixture.previousPage, 20)
  );
  assert.throws(
    () => fixture.sandbox.assertGrassProductCrossPageIdentityReady(preview, fixture.previousPage),
    /完整内容与已采集第 1 页相同或仅顺序不同/
  );
});

function makeCollectorSandbox(stopOnFirstScroll, mutateOnReverse, mutateBottomOnSecondVisit) {
  let clock = 0;
  let stopped = false;
  let sawBottom = false;
  let reverseMutation = false;
  let bottomVisits = 0;
  let bottomMutation = false;
  const events = [];
  const collection = { stopRequested: false, warning: '' };
  const headerRow = { isConnected: true };
  const tableRoot = { isConnected: true, contains: (element) => element === scroller };
  const scroller = {
    isConnected: true,
    scrollTop: 915,
    scrollLeft: 7,
    scrollHeight: 3232,
    clientHeight: 470,
    scrollTo(options) {
      this.scrollTop = options.top;
      this.scrollLeft = options.left;
      events.push('scroll:' + options.top + ':' + options.left);
      if (options.top === this.scrollHeight - this.clientHeight) {
        sawBottom = true;
        bottomVisits += 1;
        if (mutateBottomOnSecondVisit && bottomVisits >= 2) bottomMutation = true;
      }
      else if (mutateOnReverse && sawBottom && options.top < this.scrollHeight - this.clientHeight) {
        reverseMutation = true;
      }
      if (stopOnFirstScroll && !stopped && options.top === 0) {
        stopped = true;
        collection.stopRequested = true;
      }
    },
  };
  const readPage = () => {
    const centerRaw = (scroller.scrollTop + (scroller.clientHeight / 2)) / 32;
    let start = Math.max(1, Math.floor(centerRaw) - 13);
    let end = Math.min(100, start + 26);
    start = Math.max(1, end - 26);
    const rows = [];
    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      const title = reverseMutation && ordinal === 50
        ? '第50行发生变化'
        : bottomMutation && ordinal === 100 ? '第100行发生变化' : '第' + ordinal + '行';
      rows.push({ rawOrdinal: ordinal, values: [String(100000 + ordinal), title] });
    }
    return {
      headers: ['商品id', '商品标题'],
      rows,
      pageNo: 1,
      pageSize: 100,
      totalExpected: 100,
      pageCountExpected: 1,
      selectedFieldCount: 2,
      fieldCoverageComplete: true,
      paginationAuthoritative: true,
      fingerprint: 'fp',
      windowRowHeight: 32,
      windowHasViewportRows: true,
      windowScrollTop: scroller.scrollTop,
      windowScrollLeft: scroller.scrollLeft,
      windowScrollHeight: scroller.scrollHeight,
      windowClientHeight: scroller.clientHeight,
    };
  };
  const collectorSandbox = {
    Date: { now: () => { clock += 10; return clock; } },
    grassProductCollection: collection,
    grassProductRiskMessage: () => '',
    readCurrentGrassProductPage: readPage,
    readGrassProductPageIdentity: () => ({ pageNo: 1, fingerprint: 'fp' }),
    findGrassProductHeaderRow: () => headerRow,
    findGrassProductTableRoot: () => tableRoot,
    findGrassProductScroller: () => scroller,
    renderGrassProductCollectorState: () => {},
    sleep: async () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_SCROLL_POLL_MS = 120;',
    'const GRASS_PRODUCT_SCROLL_STABLE_READS = 3;',
    'const GRASS_PRODUCT_SCROLL_SETTLE_TIMEOUT_MS = 3000;',
    'const GRASS_PRODUCT_SCROLL_STEP_RATIO = 0.65;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductExpectedRowCount'),
    extractFunction('mergeGrassProductOrdinalRows'),
    extractFunction('grassProductRowsFromOrdinalMap'),
    extractFunction('validateCompleteGrassProductWindowRows'),
    extractFunction('grassProductScrollPositions'),
    extractFunction('grassProductWindowCoversScrollTarget'),
    extractFunction('grassProductPageHasExpectedRows'),
    extractFunction('grassProductRowsHaveCompleteValues'),
    extractFunction('assertGrassProductPaginationReady'),
    extractFunction('assertGrassProductPageReady'),
    extractFunction('setGrassProductScrollerPosition'),
    extractFunction('grassProductCells'),
    extractAsyncFunction('waitForGrassProductWindow'),
    extractAsyncFunction('collectCompleteGrassProductPage'),
  ].join('\n'), collectorSandbox);
  return { collectorSandbox, collection, events, scroller };
}

test('virtual-page collector covers 100 rows and restores both scroll axes', async () => {
  const fixture = makeCollectorSandbox(false);
  const result = await fixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp');
  assert.equal(result.rows.length, 100);
  assert.deepEqual(Array.from(result.rows[0].values), ['100001', '第1行']);
  assert.deepEqual(Array.from(result.rows[99].values), ['100100', '第100行']);
  assert.equal(result.restoredScrollTop, 915);
  assert.equal(
    result.restoredWindowSignature,
    fixture.collectorSandbox.grassProductWindowSignature(
      fixture.collectorSandbox.readCurrentGrassProductPage()
    ),
    'the runner must receive the exact window signature produced after restoring the table position'
  );
  assert.equal(fixture.scroller.scrollTop, 915);
  assert.equal(fixture.scroller.scrollLeft, 7);
  assert.equal(fixture.events.at(-1), 'scroll:915:7');
});

test('stopping a virtual-page scan rejects the partial page and restores scroll position', async () => {
  const fixture = makeCollectorSandbox(true);
  fixture.collectorSandbox.readGrassProductPageIdentity = () => {
    throw new Error('identity temporarily unavailable');
  };
  await assert.rejects(
    fixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp'),
    /停止/
  );
  assert.equal(fixture.scroller.scrollTop, 915);
  assert.equal(fixture.scroller.scrollLeft, 7);
  assert.equal(fixture.events.at(-1), 'scroll:915:7');
});

test('reverse validation pass rejects rows that change during a virtual-page scan', async () => {
  const fixture = makeCollectorSandbox(false, true);
  await assert.rejects(
    fixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp'),
    /同一行位置/
  );
  assert.equal(fixture.scroller.scrollTop, 915);
  assert.equal(fixture.scroller.scrollLeft, 7);
});

test('reverse validation rechecks the bottom window instead of trusting its first read', async () => {
  const fixture = makeCollectorSandbox(false, false, true);
  await assert.rejects(
    fixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp'),
    /同一行位置/
  );
  assert.equal(fixture.scroller.scrollTop, 915);
  assert.equal(fixture.scroller.scrollLeft, 7);
});

function exactTwentyRowPage(withDuplicateOrdinal) {
  return {
    headers: ['商品id', '商品标题'],
    rows: Array.from({ length: 20 }, (_, index) => ({
      rawOrdinal: withDuplicateOrdinal && index === 1 ? 1 : index + 1,
      values: [String(100001 + index), '第' + (index + 1) + '行'],
    })),
    pageNo: 1,
    pageSize: 20,
    totalExpected: 20,
    pageCountExpected: 1,
    selectedFieldCount: 2,
    fieldCoverageComplete: true,
    paginationAuthoritative: true,
    fingerprint: 'fp',
    windowRowHeight: 32,
    windowHasViewportRows: true,
    windowScrollTop: 0,
    windowScrollLeft: 0,
    windowScrollHeight: 672,
    windowClientHeight: 470,
  };
}

test('collector fast path validates exact-count ordinals before accepting a page', async () => {
  const validFixture = makeCollectorSandbox(false);
  validFixture.collectorSandbox.readCurrentGrassProductPage = () => exactTwentyRowPage(false);
  const result = await validFixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp');
  assert.equal(result.rows.length, 20);
  assert.equal(validFixture.events.length, 0, 'a fully mounted page should not be scrolled');

  const invalidFixture = makeCollectorSandbox(false);
  invalidFixture.collectorSandbox.readCurrentGrassProductPage = () => exactTwentyRowPage(true);
  await assert.rejects(
    invalidFixture.collectorSandbox.collectCompleteGrassProductPage(1, 'fp'),
    /不连续/
  );
});

function makeSequentialGrassPages() {
  const totalExpected = 2525;
  const pageSize = 100;
  const pageCountExpected = 26;
  const overlapPattern = [4, 6, 14, 26, 99, 100, 0, 1, 20, 25];
  const pages = [];
  let expectedSharedIdentityCount = 0;
  for (let pageNo = 1; pageNo <= pageCountExpected; pageNo += 1) {
    const rowCount = pageNo === pageCountExpected ? 25 : pageSize;
    const previousPage = pages[pages.length - 1];
    const overlap = previousPage
      ? Math.min(overlapPattern[(pageNo - 2) % overlapPattern.length], previousPage.rows.length, rowCount)
      : 0;
    const rows = Array.from({ length: rowCount }, (_, index) => {
      if (index < overlap) {
        const previousRow = previousPage.rows[previousPage.rows.length - overlap + index];
        return {
          rawOrdinal: index + 1,
          values: [previousRow.values[0], previousRow.values[1], String((pageNo * 10000) + index)],
        };
      }
      const itemId = String(700000000000 + (pageNo * 1000) + index);
      return {
        rawOrdinal: index + 1,
        values: [itemId, '第' + pageNo + '页商品' + (index + 1), String((pageNo * 10000) + index)],
      };
    });
    expectedSharedIdentityCount += overlap;
    pages.push({
      headers: ['商品id', '商品标题', '商品成交GMV'],
      rows,
      pageNo,
      pageSize,
      totalExpected,
      pageCountExpected,
      selectedFieldCount: 14,
      fieldCoverageComplete: false,
      paginationAuthoritative: true,
      fingerprint: '2525-row-fingerprint',
      windowScrollTop: 0,
      restoredScrollTop: 0,
    });
  }
  return { pages, expectedSharedIdentityCount };
}

function makeCaptureAllRunner(pages) {
  let currentPageIndex = 0;
  let clickCount = 0;
  let delayCount = 0;
  let disconnectCount = 0;
  let waitCount = 0;
  let scanCount = 0;
  let activeScans = 0;
  let maxActiveScans = 0;
  let confirmationCount = 0;
  const grassProductCollection = {
    fingerprint: '',
    headers: [],
    pages: new Map(),
    totalExpected: 0,
    pageSize: 0,
    pageCountExpected: 0,
    selectedFieldCount: 0,
    fieldCoverageComplete: false,
    paginationAuthoritative: false,
    preservedSharedIdentityCount: 0,
    running: false,
    stopRequested: false,
    warning: '',
  };
  const runnerSandbox = {
    window: {
      confirm() {
        confirmationCount += 1;
        return true;
      },
    },
    grassProductCollection,
    readCurrentGrassProductPage: () => pages[currentPageIndex],
    assertGrassProductPaginationReady: () => {},
    assertGrassProductPageReady: () => {},
    collectCompleteGrassProductPage: async (expectedPageNo) => {
      scanCount += 1;
      activeScans += 1;
      maxActiveScans = Math.max(maxActiveScans, activeScans);
      try {
        assert.equal(pages[currentPageIndex].pageNo, expectedPageNo);
        await Promise.resolve();
        return pages[currentPageIndex];
      } finally {
        activeScans -= 1;
      }
    },
    renderGrassProductCollectorState: () => {},
    grassProductRiskMessage: () => '',
    sleep: async () => { delayCount += 1; },
    grassProductDelay: () => 4000,
    findGrassProductNextButton: () => ({
      click() {
        clickCount += 1;
        currentPageIndex += 1;
      },
    }),
    createGrassProductRenderGate: () => ({
      disconnect() { disconnectCount += 1; },
    }),
    waitForGrassProductPage: async (expectedPageNo) => {
      waitCount += 1;
      assert.equal(pages[currentPageIndex].pageNo, expectedPageNo);
      return pages[currentPageIndex];
    },
    setGrassProductWarning: () => {},
  };
  vm.runInNewContext([
    'const GRASS_PRODUCT_MAX_AUTO_PAGES = 30;',
    'const GRASS_PRODUCT_MAX_ROWS = 10000;',
    'const GRASS_PRODUCT_MAX_TEXT_CHARS = 20000000;',
    extractFunction('grassProductRowSignature'),
    extractFunction('grassProductRowIdentitySignature'),
    extractFunction('grassProductWindowSignature'),
    extractFunction('grassProductWindowContentSignature'),
    extractFunction('grassProductCanonicalPageSignature'),
    extractFunction('grassProductSharedIdentityCount'),
    extractFunction('assertGrassProductCrossPageIdentityReady'),
    extractFunction('resetGrassProductCollection'),
    extractFunction('storeGrassProductPage'),
    extractFunction('grassProductCollectionRows'),
    extractFunction('grassProductCollectionComplete'),
    extractAsyncFunction('captureAllGrassProductPages'),
  ].join('\n'), runnerSandbox);
  pages.forEach((page) => {
    page.restoredWindowSignature = runnerSandbox.grassProductWindowSignature(page);
  });
  return {
    runnerSandbox,
    collection: grassProductCollection,
    stats: () => ({
      clickCount,
      delayCount,
      disconnectCount,
      waitCount,
      scanCount,
      maxActiveScans,
      confirmationCount,
      currentPageIndex,
    }),
  };
}

test('capture-all runner commits all 2525 rows across 26 pages with exactly 25 serial clicks', async () => {
  const fixture = makeSequentialGrassPages();
  const runner = makeCaptureAllRunner(fixture.pages);
  await runner.runnerSandbox.captureAllGrassProductPages();
  const stats = runner.stats();
  assert.equal(stats.clickCount, 25);
  assert.equal(stats.delayCount, 25);
  assert.equal(stats.disconnectCount, 25);
  assert.equal(stats.waitCount, 25);
  assert.equal(stats.scanCount, 26);
  assert.equal(stats.maxActiveScans, 1);
  assert.equal(stats.confirmationCount, 1);
  assert.equal(stats.currentPageIndex, 25, 'the runner must stop on page 26 without a page-27 click');
  assert.equal(runner.collection.pages.size, 26);
  assert.equal(runner.runnerSandbox.grassProductCollectionRows().length, 2525);
  assert.equal(runner.collection.pages.get(26).rows.length, 25);
  assert.equal(runner.collection.preservedSharedIdentityCount, fixture.expectedSharedIdentityCount);
  assert.match(runner.collection.warning, /所有商品行已采集/);
  assert.equal(runner.collection.running, false);
});

test('capture-all runner rejects a non-adjacent historical replay before commit or another click', async () => {
  const fixture = makeSequentialGrassPages();
  const replaySource = fixture.pages[4];
  const originalPageSeventeen = fixture.pages[16];
  fixture.pages[16] = {
    ...originalPageSeventeen,
    rows: replaySource.rows.map((row, index) => ({
      rawOrdinal: index + 1,
      values: row.values.slice(),
    })),
  };
  const runner = makeCaptureAllRunner(fixture.pages);
  await assert.rejects(
    runner.runnerSandbox.captureAllGrassProductPages(),
    /已采集第 5 页相同或仅顺序不同/
  );
  const stats = runner.stats();
  assert.equal(stats.clickCount, 16, 'page 17 is reached once and page 18 is never clicked');
  assert.equal(runner.collection.pages.size, 16);
  assert.equal(runner.collection.pages.has(17), false);
  assert.equal(runner.collection.running, false);
});

console.log('sycm grass product DOM-only collection guards passed');
