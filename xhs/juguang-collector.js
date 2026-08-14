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
    splitColumns: Object.freeze(['marketingTarget', 'deliveryMode']),
    verifiedAt: '2026-08-04',
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
    'time', 'noteId', 'marketingTarget', 'deliveryMode',
    ...NOTE_COLUMNS.filter((column) => !['time', 'noteId'].includes(column)),
  ]);
  const ACCOUNT_COLUMNS = Object.freeze(NOTE_COLUMNS.filter((column) => (
    !['noteId', 'noteMaterialType'].includes(column)
  )));

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

  function normalizeReportRow(value) {
    if (!isObject(value)) throw new Error('Juguang report row must be an object.');
    const safe = contract.sanitizeSensitiveData(value);
    const dimensions = Object.assign({}, safe);
    delete dimensions.dataValueJson;
    const metrics = parseMetricObject(safe.dataValueJson);
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

  function finiteNonNegative(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Juguang response ${field} must be a finite non-negative number.`);
    }
    return number;
  }

  function parseJuguangPage(response, page) {
    if (!isObject(response) || !isObject(response.data)) throw new Error('Juguang response data is missing or invalid.');
    const data = response.data;
    if (!Array.isArray(data.dataList)) throw new Error('Juguang response data.dataList must be an array.');
    if (!isObject(data.page)) throw new Error('Juguang response data.page is missing or invalid.');
    const currentPage = Math.max(1, Number(page) || 1);
    const pageNum = finiteNonNegative(data.page.pageNum, 'data.page.pageNum');
    const pageSize = finiteNonNegative(data.page.pageSize, 'data.page.pageSize');
    const total = finiteNonNegative(data.page.totalCount, 'data.page.totalCount');
    const totalPage = finiteNonNegative(data.page.totalPage, 'data.page.totalPage');
    if (pageNum > 0 && pageNum !== currentPage) {
      throw new Error(`Juguang response page mismatch: expected ${currentPage}, received ${pageNum}.`);
    }
    const hasNext = currentPage < totalPage;
    return {
      items: data.dataList,
      total,
      pageSize,
      hasNext,
      nextPage: hasNext ? currentPage + 1 : null,
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

    async function request(tabId, endpoint, payload) {
      return settings.pageClient.request({ tabId, platform: 'juguang', endpoint, payload: payload || {} });
    }

    async function currentAccount(context) {
      return accountTools.normalizeListedAccount(await request(context.tabId, 'accounts.current', {}));
    }

    async function returnToMainAccount(context, current) {
      if (typeof settings.returnToMainAccount !== 'function') {
        throw new Error('Juguang child account discovery requires the return-to-main workflow.');
      }
      await settings.returnToMainAccount({
        tabId: context.tabId,
        current: accountTools.normalizeListedAccount(current),
        reportPath: '/aurora/ad/datareports-basic/note',
      });
      const actual = await currentAccount(context);
      if (Number(actual.accountType) !== 4) {
        throw new Error(`Juguang main account identity mismatch: expected accountType 4, got ${actual.accountType}`);
      }
      return actual;
    }

    async function switchAccount(context, target) {
      if (Number(target && target.accountType) === 4 && typeof settings.returnToMainAccount === 'function') {
        const current = await currentAccount(context);
        const actual = await returnToMainAccount(context, current);
        return accountTools.verifyAccount(actual, target);
      }
      if (typeof settings.switchAccount === 'function') {
        await settings.switchAccount({ tabId: context.tabId, target, reportPath: '/aurora/ad/datareports-basic/note' });
      } else {
        // Test adapters may emulate navigation through the same injected page-client surface.
        await settings.pageClient.request({
          tabId: context.tabId,
          platform: 'juguang',
          endpoint: 'accounts.switch',
          payload: { target },
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
          const response = await request(context.tabId, 'accounts.list', {
            pageIndex, pageSize: 50, shadowAccount,
          });
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

    async function collectReport(context, account, dataset, overrides) {
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
          fetchPage: (page) => request(context.tabId, 'reports.query', reportBody(context, {
            ...overrides, pageNum: page,
          })),
          parsePage(response, page) {
            const parsed = parseJuguangPage(response, page);
            assertFeeSupported(dataset, parsed.unsupportedColumns);
            spendOf(parsed.totalData.metrics.fee, `${dataset} totalData.metrics.fee`);
            const items = parsed.items.map(normalizeReportRow);
            items.forEach((item, index) => spendOf(
              item && item.metrics && item.metrics.fee,
              `${dataset} dataList[${index}].metrics.fee`
            ));
            lastTotal = parsed.totalData;
            unsupportedColumns = unsupportedColumnNames(
              unsupportedColumns.concat(parsed.unsupportedColumns)
            );
            return Object.assign({}, parsed, { items });
          },
        });
      } catch (error) {
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

    async function collectAccount(context, account) {
      const output = {
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
      let hasUnsupportedColumns = false;
      try {
        await switchAccount(context, account);
      } catch (error) {
        const mismatch = /mismatch|不匹配/i.test(String(error && error.message || error));
        output.errors.push(errorRecord(error, {
          code: mismatch ? 'account_identity_mismatch' : 'account_switch_failed',
        }));
        return output;
      }

      try {
        const response = await request(context.tabId, 'reports.query', reportBody(context, {
          dataSource: 'account', columns: ACCOUNT_COLUMNS, pageSize: 1, timeUnit: 'SUMMARY',
        }));
        const parsed = parseJuguangPage(response, 1);
        output.accountSummary = parsed.totalData;
        hasUnsupportedColumns = recordUnsupportedColumns(
          output, 'account', parsed.unsupportedColumns
        ) || hasUnsupportedColumns;
        const accountSpend = spendOf(parsed.totalData.metrics.fee, 'account totalData.metrics.fee');
        if (accountSpend <= 0) {
          output.status = hasUnsupportedColumns ? 'partial' : 'verified_no_spend';
          output.reconciliation = {
            reconciled: true, accountSpend: 0, summarySpend: 0, dailySpend: 0, issues: [],
          };
          return output;
        }

        const summary = await collectReport(context, account, 'summary', {
          dataSource: 'note', timeUnit: 'SUMMARY', splitColumns: [], columns: NOTE_COLUMNS,
          sorts: [{ column: 'fee', sort: 'desc' }],
        });
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
        });
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
        output.schemaValid = false;
        output.errors.push(errorRecord(error, { code: 'report_schema_invalid' }));
        output.status = 'failed';
      }
      return contract.sanitizeSensitiveData(output);
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
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('Juguang tabId is required.');
      if (!context.runId || !context.accountKey) throw new Error('Juguang runId and accountKey are required.');
      if (!context.dateRange.from || !context.dateRange.to) throw new Error('Juguang dateRange is required.');
      context.prefix = `xhs:${encodeURIComponent(context.runId)}:juguang`;
      const startedAt = now();
      let initialAccount = null;
      let restoredAccount = null;
      const accounts = [];
      const errors = [];
      let targets = [];
      try {
        initialAccount = await currentAccount(context);
        const discovery = await discoverAccounts(context, initialAccount);
        initialAccount = discovery.initialAccount;
        targets = discovery.targets;
        for (const account of targets) accounts.push(await collectAccount(context, account));
      } catch (error) {
        errors.push(errorRecord(error, { code: 'account_discovery_failed' }));
      } finally {
        if (initialAccount) {
          try {
            const restored = await switchAccount(context, initialAccount);
            restoredAccount = restored.verified;
          } catch (error) {
            errors.push(errorRecord(error, { code: 'account_restore_failed' }));
          }
        }
      }

      const failedUnits = accounts.filter((account) => !['complete', 'verified_no_spend'].includes(account.status));
      const truncated = accounts.some((account) => account.truncated);
      const warnings = accounts.flatMap((account) => (account.warnings || []).map((warning) => (
        Object.assign({ accountId: accountTools.accountKey(account.account) }, warning)
      )));
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
