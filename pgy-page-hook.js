(function installPgyPageHook() {
  'use strict';

  const ORIGIN = 'https://pgy.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const INSTALL_FLAG = '__taobaoDataAssistantXhsPgyHookV3';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });
  const CHANNEL = 'xhs-page-bridge-v3';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const MAX_EXPORT_FILE_BYTES = 64 * 1024 * 1024;
  const ENDPOINTS = Object.freeze({
    'identity.get': { path: '/api/solar/content/note/list', identity: true },
    'notes.list': { path: '/api/solar/content/note/list' },
    'notes.sum': { path: '/api/solar/content/note/list/sum' },
    'notes.searchKeywords': {
      path: '/api/solar/trade/note/search_keyword_data',
      method: 'GET',
      queryFields: Object.freeze(['noteId', 'orderCategory']),
    },
    'notes.linkExport.submit': {
      path: '/api/solar/common/long_task/task/submit',
      exportAction: 'submit',
    },
    'notes.linkExport.status': {
      path: '/api/solar/common/long_task/task/status',
      method: 'GET',
      queryFields: Object.freeze(['taskId']),
      exportAction: 'status',
    },
    'notes.linkExport.result': {
      path: '/api/solar/common/long_task/task/result',
      method: 'GET',
      queryFields: Object.freeze(['taskId']),
      exportAction: 'result',
    },
    'projects.list': { path: '/api/solar/content/project/third_list' },
  });
  const BODY_FIELDS = Object.freeze([
    'brandUserIds', 'startTime', 'endTime', 'pageNum', 'pageSize', 'sorts', 'sceneType',
  ]);

  function safeBody(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return Object.fromEntries(BODY_FIELDS
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]]));
  }

  function safeIdentifier(value, maxLength) {
    const text = String(value == null ? '' : value).trim();
    const limit = Math.max(1, Number(maxLength) || 128);
    return text && text.length <= limit && /^[a-z0-9_-]+$/i.test(text) ? text : '';
  }

  function safeTaskId(value) {
    const text = String(value == null ? '' : value).trim();
    return text && text.length <= 512 && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  function safeDate(value) {
    const text = String(value == null ? '' : value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function retryableApiFailure(response, body) {
    const status = Number(response && response.status);
    const bodyCode = Number(body && (body.code ?? body.status ?? body.statusCode));
    const message = String(body && (body.msg || body.message) || '').toLowerCase();
    return status === 429 || status >= 500 || bodyCode === 429 ||
      /\u8bf7\u6c42(?:\u8fc7\u4e8e|\u592a)?\u9891\u7e41|\u64cd\u4f5c\u9891\u7e41|\u9650\u6d41|\u7a0d\u540e\u91cd\u8bd5|too many requests|rate limit/.test(message);
  }

  function exportSubmitBody(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const brandUserId = safeIdentifier(source.brandUserId, 128);
    const startTime = safeDate(source.startTime);
    const endTime = safeDate(source.endTime);
    if (!brandUserId || !startTime || !endTime) {
      throw Object.assign(new Error('蒲公英官方链接导出缺少品牌账号或日期范围。'), {
        code: 'PGY_LINK_EXPORT_INPUT_INVALID',
        retryable: false,
      });
    }
    return {
      input: {
        extra: {
          reportCode: '',
          eventGroupId: '',
          bizId: '',
          operatorUserIds: [],
          brandUserIds: [brandUserId],
          kolIds: [],
          cooperateType: [],
          bizTitle: '',
          noteId: '',
          adsPromotionMode: '',
          dateType: '2',
          keyword: '',
          briefId: '',
          startTime,
          endTime,
          sorts: [],
          collectionTypeList: [],
          spuIds: [],
          projectId: '',
        },
      },
      moduleName: 'solar',
      taskName: 'content_note_download_task',
    };
  }

  function endpointBody(endpoint, payload) {
    return endpoint.exportAction === 'submit' ? exportSubmitBody(payload) : safeBody(payload);
  }

  function requestUrl(endpoint, payload) {
    const url = new URL(endpoint.path, ORIGIN);
    if (endpoint.method !== 'GET') return url.pathname;
    const source = payload && typeof payload === 'object' ? payload : {};
    for (const key of endpoint.queryFields || []) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = source[key];
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return `${url.pathname}${url.search}`;
  }

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('signature') ||
      normalized === 'sign' || normalized.includes('password') || normalized.includes('credential');
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

  function post(message, fields) {
    window.postMessage(Object.assign({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'pgy',
      requestId: message.requestId,
      nonce: message.nonce,
    }, fields), ORIGIN);
  }

  function requestOfficialLongTask(endpoint, payload) {
    const http = window.$http;
    if (!http || typeof http.post !== 'function' || typeof http.get !== 'function') {
      throw Object.assign(new Error('蒲公英官方 HTTP 客户端未加载。'), {
        code: 'PGY_OFFICIAL_HTTP_UNAVAILABLE', retryable: true,
      });
    }
    if (endpoint.exportAction === 'submit') {
      return http.post(endpoint.path, exportSubmitBody(payload), { transform: true })
        .then((data) => ({ body: { code: 0, data }, ok: true, status: 200 }));
    }
    const taskId = safeTaskId(payload && payload.taskId);
    if (!taskId) {
      throw Object.assign(new Error('蒲公英官方链接导出任务号无效。'), {
        code: 'PGY_LINK_EXPORT_TASK_ID_INVALID', retryable: false,
      });
    }
    return http.get(endpoint.path, { params: { taskId }, transform: true })
      .then((data) => ({ body: { code: 0, data }, ok: true, status: 200 }));
  }

  function requestJson(endpoint, payload) {
    if (endpoint.exportAction) return requestOfficialLongTask(endpoint, payload);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const method = endpoint.method || 'POST';
      xhr.open(method, requestUrl(endpoint, payload), true);
      xhr.withCredentials = true;
      xhr.timeout = 45000;
      if (method === 'POST') xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          const code = Number(body && body.code);
          const ok = xhr.status >= 200 && xhr.status < 300 && body && body.success !== false &&
            (!Number.isFinite(code) || code === 0 || code === 200);
          resolve({ body, ok, status: xhr.status });
        } catch (error) {
          reject(Object.assign(new Error('蒲公英接口返回了无法识别的数据。'), {
            code: 'PGY_INVALID_JSON', retryable: true,
          }));
        }
      };
      xhr.onerror = () => reject(Object.assign(new Error('蒲公英接口网络请求失败。'), {
        code: 'PGY_NETWORK_ERROR', retryable: true,
      }));
      xhr.ontimeout = () => reject(Object.assign(new Error('蒲公英接口请求超时。'), {
        code: 'PGY_TIMEOUT', retryable: true,
      }));
      xhr.send(method === 'GET' ? null : JSON.stringify(endpointBody(endpoint, payload)));
    });
  }

  function longTaskData(body) {
    let value = body && body.data;
    for (let depth = 0; depth < 4; depth += 1) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (value.taskId != null || value.task_id != null || value.status != null || value.result) {
        return value;
      }
      if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) return value;
      value = value.data;
    }
    return value;
  }

  function exportResultUrl(body) {
    const data = longTaskData(body);
    const value = data && data.result && data.result.extra && data.result.extra.url;
    const text = String(value == null ? '' : value).trim();
    let url;
    try {
      url = new URL(text);
    } catch (error) {
      return '';
    }
    return url.protocol === 'https:' && !url.username && !url.password && text.length <= 8192
      ? url.toString()
      : '';
  }

  async function downloadAndParseExport(body, payload) {
    const resultUrl = exportResultUrl(body);
    if (!resultUrl) {
      throw Object.assign(new Error('蒲公英导出任务没有返回结果文件。'), {
        code: 'PGY_LINK_EXPORT_RESULT_MISSING', retryable: true,
      });
    }
    if (typeof fetch !== 'function') {
      throw Object.assign(new Error('当前页面无法下载蒲公英导出结果。'), {
        code: 'PGY_LINK_EXPORT_DOWNLOAD_UNAVAILABLE', retryable: true,
      });
    }
    const resultOrigin = new URL(resultUrl).origin;
    const response = await fetch(resultUrl, {
      method: 'GET',
      credentials: resultOrigin === ORIGIN ? 'include' : 'omit',
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!response || !response.ok) {
      throw Object.assign(new Error(`蒲公英导出结果下载失败（HTTP ${response && response.status || 0}）。`), {
        code: 'PGY_LINK_EXPORT_DOWNLOAD_FAILED', retryable: true,
      });
    }
    const contentLength = Number(response.headers && response.headers.get &&
      response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_EXPORT_FILE_BYTES) {
      throw Object.assign(new Error('蒲公英导出结果文件超过 64 MB 安全上限。'), {
        code: 'PGY_LINK_EXPORT_FILE_TOO_LARGE', retryable: false,
      });
    }
    const parser = window.XhsPgyExportLinks;
    if (!parser || typeof parser.parseWorkbook !== 'function') {
      throw Object.assign(new Error('蒲公英导出结果解析器未加载。'), {
        code: 'PGY_LINK_EXPORT_PARSER_UNAVAILABLE', retryable: false,
      });
    }
    const workbookBuffer = await response.arrayBuffer();
    const signature = new Uint8Array(workbookBuffer, 0, Math.min(4, workbookBuffer.byteLength));
    if (!workbookBuffer.byteLength || workbookBuffer.byteLength > MAX_EXPORT_FILE_BYTES ||
        signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b ||
        signature[2] !== 0x03 || signature[3] !== 0x04) {
      throw Object.assign(new Error('蒲公英导出结果不是有效的 XLSX 文件。'), {
        code: workbookBuffer.byteLength > MAX_EXPORT_FILE_BYTES
          ? 'PGY_LINK_EXPORT_FILE_TOO_LARGE'
          : 'PGY_LINK_EXPORT_FILE_INVALID',
        retryable: workbookBuffer.byteLength <= MAX_EXPORT_FILE_BYTES,
      });
    }
    const parsed = parser.parseWorkbook(
      workbookBuffer,
      window.XLSX,
      Array.isArray(payload && payload.noteIds) ? payload.noteIds : []
    );
    return Object.assign({ taskId: safeTaskId(payload && payload.taskId) }, parsed);
  }

  async function request(message) {
    const endpoint = ENDPOINTS[message.endpoint];
    try {
      const response = await requestJson(endpoint, message.payload);
      const body = response.body;
      if (!response.ok) {
        post(message, {
          ok: false,
          code: 'PGY_API_ERROR',
          message: String(body && (body.msg || body.message) || `HTTP ${response.status}`),
          retryable: retryableApiFailure(response, body),
        });
        return;
      }
      let responseData = sanitize(body);
      if (endpoint.identity) {
        const row = body && body.data && Array.isArray(body.data.list) ? body.data.list[0] : null;
        const brandUserId = row && (row.reportBrandUserId || row.operateUserId);
        if (!brandUserId) {
          post(message, { ok: false, code: 'PGY_IDENTITY_UNAVAILABLE', message: '无法从蒲公英笔记数据识别当前品牌账号。', retryable: false });
          return;
        }
        responseData = {
          brandUserId: String(brandUserId),
          brandUserName: String(row.reportBrandUserName || row.operateUserName || ''),
        };
      } else if (endpoint.exportAction === 'submit') {
        const data = longTaskData(body);
        const taskId = safeTaskId(data && (data.taskId || data.task_id));
        if (!taskId) throw Object.assign(new Error('蒲公英导出任务未返回 taskId。'), {
          code: 'PGY_LINK_EXPORT_TASK_ID_MISSING', retryable: true,
        });
        responseData = { taskId };
      } else if (endpoint.exportAction === 'status') {
        const data = longTaskData(body);
        const status = Number(data && data.status);
        if (!Number.isFinite(status)) throw Object.assign(new Error('蒲公英导出任务状态无效。'), {
          code: 'PGY_LINK_EXPORT_STATUS_INVALID', retryable: true,
        });
        responseData = { status };
      } else if (endpoint.exportAction === 'result') {
        responseData = await downloadAndParseExport(body, message.payload);
      }
      post(message, { ok: true, data: responseData });
    } catch (error) {
      post(message, {
        ok: false,
        code: String(error && error.code || 'PGY_LINK_EXPORT_FAILED'),
        message: String(error && error.message || '蒲公英官方链接导出失败。'),
        retryable: !error || error.retryable !== false,
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
    if (message.platform !== 'pgy' || !Object.prototype.hasOwnProperty.call(ENDPOINTS, message.endpoint)) return;
    if (typeof message.requestId !== 'string' || !message.requestId || typeof message.nonce !== 'string' || !message.nonce) return;
    if (new TextEncoder().encode(JSON.stringify(message.payload || {})).byteLength > MAX_PAYLOAD_BYTES) return;
    request(message);
  });
})();
