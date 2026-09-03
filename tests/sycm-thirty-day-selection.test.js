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

test('30-day mode survives the current div/tab date-control markup', () => {
  assert.match(
    content,
    /const TRAFFIC_DATE_CONTROL_SELECTOR = [\s\S]*\[role="tab"\][\s\S]*div/,
    'traffic presets must include the div/tab controls used by the current SYCM toolbar'
  );
  const targetBlock = content.match(
    /function findTrafficThirtyDayTarget\(\) \{([\s\S]*?)\n  \}\n\n  async function waitForTrafficThirtyDayTarget/
  );
  assert.ok(targetBlock, 'expected thirty-day target finder');
  assert.match(
    targetBlock[1],
    /compactTextClickTarget\(element\)/,
    'the visible label must be promoted to its actual clickable container'
  );
});

test('a div label is promoted to its clickable tab container', () => {
  const tab = {
    parentElement: null,
    className: 'next-tabs-tab',
    innerText: '30天',
    textContent: '30天',
    contains: (element) => element === tab || element === label,
    closest: () => tab,
    matches: (selector) => selector.includes('[role="tab"]'),
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 72, height: 32 }),
  };
  const label = {
    parentElement: tab,
    innerText: '30天',
    textContent: '30天',
    closest: () => tab,
    matches: () => false,
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 42, height: 24 }),
  };
  const body = {
    querySelectorAll: () => [label],
    contains: () => true,
  };
  const sandbox = {
    document: { body },
    TRAFFIC_DATE_CONTROL_SELECTOR: 'button, [role="tab"], div',
    findTrafficDateToolbar: () => null,
    isVisible: () => true,
    normalizeText: (value) => String(value || '').replace(/\s+/g, '').replace(/[：:]/g, '').trim(),
    getElementText: (element) => String(element && element.innerText || '').replace(/\s+/g, ''),
    closestClickTarget: (element) => element && element.closest(),
  };
  vm.runInNewContext([
    extractFunction('dateModeFromLabel'),
    extractFunction('compactTextClickTarget'),
    extractFunction('findTrafficThirtyDayTarget'),
  ].join('\n'), sandbox);
  assert.equal(sandbox.findTrafficThirtyDayTarget(), tab);
});

test('a canonical 30-day URL range is an authoritative last30 fallback', () => {
  const sandbox = {};
  vm.runInNewContext(extractFunction('dateModeFromDateRange'), sandbox);
  assert.equal(sandbox.dateModeFromDateRange('2026-08-05|2026-09-03'), 'last30');
  assert.equal(sandbox.dateModeFromDateRange('2026-08-28|2026-09-03'), 'last7');
  assert.equal(sandbox.dateModeFromDateRange('2026-09-03|2026-09-03'), 'day');
  assert.equal(sandbox.dateModeFromDateRange(''), '');
  assert.match(
    content,
    /const detectedDateMode = isTrafficPage\(\) \? detectTrafficDateMode\(\) : '';[\s\S]*dateMode:[\s\S]*detectedDateMode \|\| dateModeFromDateRange\(dateRange\)/,
    'traffic context must fall back to the URL range when active styling is not exposed'
  );
});
