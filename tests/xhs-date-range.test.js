const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const from = source.indexOf('function normalizePlatformTaskIds');
const to = source.indexOf('\nasync function waitTabComplete', from);
assert.ok(from >= 0 && to > from, 'background date-range helpers must remain extractable');

const context = vm.createContext({
  PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp'],
  REPORT_PLATFORM_TASK_IDS: ['sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang'],
  PLATFORM_RETRY_ATTEMPTS: 1,
  setTimeout,
});
vm.runInContext(
  source.slice(from, to) + '\nglobalThis.normalizeRangeForTest = normalizeXhsDateRange;',
  context,
);

test('XHS date range accepts real calendar dates including leap day', () => {
  assert.deepEqual(
    { ...context.normalizeRangeForTest({ from: '2032-02-29', to: '2032-03-01' }, true) },
    { from: '2032-02-29', to: '2032-03-01', timezone: 'Asia/Shanghai' },
  );
});

test('XHS date range rejects impossible calendar dates instead of normalizing them', () => {
  for (const invalid of [
    { from: '2031-02-29', to: '2031-03-01' },
    { from: '2032-02-30', to: '2032-03-01' },
    { from: '2032-04-31', to: '2032-05-01' },
    { from: '2032-00-01', to: '2032-01-01' },
  ]) {
    assert.throws(
      () => context.normalizeRangeForTest(invalid, true),
      /有效的小红书开始和结束日期/,
    );
  }
});
