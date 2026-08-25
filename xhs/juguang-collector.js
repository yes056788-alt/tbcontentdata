(function initXhsJuguangCollector(root, factory) {
  const collectorCore = typeof module === 'object' && module.exports
    ? require('./collector-core')
    : root.XhsCollectorCore;
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const accountTools = typeof module === 'object' && module.exports
    ? require('./juguang-accounts')
    : root.XhsJuguangAccounts;
  const api = factory(collectorCore, contract, accountTools);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsJuguangCollector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsJuguangCollectorApi(
  collectorCore,
  contract,
  accountTools
) {
  'use strict';

  if (!collectorCore) throw new Error('XhsCollectorCore must be loaded before XhsJuguangCollector');
  if (!contract) throw new Error('XhsContract must be loaded before XhsJuguangCollector');
  if (!accountTools) throw new Error('XhsJuguangAccounts must be loaded before XhsJuguangCollector');

  const ATTRIBUTION = Object.freeze({
    basis: 'conversion_time',
    dataCaliber: 0,
    windowDays: 15,
    splitColumns: Object.freeze(['marketingTarget', 'placement']),
    verifiedAt: '2026-08-24',
  });
  const PLACEMENT_LABELS = Object.freeze({
    1: '信息流',
    2: '搜索',
    4: '全站智投',
    7: '视频流',
  });
  const NOTE_COLUMNS = Object.freeze([
    'time', 'noteId', 'fee', 'impression', 'click', 'ctr', 'acp', 'cpm',
    'interaction', 'cpi', 'videoPlay5sCnt', 'videoPlay5sRate', 'iUserNum',
    'iUserPrice', 'tiUserNum', 'tiUserPrice', 'messageConsult',
    'initiativeMessage', 'msgLeadsNum', 'messageConsultCpl',
    'initiativeMessageCpl', 'msgLeadsCost', 'externalGoodsOrder15',
    'externalGoodsOrderRate15New', 'outClickEnterStoreCnt15d',
    'outClickEnterStoreCvr15dNew', 'externalRgmv15', 'externalRoi15',
    'externalGoodsOrderPrice15', 'noteMaterialType',
  ]);
  const DAILY_COLUMNS = Object.freeze([
    'time', 'noteId', 'marketingTarget', 'placement',
    ...NOTE_COLUMNS.filter((column) => !['time', 'noteId'].includes(column)),
    'outSideSellerPv15d', 'outSideSellerPvRate15dNew', 'outSideSellerPvfee15d',
  ]);
  const ACCOUNT_COLUMNS = Object.freeze(NOTE_COLUMNS.filter((column) => (
    !['noteId', 'noteMaterialType'].includes(column)
  )));
  const DEFAULT_CONCURRENT_ACCOUNT_TABS = 3;
  const DEFAULT_ZERO_SPEND_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function numericMetric(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' && value.trim() === '') return value;
    const normalized = String(value == null ? '' : value).replace(/[,￥¥%]/g, '').trim();
    const number = Number(normalized);
    return Number.isFinite(number) ? number : value;
  }

  function reportSchemaError(message) {
    const error = new Error(message);
    error.schemaInvalid = true;
    return error;
  }

  function unsupportedColumnNames(value) {
    const names = (Array.isArray(value) ? value : []).map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!isObject(item)) return '';
      return String(
        item.column || item.columnName || item.name || item.field || item.key || ''
      ).trim();
    }).filter(Boolean);
    return Array.from(new Set(names));
  }

  function assertFeeSupported(dataset, columns) {
    if (!unsupportedColumnNames(columns).some((column) => column.toLowerCase() === 'fee')) return;
    throw reportSchemaError(`Juguang ${dataset} response marks required fee as unsupported.`);
  }

  function recordUnsupportedColumns(output, dataset, columns) {
    const names = unsupportedColumnNames(columns);
    assertFeeSupported(dataset, names);
    if (names.length === 0) return false;
    output.warnings.push({ code: 'unsupported_columns', dataset, columns: names });
    return true;
  }

  function parseMetricObject(value) {
    let source = value;
    if (typeof value === 'string') {
      try {
        source = JSON.parse(value);
      } catch (error) {
        throw new Error('Juguang dataValueJson is invalid JSON.');
      }
    }
    if (!isObject(source)) throw new Error('Juguang dataValueJson must contain an object.');
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, numericMetric(item)]));
  }

  function normalizePlacementType(value) {
    if (value === null || value === undefined || value === '') return null;
    const source = isObject(value)
      ? value.name || value.label || value.value || value.code
      : value;
    const key = String(source == null ? '' : source).trim();
    if (!key) return null;
    return PLACEMENT_LABELS[key] || key;
  }

  function normalizeReportRow(value) {
    if (!isObject(value)) throw new Error('Juguang report row must be an object.');
    const safe = contract.sanitizeSensitiveData(value);
    const dimensions = Object.assign({}, safe);
    delete dimensions.dataValueJson;
    const metrics = parseMetricObject(safe.dataValueJson);
    const placementType = normalizePlacementType(
      dimensions.placementType !== undefined
        ? dimensions.placementType
        : dimensions.placementName !== undefined
          ? dimensions.placementName
          : metrics.placementType !== undefined
            ? metrics.placementType
            : metrics.placementName !== undefined
              ? metrics.placementName
              : dimensions.placement !== undefined
                ? dimensions.placement
                : metrics.placement
    );
    if (placementType !== null) dimensions.placementType = placementType;
    const noteId = String(dimensions.noteId || metrics.noteId || '').trim() || null;
    return { noteId, dimensions, metrics };
  }

  function normalizeReportTotal(dataValue) {
    const data = isObject(dataValue) ? dataValue : {};
    if (!isObject(data.totalData)) throw new Error('Juguang response data.totalData is missing or invalid.');
    const safe = contract.sanitizeSensitiveData(data.totalData);
    const dimensions = Object.assign({}, safe);
    delete dimensions.dataValueJson;
    return { dimensions, metrics: parseMetricObject(safe.dataValueJson) };
  }

  function finiteNonNegativeInteger(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
      throw reportSchemaError(
        `Juguang response ${field} must be a finite non-negative integer.`
      );
    }
    return number;
  }

  function finitePositiveInteger(value, field) {
    const number = finiteNonNegativeInteger(value, field);
    if (number < 1) {
      throw reportSchemaError(`Juguang response ${field} must be a positive integer.`);
    }
    return number;
  }

  function parseJuguangPage(response, page) {
    if (!isObject(response) || !isObject(response.data)) {
      throw reportSchemaError('Juguang response data is missing or invalid.');
    }
    const data = response.data;
    if (!Array.isArray(data.dataList)) {
      throw reportSchemaError('Juguang response data.dataList must be an array.');
    }
    if (!isObject(data.page)) {
      throw reportSchemaError('Juguang response data.page is missing or invalid.');
    }
    const currentPage = Math.max(1, Number(page) || 1);
    const hasPageIndex = Object.prototype.hasOwnProperty.call(data.page, 'pageIndex');
    const hasPageNum = Object.prototype.hasOwnProperty.call(data.page, 'pageNum');
    if (!hasPageIndex && !hasPageNum) {
      throw reportSchemaError(
        'Juguang response data.page.pageIndex (or compatible pageNum) is missing.'
      );
    }
    const pageIndex = finitePositiveInteger(
      hasPageIndex ? data.page.pageIndex : data.page.pageNum,
      hasPageIndex ? 'data.page.pageIndex' : 'data.page.pageNum'
    );
    if (hasPageIndex && hasPageNum) {
      const compatiblePageNum = finitePositiveInteger(data.page.pageNum, 'data.page.pageNum');
      if (compatiblePageNum !== pageIndex) {
        throw reportSchemaError(
          `Juguang response data.page.pageIndex/pageNum conflict: ${pageIndex} versus ${compatiblePageNum}.`
        );
      }
    }
    const pageSize = finitePositiveInteger(data.page.pageSize, 'data.page.pageSize');
    const total = finiteNonNegativeInteger(data.page.totalCount, 'data.page.totalCount');
    const totalPage = finiteNonNegativeInteger(data.page.totalPage, 'data.page.totalPage');
    if (pageIndex !== currentPage) {
      throw reportSchemaError(
        `Juguang response page mismatch: expected ${currentPage}, received ${pageIndex}.`
      );
    }
    const expectedTotalPage = total === 0 ? 0 : Math.ceil(total / pageSize);
    if (totalPage !== expectedTotalPage) {
      throw reportSchemaError(
        `Juguang response pagination is inconsistent: totalPage ${totalPage}, expected ${expectedTotalPage}.`
      );
    }
    const expectedItems = total === 0
      ? 0
      : Math.max(0, Math.min(pageSize, total - ((pageIndex - 1) * pageSize)));
    if (data.dataList.length !== expectedItems) {
      throw reportSchemaError(
        `Juguang response pagination row count mismatch: expected ${expectedItems}, received ${data.dataList.length}.`
      );
    }
    const hasNext = pageIndex < totalPage;
    return {
      items: data.dataList,
      total,
      pageSize,
      hasNext,
      nextPage: hasNext ? pageIndex + 1 : null,
      totalData: normalizeReportTotal(data),
      unsupportedColumns: unsupportedColumnNames(data.unsupportedColumns),
    };
  }

  function spendOf(value, field) {
    const missing = value === null || value === undefined ||
      (typeof value === 'string' && value.trim() === '');
    const number = missing ? NaN : Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw reportSchemaError(
        `Juguang response ${field || 'fee'} must be a finite non-negative fee.`
      );
    }
    return number;
  }

  function reconcileJuguangSpend(input) {
    const source = isObject(input) ? input : {};
    const accountSpend = spendOf(source.accountSpend, 'account fee');
    const summarySpend = (Array.isArray(source.summaryRows) ? source.summaryRows : [])
      .reduce((sum, row, index) => sum + spendOf(
        row && row.metrics && row.metrics.fee,
        `summaryRows[${index}].metrics.fee`
      ), 0);
    const dailySpend = (Array.isArray(source.dailyRows) ? source.dailyRows : [])
      .reduce((sum, row, index) => sum + spendOf(
        row && row.metrics && row.metrics.fee,
        `dailyRows[${index}].metrics.fee`
      ), 0);
    const tolerance = Math.max(0.01, Math.abs(accountSpend) * 0.01);
    const issues = [];
    if (Math.abs(summarySpend - accountSpend) > tolerance) {
      issues.push({ code: 'summary_spend_mismatch', expected: accountSpend, actual: summarySpend, tolerance });
    }
    if (Math.abs(dailySpend - accountSpend) > tolerance) {
      issues.push({ code: 'daily_spend_mismatch', expected: accountSpend, actual: dailySpend, tolerance });
    }
    return {
      reconciled: issues.length === 0,
      accountSpend,
      summarySpend,
      dailySpend,
      tolerance,
      issues,
    };
  }

  function errorRecord(error, fields) {
    return contract.sanitizeSensitiveData(Object.assign({
      code: error && error.code || 'juguang_collection_error',
      message: String(error && error.message || error || 'Unknown Juguang collection error'),
    }, fields || {}));
  }

  function normalizeMaxPages(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function flattenPages(record) {
    return (record && Array.isArray(record.pages) ? record.pages : [])
      .slice().sort((left, right) => left.page - right.page)
      .flatMap((entry) => Array.isArray(entry.items) ? entry.items : []);
  }

  function createJuguangCollector(options) {
    const settings = isObject(options) ? options : {};
    if (!settings.pageClient || typeof settings.pageClient.request !== 'function') {
      throw new Error('Juguang pageClient is required.');
    }
    if (!settings.cache || typeof settings.cache.open !== 'function') {
      throw new Error('Juguang collection cache is required.');
    }
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    const retry = isObject(settings.retry) ? settings.retry : { retries: 2, baseDelayMs: 150, maxDelayMs: 1500 };
    const zeroSpendCacheTtlMs = Math.max(
      0,
      Number(settings.zeroSpendCacheTtlMs) || DEFAULT_ZERO_SPEND_CACHE_TTL_MS
    );

    async function request(tabId, endpoint, payload, signal, pinnedTabId) {
      return settings.pageClient.request({
        tabId, platform: 'juguang', endpoint, payload: payload || {}, signal,
        pinnedTabId: Boolean(pinnedTabId),
      });
    }

    function rethrowAbort(error, signal) {
      if (collectorCore.isAbortError(error, signal)) throw collectorCore.abortError(signal);
    }

    async function currentAccount(context) {
      collectorCore.throwIfAborted(context.signal);
      return accountTools.normalizeListedAccount(await request(
        context.tabId, 'accounts.current', {}, context.signal, context.pinnedTabId
      ));
    }

    function isStrongCurrentAccount(account) {
      const normalized = accountTools.normalizeListedAccount(account);
      const advertiserId = Number(normalized.advertiserId);
      const accountType = Number(normalized.accountType);
      if (!Number.isFinite(advertiserId) || advertiserId <= 0) return false;
      if (accountType === 4) return true;
      return accountType === 602 && Boolean(String(normalized.vSellerId || '').trim());
    }

    function verifyGuardedCurrentAccount(actual, expected) {
      try {
        return accountTools.verifyAccount(actual, expected);
      } catch (cause) {
        const error = new Error('Juguang current account identity changed during guarded collection.');
        error.code = 'JUGUANG_ACCOUNT_IDENTITY_DRIFT';
        error.retryable = false;
        throw error;
      }
    }

    async function verifyStableCurrentAccount(context, expected) {
      verifyGuardedCurrentAccount(await currentAccount(context), expected);
      // Let a return-to-main action that rejected before its page-side mutation settle before
      // accepting the fallback identity. Every report request is guarded again below.
      await Promise.resolve();
      return verifyGuardedCurrentAccount(await currentAccount(context), expected);
    }

    async function requestGuardedReport(context, account, payload, guarded) {
      if (guarded) verifyGuardedCurrentAccount(await currentAccount(context), account);
      const response = await request(
        context.tabId, 'reports.query', payload, context.signal, context.pinnedTabId
      );
      // The page can finish a previously timed-out account transition while the report is in
      // flight. Reject its response unless the same strong identity is still current.
      if (guarded) verifyGuardedCurrentAccount(await currentAccount(context), account);
      return response;
    }

    async function returnToMainAccount(context, current) {
      if (typeof settings.returnToMainAccount !== 'function') {
        throw new Error('Juguang child account discovery requires the return-to-main workflow.');
      }
      const actual = accountTools.normalizeListedAccount(await settings.returnToMainAccount({
        tabId: context.tabId,
        current: accountTools.normalizeListedAccount(current),
        reportPath: '/aurora/ad/datareports-basic/note',
        signal: context.signal,
        pinnedTabId: context.pinnedTabId,
      }));
      if (Number(actual.accountType) !== 4) {
        throw new Error(`Juguang main account identity mismatch: expected accountType 4, got ${actual.accountType}`);
      }
      return actual;
    }

    async function switchAccount(context, target) {
      const current = await currentAccount(context);
      try {
        return accountTools.verifyAccount(current, target);
      } catch (error) {
        // A real transition is only needed when the verified current identity differs.
      }
      if (Number(target && target.accountType) === 4 && typeof settings.returnToMainAccount === 'function') {
        const actual = await returnToMainAccount(context, current);
        return accountTools.verifyAccount(actual, target);
      }
      if (typeof settings.switchAccount === 'function') {
        const actual = accountTools.normalizeListedAccount(await settings.switchAccount({
          tabId: context.tabId,
          target,
          reportPath: '/aurora/ad/datareports-basic/note',
          signal: context.signal,
          pinnedTabId: context.pinnedTabId,
        }));
        return accountTools.verifyAccount(actual, target);
      } else {
        // Test adapters may emulate navigation through the same injected page-client surface.
        await settings.pageClient.request({
          tabId: context.tabId,
          platform: 'juguang',
          endpoint: 'accounts.switch',
          payload: { target },
          signal: context.signal,
          pinnedTabId: context.pinnedTabId,
        });
      }
      return accountTools.verifyAccount(await currentAccount(context), target);
    }

    async function discoverAccounts(context, initial) {
      if (Number(initial && initial.accountType) !== 4) {
        await returnToMainAccount(context, initial);
      }
      const discovered = [];
      for (const shadowAccount of [false, true]) {
        let pageIndex = 1;
        while (true) {
          collectorCore.throwIfAborted(context.signal);
          const response = await request(context.tabId, 'accounts.list', {
            pageIndex, pageSize: 50, shadowAccount,
          }, context.signal, context.pinnedTabId);
          if (!isObject(response) || !Array.isArray(response.accounts)) {
            throw new Error('Juguang account list accounts is missing or invalid.');
          }
          discovered.push(...response.accounts.map(accountTools.normalizeListedAccount));
          const total = Number(response.total);
          if (!response.accounts.length || !Number.isFinite(total) || pageIndex * 50 >= total) break;
          pageIndex += 1;
        }
      }

      const normalizedInitial = accountTools.normalizeListedAccount(initial);
      const canonicalInitial = discovered.find((account) => (
        normalizedInitial.vSellerId && String(account.vSellerId || '') === String(normalizedInitial.vSellerId)
      )) || discovered.find((account) => (
        Number(account.advertiserId) === Number(normalizedInitial.advertiserId) &&
        Number(account.accountType) === Number(normalizedInitial.accountType)
      )) || normalizedInitial;
      const byKey = new Map();
      for (const account of discovered) {
        byKey.set(accountTools.accountKey(account), account);
      }
      const canonicalKey = accountTools.accountKey(canonicalInitial);
      if (!byKey.has(canonicalKey)) byKey.set(canonicalKey, canonicalInitial);
      return { initialAccount: canonicalInitial, targets: Array.from(byKey.values()) };
    }

    function reportBody(context, overrides) {
      const source = isObject(overrides) ? overrides : {};
      return {
        pageNum: source.pageNum || 1,
        pageSize: source.pageSize || context.pageSize,
        sorts: source.sorts || [],
        filters: source.filters || [],
        dataCaliber: ATTRIBUTION.dataCaliber,
        timeUnit: source.timeUnit || 'SUMMARY',
        splitColumns: source.splitColumns || [],
        startDate: context.dateRange.from,
        endDate: context.dateRange.to,
        webModule: 'base_report_page',
        dataSource: source.dataSource || 'note',
        dataPattern: 'table',
        columns: source.columns || NOTE_COLUMNS,
      };
    }

    async function collectReport(context, account, dataset, overrides, guarded) {
      const accountId = accountTools.accountKey(account);
      const cacheKey = `${context.prefix}:account:${encodeURIComponent(accountId)}:${dataset}`;
      const fingerprint = collectorCore.stableFingerprint({
        endpoint: 'reports.query', accountKey: context.accountKey, accountId,
        dataset, dateRange: context.dateRange, pageSize: context.pageSize,
        dataCaliber: ATTRIBUTION.dataCaliber,
        timeUnit: overrides.timeUnit,
        splitColumns: overrides.splitColumns || [],
        columns: overrides.columns,
      });
      let paginationError = null;
      let result;
      let lastTotal = null;
      let unsupportedColumns = [];
      try {
        result = await collectorCore.collectPaginated({
          cache: settings.cache,
          cacheKey,
          fingerprint,
          maxPages: context.maxPages,
          retry,
          signal: context.signal,
          fetchPage: (page) => requestGuardedReport(context, account, reportBody(context, {
            ...overrides, pageNum: page,
          }), guarded),
          parsePage(response, page) {
            const parsed = parseJuguangPage(response, page);
            assertFeeSupported(dataset, parsed.unsupportedColumns);
            spendOf(parsed.totalData.metrics.fee, `${dataset} totalData.metrics.fee`);
            const items = parsed.items.map(normalizeReportRow);
            items.forEach((item, index) => spendOf(
              item && item.metrics && item.metrics.fee,
              `${dataset} dataList[${index}].metrics.fee`
            ));
            if (dataset === 'daily' && (overrides.splitColumns || []).includes('placement')) {
              const paidItems = items.filter((item) => Number(item && item.metrics && item.metrics.fee) > 0);
              if (paidItems.length && paidItems.every((item) => !(
                item && item.dimensions && item.dimensions.placementType !== null &&
                item.dimensions.placementType !== undefined &&
                String(item.dimensions.placementType).trim()
              ))) {
                throw reportSchemaError(
                  'Juguang paid daily rows are missing the requested placement dimension.'
                );
              }
            }
            lastTotal = parsed.totalData;
            unsupportedColumns = unsupportedColumnNames(
              unsupportedColumns.concat(parsed.unsupportedColumns)
            );
            return Object.assign({}, parsed, { items });
          },
        });
      } catch (error) {
        rethrowAbort(error, context.signal);
        if (error && error.code === 'JUGUANG_ACCOUNT_IDENTITY_DRIFT') throw error;
        paginationError = error;
        if (error && error.schemaInvalid) throw error;
        const record = await settings.cache.read(cacheKey);
        if (!record || Number(record.receivedCount) === 0) throw error;
        await settings.cache.update(cacheKey, {
          status: 'partial',
          warnings: [{ code: 'pagination_incomplete', message: String(error.message || error) }],
        });
        const partial = await settings.cache.read(cacheKey);
        result = {
          cacheKey,
          fingerprint,
          status: 'partial',
          truncated: Boolean(partial.truncated),
          nextPage: partial.nextPage,
          receivedCount: partial.receivedCount,
          expectedCount: partial.expectedCount,
          pageCount: partial.pageCount,
          items: flattenPages(partial),
          warnings: partial.warnings || [],
        };
      }
      return { result, total: lastTotal, unsupportedColumns, paginationError };
    }

    function accountOutput(account) {
      return {
        account: contract.sanitizeSensitiveData(account),
        status: 'failed',
        schemaValid: true,
        truncated: false,
        accountSummary: null,
        summaryRows: [],
        dailyRows: [],
        checkpoints: {},
        reconciliation: { reconciled: false, issues: [] },
        warnings: [],
        errors: [],
      };
    }

    function zeroSpendProofDescriptor(context, account) {
      const accountId = accountTools.accountKey(account);
      return {
        cacheKey: [
          'xhs:juguang:zero-spend-proof',
          encodeURIComponent(context.accountKey),
          encodeURIComponent(accountId),
          context.dateRange.from,
          context.dateRange.to,
        ].join(':'),
        fingerprint: collectorCore.stableFingerprint({
          kind: 'juguang_zero_spend_proof_v1',
          accountKey: context.accountKey,
          accountId,
          dateRange: context.dateRange,
          attribution: ATTRIBUTION,
        }),
      };
    }

    async function readZeroSpendProof(context, account) {
      const descriptor = zeroSpendProofDescriptor(context, account);
      const record = await settings.cache.open(descriptor.cacheKey, descriptor.fingerprint);
      const proof = record && record.status === 'complete' &&
        Array.isArray(record.pages) && record.pages[0] && record.pages[0].items[0];
      const expiresAt = proof && Date.parse(String(proof.expiresAt || ''));
      const currentTime = Date.parse(String(now()));
      if (!proof || !Number.isFinite(expiresAt) || !Number.isFinite(currentTime) || expiresAt <= currentTime) {
        return null;
      }
      return proof;
    }

    async function writeZeroSpendProof(context, account, accountSummary) {
      const descriptor = zeroSpendProofDescriptor(context, account);
      await settings.cache.open(descriptor.cacheKey, descriptor.fingerprint);
      const verifiedAt = String(now());
      const verifiedTime = Date.parse(verifiedAt);
      const proof = {
        verifiedAt,
        expiresAt: new Date(verifiedTime + zeroSpendCacheTtlMs).toISOString(),
        accountSummary: contract.sanitizeSensitiveData(accountSummary),
      };
      await settings.cache.commitPage(descriptor.cacheKey, descriptor.fingerprint, {
        page: 1,
        items: [proof],
        expectedCount: 1,
        nextPage: null,
      });
      await settings.cache.update(descriptor.cacheKey, {
        status: 'complete',
        truncated: false,
        nextPage: null,
        warnings: [],
      });
      return proof;
    }

    function cachedNoSpendOutput(account, proof) {
      const output = accountOutput(account);
      output.status = 'cached_no_spend';
      output.accountSummary = proof.accountSummary || {
        dimensions: {}, metrics: { fee: 0 },
      };
      output.reconciliation = {
        reconciled: true, accountSpend: 0, summarySpend: 0, dailySpend: 0, issues: [],
      };
      output.zeroSpendProof = {
        source: 'cache',
        verifiedAt: proof.verifiedAt,
        expiresAt: proof.expiresAt,
      };
      return contract.sanitizeSensitiveData(output);
    }

    async function collectAccount(context, account, options) {
      const guarded = Boolean(options && options.requireStableCurrentIdentity);
      const throwIdentityDrift = Boolean(options && options.throwIdentityDrift);
      const allowCachedZero = !(options && options.allowCachedZero === false);
      const output = accountOutput(account);
      let hasUnsupportedColumns = false;
      if (allowCachedZero) {
        const proof = await readZeroSpendProof(context, account);
        if (proof) return cachedNoSpendOutput(account, proof);
      }
      try {
        if (guarded) await verifyStableCurrentAccount(context, account);
        else await switchAccount(context, account);
      } catch (error) {
        rethrowAbort(error, context.signal);
        if (throwIdentityDrift && error && error.code === 'JUGUANG_ACCOUNT_IDENTITY_DRIFT') {
          throw error;
        }
        const mismatch = error && error.code === 'JUGUANG_ACCOUNT_IDENTITY_DRIFT' ||
          /mismatch|不匹配/i.test(String(error && error.message || error));
        output.errors.push(errorRecord(error, {
          code: mismatch ? 'account_identity_mismatch' : 'account_switch_failed',
        }));
        return output;
      }

      try {
        const response = await requestGuardedReport(context, account, reportBody(context, {
          dataSource: 'account', columns: ACCOUNT_COLUMNS, pageSize: 1, timeUnit: 'SUMMARY',
        }), guarded);
        const parsed = parseJuguangPage(response, 1);
        output.accountSummary = parsed.totalData;
        hasUnsupportedColumns = recordUnsupportedColumns(
          output, 'account', parsed.unsupportedColumns
        ) || hasUnsupportedColumns;
        const accountSpend = spendOf(parsed.totalData.metrics.fee, 'account totalData.metrics.fee');
        if (accountSpend <= 0) {
          output.status = 'verified_no_spend';
          output.reconciliation = {
            reconciled: true, accountSpend: 0, summarySpend: 0, dailySpend: 0, issues: [],
          };
          const proof = await writeZeroSpendProof(context, account, output.accountSummary);
          output.zeroSpendProof = {
            source: 'live',
            verifiedAt: proof.verifiedAt,
            expiresAt: proof.expiresAt,
          };
          return output;
        }

        const summary = await collectReport(context, account, 'summary', {
          dataSource: 'note', timeUnit: 'SUMMARY', splitColumns: [], columns: NOTE_COLUMNS,
          sorts: [{ column: 'fee', sort: 'desc' }],
        }, guarded);
        output.summaryRows = summary.result.items;
        output.checkpoints.summary = summary.result;
        hasUnsupportedColumns = recordUnsupportedColumns(
          output, 'summary', summary.unsupportedColumns
        ) || hasUnsupportedColumns;
        if (summary.paginationError) {
          output.errors.push(errorRecord(summary.paginationError, { code: 'pagination_incomplete', dataset: 'summary' }));
        }

        const daily = await collectReport(context, account, 'daily', {
          dataSource: 'note', timeUnit: 'DAY', splitColumns: ATTRIBUTION.splitColumns,
          columns: DAILY_COLUMNS, sorts: [{ column: 'time', sort: 'asc' }],
        }, guarded);
        output.dailyRows = daily.result.items;
        output.checkpoints.daily = daily.result;
        hasUnsupportedColumns = recordUnsupportedColumns(
          output, 'daily', daily.unsupportedColumns
        ) || hasUnsupportedColumns;
        if (daily.paginationError) {
          output.errors.push(errorRecord(daily.paginationError, { code: 'pagination_incomplete', dataset: 'daily' }));
        }

        output.truncated = Boolean(summary.result.truncated || daily.result.truncated);
        output.warnings.push(...(summary.result.warnings || []), ...(daily.result.warnings || []));
        output.reconciliation = reconcileJuguangSpend({
          accountSpend,
          summaryRows: output.summaryRows,
          dailyRows: output.dailyRows,
        });
        output.warnings.push(...output.reconciliation.issues);
        output.status = summary.result.status === 'complete' && daily.result.status === 'complete' &&
          output.reconciliation.reconciled && output.errors.length === 0 && !hasUnsupportedColumns
          ? 'complete'
          : 'partial';
      } catch (error) {
        rethrowAbort(error, context.signal);
        const identityDrift = error && error.code === 'JUGUANG_ACCOUNT_IDENTITY_DRIFT';
        if (throwIdentityDrift && identityDrift) throw error;
        output.schemaValid = identityDrift;
        output.errors.push(errorRecord(error, {
          code: identityDrift ? 'account_identity_mismatch' : 'report_schema_invalid',
        }));
        output.status = 'failed';
      }
      return contract.sanitizeSensitiveData(output);
    }

    function isChildAccount(account) {
      return Number(account && account.accountType) === 602 &&
        Boolean(String(account && account.vSellerId || '').trim());
    }

    function concurrentTabCount(value, childCount) {
      if (value === undefined || value === null || value === '' || value === false) return 0;
      const requested = Math.floor(Number(value));
      const configured = value === true
        ? DEFAULT_CONCURRENT_ACCOUNT_TABS
        : Number.isFinite(requested)
        ? Math.min(3, Math.max(2, requested))
        : DEFAULT_CONCURRENT_ACCOUNT_TABS;
      return Math.min(Math.max(0, Number(childCount) || 0), configured);
    }

    function parallelFailureReason(error) {
      if (error && error.code === 'JUGUANG_ACCOUNT_IDENTITY_DRIFT') {
        return 'account_identity_drift';
      }
      if (error && error.code === 'JUGUANG_TAB_ISOLATION_FAILED') {
        return 'isolation_failed';
      }
      return 'parallel_collection_failed';
    }

    function tabIsolationError(message, cause) {
      const error = new Error(message || 'Juguang temporary tabs failed account isolation verification.');
      error.code = 'JUGUANG_TAB_ISOLATION_FAILED';
      error.retryable = false;
      if (cause) error.cause = cause;
      return error;
    }

    async function collectChildAccountsInParallel(context, children, laneCount, state) {
      let tabIds = [];
      let externalAbortListener = null;
      const laneController = new AbortController();
      if (context.signal) {
        externalAbortListener = () => laneController.abort(context.signal.reason);
        if (context.signal.aborted) externalAbortListener();
        else context.signal.addEventListener('abort', externalAbortListener, { once: true });
      }
      try {
        const created = await settings.createConcurrentAccountTabs({
          count: laneCount,
          sourceTabId: context.tabId,
          reportPath: '/aurora/ad/datareports-basic/note',
          signal: context.signal,
        });
        tabIds = (Array.isArray(created) ? created : created && created.tabIds || [])
          .map(Number)
          .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
        if (tabIds.length !== laneCount || new Set(tabIds).size !== laneCount) {
          throw tabIsolationError(
            `Juguang requested ${laneCount} temporary tabs but received ${tabIds.length} unique tabs.`
          );
        }

        const laneContexts = tabIds.map((tabId) => Object.assign({}, context, {
          tabId,
          pinnedTabId: true,
          signal: laneController.signal,
          prefix: `${context.prefix}:parallel-attempt:${tabId}`,
        }));
        const isolationTargets = children.slice(0, laneCount);
        const expectedAdvertiserIds = isolationTargets.map((account) => Number(account.advertiserId));
        if (expectedAdvertiserIds.some((id) => !Number.isFinite(id) || id <= 0) ||
            new Set(expectedAdvertiserIds).size !== expectedAdvertiserIds.length) {
          throw tabIsolationError('Juguang child accounts do not expose distinct advertiserId values.');
        }

        await Promise.all(laneContexts.map((laneContext, index) => (
          switchAccount(laneContext, isolationTargets[index])
        )));
        const verified = await Promise.all(laneContexts.map((laneContext, index) => (
          verifyStableCurrentAccount(laneContext, isolationTargets[index])
        )));
        const actualAdvertiserIds = verified.map((entry) => Number(entry.verified.advertiserId));
        if (new Set(actualAdvertiserIds).size !== actualAdvertiserIds.length) {
          throw tabIsolationError('Juguang temporary tabs share an advertiserId after switching.');
        }
        state.isolationVerified = true;
        state.activeLanes = laneCount;

        const results = new Array(children.length);
        let nextIndex = 0;
        let terminalError = null;
        async function runLane(laneContext) {
          while (!terminalError) {
            collectorCore.throwIfAborted(laneContext.signal);
            const index = nextIndex;
            nextIndex += 1;
            if (index >= children.length) return;
            try {
              await switchAccount(laneContext, children[index]);
              results[index] = await collectAccount(laneContext, children[index], {
                requireStableCurrentIdentity: true,
                throwIdentityDrift: true,
              });
            } catch (error) {
              if (!terminalError && !collectorCore.isAbortError(error, laneContext.signal)) {
                terminalError = error;
                laneController.abort(error);
              }
              return;
            }
          }
        }
        await Promise.allSettled(laneContexts.map((laneContext) => runLane(laneContext)));
        if (context.signal && context.signal.aborted) throw collectorCore.abortError(context.signal);
        if (terminalError) throw terminalError;
        if (results.some((entry) => !entry)) {
          throw tabIsolationError('Juguang concurrent account collection ended before every account completed.');
        }
        return results;
      } catch (error) {
        if (collectorCore.isAbortError(error, context.signal)) throw collectorCore.abortError(context.signal);
        if (error && ['JUGUANG_ACCOUNT_IDENTITY_DRIFT', 'JUGUANG_TAB_ISOLATION_FAILED'].includes(error.code)) {
          throw error;
        }
        throw tabIsolationError('Juguang concurrent account tabs could not be verified.', error);
      } finally {
        if (externalAbortListener && context.signal) {
          context.signal.removeEventListener('abort', externalAbortListener);
        }
        if (tabIds.length > 0 && typeof settings.closeConcurrentAccountTabs === 'function') {
          await settings.closeConcurrentAccountTabs({ tabIds: tabIds.slice() });
        }
      }
    }

    async function collect(input) {
      const source = isObject(input) ? input : {};
      const context = {
        tabId: Number(source.tabId),
        runId: String(source.runId || '').trim(),
        accountKey: String(source.accountKey || '').trim(),
        dateRange: contract.sanitizeSensitiveData(source.dateRange || {}),
        pageSize: Math.max(1, Math.floor(Number(source.pageSize) || 20)),
        maxPages: normalizeMaxPages(source.maxPages),
        concurrentAccountTabs: source.concurrentAccountTabs,
        signal: source.signal,
        pinnedTabId: false,
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('Juguang tabId is required.');
      if (!context.runId || !context.accountKey) throw new Error('Juguang runId and accountKey are required.');
      if (!context.dateRange.from || !context.dateRange.to) throw new Error('Juguang dateRange is required.');
      context.prefix = `xhs:${encodeURIComponent(context.runId)}:juguang`;
      const startedAt = now();
      collectorCore.throwIfAborted(context.signal);
      let initialAccount = null;
      let restoredAccount = null;
      let sessionRestoreStatus = 'not_attempted';
      const accounts = [];
      const errors = [];
      const restoreWarnings = [];
      const collectionWarnings = [];
      const accountCollection = {
        mode: 'sequential',
        requestedLanes: 0,
        activeLanes: 0,
        isolationVerified: false,
        fallbackReason: null,
      };
      let targets = [];
      try {
        initialAccount = await currentAccount(context);
        const discovery = await discoverAccounts(context, initialAccount);
        initialAccount = discovery.initialAccount;
        targets = discovery.targets;
        const children = targets.filter(isChildAccount);
        const sequentialTargets = targets.filter((account) => !isChildAccount(account));
        const resultsByAccount = new Map();
        for (const account of sequentialTargets) {
          collectorCore.throwIfAborted(context.signal);
          resultsByAccount.set(
            accountTools.accountKey(account),
            await collectAccount(context, account)
          );
        }

        const laneCount = concurrentTabCount(context.concurrentAccountTabs, children.length);
        const canUseConcurrentTabs = laneCount >= 2 &&
          typeof settings.createConcurrentAccountTabs === 'function' &&
          typeof settings.closeConcurrentAccountTabs === 'function';
        accountCollection.requestedLanes = laneCount;
        if (canUseConcurrentTabs) {
          try {
            const parallelResults = await collectChildAccountsInParallel(
              context, children, laneCount, accountCollection
            );
            accountCollection.mode = 'parallel';
            parallelResults.forEach((result, index) => {
              resultsByAccount.set(accountTools.accountKey(children[index]), result);
            });
          } catch (error) {
            rethrowAbort(error, context.signal);
            accountCollection.mode = 'sequential_fallback';
            accountCollection.activeLanes = 0;
            accountCollection.fallbackReason = parallelFailureReason(error);
            collectionWarnings.push(errorRecord(error, {
              code: 'juguang_parallel_fallback',
              reason: accountCollection.fallbackReason,
            }));
            for (const account of children) {
              collectorCore.throwIfAborted(context.signal);
              resultsByAccount.set(
                accountTools.accountKey(account),
                await collectAccount(context, account, { allowCachedZero: false })
              );
            }
          }
        } else {
          for (const account of children) {
            collectorCore.throwIfAborted(context.signal);
            resultsByAccount.set(
              accountTools.accountKey(account),
              await collectAccount(context, account)
            );
          }
        }
        for (const account of targets) {
          const result = resultsByAccount.get(accountTools.accountKey(account));
          if (result) accounts.push(result);
        }
      } catch (error) {
        rethrowAbort(error, context.signal);
        errors.push(errorRecord(error, { code: 'account_discovery_failed' }));
        // The current advertiser identity comes from the official MCC identity endpoint and
        // is still safe to query even when the product's return-to-main UI has changed. Keep
        // the discovery error so the result cannot be mistaken for full advertiser coverage.
        if (isStrongCurrentAccount(initialAccount)) {
          targets = [initialAccount];
          accounts.push(await collectAccount(context, initialAccount, {
            requireStableCurrentIdentity: true,
          }));
        }
      } finally {
        if (initialAccount && !(context.signal && context.signal.aborted)) {
          sessionRestoreStatus = 'running';
          try {
            const restored = await switchAccount(context, initialAccount);
            restoredAccount = restored.verified;
            sessionRestoreStatus = 'complete';
          } catch (error) {
            rethrowAbort(error, context.signal);
            sessionRestoreStatus = 'failed';
            restoreWarnings.push(errorRecord(error, { code: 'account_restore_failed' }));
          }
        }
      }

      collectorCore.throwIfAborted(context.signal);

      const failedUnits = accounts.filter((account) => ![
        'complete', 'verified_no_spend', 'cached_no_spend',
      ].includes(account.status));
      const truncated = accounts.some((account) => account.truncated);
      const warnings = restoreWarnings.concat(collectionWarnings, accounts.flatMap((account) => (
        account.warnings || []
      ).map((warning) => (
        Object.assign({ accountId: accountTools.accountKey(account.account) }, warning)
      ))));
      if (truncated && !warnings.some((warning) => warning.code === 'truncated_maxPages')) {
        warnings.unshift({ code: 'truncated_maxPages', limit: 'maxPages', value: context.maxPages });
      }
      const accountErrors = accounts.flatMap((account) => (account.errors || []).map((error) => (
        Object.assign({ accountId: accountTools.accountKey(account.account) }, error)
      )));
      const status = targets.length > 0 && accounts.length === targets.length &&
        errors.length === 0 && accountErrors.length === 0 && failedUnits.length === 0 && !truncated
        ? 'complete'
        : targets.length || accounts.length ? 'partial' : 'failed';
      return {
        schemaVersion: 1,
        platform: 'juguang',
        runId: context.runId,
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        startedAt,
        finishedAt: now(),
        status,
        truncated,
        initialAccount: contract.sanitizeSensitiveData(initialAccount),
        restoredAccount: contract.sanitizeSensitiveData(restoredAccount),
        sessionRestore: { status: sessionRestoreStatus },
        accountCollection,
        accounts: contract.sanitizeSensitiveData(accounts),
        attribution: ATTRIBUTION,
        warnings: contract.sanitizeSensitiveData(warnings),
        errors: contract.sanitizeSensitiveData(errors.concat(accountErrors)),
      };
    }

    return Object.freeze({ collect });
  }

  return Object.freeze({
    ACCOUNT_COLUMNS,
    ATTRIBUTION,
    DAILY_COLUMNS,
    NOTE_COLUMNS,
    createJuguangCollector,
    normalizeReportRow,
    normalizeReportTotal,
    parseJuguangPage,
    reconcileJuguangSpend,
  });
});
