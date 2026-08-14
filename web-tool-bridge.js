// Bridges approved local and team dashboards to the extension without exposing arbitrary origins.
(function () {
  'use strict';

  if (window.__taobaoFullChainBridgeV1) return;
  if (window.top !== window) {
    try {
      if (window.top.location.origin !== location.origin) return;
    } catch (error) {
      return;
    }
  }

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const CAPABILITIES = [
    'parallelPlatformRuns',
    'accountVault',
    'accountSessionUnlock',
    'accountSessionManagement',
    'accountBatch',
    'accountBatchMultiSelect',
    'storeRunArchive',
    'storeRunManualInputs',
    'cloudSync',
    'projectDirectory',
    'projectTasks',
    'xhsAnalysis',
  ];
  const ACCOUNT_VAULT_KEY = 'taobaoAccountVaultV1';
  const ACCOUNT_BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
  const PROJECT_DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const PROJECT_TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
  const STORE_RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const STORE_RUN_KEY_PREFIX = 'taobaoStoreRunV1:';
  const MAX_IMPORTED_RUN_BYTES = 24 * 1024 * 1024;
  const ARCHIVE_SNAPSHOT_KEYS = new Set([
    'businessDefenseSycmTrafficSnapshotV1',
    'gh_channel_snapshot',
    'wxtBusinessDefenseReportV1',
    'dmpPortraitSnapshotV1',
    'businessDefenseManualInputsV1',
    'businessDefenseAutoCollectStatusV1',
    'taobaoContentDiagnosisReportStatusV1',
    'taobaoContentDiagnosisReportV1',
    'taobaoContentDiagnosisWxtReportV1',
    'xhsAnalysisSnapshotV1',
    'xhsCollectionStatusV1',
  ]);
  const TEAM_DASHBOARD_ORIGINS = new Set([
    'https://tbdata.aizicheng.com',
  ]);
  const ALLOWED_ORIGINS = new Set([
    'http://localhost:3400',
    'http://127.0.0.1:3400',
    ...TEAM_DASHBOARD_ORIGINS,
  ]);
  if (!ALLOWED_ORIGINS.has(location.origin)) return;
  const TEAM_WORKBENCH_PATHS = new Set([
    '/',
    '/workspace.html',
    '/accounts.html',
    '/report.html',
    '/data.html',
    '/report-view.html',
  ]);
  if (TEAM_DASHBOARD_ORIGINS.has(location.origin) && !TEAM_WORKBENCH_PATHS.has(location.pathname)) return;
  window.__taobaoFullChainBridgeV1 = true;

  const READABLE_KEYS = new Set([
    'businessDefenseSycmTrafficSnapshotV1',
    'gh_channel_snapshot',
    'wxtBusinessDefenseReportV1',
    'dmpPortraitSnapshotV1',
    'businessDefenseManualInputsV1',
    'businessDefenseAutoCollectStatusV1',
    'taobaoContentDiagnosisReportStatusV1',
    'taobaoContentDiagnosisReportV1',
    'taobaoContentDiagnosisWxtReportV1',
    'xhsAnalysisSnapshotV1',
    'xhsCollectionStatusV1',
    ACCOUNT_VAULT_KEY,
    ACCOUNT_BATCH_STATUS_KEY,
    PROJECT_DIRECTORY_KEY,
    PROJECT_TASK_STATUS_KEY,
    STORE_RUN_INDEX_KEY,
  ]);
  const CLEARABLE_KEYS = new Set([
    'businessDefenseSycmTrafficSnapshotV1',
    'gh_channel_snapshot',
    'wxtBusinessDefenseReportV1',
    'dmpPortraitSnapshotV1',
    'businessDefenseManualInputsV1',
    'businessDefenseAutoCollectStatusV1',
    'taobaoContentDiagnosisReportStatusV1',
    'taobaoContentDiagnosisReportV1',
    'taobaoContentDiagnosisWxtReportV1',
    'xhsAnalysisSnapshotV1',
    'xhsCollectionStatusV1',
    'businessDefenseLastAutoCollectAt',
    'sycmContentDiagnosisSnapshotV1',
    'wxtReportApiTraceV1',
  ]);
  const MANUAL_KEYS = new Set([
    'xhs_kolSpend',
    'xhs_juguangSpend',
    'xhs_reportedNoteShare',
    'xhs_unreportedNoteShare',
    'xhs_productSeedingSpend',
    'xhs_seedingDirectSpend',
    'xhs_xingheVisitors',
    'xhs_dmpVisitors',
    'xhs_noteCount',
    'xhs_unreportedNoteCount',
    'xhs_storeGmv',
    'xhs_taskGmv',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const PERCENT_MANUAL_KEYS = new Set([
    'xhs_reportedNoteShare',
    'xhs_unreportedNoteShare',
    'xhs_l12Penetration',
    'xhs_l45Penetration',
  ]);
  const INTEGER_MANUAL_KEYS = new Set([
    'xhs_xingheVisitors',
    'xhs_dmpVisitors',
    'xhs_noteCount',
    'xhs_unreportedNoteCount',
    'xhs_contentAudienceAsset',
    'xhs_storeAudienceAsset',
  ]);
  const VERSION = chrome.runtime.getManifest().version;
  const PLATFORM_TASK_IDS = ['sycm', 'guanghe', 'wxt', 'dmp'];
  const XHS_PLATFORM_TASK_IDS = ['adstar', 'pgy', 'juguang'];

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
  }

  function normalizeAccountPlatform(value) {
    return value === 'xiaohongshu' ? 'xiaohongshu' : 'taobao';
  }

  function validBase64(value, maxLength) {
    const text = cleanText(value, maxLength);
    return text && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? text : '';
  }

  function sanitizeEncryptedVault(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const kdf = source.kdf && typeof source.kdf === 'object' ? source.kdf : {};
    const cipher = source.cipher && typeof source.cipher === 'object' ? source.cipher : {};
    const iterations = Number(kdf.iterations);
    const salt = validBase64(kdf.salt, 200);
    const iv = validBase64(cipher.iv, 200);
    const data = validBase64(cipher.data, 8 * 1024 * 1024);
    if (Number(source.schema) !== 1 || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' ||
        cipher.name !== 'AES-GCM' || !Number.isInteger(iterations) || iterations < 150000 ||
        iterations > 1000000 || !salt || !iv || !data) {
      throw new Error('账号库密文格式无效。');
    }
    return {
      schema: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
      cipher: { name: 'AES-GCM', iv, data },
      updatedAt: Number(source.updatedAt) || Date.now(),
    };
  }

  function sanitizeProjectDirectory(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const groupIds = new Set();
    const storeGroups = (Array.isArray(source.storeGroups) ? source.storeGroups : []).slice(0, 300).map((group) => {
      const item = group && typeof group === 'object' ? group : {};
      const id = cleanText(item.id, 100);
      const name = cleanText(item.name, 80);
      if (!id || !name || groupIds.has(id)) return null;
      groupIds.add(id);
      return { id, name };
    }).filter(Boolean);
    const storeIds = new Set();
    const stores = (Array.isArray(source.stores) ? source.stores : []).slice(0, 1000).map((store) => {
      const item = store && typeof store === 'object' ? store : {};
      const id = cleanText(item.id, 100);
      const name = cleanText(item.name, 120);
      if (!id || !name || storeIds.has(id)) return null;
      storeIds.add(id);
      return {
        id,
        name,
        groupId: groupIds.has(item.groupId) ? item.groupId : '',
        createdAt: cleanText(item.createdAt, 80),
        updatedAt: cleanText(item.updatedAt, 80),
      };
    }).filter(Boolean);
    return {
      schema: 1,
      storeGroups,
      stores,
      updatedAt: Number(source.updatedAt) || Date.now(),
    };
  }

  function sanitizeBatchPayload(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 100).map((account) => {
      const item = account && typeof account === 'object' ? account : {};
      return {
        id: cleanText(item.id, 80),
        name: cleanText(item.name, 100),
        platform: normalizeAccountPlatform(item.platform),
        storeId: cleanText(item.storeId, 80),
        storeName: cleanText(item.storeName, 120),
        username: cleanText(item.username, 240),
        password: String(item.password == null ? '' : item.password).slice(0, 360),
        roleKeyword: cleanText(item.roleKeyword, 80),
        accountGroupId: cleanText(item.accountGroupId, 80),
        accountGroupName: cleanText(item.accountGroupName, 100),
        storeGroupId: cleanText(item.storeGroupId, 80),
        storeGroupName: cleanText(item.storeGroupName, 100),
      };
    });
    return {
      accounts,
      notification: {
        webhook: cleanText(source.notification && source.notification.webhook, 900),
        secret: cleanText(source.notification && source.notification.secret, 300),
      },
      selection: source.selection && typeof source.selection === 'object' ? {
        type: cleanText(source.selection.type, 40),
        groupId: cleanText(source.selection.groupId, 80),
        groupName: cleanText(source.selection.groupName, 100),
      } : {},
      resume: source.resume === true,
      startIndex: Math.max(0, Number(source.startIndex) || 0),
      batchId: cleanText(source.batchId, 100),
      startedAt: Number(source.startedAt) || 0,
      taskType: ['collect', 'report', 'both'].includes(source.taskType) ? source.taskType : 'both',
      platforms: sanitizePlatformTasks(source.platforms),
    };
  }

  function sanitizePlatformTasks(value) {
    if (value === undefined || value === null) return PLATFORM_TASK_IDS.slice();
    const selected = Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanText(item, 24))
      .filter((item) => PLATFORM_TASK_IDS.includes(item))));
    if (!selected.length) throw new Error('请至少选择一个平台任务。');
    return selected;
  }

  function sanitizeProjectPlatformTasks(value) {
    const allowed = PLATFORM_TASK_IDS.concat(XHS_PLATFORM_TASK_IDS);
    const selected = Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanText(item, 24))
      .filter((item) => allowed.includes(item))));
    if (!selected.length) throw new Error('请至少选择一个平台任务。');
    return selected;
  }

  function sanitizeXhsDateRange(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const from = cleanText(source.from, 10);
    const to = cleanText(source.to, 10);
    const valid = /^\d{4}-\d{2}-\d{2}$/;
    if (!valid.test(from) || !valid.test(to) || from > to) {
      throw new Error('请选择有效的小红书开始和结束日期。');
    }
    const duration = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (!Number.isFinite(duration) || duration > 366) throw new Error('小红书取数范围不能超过 367 天。');
    return { from, to, timezone: 'Asia/Shanghai' };
  }

  function sanitizeAccountSessionVault(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cleanGroups = (items, limit) => {
      const ids = new Set();
      return (Array.isArray(items) ? items : []).slice(0, limit).map((value) => {
        const item = value && typeof value === 'object' ? value : {};
        const id = cleanText(item.id, 100);
        const name = cleanText(item.name, 100);
        if (!id || !name || ids.has(id)) return null;
        ids.add(id);
        return { id, name };
      }).filter(Boolean);
    };
    const accountGroups = cleanGroups(source.accountGroups, 300);
    const storeGroups = cleanGroups(source.storeGroups, 300);
    const accountGroupIds = new Set(accountGroups.map((item) => item.id));
    const storeGroupIds = new Set(storeGroups.map((item) => item.id));
    const storeIds = new Set();
    const stores = (Array.isArray(source.stores) ? source.stores : []).slice(0, 1000).map((value) => {
      const item = value && typeof value === 'object' ? value : {};
      const id = cleanText(item.id, 100);
      const name = cleanText(item.name, 120);
      if (!id || !name || storeIds.has(id)) return null;
      storeIds.add(id);
      return { id, name, groupId: storeGroupIds.has(item.groupId) ? item.groupId : '' };
    }).filter(Boolean);
    const accountIds = new Set();
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 500).map((value) => {
      const item = value && typeof value === 'object' ? value : {};
      const id = cleanText(item.id, 100);
      const storeId = cleanText(item.storeId, 100);
      const username = cleanText(item.username, 240);
      const password = String(item.password == null ? '' : item.password).slice(0, 360);
      const platform = normalizeAccountPlatform(item.platform);
      if (!id || accountIds.has(id) || !storeIds.has(storeId) || !username || !password) return null;
      accountIds.add(id);
      return {
        id,
        name: cleanText(item.name, 100) || username,
        platform,
        storeId,
        username,
        password,
        accountGroupId: accountGroupIds.has(item.accountGroupId) ? item.accountGroupId : '',
        roleKeyword: platform === 'taobao' ? (cleanText(item.roleKeyword, 80) || '品牌') : '',
        enabled: item.enabled !== false,
      };
    }).filter(Boolean);
    return {
      schema: 3,
      accountGroups,
      storeGroups,
      stores,
      accounts,
      notification: {
        webhook: cleanText(source.notification && source.notification.webhook, 900),
        secret: cleanText(source.notification && source.notification.secret, 300),
      },
    };
  }

  function sanitizeSessionBatchRequest(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawSelection = source.selection && typeof source.selection === 'object' ? source.selection : {};
    const accountIds = Array.from(new Set((Array.isArray(rawSelection.accountIds)
      ? rawSelection.accountIds
      : []).slice(0, 500).map((item) => cleanText(item, 100)).filter(Boolean)));
    if (!source.resume && !accountIds.length) throw new Error('请至少选择一个组内账号。');
    if (accountIds.length > 100) throw new Error('每次最多选择 100 个账号。');
    return {
      selection: {
        type: 'storeGroup',
        id: cleanText(rawSelection.id, 100),
        accountIds,
      },
      resume: source.resume === true,
      taskType: 'report',
      platforms: sanitizePlatformTasks(source.platforms),
    };
  }

  function sanitizeProjectTask(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const store = source.store && typeof source.store === 'object' ? source.store : {};
    const storeId = cleanText(store.id, 100);
    const storeName = cleanText(store.name, 120);
    if (!storeId || !storeName) throw new Error('请先选择本次任务归属的店铺。');
    const platforms = sanitizeProjectPlatformTasks(source.platforms);
    const hasXhs = platforms.some((platform) => XHS_PLATFORM_TASK_IDS.includes(platform));
    return {
      taskType: 'report',
      platforms,
      dateRange: hasXhs ? sanitizeXhsDateRange(source.dateRange) : null,
      store: {
        id: storeId,
        name: storeName,
        groupId: cleanText(store.groupId, 100),
        groupName: cleanText(store.groupName, 100),
      },
    };
  }

  function requireOneClickTaskPage() {
    if (location.pathname !== '/report.html') {
      throw new Error('请从“一键取数”页面发起任务。');
    }
  }

  function sanitizeRunId(value) {
    const runId = cleanText(value, 120);
    if (!/^store-run-[a-z0-9-]+$/i.test(runId)) throw new Error('店铺归档编号无效。');
    return runId;
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

  const MAX_IMPORTED_XHS_SNAPSHOT_BYTES = 8 * 1024 * 1024;
  const IMPORTED_XHS_SNAPSHOT_KEYS = new Set(['xhsAnalysisSnapshotV1', 'xhsCollectionStatusV1']);
  const IMPORTED_RUN_SENSITIVE_KEYS = new Set([
    'password', 'masterpassword', 'authorization', 'cookie', 'cookies',
    'token', 'accesstoken', 'refreshtoken', 'signature', 'sign', 'secret',
    'xsectoken', 'tbtoken', 'apikey', 'secretkey', 'sessionid', 'csrftoken',
  ]);
  const IMPORTED_XHS_STATE_KEYS = new Set([
    'raw', 'rawresponse', 'rawresponses', 'rawpayload', 'rawpages',
    'checkpoint', 'checkpoints', 'pages', 'cache', 'cachekey', 'fingerprint',
    'indexeddb', 'datasets',
  ]);

  function normalizedImportedRunKey(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isImportedSensitiveRunKey(value) {
    const key = normalizedImportedRunKey(value);
    if (IMPORTED_RUN_SENSITIVE_KEYS.has(key) || key === 'xs' || key === 'xsign' ||
        key.includes('authorization') || key.includes('credential')) return true;
    const stems = ['token', 'cookie', 'cookies', 'signature', 'password', 'secret'];
    const descriptors = ['', 'value', 'header', 'hash', 'data', 'key', 'param', 'parameter'];
    return stems.some((stem) => descriptors.some((descriptor) => key.endsWith(stem + descriptor)));
  }

  function isImportedRawStateKey(value) {
    const key = normalizedImportedRunKey(value);
    return IMPORTED_XHS_STATE_KEYS.has(key) || key.startsWith('raw') ||
      key.startsWith('checkpoint');
  }

  function importedStringContainsCredential(value) {
    if (typeof value !== 'string') return false;
    let candidate = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/i.test(candidate)) return true;
      const assignment = /(?:[?&#]|\b)([a-z0-9_.%-]{1,160})["']?\s*[:=]/gi;
      let match;
      while ((match = assignment.exec(candidate))) {
        let key = match[1];
        try { key = decodeURIComponent(key); } catch (error) {}
        if (isImportedSensitiveRunKey(key)) return true;
      }
      let decoded = candidate;
      try { decoded = decodeURIComponent(candidate); } catch (error) {}
      if (decoded === candidate) break;
      candidate = decoded;
    }
    return false;
  }

  function importedRunContainsSensitiveValue(value, seen, depth) {
    if (importedStringContainsCredential(value)) return true;
    if (!value || typeof value !== 'object') return false;
    if (Number(depth) > 64) return true;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (isImportedSensitiveRunKey(key)) return true;
      if (importedRunContainsSensitiveValue(child, visited, Number(depth || 0) + 1)) return true;
    }
    return false;
  }

  function importedXhsContainsRawState(value, seen, depth) {
    if (!value || typeof value !== 'object') return false;
    if (Number(depth) > 64) return true;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (isImportedRawStateKey(key)) return true;
      if (importedXhsContainsRawState(child, visited, Number(depth || 0) + 1)) return true;
    }
    return false;
  }

  function assertImportedRunSafe(run) {
    if (importedRunContainsSensitiveValue(run)) {
      throw new Error('云端历史归档包含不应导入的敏感凭据或签名链接。');
    }
    const snapshots = run && typeof run.snapshots === 'object' && !Array.isArray(run.snapshots)
      ? run.snapshots
      : {};
    for (const key of IMPORTED_XHS_SNAPSHOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(snapshots, key)) continue;
      const snapshot = snapshots[key];
      let serialized = '';
      try {
        serialized = JSON.stringify(snapshot);
      } catch (error) {
        throw new Error('云端小红书快照不是可存储的 JSON 对象。');
      }
      if (!serialized ||
          utf8ByteLength(serialized, MAX_IMPORTED_XHS_SNAPSHOT_BYTES) >= MAX_IMPORTED_XHS_SNAPSHOT_BYTES) {
        throw new Error('云端小红书快照超过 8MB 安全限制。');
      }
      if (importedXhsContainsRawState(snapshot)) {
        throw new Error('云端小红书快照包含不应导入的 raw/checkpoint 原始分页状态。');
      }
    }
  }

  function jsonCloneWithinLimit(value, limit, label) {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new Error(label + '不是可存储的 JSON 对象。');
    }
    if (!serialized || utf8ByteLength(serialized, limit) > limit) {
      throw new Error(label + '超过 ' + Math.floor(limit / 1024 / 1024) + 'MB 安全限制。');
    }
    return JSON.parse(serialized);
  }

  function runTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 && timestamp < 4102444800000 ? timestamp : 0;
  }

  function runFreshness(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return runTimestamp(source.updatedAt) || runTimestamp(source.finishedAt) || runTimestamp(source.startedAt);
  }

  function sanitizeImportedRun(value, expectedRunId) {
    const cloned = jsonCloneWithinLimit(value, MAX_IMPORTED_RUN_BYTES, '云端历史归档');
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
      throw new Error('云端历史归档必须是对象。');
    }
    assertImportedRunSafe(cloned);
    const runId = sanitizeRunId(cloned.runId);
    if (expectedRunId && runId !== sanitizeRunId(expectedRunId)) {
      throw new Error('云端历史归档编号不一致。');
    }
    const schema = Number(cloned.schema);
    const startedAt = runTimestamp(cloned.startedAt);
    const finishedAt = runTimestamp(cloned.finishedAt);
    const updatedAt = runTimestamp(cloned.updatedAt) || finishedAt;
    if (!Number.isInteger(schema) || schema < 1 || schema > 10 || !startedAt || !finishedAt ||
        finishedAt < startedAt || updatedAt < finishedAt) {
      throw new Error('云端历史归档时间或版本无效。');
    }
    const rawAccount = cloned.account && typeof cloned.account === 'object' && !Array.isArray(cloned.account)
      ? cloned.account
      : {};
    const account = {
      id: cleanText(rawAccount.id, 100),
      name: cleanText(rawAccount.name, 100),
      platform: normalizeAccountPlatform(rawAccount.platform),
      storeId: cleanText(rawAccount.storeId, 100),
      storeName: cleanText(rawAccount.storeName, 120),
      usernameMasked: cleanText(rawAccount.usernameMasked, 240),
      roleKeyword: cleanText(rawAccount.roleKeyword, 80),
      accountGroupId: cleanText(rawAccount.accountGroupId, 100),
      accountGroupName: cleanText(rawAccount.accountGroupName, 100),
      storeGroupId: cleanText(rawAccount.storeGroupId, 100),
      storeGroupName: cleanText(rawAccount.storeGroupName, 100),
    };
    if (!account.storeId || !account.storeName) throw new Error('云端历史归档缺少店铺信息。');
    const rawSnapshots = cloned.snapshots && typeof cloned.snapshots === 'object' && !Array.isArray(cloned.snapshots)
      ? cloned.snapshots
      : {};
    const snapshots = {};
    for (const [key, snapshot] of Object.entries(rawSnapshots)) {
      if (ARCHIVE_SNAPSHOT_KEYS.has(key)) snapshots[key] = snapshot;
    }
    const taskType = ['collect', 'report', 'both'].includes(cloned.taskType) ? cloned.taskType : '';
    const runMode = ['current', 'batch'].includes(cloned.runMode) ? cloned.runMode : '';
    const status = ['success', 'partial', 'failed'].includes(cloned.status) ? cloned.status : '';
    if (!taskType || !runMode || !status) throw new Error('云端历史归档任务类型或状态无效。');
    const run = {
      schema,
      runId,
      batchId: cleanText(cloned.batchId, 120),
      taskType,
      runMode,
      account,
      startedAt,
      finishedAt,
      updatedAt,
      xinghe: {
        state: cleanText(cloned.xinghe && cloned.xinghe.state, 100),
        noPermission: Boolean(cloned.xinghe && cloned.xinghe.noPermission),
      },
      status,
      failures: (Array.isArray(cloned.failures) ? cloned.failures : []).slice(0, 500)
        .map((item) => cleanText(item, 2000)).filter(Boolean),
      snapshots,
    };
    jsonCloneWithinLimit(run, MAX_IMPORTED_RUN_BYTES, '云端历史归档');
    return run;
  }

  function storeRunIndexEntry(run) {
    const account = run.account || {};
    return {
      runId: run.runId,
      batchId: run.batchId,
      taskType: run.taskType,
      runMode: run.runMode,
      accountId: account.id,
      accountName: account.name,
      storeId: account.storeId,
      storeName: account.storeName,
      usernameMasked: account.usernameMasked,
      accountGroupId: account.accountGroupId,
      accountGroupName: account.accountGroupName,
      storeGroupId: account.storeGroupId,
      storeGroupName: account.storeGroupName,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt: run.updatedAt,
      status: run.status,
      failureCount: run.failures.length,
    };
  }

  function post(message) {
    window.postMessage(Object.assign({
      channel: CHANNEL,
      version: VERSION,
      capabilities: CAPABILITIES.slice(),
    }, message), location.origin);
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, message: error.message || '扩展后台未响应。' });
          return;
        }
        resolve(response || { ok: false, message: '扩展后台未返回结果。' });
      });
    });
  }

  function normalizeManualValue(key, rawValue) {
    const text = String(rawValue == null ? '' : rawValue).trim().slice(0, 120);
    if (!text) return '';
    const numericText = text.replace(/[,，¥￥\s]/g, '').replace(/[%％]$/, '');
    const number = Number(numericText);
    if (!Number.isFinite(number)) throw new Error('手填数据必须是有效数字。');
    if (number < 0) throw new Error('手填数据不能小于 0。');
    if (PERCENT_MANUAL_KEYS.has(key)) {
      const percentage = /[%％]$/.test(text) ? number : (number <= 1 ? number * 100 : number);
      if (percentage > 100) throw new Error('手填百分比不能超过 100%。');
      return Number(percentage.toFixed(6)).toString() + '%';
    }
    if (/[%％]$/.test(text)) throw new Error('该手填指标不能使用百分号。');
    if (INTEGER_MANUAL_KEYS.has(key) && !Number.isInteger(number)) {
      throw new Error('人数和数量类手填指标必须是整数。');
    }
    return text;
  }

  function normalizeManualRecord(key, rawValue) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      return normalizeManualValue(key, rawValue);
    }
    const value = normalizeManualValue(key, rawValue.value);
    if (!value) return '';
    const output = { value };
    if (rawValue.manualOverride === true) output.manualOverride = true;
    const updatedAt = cleanText(rawValue.updatedAt, 80);
    if (updatedAt && Number.isFinite(Date.parse(updatedAt))) output.updatedAt = updatedAt;
    const accountKeys = Array.from(new Set((Array.isArray(rawValue.accountKeys) ? rawValue.accountKeys : [])
      .map((item) => cleanText(item, 100))
      .filter(Boolean)))
      .slice(0, 20);
    if (accountKeys.length) output.accountKeys = accountKeys;
    const range = rawValue.dateRange && typeof rawValue.dateRange === 'object' &&
      !Array.isArray(rawValue.dateRange) ? rawValue.dateRange : null;
    const from = range && cleanText(range.from, 10);
    const to = range && cleanText(range.to, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to) {
      output.dateRange = { from, to, timezone: 'Asia/Shanghai' };
    }
    return output;
  }

  function sanitizeManualInputs(value, strict) {
    const output = {};
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    for (const [key, rawValue] of Object.entries(source)) {
      if (!MANUAL_KEYS.has(key)) continue;
      if (!['string', 'number', 'object'].includes(typeof rawValue) || rawValue === null) continue;
      try {
        const record = normalizeManualRecord(key, rawValue);
        if (record) output[key] = record;
      } catch (error) {
        if (strict) throw error;
      }
    }
    return output;
  }

  async function handleRequest(action, payload) {
    if (action === 'ping') {
      return { version: VERSION, connected: true, capabilities: CAPABILITIES.slice() };
    }
    if (action === 'getStorage') {
      const keys = Array.from(new Set((Array.isArray(payload && payload.keys) ? payload.keys : [])
        .filter((key) => READABLE_KEYS.has(key))));
      return chrome.storage.local.get(keys);
    }
    if (action === 'setManualInputs') {
      const manualInputs = sanitizeManualInputs(payload && payload.manualInputs, true);
      await chrome.storage.local.set({ businessDefenseManualInputsV1: manualInputs });
      return { saved: true };
    }
    if (action === 'patchStoreRunManualInput') {
      const runId = sanitizeRunId(payload && payload.runId);
      const key = cleanText(payload && payload.key, 100);
      if (!MANUAL_KEYS.has(key)) throw new Error('手填指标不在允许范围内。');
      const value = normalizeManualRecord(key, payload && payload.value);
      const runKey = STORE_RUN_KEY_PREFIX + runId;
      const stored = await chrome.storage.local.get([
        runKey,
        STORE_RUN_INDEX_KEY,
        ACCOUNT_BATCH_STATUS_KEY,
        PROJECT_TASK_STATUS_KEY,
      ]);
      if (stored[ACCOUNT_BATCH_STATUS_KEY] && stored[ACCOUNT_BATCH_STATUS_KEY].running) {
        throw new Error('批量任务执行期间不能编辑店铺历史数据。');
      }
      if (stored[PROJECT_TASK_STATUS_KEY] && stored[PROJECT_TASK_STATUS_KEY].running) {
        throw new Error('当前账号任务执行期间不能编辑店铺历史数据。');
      }
      const run = stored[runKey];
      if (!run || typeof run !== 'object') throw new Error('未找到这条店铺历史归档。');
      const snapshots = Object.assign({}, run.snapshots && typeof run.snapshots === 'object'
        ? run.snapshots
        : {});
      const manualInputs = sanitizeManualInputs(snapshots.businessDefenseManualInputsV1, false);
      if (value) manualInputs[key] = value;
      else delete manualInputs[key];
      snapshots.businessDefenseManualInputsV1 = manualInputs;
      const updatedAt = Date.now();
      const updatedRun = Object.assign({}, run, { snapshots, updatedAt });
      const runIndex = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
      await chrome.storage.local.set({
        [runKey]: updatedRun,
        [STORE_RUN_INDEX_KEY]: runIndex.map((item) => (
          item && item.runId === runId ? Object.assign({}, item, { updatedAt }) : item
        )),
        businessDefenseManualInputsV1: manualInputs,
      });
      return { saved: true, runId, manualInputs };
    }
    if (action === 'clearStorage') {
      const requested = Array.isArray(payload && payload.keys) ? payload.keys : [];
      const keys = Array.from(new Set(requested.filter((key) => CLEARABLE_KEYS.has(key))));
      const batchStored = await chrome.storage.local.get([ACCOUNT_BATCH_STATUS_KEY, PROJECT_TASK_STATUS_KEY]);
      if (batchStored[ACCOUNT_BATCH_STATUS_KEY] && batchStored[ACCOUNT_BATCH_STATUS_KEY].running && keys.length) {
        throw new Error('批量任务执行期间不能清空当前店铺数据。');
      }
      if (batchStored[PROJECT_TASK_STATUS_KEY] && batchStored[PROJECT_TASK_STATUS_KEY].running && keys.length) {
        throw new Error('当前账号任务执行期间不能清空店铺数据。');
      }
      await chrome.storage.local.remove(keys);
      return { cleared: keys };
    }
    if (action === 'setAccountVault') {
      const vault = sanitizeEncryptedVault(payload && payload.vault);
      await chrome.storage.local.set({ [ACCOUNT_VAULT_KEY]: vault });
      return { saved: true, updatedAt: vault.updatedAt };
    }
    if (action === 'setAccountSession') {
      const masterPassword = String(payload && payload.masterPassword || '').slice(0, 512);
      if (masterPassword.length < 8) throw new Error('账号库主密码无效。');
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_SET',
        source: 'business-defense-web-tool',
        vault: sanitizeAccountSessionVault(payload && payload.vault),
        masterPassword,
      });
    }
    if (action === 'getAccountSessionSummary') {
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_GET_SUMMARY',
        source: 'business-defense-web-tool',
      });
    }
    if (action === 'getAccountManagementSession') {
      if (location.pathname !== '/accounts.html') {
        throw new Error('仅账号库管理页可恢复管理会话。');
      }
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_GET_MANAGEMENT',
        source: 'business-defense-web-tool',
      });
    }
    if (action === 'clearAccountSession') {
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_CLEAR',
        source: 'business-defense-web-tool',
      });
    }
    if (action === 'setProjectDirectory') {
      const directory = sanitizeProjectDirectory(payload && payload.directory);
      await chrome.storage.local.set({ [PROJECT_DIRECTORY_KEY]: directory });
      return { saved: true, updatedAt: directory.updatedAt };
    }
    if (action === 'clearAccountVault') {
      const stored = await chrome.storage.local.get([ACCOUNT_BATCH_STATUS_KEY]);
      const status = stored[ACCOUNT_BATCH_STATUS_KEY];
      if (status && (status.running || status.paused)) {
        throw new Error('请先完成或取消暂停的批量任务，再重置账号库。');
      }
      await runtimeMessage({
        type: 'ACCOUNT_SESSION_CLEAR',
        source: 'business-defense-web-tool',
      });
      await chrome.storage.local.remove([ACCOUNT_VAULT_KEY, PROJECT_DIRECTORY_KEY]);
      return { cleared: true };
    }
    if (action === 'startAccountBatchFromSession') {
      requireOneClickTaskPage();
      return runtimeMessage({
        type: 'ACCOUNT_BATCH_START_FROM_SESSION',
        source: 'business-defense-web-tool',
        payload: sanitizeSessionBatchRequest(payload),
      });
    }
    if (action === 'startProjectTask') {
      requireOneClickTaskPage();
      return runtimeMessage({
        type: 'PROJECT_TASK_START',
        source: 'business-defense-web-tool',
        payload: sanitizeProjectTask(payload),
      });
    }
    if (action === 'cancelAccountBatch') {
      return runtimeMessage({
        type: 'ACCOUNT_BATCH_CANCEL',
        source: 'business-defense-web-tool',
      });
    }
    if (action === 'testDingTalk') {
      const notification = sanitizeBatchPayload({ notification: payload && payload.notification }).notification;
      return runtimeMessage({
        type: 'ACCOUNT_BATCH_TEST_DINGTALK',
        source: 'business-defense-web-tool',
        notification,
      });
    }
    if (action === 'listStoreRuns') {
      const stored = await chrome.storage.local.get([STORE_RUN_INDEX_KEY]);
      return { runs: Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [] };
    }
    if (action === 'getStoreRun') {
      const runId = sanitizeRunId(payload && payload.runId);
      const stored = await chrome.storage.local.get([STORE_RUN_KEY_PREFIX + runId]);
      return { run: stored[STORE_RUN_KEY_PREFIX + runId] || null };
    }
    if (action === 'importStoreRun') {
      const run = sanitizeImportedRun(payload && payload.run, payload && payload.runId);
      const runKey = STORE_RUN_KEY_PREFIX + run.runId;
      const stored = await chrome.storage.local.get([runKey, STORE_RUN_INDEX_KEY]);
      const currentRun = stored[runKey];
      const index = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
      const currentEntry = index.find((item) => item && item.runId === run.runId) || null;
      const localFreshness = Math.max(runFreshness(currentRun), runFreshness(currentEntry));
      const incomingFreshness = runFreshness(run);
      if ((currentRun || currentEntry) && localFreshness >= incomingFreshness) {
        return {
          imported: false,
          reason: 'local-newer-or-equal',
          runId: run.runId,
          localUpdatedAt: localFreshness,
        };
      }
      const entry = storeRunIndexEntry(run);
      await chrome.storage.local.set({
        [runKey]: run,
        [STORE_RUN_INDEX_KEY]: [entry].concat(index.filter((item) => (
          item && item.runId !== run.runId
        ))).sort((left, right) => (
          runFreshness(right) - runFreshness(left)
        )).slice(0, 1000),
      });
      return {
        imported: true,
        replaced: Boolean(currentRun || currentEntry),
        runId: run.runId,
        updatedAt: incomingFreshness,
      };
    }
    if (action === 'deleteStoreRun') {
      const runId = sanitizeRunId(payload && payload.runId);
      const stored = await chrome.storage.local.get([STORE_RUN_INDEX_KEY]);
      const index = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
      await chrome.storage.local.remove(STORE_RUN_KEY_PREFIX + runId);
      await chrome.storage.local.set({
        [STORE_RUN_INDEX_KEY]: index.filter((item) => item && item.runId !== runId),
      });
      return { deleted: true };
    }
    if (action === 'restoreStoreRun') {
      const runId = sanitizeRunId(payload && payload.runId);
      const stored = await chrome.storage.local.get([
        STORE_RUN_KEY_PREFIX + runId,
        ACCOUNT_BATCH_STATUS_KEY,
        PROJECT_TASK_STATUS_KEY,
      ]);
      if (stored[ACCOUNT_BATCH_STATUS_KEY] && stored[ACCOUNT_BATCH_STATUS_KEY].running) {
        throw new Error('批量任务执行期间不能切换店铺历史报告。');
      }
      if (stored[PROJECT_TASK_STATUS_KEY] && stored[PROJECT_TASK_STATUS_KEY].running) {
        throw new Error('当前账号任务执行期间不能切换店铺历史记录。');
      }
      const run = stored[STORE_RUN_KEY_PREFIX + runId];
      if (!run || typeof run !== 'object') throw new Error('未找到这条店铺历史归档。');
      const snapshots = run.snapshots && typeof run.snapshots === 'object' ? run.snapshots : {};
      const restored = {};
      for (const [key, value] of Object.entries(snapshots)) {
        if (ARCHIVE_SNAPSHOT_KEYS.has(key)) restored[key] = value;
      }
      await chrome.storage.local.remove(Array.from(ARCHIVE_SNAPSHOT_KEYS));
      if (Object.keys(restored).length) await chrome.storage.local.set(restored);
      return { restored: true, runId, storeName: run.account && run.account.storeName || '' };
    }
    throw new Error('网页工具请求不在允许范围内。');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== 'request' || !message.requestId) return;
    Promise.resolve(handleRequest(message.action, message.payload || {})).then((data) => {
      post({ type: 'response', requestId: message.requestId, ok: true, data });
    }).catch((error) => {
      post({
        type: 'response',
        requestId: message.requestId,
        ok: false,
        message: error && error.message ? error.message : String(error),
      });
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const keys = Object.keys(changes || {}).filter((key) => READABLE_KEYS.has(key));
    if (keys.length) post({ type: 'storageChanged', keys });
  });

  post({ type: 'ready', connected: true });
})();
