(function initXhsAnalysis(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const qualityTools = typeof module === 'object' && module.exports
    ? require('./quality')
    : root.XhsQuality;
  const identityTools = typeof module === 'object' && module.exports
    ? require('./identity')
    : root.XhsIdentity;
  const api = factory(contract, qualityTools, identityTools);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsAnalysisApi(contract, qualityTools, identityTools) {
  'use strict';

  if (!contract || !qualityTools || !identityTools) {
    throw new Error('XhsContract, XhsQuality and XhsIdentity must be loaded before XhsAnalysis');
  }

  const SNAPSHOT_SCHEMA = 'xhsAnalysisSnapshotV1';
  const STAR_METRIC_MAP = Object.freeze({
    readUv: 'readUv1d',
    engagementUv: 'engagementUv1d',
    searchImpressionUv: 'slrAttrItmSeImpsUv1d',
    searchVisitUv: 'slrAttrSlrSeVstUv1d',
    storeVisitUv: 'slrAttrSlrVstUv1d',
    newStoreVisitUv: 'slrAttrSlrVstUv1dNew',
    favoriteUv: 'slrAttrItmCltUv1d',
    cartUv: 'slrAttrItmCartUv1d',
    orderUv: 'slrAttrItmOrdUv1d',
    newOrderUv: 'slrAttrItmOrdUv1dNew',
    gmv: 'slrAttrItmOrdGmv1d',
    seededProductGmv: 'slrAttrItmOrdGmv1d1bpOrd',
    linkedProductGmv: 'slrAttrItmOrdGmv1dNot1bpOrd',
  });
  const STAR_METRIC_ALIASES = Object.freeze({
    favoriteUv: ['slrAttrItmFavUv1d'],
    seededProductGmv: ['slrAttrTaskItmOrdGmv1d'],
    linkedProductGmv: ['slrAttrLinkItmOrdGmv1d'],
  });

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '' || value === '-') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function numberOrZero(value) {
    return numberValue(value) === null ? 0 : numberValue(value);
  }

  function ratio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  }

  function starMetricValue(value, target, source) {
    for (const key of [source].concat(STAR_METRIC_ALIASES[target] || [], target)) {
      if (value[key] !== undefined) return value[key];
    }
    return undefined;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const slash = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
    if (slash) return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  function canonicalShanghaiDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{8}$/.test(text)) {
      return canonicalDate(text);
    }
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return canonicalDate(value);
    return new Date(instant.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function cleanIdentifier(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !['-', '--', '—'].includes(text) ? text : null;
  }

  function normalizedSamplingRatio(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[%\s]/g, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized > 0 && normalized <= 1 ? normalized : null;
  }

  function normalizedRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[,，%\s]/g, ''));
    if (!Number.isFinite(number) || number < 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized >= 0 && normalized <= 1 ? normalized : null;
  }

  function normalizePgySpus(value) {
    const source = array(value);
    const seen = new Set();
    return source.map((item) => {
      const safe = isObject(item) ? item : {};
      const id = cleanIdentifier(safe.id ?? safe.spuId ?? safe.spuCode ?? safe.spuNo);
      const name = cleanIdentifier(safe.name ?? safe.spuName ?? safe.spuTitle ?? safe.title);
      return id || name ? { id: id || name, name: name || id } : null;
    }).filter((item) => {
      if (!item) return false;
      const key = `${item.id}\u0000${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function compactPgySearchKeywordEvidence(value) {
    const source = isObject(value) ? value : {};
    const hasKeywords = Object.prototype.hasOwnProperty.call(source, 'searchKeywords');
    const hasStatus = Object.prototype.hasOwnProperty.call(source, 'searchKeywordFetchStatus');
    const hasErrorCode = Object.prototype.hasOwnProperty.call(source, 'searchKeywordErrorCode');
    if (!hasKeywords && !hasStatus && !hasErrorCode) return {};
    const searchKeywords = array(source.searchKeywords).map((item) => {
      const row = isObject(item) ? item : {};
      const keyword = cleanIdentifier(row.keyword);
      if (!keyword) return null;
      const rawSearchScore = numberValue(row.searchScore);
      const rawImpressions = numberValue(row.impressions);
      const rawReads = numberValue(row.reads);
      return {
        keyword,
        ...(rawSearchScore !== null && rawSearchScore >= 0
          ? { searchScore: rawSearchScore }
          : {}),
        impressions: rawImpressions !== null && rawImpressions >= 0 ? rawImpressions : null,
        reads: rawReads !== null && rawReads >= 0 ? rawReads : null,
        clickRate: normalizedRate(row.clickRate),
      };
    }).filter(Boolean);
    const requestedStatus = String(source.searchKeywordFetchStatus || '');
    const searchKeywordFetchStatus = ['complete', 'empty', 'failed'].includes(requestedStatus)
      ? requestedStatus
      : searchKeywords.length ? 'complete' : 'empty';
    const errorCode = cleanIdentifier(source.searchKeywordErrorCode);
    const searchKeywordErrorCode = errorCode && /^[A-Za-z0-9_:-]{1,128}$/.test(errorCode)
      ? errorCode
      : null;
    return Object.assign(
      { searchKeywords, searchKeywordFetchStatus },
      searchKeywordFetchStatus === 'failed' && searchKeywordErrorCode
        ? { searchKeywordErrorCode }
        : {}
    );
  }

  function normalizedRange(value) {
    const range = isObject(value) ? value : {};
    const from = canonicalDate(range.from);
    const to = canonicalDate(range.to);
    return { from, to };
  }

  function dateInRange(value, rangeValue) {
    const date = canonicalDate(value);
    const range = normalizedRange(rangeValue);
    if (!date || !range.from || !range.to || range.from > range.to) return false;
    return date >= range.from && date <= range.to;
  }

  function monthsInRange(rangeValue) {
    const range = normalizedRange(rangeValue);
    if (!range.from || !range.to || range.from > range.to) return [];
    const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
    const end = `${range.to.slice(0, 7)}`;
    const months = [];
    while (!Number.isNaN(cursor.getTime())) {
      const month = cursor.toISOString().slice(0, 7);
      months.push(month);
      if (month === end) break;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      if (months.length > 240) break;
    }
    return months;
  }

  function mergeIntervals(values) {
    const valid = array(values)
      .map((value) => ({ start: canonicalDate(value.start), end: canonicalDate(value.end) }))
      .filter((value) => value.start && value.end && value.start <= value.end)
      .sort((left, right) => left.start.localeCompare(right.start));
    const merged = [];
    for (const interval of valid) {
      const previous = merged[merged.length - 1];
      if (!previous) {
        merged.push({ ...interval });
        continue;
      }
      const dayAfter = new Date(`${previous.end}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      if (interval.start <= dayAfter.toISOString().slice(0, 10)) {
        if (interval.end > previous.end) previous.end = interval.end;
      } else {
        merged.push({ ...interval });
      }
    }
    return merged;
  }

  function unique(values) {
    return [...new Set(array(values).filter((value) => value !== null && value !== undefined && value !== '')
      .map(String))];
  }

  function noteIdOf(value) {
    const row = isObject(value) ? value : {};
    return row.noteId || row.contentId || row.dimensions && row.dimensions.noteId || null;
  }

  function normalizePgy(collection) {
    const notes = new Map();
    for (const row of array(collection && collection.notes)) {
      const rawId = noteIdOf(row);
      if (!rawId) continue;
      const noteId = String(rawId);
      if (!notes.has(noteId)) {
        notes.set(noteId, {
          noteId,
          title: row.title || row.noteTitle || null,
          author: isObject(row.author)
            ? {
              id: row.author.id || null,
              name: row.author.name || null,
              followerCount: numberValue(row.author.followerCount),
            }
            : {
              id: row.kolId || null,
              name: row.author || row.kolNickName || null,
              followerCount: numberValue(row.kolFanNum),
            },
          publishDate: canonicalDate(row.publishDate || row.notePublishTime),
          cooperationCost: 0,
          platformFee: 0,
          metrics: {
            impressions: null,
            reads: null,
            interactions: null,
            taobaoOffsiteActiveUv15d: null,
            taobaoOffsiteActiveCost15d: null,
            taobaoDealUv15d: null,
            taobaoAddCartUv15d: null,
            taobaoAddCartRate15d: null,
            taobaoPurchaseRate15d: null,
          },
          sourceCount: 0,
          taskIntervals: [],
          taobaoTaskId: null,
          taskEndDate: null,
          spus: [],
          spuName: null,
          crossDomainProjectName: null,
          taobaoSamplingRatio: null,
          noteUrl: null,
        });
      }
      const note = notes.get(noteId);
      const costs = isObject(row.costs) ? row.costs : {};
      const actual = numberValue(costs.cooperation !== undefined ? costs.cooperation : row.actualConsume);
      const fallback = Math.max(0, numberOrZero(row.totalConsume) - numberOrZero(row.refundAmount));
      note.cooperationCost += actual === null ? fallback : actual;
      note.platformFee += numberOrZero(costs.platformFee !== undefined ? costs.platformFee : row.totalPlatformPrice);
      const metrics = isObject(row.metrics) ? row.metrics : row;
      for (const [target, candidates] of Object.entries({
        impressions: ['impressions', 'impNum'],
        reads: ['reads', 'readNum'],
        interactions: ['interactions', 'engageNum'],
        taobaoOffsiteActiveUv15d: ['taobaoOffsiteActiveUv15d', 'intoStoreUv', 'thirdTaobaoActivePgyUserNum'],
        taobaoOffsiteActiveCost15d: ['taobaoOffsiteActiveCost15d', 'intoStoreCost', 'thirdTaobaoActivePgyUserCost'],
        taobaoDealUv15d: ['taobaoDealUv15d', 'taobaoDealUv'],
        taobaoAddCartUv15d: ['taobaoAddCartUv15d', 'taobaoAddCartUv'],
        taobaoAddCartRate15d: ['taobaoAddCartRate15d', 'taobaoAddCartRatio'],
        taobaoPurchaseRate15d: ['taobaoPurchaseRate15d', 'taobaoDealRatio'],
      })) {
        for (const key of candidates) {
          const value = numberValue(metrics[key]);
          if (value !== null) note.metrics[target] = Math.max(note.metrics[target] ?? value, value);
        }
      }
      const taskStart = canonicalDate(row.taskStartTime || row.task && row.task.start);
      const taskEnd = canonicalDate(
        row.taskEndDate || row.taskEndTime || row.task && row.task.end
      );
      if (taskStart && taskEnd) note.taskIntervals.push({ start: taskStart, end: taskEnd });
      const taobaoTaskId = cleanIdentifier(row.taobaoTaskId);
      if (!note.taobaoTaskId && taobaoTaskId) note.taobaoTaskId = taobaoTaskId;
      if (!note.taskEndDate && taskEnd) note.taskEndDate = taskEnd;
      const spuName = cleanIdentifier(row.spuName);
      if (!note.spuName && spuName) note.spuName = spuName;
      const crossDomainProjectName = cleanIdentifier(
        row.crossDomainProjectName !== undefined ? row.crossDomainProjectName : row.thirdProjectName
      );
      if (!note.crossDomainProjectName && crossDomainProjectName) {
        note.crossDomainProjectName = crossDomainProjectName;
      }
      const samplingRatio = normalizedSamplingRatio(
        row.taobaoSamplingRatio !== undefined
          ? row.taobaoSamplingRatio
          : isObject(row.starData) ? row.starData.dataTransRatio : row.dataTransRatio
      );
      if (note.taobaoSamplingRatio === null && samplingRatio !== null) {
        note.taobaoSamplingRatio = samplingRatio;
      }
      const mergedSpus = normalizePgySpus(
        array(row.spus).length ? row.spus : (row.spuList || [row.spu || row.spuInfo || {
          spuId: row.spuId ?? row.spuCode ?? row.spuNo,
          spuName: row.spuName ?? row.spuTitle,
        }])
      );
      for (const spu of mergedSpus) {
        if (!note.spus.some((item) => item.id === spu.id && item.name === spu.name)) note.spus.push(spu);
      }
      note.sourceCount += 1;
      if (!note.title && (row.title || row.noteTitle)) note.title = row.title || row.noteTitle;
      if (!note.noteUrl && row.noteUrl) note.noteUrl = String(row.noteUrl);
      if (!note.publishDate) note.publishDate = canonicalDate(row.publishDate || row.notePublishTime);
      const rowFollowerCount = numberValue(
        isObject(row.author) ? row.author.followerCount : row.kolFanNum
      );
      if (rowFollowerCount !== null) {
        note.author.followerCount = Math.max(note.author.followerCount ?? rowFollowerCount, rowFollowerCount);
      }
    }
    for (const note of notes.values()) {
      note.metrics.readRate = ratio(note.metrics.reads, note.metrics.impressions);
      note.metrics.engagementRate = ratio(note.metrics.interactions, note.metrics.reads);
      note.taskIntervals = mergeIntervals(note.taskIntervals);
    }
    return notes;
  }

  function compactPgyFacts(collection) {
    return array(collection && collection.notes).map((row) => {
      const source = isObject(row) ? row : {};
      const noteId = String(noteIdOf(source) || '').trim();
      const author = isObject(source.author) ? source.author : {};
      const costs = isObject(source.costs) ? source.costs : {};
      const metrics = isObject(source.metrics) ? source.metrics : source;
      const cooperation = numberOrZero(
        costs.cooperation !== undefined ? costs.cooperation : source.actualConsume
      );
      const platformFee = numberOrZero(
        costs.platformFee !== undefined ? costs.platformFee : source.totalPlatformPrice
      );
      const fact = {
        noteId,
        sourceKey: String(source.sourceKey || source.bizId || noteId),
        title: source.title == null ? String(source.noteTitle || '') : String(source.title),
        noteUrl: source.noteUrl == null ? null : String(source.noteUrl),
        publishDate: canonicalDate(source.publishDate || source.notePublishTime),
        spuName: cleanIdentifier(source.spuName),
        crossDomainProjectName: cleanIdentifier(
          source.crossDomainProjectName !== undefined
            ? source.crossDomainProjectName
            : source.thirdProjectName
        ),
        taobaoSamplingRatio: normalizedSamplingRatio(
          source.taobaoSamplingRatio !== undefined
            ? source.taobaoSamplingRatio
            : isObject(source.starData) ? source.starData.dataTransRatio : source.dataTransRatio
        ),
        spus: normalizePgySpus(
          array(source.spus).length ? source.spus : (source.spuList || [source.spu || source.spuInfo || {
            spuId: source.spuId ?? source.spuCode ?? source.spuNo,
            spuName: source.spuName ?? source.spuTitle,
          }])
        ),
        taobaoTaskId: cleanIdentifier(source.taobaoTaskId),
        taskEndDate: canonicalDate(source.taskEndDate || source.taskEndTime),
        author: {
          id: author.id == null
            ? (source.kolId == null ? null : String(source.kolId))
            : String(author.id),
          name: author.name == null
            ? (source.kolNickName == null ? null : String(source.kolNickName))
            : String(author.name),
          followerCount: numberValue(
            author.followerCount !== undefined ? author.followerCount : source.kolFanNum
          ),
        },
        costs: {
          cooperation,
          platformFee,
          total: numberValue(costs.total) === null
            ? cooperation + platformFee
            : numberValue(costs.total),
        },
        metrics: {
          impressions: numberOrZero(
            metrics.impressions !== undefined ? metrics.impressions : metrics.impNum
          ),
          reads: numberOrZero(metrics.reads !== undefined ? metrics.reads : metrics.readNum),
          interactions: numberOrZero(
            metrics.interactions !== undefined ? metrics.interactions : metrics.engageNum
          ),
          taobaoOffsiteActiveUv15d: numberValue(
            metrics.taobaoOffsiteActiveUv15d !== undefined
              ? metrics.taobaoOffsiteActiveUv15d
              : metrics.intoStoreUv !== undefined
                ? metrics.intoStoreUv
                : metrics.thirdTaobaoActivePgyUserNum
          ),
          taobaoOffsiteActiveCost15d: numberValue(
            metrics.taobaoOffsiteActiveCost15d !== undefined
              ? metrics.taobaoOffsiteActiveCost15d
              : metrics.intoStoreCost !== undefined
                ? metrics.intoStoreCost
                : metrics.thirdTaobaoActivePgyUserCost
          ),
          taobaoDealUv15d: numberValue(
            metrics.taobaoDealUv15d !== undefined ? metrics.taobaoDealUv15d : metrics.taobaoDealUv
          ),
          taobaoAddCartUv15d: numberValue(
            metrics.taobaoAddCartUv15d !== undefined
              ? metrics.taobaoAddCartUv15d
              : metrics.taobaoAddCartUv
          ),
          taobaoAddCartRate15d: numberValue(
            metrics.taobaoAddCartRate15d !== undefined
              ? metrics.taobaoAddCartRate15d
              : metrics.taobaoAddCartRatio
          ),
          taobaoPurchaseRate15d: numberValue(
            metrics.taobaoPurchaseRate15d !== undefined
              ? metrics.taobaoPurchaseRate15d
              : metrics.taobaoDealRatio
          ),
        },
      };
      return Object.assign(fact, compactPgySearchKeywordEvidence(source));
    }).filter((fact) => fact.noteId);
  }

  const PGY_FOLLOWER_TIERS = Object.freeze([
    Object.freeze({ key: '1k_5k', label: '1K-5K', min: 1000, max: 5000 }),
    Object.freeze({ key: '5k_10k', label: '5K-1W', min: 5000, max: 10000 }),
    Object.freeze({ key: '10k_100k', label: '1W-10W', min: 10000, max: 100000 }),
    Object.freeze({ key: '100k_500k', label: '10W-50W', min: 100000, max: 500000 }),
    Object.freeze({ key: '500k_plus', label: '50W+', min: 500000, max: Infinity }),
  ]);

  function selectPgyPeriod(pgyByNote, rangeValue) {
    const selected = new Map();
    let invalidPublishDate = 0;
    let outsideRange = 0;
    for (const [noteId, note] of pgyByNote) {
      if (!note.publishDate) {
        invalidPublishDate += 1;
        continue;
      }
      if (!dateInRange(note.publishDate, rangeValue)) {
        outsideRange += 1;
        continue;
      }
      selected.set(noteId, note);
    }
    return { selected, invalidPublishDate, outsideRange };
  }

  function pgyPeriodSummary(selection, rangeValue, asOfValue) {
    const notes = [...selection.selected.values()];
    const costs = notes.reduce((result, note) => {
      result.cooperation += numberOrZero(note.cooperationCost);
      result.platformFee += numberOrZero(note.platformFee);
      result.total = result.cooperation + result.platformFee;
      return result;
    }, { cooperation: 0, platformFee: 0, total: 0 });
    const metrics = notes.reduce((result, note) => {
      result.impressions += numberOrZero(note.metrics && note.metrics.impressions);
      result.reads += numberOrZero(note.metrics && note.metrics.reads);
      result.interactions += numberOrZero(note.metrics && note.metrics.interactions);
      return result;
    }, { impressions: 0, reads: 0, interactions: 0 });
    metrics.readRate = ratio(metrics.reads, metrics.impressions);
    metrics.engagementRate = ratio(metrics.interactions, metrics.reads);
    const taobao15d = notes.reduce((result, note) => {
      const values = isObject(note.metrics) ? note.metrics : {};
      const sampling = normalizedSamplingRatio(note.taobaoSamplingRatio);
      const activeUv = numberValue(values.taobaoOffsiteActiveUv15d);
      const dealUv = numberValue(values.taobaoDealUv15d);
      const addCartUv = numberValue(values.taobaoAddCartUv15d);
      result.offsiteActiveUv += numberOrZero(activeUv);
      result.dealUv += numberOrZero(dealUv);
      result.addCartUv += numberOrZero(addCartUv);
      if (sampling !== null) {
        if (activeUv !== null) {
          const adjustedActive = activeUv / sampling;
          result.adjustedActiveUv += adjustedActive;
          const activeCost = numberValue(values.taobaoOffsiteActiveCost15d);
          if (activeCost !== null) result.activeCostNumerator += activeCost * adjustedActive;
          else result.activeCostComplete = false;
        }
        if (dealUv !== null) result.adjustedDealUv += dealUv / sampling;
        if (addCartUv !== null) result.adjustedAddCartUv += addCartUv / sampling;
      } else if (activeUv !== null || dealUv !== null || addCartUv !== null) {
        result.samplingComplete = false;
      }
      return result;
    }, {
      offsiteActiveUv: 0,
      dealUv: 0,
      addCartUv: 0,
      adjustedActiveUv: 0,
      adjustedDealUv: 0,
      adjustedAddCartUv: 0,
      activeCostNumerator: 0,
      activeCostComplete: true,
      samplingComplete: true,
    });
    taobao15d.offsiteActiveCost = taobao15d.samplingComplete && taobao15d.activeCostComplete
      ? ratio(taobao15d.activeCostNumerator, taobao15d.adjustedActiveUv)
      : null;
    taobao15d.addCartRate = taobao15d.samplingComplete
      ? ratio(taobao15d.adjustedAddCartUv, metrics.reads)
      : null;
    taobao15d.purchaseRate = taobao15d.samplingComplete
      ? ratio(taobao15d.adjustedDealUv, metrics.reads)
      : null;
    delete taobao15d.adjustedActiveUv;
    delete taobao15d.adjustedDealUv;
    delete taobao15d.adjustedAddCartUv;
    delete taobao15d.activeCostNumerator;
    delete taobao15d.activeCostComplete;
    delete taobao15d.samplingComplete;

    const monthCounts = new Map(monthsInRange(rangeValue).map((month) => [month, 0]));
    for (const note of notes) {
      const month = String(note.publishDate || '').slice(0, 7);
      if (monthCounts.has(month)) monthCounts.set(month, monthCounts.get(month) + 1);
    }
    const tierState = new Map(PGY_FOLLOWER_TIERS.map((tier) => [tier.key, {
      ...tier, noteCount: 0, authorKeys: new Set(), cooperationCost: 0,
    }]));
    const excluded = {
      below1k: { noteCount: 0, authorKeys: new Set() },
      unknown: { noteCount: 0, authorKeys: new Set() },
    };
    for (const note of notes) {
      const followerCount = numberValue(note.author && note.author.followerCount);
      const authorKey = String(
        note.author && (note.author.id || note.author.name) || `note:${note.noteId}`
      );
      if (followerCount === null) {
        excluded.unknown.noteCount += 1;
        excluded.unknown.authorKeys.add(authorKey);
        continue;
      }
      if (followerCount < 1000) {
        excluded.below1k.noteCount += 1;
        excluded.below1k.authorKeys.add(authorKey);
        continue;
      }
      const tier = PGY_FOLLOWER_TIERS.find((item) => (
        followerCount >= item.min && followerCount < item.max
      ));
      if (!tier) continue;
      const state = tierState.get(tier.key);
      state.noteCount += 1;
      state.authorKeys.add(authorKey);
      state.cooperationCost += numberOrZero(note.cooperationCost);
    }
    const followerTiers = PGY_FOLLOWER_TIERS.map((tier) => {
      const state = tierState.get(tier.key);
      return {
        key: tier.key,
        label: tier.label,
        noteCount: state.noteCount,
        authorCount: state.authorKeys.size,
        cooperationCost: state.cooperationCost,
        averageCooperationCost: ratio(state.cooperationCost, state.noteCount),
      };
    });
    const asOf = canonicalDate(asOfValue);
    return {
      noteCount: notes.length,
      reportedNoteCount: notes.length,
      starTaskNoteCount: notes.reduce((count, note) => (
        count + (cleanIdentifier(note.taobaoTaskId) ? 1 : 0)
      ), 0),
      overdueNoteCount: asOf
        ? notes.reduce((count, note) => {
          const taskEndDate = canonicalDate(note.taskEndDate);
          return count + (taskEndDate && asOf > taskEndDate ? 1 : 0);
        }, 0)
        : null,
      costs,
      metrics,
      taobao15d,
      monthly: [...monthCounts.entries()].map(([month, noteCount]) => ({ month, noteCount })),
      followerTiers,
      followerTierExcluded: {
        below1k: {
          noteCount: excluded.below1k.noteCount,
          authorCount: excluded.below1k.authorKeys.size,
        },
        unknown: {
          noteCount: excluded.unknown.noteCount,
          authorCount: excluded.unknown.authorKeys.size,
        },
      },
      excluded: {
        invalidPublishDate: selection.invalidPublishDate,
        outsideRange: selection.outsideRange,
      },
    };
  }

  function hasStarMetric(row) {
    if (!isObject(row)) return false;
    return Object.entries(STAR_METRIC_MAP).some(([target, source]) => (
      numberValue(starMetricValue(row, target, source)) !== null
    ));
  }

  function buildTaskIndex(adstar, pgyByNote, rangeValue) {
    const orders = array(adstar && adstar.lists && adstar.lists.orders && adstar.lists.orders.items);
    const orderMap = new Map();
    for (const order of orders) {
      const id = order.orderId || order.id || order.buyOrderId;
      if (!id) continue;
      orderMap.set(String(id), {
        id: String(id),
        projectId: order.projectId == null ? null : String(order.projectId),
        start: canonicalDate(order.startTime || order.startDate),
        end: canonicalDate(order.endTime || order.endDate),
      });
    }
    const mutable = new Map();
    function entry(noteId) {
      const id = String(noteId);
      if (!mutable.has(id)) {
        mutable.set(id, {
          noteId: id,
          intervals: [],
          pgyIntervals: [],
          orderIds: new Set(),
          reportOrderIds: new Set(),
          projectIds: new Set(),
          relations: [],
        });
      }
      return mutable.get(id);
    }
    for (const row of array(adstar && adstar.contentRows)) {
      const noteId = noteIdOf(row);
      const date = canonicalDate(row.theDate || row.ds || row.date);
      if (!noteId || !dateInRange(date, rangeValue)) continue;
      const current = entry(noteId);
      const orderId = row.listOrderId == null ? null : String(row.listOrderId);
      const rawReportOrderId = orderId ? null : row.reportOrderId || row.orderId;
      const reportOrderId = rawReportOrderId == null ? null : String(rawReportOrderId);
      const order = orderId ? orderMap.get(orderId) : null;
      const rawProjectId = row.projectId != null ? row.projectId : order && order.projectId;
      const projectId = rawProjectId == null ? null : String(rawProjectId);
      if (orderId) current.orderIds.add(orderId);
      if (reportOrderId) current.reportOrderIds.add(reportOrderId);
      if (projectId) current.projectIds.add(projectId);
      if (order && order.start && order.end) current.intervals.push({ start: order.start, end: order.end });
      current.relations.push({
        source: 'adstar',
        identityKind: orderId ? 'business_order' : 'project_report_order',
        orderId,
        reportOrderId,
        projectId,
        start: order && order.start || null,
        end: order && order.end || null,
      });
    }
    for (const [noteId, pgy] of pgyByNote) {
      if (!pgy.taskIntervals.length) continue;
      const current = mutable.get(String(noteId));
      if (!current || current.intervals.length) continue;
      for (const interval of pgy.taskIntervals) {
        current.pgyIntervals.push(interval);
        current.relations.push({
          source: 'pgy_task_metadata',
          classificationEligible: false,
          orderId: null,
          reportOrderId: null,
          projectId: null,
          ...interval,
        });
      }
    }
    const result = new Map();
    for (const [noteId, value] of mutable) {
      result.set(noteId, {
        noteId,
        intervals: mergeIntervals(value.intervals),
        pgyIntervals: mergeIntervals(value.pgyIntervals),
        orderIds: [...value.orderIds],
        reportOrderIds: [...value.reportOrderIds],
        projectIds: [...value.projectIds],
        relationCount: value.relations.length,
        relationSources: unique(value.relations.map((relation) => relation && relation.source)),
      });
    }
    return result;
  }

  function taskStatus(noteId, date, taskIndex, starCoverageComplete = true) {
    if (!date) return 'unknown';
    const task = taskIndex.get(String(noteId));
    if (!task) return starCoverageComplete ? 'no_task' : 'unknown';
    if (!task.intervals.length) return 'unknown';
    if (task.intervals.some((interval) => date >= interval.start && date <= interval.end)) {
      return 'in_task';
    }
    return starCoverageComplete ? 'out_of_task' : 'unknown';
  }

  function normalizeStarMetrics(value) {
    if (!isObject(value)) return null;
    const metrics = {};
    for (const [target, source] of Object.entries(STAR_METRIC_MAP)) {
      metrics[target] = numberValue(starMetricValue(value, target, source));
    }
    metrics.contentEngagementRate = ratio(metrics.engagementUv, metrics.readUv) ??
      numberValue(value.contentEngagementRate);
    metrics.platformVisitRate = numberValue(
      value.drainRate !== undefined ? value.drainRate : value.visitRate
    );
    metrics.visitRate = ratio(metrics.storeVisitUv, metrics.readUv) ?? metrics.platformVisitRate;
    metrics.addCartRate = ratio(metrics.cartUv, metrics.storeVisitUv) ?? numberValue(
      value.addCartRate !== undefined ? value.addCartRate : value.cartRate
    );
    metrics.conversionRate = ratio(metrics.orderUv, metrics.storeVisitUv) ??
      numberValue(value.conversionRate);
    return metrics;
  }

  function normalizeStarNotes(adstar, taskIndex, rangeValue) {
    const byDay = new Map();
    for (const row of array(adstar && adstar.contentRows)) {
      const rawId = noteIdOf(row);
      if (!rawId) continue;
      const noteId = String(rawId);
      const date = canonicalDate(row.theDate || row.ds || row.date);
      if (!dateInRange(date, rangeValue) || !hasStarMetric(row)) continue;
      const key = `${noteId}|${date || 'unknown'}`;
      if (!byDay.has(key)) {
        byDay.set(key, {
          noteId,
          date,
          orderIds: new Set(),
          reportOrderIds: new Set(),
          projectIds: new Set(),
          rowCount: 0,
          metrics: Object.fromEntries(Object.keys(STAR_METRIC_MAP).map((name) => [name, null])),
        });
      }
      const daily = byDay.get(key);
      const orderId = row.listOrderId;
      const reportOrderId = orderId == null ? row.reportOrderId || row.orderId : null;
      if (orderId != null) daily.orderIds.add(String(orderId));
      if (reportOrderId != null) daily.reportOrderIds.add(String(reportOrderId));
      if (row.projectId != null) daily.projectIds.add(String(row.projectId));
      daily.rowCount += 1;
      for (const [target, source] of Object.entries(STAR_METRIC_MAP)) {
        const value = numberValue(starMetricValue(row, target, source));
        if (value !== null) daily.metrics[target] = Math.max(daily.metrics[target] ?? value, value);
      }
    }
    const daily = [...byDay.values()].map((row) => ({
      noteId: row.noteId,
      date: row.date,
      taskStatus: taskStatus(row.noteId, row.date, taskIndex),
      orderIds: [...row.orderIds],
      reportOrderIds: [...row.reportOrderIds],
      projectIds: [...row.projectIds],
      rowCount: row.rowCount,
      metrics: Object.assign({}, row.metrics, {
        contentEngagementRate: ratio(row.metrics.engagementUv, row.metrics.readUv),
      }),
    }));
    const byNote = new Map();
    for (const row of daily) {
      if (!byNote.has(row.noteId)) {
        byNote.set(row.noteId, {
          noteId: row.noteId,
          dates: 0,
          orderIds: new Set(),
          reportOrderIds: new Set(),
          projectIds: new Set(),
          metrics: Object.fromEntries(Object.keys(STAR_METRIC_MAP).map((name) => [name, null])),
        });
      }
      const note = byNote.get(row.noteId);
      note.dates += 1;
      row.orderIds.forEach((id) => note.orderIds.add(id));
      row.reportOrderIds.forEach((id) => note.reportOrderIds.add(id));
      row.projectIds.forEach((id) => note.projectIds.add(id));
      for (const name of Object.keys(STAR_METRIC_MAP)) {
        const value = numberValue(row.metrics[name]);
        if (value !== null) note.metrics[name] = (note.metrics[name] ?? 0) + value;
      }
    }
    for (const note of byNote.values()) {
      note.orderIds = [...note.orderIds];
      note.reportOrderIds = [...note.reportOrderIds];
      note.projectIds = [...note.projectIds];
      note.metrics.contentEngagementRate = ratio(note.metrics.engagementUv, note.metrics.readUv);
      note.metrics.visitRate = ratio(note.metrics.storeVisitUv, note.metrics.readUv);
    }
    return { daily, byNote };
  }

  function marketingObjective(value, row) {
    const label = value == null ? '' : String(isObject(value) ? value.name || value.label || '' : value);
    const compact = label.toLowerCase().replace(/[\s_-]/g, '');
    if (label === '13' || compact.includes('直达') || compact.includes('direct')) return 'direct';
    if (label === '4' || compact.includes('种草') || compact.includes('seeding')) return 'product_seeding';
    const metrics = isObject(row.metrics) ? row.metrics : row;
    if (numberOrZero(metrics.externalGoodsOrder15) > 0 || numberOrZero(metrics.externalRgmv15) > 0) return 'direct';
    return 'unknown';
  }

  function normalizeJuguang(juguang, taskIndex, rangeValue, starCoverageComplete) {
    const rows = [];
    for (const unit of array(juguang && juguang.accounts)) {
      const account = isObject(unit.account) ? unit.account : {};
      const accountMetrics = isObject(unit.accountSummary && unit.accountSummary.metrics)
        ? unit.accountSummary.metrics : {};
      const accountPlatformRoi15 = numberValue(accountMetrics.externalRoi15);
      const sourceRows = array(unit.dailyRows).length ? unit.dailyRows : array(unit.summaryRows);
      for (const row of sourceRows) {
        const rawId = noteIdOf(row);
        if (!rawId) continue;
        const dimensions = isObject(row.dimensions) ? row.dimensions : {};
        const metrics = isObject(row.metrics) ? row.metrics : row;
        const noteId = String(rawId);
        const date = canonicalDate(dimensions.time || row.time || row.date);
        if (!dateInRange(date, rangeValue)) continue;
        const objective = marketingObjective(
          dimensions.marketingTarget !== undefined ? dimensions.marketingTarget : row.marketingTarget,
          row
        );
        const direct = objective === 'direct';
        const storeVisits15 = numberValue(metrics.outClickEnterStoreCnt15d);
        const orders15 = numberValue(metrics.externalGoodsOrder15);
        const gmv15 = numberValue(metrics.externalRgmv15);
        const conversionObservable = direct && [storeVisits15, orders15, gmv15]
          .every((value) => value !== null);
        const productSeeding = objective === 'product_seeding';
        const seedingExternalActiveUv15 = numberValue(metrics.outSideSellerPv15d);
        const seedingExternalPlatformRate15 = numberValue(metrics.outSideSellerPvRate15dNew);
        const seedingExternalPlatformCost15 = numberValue(metrics.outSideSellerPvfee15d);
        const seedingExternalObservable = productSeeding && [
          seedingExternalActiveUv15,
          seedingExternalPlatformRate15,
          seedingExternalPlatformCost15,
        ].every((value) => value !== null);
        rows.push({
          noteId,
          date,
          accountId: String(row.accountId || account.vSellerId || `advertiser-${account.advertiserId}`),
          accountName: account.name || null,
          accountType: account.accountType == null ? null : account.accountType,
          accountPlatformRoi15,
          marketingObjective: objective,
          placementType: dimensions.placementType !== undefined
            ? dimensions.placementType
            : row.placementType !== undefined
              ? row.placementType
              : null,
          deliveryMode: dimensions.deliveryMode !== undefined ? dimensions.deliveryMode : row.deliveryMode,
          taskStatus: taskStatus(noteId, date, taskIndex, starCoverageComplete),
          spend: numberOrZero(metrics.fee),
          impressions: numberOrZero(metrics.impression),
          clicks: numberOrZero(metrics.click),
          interactions: numberOrZero(metrics.interaction),
          seedUsers: numberOrZero(metrics.iUserNum),
          deepSeedUsers: numberOrZero(metrics.tiUserNum),
          conversion: {
            observable: conversionObservable,
            storeVisits: conversionObservable ? storeVisits15 : null,
            orders: conversionObservable ? orders15 : null,
            gmv: conversionObservable ? gmv15 : null,
            platformRoi15: direct ? numberValue(metrics.externalRoi15) : null,
          },
          seedingExternal15: {
            observable: seedingExternalObservable,
            activeUv: productSeeding ? seedingExternalActiveUv15 : null,
            platformRate: productSeeding ? seedingExternalPlatformRate15 : null,
            platformCost: productSeeding ? seedingExternalPlatformCost15 : null,
          },
        });
      }
    }
    return rows;
  }

  function summarizeJuguang(rows) {
    const summary = {
      rows: rows.length,
      noteCount: new Set(rows.map((row) => row.noteId)).size,
      spend: 0,
      impressions: 0,
      clicks: 0,
      interactions: 0,
      seedUsers: 0,
      deepSeedUsers: 0,
      directSpend: 0,
      storeVisits: null,
      orders: null,
      gmv: null,
    };
    let unobservableDirectRows = 0;
    for (const row of rows) {
      summary.spend += row.spend;
      summary.impressions += row.impressions;
      summary.clicks += row.clicks;
      summary.interactions += row.interactions;
      summary.seedUsers += row.seedUsers;
      summary.deepSeedUsers += row.deepSeedUsers;
      if (row.marketingObjective !== 'direct') continue;
      summary.directSpend += row.spend;
      if (row.conversion.observable) {
        summary.storeVisits = (summary.storeVisits ?? 0) + (row.conversion.storeVisits ?? 0);
        summary.orders = (summary.orders ?? 0) + (row.conversion.orders ?? 0);
        summary.gmv = (summary.gmv ?? 0) + (row.conversion.gmv ?? 0);
      } else {
        unobservableDirectRows += 1;
      }
    }
    if (unobservableDirectRows > 0) {
      summary.storeVisits = null;
      summary.orders = null;
      summary.gmv = null;
    }
    summary.roi = unobservableDirectRows > 0 ? null : ratio(summary.gmv, summary.directSpend);
    summary.calculatedRoi15 = summary.roi;
    return summary;
  }

  function groupJuguang(rows, keyBuilder) {
    const groups = new Map();
    for (const row of rows) {
      const key = String(keyBuilder(row));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key, values]) => ({ key, ...summarizeJuguang(values) }))
      .sort((left, right) => right.spend - left.spend);
  }

  function reportTaskStatus(value) {
    if (value === 'in_task') return 'in_task';
    if (value === 'out_of_task' || value === 'no_task') return 'outside_task';
    return 'unknown';
  }

  function taskObjectiveGroups(rows) {
    const groups = new Map();
    for (const row of rows) {
      const task = reportTaskStatus(row.taskStatus);
      const objective = ['direct', 'product_seeding'].includes(row.marketingObjective)
        ? row.marketingObjective : 'unknown';
      const key = `${task}\u0000${objective}`;
      if (!groups.has(key)) groups.set(key, { taskStatus: task, marketingObjective: objective, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].map((group) => ({
      taskStatus: group.taskStatus,
      marketingObjective: group.marketingObjective,
      ...summarizeJuguang(group.rows),
    })).sort((left, right) => right.spend - left.spend);
  }

  function accountJuguangGroups(rows) {
    return groupJuguang(rows, (row) => row.accountId).map((summary) => {
      const sourceRows = rows.filter((row) => String(row.accountId) === String(summary.key));
      const labels = unique(sourceRows.map((row) => row.accountName));
      const platformValues = unique(sourceRows.map((row) => row.accountPlatformRoi15)
        .filter((value) => numberValue(value) !== null));
      return {
        ...summary,
        label: labels[0] || String(summary.key),
        platformRoi15: platformValues.length === 1 ? numberValue(platformValues[0]) : null,
      };
    });
  }

  function maturity(publishDate, asOf) {
    if (!publishDate || !asOf) return 'unknown';
    const start = new Date(`${publishDate}T00:00:00Z`);
    const end = new Date(`${canonicalDate(asOf)}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 'unknown';
    const days = Math.floor((end - start) / 86400000);
    return days < 7 ? 'new' : days < 15 ? 'observing' : 'mature';
  }

  function emptyTask(noteId) {
    return {
      noteId,
      intervals: [],
      pgyIntervals: [],
      orderIds: [],
      reportOrderIds: [],
      projectIds: [],
      relationCount: 0,
      relationSources: [],
    };
  }

  function buildNotes(pgyByNote, periodPgyIds, juguangRows, starByNote, taskIndex, asOf, availability) {
    const known = isObject(availability) ? availability : {};
    const pgyAvailable = known.pgyAvailable === true;
    const pgyComplete = known.pgyComplete === true;
    const juguangAvailable = known.juguangAvailable === true;
    const juguangComplete = known.juguangComplete === true;
    const starCoverageComplete = known.starCoverageComplete === true;
    const adByNote = new Map();
    for (const row of juguangRows) {
      if (!adByNote.has(row.noteId)) adByNote.set(row.noteId, []);
      adByNote.get(row.noteId).push(row);
    }
    const notes = [];
    for (const noteId of starByNote.keys()) {
      const pgy = pgyByNote.get(noteId) || null;
      const task = taskIndex.get(noteId) || emptyTask(noteId);
      const adRows = adByNote.get(noteId) || [];
      const allAds = summarizeJuguang(adRows);
      const inTask = summarizeJuguang(adRows.filter((row) => row.taskStatus === 'in_task'));
      const outsideTask = summarizeJuguang(adRows.filter((row) => (
        ['out_of_task', 'no_task'].includes(row.taskStatus)
      )));
      const unknownTask = summarizeJuguang(adRows.filter((row) => row.taskStatus === 'unknown'));
      const outsideDirect = summarizeJuguang(adRows.filter((row) => (
        row.marketingObjective === 'direct' && ['out_of_task', 'no_task'].includes(row.taskStatus)
      )));
      const star = starByNote.get(noteId) || null;
      const pgyIncludedInPeriod = Boolean(pgy && periodPgyIds.has(noteId));
      const cooperation = pgyComplete ? (pgy ? pgy.cooperationCost : 0) : null;
      const platformFee = pgyComplete ? (pgy ? pgy.platformFee : 0) : null;
      const partnership = cooperation == null || platformFee == null
        ? null
        : cooperation + platformFee;
      const periodPartnership = pgyIncludedInPeriod ? partnership : 0;
      const alignmentComplete = starCoverageComplete && unknownTask.spend === 0;
      const alignedCost = pgyComplete && juguangComplete && alignmentComplete
        ? periodPartnership + inTask.spend
        : null;
      const publishDate = pgy && pgy.publishDate || null;
      notes.push({
        noteId,
        title: pgy && pgy.title || null,
        noteUrl: pgy && pgy.noteUrl || null,
        author: pgy && pgy.author || null,
        publishDate,
        maturity: maturity(publishDate, asOf),
        task,
        costs: {
          cooperation,
          platformFee,
          creatorTotal: partnership,
          juguang: juguangComplete ? allAds.spend : null,
          total: partnership == null || !juguangComplete ? null : partnership + allAds.spend,
          periodCreator: pgyComplete ? periodPartnership : null,
          periodTotal: pgyComplete && juguangComplete ? periodPartnership + allAds.spend : null,
          starTaskAligned: alignedCost,
          outsideTask: juguangComplete && alignmentComplete ? outsideTask.spend : null,
          outsideDirect: juguangComplete && starCoverageComplete ? outsideDirect.spend : null,
        },
        pgy: pgyAvailable && pgy ? {
          sourceCount: pgy.sourceCount,
          spuName: pgy.spuName,
          crossDomainProjectName: pgy.crossDomainProjectName,
          taobaoSamplingRatio: pgy.taobaoSamplingRatio,
          metrics: pgy.metrics,
          followerCount: pgy.author && pgy.author.followerCount,
          includedInPeriod: pgyIncludedInPeriod,
          coverage: pgyComplete ? 'complete' : 'partial',
          observedCosts: {
            cooperation: pgy.cooperationCost,
            platformFee: pgy.platformFee,
            total: pgy.cooperationCost + pgy.platformFee,
          },
        } : null,
        juguang: juguangAvailable ? {
          accountIds: unique(adRows.map((row) => row.accountId)),
          total: allAds,
          inTask,
          outsideTask,
          outsideDirect,
          objectives: groupJuguang(adRows, (row) => row.marketingObjective),
          taskStatuses: groupJuguang(adRows, (row) => row.taskStatus),
          coverage: juguangComplete ? 'complete' : 'partial',
          alignmentCoverage: alignmentComplete ? 'complete' : 'partial',
        } : null,
        star: star ? Object.assign({}, star, {
          roi: ratio(star.metrics.seededProductGmv, alignedCost),
        }) : null,
        results: {
          starTaskGmv: star ? star.metrics.seededProductGmv : null,
          starTaskRoi: star ? ratio(star.metrics.seededProductGmv, alignedCost) : null,
          outsideDirectGmv: juguangComplete && starCoverageComplete ? outsideDirect.gmv : null,
          outsideDirectRoi: juguangComplete && starCoverageComplete ? outsideDirect.roi : null,
        },
      });
    }
    return notes.sort((left, right) => numberOrZero(right.costs.total) - numberOrZero(left.costs.total));
  }

  function starLayers(adstar, joinedNotes, rangeValue) {
    const nested = array(adstar && adstar.nested);
    const excludedProjects = new Set(array(adstar && adstar.excluded && adstar.excluded.projects)
      .map((item) => item && (item.id || item.projectId)).filter(Boolean).map(String));
    const excludedOrders = new Set(array(adstar && adstar.excluded && adstar.excluded.orders)
      .map((item) => item && (item.id || item.orderId)).filter(Boolean).map(String));
    const projectItems = array(adstar && adstar.lists && adstar.lists.projects &&
      adstar.lists.projects.items).filter((project) => {
      const id = project && (project.projectId || project.id);
      return id != null && !excludedProjects.has(String(id));
    });
    const orderItems = array(adstar && adstar.lists && adstar.lists.orders && adstar.lists.orders.items)
      .filter((order) => {
        const id = order && (order.orderId || order.id || order.buyOrderId);
        const projectId = order && order.projectId;
        return id != null && !excludedOrders.has(String(id)) &&
          (projectId == null || !excludedProjects.has(String(projectId)));
      });
    const nestedProjects = new Map();
    const nestedOrders = new Map();

    function identifier(value) {
      const text = value == null ? '' : String(value).trim();
      return text || null;
    }

    for (const unit of nested) {
      const type = String(unit && unit.type || '');
      const id = identifier(unit && (
        unit.id || type === 'order' && unit.orderId || type === 'project' && unit.projectId
      ));
      if (!id) continue;
      if (type === 'project' && excludedProjects.has(id)) continue;
      if (type === 'order' && (excludedOrders.has(id) || (
        unit.projectId != null && excludedProjects.has(String(unit.projectId))
      ))) continue;
      if (type === 'project' && !nestedProjects.has(id)) nestedProjects.set(id, unit);
      if (type === 'order' && !nestedOrders.has(id)) nestedOrders.set(id, unit);
    }

    function nativeCoverage(unit) {
      return unit && String(unit.status || '') === 'complete' && isObject(unit.summary)
        ? 'complete'
        : 'partial';
    }

    function projectUnit(metadata, id) {
      const native = nestedProjects.get(id) || null;
      return {
        id,
        name: native && native.name || metadata.projectName || metadata.name || null,
        status: native
          ? String(native.status || 'partial')
          : String(metadata.projectStatusDesc || metadata.projectStatus || metadata.status || 'missing'),
        coverage: nativeCoverage(native),
        metrics: native && isObject(native.summary) ? normalizeStarMetrics(native.summary) : null,
        source: metadata.__nestedOnly ? 'nested' : 'project_list',
        businessIdentityVerified: !metadata.__nestedOnly,
        startDate: canonicalDate(metadata.startTime || metadata.startDate || native && (
          native.startTime || native.startDate
        )),
        endDate: canonicalDate(metadata.endTime || metadata.endDate || native && (
          native.endTime || native.endDate
        )),
      };
    }

    function orderUnit(metadata, id) {
      const native = nestedOrders.get(id) || null;
      const projectId = identifier(native && native.projectId) || identifier(metadata.projectId);
      return {
        id,
        name: native && native.name || metadata.orderName || metadata.name || null,
        projectId,
        status: native ? String(native.status || 'partial') : 'missing',
        coverage: nativeCoverage(native),
        metrics: native && isObject(native.summary) ? normalizeStarMetrics(native.summary) : null,
        source: metadata.__nestedOnly ? 'nested' : 'order_list',
        businessIdentityVerified: !metadata.__nestedOnly,
        reportOrderId: null,
        startDate: canonicalDate(metadata.startTime || metadata.startDate),
        endDate: canonicalDate(metadata.endTime || metadata.endDate),
        deliveryMode: metadata.normalizedDeliveryMode || metadata.deliveryModeDesc ||
          metadata.deliveryMode || null,
        orderStatus: metadata.orderStatusDesc || metadata.orderStatus || null,
      };
    }

    const projectUnits = [];
    const projectIds = new Set();
    for (const metadata of projectItems) {
      const id = identifier(metadata && (metadata.projectId || metadata.id));
      if (!id || projectIds.has(id)) continue;
      projectIds.add(id);
      projectUnits.push(projectUnit(metadata, id));
    }
    for (const [id, native] of nestedProjects) {
      if (projectIds.has(id)) continue;
      projectIds.add(id);
      projectUnits.push(projectUnit({
        __nestedOnly: true,
        projectName: native && native.name,
      }, id));
    }

    const orderUnits = [];
    const businessOrderIds = new Set();
    for (const metadata of orderItems) {
      const id = identifier(metadata && (metadata.orderId || metadata.id || metadata.buyOrderId));
      if (!id || businessOrderIds.has(id)) continue;
      businessOrderIds.add(id);
      orderUnits.push(orderUnit(metadata, id));
    }
    for (const [id, native] of nestedOrders) {
      if (businessOrderIds.has(id)) continue;
      businessOrderIds.add(id);
      orderUnits.push(orderUnit({
        __nestedOnly: true,
        orderName: native && native.name,
        projectId: native && native.projectId,
      }, id));
    }

    function usableRelationRow(row) {
      return dateInRange(row && (row.theDate || row.ds || row.date), rangeValue) &&
        hasStarMetric(row);
    }

    function relationContentKey(row) {
      const projectId = identifier(row && row.projectId) || '';
      const noteId = identifier(noteIdOf(row)) || '';
      const date = canonicalDate(row && (row.theDate || row.ds || row.date)) || '';
      return `${projectId}\u0000${noteId}\u0000${date}`;
    }

    const verifiedContentKeys = new Set(array(adstar && adstar.contentRows)
      .filter((row) => row && row.listOrderId != null && usableRelationRow(row))
      .map(relationContentKey));
    const reportOrderIds = new Set();
    for (const project of projectUnits) {
      const native = nestedProjects.get(project.id);
      const reportRows = array(native && native.details && native.details.order);
      for (const row of reportRows) {
        const reportOrderId = identifier(row && (row.reportOrderId || row.orderId));
        const noteId = identifier(noteIdOf(row));
        if (!reportOrderId || !noteId || !usableRelationRow(row) ||
          verifiedContentKeys.has(relationContentKey(row))) continue;
        const key = `${project.id}\u0000${reportOrderId}`;
        if (reportOrderIds.has(key)) continue;
        reportOrderIds.add(key);
        orderUnits.push({
          id: `project_report:${project.id}:${reportOrderId}`,
          name: row.orderName || '项目报表订单',
          projectId: project.id,
          status: 'unverified',
          coverage: 'partial',
          metrics: null,
          source: 'project_report',
          businessIdentityVerified: false,
          reportOrderId,
          startDate: null,
          endDate: null,
          deliveryMode: null,
          orderStatus: null,
        });
      }
    }

    const businessRelationCandidates = new Map();
    const reportRelationCandidates = new Map();
    function addRelationCandidate(target, relationId, order) {
      const id = identifier(relationId);
      if (!id) return;
      if (!target.has(id)) target.set(id, []);
      target.get(id).push(order);
    }
    for (const order of orderUnits) {
      if (order.businessIdentityVerified) {
        addRelationCandidate(businessRelationCandidates, order.id, order);
      } else if (order.source === 'project_report') {
        addRelationCandidate(reportRelationCandidates, order.reportOrderId, order);
      }
    }

    const notePlacements = new Map();
    const unassignedNotes = [];
    const ambiguousOrderIds = new Set();
    const unresolvedProjectIds = new Set();
    const coverageIssues = [];
    const rawBusinessNoteIds = new Map();
    const resolvedBusinessNoteIds = new Map();

    function addOrderNote(target, orderId, noteId) {
      const id = identifier(orderId);
      const note = identifier(noteId);
      if (!id || !note) return;
      if (!target.has(id)) target.set(id, new Set());
      target.get(id).add(note);
    }

    for (const row of array(adstar && adstar.contentRows)) {
      if (row && row.listOrderId != null && usableRelationRow(row)) {
        addOrderNote(rawBusinessNoteIds, row.listOrderId, noteIdOf(row));
      }
    }

    function orderSort(left, right) {
      const leftStart = left && left.startDate || '9999-12-31';
      const rightStart = right && right.startDate || '9999-12-31';
      return leftStart.localeCompare(rightStart) || String(left && left.id || '')
        .localeCompare(String(right && right.id || ''));
    }

    function hierarchyNoteCosts(note) {
      const noteCosts = isObject(note && note.costs) ? note.costs : {};
      const noteJuguang = isObject(note && note.juguang) ? note.juguang : {};
      const inTask = isObject(noteJuguang.inTask) ? noteJuguang.inTask : {};
      return {
        creator: numberValue(noteCosts.periodCreator),
        adInTask: numberValue(inTask.spend),
        total: numberValue(noteCosts.starTaskAligned),
      };
    }

    function compactUnassignedNote(note, projectIds, candidates, reason) {
      return {
        noteId: note && note.noteId == null ? null : String(note.noteId),
        title: note && note.title || null,
        noteUrl: note && note.noteUrl || null,
        publishDate: canonicalDate(note && note.publishDate),
        projectIds: projectIds.slice(),
        candidateOrderIds: candidates.map((candidate) => String(candidate.id)),
        reason,
        costs: hierarchyNoteCosts(note),
        includedInHierarchy: false,
      };
    }

    function compactHierarchyNote(note, order, candidates, rule) {
      const costs = order.businessIdentityVerified ? hierarchyNoteCosts(note) : null;
      return {
        noteId: String(note.noteId),
        title: note.title || null,
        noteUrl: note.noteUrl || null,
        publishDate: canonicalDate(note.publishDate),
        metrics: isObject(note.star && note.star.metrics) ? { ...note.star.metrics } : null,
        costs,
        ownership: {
          projectId: order.projectId == null ? null : String(order.projectId),
          orderId: String(order.id),
          candidateOrderIds: candidates.map((candidate) => String(candidate.id)),
          rule,
        },
      };
    }

    for (const note of array(joinedNotes)) {
      const taskOrderIds = array(note && note.task && note.task.orderIds).map(String);
      const taskReportOrderIds = array(note && note.task && note.task.reportOrderIds).map(String);
      const taskProjectIds = new Set(array(note && note.task && note.task.projectIds).map(String));
      const candidates = [];
      const candidateIds = new Set();
      for (const relationId of unique(taskOrderIds)) {
        for (const candidate of array(businessRelationCandidates.get(relationId))) {
          if (taskProjectIds.size && candidate.projectId && !taskProjectIds.has(candidate.projectId)) {
            continue;
          }
          if (candidateIds.has(candidate.id)) continue;
          candidateIds.add(candidate.id);
          candidates.push(candidate);
        }
      }
      for (const relationId of unique(taskReportOrderIds)) {
        for (const candidate of array(reportRelationCandidates.get(relationId))) {
          if (taskProjectIds.size && candidate.projectId && !taskProjectIds.has(candidate.projectId)) {
            continue;
          }
          if (candidateIds.has(candidate.id)) continue;
          candidateIds.add(candidate.id);
          candidates.push(candidate);
        }
      }
      candidates.sort(orderSort);
      if (!candidates.length) {
        const affectedProjects = [...taskProjectIds];
        affectedProjects.forEach((id) => unresolvedProjectIds.add(id));
        unassignedNotes.push(compactUnassignedNote(
          note, affectedProjects, [], 'order_relation_missing'
        ));
        continue;
      }
      const publishDate = canonicalDate(note.publishDate);
      const intervalMatches = publishDate ? candidates.filter((candidate) => (
        candidate.startDate && candidate.endDate &&
        publishDate >= candidate.startDate && publishDate <= candidate.endDate
      )) : [];
      const owner = candidates.length === 1
        ? candidates[0]
        : intervalMatches.length === 1 ? intervalMatches[0] : null;
      if (!owner) {
        candidates.forEach((candidate) => ambiguousOrderIds.add(candidate.id));
        unassignedNotes.push(compactUnassignedNote(
          note, [...taskProjectIds], candidates, 'ambiguous_order_relation'
        ));
        continue;
      }
      const rule = candidates.length === 1 ? 'unique_candidate' : 'unique_publish_date_interval';
      for (const candidate of candidates) {
        if (candidate.businessIdentityVerified) {
          addOrderNote(resolvedBusinessNoteIds, candidate.id, note && note.noteId);
        }
      }
      if (!notePlacements.has(owner.id)) notePlacements.set(owner.id, []);
      notePlacements.get(owner.id).push(compactHierarchyNote(note, owner, candidates, rule));
    }

    if (unassignedNotes.some((note) => note.reason === 'ambiguous_order_relation')) {
      coverageIssues.push({
        severity: 'critical',
        code: 'adstar_note_order_ambiguous',
        platform: 'adstar',
        message: '星河存在无法唯一归属到订单的笔记，相关订单与项目成本保持未知。',
        count: unassignedNotes.filter((note) => note.reason === 'ambiguous_order_relation').length,
      });
    }
    if (unassignedNotes.some((note) => note.reason === 'order_relation_missing')) {
      coverageIssues.push({
        severity: 'critical',
        code: 'adstar_note_order_relation_missing',
        platform: 'adstar',
        message: '星河存在无法关联到已采集订单的笔记，相关项目成本保持未知。',
        count: unassignedNotes.filter((note) => note.reason === 'order_relation_missing').length,
      });
    }
    const reportOrderCount = orderUnits.filter((order) => order.source === 'project_report').length;
    if (reportOrderCount > 0) {
      coverageIssues.push({
        severity: 'critical',
        code: 'adstar_report_order_unverified',
        platform: 'adstar',
        message: '星河仅返回项目报表订单关系，业务订单身份未验证，相关成本保持未知。',
        count: reportOrderCount,
      });
    }

    function sumNoteCosts(notes) {
      const rows = array(notes);
      const sum = (key) => {
        const values = rows.map((note) => numberValue(note && note.costs && note.costs[key]));
        return values.some((value) => value === null)
          ? null
          : values.reduce((total, value) => total + value, 0);
      };
      return { creator: sum('creator'), adInTask: sum('adInTask'), total: sum('total') };
    }

    function completeCheckpoint(checkpoint) {
      const expected = numberValue(checkpoint && checkpoint.expectedCount);
      const received = numberValue(checkpoint && checkpoint.receivedCount);
      return Boolean(checkpoint) && String(checkpoint.status || '') === 'complete' &&
        expected !== null && received !== null && expected === received && checkpoint.truncated !== true;
    }

    function orderCosts(order, notes) {
      if (!order.businessIdentityVerified || ambiguousOrderIds.has(order.id)) return null;
      const native = nestedOrders.get(order.id) || null;
      if (!native) return null;
      const checkpoint = native.checkpoints && native.checkpoints.content;
      const rawRelations = rawBusinessNoteIds.get(order.id) || new Set();
      const resolvedRelations = resolvedBusinessNoteIds.get(order.id) || new Set();
      const relationsExplained = rawRelations.size > 0 && [...rawRelations]
        .every((noteId) => resolvedRelations.has(noteId));
      if (!notes.length) {
        const expected = numberValue(checkpoint && checkpoint.expectedCount);
        const received = numberValue(checkpoint && checkpoint.receivedCount);
        return completeCheckpoint(checkpoint) && (
          expected === 0 && received === 0 || expected > 0 && relationsExplained
        )
          ? { creator: 0, adInTask: 0, total: 0 }
          : null;
      }
      if (checkpoint && !completeCheckpoint(checkpoint)) return null;
      if (!checkpoint && String(native.status || '') !== 'complete') return null;
      if (rawRelations.size > 0 && !relationsExplained) return null;
      const rolled = sumNoteCosts(notes);
      return Object.values(rolled).some((value) => value === null) ? null : rolled;
    }

    function cloneHierarchyNote(note) {
      return {
        ...note,
        metrics: isObject(note.metrics) ? { ...note.metrics } : note.metrics,
        costs: isObject(note.costs) ? { ...note.costs } : note.costs,
        ownership: {
          ...note.ownership,
          candidateOrderIds: note.ownership.candidateOrderIds.slice(),
        },
      };
    }

    function cloneOrder(order) {
      const notes = array(notePlacements.get(order.id)).map((note) => ({
        ...cloneHierarchyNote(note),
      }));
      const costs = orderCosts(order, notes);
      return {
        ...order,
        metrics: isObject(order.metrics) ? { ...order.metrics } : order.metrics,
        costs,
        costCoverage: costs === null ? 'partial' : 'complete',
        notes,
      };
    }

    function sumOrderCosts(orders) {
      const rows = array(orders);
      const sum = (key) => {
        const values = rows.map((order) => numberValue(order && order.costs && order.costs[key]));
        return values.some((value) => value === null)
          ? null
          : values.reduce((total, value) => total + value, 0);
      };
      return { creator: sum('creator'), adInTask: sum('adInTask'), total: sum('total') };
    }

    const orders = orderUnits.map(cloneOrder);
    const projects = projectUnits.map((project) => {
      const projectOrders = orders.filter((order) => order.projectId === project.id).map(cloneOrder);
      let costs = null;
      if (!unresolvedProjectIds.has(project.id) && projectOrders.length &&
        projectOrders.every((order) => order.costs !== null)) {
        const rolled = sumOrderCosts(projectOrders);
        costs = Object.values(rolled).some((value) => value === null) ? null : rolled;
      } else if (!projectOrders.length) {
        const native = nestedProjects.get(project.id);
        const checkpoint = native && native.checkpoints && native.checkpoints.order;
        const expected = numberValue(checkpoint && checkpoint.expectedCount);
        const received = numberValue(checkpoint && checkpoint.receivedCount);
        if (completeCheckpoint(checkpoint) && expected === 0 && received === 0) {
          costs = { creator: 0, adInTask: 0, total: 0 };
        }
      }
      return {
        ...project,
        metrics: isObject(project.metrics) ? { ...project.metrics } : project.metrics,
        costs,
        costCoverage: costs === null ? 'partial' : 'complete',
        orders: projectOrders,
      };
    });
    return {
      projects,
      orders,
      unassignedNotes,
      coverageIssues,
    };
  }

  function buildQuality(input, collections) {
    const base = qualityTools.evaluateDecisionReadiness({
      pgy: collections.pgy,
      juguang: collections.juguang,
      adstar: collections.adstar,
    });
    const issues = array(base.issues).slice();
    const requestedRange = JSON.stringify(input.dateRange || {});
    for (const platform of ['pgy', 'juguang', 'adstar']) {
      const collection = collections[platform];
      if (!collection) continue;
      if (requestedRange !== JSON.stringify(collection.dateRange || {})) {
        if (!issues.some((issue) => issue.code === 'date_range_mismatch' && issue.platform === platform)) {
          issues.push({
            severity: 'critical', code: 'date_range_mismatch', platform,
            message: `Requested date range does not match ${platform}`,
          });
        }
      }
      if (input.runId && collection.runId && String(input.runId) !== String(collection.runId)) {
        issues.push({
          severity: 'critical', code: 'run_id_mismatch', platform,
          message: `Run id does not match ${platform} collection`,
        });
      }
    }
    const issueIndexes = new Map();
    const severityRank = { info: 1, warning: 2, critical: 3 };
    const sanitized = [];
    for (const issue of contract.sanitizeSensitiveData(issues)) {
      const key = `${String(issue && issue.code || '')}\u0000${String(issue && issue.platform || '')}`;
      if (!issueIndexes.has(key)) {
        issueIndexes.set(key, sanitized.length);
        sanitized.push(issue);
        continue;
      }
      const index = issueIndexes.get(key);
      const previous = sanitized[index];
      const previousRank = severityRank[String(previous && previous.severity || '')] || 0;
      const nextRank = severityRank[String(issue && issue.severity || '')] || 0;
      if (nextRank > previousRank) sanitized[index] = issue;
    }
    return {
      decisionReady: !sanitized.some((issue) => issue.severity === 'critical'),
      requiredPlatforms: ['pgy', 'juguang', 'adstar'],
      issues: sanitized,
    };
  }

  function assignActions(notes, quality, targetRoi) {
    if (!quality.decisionReady) {
      const actions = [{
        noteId: null,
        action: 'collect_more',
        confidence: 'high',
        evidence: ['三平台数据完整性或日期/运行口径未通过'],
      }];
      for (const note of notes) {
        actions.push({
          noteId: note.noteId,
          action: 'observe',
          confidence: 'low',
          evidence: ['数据质量未达到经营决策标准'],
        });
      }
      return actions;
    }
    const benchmark = numberValue(targetRoi);
    return notes.map((note) => {
      const candidates = [note.results.starTaskRoi, note.results.outsideDirectRoi].filter(Number.isFinite);
      const best = candidates.length ? Math.max(...candidates) : null;
      let action = 'observe';
      if (note.maturity === 'mature' && benchmark !== null && best !== null) {
        action = best >= benchmark ? 'scale' : best < benchmark * 0.5 ? 'stop' : 'optimize';
      }
      return {
        noteId: note.noteId,
        action,
        confidence: action === 'observe' ? 'low' : 'high',
        evidence: best === null || benchmark === null
          ? ['等待完整归因数据']
          : [`可观测 ROI ${best.toFixed(2)}，目标 ${benchmark.toFixed(2)}`],
      };
    });
  }

  function accountMetadata(collections, generatedAt) {
    const output = {};
    for (const platform of ['pgy', 'juguang', 'adstar']) {
      const collection = collections[platform] || {};
      const accountKeys = identityTools.extractPlatformIdentity(platform, collection);
      output[platform] = {
        accountKeys,
        collectedAt: collection.finishedAt || generatedAt,
      };
    }
    return output;
  }

  function createXhsAnalysisSnapshot(input) {
    const source = isObject(input) ? input : {};
    const generatedAt = source.generatedAt || new Date().toISOString();
    const collections = isObject(source.collections) ? source.collections : {};
    const requestedPlatforms = array(source.selectedPlatforms)
      .filter((platform) => ['pgy', 'juguang', 'adstar'].includes(platform));
    const selectedPlatforms = requestedPlatforms.length
      ? Array.from(new Set(requestedPlatforms))
      : ['pgy', 'juguang', 'adstar'];
    const hasPgy = selectedPlatforms.includes('pgy');
    const hasJuguang = selectedPlatforms.includes('juguang');
    const hasAdstar = selectedPlatforms.includes('adstar');
    const pgy = isObject(collections.pgy) ? collections.pgy : {};
    const juguang = isObject(collections.juguang) ? collections.juguang : {};
    const adstar = isObject(collections.adstar) ? collections.adstar : {};
    const unavailableStatuses = new Set(['failed', 'cancelled', 'missing']);
    const collectionUsable = (selected, collection) => selected && Object.keys(collection).length > 0 &&
      !unavailableStatuses.has(String(collection.status || 'missing'));
    const usePgy = collectionUsable(hasPgy, pgy);
    const useJuguang = collectionUsable(hasJuguang, juguang);
    const useAdstar = collectionUsable(hasAdstar, adstar);
    const completeStatuses = new Set(['complete', 'verified_no_spend']);
    const pgyCoverageComplete = usePgy && completeStatuses.has(String(pgy.status || ''));
    const juguangCoverageComplete = useJuguang && completeStatuses.has(String(juguang.status || ''));
    const starCoverageComplete = useAdstar && completeStatuses.has(String(adstar.status || ''));
    const analysisRange = source.dateRange || {};
    const reportAsOf = canonicalDate(source.asOf) || canonicalDate(generatedAt);
    const pgyAsOf = canonicalShanghaiDate(generatedAt) || reportAsOf;
    const pgyByNote = normalizePgy(usePgy ? pgy : {});
    const pgySelection = selectPgyPeriod(pgyByNote, analysisRange);
    const taskIndex = buildTaskIndex(useAdstar ? adstar : {}, pgyByNote, analysisRange);
    const starNormalized = normalizeStarNotes(useAdstar ? adstar : {}, taskIndex, analysisRange);
    const pgyReport = usePgy
      ? pgyPeriodSummary(pgySelection, analysisRange, pgyAsOf)
      : {
        noteCount: null,
        reportedNoteCount: null,
        starTaskNoteCount: null,
        overdueNoteCount: null,
        costs: { cooperation: null, platformFee: null, total: null },
        metrics: null,
        monthly: [],
        followerTiers: [],
        followerTierExcluded: {
          below1k: { noteCount: 0, authorCount: 0 },
          unknown: { noteCount: 0, authorCount: 0 },
        },
        excluded: { invalidPublishDate: 0, outsideRange: 0 },
      };
    pgyReport.coverage = pgyCoverageComplete ? 'complete' : usePgy ? 'partial' : 'unavailable';
    pgyReport.asOf = usePgy ? pgyAsOf : null;
    if (usePgy && pgy.collectionScope === 'all_available') {
      pgyReport.collectionScope = 'all_available';
      pgyReport.latestPublishDate = canonicalDate(pgy.latestPublishDate);
      pgyReport.collectedAt = pgy.finishedAt || null;
      pgyReport.defaultDateRange = contract.sanitizeSensitiveData(analysisRange);
      pgyReport.facts = compactPgyFacts(pgy);
    }
    if (usePgy && !pgyCoverageComplete) {
      pgyReport.costs = { cooperation: null, platformFee: null, total: null };
    }
    const juguangRows = normalizeJuguang(
      useJuguang ? juguang : {}, taskIndex, analysisRange, starCoverageComplete
    );
    const notes = buildNotes(pgyByNote, new Set(pgySelection.selected.keys()), juguangRows,
      starNormalized.byNote, taskIndex,
      reportAsOf, {
        pgyAvailable: usePgy,
        pgyComplete: pgyCoverageComplete,
        juguangAvailable: useJuguang,
        juguangComplete: juguangCoverageComplete,
        starCoverageComplete,
      });
    const star = starLayers(useAdstar ? adstar : {}, notes, analysisRange);
    const quality = buildQuality(source, { pgy, juguang, adstar });
    for (const issue of array(star.coverageIssues)) {
      if (!quality.issues.some((existing) => (
        existing && existing.code === issue.code && existing.platform === issue.platform
      ))) {
        quality.issues.push({ ...issue });
      }
      if (issue.severity === 'critical') quality.decisionReady = false;
    }
    if (usePgy && pgyReport.excluded.invalidPublishDate > 0) {
      quality.issues.push({
        severity: 'critical',
        code: 'pgy_publish_date_missing',
        platform: 'pgy',
        message: `${pgyReport.excluded.invalidPublishDate} 条蒲公英笔记缺少有效发布时间，已排除期间汇总。`,
      });
      quality.decisionReady = false;
    }
    const cooperation = pgyCoverageComplete ? pgyReport.costs.cooperation : null;
    const platformFee = pgyCoverageComplete ? pgyReport.costs.platformFee : null;
    const partnership = pgyCoverageComplete ? pgyReport.costs.total : null;
    const adTotal = summarizeJuguang(juguangRows);
    const adInTask = summarizeJuguang(juguangRows.filter((row) => row.taskStatus === 'in_task'));
    const adOutsideTask = summarizeJuguang(juguangRows.filter((row) => (
      row.taskStatus === 'out_of_task' || row.taskStatus === 'no_task'
    )));
    const adUnknownTask = summarizeJuguang(juguangRows.filter((row) => ![
      'in_task', 'out_of_task', 'no_task',
    ].includes(row.taskStatus)));
    const outsideDirect = summarizeJuguang(juguangRows.filter((row) => (
      row.marketingObjective === 'direct' && ['out_of_task', 'no_task'].includes(row.taskStatus)
    )));
    const directTotal = summarizeJuguang(juguangRows.filter((row) => row.marketingObjective === 'direct'));
    const taskAlignmentComplete = starCoverageComplete && adUnknownTask.spend === 0;
    const starTaskCost = pgyCoverageComplete && juguangCoverageComplete && taskAlignmentComplete
      ? partnership + adInTask.spend
      : null;
    if (useJuguang && juguangCoverageComplete && starCoverageComplete && adUnknownTask.spend > 0) {
      quality.issues.push({
        severity: 'critical',
        code: 'juguang_task_period_unknown',
        platform: 'juguang',
        message: `${adUnknownTask.spend} 元聚光消耗缺少可验证的星河任务周期，任务期内外费用保持未知。`,
      });
      quality.decisionReady = false;
    }
    const storeMetrics = useAdstar ? normalizeStarMetrics(adstar.storeSummary) : null;
    if (storeMetrics) storeMetrics.visitCost = ratio(starTaskCost, storeMetrics.storeVisitUv);
    const taskGmv = storeMetrics && storeMetrics.seededProductGmv;
    const storeGmv = storeMetrics && storeMetrics.gmv;
    const accountOverview = {
      totalSpend: pgyCoverageComplete && juguangCoverageComplete
        ? partnership + adTotal.spend
        : null,
      creatorSpend: partnership,
      adSpend: juguangCoverageComplete ? adTotal.spend : null,
      starAlignedSpend: starTaskCost,
      taskAdSpend: juguangCoverageComplete && starCoverageComplete ? adInTask.spend : null,
      outsideTaskAdSpend: juguangCoverageComplete && starCoverageComplete
        ? adOutsideTask.spend
        : null,
      unknownTaskAdSpend: juguangCoverageComplete ? adUnknownTask.spend : null,
      taskRoi: useAdstar ? ratio(taskGmv, starTaskCost) : null,
      outsideDirectRoi: juguangCoverageComplete && starCoverageComplete ? outsideDirect.roi : null,
      directRoi: juguangCoverageComplete ? directTotal.roi : null,
    };
    const actions = assignActions(notes, quality, source.targetRoi);
    const snapshot = {
      schema: SNAPSHOT_SCHEMA,
      schemaVersion: 1,
      runId: source.runId || null,
      storeId: source.storeId || null,
      selectedPlatforms,
      generatedAt,
      asOf: reportAsOf,
      dateRange: contract.sanitizeSensitiveData(source.dateRange || null),
      accounts: accountMetadata({ pgy, juguang, adstar }, generatedAt),
      pgy: pgyReport,
      management: {
        noteCount: useAdstar ? notes.length : null,
        accountOverview,
        costs: {
          cooperation,
          platformFee,
          partnership,
          juguang: juguangCoverageComplete ? adTotal.spend : null,
          total: pgyCoverageComplete && juguangCoverageComplete
            ? partnership + adTotal.spend
            : null,
          starTaskAligned: starTaskCost,
          outsideDirect: juguangCoverageComplete && starCoverageComplete
            ? outsideDirect.spend
            : null,
          juguangInTask: juguangCoverageComplete && starCoverageComplete ? adInTask.spend : null,
          juguangOutsideTask: juguangCoverageComplete && starCoverageComplete
            ? adOutsideTask.spend
            : null,
          juguangUnknownTask: juguangCoverageComplete ? adUnknownTask.spend : null,
        },
        starTaskResult: {
          source: 'adstar_store_summary_seeded_product_gmv',
          metrics: storeMetrics ? { ...storeMetrics } : null,
          gmv: taskGmv,
          roi: ratio(taskGmv, starTaskCost),
        },
        storeResult: {
          source: 'adstar_store_summary',
          metrics: storeMetrics ? { ...storeMetrics } : null,
          gmv: storeGmv,
          roi: ratio(storeGmv, starTaskCost),
        },
        outsideDirectResult: juguangCoverageComplete && starCoverageComplete ? {
          attributionBasis: 'conversion_time',
          attributionWindowDays: numberValue(juguang.attribution && juguang.attribution.windowDays) || 15,
          spend: outsideDirect.spend,
          storeVisits: outsideDirect.storeVisits,
          orders: outsideDirect.orders,
          gmv: outsideDirect.gmv,
          roi: outsideDirect.roi,
        } : null,
        directResult: juguangCoverageComplete ? {
          attributionBasis: 'conversion_time',
          attributionWindowDays: numberValue(juguang.attribution && juguang.attribution.windowDays) || 15,
          spend: directTotal.directSpend,
          storeVisits: directTotal.storeVisits,
          orders: directTotal.orders,
          gmv: directTotal.gmv,
          roi: directTotal.roi,
        } : null,
      },
      spotlight: {
        total: useJuguang ? adTotal : null,
        daily: useJuguang ? juguangRows : [],
        byAccount: useJuguang ? accountJuguangGroups(juguangRows) : [],
        byMarketingObjective: useJuguang
          ? groupJuguang(juguangRows, (row) => row.marketingObjective)
          : [],
        byDeliveryMode: useJuguang
          ? groupJuguang(juguangRows, (row) => row.deliveryMode == null ? 'unknown' : row.deliveryMode)
          : [],
        byPlacementType: useJuguang
          ? groupJuguang(juguangRows, (row) => row.placementType == null ? 'unknown' : row.placementType)
          : [],
        byTaskStatus: useJuguang ? groupJuguang(juguangRows, (row) => row.taskStatus) : [],
        byTaskObjective: useJuguang ? taskObjectiveGroups(juguangRows) : [],
      },
      star: Object.assign({
        coverage: starCoverageComplete ? 'complete' : useAdstar ? 'partial' : 'unavailable',
        store: useAdstar ? {
          costs: {
            total: starTaskCost,
            creator: partnership,
            adInTask: juguangCoverageComplete && taskAlignmentComplete ? adInTask.spend : null,
          },
          metrics: storeMetrics ? Object.assign({}, storeMetrics) : null,
          storeRoi: ratio(storeGmv, starTaskCost),
          taskRoi: ratio(taskGmv, starTaskCost),
        } : null,
        taskSummary: useAdstar ? {
          activeNoteCount: starNormalized.byNote.size,
          gmv: taskGmv,
          metrics: storeMetrics ? { ...storeMetrics } : null,
          costs: {
            total: starTaskCost,
            creator: partnership,
            adInTask: juguangCoverageComplete && taskAlignmentComplete ? adInTask.spend : null,
          },
          roi: ratio(taskGmv, starTaskCost),
        } : null,
        // The joined notes and hierarchy already retain every V2 report/Excel field. Keeping
        // the same normalized Star daily facts here duplicated tens of thousands of rows and
        // could make an otherwise complete collection exceed the archive's 8 MiB safety gate.
        daily: [],
        dailyCount: useAdstar ? starNormalized.daily.length : 0,
        dailyOmitted: Boolean(useAdstar && starNormalized.daily.length),
      }, star),
      targetRoi: numberValue(source.targetRoi),
      quality,
      actions,
      notes,
    };
    return contract.sanitizeSensitiveData(snapshot);
  }

  return Object.freeze({
    SNAPSHOT_SCHEMA,
    STAR_METRIC_MAP,
    canonicalDate,
    createXhsAnalysisSnapshot,
    mergeIntervals,
  });
});
