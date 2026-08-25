const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function createReportHarness() {
  const source = read('web-tool/report.js');
  const sideEffectsStart = source.indexOf('  window.TaobaoReportExport = Object.freeze({');
  assert.ok(sideEffectsStart > 0, 'report side-effect marker');
  const instrumented = source.slice(0, sideEffectsStart) + `
  window.__xhsStarReportV3Test = Object.freeze({
    buildXhsProjectTree,
    buildXhsProjectSummary,
    buildXhsTaskSummary,
    buildXhsNotesTable,
    setState(value) {
      xhsAnalysis = value && typeof value === 'object' ? value : null;
    },
    setNoteState(filters, expanded) {
      xhsNoteFilters = Object.assign({ projectId: '', taskId: '', spuName: '', from: '', to: '' }, filters || {});
      xhsNoteExpanded = expanded === true;
    },
    getNoteState() {
      return { filters: { ...xhsNoteFilters }, expanded: xhsNoteExpanded };
    },
    buildStarMarkup() {
      return buildXhsMarkup({ platform: 'adstar' });
    },
  });
})();`;
  const windowObject = {
    XhsReportModel: null,
    addEventListener() {},
    clearTimeout,
    postMessage() {},
    setTimeout,
  };
  windowObject.self = windowObject;
  windowObject.top = windowObject;
  const document = {
    documentElement: { classList: { add() {} } },
    getElementById() { return null; },
  };
  vm.runInNewContext(instrumented, {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    location: { origin: 'http://127.0.0.1:3400', search: '?builder=1' },
    setTimeout,
    structuredClone,
    window: windowObject,
  }, { filename: 'web-tool/report.js' });
  return windowObject.__xhsStarReportV3Test;
}

function task(id, projectId, overrides) {
  return Object.assign({
    id,
    projectId,
    name: `虚构任务 ${id}`,
    status: 'complete',
    orderStatus: 'complete',
    startDate: '2030-01-01',
    endDate: '2030-01-31',
    deliveryMode: '虚构投放模式',
    businessIdentityVerified: true,
    metrics: {
      readUv: 222,
      searchImpressionUv: 333,
      storeVisitUv: 20,
      visitRate: 0.09,
      gmv: 444,
      seededProductGmv: 111,
    },
    costs: { creator: 110, adInTask: 30, total: 140 },
    notes: [{
      noteId: 'fictional-nested-note',
      title: '不应出现在项目任务汇总中的笔记',
      publishDate: '2030-01-05',
      metrics: { readUv: 10, storeVisitUv: 2 },
      costs: { creator: 11, adInTask: 3, total: 14 },
    }],
  }, overrides || {});
}

function starHierarchy() {
  const existingTask = task('fictional-order-1', 'fictional-project-1');
  return {
    projects: [{
      id: 'fictional-project-1',
      name: '虚构星河项目',
      status: 'complete',
      startDate: '2030-01-01',
      endDate: '2030-01-31',
      metrics: {
        readUv: 111,
        searchImpressionUv: 123,
        storeVisitUv: 10,
        visitRate: 0.09,
        gmv: 555,
        seededProductGmv: 222,
      },
      costs: { creator: 110, adInTask: 30, total: 140 },
      orders: [existingTask],
    }],
    orders: [existingTask],
    unassignedNotes: [{
      noteId: 'fictional-unassigned-note',
      title: '不应出现在星河汇总区的待归属笔记',
      publishDate: '2030-01-08',
      candidateOrderIds: [],
      costs: { creator: null, adInTask: null, total: null },
    }],
  };
}

