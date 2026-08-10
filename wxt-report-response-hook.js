// wxt-report-response-hook.js - Samples normal Wanxiangtai XHR responses in opt-in trace mode.
(function () {
  'use strict';

  if (location.hostname !== 'one.alimama.com' && location.hostname !== 'one.alimama.hk') return;
  if (new URL(location.href).searchParams.get('__wxtTrace') !== '1') return;
  if (window.__wxtReportResponseHookV1) return;
  window.__wxtReportResponseHookV1 = true;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  let responseCount = 0;

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') ||
      normalized.includes('cookie') ||
      normalized.startsWith('csrf') ||
      normalized === 'sign' ||
      normalized.endsWith('signature') ||
      normalized === 'cna' ||
      normalized === 'utdid' ||
      normalized === 'sid' ||
      normalized === 'sessionid' ||
      normalized === 'userid' ||
      normalized === 'memberid' ||
      normalized === 'loginpointid';
  }

  function sampleValue(value, depth) {
    const level = Number(depth || 0);
    if (level > 7) return '[max-depth]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return value.length > 1000 ? value.slice(0, 1000) + '...[truncated]' : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return {
        __type: 'array',
        length: value.length,
        sample: value.slice(0, 3).map((item) => sampleValue(item, level + 1)),
      };
    }
    if (typeof value === 'object') {
      const result = {};
      Object.keys(value).slice(0, 120).forEach((key) => {
        result[key] = isSensitiveKey(key)
          ? '[redacted]'
          : sampleValue(value[key], level + 1);
      });
      return result;
    }
    return String(value);
  }

  function sanitizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      for (const key of Array.from(url.searchParams.keys())) {
        if (isSensitiveKey(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.toString();
    } catch (error) {
      return String(rawUrl || '').slice(0, 3000);
    }
  }

  function shouldSample(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return (
        url.hostname === 'one.alimama.com' ||
        url.hostname.endsWith('.alimama.com') ||
        url.hostname === 'one.alimama.hk' ||
        url.hostname.endsWith('.alimama.hk')
      ) &&
        /\/report\/(?:query|chargeSum|liveChargeSum)\.json$/i.test(url.pathname);
    } catch (error) {
      return false;
    }
  }

  function readResponse(xhr) {
    if (xhr.responseType === 'json') return xhr.response;
    if (xhr.responseType && xhr.responseType !== 'text') {
      return { __type: xhr.responseType || 'unknown' };
    }
    const text = xhr.responseText || '';
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  function emitResponse(xhr) {
    if (responseCount >= 30 || !shouldSample(xhr.__wxtTraceUrl)) return;
    responseCount += 1;
    let response;
    try {
      response = sampleValue(readResponse(xhr), 0);
    } catch (error) {
      response = { __error: error && error.message ? error.message : String(error) };
    }
    document.dispatchEvent(new CustomEvent('WXT_REPORT_API_RESPONSE', {
      detail: JSON.stringify({
        method: xhr.__wxtTraceMethod || 'GET',
        status: xhr.status,
        url: sanitizeUrl(xhr.__wxtTraceUrl),
        response,
      }),
    }));
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__wxtTraceMethod = String(method || 'GET').toUpperCase();
    this.__wxtTraceUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (shouldSample(this.__wxtTraceUrl)) {
      this.addEventListener('loadend', () => emitResponse(this), { once: true });
    }
    return originalSend.apply(this, args);
  };
})();
