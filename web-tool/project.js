(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const UNGROUPED_ID = '__ungrouped__';
  const pendingRequests = new Map();
  const expandedGroups = new Set();
  const viewerOverrides = { report: '', data: '' };
  const viewerTokens = { report: 0, data: 0 };
  const $ = (selector) => document.querySelector(selector);
  let directory = { schema: 1, storeGroups: [], stores: [] };
  let runs = [];
  let selectedStoreId = '';
  let activeView = 'report';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function request(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('数据助手响应超时，请重新加载扩展。'));
      }, Number(timeoutMs) || 30000);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({ channel: CHANNEL, type: 'request', requestId, action, payload: payload || {} }, location.origin);
    });
  }

  function setNotice(message, tone) {
    $('#pageNotice').textContent = message || '';
    $('#pageNotice').dataset.tone = tone || '';
  }

  function setConnection(connected, version) {
    const state = $('#connectionState');
    state.className = 'connection-state ' + (connected ? 'connected' : 'disconnected');
    state.textContent = connected ? '数据助手已连接' : '数据助手未连接';
    $('#extensionVersion').textContent = version ? 'v' + version : '';
  }

  function cleanDirectory(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      schema: 1,
      storeGroups: (Array.isArray(source.storeGroups) ? source.storeGroups : []).filter((item) => item && item.id && item.name),
      stores: (Array.isArray(source.stores) ? source.stores : []).filter((item) => item && item.id && item.name),
      updatedAt: Number(source.updatedAt) || Date.now(),
    };
  }

  function legacyStoreId(name) {
    let hash = 2166136261;
    for (const character of String(name || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return 'history-store-' + (hash >>> 0).toString(36);
  }

  function mergeHistoryStores(sourceDirectory, historyRuns) {
    const output = cleanDirectory(sourceDirectory);
    const groupIds = new Set(output.storeGroups.map((group) => group.id));
    const storeIds = new Set(output.stores.map((store) => store.id));
    const storeNames = new Set(output.stores.map((store) => store.name));
    historyRuns.forEach((run) => {
      if (!run || !run.storeName) return;
      const groupId = String(run.storeGroupId || '');
      if (groupId && !groupIds.has(groupId)) {
        output.storeGroups.push({ id: groupId, name: run.storeGroupName || '历史分组' });
        groupIds.add(groupId);
      }
      if ((run.storeId && storeIds.has(run.storeId)) || storeNames.has(run.storeName)) return;
      const id = run.storeId || legacyStoreId(run.storeName);
      output.stores.push({ id, name: run.storeName, groupId: groupIds.has(groupId) ? groupId : '' });
      storeIds.add(id);
      storeNames.add(run.storeName);
    });
    return output;
  }

  function groupName(groupId) {
    const group = directory.storeGroups.find((item) => item.id === groupId);
    return group ? group.name : '未分组';
  }

  function storeById(storeId) {
    return directory.stores.find((store) => store.id === storeId) || null;
  }

  function runsForStore(store) {
    if (!store) return [];
    return runs.filter((run) => (
      (run.storeId && run.storeId === store.id) || String(run.storeName || '') === store.name
    )).sort((left, right) => Number(right.finishedAt) - Number(left.finishedAt));
  }

  function formatDate(value) {
    const date = new Date(Number(value) || value);
    if (!Number.isFinite(date.getTime())) return '-';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date).replace(/\//g, '-');
  }

  function statusInfo(value) {
    if (value === 'success') return ['success', '成功'];
    if (value === 'partial') return ['partial', '部分成功'];
    return ['failed', '失败'];
  }

  function taskTypeInfo(value) {
    if (value === 'collect') return ['经营取数', true, false];
    if (value === 'report') return ['诊断报告', false, true];
    return ['取数 + 报告', true, true];
  }

  function projectGroups() {
    const groups = directory.storeGroups.map((group) => ({
      id: group.id,
      name: group.name,
      stores: directory.stores.filter((store) => store.groupId === group.id),
    }));
    const ungrouped = directory.stores.filter((store) => !store.groupId || !directory.storeGroups.some((group) => group.id === store.groupId));
    if (ungrouped.length) groups.push({ id: UNGROUPED_ID, name: '未分组', stores: ungrouped });
    return groups;
  }

  function groupIdForStore(store) {
    return store && directory.storeGroups.some((group) => group.id === store.groupId)
      ? store.groupId
      : UNGROUPED_ID;
  }

  function renderTree() {
    const groups = projectGroups();
    $('#projectTreeEmpty').hidden = directory.stores.length > 0;
    $('#projectTree').hidden = directory.stores.length === 0;
    $('#projectTree').innerHTML = groups.map((group) => {
      const expanded = expandedGroups.has(group.id);
      return '<section class="project-tree-group' + (expanded ? ' expanded' : '') + '">' +
        '<button class="project-group-button" type="button" data-project-group="' + escapeHtml(group.id) + '" aria-expanded="' + expanded + '">' +
        '<i class="tree-chevron" aria-hidden="true"></i><span>' + escapeHtml(group.name) + '</span><b>' + group.stores.length + '</b></button>' +
        '<div class="project-store-list"' + (expanded ? '' : ' hidden') + '>' + group.stores.map((store) => (
          '<button class="project-store-button' + (store.id === selectedStoreId ? ' active' : '') + '" type="button" data-project-store="' + escapeHtml(store.id) + '">' +
          '<span>' + escapeHtml(store.name) + '</span><small>' + runsForStore(store).length + '</small></button>'
        )).join('') + '</div></section>';
    }).join('');
  }

  function latestRunForView(store, view) {
    const override = viewerOverrides[view];
    const storeRuns = runsForView(store, view);
    if (override) {
      const exact = storeRuns.find((run) => run.runId === override);
      if (exact) return exact;
    }
    return storeRuns[0] || null;
  }

  function runsForView(store, view) {
    return runsForStore(store).filter((run) => {
      const type = taskTypeInfo(run.taskType);
      return view === 'report' ? type[2] : type[1];
    });
  }

  function renderHistoryPicker(store, view, selectedRun) {
    const picker = $('#projectHistoryPicker');
    const select = $('#projectRunSelect');
    if (!store || !['report', 'data'].includes(view)) {
      picker.hidden = true;
      return;
    }
    const viewRuns = runsForView(store, view);
    picker.hidden = false;
    select.disabled = viewRuns.length === 0;
    select.innerHTML = viewRuns.length ? viewRuns.map((run) => {
      const status = statusInfo(run.status)[1];
      const account = run.accountName || run.usernameMasked || '当前账号';
      return '<option value="' + escapeHtml(run.runId) + '">' +
        escapeHtml(formatDate(run.finishedAt) + ' · ' + account + ' · ' + status) + '</option>';
    }).join('') : '<option value="">暂无可选记录</option>';
    if (selectedRun) select.value = selectedRun.runId;
  }

  function setViewerState(view, title, copy) {
    const state = view === 'report' ? $('#projectReportState') : $('#projectDataState');
    const frame = view === 'report' ? $('#projectReportFrame') : $('#projectDataFrame');
    frame.hidden = true;
    $('#projectExportBtn').disabled = true;
    state.hidden = false;
    state.innerHTML = '<strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(copy || '') + '</p>';
  }

  async function loadViewer(view) {
    const store = storeById(selectedStoreId);
    if (!store || !['report', 'data'].includes(view)) return;
    const token = ++viewerTokens[view];
    const run = latestRunForView(store, view);
    const frame = view === 'report' ? $('#projectReportFrame') : $('#projectDataFrame');
    const state = view === 'report' ? $('#projectReportState') : $('#projectDataState');
    const noun = view === 'report' ? '诊断报告' : '数据表格';
    renderHistoryPicker(store, view, run);
    if (!run) {
      $('#projectViewMeta').textContent = '暂无' + noun;
      setViewerState(view, '该店铺暂无' + noun, view === 'report' ? '可从右上角生成第一份诊断报告。' : '可从右上角启动经营取数。');
      return;
    }
    $('#projectViewMeta').textContent = noun + ' · ' + formatDate(run.finishedAt);
    setViewerState(view, '正在载入' + noun, run.accountName || run.usernameMasked || '当前账号');
    try {
      await request('restoreStoreRun', { runId: run.runId }, 45000);
      if (token !== viewerTokens[view] || selectedStoreId !== store.id || activeView !== view) return;
      frame.onload = () => {
        if (token !== viewerTokens[view]) return;
        state.hidden = true;
        frame.hidden = false;
        $('#projectExportBtn').disabled = false;
      };
      frame.src = (view === 'report' ? '/report-view.html' : '/data.html') +
        '?embed=1&archive=' + encodeURIComponent(run.runId) + '&loaded=' + Date.now();
    } catch (error) {
      if (token !== viewerTokens[view]) return;
      setViewerState(view, noun + '载入失败', error.message);
    }
  }

  function runActions(run) {
    const type = taskTypeInfo(run.taskType);
    let actions = '';
    if (type[1]) actions += '<button class="row-action" type="button" data-run-action="data" data-run-id="' + escapeHtml(run.runId) + '">查看数据</button>';
    if (type[2]) actions += '<button class="row-action" type="button" data-run-action="report" data-run-id="' + escapeHtml(run.runId) + '">打开报告</button>';
    actions += '<button class="row-action danger" type="button" data-run-action="delete" data-run-id="' + escapeHtml(run.runId) + '">删除</button>';
    return '<div class="row-actions">' + actions + '</div>';
  }

  function renderHistory(storeRuns) {
    $('#storeHistoryCount').textContent = storeRuns.length + ' 条';
    $('#projectRunRows').innerHTML = storeRuns.length ? storeRuns.map((run) => {
      const type = taskTypeInfo(run.taskType);
      const status = statusInfo(run.status);
      const mode = run.runMode === 'current' ? '当前登录账号' : '批量账号库';
      return '<tr><td><strong>' + type[0] + '</strong></td><td>' + mode + '</td>' +
        '<td>' + escapeHtml(run.accountName || run.usernameMasked || '-') + '</td><td>' + escapeHtml(formatDate(run.finishedAt)) + '</td>' +
        '<td><span class="status-badge ' + status[0] + '">' + status[1] + '</span></td><td>' + (Number(run.failureCount) || 0) + '</td>' +
        '<td>' + runActions(run) + '</td></tr>';
    }).join('') : '<tr><td class="empty-cell" colspan="7">该店铺暂无历史任务</td></tr>';
  }

  function renderActiveView() {
    document.querySelectorAll('[data-project-view]').forEach((button) => {
      const active = button.dataset.projectView === activeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-project-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.projectPanel !== activeView;
    });
    if (activeView === 'history') {
      renderHistoryPicker(null, activeView, null);
      $('#projectViewMeta').textContent = runsForStore(storeById(selectedStoreId)).length + ' 条归档';
      $('#projectExportBtn').hidden = true;
      return;
    }
    $('#projectExportBtn').hidden = false;
    $('#projectExportBtn').disabled = true;
    $('#projectExportBtn').textContent = activeView === 'report' ? '导出诊断报告' : '导出数据表格';
    loadViewer(activeView);
  }

  function exportActiveView() {
    if (!['report', 'data'].includes(activeView)) return;
    const frame = activeView === 'report' ? $('#projectReportFrame') : $('#projectDataFrame');
    const exportId = activeView === 'report' ? 'exportReportBtn' : 'exportBtn';
    const exportButton = frame.contentDocument && frame.contentDocument.getElementById(exportId);
    if (!exportButton || exportButton.disabled) {
      throw new Error(activeView === 'report' ? '当前诊断报告尚未载入完成。' : '当前数据表格尚未载入完成。');
    }
    exportButton.click();
  }

  function renderProject() {
    const store = storeById(selectedStoreId);
    $('#projectEmpty').hidden = Boolean(store);
    $('#projectDashboard').hidden = !store;
    if (!store) return;
    const storeRuns = runsForStore(store);
    $('#selectedStoreGroup').textContent = groupName(store.groupId);
    $('#selectedStoreName').textContent = store.name;
    $('#selectedStoreCopy').textContent = storeRuns.length ? '已归档 ' + storeRuns.length + ' 条运行记录' : '暂无运行记录';
    $('#storeCollectLink').href = '/collect.html?store=' + encodeURIComponent(store.id);
    $('#storeReportLink').href = '/report.html?store=' + encodeURIComponent(store.id);
    renderHistory(storeRuns);
    renderActiveView();
  }

  function selectStore(storeId) {
    const store = storeById(storeId);
    if (!store) return;
    selectedStoreId = store.id;
    activeView = 'report';
    viewerOverrides.report = '';
    viewerOverrides.data = '';
    expandedGroups.add(groupIdForStore(store));
    const url = new URL(location.href);
    url.searchParams.set('store', store.id);
    history.replaceState(null, '', url);
    renderTree();
    renderProject();
  }

  async function handleRunAction(button) {
    const runId = button.dataset.runId;
    const action = button.dataset.runAction;
    if (action === 'data' || action === 'report') {
      viewerOverrides[action] = runId;
      activeView = action;
      renderActiveView();
      return;
    }
    if (!window.confirm('删除这条历史记录？删除后无法恢复。')) return;
    await request('deleteStoreRun', { runId });
    runs = runs.filter((run) => run.runId !== runId);
    if (viewerOverrides.report === runId) viewerOverrides.report = '';
    if (viewerOverrides.data === runId) viewerOverrides.data = '';
    setNotice('历史记录已删除。', 'success');
    renderTree();
    renderProject();
  }

  async function loadProject() {
    const stored = await request('getStorage', { keys: [DIRECTORY_KEY, RUN_INDEX_KEY] }, 30000);
    runs = Array.isArray(stored && stored[RUN_INDEX_KEY]) ? stored[RUN_INDEX_KEY] : [];
    const original = cleanDirectory(stored && stored[DIRECTORY_KEY]);
    directory = mergeHistoryStores(original, runs);
    if (JSON.stringify(original) !== JSON.stringify(directory)) {
      request('setProjectDirectory', { directory }).catch(() => {});
    }
    const requestedStore = new URLSearchParams(location.search).get('store');
    if (requestedStore && storeById(requestedStore)) selectedStoreId = requestedStore;
    if (selectedStoreId && !storeById(selectedStoreId)) selectedStoreId = '';
    if (selectedStoreId) expandedGroups.add(groupIdForStore(storeById(selectedStoreId)));
    renderTree();
    renderProject();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === 'response' && pendingRequests.has(message.requestId)) {
      const pending = pendingRequests.get(message.requestId);
      pendingRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.message || '数据助手请求失败。'));
      return;
    }
    if (message.type === 'ready') setConnection(true, message.version);
    if (message.type === 'storageChanged' && (message.keys || []).some((key) => [DIRECTORY_KEY, RUN_INDEX_KEY].includes(key))) {
      loadProject().catch((error) => setNotice(error.message, 'error'));
    }
  });

  $('#projectTree').addEventListener('click', (event) => {
    const groupButton = event.target.closest('[data-project-group]');
    if (groupButton) {
      const groupId = groupButton.dataset.projectGroup;
      if (expandedGroups.has(groupId)) expandedGroups.delete(groupId);
      else expandedGroups.add(groupId);
      renderTree();
      return;
    }
    const storeButton = event.target.closest('[data-project-store]');
    if (storeButton) selectStore(storeButton.dataset.projectStore);
  });

  document.querySelectorAll('[data-project-view]').forEach((button) => {
    button.addEventListener('click', () => {
      activeView = button.dataset.projectView;
      renderActiveView();
    });
  });

  $('#projectRunRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-run-action]');
    if (!button) return;
    handleRunAction(button).catch((error) => setNotice(error.message, 'error'));
  });

  $('#projectExportBtn').addEventListener('click', () => {
    try {
      exportActiveView();
    } catch (error) {
      setNotice(error.message, 'error');
    }
  });

  $('#projectRunSelect').addEventListener('change', (event) => {
    if (!['report', 'data'].includes(activeView)) return;
    viewerOverrides[activeView] = event.currentTarget.value;
    loadViewer(activeView);
  });

  Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
    .catch(() => null)
    .then(() => request('ping', {}, 5000))
    .then((response) => {
      setConnection(Boolean(response && response.connected), response && response.version);
      return loadProject();
    }).catch(() => {
      setConnection(false, '');
      setNotice('未连接数据助手，请在 Chrome 扩展管理页重新加载扩展。', 'error');
    });
})();
