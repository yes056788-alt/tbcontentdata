const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('report exposes a single-label keyword correction dialog', () => {
  const html = read('web-tool/report-view.html');
  assert.match(html, /id="xhsClassificationCorrectionDialog"/);
  assert.match(html, /name="commercialCategory"/);
  assert.match(html, /name="relevance"/);
  assert.match(html, /name="intent"/);
  assert.match(html, /data-xhs-classification-correction-save/);

  const commercialOptions = html.match(/name="commercialCategory"[\s\S]*?<\/select>/);
  assert.ok(commercialOptions, 'commercial category correction control');
  for (const value of [
    'own_brand', 'competitor', 'own_product', 'need_pain_point',
    'core_category', 'adjacent_category', 'industry_interest', 'unrelated', 'unknown',
  ]) {
    assert.match(commercialOptions[0], new RegExp(`value="${value}"`));
  }
});

test('keyword correction persists one topic and one intent as a scoped manual override', () => {
  const report = read('web-tool/report.js');
  assert.match(report, /function saveXhsKeywordCorrection\(/);
  assert.match(report, /manualOverrides/);
  assert.match(report, /topicTagIds:\s*topicTagId\s*\?\s*\[topicTagId\]\s*:\s*\[\]/);
  assert.match(report, /intentIds:\s*\[intentId\]/);
  assert.match(report, /primaryIntentId:\s*intentId/);
  assert.match(report, /requestBridge\('setProjectDirectory'/);
  assert.match(report, /runXhsSearchClassification\(true\)/);
});

test('report reconciles existing classification archives against current store configuration', () => {
  const report = read('web-tool/report.js');
  const runStart = report.indexOf('async function runXhsSearchClassification(force)');
  const scheduleStart = report.indexOf('function scheduleXhsSearchClassification()');
  const nextFunction = report.indexOf('function xhsNoteSnapshotIdentity', scheduleStart);
  const runSource = report.slice(runStart, scheduleStart);
  const scheduleSource = report.slice(scheduleStart, nextFunction);

  assert.ok(runStart >= 0 && scheduleStart > runStart && nextFunction > scheduleStart);
  assert.doesNotMatch(runSource, /if \(!force && xhsArray\(existingArchive\.entries\)\.length\) return/);
  assert.match(runSource, /classificationArchive:\s*\{\}/);
  assert.doesNotMatch(scheduleSource, /searchClassification[\s\S]*?entries\)\.length\) return/);
  assert.match(scheduleSource, /xhsClassificationIdentity\(analysis, pgy\)/);
});

test('classification changes queued during an active run are replayed after it finishes', () => {
  const report = read('web-tool/report.js');
  assert.match(report, /let xhsClassificationRerunRequested\s*=\s*false/);
  assert.match(report, /let xhsClassificationRerunForce\s*=\s*false/);
  assert.match(report, /if \(xhsClassificationRunning\) \{[\s\S]*?xhsClassificationRerunRequested = true;[\s\S]*?return;[\s\S]*?\}/);
  assert.match(report, /finally \{[\s\S]*?const rerunRequested = xhsClassificationRerunRequested;[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?runXhsSearchClassification\(rerunForce\);[\s\S]*?\}, 0\);/);
});
