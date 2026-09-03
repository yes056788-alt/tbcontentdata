(function initSearchClassificationClient(root, factory) {
  const core = typeof module === 'object' && module.exports
    ? require('../xhs/search-classification')
    : root.XhsSearchClassification;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsSearchClassificationClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSearchClassificationClient(core) {
  'use strict';

  if (!core) throw new Error('XhsSearchClassification must be loaded first.');

  const ENDPOINT = '/api/search-keyword-classifications';
  const PROMPT_VERSION = 'xhs-search-industry-rules-v1';
  const TAXONOMY_VERSION = 'xhs-search-taxonomy-v2';
  const RULESET_VERSION = 'xhs-search-sheba-style-v3';
  const DEFAULT_MODEL = 'gpt-5.4-mini-2026-03-17';
  const CREDENTIAL_VERSION_HEADER = 'X-OpenAI-Credential-Version';
  const MODEL_BATCH_SIZE = 30;
  const MAX_SEMANTIC_CANDIDATES = 300;

  const COMMERCIAL_ENTITY = Object.freeze({
    '自有品牌词': 'own_brand',
    '竞品词': 'competitor',
    '自有产品词': 'own_product',
  });
  const COMMERCIAL_TOPIC = Object.freeze({
    '品类需求词': 'need_pain_point',
    '核心品类词': 'core_category',
    '邻近品类/场景': 'adjacent_category',
    '泛宠物兴趣词': 'industry_interest',
    '泛家居兴趣词': 'industry_interest',
    '泛健康兴趣词': 'industry_interest',
    '泛行业兴趣词': 'industry_interest',
    '无关词': 'unrelated',
  });
  const RELEVANCE_IDS = Object.freeze({
    '强相关': 'strong', '中相关': 'medium', '弱相关': 'weak', '无关': 'none', '待确认': 'review',
  });
  const INTENT_IDS = Object.freeze({
    '品牌/产品查找': 'brand_product_lookup',
    '品类探索': 'category_exploration',
    '问题解决': 'problem_solving',
    '对比评估': 'comparison',
    '购买决策': 'purchase_decision',
    '使用/喂养': 'usage',
    '使用/养护': 'usage',
    '服用/使用': 'usage',
    '使用方法': 'usage',
    '兴趣浏览': 'interest_browsing',
    '意图不明确': 'unclear',
  });

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value, maximum) {
    const text = String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/gu, ' ');
    return text && text.length <= maximum ? text : '';
  }

  function normalizedKeyword(value) {
    return cleanText(value, 160).toLocaleLowerCase('zh-CN');
  }

  function normalizedRevision(value) {
    if (Number.isSafeInteger(Number(value)) && Number(value) >= 0) return 'r' + Number(value);
    const text = cleanText(value, 64);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text) ? text : 'unversioned';
  }

  function normalizeStoreClassification(value, resolvedProfileId) {
    const source = isObject(value) ? value : {};
    const requestedProfile = cleanText(source.profileId, 96);
    const profileId = !requestedProfile || requestedProfile === 'auto'
      ? cleanText(resolvedProfileId, 96)
      : requestedProfile;
    return core.normalizeConfig({
      profileId,
      customIndustry: source.customIndustry,
      revision: normalizedRevision(source.revision),
      facts: {
        ownBrands: source.ownBrandTerms,
        ownProducts: source.ownProductTerms,
        competitors: source.competitorTerms,
      },
      manualOverrides: source.manualOverrides,
    });
  }

  function ruleClassificationFromRow(value) {
    const row = isObject(value) ? value : {};
    const commercial = cleanText(row.commercialCategory, 64);
    const entityRelation = COMMERCIAL_ENTITY[commercial] ||
      (commercial === '待确认' ? 'unknown' : 'generic_category');
    const topicId = COMMERCIAL_TOPIC[commercial] || '';
    const intentId = INTENT_IDS[cleanText(row.intent, 64)] || 'unclear';
    return core.normalizeRuleClassification({
      entityRelation,
      topicTags: topicId ? [{ id: topicId, source: 'rule' }] : [],
      intents: [{ id: intentId, isPrimary: true, source: 'rule' }],
      relevance: RELEVANCE_IDS[cleanText(row.relevance, 64)] || 'review',
      confidenceScore: Number(row.confidenceScore),
      source: 'rule',
      reasonCodes: ['RULE_LEGACY_CLASSIFICATION'],
    });
  }

  function semanticOptions(storeClassification) {
    const semantic = isObject(storeClassification && storeClassification.semantic)
      ? storeClassification.semantic
      : {};
    const enabled = semantic.enabled === true;
    return {
      enabled,
      provider: enabled ? 'openai' : 'rules',
      model: enabled ? DEFAULT_MODEL : '',
      promptVersion: PROMPT_VERSION,
    };
  }

  function stableItemId(cacheKey, index) {
    let hash = 0x811c9dc5;
    for (let offset = 0; offset < cacheKey.length; offset += 1) {
      hash ^= cacheKey.charCodeAt(offset);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'kw-' + hash.toString(16).padStart(8, '0') + '-' + index.toString(36);
  }

  function primaryIntentId(classification) {
    const intents = Array.isArray(classification && classification.intents)
      ? classification.intents
      : [];
    const primary = intents.find((intent) => intent && intent.isPrimary) || intents[0];
    return cleanText(primary && primary.id, 64);
  }

  function ruleCandidate(classification) {
    const topicTags = Array.isArray(classification.topicTags) ? classification.topicTags : [];
    const intents = Array.isArray(classification.intents) ? classification.intents : [];
    return {
      lockedEntityRelation: cleanText(classification.entity && classification.entity.relation, 64) || 'unknown',
      topicTagIds: topicTags.map((tag) => cleanText(tag && tag.id, 64)).filter(Boolean).slice(0, 1),
      intentIds: intents.map((intent) => cleanText(intent && intent.id, 64)).filter(Boolean).slice(0, 1),
      relevance: cleanText(classification.relevance && classification.relevance.id, 64) || 'review',
      confidenceScore: Math.min(1, Math.max(0, Number(classification.confidenceScore) || 0)),
    };
  }

  function shouldAskQwen(row, automatic, semantic) {
    if (!semantic.enabled || automatic.source === 'override') return false;
    const relation = cleanText(automatic.entity && automatic.entity.relation, 64);
    if (['own_brand', 'competitor', 'own_product'].includes(relation) &&
        automatic.confidenceScore >= 0.75) return false;
    if (automatic.needsReview || automatic.confidenceScore < 0.8) return true;
    const keyword = normalizedKeyword(row && row.keyword);
    return relation === 'generic_category' && keyword.length >= 6;
  }

  function rowWithClassification(row, classification, profileId) {
    const projected = core.projectLegacyFields(classification, { profileId });
    return {
      ...row,
      ...projected,
      classificationV2: classification,
      classificationSource: classification.source,
      needsReview: classification.needsReview === true,
    };
  }

  function archiveEngine(model, semantic) {
    const enabled = Boolean(semantic && semantic.enabled);
    return {
      rulesetVersion: RULESET_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      provider: enabled ? 'openai' : 'rules',
      model: enabled ? (cleanText(model, 96) || DEFAULT_MODEL) : '',
      promptVersion: PROMPT_VERSION,
    };
  }

  function createArchive(status, config, entries, model, semanticRunValue, semantic) {
    const semanticRun = isObject(semanticRunValue) ? semanticRunValue : {};
    return {
      schema: 'xhsSearchClassificationArchiveV1',
      schemaVersion: 1,
      status,
      configRevision: config.revision,
      profileId: config.profileId,
      engine: archiveEngine(model, semantic),
      semanticRun: {
        candidateCount: Math.max(0, Number(semanticRun.candidateCount) || 0),
        attemptedCount: Math.max(0, Number(semanticRun.attemptedCount) || 0),
        classifiedCount: Math.max(0, Number(semanticRun.classifiedCount) || 0),
        deferredCount: Math.max(0, Number(semanticRun.deferredCount) || 0),
        errorCode: cleanText(semanticRun.errorCode, 64),
      },
      generatedAt: new Date().toISOString(),
      entries,
    };
  }

  function exactArchiveEntry(archive, cacheKey, keyword, scopeKey, preferFrozen) {
    const entries = isObject(archive) && Array.isArray(archive.entries) ? archive.entries : [];
    const exact = entries.find((entry) => isObject(entry) && entry.cacheKey === cacheKey);
    if (exact || !preferFrozen) return exact || null;
    const normalized = normalizedKeyword(keyword);
    const scope = cleanText(scopeKey, 160) || '*';
    return entries.find((entry) => isObject(entry) &&
      entry.normalizedKeyword === normalized && entry.scopeKey === scope) || null;
  }

  async function responseJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function classifyRows(optionsValue) {
    const options = isObject(optionsValue) ? optionsValue : {};
    const rows = Array.isArray(options.rows) ? options.rows.filter(isObject) : [];
    const profileId = cleanText(options.profileId, 96) || 'cross-industry-generic-v1';
    const scopeKey = cleanText(options.scopeKey, 160) || '*';
    const storeClassification = isObject(options.storeClassification)
      ? options.storeClassification
      : {};
    const config = normalizeStoreClassification(storeClassification, profileId);
    const automaticConfig = core.normalizeConfig({
      profileId: config.profileId,
      customIndustry: config.customIndustry,
      revision: config.revision,
      facts: config.facts,
      manualOverrides: [],
    });
    const semantic = semanticOptions(storeClassification);
    const plans = rows.map((row, index) => {
      const heuristic = ruleClassificationFromRow(row);
      const automaticRule = core.resolveClassification({
        keyword: row.keyword, scopeKey, config: automaticConfig, heuristic,
      });
      const effectiveRule = core.resolveClassification({
        keyword: row.keyword, scopeKey, config, heuristic,
      });
      const candidate = ruleCandidate(automaticRule);
      const cacheKey = core.createCacheKey({
        keyword: row.keyword, scopeKey, config: automaticConfig, semantic,
        ruleCandidate: candidate,
      });
      const archived = options.force === true ? null : exactArchiveEntry(
        options.archive, cacheKey, row.keyword, scopeKey, options.preferFrozenArchive === true
      );
      return {
        index,
        row,
        heuristic,
        automaticRule,
        effectiveRule,
        candidate,
        cacheKey,
        archived,
        itemId: stableItemId(cacheKey, index),
      };
    });
    const semanticCandidates = plans.filter((plan) => !plan.archived &&
      shouldAskQwen(plan.row, plan.effectiveRule, semantic));
    const pending = semanticCandidates.slice(0, MAX_SEMANTIC_CANDIDATES);
    const deferredCount = semanticCandidates.length - pending.length;
    const qwenResults = new Map();
    let model = cleanText(options.archive && options.archive.engine && options.archive.engine.model, 96) ||
      DEFAULT_MODEL;
    let modelErrorCode = '';
    let classifiedCount = 0;
    let credentialVersion = '';
    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (pending.length && fetchImpl) {
      for (let offset = 0; offset < pending.length; offset += MODEL_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + MODEL_BATCH_SIZE);
        const requestId = 'search-classification-' + Date.now().toString(36) + '-' +
          offset.toString(36);
        const requestPayload = {
          schema: 'xhsSearchSemanticBatchRequestV1',
          schemaVersion: 1,
          requestId,
          promptVersion: PROMPT_VERSION,
          taxonomyVersion: TAXONOMY_VERSION,
          context: {
            industry: config.industry,
            industryName: config.customIndustry,
            profileId: config.profileId,
          },
          items: batch.map((plan) => ({
            itemId: plan.itemId,
            keyword: cleanText(plan.row.keyword, 128),
            ruleCandidate: plan.candidate,
          })),
        };
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (credentialVersion) headers[CREDENTIAL_VERSION_HEADER] = credentialVersion;
          const response = await fetchImpl(options.endpoint || ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(requestPayload),
          });
          const responseCredentialVersion = cleanText(
            response && response.headers && response.headers.get(CREDENTIAL_VERSION_HEADER), 64
          );
          const responseCredentialVersionValid = /^[A-Za-z0-9_-]{16,64}$/u.test(
            responseCredentialVersion
          );
          const hasLaterBatch = offset + batch.length < pending.length;
          const credentialChanged = Boolean(
            credentialVersion && (
              !responseCredentialVersionValid || responseCredentialVersion !== credentialVersion
            )
          );
          const firstCredentialVersionMissing = Boolean(
            !credentialVersion && hasLaterBatch && !responseCredentialVersionValid
          );
          if (!credentialVersion && responseCredentialVersionValid) {
            credentialVersion = responseCredentialVersion;
          }
          const payload = await responseJson(response);
          const responseErrorCode = cleanText(payload && payload.error && payload.error.code, 64);
          if (credentialChanged || responseErrorCode === 'MODEL_CREDENTIAL_CHANGED') {
            modelErrorCode = 'MODEL_CREDENTIAL_CHANGED';
            pending.slice(offset).forEach((plan) => qwenResults.set(plan.itemId, {
              status: 'abstained', errorCode: modelErrorCode,
            }));
            break;
          }
          if (!response.ok) {
            modelErrorCode = responseErrorCode ||
              'MODEL_UPSTREAM_UNAVAILABLE';
            batch.forEach((plan) => qwenResults.set(plan.itemId, {
              status: 'abstained', errorCode: modelErrorCode,
            }));
            if (firstCredentialVersionMissing) {
              pending.slice(offset + batch.length).forEach((plan) => qwenResults.set(plan.itemId, {
                status: 'abstained', errorCode: modelErrorCode,
              }));
              break;
            }
            continue;
          }
          model = cleanText(payload.model, 96) || model;
          const validated = core.validateQwenBatchResponse(requestPayload, payload);
          validated.forEach((result) => {
            qwenResults.set(result.itemId, result);
            if (result.status === 'classified') classifiedCount += 1;
          });
          if (firstCredentialVersionMissing) {
            modelErrorCode = 'MODEL_CREDENTIAL_VERSION_MISSING';
            pending.slice(offset + batch.length).forEach((plan) => qwenResults.set(plan.itemId, {
              status: 'abstained', errorCode: modelErrorCode,
            }));
            break;
          }
        } catch {
          modelErrorCode = 'MODEL_UPSTREAM_UNAVAILABLE';
          batch.forEach((plan) => qwenResults.set(plan.itemId, {
            status: 'abstained', errorCode: modelErrorCode,
          }));
        }
      }
    } else if (pending.length) {
      modelErrorCode = 'MODEL_CLIENT_UNAVAILABLE';
      pending.forEach((plan) => qwenResults.set(plan.itemId, {
        status: 'abstained', errorCode: modelErrorCode,
      }));
    }
    if (!modelErrorCode && deferredCount > 0) {
      modelErrorCode = 'MODEL_CANDIDATE_BUDGET_REACHED';
    }

    const entries = [];
    const classifiedRows = plans.map((plan) => {
      if (plan.archived) {
        const automatic = core.normalizeRuleClassification(plan.archived.automatic);
        const effective = core.resolveClassification({
          keyword: plan.row.keyword,
          scopeKey,
          config,
          heuristic: automatic,
        });
        entries.push(core.createArchiveEntry({
          keyword: plan.row.keyword,
          scopeKey,
          cacheKey: plan.cacheKey,
          automatic,
          effective,
          appliedOverrideId: effective.appliedOverrideId,
        }));
        return rowWithClassification(plan.row, effective, config.profileId);
      }
      const qwen = qwenResults.get(plan.itemId);
      const automatic = qwen
        ? core.resolveClassification({
          keyword: plan.row.keyword, scopeKey, config: automaticConfig,
          heuristic: plan.heuristic, qwen,
        })
        : plan.automaticRule;
      const effective = qwen
        ? core.resolveClassification({
          keyword: plan.row.keyword, scopeKey, config,
          heuristic: plan.heuristic, qwen,
        })
        : plan.effectiveRule;
      entries.push(core.createArchiveEntry({
        keyword: plan.row.keyword,
        scopeKey,
        cacheKey: plan.cacheKey,
        automatic,
        effective,
        appliedOverrideId: effective.appliedOverrideId,
      }));
      return rowWithClassification(plan.row, effective, config.profileId);
    });
    const archivedStatus = cleanText(options.archive && options.archive.status, 32);
    const allRowsFromArchive = plans.length > 0 && plans.every((plan) => Boolean(plan.archived));
    const status = semanticCandidates.length === 0
      ? allRowsFromArchive && ['rules_only', 'complete', 'partial'].includes(archivedStatus)
        ? archivedStatus
        : 'rules_only'
      : classifiedCount === semanticCandidates.length
        ? 'complete'
        : classifiedCount > 0
          ? 'partial'
          : 'rules_only';
    return {
      rows: classifiedRows,
      archive: createArchive(status, config, entries, model, {
        candidateCount: semanticCandidates.length,
        attemptedCount: pending.length,
        classifiedCount,
        deferredCount,
        errorCode: modelErrorCode,
      }, semantic),
      config,
      pendingCount: semanticCandidates.length,
      attemptedCount: pending.length,
      deferredCount,
      classifiedCount,
      modelErrorCode,
    };
  }

  return Object.freeze({
    ENDPOINT,
    DEFAULT_MODEL,
    PROMPT_VERSION,
    TAXONOMY_VERSION,
    RULESET_VERSION,
    normalizeStoreClassification,
    ruleClassificationFromRow,
    classifyRows,
  });
});
