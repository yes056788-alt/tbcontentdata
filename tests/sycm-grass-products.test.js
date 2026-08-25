const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const featureStart = content.indexOf('function normalizeGrassProductText(');
const featureEnd = content.indexOf('async function runTrafficDiagnosis(', featureStart);
assert.ok(featureStart > 0 && featureEnd > featureStart, 'expected isolated grass product feature block');
const feature = content.slice(featureStart, featureEnd);

assert.match(content, /const GRASS_PRODUCT_MAX_AUTO_PAGES = 30;/);
assert.match(content, /const GRASS_PRODUCT_MAX_ROWS = 10000;/);
assert.match(content, /const GRASS_PRODUCT_MAX_TEXT_CHARS = 20000000;/);
assert.match(content, /const GRASS_PRODUCT_MIN_DELAY_MS = 3200;/);
assert.match(content, /const GRASS_PRODUCT_MAX_DELAY_MS = 4800;/);
assert.match(feature, /\.row\.header-font/);
assert.match(feature, /\.row\.body-font/);
assert.match(feature, /!cell\.classList\.contains\('hide-column'\)/);
assert.match(feature, /replace\(\/\\\.0\+\$\/, ''\)/);
assert.match(feature, /\/\^\\d\{6,24\}\$\//);
assert.match(feature, /await sleep\(grassProductDelay\(\)\);[\s\S]*nextButton\.click\(\);/);
assert.match(feature, /操作频繁/);
assert.match(feature, /访问受限/);
assert.match(feature, /验证码/);
assert.match(feature, /function readGrassProductSelectedFieldCount\(/);
assert.match(feature, /function readGrassProductLabeledFilters\(/);
assert.match(feature, /fieldCoverageComplete = selectedFieldCount > 0/);
assert.match(feature, /cell\.querySelectorAll\([\s\S]*\[aria-sort\]/);
assert.match(feature, /move-up\|move-down/);
assert.match(feature, /paginationAuthoritative/);
assert.match(feature, /assertGrassProductPageReady\(firstPage\)/);
assert.match(feature, /!firstPage\.fieldCoverageComplete/);
assert.match(feature, /allowPartialFields = window\.confirm\(/);
assert.match(feature, /缺失列在页面 DOM 中没有数据/);
assert.match(feature, /所有商品行已采集/);
assert.match(feature, /const delayedRiskMessage = grassProductRiskMessage\(\)/);
assert.match(feature, /beforeClick\.fingerprint !== page\.fingerprint/);
assert.match(feature, /findGrassProductPagination\(tableRoot\)/);
assert.doesNotMatch(feature, /\bfetch\s*\(/);
assert.doesNotMatch(feature, /XMLHttpRequest/);
assert.doesNotMatch(feature, /chrome\.webRequest/);
assert.doesNotMatch(feature, /cookie|authorization|requestBody/i);

const sandbox = {};
vm.runInNewContext([
  extractFunction('normalizeGrassProductText'),
  extractFunction('grassProductCells'),
  extractFunction('readGrassProductCell'),
  extractFunction('readGrassProductSelectedFieldCount'),
  extractFunction('grassProductPageSignature'),
  extractFunction('grassProductPageHasExpectedRows'),
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
}), /仍在加载/);

assert.equal(sandbox.protectGrassProductCsvValue('=2+2'), "'=2+2");
assert.equal(sandbox.protectGrassProductCsvValue('+cmd'), "'+cmd");
assert.equal(sandbox.protectGrassProductCsvValue('@SUM(A1:A2)'), "'@SUM(A1:A2)");
assert.equal(sandbox.protectGrassProductCsvValue(' \t=2+2'), "' \t=2+2");
assert.equal(sandbox.protectGrassProductCsvValue('-12.50'), '-12.50');
assert.equal(sandbox.grassProductCsvCell('1234567890123', true), '"\'1234567890123"');
assert.equal(sandbox.grassProductCsvCell('a"b', false), '"a""b"');
assert.equal(sandbox.grassProductCsvCell('a,b', false), '"a,b"');

console.log('sycm grass product DOM-only collection guards passed');
