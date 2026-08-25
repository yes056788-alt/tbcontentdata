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
      const detailKeys = window.XhsMetrics &&
        typeof window.XhsMetrics.analysisDetailKeys === 'function'
        ? window.XhsMetrics.analysisDetailKeys(data.xhsAnalysisSnapshotV1)
        : [];
      const detailValues = detailKeys.length ? await getStorage(detailKeys) : {};
      const hydratedXhsAnalysis = window.XhsMetrics &&
        typeof window.XhsMetrics.hydrateXhsAnalysisArchiveBundle === 'function'
        ? window.XhsMetrics.hydrateXhsAnalysisArchiveBundle(
          data.xhsAnalysisSnapshotV1,
          detailValues
        )
        : data.xhsAnalysisSnapshotV1;
      const analysisSnapshot = xhsAnalysisWithStatus(
        hydratedXhsAnalysis,
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
    const safeObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
    const safeRows = (value) => Array.isArray(value) ? value : [];
    const management = safeObject(analysis.management);
    const costs = safeObject(management.costs);
    const accountOverview = safeObject(management.accountOverview);
    const starTask = safeObject(management.starTaskResult);
    const storeResult = safeObject(management.storeResult);
    const outsideDirect = safeObject(management.outsideDirectResult);
    const directResult = safeObject(management.directResult);
    const pgy = safeObject(analysis.pgy);
    const star = safeObject(analysis.star);
    const spotlight = safeObject(analysis.spotlight);
    const dateRange = safeObject(analysis.dateRange);
    const finiteNumber = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const number = typeof value === 'number'
        ? value
        : Number(String(value).replace(/[,，￥¥%\s]/g, ''));
      return Number.isFinite(number) ? number : null;
    };
    const firstValue = (...values) => values.find((value) => (
      value !== null && value !== undefined && value !== ''
    ));
    const sumIfKnown = (...values) => {
      const numbers = values.map(finiteNumber);
      return numbers.every((value) => value !== null)
        ? numbers.reduce((sum, value) => sum + value, 0)
        : null;
    };
    const ratio = (numerator, denominator) => {
      const top = finiteNumber(numerator);
      const bottom = finiteNumber(denominator);
      return top !== null && bottom !== null && bottom > 0 ? top / bottom : null;
    };
    const cellNumber = (value) => {
      const number = finiteNumber(value);
      return number === null ? '—' : number;
    };
    const cellText = (value) => value === null || value === undefined || String(value).trim() === ''
      ? '—'
      : String(value);
    const metric = (value, key) => safeObject(value && value.metrics)[key];
    const appendDataSheet = (sheetName, rows, widths) => {
      const data = rows.length ? rows : [{ 说明: '本次归档暂无该类数据' }];
      const sheet = XLSX.utils.json_to_sheet(data);
      sheet['!cols'] = (widths || []).map((wch) => ({ wch }));
      if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    };
    const normalizeTaskStatus = (value) => {
      if (value === 'in_task') return 'in_task';
      if (value === 'out_of_task' || value === 'no_task' || value === 'outside_task') {
        return 'outside_task';
      }
      return 'unknown';
    };
    const normalizeObjective = (value) => {
      const text = value === null || value === undefined ? '' : String(value).trim();
      const compact = text.toLowerCase().replace(/[\s_-]/g, '');
      if (text === '13' || compact.includes('direct') || text.includes('直达')) return 'direct';
      if (text === '4' || compact.includes('seeding') || text.includes('种草')) return 'product_seeding';
      return text || 'unknown';
    };
    const objectiveLabel = (value) => ({
      direct: '种草直达',
      product_seeding: '产品种草',
      unknown: '未知营销诉求',
    }[normalizeObjective(value)] || String(value));
    const creatorSpendFallback = sumIfKnown(costs.cooperation, costs.platformFee);
    const creatorSpend = firstValue(accountOverview.creatorSpend, costs.partnership, creatorSpendFallback);
    const adSpend = firstValue(accountOverview.adSpend, costs.juguang);
    const totalSpend = firstValue(accountOverview.totalSpend, costs.total, sumIfKnown(creatorSpend, adSpend));
    const starAlignedSpend = firstValue(accountOverview.starAlignedSpend, costs.starTaskAligned);
    const taskAdSpend = firstValue(accountOverview.taskAdSpend, costs.juguangInTask);
    const outsideTaskAdSpend = firstValue(accountOverview.outsideTaskAdSpend, costs.juguangOutsideTask);
    const unknownTaskAdSpend = firstValue(accountOverview.unknownTaskAdSpend, costs.juguangUnknownTask);
    const spotlightDaily = safeRows(spotlight.daily);
    const taskObjectiveSpend = (taskStatus, marketingObjective) => {
      const bucket = safeRows(spotlight.byTaskObjective).find((item) => (
        normalizeTaskStatus(item && item.taskStatus) === taskStatus &&
        normalizeObjective(item && item.marketingObjective) === marketingObjective
      ));
      if (bucket && finiteNumber(bucket.spend) !== null) return finiteNumber(bucket.spend);
      const matching = spotlightDaily.filter((row) => (
        normalizeTaskStatus(row && row.taskStatus) === taskStatus &&
        normalizeObjective(row && row.marketingObjective) === marketingObjective
      ));
      return matching.length
        ? matching.reduce((sum, row) => sum + (finiteNumber(row.spend) || 0), 0)
        : null;
    };

    appendDataSheet('小红书账户总览', [{
      运行ID: cellText(analysis.runId),
      店铺ID: cellText(analysis.storeId),
      数据开始: cellText(dateRange.from),
      数据结束: cellText(dateRange.to),
      时区: cellText(dateRange.timezone),
      决策可用: analysis.quality && analysis.quality.decisionReady === true
        ? '是'
        : analysis.quality && analysis.quality.decisionReady === false ? '否' : '—',
      星河数据笔记数: cellNumber(management.noteCount),
      时间筛选内笔记数: cellNumber(pgy.noteCount),
      星河任务笔记数: cellNumber(pgy.starTaskNoteCount),
      超期笔记数: cellNumber(pgy.overdueNoteCount),
      蒲公英合作实付: cellNumber(safeObject(pgy.costs).cooperation),
      蒲公英平台服务费: cellNumber(safeObject(pgy.costs).platformFee),
      蒲公英曝光量: cellNumber(safeObject(pgy.metrics).impressions),
      蒲公英阅读量: cellNumber(safeObject(pgy.metrics).reads),
      蒲公英互动量: cellNumber(safeObject(pgy.metrics).interactions),
      蒲公英阅读率: cellNumber(safeObject(pgy.metrics).readRate),
      蒲公英互动率: cellNumber(safeObject(pgy.metrics).engagementRate),
      总投入: cellNumber(totalSpend),
      达人花费: cellNumber(creatorSpend),
      广告花费: cellNumber(adSpend),
      星河归因投入: cellNumber(starAlignedSpend),
      任务期内广告花费: cellNumber(taskAdSpend),
      任务期外广告花费: cellNumber(outsideTaskAdSpend),
      任务周期未知广告花费: cellNumber(unknownTaskAdSpend),
      任务期内产品种草消耗: cellNumber(taskObjectiveSpend('in_task', 'product_seeding')),
      任务期内种草直达消耗: cellNumber(taskObjectiveSpend('in_task', 'direct')),
      任务期外产品种草消耗: cellNumber(taskObjectiveSpend('outside_task', 'product_seeding')),
      任务期外种草直达消耗: cellNumber(taskObjectiveSpend('outside_task', 'direct')),
      任务ROI: cellNumber(firstValue(accountOverview.taskRoi, starTask.roi)),
      任务外直达ROI: cellNumber(firstValue(accountOverview.outsideDirectRoi, outsideDirect.roi)),
      直达ROI: cellNumber(firstValue(accountOverview.directRoi, directResult.roi)),
      生成时间: cellText(analysis.generatedAt),
    }], [24, 24, 14, 14, 18, 12, 16, 18, 18, 18, 20, 16, 16, 16, 16, 16, 14, 14, 14,
      16, 18, 18, 22, 20, 20, 20, 20, 14, 18, 14, 24]);

    const pgyMonthlyRows = safeRows(pgy.monthly).map((row) => ({
      月份: cellText(row && row.month),
      发布笔记数: cellNumber(row && row.noteCount),
    }));
    appendDataSheet('蒲公英月度', pgyMonthlyRows.length ? pgyMonthlyRows : [{
      月份: '—',
      发布笔记数: '—',
    }], [14, 16]);

    const pgyFollowerRows = safeRows(pgy.followerTiers).map((row) => ({
      粉丝量级: cellText(row && (row.label || row.key)),
      笔记数量: cellNumber(row && row.noteCount),
      达人数量: cellNumber(row && row.authorCount),
      合作费用: cellNumber(row && row.cooperationCost),
      平均合作费用: cellNumber(row && row.averageCooperationCost),
      口径: '仅合作费，不含平台服务费',
    }));
    appendDataSheet('蒲公英粉丝量级', pgyFollowerRows.length ? pgyFollowerRows : [{
      粉丝量级: '—',
      笔记数量: '—',
      达人数量: '—',
      合作费用: '—',
      平均合作费用: '—',
      口径: '仅合作费，不含平台服务费',
    }], [14, 14, 14, 16, 18, 30]);

    const spotlightGroups = new Map();
    for (const row of spotlightDaily) {
      const accountId = cellText(row && row.accountId);
      const accountName = cellText(row && (row.accountName || row.accountId));
      const marketingObjective = normalizeObjective(row && row.marketingObjective);
      const placementType = row && row.placementType;
      const key = JSON.stringify([accountId, marketingObjective, placementType]);
      if (!spotlightGroups.has(key)) {
        spotlightGroups.set(key, {
          accountId,
          accountName,
          marketingObjective,
          placementType,
          noteIds: new Set(),
          totalSpend: 0,
          inTaskSpend: 0,
          outsideTaskSpend: 0,
          unknownTaskSpend: 0,
          impressions: 0,
          clicks: 0,
          interactions: 0,
          seedUsers: 0,
          deepSeedUsers: 0,
          directSpend: 0,
          storeVisits: null,
          orders: null,
          gmv: null,
          platformRois: [],
          directRows: 0,
          observableDirectRows: 0,
          unavailableDirectRows: 0,
          seedingSpend: 0,
          seedingActiveUv: 0,
          seedingRows: 0,
          observableSeedingRows: 0,
          unavailableSeedingRows: 0,
        });
      }
      const group = spotlightGroups.get(key);
      if (row && row.noteId !== null && row.noteId !== undefined && row.noteId !== '') {
        group.noteIds.add(String(row.noteId));
      }
      const spend = finiteNumber(row && row.spend) || 0;
      group.totalSpend += spend;
      const status = normalizeTaskStatus(row && row.taskStatus);
      if (status === 'in_task') group.inTaskSpend += spend;
      else if (status === 'outside_task') group.outsideTaskSpend += spend;
      else group.unknownTaskSpend += spend;
      group.impressions += finiteNumber(row && row.impressions) || 0;
      group.clicks += finiteNumber(row && row.clicks) || 0;
      group.interactions += finiteNumber(row && row.interactions) || 0;
      group.seedUsers += finiteNumber(row && row.seedUsers) || 0;
      group.deepSeedUsers += finiteNumber(row && row.deepSeedUsers) || 0;
      if (marketingObjective === 'product_seeding') {
        const external = safeObject(row && row.seedingExternal15);
        const activeUv = finiteNumber(external.activeUv);
        group.seedingSpend += spend;
        group.seedingRows += 1;
        if (external.observable === true && activeUv !== null && activeUv >= 0) {
          group.observableSeedingRows += 1;
          group.seedingActiveUv += activeUv;
        } else {
          group.unavailableSeedingRows += 1;
        }
      }
      const conversion = safeObject(row && row.conversion);
      if (marketingObjective !== 'direct') continue;
      group.directRows += 1;
      group.directSpend += spend;
      const requiredConversionComplete = [
        conversion.storeVisits, conversion.orders, conversion.gmv,
      ].every((value) => finiteNumber(value) !== null);
      const hasObservableFlag = Object.prototype.hasOwnProperty.call(conversion, 'observable');
      const observable = requiredConversionComplete && (
        hasObservableFlag ? conversion.observable === true : true
      );
      if (observable) {
        group.observableDirectRows += 1;
        group.storeVisits = (group.storeVisits || 0) + (finiteNumber(conversion.storeVisits) || 0);
        group.orders = (group.orders || 0) + (finiteNumber(conversion.orders) || 0);
        group.gmv = (group.gmv || 0) + (finiteNumber(conversion.gmv) || 0);
        const platformRoi = finiteNumber(conversion.platformRoi15);
        if (platformRoi !== null) group.platformRois.push(platformRoi);
      } else {
        group.unavailableDirectRows += 1;
      }
    }
    const juguangRows = [...spotlightGroups.values()].sort((left, right) => (
      right.totalSpend - left.totalSpend
    )).map((group) => {
      const platformRois = [...new Set(group.platformRois.map(String))];
      const conversionObservability = group.directRows === 0 || group.observableDirectRows === 0
        ? '不可用'
        : group.unavailableDirectRows > 0 ? '部分不可用' : '完整';
      const conversionComplete = conversionObservability === '完整';
      const seedingObservability = group.seedingRows === 0 || group.observableSeedingRows === 0
        ? '不可用'
        : group.unavailableSeedingRows > 0 ? '部分不可用' : '完整';
      const seedingComplete = seedingObservability === '完整';
      return {
        广告账户ID: group.accountId,
        广告账户: group.accountName,
        营销诉求: objectiveLabel(group.marketingObjective),
        投放位置: cellText(group.placementType),
        笔记数: group.noteIds.size,
        总消耗: group.totalSpend,
        任务期内消耗: group.inTaskSpend,
        任务期外消耗: group.outsideTaskSpend,
        任务周期未知消耗: group.unknownTaskSpend,
        曝光: group.impressions,
        点击: group.clicks,
        互动: group.interactions,
        新增种草人群: group.seedUsers,
        新增深度种草人群: group.deepSeedUsers,
        '15日站外行为可观测性': seedingObservability,
        '15日站外活跃UV': cellNumber(seedingComplete ? group.seedingActiveUv : null),
        '15日站外行为成本': cellNumber(seedingComplete
          ? ratio(group.seedingSpend, group.seedingActiveUv)
          : null),
        '15日直达消耗': group.directSpend,
        '15日转化可观测性': conversionObservability,
        外链进店数: cellNumber(conversionComplete ? group.storeVisits : null),
        '15日成交订单数': cellNumber(conversionComplete ? group.orders : null),
        '15日成交GMV': cellNumber(conversionComplete ? group.gmv : null),
        '15日计算ROI': cellNumber(conversionComplete ? ratio(group.gmv, group.directSpend) : null),
        平台原始ROI: conversionComplete &&
          group.platformRois.length === group.directRows && platformRois.length === 1
          ? Number(platformRois[0])
          : '—',
      };
    });
    if (!juguangRows.length) {
      safeRows(spotlight.byAccount).forEach((row) => {
        const directSpend = finiteNumber(row && row.directSpend);
        const conversionComplete = directSpend !== null && directSpend > 0 && [
          row && row.storeVisits, row && row.orders, row && row.gmv,
        ].every((value) => finiteNumber(value) !== null);
        juguangRows.push({
          广告账户ID: cellText(row && row.key),
          广告账户: cellText(row && (row.label || row.key)),
          营销诉求: '全部',
          投放位置: '—',
          笔记数: cellNumber(row && row.noteCount),
          总消耗: cellNumber(row && row.spend),
          任务期内消耗: '—',
          任务期外消耗: '—',
          任务周期未知消耗: '—',
          曝光: cellNumber(row && row.impressions),
          点击: cellNumber(row && row.clicks),
          互动: cellNumber(row && row.interactions),
          新增种草人群: cellNumber(row && row.seedUsers),
          新增深度种草人群: cellNumber(row && row.deepSeedUsers),
          '15日站外行为可观测性': '不可用',
          '15日站外活跃UV': '—',
          '15日站外行为成本': '—',
          '15日直达消耗': cellNumber(directSpend),
          '15日转化可观测性': conversionComplete ? '完整' : '不可用',
          外链进店数: cellNumber(conversionComplete ? row && row.storeVisits : null),
          '15日成交订单数': cellNumber(conversionComplete ? row && row.orders : null),
          '15日成交GMV': cellNumber(conversionComplete ? row && row.gmv : null),
          '15日计算ROI': cellNumber(conversionComplete
            ? firstValue(row && row.calculatedRoi15, row && row.roi)
            : null),
          平台原始ROI: cellNumber(conversionComplete ? row && row.platformRoi15 : null),
        });
      });
    }
    appendDataSheet('聚光分析', juguangRows.length ? juguangRows : [{
      广告账户ID: '—', 广告账户: '—', 营销诉求: '—', 投放位置: '—', 笔记数: '—',
      总消耗: '—', 任务期内消耗: '—', 任务期外消耗: '—', 任务周期未知消耗: '—',
      曝光: '—', 点击: '—', 互动: '—', 新增种草人群: '—', 新增深度种草人群: '—',
      '15日站外行为可观测性': '不可用', '15日站外活跃UV': '—', '15日站外行为成本': '—',
      '15日直达消耗': '—', '15日转化可观测性': '不可用', 外链进店数: '—',
      '15日成交订单数': '—', '15日成交GMV': '—', '15日计算ROI': '—', 平台原始ROI: '—',
    }], [24, 24, 16, 16, 12, 14, 16, 16, 20, 14, 14, 14, 18, 22, 22, 18, 18,
      16, 18, 16, 18, 18, 16, 16]);

    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const hasStarStore = hasOwn(star, 'store');
    const rawStarStore = star.store;
    const starStore = safeObject(rawStarStore);
    const hasStarTaskSummary = hasOwn(star, 'taskSummary');
    const rawStarTaskSummary = star.taskSummary;
    const starTaskSummary = safeObject(rawStarTaskSummary);
    const legacyStoreMetrics = Object.keys(safeObject(storeResult.metrics)).length
      ? safeObject(storeResult.metrics)
      : safeObject(starTask.metrics);
    const containerValue = (present, rawContainer, container, key, fallback) => {
      if (!present) return fallback;
      if (!rawContainer || typeof rawContainer !== 'object' || Array.isArray(rawContainer)) return null;
      return hasOwn(container, key) ? container[key] : fallback;
    };
    const nestedValue = (present, rawContainer, container, section, key, fallback) => {
      if (!present) return fallback;
      if (!rawContainer || typeof rawContainer !== 'object' || Array.isArray(rawContainer)) return null;
      if (!hasOwn(container, section)) return fallback;
      const rawSection = container[section];
      const sectionObject = safeObject(rawSection);
      if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) return null;
      return hasOwn(sectionObject, key) ? sectionObject[key] : fallback;
    };
    const storeValue = (key, fallback) => containerValue(
      hasStarStore, rawStarStore, starStore, key, fallback
    );
    const storeNestedValue = (section, key, fallback) => nestedValue(
      hasStarStore, rawStarStore, starStore, section, key, fallback
    );
    const taskValue = (key, fallback) => containerValue(
      hasStarTaskSummary, rawStarTaskSummary, starTaskSummary, key, fallback
    );
    const taskNestedValue = (section, key, fallback) => nestedValue(
      hasStarTaskSummary, rawStarTaskSummary, starTaskSummary, section, key, fallback
    );
    const storeMetric = (key) => storeNestedValue(
      'metrics', key, firstValue(legacyStoreMetrics[key], key === 'gmv' ? storeResult.gmv : null)
    );
    const taskMetric = (key) => taskNestedValue('metrics', key, null);
    const storeMetricIsExplicit = (key) => hasStarStore && rawStarStore &&
      typeof rawStarStore === 'object' && !Array.isArray(rawStarStore) && hasOwn(starStore, 'metrics') &&
      starStore.metrics && typeof starStore.metrics === 'object' && !Array.isArray(starStore.metrics) &&
      hasOwn(starStore.metrics, key);
    const taskMetricIsExplicit = (key) => hasStarTaskSummary && rawStarTaskSummary &&
      typeof rawStarTaskSummary === 'object' && !Array.isArray(rawStarTaskSummary) &&
      hasOwn(starTaskSummary, 'metrics') && starTaskSummary.metrics &&
      typeof starTaskSummary.metrics === 'object' && !Array.isArray(starTaskSummary.metrics) &&
      hasOwn(starTaskSummary.metrics, key);
    const starStoreMetrics = Object.fromEntries([
      'readUv', 'searchImpressionUv', 'engagementUv', 'storeVisitUv',
      'visitRate', 'visitCost', 'gmv', 'seededProductGmv',
    ].map((key) => [key, storeMetric(key)]));
    const starTaskMetrics = Object.fromEntries([
      'readUv', 'searchImpressionUv', 'engagementUv', 'storeVisitUv', 'visitRate', 'visitCost',
    ].map((key) => [key, taskMetric(key)]));
    const taskActiveNoteCount = taskValue('activeNoteCount', management.noteCount);
    const storeCost = storeNestedValue('costs', 'total', starAlignedSpend);
    const storeCreatorCost = storeNestedValue('costs', 'creator', creatorSpend);
    const storeAdCost = storeNestedValue('costs', 'adInTask', taskAdSpend);
    const storeGmv = starStoreMetrics.gmv;
    const taskGmv = taskValue('gmv', firstValue(starTask.gmv, starStoreMetrics.seededProductGmv));
    const storeVisitRate = storeMetricIsExplicit('visitRate')
      ? starStoreMetrics.visitRate
      : firstValue(starStoreMetrics.visitRate, ratio(starStoreMetrics.storeVisitUv, starStoreMetrics.readUv));
    const storeVisitCost = storeMetricIsExplicit('visitCost')
      ? starStoreMetrics.visitCost
      : firstValue(starStoreMetrics.visitCost, ratio(storeCost, starStoreMetrics.storeVisitUv));
    const taskVisitRate = taskMetricIsExplicit('visitRate')
      ? starTaskMetrics.visitRate
      : firstValue(starTaskMetrics.visitRate, ratio(starTaskMetrics.storeVisitUv, starTaskMetrics.readUv));
    const storeRoi = storeValue('storeRoi', firstValue(storeResult.roi, ratio(storeGmv, storeCost)));
    const storeTaskRoi = storeValue('taskRoi', taskValue('roi', starTask.roi));
    const taskRoi = taskValue('roi', storeValue('taskRoi', starTask.roi));
    const taskCost = taskNestedValue('costs', 'total', storeCost);
    const taskCreatorCost = taskNestedValue('costs', 'creator', storeCreatorCost);
    const taskAdCost = taskNestedValue('costs', 'adInTask', storeAdCost);
    appendDataSheet('星河汇总', [{
      汇总层级: '全店汇总',
      任务笔记数: cellNumber(taskActiveNoteCount),
      总花费: cellNumber(storeCost),
      达人花费: cellNumber(storeCreatorCost),
      广告花费: cellNumber(storeAdCost),
      阅读UV: cellNumber(starStoreMetrics.readUv),
      搜索曝光UV: cellNumber(starStoreMetrics.searchImpressionUv),
      互动UV: cellNumber(starStoreMetrics.engagementUv),
      进店UV: cellNumber(starStoreMetrics.storeVisitUv),
      进店率: cellNumber(storeVisitRate),
      进店成本: cellNumber(storeVisitCost),
      GMV: cellNumber(storeGmv),
      全店ROI: cellNumber(storeRoi),
      任务ROI: cellNumber(storeTaskRoi),
    }, {
      汇总层级: '星河任务汇总',
      任务笔记数: cellNumber(taskActiveNoteCount),
      总花费: cellNumber(taskCost),
      达人花费: cellNumber(taskCreatorCost),
      广告花费: cellNumber(taskAdCost),
      阅读UV: cellNumber(starTaskMetrics.readUv),
      搜索曝光UV: cellNumber(starTaskMetrics.searchImpressionUv),
      互动UV: cellNumber(starTaskMetrics.engagementUv),
      进店UV: cellNumber(starTaskMetrics.storeVisitUv),
      进店率: cellNumber(taskVisitRate),
      进店成本: cellNumber(starTaskMetrics.visitCost),
      GMV: cellNumber(taskGmv),
      全店ROI: '—',
      任务ROI: cellNumber(taskRoi),
    }], [18, 16, 14, 14, 14, 14, 16, 14, 14, 14, 14, 14, 14, 14]);

    const topLevelOrders = safeRows(star.orders);
    const attachedOrderIds = new Set();
    const starProjectTaskRows = [];
    const appendStarUnit = (layer, unit, projectId) => {
      const metrics = safeObject(unit && unit.metrics);
      const unitCosts = safeObject(unit && unit.costs);
      const order = layer === '任务' ? unit : null;
      const orderIdentityVerified = !order || order.businessIdentityVerified !== false;
      const businessOrderId = order && orderIdentityVerified ? order.id : null;
      const reportOrderId = order && !orderIdentityVerified ? order.reportOrderId : null;
      starProjectTaskRows.push({
        层级: layer,
        项目ID: cellText(layer === '项目' ? unit && unit.id : projectId),
        任务ID: order ? cellText(businessOrderId) : '—',
        报表任务标识: order ? cellText(reportOrderId) : '—',
        业务任务身份: order ? (orderIdentityVerified ? '已验证' : '未验证') : '—',
        名称: cellText(unit && (unit.name || unit.title)),
        状态: cellText(unit && (unit.orderStatus || unit.status)),
        开始日期: cellText(unit && unit.startDate),
        结束日期: cellText(unit && unit.endDate),
        投放模式: cellText(unit && unit.deliveryMode),
        总花费: cellNumber(unitCosts.total),
        达人花费: cellNumber(unitCosts.creator),
        任务期内广告花费: cellNumber(unitCosts.adInTask),
        阅读UV: cellNumber(metrics.readUv),
        搜索曝光UV: cellNumber(metrics.searchImpressionUv),
        互动UV: cellNumber(metrics.engagementUv),
        进店UV: cellNumber(metrics.storeVisitUv),
        进店率: cellNumber(firstValue(metrics.visitRate, ratio(metrics.storeVisitUv, metrics.readUv))),
        收藏UV: cellNumber(metrics.favoriteUv),
        加购UV: cellNumber(metrics.cartUv),
        成交UV: cellNumber(metrics.orderUv),
        GMV: cellNumber(metrics.gmv),
        任务商品GMV: cellNumber(metrics.seededProductGmv),
        连带GMV: cellNumber(metrics.linkedProductGmv),
      });
    };
    safeRows(star.projects).forEach((project) => {
      appendStarUnit('项目', project, project && project.id);
      const nestedOrders = safeRows(project && project.orders);
      const projectOrders = nestedOrders.length
        ? nestedOrders
        : topLevelOrders.filter((order) => String(order && order.projectId || '') === String(project && project.id || ''));
      projectOrders.forEach((order) => {
        if (order && order.id !== null && order.id !== undefined) attachedOrderIds.add(String(order.id));
        appendStarUnit('任务', order, project && project.id);
      });
    });
    topLevelOrders.forEach((order) => {
      if (order && attachedOrderIds.has(String(order.id))) return;
      appendStarUnit('任务', order, order && order.projectId);
    });
    appendDataSheet('星河项目任务', starProjectTaskRows.length ? starProjectTaskRows : [{
      层级: '—', 项目ID: '—', 任务ID: '—', 报表任务标识: '—', 业务任务身份: '—',
      名称: '—', 状态: '—', 开始日期: '—', 结束日期: '—', 投放模式: '—',
      总花费: '—', 达人花费: '—', 任务期内广告花费: '—',
      阅读UV: '—', 搜索曝光UV: '—', 互动UV: '—',
      进店UV: '—', 进店率: '—', 收藏UV: '—', 加购UV: '—', 成交UV: '—', GMV: '—',
      任务商品GMV: '—', 连带GMV: '—',
    }], [12, 28, 28, 28, 16, 32, 14, 14, 14, 16, 14, 14, 18, 14, 16, 14, 14, 14, 14, 14, 14, 14, 18, 14]);

    const joinedNoteRows = safeRows(analysis.notes).map((note) => {
      const noteCosts = safeObject(note && note.costs);
      const notePgy = safeObject(note && note.pgy);
      const pgyMetrics = safeObject(notePgy.metrics);
      const noteJuguang = safeObject(note && note.juguang);
      const starMetrics = safeObject(note && note.star && note.star.metrics);
      const noteResults = safeObject(note && note.results);
      const pgyCostCoverageComplete = !hasOwn(notePgy, 'coverage') || notePgy.coverage === 'complete';
      const juguangCostCoverageComplete = !hasOwn(noteJuguang, 'coverage') ||
        noteJuguang.coverage === 'complete';
      const juguangAlignmentComplete = juguangCostCoverageComplete && (
        !hasOwn(noteJuguang, 'alignmentCoverage') || noteJuguang.alignmentCoverage === 'complete'
      );
      const publishDate = String(note && note.publishDate || '');
      const canInferPeriod = Boolean(note && note.pgy) && /^\d{4}-\d{2}-\d{2}$/.test(publishDate) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(dateRange.from || '')) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(dateRange.to || ''));
      const included = Object.prototype.hasOwnProperty.call(notePgy, 'includedInPeriod')
        ? notePgy.includedInPeriod
        : canInferPeriod ? publishDate >= dateRange.from && publishDate <= dateRange.to : null;
      const periodCreatorFallback = included === true
        ? sumIfKnown(noteCosts.cooperation, noteCosts.platformFee)
        : included === false ? 0 : null;
      const periodCreator = pgyCostCoverageComplete
        ? hasOwn(noteCosts, 'periodCreator')
          ? finiteNumber(noteCosts.periodCreator)
          : finiteNumber(periodCreatorFallback)
        : null;
      const creatorTotalFallback = sumIfKnown(noteCosts.cooperation, noteCosts.platformFee);
      const creatorTotal = pgyCostCoverageComplete
        ? hasOwn(noteCosts, 'creatorTotal')
          ? finiteNumber(noteCosts.creatorTotal)
          : finiteNumber(creatorTotalFallback) !== null
            ? finiteNumber(creatorTotalFallback)
            : included === true ? periodCreator : null
        : null;
      const totalJuguangBucket = safeObject(noteJuguang.total);
      const allJuguang = juguangCostCoverageComplete
        ? hasOwn(totalJuguangBucket, 'spend')
          ? finiteNumber(totalJuguangBucket.spend)
          : finiteNumber(noteCosts.juguang)
        : null;
      const inTaskBucket = safeObject(noteJuguang.inTask);
      const inTaskJuguang = juguangAlignmentComplete && hasOwn(inTaskBucket, 'spend')
        ? finiteNumber(inTaskBucket.spend)
        : null;
      const outsideTaskBucket = safeObject(noteJuguang.outsideTask);
      const outsideStatusBuckets = safeRows(noteJuguang.taskStatuses).filter((bucket) => (
        normalizeTaskStatus(bucket && (bucket.key || bucket.taskStatus)) === 'outside_task'
      ));
      let outsideTaskJuguang = juguangAlignmentComplete && hasOwn(outsideTaskBucket, 'spend')
        ? finiteNumber(outsideTaskBucket.spend)
        : null;
      if (juguangAlignmentComplete && !hasOwn(outsideTaskBucket, 'spend') &&
        outsideStatusBuckets.length) {
        const outsideValues = outsideStatusBuckets.map((bucket) => finiteNumber(bucket && bucket.spend));
        outsideTaskJuguang = outsideValues.every((value) => value !== null)
          ? outsideValues.reduce((sum, value) => sum + value, 0)
          : null;
      }
      const approvedTotal = sumIfKnown(creatorTotal, allJuguang);
      const approvedPeriodTotal = sumIfKnown(periodCreator, inTaskJuguang);
      const approvedVisitCost = ratio(approvedPeriodTotal, starMetrics.storeVisitUv);
      return {
        笔记ID: cellText(note && note.noteId),
        标题: cellText(note && note.title),
        达人: cellText(note && note.author && note.author.name),
        达人粉丝数: cellNumber(firstValue(
          note && note.author && note.author.followerCount,
          notePgy.followerCount
        )),
        发布时间: cellText(note && note.publishDate),
        SPU名称: cellText(notePgy.spuName),
        蒲公英计入本期: included === true ? '是' : included === false ? '否（期外）' : '—',
        成熟度: cellText(note && note.maturity),
        任务区间: cellText(safeRows(note && note.task && note.task.intervals).map((item) => (
          String(item.start || '—') + ' 至 ' + String(item.end || '—')
        )).join('；')),
        星河项目ID: cellText(safeRows(note && note.task && note.task.projectIds).join('；')),
        星河任务ID: cellText(safeRows(note && note.task && note.task.orderIds).join('；')),
        合作实付: cellNumber(pgyCostCoverageComplete ? noteCosts.cooperation : null),
        平台服务费: cellNumber(pgyCostCoverageComplete ? noteCosts.platformFee : null),
        达人花费: cellNumber(creatorTotal),
        本期达人花费: cellNumber(periodCreator),
        广告花费: cellNumber(allJuguang),
        任务期内广告花费: cellNumber(inTaskJuguang),
        任务外直达广告花费: cellNumber(
          juguangAlignmentComplete ? noteCosts.outsideDirect : null
        ),
        总花费: cellNumber(approvedTotal),
        任务期内花费: cellNumber(approvedPeriodTotal),
        任务期外花费: cellNumber(outsideTaskJuguang),
        进店成本: cellNumber(approvedVisitCost),
        蒲公英曝光量: cellNumber(pgyMetrics.impressions),
        蒲公英阅读量: cellNumber(pgyMetrics.reads),
        蒲公英互动量: cellNumber(pgyMetrics.interactions),
        蒲公英阅读率: cellNumber(firstValue(
          pgyMetrics.readRate,
          ratio(pgyMetrics.reads, pgyMetrics.impressions)
        )),
        蒲公英互动率: cellNumber(firstValue(
          pgyMetrics.engagementRate,
          ratio(pgyMetrics.interactions, pgyMetrics.reads)
        )),
        星河阅读UV: cellNumber(starMetrics.readUv),
        星河搜索曝光UV: cellNumber(starMetrics.searchImpressionUv),
        星河进店UV: cellNumber(starMetrics.storeVisitUv),
        星河GMV: cellNumber(firstValue(starMetrics.gmv, noteResults.starGmv)),
        星河任务GMV: cellNumber(noteResults.starTaskGmv),
        任务ROI: cellNumber(noteResults.starTaskRoi),
        任务外直达GMV: cellNumber(noteResults.outsideDirectGmv),
        任务外直达ROI: cellNumber(noteResults.outsideDirectRoi),
      };
    });
    appendDataSheet('笔记全链路', joinedNoteRows.length ? joinedNoteRows : [{
      笔记ID: '—', 标题: '—', 达人: '—', 达人粉丝数: '—', 发布时间: '—', 蒲公英计入本期: '—',
      成熟度: '—', 任务区间: '—', 星河项目ID: '—', 星河任务ID: '—', 合作实付: '—',
      平台服务费: '—', 本期达人花费: '—', 广告花费: '—', 任务期内广告花费: '—',
      任务外直达广告花费: '—', 总花费: '—', 任务期内花费: '—', 任务期外花费: '—',
      进店成本: '—', 蒲公英曝光量: '—', 蒲公英阅读量: '—',
      蒲公英互动量: '—', 蒲公英阅读率: '—', 蒲公英互动率: '—', 星河阅读UV: '—',
      星河搜索曝光UV: '—', 星河进店UV: '—', 星河GMV: '—', 星河任务GMV: '—', 任务ROI: '—',
      任务外直达GMV: '—', 任务外直达ROI: '—',
    }], [24, 34, 18, 16, 14, 18, 12, 30, 28, 28, 14, 14, 16, 14, 18, 22, 14, 16,
      16, 16, 16, 16, 16, 16, 14, 18, 16, 14, 14, 14, 18, 18, 18]);

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
