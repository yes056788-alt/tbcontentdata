(function installJuguangPageHook() {
  'use strict';

  const ORIGIN = 'https://ad.xiaohongshu.com';
  const MCC_ORIGIN = 'https://mcc.xiaohongshu.com';
  if (self !== top || location.origin !== ORIGIN) return;
  const CHANNEL = 'xhs-page-bridge-v1';
  const REQUEST_TYPE = 'XHS_PAGE_REQUEST';
  const RESPONSE_TYPE = 'XHS_PAGE_RESPONSE';
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const REPORT_PATH = '/api/leona/rtb/common/data/report';
  const CURRENT_ACCOUNT_PATH = '/api/edith/get_account_info';
  const ACCOUNT_LIST_PATH = '/api/edith/page_user_account';
  const REPORT_FIELDS = Object.freeze([
    'pageNum', 'pageSize', 'sorts', 'filters', 'dataCaliber', 'timeUnit', 'splitColumns',
    'startDate', 'endDate', 'webModule', 'dataSource', 'dataPattern', 'columns',
  ]);
  const LIST_FIELDS = Object.freeze(['pageIndex', 'pageSize', 'shadowAccount']);
  const ENDPOINTS = Object.freeze({
    'reports.query': { origin: ORIGIN, path: REPORT_PATH, fields: REPORT_FIELDS, transform: 'report' },
    'accounts.current': { origin: MCC_ORIGIN, path: CURRENT_ACCOUNT_PATH, query: { platform: '1' }, fields: [], transform: 'identity' },
    'identity.get': { origin: MCC_ORIGIN, path: CURRENT_ACCOUNT_PATH, query: { platform: '1' }, fields: [], transform: 'identity' },
    'accounts.list': { origin: MCC_ORIGIN, path: ACCOUNT_LIST_PATH, query: { platform: '1' }, fields: LIST_FIELDS, transform: 'accounts' },
  });

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('signature') ||
      normalized.includes('password') || normalized.includes('credential') ||
      normalized === 'sign' || normalized === 'xs' || normalized.startsWith('xsec') ||
      normalized === 'secret' || normalized.includes('mobile') || normalized.includes('contact');
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

  function responseData(body) {
    return body && body.data && body.data.data || body && body.data || {};
  }

  function minimalIdentity(value) {
    const data = value && typeof value === 'object' ? value : {};
    const brand = data.brand && typeof data.brand === 'object' ? data.brand : {};
    const subAccount = data.subAccount && typeof data.subAccount === 'object' ? data.subAccount : {};
    return {
      accountType: data.accountType,
      advertiserId: data.advertiserId,
      brandUserId: brand.brandUserId || null,
      brandUserName: brand.brandUserName || null,
      name: subAccount.agentSubAccountName || data.name || brand.brandUserName || null,
      vSellerId: subAccount.agentSubAccountId || data.vSellerId || null,
    };
  }

  function minimalAccountList(value) {
    const data = value && typeof value === 'object' ? value : {};
    const rows = Array.isArray(data.dataList) ? data.dataList : [];
    return {
      accounts: rows.map((row) => minimalIdentity({
        accountType: row.accountType,
        advertiserId: row.advertiserId,
        brand: row.brand,
        name: row.accountName || row.name || row.owner && row.owner.name,
        vSellerId: row.virtualSellerId || row.vSellerId,
      })),
      pageIndex: Number(data.pageIndex) || 1,
      pageSize: Number(data.pageSize) || rows.length,
      total: Number(data.total) || 0,
    };
  }

  function safeBody(payload, fields) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return Object.fromEntries(fields
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

  function transformResponse(endpoint, body) {
    if (endpoint.transform === 'identity') return minimalIdentity(responseData(body));
    if (endpoint.transform === 'accounts') return minimalAccountList(responseData(body));
    return sanitize(body);
  }

  function request(message) {
    const endpoint = ENDPOINTS[message.endpoint];
    const url = new URL(endpoint.path, endpoint.origin);
    for (const [key, value] of Object.entries(endpoint.query || {})) url.searchParams.set(key, value);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url.toString(), true);
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
          ? { ok: true, data: transformResponse(endpoint, body) }
          : { ok: false, code: 'JUGUANG_API_ERROR', message: '聚光接口返回业务错误。', retryable: xhr.status >= 500 });
      } catch (error) {
        post(message, { ok: false, code: 'JUGUANG_INVALID_JSON', message: '聚光接口返回了无法识别的数据。', retryable: true });
      }
    };
    xhr.onerror = () => post(message, { ok: false, code: 'JUGUANG_NETWORK_ERROR', message: '聚光接口网络请求失败。', retryable: true });
    xhr.ontimeout = () => post(message, { ok: false, code: 'JUGUANG_TIMEOUT', message: '聚光接口请求超时。', retryable: true });
    xhr.send(JSON.stringify(safeBody(message.payload, endpoint.fields)));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== REQUEST_TYPE) return;
    if (message.platform !== 'juguang' || !Object.prototype.hasOwnProperty.call(ENDPOINTS, message.endpoint)) return;
    if (typeof message.requestId !== 'string' || !message.requestId || typeof message.nonce !== 'string' || !message.nonce) return;
    if (new TextEncoder().encode(JSON.stringify(message.payload || {})).byteLength > MAX_PAYLOAD_BYTES) return;
    request(message);
  });
})();
