(function initXhsSearchClassification(root, factory) {
  const api = factory();
  Object.defineProperty(api, 'standaloneSource', {
    value: '(' + factory.toString() + ')()',
    enumerable: false,
  });
  Object.freeze(api);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsSearchClassification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsSearchClassificationApi() {
  'use strict';

  const LIMITS = Object.freeze({
    termLength: 64,
    factTerms: 200,
    keywordLength: 160,
    scopeKeyLength: 160,
    revisionLength: 64,
    idLength: 96,
    reasonLength: 160,
    manualOverrides: 500,
    topicTags: 12,
    intents: 8,
    evidenceTerms: 8,
    qwenItems: 200,
  });

  const PROFILE_INDUSTRIES = Object.freeze({
    'sheba-cat-food-v1': 'pet',
    'home-furnishing-v1': 'furniture',
    'health-supplements-v1': 'health_supplements',
    'cross-industry-generic-v1': 'generic',
  });

  const ENTITY_LABELS = Object.freeze({
    own_product: '自有产品',
    own_brand: '自有品牌',
    competitor: '竞品',
    generic_category: '泛品类',
    unknown: '未知',
  });

  const TOPIC_LABELS = Object.freeze({
    core_category: '核心品类',
    need_pain_point: '需求/痛点',
    usage_scenario: '使用场景',
    adjacent_category: '邻近品类',
    industry_interest: '行业兴趣',
    unrelated: '无关',
    safety_adverse_effect: '安全/副作用',
  });

  const INTENT_LABELS = Object.freeze({
    brand_product_lookup: '品牌/产品查找',
    category_exploration: '品类探索',
    problem_solving: '问题解决',
    comparison: '对比评估',
    purchase_decision: '购买决策',
    usage: '使用方法',
    interest_browsing: '兴趣浏览',
    unclear: '意图不明确',
  });

  const RELEVANCE_LABELS = Object.freeze({
    strong: '强相关',
    medium: '中相关',
    weak: '弱相关',
    none: '无关',
    review: '待确认',
  });

  const TOPIC_PRIORITY = Object.freeze([
    'safety_adverse_effect',
    'need_pain_point',
    'core_category',
    'usage_scenario',
    'adjacent_category',
    'industry_interest',
    'unrelated',
  ]);

  const INTENT_PRIORITY = Object.freeze([
    'purchase_decision',
    'comparison',
    'problem_solving',
    'usage',
    'brand_product_lookup',
    'category_exploration',
    'interest_browsing',
    'unclear',
  ]);

  const COMPONENT_SOURCES = Object.freeze(new Set([
    'override', 'fact', 'qwen', 'rule', 'heuristic', 'hybrid',
  ]));

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function cleanText(value, maximumLength, collapseWhitespace) {
    if (typeof value !== 'string') return '';
    let text = value.normalize('NFKC').trim();
    if (collapseWhitespace !== false) text = text.replace(/\s+/gu, ' ');
    if (!text || text.length > maximumLength) return '';
    return text;
  }

  function normalizedKeyword(value) {
    const text = cleanText(value, LIMITS.keywordLength, true);
    return text ? text.toLocaleLowerCase('zh-CN') : '';
  }

  function normalizedScopeKey(value) {
    return cleanText(value, LIMITS.scopeKeyLength, true) || '*';
  }

  function safeId(value) {
    const text = cleanText(value, LIMITS.idLength, false);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) ? text : '';
  }

  function safeRevision(value) {
    const text = cleanText(value, LIMITS.revisionLength, false);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) ? text : 'unversioned';
  }

  function finiteScore(value, fallback) {
    const score = Number(value);
    return Number.isFinite(score) && score >= 0 && score <= 1 ? score : fallback;
  }

  function uniqueStrings(values, maximumCount, maximumLength, normalizeForIdentity) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const text = cleanText(value, maximumLength, true);
      if (!text) continue;
      const identity = normalizeForIdentity === false ? text : text.toLocaleLowerCase('zh-CN');
      if (seen.has(identity)) continue;
      seen.add(identity);
      output.push(text);
      if (output.length >= maximumCount) break;
    }
    return output;
  }

  function enumValues(values, dictionary, maximumCount) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const id = typeof value === 'string'
        ? value
        : isObject(value) && typeof value.id === 'string' ? value.id : '';
      if (!Object.prototype.hasOwnProperty.call(dictionary, id) || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
      if (result.length >= maximumCount) break;
    }
    return result;
  }

  function highestPriorityValue(values, priority) {
    const positions = new Map(priority.map((value, index) => [value, index]));
    return (Array.isArray(values) ? values : []).slice().sort((left, right) => (
      (positions.has(left) ? positions.get(left) : Number.MAX_SAFE_INTEGER) -
      (positions.has(right) ? positions.get(right) : Number.MAX_SAFE_INTEGER)
    ))[0] || '';
  }

  function normalizeOverridePatch(value) {
    const source = isObject(value) ? value : {};
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(ENTITY_LABELS, source.entityRelation)) {
      patch.entityRelation = source.entityRelation;
    }
    const topicCandidates = enumValues(source.topicTagIds, TOPIC_LABELS, LIMITS.topicTags);
    if (topicCandidates.length || Array.isArray(source.topicTagIds)) {
      const topicTagId = highestPriorityValue(topicCandidates, TOPIC_PRIORITY);
      patch.topicTagIds = topicTagId ? [topicTagId] : [];
    }
    const intentCandidates = enumValues(source.intentIds, INTENT_LABELS, LIMITS.intents);
    const explicitPrimary = Object.prototype.hasOwnProperty.call(INTENT_LABELS, source.primaryIntentId)
      ? source.primaryIntentId
      : '';
    if (explicitPrimary && !intentCandidates.includes(explicitPrimary)) {
      intentCandidates.push(explicitPrimary);
    }
    if (intentCandidates.length || Array.isArray(source.intentIds) || explicitPrimary) {
      const intentId = explicitPrimary || highestPriorityValue(intentCandidates, INTENT_PRIORITY);
      patch.intentIds = intentId ? [intentId] : [];
      if (intentId) patch.primaryIntentId = intentId;
    }
    if (Object.prototype.hasOwnProperty.call(RELEVANCE_LABELS, source.relevance)) {
      patch.relevance = source.relevance;
    }
    return Object.keys(patch).length ? patch : null;
  }

  function normalizeManualOverride(value) {
    const source = isObject(value) ? value : {};
    const keyword = normalizedKeyword(source.normalizedKeyword || source.keyword);
    const patch = normalizeOverridePatch(source.patch);
    if (!keyword || !patch) return null;
    const requestedId = safeId(source.id);
    const id = requestedId || 'manual:' + keyword;
    const reason = cleanText(source.reason, LIMITS.reasonLength, true);
    return deepFreeze({
      id,
      scopeKey: normalizedScopeKey(source.scopeKey),
      normalizedKeyword: keyword,
      active: source.active !== false,
      reason,
      patch,
    });
  }

  function normalizeConfig(value) {
    const source = isObject(value) ? value : {};
    const requestedProfile = cleanText(source.profileId, LIMITS.idLength, false);
    const profileId = Object.prototype.hasOwnProperty.call(PROFILE_INDUSTRIES, requestedProfile)
      ? requestedProfile
      : 'cross-industry-generic-v1';
    const customIndustry = profileId === 'cross-industry-generic-v1'
      ? cleanText(source.customIndustry, 120, true)
      : '';
    const facts = isObject(source.facts) ? source.facts : {};
    const manualOverrides = [];
    for (const rawOverride of Array.isArray(source.manualOverrides) ? source.manualOverrides : []) {
      const override = normalizeManualOverride(rawOverride);
      if (override) manualOverrides.push(override);
      if (manualOverrides.length >= LIMITS.manualOverrides) break;
    }
    return deepFreeze({
      schema: 'xhsSearchClassificationConfigV1',
      schemaVersion: 1,
      profileId,
      industry: customIndustry ? 'custom' : PROFILE_INDUSTRIES[profileId],
      customIndustry,
      revision: safeRevision(source.revision),
      facts: {
        ownBrands: uniqueStrings(facts.ownBrands, LIMITS.factTerms, LIMITS.termLength),
        ownProducts: uniqueStrings(facts.ownProducts, LIMITS.factTerms, LIMITS.termLength),
        competitors: uniqueStrings(facts.competitors, LIMITS.factTerms, LIMITS.termLength),
      },
      manualOverrides,
    });
  }

  function normalizedSource(value, fallback) {
    return COMPONENT_SOURCES.has(value) ? value : fallback;
  }

  function normalizeEvidence(values) {
    return uniqueStrings(values, LIMITS.evidenceTerms, LIMITS.termLength);
  }

  function normalizeTopicTags(values, fallbackSource) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const source = typeof value === 'string' ? { id: value } : isObject(value) ? value : {};
      const id = source.id;
      if (!Object.prototype.hasOwnProperty.call(TOPIC_LABELS, id) || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        label: TOPIC_LABELS[id],
        evidence: normalizeEvidence(source.evidence),
        source: normalizedSource(source.source, fallbackSource),
      });
      if (result.length >= LIMITS.topicTags) break;
    }
    if (!result.length) return result;
    const selectedId = highestPriorityValue(result.map((item) => item.id), TOPIC_PRIORITY);
    return result.filter((item) => item.id === selectedId).slice(0, 1);
  }

  function normalizeIntents(values, requestedPrimaryId, fallbackSource, preferRequestedPrimary) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const source = typeof value === 'string' ? { id: value } : isObject(value) ? value : {};
      const id = source.id;
      if (!Object.prototype.hasOwnProperty.call(INTENT_LABELS, id) || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        label: INTENT_LABELS[id],
        isPrimary: false,
        evidence: normalizeEvidence(source.evidence),
        source: normalizedSource(source.source, fallbackSource),
      });
      if (result.length >= LIMITS.intents) break;
    }
    const requestedIsAvailable = Object.prototype.hasOwnProperty.call(
      INTENT_LABELS, requestedPrimaryId
    ) && seen.has(requestedPrimaryId);
    const primaryId = preferRequestedPrimary && requestedIsAvailable
      ? requestedPrimaryId
      : highestPriorityValue(result.map((intent) => intent.id), INTENT_PRIORITY);
    const selected = result.find((intent) => intent.id === primaryId);
    if (!selected) return [];
    selected.isPrimary = true;
    return [selected];
  }

  function normalizeReasonCodes(values) {
    return uniqueStrings(values, 24, 64, false).filter((value) => (
      /^[A-Z0-9_:-]+$/.test(value)
    ));
  }

  function normalizeRuleClassification(value) {
    const source = isObject(value) ? value : {};
    const defaultSource = normalizedSource(source.source, 'heuristic');
    const rawEntity = isObject(source.entity) ? source.entity : {};
    const requestedRelation = rawEntity.relation || source.entityRelation;
    const relation = Object.prototype.hasOwnProperty.call(ENTITY_LABELS, requestedRelation)
      ? requestedRelation
      : 'unknown';
    const relevanceId = isObject(source.relevance) ? source.relevance.id : source.relevance;
    const relevance = Object.prototype.hasOwnProperty.call(RELEVANCE_LABELS, relevanceId)
      ? relevanceId
      : 'review';
    const score = finiteScore(source.confidenceScore, 0.35);
    const topicValues = source.topicTags || source.topicTagIds;
    const intentValues = source.intents || source.intentIds;
    const topicTags = normalizeTopicTags(topicValues, defaultSource);
    const intents = normalizeIntents(intentValues, source.primaryIntentId, defaultSource, false);
    const result = {
      schema: 'xhsSearchClassificationV2',
      schemaVersion: 2,
      entity: {
        relation,
        label: ENTITY_LABELS[relation],
        matchedTerm: cleanText(rawEntity.matchedTerm || source.matchedTerm, LIMITS.termLength, true) || null,
        source: normalizedSource(rawEntity.source, defaultSource),
        lockedByFact: rawEntity.lockedByFact === true,
      },
      topicTags,
      intents,
      relevance: {
        id: relevance,
        label: RELEVANCE_LABELS[relevance],
        source: normalizedSource(isObject(source.relevance) && source.relevance.source, defaultSource),
      },
      source: defaultSource,
      confidenceScore: score,
      needsReview: source.needsReview === true || relation === 'unknown' || relevance === 'review' ||
        score < 0.75 || intents.length === 0 || intents.some((intent) => intent.id === 'unclear'),
      reasonCodes: normalizeReasonCodes(source.reasonCodes),
    };
    return deepFreeze(result);
  }

  function qwenItemId(value) {
    const source = isObject(value) ? value : {};
    return safeId(source.itemId) || safeId(source.id);
  }

  function normalizeQwenSemanticResult(value) {
    const source = isObject(value) ? value : {};
    if (source.status && source.status !== 'classified') return null;
    if (!Array.isArray(source.topicTagIds) || !Array.isArray(source.intentIds)) return null;
    if (source.topicTagIds.length > LIMITS.topicTags || source.intentIds.length > LIMITS.intents) return null;
    const topicTagIds = enumValues(source.topicTagIds, TOPIC_LABELS, LIMITS.topicTags);
    const intentIds = enumValues(source.intentIds, INTENT_LABELS, LIMITS.intents);
    if (topicTagIds.length !== source.topicTagIds.length || intentIds.length !== source.intentIds.length) {
      return null;
    }
    const primaryIntentId = typeof source.primaryIntentId === 'string' ? source.primaryIntentId : '';
    if ((intentIds.length && !intentIds.includes(primaryIntentId)) || (!intentIds.length && primaryIntentId)) {
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(RELEVANCE_LABELS, source.relevance)) return null;
    const confidenceScore = finiteScore(source.confidenceScore, null);
    if (confidenceScore === null) return null;
    const rawRationale = source.rationale !== undefined ? source.rationale : source.reason;
    const rationale = rawRationale === undefined || rawRationale === null
      ? ''
      : cleanText(rawRationale, LIMITS.reasonLength, true);
    if ((rawRationale !== undefined && rawRationale !== null) && !rationale) return null;
    return {
      topicTagIds,
      intentIds,
      primaryIntentId,
      relevance: source.relevance,
      confidenceScore,
      rationale,
    };
  }

  function validateQwenBatchResponse(requestValue, responseValue) {
    const request = isObject(requestValue) ? requestValue : {};
    const response = isObject(responseValue) ? responseValue : {};
    const requestedItems = (Array.isArray(request.items) ? request.items : [])
      .slice(0, LIMITS.qwenItems);
    const responseGroups = new Map();
    for (const item of Array.isArray(response.items) ? response.items : []) {
      const itemId = qwenItemId(item);
      if (!itemId) continue;
      if (!responseGroups.has(itemId)) responseGroups.set(itemId, []);
      responseGroups.get(itemId).push(item);
    }
    return requestedItems.map((requested) => {
      const itemId = qwenItemId(requested);
      const matches = itemId ? responseGroups.get(itemId) || [] : [];
      if (!itemId || matches.length !== 1) {
        return deepFreeze({
          itemId,
          status: 'abstained',
          errorCode: matches.length > 1 ? 'QWEN_ITEM_DUPLICATE' : 'QWEN_ITEM_MISSING',
        });
      }
      const responseItem = matches[0];
      if (responseItem.status === 'abstained') {
        return deepFreeze({ itemId, status: 'abstained', errorCode: 'QWEN_ABSTAINED' });
      }
      if (responseItem.status !== 'classified') {
        return deepFreeze({ itemId, status: 'abstained', errorCode: 'QWEN_ITEM_INVALID' });
      }
      const result = normalizeQwenSemanticResult(responseItem);
      if (!result) {
        return deepFreeze({ itemId, status: 'abstained', errorCode: 'QWEN_ITEM_INVALID' });
      }
      return deepFreeze({ itemId, status: 'classified', result });
    });
  }

  function firstFactMatch(keyword, values) {
    const normalizedValues = (Array.isArray(values) ? values : []).map((term) => ({
      term,
      normalized: normalizedKeyword(term),
    })).filter((item) => item.normalized).sort((left, right) => (
      right.normalized.length - left.normalized.length
    ));
    return normalizedValues.find((item) => keyword.includes(item.normalized)) || null;
  }

  function resolveFactEntity(keyword, config, fallbackEntity) {
    const brand = firstFactMatch(keyword, config.facts.ownBrands);
    if (brand) {
      return {
        relation: 'own_brand', label: ENTITY_LABELS.own_brand,
        matchedTerm: brand.term, source: 'fact', lockedByFact: true,
      };
    }
    const competitor = firstFactMatch(keyword, config.facts.competitors);
    if (competitor) {
      return {
        relation: 'competitor', label: ENTITY_LABELS.competitor,
        matchedTerm: competitor.term, source: 'fact', lockedByFact: true,
      };
    }
    const product = firstFactMatch(keyword, config.facts.ownProducts);
    if (product) {
      return {
        relation: 'own_product', label: ENTITY_LABELS.own_product,
        matchedTerm: product.term, source: 'fact', lockedByFact: true,
      };
    }
    return { ...fallbackEntity };
  }

  function findManualOverride(config, keyword, scopeKey) {
    const candidates = config.manualOverrides.filter((override) => (
      override.active && override.normalizedKeyword === keyword &&
      (override.scopeKey === scopeKey || override.scopeKey === '*')
    ));
    return candidates.find((override) => override.scopeKey === scopeKey) || candidates[0] || null;
  }

  function tagsFromIds(ids, source) {
    return normalizeTopicTags(ids.map((id) => ({ id, source })), source);
  }

  function intentsFromIds(ids, primaryIntentId, source, preferRequestedPrimary) {
    return normalizeIntents(
      ids.map((id) => ({ id, source })),
      primaryIntentId,
      source,
      preferRequestedPrimary === true
    );
  }

  function resolveClassification(value) {
    const source = isObject(value) ? value : {};
    const config = normalizeConfig(source.config);
    const keyword = normalizedKeyword(source.keyword);
    const scopeKey = normalizedScopeKey(source.scopeKey);
    const heuristic = normalizeRuleClassification(source.heuristic);
    let entity = resolveFactEntity(keyword, config, heuristic.entity);
    let topicTags = heuristic.topicTags.map((item) => ({ ...item, evidence: item.evidence.slice() }));
    let intents = heuristic.intents.map((item) => ({ ...item, evidence: item.evidence.slice() }));
    let relevance = { ...heuristic.relevance };
    let confidenceScore = heuristic.confidenceScore;
    const reasonCodes = heuristic.reasonCodes.slice();
    let hasQwen = false;
    let qwenError = '';
    const qwen = isObject(source.qwen) ? source.qwen : {};
    if (qwen.status === 'classified') {
      const semantic = normalizeQwenSemanticResult(qwen.result);
      if (semantic) {
        topicTags = tagsFromIds(semantic.topicTagIds, 'qwen');
        intents = intentsFromIds(semantic.intentIds, semantic.primaryIntentId, 'qwen', false);
        relevance = {
          id: semantic.relevance,
          label: RELEVANCE_LABELS[semantic.relevance],
          source: 'qwen',
        };
        confidenceScore = semantic.confidenceScore;
        reasonCodes.push('QWEN_SEMANTIC_ENRICHED');
        hasQwen = true;
      } else {
        qwenError = 'QWEN_ITEM_INVALID';
      }
    } else if (qwen.status === 'abstained') {
      qwenError = /^[A-Z0-9_:-]{1,64}$/.test(String(qwen.errorCode || ''))
        ? String(qwen.errorCode)
        : 'QWEN_ABSTAINED';
    }
    if (qwenError) reasonCodes.push(qwenError);
    if (entity.source === 'fact') reasonCodes.push('FACT_' + entity.relation.toUpperCase());

    const manualOverride = findManualOverride(config, keyword, scopeKey);
    if (manualOverride) {
      const patch = manualOverride.patch;
      if (patch.entityRelation) {
        entity = {
          relation: patch.entityRelation,
          label: ENTITY_LABELS[patch.entityRelation],
          matchedTerm: keyword || null,
          source: 'override',
          lockedByFact: false,
        };
      }
      if (patch.topicTagIds) topicTags = tagsFromIds(patch.topicTagIds, 'override');
      if (patch.intentIds) {
        intents = intentsFromIds(patch.intentIds, patch.primaryIntentId, 'override', true);
      } else if (patch.primaryIntentId) {
        intents = intentsFromIds(
          [patch.primaryIntentId], patch.primaryIntentId, 'override', true
        );
      }
      if (patch.relevance) {
        relevance = {
          id: patch.relevance,
          label: RELEVANCE_LABELS[patch.relevance],
          source: 'override',
        };
      }
      confidenceScore = 1;
      reasonCodes.push('MANUAL_OVERRIDE');
    }

    const resultSource = manualOverride
      ? 'override'
      : hasQwen
        ? 'hybrid'
        : entity.source === 'fact'
          ? 'fact'
          : heuristic.source;
    const needsReview = manualOverride ? false : entity.relation === 'unknown' ||
      relevance.id === 'review' || confidenceScore < 0.75 || intents.length === 0 ||
      intents.some((intent) => intent.id === 'unclear') || Boolean(qwenError);
    return deepFreeze({
      schema: 'xhsSearchClassificationV2',
      schemaVersion: 2,
      entity,
      topicTags,
      intents,
      relevance,
      source: resultSource,
      confidenceScore,
      needsReview,
      reasonCodes: normalizeReasonCodes(reasonCodes),
      appliedOverrideId: manualOverride ? manualOverride.id : null,
    });
  }

  function interestCategory(profileId) {
    if (profileId === 'sheba-cat-food-v1') return '泛宠物兴趣词';
    if (profileId === 'home-furnishing-v1') return '泛家居兴趣词';
    if (profileId === 'health-supplements-v1') return '泛健康兴趣词';
    return '泛行业兴趣词';
  }

  function legacyCommercialCategory(value, profileId) {
    const relation = value.entity.relation;
    if (relation === 'own_brand') return '自有品牌词';
    if (relation === 'competitor') return '竞品词';
    if (relation === 'own_product') return '自有产品词';
    const topics = new Set(value.topicTags.map((tag) => tag.id));
    if (topics.has('need_pain_point') || topics.has('safety_adverse_effect')) return '品类需求词';
    if (topics.has('core_category')) return '核心品类词';
    if (topics.has('usage_scenario') || topics.has('adjacent_category')) return '邻近品类/场景';
    if (topics.has('industry_interest')) return interestCategory(profileId);
    if (topics.has('unrelated')) return '无关词';
    return '待确认';
  }

  function usageIntentLabel(profileId) {
    if (profileId === 'sheba-cat-food-v1') return '使用/喂养';
    if (profileId === 'home-furnishing-v1') return '使用/养护';
    if (profileId === 'health-supplements-v1') return '服用/使用';
    return '使用方法';
  }

  function confidenceLabel(score) {
    return score >= 0.8 ? '高' : score >= 0.5 ? '中' : '低';
  }

  function classificationReason(value) {
    if (value.source === 'override') return '人工修正分类';
    if (value.source === 'hybrid') return '规则与千问语义联合分类';
    if (value.source === 'fact') return '店铺事实与规则分类';
    if (value.source === 'qwen') return '千问语义分类';
    return '规则自动分类';
  }

  function projectLegacyFields(value, optionsValue) {
    const classification = normalizeRuleClassification(value);
    const options = isObject(optionsValue) ? optionsValue : {};
    const requestedProfile = cleanText(options.profileId, LIMITS.idLength, false);
    const profileId = Object.prototype.hasOwnProperty.call(PROFILE_INDUSTRIES, requestedProfile)
      ? requestedProfile
      : 'cross-industry-generic-v1';
    const primary = classification.intents.find((intent) => intent.isPrimary) || null;
    const intentLabel = primary
      ? primary.id === 'usage' ? usageIntentLabel(profileId) : INTENT_LABELS[primary.id]
      : '意图不明确';
    const primarySource = primary && primary.source;
    return {
      commercialCategory: legacyCommercialCategory(classification, profileId),
      relevance: RELEVANCE_LABELS[classification.relevance.id],
      intent: intentLabel,
      confidenceScore: classification.confidenceScore,
      confidence: confidenceLabel(classification.confidenceScore),
      classificationReason: classificationReason(classification),
      intentReason: primarySource === 'override'
        ? '人工修正主意图：' + intentLabel
        : primarySource === 'qwen'
          ? '千问识别主意图：' + intentLabel
          : primary
            ? '规则识别主意图：' + intentLabel
            : '关键词缺少足够的行为意图信号',
    };
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isObject(value)) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
      return null;
    }
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined && typeof value[key] !== 'function') {
        result[key] = stableValue(value[key]);
      }
      return result;
    }, {});
  }

  function normalizedCacheRuleCandidate(value) {
    const source = isObject(value) ? value : {};
    const entity = isObject(source.entity) ? source.entity.relation : source.entityRelation;
    return {
      entityRelation: Object.prototype.hasOwnProperty.call(ENTITY_LABELS, entity) ? entity : 'unknown',
      topicTagIds: enumValues(
        source.topicTagIds || source.topicTags, TOPIC_LABELS, LIMITS.topicTags
      ).sort(),
      intentIds: enumValues(
        source.intentIds || source.intents, INTENT_LABELS, LIMITS.intents
      ).sort(),
      primaryIntentId: Object.prototype.hasOwnProperty.call(INTENT_LABELS, source.primaryIntentId)
        ? source.primaryIntentId
        : '',
      relevance: Object.prototype.hasOwnProperty.call(RELEVANCE_LABELS,
        isObject(source.relevance) ? source.relevance.id : source.relevance)
        ? (isObject(source.relevance) ? source.relevance.id : source.relevance)
        : 'review',
      confidenceScore: finiteScore(source.confidenceScore, null),
    };
  }

  function compactStableHash(value) {
    const text = String(value);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193) >>> 0;
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b) >>> 0;
    }
    return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
  }

  function createCacheKey(value) {
    const source = isObject(value) ? value : {};
    const config = normalizeConfig(source.config);
    const semantic = isObject(source.semantic) ? source.semantic : {};
    const input = {
      schemaVersion: 2,
      keyword: normalizedKeyword(source.keyword),
      scopeKey: normalizedScopeKey(source.scopeKey),
      profileId: config.profileId,
      industry: config.industry,
      customIndustry: config.customIndustry,
      factRevision: config.revision,
      facts: {
        ownBrands: config.facts.ownBrands.slice().sort(),
        ownProducts: config.facts.ownProducts.slice().sort(),
        competitors: config.facts.competitors.slice().sort(),
      },
      semantic: {
        provider: cleanText(semantic.provider, LIMITS.idLength, false),
        model: cleanText(semantic.model, LIMITS.idLength, false),
        promptVersion: cleanText(semantic.promptVersion, LIMITS.idLength, false),
      },
      ruleCandidate: normalizedCacheRuleCandidate(source.ruleCandidate),
    };
    return 'xhs-search-classification-v2:' + compactStableHash(
      JSON.stringify(stableValue(input))
    );
  }

  function compactClassification(value) {
    const normalized = normalizeRuleClassification(value);
    return {
      schema: normalized.schema,
      schemaVersion: normalized.schemaVersion,
      entity: normalized.entity,
      topicTags: normalized.topicTags,
      intents: normalized.intents,
      relevance: normalized.relevance,
      source: normalized.source,
      confidenceScore: normalized.confidenceScore,
      needsReview: normalized.needsReview,
      reasonCodes: normalized.reasonCodes,
    };
  }

  function createArchiveEntry(value) {
    const source = isObject(value) ? value : {};
    const keyword = normalizedKeyword(source.normalizedKeyword || source.keyword);
    const cacheKey = cleanText(source.cacheKey, 64, false);
    if (!keyword || !/^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(cacheKey)) {
      throw new Error('Classification archive entry requires a keyword and valid cacheKey.');
    }
    return deepFreeze({
      cacheKey,
      normalizedKeyword: keyword,
      scopeKey: normalizedScopeKey(source.scopeKey),
      automatic: compactClassification(source.automatic),
      effective: compactClassification(source.effective),
      appliedOverrideId: safeId(source.appliedOverrideId) || null,
    });
  }

  function findArchiveEntry(archiveValue, queryValue) {
    const entries = Array.isArray(archiveValue)
      ? archiveValue
      : isObject(archiveValue) && Array.isArray(archiveValue.entries) ? archiveValue.entries : [];
    const query = isObject(queryValue) ? queryValue : {};
    const rawCacheKey = cleanText(query.cacheKey, 64, false);
    const requestedCacheKey = /^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(rawCacheKey)
      ? rawCacheKey
      : '';
    if (requestedCacheKey) {
      const byCacheKey = entries.find((entry) => (
        isObject(entry) && entry.cacheKey === requestedCacheKey
      ));
      if (byCacheKey) return byCacheKey;
    }
    const keyword = normalizedKeyword(query.normalizedKeyword || query.keyword);
    if (!keyword) return null;
    const scopeKey = normalizedScopeKey(query.scopeKey);
    return entries.find((entry) => (
      isObject(entry) && entry.normalizedKeyword === keyword && entry.scopeKey === scopeKey
    )) || null;
  }

  return {
    LIMITS,
    PROFILE_INDUSTRIES,
    ENTITY_LABELS,
    TOPIC_LABELS,
    INTENT_LABELS,
    RELEVANCE_LABELS,
    TOPIC_PRIORITY,
    INTENT_PRIORITY,
    normalizeConfig,
    normalizeRuleClassification,
    validateQwenBatchResponse,
    resolveClassification,
    projectLegacyFields,
    createCacheKey,
    createArchiveEntry,
    findArchiveEntry,
  };
});