function explorerNote(id, options) {
  const input = options && typeof options === 'object' ? options : {};
  const periodCreator = Object.prototype.hasOwnProperty.call(input, 'periodCreator')
    ? input.periodCreator : Number(input.rank || 0);
  const creatorTotal = Object.prototype.hasOwnProperty.call(input, 'creatorTotal')
    ? input.creatorTotal : periodCreator;
  const juguangTotal = Object.prototype.hasOwnProperty.call(input, 'juguangTotal')
    ? input.juguangTotal : 0;
  const juguangInTask = Object.prototype.hasOwnProperty.call(input, 'juguangInTask')
    ? input.juguangInTask : 0;
  const juguangOutsideTask = Object.prototype.hasOwnProperty.call(input, 'juguangOutsideTask')
    ? input.juguangOutsideTask : Math.max(0, Number(juguangTotal) - Number(juguangInTask));
  return {
    noteId: id,
    title: input.title || `虚构笔记 ${id}`,
    publishDate: Object.prototype.hasOwnProperty.call(input, 'publishDate')
      ? input.publishDate : '2030-01-15',
    task: {
      projectIds: input.projectIds || ['fictional-project-1'],
      orderIds: input.taskIds || ['fictional-order-1'],
    },
    pgy: {
      includedInPeriod: input.includedInPeriod !== false,
      spuName: input.spuName || '虚构 SPU A',
      metrics: { impressions: 100, reads: 50, interactions: 10 },
    },
    star: {
      metrics: {
        readUv: 100,
        storeVisitUv: Object.prototype.hasOwnProperty.call(input, 'storeVisitUv')
          ? input.storeVisitUv : 10,
      },
    },
    costs: {
      creatorTotal,
      periodCreator,
      juguang: juguangTotal,
      // Deliberately wrong legacy totals prove that V3 uses the approved facts/formulas.
      total: 9999,
      periodTotal: 8888,
      starTaskAligned: 7777,
    },
    juguang: {
      total: { spend: juguangTotal },
      inTask: { spend: juguangInTask },
      taskStatuses: [
        { key: 'in_task', spend: juguangInTask },
        { key: 'out_of_task', spend: juguangOutsideTask },
      ],
    },
    results: { starTaskGmv: 100, starTaskRoi: 1 },
  };
}

function noteExplorerAnalysis() {
  const notes = [explorerNote('fictional-note-formula', {
    title: '费用公式笔记',
    publishDate: '2030-01-05',
    projectIds: ['fictional-project-1'],
    taskIds: ['fictional-order-1'],
    periodCreator: 110,
    juguangTotal: 90,
    juguangInTask: 30,
    juguangOutsideTask: 60,
    storeVisitUv: 20,
  })];
  for (let rank = 1; rank <= 20; rank += 1) {
    notes.push(explorerNote(`fictional-note-${String(rank).padStart(2, '0')}`, {
      rank,
      publishDate: rank === 1 ? '2030-01-10' : '2030-01-15',
      projectIds: rank <= 10 ? ['fictional-project-1'] : ['fictional-project-2'],
      taskIds: rank <= 10 ? ['fictional-order-1'] : ['fictional-order-2'],
    }));
  }
  notes.push(explorerNote('fictional-note-unknown', {
    title: '旧归档未知费用笔记',
    publishDate: null,
    projectIds: [],
    taskIds: [],
    periodCreator: null,
    juguangTotal: null,
    juguangInTask: null,
    juguangOutsideTask: null,
    storeVisitUv: 0,
  }));
  return {
    star: starHierarchy(),
    notes,
  };
}

function noteRows(markup) {
  return [...String(markup).matchAll(/<tr\b[^>]*data-xhs-note-id=["']([^"']+)["'][^>]*>[\s\S]*?<\/tr>/g)]
    .map((match) => ({ id: match[1], html: match[0] }));
}

function firstTableBody(markup) {
  const match = String(markup).match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(match, 'missing table body');
  return match[1];
}

