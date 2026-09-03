(function initXhsPgyExportLinks(root, factory) {
  const api = factory(root.XhsContract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsPgyExportLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsPgyExportLinks(contract) {
  'use strict';

  function cleanHeader(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[\s_\-（）()]/g, '');
  }

  function headerIndex(row, candidates) {
    const wanted = new Set(candidates.map(cleanHeader));
    return row.findIndex((value) => wanted.has(cleanHeader(value)));
  }

  function expectedNoteSet(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return new Set(values.map((value) => String(value == null ? '' : value).trim()).filter(Boolean));
  }

  function noteIdFromOfficialUrl(value) {
    try {
      const match = new URL(value).pathname.match(/^\/explore\/([^/]+)\/?$/i);
      const noteId = match ? decodeURIComponent(match[1]) : '';
      return /^[a-z0-9_-]{3,128}$/i.test(noteId) ? noteId : '';
    } catch (error) {
      return '';
    }
  }

  function cellHyperlinkTarget(sheet, xlsx, rowIndex, columnIndex) {
    if (!sheet || !xlsx || !xlsx.utils || typeof xlsx.utils.encode_cell !== 'function') return '';
    let rowOffset = 0;
    let columnOffset = 0;
    if (typeof sheet['!ref'] === 'string' && typeof xlsx.utils.decode_range === 'function') {
      try {
        const range = xlsx.utils.decode_range(sheet['!ref']);
        rowOffset = range && range.s && Number.isInteger(range.s.r) ? range.s.r : 0;
        columnOffset = range && range.s && Number.isInteger(range.s.c) ? range.s.c : 0;
      } catch (error) {
        rowOffset = 0;
        columnOffset = 0;
      }
    }
    const address = xlsx.utils.encode_cell({
      r: rowOffset + rowIndex,
      c: columnOffset + columnIndex,
    });
    const cell = sheet[address];
    const target = cell && cell.l && (cell.l.Target || cell.l.target);
    return String(target == null ? '' : target)
      // SheetJS may preserve the XML relationship escaping in external URLs.
      // Normalize only ampersand separators; the URL still goes through the
      // strict official-note validator below.
      .replace(/&(?:amp|#38|#x26);/gi, '&')
      .trim();
  }

  function parseWorkbook(arrayBuffer, xlsx, expectedNoteIds) {
    if (!contract || typeof contract.sanitizeOfficialNoteUrl !== 'function') {
      throw new Error('XHS official-note URL validator is unavailable.');
    }
    if (!xlsx || typeof xlsx.read !== 'function' || !xlsx.utils ||
        typeof xlsx.utils.sheet_to_json !== 'function') {
      throw new Error('XLSX parser is unavailable for the PGY export result.');
    }
    const workbook = xlsx.read(arrayBuffer, { type: 'array', cellDates: false });
    const expected = expectedNoteSet(expectedNoteIds);
    const byNoteId = new Map();
    let parsedRowCount = 0;
    let rejectedRowCount = 0;
    let headerFound = false;

    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets && workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
        // Keep worksheet row offsets intact so hyperlink relationships can be
        // resolved from the original cell address.
        blankrows: true,
      });
      let headerRow = -1;
      let noteIdColumn = -1;
      let noteUrlColumn = -1;
      for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
        const row = Array.isArray(rows[index]) ? rows[index] : [];
        const candidateNoteIdColumn = headerIndex(row, ['笔记id', 'noteid']);
        const candidateNoteUrlColumn = headerIndex(row, ['笔记链接', '笔记url', 'noteurl']);
        if (candidateNoteUrlColumn >= 0) {
          headerRow = index;
          noteIdColumn = candidateNoteIdColumn;
          noteUrlColumn = candidateNoteUrlColumn;
          headerFound = true;
          break;
        }
      }
      if (headerRow < 0) continue;
      for (let index = headerRow + 1; index < rows.length; index += 1) {
        const row = Array.isArray(rows[index]) ? rows[index] : [];
        let noteId = noteIdColumn >= 0
          ? String(row[noteIdColumn] == null ? '' : row[noteIdColumn]).trim()
          : '';
        const displayedUrl = String(row[noteUrlColumn] == null ? '' : row[noteUrlColumn]).trim();
        const rawUrl = cellHyperlinkTarget(sheet, xlsx, index, noteUrlColumn) || displayedUrl;
        if (!noteId && !rawUrl) continue;
        parsedRowCount += 1;
        const officialUrl = contract.sanitizeOfficialNoteUrl(rawUrl, noteId || undefined);
        if (!officialUrl) {
          rejectedRowCount += 1;
          continue;
        }
        if (!noteId) noteId = noteIdFromOfficialUrl(officialUrl);
        if (!noteId || (expected && !expected.has(noteId))) continue;
        byNoteId.set(noteId, officialUrl);
      }
    }

    if (!headerFound) {
      throw new Error('PGY export workbook is missing the 笔记链接 column.');
    }
    return {
      links: [...byNoteId.entries()],
      parsedRowCount,
      rejectedRowCount,
      matchedNoteCount: byNoteId.size,
    };
  }

  return Object.freeze({ parseWorkbook });
});
