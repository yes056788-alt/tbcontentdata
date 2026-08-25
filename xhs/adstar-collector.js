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
  const ORDER_MEMBER_TYPES = Object.freeze([5, 6]);

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
    const total = finiteNonNegative(model.totalCount, 'model.totalCount');
    const pageSize = finiteNonNegative(model.pageSize, 'model.pageSize');
    if (pageSize === 0 && total > 0) {
      throw new Error('Star response model.pageSize cannot be zero when rows exist.');
    }
    const reportedTotalPages = model.totalPages == null || model.totalPages === ''
      ? null
      : finiteNonNegative(model.totalPages, 'model.totalPages');
    const derivedTotalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : null;
    const totalPages = reportedTotalPages == null
      ? derivedTotalPages
      : (reportedTotalPages === 0 && total === 0 ? 1 : reportedTotalPages);
    if (reportedTotalPages != null && derivedTotalPages != null && totalPages !== derivedTotalPages) {
      throw new Error(
        `Star pagination mismatch: model.totalPages ${totalPages} contradicts ` +
        `model.totalCount ${total} and model.pageSize ${pageSize}.`
      );
    }
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new Error('Star response must include a valid model.totalPages or derivable page count.');
    }
    if (currentPage > totalPages) {
      throw new Error(
        `Star pagination mismatch: requested page ${currentPage} exceeds model.totalPages ${totalPages}.`
      );
    }

    const hasNext = currentPage < totalPages;
    const nextPage = hasNext ? currentPage + 1 : null;

    const parsed = {
      items: model.result,
      total,
      pageSize,
      hasNext,
      nextPage,
    };
    if (responsePage !== currentPage) {
      parsed.pageEcho = { requestedPage: currentPage, responsePage };
    }
    return parsed;
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

  function normalizeOrder(order, collectionMemberType) {
    const safe = contract.sanitizeSensitiveData(order || {});
    const id = orderId(safe);
    return Object.assign({}, safe, {
      orderId: id,
      buyOrderId: safe.buyOrderId == null ? null : String(safe.buyOrderId),
      projectId: safe.projectId == null ? null : String(safe.projectId),
      settleSeqId: safe.settleSeqId == null ? null : String(safe.settleSeqId),
      normalizedDeliveryMode: reportDeliveryMode(safe),
      collectionMemberType: Number(collectionMemberType),
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
    const diagnostics = {};
    for (const key of [
      'stage', 'memberType', 'requestedPage', 'responsePage', 'unitType', 'dataset',
    ]) {
      const value = error && error[key];
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        diagnostics[key] = value;
      }
    }
    return Object.assign({
      code: error && error.code || 'adstar_collection_error',
      message: String(error && error.message || error || 'Unknown Star collection error'),
    }, diagnostics, fields || {});
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

  function normalizedTaskConcurrency(value) {
    const requested = Math.floor(Number(value));
    if (!Number.isFinite(requested)) return 4;
    return Math.min(5, Math.max(3, requested));
  }

  async function mapWithConcurrency(items, limit, worker, signal) {
    const values = Array.isArray(items) ? items : [];
    if (values.length === 0) return [];
    const results = new Array(values.length);
    let nextIndex = 0;
    async function runLane() {
      while (true) {
        collectorCore.throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await worker(values[index], index);
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(values.length, Math.max(1, Number(limit) || 1)) },
      () => runLane()
    ));
    return results;
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

  function paginatedRowIdentity(item, endpoint, warningContext) {
    const row = isObject(item) ? item : {};
    if (endpoint === 'projects.list') {
      const id = String(row.id ?? row.projectId ?? '').trim();
      return id ? `project:${id}` : null;
    }
    if (endpoint === 'orders.list') {
      const id = String(row.orderId ?? row.buyOrderId ?? '').trim();
      return id ? `order:${id}` : null;
    }
    if (endpoint !== 'reports.detail') return null;

    const context = isObject(warningContext) ? warningContext : {};
    const noteId = String(row.noteId ?? row.contentId ?? '').trim();
    const relation = {
      listOrderId: row.listOrderId == null ? null : String(row.listOrderId),
      reportOrderId: row.reportOrderId == null ? null : String(row.reportOrderId),
      orderId: row.orderId == null ? null : String(row.orderId),
      settleSeqId: row.settleSeqId == null ? null : String(row.settleSeqId),
    };
    const date = row.theDate ?? row.ds ?? row.date ?? null;
    const flowType = row.flowType ?? row.flow ?? null;
    const cycle = row.cycleStr ?? row.cycle ?? null;
    const dimensionId = noteId ? null : (
      row.itemId ?? row.productId ?? row.planId ?? row.campaignId ?? row.id ?? null
    );
    const identity = {
      dataset: context.dataset ?? row.dataBatch ?? null,
      projectId: row.projectId == null ? null : String(row.projectId),
      ...relation,
      noteId: noteId || null,
      date: date == null ? null : String(date),
      flowType: flowType == null ? null : String(flowType),
      cycle: cycle == null ? null : String(cycle),
      dimensionId: dimensionId == null ? null : String(dimensionId),
    };
    const hasStableDimension = Object.entries(identity).some(([key, value]) => (
      !['dataset', 'projectId'].includes(key) && value !== null && value !== ''
    ));
    return hasStableDimension
      ? `detail:${collectorCore.stableFingerprint(identity)}`
      : null;
  }

  function duplicateRowsAcrossPages(pages, getIdentity) {
    const seen = new Set();
    let duplicateCount = 0;
    for (const page of (Array.isArray(pages) ? pages : []).slice().sort((left, right) => (
      Number(left && left.page) - Number(right && right.page)
    ))) {
      const currentPage = new Set((Array.isArray(page && page.items) ? page.items : []).map((item) => {
        const identity = typeof getIdentity === 'function' ? getIdentity(item) : null;
        return identity || `row:${collectorCore.stableFingerprint(item)}`;
      }));
      for (const fingerprint of currentPage) {
        if (seen.has(fingerprint)) duplicateCount += 1;
      }
      for (const fingerprint of currentPage) seen.add(fingerprint);
    }
    return duplicateCount;
  }

  function compareProjectOrderInventory(projects, orders) {
    const inventoryProjectIds = new Set();
    let expectedOrderCount = 0;
    for (const project of Array.isArray(projects) ? projects : []) {
      const count = Number(project && project.orderNum);
      if (!Number.isFinite(count) || count <= 0) continue;
      expectedOrderCount += count;
      inventoryProjectIds.add(projectId(project));
    }
    const collectedOrders = Array.isArray(orders) ? orders : [];
    const matchedProjectOrderCount = collectedOrders.filter((order) => (
      inventoryProjectIds.has(String(order && order.projectId || ''))
    )).length;
    return {
      mismatch: expectedOrderCount > 0 && matchedProjectOrderCount < expectedOrderCount,
      expectedOrderCount,
      inventoryProjectCount: inventoryProjectIds.size,
      collectedOrderCount: collectedOrders.length,
      matchedProjectOrderCount,
    };
  }

  function mergeOrderLists(memberTypeLists) {
    const sources = Array.isArray(memberTypeLists) ? memberTypeLists : [];
    const ordersById = new Map();
    const items = [];
    let duplicateCount = 0;
    for (const source of sources) {
      for (const order of Array.isArray(source.items) ? source.items : []) {
        const id = orderId(order);
        const comparable = Object.assign({}, order);
        delete comparable.collectionMemberType;
        const fingerprint = collectorCore.stableFingerprint(comparable);
        if (!ordersById.has(id)) {
          ordersById.set(id, { order, fingerprint, memberType: source.memberType });
          items.push(order);
          continue;
        }
        const existing = ordersById.get(id);
        if (existing.memberType === source.memberType) {
          items.push(order);
          continue;
        }
        duplicateCount += 1;
        if (existing.fingerprint !== fingerprint) {
          const error = new Error(
            'Star order lists contain conflicting records for the same orderId across member types.'
          );
          error.code = 'ADSTAR_ORDER_ID_CONFLICT';
          error.retryable = false;
          error.stage = 'orders.merge';
          error.memberType = source.memberType;
          throw error;
        }
      }
    }

    const rawExpectedCount = sources.every((source) => Number.isFinite(Number(source.expectedCount)))
      ? sources.reduce((total, source) => total + Number(source.expectedCount), 0)
      : null;
    const allComplete = sources.every((source) => source.status === 'complete');
    const status = allComplete
      ? 'complete'
      : (sources.some((source) => source.status === 'cancelled') ? 'cancelled' : 'partial');
    const warnings = sources.flatMap((source) => (source.warnings || []).map((warning) => (
      Object.assign({ memberType: source.memberType }, warning)
    )));
    if (duplicateCount > 0) {
      warnings.push({
        code: 'duplicate_order_across_member_types_deduplicated',
        count: duplicateCount,
      });
    }
    const sourceMetadata = sources.map((source) => ({
      memberType: source.memberType,
      cacheKey: source.cacheKey,
      fingerprint: source.fingerprint,
      status: source.status,
      truncated: Boolean(source.truncated),
      nextPage: source.nextPage == null ? null : source.nextPage,
      expectedCount: source.expectedCount,
      receivedCount: source.receivedCount,
      pageCount: source.pageCount,
      warnings: Array.isArray(source.warnings) ? source.warnings.slice() : [],
    }));
    return {
      cacheKey: null,
      fingerprint: collectorCore.stableFingerprint(sourceMetadata.map((source) => ({
        memberType: source.memberType,
        fingerprint: source.fingerprint,
      }))),
      status,
      truncated: sources.some((source) => source.truncated),
      nextPage: null,
      receivedCount: items.length,
      expectedCount: rawExpectedCount == null ? null : Math.max(0, rawExpectedCount - duplicateCount),
      rawReceivedCount: sources.reduce((total, source) => total + Number(source.receivedCount || 0), 0),
      rawExpectedCount,
      pageCount: sources.reduce((total, source) => total + Number(source.pageCount || 0), 0),
      items,
      warnings,
      sources: sourceMetadata,
    };
  }

  function deriveAccountIdentity(projects, orders) {
    const projectValues = Array.isArray(projects) ? projects : [];
    const orderValues = Array.isArray(orders) ? orders : [];
    const trustedOrderValues = orderValues.filter((order) => Number(order.collectionMemberType) !== 6);
    const candidatesByMemberId = new Map();
    let missingProjectMemberIdCount = 0;
    let missingOrderMemberIdCount = 0;
    let missingOrderMemberNameCount = 0;

    function addCandidate(value, idField, nameField, source) {
      const memberId = String(value && value[idField] != null ? value[idField] : '').trim();
      const memberName = String(value && value[nameField] != null ? value[nameField] : '').trim();
      if (!memberId) {
        if (source === 'project') missingProjectMemberIdCount += 1;
        else missingOrderMemberIdCount += 1;
        return;
      }
      if (!candidatesByMemberId.has(memberId)) {
        candidatesByMemberId.set(memberId, {
          memberId,
          projectNames: new Set(),
          orderNames: new Set(),
          sources: new Set(),
        });
      }
      const candidate = candidatesByMemberId.get(memberId);
      candidate.sources.add(source);
      if (memberName) candidate[source === 'project' ? 'projectNames' : 'orderNames'].add(memberName);
      else if (source === 'order') missingOrderMemberNameCount += 1;
    }

    for (const project of projectValues) {
      addCandidate(project, 'promoteShopMemberId', 'promoteShopName', 'project');
    }
    for (const order of trustedOrderValues) {
      addCandidate(order, 'memberId', 'memberName', 'order');
    }

    const candidates = Array.from(candidatesByMemberId.values())
      .map((candidate) => ({
        memberId: candidate.memberId,
        memberName: Array.from(candidate.projectNames).sort()[0] ||
          Array.from(candidate.orderNames).sort()[0] || null,
        sources: candidate.sources,
      }))
      .sort((left, right) => left.memberId.localeCompare(right.memberId));
    const warnings = [];
    if (!candidates.length) {
      warnings.push({
        code: 'adstar_account_identity_missing',
        message: 'Star project and order rows do not expose a stable memberId account identity.',
        projectCount: projectValues.length,
        orderCount: orderValues.length,
        ignoredAgencyOrderCount: orderValues.length - trustedOrderValues.length,
        missingProjectMemberIdCount,
        missingOrderMemberIdCount,
        // Retain the original diagnostic field names for older report readers.
        missingMemberIdCount: missingOrderMemberIdCount,
        missingMemberNameCount: missingOrderMemberNameCount,
      });
    }
    if (candidates.length > 1) {
      warnings.push({
        code: 'adstar_account_identity_ambiguous',
        message: 'Star project and order rows contain multiple memberId account identities.',
        identityCount: candidates.length,
        projectIdentityCount: candidates.filter((candidate) => candidate.sources.has('project')).length,
        orderIdentityCount: candidates.filter((candidate) => candidate.sources.has('order')).length,
      });
    }
    return {
      identity: candidates.length === 1 ? {
        memberId: candidates[0].memberId,
        memberName: candidates[0].memberName,
      } : null,
      ambiguous: candidates.length > 1,
      warnings,
    };
  }

  const CONTENT_PROJECTION_FIELDS = Object.freeze([
    'theDate', 'ds', 'projectId', 'orderId', 'listOrderId', 'reportOrderId',
    'settleSeqId', 'noteId', 'contentId', 'orderName', 'kolName', 'media',
    'readUv1d', 'engagementUv1d', 'slrAttrItmSeImpsUv1d', 'slrAttrSlrSeVstUv1d',
    'slrAttrSlrVstUv1d', 'slrAttrSlrVstUv1dNew', 'slrAttrItmCltUv1d', 'slrAttrItmFavUv1d',
    'slrAttrItmCartUv1d', 'slrAttrItmOrdUv1d', 'slrAttrItmOrdUv1dNew',
    'slrAttrItmOrdGmv1d', 'slrAttrItmOrdGmv1d1bpOrd', 'slrAttrItmOrdGmv1dNot1bpOrd',
    'slrAttrTaskItmOrdGmv1d', 'slrAttrLinkItmOrdGmv1d',
  ]);

  function projectContentRow(row) {
    return Object.fromEntries(CONTENT_PROJECTION_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(row, field))
      .map((field) => [field, row[field]]));
  }

  function usableContentId(value) {
    const text = value == null ? '' : String(value).trim();
    return text && !['null', 'undefined', '-'].includes(text.toLowerCase()) ? text : null;
  }

  function projectOrderContentRow(row) {
    const noteId = usableContentId(row && (row.noteId || row.contentId));
    if (!noteId) return null;
    const projected = projectContentRow(Object.assign({}, row, {
      noteId,
      contentId: noteId,
    }));
    if (projected.orderId != null) {
      projected.reportOrderId = projected.reportOrderId == null
        ? String(projected.orderId)
        : projected.reportOrderId;
      delete projected.orderId;
    }
    delete projected.listOrderId;
    return projected;
  }

  function contentRowKey(row) {
    return [
      row && row.projectId,
      row && (row.listOrderId || row.orderId || row.reportOrderId || row.settleSeqId),
      row && (row.noteId || row.contentId),
      row && (row.theDate || row.ds),
    ].map((value) => String(value == null ? '' : value)).join('|');
  }

  function collectContentRows(nested) {
    const rows = [];
    const keys = new Set();
    const settlementAliases = new Map();
    for (const unit of nested) {
      if (unit.type !== 'order' || !unit.id || !unit.projectId || !unit.settleSeqId) continue;
      const key = `${String(unit.projectId)}\u0000${String(unit.settleSeqId)}`;
      if (settlementAliases.has(key)) {
        settlementAliases.set(key, null);
      } else {
        settlementAliases.set(key, {
          listOrderId: String(unit.id),
          settleSeqId: String(unit.settleSeqId),
        });
      }
    }
    function add(row) {
      if (!row) return;
      const key = contentRowKey(row);
      if (keys.has(key)) return;
      keys.add(key);
      rows.push(row);
    }
    for (const unit of nested) {
      if (unit.type !== 'order') continue;
      for (const row of unit.details.content) add(projectContentRow(row));
    }
    for (const unit of nested) {
      if (unit.type !== 'project') continue;
      for (const row of unit.details.order) {
        const projected = projectOrderContentRow(row);
        if (!projected) continue;
        const aliasKey = `${String(projected.projectId || unit.id || '')}\u0000${String(projected.reportOrderId || '')}`;
        const alias = settlementAliases.get(aliasKey);
        if (alias) Object.assign(projected, alias);
        add(projected);
      }
    }
    return rows;
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

    async function request(tabId, endpoint, payload, signal) {
      return settings.pageClient.request({ tabId, platform: 'adstar', endpoint, payload, signal });
    }

    function rethrowAbort(error, signal) {
      if (collectorCore.isAbortError(error, signal)) throw collectorCore.abortError(signal);
    }

    async function collectPages(input) {
      collectorCore.throwIfAborted(input.signal);
      const fingerprint = collectorCore.stableFingerprint(input.fingerprint);
      const pageWarnings = [];
      let lastRequestedPage = null;
      function annotate(error) {
        if (!error || typeof error !== 'object') return error;
        const context = Object.assign({ stage: input.endpoint }, input.warningContext || {});
        for (const key of ['stage', 'memberType', 'unitType', 'dataset']) {
          const value = context[key];
          if (value !== undefined && value !== null && error[key] == null) error[key] = value;
        }
        if (lastRequestedPage != null && error.requestedPage == null) {
          error.requestedPage = lastRequestedPage;
        }
        return error;
      }

      let priorWarnings = [];
      try {
        const initialRecord = await settings.cache.open(input.cacheKey, fingerprint);
        priorWarnings = Array.isArray(initialRecord.warnings)
          ? initialRecord.warnings.filter((warning) => (
            warning && warning.code === 'adstar_response_page_echo'
          ))
          : [];
      } catch (error) {
        throw annotate(error);
      }

      let result;
      try {
        result = await collectorCore.collectPaginated({
          cache: settings.cache,
          cacheKey: input.cacheKey,
          fingerprint,
          maxPages: input.maxPages,
          retry,
          signal: input.signal,
          fetchPage(page) {
            lastRequestedPage = page;
            return request(input.tabId, input.endpoint, input.payload(page), input.signal);
          },
          parsePage(response, page) {
            const parsed = modelPage(response, page);
            if (parsed.pageEcho) {
              pageWarnings.push(contract.sanitizeSensitiveData(Object.assign({
                code: 'adstar_response_page_echo',
                message: 'Star response echoed a stale page number; pagination used the requested page and reconciled totals.',
                stage: input.endpoint,
                requestedPage: parsed.pageEcho.requestedPage,
                responsePage: parsed.pageEcho.responsePage,
              }, input.warningContext || {})));
            }
            return Object.assign({}, parsed, {
              items: parsed.items.map(input.normalizeItem || ((item) => contract.sanitizeSensitiveData(item))),
            });
          },
        });
      } catch (error) {
        rethrowAbort(error, input.signal);
        throw annotate(error);
      }
      const warningsByFingerprint = new Map();
      for (const warning of [...priorWarnings, ...(result.warnings || []), ...pageWarnings]) {
        warningsByFingerprint.set(collectorCore.stableFingerprint(warning), warning);
      }
      const warnings = Array.from(warningsByFingerprint.values());
      if (warnings.length > 0 && typeof settings.cache.update === 'function') {
        await settings.cache.update(input.cacheKey, { warnings });
      }

      const record = typeof settings.cache.read === 'function'
        ? await settings.cache.read(input.cacheKey)
        : null;
      const duplicateRowCount = record
        ? duplicateRowsAcrossPages(record.pages, (item) => (
          paginatedRowIdentity(item, input.endpoint, input.warningContext)
        ))
        : duplicateValues(result.items, (item) => collectorCore.stableFingerprint(item)).length;
      if (duplicateRowCount > 0) {
        const rowType = input.endpoint === 'orders.list'
          ? 'order'
          : (input.endpoint === 'projects.list' ? 'project' : 'detail');
        const error = new Error(
          `Star pagination detected duplicate ${rowType} rows across requested pages.`
        );
        error.code = 'ADSTAR_PAGE_REPLAY';
        error.retryable = false;
        throw annotate(error);
      }
      return Object.assign({}, result, { warnings });
    }

    async function collectSummary(input) {
      collectorCore.throwIfAborted(input.signal);
      const fingerprint = collectorCore.stableFingerprint(input.fingerprint);
      const record = await settings.cache.open(input.cacheKey, fingerprint);
      if (record.status === 'complete' && Array.isArray(record.pages) && record.pages[0]) {
        return {
          data: record.pages[0].items[0] || null,
          checkpoint: checkpoint(record, 'complete'),
        };
      }
      const response = await collectorCore.withRetry(
        () => request(input.tabId, 'reports.summary', input.payload, input.signal),
        Object.assign({}, retry, { signal: input.signal })
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
        signal: input.signal,
        endpoint: 'reports.detail',
        cacheKey: input.cacheKey,
        maxPages: input.maxPages,
        fingerprint: input.fingerprint,
        warningContext: {
          stage: 'reports.detail',
          unitType: input.payload && input.payload.level || 'unknown',
          dataset: input.dataBatch,
        },
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
            signal: context.signal,
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
            signal: context.signal,
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
          rethrowAbort(error, context.signal);
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
            signal: context.signal,
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
            signal: context.signal,
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
          rethrowAbort(error, context.signal);
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
        identity: null,
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
        memberTypes: ORDER_MEMBER_TYPES.slice(),
        taskConcurrency: normalizedTaskConcurrency(source.taskConcurrency),
        maxPages: normalizeMaxPages(source.maxPages),
        verifiedIdentity: requiredText(source.verifiedIdentity || source.accountKey, 'Star verifiedIdentity'),
        signal: source.signal,
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('Star tabId is required.');
      requiredText(context.dateRange.from, 'Star dateRange.from');
      requiredText(context.dateRange.to, 'Star dateRange.to');
      if (dateBoundary(context.dateRange.from, false) > dateBoundary(context.dateRange.to, true)) {
        throw new Error('Star dateRange.from must not be after dateRange.to.');
      }
      context.prefix = `xhs:${encodeURIComponent(context.runId)}:adstar:${encodeURIComponent(context.verifiedIdentity)}`;
      const startedAt = now();
      collectorCore.throwIfAborted(context.signal);

      let projectsList;
      let ordersList;
      try {
        projectsList = await collectPages({
          tabId: context.tabId,
          signal: context.signal,
          endpoint: 'projects.list',
          cacheKey: `${context.prefix}:projects`,
          maxPages: context.maxPages,
          fingerprint: {
            endpoint: 'projects.list', accountKey: context.accountKey,
            verifiedIdentity: context.verifiedIdentity, pageSize: context.pageSize,
          },
          warningContext: { stage: 'projects.list' },
          payload: (page) => ({ pageNo: page, pageSize: context.pageSize }),
          normalizeItem: normalizeProject,
        });
        const orderLists = [];
        for (const memberType of context.memberTypes) {
          const list = await collectPages({
            tabId: context.tabId,
            signal: context.signal,
            endpoint: 'orders.list',
            cacheKey: `${context.prefix}:orders:memberType:${memberType}`,
            maxPages: context.maxPages,
            fingerprint: {
              endpoint: 'orders.list', accountKey: context.accountKey,
              verifiedIdentity: context.verifiedIdentity, pageSize: context.pageSize,
              memberType,
            },
            warningContext: { stage: 'orders.list', memberType },
            payload: (page) => ({
              saleType: 1,
              memberType,
              pageNo: page,
              pageSize: context.pageSize,
            }),
            normalizeItem: (item) => normalizeOrder(item, memberType),
          });
          orderLists.push(Object.assign({ memberType }, list));
        }
        ordersList = mergeOrderLists(orderLists);
      } catch (error) {
        rethrowAbort(error, context.signal);
        return failedResult(context, error, startedAt);
      }

      const relevantOrders = ordersList.items.filter((order) => overlapsDateRange(order, context.dateRange));
      const relevantProjectIds = new Set(relevantOrders.map((order) => order.projectId).filter(Boolean));
      const relevantProjects = projectsList.items.filter((project) => (
        relevantProjectIds.has(projectId(project)) ||
        !hasBusinessDateRange(project) ||
        overlapsDateRange(project, context.dateRange)
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
      const accountIdentity = deriveAccountIdentity(projectsList.items, ordersList.items);
      const orderInventory = compareProjectOrderInventory(projectsList.items, ordersList.items);
      const truncation = {
        maxPages: projectsList.truncated || ordersList.truncated,
        maxProjects: selectedProjects.truncated,
        maxOrders: selectedOrders.truncated,
      };
      const warnings = accountIdentity.warnings.slice();
      if (orderInventory.mismatch) {
        warnings.push({
          code: 'adstar_order_inventory_mismatch',
          message: 'Star order lists returned fewer related orders than the project inventory declares.',
          expectedOrderCount: orderInventory.expectedOrderCount,
          inventoryProjectCount: orderInventory.inventoryProjectCount,
          collectedOrderCount: orderInventory.collectedOrderCount,
          matchedProjectOrderCount: orderInventory.matchedProjectOrderCount,
        });
      }
      if (selectedProjects.truncated) warnings.push({ code: 'truncated_maxProjects', limit: 'maxProjects', value: selectedProjects.limit });
      if (selectedOrders.truncated) warnings.push({ code: 'truncated_maxOrders', limit: 'maxOrders', value: selectedOrders.limit });
      for (const project of projectsList.items) {
        if (!hasBusinessDateRange(project) && !relevantProjectIds.has(projectId(project))) {
          warnings.push({
            code: 'date_scope_unknown', unitType: 'project', unitId: projectId(project),
            message: 'Project has no list-level business date range; nested reports were collected with the requested report date range.',
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
          signal: context.signal,
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
        rethrowAbort(error, context.signal);
        errors.push(errorRecord(error, {
          code: 'nested_unit_incomplete', unitType: 'store', unitId: 'store',
        }));
      }

      for (const project of selectedProjects.items) {
        collectorCore.throwIfAborted(context.signal);
        const unit = await collectProjectUnit(context, project);
        nested.push(unit);
        for (const error of unit.errors) {
          errors.push(Object.assign({}, error, {
            code: 'nested_unit_incomplete', unitType: 'project', unitId: unit.id,
          }));
        }
      }
      const orderUnits = await mapWithConcurrency(
        selectedOrders.items,
        context.taskConcurrency,
        (order) => collectOrderUnit(context, order),
        context.signal,
      );
      for (const unit of orderUnits) {
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
        duplicateProjects.length === 0 && duplicateOrders.length === 0 && duplicateSettlements.length === 0 &&
        !accountIdentity.ambiguous && !orderInventory.mismatch;
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

      collectorCore.throwIfAborted(context.signal);
      return Object.assign({}, statusEvidence, {
        schemaVersion: 1,
        runId: context.runId,
        startedAt,
        finishedAt: now(),
        identity: contract.sanitizeSensitiveData(accountIdentity.identity),
        lists: { projects: projectsList, orders: ordersList },
        storeSummary,
        storeCheckpoint,
        nested: contract.sanitizeSensitiveData(nested),
        taskConcurrency: context.taskConcurrency,
        contentRows: contract.sanitizeSensitiveData(collectContentRows(nested)),
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
