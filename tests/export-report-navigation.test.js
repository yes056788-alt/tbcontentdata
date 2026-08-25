const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const reportSource = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'report.js'), 'utf8');
const scriptStart = reportSource.indexOf('const exportScriptBody = [');
const scriptAssignStart = reportSource.indexOf('const script = \'<script nonce="', scriptStart);
assert.ok(scriptStart >= 0, 'expected export script body');
assert.ok(scriptAssignStart >= 0, 'expected export script wrapper');
const scriptTagEnd = reportSource.indexOf(';', scriptAssignStart);
assert.ok(scriptTagEnd >= 0, 'expected script assignment terminator');
const runtimeStart = reportSource.indexOf('function xhsInteractiveExportRuntime() {');
const runtimeEnd = reportSource.indexOf('\n  function buildExportReportDocument(metadata) {', runtimeStart);
assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'expected standalone XHS export runtime');
const runtimeSource = reportSource.slice(runtimeStart, runtimeEnd);
const scriptSourceSnippet = reportSource.slice(scriptStart, scriptTagEnd + 1);
const context = { exportScriptNonce: 'taobao-report-export-v1', __script: '' };
vm.runInNewContext(runtimeSource + '\n' + scriptSourceSnippet + ';__script = script;', context);
const scriptTag = context.__script;
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
  const keys = ['flow', 'guanghe', 'wxt', 'shortVideo', 'dmp', 'adstar', 'pgy', 'juguang'];
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
  assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, false, true, true, true, true, true]);
  assert.deepEqual(
    tabs.map((tab) => tab.classList.contains('active')),
    [false, false, true, false, false, false, false, false],
  );
  assert.deepEqual(
    tabs.map((tab) => tab.getAttribute('aria-selected')),
    ['false', 'false', 'true', 'false', 'false', 'false', 'false', 'false'],
  );
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0, -1, -1, -1, -1, -1]);

  let prevented = false;
  tabs[2].listeners.get('keydown')({
    key: 'End',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(panels.map((panel) => panel.hidden), [true, true, true, true, true, true, true, false]);
  assert.equal(tabs[7].focused, true);
  assert.equal(tabs[7].scrolled, true);

  views[1].listeners.get('click')();
  assert.deepEqual(viewPanels.map((panel) => panel.hidden), [true, false]);
  assert.deepEqual(views.map((view) => view.getAttribute('aria-selected')), ['false', 'true']);
  assert.deepEqual(views.map((view) => view.tabIndex), [-1, 0]);
  assert.equal(documentListeners.has('change'), true);
});

