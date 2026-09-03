import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_DASHSCOPE_BASE_URL,
  DEFAULT_QWEN_MODEL,
  classifySearchKeywordsWithQwen,
  parseQwenTimeoutMilliseconds,
  parseSearchKeywordClassificationRequest,
  resolveDashScopeEndpoint,
} from "../app/server/qwen-classification.ts";

const API_KEY = "sk-test-qwen-key-that-must-never-leak";

function validRequest(overrides = {}) {
  return {
    schema: "xhsSearchSemanticBatchRequestV1",
    schemaVersion: 1,
    requestId: "request-20260830-001",
    promptVersion: "hybrid-qwen-v1",
    taxonomyVersion: "xhs-search-taxonomy-v1",
    context: {
      industry: "furniture",
      industryName: "",
      profileId: "home-furnishing-v1",
    },
    items: [
      {
        itemId: "keyword-1",
        keyword: "顾家护腰床垫哪里买",
        ruleCandidate: {
          lockedEntityRelation: "own_brand",
          topicTagIds: ["core_category", "need_pain_point"],
          intentIds: ["purchase_decision"],
          relevance: "strong",
          confidenceScore: 0.98,
        },
      },
      {
        itemId: "keyword-2",
        keyword: "鱼油副作用值得买吗",
        ruleCandidate: {
          lockedEntityRelation: "generic_category",
          topicTagIds: ["core_category", "safety_adverse_effect"],
          intentIds: ["purchase_decision", "problem_solving"],
          relevance: "strong",
          confidenceScore: 0.84,
        },
      },
    ],
    ...overrides,
  };
}

