// lingxi-content-script.js - ISOLATED world UI for Lingxi audience portraits.
(function installLingxiPortraitUi() {
  'use strict';

  const LINGXI_ORIGIN = 'https://idea.xiaohongshu.com';
  if (window !== window.top || location.origin !== LINGXI_ORIGIN) return;

  const INSTALL_FLAG = '__lingxiAudiencePortraitUiV1';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  const CHANNEL = 'xhs-page-bridge-v2';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const PLATFORM = 'lingxi';
  const ENDPOINTS = Object.freeze({
    LIST_GROUPS: 'listGroups',
    GET_PORTRAIT_PANEL: 'getPortraitPanel',
    BUILD_PORTRAIT: 'buildPortrait',
  });
  const REQUEST_TIMEOUT_MS_BY_ENDPOINT = Object.freeze({
    listGroups: 45000,
    getPortraitPanel: 45000,
    buildPortrait: 300000,
  });
  const UI_ACTION_ENDPOINTS = Object.freeze({
    LIST_GROUPS: ENDPOINTS.LIST_GROUPS,
    BUILD_PORTRAIT: ENDPOINTS.BUILD_PORTRAIT,
  });

  // Keep this canonical list in one place. The page hook receives it with every build.
  const PORTRAIT_PANEL_IDS = [
    1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21, 23, 25, 28, 30,
    31, 32, 33,
  ];
  const PORTRAIT_PANEL_CONFIGS = [
    {
      panelName: '预测性别',
      pageSize: 10,
      filterField: [{ fieldValues: ['男', '女'], fieldCn: '预测性别', fieldEn: 'sex' }],
    },
    { panelName: '预测年龄', pageSize: 10 },
    { panelName: '婚恋状态', pageSize: 1000 },
    { panelName: '母婴阶段', pageSize: 1000 },
    {
      panelName: '地域分布-省份/区域/城市',
      pageSize: 30,
      filterField: [{ fieldValues: ['province'], fieldCn: '地域等级', fieldEn: 'flatOption' }],
    },
    {
      panelName: '城市等级',
      pageSize: 10,
      filterField: [{
        fieldValues: ['新一线城市', '二线城市', '三线城市', '一线城市', '四线城市', '五线城市'],
        fieldCn: '城市等级',
        fieldEn: 'cityLevel',
      }],
    },
    { panelName: '用户小区档次', pageSize: 10 },
    { panelName: '消费水平', pageSize: 10 },
    { panelName: '固定资产', pageSize: 1000 },
    {
      panelName: '品牌及 SPU 偏好-品牌【需下钻】',
      pageSize: 1000,
      orderField: ['tgi', 'brandCode'],
      orderType: 'desc',
    },
    { panelName: '品牌及 SPU 偏好-SPU', pageSize: 1000 },
    { panelName: '手机价格', pageSize: 10 },
    { panelName: '手机品牌及型号-手机品牌偏好【需下钻】', pageSize: 10 },
    { panelName: '手机品牌及型号-手机型号偏好', pageSize: 10 },
    { panelName: '内容兴趣偏好-XX 级类目', pageSize: 300 },
    {
      panelName: '内容关键词偏好【商业/社区类目】',
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelName: '搜索词偏好【商业/社区类目】',
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelName: '热点关注偏好【品牌/通用】',
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelName: '内容 KOL 偏好 - 概览【标签/粉丝量】',
      pageSize: 10,
      filterField: [{
        fieldValues: ['kolTag'],
        fieldCn: 'kol筛选【粉丝量/标签】',
        fieldEn: 'flatOption',
      }],
    },
    { panelName: '内容 KOL 偏好 - 明细【标签/粉丝量】', pageSize: 300 },
    {
      panelName: '二十大生活方式',
      pageSize: 100,
      orderField: ['tgi'],
      orderType: 'desc',
    },
    { panelName: '行业品类偏好-XX 级类目', pageSize: 100 },
    {
      panelName: '消费金额',
      pageSize: 10,
      filterField: [{ fieldValues: ['全部'], fieldCn: '事件类型筛选', fieldEn: 'flatOption' }],
    },
  ];
  const PANELS = Object.freeze(PORTRAIT_PANEL_IDS.map((panelId, index) => Object.freeze({
    panelId,
    ...PORTRAIT_PANEL_CONFIGS[index],
  })));

  const DEFAULT_GROUP_TYPES = Object.freeze([1, 2, 11, 31, 3, 21]);
  const GROUP_PAGE_SIZE = 20;
  const MAX_GROUP_PAGES = 100;

  const ROOT_ID = 'lingxi-audience-portrait-extension-root';
  const pendingRequests = new Map();
  let requestSequence = 0;
  const state = {
    open: false,
    loadingGroups: false,
    building: false,
    groups: [],
    selectedGroupIds: new Set(),
    results: [],
    progress: '',
    error: '',
  };

  function uniqueToken(prefix) {
    if (typeof crypto === 'object' && crypto && typeof crypto.randomUUID === 'function') {
      return prefix + crypto.randomUUID();
    }
    if (typeof crypto === 'object' && crypto && typeof crypto.getRandomValues === 'function') {
      const words = new Uint32Array(4);
      crypto.getRandomValues(words);
      return prefix + Array.from(words, (value) => value.toString(16).padStart(8, '0')).join('');
    }
    requestSequence += 1;
    return prefix + Date.now().toString(36) + '-' + requestSequence.toString(36);
  }

  function bridgeRequest(endpoint, payload) {
    if (!Object.values(ENDPOINTS).includes(endpoint)) {
      return Promise.reject(new Error('不支持的灵犀画像接口。'));
    }
    const requestId = uniqueToken('lingxi-request-');
    const nonce = uniqueToken('lingxi-nonce-');
    const timeoutMs = REQUEST_TIMEOUT_MS_BY_ENDPOINT[endpoint] || 45000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pendingRequest = pendingRequests.get(requestId);
        if (!pendingRequest || pendingRequest.nonce !== nonce) return;
        pendingRequests.delete(requestId);
        reject(new Error('灵犀画像请求超时，请确认页面仍处于登录状态后重试。'));
      }, timeoutMs);
      pendingRequests.set(requestId, { nonce, resolve, reject, timer });
      window.postMessage({
        channel: CHANNEL,
        type: REQUEST_TYPE,
        platform: PLATFORM,
        endpoint,
        requestId,
        nonce,
        payload: payload || {},
      }, LINGXI_ORIGIN);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== LINGXI_ORIGIN) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== RESPONSE_TYPE) return;
    if (message.platform !== PLATFORM || typeof message.requestId !== 'string') return;
    const pendingRequest = pendingRequests.get(message.requestId);
    if (!pendingRequest || message.nonce !== pendingRequest.nonce) return;
    pendingRequests.delete(message.requestId);
    clearTimeout(pendingRequest.timer);
    if (message.ok === false) {
      const error = new Error(String(message.message || '灵犀画像接口请求失败。'));
      error.code = message.code || 'LINGXI_PORTRAIT_REQUEST_FAILED';
      pendingRequest.reject(error);
      return;
    }
    pendingRequest.resolve(message.data);
  });

  function dispatchUiAction(action, payload) {
    const endpoint = UI_ACTION_ENDPOINTS[action];
    if (!endpoint) return Promise.reject(new Error('不支持的灵犀画像操作。'));
    return bridgeRequest(endpoint, payload);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function displayText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
  }

  function normalizeGroups(data) {
    const body = data && typeof data === 'object' ? data : {};
    const candidates = [body.list, body.records, body.items, body.rows, body.groupList];
    const list = candidates.find(Array.isArray) || (Array.isArray(data) ? data : []);
    const seen = new Set();
    return list.map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const displayInfo = source.displayInfo && typeof source.displayInfo === 'object'
        ? source.displayInfo
        : {};
      const rawId = source.groupId == null
        ? (source.audienceId == null ? source.id : source.audienceId)
        : source.groupId;
      const groupId = String(rawId == null ? '' : rawId).trim();
      if (!groupId || seen.has(groupId)) return null;
      seen.add(groupId);
      return {
        groupId,
        groupName: displayText(
          source.groupName || source.audienceName || source.name || source.crowdName,
          '未命名人群 ' + (index + 1),
        ),
        size: displayInfo.coveredNum == null
          ? (source.groupSize == null
              ? (source.audienceSize == null ? source.coverage : source.audienceSize)
              : source.groupSize)
          : displayInfo.coveredNum,
      };
    }).filter(Boolean);
  }

  function rawGroupList(data) {
    const body = data && typeof data === 'object' ? data : {};
    const candidates = [body.list, body.records, body.items, body.rows, body.groupList];
    return candidates.find(Array.isArray) || (Array.isArray(data) ? data : []);
  }

  function normalizeBuildResult(group, data) {
    const body = data && typeof data === 'object' ? data : {};
    const panels = Array.isArray(body.panels) ? body.panels : [];
    const warnings = Array.isArray(body.warnings)
      ? body.warnings.map((warning) => String(warning == null ? '' : warning)).filter(Boolean)
      : [];
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      collectedAt: new Date().toISOString(),
      partial: body.partial === true || warnings.length > 0 || panels.some((panel) => panel && panel.error),
      warnings,
      panels,
    };
  }

  function formatSize(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return value == null || value === '' ? '' : String(value);
    return number.toLocaleString('zh-CN');
  }

  function warningCount() {
    return state.results.reduce((total, result) => total + result.warnings.length, 0);
  }

  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ROOT_ID;
    (document.documentElement || document.body).appendChild(host);
  }
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  function groupRowsHtml() {
    if (state.loadingGroups) return '<div class="empty">正在加载灵犀人群…</div>';
    if (!state.groups.length) {
      return '<div class="empty">尚未加载人群。点击“加载人群”读取当前账号的人群列表。</div>';
    }
    return state.groups.map((group) => {
      const checked = state.selectedGroupIds.has(group.groupId) ? ' checked' : '';
      const size = formatSize(group.size);
      return '<label class="group-row">' +
        '<input type="checkbox" data-group-id="' + escapeHtml(group.groupId) + '"' + checked + '>' +
        '<span class="group-main"><strong>' + escapeHtml(group.groupName) + '</strong>' +
        '<small>ID: ' + escapeHtml(group.groupId) + (size ? ' · ' + escapeHtml(size) + ' 人' : '') +
        '</small></span></label>';
    }).join('');
  }

  function resultRowsHtml() {
    if (!state.results.length) return '';
    return state.results.map((result) => {
      const completed = result.panels.filter((panel) => panel && !panel.error).length;
      const warningItems = result.warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('');
      const status = result.partial ? '部分完成' : '完整';
      return '<article class="result-card ' + (result.partial ? 'partial' : '') + '">' +
        '<div class="result-title"><strong>' + escapeHtml(result.groupName) + '</strong>' +
        '<span>' + escapeHtml(status) + ' · ' + completed + '/' + result.panels.length + ' 面板</span></div>' +
        (warningItems ? '<ul class="warnings">' + warningItems + '</ul>' : '') +
        '</article>';
    }).join('');
  }

  function render() {
    const selectedCount = state.selectedGroupIds.size;
    const warningTotal = warningCount();
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        button, input { font: inherit; }
        .launcher {
          position: fixed; right: 22px; bottom: 88px; z-index: 2147483600;
          border: 0; border-radius: 999px; padding: 12px 17px; cursor: pointer;
          color: #fff; background: linear-gradient(135deg, #ff2442, #ff6a45);
          box-shadow: 0 10px 30px rgba(255, 36, 66, .3); font: 600 14px/20px system-ui, sans-serif;
        }
        .panel {
          position: fixed; right: 22px; bottom: 142px; z-index: 2147483600;
          width: min(430px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 174px));
          display: flex; flex-direction: column; overflow: hidden; border: 1px solid #eee;
          border-radius: 16px; background: #fff; color: #222;
          box-shadow: 0 18px 55px rgba(40, 24, 27, .22); font: 14px/1.45 system-ui, sans-serif;
        }
        .hidden { display: none; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 12px; border-bottom: 1px solid #f2f2f2; }
        .header h2 { margin: 0; font-size: 17px; }
        .header p { margin: 3px 0 0; color: #888; font-size: 12px; }
        .icon-button { border: 0; background: transparent; color: #777; cursor: pointer; font-size: 22px; padding: 2px 5px; }
        .toolbar { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 16px 8px; }
        .button { border: 1px solid #ddd; border-radius: 9px; padding: 7px 11px; background: #fff; color: #333; cursor: pointer; }
        .button:hover { border-color: #ff2442; color: #ff2442; }
        .button.primary { border-color: #ff2442; background: #ff2442; color: #fff; }
        .button:disabled { cursor: not-allowed; opacity: .5; }
        .selection-note { padding: 0 16px 8px; color: #777; font-size: 12px; }
        .group-list { margin: 0 16px; min-height: 92px; max-height: 245px; overflow: auto; border: 1px solid #eee; border-radius: 10px; }
        .group-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f3f3f3; }
        .group-row:last-child { border-bottom: 0; }
        .group-row:hover { background: #fff7f8; }
        .group-row input { margin-top: 3px; accent-color: #ff2442; }
        .group-main { display: grid; min-width: 0; }
        .group-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .group-main small { color: #999; }
        .empty { padding: 22px 16px; text-align: center; color: #999; }
        .status { margin: 10px 16px 0; padding: 9px 11px; border-radius: 8px; color: #555; background: #f7f7f8; }
        .status.error { color: #b42318; background: #fff0f0; }
        .results { padding: 10px 16px 14px; overflow: auto; }
        .result-heading { display: flex; justify-content: space-between; align-items: center; margin: 2px 0 8px; }
        .result-heading h3 { margin: 0; font-size: 14px; }
        .exports { display: flex; gap: 6px; }
        .exports .button { padding: 5px 8px; font-size: 12px; }
        .result-card { border: 1px solid #e8ece9; border-left: 3px solid #28a76f; border-radius: 9px; padding: 9px 10px; margin-top: 7px; }
        .result-card.partial { border-left-color: #f59e0b; }
        .result-title { display: flex; justify-content: space-between; gap: 10px; }
        .result-title span { color: #777; font-size: 12px; white-space: nowrap; }
        .warnings { margin: 7px 0 0; padding-left: 18px; color: #a15c00; font-size: 12px; }
      </style>
      <button class="launcher" type="button" data-action="toggle">灵犀人群画像</button>
      <section class="panel ${state.open ? '' : 'hidden'}" aria-label="灵犀人群画像工具">
        <header class="header">
          <div><h2>灵犀人群画像</h2><p>批量采集 23 个画像面板，仅使用当前页面已登录会话</p></div>
          <button class="icon-button" type="button" data-action="close" aria-label="关闭">×</button>
        </header>
        <div class="toolbar">
          <button class="button" type="button" data-action="load" ${state.loadingGroups || state.building ? 'disabled' : ''}>${state.loadingGroups ? '加载中…' : '加载人群'}</button>
          <button class="button" type="button" data-action="select-all" ${state.groups.length ? '' : 'disabled'}>全选</button>
          <button class="button" type="button" data-action="clear" ${selectedCount ? '' : 'disabled'}>清空</button>
          <button class="button primary" type="button" data-action="build" ${selectedCount && !state.building ? '' : 'disabled'}>${state.building ? '生成中…' : '生成画像'}</button>
        </div>
        <div class="selection-note">已选择 ${selectedCount} 个人群；每个人群采集 ${PANELS.length} 个面板</div>
        <div class="group-list">${groupRowsHtml()}</div>
        ${state.progress ? '<div class="status">' + escapeHtml(state.progress) + '</div>' : ''}
        ${state.error ? '<div class="status error">' + escapeHtml(state.error) + '</div>' : ''}
        ${state.results.length ? `
          <div class="results">
            <div class="result-heading"><h3>画像结果 ${state.results.length} 份${warningTotal ? ' · ' + warningTotal + ' 条提示' : ''}</h3>
              <div class="exports">
                <button class="button" type="button" data-action="export-csv">导出 CSV</button>
                <button class="button" type="button" data-action="export-json">导出 JSON</button>
              </div>
            </div>
            ${resultRowsHtml()}
          </div>` : ''}
      </section>`;
  }

  async function loadGroups() {
    state.loadingGroups = true;
    state.error = '';
    state.progress = '正在读取当前灵犀账号的人群…';
    render();
    try {
      const groups = [];
      const seenGroupIds = new Set();
      let fetchedGroupCount = 0;
      let reachedPageLimit = false;
      for (let pageNum = 1; pageNum <= MAX_GROUP_PAGES; pageNum += 1) {
        const data = await dispatchUiAction('LIST_GROUPS', {
          pageNum,
          pageSize: GROUP_PAGE_SIZE,
          types: DEFAULT_GROUP_TYPES.slice(),
          status: [],
          sourceTypeList: [],
          dmpFlag: 5,
        });
        const pageItems = rawGroupList(data);
        fetchedGroupCount += pageItems.length;
        for (const group of normalizeGroups(data)) {
          if (seenGroupIds.has(group.groupId)) continue;
          seenGroupIds.add(group.groupId);
          groups.push(group);
        }
        const rawTotal = data && data.total;
        const numericTotal = Number(rawTotal);
        const hasTotal = rawTotal !== null && rawTotal !== undefined && rawTotal !== '' &&
          Number.isFinite(numericTotal) && numericTotal >= 0;
        const reachedTotal = hasTotal && fetchedGroupCount >= numericTotal;
        const reachedEmptyPage = pageItems.length === 0;
        const reachedShortPageWithoutTotal = !hasTotal && pageItems.length < GROUP_PAGE_SIZE;
        if (reachedTotal || reachedEmptyPage || reachedShortPageWithoutTotal) break;
        reachedPageLimit = pageNum === MAX_GROUP_PAGES;
      }
      state.groups = groups;
      const available = new Set(state.groups.map((group) => group.groupId));
      state.selectedGroupIds = new Set(
        Array.from(state.selectedGroupIds).filter((groupId) => available.has(groupId)),
      );
      state.progress = state.groups.length
        ? '已加载 ' + state.groups.length + ' 个人群，可多选后生成画像。' +
          (reachedPageLimit ? ' 已达到安全分页上限。' : '')
        : '当前列表没有可采集的人群。';
    } catch (error) {
      state.groups = [];
      state.selectedGroupIds.clear();
      state.progress = '';
      state.error = error && error.message ? error.message : String(error);
    } finally {
      state.loadingGroups = false;
      render();
    }
  }

  async function buildPortraits() {
    if (state.building) return;
    const selected = state.groups.filter((group) => state.selectedGroupIds.has(group.groupId));
    if (!selected.length) {
      state.error = '请至少选择一个人群。';
      render();
      return;
    }
    state.building = true;
    state.error = '';
    state.results = [];
    render();
    for (let index = 0; index < selected.length; index += 1) {
      const group = selected[index];
      state.progress = '正在生成 ' + (index + 1) + '/' + selected.length + '：' + group.groupName;
      render();
      try {
        const data = await dispatchUiAction('BUILD_PORTRAIT', {
          groupId: group.groupId,
          panels: PANELS.map((panel) => ({ page: 1, ...panel })),
        });
        state.results.push(normalizeBuildResult(group, data));
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        state.results.push({
          groupId: group.groupId,
          groupName: group.groupName,
          collectedAt: new Date().toISOString(),
          partial: true,
          warnings: [message],
          panels: [],
        });
      }
    }
    state.building = false;
    const partialCount = state.results.filter((result) => result.partial).length;
    state.progress = '画像生成完成：' + state.results.length + ' 个人群' +
      (partialCount ? '，其中 ' + partialCount + ' 份为部分结果，请查看提示。' : '。');
    render();
  }

  function downloadBlob(filename, type, text) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportJson() {
    downloadBlob(
      'lingxi-audience-portraits.json',
      'application/json;charset=utf-8',
      JSON.stringify({ platform: PLATFORM, exportedAt: new Date().toISOString(), results: state.results }, null, 2),
    );
  }

  function csvCell(value) {
    let text = value && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    const records = [];
    for (const result of state.results) {
      for (const panel of result.panels) {
        const rows = Array.isArray(panel && panel.rows) && panel.rows.length ? panel.rows : [{}];
        for (const row of rows) {
          records.push(Object.assign({
            groupId: result.groupId,
            groupName: result.groupName,
            partial: result.partial,
            panelId: panel && panel.panelId,
            panelName: panel && panel.panelName,
            panelError: panel && panel.error,
          }, row && typeof row === 'object' ? row : { value: row }));
        }
      }
      if (!result.panels.length) {
        records.push({
          groupId: result.groupId,
          groupName: result.groupName,
          partial: true,
          panelError: result.warnings.join('；'),
        });
      }
    }
    const columns = Array.from(records.reduce((all, record) => {
      Object.keys(record).forEach((key) => all.add(key));
      return all;
    }, new Set(['groupId', 'groupName', 'partial', 'panelId', 'panelName', 'panelError'])));
    const lines = [columns.map(csvCell).join(',')];
    records.forEach((record) => lines.push(columns.map((column) => csvCell(record[column])).join(',')));
    downloadBlob('lingxi-audience-portraits.csv', 'text/csv;charset=utf-8', '\ufeff' + lines.join('\r\n'));
  }

  shadow.addEventListener('change', (event) => {
    const input = event.target;
    if (!input || !input.matches('input[data-group-id]')) return;
    const groupId = input.getAttribute('data-group-id');
    if (input.checked) state.selectedGroupIds.add(groupId);
    else state.selectedGroupIds.delete(groupId);
    render();
  });

  shadow.addEventListener('click', (event) => {
    const button = event.target && event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'toggle') {
      state.open = !state.open;
      render();
      if (state.open && !state.groups.length && !state.loadingGroups) loadGroups();
    } else if (action === 'close') {
      state.open = false;
      render();
    } else if (action === 'load') {
      loadGroups();
    } else if (action === 'select-all') {
      state.selectedGroupIds = new Set(state.groups.map((group) => group.groupId));
      render();
    } else if (action === 'clear') {
      state.selectedGroupIds.clear();
      render();
    } else if (action === 'build') {
      buildPortraits();
    } else if (action === 'export-json') {
      exportJson();
    } else if (action === 'export-csv') {
      exportCsv();
    }
  });

  render();
})();
