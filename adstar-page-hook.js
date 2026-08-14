(function installAdstarPageHook() {
  'use strict';

  const ORIGIN = 'https://adstar.alimama.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const CHANNEL = 'xhs-page-bridge-v1';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
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

  function request(message) {
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
        post(message, ok
          ? { ok: true, data: body }
          : { ok: false, code: 'ADSTAR_API_ERROR', message: String(body && (body.msg || body.message) || `HTTP ${xhr.status}`), retryable: xhr.status >= 500 });
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
