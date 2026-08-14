(function installPgyPageHook() {
  'use strict';

  const ORIGIN = 'https://pgy.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const CHANNEL = 'xhs-page-bridge-v1';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const ENDPOINTS = Object.freeze({
    'identity.get': { path: '/api/solar/content/note/list', identity: true },
    'notes.list': { path: '/api/solar/content/note/list' },
    'notes.sum': { path: '/api/solar/content/note/list/sum' },
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

  function request(message) {
    const endpoint = ENDPOINTS[message.endpoint];
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint.path, true);
    xhr.withCredentials = true;
    xhr.timeout = 45000;
    xhr.setRequestHeader('content-type', 'application/json;charset=UTF-8');
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        const code = Number(body && body.code);
        const ok = xhr.status >= 200 && xhr.status < 300 && body && body.success !== false &&
          (!Number.isFinite(code) || code === 0 || code === 200);
        let responseData = sanitize(body);
        if (ok && endpoint.identity) {
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
        }
        post(message, ok
          ? { ok: true, data: responseData }
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
