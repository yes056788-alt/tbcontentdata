const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'diagnosis-popup.js'), 'utf8');
const start = source.indexOf('  function asNumber(value)');
const end = source.indexOf('\n\n  function divide', start);
assert.ok(start >= 0 && end > start, 'expected asNumber in diagnosis-popup.js');

const context = vm.createContext({});
vm.runInContext(
  source.slice(start, end) + '\nglobalThis.asNumber = asNumber;',
  context
);

assert.equal(context.asNumber(143793), 143793);
assert.equal(context.asNumber('143,793'), 143793);
assert.equal(context.asNumber('143,793人'), 143793);
assert.equal(context.asNumber('12.3万'), 123000);
assert.equal(context.asNumber('1.2亿'), 120000000);
assert.equal(context.asNumber('12.5%'), 0.125);
assert.equal(context.asNumber('计算中'), null);
assert.equal(context.asNumber('暂无'), null);
assert.equal(context.asNumber('万'), null);

console.log('dmp crowd size format guards passed');
