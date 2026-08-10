(function () {
  'use strict';

  if (window.self !== window.top && new URLSearchParams(location.search).get('embed') === '1') {
    document.documentElement.classList.add('embedded-view');
  }

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const STATUS_KEY = 'taobaoContentDiagnosisReportStatusV1';
  const REPORT_KEY = 'taobaoContentDiagnosisReportV1';
  const WXT_KEY = 'taobaoContentDiagnosisWxtReportV1';
  const STORAGE_KEYS = [STATUS_KEY, REPORT_KEY, WXT_KEY];
  const STEPS = [
    { key: 'sycm', name: '生意参谋流量诊断' },
    { key: 'guanghe', name: '光合渠道与资产诊断' },
    { key: 'wxtMarketing', name: '万相台营销场景报告' },
    { key: 'wxtShortVideo', name: '万相台短视频诊断' },
    { key: 'dmp', name: '内容人群画像诊断' },
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

  let bridgeConnected = false;
  let bridgeVersion = '';
  let bridgeCapabilities = new Set();
  let requestSequence = 0;
  let scheduledLoad = null;
  let transientNotice = '';
  let reportStatus = {};
  let reportData = null;
  let wxtReport = null;
  let activeSection = 'flow';
  let guangheView = 'channel';
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

  function reportGenerationSupported() {
    return bridgeCapabilities.has('contentDiagnosisReport');
  }

  function updateConnection(connected, version, message, capabilities) {
    bridgeConnected = Boolean(connected);
    if (version) bridgeVersion = String(version);
    if (Array.isArray(capabilities)) bridgeCapabilities = new Set(capabilities.map(String));
    const outdated = bridgeConnected && !reportGenerationSupported();
    const state = document.getElementById('connectionState');
    state.className = 'connection-state ' + (bridgeConnected && !outdated ? 'connected' : 'disconnected');
    state.textContent = outdated
      ? '数据助手需重载'
      : (bridgeConnected ? '数据助手已连接' : (message || '数据助手未连接'));
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
      scheduleLoad();
      return;
    }
    if (message.type === 'storageChanged') {
      updateConnection(true, message.version || '', '', message.capabilities);
      if ((message.keys || []).some((key) => STORAGE_KEYS.includes(key))) scheduleLoad();
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
      const stored = await requestBridge('getStorage', { keys: STORAGE_KEYS }, 30000);
      reportStatus = stored && stored[STATUS_KEY] || {};
      reportData = stored && stored[REPORT_KEY] || null;
      wxtReport = stored && stored[WXT_KEY] || null;
      if (reportStatus.running || reportStatus.finishedAt || reportStatus.error) transientNotice = '';
      render();
    } catch (error) {
      updateConnection(false, '', error.message);
      document.getElementById('reportNotice').textContent = error.message;
    }
  }

  function reportIsRunning() {
    if (!reportStatus || reportStatus.running !== true) return false;
    const updatedAt = Number(reportStatus.updatedAt || reportStatus.startedAt);
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 25 * 60 * 1000;
  }

  function updateButtons() {
    const running = reportIsRunning();
    const hasData = Boolean(reportData) || sectionHasData('flow') || sectionHasData('guanghe') ||
      sectionHasData('wxt') || sectionHasData('shortVideo') || sectionHasData('dmp');
    const generate = document.getElementById('generateReportBtn');
    if (generate) {
      generate.disabled = !bridgeConnected || !reportGenerationSupported() || running;
      generate.textContent = running ? '正在生成…' : '一键生成报告';
    }
    const refresh = document.getElementById('refreshReportBtn');
    const exportButton = document.getElementById('exportReportBtn');
    const clear = document.getElementById('clearReportBtn');
    if (refresh) refresh.disabled = !bridgeConnected;
    if (exportButton) exportButton.disabled = !hasData;
    if (clear) clear.disabled = !bridgeConnected || (!reportData && !wxtReport && !Object.keys(reportStatus || {}).length);
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
      : '四个平台并行生成，万相台两章按依赖顺序执行';
  }

  function sectionResultKey(section) {
    if (section === 'flow') return 'sycm';
    if (section === 'guanghe') return 'guanghe';
    if (section === 'wxt') return 'wxtMarketing';
    if (section === 'shortVideo') return 'wxtShortVideo';
    return 'dmp';
  }

  function validWxtSnapshot() {
    return Boolean(wxtReport && reportData && wxtReport.runId === reportData.runId);
  }

  function sectionHasData(section) {
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
    if (bridgeConnected && !reportGenerationSupported()) {
      notice.textContent = '当前扩展版本不支持报告任务，请在 Chrome 扩展管理页重载“淘宝内容诊断插件”，再刷新本页。';
      return;
    }
    if (transientNotice) {
      notice.textContent = transientNotice;
      return;
    }
    if (reportIsRunning()) {
      notice.textContent = '生意参谋、光合、万相台和达摩盘正在后台并行读取，当前网页不会被平台标签页打断。';
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

  function buildGuangheRows(view, includeAllChildren) {
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
      const isExpanded = includeAllChildren || expanded[view].has(parent.key);
      const button = includeAllChildren || !children.length ? '' : '<button class="dimension-button" type="button" data-expand-view="' +
        view + '" data-expand-key="' + escapeHtml(parent.key) + '" aria-label="展开明细">' + (isExpanded ? '−' : '+') + '</button>';
      let markup = '<tr class="guanghe-parent"><td class="guanghe-dimension">' + button +
        '<strong>' + escapeHtml(parent.label) + '</strong></td>' +
        guangheCells(
          parent.row,
          findGuangheRow('全部', 'all') || parent.row,
          assetView,
          parent.key === (assetView ? 'all' : '全部') ? [] : parentPeers
        ) + '</tr>';
      if (isExpanded) {
        markup += children.map((child) => '<tr class="dimension-child"><td class="guanghe-dimension">' +
          escapeHtml(child.label) + '</td>' +
          guangheCells(child.row, parent.row, assetView, childPeers) + '</tr>').join('');
      }
      return markup;
    }).join('');
  }

  function buildGuangheMarkup(view, includeAllChildren) {
    if (!reportData || !reportData.guanghe) return '';
    const assetView = view === 'asset';
    return '<div class="report-table-block"><table class="guanghe-table ' + (assetView ? 'asset-view' : '') + '">' +
      guangheHeader(assetView) + '<tbody>' + buildGuangheRows(view, includeAllChildren) + '</tbody></table></div>';
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
    const hasReportState = Boolean(reportData || Object.keys(reportStatus || {}).length);
    document.getElementById('emptyReport').hidden = hasReportState;
    document.getElementById('generatedAt').textContent = reportData && reportData.finishedAt
      ? '生成于 ' + formatDateTime(reportData.finishedAt)
      : (reportIsRunning() ? '正在生成' : '尚未生成');
    renderFlow();
    renderGuanghe();
    renderEmbeddedReports();
    renderDmp();
    showActiveSection(hasReportState);
    updateButtons();
  }

  function exportReport() {
    const embeddedBody = (markup) => {
      const template = document.createElement('template');
      template.innerHTML = String(markup || '');
      const duplicateHeader = template.content.querySelector('.wxt-report-head');
      if (duplicateHeader) duplicateHeader.remove();
      return template.innerHTML;
    };
    const missingChapter = (section) => '<div class="export-missing"><strong>本章节未生成</strong><p>' +
      escapeHtml(sectionError(section) || '本次任务未选择该平台，或平台未返回可用数据。') + '</p></div>';
    const chapter = (index, title, subtitle, content) => '<section class="export-chapter">' +
      '<header class="export-chapter-head"><span>' + String(index).padStart(2, '0') + ' / 05</span><h1>' + title +
      '</h1><p>' + subtitle + '</p></header><div class="export-chapter-body">' + content + '</div></section>';
    const flow = chapter(1, '生意参谋流量诊断', '最近30个完整自然日 · 内容指标来自光合资产总览',
      sectionHasData('flow') ? buildFlowMarkup() : missingChapter('flow'));
    const guanghe = chapter(2, '光合渠道诊断', '渠道视角与资产视角', sectionHasData('guanghe')
      ? '<h2>渠道视角</h2>' + buildGuangheMarkup('channel', true) + '<h2>资产视角</h2>' + buildGuangheMarkup('asset', true)
      : missingChapter('guanghe'));
    const marketing = chapter(3, '万相台营销报告', '营销场景、花费结构与投放效果', sectionHasData('wxt')
      ? embeddedBody(normalizeWxtMarketingMarkup(wxtReport.marketing.markup)) : missingChapter('wxt'));
    const shortVideo = chapter(4, '短视频诊断', '免费内容与付费投放综合诊断', sectionHasData('shortVideo')
      ? embeddedBody(normalizeWxtShortVideoMarkup(wxtReport.shortVideo.markup)) : missingChapter('shortVideo'));
    const dmp = chapter(5, '内容人群画像诊断', '达摩盘 · 年龄与消费能力等级', sectionHasData('dmp')
      ? buildDmpMarkup() : missingChapter('dmp'));
    const css = 'body{margin:0;background:#eef1f5;color:#182230;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;letter-spacing:0}' +
      '.export-cover{max-width:1120px;margin:24px auto 0;padding:28px;background:#fff;border-top:4px solid #0b67d1}.export-cover span{color:#0b67d1;font-size:12px;font-weight:750}.export-cover h1{margin:8px 0 5px;font-size:30px}.export-cover p{margin:0;color:#667085}' +
      '.export-chapter{max-width:1120px;margin:18px auto 28px;background:#f4f6f8}.export-chapter-head{padding:22px 24px;background:#243b72;color:#fff}.export-chapter-head span{color:#9ec5ff;font-size:11px;font-weight:750}.export-chapter-head h1{margin:5px 0 4px;font-size:24px}.export-chapter-head p{margin:0;color:#dbe7ff;font-size:12px}.export-chapter-body{padding:18px 0}.export-chapter-body>h2{margin:18px 18px 10px;font-size:17px}.export-missing{display:grid;min-height:260px;place-content:center;padding:24px;text-align:center}.export-missing strong{font-size:18px}.export-missing p{max-width:580px;margin:6px 0 0;color:#667085}' +
      '.diagnosis-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0 18px;border:1px solid #dfe4ea;background:#fff}' +
      '.diagnosis-kpis>div{padding:14px;border-right:1px solid #dfe4ea}.diagnosis-kpis span{display:block;color:#667085;font-size:11px}.diagnosis-kpis strong{display:block;margin-top:5px;font-size:20px}' +
      '.report-table-block{margin-top:18px;overflow:auto;border:1px solid #dfe4ea;background:#fff}.report-table-block table{width:100%;min-width:820px;border-collapse:collapse}' +
      '.report-table-block th,.report-table-block td{padding:9px 10px;border-bottom:1px solid #edf0f3;text-align:left;white-space:nowrap}.report-table-block th{background:#eef2f6}' +
      '.dimension-button{display:none}.dimension-child td:first-child{padding-left:30px}.metric-result.good{color:#067647}.metric-result.watch{color:#a34b00}' +
      GUANGHE_EXPORT_STYLES +
      dmpExportStyles() +
      String(wxtReport && wxtReport.styles || '') +
      WXT_KPI_LAYOUT_OVERRIDES +
      WXT_CHART_LAYOUT_OVERRIDES +
      WXT_TABLE_LAYOUT_OVERRIDES +
      '.wxt-report{max-width:1084px!important;margin:0 auto!important}.wxt-report-head{display:none!important}' +
      '@media print{.export-cover,.export-chapter{break-after:page}.export-chapter:last-child{break-after:auto}}' +
      '@media(max-width:720px){.diagnosis-kpis{grid-template-columns:1fr}.export-cover,.export-chapter{margin:0}.export-chapter-body{padding:10px 0}}';
    const script = '<script>document.addEventListener("change",function(e){var s=e.target.closest&&e.target.closest("[data-attribution-select]");if(!s)return;document.querySelectorAll("[data-attribution-report]").forEach(function(n){n.hidden=n.getAttribute("data-attribution-report")!==s.value;});});<\/script>';
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>淘宝内容诊断报告</title><style>' + css + '</style></head><body><header class="export-cover"><span>TAOBAO CONTENT DIAGNOSIS</span><h1>淘宝内容诊断报告</h1><p>流量、光合、万相台、短视频与内容人群画像 · 五章节合并导出</p></header>' +
      flow + guanghe + marketing + shortVideo + dmp + script + '</body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '淘宝内容诊断报告_' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  document.getElementById('generateReportBtn').addEventListener('click', async () => {
    if (!bridgeConnected || !reportGenerationSupported() || reportIsRunning()) return;
    const previousStatus = reportStatus;
    const now = Date.now();
    transientNotice = '任务已提交，正在并行启动生意参谋、光合、万相台和达摩盘…';
    reportStatus = {
      running: true,
      startedAt: now,
      updatedAt: now,
      total: STEPS.length,
      stepIndex: 0,
      currentStep: '跨平台并行启动',
      activeSteps: ['生意参谋流量诊断', '光合渠道与资产诊断', '万相台营销场景报告', '内容人群画像诊断'],
      results: [],
    };
    render();
    try {
      const response = await requestBridge('startContentDiagnosisReport', {}, 15000);
      if (!response || response.ok === false) {
        throw new Error(response && response.message ? response.message : '报告任务未成功启动。');
      }
      transientNotice = response.started === false
        ? '报告任务已在后台运行，正在恢复进度…'
        : '报告任务已启动，四个平台正在并行读取…';
      window.setTimeout(loadReport, 350);
    } catch (error) {
      reportStatus = previousStatus;
      transientNotice = '启动失败：' + error.message;
      render();
    }
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

  render();
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
})();
