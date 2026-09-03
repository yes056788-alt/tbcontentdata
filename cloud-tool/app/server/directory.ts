import { ApiError, requireObject } from "./http.ts";

const MAX_STORE_GROUPS = 300;
const MAX_STORES = 1_000;
const MAX_CLASSIFICATION_TERMS = 200;
const MAX_MANUAL_OVERRIDES = 500;
const MAX_REVISION = 2_147_483_647;
const TOPIC_PRIORITY = [
  "safety_adverse_effect",
  "need_pain_point",
  "core_category",
  "usage_scenario",
  "adjacent_category",
  "industry_interest",
  "unrelated",
] as const;
const INTENT_PRIORITY = [
  "purchase_decision",
  "comparison",
  "problem_solving",
  "usage",
  "brand_product_lookup",
  "category_exploration",
  "interest_browsing",
  "unclear",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function nonNegativeInteger(value: unknown, maxValue = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, maxValue);
}

function cleanStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of (Array.isArray(value) ? value : []).slice(0, maxItems)) {
    const item = cleanText(raw, maxLength);
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

function highestPriorityClassificationTerm(
  value: unknown,
  priority: readonly string[],
): string {
  const candidates = cleanStringList(value, 20, 80);
  return priority.find((item) => candidates.includes(item)) || candidates[0] || "";
}

function sanitizeClassificationPatch(
  value: unknown,
  legacyValue: Record<string, unknown>,
): Record<string, unknown> {
  const patch = isRecord(value) ? value : {};
  const topicTagsExplicit = Array.isArray(patch.topicTagIds);
  const entityRelation = cleanText(
    patch.entityRelation == null ? legacyValue.commercialCategory : patch.entityRelation,
    80,
  );
  const topicTagId = highestPriorityClassificationTerm(
    patch.topicTagIds == null ? legacyValue.topicTagIds : patch.topicTagIds,
    TOPIC_PRIORITY,
  );
  const prioritizedIntentId = highestPriorityClassificationTerm(
    patch.intentIds == null ? legacyValue.secondaryIntents : patch.intentIds,
    INTENT_PRIORITY,
  );
  let primaryIntentId = cleanText(
    patch.primaryIntentId == null
      ? legacyValue.primaryIntent || legacyValue.intent
      : patch.primaryIntentId,
    80,
  );
  if (!primaryIntentId) primaryIntentId = prioritizedIntentId;
  const topicTagIds = topicTagId ? [topicTagId] : [];
  const intentIds = primaryIntentId ? [primaryIntentId] : [];
  const relevance = cleanText(
    patch.relevance == null ? legacyValue.relevance : patch.relevance,
    80,
  );
  return {
    ...(entityRelation ? { entityRelation } : {}),
    ...(topicTagIds.length || topicTagsExplicit ? { topicTagIds } : {}),
    ...(intentIds.length ? { intentIds } : {}),
    ...(primaryIntentId ? { primaryIntentId } : {}),
    ...(relevance ? { relevance } : {}),
  };
}

function sanitizeClassificationOverride(value: unknown): Record<string, unknown> | null {
  const item = isRecord(value) ? value : {};
  const keyword = cleanText(item.keyword || item.normalizedKeyword, 160);
  const keywordKey = cleanText(item.keywordKey, 240);
  const normalizedKeyword = cleanText(item.normalizedKeyword, 160);
  const id = cleanText(item.id || keywordKey || normalizedKeyword || keyword, 96);
  if (!id || !keyword) return null;
  return {
    id,
    scopeKey: cleanText(item.scopeKey, 160),
    keyword,
    ...(keywordKey ? { keywordKey } : {}),
    ...(normalizedKeyword ? { normalizedKeyword } : {}),
    active: item.active !== false,
    reason: cleanText(item.reason, 160),
    patch: sanitizeClassificationPatch(item.patch, item),
    updatedAt: nonNegativeInteger(item.updatedAt),
  };
}

function sanitizeStoreClassification(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || Number(value.schema) !== 1) return null;
  const overrideIds = new Set<string>();
  const manualOverrides: Record<string, unknown>[] = [];
  for (const raw of (Array.isArray(value.manualOverrides) ? value.manualOverrides : [])
    .slice(0, MAX_MANUAL_OVERRIDES)) {
    const item = sanitizeClassificationOverride(raw);
    const id = cleanText(item?.id, 96);
    if (item && !overrideIds.has(id)) {
      overrideIds.add(id);
      manualOverrides.push(item);
    }
    if (manualOverrides.length >= MAX_MANUAL_OVERRIDES) break;
  }
  return {
    schema: 1,
    profileId: cleanText(value.profileId, 96),
    customIndustry: cleanText(value.customIndustry, 120),
    ownBrandTerms: cleanStringList(value.ownBrandTerms, MAX_CLASSIFICATION_TERMS, 64),
    ownProductTerms: cleanStringList(value.ownProductTerms, MAX_CLASSIFICATION_TERMS, 64),
    competitorTerms: cleanStringList(value.competitorTerms, MAX_CLASSIFICATION_TERMS, 64),
    manualOverrides,
    revision: nonNegativeInteger(value.revision, MAX_REVISION),
    updatedAt: nonNegativeInteger(value.updatedAt),
  };
}

export function validateDirectory(value: unknown): Record<string, unknown> {
  const directory = requireObject(value, "directory 必须是 JSON 对象。");
  if (directory.schema !== undefined && Number(directory.schema) !== 1) {
    throw new ApiError(400, "INVALID_DIRECTORY", "directory.schema 无效。");
  }

  const groupIds = new Set<string>();
  const storeGroups: Record<string, unknown>[] = [];
  for (const raw of (Array.isArray(directory.storeGroups) ? directory.storeGroups : [])
    .slice(0, MAX_STORE_GROUPS)) {
    const group = isRecord(raw) ? raw : {};
    const id = cleanText(group.id, 100);
    const name = cleanText(group.name, 80);
    if (!id || !name || groupIds.has(id)) continue;
    groupIds.add(id);
    storeGroups.push({ id, name });
  }

  const storeIds = new Set<string>();
  const stores: Record<string, unknown>[] = [];
  for (const raw of (Array.isArray(directory.stores) ? directory.stores : [])
    .slice(0, MAX_STORES)) {
    const store = isRecord(raw) ? raw : {};
    const id = cleanText(store.id, 100);
    const name = cleanText(store.name, 120);
    if (!id || !name || storeIds.has(id)) continue;
    storeIds.add(id);
    const groupId = cleanText(store.groupId, 100);
    const classification = sanitizeStoreClassification(store.classification);
    stores.push({
      id,
      name,
      groupId: groupIds.has(groupId) ? groupId : "",
      createdAt: cleanText(store.createdAt, 80),
      updatedAt: cleanText(store.updatedAt, 80),
      ...(classification ? { classification } : {}),
    });
  }

  return {
    schema: 1,
    storeGroups,
    stores,
    updatedAt: nonNegativeInteger(directory.updatedAt),
  };
}
