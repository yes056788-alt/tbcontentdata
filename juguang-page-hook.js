(function installJuguangPageHook() {
  'use strict';

  const ORIGIN = 'https://ad.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const CHANNEL = 'xhs-page-bridge-v1';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const REPORT_PATH = '/api/leona/rtb/common/data/report';
  const REPORT_FIELDS = Object.freeze([
    'pageNum', 'pageSize', 'sorts', 'filters', 'dataCaliber', 'timeUnit', 'splitColumns',
    'startDate', 'endDate', 'webModule', 'dataSource', 'dataPattern', 'columns',
  ]);

  function safeReportBody(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return Object.fromEntries(REPORT_FIELDS
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]]));
  }

  function post(message, fields) {
    window.postMessage(Object.assign({
      channel: CHANNEL,
      type: RESPONSE_TYPE,
      platform: 'juguang',
      requestId: message.requestId,
      nonce: message.nonce,
    }, fields), ORIGIN);
  }

  function requestReport(message) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', REPORT_PATH, true);
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
          : { ok: false, code: 'JUGUANG_API_ERROR', message: String(body && (body.msg || body.message) || `HTTP ${xhr.status}`), retryable: xhr.status >= 500 });
      } catch (error) {
        post(message, { ok: false, code: 'JUGUANG_INVALID_JSON', message: '聚光接口返回了无法识别的数据。', retryable: true });
      }
    };
    xhr.onerror = () => post(message, { ok: false, code: 'JUGUANG_NETWORK_ERROR', message: '聚光接口网络请求失败。', retryable: true });
    xhr.ontimeout = () => post(message, { ok: false, code: 'JUGUANG_TIMEOUT', message: '聚光接口请求超时。', retryable: true });
    xhr.send(JSON.stringify(safeReportBody(message.payload)));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
    if (message.platform !== 'juguang' || message.endpoint !== 'reports.query') return;
    if (typeof message.requestId !== 'string' || !message.requestId || typeof message.nonce !== 'string' || !message.nonce) return;
    if (new TextEncoder().encode(JSON.stringify(message.payload || {})).byteLength > MAX_PAYLOAD_BYTES) return;
    requestReport(message);
  });
})();
