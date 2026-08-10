const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const content = fs.readFileSync(path.join(__dirname, '..', 'wxt-report-content.js'), 'utf8');
const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

assert.match(content, /requestReportData\(dateRange, 'marketingScene', \{ silent: true \}\)/);
assert.match(content, /capturedMetrics/);
assert.match(content, /missingMetrics/);
assert.match(content, /saveBusinessDefenseWxtSnapshot\(data, 'marketingScene'\)/);
assert.doesNotMatch(content, /万相台接口已返回，但缺少.*missing\.join/);
assert.match(background, /已取：.*capturedMetrics/);
assert.match(background, /待补：.*missingMetrics/);

console.log('wxt partial save guards passed');