test('Star project area renders existing orders as summary-only tasks and never nests notes', () => {
  const harness = createReportHarness();
  const markup = harness.buildXhsProjectTree(starHierarchy());

  assert.match(markup, /data-xhs-star-project=["']fictional-project-1["']/);
  assert.match(markup, /data-xhs-star-task=["']fictional-order-1["']/,
    '任务必须直接对应现有 Star order，不另造身份');
  assert.match(markup, /虚构星河项目[\s\S]*虚构任务 fictional-order-1/);
  assert.match(markup, /阅读UV[\s\S]*111[\s\S]*阅读UV[\s\S]*222/,
    '项目与任务各自的原生 summary 必须保留');
  assert.match(markup, /2030-01-01 至 2030-01-31/);
  assert.doesNotMatch(markup, /data-xhs-star-note=|fictional-nested-note|fictional-unassigned-note/,
    '项目/任务汇总区不得再渲染任何笔记节点');
  assert.doesNotMatch(markup, />[^<]*订单[^<]*</,
    '新 UI 中业务 order 统一称为“任务”');
});

test('Star project analysis removes the unavailable project-period column while task periods remain', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  hierarchy.projects[0].startDate = '2030-02-01';
  hierarchy.projects[0].endDate = '2030-02-28';
  hierarchy.orders.push(task('fictional-top-level-task', '', {
    projectId: null,
    status: 'partial',
    orderStatus: 'partial',
    startDate: '2030-03-01',
    endDate: '2030-03-31',
  }));
  const projectMarkup = harness.buildXhsProjectSummary(hierarchy, {}, false);
  const taskMarkup = harness.buildXhsTaskSummary(hierarchy, {}, false);

  assert.doesNotMatch(projectMarkup, /项目周期|2030-02-01 至 2030-02-28/);
  assert.match(taskMarkup, /fictional-top-level-task[\s\S]*部分完成[\s\S]*2030-03-01 至 2030-03-31/,
    'top-level task summary must retain status and period');
});

test('Star project and task analyses filter by the selected project and task without nesting task rows in project data', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  const secondTask = task('fictional-order-2', 'fictional-project-2');
  hierarchy.projects.push({
    id: 'fictional-project-2', name: '第二个星河项目', status: 'complete',
    metrics: { readUv: 88, searchImpressionUv: 99, storeVisitUv: 8, visitRate: 0.1, gmv: 666 },
    costs: { creator: 50, adInTask: 10, total: 60 }, orders: [secondTask],
  });
  hierarchy.orders.push(secondTask);

  const projectMarkup = harness.buildXhsProjectSummary(hierarchy, {
    projectId: '', taskId: 'fictional-order-2',
  }, false);
  const taskMarkup = harness.buildXhsTaskSummary(hierarchy, {
    projectId: 'fictional-project-2', taskId: 'fictional-order-2',
  }, false);

  assert.match(projectMarkup, /第二个星河项目/);
  assert.doesNotMatch(projectMarkup, /data-xhs-star-project="fictional-project-1"/);
  assert.doesNotMatch(projectMarkup, /data-xhs-star-task=/,
    '项目分析只保留项目级汇总行，不嵌入任务明细');
  assert.match(taskMarkup, /虚构任务 fictional-order-2/);
  assert.doesNotMatch(taskMarkup, /虚构任务 fictional-order-1/);
  assert.match(projectMarkup, /data-xhs-star-filter="project"/);
  assert.match(projectMarkup, /data-xhs-star-filter="task"/);
});

test('Star project costs come from its task totals and project/task tables recalculate total-row rates and costs', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  hierarchy.projects[0].costs = { creator: 9000, adInTask: 9000, total: 18000 };
  const second = task('fictional-order-2', 'fictional-project-1', {
    metrics: {
      readUv: 78,
      searchImpressionUv: 50,
      storeVisitUv: 10,
      visitRate: 0.99,
      gmv: 300,
      seededProductGmv: 60,
    },
    costs: { creator: 40, adInTask: 20, total: 60 },
  });
  hierarchy.projects[0].orders.push(second);
  hierarchy.orders.push(second);
  const unverifiedReportTask = task('project_report:fictional-project-1:report-only', 'fictional-project-1', {
    businessIdentityVerified: false,
    reportOrderId: 'fictional-report-order-only',
    metrics: { readUv: null, searchImpressionUv: null, storeVisitUv: null },
    costs: { creator: null, adInTask: null, total: null },
  });
  hierarchy.projects[0].orders.push(unverifiedReportTask);
  hierarchy.orders.push(unverifiedReportTask);

  const projectMarkup = harness.buildXhsProjectSummary(hierarchy, {}, false);
  const taskMarkup = harness.buildXhsTaskSummary(hierarchy, {}, false);
  assert.doesNotMatch(projectMarkup, /¥18,000|¥9,000/);
  assert.match(projectMarkup, /虚构星河项目[\s\S]*¥200/,
    'project cost must equal 140 + 60 from its tasks');
  assert.match(projectMarkup, /虚构星河项目[\s\S]*?<\/td><td>2<\/td>/,
    'report-only identities must not inflate the verified business-task count');
  assert.doesNotMatch(taskMarkup, /project_report:fictional-project-1:report-only|fictional-report-order-only/,
    '未验证的项目报表订单与真实订单重复，不得出现在任务报表');
  for (const markup of [projectMarkup, taskMarkup]) {
    assert.match(markup, /<tr class="xhs-total-row"/);
    assert.match(markup, /进店成本/);
    assert.match(markup, /ROI/);
  }
  assert.match(taskMarkup, /筛选后汇总[\s\S]*¥200[\s\S]*30[\s\S]*10\.00%[\s\S]*¥6\.67/,
    'task total row must recompute 30\/300 visit rate and 200\/30 visit cost');
});

