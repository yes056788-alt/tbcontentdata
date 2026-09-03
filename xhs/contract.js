(function initXhsContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsContract() {
  'use strict';

  const PLATFORM_IDS = Object.freeze(['adstar', 'pgy', 'juguang']);
  const COLLECTION_STATUSES = Object.freeze([
    'running',
    'complete',
    'partial',
    'failed',
    'cancelled',
    'verified_no_spend',
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function issue(path, message, code) {
    return { path, message, code: code || 'schema_invalid' };
  }

  function requireObject(value, path, issues) {
    if (isObject(value)) return true;
    issues.push(issue(path, `${path} must be an object`));
    return false;
  }

  function requireArray(value, path, issues) {
    if (Array.isArray(value)) return true;
    issues.push(issue(path, `${path} must be an array`));
    return false;
  }

  function requireFiniteNumber(value, path, issues) {
    if (Number.isFinite(Number(value))) return true;
    issues.push(issue(path, `${path} must be numeric`));
    return false;
  }

  function requireIntegerAtLeast(value, path, issues, minimum) {
    const number = Number(value);
    const lowerBound = Number(minimum) || 0;
    if (Number.isFinite(number) && Number.isInteger(number) && number >= lowerBound) return true;
    issues.push(issue(
      path,
      `${path} must be an integer greater than or equal to ${lowerBound}`
    ));
    return false;
  }

  function validatePgyPage(response, issues) {
    if (!requireObject(response.data, 'data', issues)) return;
    requireArray(response.data.list, 'data.list', issues);
    requireFiniteNumber(response.data.pageNum, 'data.pageNum', issues);
    requireFiniteNumber(response.data.pageSize, 'data.pageSize', issues);
    requireFiniteNumber(response.data.total, 'data.total', issues);
    requireFiniteNumber(response.data.totalPage, 'data.totalPage', issues);
  }

  function validateJuguangPage(response, issues) {
    if (!requireObject(response.data, 'data', issues)) return;
    requireArray(response.data.dataList, 'data.dataList', issues);
    if (!requireObject(response.data.page, 'data.page', issues)) return;
    const page = response.data.page;
    const hasPageIndex = Object.prototype.hasOwnProperty.call(page, 'pageIndex');
    const hasPageNum = Object.prototype.hasOwnProperty.call(page, 'pageNum');
    if (!hasPageIndex && !hasPageNum) {
      issues.push(issue(
        'data.page.pageIndex',
        'data.page.pageIndex or compatible data.page.pageNum is required'
      ));
    } else {
      const pageIndexValid = !hasPageIndex || requireIntegerAtLeast(
        page.pageIndex,
        'data.page.pageIndex',
        issues,
        1
      );
      const pageNumValid = !hasPageNum || requireIntegerAtLeast(
        page.pageNum,
        'data.page.pageNum',
        issues,
        1
      );
      if (hasPageIndex && hasPageNum && pageIndexValid && pageNumValid &&
          Number(page.pageIndex) !== Number(page.pageNum)) {
        issues.push(issue(
          'data.page.pageNum',
          'data.page.pageIndex and data.page.pageNum conflict'
        ));
      }
    }
    requireIntegerAtLeast(page.pageSize, 'data.page.pageSize', issues, 1);
    requireIntegerAtLeast(page.totalCount, 'data.page.totalCount', issues, 0);
    requireIntegerAtLeast(page.totalPage, 'data.page.totalPage', issues, 0);
  }

  function validateAdstarPage(response, issues) {
    if (!requireObject(response.model, 'model', issues)) return;
    requireArray(response.model.result, 'model.result', issues);
    requireFiniteNumber(response.model.pageNo, 'model.pageNo', issues);
    requireFiniteNumber(response.model.pageSize, 'model.pageSize', issues);
    requireFiniteNumber(response.model.totalCount, 'model.totalCount', issues);
    requireFiniteNumber(response.model.totalPages, 'model.totalPages', issues);
    if (typeof response.model.hasNext !== 'boolean') {
      issues.push(issue('model.hasNext', 'model.hasNext must be boolean'));
    }
  }

  function responseBody(response) {
    if (isObject(response) && isObject(response.body) && Number.isFinite(Number(response.httpStatus))) {
      return response.body;
    }
    return response;
  }

  function validateResponseEnvelope(input) {
    const source = isObject(input) ? input : {};
    const platform = String(source.platform || '');
    const dataset = String(source.dataset || '');
    const response = responseBody(source.response);
    const issues = [];

    if (!PLATFORM_IDS.includes(platform)) {
      issues.push(issue('platform', `Unsupported platform: ${platform || '(missing)'}`, 'platform_unsupported'));
    }
    if (!dataset) issues.push(issue('dataset', 'dataset is required', 'dataset_missing'));
    if (!requireObject(response, 'response', issues)) return { valid: false, issues };

    const numericCode = Number(response.code);
    if (response.success === false || (Number.isFinite(numericCode) && ![0, 200].includes(numericCode))) {
      issues.push(issue('response.code', response.msg || response.message || 'Platform API returned an error', 'api_error'));
      return { valid: false, issues };
    }

    if (platform === 'pgy') validatePgyPage(response, issues);
    if (platform === 'juguang') validateJuguangPage(response, issues);
    if (platform === 'adstar') validateAdstarPage(response, issues);
    return { valid: issues.length === 0, issues };
  }

  function normalizedSensitiveKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isSensitiveKey(key) {
    const normalized = normalizedSensitiveKey(key);
    return normalized.includes('token') ||
      normalized.includes('cookie') ||
      normalized.includes('authorization') ||
      normalized.includes('signature') ||
      normalized === 'sign' ||
      normalized === 'xs' ||
      normalized === 'xsign' ||
      normalized.startsWith('csrf') ||
      normalized.includes('password') ||
      normalized.includes('credential') ||
      normalized === 'secret' ||
      normalized.endsWith('secretkey') ||
      normalized.endsWith('secretvalue') ||
      normalized === 'sessionid' ||
      normalized === 'setcookie';
  }

  function cleanOfficialNoteId(value) {
    const noteId = String(value == null ? '' : value).trim();
    return /^[a-z0-9_-]{3,128}$/i.test(noteId) ? noteId : '';
  }

  // The PGY content-note export is the platform's only supported web link source.
  // Keep this exception deliberately narrow: one HTTPS host/path, an exact noteId,
  // and only the two query parameters emitted by the official export workbook.
  function sanitizeOfficialNoteUrl(value, expectedNoteId) {
    const text = String(value == null ? '' : value).trim();
    if (!text || !/^https:\/\//i.test(text)) return null;
    let url;
    try {
      url = new URL(text);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'www.xiaohongshu.com' ||
        url.username || url.password || url.hash) return null;
    const pathMatch = url.pathname.match(/^\/explore\/([^/]+)\/?$/i);
    if (!pathMatch) return null;
    let pathNoteId = '';
    try {
      pathNoteId = cleanOfficialNoteId(decodeURIComponent(pathMatch[1]));
    } catch (error) {
      return null;
    }
    const requiredNoteId = cleanOfficialNoteId(expectedNoteId);
    if (!pathNoteId || (requiredNoteId && pathNoteId !== requiredNoteId)) return null;
    const xsecToken = String(url.searchParams.get('xsec_token') || '').trim();
    const xsecSource = String(url.searchParams.get('xsec_source') || '').trim();
    if (!/^[^\s\u0000-\u001f\u007f]{8,2048}$/.test(xsecToken) ||
        xsecSource !== 'pc_pgyexport') return null;
    const normalized = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(pathNoteId)}`);
    normalized.searchParams.set('xsec_token', xsecToken);
    normalized.searchParams.set('xsec_source', xsecSource);
    return normalized.toString();
  }

  function sanitizeUrl(text) {
    if (!/^https?:\/\//i.test(text)) return text;
    const officialNoteUrl = sanitizeOfficialNoteUrl(text);
    if (officialNoteUrl) return officialNoteUrl;
    let url;
    try {
      url = new URL(text);
    } catch (error) {
      return text;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) url.searchParams.delete(key);
    }
    if (url.hash && /(?:token|cookie|authorization|signature|(?:^|[?&])sign=)/i.test(url.hash)) {
      url.hash = '';
    }
    return url.toString();
  }

  function sanitizeText(value) {
    const text = String(value);
    if (/^https?:\/\/[^\s]+$/i.test(text)) return sanitizeUrl(text);
    return text
      .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url))
      .replace(/([?&][^?&#=\s]*(?:token|cookie|authorization|signature|sign)[^?&#=\s]*=[^&#\s]*)/gi, '')
      .replace(/\bauthorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, '[redacted]')
      .replace(/\b[^\s:=;,]*(?:token|cookie|authorization|signature|password|credential)[^\s:=;,]*\s*[:=]\s*[^\s;,]+/gi, '[redacted]');
  }

  function sanitizeSensitiveData(value, seen) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return sanitizeText(value);
    if (typeof value !== 'object') return value;

    const visited = seen || new WeakMap();
    if (visited.has(value)) return '[circular]';

    if (Array.isArray(value)) {
      const output = [];
      visited.set(value, output);
      for (const item of value) output.push(sanitizeSensitiveData(item, visited));
      return output;
    }

    if (value instanceof Date) return value.toISOString();
    const output = {};
    visited.set(value, output);
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      output[key] = sanitizeSensitiveData(item, visited);
    }
    return output;
  }

  return Object.freeze({
    COLLECTION_STATUSES,
    PLATFORM_IDS,
    isSensitiveKey,
    sanitizeOfficialNoteUrl,
    sanitizeSensitiveData,
    validateResponseEnvelope,
  });
});
