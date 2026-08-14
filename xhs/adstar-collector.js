(function initXhsAdstarCollector(root, factory) {
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
  root.XhsAdstarCollector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsAdstarCollectorApi(
  collectorCore,
  contract,
  quality
) {
  'use strict';

  if (!collectorCore) throw new Error('XhsCollectorCore must be loaded before XhsAdstarCollector');
  if (!contract) throw new Error('XhsContract must be loaded before XhsAdstarCollector');
  if (!quality) throw new Error('XhsQuality must be loaded before XhsAdstarCollector');

  const DELIVERY_MODE_BY_CODE = Object.freeze({
    88: 'cptSeedDaily',
  });
  const DEFAULT_PAGE_SIZE = 20;
  const DEFAULT_MEMBER_TYPE = 5;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNonNegative(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Star response ${field} must be a finite non-negative number.`);
    }
    return number;
  }

  function modelPage(response, page) {
    if (!isObject(response) || !isObject(response.model)) {
      throw new Error('Star response model is missing or invalid.');
    }
    const model = response.model;
    if (!Array.isArray(model.result)) {
      throw new Error('Star response model.result must be an array.');
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const responsePage = finiteNonNegative(model.pageNo, 'model.pageNo');
    if (responsePage !== currentPage) {
      throw new Error(`Star response model.pageNo mismatch: requested page ${currentPage}, received ${responsePage}.`);
    }
    const total = finiteNonNegative(model.totalCount, 'model.totalCount');
    const pageSize = finiteNonNegative(model.pageSize, 'model.pageSize');
    if (pageSize === 0 && total > 0) {
      throw new Error('Star response model.pageSize cannot be zero when rows exist.');
    }
    const totalPages = model.totalPages == null || model.totalPages === ''
      ? null
      : finiteNonNegative(model.totalPages, 'model.totalPages');
    if (typeof model.hasNext !== 'boolean' && totalPages == null) {
      throw new Error('Star response must include model.hasNext or model.totalPages.');
    }

    const hasNext = model.hasNext === true || (
      model.hasNext !== false && totalPages != null && currentPage < totalPages
    );
    let nextPage = null;
    if (hasNext) {
      nextPage = model.nextPage == null || model.nextPage === ''
        ? currentPage + 1
        : Number(model.nextPage);
      if (!Number.isInteger(nextPage) || nextPage <= currentPage) {
        throw new Error('Star response model.nextPage must advance beyond the current page.');
      }
    }

    return {
      items: model.result,
      total,
      pageSize,
      hasNext,
      nextPage,
    };
  }

  function reportDeliveryMode(order) {
    const source = isObject(order) ? order : {};
    const candidates = [
      source.deliveryModeType,
      source.reportDeliveryMode,
      source.deliveryModeCode,
      source.deliveryMode,
    ];
    for (const value of candidates) {
      if (value === undefined || value === null || value === '') continue;
      if (Object.prototype.hasOwnProperty.call(DELIVERY_MODE_BY_CODE, value)) {
        return DELIVERY_MODE_BY_CODE[value];
      }
      if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return value.trim();
    }
    return 'unknown';
  }

  function orderReportExt(order, dataBatch) {
    const source = isObject(order) ? order : {};
    const ext = {
      settleSeqId: source.settleSeqId,
      media: source.media || 'RED_BOOK',
      saleType: source.saleType == null ? 1 : source.saleType,
      businessMode: source.businessMode == null ? source.deliveryMode : source.businessMode,
      deliveryMode: reportDeliveryMode(source),
      projectId: source.projectId == null ? source.projectId : String(source.projectId),
      flowType: 'all',
      cycleStr: '15',
    };
    if (dataBatch) ext.dataBatch = dataBatch;
    return ext;
  }

  function dateBoundary(value, endOfDay) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{8}$/.test(text)) {
      const canonical = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
      return Date.parse(`${canonical}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return Date.parse(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`);
    }
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
      ? `${text.replace(' ', 'T')}+08:00`
      : text;
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function overlapsDateRange(unit, dateRange) {
    const source = isObject(unit) ? unit : {};
    const range = isObject(dateRange) ? dateRange : {};
    const rangeStart = dateBoundary(range.from, false);
    const rangeEnd = dateBoundary(range.to, true);
    if (rangeStart == null || rangeEnd == null || rangeStart > rangeEnd) return true;

    const unitStartValue = source.startTime ?? source.startDate ?? source.beginTime ?? source.beginDate;
    const unitEndValue = source.endTime ?? source.endDate ?? source.finishTime ?? source.finishDate;
    if (unitStartValue == null && unitEndValue == null) return true;
    const unitStart = dateBoundary(unitStartValue, false);
    const unitEnd = dateBoundary(unitEndValue, true);
    if (unitStart == null && unitEnd == null) return true;
    return (unitStart == null || unitStart <= rangeEnd) && (unitEnd == null || unitEnd >= rangeStart);
  }

  function requiredText(value, label) {
    const text = value == null ? '' : String(value).trim();
    if (!text) throw new Error(`${label} is required.`);
    return text;
  }

  function projectId(project) {
    return requiredText(project && (project.id ?? project.projectId), 'Star project id');
  }

  function orderId(order) {
    return requiredText(order && (order.orderId ?? order.buyOrderId), 'Star order id');
  }

  function normalizeProject(project) {
    const safe = contract.sanitizeSensitiveData(project || {});
    const id = projectId(safe);
    return Object.assign({}, safe, {
      id,
      projectId: safe.projectId == null ? id : String(safe.projectId),
    });
  }

  function normalizeOrder(order) {
    const safe = contract.sanitizeSensitiveData(order || {});
    const id = orderId(safe);
    return Object.assign({}, safe, {
      orderId: id,
      buyOrderId: safe.buyOrderId == null ? null : String(safe.buyOrderId),
      projectId: safe.projectId == null ? null : String(safe.projectId),
      settleSeqId: safe.settleSeqId == null ? null : String(safe.settleSeqId),
      normalizedDeliveryMode: reportDeliveryMode(safe),
    });
  }

  function normalizeDetailRow(item, identity, dataBatch) {
    const safe = contract.sanitizeSensitiveData(item || {});
    const row = Object.assign({}, safe);
    if (identity.projectId != null) row.projectId = String(identity.projectId);
    if (identity.orderId != null) {
      row.listOrderId = String(identity.orderId);
      row.reportOrderId = safe.orderId == null ? null : String(safe.orderId);
    }
    if (identity.settleSeqId != null) row.settleSeqId = String(identity.settleSeqId);
    row.dataBatch = dataBatch;
    if (dataBatch === 'content') {
      const noteId = String(safe.noteId || safe.contentId || '').trim();
      if (!noteId) {
        const error = new Error('Star content detail row is missing contentId or noteId.');
        error.code = 'ADSTAR_SCHEMA_INVALID';
        error.retryable = false;
        throw error;
      }
      row.contentId = safe.contentId == null ? null : String(safe.contentId);
      row.noteId = noteId;
    }
    return row;
  }

  function reportDates(dateRange) {
    return {
      startTime: `${dateRange.from} 00:00:00`,
      endTime: `${dateRange.to} 23:59:59`,
    };
  }

  function errorRecord(error, fields) {
    return Object.assign({
      code: error && error.code || 'adstar_collection_error',
      message: String(error && error.message || error || 'Unknown Star collection error'),
    }, fields || {});
  }

  function checkpoint(record, status) {
    return {
      cacheKey: record.cacheKey,
      fingerprint: record.fingerprint,
      status: status || record.status,
      expectedCount: record.expectedCount,
      receivedCount: record.receivedCount,
      pageCount: record.pageCount,
      nextPage: record.nextPage,
      truncated: Boolean(record.truncated),
      warnings: Array.isArray(record.warnings) ? record.warnings.slice() : [],
    };
  }

  function capped(items, configuredLimit) {
    if (configuredLimit === undefined || configuredLimit === null || configuredLimit === '') {
      return { items: items.slice(), truncated: false, limit: null };
    }
    const limit = Math.max(0, Math.floor(Number(configuredLimit) || 0));
    return { items: items.slice(0, limit), truncated: items.length > limit, limit };
  }

  function normalizeMaxPages(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function hasBusinessDateRange(unit) {
    const source = isObject(unit) ? unit : {};
    return [source.startTime, source.startDate, source.beginTime, source.beginDate,
      source.endTime, source.endDate, source.finishTime, source.finishDate]
      .some((value) => value !== undefined && value !== null && value !== '');
  }

  function duplicateValues(items, getValue) {
    const seen = new Set();
    const duplicates = new Set();
    for (const item of items) {
      const value = String(getValue(item) || '');
      if (!value) continue;
      if (seen.has(value)) duplicates.add(value);
      seen.add(value);
    }
    return Array.from(duplicates);
  }

  const CONTENT_PROJECTION_FIELDS = Object.freeze([
    'theDate', 'ds', 'projectId', 'orderId', 'listOrderId', 'reportOrderId',
    'settleSeqId', 'noteId', 'contentId', 'orderName', 'kolName', 'media',
    'readUv1d', 'engagementUv1d', 'slrAttrItmSeImpsUv1d', 'slrAttrSlrSeVstUv1d',
    'slrAttrSlrVstUv1d', 'slrAttrSlrVstUv1dNew', 'slrAttrItmFavUv1d',
    'slrAttrItmCartUv1d', 'slrAttrItmOrdUv1d', 'slrAttrItmOrdUv1dNew',
    'slrAttrItmOrdGmv1d', 'slrAttrTaskItmOrdGmv1d', 'slrAttrLinkItmOrdGmv1d',
  ]);

  function projectContentRow(row) {
    return Object.fromEntries(CONTENT_PROJECTION_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(row, field))
      .map((field) => [field, row[field]]));
  }

  function createAdstarCollector(options) {
    const settings = isObject(options) ? options : {};
    if (!settings.pageClient || typeof settings.pageClient.request !== 'function') {
      throw new Error('Star pageClient is required.');
    }
    if (!settings.cache || typeof settings.cache.open !== 'function') {
      throw new Error('Star collection cache is required.');
    }
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    const retry = isObject(settings.retry) ? settings.retry : { retries: 2, baseDelayMs: 150, maxDelayMs: 1500 };

    async function request(tabId, endpoint, payload) {
      return settings.pageClient.request({ tabId, platform: 'adstar', endpoint, payload });
    }

    async function collectPages(input) {
      const fingerprint = collectorCore.stableFingerprint(input.fingerprint);
      return collectorCore.collectPaginated({
        cache: settings.cache,
        cacheKey: input.cacheKey,
        fingerprint,
        maxPages: input.maxPages,
        retry,
        fetchPage: (page) => request(input.tabId, input.endpoint, input.payload(page)),
        parsePage(response, page) {
          const parsed = modelPage(response, page);
          return Object.assign({}, parsed, {
            items: parsed.items.map(input.normalizeItem || ((item) => contract.sanitizeSensitiveData(item))),
          });
        },
      });
    }

    async function collectSummary(input) {
      const fingerprint = collectorCore.stableFingerprint(input.fingerprint);
      const record = await settings.cache.open(input.cacheKey, fingerprint);
      if (record.status === 'complete' && Array.isArray(record.pages) && record.pages[0]) {
        return {
          data: record.pages[0].items[0] || null,
          checkpoint: checkpoint(record, 'complete'),
        };
      }
      const response = await collectorCore.withRetry(
        () => request(input.tabId, 'reports.summary', input.payload),
        retry
      );
      if (!isObject(response) || !isObject(response.model)) {
        throw new Error('Star summary response model is missing or invalid.');
      }
      const summary = contract.sanitizeSensitiveData(response.model);
      await settings.cache.commitPage(input.cacheKey, fingerprint, {
        page: 1,
        items: [summary],
        expectedCount: 1,
        nextPage: null,
      });
      const completed = await settings.cache.update(input.cacheKey, {
        status: 'complete',
        truncated: false,
        warnings: [],
        nextPage: null,
      });
      return { data: summary, checkpoint: checkpoint(completed, 'complete') };
    }

    async function collectNestedDetail(input) {
      return collectPages({
        tabId: input.tabId,
        endpoint: 'reports.detail',
        cacheKey: input.cacheKey,
        maxPages: input.maxPages,
        fingerprint: input.fingerprint,
        payload(page) {
          return Object.assign({}, input.payload, {
            pageNo: page,
            pageSize: input.pageSize,
            orderByColumn: '',
            orderByDirection: '',
          });
        },
        normalizeItem: (item) => normalizeDetailRow(item, input.identity, input.dataBatch),
      });
    }

    async function collectProjectUnit(context, project) {
      const id = projectId(project);
      const keyId = encodeURIComponent(id);
      const dates = reportDates(context.dateRange);
      const unit = {
        type: 'project',
        id,
        name: project.projectName || null,
        status: 'complete',
        summary: null,
        details: { project: [], order: [] },
        checkpoints: {},
        warnings: [],
        errors: [],
      };
      const operations = [
        {
          name: 'summary',
          run: () => collectSummary({
            tabId: context.tabId,
            cacheKey: `${context.prefix}:project:${keyId}:summary`,
            fingerprint: { endpoint: 'reports.summary', level: 'project', id, dateRange: context.dateRange },
            payload: {
              level: 'project',
              projectId: id,
              bizType: 'selfOfficial_projectSummary_summary',
              ...dates,
              ext: { orderId: null, projectId: id, media: 'all' },
            },
          }),
          apply: (result) => {
            unit.summary = result.data;
            unit.checkpoints.summary = result.checkpoint;
          },
        },
        ...['project', 'order'].map((dataBatch) => ({
          name: dataBatch,
          run: () => collectNestedDetail({
            tabId: context.tabId,
            cacheKey: `${context.prefix}:project:${keyId}:${dataBatch}`,
            maxPages: context.maxPages,
            pageSize: context.pageSize,
            dataBatch,
            identity: { projectId: id },
            fingerprint: {
              endpoint: 'reports.detail', level: 'project', id, dataBatch,
              dateRange: context.dateRange, pageSize: context.pageSize,
            },
            payload: {
              level: 'project',
              projectId: id,
              bizType: 'selfOfficial_projectInfo_detail',
              dataBatch,
              ...dates,
              ext: { projectId: id, dataBatch },
            },
          }),
          apply: (result) => {
            unit.details[dataBatch] = result.items;
            unit.checkpoints[dataBatch] = {
              cacheKey: result.cacheKey,
              fingerprint: result.fingerprint,
              status: result.status,
              expectedCount: result.expectedCount,
              receivedCount: result.receivedCount,
              pageCount: result.pageCount,
              nextPage: result.nextPage,
              truncated: result.truncated,
              warnings: result.warnings,
            };
            if (result.status !== 'complete') unit.status = 'partial';
          },
        })),
      ];
      for (const operation of operations) {
        try {
          operation.apply(await operation.run());
        } catch (error) {
          unit.status = 'partial';
          unit.errors.push(errorRecord(error, { dataset: operation.name }));
        }
      }
      return unit;
    }

    async function collectOrderUnit(context, order) {
      const id = orderId(order);
      const keyId = encodeURIComponent(id);
      const dates = reportDates(context.dateRange);
      const identity = {
        projectId: order.projectId == null ? null : String(order.projectId),
        orderId: id,
        settleSeqId: order.settleSeqId == null ? null : String(order.settleSeqId),
      };
      const unit = {
        type: 'order',
        id,
        name: order.orderName || null,
        projectId: identity.projectId,
        settleSeqId: identity.settleSeqId,
        status: 'complete',
        summary: null,
        details: { order: [], content: [] },
        checkpoints: {},
        warnings: [],
        errors: [],
      };
      if (!identity.settleSeqId || !identity.projectId) {
        unit.status = 'failed';
        unit.errors.push({
          code: 'adstar_order_identity_missing',
          message: 'Star order is missing settleSeqId or projectId.',
        });
        return unit;
      }
      const operations = [
        {
          name: 'summary',
          run: () => collectSummary({
            tabId: context.tabId,
            cacheKey: `${context.prefix}:order:${keyId}:summary`,
            fingerprint: { endpoint: 'reports.summary', level: 'order', id, settleSeqId: identity.settleSeqId, dateRange: context.dateRange },
            payload: {
              level: 'order',
              orderId: id,
              bizType: 'selfOfficial_orderSum_summary',
              ...dates,
              ext: orderReportExt(order),
            },
          }),
          apply: (result) => {
            unit.summary = result.data;
            unit.checkpoints.summary = result.checkpoint;
          },
        },
        ...['order', 'content'].map((dataBatch) => ({
          name: dataBatch,
          run: () => collectNestedDetail({
            tabId: context.tabId,
            cacheKey: `${context.prefix}:order:${keyId}:${dataBatch}`,
            maxPages: context.maxPages,
            pageSize: context.pageSize,
            dataBatch,
            identity,
            fingerprint: {
              endpoint: 'reports.detail', level: 'order', id, settleSeqId: identity.settleSeqId,
              dataBatch, dateRange: context.dateRange, pageSize: context.pageSize,
            },
            payload: {
              level: 'order',
              orderId: id,
              bizType: 'selfOfficial_orderInfo_detail',
              dataBatch,
              ...dates,
              ext: orderReportExt(order, dataBatch),
            },
          }),
          apply: (result) => {
            unit.details[dataBatch] = result.items;
            unit.checkpoints[dataBatch] = {
              cacheKey: result.cacheKey,
              fingerprint: result.fingerprint,
              status: result.status,
              expectedCount: result.expectedCount,
              receivedCount: result.receivedCount,
              pageCount: result.pageCount,
              nextPage: result.nextPage,
              truncated: result.truncated,
              warnings: result.warnings,
            };
            if (result.status !== 'complete') unit.status = 'partial';
          },
        })),
      ];
      for (const operation of operations) {
        try {
          operation.apply(await operation.run());
        } catch (error) {
          unit.status = 'partial';
          unit.errors.push(errorRecord(error, { dataset: operation.name }));
        }
      }
      return unit;
    }

    function failedResult(context, error, startedAt) {
      const errors = [errorRecord(error, { platform: 'adstar' })];
      const status = quality.derivePlatformStatus({
        platform: 'adstar',
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        schemaValid: false,
        paginationComplete: false,
        reconciled: false,
        receivedCount: 0,
        errors,
      });
      return Object.assign({}, status, {
        schemaVersion: 1,
        runId: context.runId,
        startedAt,
        finishedAt: now(),
        lists: {
          projects: { status: 'failed', items: [] },
          orders: { status: 'failed', items: [] },
        },
        storeSummary: null,
        nested: [],
        contentRows: [],
        excluded: { projects: [], orders: [] },
      });
    }

    async function collect(input) {
      const source = isObject(input) ? input : {};
      const context = {
        tabId: Number(source.tabId),
        runId: requiredText(source.runId, 'Star runId'),
        accountKey: requiredText(source.accountKey, 'Star accountKey'),
        dateRange: contract.sanitizeSensitiveData(source.dateRange || {}),
        pageSize: Math.max(1, Math.floor(Number(source.pageSize) || DEFAULT_PAGE_SIZE)),
        memberType: Math.max(1, Math.floor(Number(source.memberType) || DEFAULT_MEMBER_TYPE)),
        maxPages: normalizeMaxPages(source.maxPages),
        verifiedIdentity: requiredText(source.verifiedIdentity || source.accountKey, 'Star verifiedIdentity'),
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('Star tabId is required.');
      requiredText(context.dateRange.from, 'Star dateRange.from');
      requiredText(context.dateRange.to, 'Star dateRange.to');
      if (dateBoundary(context.dateRange.from, false) > dateBoundary(context.dateRange.to, true)) {
        throw new Error('Star dateRange.from must not be after dateRange.to.');
      }
      context.prefix = `xhs:${encodeURIComponent(context.runId)}:adstar:${encodeURIComponent(context.verifiedIdentity)}`;
      const startedAt = now();

      let projectsList;
      let ordersList;
      try {
        projectsList = await collectPages({
          tabId: context.tabId,
          endpoint: 'projects.list',
          cacheKey: `${context.prefix}:projects`,
          maxPages: context.maxPages,
          fingerprint: {
            endpoint: 'projects.list', accountKey: context.accountKey,
            verifiedIdentity: context.verifiedIdentity, pageSize: context.pageSize,
          },
          payload: (page) => ({ pageNo: page, pageSize: context.pageSize }),
          normalizeItem: normalizeProject,
        });
        ordersList = await collectPages({
          tabId: context.tabId,
          endpoint: 'orders.list',
          cacheKey: `${context.prefix}:orders`,
          maxPages: context.maxPages,
          fingerprint: {
            endpoint: 'orders.list', accountKey: context.accountKey,
            verifiedIdentity: context.verifiedIdentity, pageSize: context.pageSize,
            memberType: context.memberType,
          },
          payload: (page) => ({
            saleType: 1,
            memberType: context.memberType,
            pageNo: page,
            pageSize: context.pageSize,
          }),
          normalizeItem: normalizeOrder,
        });
      } catch (error) {
        return failedResult(context, error, startedAt);
      }

      const relevantOrders = ordersList.items.filter((order) => overlapsDateRange(order, context.dateRange));
      const relevantProjectIds = new Set(relevantOrders.map((order) => order.projectId).filter(Boolean));
      const relevantProjects = projectsList.items.filter((project) => (
        relevantProjectIds.has(projectId(project)) ||
        (hasBusinessDateRange(project) && overlapsDateRange(project, context.dateRange))
      ));
      const excluded = {
        projects: projectsList.items
          .filter((project) => !relevantProjects.includes(project))
          .map((project) => ({
            id: projectId(project),
            reason: hasBusinessDateRange(project) ? 'outside_date_range' : 'date_scope_unknown',
          })),
        orders: ordersList.items
          .filter((order) => !relevantOrders.includes(order))
          .map((order) => ({ id: orderId(order), reason: 'outside_date_range' })),
      };
      const selectedProjects = capped(relevantProjects, source.maxProjects);
      const selectedOrders = capped(relevantOrders, source.maxOrders);
      const truncation = {
        maxPages: projectsList.truncated || ordersList.truncated,
        maxProjects: selectedProjects.truncated,
        maxOrders: selectedOrders.truncated,
      };
      const warnings = [];
      if (selectedProjects.truncated) warnings.push({ code: 'truncated_maxProjects', limit: 'maxProjects', value: selectedProjects.limit });
      if (selectedOrders.truncated) warnings.push({ code: 'truncated_maxOrders', limit: 'maxOrders', value: selectedOrders.limit });
      for (const project of projectsList.items) {
        if (!hasBusinessDateRange(project) && !relevantProjectIds.has(projectId(project))) {
          warnings.push({
            code: 'date_scope_unknown', unitType: 'project', unitId: projectId(project),
            message: 'Project has no business date range and no related in-range order.',
          });
        }
      }
      const duplicateProjects = duplicateValues(projectsList.items, projectId);
      const duplicateOrders = duplicateValues(ordersList.items, orderId);
      const duplicateSettlements = duplicateValues(ordersList.items, (order) => order.settleSeqId);
      for (const [type, values] of [
        ['project_id', duplicateProjects], ['order_id', duplicateOrders], ['settle_seq_id', duplicateSettlements],
      ]) {
        if (values.length) warnings.push({ code: `duplicate_${type}`, values });
      }
      for (const order of relevantOrders) {
        if (reportDeliveryMode(order) === 'unknown') {
          warnings.push({ code: 'unknown_delivery_mode', unitType: 'order', unitId: orderId(order) });
        }
      }

      let storeSummary = null;
      let storeCheckpoint = null;
      const nested = [];
      const errors = [];
      try {
        const storeResult = await collectSummary({
          tabId: context.tabId,
          cacheKey: `${context.prefix}:store:summary`,
          fingerprint: { endpoint: 'reports.summary', level: 'store', dateRange: context.dateRange },
          payload: {
            level: 'store',
            bizType: 'selfOfficial_oneBpBrandEffectData_summary',
            ext: {
              startTime: context.dateRange.from,
              endTime: context.dateRange.to,
              deliveryModeType: 'all',
              media: 'all',
              flowType: 'all',
              cycleStr: '15',
              deliveryMode: 'all',
            },
          },
        });
        storeSummary = storeResult.data;
        storeCheckpoint = storeResult.checkpoint;
      } catch (error) {
        errors.push(errorRecord(error, {
          code: 'nested_unit_incomplete', unitType: 'store', unitId: 'store',
        }));
      }

      for (const project of selectedProjects.items) {
        const unit = await collectProjectUnit(context, project);
        nested.push(unit);
        for (const error of unit.errors) {
          errors.push(Object.assign({}, error, {
            code: 'nested_unit_incomplete', unitType: 'project', unitId: unit.id,
          }));
        }
      }
      for (const order of selectedOrders.items) {
        const unit = await collectOrderUnit(context, order);
        nested.push(unit);
        for (const error of unit.errors) {
          errors.push(Object.assign({}, error, {
            code: 'nested_unit_incomplete', unitType: 'order', unitId: unit.id,
          }));
        }
      }

      const paginationComplete = projectsList.status === 'complete' && ordersList.status === 'complete' &&
        nested.every((unit) => unit.status === 'complete');
      const expectedProjects = Number(projectsList.expectedCount);
      const expectedOrders = Number(ordersList.expectedCount);
      const reconciled = Number.isFinite(expectedProjects) && expectedProjects === projectsList.receivedCount &&
        Number.isFinite(expectedOrders) && expectedOrders === ordersList.receivedCount &&
        duplicateProjects.length === 0 && duplicateOrders.length === 0 && duplicateSettlements.length === 0;
      const schemaValid = !nested.some((unit) => (unit.errors || []).some((error) => (
        error.code === 'ADSTAR_SCHEMA_INVALID'
      )));
      const statusEvidence = quality.derivePlatformStatus({
        platform: 'adstar',
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        schemaValid,
        paginationComplete,
        reconciled,
        receivedCount: projectsList.receivedCount + ordersList.receivedCount,
        truncation,
        nested: nested.map((unit) => ({ type: unit.type, id: unit.id, status: unit.status })),
        warnings: warnings.concat(projectsList.warnings || [], ordersList.warnings || []),
        errors,
      });

      return Object.assign({}, statusEvidence, {
        schemaVersion: 1,
        runId: context.runId,
        startedAt,
        finishedAt: now(),
        lists: { projects: projectsList, orders: ordersList },
        storeSummary,
        storeCheckpoint,
        nested: contract.sanitizeSensitiveData(nested),
        contentRows: contract.sanitizeSensitiveData(nested.flatMap((unit) => (
          unit.type === 'order' ? unit.details.content.map(projectContentRow) : []
        ))),
        excluded: contract.sanitizeSensitiveData(excluded),
      });
    }

    return Object.freeze({ collect });
  }

  return Object.freeze({
    DELIVERY_MODE_BY_CODE,
    createAdstarCollector,
    modelPage,
    orderReportExt,
    overlapsDateRange,
    reportDeliveryMode,
  });
});
