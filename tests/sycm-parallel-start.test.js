const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'sycm-content-script.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

assert.match(content, /async function waitForTrafficThirtyDayTarget/);
assert.match(content, /await waitForTrafficThirtyDayTarget\(20000\)/);
assert.match(background, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
assert.match(background, /30天\|日期工具条\|日期未完成切换\|页面稳定/);

console.log('sycm parallel start guards passed');
