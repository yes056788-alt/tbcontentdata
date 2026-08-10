(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
  const BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
  const taskType = document.body.dataset.taskType === 'report' ? 'report' : 'collect';
  const pendingRequests = new Map();
  const $ = (selector) => document.querySelector(selector);

  let connected = false;
  let directory = { storeGroups: [], stores: [] };
  let runs = [];
  let taskStatus = null;
  let accountSession = { unlocked: false, totalEnabledAccounts: 0, storeGroups: [], stores: [] };
  let batchStatus = null;
  let selectedStoreId = '';
  let activeMode = 'current';
  let refreshing = false;

  function selectedPlatforms(mode) {
    const picker = document.querySelector('[data-platform-picker="' + mode + '"]');
    return picker ? Array.from(picker.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value) : [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function request(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
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

  function setConnection(ok, version) {
    connected = Boolean(ok);
    const state = $('#connectionState');
    state.className = 'connection-state ' + (ok ? 'connected' : 'disconnected');
    state.textContent = ok ? '数据助手已连接' : '数据助手未连接';
    $('#extensionVersion').textContent = version ? 'v' + version : '';
    renderStatus();
  }

  function groupName(groupId) {
    const group = directory.storeGroups.find((item) => item.id === groupId);
    return group ? group.name : '未分组';
  }

  function storeById(storeId) {
    return directory.stores.find((store) => store.id === storeId) || null;
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

  function runMatchesType(run) {
    const type = run && run.taskType || 'both';
    return type === 'both' || type === taskType;
  }

  function mergeRunStores() {
    const storeNames = new Set(directory.stores.map((store) => store.name));
    runs.forEach((run) => {
      if (!run || !run.storeName || storeNames.has(run.storeName)) return;
      directory.stores.push({
        id: run.storeId || 'history-' + String(run.runId || Math.random()).replace(/[^a-z0-9-]/gi, '').slice(0, 60),
        name: run.storeName,
        groupId: run.storeGroupId || '',
      });
      if (run.storeGroupId && !directory.storeGroups.some((group) => group.id === run.storeGroupId)) {
        directory.storeGroups.push({ id: run.storeGroupId, name: run.storeGroupName || '历史分组' });
      }
      storeNames.add(run.storeName);
    });
  }

  function renderSelectors() {
    const requestedStoreId = new URLSearchParams(location.search).get('store');
    if (requestedStoreId && storeById(requestedStoreId)) selectedStoreId = requestedStoreId;
    const selected = storeById(selectedStoreId);
    const groupSelect = $('#taskGroupSelect');
    groupSelect.innerHTML = '<option value="__all__">全部店铺分组</option>' + directory.storeGroups.map((group) => (
      '<option value="' + escapeHtml(group.id) + '">' + escapeHtml(group.name) + '</option>'
    )).join('');
    groupSelect.value = selected && selected.groupId || '__all__';
    renderStoreOptions();
  }

  function renderStoreOptions() {
    const groupId = $('#taskGroupSelect').value;
    const stores = directory.stores.filter((store) => groupId === '__all__' || store.groupId === groupId);
    const select = $('#taskStoreSelect');
    select.innerHTML = '<option value="">请选择店铺</option>' + stores.map((store) => (
      '<option value="' + escapeHtml(store.id) + '">' + escapeHtml(store.name) + '</option>'
    )).join('');
    select.value = stores.some((store) => store.id === selectedStoreId) ? selectedStoreId : '';
    if (!select.value) selectedStoreId = '';
    renderStatus();
  }

  function normalizeAccountSessionSummary(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      unlocked: source.unlocked === true,
      unlockedAt: Number(source.unlockedAt) || 0,
      totalEnabledAccounts: Math.max(0, Number(source.totalEnabledAccounts) || 0),
      ungroupedAccountCount: Math.max(0, Number(source.ungroupedAccountCount) || 0),
      storeGroups: (Array.isArray(source.storeGroups) ? source.storeGroups : []).map((group) => ({
        id: String(group && group.id || ''),
        name: String(group && group.name || ''),
        enabledAccountCount: Math.max(0, Number(group && group.enabledAccountCount) || 0),
      })).filter((group) => group.id && group.name),
      stores: (Array.isArray(source.stores) ? source.stores : []).map((store) => ({
        id: String(store && store.id || ''),
        name: String(store && store.name || ''),
        groupId: String(store && store.groupId || ''),
        enabledAccountCount: Math.max(0, Number(store && store.enabledAccountCount) || 0),
      })).filter((store) => store.id && store.name),
    };
  }

  function selectedBatchAccountCount() {
    if (!accountSession.unlocked) return 0;
    const type = $('#batchScopeType').value;
    const id = $('#batchScopeSelect').value;
    if (type === 'store') {
      const store = accountSession.stores.find((item) => item.id === id);
      return store ? store.enabledAccountCount : 0;
    }
    if (id === '__all__') return accountSession.totalEnabledAccounts;
    if (id === '__ungrouped__') return accountSession.ungroupedAccountCount;
    const group = accountSession.storeGroups.find((item) => item.id === id);
    return group ? group.enabledAccountCount : 0;
  }

  function renderBatchScopeOptions() {
    const type = $('#batchScopeType').value;
    const select = $('#batchScopeSelect');
    const selected = select.value;
    let items = [];
    if (type === 'store') {
      $('#batchScopeLabel').textContent = '选择店铺';
      items = accountSession.stores.map((store) => ({
        id: store.id,
        name: store.name,
        count: store.enabledAccountCount,
      }));
    } else {
      $('#batchScopeLabel').textContent = '选择店铺分组';
      items = [{ id: '__all__', name: '全部启用店铺', count: accountSession.totalEnabledAccounts }]
        .concat(accountSession.storeGroups.map((group) => ({
          id: group.id,
          name: group.name,
          count: group.enabledAccountCount,
        })));
      if (accountSession.ungroupedAccountCount || accountSession.stores.some((store) => !store.groupId)) {
        items.push({ id: '__ungrouped__', name: '未分组店铺', count: accountSession.ungroupedAccountCount });
      }
    }
    select.innerHTML = items.length ? items.map((item) => (
      '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '（' + item.count + ' 个淘宝账号）</option>'
    )).join('') : '<option value="">暂无可执行店铺</option>';
    if (items.some((item) => item.id === selected)) select.value = selected;
    $('#batchScopeType').disabled = !accountSession.unlocked;
    select.disabled = !accountSession.unlocked || !items.length;
    renderBatchControls();
  }

  function renderBatchControls() {
    const accountCount = selectedBatchAccountCount();
    const platformCount = selectedPlatforms('batch').length;
    $('#batchAccountSummary').textContent = accountCount + ' 个';
    const status = batchStatus || {};
    const sameTask = status.taskType === taskType;
    const running = Boolean(status.running);
    const paused = Boolean(status.paused && sameTask);
    $('#startBatchTaskBtn').disabled = !connected || !accountSession.unlocked || !accountCount || !platformCount || running || paused;
    $('#resumeBatchTaskBtn').hidden = !paused;
    $('#resumeBatchTaskBtn').disabled = !connected || !accountSession.unlocked || !platformCount;
    $('#cancelBatchTaskBtn').disabled = !(status.running || status.paused);
  }

  function renderStatus() {
    const isReport = taskType === 'report';
    if (activeMode === 'batch') {
      const status = batchStatus || null;
      const sameTask = Boolean(status && (status.taskType === taskType || status.taskType === 'both'));
      const total = sameTask ? Number(status.total) || 0 : 0;
      const results = sameTask && Array.isArray(status.results) ? status.results : [];
      const completed = results.length;
      const issueResults = results.filter((item) => item && (item.ok === false || item.partial));
      const successCount = Math.max(0, completed - issueResults.length);
      const latestIssue = issueResults[issueResults.length - 1] || null;
      const running = Boolean(sameTask && status.running);
      const paused = Boolean(sameTask && status.paused);
      const progress = total ? Math.round(completed / total * 100) : 0;
      $('#taskStatusDescription').textContent = '批量账号库执行进度';
      $('#currentTaskProgress').classList.toggle('running', running);
      $('#currentTaskProgress').style.width = running ? '' : progress + '%';
      $('#currentTaskStore').textContent = sameTask
        ? (status.currentStoreName || status.selection && (status.selection.name || status.selection.groupName) || '批量任务')
        : '尚未启动';
      $('#currentTaskState').textContent = sameTask
        ? paused ? '等待验证码'
          : running ? completed + ' / ' + total
            : status.error ? '失败'
              : issueResults.length ? successCount + ' 成功 / ' + issueResults.length + ' 异常'
                : '已完成'
        : '等待开始';
      $('#currentTaskCopy').textContent = sameTask
        ? (status.pauseReason || status.error || (latestIssue
          ? (latestIssue.storeName || '账号') + '：' + (latestIssue.message || '任务未成功。')
          : status.phase || '批量任务状态已更新'))
        : (accountSession.unlocked ? '选择店铺分组或单个店铺后启动。' : '请先在账号库管理中解锁本次 Chrome 会话。');
      $('#currentTaskStartedAt').textContent = sameTask ? formatDate(status.startedAt) : '-';
      $('#currentTaskFinishedAt').textContent = sameTask && status.finishedAt ? formatDate(status.finishedAt) : '-';
      $('#openLatestTaskBtn').hidden = true;
      renderBatchControls();
      return;
    }

    const status = taskStatus && taskStatus.taskType === taskType ? taskStatus : null;
    const runningAnyTask = Boolean(taskStatus && taskStatus.running);
    const running = Boolean(status && status.running);
    $('#taskStatusDescription').textContent = isReport ? '当前登录账号的报告生成进度' : '当前登录账号执行进度';
    $('#startCurrentTaskBtn').disabled = !connected || !selectedStoreId || !selectedPlatforms('current').length || runningAnyTask;
    $('#currentTaskProgress').classList.toggle('running', running);
    $('#currentTaskProgress').style.width = running ? '' : (status && status.finishedAt ? '100%' : '0');
    $('#currentTaskStore').textContent = status && status.storeName || '尚未启动';
    $('#currentTaskState').textContent = status
      ? (running ? '执行中' : status.error || status.status === 'failed'
        ? '失败'
        : status.status === 'partial' ? '部分成功' : '已完成')
      : '等待开始';
    $('#currentTaskCopy').textContent = status
      ? (status.error || status.phase || '任务状态已更新')
      : (runningAnyTask ? '另一类当前账号任务正在执行。' : '选择店铺后启动任务。');
    $('#currentTaskStartedAt').textContent = status ? formatDate(status.startedAt) : '-';
    $('#currentTaskFinishedAt').textContent = status && status.finishedAt ? formatDate(status.finishedAt) : '-';
    $('#openLatestTaskBtn').hidden = !(status && status.archiveRunId && !running);
    $('#openLatestTaskBtn').dataset.runId = status && status.archiveRunId || '';
  }

  function renderLogs() {
    const values = runs.filter(runMatchesType).sort((left, right) => Number(right.finishedAt) - Number(left.finishedAt));
    $('#taskLogCount').textContent = values.length + ' 条';
    $('#taskRunRows').innerHTML = values.length ? values.map((run) => {
      const status = statusInfo(run.status);
      const mode = run.runMode === 'current' ? '当前登录账号' : '批量账号库';
      const actionLabel = taskType === 'report' ? '打开报告' : '查看数据';
      return '<tr><td><strong>' + escapeHtml(run.storeName || '-') + '</strong></td><td>' + mode + '</td>' +
        '<td>' + escapeHtml(run.accountName || run.usernameMasked || '-') + '</td><td>' + escapeHtml(formatDate(run.finishedAt)) + '</td>' +
        '<td><span class="status-badge ' + status[0] + '">' + status[1] + '</span></td><td>' + (Number(run.failureCount) || 0) + '</td>' +
        '<td><div class="row-actions"><button class="row-action" type="button" data-run-action="open" data-run-id="' + escapeHtml(run.runId) + '">' + actionLabel + '</button>' +
        '<button class="row-action danger" type="button" data-run-action="delete" data-run-id="' + escapeHtml(run.runId) + '">删除</button></div></td></tr>';
    }).join('') : '<tr><td class="empty-cell" colspan="7">暂无已归档的运行日志</td></tr>';
  }

  function renderBatchSession() {
    const notice = $('#batchSessionNotice');
    notice.classList.toggle('unlocked', accountSession.unlocked);
    notice.innerHTML = accountSession.unlocked
      ? '<div><strong>账号库会话已解锁</strong><p>本次 Chrome 会话可直接执行，共 ' + accountSession.totalEnabledAccounts + ' 个启用淘宝账号。</p></div><a href="/accounts.html">管理账号</a>'
      : '<div><strong>本次 Chrome 会话尚未解锁账号库</strong><p>进入账号库管理解锁一次，返回后即可直接选择店铺分组或单个店铺。</p></div><a href="/accounts.html">去解锁</a>';
    renderBatchScopeOptions();
  }

  async function refresh() {
    if (!connected || refreshing) return;
    refreshing = true;
    try {
      const [stored, sessionResponse] = await Promise.all([
        request('getStorage', { keys: [
          DIRECTORY_KEY, RUN_INDEX_KEY, TASK_STATUS_KEY, BATCH_STATUS_KEY,
        ] }, 30000),
        request('getAccountSessionSummary', {}, 10000).catch((error) => ({
          ok: false,
          message: error && error.message || '账号库会话状态读取失败。',
        })),
      ]);
      const source = stored && stored[DIRECTORY_KEY] || {};
      directory = {
        storeGroups: Array.isArray(source.storeGroups) ? source.storeGroups.slice() : [],
        stores: Array.isArray(source.stores) ? source.stores.slice() : [],
      };
      runs = Array.isArray(stored && stored[RUN_INDEX_KEY]) ? stored[RUN_INDEX_KEY] : [];
      taskStatus = stored && stored[TASK_STATUS_KEY] || null;
      batchStatus = stored && stored[BATCH_STATUS_KEY] || null;
      accountSession = normalizeAccountSessionSummary(
        sessionResponse && sessionResponse.ok !== false ? sessionResponse.summary : null
      );
      mergeRunStores();
      renderSelectors();
      renderLogs();
      renderBatchSession();
      renderStatus();
      if (sessionResponse && sessionResponse.ok === false) {
        setNotice('当前数据助手版本不支持账号库会话，请在扩展管理页重新加载扩展。', 'error');
      }
      if (!directory.stores.length) setNotice('还没有店铺项目，请先进入账号库管理新增账号。', 'error');
    } catch (error) {
      setNotice(error.message, 'error');
    } finally {
      refreshing = false;
    }
  }

  async function startBatch(resume) {
    if (!connected) throw new Error('数据助手未连接。');
    if (!accountSession.unlocked) throw new Error('请先在账号库管理中解锁一次，本次 Chrome 会话内无需重复解锁。');
    let accountCount = selectedBatchAccountCount();
    let selection = {
      type: $('#batchScopeType').value === 'store' ? 'store' : 'storeGroup',
      id: $('#batchScopeSelect').value,
    };
    let platforms = selectedPlatforms('batch');
    if (resume) {
      if (!batchStatus || !batchStatus.paused || batchStatus.taskType !== taskType) throw new Error('当前没有可继续的本类任务。');
      accountCount = Number(batchStatus.total) || (Array.isArray(batchStatus.accountIds) ? batchStatus.accountIds.length : 0);
      selection = batchStatus.selection || selection;
      platforms = Array.isArray(batchStatus.platforms) && batchStatus.platforms.length
        ? batchStatus.platforms.slice() : platforms;
    }
    if (!accountCount) throw new Error('当前选择没有可执行的启用淘宝账号。');
    if (!platforms.length) throw new Error('请至少选择一个平台任务。');
    const response = await request('startAccountBatchFromSession', {
      selection,
      resume: Boolean(resume),
      taskType,
      platforms,
    }, 45000);
    if (!response || response.ok === false) throw new Error(response && response.message || '批量任务启动失败。');
    setNotice(response.started === false ? '批量任务已在执行。' : '批量任务已启动。', 'success');
    setTimeout(refresh, 300);
  }

  async function startCurrentTask() {
    const store = storeById(selectedStoreId);
    if (!store) throw new Error('请先选择本次任务归属的店铺。');
    if (!connected) throw new Error('数据助手未连接。');
    const platforms = selectedPlatforms('current');
    if (!platforms.length) throw new Error('请至少选择一个平台任务。');
    const actionName = taskType === 'report' ? '生成诊断报告' : '经营取数';
    if (!window.confirm('使用当前 Chrome 已登录账号为“' + store.name + '”' + actionName + '？')) return;
    taskStatus = {
      taskType,
      runMode: 'current',
      storeId: store.id,
      storeName: store.name,
      running: true,
      startedAt: Date.now(),
      phase: '正在启动任务',
      platforms,
    };
    renderStatus();
    setNotice('任务已提交，后台页面会自动打开并执行。');
    const response = await request('startProjectTask', {
      taskType,
      platforms,
      store: { id: store.id, name: store.name, groupId: store.groupId || '', groupName: groupName(store.groupId) },
    }, 30000);
    if (!response || response.ok === false) throw new Error(response && response.message || '任务启动失败。');
    setTimeout(refresh, 350);
  }

  async function openRun(runId) {
    if (!runId) return;
    await request('restoreStoreRun', { runId }, 45000);
    location.href = taskType === 'report'
      ? '/report-view.html?archive=' + encodeURIComponent(runId)
      : '/data.html?archive=' + encodeURIComponent(runId);
  }

  async function handleRunAction(button) {
    const runId = button.dataset.runId;
    if (button.dataset.runAction === 'open') {
      await openRun(runId);
      return;
    }
    if (!window.confirm('删除这条运行日志和归档数据？')) return;
    await request('deleteStoreRun', { runId });
    runs = runs.filter((run) => run.runId !== runId);
    renderLogs();
    setNotice('运行日志已删除。', 'success');
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
    if (message.type === 'storageChanged' && (message.keys || []).some((key) => (
      [DIRECTORY_KEY, RUN_INDEX_KEY, TASK_STATUS_KEY, BATCH_STATUS_KEY].includes(key)
    ))) refresh();
  });

  document.querySelectorAll('[data-task-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      activeMode = button.dataset.taskMode;
      document.querySelectorAll('[data-task-mode]').forEach((item) => item.classList.toggle('active', item === button));
      $('#currentModePanel').hidden = activeMode !== 'current';
      $('#batchModePanel').hidden = activeMode !== 'batch';
      renderStatus();
      if (activeMode === 'batch') refresh();
    });
  });
  $('#taskGroupSelect').addEventListener('change', () => { selectedStoreId = ''; renderStoreOptions(); });
  $('#taskStoreSelect').addEventListener('change', (event) => { selectedStoreId = event.currentTarget.value; renderStatus(); });
  $('#startCurrentTaskBtn').addEventListener('click', () => {
    startCurrentTask().catch((error) => { setNotice(error.message, 'error'); refresh(); });
  });
  $('#batchScopeType').addEventListener('change', () => { renderBatchScopeOptions(); renderStatus(); });
  $('#batchScopeSelect').addEventListener('change', () => { renderBatchControls(); renderStatus(); });
  document.querySelectorAll('[data-platform-picker] input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      renderBatchControls();
      renderStatus();
    });
  });
  $('#startBatchTaskBtn').addEventListener('click', () => startBatch(false).catch((error) => setNotice(error.message, 'error')));
  $('#resumeBatchTaskBtn').addEventListener('click', () => startBatch(true).catch((error) => setNotice(error.message, 'error')));
  $('#cancelBatchTaskBtn').addEventListener('click', async () => {
    if (!window.confirm('取消批量任务？当前平台步骤结束后会停止。')) return;
    try {
      const response = await request('cancelAccountBatch');
      if (!response || response.ok === false) throw new Error(response && response.message || '取消失败。');
      setNotice('正在取消批量任务。');
      setTimeout(refresh, 300);
    } catch (error) { setNotice(error.message, 'error'); }
  });
  $('#openLatestTaskBtn').addEventListener('click', (event) => {
    openRun(event.currentTarget.dataset.runId).catch((error) => setNotice(error.message, 'error'));
  });
  $('#taskRunRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-run-action]');
    if (button) handleRunAction(button).catch((error) => setNotice(error.message, 'error'));
  });

  Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
    .catch(() => null)
    .then(() => request('ping', {}, 5000))
    .then((response) => {
      setConnection(Boolean(response && response.connected), response && response.version);
      return refresh();
    }).catch(() => {
      setConnection(false, '');
      setNotice('未连接数据助手，请在 Chrome 扩展管理页重新加载扩展。', 'error');
    });
  setInterval(() => {
    if (connected && (activeMode === 'batch' || (taskStatus && taskStatus.running) ||
        (batchStatus && (batchStatus.running || batchStatus.paused)))) refresh();
  }, 2000);
  window.addEventListener('focus', () => { if (connected) refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (connected && !document.hidden) refresh();
  });
})();
