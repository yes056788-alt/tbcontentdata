const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'sycm-content-script.js'), 'utf8');

const ensureStoreBlock = content.match(
  /async function ensureStoreVisitorMetrics\(\) \{([\s\S]*?)\n  \}\n\n  function readProductVisitorsFromMetricCards/
);

assert.ok(ensureStoreBlock, 'expected ensureStoreVisitorMetrics implementation');
assert.match(content, /function readThirtyDayMetricCard\(labels\)/);
assert.match(content, /!hasThirtyDayComparison\(text\)/);
assert.match(content, /normalized\.includes\('较前30日'\)/);
assert.match(content, /normalized\.includes\('较前30天'\)/);
assert.match(ensureStoreBlock[1], /readThirtyDayStoreSummaryMetric\(summaryCard\)/);
assert.match(ensureStoreBlock[1], /readThirtyDayMetricCard\(\['短视频访客数'\]\)/);
assert.doesNotMatch(ensureStoreBlock[1], /readMetric\(\['短视频访客数'\]\)/);
assert.match(ensureStoreBlock[1], /dateContext\.dateMode !== 'last30'/);
assert.match(ensureStoreBlock[1], /stableMatches >= 3/);

console.log('sycm 30-day metric guards passed');
