import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

test("server start scripts should synchronize web-tool assets before running", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const { scripts = {} } = packageJson;
  assert.equal(scripts["prestart"], "npm run sync:web");
  assert.equal(scripts["prestart:node"], "npm run sync:web");
});
