// 经营攻防一键取数弹窗：汇总插件已采集快照并导出完整指标表。
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
  ]);

  let currentRows = [];
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

  function sendRuntimeMessage(message) {
    if (!IS_EXTENSION_PAGE) {
      return requestWebBridge('startAutoCollect', { message }, 20 * 60 * 1000);
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, message: error.message || '扩展后台未响应。' });
          return;
        }
        resolve(response || { ok: false, message: '扩展后台未返回结果。' });
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
        const value = normalizeManualInput(key, manual[key]);
        if (value) put(values, key, value, '手填项');
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

    put(values, 'xhs_totalSpend', add(values.xhs_kolSpend && values.xhs_kolSpend.value, values.xhs_juguangSpend && values.xhs_juguangSpend.value), '公式计算');
    if (values.xhs_kolSpend && values.xhs_juguangSpend) {
      values.xhs_kfsRatio = { value: values.xhs_kolSpend.value + ':' + values.xhs_juguangSpend.value, source: '公式计算', updatedAt: '', raw: '' };
    }
    put(values, 'xhs_visitFrequency', divide(values.xhs_xingheVisitors && values.xhs_xingheVisitors.value, values.xhs_dmpVisitors && values.xhs_dmpVisitors.value), '公式计算');
    put(values, 'xhs_visitCost', divide(values.xhs_totalSpend && values.xhs_totalSpend.value, values.xhs_xingheVisitors && values.xhs_xingheVisitors.value), '公式计算');
    put(values, 'xhs_storeRoi', divide(values.xhs_storeGmv && values.xhs_storeGmv.value, values.xhs_totalSpend && values.xhs_totalSpend.value), '公式计算');
    put(values, 'xhs_taskRoi', divide(values.xhs_taskGmv && values.xhs_taskGmv.value, values.xhs_totalSpend && values.xhs_totalSpend.value), '公式计算');
    put(values, 'xhs_contentAudienceShare', divide(values.xhs_contentAudienceAsset && values.xhs_contentAudienceAsset.value, values.xhs_storeAudienceAsset && values.xhs_storeAudienceAsset.value), '公式计算');
    put(values, 'xhs_l45OverL12', divide(values.xhs_l45Penetration && values.xhs_l45Penetration.value, values.xhs_l12Penetration && values.xhs_l12Penetration.value), '公式计算');
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
    if (item) return { text: isManualMetric(metric) ? '已填写' : '已取到', cls: 'ok' };
    if (isManualMetric(metric)) return { text: '待填写', cls: 'pending' };
    if (metric.collect === 'formula') return { text: '待计算', cls: 'pending' };
    return { text: '待采集', cls: 'missing' };
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
        sourceText: metric.formula || metric.source || metric.note || '',
        updatedAt: item && item.updatedAt || '',
      });
    });
  }

  async function loadRows() {
    try {
      const data = await getStorage(STORAGE_KEYS);
      updateConnectionState(true, webBridgeVersion);
      manualInputs = data.businessDefenseManualInputsV1 || {};
      autoCollectStatus = data.businessDefenseAutoCollectStatusV1 || {};
      if (autoCollectStatus.running || autoCollectStatus.finishedAt || autoCollectStatus.error) {
        transientNotice = '';
      }
      const values = {};
      collectDmp(values, data.dmpPortraitSnapshotV1);
      collectSycm(values, data.businessDefenseSycmTrafficSnapshotV1);
      collectGuanghe(values, data.gh_channel_snapshot);
      collectWxt(values, data.wxtBusinessDefenseReportV1);
      collectManual(values, data.businessDefenseManualInputsV1);
      computeFormulas(values);
      currentRows = buildRows(values);
      const lastSync = document.getElementById('lastSync');
      if (lastSync) lastSync.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      render(currentRows);
    } catch (error) {
      updateConnectionState(false, '', '数据助手未连接');
      manualInputs = {};
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
    const button = document.getElementById('autoCollectBtn');
    const clearButton = document.getElementById('clearBtn');
    const hint = document.getElementById('hint');
    renderPlatformProgress(autoCollectStatus);
    if (!webBridgeConnected) {
      button.disabled = true;
      clearButton.disabled = true;
      button.textContent = '数据助手未连接';
      hint.textContent = transientNotice || '请在 Chrome 扩展页重载“淘宝内容诊断插件”，然后刷新本页。';
      return;
    }
    if (!parallelWebToolSupported()) {
      button.disabled = true;
      clearButton.disabled = false;
      button.textContent = '需要重载扩展';
      hint.textContent = '当前扩展仍是旧版，请在 Chrome 扩展管理页重载“淘宝内容诊断插件”，再刷新本页。';
      return;
    }
    if (autoCollectIsActive(autoCollectStatus)) {
      const index = Array.isArray(autoCollectStatus.results) ? autoCollectStatus.results.length : 0;
      const total = Number(autoCollectStatus.total) || 4;
      const active = Array.isArray(autoCollectStatus.activeSteps)
        ? autoCollectStatus.activeSteps
        : (autoCollectStatus.currentStep ? [autoCollectStatus.currentStep] : []);
      button.disabled = true;
      clearButton.disabled = true;
      button.textContent = '正在取数 ' + index + '/' + total;
      hint.textContent = '正在并行读取：' + (active.join('、') || '准备平台任务') + '。请保持各平台账号已登录。';
      return;
    }
    button.disabled = false;
    clearButton.disabled = false;
    button.textContent = autoCollectStatus.running ? '重新取数' : '一键取数';
    if (transientNotice) {
      hint.textContent = transientNotice;
      return;
    }
    if (autoCollectStatus.running) {
      hint.textContent = '上次取数已中断，可点击“重新取数”再次执行。';
      return;
    }
    if (autoCollectStatus.error) {
      hint.textContent = '自动取数失败：' + autoCollectStatus.error;
      return;
    }
    const statusResults = Array.isArray(autoCollectStatus.results) ? autoCollectStatus.results : [];
    if (autoCollectStatus.finishedAt && statusResults.length) {
      hint.textContent = '上次自动取数：' + statusResults.map((item) => (
        (item.skipped ? '跳过 ' : (!item.ok ? '失败 ' : (item.partial ? '部分完成 ' : '成功 '))) +
          item.name + (item.message ? '（' + item.message + '）' : '')
      )).join('；');
      return;
    }
    hint.textContent = '点击“一键取数”后，数据助手会在后台并行读取光合、生意参谋、万相台和DMP。';
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
        const manualRows = xiaohongshuRows.filter(isManualMetric);
        xiaohongshuCount.textContent = xiaohongshuRows.length + ' 项 · 已填写 ' +
          manualRows.filter(row => row.item).length + ' / ' + manualRows.length + ' 项';
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

  function valueCell(row) {
    if (isManualMetric(row)) {
      const saved = manualInputs[row.key] == null ? '' : manualInputs[row.key];
      const percentage = PERCENT_MANUAL_KEYS.has(row.key);
      return '<input class="manual-input" data-key="' + escapeHtml(row.key) + '" value="' + escapeHtml(saved) +
        '" inputmode="decimal" aria-label="手动填写' + escapeHtml(row.name) + '" placeholder="' +
        (percentage ? '例如 30%' : '输入数值') + '"' + (archiveManualInputsSupported()
          ? ''
          : ' disabled title="请重载数据助手后再填写"') + '>';
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
        if (value) next[key] = value;
        else delete next[key];
        if (String(manualInputs[key] == null ? '' : manualInputs[key]) === value) return;
        const previous = manualInputs;
        manualInputs = next;
        input.disabled = true;
        const operation = manualSaveQueue.catch(() => {}).then(async () => {
          await setStorage(
            { businessDefenseManualInputsV1: next },
            { key, value }
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
      更新时间: row.updatedAt || '',
      备注: row.note || '',
    }));
    const workbook = XLSX.utils.book_new();
    const appendSheet = (platform, sheetName) => {
      const sheet = XLSX.utils.json_to_sheet(exportRows(platform));
      sheet['!cols'] = [
        { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 10 },
        { wch: 52 }, { wch: 22 }, { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    };
    appendSheet('淘天', '淘宝经营数据');
    appendSheet('小红书', '小红书手填数据');
    XLSX.writeFile(workbook, '经营攻防内容诊断取数_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  async function autoCollect() {
    const previousStatus = autoCollectStatus;
    const now = Date.now();
    let shouldReload = false;
    let backgroundRunning = false;
    transientNotice = '';
    autoCollectStatus = {
      running: true,
      startedAt: now,
      updatedAt: now,
      total: 4,
      stepIndex: 0,
      currentStep: '跨平台并行启动',
      activeSteps: ['光合内容指标', '生意参谋流量指标', '万相台内容投放', 'DMP人群资产画像'],
      results: [],
    };
    render(currentRows);
    try {
      const response = await sendRuntimeMessage({ type: 'BUSINESS_DEFENSE_AUTO_COLLECT' });
      if (response.ok) {
        shouldReload = true;
        if (response.running) {
          backgroundRunning = true;
          transientNotice = response.started === false
            ? '取数任务已在后台运行，正在恢复并行进度。'
            : '四个平台已并行启动，数据会按完成顺序更新。';
        } else {
          const summary = (response.results || []).map((item) => (
            item.skipped
              ? '跳过 ' + item.name
              : (!item.ok
                ? '失败 ' + item.name + '：' + (item.message || '失败')
                : (item.partial
                  ? '部分完成 ' + item.name + (item.message ? '：' + item.message : '')
                  : '成功 ' + item.name + (item.message ? '：' + item.message : '')))
          )).join('；');
          transientNotice = '自动取数完成：' + (summary || '未返回明细');
        }
      } else {
        autoCollectStatus = previousStatus;
        transientNotice = '自动取数失败：' + (response.message || '未知错误');
      }
    } catch (error) {
      autoCollectStatus = previousStatus;
      transientNotice = '自动取数异常：' + (error && error.message ? error.message : String(error));
    } finally {
      if (shouldReload) {
        if (backgroundRunning) {
          render(currentRows);
          window.setTimeout(loadRows, 350);
        } else {
          await loadRows();
        }
      } else {
        render(currentRows);
      }
    }
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
      autoCollectStatus = {};
      transientNotice = '已清空本地汇总数据。可重新点击“自动取数”生成一份全新快照。';
      await loadRows();
    } catch (error) {
      transientNotice = '清空失败：' + (error && error.message ? error.message : String(error));
      render(currentRows);
    } finally {
      button.disabled = false;
      button.textContent = '清空数据';
    }
  }

  document.getElementById('autoCollectBtn').addEventListener('click', autoCollect);
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
