const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const taskSource = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'task.js'), 'utf8');
const listenerStart = taskSource.indexOf(
  "document.querySelectorAll('[data-platform-picker] input[type=\"checkbox\"]')",
);
const listenerEnd = taskSource.indexOf("\n  $('#startBatchTaskBtn')", listenerStart);

assert.ok(listenerStart >= 0 && listenerEnd > listenerStart, 'platform picker listener should remain extractable');

test('selecting a platform clears only the stale empty-platform error', () => {
  const listeners = {};
  const input = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const notice = { textContent: '请至少选择一个平台任务。', dataset: { tone: 'error' } };
  const context = vm.createContext({
    $: (selector) => selector === '#pageNotice' ? notice : null,
    activeMode: 'current',
    selectedPlatforms: () => ['adstar'],
    document: {
      querySelectorAll(selector) {
        return selector === '[data-platform-picker] input[type="checkbox"]' ? [input] : [];
      },
    },
    renderBatchControls() {},
    renderStatus() {},
    setNotice(message, tone) {
      notice.textContent = message || '';
      notice.dataset.tone = tone || '';
    },
  });

  vm.runInContext(taskSource.slice(listenerStart, listenerEnd), context, {
    filename: 'task-platform-picker-listener.js',
  });

  listeners.change();
  assert.equal(notice.textContent, '');
  assert.equal(notice.dataset.tone, '');

  notice.textContent = '数据助手未连接。';
  notice.dataset.tone = 'error';
  listeners.change();
  assert.equal(notice.textContent, '数据助手未连接。');
  assert.equal(notice.dataset.tone, 'error');

  context.selectedPlatforms = () => [];
  notice.textContent = '请至少选择一个平台任务。';
  notice.dataset.tone = 'error';
  listeners.change();
  assert.equal(notice.textContent, '请至少选择一个平台任务。');
  assert.equal(notice.dataset.tone, 'error');
});

test('XHS selection rejects a stale bridge with an actionable refresh message', () => {
  const helperStart = taskSource.indexOf('function validatePlatformCapabilities');
  const helperEnd = taskSource.indexOf('\n  function ', helperStart + 1);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'platform capability helper should remain extractable');

  const context = vm.createContext({ bridgeCapabilities: new Set() });
  vm.runInContext(
    taskSource.slice(helperStart, helperEnd) + '\nglobalThis.validate = validatePlatformCapabilities;',
    context,
    { filename: 'task-platform-capabilities.js' },
  );

  assert.throws(
    () => context.validate(['adstar', 'pgy', 'juguang']),
    /旧版数据助手.*刷新本页/,
  );
  assert.doesNotThrow(() => context.validate(['sycm']));

  context.bridgeCapabilities.add('xhsAnalysis');
  assert.doesNotThrow(() => context.validate(['adstar', 'pgy', 'juguang']));

  const currentTaskStart = taskSource.indexOf('async function startCurrentTask');
  const currentTaskEnd = taskSource.indexOf('\n  async function ', currentTaskStart + 1);
  assert.match(
    taskSource.slice(currentTaskStart, currentTaskEnd),
    /validatePlatformCapabilities\(platforms\)/,
  );
});
