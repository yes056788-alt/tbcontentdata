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

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }
  let directory = { schema: 1, storeGroups: [], stores: [] };
  let runs = [];
  let selectedStoreId = '';
  let activeView = 'report';
  let batchExportCandidates = [];
  let batchExportMissingStores = [];
  let batchExportSelectedRunIds = new Set();
  let batchExportRunning = false;
  let batchExportCanceled = false;
  let batchExportStopReason = '';
  let batchExportAbortController = null;
  let batchExportPendingDownload = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function request(action, payload, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        const error = new Error('批量导出已停止。');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      const requestId = 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      let abortHandler = null;
      const removeAbortListener = () => {
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      };
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        removeAbortListener();
        reject(new Error('数据助手响应超时，请重新加载扩展。'));
      }, Number(timeoutMs) || 30000);
      if (signal) {
        abortHandler = () => {
          if (!pendingRequests.delete(requestId)) return;
          clearTimeout(timer);
          removeAbortListener();
          const error = new Error('批量导出已停止。');
          error.name = 'AbortError';
          reject(error);
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      pendingRequests.set(requestId, { resolve, reject, timer, removeAbortListener });
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
      if (run.storeId ? storeIds.has(run.storeId) : storeNames.has(run.storeName)) return;
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
    const uniqueName = directory.stores.filter((item) => item.name === store.name).length === 1;
    return runs.filter((run) => run && (
      run.storeId ? run.storeId === store.id : uniqueName && String(run.storeName || '') === store.name
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
    if (value === 'collect') return ['历史经营取数', true, false];
    if (value === 'report') return ['一键取数', true, true];
    if (value === 'comment_monitor') return ['评论监测', false, false];
    return ['一键取数', true, true];
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

  function batchExportUtils() {
    const utils = window.TaobaoBatchReportExport;
    if (!utils) throw new Error('批量导出组件未载入，请刷新页面。');
    return utils;
  }

  function selectedBatchExportScope() {
    const checked = document.querySelector('input[name="batchExportScope"]:checked');
    return checked ? checked.value : 'store';
  }

  function selectedBatchExportHistoryMode() {
    const checked = document.querySelector('input[name="batchExportHistoryMode"]:checked');
    return checked ? checked.value : 'latest';
  }

  function batchExportGroup() {
    const groupId = $('#batchExportGroupSelect').value;
    return projectGroups().find((group) => group.id === groupId) || null;
  }

  function buildBatchExportCandidates() {
    const scope = selectedBatchExportScope();
    const group = scope === 'group' ? batchExportGroup() : null;
    const stores = scope === 'store' ? [storeById(selectedStoreId)].filter(Boolean) : (group ? group.stores : []);
    const candidates = batchExportUtils().selectReportCandidates({
      stores,
      knownStores: directory.stores,
      runs,
      historyMode: scope === 'store' ? 'all' : selectedBatchExportHistoryMode(),
    });
    const storeIdsWithReports = new Set(candidates.map((candidate) => candidate.store.id));
    batchExportMissingStores = scope === 'group'
      ? stores.filter((store) => !storeIdsWithReports.has(store.id))
      : [];
    return candidates;
  }

  function renderBatchExportSelectionCount() {
    const limit = batchExportUtils().MAX_REPORTS;
    const selected = batchExportCandidates.filter((candidate) => batchExportSelectedRunIds.has(candidate.run.runId));
    $('#batchExportSelectionCount').textContent = '已选 ' + selected.length + ' / ' + batchExportCandidates.length + ' 份';
    const button = $('#startBatchExportBtn');
    button.disabled = batchExportRunning || selected.length === 0;
    button.textContent = batchExportRunning ? '正在导出…' : '导出 ' + selected.length + ' 份报告';
    const limitCopy = batchExportCandidates.length > limit
      ? '当前有 ' + batchExportCandidates.length + ' 份报告，每次最多选择 ' + limit + ' 份。'
      : '每次最多导出 ' + limit + ' 份报告。';
    $('#batchExportHint').textContent = limitCopy + (batchExportMissingStores.length
      ? ' 另有 ' + batchExportMissingStores.length + ' 个店铺暂无报告，将在导出清单中标记为跳过。'
      : '');
  }

  function renderBatchExportCandidates(resetSelection) {
    batchExportCandidates = buildBatchExportCandidates();
    const availableIds = new Set(batchExportCandidates.map((candidate) => candidate.run.runId));
    if (resetSelection) {
      batchExportSelectedRunIds = new Set(
        batchExportCandidates.slice(0, batchExportUtils().MAX_REPORTS).map((candidate) => candidate.run.runId)
      );
    } else {
      batchExportSelectedRunIds = new Set(
        Array.from(batchExportSelectedRunIds).filter((runId) => availableIds.has(runId))
      );
    }
    const latestGroupMode = selectedBatchExportScope() === 'group' && selectedBatchExportHistoryMode() === 'latest';
    const candidateMarkup = batchExportCandidates.map((candidate) => {
      const run = candidate.run;
      const status = statusInfo(run.status);
      const account = run.accountName || run.usernameMasked || '当前账号';
      const detail = latestGroupMode
        ? '自动选择最新可用报告 · 索引最新 ' + formatDate(run.finishedAt)
        : formatDate(run.finishedAt) + ' · ' + account;
      return '<label class="batch-export-item"><input type="checkbox" data-batch-export-run="' +
        escapeHtml(run.runId) + '"' + (batchExportSelectedRunIds.has(run.runId) ? ' checked' : '') + '><span><strong>' +
        escapeHtml(candidate.store && candidate.store.name || run.storeName || '未命名店铺') + '</strong><small>' +
        escapeHtml(detail) + '</small></span><b class="' + status[0] + '">' +
        status[1] + '</b></label>';
    }).join('');
    const missingMarkup = batchExportMissingStores.map((store) => (
      '<div class="batch-export-item unavailable" aria-disabled="true"><span class="batch-export-placeholder" aria-hidden="true">—</span>' +
      '<span><strong>' + escapeHtml(store.name) + '</strong><small>该店铺暂无诊断报告</small></span><b class="failed">跳过</b></div>'
    )).join('');
    $('#batchExportList').innerHTML = candidateMarkup || missingMarkup
      ? candidateMarkup + missingMarkup
      : '<div class="batch-export-empty"><strong>暂无诊断报告记录</strong><span>请先完成一次一键取数</span></div>';
    renderBatchExportSelectionCount();
  }

  function renderBatchExportGroups() {
    const groups = projectGroups();
    const select = $('#batchExportGroupSelect');
    select.innerHTML = groups.map((group) => '<option value="' + escapeHtml(group.id) + '">' +
      escapeHtml(group.name + ' (' + group.stores.length + ' 个店铺)') + '</option>').join('');
    const currentStore = storeById(selectedStoreId);
    const preferred = groupIdForStore(currentStore);
    if (groups.some((group) => group.id === preferred)) select.value = preferred;
  }

  function openBatchExportDialog() {
    if (!storeById(selectedStoreId)) {
      setNotice('请先从左侧选择一个店铺。', 'error');
      return;
    }
    batchExportRunning = false;
    batchExportCanceled = false;
    batchExportStopReason = '';
    batchExportAbortController = null;
    batchExportPendingDownload = null;
    document.querySelector('input[name="batchExportScope"][value="store"]').checked = true;
    document.querySelector('input[name="batchExportHistoryMode"][value="latest"]').checked = true;
    $('#batchExportGroupOptions').hidden = true;
    $('#batchExportSetup').hidden = false;
    $('#batchExportProgress').hidden = true;
    $('#batchExportResultList').innerHTML = '';
    $('#cancelBatchExportBtn').textContent = '取消';
    $('#cancelBatchExportBtn').disabled = false;
    $('#closeBatchExportBtn').disabled = false;
    renderBatchExportGroups();
    renderBatchExportCandidates(true);
    $('#batchExportDialog').showModal();
  }

  function closeBatchExportDialog() {
    if (batchExportRunning) {
      stopBatchExport();
      return;
    }
    $('#batchExportDialog').close();
  }

  function stopBatchExport() {
    batchExportCanceled = true;
    batchExportStopReason = '用户停止导出，未继续处理。';
    if (batchExportAbortController) batchExportAbortController.abort();
    $('#batchExportProgressCopy').textContent = '正在停止，将保留已完成的报告且不会自动下载…';
  }

  function waitForBatchReportBuilder() {
    const frame = $('#batchReportBuilderFrame');
    const current = frame.contentWindow && frame.contentWindow.TaobaoReportExport;
    if (current && typeof current.buildFromArchive === 'function') return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('报告生成器载入超时。')), 20000);
      frame.onload = () => {
        window.clearTimeout(timeout);
        const api = frame.contentWindow && frame.contentWindow.TaobaoReportExport;
        if (!api || typeof api.buildFromArchive !== 'function') {
          reject(new Error('报告生成器不可用，请刷新页面。'));
          return;
        }
        resolve(api);
      };
      frame.src = '/report-view.html?embed=1&builder=1&loaded=' + Date.now();
    });
  }

  function downloadBatchExport(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function batchManifestCsv(rows) {
    const cell = batchExportUtils().csvCell;
    const header = ['店铺', '完成时间', '执行账号', '任务状态', '文件名', '导出结果', '说明'];
    return '\ufeff' + [header].concat(rows).map((row) => row.map(cell).join(',')).join('\r\n');
  }

  function batchExportRunQueue(candidate, scope, historyMode) {
    if (scope !== 'group' || historyMode !== 'latest') return [candidate.run];
    return batchExportUtils().selectReportCandidates({
      stores: [candidate.store],
      knownStores: directory.stores,
      runs,
      historyMode: 'all',
    }).map((item) => item.run);
  }

  function appendBatchExportResult(tone, message) {
    $('#batchExportResultList').insertAdjacentHTML(
      'beforeend',
      '<li class="' + escapeHtml(tone) + '">' + escapeHtml(message) + '</li>'
    );
  }

  async function startBatchExport() {
    const utils = batchExportUtils();
    const frozen = batchExportCandidates.filter((candidate) => batchExportSelectedRunIds.has(candidate.run.runId));
    if (!frozen.length) throw new Error('请至少选择一份历史报告。');
    if (frozen.length > utils.MAX_REPORTS) throw new Error('每次最多导出 ' + utils.MAX_REPORTS + ' 份报告。');
    const scope = selectedBatchExportScope();
    const historyMode = selectedBatchExportHistoryMode();
    const missingStores = batchExportMissingStores.slice();
    const selectedGroup = scope === 'group' ? batchExportGroup() : null;
    const scopeName = scope === 'store'
      ? frozen[0].store && frozen[0].store.name || '当前店铺'
      : selectedGroup && selectedGroup.name || '店铺分组';
    batchExportRunning = true;
    batchExportCanceled = false;
    batchExportStopReason = '';
    batchExportPendingDownload = null;
    $('#batchExportSetup').hidden = true;
    $('#batchExportProgress').hidden = false;
    $('#batchExportProgressBar').max = frozen.length;
    $('#batchExportProgressBar').value = 0;
    $('#batchExportProgressCopy').textContent = '正在载入报告生成器…';
    $('#batchExportResultList').innerHTML = '';
    $('#cancelBatchExportBtn').textContent = '停止并保留已完成报告';
    $('#cancelBatchExportBtn').disabled = false;
    $('#closeBatchExportBtn').disabled = true;
    renderBatchExportSelectionCount();

    $('#batchExportProgressCopy').textContent = '正在确认数据助手连接…';
    const connection = await request('ping', {}, 5000);
    if (!connection || !connection.connected) throw new Error('数据助手未连接，请重新加载扩展后再试。');

    const entries = [];
    const manifestRows = missingStores.map((store) => [
      store.name, '', '', '', '', '跳过', '该店铺暂无诊断报告',
    ]);
    let totalBytes = 0;
    let completed = 0;
    let failed = 0;
    let skipped = missingStores.length;
    const processedRunIds = new Set();
    missingStores.forEach((store) => {
      appendBatchExportResult('skipped', store.name + ' — 跳过：暂无诊断报告');
    });
    const api = await waitForBatchReportBuilder();
    for (let index = 0; index < frozen.length; index += 1) {
      if (batchExportCanceled) break;
      const candidate = frozen[index];
      const initialRun = candidate.run;
      const storeName = candidate.store && candidate.store.name || initialRun.storeName || '未命名店铺';
      $('#batchExportProgressCopy').textContent = '正在生成 ' + (index + 1) + ' / ' + frozen.length + '：' + storeName;
      const runQueue = batchExportRunQueue(candidate, scope, historyMode);
      let exportedRun = null;
      let exportedFilename = '';
      let lastReason = '没有找到可导出的报告模块。';
      let usedFallback = false;
      for (let attempt = 0; attempt < runQueue.length; attempt += 1) {
        if (batchExportCanceled) break;
        const run = runQueue[attempt];
        try {
          batchExportAbortController = new AbortController();
          const response = await request(
            'getStoreRun',
            { runId: run.runId },
            45000,
            batchExportAbortController.signal
          );
          batchExportAbortController = null;
          if (batchExportCanceled) break;
          const archive = response && response.run;
          if (!archive || archive.runId !== run.runId || !archive.snapshots || typeof archive.snapshots !== 'object') {
            throw new Error('历史归档不完整。');
          }
          const archiveStoreId = String(archive.account && archive.account.storeId || '');
          const archiveStoreName = String(archive.account && archive.account.storeName || archive.storeName || '');
          const storeNameUnique = directory.stores.filter((store) => store.name === candidate.store.name).length === 1;
          const archiveMatchesStore = archiveStoreId
            ? archiveStoreId === candidate.store.id
            : storeNameUnique && archiveStoreName === candidate.store.name;
          if (!archiveMatchesStore) throw new Error('历史归档与所选店铺不一致，已拒绝导出。');
          const built = api.buildFromArchive(archive, {
            storeName,
            accountName: run.accountName || run.usernameMasked || '',
            finishedAt: run.finishedAt,
          });
          if (!built || !built.html || !Array.isArray(built.hasData) || !built.hasData.length) {
            throw new Error('这条历史记录没有可导出的报告模块。');
          }
          if (String(built.runId || '') !== String(run.runId)) {
            throw new Error('报告生成结果与历史归档不一致，已拒绝导出。');
          }
          const bytes = utils.utf8(built.html);
          if (totalBytes + bytes.length > utils.MAX_TOTAL_BYTES) {
            batchExportCanceled = true;
            batchExportStopReason = '已达批量导出体积上限，请减少选择数量。';
            lastReason = batchExportStopReason;
            break;
          }
          const suffix = String(run.runId).replace(/[^a-z0-9_-]/gi, '').slice(-6) || 'report';
          exportedFilename = String(completed + 1).padStart(3, '0') + '_' + utils.sanitizeFilename(storeName, '店铺') + '_' +
            utils.dateParts(run.finishedAt).compact + '_' + suffix + '.html';
          entries.push({ name: exportedFilename, data: bytes, updatedAt: run.finishedAt });
          totalBytes += bytes.length;
          completed += 1;
          exportedRun = run;
          usedFallback = attempt > 0;
          break;
        } catch (error) {
          batchExportAbortController = null;
          if (batchExportCanceled || error && error.name === 'AbortError') break;
          lastReason = error && error.message ? error.message : String(error);
        }
      }
      if (batchExportCanceled) break;
      processedRunIds.add(initialRun.runId);
      if (exportedRun) {
        const reason = usedFallback ? '索引最新记录不可用，已自动回退至较早的可用报告。' : '';
        appendBatchExportResult(
          'success',
          storeName + ' · ' + formatDate(exportedRun.finishedAt) + ' — 已生成' + (usedFallback ? '（已自动回退）' : '')
        );
        manifestRows.push([
          storeName,
          formatDate(exportedRun.finishedAt),
          exportedRun.accountName || exportedRun.usernameMasked || '',
          statusInfo(exportedRun.status)[1],
          exportedFilename,
          '成功',
          reason,
        ]);
      } else {
        failed += 1;
        appendBatchExportResult('failed', storeName + ' · ' + formatDate(initialRun.finishedAt) + ' — ' + lastReason);
        manifestRows.push([
          storeName,
          formatDate(initialRun.finishedAt),
          initialRun.accountName || initialRun.usernameMasked || '',
          statusInfo(initialRun.status)[1],
          '',
          '失败',
          lastReason,
        ]);
      }
      $('#batchExportProgressBar').value = index + 1;
    }

    batchExportAbortController = null;
    if (batchExportCanceled) {
      frozen.filter((candidate) => !processedRunIds.has(candidate.run.runId)).forEach((candidate) => {
        const run = candidate.run;
        const storeName = candidate.store && candidate.store.name || run.storeName || '未命名店铺';
        skipped += 1;
        manifestRows.push([
          storeName,
          formatDate(run.finishedAt),
          run.accountName || run.usernameMasked || '',
          statusInfo(run.status)[1],
          '',
          '跳过',
          batchExportStopReason || '批量导出已停止，未继续处理。',
        ]);
        appendBatchExportResult('skipped', storeName + ' — ' + (batchExportStopReason || '已停止，未处理'));
      });
    }

    if (entries.length) {
      entries.push({ name: '导出清单.csv', data: batchManifestCsv(manifestRows), updatedAt: Date.now() });
      $('#batchExportProgressCopy').textContent = '正在打包 ' + completed + ' 份报告…';
      $('#cancelBatchExportBtn').disabled = true;
      const zip = utils.createStoredZip(entries);
      const zipName = '诊断报告_' + utils.sanitizeFilename(scopeName, '批量导出') + '_' +
        utils.dateParts(Date.now()).compact + '_' + completed + '份.zip';
      batchExportPendingDownload = { bytes: zip, filename: zipName };
      if (!batchExportCanceled) downloadBatchExport(zip, zipName);
    }

    batchExportRunning = false;
    $('#closeBatchExportBtn').disabled = false;
    $('#cancelBatchExportBtn').disabled = false;
    $('#cancelBatchExportBtn').textContent = '关闭';
    const downloadButton = $('#startBatchExportBtn');
    downloadButton.disabled = !batchExportPendingDownload;
    downloadButton.textContent = batchExportPendingDownload
      ? (batchExportCanceled ? '下载已完成的 ' + completed + ' 份报告' : '再次下载报告包')
      : '没有可导出报告';
    const title = batchExportCanceled
      ? '批量导出已停止'
      : completed === 0
        ? '批量导出未生成文件'
        : failed || skipped
          ? '批量导出部分完成'
          : '批量导出完成';
    $('#batchExportProgressTitle').textContent = title;
    $('#batchExportProgressCopy').textContent = '成功 ' + completed + ' 份，失败 ' + failed + ' 份，跳过 ' + skipped + ' 份。' +
      (batchExportCanceled && batchExportStopReason ? ' ' + batchExportStopReason : '') +
      (batchExportCanceled && completed ? ' 请点击下方按钮下载已完成报告。' : '');
    $('#batchExportProgressTitle').focus();
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
      setViewerState(view, '该店铺暂无' + noun, '可从右上角执行第一次一键取数。');
      return;
    }
    $('#projectViewMeta').textContent = noun + ' · ' + formatDate(run.finishedAt);
    setViewerState(view, '正在载入' + noun, run.accountName || run.usernameMasked || '当前账号');
    try {
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
      button.tabIndex = active ? 0 : -1;
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
    await deleteStoreRun(runId);
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
      if (pending.removeAbortListener) pending.removeAbortListener();
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
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(document.querySelectorAll('[data-project-view]'));
      const currentIndex = tabs.indexOf(button);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
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

  $('#openBatchExportBtn').addEventListener('click', openBatchExportDialog);
  $('#closeBatchExportBtn').addEventListener('click', closeBatchExportDialog);
  $('#cancelBatchExportBtn').addEventListener('click', closeBatchExportDialog);
  $('#batchExportDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeBatchExportDialog();
  });

  document.querySelectorAll('input[name="batchExportScope"]').forEach((input) => {
    input.addEventListener('change', () => {
      const groupMode = selectedBatchExportScope() === 'group';
      $('#batchExportGroupOptions').hidden = !groupMode;
      renderBatchExportCandidates(true);
    });
  });
  document.querySelectorAll('input[name="batchExportHistoryMode"]').forEach((input) => {
    input.addEventListener('change', () => renderBatchExportCandidates(true));
  });
  $('#batchExportGroupSelect').addEventListener('change', () => renderBatchExportCandidates(true));
  $('#batchExportList').addEventListener('change', (event) => {
    const input = event.target.closest('[data-batch-export-run]');
    if (!input) return;
    const runId = input.dataset.batchExportRun;
    if (input.checked) {
      if (batchExportSelectedRunIds.size >= batchExportUtils().MAX_REPORTS) {
        input.checked = false;
        $('#batchExportHint').textContent = '每次最多选择 ' + batchExportUtils().MAX_REPORTS + ' 份报告。';
      } else {
        batchExportSelectedRunIds.add(runId);
      }
    } else {
      batchExportSelectedRunIds.delete(runId);
    }
    renderBatchExportSelectionCount();
  });
  $('#selectAllBatchReportsBtn').addEventListener('click', () => {
    batchExportSelectedRunIds = new Set(
      batchExportCandidates.slice(0, batchExportUtils().MAX_REPORTS).map((candidate) => candidate.run.runId)
    );
    renderBatchExportCandidates(false);
  });
  $('#clearBatchReportsBtn').addEventListener('click', () => {
    batchExportSelectedRunIds.clear();
    renderBatchExportCandidates(false);
  });
  $('#startBatchExportBtn').addEventListener('click', () => {
    if (batchExportPendingDownload && !batchExportRunning && !$('#batchExportProgress').hidden) {
      downloadBatchExport(batchExportPendingDownload.bytes, batchExportPendingDownload.filename);
      return;
    }
    startBatchExport().catch((error) => {
      batchExportRunning = false;
      batchExportAbortController = null;
      $('#closeBatchExportBtn').disabled = false;
      $('#cancelBatchExportBtn').disabled = false;
      $('#cancelBatchExportBtn').textContent = '关闭';
      $('#startBatchExportBtn').disabled = true;
      $('#startBatchExportBtn').textContent = '导出失败';
      $('#batchExportProgressTitle').textContent = '批量导出失败';
      $('#batchExportProgressCopy').textContent = error && error.message ? error.message : String(error);
    });
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
