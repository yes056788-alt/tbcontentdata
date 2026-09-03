(function initPgyCommentInventory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsPgyCommentInventory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const PAGE_SIZE = 100;
  const MAX_PAGES = 10000;
  const MAX_LINK_POLLS = 90;
  const SENSITIVE_KEYS = /(?:token|cookie|authorization|signature|password|secret|credential)/i;

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function sanitize(value, depth) {
    if (depth > 8) return null;
    if (value === null || value === undefined) return value;
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 10000).map((item) => sanitize(item, depth + 1));
    if (typeof value !== 'object') return String(value);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEYS.test(String(key)))
      .slice(0, 300)
      .map(([key, item]) => [key, sanitize(item, depth + 1)]));
  }

  function listEnvelope(response) {
    let value = object(response);
    for (let depth = 0; depth < 4; depth += 1) {
      if (Array.isArray(value.list)) return value;
      value = object(value.data);
    }
    return {};
  }

  function isoDateTime(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? text.replace(' ', 'T') + '+08:00'
      : text;
    const time = Date.parse(normalized);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
  }

  function canonicalDate(value) {
    const text = String(value == null ? '' : value).trim();
    const direct = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (direct) return direct[1];
    const time = Date.parse(text);
    if (!Number.isFinite(time)) return '';
    return new Date(time).toISOString().slice(0, 10);
  }

  function officialNoteUrl(value, noteId) {
    const text = String(value == null ? '' : value).trim();
    let url;
    try { url = new URL(text); } catch (error) { return ''; }
    const match = /^\/explore\/([a-z0-9_-]{3,128})$/i.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || !match ||
        match[1] !== String(noteId) || !url.searchParams.get('xsec_token') ||
        url.searchParams.get('xsec_source') !== 'pc_pgyexport') return '';
    return url.toString();
  }

  function loginError(error) {
    const code = String(error && error.code || '');
    if (!/IDENTITY|LOGIN|AUTH|401|403/i.test(code + ' ' + String(error && error.message || ''))) {
      return error;
    }
    const wrapped = new Error(String(error && error.message || '蒲公英登录已失效。'));
    wrapped.code = 'LOGIN_REQUIRED';
    wrapped.retryable = true;
    wrapped.cause = error;
    return wrapped;
  }

  function createPgyCommentInventoryCollector(options) {
    const settings = object(options);
    if (!settings.pageClient || typeof settings.pageClient.request !== 'function') {
      throw new Error('PGY comment inventory requires a pageClient.');
    }
    const now = typeof settings.now === 'function' ? settings.now : Date.now;
    const wait = typeof settings.wait === 'function'
      ? settings.wait
      : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    async function request(tabId, endpoint, payload, signal) {
      return settings.pageClient.request({
        platform: 'pgy', tabId, endpoint, payload: payload || {}, signal,
      });
    }

    async function collect(input) {
      const source = object(input);
      const tabId = Number(source.tabId);
      if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('PGY tabId is required.');
      let identity;
      try {
        identity = await request(tabId, 'identity.get', {
          brandUserIds: [], startTime: '', endTime: '', pageNum: 1,
          pageSize: 1, sorts: [], sceneType: 0,
        }, source.signal);
      } catch (error) {
        throw loginError(error);
      }
      const brandUserId = String(identity && identity.brandUserId || '').trim();
      if (!brandUserId) throw loginError(Object.assign(new Error('无法识别蒲公英品牌账号。'), {
        code: 'PGY_IDENTITY_UNAVAILABLE',
      }));

      const rows = [];
      let platformUpdatedAt = '';
      let expectedCount = null;
      let page = 1;
      while (page <= MAX_PAGES) {
        let response;
        try {
          response = await request(tabId, 'notes.list', {
            brandUserIds: [brandUserId], startTime: '', endTime: '', pageNum: page,
            pageSize: PAGE_SIZE, sorts: [], sceneType: 0,
          }, source.signal);
        } catch (error) {
          throw loginError(error);
        }
        const envelope = listEnvelope(response);
        const pageRows = Array.isArray(envelope.list) ? envelope.list : [];
        rows.push(...pageRows.map((item) => sanitize(item, 0)));
        const updateCandidate = isoDateTime(
          envelope.platformUpdatedAt || envelope.dataUpdateTime || envelope.updateTime ||
          response && (response.platformUpdatedAt || response.dataUpdateTime || response.updateTime)
        );
        if (updateCandidate) platformUpdatedAt = updateCandidate;
        const total = Number(envelope.total ?? envelope.totalCount);
        if (Number.isFinite(total) && total >= 0) expectedCount = total;
        const totalPages = Number(envelope.totalPage ?? envelope.totalPages);
        if ((Number.isFinite(totalPages) && page >= totalPages) ||
            (!Number.isFinite(totalPages) && pageRows.length < PAGE_SIZE) || !pageRows.length) break;
        page += 1;
      }
      if (page > MAX_PAGES) {
        const error = new Error('蒲公英笔记库存分页超过安全上限。');
        error.code = 'PGY_INVENTORY_TRUNCATED';
        error.retryable = false;
        throw error;
      }
      const capturedAt = new Date(Number(now())).toISOString();
      return {
        schema: 'PgyCommentInventoryV1',
        schemaVersion: 1,
        accountKey: brandUserId,
        brandUserId,
        brandUserName: String(identity.brandUserName || ''),
        capturedAt,
        platformUpdatedAt: platformUpdatedAt || capturedAt,
        expectedCount,
        pageCount: page,
        rows,
      };
    }

    async function resolveOfficialLinks(input) {
      const source = object(input);
      const tabId = Number(source.tabId);
      const brandUserId = String(source.brandUserId || '').trim();
      const noteIds = Array.from(new Set((Array.isArray(source.noteIds) ? source.noteIds : [])
        .map((item) => String(item || '').trim()).filter(Boolean)));
      if (!noteIds.length) return {};
      const dates = (Array.isArray(source.notes) ? source.notes : [])
        .map((item) => canonicalDate(item && (
          item.publishedAt || item.publishDate || item.notePublishTime
        )))
        .filter(Boolean).sort();
      const today = new Date(Number(now())).toISOString().slice(0, 10);
      const startTime = dates[0] || today;
      const submitted = await request(tabId, 'notes.linkExport.submit', {
        brandUserId, startTime, endTime: today, noteIds,
      }, source.signal);
      const taskId = String(submitted && submitted.taskId || '').trim();
      if (!taskId) throw Object.assign(new Error('蒲公英官方链接任务未返回 taskId。'), {
        code: 'PGY_LINK_EXPORT_TASK_ID_MISSING', retryable: true,
      });
      let complete = false;
      for (let attempt = 0; attempt < MAX_LINK_POLLS; attempt += 1) {
        const status = await request(tabId, 'notes.linkExport.status', { taskId }, source.signal);
        const value = Number(status && status.status);
        if (value === 3) { complete = true; break; }
        if (value === 4 || value < 0) throw Object.assign(new Error('蒲公英官方链接任务执行失败。'), {
          code: 'PGY_LINK_EXPORT_FAILED', retryable: true,
        });
        await wait(2000);
      }
      if (!complete) throw Object.assign(new Error('蒲公英官方链接任务等待超时。'), {
        code: 'PGY_LINK_EXPORT_TIMEOUT', retryable: true,
      });
      const result = await request(tabId, 'notes.linkExport.result', { taskId, noteIds }, source.signal);
      const requested = new Set(noteIds);
      const output = {};
      for (const entry of Array.isArray(result && result.links) ? result.links : []) {
        const noteId = String(Array.isArray(entry) ? entry[0] : entry && entry.noteId || '').trim();
        const value = Array.isArray(entry) ? entry[1] : entry && entry.noteUrl;
        if (!requested.has(noteId)) continue;
        const safeUrl = officialNoteUrl(value, noteId);
        if (safeUrl) output[noteId] = safeUrl;
      }
      return output;
    }

    return Object.freeze({ collect, resolveOfficialLinks });
  }

  return Object.freeze({ createPgyCommentInventoryCollector, officialNoteUrl });
});
