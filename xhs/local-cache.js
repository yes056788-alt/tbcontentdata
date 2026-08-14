(function initXhsLocalCache(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsLocalCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsLocalCacheApi(root) {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function createRecord(cacheKey, fingerprint) {
    return {
      cacheKey,
      fingerprint,
      status: 'running',
      nextPage: 1,
      expectedCount: null,
      receivedCount: 0,
      pageCount: 0,
      cancelRequested: false,
      truncated: false,
      warnings: [],
      pages: [],
      updatedAt: Date.now(),
    };
  }

  function assertFingerprint(record, fingerprint) {
    if (record.fingerprint === fingerprint) return;
    const error = new Error('Cached query fingerprint does not match the requested query.');
    error.code = 'XHS_QUERY_FINGERPRINT_MISMATCH';
    error.retryable = false;
    throw error;
  }

  function normalizePages(pages) {
    return pages.slice().sort((left, right) => left.page - right.page);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    });
  }

  function createIndexedDbCache(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const indexedDbFactory = Object.prototype.hasOwnProperty.call(settings, 'indexedDB')
      ? settings.indexedDB
      : root.indexedDB;
    if (!indexedDbFactory || typeof indexedDbFactory.open !== 'function') {
      throw new Error('IndexedDB is unavailable; an IndexedDB implementation is required.');
    }
    const databaseName = String(settings.databaseName || 'tbcontentdata-xhs-cache-v1');
    let databasePromise = null;

    function openDatabase() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDbFactory.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('runs')) {
            database.createObjectStore('runs', { keyPath: 'runId' });
          }
          if (!database.objectStoreNames.contains('pages')) {
            const pages = database.createObjectStore('pages', { keyPath: 'id' });
            pages.createIndex('cacheKey', 'cacheKey', { unique: false });
          }
          if (!database.objectStoreNames.contains('datasets')) {
            database.createObjectStore('datasets', { keyPath: 'cacheKey' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open the XHS IndexedDB cache.'));
        request.onblocked = () => reject(new Error('The XHS IndexedDB cache upgrade is blocked.'));
      });
      return databasePromise;
    }

    async function readDataset(database, cacheKey) {
      const transaction = database.transaction(['datasets', 'pages'], 'readonly');
      const datasetRequest = transaction.objectStore('datasets').get(cacheKey);
      const pagesRequest = transaction.objectStore('pages').index('cacheKey').getAll(cacheKey);
      const [dataset, pages] = await Promise.all([
        requestResult(datasetRequest),
        requestResult(pagesRequest),
      ]);
      await transactionDone(transaction);
      if (!dataset) return null;
      return Object.assign({}, dataset, { pages: normalizePages(pages || []) });
    }

    return Object.freeze({
      async open(cacheKey, fingerprint) {
        const database = await openDatabase();
        const existing = await readDataset(database, cacheKey);
        if (existing) {
          assertFingerprint(existing, fingerprint);
          return clone(existing);
        }
        const transaction = database.transaction(['datasets'], 'readwrite');
        const record = createRecord(cacheKey, fingerprint);
        const dataset = Object.assign({}, record);
        delete dataset.pages;
        transaction.objectStore('datasets').put(dataset);
        await transactionDone(transaction);
        return record;
      },

      async read(cacheKey) {
        return clone(await readDataset(await openDatabase(), cacheKey));
      },

      async commitPage(cacheKey, fingerprint, pageRecord) {
        const database = await openDatabase();
        const transaction = database.transaction(['pages', 'datasets'], 'readwrite');
        const pages = transaction.objectStore('pages');
        const datasets = transaction.objectStore('datasets');
        const page = Math.max(1, Number(pageRecord.page) || 1);
        const id = `${cacheKey}:${page}`;
        const [dataset, existing] = await Promise.all([
          requestResult(datasets.get(cacheKey)),
          requestResult(pages.get(id)),
        ]);
        if (!dataset) {
          transaction.abort();
          throw new Error(`Cache is not initialized: ${cacheKey}`);
        }
        assertFingerprint(dataset, fingerprint);
        const items = Array.isArray(pageRecord.items) ? clone(pageRecord.items) : [];
        pages.put({ id, cacheKey, page, items, rowCount: items.length, committedAt: Date.now() });
        const previousCount = existing ? Number(existing.rowCount) || 0 : 0;
        dataset.receivedCount = Math.max(0, (Number(dataset.receivedCount) || 0) - previousCount + items.length);
        dataset.pageCount = Math.max(0, (Number(dataset.pageCount) || 0) + (existing ? 0 : 1));
        dataset.expectedCount = Number.isFinite(Number(pageRecord.expectedCount))
          ? Number(pageRecord.expectedCount)
          : dataset.expectedCount;
        dataset.nextPage = pageRecord.nextPage == null ? null : Math.max(1, Number(pageRecord.nextPage) || page + 1);
        dataset.status = 'running';
        dataset.truncated = false;
        dataset.warnings = [];
        dataset.updatedAt = Date.now();
        datasets.put(dataset);
        await transactionDone(transaction);
        return clone(await readDataset(database, cacheKey));
      },

      async requestCancel(cacheKey) {
        const database = await openDatabase();
        const transaction = database.transaction(['datasets'], 'readwrite');
        const store = transaction.objectStore('datasets');
        const dataset = await requestResult(store.get(cacheKey));
        if (!dataset) {
          transaction.abort();
          return false;
        }
        dataset.cancelRequested = true;
        dataset.updatedAt = Date.now();
        store.put(dataset);
        await transactionDone(transaction);
        return true;
      },

      async update(cacheKey, patch) {
        const database = await openDatabase();
        const transaction = database.transaction(['datasets'], 'readwrite');
        const store = transaction.objectStore('datasets');
        const dataset = await requestResult(store.get(cacheKey));
        if (!dataset) {
          transaction.abort();
          throw new Error(`Cache is not initialized: ${cacheKey}`);
        }
        Object.assign(dataset, clone(patch || {}), { updatedAt: Date.now() });
        store.put(dataset);
        await transactionDone(transaction);
        return clone(await readDataset(database, cacheKey));
      },

      async remove(cacheKey) {
        const database = await openDatabase();
        const transaction = database.transaction(['pages', 'datasets'], 'readwrite');
        const pages = transaction.objectStore('pages');
        const keys = await requestResult(pages.index('cacheKey').getAllKeys(cacheKey));
        for (const key of keys || []) pages.delete(key);
        transaction.objectStore('datasets').delete(cacheKey);
        await transactionDone(transaction);
        return true;
      },
    });
  }

  function createMemoryCache() {
    const records = new Map();

    return Object.freeze({
      async open(cacheKey, fingerprint) {
        let record = records.get(cacheKey);
        if (!record) {
          record = createRecord(cacheKey, fingerprint);
          records.set(cacheKey, record);
        } else {
          assertFingerprint(record, fingerprint);
        }
        return clone(record);
      },

      async read(cacheKey) {
        const record = records.get(cacheKey);
        return record ? clone(record) : null;
      },

      async commitPage(cacheKey, fingerprint, pageRecord) {
        const record = records.get(cacheKey);
        if (!record) throw new Error(`Cache is not initialized: ${cacheKey}`);
        assertFingerprint(record, fingerprint);

        const page = Math.max(1, Number(pageRecord.page) || 1);
        const items = Array.isArray(pageRecord.items) ? clone(pageRecord.items) : [];
        const existingIndex = record.pages.findIndex((entry) => entry.page === page);
        const entry = {
          page,
          items,
          rowCount: items.length,
          committedAt: Date.now(),
        };
        if (existingIndex >= 0) record.pages[existingIndex] = entry;
        else record.pages.push(entry);
        record.pages = normalizePages(record.pages);
        record.receivedCount = record.pages.reduce((sum, current) => sum + current.rowCount, 0);
        record.pageCount = record.pages.length;
        record.expectedCount = Number.isFinite(Number(pageRecord.expectedCount))
          ? Number(pageRecord.expectedCount)
          : record.expectedCount;
        record.nextPage = pageRecord.nextPage == null ? null : Math.max(1, Number(pageRecord.nextPage) || page + 1);
        record.status = 'running';
        record.truncated = false;
        record.warnings = [];
        record.updatedAt = Date.now();
        return clone(record);
      },

      async requestCancel(cacheKey) {
        const record = records.get(cacheKey);
        if (!record) return false;
        record.cancelRequested = true;
        record.updatedAt = Date.now();
        return true;
      },

      async update(cacheKey, patch) {
        const record = records.get(cacheKey);
        if (!record) throw new Error(`Cache is not initialized: ${cacheKey}`);
        Object.assign(record, clone(patch || {}), { updatedAt: Date.now() });
        return clone(record);
      },

      async remove(cacheKey) {
        return records.delete(cacheKey);
      },
    });
  }

  return Object.freeze({
    assertFingerprint,
    createIndexedDbCache,
    createMemoryCache,
    createRecord,
  });
});
