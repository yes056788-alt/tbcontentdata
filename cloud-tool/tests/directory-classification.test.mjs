import assert from "node:assert/strict";
import test from "node:test";
import { validateDirectory } from "../app/server/directory.ts";

function directoryWithClassification(classification) {
  return {
    schema: 1,
    storeGroups: [{ id: "group-1", name: "默认组", unknown: "drop" }],
    stores: [{
      id: "store-1",
      name: "家具店",
      groupId: "group-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      classification,
      cookies: "must-drop",
      unknown: "drop",
    }],
    updatedAt: 1788048000000,
    password: "must-drop",
    unknown: "drop",
  };
}

test("directory whitelist preserves classification and projects legacy overrides into patch", () => {
  const result = validateDirectory(directoryWithClassification({
    schema: 1,
    profileId: "home-furnishing-v1",
    customIndustry: "家具",
    ownBrandTerms: [" 顾家 ", "顾家"],
    ownProductTerms: [{ password: "must-drop" }, "护腰床垫"],
    competitorTerms: ["慕思"],
    manualOverrides: [{
      id: "override-1",
      scopeKey: "store-1",
      keyword: "顾家床垫值得买吗",
      active: false,
      reason: "运营人工确认",
      commercialCategory: "own_brand",
      topicTagIds: ["core_category", "safety_adverse_effect"],
      secondaryIntents: ["problem_solving", "purchase_decision"],
      relevance: "strong",
      password: "must-drop",
      unknown: "drop",
    }],
    revision: 3,
    updatedAt: 1788048000000,
    token: "must-drop",
    unknown: "drop",
  }));

  assert.deepEqual(result, {
    schema: 1,
    storeGroups: [{ id: "group-1", name: "默认组" }],
    stores: [{
      id: "store-1",
      name: "家具店",
      groupId: "group-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      classification: {
        schema: 1,
        profileId: "home-furnishing-v1",
        customIndustry: "家具",
        ownBrandTerms: ["顾家"],
        ownProductTerms: ["护腰床垫"],
        competitorTerms: ["慕思"],
        manualOverrides: [{
          id: "override-1",
          scopeKey: "store-1",
          keyword: "顾家床垫值得买吗",
          active: false,
          reason: "运营人工确认",
          patch: {
            entityRelation: "own_brand",
            topicTagIds: ["safety_adverse_effect"],
            intentIds: ["purchase_decision"],
            primaryIntentId: "purchase_decision",
            relevance: "strong",
          },
          updatedAt: 0,
        }],
        revision: 3,
        updatedAt: 1788048000000,
      },
    }],
    updatedAt: 1788048000000,
  });
  assert.equal(JSON.stringify(result).includes("must-drop"), false);
});

test("classification whitelist applies deterministic string and collection caps", () => {
  const result = validateDirectory(directoryWithClassification({
    schema: 1,
    profileId: "p".repeat(100),
    customIndustry: "行".repeat(150),
    ownBrandTerms: Array.from({ length: 205 }, (_, index) => ` 品牌 ${index} `),
    ownProductTerms: ["品".repeat(150)],
    competitorTerms: [],
    manualOverrides: Array.from({ length: 505 }, (_, index) => ({
      id: `override-${index}`,
      scopeKey: "scope-1",
      keyword: `关键词-${index}`,
      active: true,
      reason: "理".repeat(600),
      patch: {
        entityRelation: "generic_category",
        topicTagIds: Array.from({ length: 25 }, (_, tagIndex) => `tag-${tagIndex}`),
        intentIds: Array.from({ length: 25 }, (_, intentIndex) => `intent-${intentIndex}`),
        primaryIntentId: "purchase_decision",
        relevance: "strong",
        token: "must-drop",
      },
      updatedAt: 1788048000000,
    })),
    revision: Number.MAX_SAFE_INTEGER,
    updatedAt: 1788048000000,
  }));

  const classification = result.stores[0].classification;
  assert.equal(classification.profileId.length, 96);
  assert.equal(classification.customIndustry.length, 120);
  assert.equal(classification.ownBrandTerms.length, 200);
  assert.equal(classification.ownProductTerms[0].length, 64);
  assert.equal(classification.manualOverrides.length, 500);
  assert.equal(classification.manualOverrides[0].reason.length, 160);
  assert.deepEqual(classification.manualOverrides[0].patch.topicTagIds, ["tag-0"]);
  assert.deepEqual(classification.manualOverrides[0].patch.intentIds, ["purchase_decision"]);
  assert.equal(classification.manualOverrides[0].patch.primaryIntentId, "purchase_decision");
  assert.equal(classification.revision, 2147483647);
});

test("manual override preserves an explicit empty topic list", () => {
  const result = validateDirectory(directoryWithClassification({
    schema: 1,
    profileId: "cross-industry-generic-v1",
    manualOverrides: [{
      id: "override-clear-topic",
      scopeKey: "store:store-1",
      keyword: "待确认词",
      patch: {
        entityRelation: "unknown",
        topicTagIds: [],
        intentIds: ["unclear"],
        primaryIntentId: "unclear",
        relevance: "review",
      },
    }],
  }));

  assert.deepEqual(
    result.stores[0].classification.manualOverrides[0].patch.topicTagIds,
    [],
  );
});