test('Star project spend sums collected task costs even when other verified tasks have no cost', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  const missingCostTask = task('fictional-order-missing-cost', 'fictional-project-1', {
    costs: { creator: null, adInTask: null, total: null },
  });
  hierarchy.projects[0].orders.push(missingCostTask);
  hierarchy.orders.push(missingCostTask);
  const unknownProjectTask = task('fictional-order-project-2', 'fictional-project-2', {
    costs: { creator: null, adInTask: null, total: null },
  });
  hierarchy.projects.push({
    id: 'fictional-project-2',
    name: '全部成本未知项目',
    status: 'complete',
    metrics: {
      readUv: 88, searchImpressionUv: 99, storeVisitUv: 8,
      cartUv: 2, orderUv: 1, gmv: 666, seededProductGmv: 100,
    },
    orders: [unknownProjectTask],
  });
  hierarchy.orders.push(unknownProjectTask);

  const markup = harness.buildXhsProjectSummary(hierarchy, {}, false, true);

  assert.match(markup, /项目数[\s\S]*2[\s\S]*花费[\s\S]*¥140[\s\S]*进店成本[\s\S]*¥7\.78/,
    '项目汇总应累计已采集任务花费，并以项目汇总进店 UV 重算成本');
  assert.match(markup, /虚构星河项目[\s\S]*?<td>2<\/td><td>¥140<\/td><td>¥110<\/td><td>¥30<\/td>/,
    '项目行花费应等于该项目下已采集任务花费之和');
  assert.match(markup, /全部成本未知项目[\s\S]*?<td>1<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/,
    '没有任何已采集任务花费的项目仍应保持未知，不能制造零成本');
});

test('Star project aggregate sums available native project metrics without null-poisoning the whole summary', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  const noMetricTask = task('fictional-order-no-project-metrics', 'fictional-project-2', {
    metrics: {
      readUv: null, searchImpressionUv: null, storeVisitUv: null,
      cartUv: null, orderUv: null, gmv: null, seededProductGmv: null,
    },
    costs: { creator: null, adInTask: null, total: null },
  });
  hierarchy.projects.push({
    id: 'fictional-project-2',
    name: '原生指标未返回项目',
    status: 'complete',
    metrics: {
      readUv: null, searchImpressionUv: null, storeVisitUv: null,
      cartUv: null, orderUv: null, gmv: null, seededProductGmv: null,
    },
    orders: [noMetricTask],
  });
  hierarchy.orders.push(noMetricTask);

  const markup = harness.buildXhsProjectSummary(hierarchy, {}, false, true);

  assert.match(markup, /项目数[\s\S]*2[\s\S]*阅读UV[\s\S]*111[\s\S]*进店UV[\s\S]*10/,
    '一个项目缺少原生指标时，汇总仍应累计其他项目已返回的原生量值');
  assert.match(markup, /全店GMV[\s\S]*¥555[\s\S]*种草商品GMV[\s\S]*¥222/,
    'GMV 汇总不得被无数据项目整体置空');
  assert.match(markup, /进店成本[\s\S]*¥14(?:\.00)?/,
    '项目汇总成本值必须使用已汇总花费和进店 UV 重新计算');
});

