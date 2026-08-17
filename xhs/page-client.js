(function initXhsPageClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsPageClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsPageClientApi() {
  'use strict';

  const CHANNEL = 'xhs-page-bridge-v2';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const ENDPOINTS = Object.freeze({
    adstar: Object.freeze([
      'projects.list', 'orders.list', 'reports.summary', 'reports.detail', 'identity.get',
    ]),
    pgy: Object.freeze(['notes.list', 'notes.sum', 'identity.get']),
    juguang: Object.freeze([
      'reports.query', 'accounts.current', 'accounts.list', 'identity.get',
    ]),
  });

  function payloadBytes(value) {
    const serialized = JSON.stringify(value == null ? {} : value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
    return unescape(encodeURIComponent(serialized)).length;
  }

  function requestId() {
    if (typeof crypto === 'object' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `xhs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function assertRequest(input) {
    const request = input && typeof input === 'object' ? input : {};
    const platform = String(request.platform || '');
    const endpoint = String(request.endpoint || '');
    if (!Object.prototype.hasOwnProperty.call(ENDPOINTS, platform)) {
      throw new Error(`Unsupported XHS platform: ${platform || '(missing)'}`);
    }
    if (!ENDPOINTS[platform].includes(endpoint)) {
      throw new Error(`Endpoint is not allowed for ${platform}: ${endpoint || '(missing)'}`);
    }
    if (!Number.isInteger(Number(request.tabId)) || Number(request.tabId) < 0) {
      throw new Error('A valid platform tabId is required.');
    }
    if (payloadBytes(request.payload) > MAX_PAYLOAD_BYTES) {
      throw new Error('XHS page request payload exceeds the 64 KB limit.');
    }
    return { platform, endpoint, tabId: Number(request.tabId), payload: request.payload || {} };
  }

  function validateResponse(response, request) {
    if (!response || typeof response !== 'object') throw new Error('XHS page returned no response.');
    if (response.channel !== CHANNEL || response.type !== RESPONSE_TYPE) {
      throw new Error('XHS page returned an invalid response envelope.');
    }
    if (response.requestId !== request.requestId) {
      throw new Error('XHS page response requestId does not match the request.');
    }
    if (response.platform !== request.platform) {
      throw new Error('XHS page response platform does not match the request.');
    }
    if (response.ok === false) {
      const error = new Error(String(response.message || 'XHS page request failed.'));
      error.code = response.code || 'XHS_PAGE_REQUEST_FAILED';
      error.retryable = response.retryable !== false;
      throw error;
    }
    return response.data;
  }

  function createPageClient(options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (typeof settings.sendMessage !== 'function') throw new Error('sendMessage is required.');
    const defaultTimeoutMs = Math.max(1, Number(settings.timeoutMs) || 45000);

    return Object.freeze({
      async request(input) {
        const safe = assertRequest(input);
        const envelope = {
          channel: CHANNEL,
          type: REQUEST_TYPE,
          requestId: requestId(),
          platform: safe.platform,
          endpoint: safe.endpoint,
          payload: safe.payload,
        };
        const timeoutMs = Math.max(1, Number(input && input.timeoutMs) || defaultTimeoutMs);
        let timer;
        const timeout = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`XHS page request timeout after ${timeoutMs} ms.`)), timeoutMs);
        });
        try {
          const response = await Promise.race([
            Promise.resolve(settings.sendMessage(safe.tabId, envelope)),
            timeout,
          ]);
          return validateResponse(response, envelope);
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  return Object.freeze({
    CHANNEL,
    ENDPOINTS,
    MAX_PAYLOAD_BYTES,
    REQUEST_TYPE,
    RESPONSE_TYPE,
    createPageClient,
    payloadBytes,
  });
});
