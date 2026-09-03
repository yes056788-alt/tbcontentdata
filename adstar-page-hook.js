(function installAdstarPageHook() {
  'use strict';

  const ORIGIN = 'https://adstar.alimama.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const INSTALL_FLAG = '__taobaoDataAssistantXhsAdstarHookV3';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });
  const CHANNEL = 'xhs-page-bridge-v3';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const LOGIN_INFO_RETRY_DELAY_MS = 800;
  const LOGIN_INFO_RETRY_CODE = 'GET_USER_LOGIN_INFO_ERROR';
  const ENDPOINTS = Object.freeze({
    'projects.list': {
      path: '/api/one/deliveryProject/list',
      fields: ['pageNo', 'pageSize'],
    },
    'orders.list': {
      path: '/api/one/order/list',
      fields: ['saleType', 'memberType', 'pageNo', 'pageSize'],
    },
    'reports.summary': {
      path: '/api/report/multiscene/query/summary/data',
      fields: ['bizType', 'startTime', 'endTime', 'ext'],
    },
    'reports.detail': {
      path: '/api/report/multiscene/query/detail/data',
      fields: ['bizType', 'dataBatch', 'startTime', 'endTime', 'ext', 'pageNo', 'pageSize', 'orderByColumn', 'orderByDirection'],
    },
  });

  function currentToken() {
    const match = document.cookie.match(/(?:^|;\s*)_tb_token_=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
    for (const entry of performance.getEntriesByType('resource')) {
      try {
        const token = new URL(entry.name).searchParams.get('_tb_token_');
        if (token) return token;
      } catch (error) {}
    }
    return '';
  }

  function post(message, fields) {
    window.postMessage(Object.assign({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'adstar',
      requestId: message.requestId,
      nonce: message.nonce,
    }, fields), ORIGIN);
  }

  function sensitiveDiagnosticKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('signature') ||
      normalized === 'sign' || normalized === 'xs' || normalized === 'xsign' ||
      normalized.startsWith('xsec') || normalized.startsWith('csrf') ||
      normalized.includes('password') || normalized.includes('credential') ||
      normalized === 'secret' || normalized.endsWith('secretkey') ||
      normalized.endsWith('secretvalue') || normalized === 'sessionid' ||
      normalized === 'setcookie' || normalized.endsWith('accesskey') ||
      normalized.endsWith('apikey');
  }

  function diagnosticHashHasSensitiveKey(hash) {
    const source = String(hash || '');
    for (const match of source.matchAll(/(?:^|[?&#])([^=&#?]+)=/g)) {
      let key = match[1];
      try {
        key = decodeURIComponent(key);
      } catch (error) {}
      if (sensitiveDiagnosticKey(key)) return true;
    }
    return false;
  }

  function safeDiagnosticText(value) {
    return String(value == null ? '' : value)
      .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
        try {
          const url = new URL(candidate);
          for (const key of Array.from(url.searchParams.keys())) {
            if (sensitiveDiagnosticKey(key)) url.searchParams.delete(key);
          }
          if (diagnosticHashHasSensitiveKey(url.hash)) url.hash = '';
          return url.toString();
        } catch (error) {
          return '[redacted-url]';
        }
      })
      .replace(/\b(?:proxy-)?authorization\s*[:=]\s*[^;,\r\n]+/gi, '[redacted]')
      .replace(
        /\b[a-z0-9_.-]*(?:token|cookie|signature|password|credential|session[_-]?id|secret|csrf|access[_-]?key|api[_-]?key)[a-z0-9_.-]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
        '[redacted]'
      );
  }

  function businessError(body, status) {
    const source = body && typeof body === 'object' ? body : {};
    const businessCode = safeDiagnosticText(
      source.msgCode || source.errorCode || source.subCode ||
      (source.code == null ? '' : source.code)
    ).trim().replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 120);
    const detail = safeDiagnosticText(
      source.msgInfo || source.errorMsg || source.msg || source.message || ''
    ).trim().slice(0, 240);
    return {
      businessCode,
      message: `${businessCode ? `[${businessCode}] ` : ''}${detail || `HTTP ${status}`}`,
    };
  }

  function request(message, loginInfoRetryCount) {
    const token = currentToken();
    if (!token) {
      post(message, { ok: false, code: 'ADSTAR_TOKEN_MISSING', message: '星河登录态已失效，请重新登录。', retryable: false });
      return;
    }
    const endpoint = ENDPOINTS[message.endpoint];
    const source = message.payload && typeof message.payload === 'object' ? message.payload : {};
    const url = new URL(endpoint.path, ORIGIN);
    for (const key of endpoint.fields) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = source[key];
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    url.searchParams.set('bizCode', 'adstar');
    url.searchParams.set('_tb_token_', token);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', url.toString(), true);
    xhr.withCredentials = true;
    xhr.timeout = 45000;
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        const code = Number(body && body.code);
        const ok = xhr.status >= 200 && xhr.status < 300 && body && body.success !== false &&
          (!Number.isFinite(code) || code === 0 || code === 200);
        if (ok) {
          post(message, { ok: true, data: body });
          return;
        }
        const diagnostic = businessError(body, xhr.status);
        const retries = Math.max(0, Number(loginInfoRetryCount) || 0);
        if (diagnostic.businessCode === LOGIN_INFO_RETRY_CODE && retries < 1) {
          setTimeout(() => request(message, retries + 1), LOGIN_INFO_RETRY_DELAY_MS);
          return;
        }
        post(message, {
          ok: false,
          code: 'ADSTAR_API_ERROR',
          businessCode: diagnostic.businessCode || undefined,
          endpoint: message.endpoint,
          message: diagnostic.message,
          retryable: xhr.status >= 500,
        });
      } catch (error) {
        post(message, { ok: false, code: 'ADSTAR_INVALID_JSON', message: '星河接口返回了无法识别的数据。', retryable: true });
      }
    };
    xhr.onerror = () => post(message, { ok: false, code: 'ADSTAR_NETWORK_ERROR', message: '星河接口网络请求失败。', retryable: true });
    xhr.ontimeout = () => post(message, { ok: false, code: 'ADSTAR_TIMEOUT', message: '星河接口请求超时。', retryable: true });
    xhr.send();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
    if (message.platform !== 'adstar' || !Object.prototype.hasOwnProperty.call(ENDPOINTS, message.endpoint)) return;
    if (typeof message.requestId !== 'string' || !message.requestId || typeof message.nonce !== 'string' || !message.nonce) return;
    if (new TextEncoder().encode(JSON.stringify(message.payload || {})).byteLength > MAX_PAYLOAD_BYTES) return;
    request(message);
  });
})();
