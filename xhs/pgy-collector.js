(function initXhsPgyCollector(root, factory) {
  const collectorCore = typeof module === 'object' && module.exports
    ? require('./collector-core')
    : root.XhsCollectorCore;
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const quality = typeof module === 'object' && module.exports
    ? require('./quality')
    : root.XhsQuality;
  const api = factory(collectorCore, contract, quality);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsPgyCollector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsPgyCollectorApi(
  collectorCore,
  contract,
  quality
) {
  'use strict';

  if (!collectorCore) throw new Error('XhsCollectorCore must be loaded before XhsPgyCollector');
  if (!contract) throw new Error('XhsContract must be loaded before XhsPgyCollector');
  if (!quality) throw new Error('XhsQuality must be loaded before XhsPgyCollector');

  const DEFAULT_PAGE_SIZE = 30;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNonNegative(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`PGY response ${field} must be a finite non-negative number.`);
    }
    return number;
  }

  function parsePgyPage(response, page) {
    if (!isObject(response) || !isObject(response.data)) {
      throw new Error('PGY response data is missing or invalid.');
    }
    const data = response.data;
    if (!Array.isArray(data.list)) throw new Error('PGY response data.list must be an array.');
    const pageNum = finiteNonNegative(data.pageNum, 'data.pageNum');
    const pageSize = finiteNonNegative(data.pageSize, 'data.pageSize');
    const total = finiteNonNegative(data.total, 'data.total');
    const totalPage = finiteNonNegative(data.totalPage, 'data.totalPage');
    const currentPage = Math.max(1, Number(page) || 1);
    if (pageNum > 0 && pageNum !== currentPage) {
      throw new Error(`PGY response page mismatch: expected ${currentPage}, received ${pageNum}.`);
    }
    if (pageSize === 0 && total > 0) throw new Error('PGY response data.pageSize cannot be zero when rows exist.');
    const hasNext = currentPage < totalPage;
    return {
      items: data.list,
      total,
      pageSize,
      hasNext,
      nextPage: hasNext ? currentPage + 1 : null,
    };
  }

  function numberOrZero(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const canonical = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return canonical ? canonical[1] : null;
  }

  function normalizePgyNote(value) {
    const safe = contract.sanitizeSensitiveData(isObject(value) ? value : {});
    const noteId = String(safe.noteId || '').trim();
    if (!noteId) throw new Error('PGY note noteId is required.');
    const sourceKey = String(safe.bizId || noteId).trim();
    const actualConsume = optionalNumber(safe.actualConsume);
    const cooperation = actualConsume == null
      ? Math.max(0, numberOrZero(safe.totalConsume) - numberOrZero(safe.refundAmount))
      : Math.max(0, actualConsume);
    const platformFee = Math.max(0, numberOrZero(safe.totalPlatformPrice));
    return {
      noteId,
      sourceKey,
      title: safe.noteTitle == null ? '' : String(safe.noteTitle),
      publishDate: canonicalDate(safe.notePublishTime || safe.dateKey),
      author: {
        id: safe.kolId == null ? null : String(safe.kolId),
        name: safe.kolNickName == null ? null : String(safe.kolNickName),
      },
      costs: {
        cooperation,
        platformFee,
        total: cooperation + platformFee,
      },
      metrics: {
        impressions: numberOrZero(safe.impNum),
        reads: numberOrZero(safe.readNum),
        interactions: numberOrZero(safe.engageNum),
      },
      source: safe,
    };
  }

  function normalizePgySummary(value) {
    const response = isObject(value) ? value : {};
    const data = isObject(response.data) ? response.data : response;
    if (!isObject(data)) throw new Error('PGY summary data is missing or invalid.');
    const expected = optionalNumber(data.total);
    const cooperation = optionalNumber(data.actualConsume);
    const platformFee = optionalNumber(data.totalPlatformPrice);
    if (cooperation == null || platformFee == null) {
      throw new Error('PGY summary cost fields are missing or invalid.');
    }
    return {
      expectedCount: expected,
      cooperationCost: cooperation,
      platformFee,
      totalCost: cooperation + platformFee,
    };
  }

  function closeEnough(left, right) {
    return Math.abs(Number(left) - Number(right)) <= 0.01;
  }

  function reconcilePgyCollection(input) {
    const source = isObject(input) ? input : {};
    const summary = isObject(source.summary) ? source.summary : {};
    const notes = Array.isArray(source.notes) ? source.notes : [];
    const receivedCount = notes.length;
    const noteIds = new Set();
    const sourceKeys = new Set();
    let duplicateSourceCount = 0;
    for (const note of notes) {
      const noteId = String(note && note.noteId || '');
      const sourceKey = String(note && note.sourceKey || noteId);
      if (sourceKeys.has(sourceKey)) duplicateSourceCount += 1;
      sourceKeys.add(sourceKey);
      if (noteId) noteIds.add(noteId);
    }
    const uniqueCount = noteIds.size;
    const duplicateCount = Math.max(receivedCount - uniqueCount, duplicateSourceCount);
    const cooperationCost = notes.reduce((sum, note) => sum + numberOrZero(note && note.costs && note.costs.cooperation), 0);
    const platformFee = notes.reduce((sum, note) => sum + numberOrZero(note && note.costs && note.costs.platformFee), 0);
    const expectedCount = optionalNumber(summary.expectedCount);
    const issues = [];
    if (duplicateSourceCount > 0) {
      issues.push({ code: 'duplicate_source_row', count: duplicateSourceCount });
    } else if (duplicateCount > 0) {
      issues.push({ code: 'duplicate_note_id', count: duplicateCount });
    }
    if (expectedCount != null && expectedCount !== receivedCount) {
      issues.push({ code: 'row_count_mismatch', expected: expectedCount, actual: receivedCount });
    }
    if (!closeEnough(summary.cooperationCost, cooperationCost)) {
      issues.push({
        code: 'cooperation_cost_mismatch',
        expected: numberOrZero(summary.cooperationCost),
        actual: cooperationCost,
      });
    }
    if (!closeEnough(summary.platformFee, platformFee)) {
      issues.push({
        code: 'platform_fee_mismatch',
        expected: numberOrZero(summary.platformFee),
        actual: platformFee,
      });
    }
    return {
      reconciled: issues.length === 0,
      expectedCount,
      receivedCount,
      uniqueCount,
      duplicateCount,
      cooperationCost,
      platformFee,
      issues,
    };
  }

  function requestBody(context, pageNum) {
    return {
      brandUserIds: [context.identity.brandUserId],
      startTime: context.dateRange.from,
      endTime: context.dateRange.to,
      pageNum,
      pageSize: context.pageSize,
      sorts: [],
      sceneType: 0,
    };
  }

  function errorRecord(error, fields) {
    return contract.sanitizeSensitiveData(Object.assign({
      code: error && error.code || 'pgy_collection_error',
      message: String(error && error.message || error || 'Unknown PGY collection error'),
    }, fields || {}));
  }

  function flattenPages(record) {
    return (record && Array.isArray(record.pages) ? record.pages : [])
      .slice()
      .sort((left, right) => left.page - right.page)
      .flatMap((entry) => Array.isArray(entry.items) ? entry.items : []);
  }

  function partialPageResult(record, error) {
    return {
      cacheKey: record.cacheKey,
      fingerprint: record.fingerprint,
      status: 'partial',
      truncated: Boolean(record.truncated),
      nextPage: record.nextPage,
      receivedCount: Number(record.receivedCount) || 0,
      expectedCount: Number.isFinite(Number(record.expectedCount)) ? Number(record.expectedCount) : null,
      pageCount: Number(record.pageCount) || 0,
      items: flattenPages(record),
      warnings: (record.warnings || []).concat({ code: 'pagination_incomplete', message: String(error.message || error) }),
    };
  }

  function createPgyCollector(options) {
    const settings = isObject(options) ? options : {};
    if (!settings.pageClient || typeof settings.pageClient.request !== 'function') {
      throw new Error('PGY pageClient is required.');
    }
    if (!settings.cache || typeof settings.cache.open !== 'function') {
      throw new Error('PGY collection cache is required.');
    }
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    const retry = isObject(settings.retry) ? settings.retry : { retries: 2, baseDelayMs: 150, maxDelayMs: 1500 };

    async function request(tabId, endpoint, payload) {
      return settings.pageClient.request({ tabId, platform: 'pgy', endpoint, payload: payload || {} });
    }

    function baseResult(context, startedAt) {
      return {
        schemaVersion: 1,
        platform: 'pgy',
        runId: context.runId,
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        dateBasis: 'note_publish_time',
        startedAt,
        finishedAt: now(),
        identity: context.identity ? Object.assign({ accountKey: context.accountKey }, context.identity) : null,
        summary: null,
        notes: [],
        reconciliation: { reconciled: false, issues: [] },
        empty: false,
        schemaValid: false,
        paginationComplete: false,
        reconciled: false,
        expectedCount: 0,
        receivedCount: 0,
        pageCount: 0,
        nextPage: null,
        truncated: false,
        warnings: [],
        errors: [],
      };
    }

    async function collect(input) {
      const source = isObject(input) ? input : {};
      const context = {
        tabId: Number(source.tabId),
        runId: String(source.runId || '').trim(),
        accountKey: String(source.accountKey || '').trim(),
        dateRange: contract.sanitizeSensitiveData(source.dateRange || {}),
        pageSize: Math.max(1, Math.floor(Number(source.pageSize) || DEFAULT_PAGE_SIZE)),
        maxPages: source.maxPages,
        identity: null,
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('PGY tabId is required.');
      if (!context.runId) throw new Error('PGY runId is required.');
      if (!context.accountKey) throw new Error('PGY accountKey is required.');
      if (!context.dateRange.from || !context.dateRange.to) throw new Error('PGY dateRange is required.');
      const startedAt = now();

      try {
        const identity = await collectorCore.withRetry(
          () => request(context.tabId, 'identity.get', {
            brandUserIds: [], startTime: '', endTime: '', pageNum: 1, pageSize: 1, sorts: [], sceneType: 0,
          }),
          retry
        );
        if (!isObject(identity) || !identity.brandUserId) throw new Error('PGY identity brandUserId is missing.');
        context.identity = {
          brandUserId: String(identity.brandUserId),
          brandUserName: identity.brandUserName == null ? null : String(identity.brandUserName),
        };
      } catch (error) {
        const result = baseResult(context, startedAt);
        result.status = 'failed';
        result.errors = [errorRecord(error, { code: 'identity_unavailable' })];
        result.finishedAt = now();
        return result;
      }

      let summary;
      try {
        const response = await collectorCore.withRetry(
          () => request(context.tabId, 'notes.sum', requestBody(context, 1)),
          retry
        );
        summary = normalizePgySummary(response);
      } catch (error) {
        const result = baseResult(context, startedAt);
        result.identity = Object.assign({ accountKey: context.accountKey }, context.identity);
        result.status = 'failed';
        result.errors = [errorRecord(error, { code: 'summary_invalid' })];
        result.finishedAt = now();
        return result;
      }

      const cacheKey = `xhs:${encodeURIComponent(context.runId)}:pgy:notes`;
      const fingerprint = collectorCore.stableFingerprint({
        endpoint: 'notes.list', accountKey: context.accountKey,
        brandUserId: context.identity.brandUserId, dateRange: context.dateRange, pageSize: context.pageSize,
      });
      let notesResult;
      let paginationError = null;
      try {
        notesResult = await collectorCore.collectPaginated({
          cache: settings.cache,
          cacheKey,
          fingerprint,
          maxPages: context.maxPages,
          retry,
          fetchPage: (page) => request(context.tabId, 'notes.list', requestBody(context, page)),
          parsePage(response, page) {
            const parsed = parsePgyPage(response, page);
            return Object.assign({}, parsed, { items: parsed.items.map(normalizePgyNote) });
          },
        });
      } catch (error) {
        paginationError = error;
        const record = await settings.cache.read(cacheKey);
        if (!record || Number(record.receivedCount) === 0) {
          const result = baseResult(context, startedAt);
          result.identity = Object.assign({ accountKey: context.accountKey }, context.identity);
          result.summary = summary;
          result.status = 'failed';
          result.schemaValid = false;
          result.errors = [errorRecord(error, { code: 'schema_invalid' })];
          result.finishedAt = now();
          return result;
        }
        await settings.cache.update(cacheKey, {
          status: 'partial',
          warnings: [{ code: 'pagination_incomplete', message: String(error.message || error) }],
        });
        notesResult = partialPageResult(await settings.cache.read(cacheKey), error);
      }

      if (summary.expectedCount == null) summary = Object.assign({}, summary, { expectedCount: notesResult.expectedCount });
      const reconciliation = reconcilePgyCollection({ summary, notes: notesResult.items });
      const errors = paginationError
        ? [errorRecord(paginationError, { code: 'pagination_incomplete' })]
        : [];
      const schemaValid = true;
      const paginationComplete = notesResult.status === 'complete';
      const statusEvidence = quality.derivePlatformStatus({
        platform: 'pgy',
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        schemaValid,
        paginationComplete,
        reconciled: reconciliation.reconciled,
        receivedCount: notesResult.receivedCount,
        truncation: { maxPages: Boolean(notesResult.truncated) },
        warnings: (notesResult.warnings || []).concat(reconciliation.issues),
        errors,
      });
      const status = reconciliation.reconciled && paginationComplete ? 'complete' : statusEvidence.status;
      return Object.assign({}, statusEvidence, {
        schemaVersion: 1,
        platform: 'pgy',
        runId: context.runId,
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        dateBasis: 'note_publish_time',
        startedAt,
        finishedAt: now(),
        status,
        schemaValid,
        paginationComplete,
        reconciled: reconciliation.reconciled,
        expectedCount: notesResult.expectedCount,
        receivedCount: notesResult.receivedCount,
        pageCount: notesResult.pageCount,
        nextPage: notesResult.nextPage,
        truncated: Boolean(notesResult.truncated),
        checkpoint: {
          cacheKey: notesResult.cacheKey,
          fingerprint: notesResult.fingerprint,
          status: notesResult.status,
          expectedCount: notesResult.expectedCount,
          receivedCount: notesResult.receivedCount,
          pageCount: notesResult.pageCount,
          nextPage: notesResult.nextPage,
          truncated: Boolean(notesResult.truncated),
        },
        identity: Object.assign({ accountKey: context.accountKey }, context.identity),
        summary,
        notes: contract.sanitizeSensitiveData(notesResult.items),
        reconciliation: contract.sanitizeSensitiveData(reconciliation),
        empty: paginationComplete && reconciliation.reconciled && notesResult.receivedCount === 0,
        errors: contract.sanitizeSensitiveData(errors),
      });
    }

    return Object.freeze({ collect });
  }

  return Object.freeze({
    createPgyCollector,
    normalizePgyNote,
    normalizePgySummary,
    parsePgyPage,
    reconcilePgyCollection,
  });
});
