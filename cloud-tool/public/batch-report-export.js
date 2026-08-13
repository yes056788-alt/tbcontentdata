(function () {
  'use strict';

  const MAX_REPORTS = 50;
  const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }

  function utf8(value) {
    return encoder.encode(String(value == null ? '' : value));
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function truncateUtf8(value, maxBytes) {
    let output = '';
    for (const character of String(value || '')) {
      if (utf8(output + character).length > maxBytes) break;
      output += character;
    }
    return output;
  }

  function sanitizeFilename(value, fallback) {
    let output = String(value || '').normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    output = truncateUtf8(output, 100).replace(/[.\s]+$/g, '');
    if (!output || output === '.' || output === '..') output = String(fallback || '报告');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(output)) output = '_' + output;
    return output;
  }

  function dateParts(value) {
    const date = new Date(Number(value) || value || Date.now());
    const valid = Number.isFinite(date.getTime()) ? date : new Date();
    const pad = (number) => String(number).padStart(2, '0');
    return {
      compact: valid.getFullYear() + pad(valid.getMonth() + 1) + pad(valid.getDate()) + '_' +
        pad(valid.getHours()) + pad(valid.getMinutes()) + pad(valid.getSeconds()),
      display: valid.toLocaleString('zh-CN', { hour12: false }),
      dosTime: (valid.getHours() << 11) | (valid.getMinutes() << 5) | Math.floor(valid.getSeconds() / 2),
      dosDate: (Math.max(1980, valid.getFullYear()) - 1980) << 9 |
        (valid.getMonth() + 1) << 5 | valid.getDate(),
    };
  }

  function concatBytes(parts, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function createStoredZip(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('批量导出内容为空。');
    if (entries.length > 0xffff) throw new Error('批量导出文件数过多。');
    const localParts = [];
    const centralParts = [];
    const names = new Set();
    let localOffset = 0;
    let centralSize = 0;

    entries.forEach((entry) => {
      const name = String(entry && entry.name || '');
      if (!name || /[\\/]/.test(name) || name === '.' || name === '..') {
        throw new Error('批量导出文件名无效。');
      }
      if (names.has(name)) throw new Error('批量导出文件名重复：' + name);
      names.add(name);
      const nameBytes = utf8(name);
      const data = entry.data instanceof Uint8Array ? entry.data : utf8(entry.data);
      if (nameBytes.length > 0xffff || data.length > 0xffffffff) throw new Error('批量导出文件过大。');
      const timestamp = dateParts(entry.updatedAt);
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, timestamp.dosTime, true);
      localView.setUint16(12, timestamp.dosDate, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localParts.push(localHeader, nameBytes, data);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, timestamp.dosTime, true);
      centralView.setUint16(14, timestamp.dosDate, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, localOffset, true);
      centralParts.push(centralHeader, nameBytes);
      centralSize += centralHeader.length + nameBytes.length;
      localOffset += localHeader.length + nameBytes.length + data.length;
    });

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    return concatBytes(localParts.concat(centralParts, end), localOffset + centralSize + end.length);
  }

  function csvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function selectReportCandidates(options) {
    const source = options && typeof options === 'object' ? options : {};
    const stores = Array.isArray(source.stores) ? source.stores.filter((store) => store && store.id && store.name) : [];
    const knownStores = Array.isArray(source.knownStores) ? source.knownStores : stores;
    const runs = Array.isArray(source.runs) ? source.runs : [];
    const historyMode = source.historyMode === 'all' ? 'all' : 'latest';
    const storeNameCounts = new Map();
    knownStores.forEach((store) => {
      if (!store || !store.name) return;
      storeNameCounts.set(store.name, (storeNameCounts.get(store.name) || 0) + 1);
    });
    const candidates = [];
    stores.forEach((store) => {
      const matching = runs.filter((run) => run && ['report', 'both'].includes(run.taskType || 'both') && (
        run.storeId
          ? run.storeId === store.id
          : storeNameCounts.get(store.name) === 1 && String(run.storeName || '') === store.name
      )).sort((left, right) => Number(right.finishedAt) - Number(left.finishedAt));
      const selected = historyMode === 'all' ? matching : matching.slice(0, 1);
      selected.forEach((run) => candidates.push({ store, run }));
    });
    const seen = new Set();
    return candidates.filter((candidate) => {
      const runId = String(candidate.run && candidate.run.runId || '');
      if (!runId || seen.has(runId)) return false;
      seen.add(runId);
      return true;
    }).sort((left, right) => Number(right.run.finishedAt) - Number(left.run.finishedAt));
  }

  window.TaobaoBatchReportExport = Object.freeze({
    MAX_REPORTS,
    MAX_TOTAL_BYTES,
    createStoredZip,
    csvCell,
    dateParts,
    sanitizeFilename,
    selectReportCandidates,
    utf8,
  });
})();