test('查看更多按钮精确控制对应表格并可再次收起', () => {
  const rowsByTable = {
    'export-table-flow-1': [{ hidden: true }, { hidden: true }],
    'export-table-flow-2': [{ hidden: true }, { hidden: true }],
  };
  const tables = Object.fromEntries(Object.entries(rowsByTable).map(([id, rows]) => [id, {
    id,
    querySelectorAll(selector) {
      if (selector === '[data-export-table-overflow]') return rows;
      return [];
    },
  }]));
  function tableButton(tableId) {
    const attributes = new Map([
      ['aria-controls', tableId],
      ['aria-expanded', 'false'],
    ]);
    return {
      textContent: '查看更多',
      addEventListener(type, listener) {
        if (type === 'click') this.listener = listener;
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
  }
  const buttons = [tableButton('export-table-flow-1'), tableButton('export-table-flow-2')];
  const document = {
    querySelectorAll(selector) {
      if (selector === '.export-table-more') return buttons;
      return [];
    },
    getElementById(id) {
      return tables[id] || null;
    },
    addEventListener() {},
  };
  vm.runInNewContext(scriptSource, { document, Array });

  buttons[1].listener();
  assert.equal(rowsByTable['export-table-flow-1'].every((row) => row.hidden), true);
  assert.equal(rowsByTable['export-table-flow-2'].every((row) => !row.hidden), true);
  assert.equal(buttons[1].textContent, '收起');
  assert.equal(buttons[1].getAttribute('aria-expanded'), 'true');

  buttons[1].listener();
  assert.equal(rowsByTable['export-table-flow-2'].every((row) => row.hidden), true);
  assert.equal(buttons[1].textContent, '查看更多');
  assert.equal(buttons[1].getAttribute('aria-expanded'), 'false');
});

test('导出的蒲公英和星河披露按钮可离线展开并再次收起', () => {
  function disclosureButton(targetId, label) {
    const attributes = new Map([
      ['aria-controls', targetId],
      ['aria-expanded', 'false'],
    ]);
    return {
      firstChild: { nodeType: 3, nodeValue: label },
      listeners: new Map(),
      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
  }
  const pgyTarget = { hidden: true };
  const starTarget = { hidden: true };
  const pgyButton = disclosureButton('xhsPgyNoteAnalysis', '笔记分析 ');
  const starButton = disclosureButton('xhsStarProjectReport', '查看更多');
  const targets = {
    xhsPgyNoteAnalysis: pgyTarget,
    xhsStarProjectReport: starTarget,
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-xhs-pgy-note-toggle]') return [pgyButton];
      if (selector === '[data-xhs-star-toggle]') return [starButton];
      return [];
    },
    getElementById(id) {
      return targets[id] || null;
    },
    addEventListener() {},
  };

  vm.runInNewContext(scriptSource, { document, Array });
  assert.equal(pgyTarget.hidden, true);
  assert.equal(starTarget.hidden, true);

  pgyButton.listeners.get('click')();
  starButton.listeners.get('click')();
  assert.equal(pgyTarget.hidden, false);
  assert.equal(starTarget.hidden, false);
  assert.equal(pgyButton.getAttribute('aria-expanded'), 'true');
  assert.equal(starButton.getAttribute('aria-expanded'), 'true');
  assert.equal(starButton.firstChild.nodeValue, '收起报表');

  pgyButton.listeners.get('click')();
  starButton.listeners.get('click')();
  assert.equal(pgyTarget.hidden, true);
  assert.equal(starTarget.hidden, true);
  assert.equal(starButton.firstChild.nodeValue, '查看更多');
});

test('导出初始化不得用不完整任务行覆盖星河任务汇总', () => {
  const summaryMetric = { textContent: '¥999' };
  const controls = ['project', 'task'].map((kind) => ({
    value: '',
    options: [],
    selectedOptions: [],
    disabled: false,
    listeners: new Map(),
    getAttribute(name) {
      return name === 'data-xhs-star-filter' ? kind : '';
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
  }));
  const rows = [
    {
      hidden: false,
      getAttribute(name) {
        if (name === 'data-xhs-star-values') {
          return JSON.stringify({ costs: { total: 100 }, metrics: {} });
        }
        if (name === 'data-xhs-star-project-id') return 'project-a';
        if (name === 'data-xhs-star-task') return 'task-a';
        return '';
      },
    },
    {
      hidden: false,
      getAttribute(name) {
        if (name === 'data-xhs-star-values') {
          return JSON.stringify({ costs: { total: null }, metrics: {} });
        }
        if (name === 'data-xhs-star-project-id') return 'project-b';
        if (name === 'data-xhs-star-task') return 'task-b';
        return '';
      },
    },
  ];
  const taskRoot = {
    querySelectorAll(selector) {
      return selector === '[data-xhs-star-task][data-xhs-star-values]' ? rows : [];
    },
    querySelector() {
      return null;
    },
  };
  const snapshotNode = {
    textContent: JSON.stringify({
      schema: 'xhsInteractiveExportV1',
      pgy: {},
      spotlight: {},
      star: { filters: { projectId: '', taskId: '' } },
      notes: {},
    }),
  };
  const document = {
    querySelector(selector) {
      if (selector === '#xhs-export-snapshot') return snapshotNode;
      if (selector === '[data-xhs-star-summary-kind="task"]') return taskRoot;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-xhs-star-filter]') return controls;
      if (selector === '[data-xhs-export-metric="star.task.costs.total"]') return [summaryMetric];
      if (selector === '[data-xhs-export-metric^="star.task."]') return [summaryMetric];
      return [];
    },
  };

  vm.runInNewContext(
    runtimeSource + '\n;xhsInteractiveExportRuntime();',
    { document, window: { XhsReportModel: {} }, Array, Set },
  );

  assert.equal(summaryMetric.textContent, '¥999',
    '无筛选时必须保留归档中的任务汇总，不能被一条缺失明细改写为未知');

  controls[1].value = 'task-a';
  controls[1].listeners.get('change')();
  assert.equal(summaryMetric.textContent, '¥100', '选择单个任务后应按筛选后的任务明细重算');

  controls[1].value = '';
  controls[1].listeners.get('change')();
  assert.equal(summaryMetric.textContent, '¥999', '清空筛选后应恢复归档中的完整任务汇总');
});

test('导出表格构建默认只展示十行并建立可访问的精确关联', () => {
  const helperStart = reportSource.indexOf('function applyExportTableLimits(markup, options) {');
  const helperEnd = reportSource.indexOf('\n  function buildExportReportDocument(metadata) {', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'expected export table limit helper');
  const helperSource = reportSource.slice(helperStart, helperEnd);
  const rows = Array.from({ length: 12 }, () => ({
    hidden: false,
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  }));
  const appended = [];
  const parent = {
    appendChild(node) {
      appended.push(node);
    },
  };
  const table = {
    id: '',
    classList: { contains: () => false },
    tBodies: [{ rows }],
    closest(selector) {
      return selector === '.report-table-block' ? parent : null;
    },
    parentElement: parent,
  };
  const template = {
    content: {
      querySelectorAll(selector) {
        return selector === 'table' ? [table] : [];
      },
    },
    innerHTML: '',
  };
  const document = {
    createElement(tagName) {
      if (tagName === 'template') return template;
      if (tagName === 'button') {
        const attributes = new Map();
        return {
          setAttribute(name, value) {
            attributes.set(name, value);
          },
          getAttribute(name) {
            return attributes.get(name);
          },
        };
      }
      throw new Error('unexpected tag: ' + tagName);
    },
  };
  const context = { document, Array, Object, Number, String, Math, __result: null };
  vm.runInNewContext(helperSource + ';__result = applyExportTableLimits("<table></table>", { tableIdPrefix: "flow" });', context);

  assert.equal(rows.slice(0, 10).every((row) => !row.hidden), true);
  assert.equal(rows.slice(10).every((row) => row.hidden), true);
  assert.equal(rows.slice(10).every((row) => row.attributes.has('data-export-table-overflow')), true);
  assert.equal(table.id, 'export-table-flow-1');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].textContent, '查看更多');
  assert.equal(appended[0].getAttribute('aria-controls'), table.id);
  assert.equal(appended[0].getAttribute('aria-expanded'), 'false');
});

