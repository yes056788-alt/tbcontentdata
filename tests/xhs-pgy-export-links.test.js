const assert = require('node:assert/strict');
const test = require('node:test');

global.XhsContract = require('../xhs/contract');
const { parseWorkbook } = require('../xhs/pgy-export-links');
const XLSX = require('../vendor/xlsx.full.min.js');

function officialNoteUrl(noteId) {
  return `https://www.xiaohongshu.com/explore/${noteId}` +
    `?xsec_token=official-workbook-${noteId}&xsec_source=pc_pgyexport`;
}

test('parses the three-row PGY workbook header and maps only validated official links by noteId', () => {
  const rows = [
    ['蒲公英笔记数据导出'],
    ['导出时间', '2030-01-08'],
    ['序号', '笔记标题', '其他', '其他2', '其他3', '笔记链接', '发布日期', '其他4', '其他5', '其他6', '笔记id'],
    [1, '虚构笔记一', '', '', '', officialNoteUrl('fictional-export-note-001'), '2030-01-02', '', '', '', 'fictional-export-note-001'],
    [2, '错配链接', '', '', '', officialNoteUrl('different-note'), '2030-01-03', '', '', '', 'fictional-export-note-002'],
    [3, '恶意域名', '', '', '', 'https://attacker.example/explore/fictional-export-note-003?xsec_token=bad-token&xsec_source=pc_pgyexport', '2030-01-04', '', '', '', 'fictional-export-note-003'],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '笔记报告');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = parseWorkbook(buffer, XLSX, [
    'fictional-export-note-001',
    'fictional-export-note-002',
    'fictional-export-note-003',
  ]);

  assert.deepEqual(result.links, [[
    'fictional-export-note-001',
    officialNoteUrl('fictional-export-note-001'),
  ]]);
  assert.equal(result.parsedRowCount, 3);
  assert.equal(result.rejectedRowCount, 2);
  assert.equal(result.matchedNoteCount, 1);
});

test('fails closed when the export workbook schema does not contain a note-link column', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['标题', '发布日期'],
    ['虚构笔记', '2030-01-02'],
  ]), '错误格式');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  assert.throws(() => parseWorkbook(buffer, XLSX), /笔记链接/i);
});

test('extracts noteId from the official link when the PGY workbook has no separate note ID column', () => {
  const rows = [
    ['标题', '发布时间', '笔记链接'],
    ['虚构笔记一', '2030-01-02', officialNoteUrl('fictional-link-only-note-001')],
    ['非任务笔记', '2030-01-03', officialNoteUrl('fictional-link-only-note-999')],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '笔记列表');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = parseWorkbook(buffer, XLSX, ['fictional-link-only-note-001']);

  assert.deepEqual(result.links, [[
    'fictional-link-only-note-001',
    officialNoteUrl('fictional-link-only-note-001'),
  ]]);
  assert.equal(result.parsedRowCount, 2);
  assert.equal(result.rejectedRowCount, 0);
  assert.equal(result.matchedNoteCount, 1);
});

test('reads official note URLs from XLSX hyperlink relationships instead of the display label', () => {
  const validNoteId = 'fictional-hyperlink-note-001';
  const bareNoteId = 'fictional-hyperlink-note-002';
  const hostileNoteId = 'fictional-hyperlink-note-003';
  const sheet = XLSX.utils.aoa_to_sheet([
    ['笔记标题', '笔记链接'],
    ['合法官方链接', '查看笔记'],
    ['缺少官方签名', '查看笔记'],
    ['非官方域名', '查看笔记'],
  ]);
  sheet.B2.l = { Target: officialNoteUrl(validNoteId), Tooltip: '查看笔记' };
  sheet.B3.l = {
    Target: `https://www.xiaohongshu.com/explore/${bareNoteId}`,
    Tooltip: '查看笔记',
  };
  sheet.B4.l = {
    Target: `https://attacker.example/explore/${hostileNoteId}` +
      '?xsec_token=bad-token&xsec_source=pc_pgyexport',
    Tooltip: '查看笔记',
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '笔记报告');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = parseWorkbook(buffer, XLSX, [validNoteId, bareNoteId, hostileNoteId]);

  assert.deepEqual(result.links, [[validNoteId, officialNoteUrl(validNoteId)]]);
  assert.equal(result.parsedRowCount, 3);
  assert.equal(result.rejectedRowCount, 2);
  assert.equal(result.matchedNoteCount, 1);
});
