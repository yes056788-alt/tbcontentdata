// 经营数据表格：只读汇总一键取数归档，并支持手填、复制与导出。
(function () {
  'use strict';

  if (window.self !== window.top && new URLSearchParams(location.search).get('embed') === '1') {
    document.documentElement.classList.add('embedded-view');
  }

  const STORAGE_KEYS = [
    'businessDefenseSycmTrafficSnapshotV1',
    'gh_channel_snapshot',
    'wxtBusinessDefenseReportV1',
    'dmpPortraitSnapshotV1',
    'businessDefenseManualInputsV1',
    'businessDefenseAutoCollectStatusV1',
    'taobaoContentDiagnosisReportStatusV1',
    'xhsAnalysisSnapshotV1',
    'xhsCollectionStatusV1',
  ];
  const CLEARABLE_STORAGE_KEYS = [
    ...STORAGE_KEYS,
    'businessDefenseLastAutoCollectAt',
    'sycmContentDiagnosisSnapshotV1',
    'wxtReportApiTraceV1',
  ];
  const WEB_TOOL_CHANNEL = 'taobao-full-chain-tool-v1';
  const IS_EXTENSION_PAGE = location.protocol === 'chrome-extension:' &&
    typeof globalThis.chrome !== 'undefined' && chrome.storage && chrome.runtime;
  const ARCHIVE_RUN_ID = IS_EXTENSION_PAGE
    ? ''
    : String(new URLSearchParams(location.search).get('archive') || '');

  const MANUAL_KEYS = new Set([
    'xhs_kolSpend',
    'xhs_juguangSpend',
    'xhs_reportedNoteShare',
    'xhs_unreportedNoteShare',
    'xhs_productSeedingSpend',
    'xhs_seedingDirectSpend',
    'xhs_xingheVisitors',
    'xhs_dmpVisitors',
    'xhs_noteCount',
    'xhs_unreportedNoteCount',
    'xhs_storeGmv',
    'xhs_taskGmv',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const PERCENT_MANUAL_KEYS = new Set([
    'xhs_reportedNoteShare',
    'xhs_unreportedNoteShare',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const INTEGER_MANUAL_KEYS = new Set([
    'xhs_xingheVisitors',
    'xhs_dmpVisitors',
    'xhs_noteCount',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_unreportedNoteCount',
  ]);
  const XHS_DMP_KEYS = new Set([
    'xhs_dmpVisitors',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const XHS_MODE_LABELS = Object.freeze({
    automatic: '自动取数',
    formula: '公式计算',
    manual_fallback: '手填兜底',
    manual_override: '手填覆盖',
    preserved: '现有值保留',
  });

  let currentRows = [];
  let currentXhsAnalysis = null;
  let manualInputs = {};
  let autoCollectStatus = {};
  let transientNotice = '';
  let webBridgeConnected = IS_EXTENSION_PAGE;
  let webBridgeVersion = '';
  let webBridgeCapabilities = new Set();
  let webRequestSequence = 0;
  let scheduledReload = null;
  let activeFilter = 'all';
  let activePlatformTable = 'taobao';
  let manualSaveQueue = Promise.resolve();
  const pendingWebRequests = new Map();

  function archiveManualInputsSupported() {
    return IS_EXTENSION_PAGE || !ARCHIVE_RUN_ID || webBridgeCapabilities.has('storeRunManualInputs');
  }

  function parallelWebToolSupported() {
    const parallelSupported = IS_EXTENSION_PAGE || webBridgeCapabilities.has('parallelPlatformRuns');
    return parallelSupported && archiveManualInputsSupported();
  }

  function updateConnectionState(connected, version, message, capabilities) {
    webBridgeConnected = IS_EXTENSION_PAGE || Boolean(connected);
    if (version) webBridgeVersion = String(version);
    if (Array.isArray(capabilities)) webBridgeCapabilities = new Set(capabilities.map(String));
    const outdated = webBridgeConnected && !parallelWebToolSupported();
    const state = document.getElementById('connectionState');
    if (state) {
      state.className = 'connection-state ' + (webBridgeConnected && !outdated ? 'connected' : 'disconnected');
      state.textContent = outdated
        ? '数据助手需重载'
        : (webBridgeConnected ? '数据助手已连接' : (message || '数据助手未连接'));
    }
    const versionNode = document.getElementById('extensionVersion');
    if (versionNode) versionNode.textContent = webBridgeVersion ? 'v' + webBridgeVersion : '';
  }

  function requestWebBridge(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'tb-tool-' + Date.now().toString(36) + '-' + (++webRequestSequence).toString(36);
      const timeout = window.setTimeout(() => {
        pendingWebRequests.delete(requestId);
        reject(new Error('未连接淘宝数据助手，请重载扩展后刷新本页。'));
      }, Number(timeoutMs) || 10000);
      pendingWebRequests.set(requestId, { resolve, reject, timeout });
      window.postMessage({
        channel: WEB_TOOL_CHANNEL,
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      }, location.origin);
    });
  }

  function scheduleLoadRows() {
    if (scheduledReload) window.clearTimeout(scheduledReload);
    scheduledReload = window.setTimeout(() => {
      scheduledReload = null;
      loadRows();
    }, 120);
  }

  if (!IS_EXTENSION_PAGE) {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data;
      if (!message || message.channel !== WEB_TOOL_CHANNEL) return;
      if (message.type === 'ready') {
        updateConnectionState(true, message.version || '', '', message.capabilities);
        return;
      }
      if (message.type === 'storageChanged') {
        updateConnectionState(true, message.version || '', '', message.capabilities);
        if ((message.keys || []).some((key) => STORAGE_KEYS.includes(key))) scheduleLoadRows();
        return;
      }
      if (message.type !== 'response' || !message.requestId) return;
      const pending = pendingWebRequests.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      pendingWebRequests.delete(message.requestId);
      if (message.ok) {
        updateConnectionState(true, message.version || '', '', message.capabilities);
        pending.resolve(message.data);
      } else {
        updateConnectionState(false, '', message.message || '数据助手请求失败');
        pending.reject(new Error(message.message || '数据助手请求失败。'));
      }
    });
  }

  function getStorage(keys) {
    if (!IS_EXTENSION_PAGE) {
      if (ARCHIVE_RUN_ID) {
        return requestWebBridge('getStoreRun', { runId: ARCHIVE_RUN_ID }).then((result) => {
          const run = result && result.run;
          if (!run || typeof run !== 'object') throw new Error('未找到这条店铺历史归档。');
          const snapshots = run.snapshots && typeof run.snapshots === 'object' ? run.snapshots : {};
          return (Array.isArray(keys) ? keys : []).reduce((output, key) => {
            if (Object.prototype.hasOwnProperty.call(snapshots, key)) output[key] = snapshots[key];
            return output;
          }, {});
        });
      }
      return requestWebBridge('getStorage', { keys });
    }
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function setStorage(value, patch) {
    if (!IS_EXTENSION_PAGE) {
      const manualInputs = value && value.businessDefenseManualInputsV1 || {};
      if (ARCHIVE_RUN_ID) {
        if (!webBridgeCapabilities.has('storeRunManualInputs')) {
          throw new Error('数据助手版本过旧，请在扩展管理页重载后再填写。');
        }
        const savePatch = () => requestWebBridge('patchStoreRunManualInput', {
          runId: ARCHIVE_RUN_ID,
          key: patch && patch.key,
          value: patch && patch.value,
        });
        if (navigator.locks && typeof navigator.locks.request === 'function') {
          return navigator.locks.request(
            'taobao-store-run-manual-input:' + ARCHIVE_RUN_ID,
            { mode: 'exclusive' },
            savePatch
          );
        }
        return savePatch();
      }
      return requestWebBridge('setManualInputs', { manualInputs });
    }
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function removeStorage(keys) {
    if (!IS_EXTENSION_PAGE) return requestWebBridge('clearStorage', { keys });
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || '本地数据删除失败。'));
          return;
        }
        resolve();
      });
    });
  }

  function asNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const source = String(value).trim();
    const isPercent = /[%％]$/.test(source);
    let text = source.replace(/[,，¥￥\s]/g, '').replace(/[%％]$/, '').replace(/[人个]$/, '');
    let multiplier = 1;
    if (/万$/.test(text)) {
      multiplier = 10000;
      text = text.slice(0, -1);
    } else if (/亿$/.test(text)) {
      multiplier = 100000000;
      text = text.slice(0, -1);
    }
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    const scaled = number * multiplier;
    return isPercent ? scaled / 100 : scaled;
  }

  function divide(a, b) {
    const top = asNumber(a);
    const bottom = asNumber(b);
    if (top === null || bottom === null || bottom === 0) return null;
    return top / bottom;
  }

  function add(a, b) {
    const left = asNumber(a);
    const right = asNumber(b);
    if (left === null || right === null) return null;
    return left + right;
  }

  function latestTime() {
    return new Date().toLocaleString('zh-CN');
  }

  function dateTime(value) {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    return new Date(ts).toLocaleString('zh-CN');
  }

  function autoCollectIsActive(status) {
    if (!status || status.running !== true) return false;
    const updatedAt = Number(status.updatedAt || status.startedAt);
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 15 * 60 * 1000;
  }

  function put(values, key, value, source, updatedAt, raw) {
    const number = asNumber(value);
    if (number === null) return;
    values[key] = {
      value: number,
      source: source || '',
      updatedAt: updatedAt || '',
      raw: raw == null ? value : raw,
    };
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function crowdName(crowd) {
    return String(crowd && (crowd.crowdName || crowd.name || crowd.title) || '');
  }

  function crowdSize(crowd) {
    const keys = [
      'crowdNum', 'coverNum', 'coverage', 'crowdSize', 'size',
      'num', 'uv', 'count', 'population', 'optionNum',
    ];
    for (const key of keys) {
      const value = asNumber(crowd && crowd[key]);
      if (value !== null) return value;
    }
    return null;
  }

  function chartLooksLikePower(chart) {
    const name = normalizeText(chart && (chart.tagName || chart.name || chart.title || chart.tagId));
    if (name.includes('消费能力') || name.includes('购买力')) return true;
    const rows = Array.isArray(chart && chart.rows) ? chart.rows : [];
    return rows.some(row => /l[1-5]/i.test(String(row && (row.optionName || row.name || row.label) || '')));
  }

  function rateFromRow(row) {
    const normalizedRate = asNumber(row && row.rate);
    if (normalizedRate !== null) return normalizedRate / 100;
    const candidates = [row && row.percent, row && row.ratio, row && row.value];
    for (const candidate of candidates) {
      const value = asNumber(candidate);
      if (value === null) continue;
      return value > 1 ? value / 100 : value;
    }
    return null;
  }

  function powerRate(result, levels) {
    const charts = Array.isArray(result && result.charts) ? result.charts : [];
    const chart = charts.find(chartLooksLikePower);
    if (!chart || !Array.isArray(chart.rows)) return null;
    let total = 0;
    let found = false;
    chart.rows.forEach((row) => {
      const label = normalizeText(row && (row.optionName || row.name || row.label || row.optionValue));
      if (!levels.some(level => label.includes(level.toLowerCase()))) return;
      const rate = rateFromRow(row);
      if (rate === null) return;
      total += rate;
      found = true;
    });
    return found ? total : null;
  }

  function collectDmp(values, snapshot) {
    const results = Array.isArray(snapshot && snapshot.results) ? snapshot.results : [];
    const updatedAt = dateTime(snapshot && snapshot.savedAt);
    results.forEach((result) => {
      const crowd = result.crowd || {};
      const name = crowdName(crowd);
      const normalized = normalizeText(name);
      const role = String(result.role || '');
      const isTaobaoContent = role === 'tt' || normalized.includes('淘天');
      const size = crowdSize(crowd);
      if (isTaobaoContent && size !== null) {
        put(values, 'tt_contentAudienceAsset', size, 'DMP画像/人群包：' + name, updatedAt);
      }
      if (role === 'store' || normalized.includes('全店')) {
        put(values, 'tt_storeAudienceAsset', size, 'DMP画像/全店人群资产', updatedAt);
      }
      if (isTaobaoContent) {
        put(values, 'tt_l12Penetration', powerRate(result, ['L1', 'L2']), 'DMP消费能力等级：' + name, updatedAt);
        put(values, 'tt_l45Penetration', powerRate(result, ['L4', 'L5']), 'DMP消费能力等级：' + name, updatedAt);
      }
    });
  }

  function collectSycm(values, traffic) {
    if (traffic) {
      const updatedAt = dateTime(traffic.savedAt);
      put(values, 'tt_storeVisitors', traffic.storeVisitors, '生意参谋-流量', updatedAt);
      put(values, 'tt_shortVideoVisitors', traffic.shortVideoVisitors, '生意参谋-流量', updatedAt);
      put(values, 'tt_microDetailVisitors', traffic.microDetailVisitors, '生意参谋-流量', updatedAt);
      put(values, 'tt_recommendedTrafficShare', traffic.recommendedTrafficShare, '生意参谋-流量自动计算', updatedAt);
    }
  }

  function collectGuanghe(values, snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const row = rows.find(row => row.channel === '全部' && row.assetCode === 'self') ||
      rows.find(row => row.asset === '自制内容' && row.channel === '全部');
    const updatedAt = dateTime(snapshot.ts);
    put(
      values,
      'tt_seedingGmvShare',
      snapshot.seedingGmvShare,
      '淘宝光合-30日-种草成交金额占比',
      updatedAt
    );
    if (!row) return;
    const source = String(snapshot.collectionSource || '淘宝光合') + '-内容供给-自制内容';
    put(values, 'tt_selfPublishedContents', row.publishedContents, source, updatedAt);
    put(values, 'tt_selfPublicContents', row.publicContents, source, updatedAt);
  }

  function firstSceneRow(rows, keyword) {
    return (Array.isArray(rows) ? rows : []).find(row => (
      normalizeText(row && (row.scene1Name || row.sceneName || row.name)).includes(normalizeText(keyword))
    ));
  }

  function firstNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = asNumber(arguments[index]);
      if (value !== null) return value;
    }
    return null;
  }

  function collectWxt(values, snapshot) {
    const data = snapshot && snapshot.data || snapshot;
    if (!data) return;
    const updatedAt = dateTime(snapshot && snapshot.savedAt);
    const spend = data.spendSummary || {};
    const businessMetrics = data.businessDefenseMetrics || {};
    const shortVideoRow = firstSceneRow(data.marketingRows, '超级短视频') || {};
    const clickSummary = data.shortVideoClick || {};
    const displaySummary = data.shortVideoDisplay || data.shortVideo || {};
    const shortVideoSpend = firstNumber(shortVideoRow.charge, spend.shortVideoCharge);
    const shortVideoName = String(shortVideoRow.scene1Name || shortVideoRow.sceneName || '');
    const hasDirectPotentialSignal = [
      businessMetrics.displayPotentialRatio,
      displaySummary.inshopPotentialUvRate,
      displaySummary.potentialUvRate,
    ].map(asNumber).some((value) => value !== null);
    const hasShortVideoScope = shortVideoName.includes('短视频') ||
      shortVideoSpend !== null ||
      hasDirectPotentialSignal;
    const hasPaidActivity = hasShortVideoScope && shortVideoSpend !== null && shortVideoSpend > 0;
    const hasTrafficActivity = hasShortVideoScope && [
      clickSummary.adPv,
      displaySummary.adPv,
      clickSummary.click,
      displaySummary.click,
      clickSummary.inshopUv,
      displaySummary.inshopUv,
      clickSummary.inshopPotentialUv,
      displaySummary.inshopPotentialUv,
    ].map(asNumber).some((value) => value !== null && value > 0) ||
      hasDirectPotentialSignal;
    const rawClickRoi = firstNumber(
      businessMetrics.lastClickRoi,
      shortVideoRow.roi,
      clickSummary.roi,
      divide(clickSummary.alipayInshopAmt, clickSummary.charge)
    );
    const rawDisplayRoi = firstNumber(
      businessMetrics.displayRoi,
      displaySummary.roi,
      divide(displaySummary.alipayInshopAmt, displaySummary.charge)
    );
    const rawPotentialRatio = firstNumber(
      businessMetrics.displayPotentialRatio,
      displaySummary.inshopPotentialUvRate,
      displaySummary.potentialUvRate,
      divide(displaySummary.inshopPotentialUv, displaySummary.inshopUv)
    );
    const clickRoi = hasPaidActivity ? rawClickRoi : null;
    const displayRoi = hasPaidActivity ? rawDisplayRoi : null;
    const potentialRatio = hasPaidActivity || hasTrafficActivity ? rawPotentialRatio : null;
    put(values, 'tt_wujieSpend', firstNumber(spend.totalCharge, spend.onebpTotalCharge, spend.charge), '万相台-账户总花费', updatedAt);
    put(values, 'tt_superShortVideoSpend', shortVideoSpend, '万相台-超级短视频', updatedAt);
    put(values, 'tt_lastClickRoi', clickRoi, '万相台-末次点击归因', updatedAt);
    put(values, 'tt_displayRoi', displayRoi, '万相台-展现归因短视频', updatedAt);
    put(values, 'tt_displayPotentialRatio', potentialRatio !== null && potentialRatio > 1
      ? potentialRatio / 100
      : potentialRatio, '万相台-展现潜客比', updatedAt);
  }

  function collectManual(values, manual) {
    Object.keys(manual || {}).forEach((key) => {
      if (!MANUAL_KEYS.has(key)) return;
      try {
        const record = manual[key];
        const structured = Boolean(record) && typeof record === 'object' && !Array.isArray(record);
        const explicitOverride = structured && record.manualOverride === true;
        if (values[key] && !explicitOverride) return;
        if (values[key] && values[key].mode === 'manual_override') return;
        const value = normalizeManualInput(key, structured ? record.value : record);
        if (!value) return;
        if (!structured) {
          put(values, key, value, '手填项');
          return;
        }
        put(values, key, value, explicitOverride ? '手填覆盖' : '手填兜底');
        values[key].mode = explicitOverride ? 'manual_override' : 'manual_fallback';
        values[key].updatedAt = String(record.updatedAt || values[key].updatedAt || '');
        values[key].accountKeys = Array.isArray(record.accountKeys) ? record.accountKeys.slice() : [];
        values[key].dateRange = record.dateRange && typeof record.dateRange === 'object'
          ? Object.assign({}, record.dateRange)
          : null;
      } catch (error) {}
    });
  }

  function computeFormulas(values) {
    put(values, 'tt_contentAudienceShare', divide(values.tt_contentAudienceAsset && values.tt_contentAudienceAsset.value, values.tt_storeAudienceAsset && values.tt_storeAudienceAsset.value), '公式计算');
    put(values, 'tt_l45OverL12', divide(values.tt_l45Penetration && values.tt_l45Penetration.value, values.tt_l12Penetration && values.tt_l12Penetration.value), '公式计算');
    put(values, 'tt_shortVideoVisitorShare', divide(values.tt_shortVideoVisitors && values.tt_shortVideoVisitors.value, values.tt_storeVisitors && values.tt_storeVisitors.value), '公式计算');
    put(values, 'tt_efficiencyGap', divide(values.tt_shortVideoVisitorShare && values.tt_shortVideoVisitorShare.value, values.tt_seedingGmvShare && values.tt_seedingGmvShare.value), '公式计算');
    const microShare = divide(values.tt_microDetailVisitors && values.tt_microDetailVisitors.value, values.tt_storeVisitors && values.tt_storeVisitors.value);
    put(values, 'tt_recommendedTrafficShare', values.tt_recommendedTrafficShare && values.tt_recommendedTrafficShare.value != null
      ? values.tt_recommendedTrafficShare.value
      : (microShare === null ? null : 1 - microShare), '公式计算');
    put(values, 'tt_selfApprovalRate', divide(values.tt_selfPublicContents && values.tt_selfPublicContents.value, values.tt_selfPublishedContents && values.tt_selfPublishedContents.value), '公式计算');
    put(values, 'tt_superShortVideoSpendShare', divide(values.tt_superShortVideoSpend && values.tt_superShortVideoSpend.value, values.tt_wujieSpend && values.tt_wujieSpend.value), '公式计算');

    if (!values.xhs_totalSpend) put(values, 'xhs_totalSpend', add(values.xhs_kolSpend && values.xhs_kolSpend.value, values.xhs_juguangSpend && values.xhs_juguangSpend.value), '公式计算');
    if (!values.xhs_kfsRatio && values.xhs_kolSpend && values.xhs_juguangSpend) {
      values.xhs_kfsRatio = { value: values.xhs_kolSpend.value + ':' + values.xhs_juguangSpend.value, source: '公式计算', updatedAt: '', raw: '' };
    }
    if (!values.xhs_visitFrequency) put(values, 'xhs_visitFrequency', divide(values.xhs_xingheVisitors && values.xhs_xingheVisitors.value, values.xhs_dmpVisitors && values.xhs_dmpVisitors.value), '公式计算');
    if (!values.xhs_visitCost) put(values, 'xhs_visitCost', divide(values.xhs_totalSpend && values.xhs_totalSpend.value, values.xhs_xingheVisitors && values.xhs_xingheVisitors.value), '公式计算');
    if (!values.xhs_storeRoi) put(values, 'xhs_storeRoi', divide(values.xhs_storeGmv && values.xhs_storeGmv.value, values.xhs_totalSpend && values.xhs_totalSpend.value), '公式计算');
    if (!values.xhs_taskRoi) put(values, 'xhs_taskRoi', divide(values.xhs_taskGmv && values.xhs_taskGmv.value, values.xhs_totalSpend && values.xhs_totalSpend.value), '公式计算');
    if (!values.xhs_contentAudienceShare) put(values, 'xhs_contentAudienceShare', divide(values.xhs_contentAudienceAsset && values.xhs_contentAudienceAsset.value, values.xhs_storeAudienceAsset && values.xhs_storeAudienceAsset.value), '公式计算');
    if (!values.xhs_l45OverL12) put(values, 'xhs_l45OverL12', divide(values.xhs_l45Penetration && values.xhs_l45Penetration.value, values.xhs_l12Penetration && values.xhs_l12Penetration.value), '公式计算');
  }

  function formatValue(row) {
    const item = row.item;
    if (!item) return '';
    if (typeof item.value === 'string') return item.value;
    if (/Share|Rate|Penetration|Ratio$/.test(row.key) || row.name.includes('占比') || row.name.includes('渗透率')) {
      return (item.value * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
    }
    if (row.name.includes('ROI') || row.name.includes('投产') || row.name.includes('倍差') || row.name === 'L45/L12') {
      return Number(item.value).toFixed(2).replace(/\.?0+$/, '');
    }
    return Number(item.value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function isManualMetric(metric) {
    return Boolean(metric && (metric.collect === 'manual' || MANUAL_KEYS.has(metric.key)));
  }

  function statusFor(metric, item) {
    if (item) {
      if (item.mode === 'preserved') return { text: '已保留', cls: 'ok' };
      if (item.mode === 'manual_fallback' || item.mode === 'manual_override') {
        return { text: '已填写', cls: 'ok' };
      }
      return { text: '已取到', cls: 'ok' };
    }
    if (isManualMetric(metric)) return { text: '待填写', cls: 'pending' };
    if (metric.collect === 'formula') return { text: '待计算', cls: 'pending' };
    return { text: '待采集', cls: 'missing' };
  }

  function formatAccountKeys(item) {
    return item && Array.isArray(item.accountKeys) && item.accountKeys.length
      ? item.accountKeys.join('、')
      : '-';
  }

  function formatDateRange(item) {
    const range = item && item.dateRange;
    if (!range || typeof range !== 'object') return '-';
    const from = String(range.from || '');
    const to = String(range.to || '');
    const timezone = String(range.timezone || '');
    if (!from && !to) return '-';
    return from + (to ? ' 至 ' + to : '') + (timezone ? ' (' + timezone + ')' : '');
  }

  function buildRows(values) {
    return window.BusinessDefenseDiagnosisSpec.metrics.map((metric) => {
      const item = values[metric.key] || null;
      const status = statusFor(metric, item);
      return Object.assign({}, metric, {
        item,
        valueText: item ? formatValue({ key: metric.key, name: metric.name, item }) : '',
        statusText: status.text,
        statusClass: status.cls,
        sourceText: item && item.source || metric.formula || metric.source || metric.note || '',
        updatedAt: item && item.updatedAt || '',
        accountText: formatAccountKeys(item),
        dateRangeText: formatDateRange(item),
        modeText: item && (XHS_MODE_LABELS[item.mode] || item.mode) || '-',
      });
    });
  }

  function hasTaskStatus(status) {
    return Boolean(status && typeof status === 'object' && (
      status.running || status.finishedAt || status.error ||
      (Array.isArray(status.results) && status.results.length)
    ));
  }

  function dataTableStatusFromReport(status) {
    if (!hasTaskStatus(status)) return {};
    const sourceResults = Array.isArray(status.results) ? status.results : [];
    const sourceActive = new Set(
      Array.isArray(status.activeSteps)
        ? status.activeSteps.map(String)
        : (status.currentStep ? [String(status.currentStep)] : [])
    );
    const definitions = [
      { name: '光合内容指标', keys: ['guanghe'], sourceNames: ['光合渠道与资产诊断'] },
      { name: '生意参谋流量指标', keys: ['sycm'], sourceNames: ['生意参谋流量诊断'] },
      { name: '万相台内容投放', keys: ['wxtMarketing', 'wxtShortVideo'], sourceNames: ['万相台营销场景报告', '万相台短视频诊断'] },
      { name: 'DMP人群资产画像', keys: ['dmp'], sourceNames: ['内容人群画像诊断'] },
    ];
    const activeSteps = definitions.filter((definition) => (
      definition.sourceNames.some((name) => sourceActive.has(name))
    )).map((definition) => definition.name);
    const results = definitions.flatMap((definition) => {
      if (status.running && activeSteps.includes(definition.name)) return [];
      const matches = sourceResults.filter((result) => (
        definition.keys.includes(String(result && result.key || '')) ||
        definition.sourceNames.includes(String(result && result.name || ''))
      ));
      if (!matches.length) return [];
      const skipped = matches.length === definition.keys.length && matches.every((result) => result.skipped);
      const completed = matches.filter((result) => !result.skipped);
      const successes = completed.filter((result) => result.ok !== false);
      const incomplete = !skipped && matches.length < definition.keys.length;
      const partial = incomplete || completed.some((result) => result.partial || result.ok === false);
      return [{
        name: definition.name,
        ok: skipped || successes.length > 0,
        skipped,
        partial: !skipped && partial,
        message: matches.map((result) => result.message).filter(Boolean).join('；'),
      }];
    });
    return {
      running: Boolean(status.running),
      startedAt: status.startedAt,
      updatedAt: status.updatedAt,
      finishedAt: status.finishedAt,
      error: status.error,
      total: definitions.length,
      stepIndex: results.length,
      currentStep: activeSteps.join('、'),
      activeSteps,
      results,
    };
  }

  function xhsAnalysisWithStatus(snapshot, status) {
    const analysis = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const collectionStatus = status && typeof status === 'object' ? status : {};
    const platformStates = collectionStatus.platforms && typeof collectionStatus.platforms === 'object'
      ? collectionStatus.platforms
      : {};
    const accounts = Object.assign({}, analysis.accounts && typeof analysis.accounts === 'object'
      ? analysis.accounts
      : {});
    ['adstar', 'pgy', 'juguang'].forEach((platform) => {
      const platformStatus = platformStates[platform] && typeof platformStates[platform] === 'object'
        ? platformStates[platform]
        : {};
      const existing = accounts[platform] && typeof accounts[platform] === 'object'
        ? accounts[platform]
        : {};
      accounts[platform] = Object.assign({}, platformStatus, existing, {
        collectedAt: existing.collectedAt || platformStatus.collectedAt || collectionStatus.updatedAt ||
          analysis.generatedAt || '',
        dateRange: existing.dateRange || platformStatus.dateRange || analysis.dateRange || null,
      });
    });
    return Object.assign({}, analysis, { accounts });
  }

  function xhsDmpExistingValues(manual) {
    const output = {};
    XHS_DMP_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(manual || {}, key)) return;
      const item = manual[key];
      if (item === null || item === undefined || item === '') return;
      output[key] = item;
    });
    return output;
  }

  async function loadRows() {
    try {
      const data = await getStorage(STORAGE_KEYS);
      updateConnectionState(true, webBridgeVersion);
      manualInputs = data.businessDefenseManualInputsV1 || {};
      const businessStatus = data.businessDefenseAutoCollectStatusV1 || {};
      autoCollectStatus = hasTaskStatus(businessStatus)
        ? businessStatus
        : dataTableStatusFromReport(data.taobaoContentDiagnosisReportStatusV1 || {});
      if (autoCollectStatus.running || autoCollectStatus.finishedAt || autoCollectStatus.error) {
        transientNotice = '';
      }
      const values = {};
      collectDmp(values, data.dmpPortraitSnapshotV1);
      collectSycm(values, data.businessDefenseSycmTrafficSnapshotV1);
      collectGuanghe(values, data.gh_channel_snapshot);
      collectWxt(values, data.wxtBusinessDefenseReportV1);
      const analysisSnapshot = xhsAnalysisWithStatus(
        data.xhsAnalysisSnapshotV1,
        data.xhsCollectionStatusV1
      );
      currentXhsAnalysis = analysisSnapshot;
      const xhsMapping = window.XhsMetrics && typeof window.XhsMetrics.mapAnalysisSnapshot === 'function'
        ? window.XhsMetrics.mapAnalysisSnapshot({
          analysisSnapshot: analysisSnapshot,
          existingValues: xhsDmpExistingValues(data.businessDefenseManualInputsV1),
          manualInputs: data.businessDefenseManualInputsV1 || {},
        })
        : { values: {} };
      Object.assign(values, xhsMapping.values || {});
      collectManual(values, data.businessDefenseManualInputsV1);
      computeFormulas(values);
      currentRows = buildRows(values);
      const lastSync = document.getElementById('lastSync');
      if (lastSync) lastSync.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      render(currentRows);
    } catch (error) {
      updateConnectionState(false, '', '数据助手未连接');
      manualInputs = {};
      currentXhsAnalysis = null;
      autoCollectStatus = {};
      currentRows = buildRows({});
      transientNotice = error && error.message ? error.message : '数据助手未连接。';
      render(currentRows);
    }
  }

  function renderPlatformProgress(status) {
    const root = document.getElementById('platformProgress');
    if (!root) return;
    const steps = ['光合内容指标', '生意参谋流量指标', '万相台内容投放', 'DMP人群资产画像'];
    const results = Array.isArray(status && status.results) ? status.results : [];
    const current = String(status && status.currentStep || '');
    const active = new Set(
      Array.isArray(status && status.activeSteps)
        ? status.activeSteps.map(String)
        : (current ? [current] : [])
    );
    root.innerHTML = steps.map((name, index) => {
      const result = results.find((item) => item.name === name);
      let state = 'waiting';
      let stateText = '等待';
      let detail = '等待后台调度';
      if (result) {
        state = result.skipped ? 'skipped' : (!result.ok ? 'failed' : (result.partial ? 'partial' : 'success'));
        stateText = result.skipped ? '跳过' : (!result.ok ? '失败' : (result.partial ? '部分完成' : '完成'));
        detail = result.message || (!result.ok ? '未返回数据' : (result.partial ? '已保存部分数据' : '已保存快照'));
      } else if (status && status.running && active.has(name)) {
        state = 'running';
        stateText = '进行中';
        detail = '正在读取平台数据';
      } else if (status && status.finishedAt) {
        state = 'failed';
        stateText = '未完成';
        detail = '本次任务未返回该平台结果';
      }
      return '<div class="platform-step ' + state + '">' +
        '<div class="platform-step-index">' + (index + 1) + '</div>' +
        '<div class="platform-step-copy"><strong>' + escapeHtml(name) + '</strong>' +
        '<span title="' + escapeHtml(detail) + '">' + escapeHtml(detail) + '</span></div>' +
        '<b>' + stateText + '</b></div>';
    }).join('');
    const progress = document.getElementById('runProgressBar');
    if (progress) {
      const completed = results.length;
      const currentFraction = status && status.running
        ? Math.min(active.size * 0.34, steps.length - completed)
        : 0;
      progress.style.width = Math.min(100, ((completed + currentFraction) / steps.length) * 100) + '%';
    }
  }

  function renderSummary(rows) {
    const summary = document.getElementById('summary');
    if (summary) {
      const total = rows.length;
      const done = rows.filter(row => row.item).length;
      const manual = rows.filter(row => row.statusText === '待填写').length;
      const missing = rows.filter(row => row.statusText === '待采集').length;
      summary.innerHTML = [
        ['总指标', total],
        ['已有数据', done],
        ['待采集', missing],
        ['待填写', manual],
      ].map(item => '<div><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join('');
    }
    const clearButton = document.getElementById('clearBtn');
    const hint = document.getElementById('hint');
    renderPlatformProgress(autoCollectStatus);
    if (!webBridgeConnected) {
      clearButton.disabled = true;
      hint.textContent = transientNotice || '请在 Chrome 扩展页重载“淘宝内容诊断插件”，然后刷新本页。';
      return;
    }
    if (!parallelWebToolSupported()) {
      clearButton.disabled = false;
      hint.textContent = '当前扩展仍是旧版，请在 Chrome 扩展管理页重载“淘宝内容诊断插件”，再刷新本页。';
      return;
    }
    if (autoCollectIsActive(autoCollectStatus)) {
      const index = Array.isArray(autoCollectStatus.results) ? autoCollectStatus.results.length : 0;
      const total = Number(autoCollectStatus.total) || 4;
      const active = Array.isArray(autoCollectStatus.activeSteps)
        ? autoCollectStatus.activeSteps
        : (autoCollectStatus.currentStep ? [autoCollectStatus.currentStep] : []);
      clearButton.disabled = true;
      hint.textContent = '一键取数进行中（' + index + '/' + total + '）：' +
        (active.join('、') || '准备平台任务') + '。请保持各平台账号已登录。';
      return;
    }
    clearButton.disabled = false;
    if (transientNotice) {
      hint.textContent = transientNotice;
      return;
    }
    if (autoCollectStatus.running) {
      hint.textContent = '上次取数已中断，请返回团队网页的“一键取数”重新执行。';
      return;
    }
    if (autoCollectStatus.error) {
      hint.textContent = '一键取数失败：' + autoCollectStatus.error;
      return;
    }
    const statusResults = Array.isArray(autoCollectStatus.results) ? autoCollectStatus.results : [];
    if (autoCollectStatus.finishedAt && statusResults.length) {
      hint.textContent = '本次一键取数归档：' + statusResults.map((item) => (
        (item.skipped ? '跳过 ' : (!item.ok ? '失败 ' : (item.partial ? '部分完成 ' : '成功 '))) +
          item.name + (item.message ? '（' + item.message + '）' : '')
      )).join('；');
      return;
    }
    hint.textContent = '此处只读展示归档数据；新任务请从团队网页的“一键取数”发起。';
  }

  function renderPlatformTableSelection() {
    const taobaoPanel = document.getElementById('taobaoMetricsPanel');
    const xiaohongshuPanel = document.getElementById('xiaohongshuMetricsPanel');
    if (!taobaoPanel || !xiaohongshuPanel) return;
    const showTaobao = activePlatformTable === 'taobao';
    taobaoPanel.hidden = !showTaobao;
    xiaohongshuPanel.hidden = showTaobao;
    Array.from(document.querySelectorAll('[data-platform-table]')).forEach((button) => {
      const active = button.getAttribute('data-platform-table') === activePlatformTable;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function selectPlatformTable(platform, focusTab) {
    activePlatformTable = platform === 'xiaohongshu' ? 'xiaohongshu' : 'taobao';
    renderPlatformTableSelection();
    if (!focusTab) return;
    const tab = document.querySelector('[data-platform-table="' + activePlatformTable + '"]');
    if (tab) tab.focus();
  }

  function rowMarkup(row, includePlatform) {
    return (
      '<tr' + (isManualMetric(row) ? ' class="manual-metric-row"' : '') + '>' +
      (includePlatform ? '<td>' + escapeHtml(row.platform) + '</td>' : '') +
      '<td>' + escapeHtml(row.section) + '</td>' +
      '<td>' + escapeHtml(row.name) + '</td>' +
      '<td class="value">' + valueCell(row) + '</td>' +
      '<td><span class="status ' + row.statusClass + '">' + escapeHtml(row.statusText) + '</span></td>' +
      '<td class="muted">' + escapeHtml(row.sourceText || row.collect || '') + '</td>' +
      '<td class="muted">' + escapeHtml(row.accountText || '-') + '</td>' +
      '<td class="muted">' + escapeHtml(row.dateRangeText || '-') + '</td>' +
      '<td class="muted">' + escapeHtml(row.modeText || '-') + '</td>' +
      '<td class="muted">' + escapeHtml(row.updatedAt || '-') + '</td>' +
      '</tr>'
    );
  }

  function focusedManualInput() {
    const input = document.activeElement;
    if (!input || !input.classList || !input.classList.contains('manual-input')) return null;
    return {
      key: input.getAttribute('data-key') || '',
      value: input.value,
      start: input.selectionStart,
      end: input.selectionEnd,
    };
  }

  function restoreManualInputFocus(snapshot) {
    if (!snapshot || !snapshot.key) return;
    const input = Array.from(document.querySelectorAll('.manual-input')).find((node) => (
      node.getAttribute('data-key') === snapshot.key
    ));
    if (!input) return;
    input.value = snapshot.value;
    input.focus();
    if (Number.isInteger(snapshot.start) && Number.isInteger(snapshot.end)) {
      input.setSelectionRange(snapshot.start, snapshot.end);
    }
  }

  function render(rows) {
    const focusSnapshot = focusedManualInput();
    renderSummary(rows);
    const taobaoRows = rows.filter(row => row.platform === '淘天');
    const xiaohongshuRows = rows.filter(row => row.platform === '小红书');
    const taobaoBody = document.getElementById('taobaoMetricRows');
    const xiaohongshuBody = document.getElementById('xiaohongshuMetricRows');

    if (taobaoBody && xiaohongshuBody) {
      taobaoBody.innerHTML = taobaoRows.map(row => rowMarkup(row, false)).join('');
      xiaohongshuBody.innerHTML = xiaohongshuRows.map(row => rowMarkup(row, false)).join('');
      const taobaoCount = document.getElementById('taobaoMetricCount');
      const xiaohongshuCount = document.getElementById('xiaohongshuMetricCount');
      if (taobaoCount) {
        taobaoCount.textContent = taobaoRows.length + ' 项 · 已取到 ' + taobaoRows.filter(row => row.item).length + ' 项';
      }
      if (xiaohongshuCount) {
        const populatedRows = xiaohongshuRows.filter((row) => row.item);
        const manualRows = populatedRows.filter((row) => (
          row.item.mode === 'manual_fallback' || row.item.mode === 'manual_override' ||
          row.item.mode === 'preserved'
        ));
        xiaohongshuCount.textContent = xiaohongshuRows.length + ' 项 · 已取到 ' +
          populatedRows.length + ' 项 · 手填/保留 ' + manualRows.length + ' 项';
      }
      renderPlatformTableSelection();
    } else {
      const visibleRows = rows.filter((row) => {
        if (activeFilter === 'taobao') return row.platform === '淘天';
        if (activeFilter === 'xiaohongshu') return row.platform === '小红书';
        if (activeFilter === 'pending') return !row.item;
        return true;
      });
      const legacyBody = document.getElementById('metricRows');
      if (legacyBody) legacyBody.innerHTML = visibleRows.map(row => rowMarkup(row, true)).join('');
      const count = document.getElementById('visibleMetricCount');
      if (count) count.textContent = '当前显示 ' + visibleRows.length + ' / ' + rows.length + ' 项';
    }
    Array.from(document.querySelectorAll('[data-filter]')).forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-filter') === activeFilter);
    });
    bindManualInputs();
    restoreManualInputFocus(focusSnapshot);
  }

  function manualRecordValue(record) {
    return record && typeof record === 'object' && !Array.isArray(record)
      ? record.value
      : record;
  }

  function manualInputMarkup(key, name, saved, percentage, placeholder) {
    return '<input class="manual-input" data-key="' + escapeHtml(key) + '" value="' + escapeHtml(saved) +
      '" inputmode="decimal" aria-label="手动填写' + escapeHtml(name) + '" placeholder="' +
      (placeholder || (percentage ? '例如 30%' : '输入数值')) + '"' + (archiveManualInputsSupported()
        ? ''
        : ' disabled title="请重载数据助手后再填写"') + '>';
  }

  function valueCell(row) {
    const automatic = row.item && ['automatic', 'formula'].includes(row.item.mode);
    if (row.key === 'xhs_noteCount') {
      const underwaterValue = manualRecordValue(manualInputs.xhs_unreportedNoteCount);
      const total = row.valueText
        ? '<span class="note-count-total">总计 ' + escapeHtml(row.valueText) + '</span>'
        : '';
      return '<div class="note-count-editor">' + total +
        manualInputMarkup(
          'xhs_unreportedNoteCount',
          '水下笔记数',
          underwaterValue == null ? '' : underwaterValue,
          false,
          '水下笔记数'
        ) + '</div>';
    }
    if (isManualMetric(row)) {
      if (automatic) return row.valueText ? escapeHtml(row.valueText) : '-';
      const record = manualInputs[row.key];
      const savedValue = manualRecordValue(record);
      const saved = savedValue == null ? '' : savedValue;
      const percentage = PERCENT_MANUAL_KEYS.has(row.key);
      return manualInputMarkup(row.key, row.name, saved, percentage);
    }
    if (row.valueText) return escapeHtml(row.valueText);
    return '-';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeManualInput(key, value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const number = asNumber(text);
    if (number === null) throw new Error('请输入有效数字。');
    if (number < 0) throw new Error('请输入大于或等于 0 的数字。');
    if (!PERCENT_MANUAL_KEYS.has(key)) {
      if (/[%％]$/.test(text)) throw new Error('该指标请填写数值，不要输入百分号。');
      if (INTEGER_MANUAL_KEYS.has(key) && !Number.isInteger(number)) {
        throw new Error('该指标请输入整数。');
      }
      return text;
    }
    const percentage = /[%％]$/.test(text) || number <= 1 ? number * 100 : number;
    if (percentage > 100) throw new Error('百分比不能超过 100%。');
    return Number(percentage.toFixed(6)).toString() + '%';
  }

  function bindManualInputs() {
    Array.from(document.querySelectorAll('.manual-input')).forEach((input) => {
      input.addEventListener('input', () => {
        input.setCustomValidity('');
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
      input.addEventListener('blur', async () => {
        const key = input.getAttribute('data-key');
        let value = '';
        try {
          value = normalizeManualInput(key, input.value);
        } catch (error) {
          input.setCustomValidity(error && error.message ? error.message : '请输入有效数字。');
          input.setAttribute('aria-invalid', 'true');
          input.reportValidity();
          return;
        }
        const next = Object.assign({}, manualInputs);
        const previousRecord = manualInputs[key];
        const structuredOverride = previousRecord && typeof previousRecord === 'object' &&
          !Array.isArray(previousRecord) && previousRecord.manualOverride === true;
        const savedValue = structuredOverride && value
          ? Object.assign({}, previousRecord, { value, updatedAt: new Date().toISOString() })
          : value;
        if (value) next[key] = savedValue;
        else delete next[key];
        const currentValue = manualRecordValue(previousRecord);
        if (String(currentValue == null ? '' : currentValue) === value) return;
        const previous = manualInputs;
        manualInputs = next;
        input.disabled = true;
        const operation = manualSaveQueue.catch(() => {}).then(async () => {
          await setStorage(
            { businessDefenseManualInputsV1: next },
            { key, value: savedValue }
          );
          await loadRows();
        });
        manualSaveQueue = operation.catch(() => {});
        try {
          await operation;
        } catch (error) {
          manualInputs = previous;
          const currentInput = Array.from(document.querySelectorAll('.manual-input')).find((node) => (
            node.getAttribute('data-key') === key
          )) || input;
          currentInput.disabled = false;
          currentInput.setCustomValidity('保存失败：' + (error && error.message ? error.message : String(error)));
          currentInput.setAttribute('aria-invalid', 'true');
          currentInput.reportValidity();
        }
      });
    });
  }

  async function flushManualInputs() {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('manual-input')) active.blur();
    await manualSaveQueue;
    const invalid = document.querySelector('.manual-input[aria-invalid="true"]');
    if (!invalid) return true;
    invalid.focus();
    invalid.reportValidity();
    return false;
  }

  async function copyTable() {
    if (!await flushManualInputs()) return;
    const text = currentRows.map(row => [
      row.platform,
      row.section,
      row.name,
      row.valueText || '',
      row.statusText,
      row.sourceText || '',
      row.accountText || '',
      row.dateRangeText || '',
      row.modeText || '',
      row.updatedAt || '',
    ].join('\t')).join('\n');
    await navigator.clipboard.writeText(text);
  }

  async function exportExcel() {
    if (!await flushManualInputs()) return;
    const exportRows = (platform) => currentRows.filter(row => row.platform === platform).map(row => ({
      模块: row.section,
      指标: row.name,
      数值: row.valueText || '',
      状态: row.statusText,
      来源或公式: row.sourceText || '',
      采集账号: row.accountText || '',
      数据日期: row.dateRangeText || '',
      取值模式: row.modeText || '',
      更新时间: row.updatedAt || '',
      备注: row.note || '',
    }));
    const workbook = XLSX.utils.book_new();
    const appendSheet = (platform, sheetName) => {
      const sheet = XLSX.utils.json_to_sheet(exportRows(platform));
      sheet['!cols'] = [
        { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 10 },
        { wch: 52 }, { wch: 30 }, { wch: 32 }, { wch: 16 }, { wch: 22 }, { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    };
    appendSheet('淘天', '淘宝经营数据');
    appendSheet('小红书', '小红书经营数据');

    const analysis = currentXhsAnalysis && typeof currentXhsAnalysis === 'object'
      ? currentXhsAnalysis
      : {};
    const management = analysis.management && typeof analysis.management === 'object'
      ? analysis.management
      : {};
    const costs = management.costs && typeof management.costs === 'object' ? management.costs : {};
    const starTask = management.starTaskResult && typeof management.starTaskResult === 'object'
      ? management.starTaskResult
      : {};
    const outsideDirect = management.outsideDirectResult && typeof management.outsideDirectResult === 'object'
      ? management.outsideDirectResult
      : {};
    const star = analysis.star && typeof analysis.star === 'object' ? analysis.star : {};
    const spotlight = analysis.spotlight && typeof analysis.spotlight === 'object' ? analysis.spotlight : {};
    const safeRows = (value) => Array.isArray(value) ? value : [];
    const cellNumber = (value) => {
      if (value === null || value === undefined || value === '') return '';
      return Number.isFinite(Number(value)) ? Number(value) : '';
    };
    const metric = (value, key) => value && value.metrics && value.metrics[key];
    const appendDataSheet = (sheetName, rows, widths) => {
      const data = rows.length ? rows : [{ 说明: '本次归档暂无该类数据' }];
      const sheet = XLSX.utils.json_to_sheet(data);
      sheet['!cols'] = (widths || []).map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    };

    appendDataSheet('小红书管理汇总', [{
      运行ID: analysis.runId || '',
      店铺ID: analysis.storeId || '',
      数据开始: analysis.dateRange && analysis.dateRange.from || '',
      数据结束: analysis.dateRange && analysis.dateRange.to || '',
      时区: analysis.dateRange && analysis.dateRange.timezone || '',
      决策可用: analysis.quality && analysis.quality.decisionReady === true ? '是' : '否',
      笔记数: cellNumber(management.noteCount),
      合作实付: cellNumber(costs.cooperation),
      平台服务费: cellNumber(costs.platformFee),
      达人合作总成本: cellNumber(costs.partnership),
      聚光消耗: cellNumber(costs.juguang),
      总成本: cellNumber(costs.total),
      星河任务成本: cellNumber(costs.starTaskAligned),
      星河任务GMV: cellNumber(starTask.gmv),
      星河任务ROI: cellNumber(starTask.roi),
      任务外直达消耗: cellNumber(outsideDirect.spend),
      任务外直达GMV: cellNumber(outsideDirect.gmv),
      任务外直达ROI: cellNumber(outsideDirect.roi),
      生成时间: analysis.generatedAt || '',
    }], [24, 24, 14, 14, 18, 12, 12, 14, 14, 16, 14, 14, 16, 16, 16, 18, 18, 18, 24]);

    appendDataSheet('小红书笔记联表', safeRows(analysis.notes).map((note) => ({
      笔记ID: note.noteId || '',
      标题: note.title || '',
      达人: note.author && note.author.name || '',
      发布时间: note.publishDate || '',
      成熟度: note.maturity || '',
      任务区间: safeRows(note.task && note.task.intervals).map((item) => (
        String(item.start || '') + ' 至 ' + String(item.end || '')
      )).join('；'),
      星河项目ID: safeRows(note.task && note.task.projectIds).join('；'),
      星河订单ID: safeRows(note.task && note.task.orderIds).join('；'),
      合作实付: cellNumber(note.costs && note.costs.cooperation),
      平台服务费: cellNumber(note.costs && note.costs.platformFee),
      聚光消耗: cellNumber(note.costs && note.costs.juguang),
      总成本: cellNumber(note.costs && note.costs.total),
      任务成本: cellNumber(note.costs && note.costs.starTaskAligned),
      任务外直达消耗: cellNumber(note.costs && note.costs.outsideDirect),
      蒲公英曝光: cellNumber(note.pgy && metric(note.pgy, 'impressions')),
      蒲公英阅读: cellNumber(note.pgy && metric(note.pgy, 'reads')),
      蒲公英互动: cellNumber(note.pgy && metric(note.pgy, 'interactions')),
      星河GMV: cellNumber(note.results && note.results.starTaskGmv),
      星河ROI: cellNumber(note.results && note.results.starTaskRoi),
      任务外直达GMV: cellNumber(note.results && note.results.outsideDirectGmv),
      任务外直达ROI: cellNumber(note.results && note.results.outsideDirectRoi),
    })), [24, 34, 18, 14, 12, 30, 28, 28, 14, 14, 14, 14, 14, 18, 14, 14, 14, 14, 14, 18, 18]);

    const layerRows = [];
    for (const [layer, units] of [['项目', star.projects], ['订单', star.orders]]) {
      safeRows(units).forEach((unit) => layerRows.push({
        层级: layer,
        ID: unit.id || '',
        名称: unit.name || '',
        项目ID: unit.projectId || '',
        状态: unit.status || '',
        分摊成本: cellNumber(unit.allocatedCost),
        GMV: cellNumber(metric(unit, 'gmv')),
        ROI: cellNumber(unit.roi),
        阅读UV: cellNumber(metric(unit, 'readUv')),
        互动UV: cellNumber(metric(unit, 'engagementUv')),
        进店UV: cellNumber(metric(unit, 'storeVisitUv')),
        成交UV: cellNumber(metric(unit, 'orderUv')),
      }));
    }
    appendDataSheet('小红书项目订单', layerRows, [10, 28, 32, 28, 14, 14, 14, 14, 14, 14, 14, 14]);

    appendDataSheet('小红书聚光日报', safeRows(spotlight.daily).map((row) => ({
      日期: row.date || '',
      笔记ID: row.noteId || '',
      广告账户ID: row.accountId || '',
      广告账户: row.accountName || '',
      账户类型: row.accountType == null ? '' : row.accountType,
      营销诉求: row.marketingObjective || '',
      投放模式: row.deliveryMode == null ? '' : row.deliveryMode,
      任务状态: row.taskStatus || '',
      消耗: cellNumber(row.spend),
      曝光: cellNumber(row.impressions),
      点击: cellNumber(row.clicks),
      互动: cellNumber(row.interactions),
      种草人数: cellNumber(row.seedUsers),
      深度种草人数: cellNumber(row.deepSeedUsers),
      进店: cellNumber(row.conversion && row.conversion.storeVisits),
      成交: cellNumber(row.conversion && row.conversion.orders),
      GMV: cellNumber(row.conversion && row.conversion.gmv),
    })), [14, 24, 24, 24, 12, 16, 14, 14, 14, 14, 14, 14, 14, 16, 14, 14, 14]);

    appendDataSheet('小红书星河明细', safeRows(star.daily).map((row) => ({
      日期: row.date || '',
      笔记ID: row.noteId || '',
      任务状态: row.taskStatus || '',
      项目ID: safeRows(row.projectIds).join('；'),
      订单ID: safeRows(row.orderIds).join('；'),
      来源行数: cellNumber(row.rowCount),
      阅读UV: cellNumber(metric(row, 'readUv')),
      互动UV: cellNumber(metric(row, 'engagementUv')),
      搜索曝光UV: cellNumber(metric(row, 'searchImpressionUv')),
      搜索进店UV: cellNumber(metric(row, 'searchVisitUv')),
      店铺进店UV: cellNumber(metric(row, 'storeVisitUv')),
      新客进店UV: cellNumber(metric(row, 'newStoreVisitUv')),
      收藏UV: cellNumber(metric(row, 'favoriteUv')),
      加购UV: cellNumber(metric(row, 'cartUv')),
      成交UV: cellNumber(metric(row, 'orderUv')),
      新客成交UV: cellNumber(metric(row, 'newOrderUv')),
      GMV: cellNumber(metric(row, 'gmv')),
      任务商品GMV: cellNumber(metric(row, 'seededProductGmv')),
      连带GMV: cellNumber(metric(row, 'linkedProductGmv')),
    })), [14, 24, 14, 28, 28, 12, 14, 14, 16, 16, 16, 16, 14, 14, 14, 16, 14, 18, 14]);

    const qualityRows = [{
      记录类型: '质量汇总',
      严重级别: analysis.quality && analysis.quality.decisionReady === true ? 'ready' : 'critical',
      代码: 'decision_ready',
      平台: '',
      笔记ID: '',
      内容: analysis.quality && analysis.quality.decisionReady === true
        ? '三平台数据达到经营决策门槛'
        : '三平台数据未达到经营决策门槛',
    }];
    safeRows(analysis.quality && analysis.quality.issues).forEach((issue) => qualityRows.push({
      记录类型: '质量问题',
      严重级别: issue.severity || '',
      代码: issue.code || '',
      平台: issue.platform || '',
      笔记ID: issue.noteId || '',
      内容: issue.message || '',
    }));
    safeRows(analysis.actions).forEach((action) => qualityRows.push({
      记录类型: '行动建议',
      严重级别: action.confidence || '',
      代码: action.action || '',
      平台: '',
      笔记ID: action.noteId || '',
      内容: safeRows(action.evidence).join('；'),
    }));
    appendDataSheet('小红书质量说明', qualityRows, [14, 14, 24, 14, 24, 72]);
    XLSX.writeFile(workbook, '经营攻防内容诊断取数_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  async function clearData() {
    if (autoCollectIsActive(autoCollectStatus)) return;
    if (!window.confirm('确认清空一键取数快照、手填数据和上次运行状态？各平台线上数据不会被删除。')) {
      return;
    }
    const button = document.getElementById('clearBtn');
    button.disabled = true;
    button.textContent = '清空中…';
    try {
      await removeStorage(CLEARABLE_STORAGE_KEYS);
      manualInputs = {};
      currentXhsAnalysis = null;
      autoCollectStatus = {};
      transientNotice = '已清空本地汇总数据。请从团队网页的“一键取数”生成新归档。';
      await loadRows();
    } catch (error) {
      transientNotice = '清空失败：' + (error && error.message ? error.message : String(error));
      render(currentRows);
    } finally {
      button.disabled = false;
      button.textContent = '清空数据';
    }
  }

  document.getElementById('refreshBtn').addEventListener('click', loadRows);
  document.getElementById('copyBtn').addEventListener('click', copyTable);
  document.getElementById('exportBtn').addEventListener('click', exportExcel);
  document.getElementById('clearBtn').addEventListener('click', clearData);
  Array.from(document.querySelectorAll('[data-filter]')).forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.getAttribute('data-filter') || 'all';
      render(currentRows);
    });
  });
  Array.from(document.querySelectorAll('[data-platform-table]')).forEach((button) => {
    button.addEventListener('click', () => {
      selectPlatformTable(button.getAttribute('data-platform-table'), false);
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextPlatform = event.key === 'ArrowLeft' || event.key === 'Home' ? 'taobao' : 'xiaohongshu';
      selectPlatformTable(nextPlatform, true);
    });
  });
  if (IS_EXTENSION_PAGE) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (STORAGE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) scheduleLoadRows();
    });
  }

  async function initialize() {
    if (!IS_EXTENSION_PAGE) {
      try {
        const info = await requestWebBridge('ping', {}, 2000);
        updateConnectionState(true, info && info.version || '', '', info && info.capabilities);
      } catch (error) {
        updateConnectionState(false, '', '数据助手未连接');
        manualInputs = {};
        currentXhsAnalysis = null;
        autoCollectStatus = {};
        currentRows = buildRows({});
        transientNotice = error && error.message ? error.message : '数据助手未连接。';
        render(currentRows);
        return;
      }
    }
    await loadRows();
  }

  Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
    .catch(() => null)
    .then(initialize);
})();
