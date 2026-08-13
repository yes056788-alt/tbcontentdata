const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const taskSource = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'task.js'), 'utf8');
const start = taskSource.indexOf('function normalizeAccountSessionSummary');
const end = taskSource.indexOf('\n  function selectedBatchAccountIdList', start);
assert.ok(start >= 0 && end > start);

const context = vm.createContext({ Array, Boolean, Math, Number, Object, Set, String });
vm.runInContext(`
  let bridgeCapabilities = new Set();
  let accountSession = {};
  let selectedBatchGroupId = '';
  ${taskSource.slice(start, end)}
  globalThis.detailsState = function (summary, capabilities, groupId) {
    bridgeCapabilities = new Set(capabilities || []);
    accountSession = normalizeAccountSessionSummary(summary);
    selectedBatchGroupId = groupId;
    return batchAccountDetailsState();
  };
`, context, { filename: 'batch-account-details-model.js' });

function state(summary, capabilities = ['accountBatchMultiSelect']) {
  return JSON.parse(JSON.stringify(context.detailsState(summary, capabilities, 'group-1')));
}

const legacySummary = {
  unlocked: true,
  totalEnabledAccounts: 7,
  storeGroups: [{ id: 'group-1', name: '测试分组', enabledAccountCount: 7 }],
  stores: [{ id: 'store-1', name: '测试店铺', groupId: 'group-1', enabledAccountCount: 7 }],
};
assert.deepEqual(state(legacySummary), { kind: 'upgrade', actual: 0, expected: 7 });
assert.deepEqual(state({ ...legacySummary, schema: 2, accounts: [] }), {
  kind: 'incomplete', actual: 0, expected: 7,
});
assert.deepEqual(state({
  ...legacySummary,
  schema: 2,
  totalEnabledAccounts: 2,
  storeGroups: [{ id: 'group-1', name: '测试分组', enabledAccountCount: 2 }],
  accounts: [
    { id: 'account-1', storeId: 'store-1', storeName: '测试店铺', groupId: 'group-1' },
    { id: 'account-2', storeId: 'store-1', storeName: '测试店铺', groupId: 'group-1' },
  ],
}), { kind: 'ready', actual: 2, expected: 2 });
assert.deepEqual(state({
  ...legacySummary,
  schema: 2,
  totalEnabledAccounts: 2,
  storeGroups: [{ id: 'group-1', name: '测试分组', enabledAccountCount: 2 }],
  accounts: [
    { id: 'account-1', storeId: 'store-1', storeName: '测试店铺', groupId: 'group-1' },
  ],
}), { kind: 'incomplete', actual: 1, expected: 2 });
assert.deepEqual(state({ ...legacySummary, schema: 2, accounts: [] }, []), {
  kind: 'upgrade', actual: 0, expected: 7,
});

console.log('batch account detail compatibility guards passed');