test('Star whole-store summary exposes the complete funnel and three ROI definitions', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  analysis.runId = 'fictional-star-store-metrics';
  analysis.star.store = {
    costs: { total: 200, creator: 150, adInTask: 50 },
    metrics: {
      readUv: 1000, searchImpressionUv: 500, storeVisitUv: 40,
      visitRate: 0.04, cartUv: 12, orderUv: 8, gmv: 1000, seededProductGmv: 300,
    },
    storeRoi: 5,
  };
  analysis.star.taskSummary = { activeNoteCount: 2, costs: { total: 200 }, gmv: 300, roi: 1.5 };
  harness.setState(analysis);
  const markup = harness.buildStarMarkup();

  for (const label of [
    '花费', '阅读UV', '进店UV', '进店率', '进店成本', '加购率', '转化率', '成交UV',
    '全店GMV', '种草商品GMV', '种草成交占比', '全店ROI', '任务ROI', '投流ROI',
  ]) {
    assert.ok(markup.includes(label), `missing Star whole-store metric: ${label}`);
  }
  assert.match(markup, /加购率[\s\S]*30\.00%/);
  assert.match(markup, /转化率[\s\S]*20\.00%/);
  assert.match(markup, /种草商品GMV[\s\S]*¥300/);
  assert.match(markup, /种草成交占比[\s\S]*30\.00%/);
  assert.match(markup, /全店ROI[\s\S]*5\.00/);
  assert.match(markup, /任务ROI[\s\S]*1\.50/);
  assert.match(markup, /投流ROI[\s\S]*20\.00/);
});

test('Star page removes the duplicated account investment block but keeps it in whole-store summary', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  analysis.runId = 'fictional-star-deduplicated-investment';
  harness.setState(analysis);
  const markup = harness.buildStarMarkup();
  const accountStart = markup.indexOf('data-xhs-panel="account-overview"');
  const starStart = markup.indexOf('data-xhs-panel="star-analysis"');
  const accountMarkup = markup.slice(accountStart, starStart);

  assert.ok(accountStart >= 0 && starStart > accountStart, 'missing account or Star panel');
  assert.doesNotMatch(accountMarkup, /总投入|广告花费拆分/,
    '账户数据质量区不得重复展示全店投入和广告拆分');
  assert.equal((markup.match(/广告花费拆分/g) || []).length, 1,
    '投入与投放拆分只应在星河全店汇总中出现一次');
});

test('Star project and task default to summaries and reveal filterable reports via accessible show-more controls', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  analysis.runId = 'fictional-star-collapsed-details';
  harness.setState(analysis);
  const markup = harness.buildStarMarkup();

  assert.match(markup,
    /data-xhs-star-toggle="task"[^>]*aria-expanded="false"[^>]*aria-controls="xhsStarTaskReport"[^>]*>查看更多/);
  assert.match(markup, /id="xhsStarTaskReport" hidden/);
  assert.match(markup,
    /data-xhs-star-toggle="project"[^>]*aria-expanded="false"[^>]*aria-controls="xhsStarProjectReport"[^>]*>查看更多/);
  assert.match(markup, /id="xhsStarProjectReport" hidden/);
  assert.match(markup, /项目汇总[\s\S]*项目数[\s\S]*阅读UV[\s\S]*111[\s\S]*全店GMV[\s\S]*¥555/,
    '项目默认汇总必须展示项目原生的量值和 GMV，不能只显示缺失成本');

  const taskSummaryIndex = markup.indexOf('星河任务汇总');
  const taskReportIndex = markup.indexOf('id="xhsStarTaskReport"');
  const projectSummaryIndex = markup.indexOf('项目汇总');
  assert.ok(taskSummaryIndex >= 0 && taskReportIndex > taskSummaryIndex && projectSummaryIndex > taskReportIndex,
    '任务可筛选报表必须放在任务汇总下，并位于项目汇总之前');

  const source = read('web-tool/report.js');
  assert.match(source, /addEventListener\(["']click["'][\s\S]*data-xhs-star-toggle/,
    '项目和任务查看更多必须使用本地委托事件切换');
});

test('Star project, task and note tables place recalculated total rows before detail rows', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  const projectBody = firstTableBody(harness.buildXhsProjectSummary(analysis.star, {}, false, true));
  const taskBody = firstTableBody(harness.buildXhsTaskSummary(analysis.star, {}, false, true));
  const noteBody = firstTableBody(harness.buildXhsNotesTable(analysis, { expanded: true }));

  assert.ok(projectBody.indexOf('xhs-total-row') < projectBody.indexOf('data-xhs-star-project='));
  assert.ok(taskBody.indexOf('xhs-total-row') < taskBody.indexOf('data-xhs-star-task='));
  assert.ok(noteBody.indexOf('xhs-total-row') < noteBody.indexOf('data-xhs-note-id='));
});

