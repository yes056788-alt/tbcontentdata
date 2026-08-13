const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'web-tool', 'batch-report-export.js'), 'utf8');
const windowObject = {};
vm.runInNewContext(source, {
  Array,
  DataView,
  Date,
  Error,
  Math,
  Number,
  Object,
  Set,
  String,
  TextEncoder,
  Uint8Array,
  Uint32Array,
  window: windowObject,
});
const api = windowObject.TaobaoBatchReportExport;

function localZipEntries(bytes) {
  const entries = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      data: decoder.decode(bytes.subarray(dataStart, dataStart + size)),
      flags,
      method,
      crc,
    });
    offset = dataStart + size;
  }
  return { entries, centralOffset: offset, signature: view.getUint32(offset, true) };
}

test('selects all histories for one store and latest or all histories for a group', () => {
  const stores = [
    { id: 's1', name: '店铺一' },
    { id: 's2', name: '店铺二' },
    { id: 's3', name: '同名店' },
    { id: 's4', name: '同名店' },
  ];
  const runs = [
    { runId: 'store-run-s1-old', taskType: 'report', storeId: 's1', storeName: '店铺一', finishedAt: 100 },
    { runId: 'store-run-s1-new', taskType: 'report', storeId: 's1', storeName: '店铺一', finishedAt: 300 },
    { runId: 'store-run-s2-old', taskType: 'both', storeId: 's2', storeName: '店铺二', finishedAt: 200 },
    { runId: 'store-run-s2-new', taskType: 'report', storeId: 's2', storeName: '店铺二', finishedAt: 400 },
    { runId: 'store-run-s1-legacy', taskType: 'report', storeName: '店铺一', finishedAt: 50 },
    { runId: 'store-run-s1-legacy-unknown-type', storeName: '店铺一', finishedAt: 40 },
    { runId: 'same-name-store-three', taskType: 'report', storeId: 's3', storeName: '同名店', finishedAt: 600 },
    { runId: 'same-name-store-four', taskType: 'report', storeId: 's4', storeName: '同名店', finishedAt: 550 },
    { runId: 'ambiguous-legacy-store', taskType: 'report', storeName: '同名店', finishedAt: 700 },
    { runId: 'store-run-collect', taskType: 'collect', storeId: 's1', storeName: '店铺一', finishedAt: 500 },
  ];
  const oneStore = api.selectReportCandidates({ stores: [stores[0]], knownStores: stores, runs, historyMode: 'all' });
  assert.deepEqual(JSON.parse(JSON.stringify(oneStore.map((item) => item.run.runId))), [
    'store-run-s1-new', 'store-run-s1-old', 'store-run-s1-legacy', 'store-run-s1-legacy-unknown-type',
  ]);
  const latest = api.selectReportCandidates({ stores, knownStores: stores, runs, historyMode: 'latest' });
  assert.deepEqual(JSON.parse(JSON.stringify(latest.map((item) => item.run.runId))), [
    'same-name-store-three', 'same-name-store-four', 'store-run-s2-new', 'store-run-s1-new',
  ]);
  const all = api.selectReportCandidates({ stores, knownStores: stores, runs, historyMode: 'all' });
  assert.deepEqual(JSON.parse(JSON.stringify(all.map((item) => item.run.runId))), [
    'same-name-store-three', 'same-name-store-four', 'store-run-s2-new', 'store-run-s1-new',
    'store-run-s2-old', 'store-run-s1-old', 'store-run-s1-legacy', 'store-run-s1-legacy-unknown-type',
  ]);
  assert.ok(!all.some((item) => item.run.runId === 'ambiguous-legacy-store'));
});

test('sanitizes hostile filenames and CSV formula prefixes', () => {
  for (const value of ['../店铺', '..\\店铺', 'CON', 'A/B:C*D?E"F<G>H|I', '\u202eexe.html']) {
    const filename = api.sanitizeFilename(value, '报告');
    assert.doesNotMatch(filename, /[\\/\u0000-\u001f\u202a-\u202e]/);
    assert.notEqual(filename, '.');
    assert.notEqual(filename, '..');
    assert.ok(new TextEncoder().encode(filename).length <= 101);
  }
  assert.match(api.sanitizeFilename('CON', '报告'), /^_/);
  assert.equal(api.csvCell('=1+1'), '"\'=1+1"');
  assert.equal(api.csvCell('a"b'), '"a""b"');
});

test('builds one UTF-8 stored ZIP containing independent report files', () => {
  const bytes = api.createStoredZip([
    { name: '001_店铺一.html', data: '<!doctype html><p>报告一</p>', updatedAt: Date.now() },
    { name: '导出清单.csv', data: '\ufeff"店铺"\r\n"店铺一"', updatedAt: Date.now() },
  ]);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const parsed = localZipEntries(bytes);
  assert.equal(parsed.signature, 0x02014b50);
  assert.deepEqual(parsed.entries.map((entry) => entry.name), ['001_店铺一.html', '导出清单.csv']);
  assert.match(parsed.entries[0].data, /报告一/);
  assert.ok(parsed.entries.every((entry) => entry.method === 0));
  assert.ok(parsed.entries.every((entry) => (entry.flags & 0x0800) !== 0));
  const knownCrcZip = localZipEntries(api.createStoredZip([{ name: 'crc.txt', data: '123456789' }]));
  assert.equal(knownCrcZip.entries[0].crc, 0xcbf43926);
  assert.throws(() => api.createStoredZip([{ name: '../bad.html', data: 'x' }]), /文件名无效/);
  assert.throws(() => api.createStoredZip([
    { name: 'same.html', data: 'a' },
    { name: 'same.html', data: 'b' },
  ]), /文件名重复/);
});
