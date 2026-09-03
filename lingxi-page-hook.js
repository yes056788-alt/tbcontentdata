(function installLingxiPageHook() {
  'use strict';

  const ORIGIN = 'https://idea.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;

  const INSTALL_FLAG = '__taobaoDataAssistantXhsLingxiHookV1';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  const CHANNEL = 'xhs-page-bridge-v2';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const PLATFORM = 'lingxi';
  const GROUP_LIST_PATH = '/api/idea/audience/group/list';
  const PORTRAIT_PANEL_PATH = '/api/idea/audience/portrait/panel/view';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const MAX_ID_LENGTH = 256;
  const MAX_PANEL_NAME_LENGTH = 100;
  // idea.xiaohongshu.com uses the public/EXT audience branch. These are the
  // six official creation types: upload, rule, other, extend, lookalike, source.
  const DEFAULT_GROUP_TYPES = Object.freeze([1, 2, 11, 31, 3, 21]);

  const PANEL_IDS = [
    1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21, 23, 25, 28, 30,
    31, 32, 33,
  ];
  const OFFICIAL_PANEL_CONFIGS = [
    {
      panelId: 1,
      panelName: '预测性别',
      page: 1,
      pageSize: 10,
      filterField: [{ fieldValues: ['男', '女'], fieldCn: '预测性别', fieldEn: 'sex' }],
    },
    { panelId: 2, panelName: '预测年龄', page: 1, pageSize: 10 },
    { panelId: 3, panelName: '婚恋状态', page: 1, pageSize: 1000 },
    { panelId: 4, panelName: '母婴阶段', page: 1, pageSize: 1000 },
    {
      panelId: 5,
      panelName: '地域分布-省份/区域/城市',
      page: 1,
      pageSize: 30,
      filterField: [{ fieldValues: ['province'], fieldCn: '地域等级', fieldEn: 'flatOption' }],
    },
    {
      panelId: 8,
      panelName: '城市等级',
      page: 1,
      pageSize: 10,
      filterField: [{
        fieldValues: ['新一线城市', '二线城市', '三线城市', '一线城市', '四线城市', '五线城市'],
        fieldCn: '城市等级',
        fieldEn: 'cityLevel',
      }],
    },
    { panelId: 9, panelName: '用户小区档次', page: 1, pageSize: 10 },
    { panelId: 10, panelName: '消费水平', page: 1, pageSize: 10 },
    { panelId: 11, panelName: '固定资产', page: 1, pageSize: 1000 },
    {
      panelId: 12,
      panelName: '品牌及 SPU 偏好-品牌【需下钻】',
      page: 1,
      pageSize: 1000,
      orderField: ['tgi', 'brandCode'],
      orderType: 'desc',
    },
    { panelId: 13, panelName: '品牌及 SPU 偏好-SPU', page: 1, pageSize: 1000 },
    { panelId: 14, panelName: '手机价格', page: 1, pageSize: 10 },
    { panelId: 15, panelName: '手机品牌及型号-手机品牌偏好【需下钻】', page: 1, pageSize: 10 },
    { panelId: 16, panelName: '手机品牌及型号-手机型号偏好', page: 1, pageSize: 10 },
    { panelId: 17, panelName: '内容兴趣偏好-XX 级类目', page: 1, pageSize: 300 },
    {
      panelId: 21,
      panelName: '内容关键词偏好【商业/社区类目】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 23,
      panelName: '搜索词偏好【商业/社区类目】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 25,
      panelName: '热点关注偏好【品牌/通用】',
      page: 1,
      pageSize: 100,
      orderField: ['tgi', 'item'],
      orderType: 'desc',
    },
    {
      panelId: 28,
      panelName: '内容 KOL 偏好 - 概览【标签/粉丝量】',
      page: 1,
      pageSize: 10,
      filterField: [{
        fieldValues: ['kolTag'],
        fieldCn: 'kol筛选【粉丝量/标签】',
        fieldEn: 'flatOption',
      }],
    },
    { panelId: 30, panelName: '内容 KOL 偏好 - 明细【标签/粉丝量】', page: 1, pageSize: 300 },
    {
      panelId: 31,
      panelName: '二十大生活方式',
      page: 1,
      pageSize: 100,
      orderField: ['tgi'],
      orderType: 'desc',
    },
    { panelId: 32, panelName: '行业品类偏好-XX 级类目', page: 1, pageSize: 100 },
    {
      panelId: 33,
      panelName: '消费金额',
      page: 1,
      pageSize: 10,
      filterField: [{ fieldValues: ['全部'], fieldCn: '事件类型筛选', fieldEn: 'flatOption' }],
    },
  ];
  const PANEL_NAMES = Object.freeze(Object.fromEntries(OFFICIAL_PANEL_CONFIGS.map((panel) => (
    [panel.panelId, panel.panelName]
  ))));
  const PANEL_CONFIG_BY_ID = new Map(OFFICIAL_PANEL_CONFIGS.map((panel) => [panel.panelId, panel]));
  const PANEL_ID_SET = new Set(PANEL_IDS);
  const DEFAULT_PANELS = Object.freeze(OFFICIAL_PANEL_CONFIGS.map((panel) => Object.freeze(panel)));

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor' ||
      normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('headers') ||
      normalized.includes('signature') || normalized.includes('password') ||
      normalized.includes('credential') || normalized.includes('secret') ||
      normalized.includes('session') || normalized.includes('csrf') ||
      normalized === 'sign' || normalized === 'xs' || normalized.startsWith('xsec');
  }

  function sanitize(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        for (const key of Array.from(url.searchParams.keys())) {
          if (isSensitiveKey(key)) url.searchParams.delete(key);
        }
        return url.toString();
      } catch (error) {
        return value;
      }
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sanitize);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, item]) => [key, sanitize(item)]));
  }

  function safeErrorMessage(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const message = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
    if (!message || /(?:authorization|cookie|token|credential|password|secret|session|x-sec)/i.test(message)) {
      return fallback;
    }
    return message;
  }

  function bridgeError(code, message, retryable) {
    const error = new Error(message);
    error.code = code;
    error.retryable = Boolean(retryable);
    return error;
  }

  function responseData(body) {
    return Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : {};
  }

  function assertSuccessfulResponse(body, status) {
    if (!isRecord(body)) {
      throw bridgeError('LINGXI_INVALID_RESPONSE', '灵犀接口返回了无法识别的数据。', true);
    }
    const numericCode = body.code === undefined || body.code === null || body.code === ''
      ? null
      : Number(body.code);
    const businessFailed = body.success === false ||
      (numericCode !== null && Number.isFinite(numericCode) && numericCode !== 0 && numericCode !== 200);
    const httpFailed = status < 200 || status >= 300;
    if (httpFailed || businessFailed) {
      const fallback = httpFailed ? '灵犀接口请求失败。' : '灵犀接口返回业务错误。';
      throw bridgeError(
        httpFailed ? 'LINGXI_HTTP_ERROR' : 'LINGXI_API_ERROR',
        safeErrorMessage(body.msg || body.message, fallback),
        httpFailed && (status === 0 || status === 408 || status === 429 || status >= 500),
      );
    }
  }

  function postJson(path, body) {
    if (path !== GROUP_LIST_PATH && path !== PORTRAIT_PANEL_PATH) {
      return Promise.reject(bridgeError('LINGXI_PATH_NOT_ALLOWED', '灵犀接口不在允许范围内。', false));
    }

    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN) {
      return Promise.reject(bridgeError('LINGXI_ORIGIN_NOT_ALLOWED', '灵犀接口来源不合法。', false));
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };

      xhr.open('POST', url.toString(), true);
      xhr.withCredentials = true;
      xhr.timeout = 45000;
      xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
      xhr.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(xhr.responseText || '{}');
          assertSuccessfulResponse(parsed, Number(xhr.status) || 0);
        } catch (error) {
          const safeError = error && error.code
            ? error
            : bridgeError('LINGXI_INVALID_JSON', '灵犀接口返回了无法识别的数据。', true);
          finish(reject, safeError);
          return;
        }
        finish(resolve, responseData(parsed));
      };
      xhr.onerror = () => finish(reject, bridgeError(
        'LINGXI_NETWORK_ERROR', '灵犀接口网络请求失败。', true,
      ));
      xhr.ontimeout = () => finish(reject, bridgeError(
        'LINGXI_TIMEOUT', '灵犀接口请求超时。', true,
      ));
      xhr.onabort = () => finish(reject, bridgeError(
        'LINGXI_ABORTED', '灵犀接口请求已取消。', true,
      ));
      try {
        xhr.send(JSON.stringify(body));
      } catch (error) {
        finish(reject, bridgeError('LINGXI_REQUEST_ERROR', '灵犀接口请求无法发送。', false));
      }
    });
  }

  function integerInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
  }

  function safeScalarArray(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).filter((item) => (
      typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    )).map((item) => typeof item === 'string' ? item.trim().slice(0, 100) : item);
  }

  function safeString(value, maximumLength) {
    if (typeof value !== 'string') return null;
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximumLength);
    return clean || null;
  }

  function safeStringArray(value, maximumItems, maximumLength) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maximumItems)
      .map((item) => safeString(item, maximumLength))
      .filter((item) => item !== null);
  }

  function safeFilterField(value) {
    if (!Array.isArray(value)) return null;
    const fields = [];
    for (const candidate of value.slice(0, 50)) {
      if (!isRecord(candidate)) continue;
      const field = {};
      const fieldEn = safeString(candidate.fieldEn, 100);
      const fieldCn = safeString(candidate.fieldCn, 100);
      if (fieldEn !== null) field.fieldEn = fieldEn;
      if (fieldCn !== null) field.fieldCn = fieldCn;
      if (Array.isArray(candidate.fieldValues)) {
        field.fieldValues = safeStringArray(candidate.fieldValues, 100, 200);
      }
      if (Object.keys(field).length > 0) fields.push(field);
    }
    return fields;
  }

  function groupListBody(payload) {
    const source = isRecord(payload) ? payload : {};
    const requestedTypes = safeScalarArray(source.types);
    return {
      pageNum: integerInRange(source.pageNum, 1, 1, 100000),
      pageSize: integerInRange(source.pageSize, 20, 1, 20),
      types: requestedTypes.length ? requestedTypes : DEFAULT_GROUP_TYPES.slice(),
      status: safeScalarArray(source.status),
      sourceTypeList: safeScalarArray(source.sourceTypeList),
      dmpFlag: 5,
    };
  }

  function requiredGroupId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const groupId = value.trim();
      if (groupId && groupId.length <= MAX_ID_LENGTH) return groupId;
    }
    throw bridgeError('LINGXI_INVALID_PAYLOAD', '缺少有效的人群 ID。', false);
  }

  function requiredPanelId(value) {
    const panelId = Number(value);
    if (!Number.isInteger(panelId) || !PANEL_ID_SET.has(panelId)) {
      throw bridgeError('LINGXI_INVALID_PAYLOAD', '画像面板 ID 不在允许范围内。', false);
    }
    return panelId;
  }

  function safePanelName(value, panelId) {
    const panelName = safeString(value, MAX_PANEL_NAME_LENGTH);
    if (panelName !== null) return panelName;
    return PANEL_NAMES[panelId];
  }

  function panelBody(payload) {
    const source = isRecord(payload) ? payload : {};
    const panelId = requiredPanelId(source.panelId);
    const official = PANEL_CONFIG_BY_ID.get(panelId);
    const body = {
      groupId: requiredGroupId(source.groupId),
      panelId,
      panelName: safePanelName(source.panelName, panelId),
      page: integerInRange(source.page, official.page, 1, 100000),
      pageSize: integerInRange(source.pageSize, official.pageSize, 1, 1000),
      bizType: 'EXT_IDEA_AUDIENCE',
    };
    const filterField = safeFilterField(source.filterField);
    if (filterField !== null) body.filterField = filterField;
    if (Array.isArray(source.orderField)) {
      body.orderField = safeStringArray(source.orderField, 20, 100);
    }
    if (source.orderType === 'asc' || source.orderType === 'desc') {
      body.orderType = source.orderType;
    }
    return body;
  }

  function headerFieldName(header) {
    if (!isRecord(header)) return '';
    return header.fieldEn || header.field || header.key || header.dataIndex || '';
  }

  function normalizeHeader(header) {
    const fieldName = headerFieldName(header);
    if (!fieldName || isSensitiveKey(fieldName)) return null;
    const clean = sanitize(header);
    return isRecord(clean) ? clean : null;
  }

  function normalizePanel(data) {
    const source = isRecord(data) ? data : {};
    const headers = Array.isArray(source.headers)
      ? source.headers.map(normalizeHeader).filter(Boolean)
      : [];
    const dimensions = headers.filter((header) => (
      String(header.fieldType || '').toLowerCase() === 'xindex'
    ));
    const metrics = headers.filter((header) => (
      String(header.fieldType || '').toLowerCase().startsWith('yindex')
    ));
    const tableResult = Array.isArray(source.tableResult)
      ? source.tableResult
      : (Array.isArray(source.rows) ? source.rows : []);
    const rows = tableResult.map(sanitize).filter(isRecord);
    const numericTotal = Number(source.total);
    return {
      panelType: typeof source.panelType === 'string' ? source.panelType.slice(0, 50) : 'TABLE',
      dimensions,
      metrics,
      rows,
      total: Number.isFinite(numericTotal) && numericTotal >= 0 ? numericTotal : rows.length,
    };
  }

  async function listGroups(payload) {
    return sanitize(await postJson(GROUP_LIST_PATH, groupListBody(payload)));
  }

  async function getPortraitPanel(payload) {
    return normalizePanel(await postJson(PORTRAIT_PANEL_PATH, panelBody(payload)));
  }

  function requestedPanels(payload) {
    const source = isRecord(payload) ? payload : {};
    if (!Array.isArray(source.panels) || source.panels.length === 0) return DEFAULT_PANELS;
    const panels = [];
    const seen = new Set();
    for (const candidate of source.panels.slice(0, PANEL_IDS.length)) {
      if (!isRecord(candidate)) {
        throw bridgeError('LINGXI_INVALID_PAYLOAD', '画像面板配置不合法。', false);
      }
      const panelId = requiredPanelId(candidate.panelId);
      if (seen.has(panelId)) continue;
      seen.add(panelId);
      const official = PANEL_CONFIG_BY_ID.get(panelId);
      const panel = {
        panelId,
        panelName: safePanelName(candidate.panelName, panelId),
        page: integerInRange(candidate.page, official.page, 1, 100000),
        pageSize: integerInRange(candidate.pageSize, official.pageSize, 1, 1000),
      };
      const filterSource = Object.prototype.hasOwnProperty.call(candidate, 'filterField')
        ? candidate.filterField
        : official.filterField;
      const filterField = safeFilterField(filterSource);
      if (filterField !== null) panel.filterField = filterField;
      const orderFieldSource = Object.prototype.hasOwnProperty.call(candidate, 'orderField')
        ? candidate.orderField
        : official.orderField;
      if (Array.isArray(orderFieldSource)) {
        panel.orderField = safeStringArray(orderFieldSource, 20, 100);
      }
      const orderTypeSource = Object.prototype.hasOwnProperty.call(candidate, 'orderType')
        ? candidate.orderType
        : official.orderType;
      if (orderTypeSource === 'asc' || orderTypeSource === 'desc') {
        panel.orderType = orderTypeSource;
      }
      panels.push(panel);
    }
    return panels;
  }

  async function buildPortrait(payload) {
    const source = isRecord(payload) ? payload : {};
    const groupId = requiredGroupId(source.groupId);
    const panels = requestedPanels(source);
    const results = [];
    const warnings = [];

    for (const panel of panels) {
      try {
        const panelRequest = {
          groupId,
          panelId: panel.panelId,
          panelName: panel.panelName,
          page: panel.page,
          pageSize: panel.pageSize,
        };
        if (Object.prototype.hasOwnProperty.call(panel, 'filterField')) {
          panelRequest.filterField = panel.filterField;
        }
        if (Object.prototype.hasOwnProperty.call(panel, 'orderField')) {
          panelRequest.orderField = panel.orderField;
        }
        if (Object.prototype.hasOwnProperty.call(panel, 'orderType')) {
          panelRequest.orderType = panel.orderType;
        }
        const normalized = await getPortraitPanel(panelRequest);
        results.push(Object.assign({
          panelId: panel.panelId,
          panelName: panel.panelName,
        }, normalized));
      } catch (error) {
        const message = safeErrorMessage(
          error && error.message,
          '该画像面板采集失败。',
        );
        results.push({
          panelId: panel.panelId,
          panelName: panel.panelName,
          dimensions: [],
          metrics: [],
          rows: [],
          total: 0,
          error: message,
        });
        warnings.push(panel.panelName + '：' + message);
      }
    }

    return {
      groupId,
      panels: results,
      partial: warnings.length > 0,
      warnings,
    };
  }

  const HANDLERS = Object.freeze({
    'listGroups': listGroups,
    'getPortraitPanel': getPortraitPanel,
    'buildPortrait': buildPortrait,
  });

  function postResponse(message, fields) {
    const response = Object.assign({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: PLATFORM,
      requestId: message.requestId,
      nonce: message.nonce,
    }, fields);
    window.postMessage(sanitize(response), ORIGIN);
  }

  function validCorrelationValue(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
  }

  function payloadFits(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value || {})).byteLength <= MAX_PAYLOAD_BYTES;
    } catch (error) {
      return false;
    }
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!isRecord(message) || message.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
    if (message.platform !== PLATFORM || !Object.prototype.hasOwnProperty.call(HANDLERS, message.endpoint)) return;
    if (!validCorrelationValue(message.requestId) || !validCorrelationValue(message.nonce)) return;
    if (!payloadFits(message.payload)) return;

    try {
      const data = await HANDLERS[message.endpoint](message.payload || {});
      postResponse(message, { ok: true, data });
    } catch (error) {
      postResponse(message, {
        ok: false,
        code: error && error.code || 'LINGXI_REQUEST_FAILED',
        message: safeErrorMessage(error && error.message, '灵犀画像采集失败。'),
        retryable: Boolean(error && error.retryable),
      });
    }
  });
})();
