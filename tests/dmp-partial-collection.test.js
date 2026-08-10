const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

assert.match(source, /const availableCrowds = inspectedCrowds\.filter/);
assert.match(source, /const availableWanted = wanted\.filter/);
assert.match(source, /selectedRoles: availableWanted\.map/);
assert.match(source, /snapshot\.missingCrowds = missingRoles\.map/);
assert.match(source, /requestedTags: \['年龄', '消费能力等级'\]/);
assert.match(source, /tags: \[portraitTags\.age, portraitTags\.consumer\]/);
assert.match(source, /const maxPortraitAttempts = 3/);
assert.match(source, /attempt <= maxPortraitAttempts/);
assert.match(source, /if \(hasAgeRows && hasConsumerRows\) break/);
assert.match(source, /await sleep\(1500 \* attempt\)/);
assert.match(source, /portraitAttempts,/);
assert.match(source, /name: '小红书进店人群'/);
assert.match(source, /已读取：.*个人群/);
assert.doesNotMatch(
  source,
  /inspection\.ok === false \|\| missingCrowds\.length/
);

console.log('dmp partial collection guards passed');