function upstreamResponse(items, init = {}) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      choices: [{ message: { role: "assistant", content: JSON.stringify({ items }) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" }, ...init },
  );
}

test("accepts the strict hybrid request contract and normalizes keywords", () => {
  const request = validRequest();
  request.items[0].keyword = "  顾家护腰床垫哪里买  ";

  const parsed = parseSearchKeywordClassificationRequest(request);

  assert.equal(parsed.items[0].keyword, "顾家护腰床垫哪里买");
  assert.deepEqual(parsed.items[0].ruleCandidate, request.items[0].ruleCandidate);
  assert.equal(Object.hasOwn(parsed, "provider"), false);
  assert.equal(Object.hasOwn(parsed, "model"), false);

  const custom = validRequest({
    context: {
      industry: "custom",
      industryName: "户外装备",
      profileId: "cross-industry-generic-v1",
    },
  });
  assert.equal(
    parseSearchKeywordClassificationRequest(custom).context.industryName,
    "户外装备",
  );
});

test("rejects unknown request fields, invalid enums, duplicate ids, oversized batches and long keywords", () => {
  assert.throws(
    () => parseSearchKeywordClassificationRequest({ ...validRequest(), provider: "qwen" }),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const extraItemField = validRequest();
  extraItemField.items[0].entity = "competitor";
  assert.throws(
    () => parseSearchKeywordClassificationRequest(extraItemField),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const invalidEnum = validRequest();
  invalidEnum.items[0].ruleCandidate.relevance = "STRONG";
  assert.throws(
    () => parseSearchKeywordClassificationRequest(invalidEnum),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const mismatchedIndustry = validRequest();
  mismatchedIndustry.context.industryName = "户外装备";
  assert.throws(
    () => parseSearchKeywordClassificationRequest(mismatchedIndustry),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const duplicateIds = validRequest();
  duplicateIds.items[1].itemId = duplicateIds.items[0].itemId;
  assert.throws(
    () => parseSearchKeywordClassificationRequest(duplicateIds),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const tooMany = validRequest({
    items: Array.from({ length: 101 }, (_, index) => ({
      ...validRequest().items[0],
      itemId: `keyword-${index}`,
    })),
  });
  assert.throws(
    () => parseSearchKeywordClassificationRequest(tooMany),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );

  const longKeyword = validRequest();
  longKeyword.items[0].keyword = "词".repeat(129);
  assert.throws(
    () => parseSearchKeywordClassificationRequest(longKeyword),
    (error) => error?.code === "INVALID_CLASSIFICATION_REQUEST",
  );
});

test("only permits official HTTPS DashScope compatible endpoints", () => {
  assert.equal(
    resolveDashScopeEndpoint(undefined),
    `${DEFAULT_DASHSCOPE_BASE_URL}/chat/completions`,
  );
  assert.equal(
    resolveDashScopeEndpoint(
      "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/",
    ),
    "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  );
  for (const value of [
    "http://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1",
    "https://dashscope.aliyuncs.com/api/v1",
    "https://user:password@dashscope.aliyuncs.com/compatible-mode/v1",
    "https://workspace-123.unknown.maas.aliyuncs.com/compatible-mode/v1",
  ]) {
    assert.throws(
      () => resolveDashScopeEndpoint(value),
      (error) => error?.code === "QWEN_CONFIGURATION_INVALID",
      value,
    );
  }
});

test("parses the optional QWEN timeout from server environment within strict bounds", () => {
  assert.equal(parseQwenTimeoutMilliseconds(undefined), 25_000);
  assert.equal(parseQwenTimeoutMilliseconds("5000"), 5_000);
  assert.equal(parseQwenTimeoutMilliseconds("30000"), 30_000);
  for (const value of ["4999", "30001", "25000.5", "25s", ""]) {
    assert.throws(
      () => parseQwenTimeoutMilliseconds(value),
      (error) => error?.code === "QWEN_CONFIGURATION_INVALID" && error?.status === 503,
      value,
    );
  }
});

test("calls Qwen with the server model and returns only allowlisted semantic fields", async () => {
  const captured = {};
  const fetchImpl = async (url, init) => {
    captured.url = url;
    captured.init = init;
    return upstreamResponse([
      {
        itemId: "keyword-1",
        status: "classified",
        topicTagIds: ["core_category", "usage_scenario", "need_pain_point"],
        intentIds: ["problem_solving", "purchase_decision"],
        primaryIntentId: "problem_solving",
        relevance: "strong",
        confidenceScore: 0.91,
        rationale: "包含明确品类、需求和购买动作。",
      },
      {
        itemId: "keyword-2",
        status: "classified",
        entity: "competitor",
        topicTagIds: ["core_category", "safety_adverse_effect"],
        intentIds: ["purchase_decision", "problem_solving"],
        primaryIntentId: "purchase_decision",
        relevance: "strong",
        confidenceScore: 0.9,
        rationale: "恶意尝试改写实体。",
      },
    ]);
  };

  const result = await classifySearchKeywordsWithQwen(validRequest(), {
    apiKey: API_KEY,
    fetchImpl,
  });

  assert.equal(captured.url, `${DEFAULT_DASHSCOPE_BASE_URL}/chat/completions`);
  assert.equal(captured.init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(captured.init.signal instanceof AbortSignal, true);
  const upstreamBody = JSON.parse(captured.init.body);
  assert.equal(upstreamBody.model, DEFAULT_QWEN_MODEL);
  assert.deepEqual(upstreamBody.response_format, { type: "json_object" });
  assert.equal(upstreamBody.messages.some((message) => /JSON/i.test(message.content)), true);
  assert.match(upstreamBody.messages[0].content, /primaryIntentId/);
  assert.match(upstreamBody.messages[0].content, /confidenceScore/);

  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "context", "items", "model", "promptVersion", "provider", "requestId",
      "schema", "schemaVersion", "taxonomyVersion",
    ].sort(),
  );
  assert.equal(result.provider, "qwen");
  assert.equal(result.model, DEFAULT_QWEN_MODEL);
  assert.equal(result.schema, "xhsSearchSemanticBatchResponseV1");
  assert.deepEqual(result.items[0], {
    itemId: "keyword-1",
    status: "classified",
    topicTagIds: ["need_pain_point"],
    intentIds: ["purchase_decision"],
    primaryIntentId: "purchase_decision",
    relevance: "strong",
    confidenceScore: 0.91,
    rationale: "包含明确品类、需求和购买动作。",
  });
  assert.equal(result.items[1].status, "abstained");
  assert.deepEqual(result.items[1].topicTagIds, ["safety_adverse_effect"]);
  assert.deepEqual(result.items[1].intentIds, ["purchase_decision"]);
  assert.equal(result.items[1].primaryIntentId, "purchase_decision");
  assert.equal(result.items[1].relevance, "strong");
  assert.equal(result.items[1].confidenceScore, 0.84);
  assert.equal(Object.hasOwn(result.items[1], "entity"), false);
  assert.equal(JSON.stringify(result).includes(API_KEY), false);
  assert.equal(JSON.stringify(result).includes("恶意尝试改写实体"), false);
});

test("abstains only missing, duplicate or invalid upstream items while preserving valid peers", async () => {
  const result = await classifySearchKeywordsWithQwen(validRequest(), {
    apiKey: API_KEY,
    fetchImpl: async () => upstreamResponse([
      {
        itemId: "keyword-1",
        status: "classified",
        topicTagIds: ["core_category"],
        intentIds: ["purchase_decision"],
        primaryIntentId: "purchase_decision",
        relevance: "strong",
        confidenceScore: 0.88,
        rationale: "有效结果。",
      },
      {
        itemId: "keyword-1",
        status: "classified",
        topicTagIds: ["unrelated"],
        intentIds: ["unclear"],
        primaryIntentId: "unclear",
        relevance: "none",
        confidenceScore: 1,
        rationale: "重复结果。",
      },
    ]),
  });

  assert.equal(result.items[0].status, "abstained");
  assert.equal(result.items[1].status, "abstained");
  assert.match(result.items[0].rationale, /规则候选/);
  assert.match(result.items[1].rationale, /规则候选/);
});

test("maps upstream failures to stable errors without exposing response bodies or keys", async () => {
  const scenarios = [
    {
      name: "authentication",
      fetchImpl: async () => new Response(`invalid ${API_KEY}`, { status: 401 }),
      code: "QWEN_AUTH_FAILED",
      status: 503,
    },
    {
      name: "rate limit",
      fetchImpl: async () => new Response("account quota details", { status: 429 }),
      code: "QWEN_RATE_LIMITED",
      status: 503,
    },
    {
      name: "provider unavailable",
      fetchImpl: async () => new Response("internal provider trace", { status: 500 }),
      code: "QWEN_UNAVAILABLE",
      status: 502,
    },
    {
      name: "timeout",
      fetchImpl: async () => {
        const error = new Error("request timed out with secret " + API_KEY);
        error.name = "AbortError";
        throw error;
      },
      code: "QWEN_TIMEOUT",
      status: 504,
    },
    {
      name: "AbortSignal.timeout",
      fetchImpl: async () => {
        const error = new Error("provider timeout internals " + API_KEY);
        error.name = "TimeoutError";
        throw error;
      },
      code: "QWEN_TIMEOUT",
      status: 504,
    },
  ];

  for (const scenario of scenarios) {
    await assert.rejects(
      classifySearchKeywordsWithQwen(validRequest(), {
        apiKey: API_KEY,
        fetchImpl: scenario.fetchImpl,
      }),
      (error) => {
        assert.equal(error.code, scenario.code, scenario.name);
        assert.equal(error.status, scenario.status, scenario.name);
        assert.equal(error.message.includes(API_KEY), false, scenario.name);
        assert.doesNotMatch(error.message, /quota|trace|secret/i, scenario.name);
        return true;
      },
    );
  }
});

test("rejects missing server credentials and malformed Qwen envelopes without leaking details", async () => {
  await assert.rejects(
    classifySearchKeywordsWithQwen(validRequest(), { apiKey: "" }),
    (error) => error?.code === "QWEN_NOT_CONFIGURED" && error?.status === 503,
  );
  await assert.rejects(
    classifySearchKeywordsWithQwen(validRequest(), {
      apiKey: API_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [] })),
    }),
    (error) => error?.code === "QWEN_INVALID_RESPONSE" && error?.status === 502,
  );
  await assert.rejects(
    classifySearchKeywordsWithQwen(validRequest(), {
      apiKey: API_KEY,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content: JSON.stringify({ items: [] }) },
        }],
      })),
    }),
    (error) => error?.code === "QWEN_INVALID_RESPONSE" && error?.status === 502,
  );
  await assert.rejects(
    classifySearchKeywordsWithQwen(validRequest(), {
      apiKey: API_KEY,
      fetchImpl: async () => new Response("{}", {
        headers: { "Content-Length": "1000001" },
      }),
    }),
    (error) => error?.code === "QWEN_INVALID_RESPONSE" && error?.status === 502,
  );
});

test("wires the POST route through session, writer-role and 100KB boundary guards", async () => {
  const source = await readFile(
    new URL("../app/api/search-keyword-classifications/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /requireSession\(request,\s*runWriters\)/);
  assert.match(source, /readJsonBody<unknown>\(request,\s*100_000\)/);
  assert.match(source, /runtimeValue\("DASHSCOPE_API_KEY"\)/);
  assert.match(source, /runtimeValue\("QWEN_TIMEOUT_MS"\)/);
  assert.match(source, /parseQwenTimeoutMilliseconds/);
  assert.match(source, /classifySearchKeywordsWithQwen/);
  assert.match(source, /withApiErrors/);
});
