const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const report = fs.readFileSync(path.join(root, 'web-tool', 'report.js'), 'utf8');

test('SYCM runner defines and propagates the report cancellation signal', () => {
  const runner = background.match(
    /async function runBusinessDefenseSycm\(options\) \{([\s\S]*?)\n\}\n\nasync function runBusinessDefenseWxt/
  );
  assert.ok(runner, 'SYCM runner must accept an options object');
  assert.match(runner[1], /const signal = source\.signal;/);
  assert.match(runner[1], /waitTabComplete\(tabId, 45000, signal\)/);
  assert.match(runner[1], /reloadPlatformTab\(tabId, 45000, signal\)/);
  assert.match(
    runner[1],
    /sendTabMessageWithRetry\([\s\S]*\{ frameId: 0 \}, signal\)/,
    'the long-running page request must remain cancellable'
  );
});

test('content diagnosis passes its task signal into the SYCM runner', () => {
  const reportRunner = background.match(
    /async function runContentDiagnosisReport\(options\) \{([\s\S]*?)\n\}\n\nfunction batchText/
  );
  assert.ok(reportRunner, 'expected content diagnosis report runner');
  assert.match(reportRunner[1], /runBusinessDefenseSycm\(\{ signal \}\)/);
});

test('SYCM-only runs render the traffic report without requiring Guanghe data', () => {
  assert.match(
    report,
    /if \(section === 'flow'\) return Boolean\(reportData && reportData\.sycm\);/,
    'a successful SYCM-only run must not remain stuck at “等待流量诊断”'
  );
});
