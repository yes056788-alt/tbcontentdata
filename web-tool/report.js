(function () {
  'use strict';

  if (window.self !== window.top && new URLSearchParams(location.search).get('embed') === '1') {
    document.documentElement.classList.add('embedded-view');
  }

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const STATUS_KEY = 'taobaoContentDiagnosisReportStatusV1';
  const REPORT_KEY = 'taobaoContentDiagnosisReportV1';
  const WXT_KEY = 'taobaoContentDiagnosisWxtReportV1';
  const XHS_STATUS_KEY = 'xhsCollectionStatusV1';
  const XHS_ANALYSIS_KEY = 'xhsAnalysisSnapshotV1';
  const XHS_DETAIL_KEY_PREFIX = 'xhsAnalysisDetailChunkV1:';
  const STORAGE_KEYS = [STATUS_KEY, REPORT_KEY, WXT_KEY, XHS_STATUS_KEY, XHS_ANALYSIS_KEY];
  const SEARCH_PARAMS = new URLSearchParams(location.search);
  const ARCHIVE_RUN_ID = SEARCH_PARAMS.get('archive') || '';
  const BUILDER_MODE = SEARCH_PARAMS.get('builder') === '1';
  const STEPS = [
    { key: 'sycm', name: '生意参谋流量诊断' },
    { key: 'guanghe', name: '光合渠道与资产诊断' },
    { key: 'wxtMarketing', name: '万相台营销场景报告' },
    { key: 'wxtShortVideo', name: '万相台短视频诊断' },
    { key: 'dmp', name: '内容人群画像诊断' },
    { key: 'xiaohongshu', name: '小红书三平台并行取数与对齐' },
  ];
  const GH_CHANNELS = ['全部', '首猜', '逛逛', '搜索', '其他'];
  const GH_ASSETS = [
    { code: 'all', name: '全部资产' },
    { code: 'self', name: '自制内容' },
    { code: 'business', name: '达人合作内容' },
    { code: 'ugc', name: '其他用户内容' },
  ];
  const REFERENCES = {
    shortVideoShare: 0.60,
    seedingShare: 0.10,
    ratioGap: 6,
    recommendedShare: 0.70,
  };
  const DMP_CROWDS = [
    { role: 'tt', name: '淘天内容人群资产', color: '#0b67d1' },
    { role: 'store', name: '全店人群资产', color: '#e66a12' },
    { role: 'xhs', name: '小红书内容人群资产', color: '#07947d' },
    { role: 'xhsVisit', name: '小红书进店人群', color: '#d13c5a' },
  ];
  const XHS_PLATFORMS = [
    { key: 'adstar', name: '淘宝星河', mountId: 'adstarReport', contextId: 'adstarContext' },
    { key: 'pgy', name: '蒲公英', mountId: 'pgyReport', contextId: 'pgyContext' },
    { key: 'juguang', name: '聚光', mountId: 'juguangReport', contextId: 'juguangContext' },
  ];
  const XHS_REPORT_SECTION_KEYS = XHS_PLATFORMS.map((platform) => platform.key);
  const XHS_TERMINAL_PLATFORM_STATUSES = new Set([
    'complete', 'verified_no_spend', 'partial', 'failed', 'cancelled', 'missing',
  ]);
  const XHS_VIEWABLE_PLATFORM_STATUSES = new Set(['complete', 'verified_no_spend', 'partial']);

  function isXhsDetailKey(value) {
    const key = String(value == null ? '' : value);
    return key.startsWith(XHS_DETAIL_KEY_PREFIX) && /^\d{4,6}$/.test(
      key.slice(XHS_DETAIL_KEY_PREFIX.length)
    );
  }

  function xhsDetailKeys(snapshot) {
    const manifest = snapshot && typeof snapshot === 'object' && snapshot.detailArchive;
    if (!manifest || manifest.schema !== 'xhsAnalysisDetailManifestV1' ||
        !Array.isArray(manifest.chunks)) return [];
    return manifest.chunks.slice(0, 4096).map((chunk) => String(chunk && chunk.key || ''))
      .filter((key, index, keys) => isXhsDetailKey(key) && keys.indexOf(key) === index);
  }

  function xhsDetailHash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function setXhsDetailRows(snapshot, kind, rows, sourceCount) {
    const values = Array.isArray(rows) ? rows : [];
    if (kind === 'pgyFacts') snapshot.pgy.facts = values;
    else if (kind === 'spotlightDaily') snapshot.spotlight.daily = values;
    else if (kind === 'starProjects') snapshot.star.projects = values;
    else if (kind === 'starOrders') snapshot.star.orders = values;
    else if (kind === 'starUnassignedNotes') snapshot.star.unassignedNotes = values;
    else if (kind === 'actions') snapshot.actions = values;
    else if (kind === 'notes') snapshot.notes = values;
    const omitted = Number(sourceCount) > values.length;
    if (kind === 'pgyFacts') snapshot.pgy.factsOmitted = omitted;
    else if (kind === 'spotlightDaily') snapshot.spotlight.dailyOmitted = omitted;
    else if (kind === 'starProjects') snapshot.star.projectsOmitted = omitted;
    else if (kind === 'starOrders') snapshot.star.ordersOmitted = omitted;
    else if (kind === 'starUnassignedNotes') snapshot.star.unassignedNotesOmitted = omitted;
    else if (kind === 'actions') snapshot.actionsOmitted = omitted;
    else if (kind === 'notes') snapshot.notesOmitted = omitted;
  }

  function hydrateXhsDetails(input, values) {
    if (!input || typeof input !== 'object') return input;
    const snapshot = JSON.parse(JSON.stringify(input));
    const manifest = snapshot.detailArchive;
    if (!manifest || manifest.schema !== 'xhsAnalysisDetailManifestV1' ||
        !Array.isArray(manifest.chunks)) return snapshot;
    const knownKinds = [
      'pgyFacts', 'spotlightDaily', 'starProjects', 'starOrders',
      'starUnassignedNotes', 'actions', 'notes',
    ];
    const rows = Object.fromEntries(knownKinds.map((kind) => [kind, []]));
    const failures = Object.fromEntries(knownKinds.map((kind) => [kind, false]));
    const missingKeys = [];
    const invalidKeys = [];
    manifest.chunks.slice(0, 4096).sort((left, right) => (
      Number(left && left.index) - Number(right && right.index)
    )).forEach((descriptor) => {
      const key = String(descriptor && descriptor.key || '');
      const kind = String(descriptor && descriptor.kind || '');
      const chunk = values && values[key];
      if (!isXhsDetailKey(key) || !knownKinds.includes(kind) || !chunk) {
        if (chunk) invalidKeys.push(key);
        else missingKeys.push(key);
        if (knownKinds.includes(kind)) failures[kind] = true;
        return;
      }
      const serialized = JSON.stringify(chunk);
      const valid = chunk.schema === 'xhsAnalysisDetailChunkV1' &&
        String(chunk.runId == null ? '' : chunk.runId) === String(snapshot.runId == null ? '' : snapshot.runId) &&
        Number(chunk.index) === Number(descriptor.index) && chunk.kind === kind &&
        Array.isArray(chunk.items) && chunk.items.length === Number(descriptor.count) &&
        new TextEncoder().encode(serialized).byteLength === Number(descriptor.bytes) &&
        xhsDetailHash(serialized) === String(descriptor.hash || '');
      if (!valid) {
        invalidKeys.push(key);
        failures[kind] = true;
        return;
      }
      rows[kind].push(...chunk.items);
    });
    knownKinds.forEach((kind) => {
      const section = manifest.sections && manifest.sections[kind] || {};
      const sourceCount = Number(section.sourceCount) || 0;
      const storedCount = Number(section.storedCount) || 0;
      if ((!failures[kind] && Number(section.omittedCount) === 0 &&
          rows[kind].length === storedCount && storedCount === sourceCount) || sourceCount === 0) {
        setXhsDetailRows(snapshot, kind, rows[kind], sourceCount);
      }
    });
    const complete = manifest.complete === true && !missingKeys.length && !invalidKeys.length;
    snapshot.detailArchive.load = { complete, missingKeys, invalidKeys };
    if (!complete) {
      if (!snapshot.quality || typeof snapshot.quality !== 'object') {
        snapshot.quality = { decisionReady: false, issues: [] };
      }
      if (!Array.isArray(snapshot.quality.issues)) snapshot.quality.issues = [];
      if (!snapshot.quality.issues.some((issue) => issue && issue.code === 'xhs_detail_chunk_missing')) {
        snapshot.quality.issues.push({
          severity: 'warning',
          code: 'xhs_detail_chunk_missing',
          message: '汇总数据可用，部分小红书明细分片缺失或未通过完整性校验。',
        });
      }
    }
    return snapshot;
  }

  let bridgeConnected = false;
  let bridgeVersion = '';
  let requestSequence = 0;
  let scheduledLoad = null;
  let transientNotice = '';
  let reportStatus = {};
  let reportData = null;
  let wxtReport = null;
  let xhsStatus = {};
  let xhsAnalysis = null;
  let archiveRun = null;
  let activeSection = 'flow';
  let guangheView = 'channel';
  let xhsJuguangMode = 'multi';
  let xhsJuguangGroupBy = ['account', 'marketingObjective', 'placementType'];
  let xhsJuguangMultiGroupBy = ['account', 'marketingObjective', 'placementType'];
  let xhsJuguangFilters = {
    accountIds: [],
    marketingObjectives: [],
    placementTypes: [],
  };
  let xhsNoteFilters = {
    projectId: '',
    taskId: '',
    spuName: '',
    from: '',
    to: '',
  };
  let xhsNoteExpanded = false;
  let xhsNoteSnapshotKey = '';
  let xhsStarFilters = { projectId: '', taskId: '' };
  let xhsStarExpanded = { project: false, task: false };
  let xhsStarSnapshotKey = '';
  let xhsPgyDateRange = { from: '', to: '' };
  let xhsPgySpuName = '';
  let xhsPgyProjectName = '';
  let xhsPgyNoteExpanded = false;
  let xhsPgySnapshotKey = '';
  const pendingRequests = new Map();
  const expanded = {
    channel: new Set(),
    asset: new Set(),
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/[,，¥￥\s]/g, '').replace(/%$/, ''));
    if (!Number.isFinite(number)) return null;
    return /%$/.test(String(value)) ? number / 100 : number;
  }

  function divide(numerator, denominator) {
    const top = asNumber(numerator);
    const bottom = asNumber(denominator);
    if (top === null || bottom === null || bottom === 0) return null;
    return top / bottom;
  }

  function formatInteger(value) {
    const number = asNumber(value);
    return number === null ? '—' : Math.round(number).toLocaleString('zh-CN');
  }

  function formatMoney(value) {
    const number = asNumber(value);
    if (number === null) return '—';
    return '¥' + number.toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function formatPercent(value, digits) {
    const number = asNumber(value);
    if (number === null) return '—';
    return (number * 100).toLocaleString('zh-CN', {
      minimumFractionDigits: Number(digits == null ? 1 : digits),
      maximumFractionDigits: Number(digits == null ? 1 : digits),
    }) + '%';
  }

  function formatDecimal(value, digits) {
    const number = asNumber(value);
    if (number === null) return '—';
    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: Number(digits == null ? 2 : digits),
      maximumFractionDigits: Number(digits == null ? 2 : digits),
    });
  }

  function formatDateTime(value) {
    const time = Number(value);
    return Number.isFinite(time) && time > 0 ? new Date(time).toLocaleString('zh-CN') : '';
  }

  function updateConnection(connected, version, message) {
    bridgeConnected = Boolean(connected);
    if (version) bridgeVersion = String(version);
    const state = document.getElementById('connectionState');
    state.className = 'connection-state ' + (bridgeConnected ? 'connected' : 'disconnected');
    state.textContent = bridgeConnected ? '数据助手已连接' : (message || '数据助手未连接');
    document.getElementById('extensionVersion').textContent = bridgeVersion ? 'v' + bridgeVersion : '';
    updateButtons();
  }

  function requestBridge(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'tb-report-' + Date.now().toString(36) + '-' + (++requestSequence).toString(36);
      const timeout = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('未连接淘宝数据助手，请重载扩展后刷新本页。'));
      }, Number(timeoutMs) || 15000);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      window.postMessage({
        channel: CHANNEL,
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      }, location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === 'ready') {
      updateConnection(true, message.version || '', '', message.capabilities);
      if (!BUILDER_MODE) scheduleLoad();
      return;
    }
    if (message.type === 'storageChanged') {
      updateConnection(true, message.version || '', '', message.capabilities);
      if (!BUILDER_MODE && (message.keys || []).some((key) => STORAGE_KEYS.includes(key))) scheduleLoad();
      return;
    }
    if (message.type !== 'response' || !message.requestId) return;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingRequests.delete(message.requestId);
    if (message.ok) {
      updateConnection(true, message.version || '', '', message.capabilities);
      pending.resolve(message.data);
    } else {
      pending.reject(new Error(message.message || '数据助手请求失败。'));
    }
  });

  function scheduleLoad() {
    if (scheduledLoad) window.clearTimeout(scheduledLoad);
    scheduledLoad = window.setTimeout(() => {
      scheduledLoad = null;
      loadReport();
    }, 160);
  }

  async function loadReport() {
    try {
      if (ARCHIVE_RUN_ID) {
        const response = await requestBridge('getStoreRun', { runId: ARCHIVE_RUN_ID }, 45000);
        const run = response && response.run;
        if (!run || typeof run !== 'object' || run.runId !== ARCHIVE_RUN_ID) {
          throw new Error('未找到这条店铺历史归档。');
        }
        applyArchiveRun(run);
      } else {
        const stored = await requestBridge('getStorage', { keys: STORAGE_KEYS }, 30000);
        reportStatus = stored && stored[STATUS_KEY] || {};
        reportData = stored && stored[REPORT_KEY] || null;
        wxtReport = stored && stored[WXT_KEY] || null;
        xhsStatus = stored && stored[XHS_STATUS_KEY] || {};
        const baseAnalysis = stored && stored[XHS_ANALYSIS_KEY] || null;
        const detailKeys = xhsDetailKeys(baseAnalysis);
        const detailValues = detailKeys.length
          ? await requestBridge('getStorage', { keys: detailKeys }, 45000)
          : {};
        xhsAnalysis = hydrateXhsDetails(baseAnalysis, detailValues);
        archiveRun = null;
      }
      if (reportStatus.running || reportStatus.finishedAt || reportStatus.error) transientNotice = '';
      render();
    } catch (error) {
      updateConnection(false, '', error.message);
      document.getElementById('reportNotice').textContent = error.message;
    }
  }

  function applyArchiveRun(run) {
    if (!run || typeof run !== 'object' || !run.runId) throw new Error('店铺历史归档无效。');
    const snapshots = run.snapshots && typeof run.snapshots === 'object' ? run.snapshots : {};
    reportStatus = snapshots[STATUS_KEY] || {};
    reportData = snapshots[REPORT_KEY] || null;
    wxtReport = snapshots[WXT_KEY] || null;
    xhsStatus = snapshots[XHS_STATUS_KEY] || {};
    xhsAnalysis = hydrateXhsDetails(snapshots[XHS_ANALYSIS_KEY] || null, snapshots);
    archiveRun = run;
  }

  function reportIsRunning() {
    if (!reportStatus || reportStatus.running !== true) return false;
    const updatedAt = Number(reportStatus.updatedAt || reportStatus.startedAt);
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 25 * 60 * 1000;
  }

  function updateButtons() {
    const hasData = Boolean(reportData) || sectionHasData('flow') || sectionHasData('guanghe') ||
      sectionHasData('wxt') || sectionHasData('shortVideo') || sectionHasData('dmp') ||
      XHS_REPORT_SECTION_KEYS.some((section) => sectionHasData(section));
    const refresh = document.getElementById('refreshReportBtn');
    const exportButton = document.getElementById('exportReportBtn');
    const clear = document.getElementById('clearReportBtn');
    if (refresh) refresh.disabled = !bridgeConnected;
    if (exportButton) exportButton.disabled = !hasData;
    if (clear) clear.disabled = !bridgeConnected || (
      !reportData && !wxtReport && !xhsAnalysis &&
      !Object.keys(reportStatus || {}).length && !Object.keys(xhsStatus || {}).length
    );
  }

  function resultByKey(key) {
    const results = Array.isArray(reportStatus && reportStatus.results)
      ? reportStatus.results
      : (Array.isArray(reportData && reportData.results) ? reportData.results : []);
    return results.find((item) => item && item.key === key) || null;
  }

  function renderProgress() {
    const running = reportIsRunning();
    const results = STEPS.map((step) => resultByKey(step.key));
    const finishedCount = results.filter(Boolean).length;
    const currentName = String(reportStatus && reportStatus.currentStep || '');
    const activeNames = new Set(
      Array.isArray(reportStatus && reportStatus.activeSteps)
        ? reportStatus.activeSteps.map(String)
        : (currentName ? [currentName] : [])
    );
    const progress = running
      ? Math.min(97, (finishedCount + Math.min(activeNames.size * 0.34, STEPS.length - finishedCount)) /
        STEPS.length * 100)
      : (finishedCount ? finishedCount / STEPS.length * 100 : 0);
    document.getElementById('reportProgressBar').style.width = progress.toFixed(2) + '%';
    document.getElementById('reportSteps').innerHTML = STEPS.map((step, index) => {
      const result = results[index];
      const isCurrent = running && activeNames.has(step.name) && !result;
      const state = result
        ? (result.skipped ? 'skipped' : (!result.ok ? 'failed' : (result.partial ? 'partial' : 'success')))
        : (isCurrent ? 'running' : 'waiting');
      const label = result
        ? (result.skipped ? '跳过' : (!result.ok ? '失败' : (result.partial ? '部分完成' : '完成')))
        : (isCurrent ? '进行中' : '等待');
      const detail = result && result.message ? result.message : (isCurrent ? '正在打开平台并读取数据' : '尚未开始');
      return '<div class="report-step ' + state + '">' +
        '<span class="report-step-index">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<div class="report-step-copy"><strong>' + escapeHtml(step.name) + '</strong>' +
        '<span title="' + escapeHtml(detail) + '">' + escapeHtml(detail) + '</span></div>' +
        '<b>' + label + '</b></div>';
    }).join('');
    const copy = document.getElementById('reportRunCopy');
    copy.textContent = running
      ? '正在并行生成：' + (Array.from(activeNames).join('、') || '准备报告任务')
      : '淘宝任务与小红书三源同时启动；三源统一对齐后发布各来源结果';
  }

  function sectionResultKey(section) {
    if (section === 'flow') return 'sycm';
    if (section === 'guanghe') return 'guanghe';
    if (section === 'wxt') return 'wxtMarketing';
    if (section === 'shortVideo') return 'wxtShortVideo';
    if (section === 'xiaohongshu' || XHS_REPORT_SECTION_KEYS.includes(section)) return 'xiaohongshu';
    return 'dmp';
  }

  function xhsPlatformDefinition(section) {
    return XHS_PLATFORMS.find((platform) => platform.key === section) || null;
  }

  function xhsPlatformState(section) {
    if (!xhsStatusBelongsToCurrentReport()) return {};
    const platforms = xhsStatus && xhsStatus.platforms && typeof xhsStatus.platforms === 'object'
      ? xhsStatus.platforms : {};
    return platforms[section] && typeof platforms[section] === 'object' ? platforms[section] : {};
  }

  function xhsPlatformSelected(section) {
    const reportScope = currentReportRunScope();
    if (reportScope.runId) {
      if (Array.isArray(reportStatus && reportStatus.platforms)) {
        return reportStatus.platforms.map(String).filter((platform) => (
          XHS_REPORT_SECTION_KEYS.includes(platform)
        )).includes(section);
      }
      if (reportScope.synchronized && Array.isArray(reportData && reportData.platforms)) {
        return reportData.platforms.map(String).filter((platform) => (
          XHS_REPORT_SECTION_KEYS.includes(platform)
        )).includes(section);
      }
    }
    const selected = Array.isArray(xhsAnalysis && xhsAnalysis.selectedPlatforms)
      ? xhsAnalysis.selectedPlatforms.map(String)
      : [];
    if (selected.length) return selected.includes(section);
    const reportPlatforms = Array.isArray(reportData && reportData.platforms)
      ? reportData.platforms.map(String)
      : [];
    if (reportPlatforms.some((platform) => XHS_REPORT_SECTION_KEYS.includes(platform))) {
      return reportPlatforms.includes(section);
    }
    const states = xhsStatus && xhsStatus.platforms && typeof xhsStatus.platforms === 'object'
      ? xhsStatus.platforms : {};
    return Object.prototype.hasOwnProperty.call(states, section) || Boolean(xhsAnalysis);
  }

  function currentReportRunScope() {
    const statusRunId = String(reportStatus && reportStatus.runId || '');
    const dataRunId = String(reportData && reportData.runId || '');
    return {
      runId: statusRunId || dataRunId,
      synchronized: !(statusRunId && dataRunId && statusRunId !== dataRunId),
    };
  }

  function xhsRunBelongsToCurrentReport(runId) {
    const scope = currentReportRunScope();
    if (!scope.synchronized) return false;
    if (!scope.runId) return true;
    const childRunId = String(runId || '');
    const embeddedRunId = String(
      reportData && reportData.xiaohongshu && reportData.xiaohongshu.runId || ''
    );
    if (embeddedRunId) return Boolean(childRunId) && childRunId === embeddedRunId;
    if (archiveRun) return true;
    return Boolean(childRunId) && childRunId.startsWith(scope.runId + '-xhs-attempt-');
  }

  function xhsStatusBelongsToCurrentReport() {
    return xhsRunBelongsToCurrentReport(String(xhsStatus && xhsStatus.runId || ''));
  }

  function requestedXhsPlatformsForSnapshot() {
    if (xhsStatusBelongsToCurrentReport() && Array.isArray(xhsStatus && xhsStatus.requestedPlatforms)) {
      return xhsStatus.requestedPlatforms.map(String).filter((platform) => (
        XHS_REPORT_SECTION_KEYS.includes(platform)
      ));
    }
    if (xhsRunBelongsToCurrentReport(String(xhsAnalysis && xhsAnalysis.runId || '')) &&
        Array.isArray(xhsAnalysis && xhsAnalysis.selectedPlatforms)) {
      return xhsAnalysis.selectedPlatforms.map(String).filter((platform) => (
        XHS_REPORT_SECTION_KEYS.includes(platform)
      ));
    }
    const selectedByReport = XHS_REPORT_SECTION_KEYS.filter(xhsPlatformSelected);
    if (selectedByReport.length) return selectedByReport;
    const states = xhsStatusBelongsToCurrentReport() && xhsStatus && xhsStatus.platforms &&
      typeof xhsStatus.platforms === 'object' ? xhsStatus.platforms : {};
    return XHS_REPORT_SECTION_KEYS.filter((platform) => Object.prototype.hasOwnProperty.call(states, platform));
  }

  function validXhsAnalysisSnapshot() {
    if (!xhsAnalysis) return false;
    if (xhsStatus && xhsStatus.running === true) return false;
    const reportScope = currentReportRunScope();
    if (!reportScope.synchronized) return false;
    const statusRunId = String(xhsStatus && xhsStatus.runId || '');
    const analysisRunId = String(xhsAnalysis && xhsAnalysis.runId || '');
    if (reportScope.runId && !archiveRun && (!statusRunId || !analysisRunId)) return false;
    if (!xhsRunBelongsToCurrentReport(statusRunId) || !xhsRunBelongsToCurrentReport(analysisRunId)) return false;
    if (statusRunId && analysisRunId && statusRunId !== analysisRunId) return false;
    const requested = requestedXhsPlatformsForSnapshot();
    const states = xhsStatus && xhsStatus.platforms && typeof xhsStatus.platforms === 'object'
      ? xhsStatus.platforms : {};
    return requested.length > 0 && requested.every((platform) => {
      if (!Object.prototype.hasOwnProperty.call(states, platform)) return false;
      return XHS_TERMINAL_PLATFORM_STATUSES.has(String(states[platform] && states[platform].status || ''));
    });
  }

  function validWxtSnapshot() {
    return Boolean(wxtReport && reportData && wxtReport.runId === reportData.runId);
  }

  function sectionHasData(section) {
    if (XHS_REPORT_SECTION_KEYS.includes(section)) {
      if (!validXhsAnalysisSnapshot() || !xhsPlatformSelected(section)) return false;
      const status = String(xhsPlatformState(section).status || '');
      return XHS_VIEWABLE_PLATFORM_STATUSES.has(status);
    }
    if (section === 'xiaohongshu') return validXhsAnalysisSnapshot();
    if (section === 'flow') return Boolean(reportData && reportData.sycm && reportData.guanghe);
    if (section === 'guanghe') return Boolean(reportData && reportData.guanghe);
    if (section === 'wxt') return Boolean(validWxtSnapshot() && wxtReport.marketing && wxtReport.marketing.ok);
    if (section === 'shortVideo') {
      return Boolean(validWxtSnapshot() && wxtReport.shortVideo && wxtReport.shortVideo.ok);
    }
    return Boolean(reportData && reportData.dmp && Array.isArray(reportData.dmp.results) &&
      reportData.dmp.results.length);
  }

  function sectionError(section) {
    if (XHS_REPORT_SECTION_KEYS.includes(section)) {
      const platform = xhsPlatformDefinition(section);
      if (!xhsPlatformSelected(section)) return '';
      const validSnapshot = validXhsAnalysisSnapshot();
      const result = resultByKey('xiaohongshu');
      if (!validSnapshot && result && result.ok === false) {
        return result.message || platform.name + '未生成可用的分析快照。';
      }
      if (!xhsStatusBelongsToCurrentReport()) return '';
      const state = xhsPlatformState(section);
      const status = String(state.status || 'missing');
      if (status === 'failed') return platform.name + '取数失败，请展开技术详情后重试。';
      if (status === 'cancelled') return platform.name + '取数已取消。';
      if (!validSnapshot && result && ['failed', 'partial'].includes(String(xhsStatus && xhsStatus.status || ''))) {
        return platform.name + '报告未生成，请修复失败来源后重试。';
      }
      if (status === 'partial') return platform.name + '数据仅部分完成，请核对质量提示。';
      return '';
    }
    if (section === 'xiaohongshu') {
      const result = resultByKey('xiaohongshu');
      if (!xhsAnalysis && result && result.ok === false) {
        return result.message || '小红书三平台取数未生成可用的分析快照。';
      }
      if (!xhsAnalysis && xhsStatus && xhsStatus.status === 'failed') {
        return '小红书三平台取数失败，请修复失败来源后重试。';
      }
      if (!xhsAnalysis && xhsStatus && xhsStatus.status === 'partial') {
        return '小红书三平台仅部分完成，分析快照未生成，请补齐失败来源后重试。';
      }
      return '';
    }
    const result = resultByKey(sectionResultKey(section));
    if (result && result.ok === false) return result.message || '本章节生成失败。';
    if (section === 'flow') {
      const ghResult = resultByKey('guanghe');
      if (ghResult && ghResult.ok === false) return '流量诊断需要光合内容指标：' + ghResult.message;
    }
    if (validWxtSnapshot() && (section === 'wxt' || section === 'shortVideo')) {
      const block = section === 'wxt' ? wxtReport.marketing : wxtReport.shortVideo;
      if (block && block.ok === false) return block.message || '本章节生成失败。';
    }
    return '';
  }

  function renderNotice() {
    const notice = document.getElementById('reportNotice');
    if (transientNotice) {
      notice.textContent = transientNotice;
      return;
    }
    if (reportIsRunning()) {
      notice.textContent = '报告任务正在后台执行；小红书三源全部结束后才会一起发布星河、蒲公英和聚光报告。';
      return;
    }
    if (reportStatus && reportStatus.error) {
      notice.textContent = reportStatus.error;
      return;
    }
    const results = STEPS.map((step) => resultByKey(step.key)).filter(Boolean);
    const failures = results.filter((item) => !item.ok);
    const partials = results.filter((item) => item.ok && item.partial);
    const messages = [];
    if (failures.length) {
      messages.push('部分章节未生成：' + failures.map((item) => (
        item.name + '（' + (item.message || '未返回数据') + '）'
      )).join('；'));
    }
    if (partials.length) {
      messages.push('部分章节数据不完整：' + partials.map((item) => (
        item.name + (item.message ? '（' + item.message + '）' : '')
      )).join('；'));
    }
    notice.textContent = messages.join('；');
  }

  function renderTabs() {
    document.querySelectorAll('.report-tab').forEach((button) => {
      const section = button.getAttribute('data-section');
      button.classList.toggle('active', section === activeSection);
      button.classList.toggle('has-data', sectionHasData(section));
      button.classList.toggle('has-error', Boolean(sectionError(section)));
    });
  }

  function dateDescription(value) {
    const candidates = [];
    if (value && typeof value === 'object') {
      ['visibleRange', 'rangeText', 'dateRange', 'text', 'label'].forEach((key) => {
        if (value[key]) candidates.push(String(value[key]));
      });
      Object.values(value).forEach((item) => {
        if (typeof item === 'string' || typeof item === 'number') candidates.push(String(item));
      });
    } else if (value) {
      candidates.push(String(value));
    }
    const text = candidates.join(' ');
    const dates = text.match(/\d{4}[./-]\d{2}[./-]\d{2}/g) || [];
    if (dates.length >= 2) return dates[0] + ' 至 ' + dates[dates.length - 1];
    if (dates.length === 1) return dates[0];
    return text || '最近30个完整自然日';
  }

  function metricClass(value, reference) {
    const number = asNumber(value);
    return number !== null && number >= reference ? 'good' : 'watch';
  }

  function flowModel() {
    const traffic = reportData && reportData.sycm || {};
    const guanghe = reportData && reportData.guanghe || {};
    const rows = Array.isArray(guanghe.rows) ? guanghe.rows : [];
    const total = rows.find((row) => row.channel === '全部' && row.assetCode === 'all') || {};
    const shortShare = divide(traffic.shortVideoVisitors, traffic.storeVisitors);
    const removedMicroVisitors = asNumber(traffic.productVisitors) !== null && asNumber(traffic.microDetailVisitors) !== null
      ? asNumber(traffic.productVisitors) - asNumber(traffic.microDetailVisitors)
      : null;
    const recommendedShare = removedMicroVisitors === null
      ? asNumber(traffic.recommendedTrafficShare)
      : divide(asNumber(traffic.storeVisitors) - removedMicroVisitors, traffic.storeVisitors);
    const seedingShare = asNumber(guanghe.seedingGmvShare);
    return {
      traffic,
      guanghe,
      total,
      shortShare,
      removedMicroVisitors,
      recommendedShare,
      seedingShare,
      ratioGap: divide(shortShare, seedingShare),
    };
  }

  function buildFlowMarkup() {
    if (!sectionHasData('flow')) return '';
    const model = flowModel();
    const rows = [
      ['访问店铺访客数', formatInteger(model.traffic.storeVisitors), '—', '生意参谋流量页', ''],
      ['短视频访客数', formatInteger(model.traffic.shortVideoVisitors), '—', '生意参谋流量页', ''],
      ['短视频访客数占比', formatPercent(model.shortShare), formatPercent(REFERENCES.shortVideoShare), '短视频访客数 / 访问店铺访客数', metricClass(model.shortShare, REFERENCES.shortVideoShare)],
      ['种草成交金额', formatMoney(model.total.seedingAmount), '—', '光合资产总览', ''],
      ['种草成交金额占比全店', formatPercent(model.seedingShare), formatPercent(REFERENCES.seedingShare), '光合资产总览 30 日口径', metricClass(model.seedingShare, REFERENCES.seedingShare)],
      ['率值倍差', formatDecimal(model.ratioGap, 1), String(REFERENCES.ratioGap), '短视频访客占比 / 种草成交金额占比', metricClass(model.ratioGap, REFERENCES.ratioGap)],
      ['商品访客数', formatInteger(model.traffic.productVisitors), '—', '生意参谋流量页', ''],
      ['商品微详情访客数', formatInteger(model.traffic.microDetailVisitors), '—', '生意参谋流量页', ''],
      ['剔除微详情访客数', formatInteger(model.removedMicroVisitors), '—', '商品访客数 - 商品微详情访客数', ''],
      ['推荐流量占比', formatPercent(model.recommendedShare), formatPercent(REFERENCES.recommendedShare), '（店铺访客数 - 剔除微详情访客数）/ 店铺访客数', metricClass(model.recommendedShare, REFERENCES.recommendedShare)],
    ];
    return '<div class="report-table-block"><table><thead><tr><th>指标</th><th>数值</th><th>参考</th><th>来源 / 公式</th></tr></thead><tbody>' +
      rows.map((row) => '<tr><td>' + escapeHtml(row[0]) + '</td><td class="metric-result ' + row[4] + '">' +
        escapeHtml(row[1]) + '</td><td>' + escapeHtml(row[2]) + '</td><td>' + escapeHtml(row[3]) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function findGuangheRow(channel, assetCode) {
    const rows = reportData && reportData.guanghe && Array.isArray(reportData.guanghe.rows)
      ? reportData.guanghe.rows
      : [];
    return rows.find((row) => row.channel === channel && row.assetCode === assetCode) || null;
  }

  function guangheHighest(rows, getter) {
    const values = (rows || []).map(getter).filter(Number.isFinite);
    return values.length ? Math.max.apply(null, values) : null;
  }

  function guangheIsHighest(row, peerRows, getter) {
    const value = getter(row);
    const highest = guangheHighest(peerRows, getter);
    return Number.isFinite(value) && Number.isFinite(highest) && highest > 0 &&
      Math.abs(value - highest) < Math.max(1, Math.abs(highest)) * 1e-10;
  }

  function guangheMetricCell(text, best, label) {
    return '<td' + (best ? ' class="guanghe-best"' : '') + '>' + text +
      (best ? '<span class="guanghe-best-tag">' + escapeHtml(label || '最高') + '</span>' : '') +
      '</td>';
  }

  function guangheCells(row, baseline, assetView, peerRows) {
    const contentShare = divide(row.contentViewers, baseline.contentViewers);
    const clickShare = divide(row.productClickers, baseline.productClickers);
    const cartShare = divide(row.cartBuyers, baseline.cartBuyers);
    const buyerShare = divide(row.seedingBuyers, baseline.seedingBuyers);
    const aov = divide(row.seedingAmount, row.seedingBuyers);
    const uvValue = divide(row.seedingAmount, row.contentViewers);
    const shareGetter = (field) => (candidate) => divide(candidate[field], baseline[field]);
    const aovGetter = (candidate) => divide(candidate.seedingAmount, candidate.seedingBuyers);
    const uvValueGetter = (candidate) => divide(candidate.seedingAmount, candidate.contentViewers);
    const supply = assetView
      ? guangheMetricCell(formatInteger(row.publishedContents), false) +
        guangheMetricCell(formatInteger(row.publicContents), false) +
        guangheMetricCell(formatPercent(divide(row.publicContents, row.publishedContents), 1), false)
      : '';
    return supply +
      guangheMetricCell(formatInteger(row.contentViewers), false) +
      guangheMetricCell(
        formatPercent(contentShare),
        guangheIsHighest(row, peerRows, shareGetter('contentViewers')),
        '占比最高'
      ) +
      guangheMetricCell(formatPercent(row.paidTrafficShare), false) +
      guangheMetricCell(formatInteger(row.productClickers), false) +
      guangheMetricCell(
        formatPercent(clickShare),
        guangheIsHighest(row, peerRows, shareGetter('productClickers')),
        '占比最高'
      ) +
      guangheMetricCell(formatInteger(row.cartBuyers), false) +
      guangheMetricCell(
        formatPercent(cartShare),
        guangheIsHighest(row, peerRows, shareGetter('cartBuyers')),
        '占比最高'
      ) +
      guangheMetricCell(formatInteger(row.seedingBuyers), false) +
      guangheMetricCell(
        formatPercent(buyerShare),
        guangheIsHighest(row, peerRows, shareGetter('seedingBuyers')),
        '占比最高'
      ) +
      guangheMetricCell(formatMoney(row.seedingAmount), false) +
      guangheMetricCell(
        formatMoney(aov),
        guangheIsHighest(row, peerRows, aovGetter),
        '价值最高'
      ) +
      guangheMetricCell(
        formatDecimal(uvValue),
        guangheIsHighest(row, peerRows, uvValueGetter),
        '价值最高'
      );
  }

  function guangheHeader(assetView) {
    const supplyGroup = assetView ? '<th colspan="3">内容供给</th>' : '';
    const supplyColumns = assetView ? '<th>发布内容数</th><th>公域内容数</th><th>审核通过率</th>' : '';
    return '<thead><tr><th class="guanghe-dimension-head" rowspan="2">' +
      (assetView ? '资产' : '渠道') + '</th>' + supplyGroup +
      '<th colspan="3">内容查看人数</th><th colspan="2">商品点击人数</th>' +
      '<th colspan="2">商品加购人数</th><th colspan="2">种草成交人数</th><th colspan="3">价值</th></tr>' +
      '<tr>' + supplyColumns +
      '<th>人数</th><th>占比</th><th>付费占比</th>' +
      '<th>人数</th><th>占比</th><th>人数</th><th>占比</th>' +
      '<th>人数</th><th>占比</th><th>种草成交金额</th><th>客单价</th><th>UV价值</th>' +
      '</tr></thead>';
  }

  function buildGuangheRows(view, includeAllChildren, options) {
    const exportMode = Boolean(options && options.exportMode);
    const assetView = view === 'asset';
    const parentDefinitions = assetView
      ? GH_ASSETS.map((asset) => ({ key: asset.code, label: asset.name, row: findGuangheRow('全部', asset.code) }))
      : GH_CHANNELS.map((channel) => ({ key: channel, label: channel, row: findGuangheRow(channel, 'all') }));
    const parentPeers = parentDefinitions
      .filter((parent) => parent.row && parent.key !== (assetView ? 'all' : '全部'))
      .map((parent) => parent.row);
    return parentDefinitions.map((parent) => {
      if (!parent.row) return '';
      const children = assetView
        ? GH_CHANNELS.filter((channel) => channel !== '全部').map((channel) => ({
          label: channel,
          row: findGuangheRow(channel, parent.key),
        })).filter((item) => item.row)
        : GH_ASSETS.filter((asset) => asset.code !== 'all').map((asset) => ({
          label: asset.name,
          row: findGuangheRow(parent.key, asset.code),
        })).filter((item) => item.row);
      const childPeers = children.map((child) => child.row);
      const isExpanded = exportMode ? false : includeAllChildren || expanded[view].has(parent.key);
      const shouldRenderChildren = isExpanded || exportMode;
      const button = includeAllChildren || !children.length ? '' : '<button class="dimension-button" type="button" data-expand-view="' +
        view + '" data-expand-key="' + escapeHtml(parent.key) + '" data-expand-label="' +
        escapeHtml(parent.label) + '" aria-expanded="' + String(isExpanded) + '" aria-label="' +
        (isExpanded ? '收起' : '展开') + escapeHtml(parent.label) + '明细">' +
        (isExpanded ? '−' : '+') + '</button>';
      let markup = '<tr class="guanghe-parent"><td class="guanghe-dimension">' + button +
        '<strong>' + escapeHtml(parent.label) + '</strong></td>' +
        guangheCells(
          parent.row,
          findGuangheRow('全部', 'all') || parent.row,
          assetView,
          parent.key === (assetView ? 'all' : '全部') ? [] : parentPeers
        ) + '</tr>';
      if (shouldRenderChildren) {
        markup += children.map((child) => '<tr class="dimension-child' +
          (exportMode && !isExpanded ? ' export-collapsed-child' : '') +
          '" ' + (exportMode && !isExpanded ? 'hidden' : '') +
          ' data-export-parent-view="' + escapeHtml(view) +
          '" data-export-parent-key="' + escapeHtml(parent.key) + '">' +
          '<td class="guanghe-dimension">' +
          escapeHtml(child.label) + '</td>' +
          guangheCells(child.row, parent.row, assetView, childPeers) + '</tr>').join('');
      }
      return markup;
    }).join('');
  }

  function buildGuangheMarkup(view, includeAllChildren, options) {
    if (!reportData || !reportData.guanghe) return '';
    const assetView = view === 'asset';
    return '<div class="report-table-block"><table class="guanghe-table ' + (assetView ? 'asset-view' : '') + '">' +
      guangheHeader(assetView) + '<tbody>' + buildGuangheRows(view, includeAllChildren, options) + '</tbody></table></div>';
  }

  function renderFlow() {
    const target = document.getElementById('flowReport');
    const error = sectionError('flow');
    if (!sectionHasData('flow')) {
      target.innerHTML = '<div class="section-error"><strong>' + (error ? '流量诊断未生成' : '等待流量诊断') +
        '</strong><p>' + escapeHtml(error || '本章节完成后会自动显示。') + '</p></div>';
      return;
    }
    const model = flowModel();
    document.getElementById('flowContext').textContent =
      '流量：' + dateDescription(model.traffic.dateContext) + '；内容：' +
      dateDescription(model.guanghe.filterContext) + '。';
    target.innerHTML = buildFlowMarkup();
  }

  function renderGuanghe() {
    const target = document.getElementById('guangheReport');
    const error = sectionError('guanghe');
    if (!sectionHasData('guanghe')) {
      target.innerHTML = '<div class="section-error"><strong>' + (error ? '光合诊断未生成' : '等待光合诊断') +
        '</strong><p>' + escapeHtml(error || '本章节完成后会自动显示。') + '</p></div>';
      return;
    }
    const context = reportData.guanghe.filterContext || {};
    document.getElementById('guangheContext').textContent = Object.keys(context).length
      ? Object.entries(context).map(([key, value]) => key + '：' + value).join('；')
      : '最近30个完整自然日 · 光合资产总览接口';
    document.querySelectorAll('[data-guanghe-view]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-guanghe-view') === guangheView);
    });
    target.innerHTML = buildGuangheMarkup(guangheView, false);
  }

  function dmpResultsByRole() {
    const results = reportData && reportData.dmp && Array.isArray(reportData.dmp.results)
      ? reportData.dmp.results
      : [];
    return new Map(results.filter((item) => item && item.role).map((item) => [item.role, item]));
  }

  function dmpChartMatches(chart, kind) {
    const name = String(chart && chart.tagName || '');
    return kind === 'age' ? /年龄/.test(name) : /消费能力|购买力/.test(name);
  }

  function dmpChartFor(result, kind) {
    const charts = Array.isArray(result && result.charts) ? result.charts : [];
    return charts.find((chart) => dmpChartMatches(chart, kind)) || null;
  }

  function dmpRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/[%％,，\s]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function formatDmpRate(value) {
    const number = dmpRate(value);
    if (number === null) return '—';
    return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '%';
  }

  function formatDmpCount(value) {
    const number = asNumber(value);
    if (number !== null) return Math.round(number).toLocaleString('zh-CN');
    const text = String(value == null ? '' : value).trim();
    return text && !/^[-–—]+$/.test(text) ? text : '—';
  }

  function buildDmpTagModel(kind) {
    const byRole = dmpResultsByRole();
    const options = new Map();
    DMP_CROWDS.forEach((definition) => {
      const result = byRole.get(definition.role);
      const chart = dmpChartFor(result, kind);
      (Array.isArray(chart && chart.rows) ? chart.rows : []).forEach((row) => {
        const optionKey = String(row && (row.optionValue || row.optionName) || '');
        if (!optionKey) return;
        if (!options.has(optionKey)) {
          options.set(optionKey, {
            optionName: String(row.optionName || optionKey),
            rows: new Map(),
          });
        }
        options.get(optionKey).rows.set(definition.role, row);
      });
    });
    return Array.from(options.values()).sort((left, right) => {
      const maximum = (option) => Math.max(0, ...Array.from(option.rows.values()).map((row) => dmpRate(row.rate) || 0));
      return maximum(right) - maximum(left);
    });
  }

  function renderDmpTag(kind, title) {
    const options = buildDmpTagModel(kind);
    const maxRate = Math.max(1, ...options.flatMap((option) => (
      DMP_CROWDS.map((definition) => {
        const row = option.rows.get(definition.role);
        return row ? dmpRate(row.rate) || 0 : 0;
      })
    )));
    const body = options.length
      ? options.map((option) => '<tr><td>' + escapeHtml(option.optionName) + '</td>' +
        DMP_CROWDS.map((definition) => {
          const row = option.rows.get(definition.role);
          if (!row) return '<td class="dmp-data-cell empty-cell">—</td>';
          const rate = dmpRate(row.rate) || 0;
          const width = Math.max(rate > 0 ? 2 : 0, Math.min(100, rate / maxRate * 100));
          return '<td class="dmp-data-cell" style="--bar:' + width.toFixed(2) + '%;--bar-color:' +
            definition.color + '"><div class="dmp-cell-fill"></div><div class="dmp-cell-content"><strong>' +
            escapeHtml(formatDmpRate(row.rate)) + '</strong><span>人数 ' + escapeHtml(formatDmpCount(row.optionNum)) +
            ' · TGI ' + escapeHtml(row.tgi || '—') + '</span></div></td>';
        }).join('') + '</tr>').join('')
      : '<tr><td colspan="5" class="dmp-empty-row">该画像标签暂未返回分层数据</td></tr>';
    return '<section class="dmp-tag-section"><div class="dmp-tag-heading"><div><span>PORTRAIT TAG</span><h3>' +
      escapeHtml(title) + '</h3></div><b>四个人群对比</b></div><div class="dmp-table-wrap"><table class="dmp-table"><thead><tr><th>选项</th>' +
      DMP_CROWDS.map((definition) => '<th><i class="dmp-crowd-dot" style="background:' + definition.color + '"></i>' +
        escapeHtml(definition.name) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function dmpWarnings() {
    const snapshot = reportData && reportData.dmp || {};
    const byRole = dmpResultsByRole();
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.slice() : [];
    DMP_CROWDS.forEach((definition) => {
      const result = byRole.get(definition.role);
      if (!result) {
        warnings.push('未找到人群包：' + definition.name);
        return;
      }
      if (result.error) warnings.push(definition.name + '：' + result.error);
      (Array.isArray(result.warnings) ? result.warnings : []).forEach((warning) => {
        warnings.push(definition.name + '：' + warning);
      });
    });
    return Array.from(new Set(warnings.filter(Boolean)));
  }

  function buildDmpMarkup() {
    if (!sectionHasData('dmp')) return '';
    const byRole = dmpResultsByRole();
    const warnings = dmpWarnings();
    const warningMarkup = warnings.length
      ? '<div class="dmp-warning"><strong>部分画像未完整返回</strong><span>' +
        escapeHtml(warnings.join('；')) + '</span></div>'
      : '';
    return '<div class="dmp-report-body"><section class="dmp-crowd-summary"><div class="dmp-summary-heading"><div><span>DMP CROWD</span>' +
      '<h3>诊断人群</h3></div><b>' + byRole.size + '/4 已读取</b></div><div class="dmp-legend">' +
      DMP_CROWDS.map((definition) => {
        const result = byRole.get(definition.role);
        const crowd = result && result.crowd || {};
        return '<div class="dmp-legend-item' + (result ? '' : ' missing') + '"><i style="background:' + definition.color + '"></i>' +
          '<div><strong>' + escapeHtml(crowd.crowdName || definition.name) + '</strong><span>' +
          (result ? 'ID ' + escapeHtml(crowd.crowdId || '—') : '未找到对应人群包') + '</span></div><b>' +
          escapeHtml(result ? formatDmpCount(crowd.coverage) : '—') + '</b></div>';
      }).join('') + '</div></section>' + warningMarkup + renderDmpTag('age', '年龄') +
      renderDmpTag('consumer', '消费能力等级') + '</div>';
  }

  function renderDmp() {
    const target = document.getElementById('dmpReport');
    const error = sectionError('dmp');
    if (!sectionHasData('dmp')) {
      target.innerHTML = '<div class="section-error"><strong>' + (error ? '人群画像诊断未生成' : '等待人群画像诊断') +
        '</strong><p>' + escapeHtml(error || '本章节完成后会自动显示。') + '</p></div>';
      return;
    }
    const count = dmpResultsByRole().size;
    document.getElementById('dmpContext').textContent = '达摩盘 · 已读取 ' + count + '/4 个人群 · 年龄与消费能力等级';
    target.innerHTML = buildDmpMarkup();
  }

  function formatXhsTime(value) {
    const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '—';
  }

  function xhsStatusLabel(value) {
    return {
      running: '采集中',
      complete: '完整',
      partial: '部分完成',
      failed: '失败',
      cancelled: '已取消',
      verified_no_spend: '已验证无消耗',
    }[String(value || '')] || '未采集';
  }

  function redactXhsDiagnosticText(value) {
    let text = String(value == null ? '' : value).trim();
    if (!text) return '';
    text = text
      .replace(
        /(^|[^A-Za-z0-9_.-])(?:raw(?:body|data)?|headers?|request(?:url|uri)|url)\s*[:=]\s*(?:\{[^}]*\}|\[[^\]]*\]|"[^"]*"|'[^']*'|[^,;，；)>\]}]+)/gi,
        (_match, prefix) => prefix + '[敏感详情已隐藏]',
      )
      .replace(
        /(^|[^A-Za-z0-9_.-])(?:authorization\s*[:=]\s*)?bearer\s+[^\s,;，；)>\]}]+/gi,
        (_match, prefix) => prefix + '[凭据已隐藏]',
      )
      .replace(
        /(^|[^A-Za-z0-9_.-])(?:[A-Za-z0-9_.-]*(?:token|cookie|authorization|signature|password|passwd|credential)[A-Za-z0-9_.-]*|[A-Za-z0-9_.-]*secret(?:key|value)?|[A-Za-z0-9_.-]*sessionid|x-?sign|x-?s|sign|csrf[A-Za-z0-9_.-]*|set-?cookie|api[-_]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；)>\]}]+)/gi,
        (_match, prefix) => prefix + '[凭据已隐藏]',
      )
      .replace(/https?:\/\/[^\s<>"'，；。！？、）】}]+/gi, '[请求地址已隐藏]');
    return text.length > 260 ? text.slice(0, 259) + '…' : text;
  }

  function xhsDiagnosticRecords(state) {
    if (!state) return [];
    const status = String(state.status || '');
    const includeErrors = ['failed', 'partial'].includes(status);
    const includeWarnings = includeErrors || ['complete', 'verified_no_spend'].includes(status);
    if (!includeErrors && !includeWarnings) return [];
    const records = [];
    for (const [kind, fallbackCode, values] of [
      ['error', 'unknown_error', includeErrors ? state.errors : []],
      ['warning', 'warning', includeWarnings ? state.warnings : []],
    ]) {
      (Array.isArray(values) ? values : []).forEach((record) => {
        const item = record && typeof record === 'object' ? record : { message: record };
        const rawCode = String(item.code || fallbackCode).trim();
        const normalizedCode = redactXhsDiagnosticText(rawCode)
          .replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 80);
        const code = /[A-Za-z0-9]/.test(normalizedCode) ? normalizedCode : fallbackCode;
        const message = redactXhsDiagnosticText(item.message) || '未提供技术说明';
        records.push({ kind, code, message });
      });
    }
    return records;
  }

  function buildXhsDiagnosticMarkup(state) {
    const records = xhsDiagnosticRecords(state);
    if (!records.length) return '';
    return '<details class="xhs-source-diagnostics"><summary>技术详情（' + records.length + '）</summary><ul>' +
      records.map((record) => '<li data-xhs-diagnostic-kind="' + record.kind + '"><code>' +
        escapeHtml(record.code) + '</code><span>' + escapeHtml(record.message) + '</span></li>').join('') +
      '</ul></details>';
  }

  function buildXhsSourceCardsMarkup(analysis, platformKeys) {
    const snapshot = analysis && typeof analysis === 'object' ? analysis : {};
    const allowedPlatforms = Array.isArray(platformKeys) && platformKeys.length
      ? new Set(platformKeys.map(String)) : null;
    const platformStates = xhsStatusBelongsToCurrentReport() && xhsStatus && xhsStatus.platforms &&
      typeof xhsStatus.platforms === 'object'
      ? xhsStatus.platforms : {};
    const accountMeta = snapshot.accounts && typeof snapshot.accounts === 'object' ? snapshot.accounts : {};
    const sourceCards = XHS_PLATFORMS.filter((platform) => (
      !allowedPlatforms || allowedPlatforms.has(platform.key)
    )).map((platform) => {
      const state = platformStates[platform.key] && typeof platformStates[platform.key] === 'object'
        ? platformStates[platform.key] : {};
      const meta = accountMeta[platform.key] && typeof accountMeta[platform.key] === 'object'
        ? accountMeta[platform.key] : {};
      const collectedAt = state.collectedAt || state.finishedAt || state.updatedAt || meta.collectedAt;
      const accountKeys = Array.isArray(meta.accountKeys) ? meta.accountKeys : [];
      const accountLabel = String(state.accountLabel || '').trim() ||
        (accountKeys.length ? accountKeys.join('、') : '账号待识别');
      return '<article class="xhs-source-card" data-xhs-platform="' + platform.key + '"><span>' +
        escapeHtml(platform.key.toUpperCase()) + '</span><h3>' + escapeHtml(platform.name) + '</h3><strong>' +
        escapeHtml(xhsStatusLabel(state.status)) + '</strong><p>来源时间 / 采集时间：' +
        escapeHtml(formatXhsTime(collectedAt)) + '</p><small>' +
        escapeHtml(accountLabel) + '</small>' +
        buildXhsDiagnosticMarkup(state) + '</article>';
    }).join('');
    return '<section class="xhs-source-grid">' + sourceCards + '</section>';
  }

  function xhsObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function xhsArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function xhsFirstValue() {
    for (const value of arguments) {
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }

  function xhsHasOwn(value, key) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, key);
  }

  function xhsOwnOrFallback(value, key) {
    if (xhsHasOwn(value, key)) return value[key];
    return xhsFirstValue(...Array.prototype.slice.call(arguments, 2));
  }

  function normalizedXhsPgyDateRange(value) {
    const source = xhsObject(value);
    return {
      from: String(source.from || '').slice(0, 10),
      to: String(source.to || '').slice(0, 10),
    };
  }

  function currentShanghaiDate() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function xhsPgySnapshotIdentity(analysis, pgy) {
    const facts = Array.isArray(pgy.facts) ? pgy.facts : null;
    const defaultRange = normalizedXhsPgyDateRange(
      xhsHasOwn(pgy, 'defaultDateRange') ? pgy.defaultDateRange : analysis.dateRange
    );
    const firstFact = facts && facts.length ? xhsObject(facts[0]) : {};
    const lastFact = facts && facts.length ? xhsObject(facts[facts.length - 1]) : {};
    return [
      analysis.runId,
      analysis.generatedAt,
      pgy.collectedAt,
      pgy.latestPublishDate,
      defaultRange.from,
      defaultRange.to,
      facts ? facts.length : 'legacy',
      firstFact.noteId,
      lastFact.noteId,
    ].map((value) => String(value == null ? '' : value)).join('|');
  }

  function currentXhsPgyDateRange(analysis, pgy) {
    const identity = xhsPgySnapshotIdentity(analysis, pgy);
    if (identity !== xhsPgySnapshotKey) {
      xhsPgySnapshotKey = identity;
      xhsPgyDateRange = normalizedXhsPgyDateRange(
        xhsHasOwn(pgy, 'defaultDateRange') ? pgy.defaultDateRange : analysis.dateRange
      );
      xhsPgySpuName = '';
      xhsPgyProjectName = '';
      xhsPgyNoteExpanded = false;
    }
    return { ...xhsPgyDateRange };
  }

  function xhsPgyReportView(analysis, archivedPgy) {
    const factsAvailable = Array.isArray(archivedPgy.facts);
    const modelAvailable = Boolean(
      window.XhsReportModel && typeof window.XhsReportModel.aggregatePgyFacts === 'function'
    );
    const dateRange = currentXhsPgyDateRange(analysis, archivedPgy);
    let summary = archivedPgy;
    let aggregationError = '';
    if (factsAvailable && modelAvailable) {
      try {
        const input = {
          facts: archivedPgy.facts,
          dateRange,
          spuName: xhsPgySpuName,
          asOf: currentShanghaiDate(),
        };
        summary = window.XhsReportModel.aggregatePgyFacts(input);
        if (['partial', 'unavailable'].includes(String(archivedPgy.coverage || ''))) {
          summary = {
            ...summary,
            costs: { cooperation: null, platformFee: null, total: null },
            followerTiers: xhsArray(summary && summary.followerTiers).map((tier) => ({
              ...xhsObject(tier),
              averageCooperationCost: null,
            })),
          };
        }
      } catch (error) {
        aggregationError = String(error && error.message || error || '蒲公英日期聚合失败');
      }
    }
    return {
      aggregationError,
      dateRange,
      spuName: xhsPgySpuName,
      factsAvailable,
      modelAvailable,
      coverage: String(archivedPgy.coverage || ''),
      summary: xhsObject(summary),
    };
  }

  function xhsNoteSnapshotIdentity(analysis) {
    const notes = xhsArray(analysis && analysis.notes);
    const first = xhsObject(notes[0]);
    const last = xhsObject(notes[notes.length - 1]);
    return [
      analysis && analysis.runId,
      analysis && analysis.generatedAt,
      notes.length,
      first.noteId,
      last.noteId,
    ].map((value) => String(value == null ? '' : value)).join('|');
  }

  function resetXhsNoteStateForSnapshot(analysis) {
    const identity = xhsNoteSnapshotIdentity(analysis);
    if (identity === xhsNoteSnapshotKey) return;
    xhsNoteSnapshotKey = identity;
    xhsNoteFilters = { projectId: '', taskId: '', spuName: '', from: '', to: '' };
    xhsNoteExpanded = false;
  }

  function xhsStarSnapshotIdentity(analysis) {
    const star = xhsObject(analysis && analysis.star);
    const projects = xhsArray(star.projects);
    const orders = xhsArray(star.orders);
    return [
      analysis && analysis.runId,
      analysis && analysis.generatedAt,
      projects.length,
      orders.length,
      projects[0] && projects[0].id,
      orders[0] && orders[0].id,
    ].map((value) => String(value == null ? '' : value)).join('|');
  }

  function resetXhsStarStateForSnapshot(analysis) {
    const identity = xhsStarSnapshotIdentity(analysis);
    if (identity === xhsStarSnapshotKey) return;
    xhsStarSnapshotKey = identity;
    xhsStarFilters = { projectId: '', taskId: '' };
    xhsStarExpanded = { project: false, task: false };
  }

  function buildXhsPgyDateControls(view, staticExport) {
    const disabled = Boolean(
      staticExport || !view.factsAvailable || !view.modelAvailable
    );
    const disabledAttribute = disabled ? ' disabled aria-disabled="true"' : '';
    const notices = [];
    if (!view.factsAvailable) {
      notices.push('<p class="xhs-inline-warning" role="note">旧归档缺少蒲公英笔记事实，发布日期筛选已禁用；报告页不会重新请求平台。</p>');
    } else if (!view.modelAvailable) {
      notices.push('<p class="xhs-inline-warning" role="alert">蒲公英日期聚合模型未加载，请刷新报告页或联系管理员检查网页资源部署。</p>');
    } else if (view.aggregationError) {
      notices.push('<p class="xhs-inline-warning" role="alert">蒲公英日期筛选无法计算：' +
        escapeHtml(view.aggregationError) + '</p>');
    }
    if (staticExport && view.factsAvailable) {
      notices.push('<p class="xhs-inline-warning" role="note">导出静态视图（筛选请在在线报告操作）</p>');
    }
    const spuOptions = xhsArray(view.summary && view.summary.spuOptions);
    const selectedSpuName = String(view.spuName || '');
    const spuMarkup = ['<option value="">全部 SPU</option>'].concat(spuOptions.map((spu) => {
      const name = String(spu || '');
      return '<option value="' + escapeHtml(name) + '"' +
        (name === selectedSpuName ? ' selected' : '') + '>' + escapeHtml(name) + '</option>';
    })).join('');
    const asOf = String(view.summary && view.summary.asOf || '').slice(0, 10);
    const collectionNote = asOf
      ? '<p class="xhs-control-note" role="note">超期判定日期：今日 ' + escapeHtml(asOf) +
        '；任务结束日期早于今日即计为超期。</p>'
      : '';
    return notices.join('') + collectionNote + '<div class="xhs-control-grid xhs-pgy-controls">' +
      '<label><span>SPU 筛选</span><select data-xhs-pgy-spu aria-label="SPU 筛选"' + disabledAttribute + '>' +
      spuMarkup + '</select></label>' +
      '<label><span>发布日期从</span><input type="date" data-xhs-pgy-date="from" aria-label="发布日期从" value="' +
      escapeHtml(view.dateRange.from) + '"' + disabledAttribute + '></label>' +
      '<label><span>发布日期至</span><input type="date" data-xhs-pgy-date="to" aria-label="发布日期至" value="' +
      escapeHtml(view.dateRange.to) + '"' + disabledAttribute + '></label></div>';
  }

  function xhsKpiMarkup(items, extraClass) {
    return '<div class="xhs-metric-grid ' + escapeHtml(extraClass || '') + '">' + items.map((item) => (
      '<div class="xhs-metric-card"><span>' + escapeHtml(item[0]) + '</span><strong>' +
      escapeHtml(item[1]) + '</strong>' + (item[2] ? '<small>' + escapeHtml(item[2]) + '</small>' : '') + '</div>'
    )).join('') + '</div>';
  }

  function xhsPanelHeading(eyebrow, title, copy, meta) {
    return '<header class="xhs-panel-heading"><div><span>' + escapeHtml(eyebrow) + '</span><h3>' +
      escapeHtml(title) + '</h3>' + (copy ? '<p>' + escapeHtml(copy) + '</p>' : '') + '</div>' +
      (meta ? '<b>' + escapeHtml(meta) + '</b>' : '') + '</header>';
  }

  function buildXhsMonthlyChart(rows) {
    const monthly = xhsArray(rows);
    const maximum = Math.max(1, ...monthly.map((row) => Number(row && row.noteCount) || 0));
    const bars = monthly.length ? monthly.map((row) => {
      const count = Math.max(0, Number(row && row.noteCount) || 0);
      return '<div class="xhs-bar-row" role="listitem"><span class="xhs-bar-label">' +
        escapeHtml(row && row.month || '未知月份') + '</span><div class="xhs-bar-track" aria-hidden="true"><i class="xhs-bar-fill" style="--xhs-bar:' +
        Math.max(count ? 3 : 0, count / maximum * 100).toFixed(2) + '%"></i></div><strong class="xhs-chart-value">' +
        formatInteger(count) + ' 篇</strong></div>';
    }).join('') : '<p class="xhs-empty-state">当前日期范围暂无发布笔记。</p>';
    return '<figure class="xhs-bar-chart xhs-monthly-chart" role="list" aria-label="按月发布笔记数"><figcaption>按月发布笔记</figcaption>' +
      bars + '</figure>';
  }

  function buildXhsFollowerChart(rows) {
    const tiers = xhsArray(rows);
    const maximum = Math.max(1, ...tiers.map((row) => Number(row && row.noteCount) || 0));
    const bars = tiers.length ? tiers.map((row) => {
      const count = Math.max(0, Number(row && row.noteCount) || 0);
      const average = formatMoney(row && row.averageCooperationCost);
      return '<div class="xhs-bar-row" role="listitem"><span class="xhs-bar-label">' +
        escapeHtml(row && row.label || '未知量级') + '</span><div class="xhs-bar-track" aria-hidden="true"><i class="xhs-bar-fill" style="--xhs-bar:' +
        Math.max(count ? 3 : 0, count / maximum * 100).toFixed(2) + '%"></i></div><strong class="xhs-chart-value">' +
        formatInteger(count) + ' 篇 <small>平均合作费用 ' + escapeHtml(average) + '</small></strong></div>';
    }).join('') : '<p class="xhs-empty-state">暂无可用的达人粉丝量级数据。</p>';
    return '<figure class="xhs-bar-chart xhs-follower-chart" role="list" aria-label="达人粉丝量级分布，包含笔记数和平均合作费用"><figcaption>达人粉丝量级</figcaption>' +
      bars + '<span class="xhs-sr-only">平均合作费用仅包含合作金额，不包含平台服务费。</span></figure>';
  }

  function buildXhsPgyNoteAnalysis(view, staticExport) {
    if (!view.factsAvailable) return '';
    const facts = xhsArray(view.summary && view.summary.facts);
    const projects = [...new Set(facts.map((fact) => String(
      fact && fact.crossDomainProjectName || ''
    )).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const selectedProject = String(xhsPgyProjectName || '');
    const filtered = facts.filter((fact) => (
      !selectedProject || String(fact && fact.crossDomainProjectName || '') === selectedProject
    ));
    let total = selectedProject ? null : view.summary;
    if (selectedProject && view.modelAvailable) {
      try {
        total = window.XhsReportModel.aggregatePgyFacts({
          facts: filtered,
          dateRange: view.dateRange,
          spuName: view.spuName,
          asOf: view.summary && view.summary.asOf,
        });
        if (['partial', 'unavailable'].includes(String(view.coverage || ''))) {
          total = {
            ...total,
            costs: { cooperation: null, platformFee: null, total: null },
          };
        }
      } catch (error) {
        total = null;
      }
    }
    const projectOptions = ['<option value="">全部跨域项目</option>'].concat(projects.map((name) => (
      '<option value="' + escapeHtml(name) + '"' +
      (name === selectedProject ? ' selected' : '') + '>' + escapeHtml(name) + '</option>'
    ))).join('');
    const rows = filtered.length ? filtered.map((fact) => {
      const author = xhsObject(fact && fact.author);
      const costs = xhsObject(fact && fact.costs);
      const metrics = xhsObject(fact && fact.metrics);
      const noteUrl = xhsNoteDetailUrl(fact);
      const title = escapeHtml(fact && fact.title || '未命名笔记');
      const titleMarkup = noteUrl
        ? '<a class="xhs-note-detail-link" href="' + escapeHtml(noteUrl) +
          '" target="_blank" rel="noopener noreferrer">' + title + '</a>'
        : title;
      return '<tr data-xhs-pgy-note-id="' + escapeHtml(fact && fact.noteId || '') + '"><td>' +
        escapeHtml(fact && fact.publishDate || '—') + '</td><td><strong>' + titleMarkup +
        '</strong><small>' + escapeHtml(fact && fact.noteId || '—') + '</small></td><td>' +
        escapeHtml(fact && fact.crossDomainProjectName || '—') + '</td><td>' +
        escapeHtml(fact && fact.spuName || '—') + '</td><td>' +
        escapeHtml(fact && fact.taobaoTaskId || '—') + '</td><td>' +
        escapeHtml(fact && fact.taskEndDate || '—') + '</td><td>' +
        escapeHtml(author.name || '—') + '</td><td>' + formatInteger(author.followerCount) + '</td><td>' +
        formatMoney(costs.cooperation) + '</td><td>' + formatMoney(costs.platformFee) + '</td><td>' +
        formatMoney(costs.total) + '</td><td>' + formatInteger(metrics.impressions) + '</td><td>' +
        formatInteger(metrics.reads) + '</td><td>' + formatInteger(metrics.interactions) + '</td><td>' +
        formatInteger(metrics.taobaoOffsiteActiveUv15d) + '</td><td>' +
        formatMoney(metrics.taobaoOffsiteActiveCost15d) + '</td><td>' +
        formatInteger(metrics.taobaoDealUv15d) + '</td><td>' +
        formatInteger(metrics.taobaoAddCartUv15d) + '</td><td>' +
        formatPercent(metrics.taobaoAddCartRate15d, 2) + '</td><td>' +
        formatPercent(metrics.taobaoPurchaseRate15d, 2) + '</td></tr>';
    }).join('') : '<tr><td colspan="20">当前筛选条件暂无蒲公英笔记数据。</td></tr>';
    const totalCosts = xhsObject(total && total.costs);
    const totalMetrics = xhsObject(total && total.metrics);
    const taobao15d = xhsObject(total && total.taobao15d);
    const totalRow = total ? '<tr class="xhs-total-row" data-xhs-pgy-note-total><th colspan="8" scope="row">筛选后汇总</th><td>' +
      formatMoney(totalCosts.cooperation) + '</td><td>' + formatMoney(totalCosts.platformFee) + '</td><td>' +
      formatMoney(totalCosts.total) + '</td><td>' + formatInteger(totalMetrics.impressions) + '</td><td>' +
      formatInteger(totalMetrics.reads) + '</td><td>' + formatInteger(totalMetrics.interactions) + '</td><td>' +
      formatInteger(taobao15d.offsiteActiveUv) + '</td><td>' + formatMoney(taobao15d.offsiteActiveCost) +
      '</td><td>' + formatInteger(taobao15d.dealUv) + '</td><td>' + formatInteger(taobao15d.addCartUv) +
      '</td><td>' + formatPercent(taobao15d.addCartRate, 2) + '</td><td>' +
      formatPercent(taobao15d.purchaseRate, 2) + '</td></tr>' : '';
    const disabled = staticExport ? ' disabled aria-disabled="true"' : '';
    const expanded = staticExport || xhsPgyNoteExpanded;
    return '<section class="xhs-pgy-note-analysis"><button type="button" data-xhs-pgy-note-toggle aria-expanded="' +
      String(expanded) + '" aria-controls="xhsPgyNoteAnalysis"' + disabled + '>笔记分析 <span>' +
      formatInteger(filtered.length) + ' 篇</span></button><div id="xhsPgyNoteAnalysis"' +
      (expanded ? '' : ' hidden') + '><div class="xhs-control-grid xhs-pgy-note-controls"><label><span>跨域项目名称</span>' +
      '<select data-xhs-pgy-project aria-label="按跨域项目名称筛选"' + disabled + '>' + projectOptions +
      '</select></label></div><div class="report-table-block xhs-wide-table"><table><thead><tr>' +
      '<th>发布日期</th><th>笔记</th><th>跨域项目名称</th><th>SPU名称</th><th>淘宝任务ID</th>' +
      '<th>任务结束日期</th><th>达人</th><th>粉丝数</th><th>合作金额</th><th>平台服务费</th><th>达人花费</th>' +
      '<th>曝光量</th><th>阅读量</th><th>互动量</th><th>淘宝站外活跃行为UV(15天)</th>' +
      '<th>淘宝站外活跃成本(15天)</th><th>淘宝成交UV(15天)</th><th>淘宝加购UV(15天)</th>' +
      '<th>淘宝加购率(15天)</th><th>淘宝购买率(15天)</th></tr></thead><tbody>' + totalRow + rows +
      '</tbody></table></div></div></section>';
  }

  function xhsObjectiveLabel(value) {
    return {
      product_seeding: '产品种草',
      direct: '种草直达',
      unknown: '未知营销诉求',
    }[String(value == null ? 'unknown' : value)] || String(value);
  }

  function xhsPlacementTypeLabel(value) {
    return value == null || value === '' || String(value) === 'unknown'
      ? '未知投放位置'
      : String(value);
  }

  function xhsTaskStatusLabel(value) {
    return {
      in_task: '任务期内',
      outside_task: '任务期外',
      out_of_task: '任务期外',
      no_task: '无星河任务',
      unknown: '任务状态未知',
    }[String(value || 'unknown')] || String(value);
  }

  function xhsSelectedOption(value, selected) {
    return String(value) === String(selected) ? ' selected' : '';
  }

  function xhsFilterOptions(rows, dimension) {
    const values = new Map();
    xhsArray(rows).forEach((row) => {
      const source = xhsObject(row);
      let value;
      let label;
      if (dimension === 'account') {
        value = source.accountId == null || source.accountId === '' ? 'unknown' : String(source.accountId);
        label = source.accountName || (value === 'unknown' ? '未知广告账户' : value);
      } else if (dimension === 'marketingObjective') {
        value = source.marketingObjective == null || source.marketingObjective === ''
          ? 'unknown' : String(source.marketingObjective);
        label = xhsObjectiveLabel(value);
      } else {
        value = source.placementType == null || source.placementType === ''
          ? 'unknown' : String(source.placementType);
        label = xhsPlacementTypeLabel(value);
      }
      if (!values.has(value)) values.set(value, String(label));
    });
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'));
  }

  function buildXhsFilterSelect(rows, dimension, filterKey, label, disabled) {
    const available = xhsFilterOptions(rows, dimension);
    const requested = xhsArray(xhsJuguangFilters[filterKey])[0] || '';
    const selected = available.some(([value]) => String(value) === String(requested)) ? requested : '';
    const disabledAttribute = disabled ? ' disabled aria-disabled="true"' : '';
    const options = available.map(([value, text]) => (
      '<option value="' + escapeHtml(value) + '"' + xhsSelectedOption(value, selected) + '>' +
      escapeHtml(text) + '</option>'
    )).join('');
    return '<label><span>' + escapeHtml(label) + '</span><select aria-label="' + escapeHtml(label) +
      '" data-xhs-juguang-filter="' + escapeHtml(dimension) + '"' + disabledAttribute +
      '><option value="">全部</option>' +
      options + '</select></label>';
  }

  function xhsPlacementFactsUnavailable(rows) {
    const facts = xhsArray(rows);
    return facts.length > 0 && !facts.some((row) => (
      xhsHasOwn(row, 'placementType') && row.placementType !== null &&
      row.placementType !== undefined && String(row.placementType).trim() !== ''
    ));
  }

  function normalizedXhsGroupBy(placementUnavailable) {
    const allowed = ['account', 'marketingObjective', 'placementType'];
    const selected = xhsJuguangGroupBy.filter((dimension, index, values) => (
      allowed.includes(dimension) && values.indexOf(dimension) === index &&
      !(placementUnavailable && dimension === 'placementType')
    )).slice(0, 3);
    if (!selected.length) selected.push('account');
    return xhsJuguangMode === 'single' ? selected.slice(0, 1) : selected;
  }

  function buildXhsJuguangControls(rows, staticView, factsUnavailable, modelUnavailable,
    placementUnavailable) {
    const groupBy = normalizedXhsGroupBy(placementUnavailable);
    const controlsDisabled = staticView || factsUnavailable || modelUnavailable;
    const disabledAttribute = controlsDisabled
      ? ' disabled aria-disabled="true"'
      : '';
    const dimensions = [
      ['account', '广告账户', false],
      ['marketingObjective', '营销诉求', false],
      ['placementType', '投放位置', placementUnavailable],
    ];
    const groups = dimensions.map(([dimension, label, dimensionUnavailable]) => (
      '<label class="xhs-check-option"><input type="checkbox" value="' + dimension +
      '" data-xhs-juguang-group-by="' + dimension + '"' +
      (groupBy.includes(dimension) ? ' checked' : '') +
      (controlsDisabled || dimensionUnavailable ? ' disabled aria-disabled="true"' : '') +
      '><span>' + label + '</span></label>'
    )).join('');
    const staticNotice = staticView
      ? '<p class="xhs-inline-warning" role="note">导出静态视图（筛选请在在线报告操作）</p>'
      : '';
    const unavailableNotice = modelUnavailable
      ? '<p class="xhs-inline-warning" role="alert">聚光多层分析模型未加载，请刷新报告页或联系管理员检查网页资源部署。</p>'
      : factsUnavailable
        ? '<p class="xhs-inline-warning" role="note">旧归档缺少聚光逐日明细，无法进行多层分析和任务周期拆分；请重新取数。</p>'
        : placementUnavailable
          ? '<p class="xhs-inline-warning" role="note">旧归档缺少真实投放位置，新维度不可用；原 deliveryMode 0/1 不会作为投放位置展示，请重新取数。</p>'
          : '';
    return staticNotice + unavailableNotice + '<div class="xhs-control-grid"><label><span>分析层级</span><select aria-label="聚光分析层级" data-xhs-juguang-mode="selector"' +
      disabledAttribute + '>' +
      '<option value="single"' + xhsSelectedOption('single', xhsJuguangMode) + '>单层分析</option>' +
      '<option value="multi"' + xhsSelectedOption('multi', xhsJuguangMode) + '>多层分析</option></select></label>' +
      buildXhsFilterSelect(rows, 'account', 'accountIds', '按广告账户筛选', controlsDisabled) +
      buildXhsFilterSelect(rows, 'marketingObjective', 'marketingObjectives', '按营销诉求筛选', controlsDisabled) +
      buildXhsFilterSelect(rows, 'placementType', 'placementTypes', '按投放位置筛选',
        controlsDisabled || placementUnavailable) +
      '<fieldset><legend>分组维度（最多 3 层）</legend><div class="xhs-check-list">' + groups +
      '</div></fieldset></div>';
  }

  function xhsLegacyJuguangSummary(value) {
    const row = xhsObject(value);
    const spend = xhsObject(row.spend);
    const hasStructuredSpend = xhsHasOwn(row, 'spend') && row.spend &&
      typeof row.spend === 'object' && !Array.isArray(row.spend);
    const spendValue = (key, legacyKey) => {
      if (xhsHasOwn(spend, key)) return spend[key];
      if (xhsHasOwn(row, legacyKey)) return row[legacyKey];
      return null;
    };
    const totalSpend = hasStructuredSpend
      ? spendValue('total', 'totalSpend')
      : xhsHasOwn(row, 'spend') ? row.spend : null;
    const seedingExternalSourcePresent = xhsHasOwn(row, 'seedingExternal15');
    const seedingExternal = xhsObject(row.seedingExternal15);
    const conversionSourcePresent = xhsHasOwn(row, 'conversion15');
    const conversion = xhsObject(row.conversion15);
    const conversionValue = (key, legacyKey) => {
      if (xhsHasOwn(conversion, key)) return conversion[key];
      if (conversionSourcePresent && row.conversion15 == null) return null;
      return xhsHasOwn(row, legacyKey) ? row[legacyKey] : null;
    };
    return {
      spend: {
        total: totalSpend,
        inTask: spendValue('inTask', 'inTaskSpend'),
        outsideTask: spendValue('outsideTask', 'outsideTaskSpend'),
        unknown: spendValue('unknown', 'unknownTaskSpend'),
      },
      impressions: row.impressions,
      clicks: row.clicks,
      interactions: row.interactions,
      seedUsers: row.seedUsers,
      deepSeedUsers: row.deepSeedUsers,
      seedingExternal15: {
        observability: xhsHasOwn(seedingExternal, 'observability')
          ? seedingExternal.observability
          : seedingExternalSourcePresent ? 'unobservable' : 'none',
        seedingSpend: xhsHasOwn(seedingExternal, 'seedingSpend')
          ? seedingExternal.seedingSpend : null,
        activeUv: xhsHasOwn(seedingExternal, 'activeUv') ? seedingExternal.activeUv : null,
        calculatedCost: xhsHasOwn(seedingExternal, 'calculatedCost')
          ? seedingExternal.calculatedCost : null,
      },
      conversion15: {
        storeVisits: conversionValue('storeVisits', 'storeVisits'),
        orders: conversionValue('orders', 'orders'),
        gmv: conversionValue('gmv', 'gmv'),
        calculatedRoi15: xhsHasOwn(conversion, 'calculatedRoi15')
          ? conversion.calculatedRoi15
          : conversionSourcePresent && row.conversion15 == null
            ? null
            : xhsFirstValue(row.calculatedRoi15, row.roi),
        platformRoi15: conversionValue('platformRoi15', 'platformRoi15'),
      },
    };
  }

  function aggregateXhsJuguang(spotlight) {
    const rows = xhsArray(spotlight.daily);
    const placementUnavailable = xhsPlacementFactsUnavailable(rows);
    const groupBy = normalizedXhsGroupBy(placementUnavailable);
    const model = window.XhsReportModel;
    if (rows.length && model && typeof model.aggregateSpotlight === 'function') {
      try {
        const selectedFilter = (dimension, filterKey) => {
          const requested = xhsArray(xhsJuguangFilters[filterKey])[0];
          if (requested === undefined) return [];
          return xhsFilterOptions(rows, dimension).some(([value]) => String(value) === String(requested))
            ? [requested] : [];
        };
        return model.aggregateSpotlight({
          rows,
          groupBy,
          filters: {
            accountIds: selectedFilter('account', 'accountIds'),
            marketingObjectives: selectedFilter('marketingObjective', 'marketingObjectives'),
            placementTypes: placementUnavailable
              ? [] : selectedFilter('placementType', 'placementTypes'),
          },
        });
      } catch (error) {
        return { groupBy, summary: xhsLegacyJuguangSummary(spotlight.total), groups: [], error };
      }
    }
    const groups = xhsArray(spotlight.byMarketingObjective).map((row) => ({
      dimension: 'marketingObjective',
      key: row.key || 'unknown',
      label: xhsObjectiveLabel(row.key || 'unknown'),
      level: 1,
      summary: xhsLegacyJuguangSummary(row),
      children: [],
    }));
    return {
      groupBy: ['marketingObjective'],
      summary: xhsLegacyJuguangSummary(spotlight.total || {}),
      groups,
      legacy: true,
    };
  }

  function xhsJuguangMetricCells(summary, platformRoi) {
    const metrics = xhsLegacyJuguangSummary(summary);
    const seedingExternal = xhsObject(metrics.seedingExternal15);
    const conversion = xhsObject(metrics.conversion15);
    return '<td>' + formatMoney(metrics.spend.total) + '</td><td>' + formatMoney(metrics.spend.inTask) +
      '</td><td>' + formatMoney(metrics.spend.outsideTask) + '</td><td>' + formatMoney(metrics.spend.unknown) +
      '</td><td>' + formatInteger(metrics.impressions) +
      '</td><td>' + formatInteger(metrics.clicks) + '</td><td>' + formatInteger(metrics.interactions) +
      '</td><td>' + formatInteger(metrics.seedUsers) + '</td><td>' + formatInteger(metrics.deepSeedUsers) +
      '</td><td>' + formatInteger(seedingExternal.activeUv) +
      '</td><td>' + formatMoney(seedingExternal.calculatedCost) +
      '</td><td>' + formatInteger(conversion.storeVisits) + '</td><td>' + formatInteger(conversion.orders) +
      '</td><td>' + formatMoney(conversion.gmv) + '</td><td>' + formatDecimal(conversion.calculatedRoi15, 2) +
      '</td><td>' + formatDecimal(xhsFirstValue(platformRoi, conversion.platformRoi15), 2) + '</td>';
  }

  function xhsJuguangExternalNotice(summary) {
    const external = xhsObject(xhsLegacyJuguangSummary(summary).seedingExternal15);
    const observability = String(external.observability || 'none');
    if (observability === 'partial' || observability === 'unobservable') {
      return '<p class="xhs-inline-warning" role="note">部分产品种草数据缺少 15 日站外行为字段，站外活跃 UV 与成本显示为未知；请重新取数补齐。</p>';
    }
    if (observability === 'observable' && asNumber(external.activeUv) === 0 &&
        asNumber(external.calculatedCost) === null) {
      return '<p class="xhs-inline-warning" role="note">产品种草 15 日站外活跃 UV 为 0，无法计算站外行为成本。</p>';
    }
    return '';
  }

  function xhsAccountPlatformRoi(spotlight, node) {
    const placementUnavailable = xhsPlacementFactsUnavailable(spotlight && spotlight.daily);
    const fullAccountScope = node && node.dimension === 'account' && Number(node.level) === 1 &&
      normalizedXhsGroupBy(placementUnavailable)[0] === 'account' &&
      !xhsArray(xhsJuguangFilters.marketingObjectives).length &&
      !xhsArray(xhsJuguangFilters.placementTypes).length;
    if (!fullAccountScope) return null;
    const account = xhsArray(spotlight.byAccount).find((row) => String(row && row.key) === String(node.key));
    return account && account.platformRoi15;
  }

  function buildXhsJuguangGroupRows(groups, spotlight) {
    const dimensionLabels = {
      account: '广告账户',
      marketingObjective: '营销诉求',
      placementType: '投放位置',
    };
    const rows = [];
    const visit = (nodes) => xhsArray(nodes).forEach((node) => {
      const level = Math.max(1, Number(node && node.level) || 1);
      const label = node && node.label || node && node.key || '未知';
      rows.push('<tr data-xhs-juguang-level="' + level + '"><th scope="row"><span class="xhs-tree-label" style="--xhs-level:' +
        level + '"><small>' + escapeHtml(dimensionLabels[node && node.dimension] || '分组') + '</small>' +
        escapeHtml(label) + '</span></th>' + xhsJuguangMetricCells(node && node.summary,
        xhsAccountPlatformRoi(spotlight, node)) + '</tr>');
      visit(node && node.children);
    });
    visit(groups);
    return rows.join('');
  }

  function buildXhsJuguangTable(spotlight, aggregation) {
    const groupRows = buildXhsJuguangGroupRows(aggregation.groups, spotlight);
    const error = aggregation.error
      ? '<p class="xhs-inline-warning">聚光分组条件无效，已显示可用的总计。</p>' : '';
    return error + xhsJuguangExternalNotice(aggregation.summary) +
      '<div class="report-table-block xhs-wide-table"><table><thead><tr><th>分析维度</th>' +
      '<th>总消耗</th><th>任务期内消耗</th><th>任务期外消耗</th><th>任务周期未知消耗</th>' +
      '<th>曝光</th><th>点击</th><th>互动</th>' +
      '<th>新增种草人群</th><th>新增深度种草人群</th>' +
      '<th>产品种草15日站外活跃UV</th><th>站外行为成本</th>' +
      '<th>外链进店数</th><th>15日成交订单数</th>' +
      '<th>15日成交 GMV</th><th>计算 ROI</th><th>平台原始 ROI</th></tr></thead><tbody>' +
      '<tr class="xhs-total-row"><th scope="row">筛选后总计</th>' + xhsJuguangMetricCells(aggregation.summary) + '</tr>' +
      (groupRows || '<tr><td colspan="17">当前筛选条件暂无聚光投放数据。</td></tr>') +
      '</tbody></table></div>';
  }

  function xhsSumKnown(units, getter) {
    const rows = xhsArray(units);
    if (!rows.length) return null;
    let total = 0;
    for (const unit of rows) {
      const value = asNumber(getter(unit));
      if (value === null) return null;
      total += value;
    }
    return total;
  }

  function xhsSumAvailable(units, getter) {
    const rows = xhsArray(units);
    let total = 0;
    let observed = false;
    for (const unit of rows) {
      const value = asNumber(getter(unit));
      if (value === null) continue;
      observed = true;
      total += value;
    }
    return observed ? total : null;
  }

  function xhsStarAvailableCosts(units) {
    const rows = xhsArray(units);
    return {
      total: xhsSumAvailable(rows, (unit) => xhsObject(unit && unit.costs).total),
      creator: xhsSumAvailable(rows, (unit) => xhsObject(unit && unit.costs).creator),
      adInTask: xhsSumAvailable(rows, (unit) => xhsObject(unit && unit.costs).adInTask),
    };
  }

  function xhsStarAggregateUnits(units, options) {
    const rows = xhsArray(units);
    const sum = options && options.available === true ? xhsSumAvailable : xhsSumKnown;
    const costs = {
      total: sum(rows, (unit) => xhsObject(unit && unit.costs).total),
      creator: sum(rows, (unit) => xhsObject(unit && unit.costs).creator),
      adInTask: sum(rows, (unit) => xhsObject(unit && unit.costs).adInTask),
    };
    const metrics = {
      readUv: sum(rows, (unit) => xhsObject(unit && unit.metrics).readUv),
      searchImpressionUv: sum(rows, (unit) => xhsObject(unit && unit.metrics).searchImpressionUv),
      storeVisitUv: sum(rows, (unit) => xhsObject(unit && unit.metrics).storeVisitUv),
      cartUv: sum(rows, (unit) => xhsObject(unit && unit.metrics).cartUv),
      orderUv: sum(rows, (unit) => xhsObject(unit && unit.metrics).orderUv),
      gmv: sum(rows, (unit) => xhsObject(unit && unit.metrics).gmv),
      seededProductGmv: sum(rows, (unit) => xhsObject(unit && unit.metrics).seededProductGmv),
    };
    metrics.visitRate = divide(metrics.storeVisitUv, metrics.readUv);
    metrics.visitCost = divide(costs.total, metrics.storeVisitUv);
    metrics.addCartRate = divide(metrics.cartUv, metrics.storeVisitUv);
    metrics.conversionRate = divide(metrics.orderUv, metrics.storeVisitUv);
    return {
      costs,
      metrics,
      storeRoi: divide(metrics.gmv, costs.total),
      taskRoi: divide(metrics.seededProductGmv, costs.total),
      trafficRoi: divide(metrics.gmv, costs.adInTask),
      seededProductShare: divide(metrics.seededProductGmv, metrics.gmv),
    };
  }

  function xhsStarDerivedMetrics(metrics, costs, roiOverrides) {
    const values = xhsObject(metrics);
    const costValues = xhsObject(costs);
    const overrides = xhsObject(roiOverrides);
    return {
      visitRate: xhsFirstValue(divide(values.storeVisitUv, values.readUv), values.visitRate),
      visitCost: xhsFirstValue(divide(costValues.total, values.storeVisitUv), values.visitCost),
      addCartRate: xhsFirstValue(divide(values.cartUv, values.storeVisitUv), values.addCartRate),
      conversionRate: xhsFirstValue(divide(values.orderUv, values.storeVisitUv), values.conversionRate),
      seededProductShare: divide(values.seededProductGmv, values.gmv),
      storeRoi: xhsHasOwn(overrides, 'storeRoi')
        ? overrides.storeRoi : divide(values.gmv, costValues.total),
      taskRoi: xhsHasOwn(overrides, 'taskRoi')
        ? overrides.taskRoi : divide(values.seededProductGmv, costValues.total),
      trafficRoi: xhsHasOwn(overrides, 'trafficRoi')
        ? overrides.trafficRoi : divide(values.gmv, costValues.adInTask),
    };
  }

  function xhsStarMetricCards(metrics, costs, roiOverrides) {
    const values = xhsObject(metrics);
    const costValues = xhsObject(costs);
    const derived = xhsStarDerivedMetrics(values, costValues,
      roiOverrides && typeof roiOverrides === 'object' ? roiOverrides : { storeRoi: roiOverrides });
    return xhsKpiMarkup([
      ['花费', formatMoney(costValues.total)],
      ['达人花费', formatMoney(costValues.creator)],
      ['广告花费（任务期内）', formatMoney(costValues.adInTask)],
      ['阅读UV', formatInteger(values.readUv)],
      ['搜索曝光UV', formatInteger(values.searchImpressionUv)],
      ['进店UV', formatInteger(values.storeVisitUv)],
      ['进店率', formatPercent(derived.visitRate, 2)],
      ['进店成本', formatMoney(derived.visitCost)],
      ['加购率', formatPercent(derived.addCartRate, 2)],
      ['转化率', formatPercent(derived.conversionRate, 2)],
      ['成交UV', formatInteger(values.orderUv)],
      ['全店GMV', formatMoney(values.gmv)],
      ['种草商品GMV', formatMoney(values.seededProductGmv)],
      ['种草成交占比', formatPercent(derived.seededProductShare, 2)],
      ['全店ROI', formatDecimal(derived.storeRoi, 2)],
      ['任务ROI', formatDecimal(derived.taskRoi, 2)],
      ['投流ROI', formatDecimal(derived.trafficRoi, 2)],
    ], 'xhs-star-metrics');
  }

  function buildXhsStarUnitMetrics(unit) {
    const metrics = xhsObject(unit && unit.metrics);
    return '<dl class="xhs-unit-metrics"><div><dt>阅读UV</dt><dd>' + formatInteger(metrics.readUv) +
      '</dd></div><div><dt>搜索曝光UV</dt><dd>' + formatInteger(metrics.searchImpressionUv) +
      '</dd></div><div><dt>进店UV</dt><dd>' + formatInteger(metrics.storeVisitUv) +
      '</dd></div><div><dt>进店率</dt><dd>' + formatPercent(metrics.visitRate) +
      '</dd></div><div><dt>GMV</dt><dd>' + formatMoney(metrics.gmv) +
      '</dd></div><div><dt>种草商品GMV</dt><dd>' + formatMoney(metrics.seededProductGmv) + '</dd></div></dl>';
  }

  function buildXhsStarUnitCosts(costs) {
    const values = xhsObject(costs);
    return '<dl class="xhs-unit-costs"><div><dt>总花费</dt><dd>' + formatMoney(values.total) +
      '</dd></div><div><dt>达人花费</dt><dd>' + formatMoney(values.creator) +
      '</dd></div><div><dt>任务期内广告花费</dt><dd>' + formatMoney(values.adInTask) + '</dd></div></dl>';
  }

  function buildXhsStarNotes(order) {
    const notes = xhsArray(order && order.notes);
    if (!notes.length) return '<p class="xhs-empty-state">该订单暂无可联表的星河笔记。</p>';
    return '<div class="xhs-note-node-list"><h6>订单笔记 <span>' + notes.length + ' 篇</span></h6>' + notes.map((note) => (
      '<article class="xhs-note-node" data-xhs-star-note="' + escapeHtml(note && note.noteId || '') + '">' +
      '<header><div><span>笔记</span><h6>' + escapeHtml(note && note.title || note && note.noteId || '未命名笔记') +
      '</h6><code>' + escapeHtml(note && note.noteId || '—') + '</code></div><b>' +
      escapeHtml(note && note.publishDate || '暂无发布日期') + '</b></header>' +
      buildXhsStarUnitCosts(note && note.costs) + buildXhsStarUnitMetrics(note) + '</article>'
    )).join('') + '</div>';
  }

  function xhsStarOrderPublicIdentity(order) {
    const verified = !order || order.businessIdentityVerified !== false;
    return {
      verified,
      publicId: verified ? order && order.id : order && order.reportOrderId,
      label: verified ? '任务' : '报表任务标识（未验证）',
    };
  }

  function buildXhsUnassignedNotes(star) {
    const notes = xhsArray(star && star.unassignedNotes);
    if (!notes.length) return '';
    const reasonLabel = (reason) => reason === 'ambiguous_order_relation'
      ? '存在多个候选订单，无法唯一归属'
      : '未找到已采集且可验证的订单关系';
    return '<section class="xhs-unassigned-notes" aria-labelledby="xhsUnassignedNotesTitle">' +
      '<div class="xhs-subsection-heading"><div><h4 id="xhsUnassignedNotesTitle">待归属笔记</h4>' +
      '<p>以下笔记未计入项目或订单成本合计；成本仅供核对，关系确认后才能向上汇总。</p></div>' +
      '<span>' + notes.length + ' 篇</span></div><div class="xhs-unassigned-note-list">' +
      notes.map((note) => {
        const candidateCount = xhsArray(note && note.candidateOrderIds).length;
        return '<article class="xhs-note-node xhs-unassigned-note" data-xhs-star-note="' +
          escapeHtml(note && note.noteId || '') + '"><header><div><span>待归属笔记</span><h5>' +
          escapeHtml(note && note.title || note && note.noteId || '未命名笔记') + '</h5><code>' +
          escapeHtml(note && note.noteId || '—') + '</code></div><b>未计入项目或订单成本合计</b></header>' +
          '<p>' + escapeHtml(reasonLabel(note && note.reason)) + ' · 候选订单 ' + candidateCount + ' 个</p>' +
          buildXhsStarUnitCosts(note && note.costs) + '</article>';
      }).join('') + '</div></section>';
  }

  function buildXhsProjectTree(star) {
    const projects = xhsArray(star.projects);
    const topLevelOrders = xhsArray(star.orders);
    const ordersForProject = (project) => {
      const projectKey = String(project && project.id || '');
      const merged = new Map();
      topLevelOrders.filter((order) => String(order && order.projectId || '') === projectKey)
        .forEach((order) => merged.set(String(order && order.id || ''), order));
      xhsArray(project && project.orders)
        .forEach((order) => merged.set(String(order && order.id || ''), order));
      return [...merged.values()];
    };
    const attachedOrderIds = new Set(projects.flatMap((project) => (
      ordersForProject(project).map((order) => String(order && order.id || ''))
    )));
    const unassignedOrders = topLevelOrders.filter((order) => (
      !attachedOrderIds.has(String(order && order.id || ''))
    ));
    const projectMarkup = projects.map((project) => {
      const orders = ordersForProject(project);
      const orderMarkup = orders.length ? orders.map((order) => {
        const identity = xhsStarOrderPublicIdentity(order);
        return '<article class="xhs-order-node' + (identity.verified ? '' : ' xhs-order-unverified') +
        '" data-xhs-star-task="' + escapeHtml(identity.publicId || '') +
        '" data-xhs-star-order="' + escapeHtml(identity.publicId || '') + '">' +
        '<header><div><span>' + escapeHtml(identity.label) + '</span><h5>' +
        escapeHtml(order && order.name || '未命名任务') +
        '</h5><code>' + escapeHtml(identity.publicId || '—') + '</code></div><b>' +
        escapeHtml(xhsStatusLabel(order && (order.orderStatus || order.status))) + '</b></header>' +
        '<p>' + escapeHtml([order && order.startDate, order && order.endDate].filter(Boolean).join(' 至 ') || '暂无投放日期') +
        (order && order.deliveryMode ? ' · ' + escapeHtml(order.deliveryMode) : '') + '</p>' +
        buildXhsStarUnitCosts(order && order.costs) + buildXhsStarUnitMetrics(order) + '</article>';
      }).join('') : '<p class="xhs-empty-state">该项目暂无任务数据。</p>';
      return '<article class="xhs-project-node" data-xhs-star-project="' + escapeHtml(project && project.id || '') + '">' +
        '<header><div><span>星河项目</span><h4>' + escapeHtml(project && project.name || '未命名项目') +
        '</h4><code>' + escapeHtml(project && project.id || '—') + '</code></div><b>' +
        escapeHtml(xhsStatusLabel(project && project.status)) + '</b></header>' +
        '<p>' + escapeHtml([project && project.startDate, project && project.endDate]
          .filter(Boolean).join(' 至 ') || '暂无投放日期') + '</p>' +
        buildXhsStarUnitCosts(project && project.costs) + buildXhsStarUnitMetrics(project) +
        '<div class="xhs-order-list"><h5>项目任务 <span>' + orders.length + ' 条</span></h5>' + orderMarkup + '</div></article>';
    }).join('');
    const unassignedMarkup = unassignedOrders.length
      ? '<article class="xhs-project-node xhs-unassigned-orders"><header><div><span>星河任务</span><h4>未关联项目的任务</h4></div></header><div class="xhs-order-list">' +
        unassignedOrders.map((order) => {
          const identity = xhsStarOrderPublicIdentity(order);
          return '<article class="xhs-order-node' + (identity.verified ? '' : ' xhs-order-unverified') +
          '" data-xhs-star-task="' + escapeHtml(identity.publicId || '') +
          '" data-xhs-star-order="' + escapeHtml(identity.publicId || '') +
          '"><header><div><span>' + escapeHtml(identity.label) + '</span><h5>' +
          escapeHtml(order && order.name || '未命名任务') + '</h5><code>' +
          escapeHtml(identity.publicId || '—') + '</code></div><b>' +
          escapeHtml(xhsStatusLabel(order && (order.orderStatus || order.status))) + '</b></header>' +
          '<p>' + escapeHtml([order && order.startDate, order && order.endDate]
            .filter(Boolean).join(' 至 ') || '暂无投放日期') +
          (order && order.deliveryMode ? ' · ' + escapeHtml(order.deliveryMode) : '') + '</p>' +
          buildXhsStarUnitCosts(order && order.costs) + buildXhsStarUnitMetrics(order) + '</article>';
        }).join('') +
        '</div></article>' : '';
    return '<div class="xhs-project-tree">' + (projectMarkup || unassignedMarkup
      ? projectMarkup + unassignedMarkup
      : '<p class="xhs-empty-state">当前日期范围暂无星河项目和任务。</p>') + '</div>';
  }

  function xhsStarOrders(star) {
    const safe = xhsObject(star);
    const orders = new Map();
    const remember = (order, projectId) => {
      const id = String(order && order.id || '');
      if (!id || orders.has(id)) return;
      orders.set(id, Object.assign({}, xhsObject(order), {
        projectId: String(projectId || order && order.projectId || ''),
      }));
    };
    xhsArray(safe.projects).forEach((project) => {
      xhsArray(project && project.orders).forEach((order) => remember(order, project && project.id));
    });
    xhsArray(safe.orders).forEach((order) => remember(order, order && order.projectId));
    return [...orders.values()];
  }

  function xhsStarFilterOptions(star, filters) {
    const safe = xhsObject(star);
    const projects = xhsArray(safe.projects).map((project) => ({
      id: String(project && project.id || ''),
      label: String(project && project.name || project && project.id || ''),
    })).filter((project) => project.id);
    const selectedProject = String(filters && filters.projectId || '');
    const tasks = xhsStarOrders(safe).filter((task) => (
      task.businessIdentityVerified !== false &&
      (!selectedProject || !task.projectId || task.projectId === selectedProject)
    )).map((task) => ({
      id: String(task.id),
      label: String(task.name || task.id),
      projectId: task.projectId,
    }));
    return {
      projects: projects.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      tasks: tasks.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
    };
  }

  function xhsStarSelect(label, kind, value, choices, disabled) {
    const options = [{ id: '', label: '全部' }].concat(choices).map((choice) => (
      '<option value="' + escapeHtml(choice.id) + '"' +
      (String(choice.id) === String(value || '') ? ' selected' : '') + '>' +
      escapeHtml(choice.label) + '</option>'
    )).join('');
    return '<label><span>' + escapeHtml(label) + '</span><select data-xhs-star-filter="' + kind +
      '" aria-label="' + escapeHtml(label) + '"' + (disabled ? ' disabled' : '') + '>' + options + '</select></label>';
  }

  function buildXhsStarSummaryControls(star, filters, staticExport) {
    const options = xhsStarFilterOptions(star, filters);
    return '<div class="xhs-control-grid xhs-star-controls">' +
      xhsStarSelect('按项目筛选', 'project', filters.projectId, options.projects, staticExport) +
      xhsStarSelect('按任务筛选', 'task', filters.taskId, options.tasks, staticExport) +
      '</div>';
  }

  function xhsStarSummaryCells(unit) {
    const metrics = xhsObject(unit && unit.metrics);
    const costs = xhsObject(unit && unit.costs);
    const derived = xhsStarDerivedMetrics(metrics, costs);
    return '<td>' + formatMoney(costs.total) + '</td><td>' + formatMoney(costs.creator) +
      '</td><td>' + formatMoney(costs.adInTask) + '</td><td>' + formatInteger(metrics.readUv) +
      '</td><td>' + formatInteger(metrics.searchImpressionUv) + '</td><td>' +
      formatInteger(metrics.storeVisitUv) + '</td><td>' + formatPercent(derived.visitRate, 2) +
      '</td><td>' + formatMoney(derived.visitCost) + '</td><td>' +
      formatPercent(derived.addCartRate, 2) + '</td><td>' + formatPercent(derived.conversionRate, 2) +
      '</td><td>' + formatInteger(metrics.orderUv) + '</td><td>' + formatMoney(metrics.gmv) +
      '</td><td>' + formatMoney(metrics.seededProductGmv) + '</td><td>' +
      formatPercent(derived.seededProductShare, 2) + '</td><td>' + formatDecimal(derived.storeRoi, 2) +
      '</td><td>' + formatDecimal(derived.taskRoi, 2) + '</td><td>' +
      formatDecimal(derived.trafficRoi, 2) + '</td>';
  }

  function xhsStarDetailToggle(kind, expanded, count, staticExport) {
    const detailId = kind === 'project' ? 'xhsStarProjectReport' : 'xhsStarTaskReport';
    const countLabel = kind === 'project' ? '个项目' : '个任务';
    return '<button type="button" class="xhs-star-detail-toggle" data-xhs-star-toggle="' + kind +
      '" aria-expanded="' + String(expanded) + '" aria-controls="' + detailId + '"' +
      (staticExport ? ' disabled aria-disabled="true"' : '') + '>' +
      (expanded ? '收起报表' : '查看更多') + '<span>' + formatInteger(count) + ' ' + countLabel +
      '</span></button>';
  }

  function buildXhsProjectSummary(star, filters, staticExport, expanded) {
    const safe = xhsObject(star);
    const detailExpanded = Boolean(staticExport || expanded !== false);
    const selectedProject = String(filters && filters.projectId || '');
    const selectedTask = String(filters && filters.taskId || '');
    const orders = xhsStarOrders(safe);
    const taskProjectId = selectedTask
      ? String(xhsObject(orders.find((order) => String(order.id) === selectedTask)).projectId || '')
      : '';
    const rows = xhsArray(safe.projects).filter((project) => {
      const id = String(project && project.id || '');
      return (!selectedProject || id === selectedProject) && (!selectedTask || id === taskProjectId);
    });
    const displayRows = rows.map((project) => {
      const id = String(project && project.id || '');
      const projectTasks = orders.filter((order) => (
        String(order.projectId || '') === id && order.businessIdentityVerified !== false
      ));
      const taskCosts = xhsStarAvailableCosts(projectTasks);
      return {
        project: Object.assign({}, xhsObject(project), { costs: taskCosts }),
        taskCount: projectTasks.length,
      };
    });
    const tableRows = displayRows.map(({ project, taskCount }) => {
      const id = String(project && project.id || '');
      return '<tr data-xhs-star-project="' + escapeHtml(id) + '"><th scope="row"><strong>' +
        escapeHtml(project && project.name || id || '未命名项目') + '</strong><small>' +
        escapeHtml(id || '—') + '</small></th><td>' + escapeHtml(xhsStatusLabel(project && project.status)) +
        '</td><td>' + formatInteger(taskCount) + '</td>' + xhsStarSummaryCells(project) + '</tr>';
    }).join('');
    const projectUnits = displayRows.map((row) => row.project);
    // Some Star projects legitimately return no native report row for the selected
    // range. Keep those project rows unknown, but do not let them erase metrics
    // returned by the other projects. Rates and costs are derived again from the
    // available project-level quantities below.
    const total = xhsStarAggregateUnits(projectUnits, { available: true });
    const totalUnit = { costs: total.costs, metrics: total.metrics };
    const totalTaskCount = displayRows.reduce((sum, row) => sum + row.taskCount, 0);
    const totalRow = displayRows.length
      ? '<tr class="xhs-total-row"><th colspan="3" scope="row">筛选后汇总</th>' +
        xhsStarSummaryCells(totalUnit) + '</tr>' : '';
    const emptyRow = displayRows.length
      ? '' : '<tr><td colspan="20">当前筛选条件暂无星河项目汇总。</td></tr>';
    return xhsKpiMarkup([
      ['项目数', formatInteger(displayRows.length)],
      ['任务数', formatInteger(totalTaskCount)],
    ], 'xhs-star-project-metrics') +
      xhsStarMetricCards(total.metrics, total.costs, {
        storeRoi: total.storeRoi,
        taskRoi: total.taskRoi,
        trafficRoi: total.trafficRoi,
      }) + xhsStarDetailToggle('project', detailExpanded, displayRows.length, staticExport) +
      '<div class="xhs-star-detail-report" id="xhsStarProjectReport"' +
      (detailExpanded ? '' : ' hidden') + '>' + buildXhsStarSummaryControls(safe, filters, staticExport) +
      '<div class="report-table-block xhs-wide-table"><table><thead><tr><th>项目</th><th>状态</th><th>任务数</th>' +
      '<th>总花费</th><th>达人花费</th><th>任务期内广告花费</th><th>阅读UV</th>' +
      '<th>搜索曝光UV</th><th>进店UV</th><th>进店率</th><th>进店成本</th>' +
      '<th>加购率</th><th>转化率</th><th>成交UV</th><th>全店GMV</th><th>种草商品GMV</th>' +
      '<th>种草成交占比</th><th>全店ROI</th><th>任务ROI</th><th>投流ROI</th>' +
      '</tr></thead><tbody>' + totalRow + tableRows + emptyRow + '</tbody></table></div></div>';
  }

  function buildXhsTaskSummary(star, filters, staticExport, expanded) {
    const safe = xhsObject(star);
    const detailExpanded = Boolean(staticExport || expanded !== false);
    const selectedProject = String(filters && filters.projectId || '');
    const selectedTask = String(filters && filters.taskId || '');
    const projectNames = new Map(xhsArray(safe.projects).map((project) => [
      String(project && project.id || ''), String(project && project.name || project && project.id || ''),
    ]));
    const rows = xhsStarOrders(safe).filter((task) => (
      task.businessIdentityVerified !== false &&
      (!selectedProject || String(task.projectId || '') === selectedProject) &&
      (!selectedTask || String(task.id || '') === selectedTask)
    ));
    const tableRows = rows.map((task) => {
      const identity = xhsStarOrderPublicIdentity(task);
      const projectId = String(task.projectId || '');
      return '<tr data-xhs-star-task="' + escapeHtml(identity.publicId || '') + '"><th scope="row"><strong>' +
        escapeHtml(task.name || '未命名任务') + '</strong><small>' + escapeHtml(identity.publicId || '—') +
        (identity.verified ? '' : '<em>' + escapeHtml(identity.label) + '</em>') +
        '</small></th><td>' + escapeHtml(projectNames.get(projectId) || (projectId || '未关联项目')) +
        '</td><td>' + escapeHtml(xhsStatusLabel(task.orderStatus || task.status)) + '</td><td>' +
        escapeHtml([task.startDate, task.endDate].filter(Boolean).join(' 至 ') || '—') + '</td>' +
        xhsStarSummaryCells(task) + '</tr>';
    }).join('');
    const total = xhsStarAggregateUnits(rows.filter((task) => task.businessIdentityVerified !== false));
    const totalUnit = { costs: total.costs, metrics: total.metrics };
    const totalRow = rows.length
      ? '<tr class="xhs-total-row"><th colspan="4" scope="row">筛选后汇总</th>' +
        xhsStarSummaryCells(totalUnit) + '</tr>' : '';
    const emptyRow = rows.length
      ? '' : '<tr><td colspan="21">当前筛选条件暂无星河任务汇总。</td></tr>';
    return xhsStarDetailToggle('task', detailExpanded, rows.length, staticExport) +
      '<div class="xhs-star-detail-report" id="xhsStarTaskReport"' +
      (detailExpanded ? '' : ' hidden') + '>' + buildXhsStarSummaryControls(safe, filters, staticExport) +
      '<div class="report-table-block xhs-wide-table"><table><thead><tr><th>任务</th><th>项目</th><th>状态</th>' +
      '<th>任务周期</th><th>总花费</th><th>达人花费</th><th>任务期内广告花费</th><th>阅读UV</th>' +
      '<th>搜索曝光UV</th><th>进店UV</th><th>进店率</th><th>进店成本</th>' +
      '<th>加购率</th><th>转化率</th><th>成交UV</th><th>全店GMV</th><th>种草商品GMV</th>' +
      '<th>种草成交占比</th><th>全店ROI</th><th>任务ROI</th><th>投流ROI</th>' +
      '</tr></thead><tbody>' + totalRow + tableRows + emptyRow + '</tbody></table></div></div>';
  }

  function xhsPeriodCreatorSpend(costs, includedInPeriod) {
    if (xhsHasOwn(costs, 'periodCreator')) return costs.periodCreator;
    if (includedInPeriod === false) return 0;
    if (includedInPeriod !== true) return null;
    const cooperation = asNumber(costs.cooperation);
    const platformFee = asNumber(costs.platformFee);
    return cooperation === null || platformFee === null ? null : cooperation + platformFee;
  }

  function xhsCreatorTotalSpend(costs, includedInPeriod) {
    if (xhsHasOwn(costs, 'creatorTotal')) return costs.creatorTotal;
    const cooperation = asNumber(costs.cooperation);
    const platformFee = asNumber(costs.platformFee);
    if (cooperation !== null && platformFee !== null) return cooperation + platformFee;
    if (includedInPeriod === true && xhsHasOwn(costs, 'periodCreator')) return costs.periodCreator;
    return includedInPeriod === false ? null : xhsPeriodCreatorSpend(costs, includedInPeriod);
  }

  function xhsNoteTaskSpend(note, kind) {
    const juguang = xhsObject(note && note.juguang);
    const bucket = xhsObject(juguang[kind]);
    if (xhsHasOwn(bucket, 'spend')) return asNumber(bucket.spend);
    return null;
  }

  function xhsNoteOutsideSpend(note, completeAlignment) {
    const juguang = xhsObject(note && note.juguang);
    const explicit = xhsObject(juguang.outsideTask);
    if (xhsHasOwn(explicit, 'spend')) return asNumber(explicit.spend);
    const outsideKeys = new Set(['out_of_task', 'outside_task', 'no_task']);
    const buckets = xhsArray(juguang.taskStatuses).filter((bucket) => (
      outsideKeys.has(String(bucket && bucket.key || bucket && bucket.taskStatus || ''))
    ));
    if (!buckets.length) return completeAlignment ? 0 : null;
    let total = 0;
    for (const bucket of buckets) {
      const spend = asNumber(bucket && bucket.spend);
      if (spend === null) return null;
      total += spend;
    }
    return total;
  }

  function xhsNoteCostFacts(note) {
    const pgy = xhsObject(note && note.pgy);
    const costs = xhsObject(note && note.costs);
    const pgyCoverage = String(pgy.coverage || '');
    const pgyCompleteEnough = !['partial', 'unavailable'].includes(pgyCoverage);
    const includedInPeriod = typeof pgy.includedInPeriod === 'boolean'
      ? pgy.includedInPeriod : null;
    const creator = pgyCompleteEnough
      ? asNumber(xhsCreatorTotalSpend(costs, includedInPeriod))
      : null;
    const periodCreator = pgyCompleteEnough
      ? asNumber(xhsPeriodCreatorSpend(costs, includedInPeriod))
      : null;
    const juguang = xhsObject(note && note.juguang);
    const juguangCoverage = String(juguang.coverage || '');
    const juguangCompleteEnough = !['partial', 'unavailable'].includes(juguangCoverage);
    const alignmentCoverage = String(juguang.alignmentCoverage || '');
    const alignmentCompleteEnough = juguangCompleteEnough &&
      !['partial', 'unavailable'].includes(alignmentCoverage);
    const totalBucket = xhsObject(juguang.total);
    const allJuguang = juguangCompleteEnough
      ? (xhsHasOwn(totalBucket, 'spend')
        ? asNumber(totalBucket.spend) : asNumber(costs.juguang))
      : null;
    const inTaskJuguang = alignmentCompleteEnough ? xhsNoteTaskSpend(note, 'inTask') : null;
    const outsideTaskJuguang = alignmentCompleteEnough
      ? xhsNoteOutsideSpend(note, alignmentCoverage === 'complete')
      : null;
    const total = creator === null || allJuguang === null ? null : creator + allJuguang;
    const periodTotal = periodCreator === null || inTaskJuguang === null
      ? null : periodCreator + inTaskJuguang;
    const storeVisitUv = asNumber(xhsObject(note && note.star).metrics &&
      xhsObject(note && note.star).metrics.storeVisitUv);
    return {
      creator,
      periodCreator,
      allJuguang,
      total,
      periodTotal,
      inTaskJuguang,
      outsideTaskJuguang,
      visitCost: divide(periodTotal, storeVisitUv),
    };
  }

  function xhsNoteFilterOptions(analysis, notes, filters) {
    const star = xhsObject(analysis && analysis.star);
    const projects = new Map();
    const tasks = new Map();
    const spus = new Set();
    const rememberTask = (task, projectId) => {
      if (task && task.businessIdentityVerified === false) return;
      const id = String(task && task.id || '');
      if (!id) return;
      tasks.set(id, {
        id,
        label: String(task && task.name || id),
        projectId: String(projectId || task && task.projectId || ''),
      });
    };
    xhsArray(star.projects).forEach((project) => {
      const id = String(project && project.id || '');
      if (id) projects.set(id, String(project && project.name || id));
      xhsArray(project && project.orders).forEach((task) => rememberTask(task, id));
    });
    xhsArray(star.orders).forEach((task) => rememberTask(task, task && task.projectId));
    notes.forEach((note) => {
      const task = xhsObject(note && note.task);
      xhsArray(task.projectIds).forEach((id) => {
        const key = String(id || '');
        if (key && !projects.has(key)) projects.set(key, key);
      });
      xhsArray(task.orderIds).forEach((id) => {
        const key = String(id || '');
        if (key && !tasks.has(key)) tasks.set(key, { id: key, label: key, projectId: '' });
      });
      const spuName = String(xhsObject(note && note.pgy).spuName || '');
      if (spuName) spus.add(spuName);
    });
    const selectedProject = String(filters.projectId || '');
    return {
      projects: [...projects].map(([id, label]) => ({ id, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      tasks: [...tasks.values()].filter((task) => (
        !selectedProject || !task.projectId || task.projectId === selectedProject
      )).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
      spus: [...spus].sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .map((name) => ({ id: name, label: name })),
    };
  }

  function xhsNoteSelect(label, attribute, value, choices, disabled) {
    const options = [{ id: '', label: '全部' }].concat(choices).map((choice) => (
      '<option value="' + escapeHtml(choice.id) + '"' +
      (String(choice.id) === String(value || '') ? ' selected' : '') + '>' +
      escapeHtml(choice.label) + '</option>'
    )).join('');
    return '<label><span>' + escapeHtml(label) + '</span><select ' + attribute +
      ' aria-label="' + escapeHtml(label) + '"' + (disabled ? ' disabled' : '') + '>' + options + '</select></label>';
  }

  function xhsNoteDetailUrl(note) {
    const source = xhsObject(note);
    const explicit = String(source.noteUrl || '').trim();
    if (/^https:\/\/([a-z0-9-]+\.)*xiaohongshu\.com\//i.test(explicit)) return explicit;
    const noteId = String(source.noteId || '').trim();
    return noteId ? 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(noteId) : '';
  }

  function buildXhsNotesTable(analysis, options) {
    const view = xhsObject(options);
    const filters = Object.assign({ projectId: '', taskId: '', spuName: '', from: '', to: '' }, xhsObject(view.filters));
    const notes = xhsArray(analysis.notes);
    const filtered = notes.filter((note) => {
      const task = xhsObject(note && note.task);
      const projectIds = xhsArray(task.projectIds).map(String);
      const taskIds = xhsArray(task.orderIds).map(String);
      const publishDate = String(note && note.publishDate || '');
      const spuName = String(xhsObject(note && note.pgy).spuName || '');
      return (!filters.projectId || projectIds.includes(String(filters.projectId))) &&
        (!filters.taskId || taskIds.includes(String(filters.taskId))) &&
        (!filters.spuName || spuName === String(filters.spuName)) &&
        (!filters.from || Boolean(publishDate) && publishDate >= String(filters.from)) &&
        (!filters.to || Boolean(publishDate) && publishDate <= String(filters.to));
    }).map((note, index) => ({ note, index, facts: xhsNoteCostFacts(note) }))
      .sort((left, right) => {
        const leftSpend = left.facts.total;
        const rightSpend = right.facts.total;
        if (leftSpend === null && rightSpend !== null) return 1;
        if (leftSpend !== null && rightSpend === null) return -1;
        if (leftSpend !== rightSpend) return Number(rightSpend || 0) - Number(leftSpend || 0);
        return left.index - right.index;
      });
    const expandedView = view.expanded === true;
    const visible = filtered.slice(0, expandedView ? filtered.length : 20);
    const filterOptions = xhsNoteFilterOptions(analysis, notes, filters);
    const disabled = view.staticView === true;
    const controls = '<div class="xhs-control-grid xhs-note-controls">' +
      xhsNoteSelect('按项目筛选', 'data-xhs-note-filter="project"', filters.projectId, filterOptions.projects, disabled) +
      xhsNoteSelect('按任务筛选', 'data-xhs-note-filter="task"', filters.taskId, filterOptions.tasks, disabled) +
      xhsNoteSelect('按 SPU 筛选', 'data-xhs-note-filter="spu"', filters.spuName, filterOptions.spus, disabled) +
      '<label><span>发布日期从</span><input type="date" data-xhs-note-date="from" aria-label="发布日期从" value="' +
      escapeHtml(filters.from) + '"' + (disabled ? ' disabled' : '') + '></label>' +
      '<label><span>发布日期至</span><input type="date" data-xhs-note-date="to" aria-label="发布日期至" value="' +
      escapeHtml(filters.to) + '"' + (disabled ? ' disabled' : '') + '></label></div>';
    const rows = visible.length ? visible.map(({ note, facts }) => {
      const pgy = xhsObject(note && note.pgy);
      const pgyMetrics = xhsObject(pgy.metrics);
      const star = xhsObject(note && note.star);
      const starMetrics = xhsObject(star.metrics);
      const results = xhsObject(note && note.results);
      const seededProductGmv = xhsFirstValue(starMetrics.seededProductGmv, results.starTaskGmv);
      const noteDerived = xhsStarDerivedMetrics(
        Object.assign({}, starMetrics, { seededProductGmv }),
        { total: facts.periodTotal, adInTask: facts.inTaskJuguang },
        xhsHasOwn(results, 'starTaskRoi') && starMetrics.seededProductGmv == null
          ? { taskRoi: results.starTaskRoi } : null
      );
      const included = typeof pgy.includedInPeriod === 'boolean' ? pgy.includedInPeriod : null;
      const includedLabel = included === true
        ? '本期计入'
        : included === false
          ? '期外（达人费仍计入总花费）'
          : '历史口径';
      const task = xhsObject(note && note.task);
      const noteUrl = xhsNoteDetailUrl(note);
      const title = escapeHtml(note && note.title || '未命名笔记');
      const titleMarkup = noteUrl
        ? '<a class="xhs-note-detail-link" href="' + escapeHtml(noteUrl) +
          '" target="_blank" rel="noopener noreferrer">' + title + '</a>'
        : title;
      return '<tr data-xhs-note-id="' + escapeHtml(note && note.noteId || '') +
        '" data-xhs-note-project="' + escapeHtml(xhsArray(task.projectIds).join(',')) +
        '" data-xhs-note-task="' + escapeHtml(xhsArray(task.orderIds).join(',')) +
        '" data-xhs-note-spu="' + escapeHtml(pgy.spuName || '') +
        '" data-xhs-note-publish-date="' + escapeHtml(note && note.publishDate || '') +
        '" data-pgy-included-in-period="' + (included === null ? 'unknown' : String(included)) + '"><td>' +
        escapeHtml(includedLabel) + '</td><td>' + escapeHtml(note && note.publishDate || '—') + '</td><td><strong>' +
        titleMarkup + '</strong><small>' + escapeHtml(note && note.noteId || '—') +
        '</small></td><td>' + escapeHtml(pgy.spuName || '—') + '</td><td>' + formatMoney(facts.creator) + '</td><td>' + formatMoney(facts.allJuguang) +
        '</td><td>' + formatMoney(facts.total) + '</td><td>' + formatMoney(facts.periodTotal) + '</td><td>' +
        formatMoney(facts.outsideTaskJuguang) + '</td><td>' + formatMoney(facts.visitCost) + '</td><td>' +
        formatInteger(pgyMetrics.impressions) + '</td><td>' + formatInteger(pgyMetrics.reads) + '</td><td>' +
        formatInteger(pgyMetrics.interactions) + '</td><td>' + formatInteger(starMetrics.readUv) + '</td><td>' +
        formatInteger(starMetrics.storeVisitUv) + '</td><td>' + formatPercent(noteDerived.visitRate, 2) +
        '</td><td>' + formatPercent(noteDerived.addCartRate, 2) + '</td><td>' +
        formatPercent(noteDerived.conversionRate, 2) + '</td><td>' + formatInteger(starMetrics.orderUv) +
        '</td><td>' + formatMoney(starMetrics.gmv) + '</td><td>' + formatMoney(seededProductGmv) +
        '</td><td>' + formatPercent(noteDerived.seededProductShare, 2) + '</td><td>' +
        formatDecimal(noteDerived.storeRoi, 2) + '</td><td>' + formatDecimal(noteDerived.taskRoi, 2) +
        '</td><td>' + formatDecimal(noteDerived.trafficRoi, 2) + '</td></tr>';
    }).join('') : '<tr><td colspan="25">当前筛选条件暂无星河数据的笔记。</td></tr>';
    const totals = {
      creator: xhsSumKnown(filtered, (item) => item.facts.creator),
      allJuguang: xhsSumKnown(filtered, (item) => item.facts.allJuguang),
      total: xhsSumKnown(filtered, (item) => item.facts.total),
      periodTotal: xhsSumKnown(filtered, (item) => item.facts.periodTotal),
      inTaskJuguang: xhsSumKnown(filtered, (item) => item.facts.inTaskJuguang),
      outsideTaskJuguang: xhsSumKnown(filtered, (item) => item.facts.outsideTaskJuguang),
      pgyImpressions: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.pgy).metrics &&
        xhsObject(item.note && item.note.pgy).metrics.impressions),
      pgyReads: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.pgy).metrics &&
        xhsObject(item.note && item.note.pgy).metrics.reads),
      pgyInteractions: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.pgy).metrics &&
        xhsObject(item.note && item.note.pgy).metrics.interactions),
      starReadUv: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.star).metrics &&
        xhsObject(item.note && item.note.star).metrics.readUv),
      storeVisitUv: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.star).metrics &&
        xhsObject(item.note && item.note.star).metrics.storeVisitUv),
      cartUv: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.star).metrics &&
        xhsObject(item.note && item.note.star).metrics.cartUv),
      orderUv: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.star).metrics &&
        xhsObject(item.note && item.note.star).metrics.orderUv),
      storeGmv: xhsSumKnown(filtered, (item) => xhsObject(item.note && item.note.star).metrics &&
        xhsObject(item.note && item.note.star).metrics.gmv),
      seededProductGmv: xhsSumKnown(filtered, (item) => xhsFirstValue(
        xhsObject(item.note && item.note.star).metrics &&
          xhsObject(item.note && item.note.star).metrics.seededProductGmv,
        xhsObject(item.note && item.note.results).starTaskGmv
      )),
    };
    const totalDerived = xhsStarDerivedMetrics({
      readUv: totals.starReadUv,
      storeVisitUv: totals.storeVisitUv,
      cartUv: totals.cartUv,
      orderUv: totals.orderUv,
      gmv: totals.storeGmv,
      seededProductGmv: totals.seededProductGmv,
    }, { total: totals.periodTotal, adInTask: totals.inTaskJuguang });
    const totalRow = filtered.length
      ? '<tr class="xhs-total-row" data-xhs-note-total><th colspan="4" scope="row">筛选后汇总</th><td>' +
        formatMoney(totals.creator) + '</td><td>' + formatMoney(totals.allJuguang) + '</td><td>' +
        formatMoney(totals.total) + '</td><td>' + formatMoney(totals.periodTotal) + '</td><td>' +
        formatMoney(totals.outsideTaskJuguang) + '</td><td>' + formatMoney(totalDerived.visitCost) + '</td><td>' +
        formatInteger(totals.pgyImpressions) + '</td><td>' + formatInteger(totals.pgyReads) + '</td><td>' +
        formatInteger(totals.pgyInteractions) + '</td><td>' + formatInteger(totals.starReadUv) + '</td><td>' +
        formatInteger(totals.storeVisitUv) + '</td><td>' + formatPercent(totalDerived.visitRate, 2) +
        '</td><td>' + formatPercent(totalDerived.addCartRate, 2) + '</td><td>' +
        formatPercent(totalDerived.conversionRate, 2) + '</td><td>' + formatInteger(totals.orderUv) +
        '</td><td>' + formatMoney(totals.storeGmv) + '</td><td>' + formatMoney(totals.seededProductGmv) +
        '</td><td>' + formatPercent(totalDerived.seededProductShare, 2) + '</td><td>' +
        formatDecimal(totalDerived.storeRoi, 2) + '</td><td>' + formatDecimal(totalDerived.taskRoi, 2) +
        '</td><td>' + formatDecimal(totalDerived.trafficRoi, 2) + '</td></tr>' : '';
    const toggle = filtered.length > 20
      ? '<button type="button" data-xhs-note-toggle aria-expanded="' + String(expandedView) + '"' +
        (disabled ? ' disabled' : '') + '>' + (expandedView ? '收起' : '查看更多') + '</button>' : '';
    return controls + '<div class="report-table-block xhs-wide-table"><div class="xhs-note-browser-summary">显示 ' +
      visible.length + ' / ' + filtered.length + toggle + '</div><table><thead><tr><th>蒲公英计入本期</th><th>发布日期</th>' +
      '<th>笔记</th><th>SPU名称</th><th>达人花费</th><th>全部聚光</th><th>总花费</th><th>任务期内花费</th>' +
      '<th>任务期外花费</th><th>进店成本</th><th>蒲公英曝光</th>' +
      '<th>蒲公英阅读</th><th>蒲公英互动</th><th>星河阅读UV</th><th>星河进店UV</th>' +
      '<th>进店率</th><th>加购率</th><th>转化率</th><th>成交UV</th><th>全店GMV</th>' +
      '<th>种草商品GMV（任务GMV）</th><th>种草成交占比</th><th>全店ROI</th><th>任务ROI</th><th>投流ROI</th>' +
      '</tr></thead><tbody>' + totalRow + rows + '</tbody></table></div>';
  }

  function buildXhsMarkup(options) {
    const staticExport = Boolean(options && options.staticExport);
    const platform = XHS_REPORT_SECTION_KEYS.includes(options && options.platform)
      ? options.platform : '';
    const analysis = xhsObject(xhsAnalysis);
    resetXhsNoteStateForSnapshot(analysis);
    resetXhsStarStateForSnapshot(analysis);
    const management = xhsObject(analysis.management);
    const costs = xhsObject(management.costs);
    const overview = xhsObject(management.accountOverview);
    const quality = Object.keys(xhsObject(analysis.quality)).length
      ? xhsObject(analysis.quality) : { decisionReady: false, issues: [] };
    const sourceCards = buildXhsSourceCardsMarkup(analysis, platform ? [platform] : null);
    const issues = xhsArray(quality.issues).filter((issue) => (
      !platform || !issue || !issue.platform || String(issue.platform) === platform
    ));
    const issueMarkup = issues.length
      ? '<ul class="xhs-quality-list">' + issues.map((issue) => '<li><b>' +
        escapeHtml(issue.severity === 'critical' ? '关键' : '提示') + '</b><span>' +
        escapeHtml(issue.message || issue.code || '数据口径待核验') + '</span></li>').join('') + '</ul>'
      : '<p class="xhs-quality-empty">' + (quality.decisionReady
        ? (platform ? '三平台已完整取数并对齐，本平台报告已生成。' : '三平台数据完整性、日期、分页和对账均已通过。')
        : '质量证据不足，请在经营决策前补齐数据。') + '</p>';
    const qualityMarkup = '<section class="xhs-quality-panel"><div><span>数据质量</span><h3>' +
      (quality.decisionReady ? '可用于经营决策' : '需补数后再决策') + '</h3></div><b>' +
      (quality.decisionReady ? 'decisionReady = true' : 'decisionReady = false') + '</b>' + issueMarkup + '</section>';
    const accountKpis = xhsKpiMarkup([
      ['总投入', formatMoney(xhsOwnOrFallback(overview, 'totalSpend', costs.total))],
      ['达人花费', formatMoney(xhsOwnOrFallback(overview, 'creatorSpend', costs.partnership))],
      ['广告花费', formatMoney(xhsOwnOrFallback(overview, 'adSpend', costs.juguang, costs.spotlight))],
      ['星河归因投入', formatMoney(xhsOwnOrFallback(overview, 'starAlignedSpend', costs.starTaskAligned))],
      ['任务期内广告花费', formatMoney(xhsOwnOrFallback(overview, 'taskAdSpend', costs.juguangInTask))],
      ['任务期外广告花费', formatMoney(xhsOwnOrFallback(overview, 'outsideTaskAdSpend', costs.juguangOutsideTask))],
      ['任务周期未知广告花费', formatMoney(xhsOwnOrFallback(overview, 'unknownTaskAdSpend', costs.juguangUnknownTask))],
      ['任务ROI', formatDecimal(xhsOwnOrFallback(overview, 'taskRoi', management.starTaskResult && management.starTaskResult.roi), 2)],
      ['任务外直达ROI', formatDecimal(xhsOwnOrFallback(overview, 'outsideDirectRoi', management.outsideDirectResult && management.outsideDirectResult.roi), 2)],
      ['直达ROI', formatDecimal(xhsOwnOrFallback(overview, 'directRoi', management.directResult && management.directResult.roi), 2)],
    ], 'xhs-account-metrics');
    const taskBuckets = xhsArray(analysis.spotlight && analysis.spotlight.byTaskObjective);
    const bucketRows = taskBuckets.length ? taskBuckets.map((row) => '<tr><td>' +
      escapeHtml(xhsTaskStatusLabel(row && row.taskStatus)) + '</td><td>' +
      escapeHtml(xhsObjectiveLabel(row && row.marketingObjective)) + '</td><td>' + formatMoney(row && row.spend) +
      '</td><td>' + formatInteger(row && row.impressions) + '</td><td>' + formatInteger(row && row.clicks) +
      '</td><td>' + formatMoney(row && row.gmv) + '</td><td>' + formatDecimal(row && row.roi, 2) + '</td></tr>').join('')
      : '<tr><td colspan="7">历史归档未保存任务状态 × 营销诉求拆分。</td></tr>';
    const taskBucketTotals = {
      spend: xhsSumKnown(taskBuckets, (row) => row && row.spend),
      impressions: xhsSumKnown(taskBuckets, (row) => row && row.impressions),
      clicks: xhsSumKnown(taskBuckets, (row) => row && row.clicks),
      gmv: xhsSumKnown(taskBuckets, (row) => row && row.gmv),
    };
    taskBucketTotals.roi = divide(taskBucketTotals.gmv, taskBucketTotals.spend);
    const taskBucketTotalRow = taskBuckets.length
      ? '<tr class="xhs-total-row"><th colspan="2" scope="row">汇总</th><td>' +
        formatMoney(taskBucketTotals.spend) + '</td><td>' + formatInteger(taskBucketTotals.impressions) +
        '</td><td>' + formatInteger(taskBucketTotals.clicks) + '</td><td>' +
        formatMoney(taskBucketTotals.gmv) + '</td><td>' + formatDecimal(taskBucketTotals.roi, 2) + '</td></tr>'
      : '';
    const adSpendBreakdownMarkup = '<div class="report-table-block"><div class="xhs-table-heading"><h4>广告花费拆分</h4><span>任务状态 × 营销诉求</span></div>' +
      '<table><thead><tr><th>任务状态</th><th>营销诉求</th><th>消耗</th><th>曝光</th><th>点击</th><th>15日GMV</th><th>ROI</th></tr></thead>' +
      '<tbody>' + taskBucketTotalRow + bucketRows + '</tbody></table></div>';
    const accountPanel = '<section class="xhs-report-panel" data-xhs-panel="account-overview">' +
      xhsPanelHeading('ACCOUNT OVERVIEW', '账户总览', '达人费按发布日期计入，广告费保留任务期内外口径', '统一投入口径') +
      sourceCards + qualityMarkup + '</section>';
    const platformEvidencePanel = '<section class="xhs-report-panel" data-xhs-panel="platform-evidence">' +
      xhsPanelHeading('SOURCE STATUS', (xhsPlatformDefinition(platform) || {}).name || '小红书',
        '三平台并行取数全部结束后，再统一对齐并发布平台报告', '完整取数后发布') +
      sourceCards + qualityMarkup + '</section>';

    const archivedPgy = xhsObject(analysis.pgy);
    const pgyView = xhsPgyReportView(analysis, archivedPgy);
    const pgy = pgyView.summary;
    const pgyMetrics = xhsObject(pgy.metrics);
    const pgyCosts = xhsObject(pgy.costs);
    const pgyTaobao15d = xhsObject(pgy.taobao15d);
    const pgyPanel = '<section class="xhs-report-panel" data-xhs-panel="pgy-analysis">' +
      xhsPanelHeading('PUGONGYING', '蒲公英分析', '仅统计所选时间内发布的笔记；合作金额与平台服务费分开展示', '发布日期口径') +
      buildXhsPgyDateControls(pgyView, staticExport) +
      xhsKpiMarkup([
        ['时间筛选内笔记数', formatInteger(xhsFirstValue(pgy.noteCount, pgy.reportedNoteCount))],
        ['星河任务笔记数', formatInteger(pgy.starTaskNoteCount)],
        ['超期笔记数', formatInteger(pgy.overdueNoteCount)],
        ['合作金额', formatMoney(pgyCosts.cooperation)],
        ['平台服务费', formatMoney(pgyCosts.platformFee)],
        ['达人花费', formatMoney(pgyCosts.total)],
        ['曝光量', formatInteger(pgyMetrics.impressions)],
        ['阅读量', formatInteger(pgyMetrics.reads)],
        ['互动量', formatInteger(pgyMetrics.interactions)],
        ['阅读率', formatPercent(pgyMetrics.readRate)],
        ['互动率', formatPercent(pgyMetrics.engagementRate)],
        ['淘宝站外活跃行为UV(15天)', formatInteger(pgyTaobao15d.offsiteActiveUv)],
        ['淘宝站外活跃成本(15天)', formatMoney(pgyTaobao15d.offsiteActiveCost)],
        ['淘宝成交UV(15天)', formatInteger(pgyTaobao15d.dealUv)],
        ['淘宝加购UV(15天)', formatInteger(pgyTaobao15d.addCartUv)],
        ['淘宝加购率(15天)', formatPercent(pgyTaobao15d.addCartRate, 2)],
        ['淘宝购买率(15天)', formatPercent(pgyTaobao15d.purchaseRate, 2)],
      ], 'xhs-pgy-metrics') + '<div class="xhs-chart-grid">' + buildXhsMonthlyChart(pgy.monthly) +
      buildXhsFollowerChart(pgy.followerTiers) + '</div>' +
      buildXhsPgyNoteAnalysis(pgyView, staticExport) + '</section>';

    const spotlight = xhsObject(analysis.spotlight);
    const aggregation = aggregateXhsJuguang(spotlight);
    const spotlightDaily = xhsArray(spotlight.daily);
    const spotlightPlacementUnavailable = xhsPlacementFactsUnavailable(spotlightDaily);
    const legacySpotlightFactsUnavailable = spotlightDaily.length === 0 && (
      xhsArray(spotlight.byAccount).length > 0 ||
      xhsArray(spotlight.byMarketingObjective).length > 0 ||
      xhsArray(spotlight.byPlacementType).length > 0 ||
      xhsArray(spotlight.byDeliveryMode).length > 0 ||
      Number(xhsObject(spotlight.total).spend) > 0
    );
    const spotlightModelUnavailable = spotlightDaily.length > 0 && !(
      window.XhsReportModel && typeof window.XhsReportModel.aggregateSpotlight === 'function'
    );
    const juguangPanel = '<section class="xhs-report-panel" data-xhs-panel="juguang-analysis">' +
      xhsPanelHeading('JUGUANG', '聚光投放分析',
        '任务期按笔记关联的星河任务起止日期逐日判定；周期证据不完整的消耗单列为未知',
        '账户 → 营销诉求 → 投放位置') +
      buildXhsJuguangControls(spotlightDaily, staticExport, legacySpotlightFactsUnavailable,
        spotlightModelUnavailable, spotlightPlacementUnavailable) +
      buildXhsJuguangTable(spotlight, aggregation) + '</section>';

    const star = xhsObject(analysis.star);
    const storeFieldPresent = xhsHasOwn(star, 'store');
    const storeFieldIsObject = storeFieldPresent && star.store && typeof star.store === 'object' &&
      !Array.isArray(star.store);
    const store = xhsObject(star.store);
    const taskSummaryFieldPresent = xhsHasOwn(star, 'taskSummary');
    const taskSummaryFieldIsObject = taskSummaryFieldPresent && star.taskSummary &&
      typeof star.taskSummary === 'object' && !Array.isArray(star.taskSummary);
    const taskSummary = xhsObject(star.taskSummary);
    const legacyTask = xhsObject(management.starTaskResult);
    const legacyStoreCosts = {
      total: xhsFirstValue(costs.starTaskAligned, costs.total),
      creator: costs.partnership,
      adInTask: xhsFirstValue(costs.juguangInTask, costs.juguang),
    };
    const storeMetrics = storeFieldPresent && !storeFieldIsObject
      ? {}
      : xhsObject(xhsOwnOrFallback(store, 'metrics', legacyTask.metrics));
    const storeCosts = storeFieldPresent && !storeFieldIsObject
      ? {}
      : xhsObject(xhsOwnOrFallback(store, 'costs', legacyStoreCosts));
    const storeRoi = storeFieldPresent && !storeFieldIsObject
      ? null
      : xhsOwnOrFallback(store, 'storeRoi', management.storeResult && management.storeResult.roi);
    const storeTaskRoi = storeFieldPresent && !storeFieldIsObject
      ? null
      : xhsOwnOrFallback(store, 'taskRoi', management.starTaskResult && management.starTaskResult.roi);
    const taskCosts = taskSummaryFieldPresent && !taskSummaryFieldIsObject
      ? {}
      : xhsObject(xhsOwnOrFallback(taskSummary, 'costs', storeCosts));
    const taskNoteCount = taskSummaryFieldPresent
      ? taskSummaryFieldIsObject
        ? xhsOwnOrFallback(taskSummary, 'activeNoteCount', management.noteCount)
        : null
      : null;
    const taskGmv = taskSummaryFieldPresent
      ? taskSummaryFieldIsObject
        ? xhsOwnOrFallback(taskSummary, 'gmv', legacyTask.gmv)
        : null
      : legacyTask.gmv;
    const taskRoi = taskSummaryFieldPresent
      ? taskSummaryFieldIsObject
        ? xhsOwnOrFallback(taskSummary, 'roi', legacyTask.roi)
        : null
      : legacyTask.roi;
    const taskAggregate = xhsStarAggregateUnits(xhsStarOrders(star).filter((task) => (
      task.businessIdentityVerified !== false
    )));
    const taskMetrics = taskSummaryFieldPresent && taskSummaryFieldIsObject && xhsHasOwn(taskSummary, 'metrics')
      ? xhsObject(taskSummary.metrics) : taskAggregate.metrics;
    const taskMetricValues = Object.assign({}, taskMetrics, {
      seededProductGmv: xhsOwnOrFallback(taskMetrics, 'seededProductGmv', taskGmv),
    });
    const starPanel = '<section class="xhs-report-panel" data-xhs-panel="star-analysis">' +
      xhsPanelHeading('TAOBAO STAR', '星河分析', '指标保留各层星河原生汇总；花费从唯一归属笔记向上汇总到任务和项目，不均摊', '店铺 → 项目 → 任务') +
      '<section class="xhs-star-summary"><div class="xhs-subsection-heading"><h4>星河全店汇总</h4><span>全店 GMV 口径</span></div>' +
      xhsStarMetricCards(storeMetrics, storeCosts, { storeRoi, taskRoi: storeTaskRoi }) +
      '<div class="xhs-subsection-heading xhs-star-investment-heading"><h5>投入与投放拆分</h5><span>已合并账户总投入及任务期内外广告数据</span></div>' +
      accountKpis + adSpendBreakdownMarkup + '</section>' +
      '<section class="xhs-star-summary"><div class="xhs-subsection-heading"><h4>星河任务汇总</h4><span>' +
      formatInteger(taskNoteCount) + ' 篇任务笔记</span></div>' +
      xhsKpiMarkup([
        ['任务笔记数', formatInteger(taskNoteCount)],
        ['任务GMV', formatMoney(taskGmv)],
      ], 'xhs-star-task-metrics') + xhsStarMetricCards(taskMetricValues, taskCosts, { taskRoi }) +
      buildXhsTaskSummary(star, xhsStarFilters, staticExport, xhsStarExpanded.task) + '</section>' +
      '<section class="xhs-star-projects"><div class="xhs-subsection-heading"><h4>项目汇总</h4><span>默认展示项目级汇总数据</span></div>' +
      buildXhsProjectSummary(star, xhsStarFilters, staticExport, xhsStarExpanded.project) +
      '</section></section>';

    const notePanel = '<section class="xhs-report-panel" data-xhs-panel="note-join">' +
      xhsPanelHeading('NOTE JOIN', '笔记全链路', '展示星河有数据的笔记；蒲公英期外笔记仍保留达人花费，并可按 SPU 筛选',
        xhsArray(analysis.notes).length + ' 篇') + buildXhsNotesTable(analysis, {
        filters: xhsNoteFilters,
        expanded: staticExport || xhsNoteExpanded,
        staticView: staticExport,
      }) + '</section>';

    if (platform === 'adstar') {
      return '<div class="xhs-report-body">' + accountPanel + starPanel + notePanel + '</div>';
    }
    if (platform === 'pgy') {
      return '<div class="xhs-report-body">' + platformEvidencePanel + pgyPanel + '</div>';
    }
    if (platform === 'juguang') {
      return '<div class="xhs-report-body">' + platformEvidencePanel + juguangPanel + '</div>';
    }
    return '<div class="xhs-report-body">' + accountPanel + pgyPanel + juguangPanel + starPanel + notePanel + '</div>';
  }

  function renderXhsLegacy() {
    const target = document.getElementById('xhsReport');
    if (!target) return;
    const error = sectionError('xiaohongshu');
    if (!validXhsAnalysisSnapshot() && error) {
      const partial = xhsStatus && xhsStatus.status === 'partial';
      target.innerHTML = buildXhsSourceCardsMarkup(null) + '<div class="section-error"><strong>' +
        (partial ? '小红书全链路取数不完整' : '小红书全链路取数失败') +
        '</strong><p>' + escapeHtml(error) + '</p></div>';
      return;
    }
    if (!sectionHasData('xiaohongshu')) {
      target.innerHTML = '<div class="section-error"><strong>等待小红书全链路取数</strong>' +
        '<p>完成淘宝星河、蒲公英和聚光采集后，本章节会自动显示。</p></div>';
      return;
    }
    const range = xhsAnalysis && xhsAnalysis.dateRange || {};
    const context = document.getElementById('xhsContext');
    if (context) context.textContent = [range.from, range.to].filter(Boolean).join(' 至 ') || '自定义日期范围';
    target.innerHTML = buildXhsMarkup();
  }

  function renderXhsPlatform(platform) {
    const definition = xhsPlatformDefinition(platform);
    if (!definition) return;
    const target = document.getElementById(definition.mountId);
    if (!target) return;
    const error = sectionError(platform);
    if (!sectionHasData(platform)) {
      const stateMarkup = xhsPlatformSelected(platform)
        ? buildXhsSourceCardsMarkup(null, [platform])
        : '';
      const title = !xhsPlatformSelected(platform)
        ? '本次未选择' + definition.name
        : (error ? definition.name + '报告未生成' : '等待' + definition.name + '取数');
      const copy = error || (!xhsPlatformSelected(platform)
        ? '这份归档没有选择该平台。'
        : '星河、蒲公英和聚光并行取数全部结束后，三份平台报告会一起发布。');
      target.innerHTML = stateMarkup + '<div class="section-error"><strong>' +
        escapeHtml(title) + '</strong><p>' + escapeHtml(copy) + '</p></div>';
      return;
    }
    const analysis = xhsObject(xhsAnalysis);
    const markup = buildXhsMarkup({ platform });
    const range = platform === 'pgy'
      ? currentXhsPgyDateRange(analysis, xhsObject(analysis.pgy))
      : xhsObject(analysis.dateRange);
    const context = document.getElementById(definition.contextId);
    if (context) context.textContent = [range.from, range.to].filter(Boolean).join(' 至 ') || '自定义日期范围';
    target.innerHTML = markup;
  }

  function renderXhs() {
    if (document.getElementById('xhsReport')) {
      renderXhsLegacy();
      return;
    }
    XHS_REPORT_SECTION_KEYS.forEach(renderXhsPlatform);
  }

  function dmpExportStyles() {
    return [
      '.dmp-export-section{max-width:1500px;margin:24px auto;background:#f4f6f8}.dmp-export-section>h1{margin:0;padding:24px 28px 4px;background:#243b72;color:#fff}.dmp-export-section>p{margin:0;padding:0 28px 24px;background:#243b72;color:#dbe7ff}',
      '.dmp-report-body{padding:18px}.dmp-crowd-summary,.dmp-tag-section{margin:0 0 16px;border:1px solid #dfe4ea;background:#fff}.dmp-summary-heading,.dmp-tag-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:16px 18px;border-bottom:1px solid #e6eaf0}.dmp-summary-heading span,.dmp-tag-heading span{color:#667085;font-size:10px;font-weight:750}.dmp-summary-heading h3,.dmp-tag-heading h3{margin:3px 0 0;font-size:18px}.dmp-summary-heading>b,.dmp-tag-heading>b{color:#475467;font-size:11px}',
      '.dmp-legend{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#e6eaf0}.dmp-legend-item{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:9px;padding:14px;background:#fff}.dmp-legend-item>i{width:10px;height:28px;border-radius:2px}.dmp-legend-item strong,.dmp-legend-item span{display:block}.dmp-legend-item strong{font-size:12px}.dmp-legend-item span{margin-top:3px;color:#667085;font-size:10px}.dmp-legend-item>b{font-size:16px}.dmp-legend-item.missing{opacity:.55}',
      '.dmp-warning{display:flex;gap:12px;margin:0 0 16px;padding:11px 14px;border-left:3px solid #e66a12;background:#fff7ed}.dmp-warning strong{color:#9a3412;font-size:12px;white-space:nowrap}.dmp-warning span{color:#7c2d12;font-size:11px}.dmp-table-wrap{overflow:auto}.dmp-table{width:100%;min-width:1080px;border-collapse:collapse;table-layout:fixed}.dmp-table th,.dmp-table td{padding:10px;border-bottom:1px solid #e6eaf0;text-align:left;vertical-align:middle}.dmp-table th{background:#f8fafc;color:#475467;font-size:11px}.dmp-table th:first-child,.dmp-table td:first-child{width:130px;background:#fbfcfe;font-weight:700}.dmp-crowd-dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%}',
      '.dmp-data-cell{position:relative;height:50px;overflow:hidden}.dmp-cell-fill{position:absolute;inset:7px auto 7px 7px;width:var(--bar);border-left:3px solid var(--bar-color);border-radius:3px;background:color-mix(in srgb,var(--bar-color) 16%,white)}.dmp-cell-content{position:relative;z-index:1;display:flex;align-items:baseline;justify-content:space-between;gap:8px}.dmp-cell-content strong{font-size:14px}.dmp-cell-content span{color:#667085;font-size:10px;white-space:nowrap}.dmp-data-cell.empty-cell,.dmp-empty-row{color:#98a2b3;text-align:center}',
      '@media(max-width:900px){.dmp-legend{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    ].join('');
  }

  function cellText(row, index) {
    const cell = row.children[index];
    return String(cell && (cell.getAttribute('data-filter-value') || cell.textContent) || '').trim();
  }

  function initializeWxtTables(root) {
    root.querySelectorAll('table[data-filter-table-id]').forEach((table) => {
      if (table.getAttribute('data-controls-ready') === '1') return;
      table.setAttribute('data-controls-ready', '1');
      const headers = Array.from(table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells : []);
      headers.forEach((header, index) => {
        if (header.getAttribute('data-filter-type') === 'text') {
          const values = Array.from(new Set(Array.from(table.tBodies[0].rows)
            .map((row) => cellText(row, index)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
          const select = document.createElement('select');
          select.setAttribute('data-col-filter', String(index));
          const allOption = document.createElement('option');
          allOption.value = '';
          allOption.textContent = '全部';
          select.appendChild(allOption);
          values.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
          });
          header.appendChild(select);
        }
      });
    });
  }

  function bindWxtInteractions(root) {
    if (root.__taobaoReportBound) return;
    root.__taobaoReportBound = true;
    root.addEventListener('change', (event) => {
      const attribution = event.target && event.target.closest('[data-attribution-select]');
      if (attribution) {
        root.querySelectorAll('[data-attribution-report]').forEach((section) => {
          section.hidden = section.getAttribute('data-attribution-report') !== attribution.value;
        });
        initializeWxtTables(root);
        return;
      }
      const select = event.target && event.target.closest('thead select[data-col-filter]');
      if (!select) return;
      const table = select.closest('table');
      const filters = Array.from(table.querySelectorAll('thead select[data-col-filter]'))
        .map((item) => ({ index: Number(item.getAttribute('data-col-filter')), value: item.value }))
        .filter((item) => item.value);
      Array.from(table.tBodies[0].rows).forEach((row) => {
        row.style.display = filters.every((filter) => cellText(row, filter.index) === filter.value) ? '' : 'none';
      });
    });
    root.addEventListener('click', (event) => {
      const header = event.target && event.target.closest('th[data-sort-type="number"]');
      if (!header || event.target.tagName === 'SELECT') return;
      const table = header.closest('table');
      const index = Array.from(header.parentNode.children).indexOf(header);
      const direction = header.getAttribute('data-sort-direction') === 'desc' ? 'asc' : 'desc';
      Array.from(header.parentNode.children).forEach((cell) => cell.removeAttribute('data-sort-direction'));
      header.setAttribute('data-sort-direction', direction);
      const body = table.tBodies[0];
      Array.from(body.rows).sort((left, right) => {
        let leftValue = Number(left.children[index] && left.children[index].getAttribute('data-sort-value'));
        let rightValue = Number(right.children[index] && right.children[index].getAttribute('data-sort-value'));
        if (!Number.isFinite(leftValue)) leftValue = -Infinity;
        if (!Number.isFinite(rightValue)) rightValue = -Infinity;
        return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }).forEach((row) => body.appendChild(row));
    });
  }

  const WXT_CHART_LAYOUT_OVERRIDES =
    '.wxt-chart-section{min-width:0!important;overflow:hidden!important}' +
    '.wxt-pie-layout{grid-template-columns:minmax(120px,148px) minmax(0,1fr)!important;gap:14px!important}' +
    '.wxt-pie{width:min(100%,148px)!important;justify-self:center!important}' +
    '.wxt-pie-legend{width:100%!important;min-width:0!important;overflow:hidden!important}' +
    '.wxt-legend-row{grid-template-columns:9px minmax(0,1fr) minmax(76px,max-content) minmax(44px,max-content)!important;gap:7px!important;padding:5px 4px!important}' +
    '.wxt-legend-row b,.wxt-legend-row em{white-space:nowrap!important;font-variant-numeric:tabular-nums}' +
    '@media(max-width:620px){.wxt-pie-layout{grid-template-columns:1fr!important}.wxt-pie{width:min(184px,70vw)!important}}';

  // Keep large archived KPI values readable even when their stored snapshot still contains
  // the older ellipsis rule. Container units shrink the type in narrow five-column layouts;
  // overflow wrapping is the final guard for unusually large values.
  const WXT_KPI_LAYOUT_OVERRIDES =
    '.wxt-kpi-strip>div{container-type:inline-size}' +
    '.wxt-kpi-strip strong{min-width:0!important;overflow:visible!important;font-size:18px!important;' +
    'font-size:clamp(16px,10.5cqw,22px)!important;line-height:1.2!important;letter-spacing:-.02em!important;' +
    'font-variant-numeric:tabular-nums;white-space:normal!important;overflow-wrap:anywhere!important;text-overflow:clip!important}';

  const WXT_TABLE_LAYOUT_OVERRIDES =
    '.wxt-table-scroll{border-top-color:#dce5f2!important}' +
    '.wxt-report-table th,.wxt-report-table td{border-color:#e3eaf4!important}' +
    '.wxt-report-table th{background:#eef4ff!important;color:#243b72!important;font-weight:750!important}' +
    '.wxt-report-table th select{border-color:#d7e2f1!important;background:#fff!important}' +
    '.wxt-goal-reference{display:block!important;margin-top:4px!important;color:#5e78ad!important;font-size:10px!important;font-weight:650!important;line-height:1.2!important}' +
    '.wxt-report-table tbody tr:nth-child(even) td:not(:first-child):not(.wxt-metric-good):not(.wxt-metric-bad):not(.wxt-metric-watch){background:#fbfcff!important}' +
    '.wxt-report-table tbody tr:hover td:not(:first-child):not(.wxt-metric-good):not(.wxt-metric-bad):not(.wxt-metric-watch){background:#f4f8ff!important}' +
    '.wxt-diagnosis-table th:first-child,.wxt-diagnosis-table td:first-child,.wxt-aggregate-table th:first-child,.wxt-aggregate-table td:first-child,.wxt-linked-table th:first-child,.wxt-linked-table td:first-child{width:118px!important;min-width:118px!important;text-align:center!important}' +
    '.wxt-diagnosis-table th:nth-child(2),.wxt-diagnosis-table td:nth-child(2),.wxt-aggregate-table th:nth-child(2),.wxt-aggregate-table td:nth-child(2),.wxt-linked-table th:nth-child(2),.wxt-linked-table td:nth-child(2){position:sticky!important;left:118px!important;z-index:2!important;background:#fff!important;text-align:left!important;box-shadow:1px 0 0 #d7e2f1,8px 0 12px -12px rgba(36,59,114,.65)!important}' +
    '.wxt-diagnosis-table th:nth-child(2),.wxt-aggregate-table th:nth-child(2),.wxt-linked-table th:nth-child(2){z-index:3!important;background:#eef4ff!important}' +
    '.wxt-diagnosis-table th:nth-child(2),.wxt-diagnosis-table td:nth-child(2){width:240px!important;min-width:240px!important}' +
    '.wxt-aggregate-table th:nth-child(2),.wxt-aggregate-table td:nth-child(2){width:300px!important;min-width:300px!important}' +
    '.wxt-linked-table th:nth-child(2),.wxt-linked-table td:nth-child(2){width:210px!important;min-width:210px!important}' +
    '.wxt-diagnosis-table tbody tr:nth-child(even) td:nth-child(2),.wxt-aggregate-table tbody tr:nth-child(even) td:nth-child(2),.wxt-linked-table tbody tr:nth-child(even) td:nth-child(2){background:#fbfcff!important}' +
    '.wxt-diagnosis-table tbody tr:hover td:nth-child(2),.wxt-aggregate-table tbody tr:hover td:nth-child(2),.wxt-linked-table tbody tr:hover td:nth-child(2){background:#f4f8ff!important}';

  const GUANGHE_EXPORT_STYLES =
    '.guanghe-table{min-width:1540px!important;table-layout:fixed;font-size:12px}' +
    '.guanghe-table.asset-view{min-width:1840px!important}' +
    '.guanghe-table th,.guanghe-table td{height:42px;padding:8px 10px;border-right:1px solid #dce5f2;text-align:center;font-variant-numeric:tabular-nums}' +
    '.guanghe-table thead tr:first-child th{height:40px;background:#315fbd;color:#fff;font-weight:700}' +
    '.guanghe-table thead tr:nth-child(2) th{height:40px;background:#eaf2ff;color:#24458f;font-weight:650}' +
    '.guanghe-table .guanghe-dimension-head,.guanghe-table .guanghe-dimension{width:148px;min-width:148px;text-align:left}' +
    '.guanghe-table .guanghe-parent td{background:#f7faff;font-weight:600}' +
    '.guanghe-table td.guanghe-best{background:#eaf8f3!important;color:#08765b;font-weight:750;box-shadow:inset 3px 0 #16a085}' +
    '.guanghe-best-tag{display:inline-block;margin-left:5px;padding:1px 5px;border-radius:8px;background:#16a085;color:#fff;font-size:9px;font-weight:750;line-height:15px;vertical-align:1px;white-space:nowrap}';

  const XHS_EXPORT_STYLES =
    '.xhs-report-panel{margin:0 18px 22px;overflow:hidden;border:1px solid #dfe4ea;border-radius:6px;background:#f7f9fc}' +
    '.xhs-panel-heading{display:flex;min-height:88px;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:14px;padding:18px 20px;border-bottom:1px solid #d6e2f3;background:#eaf2ff}' +
    '.xhs-panel-heading span{color:#0b67d1;font-size:10px;font-weight:800}.xhs-panel-heading h3{margin:4px 0;color:#182230;font-size:21px}.xhs-panel-heading p{margin:0;color:#667085;font-size:11px}.xhs-panel-heading>b{color:#34558d;font-size:10px}' +
    '.xhs-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:0 16px 16px;border:1px solid #dfe4ea;background:#dfe4ea}.xhs-metric-card{padding:12px;background:#fff}.xhs-metric-card span,.xhs-metric-card strong,.xhs-metric-card small{display:block}.xhs-metric-card span,.xhs-metric-card small{color:#667085;font-size:9px}.xhs-metric-card strong{margin-top:4px;font-size:17px}' +
    '.xhs-account-metrics{grid-template-columns:repeat(7,minmax(0,1fr))}.xhs-pgy-metrics,.xhs-star-metrics{grid-template-columns:repeat(5,minmax(0,1fr))}.xhs-star-task-metrics{grid-template-columns:repeat(6,minmax(0,1fr))}' +
    '.xhs-chart-grid{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:14px;margin:0 16px 16px}.xhs-bar-chart{margin:0;padding:14px;border:1px solid #dfe4ea;background:#fff}.xhs-bar-chart figcaption{margin-bottom:12px;font-weight:750}.xhs-bar-row{display:grid;min-height:32px;grid-template-columns:82px minmax(80px,1fr) auto;align-items:center;gap:9px}.xhs-bar-track{height:9px;overflow:hidden;border-radius:9px;background:#e9eef5}.xhs-bar-fill{display:block;width:var(--xhs-bar,0%);height:100%;background:#0b67d1}.xhs-chart-value{font-size:10px;text-align:right}.xhs-chart-value small{display:block;color:#667085;font-size:8px}' +
    '.xhs-control-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 16px 16px;padding:12px;border:1px solid #dfe4ea;background:#fff}.xhs-control-grid label>span,.xhs-control-grid legend{display:block;margin-bottom:5px;color:#667085;font-size:9px}.xhs-control-grid select{width:100%;height:32px}.xhs-control-grid fieldset{grid-column:1/-1}.xhs-check-list{display:flex;gap:8px}.xhs-check-option>span{padding:4px 7px;border:1px solid #cfd8e5;border-radius:10px}' +
    '.xhs-star-summary,.xhs-star-projects{margin:0 16px 16px;border:1px solid #dfe4ea;background:#fff}.xhs-subsection-heading{display:flex;justify-content:space-between;padding:12px 14px}.xhs-subsection-heading h4{margin:0}.xhs-project-tree{padding:0 12px 12px}.xhs-project-node{margin-top:10px;padding:12px;border:1px solid #cdd9ea;border-left:4px solid #0b67d1;background:#f8fbff}.xhs-project-node>header,.xhs-order-node>header{display:flex;justify-content:space-between}.xhs-project-node h4,.xhs-order-node h5{margin:3px 0}.xhs-unit-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}.xhs-unit-metrics div{padding:6px;border:1px solid #e3e8ef;background:#fff}.xhs-unit-metrics dt{color:#667085;font-size:8px}.xhs-unit-metrics dd{margin:2px 0 0;font-size:10px;font-weight:700}.xhs-order-list{margin:12px 0 0 12px;padding-left:12px;border-left:2px solid #cdd9ea}.xhs-order-node{margin-top:7px;padding:10px;border:1px solid #dfe4ea;background:#fff}' +
    '.xhs-unit-costs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0}.xhs-unit-costs div{padding:7px;border:1px solid #b9d5fb;background:#eef5ff}.xhs-unit-costs dt{color:#475467;font-size:8px}.xhs-unit-costs dd{margin:2px 0 0;color:#0b4fa8;font-size:10px;font-weight:750}.xhs-note-node-list{margin:12px 0 0 14px;padding-left:14px;border-left:2px solid #d8dee8}.xhs-note-node{margin-top:7px;padding:9px;border:1px dashed #cfd8e5;background:#fbfcfe}.xhs-note-node>header{display:flex;justify-content:space-between;gap:10px}.xhs-note-node h6{margin:3px 0}.xhs-order-unverified{border-color:#f4b740;background:#fffaf0}.xhs-unassigned-notes{margin-top:14px;padding:12px;border:1px solid #f4b740;background:#fffaf0}.xhs-unassigned-note-list{display:grid;gap:7px}.xhs-unassigned-note>header b{color:#b54708}' +
    '.xhs-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}' +
    '@media(max-width:900px){.xhs-account-metrics,.xhs-pgy-metrics,.xhs-star-metrics,.xhs-star-task-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.xhs-chart-grid{grid-template-columns:1fr}.xhs-control-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}';

  function normalizeWxtMarketingMarkup(markup) {
    return String(markup || '')
      .replace(/账户花费构成/g, '一级场景花费构成')
      .replace(/营销场景花费构成/g, '二级场景花费汇总');
  }

  function normalizeWxtShortVideoMarkup(markup) {
    const references = [
      ['光合曝光点击率', '3%'],
      ['光合有效查看率', '40%'],
      ['光合次均停留时长', '6秒'],
      ['光合大点击率', '5%'],
      ['光合小点击率', '1%'],
    ];
    let result = String(markup || '');
    references.forEach(([label, reference]) => {
      const marker = label + '<span class="wxt-sort-mark">';
      result = result.split(marker).join(
        label + '<small class="wxt-goal-reference">参考值 ≥ ' + reference +
        '</small><span class="wxt-sort-mark">'
      );
    });
    return result;
  }

  function renderEmbedded(mountId, sectionName, section) {
    const mount = document.getElementById(mountId);
    const root = mount.shadowRoot || mount.attachShadow({ mode: 'open' });
    if (!section || section.ok !== true || !section.markup) {
      const error = sectionError(sectionName);
      root.innerHTML = '<style>:host{display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}' +
        '.state{display:grid;min-height:520px;place-content:center;padding:32px;text-align:center}.state strong{color:#b42318;font-size:17px}' +
        '.state p{max-width:560px;margin:6px 0 0;color:#667085;font-size:13px}</style>' +
        '<div class="state"><strong>' + (error ? '本章节未生成' : '等待本章节生成') + '</strong><p>' +
        escapeHtml(error || '本章节完成后会自动显示。') + '</p></div>';
      return;
    }
    const markup = sectionName === 'wxt'
      ? normalizeWxtMarketingMarkup(section.markup)
      : sectionName === 'shortVideo'
        ? normalizeWxtShortVideoMarkup(section.markup)
        : String(section.markup);
    root.innerHTML = '<style>:host{display:block;min-width:0;background:#f4f6f9}' +
      String(wxtReport.styles || '') +
      WXT_KPI_LAYOUT_OVERRIDES +
      WXT_CHART_LAYOUT_OVERRIDES +
      WXT_TABLE_LAYOUT_OVERRIDES +
      '.wxt-report{max-width:1120px!important}' +
      '.wxt-diagnosis-report .wxt-kpi-strip{grid-template-columns:repeat(3,minmax(0,1fr))!important}' +
      '.wxt-diagnosis-report .wxt-kpi-strip strong{overflow:visible!important;font-size:20px!important;line-height:1.25!important;overflow-wrap:anywhere;text-overflow:clip!important}' +
      '@media(max-width:980px){.wxt-diagnosis-report .wxt-kpi-strip{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
      '@media(max-width:620px){.wxt-diagnosis-report .wxt-kpi-strip{grid-template-columns:1fr!important}}' +
      '</style>' + markup;
    initializeWxtTables(root);
    bindWxtInteractions(root);
  }

  function renderEmbeddedReports() {
    const valid = validWxtSnapshot();
    renderEmbedded('wxtMarketingMount', 'wxt', valid ? wxtReport.marketing : null);
    renderEmbedded('wxtShortVideoMount', 'shortVideo', valid ? wxtReport.shortVideo : null);
  }

  function showActiveSection(hasReportState) {
    document.querySelectorAll('[data-report-section]').forEach((section) => {
      section.hidden = hasReportState === false || section.getAttribute('data-report-section') !== activeSection;
    });
    renderTabs();
  }

  function render() {
    renderProgress();
    renderNotice();
    const hasReportState = Boolean(reportData || Object.keys(reportStatus || {}).length ||
      xhsAnalysis || Object.keys(xhsStatus || {}).length);
    document.getElementById('emptyReport').hidden = hasReportState;
    const generatedValue = reportData && reportData.finishedAt || xhsAnalysis && xhsAnalysis.generatedAt;
    document.getElementById('generatedAt').textContent = generatedValue
      ? '生成于 ' + (typeof generatedValue === 'number' ? formatDateTime(generatedValue) : formatXhsTime(generatedValue))
      : (reportIsRunning() ? '正在生成' : '尚未生成');
    renderFlow();
    renderGuanghe();
    renderEmbeddedReports();
    renderDmp();
    renderXhs();
    showActiveSection(hasReportState);
    updateButtons();
  }

  function exportFilenamePart(value, fallback) {
    const cleaned = String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 60);
    return cleaned || fallback;
  }

  function sanitizeExportMarkup(markup) {
    const template = document.createElement('template');
    template.innerHTML = String(markup || '');
    template.content.querySelectorAll('script,iframe,object,embed,base,meta,link').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = String(attribute.value || '').trim();
        if (name.startsWith('on') || name === 'srcdoc') {
          node.removeAttribute(attribute.name);
          return;
        }
        if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name) &&
            /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value.replace(/[\u0000-\u0020]+/g, ''))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  function sanitizeExportStyles(styles) {
    return String(styles || '').replace(/<\/style/gi, '<\\/style');
  }

  function applyExportTableLimits(markup, options) {
    const exportOptions = Object.assign({ tablePreviewLimit: 10 }, options);
    const limit = Math.max(1, Number(exportOptions.tablePreviewLimit) || 10);
    const idPrefix = String(exportOptions.tableIdPrefix || 'report')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'report';
    if (!markup || typeof markup !== 'string') return markup;
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return markup;
    const template = document.createElement('template');
    template.innerHTML = String(markup || '');
    let limitedTableIndex = 0;
    template.content.querySelectorAll('table').forEach((table) => {
      if (table.classList && table.classList.contains('guanghe-table')) return;
      const bodies = table.tBodies ? Array.from(table.tBodies) : [];
      let rows = bodies.length
        ? bodies.flatMap((body) => Array.from(body.rows || []))
        : [];
      if (!rows.length) {
        rows = Array.from(table.querySelectorAll('tr')).filter((row) => {
          const parent = row.parentElement;
          return !parent || (parent.tagName !== 'THEAD' && parent.tagName !== 'TFOOT');
        });
      }
      if (rows.length <= limit) return;
      rows.slice(limit).forEach((row) => {
        row.hidden = true;
        row.setAttribute('data-export-table-overflow', '');
      });
      const parent = table.closest('.report-table-block') || table.parentElement;
      if (!parent) return;
      limitedTableIndex += 1;
      const tableId = 'export-table-' + idPrefix + '-' + limitedTableIndex;
      table.id = tableId;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'export-table-more';
      button.setAttribute('aria-controls', tableId);
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '查看更多';
      parent.appendChild(button);
    });
    return template.innerHTML;
  }

  function stripShortVideoExportActions(root) {
    root.querySelectorAll('section.wxt-action-section').forEach((section) => {
      section.remove();
    });
    Array.from(root.querySelectorAll('section')).forEach((section) => {
      const className = String(section.className || '').toLowerCase();
      const hasRecommendationClass = /(^|\s)(action|action-section|recommend|advice|建议|recommendation)(\s|$)/.test(className);
      const hasWxtContext = /wxt/.test(className);
      const heading = section.querySelector('.wxt-section-heading h2, .wxt-section-heading h3, h2, h3');
      const headingText = heading && heading.textContent ? heading.textContent.trim() : '';
      const suggestionHeading = /(?:^|\s)(?:操作建议|优化建议|建议清单|建议动作|建议列表|建议项|建议清除|优先动作)(?:\s|$)/i.test(headingText);
      const hasPriorityList = Boolean(section.querySelector('.wxt-priority-actions'));
      const hasRecommendationSection = hasRecommendationClass || (hasWxtContext && /recommend|action/.test(className));
      const hasLegacyAction = section.querySelector('.wxt-priority-actions, .wxt-low-sample-actions');
      if (hasRecommendationSection || hasPriorityList || hasLegacyAction || suggestionHeading) {
        section.remove();
      }
    });
  }

  function buildExportReportDocument(metadata) {
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    const normalizeEmbeddedBody = (markup, options) => {
      const template = document.createElement('template');
      template.innerHTML = sanitizeExportMarkup(markup);
      const duplicateHeader = template.content.querySelector('.wxt-report-head');
      if (duplicateHeader) duplicateHeader.remove();
      if (options && options.stripShortVideoActions) {
        stripShortVideoExportActions(template.content);
      }
      return applyExportTableLimits(template.innerHTML, options);
    };
    const missingSection = (section) => {
      const platformDiagnostics = XHS_REPORT_SECTION_KEYS.includes(section) &&
        xhsPlatformSelected(section) && xhsStatusBelongsToCurrentReport()
        ? buildXhsSourceCardsMarkup(null, [section])
        : '';
      return platformDiagnostics + '<div class="export-missing"><strong>本模块未生成</strong><p>' +
        escapeHtml(sectionError(section) || '本次任务未选择该平台，或平台未返回可用数据。') + '</p></div>';
    };
    const initialGuangheView = guangheView === 'asset' ? 'asset' : 'channel';
    const guangheViews = sectionHasData('guanghe')
      ? '<div class="export-subnav" role="tablist" aria-label="光合诊断视角">' +
        '<button id="export-guanghe-tab-channel" class="' + (initialGuangheView === 'channel' ? 'active' : '') +
        '" type="button" role="tab" aria-selected="' + (initialGuangheView === 'channel' ? 'true' : 'false') +
        '" aria-controls="export-guanghe-panel-channel" tabindex="' + (initialGuangheView === 'channel' ? '0' : '-1') +
        '" data-export-guanghe-view="channel">渠道视角</button>' +
        '<button id="export-guanghe-tab-asset" class="' + (initialGuangheView === 'asset' ? 'active' : '') +
        '" type="button" role="tab" aria-selected="' + (initialGuangheView === 'asset' ? 'true' : 'false') +
        '" aria-controls="export-guanghe-panel-asset" tabindex="' + (initialGuangheView === 'asset' ? '0' : '-1') +
        '" data-export-guanghe-view="asset">资产视角</button></div>' +
        '<div id="export-guanghe-panel-channel" role="tabpanel" aria-labelledby="export-guanghe-tab-channel"' +
        ' data-export-guanghe-panel="channel"' + (initialGuangheView === 'channel' ? '' : ' hidden') + '>' +
        buildGuangheMarkup('channel', false, { exportMode: true }) + '</div>' +
        '<div id="export-guanghe-panel-asset" role="tabpanel" aria-labelledby="export-guanghe-tab-asset"' +
        ' data-export-guanghe-panel="asset"' + (initialGuangheView === 'asset' ? '' : ' hidden') + '>' +
        buildGuangheMarkup('asset', false, { exportMode: true }) + '</div>'
      : missingSection('guanghe');
    const sections = [
      {
        key: 'flow', index: 1, label: '流量诊断', title: '生意参谋流量诊断',
        subtitle: '最近30个完整自然日 · 内容指标来自光合资产总览',
        hasData: sectionHasData('flow'),
        content: sectionHasData('flow')
          ? applyExportTableLimits(buildFlowMarkup(), { tableIdPrefix: 'flow' }) : missingSection('flow'),
      },
      {
        key: 'guanghe', index: 2, label: '光合渠道诊断', title: '光合渠道诊断',
        subtitle: '渠道视角与资产视角', hasData: sectionHasData('guanghe'), content: guangheViews,
      },
      {
        key: 'wxt', index: 3, label: '万相台报告', title: '万相台营销报告',
        subtitle: '营销场景、花费结构与投放效果', hasData: sectionHasData('wxt'),
        content: sectionHasData('wxt')
          ? normalizeEmbeddedBody(normalizeWxtMarketingMarkup(wxtReport.marketing.markup), {
            tableIdPrefix: 'wxt',
          })
          : missingSection('wxt'),
      },
      {
        key: 'shortVideo', index: 4, label: '短视频诊断', title: '短视频诊断',
        subtitle: '免费内容与付费投放综合诊断', hasData: sectionHasData('shortVideo'),
        content: sectionHasData('shortVideo')
          ? normalizeEmbeddedBody(normalizeWxtShortVideoMarkup(wxtReport.shortVideo.markup), {
            stripShortVideoActions: true,
            tableIdPrefix: 'short-video',
          })
          : missingSection('shortVideo'),
      },
      {
        key: 'dmp', index: 5, label: '内容人群画像', title: '内容人群画像诊断',
        subtitle: '达摩盘 · 年龄与消费能力等级', hasData: sectionHasData('dmp'),
        content: sectionHasData('dmp')
          ? applyExportTableLimits(buildDmpMarkup(), { tableIdPrefix: 'dmp' }) : missingSection('dmp'),
      },
      {
        key: 'adstar', index: 6, label: '淘宝星河', title: '淘宝星河分析报告',
        subtitle: '店铺 → 项目 → 任务汇总 · 笔记独立筛选',
        hasData: sectionHasData('adstar'),
        content: sectionHasData('adstar')
          ? applyExportTableLimits(buildXhsMarkup({ staticExport: true, platform: 'adstar' }), {
            tableIdPrefix: 'adstar',
          }) : missingSection('adstar'),
      },
      {
        key: 'pgy', index: 7, label: '蒲公英', title: '蒲公英分析报告',
        subtitle: '报备笔记、合作金额、平台服务费与内容表现',
        hasData: sectionHasData('pgy'),
        content: sectionHasData('pgy')
          ? applyExportTableLimits(buildXhsMarkup({ staticExport: true, platform: 'pgy' }), {
            tableIdPrefix: 'pgy',
          }) : missingSection('pgy'),
      },
      {
        key: 'juguang', index: 8, label: '聚光', title: '聚光分析报告',
        subtitle: '账户 → 营销诉求 → 投放位置 · 星河任务期对齐',
        hasData: sectionHasData('juguang'),
        content: sectionHasData('juguang')
          ? applyExportTableLimits(buildXhsMarkup({ staticExport: true, platform: 'juguang' }), {
            tableIdPrefix: 'juguang',
          }) : missingSection('juguang'),
      },
    ];
    const firstAvailable = sections.find((section) => section.hasData);
    const requestedSection = activeSection === 'xiaohongshu'
      ? (XHS_REPORT_SECTION_KEYS.find((section) => sectionHasData(section)) || 'adstar')
      : activeSection;
    const initialSection = sectionHasData(requestedSection)
      ? requestedSection
      : (firstAvailable ? firstAvailable.key : sections[0].key);
    const tabs = sections.map((section) => '<button class="export-tab' +
      (section.key === initialSection ? ' active' : '') + (section.hasData ? ' has-data' : ' is-missing') +
      '" id="export-tab-' + section.key + '" type="button" role="tab" aria-selected="' +
      (section.key === initialSection ? 'true' : 'false') + '" aria-controls="export-panel-' + section.key +
      '" tabindex="' + (section.key === initialSection ? '0' : '-1') + '" data-export-section="' + section.key + '">' +
      '<span>' + String(section.index).padStart(2, '0') + '</span><strong>' + section.label + '</strong><small>' +
      (section.hasData ? '已生成' : '未生成') + '</small></button>').join('');
    const panels = sections.map((section) => '<section id="export-panel-' + section.key +
      '" class="export-section" role="tabpanel" aria-labelledby="export-tab-' + section.key +
      '" tabindex="0" data-export-panel="' + section.key + '"' +
      (section.key === initialSection ? '' : ' hidden') + '><header class="export-section-head"><div><span>' +
      String(section.index).padStart(2, '0') + ' / ' + String(sections.length).padStart(2, '0') +
      '</span><h1>' + section.title + '</h1><p>' + section.subtitle +
      '</p></div></header><div class="export-section-body">' + section.content + '</div></section>').join('');
    const css = '*{box-sizing:border-box}html{min-width:320px}body{margin:0;background:#eef1f5;color:#182230;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;letter-spacing:0}' +
      'button,select{font:inherit}button:focus-visible,select:focus-visible{outline:3px solid rgba(11,103,209,.28);outline-offset:2px}' +
      '[hidden]{display:none!important}.export-cover{display:flex;max-width:1340px;align-items:flex-end;justify-content:space-between;gap:24px;margin:24px auto 0;padding:24px 28px;background:#fff;border-top:4px solid #0b67d1}.export-cover span{color:#0b67d1;font-size:11px;font-weight:750;letter-spacing:.08em}.export-cover h1{margin:7px 0 5px;font-size:28px}.export-cover p{margin:0;color:#667085;font-size:13px}.export-cover time{color:#667085;font-size:12px;white-space:nowrap}' +
      '.export-shell{display:grid;max-width:1340px;min-height:680px;grid-template-columns:190px minmax(0,1fr);margin:18px auto 28px;overflow:hidden;border:1px solid #dfe4ea;background:#fff}' +
      '.export-index{padding:10px;border-right:1px solid #dfe4ea;background:#f8fafc}.export-tab{display:grid;width:100%;min-height:54px;grid-template-columns:26px minmax(0,1fr);grid-template-rows:auto auto;align-items:center;gap:1px 8px;margin:0 0 4px;padding:7px 10px;border:0;border-left:3px solid transparent;border-radius:3px;background:transparent;color:#475467;text-align:left;cursor:pointer}.export-tab:hover{background:#eef2f6}.export-tab.active{border-left-color:#0b67d1;background:#eaf2ff;color:#0b67d1}.export-tab>span{grid-row:1/3;color:#98a2b3;font-size:11px;font-weight:750}.export-tab>strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.export-tab>small{color:#667085;font-size:10px}.export-tab.has-data>small{color:#067647}.export-tab.is-missing{opacity:.72}' +
      '.export-stage{min-width:0;background:#f4f6f8}.export-section{min-width:0}.export-section-head{display:flex;min-height:118px;align-items:flex-end;justify-content:space-between;gap:24px;padding:24px 28px;background:#243b72;color:#fff}.export-section-head span{color:#9ec5ff;font-size:11px;font-weight:750}.export-section-head h1{margin:5px 0 6px;font-size:25px}.export-section-head p{margin:0;color:#dbe7ff;font-size:12px}.export-section-body{padding:18px 0}.export-missing{display:grid;min-height:420px;place-content:center;padding:24px;text-align:center}.export-missing strong{font-size:18px}.export-missing p{max-width:580px;margin:6px 0 0;color:#667085}' +
      '.export-subnav{display:inline-flex;margin:0 18px 18px;overflow:hidden;border:1px solid #b7c7df;border-radius:5px;background:#fff}.export-subnav button{height:34px;padding:0 14px;border:0;border-right:1px solid #b7c7df;background:#fff;color:#475467;cursor:pointer}.export-subnav button:last-child{border-right:0}.export-subnav button.active{background:#0b67d1;color:#fff;font-weight:700}' +
      '.diagnosis-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0 18px;border:1px solid #dfe4ea;background:#fff}' +
      '.diagnosis-kpis>div{padding:14px;border-right:1px solid #dfe4ea}.diagnosis-kpis span{display:block;color:#667085;font-size:11px}.diagnosis-kpis strong{display:block;margin-top:5px;font-size:20px}' +
      '.report-table-block{margin:18px;overflow:auto;border:1px solid #dfe4ea;background:#fff}.report-table-block table{width:100%;min-width:820px;border-collapse:collapse}' +
      '.report-table-block th,.report-table-block td{padding:9px 10px;border-bottom:1px solid #edf0f3;text-align:left;white-space:nowrap}.report-table-block th{background:#eef2f6}' +
      '.dimension-button{display:block;margin-right:2px;padding:0 8px;border-radius:4px;background:#0b67d1;color:#fff;border:0;cursor:pointer;line-height:20px}.dimension-child td:first-child{padding-left:30px}.metric-result.good{color:#067647}.metric-result.watch{color:#a34b00}' +
      '.dimension-child.export-collapsed-child td:first-child{padding-left:30px}.export-table-more{margin:0 18px 18px;display:inline-flex;height:34px;padding:0 16px;border:1px solid #b7c7df;border-radius:4px;background:#fff;color:#475467;cursor:pointer}.export-table-more:hover{background:#f4f8ff}' +
      '.xhs-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 18px 18px}.xhs-source-card,.xhs-quality-panel{padding:16px;border:1px solid #dfe4ea;background:#fff}.xhs-source-card h3{margin:4px 0 10px}.xhs-source-card p,.xhs-source-card small{display:block;margin:5px 0;color:#667085;font-size:11px}.xhs-quality-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;margin:0 18px 18px}.xhs-quality-panel h3{margin:4px 0}.xhs-quality-list{grid-column:1/-1;padding:0;list-style:none}.xhs-quality-list li{display:flex;gap:10px;padding:6px 0;border-top:1px solid #edf0f3}.xhs-quality-empty,.xhs-quality-list span{color:#667085;font-size:11px}.xhs-table-heading{display:flex;justify-content:space-between;padding:13px 15px}.xhs-table-heading h3{margin:0}' +
      XHS_EXPORT_STYLES +
      GUANGHE_EXPORT_STYLES +
      dmpExportStyles() +
      sanitizeExportStyles(wxtReport && wxtReport.styles || '') +
      WXT_KPI_LAYOUT_OVERRIDES +
      WXT_CHART_LAYOUT_OVERRIDES +
      WXT_TABLE_LAYOUT_OVERRIDES +
      '.wxt-report{max-width:1084px!important;margin:0 auto!important}.wxt-report-head{display:none!important}' +
      '@media print{body{background:#fff}.export-cover{margin:0}.export-index{display:none}.export-shell{display:block;margin:0;border:0}.export-section-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '@media(max-width:900px){.export-cover,.export-shell{margin-left:12px;margin-right:12px}.export-shell{grid-template-columns:1fr}.export-index{display:flex;overflow-x:auto;border-right:0;border-bottom:1px solid #dfe4ea}.export-tab{min-width:160px;margin:0 4px 0 0}}' +
      '@media(max-width:620px){.export-cover{align-items:flex-start;flex-direction:column;margin:0;padding:20px 16px}.export-cover h1{font-size:24px}.export-shell{min-height:560px;margin:0;border-right:0;border-left:0}.export-section-head{min-height:0;padding:20px 16px}.export-section-head h1{font-size:21px}.diagnosis-kpis{grid-template-columns:1fr;margin:12px}.report-table-block{margin:12px}.export-subnav{display:flex;margin:0 12px 12px}.export-subnav button{flex:1}}';
    const exportScriptNonce = 'taobao-report-export-v1';
    const exportScriptBody = [
      '(function(){var tabs=Array.from(document.querySelectorAll("[data-export-section]"));',
      'var panels=Array.from(document.querySelectorAll("[data-export-panel]"));',
      'function activate(key,focus){',
      'tabs.forEach(function(tab){var active=tab.dataset.exportSection===key;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1;if(active&&focus){tab.focus();tab.scrollIntoView({block:"nearest",inline:"nearest"});}});',
      'panels.forEach(function(panel){panel.hidden=panel.dataset.exportPanel!==key;});',
      '}',
      'function moveTab(event,index,items,activateItem){',
      'var next=index;',
      'if(event.key==="ArrowDown"||event.key==="ArrowRight")next=(index+1)%items.length;',
      'else if(event.key==="ArrowUp"||event.key==="ArrowLeft")next=(index+items.length-1)%items.length;',
      'else if(event.key==="Home")next=0;',
      'else if(event.key==="End")next=items.length-1;',
      'else return;event.preventDefault();activateItem(items[next],true);}',
      'tabs.forEach(function(tab,index){tab.addEventListener("click",function(){activate(tab.dataset.exportSection,false);});',
      'tab.addEventListener("keydown",function(event){moveTab(event,index,tabs,function(next,focus){activate(next.dataset.exportSection,focus);});});});',
      'var views=Array.from(document.querySelectorAll("[data-export-guanghe-view]"));',
      'var viewPanels=Array.from(document.querySelectorAll("[data-export-guanghe-panel]"));',
      'function activateView(view,focus){',
      'views.forEach(function(button){var active=button===view;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();});',
      'viewPanels.forEach(function(panel){panel.hidden=panel.dataset.exportGuanghePanel!==view.dataset.exportGuangheView;});',
      '}',
      'views.forEach(function(view,index){view.addEventListener("click",function(){activateView(view,false);});',
      'view.addEventListener("keydown",function(event){moveTab(event,index,views,activateView);});});',
      'document.addEventListener("change",function(event){var select=event.target.closest&&event.target.closest("[data-attribution-select]");if(!select)return;',
      'var root=select.closest("[data-export-panel]")||document;root.querySelectorAll("[data-attribution-report]").forEach(function(node){node.hidden=node.getAttribute("data-attribution-report")!==select.value;});});',
      'var dimensionButtons=Array.from(document.querySelectorAll("[data-expand-view][data-expand-key]"));',
      'function setDimensionState(button){',
      'var rows=Array.prototype.filter.call(document.querySelectorAll("[data-export-parent-view][data-export-parent-key]"),function(row){return row.dataset.exportParentView===button.dataset.expandView&&row.dataset.exportParentKey===button.dataset.expandKey;});',
      'var collapsed=rows.length?rows[0].hidden:true;',
      'button.textContent=collapsed?"+":"−";',
      'button.setAttribute("aria-expanded",String(!collapsed));',
      'var label=button.getAttribute("data-expand-label")||"";',
      'button.setAttribute("aria-label",(collapsed?"展开":"收起")+label+"明细");',
      '}',
      'dimensionButtons.forEach(function(button){',
      'setDimensionState(button);',
      'button.addEventListener("click",function(){',
      'var rows=Array.prototype.filter.call(document.querySelectorAll("[data-export-parent-view][data-export-parent-key]"),function(row){return row.dataset.exportParentView===button.dataset.expandView&&row.dataset.exportParentKey===button.dataset.expandKey;});',
      'if(!rows.length)return;',
      'var collapsed=rows[0].hidden;',
      'rows.forEach(function(row){row.hidden=!collapsed;});',
      'setDimensionState(button);',
      '});',
      '});',
      'Array.from(document.querySelectorAll(".export-table-more")).forEach(function(button){',
      'var table=document.getElementById(button.getAttribute("aria-controls")||"");',
      'if(!table)return;',
      'var rows=Array.prototype.slice.call(table.querySelectorAll("[data-export-table-overflow]"));',
      'if(!rows.length)return;',
      'function setTableExpanded(expanded){',
      'rows.forEach(function(row){row.hidden=!expanded;});',
      'button.textContent=expanded?"收起":"查看更多";',
      'button.setAttribute("aria-expanded",String(expanded));',
      '}',
      'button.addEventListener("click",function(){',
      'setTableExpanded(button.getAttribute("aria-expanded")!=="true");',
      '});',
      '});',
      '})();'
    ].join('');
    const script = '<script nonce="' + exportScriptNonce + '">' + exportScriptBody + '<\/script>';
    const storeName = String(meta.storeName || archiveRun && archiveRun.account && archiveRun.account.storeName || '');
    const accountName = String(meta.accountName || archiveRun && archiveRun.account && (
      archiveRun.account.name || archiveRun.account.usernameMasked
    ) || '');
    const finishedAt = Number(meta.finishedAt || archiveRun && archiveRun.finishedAt || reportData && reportData.finishedAt) || Date.now();
    const generatedAt = formatDateTime(finishedAt);
    const documentTitle = storeName ? storeName + ' - 淘宝内容诊断报告' : '淘宝内容诊断报告';
    const contextCopy = [accountName, generatedAt].filter(Boolean).join(' · ');
    const contentSecurityPolicy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" +
      exportScriptNonce + "'; base-uri 'none'; form-action 'none'";
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="' + contentSecurityPolicy + '">' +
      '<title>' + escapeHtml(documentTitle) + '</title><style>' + css + '</style></head><body><header class="export-cover"><div><span>TAOBAO CONTENT DIAGNOSIS</span><h1>' +
      escapeHtml(storeName ? storeName + ' · 内容诊断报告' : '淘宝内容诊断报告') +
      '</h1><p>交互式单页报告 · 点击模块查看对应内容</p></div><time>' +
      escapeHtml(contextCopy || '生成于 ' + generatedAt) + '</time></header>' +
      '<main class="export-shell"><nav class="export-index" role="tablist" aria-label="报告模块">' + tabs +
      '</nav><div class="export-stage">' + panels + '</div></main>' + script + '</body></html>';
    const datePart = new Date(finishedAt).toISOString().slice(0, 10);
    return {
      html,
      filename: exportFilenamePart(storeName, '淘宝内容诊断报告') + '_' + datePart + '.html',
      hasData: sections.filter((section) => section.hasData).map((section) => section.key),
      runId: String(meta.runId || archiveRun && archiveRun.runId || ''),
    };
  }

  function buildExportFromArchive(run, metadata) {
    const previous = {
      reportStatus, reportData, wxtReport, xhsStatus, xhsAnalysis, archiveRun, activeSection, guangheView,
      xhsNoteFilters: { ...xhsNoteFilters },
      xhsNoteExpanded,
      xhsNoteSnapshotKey,
      xhsStarFilters: { ...xhsStarFilters },
      xhsStarExpanded: { ...xhsStarExpanded },
      xhsStarSnapshotKey,
      xhsPgyDateRange: { ...xhsPgyDateRange },
      xhsPgySpuName,
      xhsPgyProjectName,
      xhsPgyNoteExpanded,
      xhsPgySnapshotKey,
    };
    try {
      applyArchiveRun(run);
      activeSection = String(metadata && metadata.activeSection || 'flow');
      guangheView = metadata && metadata.guangheView === 'asset' ? 'asset' : 'channel';
      return buildExportReportDocument(Object.assign({}, metadata, {
        runId: run.runId,
        storeName: metadata && metadata.storeName || run.account && run.account.storeName || '',
        accountName: metadata && metadata.accountName || run.account && (
          run.account.name || run.account.usernameMasked
        ) || '',
        finishedAt: metadata && metadata.finishedAt || run.finishedAt,
      }));
    } finally {
      reportStatus = previous.reportStatus;
      reportData = previous.reportData;
      wxtReport = previous.wxtReport;
      xhsStatus = previous.xhsStatus;
      xhsAnalysis = previous.xhsAnalysis;
      archiveRun = previous.archiveRun;
      activeSection = previous.activeSection;
      guangheView = previous.guangheView;
      xhsNoteFilters = previous.xhsNoteFilters;
      xhsNoteExpanded = previous.xhsNoteExpanded;
      xhsNoteSnapshotKey = previous.xhsNoteSnapshotKey;
      xhsStarFilters = previous.xhsStarFilters;
      xhsStarExpanded = previous.xhsStarExpanded;
      xhsStarSnapshotKey = previous.xhsStarSnapshotKey;
      xhsPgyDateRange = previous.xhsPgyDateRange;
      xhsPgySpuName = previous.xhsPgySpuName;
      xhsPgyProjectName = previous.xhsPgyProjectName;
      xhsPgyNoteExpanded = previous.xhsPgyNoteExpanded;
      xhsPgySnapshotKey = previous.xhsPgySnapshotKey;
    }
  }

  function downloadExportDocument(result) {
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportReport() {
    downloadExportDocument(buildExportReportDocument({
      activeSection,
      guangheView,
    }));
  }

  window.TaobaoReportExport = Object.freeze({
    version: 1,
    buildFromArchive: buildExportFromArchive,
  });

  document.getElementById('refreshReportBtn').addEventListener('click', loadReport);
  document.getElementById('exportReportBtn').addEventListener('click', exportReport);
  document.getElementById('clearReportBtn').addEventListener('click', async () => {
    if (!window.confirm('确定清空当前内容诊断报告和生成进度吗？')) return;
    try {
      await requestBridge('clearStorage', { keys: STORAGE_KEYS });
      reportStatus = {};
      reportData = null;
      wxtReport = null;
      xhsStatus = {};
      xhsAnalysis = null;
      xhsNoteFilters = { projectId: '', taskId: '', spuName: '', from: '', to: '' };
      xhsNoteExpanded = false;
      xhsNoteSnapshotKey = '';
      xhsStarFilters = { projectId: '', taskId: '' };
      xhsStarExpanded = { project: false, task: false };
      xhsStarSnapshotKey = '';
      xhsPgyDateRange = { from: '', to: '' };
      xhsPgySpuName = '';
      xhsPgyProjectName = '';
      xhsPgyNoteExpanded = false;
      xhsPgySnapshotKey = '';
      activeSection = 'flow';
      transientNotice = '当前内容诊断报告已清空。';
      render();
    } catch (error) {
      transientNotice = '清空失败：' + error.message;
      renderNotice();
    }
  });

  document.getElementById('reportIndex').addEventListener('click', (event) => {
    const button = event.target.closest('[data-section]');
    if (!button) return;
    activeSection = button.getAttribute('data-section') || 'flow';
    showActiveSection(true);
  });

  document.querySelectorAll('[data-guanghe-view]').forEach((button) => {
    button.addEventListener('click', () => {
      guangheView = button.getAttribute('data-guanghe-view') || 'channel';
      renderGuanghe();
    });
  });

  document.getElementById('guangheReport').addEventListener('click', (event) => {
    const button = event.target.closest('[data-expand-view]');
    if (!button) return;
    const view = button.getAttribute('data-expand-view');
    const key = button.getAttribute('data-expand-key');
    if (!expanded[view] || !key) return;
    if (expanded[view].has(key)) expanded[view].delete(key);
    else expanded[view].add(key);
    renderGuanghe();
  });

  const xhsPgyReport = document.getElementById('pgyReport') || document.getElementById('xhsReport');
  if (xhsPgyReport) xhsPgyReport.addEventListener("change", (event) => {
    const spu = event.target && event.target.closest && event.target.closest('[data-xhs-pgy-spu]');
    const project = event.target && event.target.closest && event.target.closest('[data-xhs-pgy-project]');
    const date = event.target && event.target.closest && event.target.closest('[data-xhs-pgy-date]');
    if (!spu && !project && !date) return;
    if ((spu || project || date).disabled) return;
    const analysis = xhsObject(xhsAnalysis);
    currentXhsPgyDateRange(analysis, xhsObject(analysis.pgy));
    if (spu) {
      xhsPgySpuName = String(spu.value || '');
      xhsPgyProjectName = '';
      renderXhs();
      return;
    }
    if (project) {
      xhsPgyProjectName = String(project.value || '');
      renderXhs();
      return;
    }
    const boundary = date.getAttribute('data-xhs-pgy-date');
    if (!['from', 'to'].includes(boundary)) return;
    xhsPgyDateRange = {
      ...xhsPgyDateRange,
      [boundary]: String(date.value || ''),
    };
    renderXhs();
  });

  if (xhsPgyReport) xhsPgyReport.addEventListener("click", (event) => {
    const toggle = event.target && event.target.closest && event.target.closest('[data-xhs-pgy-note-toggle]');
    if (!toggle || toggle.disabled) return;
    xhsPgyNoteExpanded = !xhsPgyNoteExpanded;
    renderXhs();
  });

  const xhsNoteReport = document.getElementById('adstarReport') || document.getElementById('xhsReport');
  if (xhsNoteReport) xhsNoteReport.addEventListener("change", (event) => {
    const filter = event.target && event.target.closest && event.target.closest('[data-xhs-note-filter]');
    const date = event.target && event.target.closest && event.target.closest('[data-xhs-note-date]');
    if (!filter && !date) return;
    if (filter) {
      const kind = filter.getAttribute('data-xhs-note-filter');
      if (kind === 'project') {
        xhsNoteFilters.projectId = String(filter.value || '');
        xhsNoteFilters.taskId = '';
      } else if (kind === 'task') {
        xhsNoteFilters.taskId = String(filter.value || '');
      } else if (kind === 'spu') {
        xhsNoteFilters.spuName = String(filter.value || '');
      } else {
        return;
      }
    } else {
      const boundary = date.getAttribute('data-xhs-note-date');
      if (!['from', 'to'].includes(boundary)) return;
      xhsNoteFilters[boundary] = String(date.value || '');
    }
    xhsNoteExpanded = false;
    renderXhs();
  });

  if (xhsNoteReport) xhsNoteReport.addEventListener("click", (event) => {
    const toggle = event.target && event.target.closest && event.target.closest('[data-xhs-note-toggle]');
    if (!toggle) return;
    xhsNoteExpanded = !xhsNoteExpanded;
    renderXhs();
  });

  const xhsStarReport = document.getElementById('adstarReport') || document.getElementById('xhsReport');
  if (xhsStarReport) xhsStarReport.addEventListener("change", (event) => {
    const filter = event.target && event.target.closest && event.target.closest('[data-xhs-star-filter]');
    if (!filter || filter.disabled) return;
    const kind = filter.getAttribute('data-xhs-star-filter');
    if (kind === 'project') {
      xhsStarFilters.projectId = String(filter.value || '');
      xhsStarFilters.taskId = '';
    } else if (kind === 'task') {
      xhsStarFilters.taskId = String(filter.value || '');
    } else {
      return;
    }
    renderXhs();
  });

  if (xhsStarReport) xhsStarReport.addEventListener("click", (event) => {
    const toggle = event.target && event.target.closest && event.target.closest('[data-xhs-star-toggle]');
    if (!toggle || toggle.disabled) return;
    const kind = toggle.getAttribute('data-xhs-star-toggle');
    if (!['project', 'task'].includes(kind)) return;
    xhsStarExpanded[kind] = !xhsStarExpanded[kind];
    renderXhs();
  });

  const xhsJuguangReport = document.getElementById('juguangReport') || document.getElementById('xhsReport');
  if (xhsJuguangReport) xhsJuguangReport.addEventListener("change", (event) => {
    const control = event.target && event.target.closest && event.target.closest(
      '[data-xhs-juguang-mode],[data-xhs-juguang-filter],[data-xhs-juguang-group-by]'
    );
    if (!control) return;
    if (control.hasAttribute('data-xhs-juguang-mode')) {
      if (control.value === 'single') {
        if (xhsJuguangGroupBy.length > 1) xhsJuguangMultiGroupBy = xhsJuguangGroupBy.slice();
        xhsJuguangMode = 'single';
        xhsJuguangGroupBy = [xhsJuguangGroupBy[0] || 'account'];
      } else {
        xhsJuguangMode = 'multi';
        xhsJuguangGroupBy = xhsJuguangMultiGroupBy.slice();
      }
      renderXhs();
      return;
    }
    if (control.hasAttribute('data-xhs-juguang-filter')) {
      const dimension = control.getAttribute('data-xhs-juguang-filter');
      const filterKey = {
        account: 'accountIds',
        marketingObjective: 'marketingObjectives',
        placementType: 'placementTypes',
      }[dimension];
      if (!filterKey) return;
      xhsJuguangFilters[filterKey] = control.value === '' ? [] : [control.value];
      renderXhs();
      return;
    }
    const dimension = control.getAttribute('data-xhs-juguang-group-by');
    if (!['account', 'marketingObjective', 'placementType'].includes(dimension)) return;
    if (xhsJuguangMode === 'single') {
      xhsJuguangGroupBy = [dimension];
    } else if (control.checked) {
      xhsJuguangGroupBy = xhsJuguangGroupBy.concat(dimension)
        .filter((value, index, values) => values.indexOf(value) === index).slice(0, 3);
      xhsJuguangMultiGroupBy = xhsJuguangGroupBy.slice();
    } else {
      xhsJuguangGroupBy = xhsJuguangGroupBy.filter((value) => value !== dimension);
      if (!xhsJuguangGroupBy.length) xhsJuguangGroupBy = ['account'];
      xhsJuguangMultiGroupBy = xhsJuguangGroupBy.slice();
    }
    renderXhs();
  });

  render();
  if (!BUILDER_MODE) {
    Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
      .catch(() => null)
      .then(() => requestBridge('ping', {}, 2500))
      .then((response) => {
        updateConnection(
          Boolean(response && response.connected),
          response && response.version || '',
          '',
          response && response.capabilities
        );
        return loadReport();
      }).catch((error) => {
        updateConnection(false, '', error.message);
        document.getElementById('reportNotice').textContent = '请在 Chrome 扩展管理页重载“淘宝内容诊断插件”，再刷新本页。';
      });
  }
})();
