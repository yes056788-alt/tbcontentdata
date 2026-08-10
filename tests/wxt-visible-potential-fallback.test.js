const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

const recoveryStart = background.indexOf('async function recoverBusinessDefenseWxtPotentialRatio');
const recoveryEnd = background.indexOf('async function runBusinessDefenseWxt()', recoveryStart);
const recoveryFlow = background.slice(recoveryStart, recoveryEnd);
const collectorStart = recoveryEnd;
const collectorEnd = background.indexOf('async function runBusinessDefenseDmp(', collectorStart);
const collectorFlow = background.slice(collectorStart, collectorEnd);

assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
assert.match(background, /async function readWxtVisiblePotentialRatio/);
assert.match(background, /target: \{ tabId, allFrames: true \}/);
assert.match(background, /const directRatio = inlineRatio\(label\)/);
assert.match(background, /item\.result !== null && item\.result !== undefined/);
assert.match(background, /#!\/report\/short_video_migrate/);
assert.match(recoveryFlow, /readWxtVisiblePotentialRatio\(tabId\)/);
assert.match(recoveryFlow, /wxtBusinessDefenseReportV1/);
assert.match(recoveryFlow, /displayPotentialRatioSource: 'shortVideoPageSummary'/);
assert.match(recoveryFlow, /potentialRatioSource: '万相台短视频页面顶部汇总'/);
assert.match(collectorFlow, /recoverBusinessDefenseWxtPotentialRatio\(tabId, response\)/);
assert.doesNotMatch(recoveryFlow, /download|export|diagnosis/i);

console.log('wxt visible potential fallback guards passed');
