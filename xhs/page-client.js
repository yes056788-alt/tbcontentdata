(function initXhsPageClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsPageClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsPageClientApi() {
  'use strict';

  const CHANNEL = 'xhs-page-bridge-v3';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const BRIDGE_UNAVAILABLE_CODE = 'XHS_PAGE_BRIDGE_UNAVAILABLE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
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

  function bridgeUnavailableError(error) {
    const message = String(error && error.message || error || 'XHS page returned no response.');
    const unavailable = new Error(message);
    unavailable.code = BRIDGE_UNAVAILABLE_CODE;
    unavailable.retryable = true;
    if (error) unavailable.cause = error;
    return unavailable;
  }

  function isStaleReceiverError(error) {
    if (!error) return false;
    if (error.code === BRIDGE_UNAVAILABLE_CODE) return true;
    // Page/API failures carry their own stable code and must never be replayed as
    // transport recovery merely because their human-readable message mentions a response.
    if (error.code != null) return false;
    return /(?:receiving end does not exist|could not establish connection|no tab with id|message (?:port|channel) closed before a response|no response)/i
      .test(String(error.message || error));
  }

  function isUndeliveredReceiverError(error) {
    if (!error || error.code != null) return false;
    return /(?:receiving end does not exist|could not establish connection)/i
      .test(String(error.message || error));
  }

  function validateResponse(response, request) {
    if (!response || typeof response !== 'object') throw bridgeUnavailableError();
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

  function abortError(signal) {
    const reason = signal && signal.reason;
    if (reason && typeof reason === 'object' && reason.name === 'AbortError') return reason;
    const error = new Error(
      typeof reason === 'string' && reason.trim() ? reason : 'XHS page request was cancelled.'
    );
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    error.retryable = false;
    return error;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError(signal);
  }

  function createPageClient(options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (typeof settings.sendMessage !== 'function') throw new Error('sendMessage is required.');
    const recoverBridge = typeof settings.recoverBridge === 'function'
      ? settings.recoverBridge
      : null;
    const defaultTimeoutMs = Math.max(1, Number(settings.timeoutMs) || 45000);

    return Object.freeze({
      async request(input) {
        const safe = assertRequest(input);
        const signal = input && input.signal;
        throwIfAborted(signal);
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
        let abortListener = null;
        const timeout = new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`XHS page request timeout after ${timeoutMs} ms.`)), timeoutMs);
        });
        const aborted = new Promise((_resolve, reject) => {
          if (!signal || typeof signal.addEventListener !== 'function') return;
          abortListener = () => reject(abortError(signal));
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        });
        const sent = Promise.resolve().then(async () => {
          throwIfAborted(signal);
          try {
            return await settings.sendMessage(safe.tabId, envelope);
          } catch (error) {
            if (!recoverBridge || !isUndeliveredReceiverError(error)) throw error;
            throwIfAborted(signal);
            await recoverBridge({
              tabId: safe.tabId,
              platform: safe.platform,
              endpoint: safe.endpoint,
              signal,
            });
            throwIfAborted(signal);
            return settings.sendMessage(safe.tabId, envelope);
          }
        });
        sent.catch(() => {});
        try {
          const response = await Promise.race([
            sent,
            timeout,
            aborted,
          ]);
          throwIfAborted(signal);
          return validateResponse(response, envelope);
        } catch (error) {
          throwIfAborted(signal);
          if (isStaleReceiverError(error)) throw bridgeUnavailableError(error);
          throw error;
        } finally {
          clearTimeout(timer);
          if (abortListener && signal) signal.removeEventListener('abort', abortListener);
        }
      },
    });
  }

  return Object.freeze({
    BRIDGE_UNAVAILABLE_CODE,
    CHANNEL,
    ENDPOINTS,
    MAX_PAYLOAD_BYTES,
    REQUEST_TYPE,
    RESPONSE_TYPE,
    createPageClient,
    payloadBytes,
  });
});
