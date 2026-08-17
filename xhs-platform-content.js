(function installXhsPlatformContentBridge() {
  'use strict';

  if (self !== top) return;

  const CHANNEL = 'xhs-page-bridge-v2';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const PLATFORM_BY_ORIGIN = Object.freeze({
    'https://adstar.alimama.com': 'adstar',
    'https://pgy.xiaohongshu.com': 'pgy',
    'https://ad.xiaohongshu.com': 'juguang',
  });
  const ENDPOINTS = Object.freeze({
    adstar: Object.freeze([
      'projects.list', 'orders.list', 'reports.summary', 'reports.detail', 'identity.get',
    ]),
    pgy: Object.freeze(['notes.list', 'notes.sum', 'identity.get']),
    juguang: Object.freeze([
      'reports.query', 'accounts.current', 'accounts.list', 'identity.get',
    ]),
  });
  const platform = PLATFORM_BY_ORIGIN[location.origin];
  if (!platform) return;
  const INSTALL_FLAG = '__taobaoDataAssistantXhsPlatformContentV2';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  const pending = new Map();

  function payloadBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value == null ? {} : value)).byteLength;
  }

  function nonce() {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
  }

  function isAllowedRequest(message) {
    return Boolean(message) &&
      message.channel === CHANNEL &&
      message.type === REQUEST_TYPE &&
      message.platform === platform &&
      typeof message.requestId === 'string' &&
      message.requestId.length >= 8 &&
      ENDPOINTS[platform].includes(String(message.endpoint || '')) &&
      payloadBytes(message.payload) <= MAX_PAYLOAD_BYTES &&
      !pending.has(message.requestId);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAllowedRequest(message)) return false;
    const requestNonce = nonce();
    const timer = setTimeout(() => {
      const entry = pending.get(message.requestId);
      if (!entry || entry.nonce !== requestNonce) return;
      pending.delete(message.requestId);
      entry.sendResponse({
        channel: CHANNEL,
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        platform,
        ok: false,
        code: 'XHS_PAGE_BRIDGE_TIMEOUT',
        message: '平台页面响应超时。',
        retryable: true,
      });
    }, 45000);
    pending.set(message.requestId, { nonce: requestNonce, sendResponse, timer });
    window.postMessage({
      channel: CHANNEL,
      type: REQUEST_TYPE,
      requestId: message.requestId,
      platform,
      endpoint: message.endpoint,
      payload: message.payload || {},
      nonce: requestNonce,
    }, location.origin);
    return true;
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== RESPONSE_TYPE) return;
    if (message.platform !== platform || typeof message.requestId !== 'string') return;
    const entry = pending.get(message.requestId);
    if (!entry || message.nonce !== entry.nonce) return;
    pending.delete(message.requestId);
    clearTimeout(entry.timer);
    entry.sendResponse({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      requestId: message.requestId,
      platform,
      ok: message.ok !== false,
      data: message.data,
      code: message.code,
      message: message.message,
      retryable: message.retryable !== false,
    });
  });
})();
