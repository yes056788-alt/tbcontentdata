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
    { key: 'xiaohongshu', name: '小红书三平台全链路' },
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
    { key: 'adstar', name: '淘宝星河' },
    { key: 'pgy', name: '蒲公英' },
    { key: 'juguang', name: '聚光' },
  ];

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
        xhsAnalysis = stored && stored[XHS_ANALYSIS_KEY] || null;
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
    xhsAnalysis = snapshots[XHS_ANALYSIS_KEY] || null;
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
      sectionHasData('xiaohongshu');
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
      : '四个平台并行生成，万相台两章按依赖顺序执行';
  }

  function sectionResultKey(section) {
    if (section === 'flow') return 'sycm';
    if (section === 'guanghe') return 'guanghe';
    if (section === 'wxt') return 'wxtMarketing';
    if (section === 'shortVideo') return 'wxtShortVideo';
    if (section === 'xiaohongshu') return 'xiaohongshu';
    return 'dmp';
  }

  function validWxtSnapshot() {
    return Boolean(wxtReport && reportData && wxtReport.runId === reportData.runId);
  }

  function sectionHasData(section) {
    if (section === 'xiaohongshu') return Boolean(xhsAnalysis);
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
    if (section === 'xiaohongshu') {
      const result = resultByKey('xiaohongshu');
      if (!xhsAnalysis && result && result.ok === false) {
        const bindingIssues = safeXhsBindingIssues(result.bindingIssues);
        if (bindingIssues.length) {
          return bindingIssues.map((issue) => (
            issue.platformName + ' / ' + issue.code + '：' + issue.message
          )).join('；');
        }
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

  function safeXhsBindingIssues(value) {
    const platformNames = new Map(XHS_PLATFORMS.map((platform) => [platform.key, platform.name]));
    const messages = {
      account_binding_mismatch: (platformName) =>
        '当前' + platformName + '登录账号与所选店铺绑定不一致。',
      account_identity_bound_to_other_store: (platformName) =>
        '当前' + platformName + '登录账号已绑定到另一店铺，禁止重新归属。',
      account_identity_missing: (platformName) =>
        '无法确认' + platformName + '的真实登录账号，禁止用于店铺决策。',
      account_identity_ambiguous: (platformName) =>
        '无法唯一确认' + platformName + '账号，禁止用于店铺决策。',
    };
    return (Array.isArray(value) ? value : []).map((record) => {
      const issue = record && typeof record === 'object' ? record : {};
      const platform = String(issue.platform || '');
      if (!platformNames.has(platform)) return null;
      const rawCode = String(issue.code || '');
      const code = Object.prototype.hasOwnProperty.call(messages, rawCode)
        ? rawCode
        : 'account_binding_issue';
      const platformName = platformNames.get(platform);
      const message = messages[code]
        ? messages[code](platformName)
        : '账号绑定校验未通过。';
      return { code, platform, platformName, message };
    }).filter(Boolean);
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

  function buildXhsSourceCardsMarkup(analysis) {
    const snapshot = analysis && typeof analysis === 'object' ? analysis : {};
    const platformStates = xhsStatus && xhsStatus.platforms && typeof xhsStatus.platforms === 'object'
      ? xhsStatus.platforms : {};
    const accountMeta = snapshot.accounts && typeof snapshot.accounts === 'object' ? snapshot.accounts : {};
    const sourceCards = XHS_PLATFORMS.map((platform) => {
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

  function buildXhsMarkup() {
    const analysis = xhsAnalysis && typeof xhsAnalysis === 'object' ? xhsAnalysis : {};
    const management = analysis.management && typeof analysis.management === 'object'
      ? analysis.management : {};
    const costs = management.costs && typeof management.costs === 'object' ? management.costs : {};
    const taskResult = management.starTaskResult && typeof management.starTaskResult === 'object'
      ? management.starTaskResult : {};
    const outsideResult = management.outsideDirectResult && typeof management.outsideDirectResult === 'object'
      ? management.outsideDirectResult : {};
    const quality = analysis.quality && typeof analysis.quality === 'object'
      ? analysis.quality : { decisionReady: false, issues: [] };
    const sourceCards = buildXhsSourceCardsMarkup(analysis);
    const metrics = taskResult.metrics && typeof taskResult.metrics === 'object' ? taskResult.metrics : {};
    const kpis = [
      ['总投入', formatMoney(costs.total)],
      ['达人合作', formatMoney(costs.partnership)],
      ['聚光消耗', formatMoney(costs.juguang == null ? costs.spotlight : costs.juguang)],
      ['星河任务 GMV', formatMoney(metrics.gmv == null ? taskResult.gmv : metrics.gmv)],
      ['星河任务 ROI', formatDecimal(taskResult.roi, 2)],
      ['任务外直达 ROI', formatDecimal(outsideResult.roi, 2)],
    ].map((item) => '<div><span>' + item[0] + '</span><strong>' + escapeHtml(item[1]) + '</strong></div>').join('');
    const issues = Array.isArray(quality.issues) ? quality.issues : [];
    const issueMarkup = issues.length
      ? '<ul class="xhs-quality-list">' + issues.map((issue) => '<li><b>' +
        escapeHtml(issue.severity === 'critical' ? '关键' : '提示') + '</b><span>' +
        escapeHtml(issue.message || issue.code || '数据口径待核验') + '</span></li>').join('') + '</ul>'
      : '<p class="xhs-quality-empty">' + (quality.decisionReady
        ? '三平台账号、日期、分页和对账均已通过。'
        : '质量证据不足，尚未达到经营决策门槛，请补齐数据后重试。') + '</p>';
    const notes = Array.isArray(analysis.notes) ? analysis.notes : [];
    const spotlight = analysis.spotlight && typeof analysis.spotlight === 'object'
      ? analysis.spotlight : {};
    const objectiveRows = Array.isArray(spotlight.byMarketingObjective)
      ? spotlight.byMarketingObjective : [];
    const objectiveMarkup = objectiveRows.length ? objectiveRows.map((row) => (
      '<tr><td>' + escapeHtml(row.key || 'unknown') + '</td><td>' + formatMoney(row.spend) +
      '</td><td>' + formatInteger(row.impressions) + '</td><td>' + formatInteger(row.clicks) +
      '</td><td>' + formatInteger(row.interactions) + '</td><td>' + formatMoney(row.gmv) +
      '</td><td>' + formatDecimal(row.roi, 2) + '</td></tr>'
    )).join('') : '<tr><td colspan="7">当前日期范围暂无聚光营销诉求明细</td></tr>';
    const star = analysis.star && typeof analysis.star === 'object' ? analysis.star : {};
    const starLayers = [];
    for (const [layer, units] of [['项目', star.projects], ['订单', star.orders]]) {
      (Array.isArray(units) ? units : []).forEach((unit) => starLayers.push({ layer, unit }));
    }
    const starLayerMarkup = starLayers.length ? starLayers.map(({ layer, unit }) => (
      '<tr><td>' + layer + '</td><td>' + escapeHtml(unit.id || '—') + '</td><td>' +
      escapeHtml(unit.name || '—') + '</td><td>' + escapeHtml(xhsStatusLabel(unit.status)) +
      '</td><td>' + formatMoney(unit.allocatedCost) + '</td><td>' +
      formatMoney(unit.metrics && unit.metrics.gmv) + '</td><td>' + formatDecimal(unit.roi, 2) +
      '</td></tr>'
    )).join('') : '<tr><td colspan="7">当前日期范围暂无星河项目 / 订单明细</td></tr>';
    const noteRows = notes.length ? notes.map((note) => {
      const results = note.results && typeof note.results === 'object' ? note.results : {};
      const noteCosts = note.costs && typeof note.costs === 'object' ? note.costs : {};
      const action = Array.isArray(analysis.actions)
        ? analysis.actions.find((item) => item && item.noteId === note.noteId) : null;
      return '<tr><td>' + escapeHtml(note.noteId || '—') + '</td><td>' +
        escapeHtml(note.title || '未命名笔记') + '</td><td>' + formatMoney(noteCosts.total) + '</td><td>' +
        formatMoney(results.starTaskGmv) + '</td><td>' + formatDecimal(results.starTaskRoi, 2) + '</td><td>' +
        escapeHtml(action && action.action || 'observe') + '</td></tr>';
    }).join('') : '<tr><td colspan="6">当前日期范围暂无可联表笔记</td></tr>';
    return '<div class="xhs-report-body">' + sourceCards +
      '<section class="xhs-quality-panel"><div><span>数据质量</span><h3>' +
      (quality.decisionReady ? '可用于经营决策' : '需补数后再决策') + '</h3></div><b>' +
      (quality.decisionReady ? 'decisionReady = true' : 'decisionReady = false') + '</b>' + issueMarkup +
      '</section><section class="diagnosis-kpis xhs-kpis">' + kpis +
      '</section><section class="report-table-block"><div class="xhs-table-heading"><h3>聚光营销诉求</h3><span>' +
      objectiveRows.length + ' 类</span></div><table><thead><tr><th>营销诉求</th><th>消耗</th><th>曝光</th>' +
      '<th>点击</th><th>互动</th><th>GMV</th><th>ROI</th></tr></thead><tbody>' + objectiveMarkup +
      '</tbody></table></section><section class="report-table-block"><div class="xhs-table-heading"><h3>星河项目 / 订单</h3><span>' +
      starLayers.length + ' 条</span></div><table><thead><tr><th>层级</th><th>ID</th><th>名称</th><th>状态</th>' +
      '<th>分摊成本</th><th>GMV</th><th>ROI</th></tr></thead><tbody>' + starLayerMarkup +
      '</tbody></table></section><section class="report-table-block"><div class="xhs-table-heading"><h3>笔记全链路联表</h3><span>' +
      notes.length + ' 条</span></div><table><thead><tr><th>笔记 ID</th><th>笔记</th><th>总成本</th>' +
      '<th>星河任务 GMV</th><th>任务 ROI</th><th>行动</th></tr></thead><tbody>' + noteRows +
      '</tbody></table></section></div>';
  }

  function renderXhs() {
    const target = document.getElementById('xhsReport');
    if (!target) return;
    const error = sectionError('xiaohongshu');
    if (!xhsAnalysis && error) {
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

  function buildExportReportDocument(metadata) {
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    const embeddedBody = (markup) => {
      const template = document.createElement('template');
      template.innerHTML = sanitizeExportMarkup(markup);
      const duplicateHeader = template.content.querySelector('.wxt-report-head');
      if (duplicateHeader) duplicateHeader.remove();
      return template.innerHTML;
    };
    const missingSection = (section) => '<div class="export-missing"><strong>本模块未生成</strong><p>' +
      escapeHtml(sectionError(section) || '本次任务未选择该平台，或平台未返回可用数据。') + '</p></div>';
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
        buildGuangheMarkup('channel', true) + '</div>' +
        '<div id="export-guanghe-panel-asset" role="tabpanel" aria-labelledby="export-guanghe-tab-asset"' +
        ' data-export-guanghe-panel="asset"' + (initialGuangheView === 'asset' ? '' : ' hidden') + '>' +
        buildGuangheMarkup('asset', true) + '</div>'
      : missingSection('guanghe');
    const sections = [
      {
        key: 'flow', index: 1, label: '流量诊断', title: '生意参谋流量诊断',
        subtitle: '最近30个完整自然日 · 内容指标来自光合资产总览',
        hasData: sectionHasData('flow'),
        content: sectionHasData('flow') ? buildFlowMarkup() : missingSection('flow'),
      },
      {
        key: 'guanghe', index: 2, label: '光合渠道诊断', title: '光合渠道诊断',
        subtitle: '渠道视角与资产视角', hasData: sectionHasData('guanghe'), content: guangheViews,
      },
      {
        key: 'wxt', index: 3, label: '万相台报告', title: '万相台营销报告',
        subtitle: '营销场景、花费结构与投放效果', hasData: sectionHasData('wxt'),
        content: sectionHasData('wxt')
          ? embeddedBody(normalizeWxtMarketingMarkup(wxtReport.marketing.markup))
          : missingSection('wxt'),
      },
      {
        key: 'shortVideo', index: 4, label: '短视频诊断', title: '短视频诊断',
        subtitle: '免费内容与付费投放综合诊断', hasData: sectionHasData('shortVideo'),
        content: sectionHasData('shortVideo')
          ? embeddedBody(normalizeWxtShortVideoMarkup(wxtReport.shortVideo.markup))
          : missingSection('shortVideo'),
      },
      {
        key: 'dmp', index: 5, label: '内容人群画像', title: '内容人群画像诊断',
        subtitle: '达摩盘 · 年龄与消费能力等级', hasData: sectionHasData('dmp'),
        content: sectionHasData('dmp') ? buildDmpMarkup() : missingSection('dmp'),
      },
      {
        key: 'xiaohongshu', index: 6, label: '小红书全链路', title: '小红书全链路分析',
        subtitle: '淘宝星河 · 蒲公英 · 聚光 · noteId 联表', hasData: sectionHasData('xiaohongshu'),
        content: sectionHasData('xiaohongshu') ? buildXhsMarkup() : missingSection('xiaohongshu'),
      },
    ];
    const firstAvailable = sections.find((section) => section.hasData);
    const initialSection = sectionHasData(activeSection)
      ? activeSection
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
      String(section.index).padStart(2, '0') + ' / 06</span><h1>' + section.title + '</h1><p>' + section.subtitle +
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
      '.dimension-button{display:none}.dimension-child td:first-child{padding-left:30px}.metric-result.good{color:#067647}.metric-result.watch{color:#a34b00}' +
      '.xhs-source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 18px 18px}.xhs-source-card,.xhs-quality-panel{padding:16px;border:1px solid #dfe4ea;background:#fff}.xhs-source-card h3{margin:4px 0 10px}.xhs-source-card p,.xhs-source-card small{display:block;margin:5px 0;color:#667085;font-size:11px}.xhs-quality-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;margin:0 18px 18px}.xhs-quality-panel h3{margin:4px 0}.xhs-quality-list{grid-column:1/-1;padding:0;list-style:none}.xhs-quality-list li{display:flex;gap:10px;padding:6px 0;border-top:1px solid #edf0f3}.xhs-quality-empty,.xhs-quality-list span{color:#667085;font-size:11px}.xhs-table-heading{display:flex;justify-content:space-between;padding:13px 15px}.xhs-table-heading h3{margin:0}' +
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
    const script = '<script nonce="' + exportScriptNonce + '">(function(){var tabs=Array.from(document.querySelectorAll("[data-export-section]"));var panels=Array.from(document.querySelectorAll("[data-export-panel]"));function activate(key,focus){tabs.forEach(function(tab){var active=tab.dataset.exportSection===key;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1;if(active&&focus){tab.focus();tab.scrollIntoView({block:"nearest",inline:"nearest"});}});panels.forEach(function(panel){panel.hidden=panel.dataset.exportPanel!==key;});}function moveTab(event,index,items,activateItem){var next=index;if(event.key==="ArrowDown"||event.key==="ArrowRight")next=(index+1)%items.length;else if(event.key==="ArrowUp"||event.key==="ArrowLeft")next=(index+items.length-1)%items.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=items.length-1;else return;event.preventDefault();activateItem(items[next],true);}tabs.forEach(function(tab,index){tab.addEventListener("click",function(){activate(tab.dataset.exportSection,false);});tab.addEventListener("keydown",function(event){moveTab(event,index,tabs,function(next,focus){activate(next.dataset.exportSection,focus);});});});var views=Array.from(document.querySelectorAll("[data-export-guanghe-view]"));var viewPanels=Array.from(document.querySelectorAll("[data-export-guanghe-panel]"));function activateView(view,focus){views.forEach(function(button){var active=button===view;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();});viewPanels.forEach(function(panel){panel.hidden=panel.dataset.exportGuanghePanel!==view.dataset.exportGuangheView;});}views.forEach(function(view,index){view.addEventListener("click",function(){activateView(view,false);});view.addEventListener("keydown",function(event){moveTab(event,index,views,activateView);});});document.addEventListener("change",function(event){var select=event.target.closest&&event.target.closest("[data-attribution-select]");if(!select)return;var root=select.closest("[data-export-panel]")||document;root.querySelectorAll("[data-attribution-report]").forEach(function(node){node.hidden=node.getAttribute("data-attribution-report")!==select.value;});});})();<\/script>';
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
