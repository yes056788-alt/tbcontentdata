const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const reportSource = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'report.js'), 'utf8');
const scriptMatch = reportSource.match(
  /const script = ('<script nonce="' \+ exportScriptNonce \+ '">[^\n]+?<\\\/script>');\n    const storeName/,
);

assert.ok(scriptMatch, 'expected a self-contained export interaction script');
const scriptTag = vm.runInNewContext(scriptMatch[1], { exportScriptNonce: 'taobao-report-export-v1' });
const scriptSource = scriptTag.slice(scriptTag.indexOf('>') + 1, -'</script>'.length);

function fakeElement(dataset, active = false) {
  const listeners = new Map();
  const classes = new Set(active ? ['active'] : []);
  const attributes = new Map([['aria-selected', String(active)]]);
  return {
    dataset,
    hidden: false,
    tabIndex: active ? 0 : -1,
    focused: false,
    scrolled: false,
    listeners,
    classList: {
      contains(name) {
        return classes.has(name);
      },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    focus() {
      this.focused = true;
    },
    scrollIntoView() {
      this.scrolled = true;
    },
  };
}

test('exported report switches one visible module at a time', () => {
  const keys = ['flow', 'guanghe', 'wxt', 'shortVideo', 'dmp'];
  const tabs = keys.map((key, index) => fakeElement({ exportSection: key }, index === 0));
  const panels = keys.map((key, index) => {
    const panel = fakeElement({ exportPanel: key });
    panel.hidden = index !== 0;
    return panel;
  });
  const views = [
    fakeElement({ exportGuangheView: 'channel' }, true),
    fakeElement({ exportGuangheView: 'asset' }),
  ];
  const viewPanels = ['channel', 'asset'].map((key, index) => {
    const panel = fakeElement({ exportGuanghePanel: key });
    panel.hidden = index !== 0;
    return panel;
  });
  const documentListeners = new Map();
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-export-section]') return tabs;
      if (selector === '[data-export-panel]') return panels;
      if (selector === '[data-export-guanghe-view]') return views;
      if (selector === '[data-export-guanghe-panel]') return viewPanels;
      return [];
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };

  vm.runInNewContext(scriptSource, { document, Array });

  tabs[2].listeners.get('click')();
  assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false, true, true]);
  assert.deepEqual(tabs.map((tab) => tab.classList.contains('active')), [false, false, true, false, false]);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0, -1, -1]);

  let prevented = false;
  tabs[2].listeners.get('keydown')({
    key: 'End',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, true, true, false]);
  assert.equal(tabs[4].focused, true);
  assert.equal(tabs[4].scrolled, true);

  views[1].listeners.get('click')();
  assert.deepEqual(viewPanels.map((panel) => panel.hidden), [true, false]);
  assert.deepEqual(views.map((view) => view.getAttribute('aria-selected')), ['false', 'true']);
  assert.deepEqual(views.map((view) => view.tabIndex), [-1, 0]);
  assert.equal(documentListeners.has('change'), true);
});
