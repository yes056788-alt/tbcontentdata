(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
  const BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
  const taskType = 'report';
  const pendingRequests = new Map();
  const $ = (selector) => document.querySelector(selector);

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  let connected = false;
  let directory = { storeGroups: [], stores: [] };
  let runs = [];
  let taskStatus = null;
  let accountSession = {
    unlocked: false,
    schema: 0,
    hasAccountDetails: false,
    totalEnabledAccounts: 0,
    ungroupedAccountCount: 0,
    storeGroups: [],
    stores: [],
    accounts: [],
  };
  let batchStatus = null;
  let bridgeCapabilities = new Set();
  let selectedBatchAccountIds = new Set();
  let selectedBatchGroupId = '';
  let batchSelectionInitialized = false;
  let selectedStoreId = '';
  let activeMode = 'current';
  let refreshing = false;

  function selectedPlatforms(mode) {
    const picker = document.querySelector('[data-platform-picker="' + mode + '"]');
    return picker ? Array.from(picker.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value) : [];
  }

  function selectedCredentialMode() {
    const selected = document.querySelector('input[name="credentialMode"]:checked');
    return selected && selected.value === 'currentSession' ? 'currentSession' : 'vault';
  }

  function validatePlatformCapabilities(platforms) {
    const hasXhs = (Array.isArray(platforms) ? platforms : [])
      .some((platform) => ['adstar', 'pgy', 'juguang'].includes(platform));
    if (hasXhs && !bridgeCapabilities.has('xhsAnalysis')) {
      throw new Error('当前一键取数页仍连接旧版数据助手，请刷新本页后重试。');
    }
  }

  function dateInputValue(value) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function initializeXhsDateRange() {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    if ($('#xhsDateFrom') && !$('#xhsDateFrom').value) $('#xhsDateFrom').value = dateInputValue(start);
    if ($('#xhsDateTo') && !$('#xhsDateTo').value) $('#xhsDateTo').value = dateInputValue(end);
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

  function deleteStoreRun(runId) {
    function parseServerDeletePermission(session) {
      const source = isPlainObject(session) ? session : {};
      const member = isPlainObject(source.member) ? source.member : {};
      const role = String(source.role || member.role || (source.user && source.user.role) || '').trim().toLowerCase();
      const permissions = isPlainObject(source.permissions) ? source.permissions : {};
      const canDelete = permissions.canDeleteRuns == null ? permissions.deleteRuns : permissions.canDeleteRuns;
      const privileged = role === 'owner' || role === 'admin';
      const hasPermission = canDelete == null ? privileged : canDelete === true;
      return hasPermission === true;
    }

    function extractServerDeleteErrorText(bodyText, status) {
      if (!bodyText) return '云端删除运行记录失败（HTTP ' + status + '）。';
      try {
        const body = JSON.parse(bodyText);
        const candidate = isPlainObject(body)
          ? (body.error && (body.error.message || body.error.error) || body.message)
          : null;
        if (typeof candidate === 'string' && candidate) return candidate;
      } catch (error) {}
      return '云端删除运行记录失败（HTTP ' + status + '）。';
    }

    async function deleteRunFallbackToServer(targetRunId) {
      const id = String(targetRunId || '').trim();
      if (!/^store-run-[a-z0-9-]+$/i.test(id)) {
        throw new Error('店铺归档编号无效。');
      }
      const sessionResponse = await fetch('/api/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!sessionResponse.ok) {
        throw new Error('当前账号登录已失效，请重新登录后重试。');
      }
      const sessionPayload = await sessionResponse.json().catch(() => null);
      if (!parseServerDeletePermission(sessionPayload)) {
        throw new Error('当前账号无权限删除运行记录。');
      }
      const deleteResponse = await fetch('/api/runs/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (deleteResponse.status === 404 || deleteResponse.status === 410) {
        await request('deleteStoreRun', { runId: id }, 30000);
        return;
      }
      if (!deleteResponse.ok) {
        const deleteText = await deleteResponse.text().catch(() => '');
        throw new Error(extractServerDeleteErrorText(deleteText, deleteResponse.status));
      }
      await request('deleteStoreRun', { runId: id }, 30000);
    }

    const cloudSync = window.TaobaoCloudSync;
    if (cloudSync && typeof cloudSync.deleteRun === 'function') {
      return cloudSync.deleteRun(runId);
    }
    const hostname = String(window.location.hostname || '').toLowerCase();
    const cloudPage = Boolean(document.querySelector('.cloud-team-topbar'));
    const serverHosted = cloudPage || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    if (!serverHosted) return request('deleteStoreRun', { runId });
    return deleteRunFallbackToServer(runId);
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
      schema: Math.max(0, Number(source.schema) || 0),
      hasAccountDetails: Array.isArray(source.accounts),
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
      accounts: (Array.isArray(source.accounts) ? source.accounts : []).map((account) => ({
        id: String(account && account.id || ''),
        storeId: String(account && account.storeId || ''),
        storeName: String(account && account.storeName || ''),
        groupId: String(account && account.groupId || ''),
        usernameMasked: String(account && account.usernameMasked || ''),
        roleKeyword: String(account && account.roleKeyword || ''),
      })).filter((account) => account.id && account.storeId && account.storeName),
    };
  }

  function batchMultiSelectSupported() {
    return bridgeCapabilities.has('accountBatchMultiSelect');
  }

  function accountsForBatchGroup(groupId) {
    return accountSession.accounts.filter((account) => (
      groupId === '__ungrouped__' ? !account.groupId : account.groupId === groupId
    ));
  }

  function expectedAccountsForBatchGroup(groupId) {
    if (groupId === '__ungrouped__') return accountSession.ungroupedAccountCount;
    const group = accountSession.storeGroups.find((item) => item.id === groupId);
    return group ? group.enabledAccountCount : 0;
  }

  function batchAccountDetailsState() {
    if (!accountSession.unlocked) return { kind: 'locked', actual: 0, expected: 0 };
    const actual = accountsForBatchGroup(selectedBatchGroupId).length;
    const expected = expectedAccountsForBatchGroup(selectedBatchGroupId);
    if (!batchMultiSelectSupported() || accountSession.schema < 2 || !accountSession.hasAccountDetails) {
      return { kind: 'upgrade', actual, expected };
    }
    if (accountSession.accounts.length !== accountSession.totalEnabledAccounts || actual !== expected) {
      return { kind: 'incomplete', actual, expected };
    }
    return { kind: 'ready', actual, expected };
  }

  function selectedBatchAccountIdList() {
    const eligibleIds = new Set(accountsForBatchGroup(selectedBatchGroupId).map((account) => account.id));
    return Array.from(selectedBatchAccountIds).filter((id) => eligibleIds.has(id));
  }

  function selectedBatchAccountCount() {
    return accountSession.unlocked ? selectedBatchAccountIdList().length : 0;
  }

  function batchSelectionLocked() {
    const status = batchStatus || {};
    return Boolean(status.running || (status.paused && status.taskType === taskType));
  }

  function syncLockedBatchSelection() {
    const status = batchStatus || {};
    const sameTask = status.taskType === taskType;
    if (!(sameTask && (status.running || status.paused))) return;
    const selection = status.selection && typeof status.selection === 'object' ? status.selection : {};
    if (selection.id) selectedBatchGroupId = String(selection.id);
    const accountIds = Array.isArray(status.accountIds) ? status.accountIds : selection.accountIds;
    if (Array.isArray(accountIds) && accountIds.length) {
      selectedBatchAccountIds = new Set(accountIds.map(String));
      batchSelectionInitialized = true;
    }
  }

  function renderBatchGroupOptions() {
    syncLockedBatchSelection();
    const select = $('#batchGroupSelect');
    const items = accountSession.storeGroups.filter((group) => group.enabledAccountCount > 0).map((group) => ({
      id: group.id,
      name: group.name,
      count: group.enabledAccountCount,
    }));
    if (accountSession.ungroupedAccountCount) {
      items.push({ id: '__ungrouped__', name: '未分组店铺', count: accountSession.ungroupedAccountCount });
    }
    select.innerHTML = items.length ? items.map((item) => (
      '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '（' + item.count + ' 个淘宝账号）</option>'
    )).join('') : '<option value="">暂无可执行分组</option>';
    if (!items.some((item) => item.id === selectedBatchGroupId)) {
      selectedBatchGroupId = items[0] && items[0].id || '';
      batchSelectionInitialized = false;
    }
    select.value = selectedBatchGroupId;
    const detailsState = batchAccountDetailsState();
    select.disabled = !accountSession.unlocked || !items.length || detailsState.kind !== 'ready' || batchSelectionLocked();
    const eligibleAccounts = accountsForBatchGroup(selectedBatchGroupId);
    const eligibleIds = new Set(eligibleAccounts.map((account) => account.id));
    selectedBatchAccountIds = new Set(Array.from(selectedBatchAccountIds).filter((id) => eligibleIds.has(id)));
    if (!batchSelectionInitialized && eligibleAccounts.length) {
      selectedBatchAccountIds = new Set(eligibleAccounts.slice(0, 100).map((account) => account.id));
      batchSelectionInitialized = true;
    }
    renderBatchAccountOptions();
  }

  function renderBatchAccountOptions() {
    const accounts = accountsForBatchGroup(selectedBatchGroupId);
    const locked = batchSelectionLocked();
    const detailsState = batchAccountDetailsState();
    if (detailsState.kind === 'upgrade') {
      $('#batchAccountList').innerHTML = '<div class="batch-account-empty batch-account-alert" role="alert"><strong>当前数据助手版本过旧</strong><span>无法读取组内账号明细。请安装或重新加载最新扩展，刷新页面后重新解锁账号库。</span><a class="button primary" href="/downloads/taobao-data-assistant.zip" download>下载最新扩展</a></div>';
      $('#batchAccountHint').textContent = '需要更新数据助手后才能组内多选';
      $('#batchSelectAllBtn').textContent = '全选本组';
      updateBatchSelectionActions(accounts, locked);
      renderBatchControls();
      return;
    }
    if (detailsState.kind === 'incomplete') {
      $('#batchAccountList').innerHTML = '<div class="batch-account-empty batch-account-alert" role="alert"><strong>账号明细同步不完整</strong><span>当前分组应有 ' + detailsState.expected + ' 个账号，实际读取到 ' + detailsState.actual + ' 个。请重新加载扩展、刷新页面并重新解锁账号库。</span><a class="button" href="/accounts.html">返回账号库</a></div>';
      $('#batchAccountHint').textContent = '账号明细与分组统计不一致，已停止批量启动';
      $('#batchSelectAllBtn').textContent = '全选本组';
      updateBatchSelectionActions(accounts, locked);
      renderBatchControls();
      return;
    }
    $('#batchAccountList').innerHTML = accounts.length ? accounts.map((account) => (
      '<label class="batch-account-option"><input type="checkbox" data-batch-account-id="' + escapeHtml(account.id) + '"' +
        (selectedBatchAccountIds.has(account.id) ? ' checked' : '') + (locked ? ' disabled' : '') + '><span><strong>' +
        escapeHtml(account.storeName) + '</strong><small>' + escapeHtml(account.usernameMasked || '账号') +
        (account.roleKeyword ? ' · ' + escapeHtml(account.roleKeyword) : '') + '</small></span></label>'
    )).join('') : '<div class="batch-account-empty">当前分组没有可执行的启用淘宝账号</div>';
    $('#batchAccountHint').textContent = accounts.length
      ? '当前分组共 ' + accounts.length + ' 个启用淘宝账号，可多选执行（每次最多 100 个）'
      : '当前分组没有可执行账号';
    $('#batchSelectAllBtn').textContent = accounts.length > 100 ? '选择前 100 个' : '全选本组';
    updateBatchSelectionActions(accounts, locked);
    renderBatchControls();
  }

  function updateBatchSelectionActions(accounts, locked) {
    const values = Array.isArray(accounts) ? accounts : accountsForBatchGroup(selectedBatchGroupId);
    const selectionLocked = locked === undefined ? batchSelectionLocked() : Boolean(locked);
    const selectedCount = selectedBatchAccountIdList().length;
    const detailsReady = batchAccountDetailsState().kind === 'ready';
    $('#batchSelectAllBtn').disabled = !accountSession.unlocked || !detailsReady || !values.length ||
      selectedCount === Math.min(values.length, 100) || selectionLocked;
    $('#batchClearSelectionBtn').disabled = !accountSession.unlocked || !detailsReady || !selectedCount || selectionLocked;
  }

  function renderBatchControls() {
    const accountCount = selectedBatchAccountCount();
    const availableCount = accountsForBatchGroup(selectedBatchGroupId).length;
    const platformCount = selectedPlatforms('batch').length;
    const detailsState = batchAccountDetailsState();
    $('#batchAccountSummary').textContent = detailsState.kind === 'upgrade'
      ? '需要更新插件'
      : detailsState.kind === 'incomplete'
        ? '读取到 ' + detailsState.actual + ' / ' + detailsState.expected + ' 个'
        : '已选 ' + accountCount + ' / ' + availableCount + ' 个';
    const status = batchStatus || {};
    const sameTask = status.taskType === taskType;
    const running = Boolean(status.running);
    const paused = Boolean(status.paused && sameTask);
    const resumePlatformCount = paused && Array.isArray(status.platforms) && status.platforms.length
      ? status.platforms.length
      : platformCount;
    $('#startBatchTaskBtn').disabled = !connected || !accountSession.unlocked || detailsState.kind !== 'ready' ||
      !accountCount || accountCount > 100 || !platformCount || running || paused;
    $('#resumeBatchTaskBtn').hidden = !paused;
    $('#resumeBatchTaskBtn').disabled = !connected || !accountSession.unlocked || !resumePlatformCount;
    $('#cancelBatchTaskBtn').disabled = !(status.running || status.paused);
    $('#batchGroupSelect').disabled = !accountSession.unlocked || detailsState.kind !== 'ready' ||
      !selectedBatchGroupId || running || paused;
    document.querySelectorAll('[data-platform-picker="batch"] input[type="checkbox"]').forEach((input) => {
      input.disabled = running || paused;
    });
    updateBatchSelectionActions(undefined, running || paused);
  }

  function renderStatus() {
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
        : (accountSession.unlocked ? '选择店铺分组并勾选需要执行的账号。' : '请先在账号库管理中解锁本次 Chrome 会话。');
      $('#currentTaskStartedAt').textContent = sameTask ? formatDate(status.startedAt) : '-';
      $('#currentTaskFinishedAt').textContent = sameTask && status.finishedAt ? formatDate(status.finishedAt) : '-';
      $('#openLatestTaskBtn').hidden = true;
      renderBatchControls();
      return;
    }

    const status = taskStatus && taskStatus.taskType === taskType ? taskStatus : null;
    const terminal = Boolean(status && status.running !== true && (
      status.cancelled || status.finishedAt ||
      ['failed', 'success', 'partial', 'cancelled'].includes(status.status)
    ));
    const waitingForVerification = Boolean(status && status.running === true && !terminal && (
      status.waitingForVerification || status.paused
    ));
    const runningAnyTask = Boolean(taskStatus && (
      taskStatus.running || taskStatus.cancelling
    ));
    const running = Boolean(status && status.running);
    const cancelling = Boolean(status && status.cancelling);
    const active = running || waitingForVerification;
    const cancelButton = $('#cancelCurrentTaskBtn');
    $('#taskStatusDescription').textContent = '单店一键取数进度';
    $('#startCurrentTaskBtn').disabled = !connected || !selectedStoreId || !selectedPlatforms('current').length || runningAnyTask;
    cancelButton.hidden = !(active || cancelling);
    cancelButton.disabled = !connected || cancelling || !status || !status.taskId ||
      !bridgeCapabilities.has('projectTaskCancel');
    cancelButton.textContent = cancelling ? '正在取消' : '取消任务';
    $('#currentTaskProgress').classList.toggle('running', running);
    $('#currentTaskProgress').style.width = running ? '' : (status && status.finishedAt ? '100%' : '0');
    $('#currentTaskStore').textContent = status && status.storeName || '尚未启动';
    $('#currentTaskState').textContent = status
      ? (status.cancelled ? '已取消' : cancelling ? '正在取消' : waitingForVerification ? '等待验证' : running ? '执行中' : status.error || status.status === 'failed'
        ? '失败'
        : status.status === 'partial' ? '部分成功' : '已完成')
      : '等待开始';
    $('#currentTaskCopy').textContent = status
      ? (terminal
        ? (status.error || status.phase || '任务状态已更新')
        : (status.pauseReason || status.error || status.phase || '任务状态已更新'))
      : (runningAnyTask ? '另一类当前账号任务正在执行。' : '选择店铺后启动任务。');
    $('#currentTaskStartedAt').textContent = status ? formatDate(status.startedAt) : '-';
    $('#currentTaskFinishedAt').textContent = status && status.finishedAt ? formatDate(status.finishedAt) : '-';
    $('#openLatestTaskBtn').hidden = !(status && status.archiveRunId && !active);
    $('#openLatestTaskBtn').dataset.runId = status && status.archiveRunId || '';
  }

  function renderLogs() {
    const values = runs.filter(runMatchesType).sort((left, right) => Number(right.finishedAt) - Number(left.finishedAt));
    $('#taskLogCount').textContent = values.length + ' 条';
    $('#taskRunRows').innerHTML = values.length ? values.map((run) => {
      const status = statusInfo(run.status);
      const mode = run.runMode === 'current' ? '单店一键取数' : '批量账号库';
      const actionLabel = '打开报告';
      return '<tr><td><strong>' + escapeHtml(run.storeName || '-') + '</strong></td><td>' + mode + '</td>' +
        '<td>' + escapeHtml(run.accountName || run.usernameMasked || '-') + '</td><td>' + escapeHtml(formatDate(run.finishedAt)) + '</td>' +
        '<td><span class="status-badge ' + status[0] + '">' + status[1] + '</span></td><td>' + (Number(run.failureCount) || 0) + '</td>' +
        '<td><div class="row-actions"><button class="row-action" type="button" data-run-action="open" data-run-id="' + escapeHtml(run.runId) + '">' + actionLabel + '</button>' +
        '<button class="row-action danger" type="button" data-run-action="delete" data-run-id="' + escapeHtml(run.runId) + '">删除</button></div></td></tr>';
    }).join('') : '<tr><td class="empty-cell" colspan="7">暂无已归档的运行日志</td></tr>';
  }

  function renderBatchSession() {
    const notice = $('#batchSessionNotice');
    renderBatchGroupOptions();
    const detailsState = batchAccountDetailsState();
    notice.classList.toggle('unlocked', accountSession.unlocked && detailsState.kind === 'ready');
    notice.innerHTML = !accountSession.unlocked
      ? '<div><strong>本次 Chrome 会话尚未解锁账号库</strong><p>进入账号库管理解锁一次，返回后即可在店铺分组内多选账号。</p></div><a href="/accounts.html">去解锁</a>'
      : detailsState.kind === 'upgrade'
        ? '<div><strong>数据助手需要更新</strong><p>当前扩展只返回了账号统计，没有返回组内明细。安装或重新加载后，请刷新并重新解锁账号库。</p></div><a href="/downloads/taobao-data-assistant.zip" download>下载最新扩展</a>'
        : detailsState.kind === 'incomplete'
          ? '<div><strong>账号明细尚未完整同步</strong><p>已暂停批量启动，请重新加载扩展、刷新并重新解锁账号库。</p></div><a href="/accounts.html">返回账号库</a>'
          : '<div><strong>账号库会话已解锁</strong><p>本次 Chrome 会话可直接执行，共 ' + accountSession.totalEnabledAccounts + ' 个启用淘宝账号。</p></div><a href="/accounts.html">管理账号</a>';
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
      if (connected && !batchMultiSelectSupported()) {
        setNotice('当前数据助手版本不支持组内多选，请在扩展管理页重新加载最新版扩展。', 'error');
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
    if (!batchMultiSelectSupported()) throw new Error('请在扩展管理页重新加载最新版数据助手后再使用组内多选。');
    let accountCount = selectedBatchAccountCount();
    let selection = {
      type: 'storeGroup',
      id: selectedBatchGroupId,
      accountIds: selectedBatchAccountIdList(),
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
    if (accountCount > 100) throw new Error('每次最多选择 100 个账号。');
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
    validatePlatformCapabilities(platforms);
    const credentialMode = selectedCredentialMode();
    if (credentialMode === 'vault' && !accountSession.unlocked) {
      throw new Error('请先在账号库管理中解锁一次，再使用账号库自动登录。');
    }
    const hasXhs = platforms.some((platform) => ['adstar', 'pgy', 'juguang'].includes(platform));
    const juguangConcurrentTabs = Number($('#juguangConcurrentTabs') && $('#juguangConcurrentTabs').value);
    const dateRange = {
      from: $('#xhsDateFrom').value,
      to: $('#xhsDateTo').value,
      timezone: 'Asia/Shanghai',
    };
    if (hasXhs && (!dateRange.from || !dateRange.to || dateRange.from > dateRange.to)) {
      throw new Error('请选择有效的小红书开始和结束日期。');
    }
    const loginDescription = credentialMode === 'vault'
      ? '使用账号库中该店铺的默认淘宝与小红书账号自动登录'
      : '复用当前 Chrome 已登录账号';
    if (!window.confirm(loginDescription + '，并为“' + store.name + '”执行一键取数？')) return;
    taskStatus = {
      taskType,
      runMode: 'current',
      storeId: store.id,
      storeName: store.name,
      running: true,
      startedAt: Date.now(),
      phase: '正在启动任务',
      platforms,
      credentialMode,
    };
    renderStatus();
    setNotice('任务已提交，后台页面会自动打开并执行。');
    const response = await request('startProjectTask', {
      taskType,
      platforms,
      credentialMode,
      dateRange,
      concurrentAccountTabs: platforms.includes('juguang') && [2, 3].includes(juguangConcurrentTabs)
        ? juguangConcurrentTabs
        : undefined,
      store: { id: store.id, name: store.name, groupId: store.groupId || '', groupName: groupName(store.groupId) },
    }, 30000);
    if (!response || response.ok === false) throw new Error(response && response.message || '任务启动失败。');
    setTimeout(refresh, 350);
  }

  async function cancelCurrentTask() {
    const status = taskStatus && taskStatus.taskType === taskType ? taskStatus : null;
    if (!status || !status.taskId || (
      !status.running && !status.cancelling &&
      !status.waitingForVerification && !status.paused
    )) {
      throw new Error('当前没有正在执行的当前账号任务。');
    }
    if (!connected || !bridgeCapabilities.has('projectTaskCancel')) {
      throw new Error('当前数据助手不支持安全取消，请重新加载最新扩展。');
    }
    if (status.cancelling) return;
    const taskId = status.taskId;
    const previousPhase = status.phase;
    taskStatus = Object.assign({}, status, {
      cancelling: true,
      phase: '正在请求取消任务',
    });
    renderStatus();
    try {
      const response = await request('cancelProjectTask', { taskId: status.taskId }, 10000);
      if (response && response.cancelled === false) {
        if (taskStatus && taskStatus.taskId === taskId) {
          taskStatus = Object.assign({}, taskStatus, { cancelling: false, phase: previousPhase });
          renderStatus();
        }
        return;
      }
      if (taskStatus && taskStatus.taskId === taskId) {
        const finished = Boolean(response && response.cancelled === true && response.running === false);
        taskStatus = Object.assign({}, taskStatus, {
          running: !finished,
          cancelling: !finished,
          cancelled: finished,
          status: finished ? 'cancelled' : taskStatus.status,
          finishedAt: finished ? Date.now() : taskStatus.finishedAt,
          phase: finished ? '任务已取消' : '正在取消，当前步骤结束后停止',
        });
        renderStatus();
      }
      setNotice(response && response.message || '已提交取消请求。');
      setTimeout(refresh, 300);
    } catch (error) {
      if (taskStatus && taskStatus.taskId === taskId) {
        taskStatus = Object.assign({}, taskStatus, { cancelling: false, phase: previousPhase });
        renderStatus();
      }
      throw error;
    }
  }

  async function openRun(runId) {
    if (!runId) return;
    location.href = '/report-view.html?archive=' + encodeURIComponent(runId);
  }

  async function handleRunAction(button) {
    const runId = button.dataset.runId;
    if (button.dataset.runAction === 'open') {
      await openRun(runId);
      return;
    }
    if (!window.confirm('删除这条运行日志和归档数据？')) return;
    await deleteStoreRun(runId);
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
    if (message.type === 'ready') {
      if (Array.isArray(message.capabilities)) bridgeCapabilities = new Set(message.capabilities.map(String));
      setConnection(true, message.version);
    }
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
  $('#taskStoreSelect').addEventListener('change', (event) => {
    selectedStoreId = event.currentTarget.value;
    renderStatus();
  });
  $('#startCurrentTaskBtn').addEventListener('click', () => {
    startCurrentTask().catch((error) => { setNotice(error.message, 'error'); refresh(); });
  });
  $('#cancelCurrentTaskBtn').addEventListener('click', () => {
    cancelCurrentTask().catch((error) => { setNotice(error.message, 'error'); refresh(); });
  });
  $('#batchGroupSelect').addEventListener('change', (event) => {
    selectedBatchGroupId = event.currentTarget.value;
    selectedBatchAccountIds = new Set();
    batchSelectionInitialized = false;
    renderBatchGroupOptions();
    renderStatus();
  });
  $('#batchAccountList').addEventListener('change', (event) => {
    const input = event.target.closest('[data-batch-account-id]');
    if (!input || batchSelectionLocked()) return;
    if (input.checked) selectedBatchAccountIds.add(input.dataset.batchAccountId);
    else selectedBatchAccountIds.delete(input.dataset.batchAccountId);
    renderBatchControls();
    renderStatus();
  });
  $('#batchSelectAllBtn').addEventListener('click', () => {
    selectedBatchAccountIds = new Set(accountsForBatchGroup(selectedBatchGroupId).slice(0, 100).map((account) => account.id));
    renderBatchAccountOptions();
    renderStatus();
  });
  $('#batchClearSelectionBtn').addEventListener('click', () => {
    selectedBatchAccountIds = new Set();
    renderBatchAccountOptions();
    renderStatus();
  });
  document.querySelectorAll('[data-platform-picker] input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const picker = typeof input.closest === 'function' ? input.closest('[data-platform-picker]') : null;
      const mode = picker && picker.dataset ? picker.dataset.platformPicker : activeMode;
      if ($('#pageNotice').textContent === '请至少选择一个平台任务。' && selectedPlatforms(mode).length) {
        setNotice('', '');
      }
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
  initializeXhsDateRange();
  Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
    .catch(() => null)
    .then(() => request('ping', {}, 5000))
    .then((response) => {
      if (Array.isArray(response && response.capabilities)) {
        bridgeCapabilities = new Set(response.capabilities.map(String));
      }
      setConnection(Boolean(response && response.connected), response && response.version);
      return refresh();
    }).catch(() => {
      setConnection(false, '');
      setNotice('未连接数据助手，请在 Chrome 扩展管理页重新加载扩展。', 'error');
    });
  setInterval(() => {
    if (connected && ((taskStatus && (
      taskStatus.running || taskStatus.cancelling ||
      taskStatus.waitingForVerification || taskStatus.paused
    )) ||
        (batchStatus && (batchStatus.running || batchStatus.paused)))) refresh();
  }, 2000);
  window.addEventListener('focus', () => { if (connected) refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (connected && !document.hidden) refresh();
  });
})();
