(function installXhsCommentPageHook() {
  'use strict';

  const PAGE_ORIGINS = Object.freeze([
    'https://www.xiaohongshu.com',
    'https://edith.xiaohongshu.com',
  ]);
  if (self !== top || !PAGE_ORIGINS.includes(location.origin)) return;

  const INSTALL_FLAG = '__taobaoDataAssistantXhsCommentPageHookV1';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  const SOURCE = 'xhs-comment-page-hook-v1';
  const CAPTURE_TYPE = 'XHS_COMMENT_API_CAPTURE';
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  const ENDPOINT_KIND_BY_PATH = Object.freeze({
    '/api/sns/web/v2/comment/page': 'root',
    '/api/sns/web/v2/comment/sub/page': 'sub',
  });
  const SAFE_QUERY_KEYS = Object.freeze(new Set([
    'note_id',
    'cursor',
    'root_comment_id',
    'top_comment_id',
    'num',
    'image_formats',
  ]));
  const requestUrlByXhr = new WeakMap();

  function responseBytes(text) {
    return new TextEncoder().encode(text).byteLength;
  }

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('signature') ||
      normalized.includes('password') || normalized.includes('credential') ||
      normalized.includes('xsec');
  }

  function safeJsonText(text) {
    if (typeof text !== 'string' || !text || responseBytes(text) > MAX_RESPONSE_BYTES) return null;
    try {
      const parsed = JSON.parse(text, (key, value) => (isSensitiveKey(key) ? undefined : value));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function safeJsonValue(value) {
    if (!value || typeof value !== 'object') return null;
    try {
      return safeJsonText(JSON.stringify(value));
    } catch (error) {
      return null;
    }
  }

  function rawFetchUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      return input && typeof input.url === 'string' ? input.url : '';
    } catch (error) {
      return '';
    }
  }

  function endpointFor(rawUrl) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || ''), location.href);
    } catch (error) {
      return null;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        !PAGE_ORIGINS.includes(parsed.origin)) {
      return null;
    }
    const endpointKind = ENDPOINT_KIND_BY_PATH[parsed.pathname];
    if (!endpointKind) return null;

    const safeUrl = new URL(parsed.pathname, parsed.origin);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!SAFE_QUERY_KEYS.has(key) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
        continue;
      }
      safeUrl.searchParams.append(key, value);
    }
    return { endpointKind, url: safeUrl.toString() };
  }

  function postCapture(endpoint, body) {
    if (!endpoint || !body) return;
    try {
      window.postMessage({
        source: SOURCE,
        type: CAPTURE_TYPE,
        endpointKind: endpoint.endpointKind,
        url: endpoint.url,
        capturedAt: Date.now(),
        body,
      }, location.origin);
    } catch (error) {
      // Structured clone or extension lifecycle failures must not affect the page request.
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function xhsCommentObservedFetch(input) {
      const endpoint = endpointFor(rawFetchUrl(input));
      const responsePromise = Reflect.apply(originalFetch, this, arguments);
      if (endpoint && responsePromise && typeof responsePromise.then === 'function') {
        responsePromise.then((response) => {
          try {
            const clone = response && typeof response.clone === 'function' ? response.clone() : null;
            if (!clone || typeof clone.text !== 'function') return;
            clone.text()
              .then((text) => postCapture(endpoint, safeJsonText(text)))
              .catch(() => {});
          } catch (error) {
            // Reading a clone is best-effort and never changes the original response.
          }
        }).catch(() => {});
      }
      return responsePromise;
    };
  }

  const Xhr = window.XMLHttpRequest;
  if (Xhr && Xhr.prototype) {
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    if (typeof originalOpen === 'function' && typeof originalSend === 'function') {
      Xhr.prototype.open = function xhsCommentObservedOpen(method, url) {
        requestUrlByXhr.set(this, typeof url === 'string' ? url : String(url || ''));
        return Reflect.apply(originalOpen, this, arguments);
      };
      Xhr.prototype.send = function xhsCommentObservedSend() {
        const endpoint = endpointFor(requestUrlByXhr.get(this));
        if (endpoint && typeof this.addEventListener === 'function') {
          this.addEventListener('load', () => {
            try {
              let body = null;
              if (this.responseType === 'json') {
                body = safeJsonValue(this.response);
              } else if (!this.responseType || this.responseType === 'text') {
                body = safeJsonText(this.responseText);
              } else if (typeof this.response === 'string') {
                body = safeJsonText(this.response);
              }
              postCapture(endpoint, body);
            } catch (error) {
              // Unsupported response types and parse failures are intentionally ignored.
            }
          }, { once: true });
        }
        return Reflect.apply(originalSend, this, arguments);
      };
    }
  }
})();
