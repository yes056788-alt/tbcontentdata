import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cloudToolRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../", import.meta.url);

async function configurationDocs() {
  const [example, cloudReadme, localReadme] = await Promise.all([
    readFile(new URL(".env.production.example", cloudToolRoot), "utf8"),
    readFile(new URL("README.md", cloudToolRoot), "utf8"),
    readFile(new URL("web-tool/README.md", repositoryRoot), "utf8"),
  ]);
  return { example, cloudReadme, localReadme };
}

test("production example has no model classification credentials", async () => {
  const { example } = await configurationDocs();

  assert.doesNotMatch(example, /DASHSCOPE|QWEN|OPENAI_API_KEY|MODEL_API_KEY/);
  assert.doesNotMatch(example, /NEXT_PUBLIC_DASHSCOPE_API_KEY/);
});

test("cloud README explains Sheba-style deterministic classification", async () => {
  const { cloudReadme } = await configurationDocs();

  assert.match(cloudReadme, /希宝报告/);
  assert.match(cloudReadme, /不调用大模型/);
  assert.match(cloudReadme, /不需要 API Key/);
  assert.match(cloudReadme, /\.dev\.vars/);
  assert.match(cloudReadme, /npm run dev/);
  assert.doesNotMatch(cloudReadme, /DASHSCOPE_API_KEY|QWEN_TIMEOUT_MS|qwen3\.7/);
});

test("local web README documents rules-only classification", async () => {
  const { localReadme } = await configurationDocs();

  assert.match(localReadme, /node web-tool\/server\.mjs/);
  assert.match(localReadme, /希宝报告/);
  assert.match(localReadme, /不调用大模型/);
  assert.match(localReadme, /自有品牌词 → 竞品词 → 自有产品词/);
  assert.doesNotMatch(localReadme, /DASHSCOPE|QWEN|qwen3\.7|保存并启用/);
});
