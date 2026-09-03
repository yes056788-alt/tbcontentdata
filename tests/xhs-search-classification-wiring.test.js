const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('local and cloud report pages load the classification core before report code', () => {
  const html = read('web-tool/report-view.html');
  const core = html.indexOf('/xhs-search-classification.js');
  const model = html.indexOf('/xhs-report-model.js');
  const report = html.indexOf('/report.js');
  assert.ok(core >= 0 && model > core && report > model);

  const server = read('web-tool/server.mjs');
  assert.match(server, /['"]\/xhs-search-classification\.js['"][\s\S]*?xhs["'],\s*["']search-classification\.js/);

  const sync = read('cloud-tool/scripts/sync-web-tool.mjs');
  assert.match(sync, /xhs\/search-classification\.js/);
  assert.match(sync, /xhs-search-classification\.js/);
});

test('the product report uses deterministic industry rules without a model endpoint', () => {
  const report = read('web-tool/report.js');
  const task = read('web-tool/task.js');
  const client = read('web-tool/search-classification-client.js');
  assert.doesNotMatch(report, /\/api\/search-keyword-classifications/);
  assert.match(task, /semantic:\s*\{ enabled: false \}/);
  assert.match(client, /const enabled = semantic\.enabled === true/);
  assert.match(client, /provider: enabled \? 'openai' : 'rules'/);
});

test('the first archived report automatically classifies and persists search keywords', () => {
  const report = read('web-tool/report.js');
  const scheduleStart = report.indexOf('function scheduleXhsSearchClassification');
  const scheduleEnd = report.indexOf('function xhsNoteSnapshotIdentity', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  const schedule = report.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /if \(BUILDER_MODE\) return/);
  assert.doesNotMatch(schedule, /BUILDER_MODE\s*\|\|\s*ARCHIVE_RUN_ID/);
  assert.match(schedule, /existingSearchClassification/);
  assert.doesNotMatch(schedule, /if \(ARCHIVE_RUN_ID && archivedClassificationReady\) return/);
  assert.match(schedule, /archivedClassificationFinal/);
  assert.match(schedule, /archivedRulesetReady/);
  assert.match(schedule, /archivedEngine\.provider/);
  assert.match(schedule, /existingSearchClassification\.semanticRun/);
  assert.match(schedule, /forceSemanticRetry/);
  assert.match(schedule, /runXhsSearchClassification\(forceSemanticRetry\)/);
  assert.match(report, /requestBridge\('patchXhsSearchClassification'/);
});

test('legacy model archives are replaced by the Sheba-style deterministic ruleset', () => {
  const report = read('web-tool/report.js');
  const scheduleStart = report.indexOf('function scheduleXhsSearchClassification');
  const scheduleEnd = report.indexOf('function xhsNoteSnapshotIdentity', scheduleStart);
  const schedule = report.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /archivedStatus === 'rules_only'/);
  assert.match(schedule, /archivedNeedsReviewCount/);
  assert.match(schedule, /archivedCandidateCount === 0 && archivedNeedsReviewCount === 0/);
  assert.match(schedule, /archivedAttemptedCount > 0/);
  assert.match(schedule, /!archivedErrorCode/);
  assert.match(schedule, /Boolean\(ARCHIVE_RUN_ID && archivedClassificationReady\)/);
  assert.match(report, /xhs-search-sheba-style-v3/);
  assert.match(report, /行业规则分类完成/);
  assert.match(report, /按当前规则重新分类/);
  assert.doesNotMatch(report, /API Key 无效|OpenAI 尚未配置/);
});
