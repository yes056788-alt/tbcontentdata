(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const VAULT_KEY = 'taobaoAccountVaultV1';
  const DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const MAX_API_BYTES = 28 * 1024 * 1024;
  const MAX_RUN_BYTES = 24 * 1024 * 1024;
  const SYNC_KEYS = new Set([VAULT_KEY, DIRECTORY_KEY, RUN_INDEX_KEY]);
  const pendingBridgeRequests = new Map();
  const state = {
    enabled: false,
    connected: false,
    syncing: false,
    lastSyncedAt: 0,
    lastError: '',
    role: '',
    conflicts: [],
  };
  let stopped = false;
  let started = false;
  let startPromise = null;
  let syncPromise = null;
  let rerunRequested = false;
  let syncTimer = 0;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]';
  }

  function isLocalHost() {
    const hostname = String(location.hostname || '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  }

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
  }

  function validBase64(value, maxLength) {
    const text = cleanText(value, maxLength);
    return text && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : '';
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 4102444800000 ? number : 0;
  }

  function revision(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function utf8ByteLength(value, limit) {
    const text = String(value || '');
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
          text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > limit) return bytes;
    }
    return bytes;
  }

  function safeJson(value, maxBytes, label) {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new Error(label + '不是可同步的 JSON 数据。');
    }
    if (!serialized || utf8ByteLength(serialized, maxBytes) > maxBytes) {
      throw new Error(label + '超过 ' + Math.floor(maxBytes / 1024 / 1024) + 'MB 安全限制。');
    }
    return { serialized, value: JSON.parse(serialized) };
  }

  function sanitizeVaultRecord(value) {
    if (!isPlainObject(value)) return null;
    const kdf = isPlainObject(value.kdf) ? value.kdf : {};
    const cipher = isPlainObject(value.cipher) ? value.cipher : {};
    const iterations = Number(kdf.iterations);
    const salt = validBase64(kdf.salt, 200);
    const iv = validBase64(cipher.iv, 200);
    const data = validBase64(cipher.data, 8 * 1024 * 1024);
    if (Number(value.schema) !== 1 || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' ||
        cipher.name !== 'AES-GCM' || !Number.isInteger(iterations) || iterations < 150000 ||
        iterations > 1000000 || !salt || !iv || !data || !timestamp(value.updatedAt)) return null;
    return {
      schema: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
      cipher: { name: 'AES-GCM', iv, data },
      updatedAt: timestamp(value.updatedAt),
    };
  }

  function sanitizeDirectory(value) {
    if (!isPlainObject(value) || Number(value.schema) !== 1 || !timestamp(value.updatedAt)) return null;
    const groupIds = new Set();
    const storeGroups = (Array.isArray(value.storeGroups) ? value.storeGroups : []).slice(0, 300).map((raw) => {
      const group = isPlainObject(raw) ? raw : {};
      const id = cleanText(group.id, 100);
      const name = cleanText(group.name, 80);
      if (!id || !name || groupIds.has(id)) return null;
      groupIds.add(id);
      return { id, name };
    }).filter(Boolean);
    const storeIds = new Set();
    const stores = (Array.isArray(value.stores) ? value.stores : []).slice(0, 1000).map((raw) => {
      const store = isPlainObject(raw) ? raw : {};
      const id = cleanText(store.id, 100);
      const name = cleanText(store.name, 120);
      if (!id || !name || storeIds.has(id)) return null;
      storeIds.add(id);
      return {
        id,
        name,
        groupId: groupIds.has(store.groupId) ? store.groupId : '',
        createdAt: cleanText(store.createdAt, 80),
        updatedAt: cleanText(store.updatedAt, 80),
      };
    }).filter(Boolean);
    return {
      schema: 1,
      storeGroups,
      stores,
      updatedAt: timestamp(value.updatedAt),
    };
  }

  function sanitizeRunId(value) {
    const runId = cleanText(value, 120);
    return /^store-run-[a-z0-9-]+$/i.test(runId) ? runId : '';
  }

  function runFreshness(value) {
    const source = isPlainObject(value) ? value : {};
    return timestamp(source.updatedAt) || timestamp(source.finishedAt) || timestamp(source.startedAt);
  }

  function sanitizeRunMetadata(value) {
    if (!isPlainObject(value)) return null;
    const runId = sanitizeRunId(value.runId);
    if (!runId) return null;
    return {
      runId,
      updatedAt: runFreshness(value),
      finishedAt: timestamp(value.finishedAt),
    };
  }

  function containsSensitiveRunField(value, seen) {
    if (!value || typeof value !== 'object') return false;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      const normalized = String(key).toLowerCase().replace(/[_-]/g, '');
      if (normalized === 'masterpassword' || normalized === 'password') return true;
      if (containsSensitiveRunField(child, visited)) return true;
    }
    return false;
  }

  function sanitizeUploadRun(value, expectedRunId) {
    if (!isPlainObject(value) || containsSensitiveRunField(value)) {
      throw new Error('本地历史归档无效或包含不应上传的密码字段。');
    }
    const cloned = safeJson(value, MAX_RUN_BYTES, '本地历史归档').value;
    const runId = sanitizeRunId(cloned.runId);
    if (!runId || runId !== expectedRunId) throw new Error('本地历史归档编号不一致。');
    if (!isPlainObject(cloned.snapshots) || !isPlainObject(cloned.account)) {
      throw new Error('本地历史归档结构无效。');
    }
    return cloned;
  }

  function unwrapResponse(value) {
    return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  }

  function envelope(value, field) {
    const source = unwrapResponse(value);
    const object = isPlainObject(source) ? source : {};
    const record = Object.prototype.hasOwnProperty.call(object, field)
      ? object[field]
      : (Object.prototype.hasOwnProperty.call(object, 'record') ? object.record : null);
    return {
      record,
      revision: revision(object.revision == null ? object.version : object.revision),
      updatedAt: timestamp(object.updatedAt) || timestamp(record && record.updatedAt),
    };
  }

  function emit(type, detail) {
    Object.assign(state, detail || {});
    if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('taobao-cloud-sync', {
        detail: Object.assign({ type }, getState()),
      }));
    }
  }

  function getState() {
    return {
      enabled: state.enabled,
      connected: state.connected,
      syncing: state.syncing,
      lastSyncedAt: state.lastSyncedAt,
      lastError: state.lastError,
      role: state.role,
      conflicts: state.conflicts.slice(),
    };
  }

  function requestBridge(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'cloud-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pendingBridgeRequests.delete(requestId);
        reject(new Error('云同步连接数据助手超时。'));
      }, Number(timeoutMs) || 30000);
      pendingBridgeRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({
        channel: CHANNEL,
        type: 'request',
        requestId,
        action,
        payload: payload || {},
      }, location.origin);
    });
  }

  async function requestJson(path, options, maxBytes) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error('云同步只允许访问当前站点。');
    const request = Object.assign({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }, options || {});
    request.headers = Object.assign({ Accept: 'application/json' }, request.headers || {});
    if (request.body && typeof request.body !== 'string') {
      const body = safeJson(request.body, maxBytes || MAX_API_BYTES, '云同步请求').serialized;
      request.body = body;
      request.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url.toString(), request);
    const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
    const limit = Number(maxBytes) || MAX_API_BYTES;
    if (declaredLength > limit) throw new Error('云端返回数据超过安全限制。');
    const text = await response.text();
    if (utf8ByteLength(text, limit) > limit) throw new Error('云端返回数据超过安全限制。');
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new Error('云端返回了无效 JSON。');
      }
    }
    if (!response.ok) {
      const error = new Error(cleanText(body && (body.message || body.error), 500) ||
        ('云同步请求失败（' + response.status + '）。'));
      error.status = response.status;
      error.response = body;
      throw error;
    }
    return body;
  }

  function rolePermissions(sessionValue) {
    const source = unwrapResponse(sessionValue);
    const session = isPlainObject(source) ? source : {};
    const member = isPlainObject(session.member) ? session.member : {};
    const role = cleanText(session.role || member.role || (session.user && session.user.role), 30).toLowerCase();
    if (!['owner', 'admin', 'operator', 'viewer'].includes(role)) {
      throw new Error('当前用户尚未获得网页工具权限。');
    }
    const permissions = isPlainObject(session.permissions) ? session.permissions : {};
    const privileged = role === 'owner' || role === 'admin';
    const operative = privileged || role === 'operator';
    return {
      role,
      canReadVault: permissions.canReadVault == null ? operative : permissions.canReadVault === true,
      canWriteVault: permissions.canWriteVault == null ? privileged : permissions.canWriteVault === true,
      canWriteDirectory: permissions.canWriteDirectory == null ? operative : permissions.canWriteDirectory === true,
      canWriteRuns: permissions.canWriteRuns == null ? operative : permissions.canWriteRuns === true,
      canReadRuns: permissions.canReadRuns !== false,
    };
  }

  async function guardedRecordSync(config, permissions, conflicts) {
    const stored = await requestBridge('getStorage', { keys: [config.storageKey] }, 30000);
    const local = config.sanitize(stored && stored[config.storageKey]);
    const remoteResponse = await requestJson(config.apiPath);
    const remoteEnvelope = envelope(remoteResponse, config.field);
    const remote = config.sanitize(remoteEnvelope.record);
    if (!remote) {
      if (remoteEnvelope.record != null) throw new Error('云端' + config.label + '格式无效。');
      if (local && config.canWrite(permissions)) {
        try {
          await requestJson(config.apiPath, {
            method: 'PUT',
            body: {
              [config.field]: local,
              expectedRevision: remoteEnvelope.revision,
            },
          });
          return 'uploaded';
        } catch (error) {
          if (error.status !== 409) throw error;
          conflicts.push(config.field + ':remote-created');
          return 'conflict';
        }
      }
      return 'empty';
    }
    if (!local) {
      await requestBridge(config.setAction, { [config.field]: remote }, 45000);
      return 'downloaded';
    }
    const localJson = JSON.stringify(local);
    const remoteJson = JSON.stringify(remote);
    if (localJson === remoteJson) return 'same';
    const localUpdatedAt = timestamp(local.updatedAt);
    const remoteUpdatedAt = timestamp(remote.updatedAt) || remoteEnvelope.updatedAt;
    if (localUpdatedAt > remoteUpdatedAt && config.canWrite(permissions)) {
      try {
        await requestJson(config.apiPath, {
          method: 'PUT',
          body: {
            [config.field]: local,
            expectedRevision: remoteEnvelope.revision,
          },
        });
        return 'uploaded';
      } catch (error) {
        if (error.status !== 409) throw error;
        conflicts.push(config.field + ':revision');
        return 'conflict';
      }
    }
    if (remoteUpdatedAt > localUpdatedAt) {
      const latestStored = await requestBridge('getStorage', { keys: [config.storageKey] }, 30000);
      const latestLocal = config.sanitize(latestStored && latestStored[config.storageKey]);
      if (!latestLocal || JSON.stringify(latestLocal) !== localJson) {
        conflicts.push(config.field + ':local-changed');
        return 'conflict';
      }
      await requestBridge(config.setAction, { [config.field]: remote }, 45000);
      return 'downloaded';
    }
    conflicts.push(config.field + ':same-timestamp');
    return 'conflict';
  }

  async function syncRuns(permissions, conflicts) {
    if (!permissions.canReadRuns) return { uploaded: 0, downloaded: 0 };
    const localResponse = await requestBridge('listStoreRuns', {}, 30000);
    const localItems = (Array.isArray(localResponse && localResponse.runs) ? localResponse.runs : [])
      .slice(0, 1000).map(sanitizeRunMetadata).filter(Boolean);
    const remoteResponse = unwrapResponse(await requestJson('/api/runs'));
    const remoteArray = Array.isArray(remoteResponse)
      ? remoteResponse
      : (Array.isArray(remoteResponse && remoteResponse.runs) ? remoteResponse.runs
        : (Array.isArray(remoteResponse && remoteResponse.items) ? remoteResponse.items : []));
    const remoteItems = remoteArray.slice(0, 1000).map(sanitizeRunMetadata).filter(Boolean);
    const localMap = new Map(localItems.map((item) => [item.runId, item]));
    const remoteMap = new Map(remoteItems.map((item) => [item.runId, item]));
    let uploaded = 0;
    let downloaded = 0;
    if (permissions.canWriteRuns) {
      for (const metadata of localItems) {
        if (remoteMap.has(metadata.runId)) continue;
        const full = await requestBridge('getStoreRun', { runId: metadata.runId }, 45000);
        if (!full || !full.run) continue;
        const run = sanitizeUploadRun(full.run, metadata.runId);
        try {
          await requestJson('/api/runs', {
            method: 'POST',
            body: { run, metadata, expectedAbsent: true },
          }, MAX_API_BYTES);
          uploaded += 1;
        } catch (error) {
          if (error.status !== 409) throw error;
          conflicts.push('run:' + metadata.runId + ':remote-created');
        }
      }
    }
    for (const metadata of remoteItems) {
      if (localMap.has(metadata.runId)) continue;
      const response = unwrapResponse(await requestJson('/api/runs/' + encodeURIComponent(metadata.runId), {}, MAX_API_BYTES));
      const run = isPlainObject(response) && Object.prototype.hasOwnProperty.call(response, 'run')
        ? response.run
        : response;
      if (!isPlainObject(run) || sanitizeRunId(run.runId) !== metadata.runId) {
        throw new Error('云端历史归档编号不一致。');
      }
      const result = await requestBridge('importStoreRun', { runId: metadata.runId, run }, 60000);
      if (result && result.imported) downloaded += 1;
      else if (result && result.reason === 'local-newer-or-equal') {
        conflicts.push('run:' + metadata.runId + ':local-newer');
      }
    }
    return { uploaded, downloaded };
  }

  async function performSync() {
    emit('sync-start', { syncing: true, lastError: '', conflicts: [] });
    const conflicts = [];
    try {
      const sessionResponse = await requestJson('/api/session');
      const permissions = rolePermissions(sessionResponse);
      state.role = permissions.role;
      if (permissions.canReadVault) {
        await guardedRecordSync({
          storageKey: VAULT_KEY,
          apiPath: '/api/vault',
          field: 'vault',
          label: '账号库密文',
          sanitize: sanitizeVaultRecord,
          setAction: 'setAccountVault',
          canWrite: (value) => value.canWriteVault,
        }, permissions, conflicts);
      }
      await guardedRecordSync({
        storageKey: DIRECTORY_KEY,
        apiPath: '/api/directory',
        field: 'directory',
        label: '项目目录',
        sanitize: sanitizeDirectory,
        setAction: 'setProjectDirectory',
        canWrite: (value) => value.canWriteDirectory,
      }, permissions, conflicts);
      const runs = await syncRuns(permissions, conflicts);
      emit('sync-complete', {
        connected: true,
        syncing: false,
        lastSyncedAt: Date.now(),
        lastError: '',
        role: permissions.role,
        conflicts,
        runs,
      });
      return { ok: true, role: permissions.role, conflicts: conflicts.slice(), runs };
    } catch (error) {
      emit('sync-error', {
        syncing: false,
        lastError: error && error.message ? error.message : String(error),
        conflicts,
      });
      throw error;
    }
  }

  function scheduleSync(delayMs) {
    if (stopped || !state.enabled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncNow().catch(() => {});
    }, Number(delayMs) || 1000);
  }

  function syncNow() {
    if (!state.enabled || stopped) return Promise.resolve({ ok: true, skipped: true });
    if (syncPromise) {
      rerunRequested = true;
      return syncPromise;
    }
    syncPromise = performSync().finally(() => {
      syncPromise = null;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleSync(100);
      }
    });
    return syncPromise;
  }

  async function start() {
    if (!state.enabled || stopped) return { ok: true, skipped: true };
    if (started && state.connected) return syncNow();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      started = true;
      const ping = await requestBridge('ping', {}, 8000);
      if (!ping || ping.connected !== true || !Array.isArray(ping.capabilities) ||
          !ping.capabilities.includes('cloudSync')) {
        throw new Error('当前数据助手版本不支持云同步。');
      }
      emit('connected', { connected: true });
      return syncNow();
    })();
    try {
      return await startPromise;
    } catch (error) {
      started = false;
      throw error;
    } finally {
      startPromise = null;
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(syncTimer);
    for (const pending of pendingBridgeRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('云同步已停止。'));
    }
    pendingBridgeRequests.clear();
    emit('stopped', { syncing: false });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === 'response' && pendingBridgeRequests.has(message.requestId)) {
      const pending = pendingBridgeRequests.get(message.requestId);
      pendingBridgeRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.message || '数据助手请求失败。'));
      return;
    }
    if (message.type === 'storageChanged' && Array.isArray(message.keys) &&
        message.keys.some((key) => SYNC_KEYS.has(key))) scheduleSync(1200);
  });

  let topLevel = false;
  try {
    topLevel = window.top === window;
  } catch (error) {
    topLevel = false;
  }
  state.enabled = topLevel && !isLocalHost();
  let readyPromise = Promise.resolve({ ok: true, skipped: true });
  const publicApi = {
    start,
    syncNow,
    stop,
    getState,
    get ready() { return readyPromise; },
  };
  window.TaobaoCloudSync = Object.freeze(publicApi);
  if (state.enabled) {
    readyPromise = start().catch((error) => ({
      ok: false,
      message: error && error.message ? error.message : String(error),
    }));
  }
})();
