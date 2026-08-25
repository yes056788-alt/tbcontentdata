const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const entryFiles = ['project.js', 'task.js'];

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('Unable to extract ' + name);
}

function loadDeleteStoreRun(filename, options) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web-tool', filename), 'utf8');
  const sandbox = {
    document: {
      querySelector(selector) {
        return options.cloudPage && selector === '.cloud-team-topbar' ? {} : null;
      },
    },
    fetch: options.fetch,
    isPlainObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    },
    request: options.request,
    window: {
      location: { hostname: options.hostname },
      TaobaoCloudSync: options.cloudSync,
    },
  };
  vm.runInNewContext(
    extractFunction(source, 'deleteStoreRun') +
      '\nglobalThis.testDeleteStoreRun = deleteStoreRun;',
    sandbox,
    { filename },
  );
  return sandbox.testDeleteStoreRun;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

for (const filename of entryFiles) {
  test(filename + ' prefers cloud deletion even on localhost', async () => {
    const calls = [];
    const deleteStoreRun = loadDeleteStoreRun(filename, {
      hostname: '127.0.0.1',
      cloudPage: true,
      cloudSync: {
        async deleteRun(runId) {
          calls.push(['cloud', runId]);
          return { deleted: true, runId };
        },
      },
      fetch: async () => { throw new Error('direct fetch must not run'); },
      request: async () => { throw new Error('local-only delete must not run'); },
    });

    const result = await deleteStoreRun('store-run-localhost-server');
    assert.equal(result.deleted, true);
    assert.deepEqual(calls, [['cloud', 'store-run-localhost-server']]);
  });

  test(filename + ' falls back to the server API when cloud-sync is missing', async () => {
    const calls = [];
    const deleteStoreRun = loadDeleteStoreRun(filename, {
      hostname: '127.0.0.1',
      cloudPage: true,
      cloudSync: undefined,
      fetch: async (input, init) => {
        const url = new URL(input, 'http://127.0.0.1:3400');
        const method = (init && init.method) || 'GET';
        if (url.pathname === '/api/session') {
          calls.push('session');
          return jsonResponse({ role: 'owner', permissions: { deleteRuns: true } });
        }
        if (url.pathname === '/api/runs/store-run-fallback' && method === 'DELETE') {
          calls.push('remote');
          return jsonResponse({ deleted: true, cleanupPending: false });
        }
        throw new Error('unexpected request: ' + method + ' ' + url.pathname);
      },
      request: async (action, payload) => {
        calls.push('local');
        assert.equal(action, 'deleteStoreRun');
        assert.equal(payload.runId, 'store-run-fallback');
        return { deleted: true };
      },
    });

    await deleteStoreRun('store-run-fallback');
    assert.deepEqual(calls, ['session', 'remote', 'local']);
  });

  test(filename + ' keeps the legacy localhost page local-only', async () => {
    const calls = [];
    const deleteStoreRun = loadDeleteStoreRun(filename, {
      hostname: 'localhost',
      cloudPage: false,
      cloudSync: undefined,
      fetch: async () => { throw new Error('legacy page must not call the server API'); },
      request: async (action, payload) => {
        calls.push([action, payload.runId]);
        return { deleted: true };
      },
    });

    await deleteStoreRun('store-run-legacy-local');
    assert.deepEqual(calls, [['deleteStoreRun', 'store-run-legacy-local']]);
  });
}
