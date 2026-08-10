import assert from "node:assert/strict";
import test from "node:test";
import { scanBusinessMigration } from "../scripts/lib/business-migration-import.mjs";
import {
  createFixtureMigration,
  FIXTURE_PASSPHRASE,
  fixtureRun,
} from "./helpers/business-migration-fixture.mjs";

function trackedTextSource(text, metrics) {
  return {
    async *openLines() {
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf("\n", offset);
        const end = newline === -1 ? text.length : newline;
        const line = text.slice(offset, end);
        offset = newline === -1 ? text.length : newline + 1;
        if (!line) continue;
        metrics.linesInFlight += 1;
        metrics.maxLinesInFlight = Math.max(metrics.maxLinesInFlight, metrics.linesInFlight);
        yield line;
        metrics.linesInFlight -= 1;
      }
    },
  };
}

test("stream scanner handles many small run records one at a time", async () => {
  const runCount = 600;
  const runs = Array.from({ length: runCount }, (_, index) => fixtureRun(index + 1));
  const packageText = await createFixtureMigration({ runs });
  const metrics = { linesInFlight: 0, maxLinesInFlight: 0 };
  let callbacksInFlight = 0;
  let maxCallbacksInFlight = 0;
  let visitedRuns = 0;
  const result = await scanBusinessMigration(
    trackedTextSource(packageText, metrics),
    FIXTURE_PASSPHRASE,
    {
      async onRecord({ kind, record }) {
        callbacksInFlight += 1;
        maxCallbacksInFlight = Math.max(maxCallbacksInFlight, callbacksInFlight);
        if (kind === "run") {
          visitedRuns += 1;
          assert.match(record.metadata.id, /^store-run-fixture-/);
        }
        await Promise.resolve();
        callbacksInFlight -= 1;
      },
    },
  );
  assert.equal(result.manifest.totals.runs, runCount);
  assert.equal(visitedRuns, runCount);
  assert.equal(metrics.maxLinesInFlight, 1);
  assert.equal(maxCallbacksInFlight, 1);
});

test("a multi-megabyte run remains a single bounded record, not a whole-package buffer", async () => {
  const body = "x".repeat(5 * 1024 * 1024);
  const packageText = await createFixtureMigration({
    runs: [fixtureRun(1, { run: { largeSyntheticBody: body } })],
  });
  const metrics = { linesInFlight: 0, maxLinesInFlight: 0 };
  let observedBytes = 0;
  const result = await scanBusinessMigration(
    trackedTextSource(packageText, metrics),
    FIXTURE_PASSPHRASE,
    {
      onRecord({ kind, record }) {
        if (kind === "run") observedBytes = record.payloadBytes;
      },
    },
  );
  assert.equal(result.manifest.totals.runs, 1);
  assert.ok(observedBytes >= body.length);
  assert.equal(metrics.maxLinesInFlight, 1);
});
