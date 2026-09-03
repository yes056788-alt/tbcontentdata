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
  const PROJECT_PAGE_SIZE = 30;
  const DEFAULT_SEARCH_KEYWORD_CONCURRENCY = 4;
  const DEFAULT_SEARCH_KEYWORD_BUDGET_MS = 2 * 60 * 1000;
  const DEFAULT_LINK_EXPORT_POLL_INTERVAL_MS = 1000;
  const DEFAULT_LINK_EXPORT_TIMEOUT_MS = 2 * 60 * 1000;
  const DEFAULT_LINK_EXPORT_RESULT_TIMEOUT_MS = 3 * 60 * 1000;
  const MONEY_TOLERANCE = 0.01;
  const PLATFORM_FEE_ROW_DISPLAY_UNIT = 1;
  const SEARCH_KEYWORD_LIST_FIELDS = Object.freeze([
    'list', 'keywordList', 'searchKeywordList', 'searchKeywords',
    'topSearchKeywordList', 'keywordDataList', 'searchKeywordDataList', 'dataList',
    'rows', 'items', 'records',
  ]);
  const SEARCH_KEYWORD_FIELDS = Object.freeze([
    'keyword', 'keyWord', 'searchKeyword', 'searchWord', 'word', 'query',
  ]);
  const SEARCH_KEYWORD_IMPRESSION_FIELDS = Object.freeze([
    'impressions', 'impNum', 'impressionNum', 'exposure', 'exposureNum',
    'exposureCount', 'exposeNum', 'showNum', 'searchImpNum', 'searchImpressionNum',
  ]);
  const SEARCH_KEYWORD_READ_FIELDS = Object.freeze([
    'reads', 'read', 'readNum', 'readCount', 'clickNum', 'clicks',
    'searchReadNum', 'searchClickNum',
  ]);
  const SEARCH_KEYWORD_RATE_FIELDS = Object.freeze([
    'clickRate', 'clickRatio', 'ctr', 'readRate', 'clickThroughRate',
  ]);
  const SEARCH_KEYWORD_SCORE_FIELDS = Object.freeze(['searchScore']);

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

  function firstOptionalNumber(...values) {
    for (const value of values) {
      const number = optionalNumber(value);
      if (number !== null) return number;
    }
    return null;
  }

  function nonNegativeOptionalNumber(value) {
    const number = optionalNumber(value);
    return number !== null && number >= 0 ? number : null;
  }

  function normalizedRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[,，%\s]/g, ''));
    if (!Number.isFinite(number) || number < 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized >= 0 && normalized <= 1 ? normalized : null;
  }

  function normalizedSearchKeywordFailureCode(value) {
    const code = String(value == null ? '' : value).trim();
    return /^[A-Za-z0-9_:-]{1,128}$/.test(code)
      ? code
      : 'pgy_search_keywords_failed';
  }

  function firstOwnValue(value, fields) {
    const source = isObject(value) ? value : {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
    }
    return undefined;
  }

  function hasOwnField(value, fields) {
    return isObject(value) && fields.some((field) => (
      Object.prototype.hasOwnProperty.call(value, field)
    ));
  }

  function searchKeywordValue(value) {
    const strong = firstOwnValue(value, SEARCH_KEYWORD_FIELDS);
    if (strong !== undefined) return strong;
    const hasMetric = hasOwnField(value, SEARCH_KEYWORD_IMPRESSION_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_READ_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_RATE_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_SCORE_FIELDS);
    return hasMetric && Object.prototype.hasOwnProperty.call(value, 'name')
      ? value.name
      : undefined;
  }

  function hasSearchKeywordRow(value) {
    if (!isObject(value) || searchKeywordValue(value) === undefined) return false;
    return hasOwnField(value, SEARCH_KEYWORD_IMPRESSION_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_READ_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_RATE_FIELDS) ||
      hasOwnField(value, SEARCH_KEYWORD_SCORE_FIELDS);
  }

  function searchKeywordRows(value) {
    const seen = new Set();
    let explicitEmptyListFound = false;

    function visit(candidate, depth, explicitList) {
      if (depth > 6 || candidate === null || candidate === undefined) return null;
      if (Array.isArray(candidate)) {
        if (candidate.length === 0) {
          if (explicitList) explicitEmptyListFound = true;
          return null;
        }
        if (candidate.some(hasSearchKeywordRow)) return candidate;
        for (const item of candidate) {
          const nested = visit(item, depth + 1, false);
          if (nested) return nested;
        }
        return null;
      }
      if (!isObject(candidate) || seen.has(candidate)) return null;
      seen.add(candidate);
      const handled = new Set();
      for (const field of SEARCH_KEYWORD_LIST_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(candidate, field)) continue;
        handled.add(field);
        const nested = visit(candidate[field], depth + 1, true);
        if (nested) return nested;
      }
      for (const field of ['data', 'result', 'content', 'detail']) {
        if (!Object.prototype.hasOwnProperty.call(candidate, field)) continue;
        handled.add(field);
        const directEnvelopeList = depth === 0 && field === 'data' &&
          Array.isArray(candidate[field]);
        const nested = visit(candidate[field], depth + 1, directEnvelopeList);
        if (nested) return nested;
      }
      for (const [field, nestedValue] of Object.entries(candidate)) {
        if (handled.has(field)) continue;
        const nested = visit(nestedValue, depth + 1, false);
        if (nested) return nested;
      }
      return null;
    }

    const rows = visit(value, 0, false);
    return rows || (explicitEmptyListFound ? [] : null);
  }

  function normalizePgySearchKeywords(value) {
    const safe = contract.sanitizeSensitiveData(value);
    const rows = searchKeywordRows(safe);
    if (!rows) throw new Error('PGY search-keyword response list is missing or invalid.');
    const byKeyword = new Map();
    for (const rowValue of rows) {
      const row = isObject(rowValue) ? rowValue : {};
      const keywordValue = searchKeywordValue(row);
      const keyword = cleanIdentifier(keywordValue);
      if (!keyword) continue;
      const impressions = nonNegativeOptionalNumber(
        firstOwnValue(row, SEARCH_KEYWORD_IMPRESSION_FIELDS)
      );
      const reads = nonNegativeOptionalNumber(firstOwnValue(row, SEARCH_KEYWORD_READ_FIELDS));
      const clickRate = normalizedRate(firstOwnValue(row, SEARCH_KEYWORD_RATE_FIELDS));
      const searchScore = nonNegativeOptionalNumber(
        firstOwnValue(row, SEARCH_KEYWORD_SCORE_FIELDS)
      );
      if (!byKeyword.has(keyword)) {
        byKeyword.set(keyword, {
          keyword,
          rowCount: 0,
          impressions: 0,
          impressionsComplete: true,
          reads: 0,
          readsComplete: true,
          weightedClickRate: 0,
          weightedClickRateDenominator: 0,
          fallbackClickRate: null,
          searchScores: new Set(),
        });
      }
      const state = byKeyword.get(keyword);
      state.rowCount += 1;
      if (impressions === null) state.impressionsComplete = false;
      else state.impressions += impressions;
      if (reads === null) state.readsComplete = false;
      else state.reads += reads;
      if (searchScore !== null) state.searchScores.add(searchScore);
      if (clickRate !== null) {
        state.fallbackClickRate = state.fallbackClickRate === null
          ? clickRate
          : state.fallbackClickRate;
        if (impressions !== null && impressions > 0) {
          state.weightedClickRate += clickRate * impressions;
          state.weightedClickRateDenominator += impressions;
        }
      }
    }
    if (rows.length > 0 && byKeyword.size === 0) {
      throw new Error('PGY search-keyword rows do not contain a recognizable keyword field.');
    }
    return [...byKeyword.values()].map((state) => {
      const impressions = state.impressionsComplete ? state.impressions : null;
      const reads = state.readsComplete ? state.reads : null;
      let clickRate = null;
      if (impressions !== null && reads !== null) {
        clickRate = impressions > 0 ? reads / impressions : reads === 0 ? 0 : null;
      } else if (state.weightedClickRateDenominator > 0) {
        clickRate = state.weightedClickRate / state.weightedClickRateDenominator;
      } else {
        clickRate = state.fallbackClickRate;
      }
      const searchScore = state.searchScores.size === 1
        ? [...state.searchScores][0]
        : null;
      return {
        keyword: state.keyword,
        ...(searchScore !== null ? { searchScore } : {}),
        impressions,
        reads,
        clickRate,
      };
    }).sort((left, right) => {
      const leftImpressions = left.impressions === null ? -1 : left.impressions;
      const rightImpressions = right.impressions === null ? -1 : right.impressions;
      if (rightImpressions !== leftImpressions) return rightImpressions - leftImpressions;
      const leftReads = left.reads === null ? -1 : left.reads;
      const rightReads = right.reads === null ? -1 : right.reads;
      if (rightReads !== leftReads) return rightReads - leftReads;
      return left.keyword.localeCompare(right.keyword, 'zh-CN');
    });
  }

  function samplingRatio(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[%\s]/g, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized > 0 && normalized <= 1 ? normalized : null;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const canonical = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return canonical ? canonical[1] : null;
  }

  function firstCanonicalDate(...values) {
    for (const value of values) {
      const date = canonicalDate(value);
      if (date) return date;
    }
    return null;
  }

  function cleanIdentifier(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !['-', '--', '—'].includes(text) ? text : null;
  }

  function normalizeSpus(value) {
    const safe = isObject(value) ? value : {};
    const candidates = [];
    const add = (item) => {
      if (item === null || item === undefined) return;
      if (Array.isArray(item)) {
        item.forEach(add);
        return;
      }
      if (isObject(item)) {
        const id = cleanIdentifier(
          item.spuId ?? item.id ?? item.spuCode ?? item.spuNo ?? item.productSpuId
        );
        const name = cleanIdentifier(
          item.spuName ?? item.name ?? item.spuTitle ?? item.title ?? item.productName
        );
        if (id || name) candidates.push({ id: id || name, name: name || id });
        return;
      }
      const text = cleanIdentifier(item);
      if (text) candidates.push({ id: text, name: text });
    };
    add(safe.spu);
    add(safe.spuInfo);
    add(safe.spuInfos);
    add(safe.spuList);
    add(safe.productSpu);
    add({
      spuId: safe.spuId ?? safe.spuCode ?? safe.spuNo ?? safe.productSpuId,
      spuName: safe.spuName ?? safe.spuTitle ?? safe.productSpuName,
    });
    const seen = new Set();
    return candidates.filter((item) => {
      const key = `${item.id}\u0000${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function noteDetailUrl(value, noteId) {
    const safe = isObject(value) ? value : {};
    for (const candidate of [safe.noteUrl, safe.noteLink, safe.shareUrl, safe.url]) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      const officialUrl = contract.sanitizeOfficialNoteUrl(candidate, noteId);
      if (officialUrl) return officialUrl;
    }
    return null;
  }

  function normalizePgyNote(value, options) {
    const safe = contract.sanitizeSensitiveData(isObject(value) ? value : {});
    const noteId = String(safe.noteId || '').trim();
    if (!noteId) throw new Error('PGY note noteId is required.');
    const sourceKey = String(safe.bizId || noteId).trim();
    const actualConsume = optionalNumber(safe.actualConsume);
    const rawFollowerCount = optionalNumber(safe.kolFanNum);
    const followerCount = rawFollowerCount !== null && rawFollowerCount >= 0
      ? rawFollowerCount
      : null;
    const cooperation = actualConsume == null
      ? Math.max(0, numberOrZero(safe.totalConsume) - numberOrZero(safe.refundAmount))
      : Math.max(0, actualConsume);
    const platformFee = Math.max(0, numberOrZero(safe.totalPlatformPrice));
    const starData = isObject(safe.starData) ? safe.starData : {};
    const rawTaobaoTaskId = starData.thirdBriefId !== undefined
      ? starData.thirdBriefId
      : safe.thirdBriefId !== undefined
        ? safe.thirdBriefId
        : safe.taobaoTaskId;
    const taobaoTaskId = cleanIdentifier(rawTaobaoTaskId);
    const spuName = cleanIdentifier(safe.spuName);
    const taobaoSamplingRatio = samplingRatio(
      starData.dataTransRatio !== undefined ? starData.dataTransRatio : safe.dataTransRatio
    );
    const normalized = {
      noteId,
      sourceKey,
      title: safe.noteTitle == null ? '' : String(safe.noteTitle),
      noteUrl: noteDetailUrl(safe, noteId),
      publishDate: canonicalDate(safe.notePublishTime || safe.dateKey),
      spuName,
      spus: normalizeSpus(safe),
      crossDomainProjectId: cleanIdentifier(safe.thirdProjectId),
      crossDomainProjectName: cleanIdentifier(safe.thirdProjectName),
      taobaoTaskId,
      taobaoSamplingRatio,
      taskEndDate: firstCanonicalDate(
        safe.thirdBriefEndTime,
        starData.thirdBriefEndTime,
        safe.taskEndTime,
        safe.taobaoBriefEndTime
      ),
      author: {
        id: safe.kolId == null ? null : String(safe.kolId),
        name: safe.kolNickName == null ? null : String(safe.kolNickName),
        followerCount,
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
        taobaoOffsiteActiveUv15d: firstOptionalNumber(
          starData.intoStoreUv,
          starData.thirdTaobaoActivePgyUserNum,
          safe.intoStoreUv,
          safe.thirdTaobaoActivePgyUserNum
        ),
        taobaoOffsiteActiveCost15d: firstOptionalNumber(
          starData.intoStoreCost,
          starData.thirdTaobaoActivePgyUserCost,
          safe.intoStoreCost,
          safe.thirdTaobaoActivePgyUserCost
        ),
        taobaoDealUv15d: firstOptionalNumber(starData.taobaoDealUv, safe.taobaoDealUv),
        taobaoAddCartUv15d: firstOptionalNumber(starData.taobaoAddCartUv, safe.taobaoAddCartUv),
        taobaoAddCartRate15d: firstOptionalNumber(
          starData.taobaoAddCartRatio,
          safe.taobaoAddCartRatio
        ),
        taobaoPurchaseRate15d: firstOptionalNumber(
          starData.taobaoDealRatio,
          safe.taobaoDealRatio
        ),
      },
    };
    if (options && options.includeSearchContext === true) {
      normalized.orderCategory = cleanIdentifier(safe.orderCategory) || '0';
    }
    return normalized;
  }

  function normalizePgyProject(value) {
    const safe = contract.sanitizeSensitiveData(isObject(value) ? value : {});
    const projectId = cleanIdentifier(safe.projectId || safe.thirdProjectId);
    if (!projectId) throw new Error('PGY cross-domain project projectId is required.');
    return {
      projectId,
      projectName: cleanIdentifier(safe.projectName || safe.thirdProjectName),
      taobaoBriefId: cleanIdentifier(safe.taobaoBriefId || safe.thirdBriefId),
      taskEndDate: firstCanonicalDate(
        safe.taobaoBriefEndTime,
        safe.thirdBriefEndTime,
        safe.taskEndTime
      ),
    };
  }

  function applyPgyTaskEndDates(notesValue, projectsValue) {
    const notes = Array.isArray(notesValue) ? notesValue : [];
    const projects = Array.isArray(projectsValue) ? projectsValue : [];
    const byProject = new Map();
    for (const project of projects) {
      const projectId = cleanIdentifier(project && project.projectId);
      const taskEndDate = canonicalDate(project && project.taskEndDate);
      if (projectId && taskEndDate) byProject.set(projectId, taskEndDate);
    }
    let taskNoteCount = 0;
    let directTaskEndCount = 0;
    let projectTaskEndCount = 0;
    const enriched = notes.map((noteValue) => {
      const note = isObject(noteValue) ? noteValue : {};
      const isTaskNote = Boolean(cleanIdentifier(note.taobaoTaskId));
      if (isTaskNote) taskNoteCount += 1;
      const directTaskEndDate = canonicalDate(note.taskEndDate);
      if (directTaskEndDate) {
        if (isTaskNote) directTaskEndCount += 1;
        return note;
      }
      const projectId = cleanIdentifier(note.crossDomainProjectId);
      const projectTaskEndDate = projectId ? byProject.get(projectId) || null : null;
      if (!projectTaskEndDate) return note;
      if (isTaskNote) projectTaskEndCount += 1;
      return Object.assign({}, note, { taskEndDate: projectTaskEndDate });
    });
    const matchedTaskEndCount = directTaskEndCount + projectTaskEndCount;
    return {
      notes: enriched,
      coverage: {
        source: 'pgy_cross_domain_project',
        projectCount: new Set(projects.map((project) => cleanIdentifier(project && project.projectId))
          .filter(Boolean)).size,
        taskNoteCount,
        matchedTaskEndCount,
        directTaskEndCount,
        projectTaskEndCount,
        missingTaskEndCount: Math.max(0, taskNoteCount - matchedTaskEndCount),
      },
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
    return Math.abs(Number(left) - Number(right)) <= MONEY_TOLERANCE;
  }

  function stableMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 1e6) / 1e6;
  }

  function platformFeeReconciliation(summaryFee, detailFee, feeBearingCount) {
    const expected = stableMoney(summaryFee);
    const actual = stableMoney(detailFee);
    const difference = stableMoney(expected - actual);
    const count = Math.max(0, Math.floor(Number(feeBearingCount) || 0));
    const tolerance = count * PLATFORM_FEE_ROW_DISPLAY_UNIT;
    const exact = difference === 0;
    const perRowTruncation = difference > 0 && difference < tolerance;
    return {
      expected,
      actual,
      difference,
      tolerance,
      feeBearingCount: count,
      reconciliation: exact
        ? 'exact'
        : perRowTruncation
          ? 'per_row_yuan_truncation'
          : 'mismatch',
    };
  }

  function platformFeeMismatchMessage(diagnostics) {
    const detail = diagnostics || {};
    if (detail.feeBearingCount === 0) {
      return `PGY platform fee mismatch: summary ${detail.expected}, note rows ${detail.actual}, ` +
        `difference ${detail.difference}; no fee-bearing note rows exist, so the allowed truncation gap is 0 yuan.`;
    }
    return `PGY platform fee mismatch: summary ${detail.expected}, note rows ${detail.actual}, ` +
      `difference ${detail.difference}, allowed one-sided truncation gap must be at least 0 and strictly below ` +
      `${detail.tolerance} yuan across ${detail.feeBearingCount} fee-bearing rows.`;
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
    const cooperationCost = stableMoney(notes.reduce(
      (sum, note) => sum + numberOrZero(note && note.costs && note.costs.cooperation),
      0
    ));
    const platformFee = stableMoney(notes.reduce(
      (sum, note) => sum + numberOrZero(note && note.costs && note.costs.platformFee),
      0
    ));
    const feeBearingCount = notes.reduce((count, note) => (
      numberOrZero(note && note.costs && note.costs.platformFee) > 0 ? count + 1 : count
    ), 0);
    const platformFeeDiagnostics = platformFeeReconciliation(
      summary.platformFee,
      platformFee,
      feeBearingCount
    );
    const expectedCount = optionalNumber(summary.expectedCount);
    const issues = [];
    const warnings = [];
    if (duplicateSourceCount > 0) {
      issues.push({ code: 'duplicate_source_row', count: duplicateSourceCount });
    } else if (duplicateCount > 0) {
      issues.push({ code: 'duplicate_note_id', count: duplicateCount });
    }
    if (expectedCount != null && expectedCount !== receivedCount) {
      issues.push({ code: 'row_count_mismatch', expected: expectedCount, actual: receivedCount });
    }
    if (!closeEnough(summary.cooperationCost, cooperationCost)) {
      const expected = stableMoney(summary.cooperationCost);
      const difference = stableMoney(expected - cooperationCost);
      issues.push({
        code: 'cooperation_cost_mismatch',
        message: `PGY cooperation cost mismatch: summary ${expected}, note rows ${cooperationCost}, ` +
          `difference ${difference}, allowed absolute tolerance ${MONEY_TOLERANCE} yuan.`,
        expected,
        actual: cooperationCost,
        difference,
        tolerance: MONEY_TOLERANCE,
      });
    }
    if (platformFeeDiagnostics.reconciliation === 'per_row_yuan_truncation') {
      warnings.push({
        code: 'platform_fee_rounding_reconciled',
        message: `PGY summary platform fee ${platformFeeDiagnostics.expected} exceeds the note-row total ` +
          `${platformFeeDiagnostics.actual} by ${platformFeeDiagnostics.difference}; accepted because ` +
          `${platformFeeDiagnostics.feeBearingCount} fee-bearing rows permit a one-sided truncation gap ` +
          `strictly below ${platformFeeDiagnostics.tolerance} yuan.`,
        expected: platformFeeDiagnostics.expected,
        actual: platformFeeDiagnostics.actual,
        difference: platformFeeDiagnostics.difference,
        tolerance: platformFeeDiagnostics.tolerance,
        feeBearingCount: platformFeeDiagnostics.feeBearingCount,
      });
    } else if (platformFeeDiagnostics.reconciliation === 'mismatch') {
      issues.push({
        code: 'platform_fee_mismatch',
        message: platformFeeMismatchMessage(platformFeeDiagnostics),
        expected: platformFeeDiagnostics.expected,
        actual: platformFeeDiagnostics.actual,
        difference: platformFeeDiagnostics.difference,
        tolerance: platformFeeDiagnostics.tolerance,
        feeBearingCount: platformFeeDiagnostics.feeBearingCount,
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
      platformFeeDiagnostics,
      warnings,
      issues,
    };
  }

  function requestBody(context, pageNum) {
    return {
      brandUserIds: [context.identity.brandUserId],
      startTime: '',
      endTime: '',
      pageNum,
      pageSize: context.pageSize,
      sorts: [],
      sceneType: 0,
    };
  }

  function projectRequestBody(pageNum) {
    return { pageNum, pageSize: PROJECT_PAGE_SIZE, sorts: [] };
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
    const configuredResumeRetries = Number(settings.paginationResumeRetries);
    const configuredResumeDelay = Number(settings.paginationResumeBaseDelayMs);
    const paginationResumeRetries = Math.max(0, Math.min(5, Math.floor(
      Number.isFinite(configuredResumeRetries) ? configuredResumeRetries : 2
    )));
    const paginationResumeBaseDelayMs = Math.max(0, Math.floor(
      Number.isFinite(configuredResumeDelay) ? configuredResumeDelay : 300
    ));
    const configuredSearchKeywordConcurrency = Number(settings.searchKeywordConcurrency);
    const searchKeywordConcurrency = Math.max(1, Math.min(8, Math.floor(
      Number.isFinite(configuredSearchKeywordConcurrency)
        ? configuredSearchKeywordConcurrency
        : DEFAULT_SEARCH_KEYWORD_CONCURRENCY
    )));
    const configuredSearchKeywordBudgetMs = Number(settings.searchKeywordBudgetMs);
    const searchKeywordBudgetMs = Math.max(1, Math.min(5 * 60 * 1000, Math.floor(
      Number.isFinite(configuredSearchKeywordBudgetMs)
        ? configuredSearchKeywordBudgetMs
        : DEFAULT_SEARCH_KEYWORD_BUDGET_MS
    )));
    const configuredLinkExportPollIntervalMs = Number(settings.linkExportPollIntervalMs);
    const linkExportPollIntervalMs = Math.max(0, Math.min(10 * 1000, Math.floor(
      Number.isFinite(configuredLinkExportPollIntervalMs)
        ? configuredLinkExportPollIntervalMs
        : DEFAULT_LINK_EXPORT_POLL_INTERVAL_MS
    )));
    const configuredLinkExportTimeoutMs = Number(settings.linkExportTimeoutMs);
    const linkExportTimeoutMs = Math.max(1, Math.min(10 * 60 * 1000, Math.floor(
      Number.isFinite(configuredLinkExportTimeoutMs)
        ? configuredLinkExportTimeoutMs
        : DEFAULT_LINK_EXPORT_TIMEOUT_MS
    )));
    const configuredLinkExportResultTimeoutMs = Number(settings.linkExportResultTimeoutMs);
    const linkExportResultTimeoutMs = Math.max(1, Math.min(10 * 60 * 1000, Math.floor(
      Number.isFinite(configuredLinkExportResultTimeoutMs)
        ? configuredLinkExportResultTimeoutMs
        : DEFAULT_LINK_EXPORT_RESULT_TIMEOUT_MS
    )));

    async function request(tabId, endpoint, payload, signal, timeoutMs) {
      return settings.pageClient.request({
        tabId, platform: 'pgy', endpoint, payload: payload || {}, signal, timeoutMs,
      });
    }

    function rethrowAbort(error, signal) {
      if (collectorCore.isAbortError(error, signal)) throw collectorCore.abortError(signal);
    }

    function wait(delay, signal) {
      const milliseconds = Math.max(0, Number(delay) || 0);
      if (!milliseconds) {
        collectorCore.throwIfAborted(signal);
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
        }, milliseconds);
        const onAbort = () => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(collectorCore.abortError(signal));
        };
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      });
    }

    function noteInsideDateRange(note, dateRange) {
      const range = isObject(dateRange) ? dateRange : {};
      const publishDate = canonicalDate(note && note.publishDate);
      return Boolean(publishDate && (!range.from || publishDate >= range.from) &&
        (!range.to || publishDate <= range.to));
    }

    function linkEligibleNotes(notes, dateRange) {
      return (Array.isArray(notes) ? notes : []).filter((note) => (
        noteInsideDateRange(note, dateRange)
      ));
    }

    async function collectOfficialNoteLinks(notesValue, context) {
      const eligible = linkEligibleNotes(notesValue, context.dateRange);
      const baseCoverage = {
        taskType: 'content_note_download_task',
        totalNoteCount: eligible.length,
        matchedNoteCount: 0,
        missingNoteCount: eligible.length,
        parsedRowCount: 0,
        rejectedRowCount: 0,
        status: eligible.length ? 'failed' : 'empty',
      };
      if (!eligible.length) return { links: new Map(), coverage: baseCoverage };
      try {
        const submitted = await collectorCore.withRetry(
          () => request(context.tabId, 'notes.linkExport.submit', {
            brandUserId: context.identity.brandUserId,
            startTime: context.dateRange.from,
            endTime: context.dateRange.to,
          }, context.signal),
          Object.assign({}, retry, { signal: context.signal })
        );
        const taskId = cleanIdentifier(submitted && submitted.taskId);
        if (!taskId) throw new Error('PGY official note-link export taskId is missing.');
        const deadline = Date.now() + linkExportTimeoutMs;
        while (true) {
          collectorCore.throwIfAborted(context.signal);
          const statusResponse = await collectorCore.withRetry(
            () => request(context.tabId, 'notes.linkExport.status', { taskId }, context.signal),
            Object.assign({}, retry, { signal: context.signal })
          );
          const taskStatus = Number(statusResponse && statusResponse.status);
          if (taskStatus === 3) break;
          if (taskStatus === 5) {
            const taskError = new Error('PGY official note-link export task failed.');
            taskError.code = 'PGY_LINK_EXPORT_TASK_FAILED';
            taskError.retryable = false;
            throw taskError;
          }
          if (![1, 2].includes(taskStatus)) {
            const statusError = new Error(`PGY official note-link export returned status ${taskStatus}.`);
            statusError.code = 'PGY_LINK_EXPORT_STATUS_INVALID';
            statusError.retryable = true;
            throw statusError;
          }
          if (Date.now() >= deadline) {
            const timeoutError = new Error('PGY official note-link export timed out.');
            timeoutError.code = 'PGY_LINK_EXPORT_TIMEOUT';
            timeoutError.retryable = true;
            throw timeoutError;
          }
          await wait(linkExportPollIntervalMs, context.signal);
        }
        const eligibleIds = eligible.map((note) => String(note.noteId || '')).filter(Boolean);
        const result = await collectorCore.withRetry(
          () => request(context.tabId, 'notes.linkExport.result', {
            taskId,
            noteIds: eligibleIds.length <= 1000 ? eligibleIds : [],
          }, context.signal, linkExportResultTimeoutMs),
          Object.assign({}, retry, { signal: context.signal })
        );
        const eligibleSet = new Set(eligibleIds);
        const links = new Map();
        for (const pair of Array.isArray(result && result.links) ? result.links : []) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const noteId = String(pair[0] == null ? '' : pair[0]).trim();
          if (!eligibleSet.has(noteId)) continue;
          const officialUrl = contract.sanitizeOfficialNoteUrl(pair[1], noteId);
          if (officialUrl) links.set(noteId, officialUrl);
        }
        const matchedNoteCount = links.size;
        return {
          links,
          coverage: Object.assign({}, baseCoverage, {
            matchedNoteCount,
            missingNoteCount: Math.max(0, eligible.length - matchedNoteCount),
            parsedRowCount: Math.max(0, Number(result && result.parsedRowCount) || 0),
            rejectedRowCount: Math.max(0, Number(result && result.rejectedRowCount) || 0),
            status: matchedNoteCount === eligible.length
              ? 'complete'
              : matchedNoteCount > 0 ? 'partial' : 'failed',
          }),
        };
      } catch (error) {
        rethrowAbort(error, context.signal);
        return {
          links: new Map(),
          coverage: Object.assign({}, baseCoverage, {
            errorCode: String(error && error.code || 'PGY_LINK_EXPORT_FAILED'),
            errorMessage: String(error && error.message || error || 'PGY link export failed.'),
          }),
        };
      }
    }

    function applyOfficialNoteLinks(notesValue, linkResult) {
      const links = linkResult && linkResult.links instanceof Map ? linkResult.links : new Map();
      return (Array.isArray(notesValue) ? notesValue : []).map((note) => {
        const noteId = String(note && note.noteId || '');
        const officialUrl = links.get(noteId) ||
          contract.sanitizeOfficialNoteUrl(note && note.noteUrl, noteId);
        return Object.assign({}, note, { noteUrl: officialUrl || null });
      });
    }

    async function collectSearchKeywords(notesValue, context) {
      const notes = Array.isArray(notesValue) ? notesValue : [];
      const enriched = notes.map((note) => {
        const publicNote = Object.assign({}, note);
        delete publicNote.orderCategory;
        return publicNote;
      });
      const queue = notes.map((note, index) => ({ note, index })).filter(({ note }) => (
        noteInsideDateRange(note, context.dateRange)
      ));
      const failures = [];
      let cursor = 0;
      let budgetExceeded = false;
      const budgetController = new AbortController();
      const budgetError = new Error(
        `PGY search-keyword collection exceeded its ${searchKeywordBudgetMs} ms time budget.`
      );
      budgetError.name = 'AbortError';
      budgetError.code = 'PGY_SEARCH_KEYWORD_BUDGET_EXCEEDED';
      budgetError.retryable = false;
      const abortFromParent = () => budgetController.abort(context.signal && context.signal.reason);
      if (context.signal && typeof context.signal.addEventListener === 'function') {
        context.signal.addEventListener('abort', abortFromParent, { once: true });
        if (context.signal.aborted) abortFromParent();
      }
      const budgetTimer = setTimeout(() => {
        budgetExceeded = true;
        budgetController.abort(budgetError);
      }, searchKeywordBudgetMs);

      function recordFailure(note, index, code) {
        const publicNote = Object.assign({}, note);
        delete publicNote.orderCategory;
        const failureCode = normalizedSearchKeywordFailureCode(code);
        failures.push({
          noteId: String(note && note.noteId || ''),
          code: failureCode,
        });
        enriched[index] = Object.assign(publicNote, {
          searchKeywordFetchStatus: 'failed',
          searchKeywordErrorCode: failureCode,
          searchKeywords: [],
        });
      }

      async function worker() {
        while (cursor < queue.length) {
          const queueIndex = cursor;
          cursor += 1;
          const { note, index } = queue[queueIndex];
          const publicNote = Object.assign({}, note);
          delete publicNote.orderCategory;
          if (budgetController.signal.aborted) {
            if (context.signal && context.signal.aborted) {
              throw collectorCore.abortError(context.signal);
            }
            budgetExceeded = true;
            recordFailure(note, index, 'PGY_SEARCH_KEYWORD_BUDGET_EXCEEDED');
            continue;
          }
          try {
            const response = await collectorCore.withRetry(
              () => request(context.tabId, 'notes.searchKeywords', {
                noteId: note.noteId,
                orderCategory: note.orderCategory,
              }, budgetController.signal),
              Object.assign({}, retry, { signal: budgetController.signal })
            );
            const searchKeywords = normalizePgySearchKeywords(response);
            enriched[index] = Object.assign(publicNote, {
              searchKeywordFetchStatus: searchKeywords.length ? 'complete' : 'empty',
              searchKeywords,
            });
          } catch (error) {
            if (context.signal && context.signal.aborted) {
              throw collectorCore.abortError(context.signal);
            }
            const timedOut = budgetExceeded || budgetController.signal.aborted;
            if (timedOut) budgetExceeded = true;
            recordFailure(note, index, timedOut
              ? 'PGY_SEARCH_KEYWORD_BUDGET_EXCEEDED'
              : error && error.code || 'pgy_search_keywords_failed');
          }
        }
      }

      const workers = Math.min(searchKeywordConcurrency, queue.length);
      try {
        await Promise.all(Array.from({ length: workers }, () => worker()));
      } finally {
        clearTimeout(budgetTimer);
        if (context.signal && typeof context.signal.removeEventListener === 'function') {
          context.signal.removeEventListener('abort', abortFromParent);
        }
      }
      const completeNoteCount = enriched.reduce((count, note) => (
        count + (note && note.searchKeywordFetchStatus === 'complete' ? 1 : 0)
      ), 0);
      const emptyNoteCount = enriched.reduce((count, note) => (
        count + (note && note.searchKeywordFetchStatus === 'empty' ? 1 : 0)
      ), 0);
      const keywordCount = enriched.reduce((count, note) => (
        count + (Array.isArray(note && note.searchKeywords) ? note.searchKeywords.length : 0)
      ), 0);
      const failureCodeCounts = failures.reduce((counts, failure) => {
        counts[failure.code] = (counts[failure.code] || 0) + 1;
        return counts;
      }, {});
      return {
        notes: enriched,
        coverage: {
          totalNoteCount: queue.length,
          coveredNoteCount: completeNoteCount + emptyNoteCount,
          completeNoteCount,
          emptyNoteCount,
          failedNoteCount: failures.length,
          timedOutNoteCount: failures.filter((failure) => (
            failure.code === 'PGY_SEARCH_KEYWORD_BUDGET_EXCEEDED'
          )).length,
          failureCodeCounts,
          keywordCount,
          budgetExceeded,
          budgetMs: searchKeywordBudgetMs,
          status: failures.length === 0 ? 'complete' : 'partial',
        },
      };
    }

    function resumablePaginationError(error) {
      const message = String(error && error.message || error || '');
      if (/data\.list|page mismatch|parser returned|must be an array/i.test(message)) return false;
      return !error || error.retryable !== false ||
        /searchContentNote|network|fetch|timeout|gateway|temporary|temporarily|系统|繁忙|稍后/i.test(message);
    }

    function waitForPaginationResume(attempt, signal) {
      const delay = paginationResumeBaseDelayMs * Math.max(1, Number(attempt) || 1);
      if (!delay) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        const onAbort = () => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(collectorCore.abortError(signal));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    function baseResult(context, startedAt) {
      return {
        schemaVersion: 1,
        platform: 'pgy',
        runId: context.runId,
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        dateBasis: 'note_publish_time',
        collectionScope: 'all_available',
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
        signal: source.signal,
      };
      if (!Number.isInteger(context.tabId) || context.tabId < 0) throw new Error('PGY tabId is required.');
      if (!context.runId) throw new Error('PGY runId is required.');
      if (!context.accountKey) throw new Error('PGY accountKey is required.');
      if (!context.dateRange.from || !context.dateRange.to) throw new Error('PGY dateRange is required.');
      const startedAt = now();
      collectorCore.throwIfAborted(context.signal);

      try {
        const identity = await collectorCore.withRetry(
          () => request(context.tabId, 'identity.get', {
            brandUserIds: [], startTime: '', endTime: '', pageNum: 1, pageSize: 1, sorts: [], sceneType: 0,
          }, context.signal),
          Object.assign({}, retry, { signal: context.signal })
        );
        if (!isObject(identity) || !identity.brandUserId) throw new Error('PGY identity brandUserId is missing.');
        context.identity = {
          brandUserId: String(identity.brandUserId),
          brandUserName: identity.brandUserName == null ? null : String(identity.brandUserName),
        };
      } catch (error) {
        rethrowAbort(error, context.signal);
        const result = baseResult(context, startedAt);
        result.status = 'failed';
        result.errors = [errorRecord(error, { code: 'identity_unavailable' })];
        result.finishedAt = now();
        return result;
      }

      let summary;
      try {
        const response = await collectorCore.withRetry(
          () => request(context.tabId, 'notes.sum', requestBody(context, 1), context.signal),
          Object.assign({}, retry, { signal: context.signal })
        );
        summary = normalizePgySummary(response);
      } catch (error) {
        rethrowAbort(error, context.signal);
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
        brandUserId: context.identity.brandUserId,
        collectionScope: 'all_available',
        pageSize: context.pageSize,
      });
      let notesResult;
      let paginationError = null;
      let paginationResumeCount = 0;
      const paginationResumeWarnings = [];
      try {
        while (true) {
          try {
            notesResult = await collectorCore.collectPaginated({
              cache: settings.cache,
              cacheKey,
              fingerprint,
              maxPages: context.maxPages,
              retry,
              signal: context.signal,
              fetchPage: (page) => request(
                context.tabId, 'notes.list', requestBody(context, page), context.signal
              ),
              parsePage(response, page) {
                const parsed = parsePgyPage(response, page);
                return Object.assign({}, parsed, {
                  items: parsed.items.map((row) => normalizePgyNote(row, {
                    includeSearchContext: true,
                  })),
                });
              },
            });
            break;
          } catch (error) {
            rethrowAbort(error, context.signal);
            if (paginationResumeCount >= paginationResumeRetries || !resumablePaginationError(error)) {
              throw error;
            }
            paginationResumeCount += 1;
            const cached = await settings.cache.read(cacheKey);
            const warning = {
              code: 'pagination_resumed',
              message: `PGY pagination resumed from page ${Number(cached && cached.nextPage) || 1} after a transient interruption.`,
              attempt: paginationResumeCount,
              nextPage: Number(cached && cached.nextPage) || 1,
            };
            paginationResumeWarnings.push(warning);
            await settings.cache.update(cacheKey, {
              status: 'partial',
              warnings: [warning],
            });
            await waitForPaginationResume(paginationResumeCount, context.signal);
          }
        }
        if (paginationResumeWarnings.length) {
          notesResult = Object.assign({}, notesResult, {
            warnings: (notesResult.warnings || []).concat(paginationResumeWarnings),
          });
        }
      } catch (error) {
        rethrowAbort(error, context.signal);
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

      const officialLinkPromise = collectOfficialNoteLinks(notesResult.items, context);
      let projectsResult;
      let projectsError = null;
      const projectsCacheKey = `xhs:${encodeURIComponent(context.runId)}:pgy:projects`;
      const projectsFingerprint = collectorCore.stableFingerprint({
        endpoint: 'projects.list', accountKey: context.accountKey,
        brandUserId: context.identity.brandUserId,
        pageSize: PROJECT_PAGE_SIZE,
      });
      try {
        projectsResult = await collectorCore.collectPaginated({
          cache: settings.cache,
          cacheKey: projectsCacheKey,
          fingerprint: projectsFingerprint,
          retry,
          signal: context.signal,
          fetchPage: (page) => request(
            context.tabId, 'projects.list', projectRequestBody(page), context.signal
          ),
          parsePage(response, page) {
            const parsed = parsePgyPage(response, page);
            return Object.assign({}, parsed, { items: parsed.items.map(normalizePgyProject) });
          },
        });
      } catch (error) {
        rethrowAbort(error, context.signal);
        projectsError = error;
        const record = await settings.cache.read(projectsCacheKey);
        projectsResult = record && Number(record.receivedCount) > 0
          ? partialPageResult(record, error)
          : {
            status: 'failed', items: [], warnings: [{
              code: 'pgy_task_metadata_incomplete',
              message: String(error && error.message || error),
            }],
          };
      }

      const taskDates = applyPgyTaskEndDates(notesResult.items, projectsResult.items);
      const [searchKeywordResult, officialLinkResult] = await Promise.all([
        collectSearchKeywords(taskDates.notes, context),
        officialLinkPromise,
      ]);
      const notes = applyOfficialNoteLinks(searchKeywordResult.notes, officialLinkResult);
      if (summary.expectedCount == null) summary = Object.assign({}, summary, { expectedCount: notesResult.expectedCount });
      const reconciliation = reconcilePgyCollection({ summary, notes });
      const taskDateErrors = taskDates.coverage.missingTaskEndCount > 0
        ? [{
          code: 'pgy_task_end_date_missing',
          message: `${taskDates.coverage.missingTaskEndCount} PGY Taobao task notes are missing a task end date after cross-domain project pagination.`,
          count: taskDates.coverage.missingTaskEndCount,
        }]
        : [];
      const errors = (paginationError
        ? [errorRecord(paginationError, { code: 'pagination_incomplete' })]
        : []).concat(projectsError
          ? [errorRecord(projectsError, { code: 'pgy_task_metadata_incomplete' })]
          : [], taskDateErrors);
      const schemaValid = true;
      const paginationComplete = notesResult.status === 'complete' && projectsResult.status === 'complete';
      const statusEvidence = quality.derivePlatformStatus({
        platform: 'pgy',
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        schemaValid,
        paginationComplete,
        reconciled: reconciliation.reconciled,
        receivedCount: notesResult.receivedCount,
        truncation: { maxPages: Boolean(notesResult.truncated) },
        warnings: (notesResult.warnings || []).concat(
          projectsResult.warnings || [], reconciliation.warnings, reconciliation.issues
        ),
        errors,
      });
      const status = statusEvidence.status;
      const searchKeywordWarnings = searchKeywordResult.coverage.failedNoteCount > 0
        ? [{
          code: 'pgy_search_keywords_incomplete',
          message: `${searchKeywordResult.coverage.failedNoteCount} PGY notes are missing search-keyword data${searchKeywordResult.coverage.budgetExceeded ? ' after the enhancement time budget was reached' : ''}; core cost and performance metrics remain complete.`,
          count: searchKeywordResult.coverage.failedNoteCount,
          budgetExceeded: searchKeywordResult.coverage.budgetExceeded,
          failureCodeCounts: searchKeywordResult.coverage.failureCodeCounts,
        }]
        : [];
      const officialLinkWarnings = officialLinkResult.coverage.missingNoteCount > 0
        ? [{
          code: 'pgy_official_note_links_incomplete',
          message: `${officialLinkResult.coverage.missingNoteCount} PGY notes are missing platform-exported official links; those titles remain non-clickable.`,
          count: officialLinkResult.coverage.missingNoteCount,
          exportStatus: officialLinkResult.coverage.status,
          errorCode: officialLinkResult.coverage.errorCode || null,
        }]
        : [];
      const latestPublishDate = notes.reduce((latest, note) => {
        const publishDate = canonicalDate(note && note.publishDate);
        return publishDate && (!latest || publishDate > latest) ? publishDate : latest;
      }, null);
      collectorCore.throwIfAborted(context.signal);
      return Object.assign({}, statusEvidence, {
        schemaVersion: 1,
        platform: 'pgy',
        runId: context.runId,
        accountKey: context.accountKey,
        dateRange: context.dateRange,
        dateBasis: 'note_publish_time',
        collectionScope: 'all_available',
        latestPublishDate,
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
        paginationResumeCount,
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
        notes: contract.sanitizeSensitiveData(notes),
        officialLinkCoverage: contract.sanitizeSensitiveData(officialLinkResult.coverage),
        searchKeywordCoverage: contract.sanitizeSensitiveData(searchKeywordResult.coverage),
        taskDateCoverage: contract.sanitizeSensitiveData(taskDates.coverage),
        reconciliation: contract.sanitizeSensitiveData(reconciliation),
        empty: paginationComplete && reconciliation.reconciled && notesResult.receivedCount === 0,
        warnings: contract.sanitizeSensitiveData(
          (statusEvidence.warnings || []).concat(searchKeywordWarnings, officialLinkWarnings)
        ),
        errors: contract.sanitizeSensitiveData(errors),
      });
    }

    return Object.freeze({ collect });
  }

  return Object.freeze({
    createPgyCollector,
    applyPgyTaskEndDates,
    normalizePgyNote,
    normalizePgySearchKeywords,
    normalizePgyProject,
    normalizePgySummary,
    parsePgyPage,
    reconcilePgyCollection,
  });
});
