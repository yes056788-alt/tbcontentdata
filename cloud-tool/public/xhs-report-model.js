(function initXhsReportModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsReportModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsReportModelApi() {
  'use strict';

  const DIMENSIONS = Object.freeze([
    'account', 'marketingObjective', 'placementType', 'deliveryMode',
  ]);
  const FILTERS = Object.freeze({
    accountIds: 'account',
    marketingObjectives: 'marketingObjective',
    placementTypes: 'placementType',
    deliveryModes: 'deliveryMode',
  });
  const OBJECTIVE_LABELS = Object.freeze({
    product_seeding: '产品种草',
    direct: '种草直达',
    unknown: '未知营销诉求',
  });
  const DELIVERY_MODE_LABELS = Object.freeze({
    0: '手动投放',
    1: '自动投放',
    unknown: '未知投放模式',
  });
  const PGY_FOLLOWER_TIERS = Object.freeze([
    Object.freeze({ key: '1k_5k', label: '1K-5K', min: 1000, max: 5000 }),
    Object.freeze({ key: '5k_10k', label: '5K-1W', min: 5000, max: 10000 }),
    Object.freeze({ key: '10k_100k', label: '1W-10W', min: 10000, max: 100000 }),
    Object.freeze({ key: '100k_500k', label: '10W-50W', min: 100000, max: 500000 }),
    Object.freeze({ key: '500k_plus', label: '50W+', min: 500000, max: Infinity }),
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = typeof value === 'number'
      ? value
      : Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number'
      ? value
      : Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function ratio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const canonical = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (canonical) return `${canonical[1]}-${canonical[2]}-${canonical[3]}`;
    return null;
  }

  function cleanIdentifier(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !['-', '--', '—'].includes(text) ? text : null;
  }

  function normalizePgySpus(value) {
    const seen = new Set();
    const values = Array.isArray(value) ? value : [];
    return values.map((item) => {
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

  function pgySpuOptions(facts) {
    const values = new Set();
    for (const fact of Array.isArray(facts) ? facts : []) {
      const spuName = cleanIdentifier(fact && fact.spuName);
      if (spuName) values.add(spuName);
    }
    return [...values].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  function normalizedSamplingRatio(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[%\s]/g, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized > 0 && normalized <= 1 ? normalized : null;
  }

  function normalizedDateRange(value) {
    const source = isObject(value) ? value : {};
    return { from: canonicalDate(source.from), to: canonicalDate(source.to) };
  }

  function monthsInRange(value) {
    const range = normalizedDateRange(value);
    if (!range.from || !range.to || range.from > range.to) return [];
    const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
    const end = range.to.slice(0, 7);
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

  function aggregatePgyFacts(input) {
    const source = isObject(input) ? input : {};
    if (!Array.isArray(source.facts)) throw new Error('PGY facts must be an array.');
    const range = normalizedDateRange(source.dateRange);
    const asOf = canonicalDate(source.asOf);
    const selectedSpuName = cleanIdentifier(source.spuName);
    if (!range.from || !range.to || range.from > range.to) {
      throw new Error('PGY dateRange must be a valid closed interval.');
    }
    const notes = [];
    let invalidPublishDate = 0;
    let outsideRange = 0;
    for (const rawFact of source.facts) {
      const fact = isObject(rawFact) ? rawFact : {};
      const publishDate = canonicalDate(fact.publishDate);
      if (!publishDate) {
        invalidPublishDate += 1;
        continue;
      }
      if (publishDate < range.from || publishDate > range.to) {
        outsideRange += 1;
        continue;
      }
      const spuName = cleanIdentifier(fact.spuName);
      if (selectedSpuName && spuName !== selectedSpuName) continue;
      notes.push({ ...fact, publishDate, spuName });
    }

    const costs = notes.reduce((result, note) => {
      const values = isObject(note.costs) ? note.costs : {};
      result.cooperation += finiteNumber(values.cooperation);
      result.platformFee += finiteNumber(values.platformFee);
      result.total = result.cooperation + result.platformFee;
      return result;
    }, { cooperation: 0, platformFee: 0, total: 0 });
    const metrics = notes.reduce((result, note) => {
      const values = isObject(note.metrics) ? note.metrics : {};
      result.impressions += finiteNumber(values.impressions);
      result.reads += finiteNumber(values.reads);
      result.interactions += finiteNumber(values.interactions);
      return result;
    }, { impressions: 0, reads: 0, interactions: 0 });
    metrics.readRate = ratio(metrics.reads, metrics.impressions);
    metrics.engagementRate = ratio(metrics.interactions, metrics.reads);
    const taobaoAccumulator = notes.reduce((result, note) => {
      const values = isObject(note.metrics) ? note.metrics : {};
      const sampling = normalizedSamplingRatio(note.taobaoSamplingRatio);
      const activeUv = optionalNumber(values.taobaoOffsiteActiveUv15d);
      const activeCost = optionalNumber(values.taobaoOffsiteActiveCost15d);
      const dealUv = optionalNumber(values.taobaoDealUv15d);
      const addCartUv = optionalNumber(values.taobaoAddCartUv15d);
      result.offsiteActiveUv += activeUv === null ? 0 : activeUv;
      result.dealUv += dealUv === null ? 0 : dealUv;
      result.addCartUv += addCartUv === null ? 0 : addCartUv;
      if (sampling !== null) {
        const adjustedActive = activeUv === null ? null : activeUv / sampling;
        if (adjustedActive !== null) {
          result.adjustedActiveUv += adjustedActive;
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
    const taobao15d = {
      offsiteActiveUv: taobaoAccumulator.offsiteActiveUv,
      offsiteActiveCost: taobaoAccumulator.samplingComplete && taobaoAccumulator.activeCostComplete
        ? ratio(taobaoAccumulator.activeCostNumerator, taobaoAccumulator.adjustedActiveUv)
        : null,
      dealUv: taobaoAccumulator.dealUv,
      addCartUv: taobaoAccumulator.addCartUv,
      addCartRate: taobaoAccumulator.samplingComplete
        ? ratio(taobaoAccumulator.adjustedAddCartUv, metrics.reads)
        : null,
      purchaseRate: taobaoAccumulator.samplingComplete
        ? ratio(taobaoAccumulator.adjustedDealUv, metrics.reads)
        : null,
    };

    const monthCounts = new Map(monthsInRange(range).map((month) => [month, 0]));
    for (const note of notes) {
      const month = note.publishDate.slice(0, 7);
      if (monthCounts.has(month)) monthCounts.set(month, monthCounts.get(month) + 1);
    }

    const tierState = new Map(PGY_FOLLOWER_TIERS.map((tier) => [tier.key, {
      noteCount: 0, authorKeys: new Set(), cooperationCost: 0,
    }]));
    const excludedTiers = {
      below1k: { noteCount: 0, authorKeys: new Set() },
      unknown: { noteCount: 0, authorKeys: new Set() },
    };
    for (const note of notes) {
      const author = isObject(note.author) ? note.author : {};
      const followerCount = optionalNumber(author.followerCount);
      const authorKey = String(author.id || author.name || `note:${String(note.noteId || '')}`);
      if (followerCount === null) {
        excludedTiers.unknown.noteCount += 1;
        excludedTiers.unknown.authorKeys.add(authorKey);
        continue;
      }
      if (followerCount < 1000) {
        excludedTiers.below1k.noteCount += 1;
        excludedTiers.below1k.authorKeys.add(authorKey);
        continue;
      }
      const tier = PGY_FOLLOWER_TIERS.find((item) => (
        followerCount >= item.min && followerCount < item.max
      ));
      if (!tier) continue;
      const state = tierState.get(tier.key);
      state.noteCount += 1;
      state.authorKeys.add(authorKey);
      state.cooperationCost += finiteNumber(note.costs && note.costs.cooperation);
    }
    return {
      noteCount: notes.length,
      reportedNoteCount: notes.length,
      selectedSpuName,
      spuOptions: pgySpuOptions(source.facts),
      facts: notes,
      asOf,
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
      followerTiers: PGY_FOLLOWER_TIERS.map((tier) => {
        const state = tierState.get(tier.key);
        return {
          key: tier.key,
          label: tier.label,
          noteCount: state.noteCount,
          authorCount: state.authorKeys.size,
          cooperationCost: state.cooperationCost,
          averageCooperationCost: ratio(state.cooperationCost, state.noteCount),
        };
      }),
      followerTierExcluded: {
        below1k: {
          noteCount: excludedTiers.below1k.noteCount,
          authorCount: excludedTiers.below1k.authorKeys.size,
        },
        unknown: {
          noteCount: excludedTiers.unknown.noteCount,
          authorCount: excludedTiers.unknown.authorKeys.size,
        },
      },
      excluded: { invalidPublishDate, outsideRange },
    };
  }

  function normalizeObjective(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    const text = String(value).trim();
    const compact = text.toLowerCase().replace(/[\s_-]/g, '');
    if (text === '4' || compact === '产品种草' || compact === 'productseeding') {
      return 'product_seeding';
    }
    if (text === '13' || compact === '种草直达' || compact === 'direct') return 'direct';
    return text || 'unknown';
  }

  function normalizeDeliveryMode(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    const text = String(value).trim();
    if (text === '0' || text === '手动投放') return 0;
    if (text === '1' || text === '自动投放') return 1;
    return value;
  }

  function normalizePlacementType(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    return typeof value === 'string' ? value.trim() || 'unknown' : value;
  }

  function dimensionValue(row, dimension) {
    const source = isObject(row) ? row : {};
    if (dimension === 'account') {
      const key = source.accountId === null || source.accountId === undefined || source.accountId === ''
        ? 'unknown'
        : String(source.accountId);
      const label = source.accountName === null || source.accountName === undefined || source.accountName === ''
        ? (key === 'unknown' ? '未知广告账户' : key)
        : String(source.accountName);
      return { key, label };
    }
    if (dimension === 'marketingObjective') {
      const key = normalizeObjective(source.marketingObjective);
      return { key, label: OBJECTIVE_LABELS[key] || String(key) };
    }
    if (dimension === 'placementType') {
      const key = normalizePlacementType(source.placementType);
      return { key, label: key === 'unknown' ? '未知投放位置' : String(key) };
    }
    if (dimension === 'deliveryMode') {
      const key = normalizeDeliveryMode(source.deliveryMode);
      return { key, label: DELIVERY_MODE_LABELS[key] || String(key) };
    }
    throw new Error(`Unsupported Spotlight dimension: ${String(dimension)}`);
  }

  function comparable(value, dimension) {
    if (dimension === 'marketingObjective') return String(normalizeObjective(value));
    if (dimension === 'placementType') return String(normalizePlacementType(value));
    if (dimension === 'deliveryMode') return String(normalizeDeliveryMode(value));
    return value === null || value === undefined || value === '' ? 'unknown' : String(value);
  }

  function validateGroupBy(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
      throw new Error('Spotlight groupBy must contain 1-3 dimensions.');
    }
    const groupBy = value.map((dimension) => String(dimension));
    if (new Set(groupBy).size !== groupBy.length) {
      throw new Error('Spotlight groupBy dimensions must not contain duplicates.');
    }
    for (const dimension of groupBy) {
      if (!DIMENSIONS.includes(dimension)) {
        throw new Error(`Spotlight groupBy dimension is not allowlisted: ${dimension}`);
      }
    }
    return groupBy;
  }

  function normalizedFilters(value) {
    const source = value === undefined || value === null ? {} : value;
    if (!isObject(source)) throw new Error('Spotlight filters must be an object.');
    for (const key of Object.keys(source)) {
      if (!Object.prototype.hasOwnProperty.call(FILTERS, key)) {
        throw new Error(`Spotlight filter is not allowlisted: ${key}`);
      }
      if (!Array.isArray(source[key])) throw new Error(`Spotlight filter ${key} must be an array.`);
    }
    return Object.fromEntries(Object.entries(FILTERS).map(([filter, dimension]) => [
      filter,
      new Set((source[filter] || []).map((item) => comparable(item, dimension))),
    ]));
  }

  function matchesFilters(row, filters) {
    for (const [filter, dimension] of Object.entries(FILTERS)) {
      const accepted = filters[filter];
      if (!accepted.size) continue;
      const actual = dimensionValue(row, dimension).key;
      if (!accepted.has(comparable(actual, dimension))) return false;
    }
    return true;
  }

  function summarizeRows(rows) {
    const summary = {
      rowCount: rows.length,
      noteCount: 0,
      spend: { total: 0, inTask: 0, outsideTask: 0, unknown: 0 },
      impressions: 0,
      clicks: 0,
      interactions: 0,
      seedUsers: 0,
      deepSeedUsers: 0,
      seedingExternal15: {
        observability: 'none',
        seedingSpend: 0,
        activeUv: null,
        calculatedCost: null,
      },
      conversion15: {
        observability: 'none',
        directSpend: 0,
        storeVisits: null,
        orders: null,
        gmv: null,
        calculatedRoi15: null,
        // externalRoi15 is non-additive. The exact platform value remains on
        // each daily fact row and must never be averaged into a group.
        platformRoi15: null,
      },
    };
    const noteIds = new Set();
    let observableDirectRows = 0;
    let unobservableDirectRows = 0;
    let unknownObjectiveRows = 0;
    const platformRoiValues = [];
    let observableSeedingRows = 0;
    let unobservableSeedingRows = 0;
    let seedingActiveUv = 0;

    for (const rawRow of rows) {
      const row = isObject(rawRow) ? rawRow : {};
      if (row.noteId !== null && row.noteId !== undefined && row.noteId !== '') {
        noteIds.add(String(row.noteId));
      }
      const spend = finiteNumber(row.spend);
      summary.spend.total += spend;
      if (row.taskStatus === 'in_task') summary.spend.inTask += spend;
      else if (row.taskStatus === 'out_of_task' || row.taskStatus === 'no_task') {
        summary.spend.outsideTask += spend;
      } else {
        summary.spend.unknown += spend;
      }
      summary.impressions += finiteNumber(row.impressions);
      summary.clicks += finiteNumber(row.clicks);
      summary.interactions += finiteNumber(row.interactions);
      summary.seedUsers += finiteNumber(row.seedUsers);
      summary.deepSeedUsers += finiteNumber(row.deepSeedUsers);

      const objective = normalizeObjective(row.marketingObjective);
      if (objective === 'product_seeding') {
        summary.seedingExternal15.seedingSpend += spend;
        const external = isObject(row.seedingExternal15) ? row.seedingExternal15 : {};
        const activeUv = optionalNumber(external.activeUv);
        if (external.observable === true && activeUv !== null && activeUv >= 0) {
          observableSeedingRows += 1;
          seedingActiveUv += activeUv;
        } else {
          unobservableSeedingRows += 1;
        }
      }
      const conversion = isObject(row.conversion) ? row.conversion : {};
      if (objective === 'direct') summary.conversion15.directSpend += spend;
      if (objective === 'direct' && conversion.observable === true) {
        observableDirectRows += 1;
        summary.conversion15.storeVisits = (summary.conversion15.storeVisits ?? 0) +
          finiteNumber(conversion.storeVisits);
        summary.conversion15.orders = (summary.conversion15.orders ?? 0) +
          finiteNumber(conversion.orders);
        summary.conversion15.gmv = (summary.conversion15.gmv ?? 0) + finiteNumber(conversion.gmv);
        const platformRoi = optionalNumber(conversion.platformRoi15);
        if (platformRoi !== null) platformRoiValues.push(platformRoi);
      } else {
        if (objective === 'direct') unobservableDirectRows += 1;
        if (objective === 'unknown') unknownObjectiveRows += 1;
      }
    }

    summary.noteCount = noteIds.size;
    summary.seedingExternal15.observability = observableSeedingRows && unobservableSeedingRows
      ? 'partial'
      : observableSeedingRows
        ? 'observable'
        : unobservableSeedingRows
          ? 'unobservable'
          : 'none';
    if (unobservableSeedingRows === 0 && observableSeedingRows > 0) {
      summary.seedingExternal15.activeUv = seedingActiveUv;
      summary.seedingExternal15.calculatedCost = ratio(
        summary.seedingExternal15.seedingSpend,
        seedingActiveUv
      );
    }
    summary.conversion15.observability = observableDirectRows && unobservableDirectRows
      ? 'partial'
      : observableDirectRows
        ? 'observable'
        : unobservableDirectRows
          ? 'unobservable'
          : unknownObjectiveRows
            ? 'unknown'
            : rows.length
              ? 'unobservable'
              : 'none';
    if (unobservableDirectRows > 0) {
      summary.conversion15.storeVisits = null;
      summary.conversion15.orders = null;
      summary.conversion15.gmv = null;
    }
    summary.conversion15.calculatedRoi15 = unobservableDirectRows > 0
      ? null
      : ratio(summary.conversion15.gmv, summary.conversion15.directSpend);
    if (observableDirectRows > 0 && unobservableDirectRows === 0 &&
        platformRoiValues.length === observableDirectRows) {
      const uniquePlatformRois = [...new Set(platformRoiValues.map(String))];
      if (uniquePlatformRois.length === 1) {
        summary.conversion15.platformRoi15 = platformRoiValues[0];
      }
    }
    return summary;
  }

  function buildGroups(rows, groupBy, depth) {
    const dimension = groupBy[depth];
    const grouped = new Map();
    for (const row of rows) {
      const value = dimensionValue(row, dimension);
      const identity = `${typeof value.key}:${String(value.key)}`;
      if (!grouped.has(identity)) grouped.set(identity, { ...value, rows: [] });
      grouped.get(identity).rows.push(row);
    }
    const nodes = [...grouped.values()].map((group) => ({
      dimension,
      key: group.key,
      label: group.label,
      level: depth + 1,
      summary: summarizeRows(group.rows),
      children: depth + 1 < groupBy.length
        ? buildGroups(group.rows, groupBy, depth + 1)
        : [],
    }));
    return nodes.sort((left, right) => (
      right.summary.spend.total - left.summary.spend.total ||
      String(left.label).localeCompare(String(right.label), 'zh-CN')
    ));
  }

  function aggregateSpotlight(input) {
    const source = isObject(input) ? input : {};
    if (!Array.isArray(source.rows)) throw new Error('Spotlight rows must be an array.');
    const groupBy = validateGroupBy(source.groupBy);
    const filters = normalizedFilters(source.filters);
    const rows = source.rows.filter((row) => matchesFilters(row, filters));
    return {
      groupBy,
      summary: summarizeRows(rows),
      groups: buildGroups(rows, groupBy, 0),
    };
  }

  return Object.freeze({
    DIMENSIONS,
    aggregatePgyFacts,
    aggregateSpotlight,
  });
});
