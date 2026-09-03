(function installXhsPlatformContentBridge() {
  'use strict';

  if (self !== top) return;

  const CHANNEL = 'xhs-page-bridge-v3';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const DEFAULT_BRIDGE_TIMEOUT_MS = 45 * 1000;
  const LINK_EXPORT_RESULT_TIMEOUT_MS = 3 * 60 * 1000;
  const PLATFORM_BY_ORIGIN = Object.freeze({
    'https://adstar.alimama.com': 'adstar',
    'https://pgy.xiaohongshu.com': 'pgy',
    'https://ad.xiaohongshu.com': 'juguang',
  });
  const ENDPOINTS = Object.freeze({
    adstar: Object.freeze([
      'projects.list', 'orders.list', 'reports.summary', 'reports.detail', 'identity.get',
    ]),
    pgy: Object.freeze([
      'notes.list', 'notes.sum', 'notes.searchKeywords',
      'notes.linkExport.submit', 'notes.linkExport.status', 'notes.linkExport.result',
      'projects.list', 'identity.get',
    ]),
    juguang: Object.freeze([
      'reports.query', 'accounts.current', 'accounts.list', 'identity.get',
    ]),
  });
  const platform = PLATFORM_BY_ORIGIN[location.origin];
  if (!platform) return;
  const INSTALL_STATE_KEY = '__taobaoDataAssistantXhsPlatformContentV4';
  const previousInstall = window[INSTALL_STATE_KEY];
  const previousRuntimeListener = previousInstall && previousInstall.runtimeListener;
  let previousReceiverActive = false;
  if (typeof previousRuntimeListener === 'function') {
    try {
      previousReceiverActive = typeof chrome.runtime.onMessage.hasListener === 'function'
        ? chrome.runtime.onMessage.hasListener(previousRuntimeListener)
        : true;
    } catch (error) {
      previousReceiverActive = false;
    }
  }
  if (previousReceiverActive) return;
  if (previousInstall && typeof previousInstall.windowListener === 'function' &&
      typeof window.removeEventListener === 'function') {
    window.removeEventListener('message', previousInstall.windowListener);
  }

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

  function bridgeTimeoutMs(endpoint) {
    return endpoint === 'notes.linkExport.result'
      ? LINK_EXPORT_RESULT_TIMEOUT_MS
      : DEFAULT_BRIDGE_TIMEOUT_MS;
  }

  const runtimeListener = (message, sender, sendResponse) => {
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
    }, bridgeTimeoutMs(message.endpoint));
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
  };
  chrome.runtime.onMessage.addListener(runtimeListener);

  const windowListener = (event) => {
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
  };
  window.addEventListener('message', windowListener);

  const installState = { runtimeListener, windowListener };
  try {
    Object.defineProperty(window, INSTALL_STATE_KEY, {
      value: installState,
      configurable: true,
      writable: true,
    });
  } catch (error) {
    try { window[INSTALL_STATE_KEY] = installState; } catch (assignmentError) {}
  }
})();
