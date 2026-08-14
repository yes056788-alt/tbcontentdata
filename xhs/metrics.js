(function initXhsMetrics(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsMetrics(contract) {
  'use strict';

  if (!contract) throw new Error('XhsContract must be loaded before XhsMetrics');

  const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
  const XHS_METRIC_KEYS = Object.freeze([
    'xhs_totalSpend',
    'xhs_kolSpend',
    'xhs_juguangSpend',
    'xhs_kfsRatio',
    'xhs_noteCount',
    'xhs_reportedNoteShare',
    'xhs_unreportedNoteShare',
    'xhs_productSeedingSpend',
    'xhs_seedingDirectSpend',
    'xhs_xingheVisitors',
    'xhs_dmpVisitors',
    'xhs_visitFrequency',
    'xhs_visitCost',
    'xhs_storeGmv',
    'xhs_storeRoi',
    'xhs_taskGmv',
    'xhs_taskRoi',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_contentAudienceShare',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
    'xhs_l45OverL12',
  ]);
  const DMP_METRIC_KEYS = Object.freeze([
    'xhs_dmpVisitors',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const SOURCE_LABELS = Object.freeze({
    pgy: '蒲公英自动分析 (pgy)',
    juguang: '聚光自动分析 (juguang)',
    adstar: '星河自动分析 (adstar)',
  });

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  function firstDefined() {
    for (const value of arguments) {
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const text = String(value).trim();
    if (!text) return undefined;
    const percentage = /%$/.test(text);
    const normalized = text.replace(/[,￥¥\s]/g, '').replace(/%$/, '');
    if (!normalized) return undefined;
    const number = Number(normalized);
    if (!Number.isFinite(number)) return undefined;
    return percentage ? number / 100 : number;
  }

  function normalizedValue(key, value) {
    if (key === 'xhs_kfsRatio') {
      if (value === null || value === undefined) return undefined;
      const text = String(value).trim();
      return text || undefined;
    }
    return finiteNumber(value);
  }

  function isoTimestamp(value, fallback) {
    const candidate = value === null || value === undefined ? '' : String(value).trim();
    if (candidate && Number.isFinite(Date.parse(candidate))) return candidate;
    const fallbackText = fallback === null || fallback === undefined ? '' : String(fallback).trim();
    if (fallbackText && Number.isFinite(Date.parse(fallbackText))) return fallbackText;
    return new Date().toISOString();
  }

  function dateRange(value, fallback) {
    const primary = isObject(value) ? value : {};
    const secondary = isObject(fallback) ? fallback : {};
    return {
      from: String(firstDefined(primary.from, secondary.from, '')),
      to: String(firstDefined(primary.to, secondary.to, '')),
      timezone: String(firstDefined(primary.timezone, secondary.timezone, 'Asia/Shanghai')),
    };
  }

  function accountKeys(value, fallback) {
    const candidates = [];
    if (Array.isArray(value)) candidates.push(...value);
    else if (value !== undefined && value !== null) candidates.push(value);
    const normalized = [];
    for (const candidate of candidates) {
      const text = String(candidate).trim();
      if (text && !normalized.includes(text)) normalized.push(text);
    }
    return normalized.length ? normalized : [fallback || 'unknown'];
  }

  function createContext(snapshot) {
    const meta = isObject(snapshot.meta) ? snapshot.meta : {};
    const generatedAt = isoTimestamp(firstDefined(snapshot.generatedAt, meta.generatedAt));
    return {
      snapshot,
      generatedAt,
      dateRange: dateRange(firstDefined(snapshot.dateRange, meta.range)),
    };
  }

  function platformMetadata(context, platform) {
    const accounts = isObject(context.snapshot.accounts) ? context.snapshot.accounts : {};
    const platformAccount = isObject(accounts[platform]) ? accounts[platform] : {};
    const collection = isObject(context.snapshot.collections) && isObject(context.snapshot.collections[platform])
      ? context.snapshot.collections[platform]
      : {};
    const keys = firstDefined(
      platformAccount.accountKeys,
      platformAccount.accountKey,
      collection.accountKeys,
      collection.accountKey,
    );
    return {
      source: SOURCE_LABELS[platform],
      updatedAt: isoTimestamp(
        firstDefined(platformAccount.collectedAt, collection.collectedAt, collection.generatedAt),
        context.generatedAt,
      ),
      accountKeys: accountKeys(keys, `${platform}:unknown`),
      dateRange: dateRange(
        firstDefined(platformAccount.dateRange, collection.dateRange),
        context.dateRange,
      ),
      mode: 'automatic',
    };
  }

  function entry(key, value, metadata) {
    const normalized = normalizedValue(key, value);
    if (normalized === undefined) return undefined;
    return {
      value: normalized,
      source: String(metadata.source || 'unknown'),
      updatedAt: isoTimestamp(metadata.updatedAt),
      accountKeys: accountKeys(metadata.accountKeys, 'unknown'),
      dateRange: dateRange(metadata.dateRange),
      mode: metadata.mode,
    };
  }

  function automaticEntry(key, value, context, platform) {
    return entry(key, value, platformMetadata(context, platform));
  }

  function manualValue(source) {
    return isObject(source) && hasOwn(source, 'value') ? source.value : source;
  }

  function manualEntry(key, source, context, override) {
    const metadata = isObject(source) ? source : {};
    const suppliedSource = metadata.source == null ? '' : String(metadata.source).trim();
    const prefix = override
      ? '手填覆盖 (manual override)'
      : '手填兜底 (manual fallback)';
    return entry(key, manualValue(source), {
      source: suppliedSource ? `${prefix}: ${suppliedSource}` : prefix,
      updatedAt: isoTimestamp(metadata.updatedAt, context.generatedAt),
      accountKeys: accountKeys(metadata.accountKeys, 'manual:unknown'),
      dateRange: dateRange(metadata.dateRange, context.dateRange),
      mode: override ? 'manual_override' : 'manual_fallback',
    });
  }

  function resolveEntry(key, automatic, manual, context) {
    const explicitOverride = isObject(manual) && manual.manualOverride === true;
    if (explicitOverride) {
      const overridden = manualEntry(key, manual, context, true);
      if (overridden) return overridden;
    }
    if (automatic) return automatic;
    return manualEntry(key, manual, context, false);
  }

  function preservedEntry(key, source, context) {
    const metadata = isObject(source) ? source : {};
    return entry(key, manualValue(source), {
      source: metadata.source || 'DMP现有值 (preserved)',
      updatedAt: isoTimestamp(metadata.updatedAt, context.generatedAt),
      accountKeys: accountKeys(metadata.accountKeys, 'dmp:unknown'),
      dateRange: dateRange(metadata.dateRange, context.dateRange),
      mode: 'preserved',
    });
  }

  function uniqueAccounts(entries) {
    const result = [];
    for (const item of entries) {
      if (!item || !Array.isArray(item.accountKeys)) continue;
      for (const account of item.accountKeys) {
        if (!result.includes(account)) result.push(account);
      }
    }
    return result.length ? result : ['formula:unknown'];
  }

  function formulaEntry(key, value, dependencies, context) {
    const inputs = dependencies.filter(Boolean);
    return entry(key, value, {
      source: '公式计算 (formula)',
      updatedAt: context.generatedAt,
      accountKeys: uniqueAccounts(inputs),
      dateRange: context.dateRange,
      mode: 'formula',
    });
  }

  function safeDivide(numerator, denominator) {
    const left = finiteNumber(numerator);
    const right = finiteNumber(denominator);
    if (left === undefined || right === undefined || right === 0) return undefined;
    return left / right;
  }

  function objective(snapshot, expectedKey) {
    const spotlight = isObject(snapshot.spotlight) ? snapshot.spotlight : {};
    const groups = Array.isArray(spotlight.byMarketingObjective)
      ? spotlight.byMarketingObjective
      : [];
    return groups.find((group) => {
      if (!isObject(group)) return false;
      const key = firstDefined(group.key, group.marketingObjective, group.objective);
      return String(key || '').trim().toLowerCase() === expectedKey;
    });
  }

  function safeIssue(source) {
    if (!isObject(source)) return null;
    const output = {};
    for (const key of ['severity', 'code', 'platform', 'dataset', 'status', 'message']) {
      if (source[key] !== undefined && source[key] !== null) output[key] = String(source[key]);
    }
    return Object.keys(output).length ? output : null;
  }

  function safeAction(source, decisionReady) {
    if (!isObject(source)) return null;
    const originalAction = String(source.action || 'observe');
    const allowedAction = decisionReady || ['observe', 'refill'].includes(originalAction)
      ? originalAction
      : 'observe';
    const output = {
      action: allowedAction,
    };
    for (const key of ['noteId', 'title', 'confidence']) {
      if (source[key] !== undefined && source[key] !== null) output[key] = String(source[key]);
    }
    const evidence = Array.isArray(source.evidence)
      ? source.evidence.map((item) => String(item))
      : [];
    if (!decisionReady && allowedAction !== originalAction) {
      evidence.push('数据质量未达到决策标准，请先补数。');
      output.confidence = 'low';
    }
    if (evidence.length) output.evidence = evidence;
    if (Number.isFinite(Number(source.reviewAfterDays))) {
      output.reviewAfterDays = Number(source.reviewAfterDays);
    }
    return output;
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
    if (typeof Buffer === 'function' && typeof Buffer.byteLength === 'function') {
      return Buffer.byteLength(value, 'utf8');
    }
    return encodeURIComponent(value).replace(/%[\dA-F]{2}|./gi, 'x').length;
  }

  function assertSnapshotWithinLimit(snapshot) {
    const serialized = JSON.stringify(snapshot);
    if (serialized === undefined) {
      throw new TypeError('XHS analysis snapshot must be JSON serializable.');
    }
    if (utf8ByteLength(serialized) >= MAX_SNAPSHOT_BYTES) {
      const error = new Error('XHS analysis snapshot exceeds the 8 MB archive limit.');
      error.code = 'XHS_SNAPSHOT_SIZE_LIMIT';
      throw error;
    }
    return snapshot;
  }

  function mapAnalysisSnapshot(input) {
    const options = isObject(input) ? input : {};
    const snapshot = isObject(options.analysisSnapshot) ? options.analysisSnapshot : {};
    const existingValues = isObject(options.existingValues) ? options.existingValues : {};
    const manualInputs = isObject(options.manualInputs) ? options.manualInputs : {};
    const context = createContext(snapshot);
    const management = isObject(snapshot.management) ? snapshot.management : {};
    const costs = isObject(management.costs) ? management.costs : {};
    const starResult = isObject(management.starTaskResult) ? management.starTaskResult : {};
    const starMetrics = isObject(starResult.metrics) ? starResult.metrics : {};
    const star = isObject(snapshot.star) ? snapshot.star : {};
    const starStore = isObject(star.store) ? star.store : {};
    const starStoreMetrics = isObject(starStore.metrics) ? starStore.metrics : {};
    const productSeeding = objective(snapshot, 'product_seeding') || {};
    const direct = objective(snapshot, 'direct') || {};
    const candidates = {};

    function candidateFor(key) {
      if (hasOwn(manualInputs, key) && manualInputs[key] !== undefined) return manualInputs[key];
      return hasOwn(existingValues, key) ? existingValues[key] : undefined;
    }

    candidates.xhs_kolSpend = resolveEntry(
      'xhs_kolSpend',
      automaticEntry('xhs_kolSpend', costs.partnership, context, 'pgy'),
      candidateFor('xhs_kolSpend'),
      context,
    );
    candidates.xhs_juguangSpend = resolveEntry(
      'xhs_juguangSpend',
      automaticEntry(
        'xhs_juguangSpend',
        firstDefined(costs.spotlight, costs.juguang, isObject(snapshot.spotlight) &&
          isObject(snapshot.spotlight.total) ? snapshot.spotlight.total.spend : undefined),
        context,
        'juguang',
      ),
      candidateFor('xhs_juguangSpend'),
      context,
    );

    let totalSpend;
    if (candidates.xhs_kolSpend && candidates.xhs_juguangSpend) {
      totalSpend = formulaEntry(
        'xhs_totalSpend',
        candidates.xhs_kolSpend.value + candidates.xhs_juguangSpend.value,
        [candidates.xhs_kolSpend, candidates.xhs_juguangSpend],
        context,
      );
    } else {
      totalSpend = automaticEntry('xhs_totalSpend', costs.total, context, 'pgy');
    }
    candidates.xhs_totalSpend = resolveEntry(
      'xhs_totalSpend',
      totalSpend,
      candidateFor('xhs_totalSpend'),
      context,
    );

    candidates.xhs_productSeedingSpend = resolveEntry(
      'xhs_productSeedingSpend',
      automaticEntry('xhs_productSeedingSpend', productSeeding.spend, context, 'juguang'),
      candidateFor('xhs_productSeedingSpend'),
      context,
    );
    candidates.xhs_seedingDirectSpend = resolveEntry(
      'xhs_seedingDirectSpend',
      automaticEntry('xhs_seedingDirectSpend', direct.spend, context, 'juguang'),
      candidateFor('xhs_seedingDirectSpend'),
      context,
    );
    candidates.xhs_xingheVisitors = resolveEntry(
      'xhs_xingheVisitors',
      automaticEntry(
        'xhs_xingheVisitors',
        firstDefined(
          starMetrics.storeVisitUv,
          starResult.storeVisitUv,
          starStoreMetrics.storeVisitUv,
        ),
        context,
        'adstar',
      ),
      candidateFor('xhs_xingheVisitors'),
      context,
    );
    candidates.xhs_storeGmv = resolveEntry(
      'xhs_storeGmv',
      automaticEntry(
        'xhs_storeGmv',
        firstDefined(starMetrics.gmv, starResult.storeGmv, starResult.gmv, starStoreMetrics.gmv),
        context,
        'adstar',
      ),
      candidateFor('xhs_storeGmv'),
      context,
    );
    candidates.xhs_taskGmv = resolveEntry(
      'xhs_taskGmv',
      automaticEntry(
        'xhs_taskGmv',
        firstDefined(
          starMetrics.seededProductGmv,
          starResult.seededProductGmv,
          starResult.taskGmv,
          starResult.gmv,
        ),
        context,
        'adstar',
      ),
      candidateFor('xhs_taskGmv'),
      context,
    );

    for (const key of DMP_METRIC_KEYS) {
      const preserved = hasOwn(existingValues, key)
        ? preservedEntry(key, existingValues[key], context)
        : undefined;
      candidates[key] = preserved || resolveEntry(key, undefined, candidateFor(key), context);
    }

    const pgy = isObject(snapshot.pgy) ? snapshot.pgy : {};
    const inputs = {};
    inputs.xhs_reportedNoteCount = resolveEntry(
      'xhs_reportedNoteCount',
      automaticEntry('xhs_reportedNoteCount', pgy.reportedNoteCount, context, 'pgy'),
      candidateFor('xhs_reportedNoteCount'),
      context,
    );
    inputs.xhs_unreportedNoteCount = resolveEntry(
      'xhs_unreportedNoteCount',
      undefined,
      candidateFor('xhs_unreportedNoteCount'),
      context,
    );

    function addFormula(key, value, dependencies) {
      candidates[key] = resolveEntry(
        key,
        formulaEntry(key, value, dependencies, context),
        candidateFor(key),
        context,
      );
    }

    if (candidates.xhs_kolSpend && candidates.xhs_juguangSpend) {
      addFormula(
        'xhs_kfsRatio',
        `${candidates.xhs_kolSpend.value}:${candidates.xhs_juguangSpend.value}`,
        [candidates.xhs_kolSpend, candidates.xhs_juguangSpend],
      );
    } else {
      candidates.xhs_kfsRatio = resolveEntry(
        'xhs_kfsRatio', undefined, candidateFor('xhs_kfsRatio'), context,
      );
    }

    if (inputs.xhs_reportedNoteCount && inputs.xhs_unreportedNoteCount) {
      const noteCount = inputs.xhs_reportedNoteCount.value + inputs.xhs_unreportedNoteCount.value;
      addFormula(
        'xhs_noteCount', noteCount,
        [inputs.xhs_reportedNoteCount, inputs.xhs_unreportedNoteCount],
      );
      if (noteCount !== 0) {
        addFormula(
          'xhs_reportedNoteShare', inputs.xhs_reportedNoteCount.value / noteCount,
          [inputs.xhs_reportedNoteCount, inputs.xhs_unreportedNoteCount],
        );
        addFormula(
          'xhs_unreportedNoteShare', inputs.xhs_unreportedNoteCount.value / noteCount,
          [inputs.xhs_reportedNoteCount, inputs.xhs_unreportedNoteCount],
        );
      } else {
        for (const key of ['xhs_reportedNoteShare', 'xhs_unreportedNoteShare']) {
          candidates[key] = resolveEntry(key, undefined, candidateFor(key), context);
        }
      }
    } else {
      for (const key of ['xhs_noteCount', 'xhs_reportedNoteShare', 'xhs_unreportedNoteShare']) {
        candidates[key] = resolveEntry(key, undefined, candidateFor(key), context);
      }
    }

    addFormula(
      'xhs_visitFrequency',
      candidates.xhs_xingheVisitors && candidates.xhs_dmpVisitors
        ? safeDivide(candidates.xhs_xingheVisitors.value, candidates.xhs_dmpVisitors.value)
        : undefined,
      [candidates.xhs_xingheVisitors, candidates.xhs_dmpVisitors],
    );
    addFormula(
      'xhs_visitCost',
      candidates.xhs_totalSpend && candidates.xhs_xingheVisitors
        ? safeDivide(candidates.xhs_totalSpend.value, candidates.xhs_xingheVisitors.value)
        : undefined,
      [candidates.xhs_totalSpend, candidates.xhs_xingheVisitors],
    );
    addFormula(
      'xhs_storeRoi',
      candidates.xhs_storeGmv && candidates.xhs_totalSpend
        ? safeDivide(candidates.xhs_storeGmv.value, candidates.xhs_totalSpend.value)
        : undefined,
      [candidates.xhs_storeGmv, candidates.xhs_totalSpend],
    );
    addFormula(
      'xhs_taskRoi',
      candidates.xhs_taskGmv && candidates.xhs_totalSpend
        ? safeDivide(candidates.xhs_taskGmv.value, candidates.xhs_totalSpend.value)
        : undefined,
      [candidates.xhs_taskGmv, candidates.xhs_totalSpend],
    );
    addFormula(
      'xhs_contentAudienceShare',
      candidates.xhs_contentAudienceAsset && candidates.xhs_storeAudienceAsset
        ? safeDivide(
          candidates.xhs_contentAudienceAsset.value,
          candidates.xhs_storeAudienceAsset.value,
        )
        : undefined,
      [candidates.xhs_contentAudienceAsset, candidates.xhs_storeAudienceAsset],
    );
    addFormula(
      'xhs_l45OverL12',
      candidates.xhs_l45Penetration && candidates.xhs_l12Penetration
        ? safeDivide(candidates.xhs_l45Penetration.value, candidates.xhs_l12Penetration.value)
        : undefined,
      [candidates.xhs_l45Penetration, candidates.xhs_l12Penetration],
    );

    const values = {};
    for (const key of XHS_METRIC_KEYS) {
      if (candidates[key]) values[key] = candidates[key];
    }
    const compactInputs = {};
    for (const key of ['xhs_reportedNoteCount', 'xhs_unreportedNoteCount']) {
      if (inputs[key]) compactInputs[key] = inputs[key];
    }

    const quality = isObject(snapshot.quality) ? snapshot.quality : {};
    const decisionReady = quality.decisionReady === true;
    const issues = Array.isArray(quality.issues)
      ? quality.issues.map(safeIssue).filter(Boolean)
      : [];
    const actions = Array.isArray(snapshot.actions)
      ? snapshot.actions.map((item) => safeAction(item, decisionReady)).filter(Boolean)
      : [];
    const result = contract.sanitizeSensitiveData({
      schemaVersion: 1,
      generatedAt: context.generatedAt,
      dateRange: context.dateRange,
      values,
      inputs: compactInputs,
      decisionReady,
      issues,
      actions,
    });
    assertSnapshotWithinLimit(result);
    return result;
  }

  return Object.freeze({
    MAX_SNAPSHOT_BYTES,
    XHS_METRIC_KEYS,
    assertSnapshotWithinLimit,
    mapAnalysisSnapshot,
  });
});