test('Star project, task and note analyses share complete funnel fields and recompute totals', () => {
  const harness = createReportHarness();
  const hierarchy = starHierarchy();
  const secondTask = task('fictional-order-2', 'fictional-project-1', {
    metrics: {
      readUv: 78, searchImpressionUv: 77, storeVisitUv: 10,
      cartUv: 3, orderUv: 2, gmv: 300, seededProductGmv: 120,
    },
    costs: { creator: 40, adInTask: 20, total: 60 },
  });
  hierarchy.orders.push(secondTask);
  hierarchy.projects[0].orders.push(secondTask);
  hierarchy.orders[0].metrics = {
    readUv: 222, searchImpressionUv: 333, storeVisitUv: 20,
    cartUv: 7, orderUv: 4, gmv: 700, seededProductGmv: 180,
  };
  hierarchy.projects[0].metrics = {
    readUv: 300, searchImpressionUv: 410, storeVisitUv: 30,
    cartUv: 10, orderUv: 6, gmv: 1000, seededProductGmv: 300,
  };

  const projectMarkup = harness.buildXhsProjectSummary(hierarchy, {}, false);
  const taskMarkup = harness.buildXhsTaskSummary(hierarchy, {}, false);
  const analysis = noteExplorerAnalysis();
  analysis.notes = [analysis.notes[0]];
  analysis.notes[0].star.metrics = {
    readUv: 100, storeVisitUv: 20, cartUv: 8, orderUv: 5,
    gmv: 500, seededProductGmv: 200,
  };
  const noteMarkup = harness.buildXhsNotesTable(analysis, { expanded: true });

  for (const markup of [projectMarkup, taskMarkup, noteMarkup]) {
    for (const label of [
      '花费', '阅读UV', '进店UV', '进店率', '进店成本', '加购率', '转化率', '成交UV',
      '全店GMV', '种草商品GMV', '种草成交占比', '全店ROI', '任务ROI', '投流ROI',
    ]) assert.ok(markup.includes(label), `missing shared Star metric: ${label}`);
    assert.match(markup, /<tr class="xhs-total-row"/);
  }
  assert.match(taskMarkup, /筛选后汇总[\s\S]*10\.00%[\s\S]*¥6\.67[\s\S]*33\.33%[\s\S]*20\.00%/,
    'task totals must recompute visit, cost, cart and conversion rates from summed volumes');
});

test('note task filter excludes unverified report-only task identities that cannot match joined notes', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  analysis.star.orders.push(task('project_report:fictional-project-1:internal-key', 'fictional-project-1', {
    businessIdentityVerified: false,
    reportOrderId: 'fictional-report-order-7',
    name: '未验证报表任务',
  }));

  const markup = harness.buildXhsNotesTable(analysis, { expanded: true });
  assert.doesNotMatch(markup, /<option[^>]*value="project_report:fictional-project-1:internal-key"/);
  assert.doesNotMatch(markup, />未验证报表任务<\/option>/);
});

