(function installPgyPageHook() {
  'use strict';

  const ORIGIN = 'https://pgy.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const CHANNEL = 'xhs-page-bridge-v1';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const ENDPOINTS = Object.freeze({
    'notes.list': '/api/solar/content/note/list',
    'notes.sum': '/api/solar/content/note/list/sum',
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

  function post(message, fields) {
    window.postMessage(Object.assign({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'pgy',
      requestId: message.requestId,
      nonce: message.nonce,
    }, fields), ORIGIN);
  }

  function request(message) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ENDPOINTS[message.endpoint], true);
    xhr.withCredentials = true;
    xhr.timeout = 45000;
    xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        const code = Number(body && body.code);
        const ok = xhr.status >= 200 && xhr.status < 300 && body && body.success !== false &&
          (!Number.isFinite(code) || code === 0 || code === 200);
        post(message, ok
          ? { ok: true, data: body }
          : { ok: false, code: 'PGY_API_ERROR', message: String(body && (body.msg || body.message) || `HTTP ${xhr.status}`), retryable: xhr.status >= 500 });
      } catch (error) {
        post(message, { ok: false, code: 'PGY_INVALID_JSON', message: '蒲公英接口返回了无法识别的数据。', retryable: true });
      }
    };
    xhr.onerror = () => post(message, { ok: false, code: 'PGY_NETWORK_ERROR', message: '蒲公英接口网络请求失败。', retryable: true });
    xhr.ontimeout = () => post(message, { ok: false, code: 'PGY_TIMEOUT', message: '蒲公英接口请求超时。', retryable: true });
    xhr.send(JSON.stringify(safeBody(message.payload)));
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
