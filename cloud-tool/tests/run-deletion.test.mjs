import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteRunBodyBestEffort } from "../app/server/run-deletion.ts";

test("run deletion permissions expose both legacy and can-prefixed fields", async () => {
  const source = await readFile(
    new URL("../app/server/authz.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /deleteRuns:\s*managesWorkspace/);
  assert.match(source, /canDeleteRuns:\s*managesWorkspace/);
});

test("object cleanup succeeds without reporting a pending deletion", async () => {
  const deleted = [];
  const result = await deleteRunBodyBestEffort(
    { async delete(key) { deleted.push(key); } },
    "runs/store-run-cleanup.json",
  );
  assert.equal(result, true);
  assert.deepEqual(deleted, ["runs/store-run-cleanup.json"]);
});

test("object cleanup failure is reported without rejecting logical deletion", async () => {
  const failure = new Error("temporary object-store failure");
  const observed = [];
  const result = await deleteRunBodyBestEffort(
    { async delete() { throw failure; } },
    "runs/store-run-cleanup-failure.json",
    (error) => observed.push(error),
  );
  assert.equal(result, false);
  assert.deepEqual(observed, [failure]);
});