test('note explorer filters independently and in combination by project, task and inclusive publish dates', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();

  const projectRows = noteRows(harness.buildXhsNotesTable(analysis, {
    filters: { projectId: 'fictional-project-2' }, expanded: true,
  }));
  assert.equal(projectRows.length, 10);
  assert.ok(projectRows.every((row) => /data-xhs-note-project=["']fictional-project-2["']/.test(row.html)));

  const taskRows = noteRows(harness.buildXhsNotesTable(analysis, {
    filters: { taskId: 'fictional-order-2' }, expanded: true,
  }));
  assert.equal(taskRows.length, 10);
  assert.ok(taskRows.every((row) => /data-xhs-note-task=["']fictional-order-2["']/.test(row.html)));

  const dateRows = noteRows(harness.buildXhsNotesTable(analysis, {
    filters: { from: '2030-01-05', to: '2030-01-10' }, expanded: true,
  }));
  assert.deepEqual(dateRows.map((row) => row.id).sort(), [
    'fictional-note-01',
    'fictional-note-formula',
  ], '起止日均必须包含');

  const combinedRows = noteRows(harness.buildXhsNotesTable(analysis, {
    filters: {
      projectId: 'fictional-project-1',
      taskId: 'fictional-order-1',
      from: '2030-01-05',
      to: '2030-01-05',
    },
    expanded: true,
  }));
  assert.deepEqual(combinedRows.map((row) => row.id), ['fictional-note-formula']);
});

test('note explorer supports PGY spuName filtering and includes a totals row with recalculated cost and ROI', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  analysis.notes[0].pgy.spuName = '虚构 SPU B';
  const markup = harness.buildXhsNotesTable(analysis, {
    filters: { spuName: '虚构 SPU B' }, expanded: true,
  });
  const rows = noteRows(markup);

  assert.deepEqual(rows.map((row) => row.id), ['fictional-note-formula']);
  assert.match(markup, /data-xhs-note-filter="spu"/);
  assert.match(markup, /<tr class="xhs-total-row"[^>]*data-xhs-note-total/);
  assert.match(markup, /筛选后汇总[\s\S]*¥200[\s\S]*¥140[\s\S]*¥60[\s\S]*¥7/);
});

test('out-of-period notes keep their full creator spend in the note full-chain table', () => {
  const harness = createReportHarness();
  const note = explorerNote('fictional-note-outside-period', {
    includedInPeriod: false,
    periodCreator: 0,
    creatorTotal: 220,
    juguangTotal: 30,
    juguangInTask: 0,
    juguangOutsideTask: 30,
    storeVisitUv: 10,
  });
  const row = noteRows(harness.buildXhsNotesTable({ star: starHierarchy(), notes: [note] }, {
    expanded: true,
  }))[0];

  assert.match(row.html, /期外（达人费仍计入总花费）[\s\S]*¥220[\s\S]*¥30[\s\S]*¥250/);
});

test('note explorer uses approved cost formulas and preserves unknown instead of manufacturing zero', () => {
  const harness = createReportHarness();
  const markup = harness.buildXhsNotesTable(noteExplorerAnalysis(), { expanded: true });
  const rows = noteRows(markup);
  const formula = rows.find((row) => row.id === 'fictional-note-formula');
  const unknown = rows.find((row) => row.id === 'fictional-note-unknown');

  assert.ok(formula, '缺少费用公式笔记');
  assert.match(markup, /总花费/);
  assert.match(markup, /任务期内花费/);
  assert.match(markup, /任务期外花费/);
  assert.match(markup, /进店成本/);
  assert.match(formula.html, /¥200[\s\S]*¥140[\s\S]*¥60[\s\S]*¥7/,
    '费用应按“总花费、任务期内、任务期外、进店成本”展示为 200、140、60、7');
  assert.doesNotMatch(formula.html, /¥7,777|¥8,888|¥9,999/,
    '浏览器不得信任与批准公式冲突的旧汇总');

  assert.ok(unknown, '旧归档未知笔记不得消失');
  assert.ok((unknown.html.match(/—/g) || []).length >= 4,
    '四个费用结果的未知值必须分别显示—');
  assert.doesNotMatch(unknown.html, /¥0(?:\.00)?/,
    '零分母或缺失费用不得降级为¥0');
});

test('note explorer makes each note title a safe Xiaohongshu detail link', () => {
  const harness = createReportHarness();
  const note = explorerNote('fictional-note-link', { title: '可跳转笔记标题' });
  note.noteUrl = 'https://www.xiaohongshu.com/explore/fictional-note-link';
  const row = noteRows(harness.buildXhsNotesTable({ star: starHierarchy(), notes: [note] }, {
    expanded: true,
  }))[0];

  assert.match(row.html,
    /<a class="xhs-note-detail-link" href="https:\/\/www\.xiaohongshu\.com\/explore\/fictional-note-link" target="_blank" rel="noopener noreferrer">可跳转笔记标题<\/a>/);
});

test('note explorer respects partial source coverage instead of promoting observed buckets to complete costs', () => {
  const harness = createReportHarness();
  const note = explorerNote('fictional-note-partial', {
    title: '部分覆盖笔记',
    periodCreator: 110,
    juguangTotal: 90,
    juguangInTask: 30,
    juguangOutsideTask: 60,
    storeVisitUv: 20,
  });
  note.pgy.coverage = 'partial';
  note.juguang.coverage = 'partial';
  note.juguang.alignmentCoverage = 'partial';
  const row = noteRows(harness.buildXhsNotesTable({ star: starHierarchy(), notes: [note] }, {
    expanded: true,
  }))[0];

  assert.ok(row, 'missing partial-coverage note');
  assert.ok((row.html.match(/—/g) || []).length >= 4,
    'all approved cost results must stay unknown under partial source coverage');
  assert.doesNotMatch(row.html, /¥200|¥140|¥60|¥7(?:\.00)?/);
});

test('note explorer treats a complete aligned snapshot with no outside bucket as zero outside-task spend', () => {
  const harness = createReportHarness();
  const note = explorerNote('fictional-note-no-outside', {
    title: '无任务期外花费笔记',
    periodCreator: 110,
    juguangTotal: 30,
    juguangInTask: 30,
    juguangOutsideTask: 0,
    storeVisitUv: 20,
  });
  note.pgy.coverage = 'complete';
  note.juguang.coverage = 'complete';
  note.juguang.alignmentCoverage = 'complete';
  note.juguang.taskStatuses = [{ key: 'in_task', spend: 30 }];
  const row = noteRows(harness.buildXhsNotesTable({ star: starHierarchy(), notes: [note] }, {
    expanded: true,
  }))[0];

  assert.ok(row, 'missing complete no-outside note');
  assert.match(row.html, /¥140[\s\S]*¥140[\s\S]*¥0[\s\S]*¥7/);
});

test('note explorer defaults to total-spend Top20 and supports show-more and collapse states', () => {
  const harness = createReportHarness();
  const analysis = noteExplorerAnalysis();
  const collapsed = harness.buildXhsNotesTable(analysis);
  const collapsedRows = noteRows(collapsed);

  assert.equal(collapsedRows.length, 20, '默认只显示筛选结果中的 Top20');
  assert.equal(collapsedRows[0].id, 'fictional-note-formula', '默认按总花费降序');
  assert.equal(collapsedRows.some((row) => row.id === 'fictional-note-01'), false);
  assert.equal(collapsedRows.some((row) => row.id === 'fictional-note-unknown'), false,
    '未知总花费排在已知值之后');
  assert.match(collapsed, /显示\s*20\s*\/\s*22/);
  assert.match(collapsed, /data-xhs-note-toggle[\s\S]*aria-expanded=["']false["'][\s\S]*查看更多/);

  const expanded = harness.buildXhsNotesTable(analysis, { expanded: true });
  const expandedRows = noteRows(expanded);
  assert.equal(expandedRows.length, 22, '查看更多后展示全部筛选结果');
  assert.equal(expandedRows.at(-1).id, 'fictional-note-unknown');
  assert.match(expanded, /data-xhs-note-toggle[\s\S]*aria-expanded=["']true["'][\s\S]*收起/);
});

test('note explorer source exposes accessible native filters and delegated interaction hooks', () => {
  const source = read('web-tool/report.js');

  for (const filter of ['project', 'task']) {
    assert.match(source, new RegExp(`data-xhs-note-filter=["']${filter}["']`));
  }
  for (const boundary of ['from', 'to']) {
    assert.match(source, new RegExp(`data-xhs-note-date=["']${boundary}["']`));
  }
  assert.match(source, /<label[\s\S]*<select|<label[\s\S]*type=["']date["']/,
    '筛选控件必须有原生可访问名称');
  assert.match(source, /addEventListener\(["']change["'][\s\S]*data-xhs-note-(?:filter|date)/,
    '项目、任务、日期筛选必须通过本地 DOM 事件联动');
  assert.match(source, /addEventListener\(["']click["'][\s\S]*data-xhs-note-toggle/,
    '查看更多/收起必须使用本地事件委托，不发平台请求');
});

test('note explorer resets filters and Top20 expansion when switching analysis snapshots', () => {
  const harness = createReportHarness();
  const first = noteExplorerAnalysis();
  first.runId = 'fictional-note-run-a';
  first.generatedAt = '2030-01-20T00:00:00.000Z';
  harness.setState(first);
  harness.buildStarMarkup();
  harness.setNoteState({ projectId: 'fictional-project-2', taskId: 'fictional-order-2' }, true);

  const second = noteExplorerAnalysis();
  second.runId = 'fictional-note-run-b';
  second.generatedAt = '2030-01-21T00:00:00.000Z';
  harness.setState(second);
  harness.buildStarMarkup();

  assert.deepEqual(JSON.parse(JSON.stringify(harness.getNoteState())), {
    filters: { projectId: '', taskId: '', spuName: '', from: '', to: '' },
    expanded: false,
  });
});
