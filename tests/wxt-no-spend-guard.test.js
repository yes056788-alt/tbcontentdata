const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const content = fs.readFileSync(path.join(__dirname, '..', 'wxt-report-content.js'), 'utf8');
const popup = fs.readFileSync(path.join(__dirname, '..', 'diagnosis-popup.js'), 'utf8');

assert.match(content, /const shortVideoSpend = \[scene\.charge, spend\.shortVideoCharge\]/);
assert.match(popup, /const shortVideoSpend = firstNumber\(shortVideoRow\.charge, spend\.shortVideoCharge\)/);

assert.doesNotMatch(
  content,
  /const shortVideoSpend = \[[^\]]*(?:contentSceneCharge|click\.charge|display\.charge)/,
);
assert.doesNotMatch(
  popup,
  /const shortVideoSpend = firstNumber\([^;]*(?:contentSceneCharge|clickSummary\.charge|displaySummary\.charge)/,
);

assert.match(content, /const clickRoi = hasPaidActivity \? rawClickRoi : undefined/);
assert.match(content, /const displayRoi = hasPaidActivity \? rawDisplayRoi : undefined/);
assert.match(popup, /const clickRoi = hasPaidActivity \? rawClickRoi : null/);
assert.match(popup, /const displayRoi = hasPaidActivity \? rawDisplayRoi : null/);
assert.match(content, /const hasDirectPotentialSignal = \[/);
assert.match(content, /hasDirectPotentialSignal;\n\s*const rawClickRoi/);
assert.match(popup, /const hasDirectPotentialSignal = \[/);
assert.match(popup, /hasDirectPotentialSignal;\n\s*const rawClickRoi/);
assert.match(content, /const potentialRatio = hasPaidActivity \|\| hasTrafficActivity \? rawPotentialRatio : undefined/);
assert.match(popup, /const potentialRatio = hasPaidActivity \|\| hasTrafficActivity \? rawPotentialRatio : null/);

console.log('wxt no-spend guards passed');
