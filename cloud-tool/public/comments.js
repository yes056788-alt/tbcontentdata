(function () {
  'use strict';

  const REQUEST_SOURCE = 'taobao-full-chain-web-tool';
  const REQUEST_TYPE = 'COMMENT_MONITOR_REQUEST';
  const RESPONSE_TYPE = 'COMMENT_MONITOR_RESPONSE';
  const ALLOWED_ACTIONS = new Set(['getState', 'configure', 'runNow', 'queryComments', 'exportRaw']);
  const pendingRequests = new Map();
  const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  const scoreFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

  let currentState = normalizeState({});
  let bridgeConnected = false;
  let initialized = false;
  let activeView = 'overview';
  let filters = { from: '', to: '', search: '' };
  let refreshTimer = null;

  const $ = (selector) => document.querySelector(selector);

  function text(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength || 1000);
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function firstNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const number = Number(arguments[index]);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function validTime(value) {
    const candidate = text(value, 5);
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : '09:00';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeOfficialUrl(value) {
    const candidate = text(value, 2000);
    if (!candidate) return '';
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      return parsed.protocol === 'https:' && (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com'))
        ? parsed.href
        : '';
    } catch (_) {
      return '';
    }
  }

  function normalizeNote(value) {
    const source = value && typeof value === 'object' ? value : {};
    const delta = source.delta && typeof source.delta === 'object' ? source.delta : {};
    const metrics = source.metrics && typeof source.metrics === 'object' ? source.metrics : {};
    const heat = source.heat && typeof source.heat === 'object' ? source.heat : {};
    return {
      noteId: text(source.noteId || source.id, 160),
      title: text(source.title || source.noteTitle || '未命名笔记', 300),
      publishTime: text(source.publishTime || source.publishedAt || source.publishDate, 80),
      updatedAt: text(source.updatedAt || source.capturedAt || source.lastUpdatedAt, 80),
      officialUrl: safeOfficialUrl(source.officialUrl || source.noteUrl || source.url),
      readDelta: nonNegative(firstNumber(source.readDelta, delta.reads, delta.read, metrics.readDelta)),
      interactionDelta: nonNegative(firstNumber(
        source.interactionDelta, delta.interactions, delta.nonCommentInteractions, metrics.interactionDelta
      )),
      commentDelta: nonNegative(firstNumber(source.commentDelta, delta.comments, metrics.commentDelta)),
      totalComments: nonNegative(firstNumber(source.totalComments, source.commentCount, metrics.comments)),
      heatScore: nonNegative(firstNumber(source.heatScore, heat.score)),
      heatLevel: text(source.heatLevel || heat.level || '待计算', 40),
      captureStatus: text(source.captureStatus || source.status || '待抓取', 80),
      captureState: text(source.captureState || source.statusCode || '', 40),
      isNew: source.isNew === true,
      pending: source.pending === true,
    };
  }

  function normalizeInsight(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      id: text(source.id || source.themeId || source.theme, 160),
      theme: text(source.theme || source.label || '未分类主题', 160),
      businessType: text(source.businessType || source.category || source.type || '其他', 120),
      count: nonNegative(firstNumber(source.count, source.newMentions, source.mentions)),
      trend: text(source.trend || source.direction || '持平', 40),
      summary: text(source.summary || source.insight || source.description || '暂无摘要', 600),
      evidenceCount: nonNegative(firstNumber(
        source.evidenceCount,
        Array.isArray(source.evidenceIds) ? source.evidenceIds.length : 0
      )),
    };
  }

  function normalizeEvidence(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      commentId: text(source.commentId || source.id, 160),
      content: text(source.content || source.text || source.comment, 2000),
      theme: text(source.theme || source.category || '未分类', 120),
      sentiment: text(source.sentiment || source.tone || '中性', 40),
      noteId: text(source.noteId, 160),
      noteTitle: text(source.noteTitle || source.title || '未命名笔记', 300),
      noteUrl: safeOfficialUrl(source.noteUrl || source.officialUrl || source.url),
      commentTime: text(source.commentTime || source.createdAt || source.time, 80),
    };
  }

  function normalizeRun(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      runId: text(source.runId || source.id, 160),
      startedAt: text(source.startedAt || source.createdAt, 80),
      type: text(source.type || source.runType || '每日更新', 80),
      candidateCount: nonNegative(firstNumber(source.candidateCount, source.noteCount)),
      newCommentCount: nonNegative(firstNumber(source.newCommentCount, source.commentCount)),
      status: text(source.status || source.state || '未知', 80),
      statusCode: text(source.statusCode || source.state || '', 40),
      message: text(source.message || source.error || source.phase || '-', 300),
    };
  }

  function normalizeState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const profile = source.profile && typeof source.profile === 'object' ? source.profile : {};
    const overview = source.overview && typeof source.overview === 'object' ? source.overview : {};
    const status = source.status && typeof source.status === 'object' ? source.status : {};
    const rawEvidence = Array.isArray(source.evidence)
      ? source.evidence
      : (Array.isArray(source.comments) ? source.comments : []);
    return {
      schema: text(source.schema || 'commentMonitorWebStateV1', 80),
      generatedAt: text(source.generatedAt || source.updatedAt, 80),
      extensionVersion: text(source.extensionVersion || source.version, 40),
      stores: (Array.isArray(source.stores) ? source.stores : []).map((store) => ({
        id: text(store && store.id, 100),
        name: text(store && store.name, 120),
      })).filter((store) => store.id && store.name),
      profile: {
        enabled: profile.enabled !== false,
        scheduleTime: validTime(profile.scheduleTime),
        timezone: text(profile.timezone || 'Asia/Shanghai', 80),
        storeId: text(profile.storeId, 100),
        storeName: text(profile.storeName, 120),
      },
      status: {
        state: text(status.state || status.code || source.runState || 'idle', 60),
        label: text(status.label, 80),
        message: text(status.message || status.error || source.error, 500),
        lastSuccessAt: text(status.lastSuccessAt || source.lastSuccessAt, 80),
        nextRunAt: text(status.nextRunAt || source.nextRunAt, 80),
        pendingCount: nonNegative(firstNumber(status.pendingCount, overview.pendingTasks)),
        progress: nonNegative(status.progress),
      },
      overview: {
        newNotes: nonNegative(overview.newNotes),
        newComments: nonNegative(overview.newComments),
        hotNotes: nonNegative(overview.hotNotes),
        negativeFeedback: nonNegative(overview.negativeFeedback),
        purchaseConcerns: nonNegative(overview.purchaseConcerns),
        unansweredQuestions: nonNegative(overview.unansweredQuestions),
        pendingTasks: nonNegative(firstNumber(overview.pendingTasks, status.pendingCount)),
      },
      notes: (Array.isArray(source.notes) ? source.notes : []).map(normalizeNote),
      insights: (Array.isArray(source.insights) ? source.insights : []).map(normalizeInsight),
      evidence: rawEvidence.map(normalizeEvidence),
      runs: (Array.isArray(source.runs) ? source.runs : []).map(normalizeRun),
    };
  }

  function targetOrigin() {
    return location.origin && location.origin !== 'null' ? location.origin : '*';
  }

  function request(action, payload, timeoutMs) {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error('不支持的评论监测操作：' + action);
    }
    return new Promise((resolve, reject) => {
      const requestId = 'comment-monitor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('未收到数据助手响应，请确认扩展已安装并重新加载。'));
      }, Number(timeoutMs) || 15000);
      pendingRequests.set(requestId, { action, resolve, reject, timer });
      window.postMessage({
        source: REQUEST_SOURCE,
        type: REQUEST_TYPE,
        requestId,
        action,
        payload: payload && typeof payload === 'object' ? payload : {},
      }, targetOrigin());
    });
  }

  function responsePayload(data) {
    if (data && data.payload && typeof data.payload === 'object') return data.payload;
    if (data && data.result && typeof data.result === 'object') return data.result;
    return {};
  }

  function messageError(data) {
    if (!data || data.ok !== false) return '';
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error.message === 'string') return data.error.message;
    return '数据助手处理失败。';
  }

  function handleResponse(event) {
    if (event.source && event.source !== window) return;
    if (location.origin && location.origin !== 'null' && event.origin && event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== REQUEST_SOURCE || data.type !== RESPONSE_TYPE) return;
    bridgeConnected = true;
    const pending = pendingRequests.get(data.requestId);
    if (pending) {
      pendingRequests.delete(data.requestId);
      clearTimeout(pending.timer);
      const error = messageError(data);
      if (error) pending.reject(new Error(error));
      else pending.resolve(responsePayload(data));
    }
    if (!data.requestId || data.push === true) {
      const payload = responsePayload(data);
      if (payload.state || payload.overview || payload.notes || payload.status) applyStatePayload(payload);
    }
    if (initialized) renderConnection();
  }

  window.addEventListener('message', handleResponse);

  function stateFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.state && typeof payload.state === 'object') return payload.state;
    if (payload.monitor && typeof payload.monitor === 'object') return payload.monitor;
    if (payload.overview || payload.notes || payload.insights || payload.evidence || payload.runs || payload.status) {
      return payload;
    }
    return null;
  }

  function applyStatePayload(payload) {
    const next = stateFromPayload(payload);
    if (!next) return false;
    currentState = normalizeState(next);
    if (initialized) render();
    return true;
  }

  function formatNumber(value) {
    return numberFormatter.format(nonNegative(value));
  }

  function formatScore(value) {
    return scoreFormatter.format(nonNegative(value));
  }

  function formatDateTime(value) {
    const source = text(value, 80);
    if (!source) return '-';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return source;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function localDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function statusMeta(status) {
    const source = status && typeof status === 'object' ? status : {};
    const key = text(source.state, 60).toLowerCase();
    const values = {
      idle: ['待运行', 'empty'],
      running: ['更新中', 'running'],
      success: ['已完成', 'success'],
      complete: ['已完成', 'success'],
      completed: ['已完成', 'success'],
      waitingforlogin: ['待登录', 'waiting'],
      waiting_login: ['待登录', 'waiting'],
      waiting_for_login: ['待登录', 'waiting'],
      waitingforverification: ['待验证', 'waiting'],
      waiting_verification: ['待验证', 'waiting'],
      waiting_for_verification: ['待验证', 'waiting'],
      paused: ['已暂停', 'paused'],
      error: ['失败', 'failed'],
      failed: ['失败', 'failed'],
    };
    const fallback = source.label || (key ? source.state : '待运行');
    return values[key] || [fallback, key === 'error' ? 'failed' : 'empty'];
  }

  function renderConnection() {
    const element = $('#commentConnectionState');
    if (!element) return;
    element.className = 'connection-state ' + (bridgeConnected ? 'connected' : 'disconnected');
    element.textContent = bridgeConnected ? '数据助手已连接' : '数据助手未连接';
    $('#commentExtensionVersion').textContent = currentState.extensionVersion
      ? 'v' + currentState.extensionVersion.replace(/^v/i, '')
      : '';
  }

  function setNotice(message, tone) {
    const element = $('#commentMonitorNotice');
    if (!element) return;
    element.textContent = message || '';
    element.dataset.tone = tone || '';
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.dataset.busy = busy ? 'true' : 'false';
    button.disabled = Boolean(busy);
    button.textContent = busy ? busyText : button.dataset.defaultText;
  }

  function selectedStore() {
    const select = $('#commentStoreSelect');
    const storeId = text(select && select.value, 100);
    return currentState.stores.find((store) => store.id === storeId) || null;
  }

  function updateRunAvailability() {
    const button = $('#runCommentMonitorBtn');
    if (!button || button.dataset.busy === 'true') return;
    button.disabled = !bridgeConnected || !selectedStore();
  }

  function renderStoreSelector() {
    const select = $('#commentStoreSelect');
    const helper = $('#commentStoreHelp');
    if (!select || !helper) return;
    const requestedId = select.value || currentState.profile.storeId;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = currentState.stores.length ? '请选择店铺' : '请先在项目管理中添加店铺';
    select.appendChild(placeholder);
    currentState.stores.forEach((store) => {
      const option = document.createElement('option');
      option.value = store.id;
      option.textContent = store.name;
      select.appendChild(option);
    });
    select.value = currentState.stores.some((store) => store.id === requestedId) ? requestedId : '';
    select.disabled = !bridgeConnected || currentState.stores.length === 0;
    const store = selectedStore();
    helper.textContent = store
      ? '本次数据归属“' + store.name + '”，复用当前 Chrome 已登录的蒲公英账号；账号不符时请先到蒲公英切换。'
      : (currentState.stores.length
        ? '选择店铺后，复用当前 Chrome 已登录的蒲公英账号；未登录时会打开登录页。'
        : '暂无店铺，请先到项目管理添加店铺，再返回选择。');
    updateRunAvailability();
  }

  function currentFilterValues() {
    return {
      from: text($('#commentDateFrom') && $('#commentDateFrom').value, 10),
      to: text($('#commentDateTo') && $('#commentDateTo').value, 10),
      search: text($('#commentSearch') && $('#commentSearch').value, 100),
    };
  }

  function matchesSearch(values, query) {
    const needle = text(query, 100).toLocaleLowerCase('zh-CN');
    if (!needle) return true;
    return values.some((value) => text(value, 2000).toLocaleLowerCase('zh-CN').includes(needle));
  }

  function filterNotes(notes) {
    return notes.filter((note) => matchesSearch([
      note.title, note.noteId, note.captureStatus, note.heatLevel,
    ], filters.search));
  }

  function filterInsights(insights) {
    return insights.filter((item) => matchesSearch([
      item.theme, item.businessType, item.summary, item.trend,
    ], filters.search));
  }

  function filterEvidence(evidence) {
    return evidence.filter((item) => matchesSearch([
      item.content, item.theme, item.sentiment, item.noteTitle, item.noteId,
    ], filters.search));
  }

  function noteLink(note, label) {
    return note.officialUrl
      ? '<a href="' + escapeHtml(note.officialUrl) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(label || '打开笔记') + '</a>'
      : '<span aria-label="暂无官方链接">-</span>';
  }

  function statusBadge(label, code) {
    const source = text((code || label), 80).toLowerCase();
    let className = 'empty';
    if (/success|complete|完成|已抓取/.test(source)) className = 'success';
    else if (/running|progress|pending|进行|等待|待抓|续抓/.test(source)) className = 'running';
    else if (/error|fail|失败|异常|验证|登录/.test(source)) className = 'failed';
    else if (/pause|暂停/.test(source)) className = 'paused';
    return '<span class="status-badge ' + className + '">' + escapeHtml(label || '未知') + '</span>';
  }

  function heatBadge(note) {
    const level = note.heatLevel || '待计算';
    const code = /高|爆|热/.test(level) ? 'running' : (/低|冷/.test(level) ? 'empty' : 'success');
    return '<span class="status-badge ' + code + '">' + escapeHtml(level) + ' · ' +
      escapeHtml(formatScore(note.heatScore)) + '</span>';
  }

  function renderPriorityRows(notes) {
    const rows = notes.slice().sort((left, right) => (
      Number(right.isNew) - Number(left.isNew) || right.commentDelta - left.commentDelta || right.heatScore - left.heatScore
    )).slice(0, 10);
    $('#overviewPriorityCount').textContent = formatNumber(rows.length) + ' 篇';
    $('#commentPriorityRows').innerHTML = rows.length ? rows.map((note) => (
      '<tr><td class="note-cell"><strong>' + escapeHtml(note.title) + '</strong><small>' +
      escapeHtml(note.noteId || note.publishTime || '-') + '</small></td>' +
      '<td><span class="metric-positive">+' + formatNumber(note.commentDelta) + '</span></td>' +
      '<td>' + heatBadge(note) + '</td>' +
      '<td>' + statusBadge(note.captureStatus, note.captureState) + '</td>' +
      '<td>' + noteLink(note, '官方链接') + '</td></tr>'
    )).join('') : '<tr><td class="empty-cell" colspan="5">暂无优先处理笔记</td></tr>';
  }

  function renderHeatRows(notes) {
    const sorted = notes.slice().sort((left, right) => right.heatScore - left.heatScore || right.commentDelta - left.commentDelta);
    $('#commentHeatCount').textContent = formatNumber(sorted.length) + ' 篇';
    $('#commentHeatRows').innerHTML = sorted.length ? sorted.map((note) => (
      '<tr><td class="note-cell"><strong>' + escapeHtml(note.title) + '</strong><small>' +
      escapeHtml(note.publishTime ? '发布 ' + formatDateTime(note.publishTime) : note.noteId || '-') + '</small></td>' +
      '<td><span class="metric-positive">+' + formatNumber(note.readDelta) + '</span></td>' +
      '<td><span class="metric-positive">+' + formatNumber(note.interactionDelta) + '</span></td>' +
      '<td><span class="metric-positive">+' + formatNumber(note.commentDelta) + '</span></td>' +
      '<td><span class="heat-score">' + formatScore(note.heatScore) + '</span><br>' + heatBadge(note) + '</td>' +
      '<td>' + statusBadge(note.captureStatus, note.captureState) + '</td>' +
      '<td>' + escapeHtml(formatDateTime(note.updatedAt)) + '</td>' +
      '<td>' + noteLink(note, '打开笔记') + '</td></tr>'
    )).join('') : '<tr><td class="empty-cell" colspan="8">暂无笔记热度数据</td></tr>';
  }

  function trendMarkup(value) {
    const trend = text(value, 40) || '持平';
    const className = /上升|增长|up/i.test(trend) ? 'trend-up' : (/下降|回落|down/i.test(trend) ? 'trend-down' : '');
    return '<span class="' + className + '">' + escapeHtml(trend) + '</span>';
  }

  function renderInsightRows(insights) {
    const sorted = insights.slice().sort((left, right) => right.count - left.count);
    $('#commentInsightCount').textContent = formatNumber(sorted.length) + ' 个主题';
    $('#commentInsightRows').innerHTML = sorted.length ? sorted.map((item) => (
      '<tr><td><strong>' + escapeHtml(item.theme) + '</strong></td>' +
      '<td>' + escapeHtml(item.businessType) + '</td>' +
      '<td><span class="metric-positive">' + formatNumber(item.count) + '</span></td>' +
      '<td>' + trendMarkup(item.trend) + '</td>' +
      '<td class="wrap-cell">' + escapeHtml(item.summary) + '</td>' +
      '<td><button class="row-action" type="button" data-open-evidence="' + escapeHtml(item.theme) + '">' +
      formatNumber(item.evidenceCount || item.count) + ' 条</button></td></tr>'
    )).join('') : '<tr><td class="empty-cell" colspan="6">暂无可分析的评论主题</td></tr>';
  }

  function sentimentBadge(value) {
    const sentiment = text(value, 40) || '中性';
    const className = /负|negative/i.test(sentiment) ? 'negative' : (/正|positive/i.test(sentiment) ? 'success' : 'empty');
    return '<span class="status-badge ' + className + '">' + escapeHtml(sentiment) + '</span>';
  }

  function renderEvidenceRows(evidence) {
    $('#commentEvidenceCount').textContent = formatNumber(evidence.length) + ' 条';
    $('#commentEvidenceRows').innerHTML = evidence.length ? evidence.map((item) => (
      '<tr><td class="wrap-cell">' + escapeHtml(item.content || '-') + '</td>' +
      '<td>' + escapeHtml(item.theme) + '</td>' +
      '<td>' + sentimentBadge(item.sentiment) + '</td>' +
      '<td class="note-cell"><strong>' + escapeHtml(item.noteTitle) + '</strong><small>' + escapeHtml(item.noteId || '-') + '</small></td>' +
      '<td>' + escapeHtml(formatDateTime(item.commentTime)) + '</td>' +
      '<td>' + (item.noteUrl ? '<a href="' + escapeHtml(item.noteUrl) + '" target="_blank" rel="noopener noreferrer">官方链接</a>' : '-') + '</td></tr>'
    )).join('') : '<tr><td class="empty-cell" colspan="6">暂无评论证据</td></tr>';
  }

  function renderRunRows(runs) {
    $('#commentRunCount').textContent = formatNumber(runs.length) + ' 次';
    $('#commentRunRows').innerHTML = runs.length ? runs.map((run) => (
      '<tr><td>' + escapeHtml(formatDateTime(run.startedAt)) + '</td>' +
      '<td>' + escapeHtml(run.type) + '</td>' +
      '<td>' + formatNumber(run.candidateCount) + '</td>' +
      '<td>' + formatNumber(run.newCommentCount) + '</td>' +
      '<td>' + statusBadge(run.status, run.statusCode) + '</td>' +
      '<td class="wrap-cell">' + escapeHtml(run.message) + '</td></tr>'
    )).join('') : '<tr><td class="empty-cell" colspan="6">暂无运行记录</td></tr>';
  }

  function renderOverview() {
    const overview = currentState.overview;
    const values = {
      metricNewNotes: overview.newNotes,
      metricNewComments: overview.newComments,
      metricHotNotes: overview.hotNotes,
      metricNegativeFeedback: overview.negativeFeedback,
      metricPurchaseConcerns: overview.purchaseConcerns,
      metricUnansweredQuestions: overview.unansweredQuestions,
      metricPendingTasks: overview.pendingTasks,
    };
    Object.keys(values).forEach((id) => { $('#' + id).textContent = formatNumber(values[id]); });
  }

  function renderStatus() {
    const meta = statusMeta(currentState.status);
    $('#commentRunStatus').innerHTML = '<span class="status-badge ' + escapeHtml(meta[1]) + '">' + escapeHtml(meta[0]) + '</span>';
    $('#commentLastSuccess').textContent = formatDateTime(currentState.status.lastSuccessAt);
    $('#commentNextRun').textContent = currentState.status.nextRunAt
      ? formatDateTime(currentState.status.nextRunAt)
      : currentState.profile.scheduleTime;
    $('#commentPendingCount').textContent = formatNumber(currentState.status.pendingCount) + ' 篇';

    const stateCode = currentState.status.state.toLowerCase();
    const errorVisible = /error|fail|waiting.*login|waiting.*verification/.test(stateCode);
    $('#commentErrorState').hidden = !errorVisible;
    if (errorVisible) {
      $('#commentErrorCopy').textContent = currentState.status.message || (
        /login/.test(stateCode) ? '蒲公英或小红书登录已失效，请登录后重试。' :
          (/verification/.test(stateCode) ? '平台正在等待人工验证，验证后可继续。' : '请查看运行记录后重试。')
      );
    }
  }

  function renderEmptyState(notes, insights, evidence, runs) {
    const hasData = notes.length || insights.length || evidence.length || runs.length;
    const element = $('#commentEmptyState');
    element.hidden = Boolean(hasData);
    if (hasData) return;
    const title = element.querySelector('strong');
    const copy = element.querySelector('p');
    if (!bridgeConnected) {
      title.textContent = '未连接数据助手';
      copy.textContent = '页面可以安全预览；安装或重新加载扩展后，评论监测数据会显示在这里。';
    } else {
      title.textContent = '尚未建立评论监测基线';
      copy.textContent = '点击“立即更新”建立笔记库与首次快照，之后每日按新笔记和热度增量续抓。';
    }
  }

  function render() {
    if (!initialized) return;
    renderConnection();
    renderStoreSelector();
    renderOverview();
    renderStatus();
    const notes = filterNotes(currentState.notes);
    const insights = filterInsights(currentState.insights);
    const evidence = filterEvidence(currentState.evidence);
    renderPriorityRows(notes);
    renderHeatRows(notes);
    renderInsightRows(insights);
    renderEvidenceRows(evidence);
    renderRunRows(currentState.runs);
    renderEmptyState(notes, insights, evidence, currentState.runs);
    $('#commentMonitorEnabled').checked = currentState.profile.enabled;
    $('#commentScheduleTime').value = currentState.profile.scheduleTime;
  }

  function activateView(view, moveFocus) {
    const tabs = Array.from(document.querySelectorAll('[data-comment-view]'));
    if (!tabs.some((tab) => tab.dataset.commentView === view)) return;
    activeView = view;
    tabs.forEach((tab) => {
      const active = tab.dataset.commentView === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      if (active && moveFocus) tab.focus();
    });
    document.querySelectorAll('[data-comment-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.commentPanel !== view;
    });
  }

  function handleTabKeydown(event) {
    const tabs = Array.from(document.querySelectorAll('[data-comment-view]'));
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activateView(tabs[nextIndex].dataset.commentView, true);
  }

  async function reloadState(timeoutMs) {
    const payload = await request('getState', { filters }, timeoutMs || 15000);
    bridgeConnected = true;
    applyStatePayload(payload);
    renderConnection();
    return payload;
  }

  function scheduleRunningRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!bridgeConnected || currentState.status.state.toLowerCase() !== 'running') return;
    refreshTimer = setTimeout(async () => {
      try {
        await reloadState(15000);
      } catch (error) {
        bridgeConnected = false;
        render();
      } finally {
        scheduleRunningRefresh();
      }
    }, 3000);
  }

  async function runNow() {
    const button = $('#runCommentMonitorBtn');
    const store = selectedStore();
    if (!store) {
      setNotice('请先选择本次评论监测归属的店铺。', 'error');
      updateRunAvailability();
      return;
    }
    setButtonBusy(button, true, '正在启动…');
    setNotice('正在使用当前 Chrome 登录态更新“' + store.name + '”的评论数据，页面可以继续使用。');
    try {
      const result = await request('runNow', {
        reason: 'manual', filters, store: { id: store.id, name: store.name },
      }, 30000);
      bridgeConnected = true;
      if (!applyStatePayload(result)) await reloadState();
      scheduleRunningRefresh();
      setNotice('“' + store.name + '”的评论更新任务已启动，进度会持续保存。', 'success');
    } catch (error) {
      setNotice(error && error.message ? error.message : '无法启动评论更新。', 'error');
    } finally {
      setButtonBusy(button, false, '');
      updateRunAvailability();
      renderConnection();
    }
  }

  async function applyFilters(event) {
    if (event) event.preventDefault();
    filters = currentFilterValues();
    if (filters.from && filters.to && filters.from > filters.to) {
      setNotice('开始日期不能晚于结束日期。', 'error');
      return;
    }
    const button = $('#applyCommentFiltersBtn');
    setButtonBusy(button, true, '查询中…');
    try {
      const result = await request('queryComments', { filters }, 20000);
      bridgeConnected = true;
      if (!applyStatePayload(result)) render();
      setNotice('已更新当前筛选范围。', 'success');
    } catch (error) {
      render();
      setNotice(error && error.message ? error.message : '筛选查询失败。', 'error');
    } finally {
      setButtonBusy(button, false, '');
      renderConnection();
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $('#saveCommentSettingsBtn');
    const store = selectedStore();
    if (!store) {
      setNotice('请先在页面上方选择日更任务归属的店铺。', 'error');
      return;
    }
    const profile = {
      enabled: $('#commentMonitorEnabled').checked,
      scheduleTime: validTime($('#commentScheduleTime').value),
      timezone: 'Asia/Shanghai',
      storeId: store.id,
      storeName: store.name,
    };
    setButtonBusy(button, true, '保存中…');
    try {
      const result = await request('configure', { profile }, 15000);
      bridgeConnected = true;
      if (!applyStatePayload(result)) {
        currentState.profile = profile;
        render();
      }
      setNotice('日更设置已保存。', 'success');
    } catch (error) {
      setNotice(error && error.message ? error.message : '保存日更设置失败。', 'error');
    } finally {
      setButtonBusy(button, false, '');
      renderConnection();
    }
  }

  function downloadBlob(content, mimeType, fileName) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportDateStamp() {
    return localDateInput(new Date()).replace(/-/g, '');
  }

  function buildHtmlExport(value, selectedFilters) {
    const state = normalizeState(value);
    const reportFilters = selectedFilters && typeof selectedFilters === 'object' ? selectedFilters : {};
    const filterLabel = [text(reportFilters.from, 10), text(reportFilters.to, 10)].filter(Boolean).join(' 至 ') || '当前监测范围';
    const noteRows = state.notes.map((note) => (
      '<tr><td>' + escapeHtml(note.title) + '</td><td>' + formatNumber(note.readDelta) + '</td><td>' +
      formatNumber(note.interactionDelta) + '</td><td>' + formatNumber(note.commentDelta) + '</td><td>' +
      escapeHtml(note.heatLevel) + ' · ' + formatScore(note.heatScore) + '</td></tr>'
    )).join('') || '<tr><td colspan="5">暂无笔记热度数据</td></tr>';
    const insightRows = state.insights.map((item) => (
      '<tr><td>' + escapeHtml(item.theme) + '</td><td>' + escapeHtml(item.businessType) + '</td><td>' +
      formatNumber(item.count) + '</td><td>' + escapeHtml(item.trend) + '</td><td>' + escapeHtml(item.summary) + '</td></tr>'
    )).join('') || '<tr><td colspan="5">暂无主题洞察</td></tr>';
    const evidenceRows = state.evidence.slice(0, 200).map((item) => {
      const link = item.noteUrl
        ? '<a href="' + escapeHtml(item.noteUrl) + '" target="_blank" rel="noopener noreferrer">官方链接</a>'
        : '-';
      return '<tr><td>' + escapeHtml(item.content) + '</td><td>' + escapeHtml(item.theme) + '</td><td>' +
        escapeHtml(item.sentiment) + '</td><td>' + escapeHtml(item.noteTitle) + '</td><td>' + link + '</td></tr>';
    }).join('') || '<tr><td colspan="5">暂无评论证据</td></tr>';
    const overview = state.overview;
    const cards = [
      ['新增笔记', overview.newNotes], ['新增评论', overview.newComments], ['热笔记', overview.hotNotes],
      ['负面反馈', overview.negativeFeedback], ['购买顾虑', overview.purchaseConcerns],
      ['未回答问题', overview.unansweredQuestions], ['待续抓任务', overview.pendingTasks],
    ].map((item) => '<div><span>' + item[0] + '</span><strong>' + formatNumber(item[1]) + '</strong></div>').join('');

    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>评论监测洞察报告</title><style>' +
      ':root{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1f2937;background:#f3f5f8}' +
      '*{box-sizing:border-box}body{margin:0}.page{width:min(1200px,calc(100% - 32px));margin:auto;padding:28px 0 48px}' +
      'header{padding:20px;border:1px solid #dce2ea;background:#fff}h1{margin:0;font-size:24px}p{margin:5px 0 0;color:#667085}' +
      '.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:16px;border:1px solid #dce2ea;background:#fff}' +
      '.cards div{padding:14px;border-right:1px solid #eaecf0}.cards span,.cards strong{display:block}.cards span{color:#667085;font-size:12px}.cards strong{font-size:24px}' +
      'section{margin-top:16px;border:1px solid #dce2ea;background:#fff}h2{margin:0;padding:12px 14px;border-bottom:1px solid #eaecf0;font-size:15px}' +
      '.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px 12px;border-bottom:1px solid #eaecf0;text-align:left;vertical-align:top}' +
      'th{background:#eef2f6;white-space:nowrap}a{color:#0b67d1}@media(max-width:700px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.page{width:calc(100% - 20px)}}' +
      '</style></head><body><main class="page"><header><h1>评论监测洞察报告</h1><p>日期：' + escapeHtml(filterLabel) +
      '｜生成时间：' + escapeHtml(formatDateTime(state.generatedAt || new Date().toISOString())) +
      '</p><p>说明：仅表示关联笔记评论，不将评论归因到搜索词。</p></header>' +
      '<div class="cards">' + cards + '</div>' +
      '<section><h2>笔记热度</h2><div class="table"><table><thead><tr><th>笔记</th><th>阅读增量</th><th>互动增量</th><th>评论增量</th><th>热度</th></tr></thead><tbody>' + noteRows + '</tbody></table></div></section>' +
      '<section><h2>主题洞察</h2><div class="table"><table><thead><tr><th>主题</th><th>类型</th><th>新增提及</th><th>趋势</th><th>洞察</th></tr></thead><tbody>' + insightRows + '</tbody></table></div></section>' +
      '<section><h2>评论证据（最多 200 条）</h2><div class="table"><table><thead><tr><th>评论原文</th><th>主题</th><th>倾向</th><th>笔记</th><th>链接</th></tr></thead><tbody>' + evidenceRows + '</tbody></table></div></section>' +
      '</main></body></html>';
  }

  function exportHtml() {
    try {
      const html = buildHtmlExport(currentState, filters);
      downloadBlob(html, 'text/html;charset=utf-8', '评论监测洞察报告_' + exportDateStamp() + '.html');
      setNotice('评论洞察 HTML 已导出。', 'success');
    } catch (error) {
      setNotice(error && error.message ? error.message : '导出 HTML 失败。', 'error');
    }
  }

  function rowsToCsv(rows) {
    const source = Array.isArray(rows) ? rows : [];
    if (!source.length) return '';
    const columns = Array.from(source.reduce((set, row) => {
      Object.keys(row && typeof row === 'object' ? row : {}).forEach((key) => set.add(key));
      return set;
    }, new Set()));
    const quote = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    return [columns.map(quote).join(',')].concat(source.map((row) => columns.map((key) => quote(row[key])).join(','))).join('\r\n');
  }

  async function exportRaw(format) {
    const button = format === 'csv' ? $('#exportCommentCsvBtn') : $('#exportCommentJsonBtn');
    setButtonBusy(button, true, '准备中…');
    try {
      const result = await request('exportRaw', { format, filters }, 30000);
      bridgeConnected = true;
      const fileName = text(result.fileName, 180) || '原始评论_' + exportDateStamp() + '.' + format;
      if (typeof result.content === 'string') {
        downloadBlob(result.content, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8', fileName);
      } else if (Array.isArray(result.rows)) {
        const content = format === 'csv' ? rowsToCsv(result.rows) : JSON.stringify(result.rows, null, 2);
        downloadBlob(content, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8', fileName);
      }
      setNotice('原始评论 ' + format.toUpperCase() + ' 导出已准备。', 'success');
    } catch (error) {
      setNotice(error && error.message ? error.message : '导出原始评论失败。', 'error');
    } finally {
      setButtonBusy(button, false, '');
      renderConnection();
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-comment-view]').forEach((tab) => {
      tab.addEventListener('click', () => activateView(tab.dataset.commentView, false));
      tab.addEventListener('keydown', handleTabKeydown);
    });
    $('#commentFilterForm').addEventListener('submit', applyFilters);
    $('#commentStoreSelect').addEventListener('change', () => {
      renderStoreSelector();
      const store = selectedStore();
      setNotice(store
        ? '已选择“' + store.name + '”，点击“立即更新”将复用当前 Chrome 登录态。'
        : '', store ? 'success' : '');
    });
    $('#runCommentMonitorBtn').addEventListener('click', runNow);
    $('#commentSettingsForm').addEventListener('submit', saveSettings);
    $('#exportCommentHtmlBtn').addEventListener('click', exportHtml);
    $('#exportCommentCsvBtn').addEventListener('click', () => exportRaw('csv'));
    $('#exportCommentJsonBtn').addEventListener('click', () => exportRaw('json'));
    $('#commentInsightRows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-evidence]');
      if (!button) return;
      $('#commentSearch').value = button.dataset.openEvidence || '';
      filters.search = button.dataset.openEvidence || '';
      activateView('evidence', true);
      render();
    });
  }

  function initializeFilters() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    $('#commentDateFrom').value = localDateInput(weekAgo);
    $('#commentDateTo').value = localDateInput(today);
    const searchParams = new URLSearchParams(location.search || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('from') || '')) $('#commentDateFrom').value = searchParams.get('from');
    if (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('to') || '')) $('#commentDateTo').value = searchParams.get('to');
    $('#commentSearch').value = text(searchParams.get('search'), 100);
    filters = currentFilterValues();
  }

  async function init() {
    initialized = true;
    initializeFilters();
    bindEvents();
    activateView(activeView, false);
    render();
    try {
      await reloadState(2500);
      scheduleRunningRefresh();
      setNotice('');
    } catch (_) {
      bridgeConnected = false;
      render();
    }
  }

  window.CommentMonitorWeb = Object.freeze({
    REQUEST_SOURCE,
    REQUEST_TYPE,
    RESPONSE_TYPE,
    request,
    normalizeState,
    buildHtmlExport,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
