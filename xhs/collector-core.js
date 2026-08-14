(function initXhsCollectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsCollectorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsCollectorCoreApi() {
  'use strict';

  function stableValue(value, seen) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    const visited = seen || new WeakSet();
    if (visited.has(value)) throw new Error('Cannot fingerprint a circular query.');
    visited.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item) => stableValue(item, visited));
      visited.delete(value);
      return result;
    }
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key], visited);
    visited.delete(value);
    return result;
  }

  function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function stableFingerprint(value) {
    const serialized = JSON.stringify(stableValue(value));
    return `xhs-v1-${hashText(serialized)}-${serialized.length}`;
  }

  function wait(delayMs) {
    return delayMs > 0
      ? new Promise((resolve) => setTimeout(resolve, delayMs))
      : Promise.resolve();
  }

  async function withRetry(operation, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const retries = Math.max(0, Number(settings.retries) || 0);
    const baseDelayMs = Math.max(0, Number(settings.baseDelayMs) || 0);
    const maxDelayMs = Math.max(baseDelayMs, Number(settings.maxDelayMs) || 5000);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation(attempt + 1);
      } catch (error) {
        lastError = error;
        if (error && error.retryable === false) throw error;
        if (attempt >= retries) break;
        const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
        await wait(delay);
      }
    }
    throw lastError;
  }

  function allItems(record) {
    return (record.pages || [])
      .slice()
      .sort((left, right) => left.page - right.page)
      .flatMap((entry) => Array.isArray(entry.items) ? entry.items : []);
  }

  function resultFromRecord(record, status, extra) {
    return Object.assign({
      status,
      truncated: Boolean(record.truncated),
      nextPage: record.nextPage == null ? null : record.nextPage,
      receivedCount: Number(record.receivedCount) || 0,
      expectedCount: Number.isFinite(Number(record.expectedCount)) ? Number(record.expectedCount) : null,
      pageCount: Number(record.pageCount) || 0,
      items: allItems(record),
      warnings: Array.isArray(record.warnings) ? record.warnings.slice() : [],
    }, extra || {});
  }

  function validateParsedPage(parsed, page) {
    if (!parsed || typeof parsed !== 'object') throw new Error(`Page ${page} parser returned no result.`);
    if (!Array.isArray(parsed.items)) throw new Error(`Page ${page} parser did not return items.`);
    if (typeof parsed.hasNext !== 'boolean') throw new Error(`Page ${page} parser did not return hasNext.`);
  }

  async function collectPaginated(options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (!settings.cache || typeof settings.cache.open !== 'function') throw new Error('Collection cache is required.');
    if (!settings.cacheKey) throw new Error('Collection cacheKey is required.');
    if (!settings.fingerprint) throw new Error('Collection fingerprint is required.');
    if (typeof settings.fetchPage !== 'function') throw new Error('Collection fetchPage is required.');
    if (typeof settings.parsePage !== 'function') throw new Error('Collection parsePage is required.');

    let record = await settings.cache.open(settings.cacheKey, settings.fingerprint);
    if (record.status === 'complete' && record.nextPage == null) return resultFromRecord(record, 'complete');
    if (record.cancelRequested) return resultFromRecord(record, 'cancelled');

    let page = record.nextPage == null ? 1 : Math.max(1, Number(record.nextPage) || 1);
    let pagesFetched = 0;
    let cancelRequested = false;
    while (true) {
      if (record.cancelRequested || cancelRequested) {
        record = await settings.cache.update(settings.cacheKey, { status: 'cancelled' });
        return resultFromRecord(record, 'cancelled');
      }

      const response = await withRetry(
        () => settings.fetchPage(page),
        settings.retry || { retries: 0 }
      );
      const parsed = settings.parsePage(response, page);
      validateParsedPage(parsed, page);
      const nextPage = parsed.hasNext
        ? Math.max(1, Number(parsed.nextPage) || page + 1)
        : null;
      record = await settings.cache.commitPage(settings.cacheKey, settings.fingerprint, {
        page,
        items: parsed.items,
        expectedCount: parsed.total,
        nextPage,
      });
      pagesFetched += 1;

      let cancelWrite = null;
      const requestCancel = () => {
        cancelRequested = true;
        cancelWrite = settings.cache.requestCancel(settings.cacheKey);
      };
      if (typeof settings.onPage === 'function') {
        await settings.onPage({ page, parsed, record, requestCancel });
      }
      if (cancelWrite) await cancelWrite;
      if (cancelRequested) {
        record = await settings.cache.update(settings.cacheKey, { status: 'cancelled' });
        return resultFromRecord(record, 'cancelled');
      }

      if (!parsed.hasNext) {
        const expected = Number(record.expectedCount);
        const received = Number(record.receivedCount);
        if (Number.isFinite(expected) && expected !== received) {
          const warning = {
            code: 'page_total_mismatch',
            expectedCount: expected,
            receivedCount: received,
          };
          record = await settings.cache.update(settings.cacheKey, {
            status: 'partial',
            warnings: [warning],
          });
          return resultFromRecord(record, 'partial');
        }
        record = await settings.cache.update(settings.cacheKey, {
          status: 'complete',
          truncated: false,
          warnings: [],
          nextPage: null,
        });
        return resultFromRecord(record, 'complete');
      }

      if (Number.isFinite(Number(settings.maxPages)) && pagesFetched >= Number(settings.maxPages)) {
        const warning = {
          code: 'truncated_maxPages',
          limit: 'maxPages',
          value: Number(settings.maxPages),
        };
        record = await settings.cache.update(settings.cacheKey, {
          status: 'partial',
          truncated: true,
          warnings: [warning],
        });
        return resultFromRecord(record, 'partial');
      }
      page = nextPage;
    }
  }

  return Object.freeze({
    collectPaginated,
    stableFingerprint,
    withRetry,
  });
});