test('短视频导出移除操作建议且不会使用无效的相对选择器', () => {
  const helperStart = reportSource.indexOf('function stripShortVideoExportActions(root) {');
  const helperEnd = reportSource.indexOf('\n  function buildExportReportDocument(metadata) {', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'expected short-video export helper');
  const helperSource = reportSource.slice(helperStart, helperEnd);
  const removed = [];
  const makeSection = (className, headingText, legacyAction = false) => ({
    className,
    remove() {
      removed.push(this);
    },
    querySelector(selector) {
      assert.doesNotMatch(selector, /^\s*>/, 'selector must be valid in querySelector');
      if (selector === '.wxt-section-heading h2, .wxt-section-heading h3, h2, h3') {
        return headingText ? { textContent: headingText } : null;
      }
      if (selector === '.wxt-priority-actions') return legacyAction ? {} : null;
      if (selector === '.wxt-priority-actions, .wxt-low-sample-actions') return legacyAction ? {} : null;
      return null;
    },
  });
  const explicitAction = makeSection('wxt-chart-section wxt-action-section', '操作建议');
  const legacyAction = makeSection('legacy-section', '操作建议');
  const evidence = makeSection('wxt-evidence-section', '数据证据');
  const root = {
    querySelectorAll(selector) {
      if (selector === 'section.wxt-action-section') return [explicitAction];
      if (selector === 'section') return [legacyAction, evidence];
      return [];
    },
  };
  vm.runInNewContext(helperSource + ';stripShortVideoExportActions(root);', {
    root,
    Array,
    Boolean,
    String,
  });

  assert.deepEqual(removed, [explicitAction, legacyAction]);
  assert.equal(removed.includes(evidence), false);
});
