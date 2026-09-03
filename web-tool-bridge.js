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
    'accountBatch',
    'accountBatchMultiSelect',
    'storeRunArchive',
    'storeRunManualInputs',
    'cloudSync',
    'projectDirectory',
    'projectTasks',
    'projectTaskCancel',
    'xhsAnalysis',
    'commentMonitor',
  ];
  const ACCOUNT_VAULT_KEY = 'taobaoAccountVaultV1';
  const ACCOUNT_VAULT_SCOPE_KEY = 'taobaoAccountVaultScopeV1';
  const ACCOUNT_VAULT_SCOPED_PREFIX = 'taobaoAccountVaultScopedV1:';
  const ACCOUNT_VAULT_REMOTE_STATE_PREFIX = 'taobaoAccountVaultRemoteStateV1:';
  // Migration-only marker used by an intermediate build which kept one
  // shared active key. New reads and writes never trust it as an authority.
  const ACCOUNT_VAULT_ACTIVE_SCOPE_KEY = 'taobaoAccountVaultActiveScopeV1';
  const ACCOUNT_VAULT_LOCK_EPOCH_KEY = 'taobaoAccountVaultLockEpochV1';
  const ACCOUNT_VAULT_LEGACY_KEY = 'taobaoAccountVaultLegacyV1';
  const ACCOUNT_VAULT_QUARANTINE_PREFIX = 'taobaoAccountVaultQuarantineV1:';
  const ACCOUNT_BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
  const PROJECT_DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const PROJECT_TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
  const STORE_RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
  const STORE_RUN_KEY_PREFIX = 'taobaoStoreRunV1:';
  const COMMENT_ARCHIVE_SNAPSHOT_KEY = 'xhsCommentInsightSummaryV1';
  const COMMENT_ARCHIVE_RUN_KEYS = new Set([
    'schema', 'runId', 'batchId', 'taskType', 'runMode', 'account',
    'startedAt', 'finishedAt', 'updatedAt', 'xinghe', 'status', 'failures', 'snapshots',
  ]);
  const COMMENT_ARCHIVE_ACCOUNT_KEYS = new Set([
    'id', 'name', 'platform', 'storeId', 'storeName', 'usernameMasked', 'roleKeyword',
    'accountGroupId', 'accountGroupName', 'storeGroupId', 'storeGroupName',
  ]);
  const MAX_IMPORTED_RUN_BYTES = 24 * 1024 * 1024;
  const XHS_DETAIL_KEY_PREFIX = 'xhsAnalysisDetailChunkV1:';
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
  const TEAM_VAULT_START_AUTH_CHALLENGE_TYPE = 'TEAM_VAULT_START_AUTH_CHALLENGE';
  const TEAM_VAULT_START_AUTH_TIMEOUT_MS = 8000;
  const TEAM_VAULT_OPERATOR_ROLES = new Set(['owner', 'admin', 'operator']);
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
    '/comments.html',
    '/data.html',
    '/report-view.html',
  ]);
  const TEAM_LOCK_ONLY_PATHS = new Set([
    '/admin', '/admin/', '/change-password', '/change-password/', '/migration', '/migration/',
    '/login', '/login/',
  ]);
  const lockOnlyPage = TEAM_DASHBOARD_ORIGINS.has(location.origin) && TEAM_LOCK_ONLY_PATHS.has(location.pathname);
  const autoLockPage = TEAM_DASHBOARD_ORIGINS.has(location.origin) &&
    (location.pathname === '/login' || location.pathname === '/login/');
  if (TEAM_DASHBOARD_ORIGINS.has(location.origin) &&
      !TEAM_WORKBENCH_PATHS.has(location.pathname) && !lockOnlyPage) return;
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

  function isXhsDetailStorageKey(value) {
    const key = String(value == null ? '' : value);
    return key.startsWith(XHS_DETAIL_KEY_PREFIX) && /^\d{4,6}$/.test(
      key.slice(XHS_DETAIL_KEY_PREFIX.length)
    );
  }

  function xhsDetailKeysFromSnapshot(value) {
    const manifest = value && typeof value === 'object' && !Array.isArray(value)
      ? value.detailArchive
      : null;
    if (!manifest || manifest.schema !== 'xhsAnalysisDetailManifestV1' ||
        !Array.isArray(manifest.chunks)) return [];
    return manifest.chunks.slice(0, 4096).map((chunk) => String(chunk && chunk.key || ''))
      .filter((key, index, keys) => isXhsDetailStorageKey(key) && keys.indexOf(key) === index);
  }

  function isArchiveSnapshotKey(key) {
    return ARCHIVE_SNAPSHOT_KEYS.has(key) || key === COMMENT_ARCHIVE_SNAPSHOT_KEY ||
      isXhsDetailStorageKey(key);
  }

  function isReadableStorageKey(key) {
    return READABLE_KEYS.has(key) || isXhsDetailStorageKey(key);
  }

  function isClearableStorageKey(key) {
    return CLEARABLE_KEYS.has(key) || isXhsDetailStorageKey(key);
  }
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

  function currentVaultScopeId() {
    if (TEAM_DASHBOARD_ORIGINS.has(location.origin)) return 'team:' + location.origin;
    if (location.origin === 'http://localhost:3400' || location.origin === 'http://127.0.0.1:3400') {
      return 'local:tbcontentdata';
    }
    throw new Error('当前站点不属于允许的账号库工作区。');
  }

  function validVaultScopeId(value) {
    const scopeId = cleanText(value, 220);
    return scopeId === 'local:tbcontentdata' || scopeId === 'team:https://tbdata.aizicheng.com'
      ? scopeId
      : '';
  }

  function isVaultLikeRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      Number(value.schema) === 1 && value.cipher && typeof value.cipher === 'object');
  }

  function scopedVaultStorageKey(vaultScopeId) {
    const safeScopeId = validVaultScopeId(vaultScopeId);
    if (!safeScopeId) throw new Error('账号库工作区范围无效。');
    return ACCOUNT_VAULT_SCOPED_PREFIX + encodeURIComponent(safeScopeId);
  }

  function vaultRemoteStateStorageKey(vaultScopeId) {
    const safeScopeId = validVaultScopeId(vaultScopeId);
    if (!safeScopeId) throw new Error('账号库工作区范围无效。');
    return ACCOUNT_VAULT_REMOTE_STATE_PREFIX + encodeURIComponent(safeScopeId);
  }

  function vaultRemoteState(value, expectedVaultScopeId) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const vaultScopeId = validVaultScopeId(source.vaultScopeId);
    const revision = Number(source.revision);
    const vaultLockEpoch = Number(source.vaultLockEpoch);
    if (Number(source.schema) !== 1 || !vaultScopeId ||
        !Number.isSafeInteger(revision) || revision < 1 ||
        source.deleted !== true || !Number.isSafeInteger(vaultLockEpoch) ||
        vaultLockEpoch < 1) return null;
    if (expectedVaultScopeId && vaultScopeId !== expectedVaultScopeId) return null;
    return { schema: 1, vaultScopeId, revision, deleted: true, vaultLockEpoch };
  }

  function makeVaultRemoteState(vaultScopeId, revision, vaultLockEpoch) {
    const safeScopeId = validVaultScopeId(vaultScopeId);
    const safeRevision = Number(revision);
    const safeEpoch = Number(vaultLockEpoch);
    if (!safeScopeId || !Number.isSafeInteger(safeRevision) || safeRevision < 1) {
      throw new Error('云端账号库版本无效。');
    }
    if (!Number.isSafeInteger(safeEpoch) || safeEpoch < 1) {
      throw new Error('账号库删除锁定版本无效。');
    }
    return {
      schema: 1,
      vaultScopeId: safeScopeId,
      revision: safeRevision,
      deleted: true,
      vaultLockEpoch: safeEpoch,
    };
  }

  function scopedVaultEnvelope(value, expectedVaultScopeId) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const vaultScopeId = validVaultScopeId(source.vaultScopeId);
    if (Number(source.schema) !== 1 || !vaultScopeId || !isVaultLikeRecord(source.vault)) return null;
    if (expectedVaultScopeId && vaultScopeId !== expectedVaultScopeId) return null;
    const remoteRevision = Number(source.remoteRevision);
    const vaultLockEpoch = Number(source.vaultLockEpoch);
    return {
      schema: 1,
      vaultScopeId,
      vault: source.vault,
      remoteRevision: Number.isSafeInteger(remoteRevision) && remoteRevision >= 1 ? remoteRevision : 0,
      vaultLockEpoch: Number.isSafeInteger(vaultLockEpoch) && vaultLockEpoch >= 0 ? vaultLockEpoch : 0,
    };
  }

  function makeScopedVaultEnvelope(vaultScopeId, vault, remoteRevision, vaultLockEpoch) {
    const safeScopeId = validVaultScopeId(vaultScopeId);
    if (!safeScopeId) throw new Error('账号库工作区范围无效。');
    const safeRemoteRevision = Number(remoteRevision);
    const safeEpoch = Number(vaultLockEpoch);
    const envelope = {
      schema: 1,
      vaultScopeId: safeScopeId,
      vault,
    };
    if (Number.isSafeInteger(safeRemoteRevision) && safeRemoteRevision >= 1) {
      envelope.remoteRevision = safeRemoteRevision;
    }
    if (Number.isSafeInteger(safeEpoch) && safeEpoch >= 0) {
      envelope.vaultLockEpoch = safeEpoch;
    }
    return envelope;
  }

  async function currentVaultLockEpoch() {
    const stored = await chrome.storage.local.get([ACCOUNT_VAULT_LOCK_EPOCH_KEY]);
    return Math.max(0, Number(stored[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) || 0);
  }

  function requestedVaultLockEpoch(value) {
    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw new Error('账号库锁定版本无效，请刷新页面后重试。');
    }
    return epoch;
  }

  async function lockAccountVaultSession() {
    const nextEpoch = await currentVaultLockEpoch() + 1;
    await chrome.storage.local.set({ [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: nextEpoch });
    const response = await runtimeMessage({
      type: 'ACCOUNT_SESSION_LOCK',
      source: 'business-defense-web-tool',
      vaultLockEpoch: nextEpoch,
    });
    if (!response || response.ok === false) {
      throw new Error(response && response.message || '账号库会话锁定失败。');
    }
    const vaultLockEpoch = Math.max(nextEpoch, Number(response.vaultLockEpoch) || 0);
    if (vaultLockEpoch !== nextEpoch) {
      await chrome.storage.local.set({ [ACCOUNT_VAULT_LOCK_EPOCH_KEY]: vaultLockEpoch });
    }
    return { ok: true, locked: true, vaultLockEpoch };
  }

  async function bindAccountVaultScope() {
    const vaultScopeId = currentVaultScopeId();
    const scopedKey = scopedVaultStorageKey(vaultScopeId);
    const returningKey = ACCOUNT_VAULT_QUARANTINE_PREFIX + encodeURIComponent(vaultScopeId);
    const stored = await chrome.storage.local.get([
      scopedKey,
      ACCOUNT_VAULT_KEY,
      ACCOUNT_VAULT_SCOPE_KEY,
      ACCOUNT_VAULT_ACTIVE_SCOPE_KEY,
      ACCOUNT_VAULT_LEGACY_KEY,
      returningKey,
    ]);
    const currentScopeId = validVaultScopeId(stored[ACCOUNT_VAULT_SCOPE_KEY]);
    const activeVault = stored[ACCOUNT_VAULT_KEY];
    const activeScopeId = validVaultScopeId(stored[ACCOUNT_VAULT_ACTIVE_SCOPE_KEY]);
    const returningVault = stored[returningKey];
    let targetEnvelope = scopedVaultEnvelope(stored[scopedKey], vaultScopeId);
    let lock = null;
    const ensureLocked = async () => {
      if (!lock) lock = await lockAccountVaultSession();
      return lock;
    };
    let isolated = false;
    let claimedLegacy = false;
    let migrated = false;

    // Migrate the old shared active key into a scope-specific key. A tagged
    // record can be routed without trusting the current page. An untagged
    // record is claimable only by the explicit local-development scope;
    // production preserves it for an authenticated recovery flow.
    if (isVaultLikeRecord(activeVault)) {
      await ensureLocked();
      const sourceScopeId = activeScopeId;
      if (sourceScopeId) {
        const sourceKey = scopedVaultStorageKey(sourceScopeId);
        const existingSource = sourceKey === scopedKey
          ? targetEnvelope
          : scopedVaultEnvelope((await chrome.storage.local.get([sourceKey]))[sourceKey], sourceScopeId);
        if (!existingSource) {
          const envelope = makeScopedVaultEnvelope(sourceScopeId, activeVault);
          await chrome.storage.local.set({ [sourceKey]: envelope });
          if (sourceScopeId === vaultScopeId) targetEnvelope = envelope;
        }
        migrated = true;
      } else if (vaultScopeId === 'local:tbcontentdata') {
        if (!targetEnvelope) {
          targetEnvelope = makeScopedVaultEnvelope(vaultScopeId, activeVault);
          await chrome.storage.local.set({ [scopedKey]: targetEnvelope });
        }
        claimedLegacy = true;
      } else if (!isVaultLikeRecord(stored[ACCOUNT_VAULT_LEGACY_KEY])) {
        await chrome.storage.local.set({ [ACCOUNT_VAULT_LEGACY_KEY]: activeVault });
        isolated = true;
      }
      await chrome.storage.local.remove([ACCOUNT_VAULT_KEY, ACCOUNT_VAULT_ACTIVE_SCOPE_KEY]);
    }

    // Recover quarantines written by the preceding scoped implementation.
    const restore = Boolean(!targetEnvelope && isVaultLikeRecord(returningVault));
    if (restore) {
      targetEnvelope = makeScopedVaultEnvelope(vaultScopeId, returningVault);
      await chrome.storage.local.set({ [scopedKey]: targetEnvelope });
      await chrome.storage.local.remove(returningKey);
    }

    if (currentScopeId !== vaultScopeId) await ensureLocked();
    await chrome.storage.local.set({ [ACCOUNT_VAULT_SCOPE_KEY]: vaultScopeId });
    const vaultLockEpoch = lock ? lock.vaultLockEpoch : await currentVaultLockEpoch();
    return {
      bound: true,
      changed: currentScopeId !== vaultScopeId || isolated || claimedLegacy || migrated || restore,
      isolated,
      restored: restore,
      claimedLegacy,
      migrated,
      legacyAvailable: TEAM_DASHBOARD_ORIGINS.has(location.origin) &&
        (isValidEncryptedVault(stored[ACCOUNT_VAULT_LEGACY_KEY]) || isolated),
      vaultScopeId,
      vaultLockEpoch,
    };
  }

  async function requireBoundVaultScope() {
    const vaultScopeId = currentVaultScopeId();
    const stored = await chrome.storage.local.get([ACCOUNT_VAULT_SCOPE_KEY]);
    if (validVaultScopeId(stored[ACCOUNT_VAULT_SCOPE_KEY]) === vaultScopeId) {
      return { vaultScopeId, vaultLockEpoch: await currentVaultLockEpoch() };
    }
    const binding = await bindAccountVaultScope();
    return { vaultScopeId: binding.vaultScopeId, vaultLockEpoch: binding.vaultLockEpoch };
  }

  function normalizeAccountPlatform(value, allowLegacyDefault) {
    if (value === 'taobao' || value === 'xiaohongshu') return value;
    return allowLegacyDefault && (value === undefined || value === null || value === '') ? 'taobao' : '';
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

  function isValidEncryptedVault(value) {
    try {
      sanitizeEncryptedVault(value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function sanitizeVaultSessionKey(value) {
    const encoded = validBase64(value, 100);
    if (!encoded) throw new Error('账号库会话密钥无效，请重新解锁。');
    try {
      if (atob(encoded).length !== 32) throw new Error('invalid key length');
    } catch (error) {
      throw new Error('账号库会话密钥无效，请重新解锁。');
    }
    return encoded;
  }

  function base64Bytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function encodeBase64Bytes(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function encryptVaultWithSessionKey(value, encryptedRecord, encodedSessionKey) {
    const record = sanitizeEncryptedVault(encryptedRecord);
    const sessionKey = sanitizeVaultSessionKey(encodedSessionKey);
    const key = await crypto.subtle.importKey(
      'raw',
      base64Bytes(sessionKey),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(sanitizeAccountSessionVault(value)));
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode('taobao-account-vault-v1'),
    }, key, plaintext);
    return {
      schema: 1,
      kdf: Object.assign({}, record.kdf),
      cipher: {
        name: 'AES-GCM',
        iv: encodeBase64Bytes(iv),
        data: encodeBase64Bytes(new Uint8Array(ciphertext)),
      },
      updatedAt: Date.now(),
    };
  }

  async function encryptedVaultFingerprint(value) {
    const vault = sanitizeEncryptedVault(value);
    const bytes = new TextEncoder().encode(JSON.stringify(vault));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => (
      byte.toString(16).padStart(2, '0')
    )).join('');
  }

  async function activeVaultRecord(vaultContext) {
    const scopedKey = scopedVaultStorageKey(vaultContext.vaultScopeId);
    const remoteStateKey = vaultRemoteStateStorageKey(vaultContext.vaultScopeId);
    const stored = await chrome.storage.local.get([scopedKey, remoteStateKey]);
    const envelope = scopedVaultEnvelope(stored[scopedKey], vaultContext.vaultScopeId);
    const remoteState = vaultRemoteState(stored[remoteStateKey], vaultContext.vaultScopeId);
    const survivesTombstone = !remoteState || (envelope &&
      envelope.remoteRevision > remoteState.revision &&
      envelope.vaultLockEpoch >= remoteState.vaultLockEpoch);
    return envelope && survivesTombstone ? sanitizeEncryptedVault(envelope.vault) : null;
  }

  function classificationInteger(value, maxValue) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return Math.min(parsed, maxValue == null ? Number.MAX_SAFE_INTEGER : maxValue);
  }

  function classificationText(value, maxLength) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim().slice(0, maxLength)
      : '';
  }

  function classificationTerms(value, maxItems, maxLength) {
    const seen = new Set();
    const result = [];
    (Array.isArray(value) ? value : []).slice(0, maxItems).some((raw) => {
      const term = classificationText(raw, maxLength);
      const key = term.toLowerCase();
      if (term && !seen.has(key)) {
        seen.add(key);
        result.push(term);
      }
      return result.length >= maxItems;
    });
    return result;
  }

  function highestPriorityClassificationTerm(value, priority) {
    const candidates = classificationTerms(value, 20, 80);
    return priority.find((item) => candidates.includes(item)) || candidates[0] || '';
  }

  function sanitizeClassificationPatch(value, legacy) {
    const patch = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const old = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
    const entityRelation = classificationText(
      patch.entityRelation == null ? old.commercialCategory : patch.entityRelation,
      80
    );
    const topicTagSource = patch.topicTagIds == null ? old.topicTagIds : patch.topicTagIds;
    const hasTopicTagPatch = Array.isArray(topicTagSource);
    const topicTagId = highestPriorityClassificationTerm(
      topicTagSource,
      [
        'safety_adverse_effect', 'need_pain_point', 'core_category', 'usage_scenario',
        'adjacent_category', 'industry_interest', 'unrelated',
      ]
    );
    const prioritizedIntentId = highestPriorityClassificationTerm(
      patch.intentIds == null ? old.secondaryIntents : patch.intentIds,
      [
        'purchase_decision', 'comparison', 'problem_solving', 'usage',
        'brand_product_lookup', 'category_exploration', 'interest_browsing', 'unclear',
      ]
    );
    let primaryIntentId = classificationText(
      patch.primaryIntentId == null ? (old.primaryIntent || old.intent) : patch.primaryIntentId,
      80
    );
    if (!primaryIntentId) primaryIntentId = prioritizedIntentId;
    const topicTagIds = topicTagId ? [topicTagId] : [];
    const intentIds = primaryIntentId ? [primaryIntentId] : [];
    const relevance = classificationText(
      patch.relevance == null ? old.relevance : patch.relevance,
      80
    );
    return Object.assign(
      {},
      entityRelation ? { entityRelation } : {},
      hasTopicTagPatch ? { topicTagIds } : {},
      intentIds.length ? { intentIds } : {},
      primaryIntentId ? { primaryIntentId } : {},
      relevance ? { relevance } : {}
    );
  }

  function sanitizeClassificationOverride(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const keyword = classificationText(item.keyword || item.normalizedKeyword, 160);
    const keywordKey = classificationText(item.keywordKey, 240);
    const normalizedKeyword = classificationText(item.normalizedKeyword, 160);
    const overrideId = classificationText(item.id || keywordKey || normalizedKeyword || keyword, 96);
    if (!overrideId || !keyword) return null;
    return Object.assign({
      id: overrideId,
      scopeKey: classificationText(item.scopeKey, 160),
      keyword,
    }, keywordKey ? { keywordKey } : {}, normalizedKeyword ? { normalizedKeyword } : {}, {
      active: item.active !== false,
      reason: classificationText(item.reason, 160),
      patch: sanitizeClassificationPatch(item.patch, item),
      updatedAt: classificationInteger(item.updatedAt),
    });
  }

  function sanitizeStoreClassification(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Number(value.schema) !== 1) {
      return null;
    }
    const overrideIds = new Set();
    const manualOverrides = [];
    (Array.isArray(value.manualOverrides) ? value.manualOverrides : [])
      .slice(0, 500).some((raw) => {
        const item = sanitizeClassificationOverride(raw);
        if (item && !overrideIds.has(item.id)) {
          overrideIds.add(item.id);
          manualOverrides.push(item);
        }
        return manualOverrides.length >= 500;
      });
    return {
      schema: 1,
      profileId: classificationText(value.profileId, 96),
      customIndustry: classificationText(value.customIndustry, 120),
      ownBrandTerms: classificationTerms(value.ownBrandTerms, 200, 64),
      ownProductTerms: classificationTerms(value.ownProductTerms, 200, 64),
      competitorTerms: classificationTerms(value.competitorTerms, 200, 64),
      manualOverrides,
      revision: classificationInteger(value.revision, 2147483647),
      updatedAt: classificationInteger(value.updatedAt),
    };
  }

  const CLASSIFICATION_ARCHIVE_TOPIC_LABELS = Object.freeze({
    core_category: '核心品类',
    need_pain_point: '需求/痛点',
    usage_scenario: '使用场景',
    adjacent_category: '邻近品类',
    industry_interest: '行业兴趣',
    unrelated: '无关',
    safety_adverse_effect: '安全/副作用',
  });
  const CLASSIFICATION_ARCHIVE_INTENT_LABELS = Object.freeze({
    brand_product_lookup: '品牌/产品查找',
    category_exploration: '品类探索',
    problem_solving: '问题解决',
    comparison: '对比评估',
    purchase_decision: '购买决策',
    usage: '使用方法',
    interest_browsing: '兴趣浏览',
    unclear: '意图不明确',
  });
  const CLASSIFICATION_ARCHIVE_ENTITY_LABELS = Object.freeze({
    own_product: '自有产品',
    own_brand: '自有品牌',
    competitor: '竞品',
    generic_category: '泛品类',
    unknown: '未知',
  });
  const CLASSIFICATION_ARCHIVE_RELEVANCE_LABELS = Object.freeze({
    strong: '强相关',
    medium: '中相关',
    weak: '弱相关',
    none: '无关',
    review: '待确认',
  });
  const CLASSIFICATION_ARCHIVE_TOPIC_PRIORITY = Object.freeze([
    'safety_adverse_effect', 'need_pain_point', 'core_category', 'usage_scenario',
    'adjacent_category', 'industry_interest', 'unrelated',
  ]);
  const CLASSIFICATION_ARCHIVE_INTENT_PRIORITY = Object.freeze([
    'purchase_decision', 'comparison', 'problem_solving', 'usage',
    'brand_product_lookup', 'category_exploration', 'interest_browsing', 'unclear',
  ]);
  const CLASSIFICATION_ARCHIVE_SOURCES = Object.freeze(new Set([
    'override', 'fact', 'qwen', 'openai', 'rule', 'heuristic', 'hybrid',
  ]));
  const MAX_CLASSIFICATION_ARCHIVE_ENTRIES = 10000;
  const MAX_CLASSIFICATION_ARCHIVE_BYTES = 8 * 1024 * 1024;

  function classificationArchiveText(value, maxLength, collapseWhitespace) {
    if (typeof value !== 'string') return '';
    let text = '';
    try {
      text = value.normalize('NFKC').trim();
    } catch (error) {
      return '';
    }
    if (collapseWhitespace !== false) text = text.replace(/\s+/gu, ' ');
    if (!text || text.length > maxLength || importedStringContainsCredential(text)) return '';
    return text;
  }

  function classificationArchiveId(value, maxLength) {
    const text = classificationArchiveText(value, maxLength == null ? 96 : maxLength, false);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text) ? text : '';
  }

  function classificationArchiveSource(value) {
    return CLASSIFICATION_ARCHIVE_SOURCES.has(value) ? value : '';
  }

  function classificationArchiveEvidence(value) {
    const result = [];
    const seen = new Set();
    for (const raw of (Array.isArray(value) ? value : []).slice(0, 16)) {
      const text = classificationArchiveText(raw, 64, true);
      const key = text.toLocaleLowerCase('zh-CN');
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
      if (result.length >= 8) break;
    }
    return result;
  }

  function sanitizeClassificationArchiveTopicTags(value) {
    const candidates = new Map();
    for (const raw of (Array.isArray(value) ? value : []).slice(0, 20)) {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const id = classificationArchiveId(item.id, 64);
      const source = classificationArchiveSource(item.source);
      if (!Object.prototype.hasOwnProperty.call(CLASSIFICATION_ARCHIVE_TOPIC_LABELS, id) ||
          !source || candidates.has(id)) continue;
      candidates.set(id, {
        id,
        label: CLASSIFICATION_ARCHIVE_TOPIC_LABELS[id],
        evidence: classificationArchiveEvidence(item.evidence),
        source,
      });
    }
    const selectedId = CLASSIFICATION_ARCHIVE_TOPIC_PRIORITY.find((id) => candidates.has(id));
    return selectedId ? [candidates.get(selectedId)] : [];
  }

  function sanitizeClassificationArchiveIntents(value) {
    const candidates = new Map();
    for (const raw of (Array.isArray(value) ? value : []).slice(0, 20)) {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const id = classificationArchiveId(item.id, 64);
      const source = classificationArchiveSource(item.source);
      if (!Object.prototype.hasOwnProperty.call(CLASSIFICATION_ARCHIVE_INTENT_LABELS, id) ||
          !source || candidates.has(id)) continue;
      candidates.set(id, {
        id,
        label: CLASSIFICATION_ARCHIVE_INTENT_LABELS[id],
        isPrimary: true,
        evidence: classificationArchiveEvidence(item.evidence),
        source,
      });
    }
    const selectedId = CLASSIFICATION_ARCHIVE_INTENT_PRIORITY.find((id) => candidates.has(id));
    return selectedId ? [candidates.get(selectedId)] : [];
  }

  function sanitizeClassificationArchiveEntity(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const relation = classificationArchiveId(item.relation, 64);
    const source = classificationArchiveSource(item.source);
    if (!Object.prototype.hasOwnProperty.call(CLASSIFICATION_ARCHIVE_ENTITY_LABELS, relation) ||
        !source) return null;
    return {
      relation,
      label: CLASSIFICATION_ARCHIVE_ENTITY_LABELS[relation],
      matchedTerm: classificationArchiveText(item.matchedTerm, 64, true),
      source,
      lockedByFact: item.lockedByFact === true,
    };
  }

  function sanitizeClassificationArchiveRelevance(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const id = classificationArchiveId(item.id, 64);
    const source = classificationArchiveSource(item.source);
    if (!Object.prototype.hasOwnProperty.call(CLASSIFICATION_ARCHIVE_RELEVANCE_LABELS, id) ||
        !source) return null;
    return {
      id,
      label: CLASSIFICATION_ARCHIVE_RELEVANCE_LABELS[id],
      source,
    };
  }

  function sanitizeClassificationArchiveReasonCodes(value) {
    const result = [];
    const seen = new Set();
    for (const raw of (Array.isArray(value) ? value : []).slice(0, 48)) {
      const code = classificationArchiveText(raw, 64, false);
      if (!/^[A-Z0-9][A-Z0-9_:-]*$/u.test(code) || seen.has(code)) continue;
      seen.add(code);
      result.push(code);
      if (result.length >= 24) break;
    }
    return result;
  }

  function sanitizeClassificationArchiveClassification(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (item.schema !== 'xhsSearchClassificationV2' || Number(item.schemaVersion) !== 2 ||
        typeof item.confidenceScore !== 'number' || !Number.isFinite(item.confidenceScore) ||
        item.confidenceScore < 0 || item.confidenceScore > 1) return null;
    const entity = sanitizeClassificationArchiveEntity(item.entity);
    const relevance = sanitizeClassificationArchiveRelevance(item.relevance);
    const source = classificationArchiveSource(item.source);
    if (!entity || !relevance || !source) return null;
    return {
      schema: 'xhsSearchClassificationV2',
      schemaVersion: 2,
      entity,
      topicTags: sanitizeClassificationArchiveTopicTags(item.topicTags),
      intents: sanitizeClassificationArchiveIntents(item.intents),
      relevance,
      source,
      confidenceScore: item.confidenceScore,
      needsReview: item.needsReview === true,
      reasonCodes: sanitizeClassificationArchiveReasonCodes(item.reasonCodes),
    };
  }

  function sanitizeClassificationArchiveCacheKey(value) {
    const cacheKey = classificationArchiveText(value, 64, false);
    return /^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(cacheKey) ? cacheKey : '';
  }

  function sanitizeClassificationArchiveEntry(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cacheKey = sanitizeClassificationArchiveCacheKey(item.cacheKey);
    const normalizedKeyword = classificationArchiveText(item.normalizedKeyword, 160, true)
      .toLocaleLowerCase('zh-CN');
    const scopeKey = classificationArchiveText(item.scopeKey, 160, true) || '*';
    const automatic = sanitizeClassificationArchiveClassification(item.automatic);
    const effective = sanitizeClassificationArchiveClassification(item.effective);
    if (!cacheKey || !normalizedKeyword || !automatic || !effective) return null;
    return {
      cacheKey,
      normalizedKeyword,
      scopeKey,
      automatic,
      effective,
      appliedOverrideId: classificationArchiveId(item.appliedOverrideId, 96) || null,
    };
  }

  function sanitizeXhsSearchClassificationArchive(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (source.schema !== 'xhsSearchClassificationArchiveV1' ||
        Number(source.schemaVersion) !== 1 || !Array.isArray(source.entries)) {
      throw new Error('搜索词分类归档格式无效。');
    }
    const status = classificationArchiveId(source.status, 32);
    const configRevision = classificationArchiveId(source.configRevision, 64);
    const profileId = classificationArchiveId(source.profileId, 96);
    const engineSource = source.engine && typeof source.engine === 'object' &&
      !Array.isArray(source.engine) ? source.engine : {};
    const engine = {
      rulesetVersion: classificationArchiveId(engineSource.rulesetVersion, 96),
      taxonomyVersion: classificationArchiveId(engineSource.taxonomyVersion, 96),
      provider: classificationArchiveId(engineSource.provider, 32),
      model: classificationArchiveId(engineSource.model, 96),
      promptVersion: classificationArchiveId(engineSource.promptVersion, 96),
    };
    const generatedAtSource = classificationArchiveText(source.generatedAt, 40, false);
    let generatedAt = '';
    try {
      generatedAt = new Date(generatedAtSource).toISOString();
    } catch (error) {}
    const supportedProvider = ['rules', 'qwen', 'openai'].includes(engine.provider);
    const validModel = engine.provider === 'rules' ? !engine.model : Boolean(engine.model);
    if (!['rules_only', 'complete', 'partial'].includes(status) || !configRevision ||
        !profileId || !supportedProvider || !engine.rulesetVersion ||
        !engine.taxonomyVersion || !validModel || !engine.promptVersion || !generatedAt) {
      throw new Error('搜索词分类归档元数据无效。');
    }
    const entries = [];
    const seenCacheKeys = new Set();
    for (const raw of source.entries.slice(0, MAX_CLASSIFICATION_ARCHIVE_ENTRIES)) {
      const entry = sanitizeClassificationArchiveEntry(raw);
      if (!entry || seenCacheKeys.has(entry.cacheKey)) continue;
      seenCacheKeys.add(entry.cacheKey);
      entries.push(entry);
    }
    const archive = {
      schema: 'xhsSearchClassificationArchiveV1',
      schemaVersion: 1,
      status,
      configRevision,
      profileId,
      engine,
      generatedAt,
      entries,
    };
    const serialized = JSON.stringify(archive);
    if (utf8ByteLength(serialized, MAX_CLASSIFICATION_ARCHIVE_BYTES) >
        MAX_CLASSIFICATION_ARCHIVE_BYTES) {
      throw new Error('搜索词分类归档超过安全存储上限。');
    }
    return archive;
  }

  function xhsClassificationSnapshotMatches(value, storeId, analysisRunId, requireStoreId) {
    const snapshot = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!snapshot || snapshot.schema !== 'xhsAnalysisSnapshotV1' ||
        String(snapshot.runId || '') !== analysisRunId) return false;
    const snapshotStoreId = String(snapshot.storeId || '');
    return requireStoreId ? snapshotStoreId === storeId : !snapshotStoreId || snapshotStoreId === storeId;
  }

  function xhsClassificationRunMatches(value, storeId, analysisRunId) {
    const run = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    const account = run && run.account && typeof run.account === 'object' &&
      !Array.isArray(run.account) ? run.account : {};
    const snapshots = run && run.snapshots && typeof run.snapshots === 'object' &&
      !Array.isArray(run.snapshots) ? run.snapshots : {};
    return Boolean(run) && String(account.storeId || '') === storeId &&
      xhsClassificationSnapshotMatches(
        snapshots.xhsAnalysisSnapshotV1, storeId, analysisRunId, false
      );
  }

  function xhsSnapshotWithSearchClassification(value, archive) {
    const snapshot = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const pgy = snapshot.pgy && typeof snapshot.pgy === 'object' && !Array.isArray(snapshot.pgy)
      ? snapshot.pgy
      : {};
    return Object.assign({}, snapshot, {
      pgy: Object.assign({}, pgy, { searchClassification: archive }),
    });
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
      const classification = sanitizeStoreClassification(item.classification);
      return Object.assign({
        id,
        name,
        groupId: groupIds.has(item.groupId) ? item.groupId : '',
        createdAt: cleanText(item.createdAt, 80),
        updatedAt: cleanText(item.updatedAt, 80),
      }, classification ? { classification } : {});
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
      return {
        id,
        name,
        groupId: storeGroupIds.has(item.groupId) ? item.groupId : '',
        credentialBindings: {
          taobaoAccountId: cleanText(item.credentialBindings && item.credentialBindings.taobaoAccountId, 100),
          xiaohongshuAccountId: cleanText(item.credentialBindings && item.credentialBindings.xiaohongshuAccountId, 100),
        },
      };
    }).filter(Boolean);
    const accountIds = new Set();
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 500).map((value) => {
      const item = value && typeof value === 'object' ? value : {};
      const id = cleanText(item.id, 100);
      const storeId = cleanText(item.storeId, 100);
      const username = cleanText(item.username, 240);
      const password = String(item.password == null ? '' : item.password).slice(0, 360);
      const platform = normalizeAccountPlatform(item.platform);
      if (!id || accountIds.has(id) || !storeIds.has(storeId) || !platform || !username || !password) return null;
      accountIds.add(id);
      return {
        id,
        label: cleanText(item.label || item.name, 100) || (platform === 'xiaohongshu' ? '小红书账号' : '淘宝账号'),
        name: cleanText(item.label || item.name, 100) || (platform === 'xiaohongshu' ? '小红书账号' : '淘宝账号'),
        platform,
        storeId,
        username,
        password,
        accountGroupId: accountGroupIds.has(item.accountGroupId) ? item.accountGroupId : '',
        roleKeyword: platform === 'taobao' ? (cleanText(item.roleKeyword, 80) || '品牌') : '',
        enabled: item.enabled !== false,
      };
    }).filter(Boolean);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    stores.forEach((store) => {
      const bindings = store.credentialBindings;
      [['taobaoAccountId', 'taobao'], ['xiaohongshuAccountId', 'xiaohongshu']].forEach(([key, platform]) => {
        const account = accountsById.get(bindings[key]);
        if (!account || account.storeId !== store.id || account.platform !== platform || account.enabled === false) {
          bindings[key] = '';
        }
      });
    });
    return {
      schema: 4,
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

  function sanitizeSessionBatchRequest(value, vaultScopeId) {
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
      vaultScopeId,
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
    const credentialMode = cleanText(source.credentialMode, 32);
    if (!['vault', 'currentSession'].includes(credentialMode)) {
      throw new Error('请选择有效的登录方式。');
    }
    const concurrentAccountTabs = Number(source.concurrentAccountTabs);
    return {
      taskType: 'report',
      platforms,
      credentialMode,
      dateRange: hasXhs ? sanitizeXhsDateRange(source.dateRange) : null,
      concurrentAccountTabs: platforms.includes('juguang') &&
        [2, 3].includes(concurrentAccountTabs)
        ? concurrentAccountTabs
        : undefined,
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

  function requireAccountManagementPage() {
    if (location.pathname !== '/accounts.html' || window.top !== window) {
      throw new Error('请从顶层“账号库管理”页面修改账号会话。');
    }
  }

  function requireTeamLegacyRecoveryPage() {
    requireAccountManagementPage();
    if (!TEAM_DASHBOARD_ORIGINS.has(location.origin)) {
      throw new Error('仅在已登录的在线团队账号库页面迁移旧账号库。');
    }
    if (currentVaultScopeId() !== 'team:https://tbdata.aizicheng.com') {
      throw new Error('当前页面不属于可迁移的团队工作区。');
    }
  }

  function requireTeamVaultSyncPage() {
    if (!TEAM_DASHBOARD_ORIGINS.has(location.origin) || window.top !== window ||
        !TEAM_WORKBENCH_PATHS.has(location.pathname)) {
      throw new Error('仅允许已登录的顶层团队工作台应用账号库删除标记。');
    }
    if (currentVaultScopeId() !== 'team:https://tbdata.aizicheng.com') {
      throw new Error('当前页面不属于可同步的团队工作区。');
    }
  }

  function requireInteractiveProjectTaskCancel() {
    requireOneClickTaskPage();
    if (window.top !== window) {
      throw new Error('仅允许在顶层一键取数页取消任务。');
    }
    if (document.visibilityState !== 'visible') {
      throw new Error('请切换到可见的一键取数页后再取消任务。');
    }
    if (typeof document.hasFocus !== 'function' || !document.hasFocus()) {
      throw new Error('请先聚焦一键取数页，再取消任务。');
    }
  }

  function sanitizeProjectTaskId(value) {
    const taskId = cleanText(value, 120);
    if (!/^project-task-[a-z0-9-]+$/i.test(taskId)) throw new Error('项目任务编号无效。');
    return taskId;
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
  const IMPORTED_XHS_SNAPSHOT_KEYS = new Set([
    'xhsAnalysisSnapshotV1', 'xhsCollectionStatusV1', COMMENT_ARCHIVE_SNAPSHOT_KEY,
  ]);
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

  function isSafeImportedClassificationCacheKey(value) {
    return typeof value === 'string' &&
      /^xhs-search-classification-v2:[0-9a-f]{16}$/u.test(value);
  }

  function importedUrlContainsControlCharacter(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function isImportedOfficialPgyNoteUrl(value, expectedNoteId) {
    if (typeof value !== 'string' || value !== value.trim() ||
        typeof expectedNoteId !== 'string' || expectedNoteId !== expectedNoteId.trim() ||
        !/^https:\/\/www\.xiaohongshu\.com\/explore\//.test(value) ||
        !/^[a-z0-9_-]{3,128}$/i.test(expectedNoteId) ||
        importedUrlContainsControlCharacter(value)) return false;
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      return false;
    }
    const pathMatch = /^\/explore\/([a-z0-9_-]{3,128})$/i.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port ||
        url.username || url.password || url.hash || !pathMatch || pathMatch[1] !== expectedNoteId) {
      return false;
    }
    const rawQuery = url.search.slice(1);
    const sourceSuffix = '&xsec_source=pc_pgyexport';
    if (!rawQuery.startsWith('xsec_token=') || !rawQuery.endsWith(sourceSuffix) ||
        rawQuery.indexOf('&') !== rawQuery.length - sourceSuffix.length) return false;
    const token = String(url.searchParams.get('xsec_token') || '');
    return token.length >= 8 && token.length <= 2048 && !/\s/.test(token) &&
      !importedUrlContainsControlCharacter(token) &&
      url.searchParams.getAll('xsec_token').length === 1 &&
      url.searchParams.getAll('xsec_source').length === 1;
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
      if (key === 'noteUrl' && Object.prototype.hasOwnProperty.call(value, 'noteId') &&
          isImportedOfficialPgyNoteUrl(child, value.noteId)) continue;
      if (importedRunContainsSensitiveValue(child, visited, Number(depth || 0) + 1)) return true;
    }
    return false;
  }

  function importedXhsContainsRawState(value, seen, depth, context) {
    if (!value || typeof value !== 'object') return false;
    if (Number(depth) > 64) return true;
    const visited = seen || new Set();
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) {
      const itemContext = context === 'classificationEntries' ? 'classificationEntry' : '';
      return value.some((child) => importedXhsContainsRawState(
        child, visited, Number(depth || 0) + 1, itemContext
      ));
    }
    const classificationArchive = value.schema === 'xhsSearchClassificationArchiveV1' &&
      Number(value.schemaVersion) === 1 && Array.isArray(value.entries);
    for (const [key, child] of Object.entries(value)) {
      if (isImportedRawStateKey(key)) {
        if (normalizedImportedRunKey(key) === 'cachekey' && context === 'classificationEntry' &&
            isSafeImportedClassificationCacheKey(child)) continue;
        return true;
      }
      const childContext = classificationArchive && key === 'entries'
        ? 'classificationEntries'
        : '';
      if (importedXhsContainsRawState(
        child, visited, Number(depth || 0) + 1, childContext
      )) return true;
    }
    return false;
  }

  function importedCommentPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]';
  }

  function importedCommentHasOnlyKeys(value, allowedKeys) {
    return importedCommentPlainObject(value) &&
      Object.keys(value).every((key) => allowedKeys.has(key));
  }

  function importedCommentText(value, maximum, required) {
    return typeof value === 'string' && value.length <= maximum && (!required || value.length > 0);
  }

  function importedCommentTime(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 4102444800000;
  }

  function importedCommentCanonical(value) {
    if (Array.isArray(value)) return value.map(importedCommentCanonical);
    if (!importedCommentPlainObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, importedCommentCanonical(value[key]),
    ]));
  }

  function importedCommentArchiveRunIsSafe(value) {
    const run = importedCommentPlainObject(value) ? value : {};
    const snapshots = importedCommentPlainObject(run.snapshots) ? run.snapshots : {};
    const hasCommentSummary = Object.prototype.hasOwnProperty.call(
      snapshots, COMMENT_ARCHIVE_SNAPSHOT_KEY
    );
    if (run.taskType !== 'comment_monitor') return !hasCommentSummary;
    if (!importedCommentHasOnlyKeys(run, COMMENT_ARCHIVE_RUN_KEYS) || run.schema !== 3 ||
        !/^store-run-[a-z0-9-]+$/iu.test(run.runId || '') ||
        !importedCommentText(run.batchId, 120, true) || run.runMode !== 'current' ||
        !['success', 'partial'].includes(run.status) || !importedCommentTime(run.startedAt) ||
        !importedCommentTime(run.finishedAt) || !importedCommentTime(run.updatedAt) ||
        run.finishedAt < run.startedAt || run.updatedAt < run.finishedAt) return false;
    if (!importedCommentHasOnlyKeys(run.account, COMMENT_ARCHIVE_ACCOUNT_KEYS) ||
        run.account.platform !== 'xiaohongshu' ||
        !importedCommentText(run.account.storeId, 100, true) ||
        !importedCommentText(run.account.storeName, 120, true) ||
        !Object.values(run.account).every((item) => typeof item === 'string' && item.length <= 240)) return false;
    if (!importedCommentHasOnlyKeys(run.xinghe, new Set(['state', 'noPermission'])) ||
        !importedCommentText(run.xinghe.state, 100, false) ||
        typeof run.xinghe.noPermission !== 'boolean' || !Array.isArray(run.failures) ||
        run.failures.length > 100 ||
        !run.failures.every((item) => importedCommentText(item, 120, true))) return false;
    if (Object.keys(snapshots).length !== 1 || !hasCommentSummary) return false;
    const summary = snapshots[COMMENT_ARCHIVE_SNAPSHOT_KEY];
    if (!importedCommentPlainObject(summary) || summary.schema !== 'CommentInsightSummaryV1' ||
        summary.schemaVersion !== 1 || !/^[0-9a-f]{64}$/u.test(summary.accountRef || '') ||
        !importedCommentText(summary.generatedAt, 80, true) ||
        !Array.isArray(summary.noteMetrics) || !Array.isArray(summary.noteStates)) return false;
    const monitor = globalThis.XhsCommentMonitor;
    if (!monitor || typeof monitor.sanitizeCommentInsightSummaryForArchive !== 'function') return false;
    try {
      const canonical = monitor.sanitizeCommentInsightSummaryForArchive(summary, {
        accountRef: summary.accountRef,
        bindingSourceRunId: summary.bindingSourceRunId,
      });
      return JSON.stringify(importedCommentCanonical(summary)) ===
        JSON.stringify(importedCommentCanonical(canonical));
    } catch (error) {
      return false;
    }
  }

  function assertImportedCommentArchiveBoundary(run) {
    if (!importedCommentArchiveRunIsSafe(run)) {
      throw new Error('云端评论监测归档结构不符合脱敏 schema，已拒绝导入。');
    }
  }

  function assertImportedRunSafe(run) {
    if (importedRunContainsSensitiveValue(run)) {
      throw new Error('云端历史归档包含不应导入的敏感凭据或签名链接。');
    }
    assertImportedCommentArchiveBoundary(run);
    const snapshots = run && typeof run.snapshots === 'object' && !Array.isArray(run.snapshots)
      ? run.snapshots
      : {};
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (!IMPORTED_XHS_SNAPSHOT_KEYS.has(key) && !isXhsDetailStorageKey(key)) continue;
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
      if (isArchiveSnapshotKey(key)) snapshots[key] = snapshot;
    }
    const taskType = ['collect', 'report', 'both', 'comment_monitor'].includes(cloned.taskType)
      ? cloned.taskType
      : '';
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
      capabilities: lockOnlyPage ? ['accountVaultLock'] : CAPABILITIES.slice(),
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

  const COMMENT_MONITOR_MESSAGE_TYPES = Object.freeze({
    getCommentMonitorState: 'COMMENT_MONITOR_GET_STATE',
    configureCommentMonitor: 'COMMENT_MONITOR_CONFIGURE',
    runCommentMonitorNow: 'COMMENT_MONITOR_RUN_NOW',
    queryCommentMonitorComments: 'COMMENT_MONITOR_QUERY_COMMENTS',
    exportCommentMonitorRaw: 'COMMENT_MONITOR_EXPORT_RAW',
  });

  function commentMonitorNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function commentMonitorWebState(value, evidenceItems, storeItems) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const profile = source.profile && typeof source.profile === 'object' ? source.profile : {};
    const state = source.state && typeof source.state === 'object' ? source.state : {};
    const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
    const noteIndex = source.noteIndex && typeof source.noteIndex === 'object' ? source.noteIndex : {};
    const metricValues = Array.isArray(summary.noteMetrics) ? summary.noteMetrics : [];
    const stateValues = Array.isArray(summary.noteStates) ? summary.noteStates : [];
    const indexedValues = Array.isArray(noteIndex.notes) ? noteIndex.notes : [];
    const noteById = new Map();
    indexedValues.concat(metricValues, stateValues).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const noteId = cleanText(item.noteId, 160);
      if (!noteId) return;
      noteById.set(noteId, Object.assign({}, noteById.get(noteId) || {}, item));
    });
    const notes = Array.from(noteById.values()).map((item) => ({
      noteId: cleanText(item.noteId, 160),
      title: cleanText(item.title || item.noteTitle || '未命名笔记', 300),
      publishedAt: cleanText(item.publishedAt || item.notePublishTime, 80),
      updatedAt: cleanText(item.platformUpdatedAt || state.updatedAt, 80),
      officialUrl: cleanText(item.officialUrl, 3000),
      readDelta: commentMonitorNumber(item.readDelta),
      interactionDelta: commentMonitorNumber(
        item.nonCommentInteractionDelta === null ? 0 : item.nonCommentInteractionDelta
      ),
      commentDelta: commentMonitorNumber(item.commentDelta),
      commentCount: commentMonitorNumber(item.commentCount),
      heatScore: commentMonitorNumber(item.heatScore) * 100,
      heatLevel: item.discovery === 'new_note' ? '新笔记置顶'
        : item.heatTop20 === true ? '高热 Top 20%' : '常规',
      captureStatus: cleanText(item.captureStatus || item.status || '已建立基线', 80),
      captureState: cleanText(item.status, 40),
      isNew: item.discovery === 'new_note',
      pending: item.status === 'continuation',
    }));
    const categories = summary.categories && typeof summary.categories === 'object'
      ? summary.categories
      : {};
    const insights = Object.entries(categories).map(([id, category]) => {
      const item = category && typeof category === 'object' ? category : {};
      return {
        id,
        theme: cleanText(item.label || id, 160),
        businessType: '评论主题',
        count: commentMonitorNumber(item.count),
        trend: summary.interval && summary.interval.label || '累计',
        summary: commentMonitorNumber(item.count) > 0
          ? `共识别 ${commentMonitorNumber(item.count)} 条相关评论，可下钻查看证据。`
          : '当前范围暂无相关评论。',
        evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
      };
    });
    const noteTitle = new Map(notes.map((item) => [item.noteId, item.title]));
    const noteUrl = new Map(notes.map((item) => [item.noteId, item.officialUrl]));
    const evidenceThemes = new Map();
    const summaryEvidence = [];
    Object.values(categories).forEach((category) => {
      const item = category && typeof category === 'object' ? category : {};
      const theme = cleanText(item.label || '未分类', 120);
      (Array.isArray(item.evidence) ? item.evidence : []).forEach((entry) => {
        const commentId = cleanText(entry && entry.commentId, 160);
        if (commentId) evidenceThemes.set(commentId, theme);
        summaryEvidence.push({
          commentId,
          content: cleanText(entry && entry.excerpt, 2000),
          theme,
          sentiment: '中性',
          noteId: cleanText(entry && entry.noteId, 160),
          noteTitle: noteTitle.get(entry && entry.noteId) || '未命名笔记',
          noteUrl: noteUrl.get(entry && entry.noteId) || '',
          commentTime: '',
        });
      });
    });
    const queriedEvidence = Array.isArray(evidenceItems) ? evidenceItems.map((entry) => ({
      commentId: cleanText(entry && entry.commentId, 160),
      content: cleanText(entry && entry.content, 2000),
      theme: evidenceThemes.get(cleanText(entry && entry.commentId, 160)) || '未分类',
      sentiment: '中性',
      noteId: cleanText(entry && entry.noteId, 160),
      noteTitle: noteTitle.get(entry && entry.noteId) || '未命名笔记',
      noteUrl: noteUrl.get(entry && entry.noteId) || '',
      commentTime: cleanText(entry && entry.createdAt, 80),
    })) : null;
    const semanticItems = summary.semantic && Array.isArray(summary.semantic.items)
      ? summary.semantic.items
      : [];
    const complaintCount = commentMonitorNumber(categories.complaint_risk && categories.complaint_risk.count);
    const concernCount = complaintCount +
      commentMonitorNumber(categories.price_promotion && categories.price_promotion.count) +
      commentMonitorNumber(categories.fit_compatibility && categories.fit_compatibility.count);
    const newCommentCount = metricValues.reduce((total, item) => (
      total + commentMonitorNumber(item && item.commentDelta)
    ), 0) || commentMonitorNumber(state.capturedCommentCount);
    return {
      schema: 'commentMonitorWebStateV1',
      generatedAt: cleanText(summary.generatedAt || state.updatedAt, 80),
      extensionVersion: VERSION,
      stores: (Array.isArray(storeItems) ? storeItems : []).map((store) => ({
        id: cleanText(store && store.id, 100),
        name: cleanText(store && store.name, 120),
      })).filter((store) => store.id && store.name),
      profile: {
        enabled: profile.enabled === true,
        scheduleTime: cleanText(profile.dailyTime || '09:00', 5),
        timezone: 'Asia/Shanghai',
        storeId: cleanText(profile.storeId, 100),
        storeName: cleanText(profile.storeName, 120),
      },
      status: {
        state: cleanText(state.status || (state.running ? 'running' : 'idle'), 60),
        message: cleanText(state.error, 500),
        lastSuccessAt: cleanText(state.lastSuccessfulAt, 80),
        pendingCount: commentMonitorNumber(state.pendingContinuationCount),
      },
      overview: {
        newNotes: notes.filter((item) => item.isNew).length,
        newComments: newCommentCount,
        hotNotes: notes.filter((item) => /高热|置顶/.test(item.heatLevel)).length,
        negativeFeedback: semanticItems.filter((item) => item && item.sentiment === 'negative').length || complaintCount,
        purchaseConcerns: concernCount,
        unansweredQuestions: semanticItems.filter((item) => item && item.unresolvedQuestion === true).length,
        pendingTasks: commentMonitorNumber(state.pendingContinuationCount),
      },
      notes,
      insights,
      evidence: queriedEvidence || summaryEvidence,
      runs: (Array.isArray(source.runs) ? source.runs : []).map((run) => Object.assign({}, run, {
        type: cleanText(run && run.trigger || '每日更新', 80),
        newCommentCount: run && run.runId === state.runId ? newCommentCount : 0,
      })),
    };
  }

  async function callCommentMonitorRuntime(type, payload) {
    const response = await runtimeMessage({
      type, payload: payload || {}, source: 'business-defense-web-tool',
    });
    if (!response || response.ok !== true) {
      throw new Error(cleanText(response && response.message, 1000) || '评论监测后台未响应。');
    }
    return response.data === undefined ? response : response.data;
  }

  async function commentMonitorStores() {
    const stored = await chrome.storage.local.get([PROJECT_DIRECTORY_KEY]);
    return sanitizeProjectDirectory(stored[PROJECT_DIRECTORY_KEY]).stores.map((store) => ({
      id: store.id,
      name: store.name,
    }));
  }

  async function selectedCommentMonitorStore(payload) {
    const source = payload && payload.store && typeof payload.store === 'object'
      ? payload.store
      : (payload && payload.profile && typeof payload.profile === 'object' ? {
        id: payload.profile.storeId,
        name: payload.profile.storeName,
      } : {});
    const storeId = cleanText(source.id, 100);
    const stores = await commentMonitorStores();
    const store = stores.find((item) => item.id === storeId);
    if (!store) throw new Error('请选择项目管理中已存在的店铺后再更新。');
    return { store, stores };
  }

  async function getCommentMonitorState() {
    const [value, stores] = await Promise.all([
      callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.getCommentMonitorState),
      commentMonitorStores(),
    ]);
    return commentMonitorWebState(value, null, stores);
  }

  async function configureCommentMonitor(payload) {
    const profile = payload && payload.profile && typeof payload.profile === 'object'
      ? payload.profile
      : {};
    const selection = await selectedCommentMonitorStore(payload);
    await callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.configureCommentMonitor, {
      enabled: profile.enabled === true,
      dailyTime: cleanText(profile.scheduleTime || profile.dailyTime || '09:00', 5),
      timezone: 'Asia/Shanghai',
      storeId: selection.store.id,
      storeName: selection.store.name,
    });
    return getCommentMonitorState();
  }

  async function runCommentMonitorNow(payload) {
    const selection = await selectedCommentMonitorStore(payload);
    return callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.runCommentMonitorNow, {
      storeId: selection.store.id,
      storeName: selection.store.name,
    });
  }

  async function queryCommentMonitorComments(payload) {
    const filters = payload && payload.filters && typeof payload.filters === 'object'
      ? payload.filters
      : {};
    const [stateValue, queryValue, stores] = await Promise.all([
      callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.getCommentMonitorState),
      callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.queryCommentMonitorComments, filters),
      commentMonitorStores(),
    ]);
    return commentMonitorWebState(stateValue, queryValue && queryValue.items, stores);
  }

  async function exportCommentMonitorRaw(payload) {
    const filters = payload && payload.filters && typeof payload.filters === 'object'
      ? payload.filters
      : {};
    const result = await callCommentMonitorRuntime(COMMENT_MONITOR_MESSAGE_TYPES.exportCommentMonitorRaw,
      Object.assign({}, filters, { format: payload && payload.format === 'json' ? 'json' : 'csv' }));
    return Object.assign({}, result, {
      fileName: `原始评论_${new Date().toISOString().slice(0, 10)}.${result.extension || 'csv'}`,
    });
  }

  function teamSessionAllowsVaultTasks(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const member = source.member && typeof source.member === 'object' && !Array.isArray(source.member)
      ? source.member
      : {};
    const permissions = source.permissions && typeof source.permissions === 'object' &&
      !Array.isArray(source.permissions) ? source.permissions : {};
    const role = cleanText(source.role, 30).toLowerCase();
    const memberRole = cleanText(member.role, 30).toLowerCase();
    const canReadVault = permissions.canReadVault === true || permissions.readVault === true;
    const canWriteRuns = permissions.canWriteRuns === true || permissions.writeRuns === true;
    return member.status === 'active' && TEAM_VAULT_OPERATOR_ROLES.has(role) &&
      memberRole === role && source.mustChangePassword === false && canReadVault && canWriteRuns;
  }

  async function answerTeamVaultStartAuthorizationChallenge(message) {
    const nonce = cleanText(message && message.nonce, 180);
    const requestedScopeId = validVaultScopeId(message && message.vaultScopeId);
    const allowedPage = window.top === window &&
      (location.pathname === '/report.html' || location.pathname === '/accounts.html');
    const base = { ok: false, nonce, vaultScopeId: requestedScopeId || '' };
    if (!/^[A-Za-z0-9._:-]{16,180}$/.test(nonce) ||
        requestedScopeId !== 'team:https://tbdata.aizicheng.com' ||
        !TEAM_DASHBOARD_ORIGINS.has(location.origin) || !allowedPage) {
      return base;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEAM_VAULT_START_AUTH_TIMEOUT_MS);
    try {
      const sessionResponse = await fetch(location.origin + '/api/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!sessionResponse || !sessionResponse.ok) return base;
      const session = await sessionResponse.json().catch(() => null);
      if (!teamSessionAllowsVaultTasks(session)) return base;
      return {
        ok: true,
        nonce,
        vaultScopeId: requestedScopeId,
        checkedAt: Date.now(),
      };
    } catch (error) {
      return base;
    } finally {
      clearTimeout(timer);
    }
  }

  if (chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== TEAM_VAULT_START_AUTH_CHALLENGE_TYPE) return;
      if (sender && sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) {
        sendResponse({ ok: false, nonce: '', vaultScopeId: '' });
        return false;
      }
      answerTeamVaultStartAuthorizationChallenge(message).then(sendResponse).catch(() => {
        sendResponse({
          ok: false,
          nonce: cleanText(message && message.nonce, 180),
          vaultScopeId: '',
        });
      });
      return true;
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
      return {
        version: VERSION,
        connected: true,
        capabilities: lockOnlyPage ? ['accountVaultLock'] : CAPABILITIES.slice(),
      };
    }
    if (action === 'lockAccountVault') {
      return lockAccountVaultSession();
    }
    if (lockOnlyPage) {
      throw new Error('当前页面仅允许锁定账号库会话。');
    }
    if (action === 'getCommentMonitorState') return getCommentMonitorState();
    if (action === 'configureCommentMonitor') return configureCommentMonitor(payload);
    if (action === 'runCommentMonitorNow') return runCommentMonitorNow(payload);
    if (action === 'queryCommentMonitorComments') return queryCommentMonitorComments(payload);
    if (action === 'exportCommentMonitorRaw') return exportCommentMonitorRaw(payload);
    if (action === 'getStorage') {
      const keys = Array.from(new Set((Array.isArray(payload && payload.keys) ? payload.keys : [])
        .filter((key) => isReadableStorageKey(key))));
      const wantsVault = keys.includes(ACCOUNT_VAULT_KEY);
      const regularKeys = keys.filter((key) => key !== ACCOUNT_VAULT_KEY);
      if (!wantsVault) return chrome.storage.local.get(regularKeys);
      const vaultScopeId = currentVaultScopeId();
      const scopedKey = scopedVaultStorageKey(vaultScopeId);
      const remoteStateKey = vaultRemoteStateStorageKey(vaultScopeId);
      const stored = await chrome.storage.local.get(regularKeys.concat(scopedKey, remoteStateKey));
      const result = Object.fromEntries(regularKeys.filter((key) => (
        Object.prototype.hasOwnProperty.call(stored, key)
      )).map((key) => [key, stored[key]]));
      const envelope = scopedVaultEnvelope(stored[scopedKey], vaultScopeId);
      const remoteState = vaultRemoteState(stored[remoteStateKey], vaultScopeId);
      const survivesTombstone = !remoteState || (envelope &&
        envelope.remoteRevision > remoteState.revision &&
        envelope.vaultLockEpoch >= remoteState.vaultLockEpoch);
      if (envelope && survivesTombstone) result[ACCOUNT_VAULT_KEY] = envelope.vault;
      return result;
    }
    if (action === 'bindAccountVaultScope') {
      return bindAccountVaultScope();
    }
    if (action === 'setManualInputs') {
      const manualInputs = sanitizeManualInputs(payload && payload.manualInputs, true);
      await chrome.storage.local.set({ businessDefenseManualInputsV1: manualInputs });
      return { saved: true };
    }
    if (action === 'patchXhsSearchClassification') {
      const storeId = classificationArchiveText(payload && payload.storeId, 100, false);
      const analysisRunId = classificationArchiveText(
        payload && payload.analysisRunId, 120, false
      );
      if (!storeId || !analysisRunId) throw new Error('搜索词分类归档缺少店铺或分析批次标识。');
      const requestedRunId = payload && payload.runId
        ? sanitizeRunId(payload.runId)
        : '';
      const archive = sanitizeXhsSearchClassificationArchive(payload && payload.archive);
      const initialKeys = ['xhsAnalysisSnapshotV1', STORE_RUN_INDEX_KEY];
      if (requestedRunId) initialKeys.push(STORE_RUN_KEY_PREFIX + requestedRunId);
      const stored = await chrome.storage.local.get(initialKeys);
      const runIndex = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
      const matchedRuns = [];
      if (requestedRunId) {
        const exactRun = stored[STORE_RUN_KEY_PREFIX + requestedRunId];
        if (!xhsClassificationRunMatches(exactRun, storeId, analysisRunId)) {
          throw new Error('指定的店铺归档与当前搜索词分类批次不匹配。');
        }
        matchedRuns.push({ runId: requestedRunId, run: exactRun });
      } else {
        const candidateRunIds = [];
        const seenRunIds = new Set();
        for (const item of runIndex) {
          if (!item || typeof item !== 'object' || String(item.storeId || '') !== storeId) continue;
          let runId = '';
          try {
            runId = sanitizeRunId(item.runId);
          } catch (error) {}
          if (!runId || seenRunIds.has(runId)) continue;
          seenRunIds.add(runId);
          candidateRunIds.push(runId);
          if (candidateRunIds.length >= 5000) break;
        }
        if (candidateRunIds.length) {
          const runKeys = candidateRunIds.map((runId) => STORE_RUN_KEY_PREFIX + runId);
          const historicalStored = await chrome.storage.local.get(runKeys);
          candidateRunIds.forEach((runId) => {
            const run = historicalStored[STORE_RUN_KEY_PREFIX + runId];
            if (xhsClassificationRunMatches(run, storeId, analysisRunId)) {
              matchedRuns.push({ runId, run });
            }
          });
        }
      }
      const currentSnapshot = stored.xhsAnalysisSnapshotV1;
      const currentUpdated = xhsClassificationSnapshotMatches(
        currentSnapshot, storeId, analysisRunId, true
      );
      if (!currentUpdated && !matchedRuns.length) {
        throw new Error('未找到匹配的小红书分析快照或店铺归档。');
      }
      const updatedAt = Date.now();
      const writes = {};
      if (currentUpdated) {
        writes.xhsAnalysisSnapshotV1 = xhsSnapshotWithSearchClassification(
          currentSnapshot, archive
        );
      }
      const matchedRunIds = new Set();
      matchedRuns.forEach(({ runId, run }) => {
        const snapshots = Object.assign({}, run.snapshots && typeof run.snapshots === 'object' &&
          !Array.isArray(run.snapshots) ? run.snapshots : {});
        snapshots.xhsAnalysisSnapshotV1 = xhsSnapshotWithSearchClassification(
          snapshots.xhsAnalysisSnapshotV1, archive
        );
        writes[STORE_RUN_KEY_PREFIX + runId] = Object.assign({}, run, { snapshots, updatedAt });
        matchedRunIds.add(runId);
      });
      if (matchedRunIds.size) {
        writes[STORE_RUN_INDEX_KEY] = runIndex.map((item) => (
          item && matchedRunIds.has(item.runId) ? Object.assign({}, item, { updatedAt }) : item
        ));
      }
      await chrome.storage.local.set(writes);
      return {
        saved: true,
        currentUpdated,
        historyRunIds: Array.from(matchedRunIds),
        entryCount: archive.entries.length,
      };
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
      const keys = Array.from(new Set(requested.filter((key) => isClearableStorageKey(key))));
      const batchStored = await chrome.storage.local.get([ACCOUNT_BATCH_STATUS_KEY, PROJECT_TASK_STATUS_KEY]);
      if (batchStored[ACCOUNT_BATCH_STATUS_KEY] && batchStored[ACCOUNT_BATCH_STATUS_KEY].running && keys.length) {
        throw new Error('批量任务执行期间不能清空当前店铺数据。');
      }
      if (batchStored[PROJECT_TASK_STATUS_KEY] && batchStored[PROJECT_TASK_STATUS_KEY].running && keys.length) {
        throw new Error('当前账号任务执行期间不能清空店铺数据。');
      }
      if (keys.includes('xhsAnalysisSnapshotV1')) {
        const xhsStored = await chrome.storage.local.get('xhsAnalysisSnapshotV1');
        xhsDetailKeysFromSnapshot(xhsStored.xhsAnalysisSnapshotV1).forEach((key) => {
          if (!keys.includes(key)) keys.push(key);
        });
      }
      await chrome.storage.local.remove(keys);
      return { cleared: keys };
    }
    if (action === 'getLegacyAccountVault') {
      requireTeamLegacyRecoveryPage();
      const vaultContext = await requireBoundVaultScope();
      const legacyStored = await chrome.storage.local.get([
        ACCOUNT_VAULT_LEGACY_KEY,
        ACCOUNT_VAULT_LOCK_EPOCH_KEY,
      ]);
      if (!isValidEncryptedVault(legacyStored[ACCOUNT_VAULT_LEGACY_KEY])) {
        return {
          legacyAvailable: false,
          vaultScopeId: vaultContext.vaultScopeId,
          vaultLockEpoch: vaultContext.vaultLockEpoch,
        };
      }
      const vaultLockEpoch = Math.max(
        0,
        Number(legacyStored[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) || 0,
      );
      if (vaultLockEpoch !== vaultContext.vaultLockEpoch) {
        throw new Error('账号库已在其他页面锁定，请刷新后重试。');
      }
      const legacyVault = sanitizeEncryptedVault(legacyStored[ACCOUNT_VAULT_LEGACY_KEY]);
      return {
        legacyAvailable: true,
        legacyVault,
        fingerprint: await encryptedVaultFingerprint(legacyVault),
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch,
      };
    }
    if (action === 'commitLegacyAccountVault') {
      requireTeamLegacyRecoveryPage();
      const expectedFingerprint = cleanText(payload && payload.fingerprint, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
        throw new Error('旧账号库校验标识无效。');
      }
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const remoteRevision = Number(payload && payload.remoteRevision);
      if (payload && payload.serverConfirmed !== true ||
          !Number.isSafeInteger(remoteRevision) || remoteRevision < 1) {
        throw new Error('云端账号库版本无效，不能提交旧库迁移。');
      }
      const vaultContext = await requireBoundVaultScope();
      const scopedKey = scopedVaultStorageKey(vaultContext.vaultScopeId);
      const remoteStateKey = vaultRemoteStateStorageKey(vaultContext.vaultScopeId);
      const stored = await chrome.storage.local.get([
        ACCOUNT_VAULT_LEGACY_KEY,
        ACCOUNT_VAULT_SCOPE_KEY,
        ACCOUNT_VAULT_LOCK_EPOCH_KEY,
        scopedKey,
        remoteStateKey,
      ]);
      const currentEpoch = Math.max(0, Number(stored[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) || 0);
      if (vaultContext.vaultLockEpoch !== expectedEpoch || currentEpoch !== expectedEpoch ||
          validVaultScopeId(stored[ACCOUNT_VAULT_SCOPE_KEY]) !== vaultContext.vaultScopeId) {
        throw new Error('账号库已在其他页面锁定，迁移已停止。');
      }
      if (scopedVaultEnvelope(stored[scopedKey], vaultContext.vaultScopeId)) {
        throw new Error('当前团队账号库已存在，不能用旧账号库覆盖。');
      }
      const existingRemoteState = vaultRemoteState(
        stored[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      if (existingRemoteState && existingRemoteState.revision >= remoteRevision) {
        throw new Error('云端账号库状态已变化，旧库迁移已停止。');
      }
      if (!isValidEncryptedVault(stored[ACCOUNT_VAULT_LEGACY_KEY])) {
        throw new Error('未找到可迁移的旧账号库密文。');
      }
      const legacyVault = sanitizeEncryptedVault(stored[ACCOUNT_VAULT_LEGACY_KEY]);
      if (await encryptedVaultFingerprint(legacyVault) !== expectedFingerprint) {
        throw new Error('旧账号库已变化，请重新验证主密码。');
      }
      await chrome.storage.local.set({
        [scopedKey]: makeScopedVaultEnvelope(
          vaultContext.vaultScopeId,
          legacyVault,
          remoteRevision,
          expectedEpoch,
        ),
      });
      const latest = await chrome.storage.local.get([
        ACCOUNT_VAULT_LEGACY_KEY,
        ACCOUNT_VAULT_SCOPE_KEY,
        ACCOUNT_VAULT_LOCK_EPOCH_KEY,
        scopedKey,
        remoteStateKey,
      ]);
      const latestLegacy = isValidEncryptedVault(latest[ACCOUNT_VAULT_LEGACY_KEY])
        ? sanitizeEncryptedVault(latest[ACCOUNT_VAULT_LEGACY_KEY])
        : null;
      const latestEnvelope = scopedVaultEnvelope(latest[scopedKey], vaultContext.vaultScopeId);
      const latestRemoteState = vaultRemoteState(
        latest[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      const unchanged = latestLegacy &&
        await encryptedVaultFingerprint(latestLegacy) === expectedFingerprint;
      if (Math.max(0, Number(latest[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) || 0) !== expectedEpoch ||
          validVaultScopeId(latest[ACCOUNT_VAULT_SCOPE_KEY]) !== vaultContext.vaultScopeId ||
          !latestEnvelope || latestEnvelope.remoteRevision !== remoteRevision ||
          latestEnvelope.vaultLockEpoch !== expectedEpoch ||
          (latestRemoteState && latestRemoteState.revision >= remoteRevision) || !unchanged) {
        throw new Error('旧账号库状态已变化，迁移已停止。');
      }
      await chrome.storage.local.remove(ACCOUNT_VAULT_LEGACY_KEY);
      return {
        committed: true,
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch: expectedEpoch,
        updatedAt: legacyVault.updatedAt,
      };
    }
    if (action === 'setAccountVault') {
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const vaultContext = await requireBoundVaultScope();
      if (vaultContext.vaultLockEpoch !== expectedEpoch || await currentVaultLockEpoch() !== expectedEpoch) {
        throw new Error('账号库已在其他页面锁定，请重新登录并解锁。');
      }
      const vault = sanitizeEncryptedVault(payload && payload.vault);
      const scopedKey = scopedVaultStorageKey(vaultContext.vaultScopeId);
      const remoteStateKey = vaultRemoteStateStorageKey(vaultContext.vaultScopeId);
      const requestedRemoteRevision = Number(payload && payload.remoteRevision);
      const serverConfirmed = payload && payload.serverConfirmed === true &&
        Number.isSafeInteger(requestedRemoteRevision) && requestedRemoteRevision >= 1;
      const before = await chrome.storage.local.get([scopedKey, remoteStateKey]);
      const beforeRemoteState = vaultRemoteState(
        before[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      const beforeEnvelope = scopedVaultEnvelope(
        before[scopedKey],
        vaultContext.vaultScopeId,
      );
      const confirmedAfterTombstone = serverConfirmed && beforeRemoteState &&
        requestedRemoteRevision > beforeRemoteState.revision;
      const existingAfterTombstone = beforeEnvelope && beforeRemoteState &&
        beforeEnvelope.remoteRevision > beforeRemoteState.revision &&
        beforeEnvelope.vaultLockEpoch >= beforeRemoteState.vaultLockEpoch;
      if (beforeRemoteState && !confirmedAfterTombstone && !existingAfterTombstone) {
        throw new Error('团队账号库已删除，只有服务器确认的更新版本才能重建。');
      }
      if (beforeRemoteState && serverConfirmed &&
          requestedRemoteRevision < beforeRemoteState.revision) {
        throw new Error('云端账号库版本已更新，拒绝写入过期密文。');
      }
      const envelopeRemoteRevision = serverConfirmed
        ? requestedRemoteRevision
        : (beforeEnvelope && beforeEnvelope.remoteRevision || 0);
      const envelope = makeScopedVaultEnvelope(
        vaultContext.vaultScopeId,
        vault,
        envelopeRemoteRevision,
        expectedEpoch,
      );
      // Each trusted workspace owns a distinct storage key. Concurrent bridge
      // instances can interleave, but can never replace or expose another
      // scope's ciphertext.
      await chrome.storage.local.set({ [scopedKey]: envelope });
      const latest = await chrome.storage.local.get([
        scopedKey,
        remoteStateKey,
        ACCOUNT_VAULT_SCOPE_KEY,
        ACCOUNT_VAULT_LOCK_EPOCH_KEY,
      ]);
      const latestEpoch = Math.max(0, Number(latest[ACCOUNT_VAULT_LOCK_EPOCH_KEY]) || 0);
      const scopeChanged = validVaultScopeId(latest[ACCOUNT_VAULT_SCOPE_KEY]) !==
        vaultContext.vaultScopeId;
      const latestEnvelope = scopedVaultEnvelope(latest[scopedKey], vaultContext.vaultScopeId);
      const latestRemoteState = vaultRemoteState(
        latest[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      const remoteStateRejected = latestRemoteState && !(
        latestEnvelope && latestEnvelope.remoteRevision > latestRemoteState.revision &&
        latestEnvelope.vaultLockEpoch >= latestRemoteState.vaultLockEpoch
      );
      if (latestEpoch !== expectedEpoch || scopeChanged || !latestEnvelope || remoteStateRejected) {
        // A lock/tombstone may win while this write is in flight. Remove only
        // the ciphertext written by this stale operation; a later writer with
        // a different ciphertext remains untouched.
        if (latestEnvelope && JSON.stringify(latestEnvelope.vault) === JSON.stringify(vault)) {
          await chrome.storage.local.remove(scopedKey);
        }
        throw new Error('账号库已在其他页面锁定，本次保存已停止。');
      }
      return { saved: true, vaultScopeId: vaultContext.vaultScopeId, updatedAt: vault.updatedAt };
    }

    if (action === 'applyAccountVaultTombstone') {
      requireTeamVaultSyncPage();
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const tombstoneRevision = Number(payload && payload.revision);
      if (!Number.isSafeInteger(tombstoneRevision) || tombstoneRevision < 1) {
        throw new Error('云端账号库删除版本无效。');
      }
      const vaultContext = await requireBoundVaultScope();
      if (vaultContext.vaultScopeId !== 'team:https://tbdata.aizicheng.com' ||
          vaultContext.vaultLockEpoch !== expectedEpoch ||
          await currentVaultLockEpoch() !== expectedEpoch) {
        throw new Error('账号库已在其他页面锁定，请重新同步删除标记。');
      }
      const scopedKey = scopedVaultStorageKey(vaultContext.vaultScopeId);
      const remoteStateKey = vaultRemoteStateStorageKey(vaultContext.vaultScopeId);
      const stored = await chrome.storage.local.get([scopedKey, remoteStateKey]);
      const existingRemoteState = vaultRemoteState(
        stored[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      const existingEnvelope = scopedVaultEnvelope(
        stored[scopedKey],
        vaultContext.vaultScopeId,
      );
      if ((existingRemoteState && existingRemoteState.revision > tombstoneRevision) ||
          (existingEnvelope && existingEnvelope.remoteRevision > tombstoneRevision)) {
        return {
          applied: false,
          stale: true,
          revision: Math.max(
            existingRemoteState && existingRemoteState.revision || 0,
            existingEnvelope && existingEnvelope.remoteRevision || 0,
          ),
          vaultScopeId: vaultContext.vaultScopeId,
          vaultLockEpoch: expectedEpoch,
        };
      }
      await chrome.storage.local.set({
        [remoteStateKey]: makeVaultRemoteState(
          vaultContext.vaultScopeId,
          tombstoneRevision,
          expectedEpoch + 1,
        ),
      });
      const beforeLock = await chrome.storage.local.get([remoteStateKey]);
      const beforeLockState = vaultRemoteState(
        beforeLock[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      if (!beforeLockState || !beforeLockState.deleted ||
          beforeLockState.revision !== tombstoneRevision) {
        return {
          applied: false,
          stale: true,
          revision: beforeLockState && beforeLockState.revision || tombstoneRevision,
          vaultScopeId: vaultContext.vaultScopeId,
          vaultLockEpoch: expectedEpoch,
        };
      }
      const lock = await lockAccountVaultSession();
      const afterLock = await chrome.storage.local.get([remoteStateKey]);
      const afterLockState = vaultRemoteState(
        afterLock[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      if (!afterLockState || !afterLockState.deleted ||
          afterLockState.revision !== tombstoneRevision) {
        return {
          applied: false,
          stale: true,
          revision: afterLockState && afterLockState.revision || tombstoneRevision,
          vaultScopeId: vaultContext.vaultScopeId,
          vaultLockEpoch: lock.vaultLockEpoch,
        };
      }
      if (afterLockState.vaultLockEpoch !== lock.vaultLockEpoch) {
        await chrome.storage.local.set({
          [remoteStateKey]: makeVaultRemoteState(
            vaultContext.vaultScopeId,
            tombstoneRevision,
            lock.vaultLockEpoch,
          ),
        });
      }
      await chrome.storage.local.remove(scopedKey);
      return {
        applied: true,
        revision: tombstoneRevision,
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch: lock.vaultLockEpoch,
      };
    }
    if (action === 'setAccountSession') {
      requireAccountManagementPage();
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const vaultContext = await requireBoundVaultScope();
      if (vaultContext.vaultLockEpoch !== expectedEpoch || await currentVaultLockEpoch() !== expectedEpoch) {
        throw new Error('账号库已在其他页面锁定，请重新登录并解锁。');
      }
      const remoteStateKey = vaultRemoteStateStorageKey(vaultContext.vaultScopeId);
      const scopedKey = scopedVaultStorageKey(vaultContext.vaultScopeId);
      const remoteStateStored = await chrome.storage.local.get([remoteStateKey, scopedKey]);
      const remoteState = vaultRemoteState(
        remoteStateStored[remoteStateKey],
        vaultContext.vaultScopeId,
      );
      const activeEnvelope = scopedVaultEnvelope(
        remoteStateStored[scopedKey],
        vaultContext.vaultScopeId,
      );
      if (remoteState && !(activeEnvelope &&
          activeEnvelope.remoteRevision > remoteState.revision &&
          activeEnvelope.vaultLockEpoch >= remoteState.vaultLockEpoch)) {
        throw new Error('团队账号库已删除，不能恢复旧的明文会话。');
      }
      if (!activeEnvelope) throw new Error('未找到当前账号库密文，请重新解锁。');
      const vaultSessionKey = payload && payload.vaultSessionKey
        ? sanitizeVaultSessionKey(payload.vaultSessionKey)
        : '';
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_SET',
        source: 'business-defense-web-tool',
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch: expectedEpoch,
        vaultFingerprint: await encryptedVaultFingerprint(activeEnvelope.vault),
        ...(vaultSessionKey ? { vaultSessionKey } : {}),
        vault: sanitizeAccountSessionVault(payload && payload.vault),
      });
    }
    if (action === 'getAccountManagementSession') {
      requireAccountManagementPage();
      const vaultContext = await requireBoundVaultScope();
      const record = await activeVaultRecord(vaultContext);
      if (!record) {
        return {
          unlocked: false,
          vaultScopeId: vaultContext.vaultScopeId,
          vaultLockEpoch: vaultContext.vaultLockEpoch,
        };
      }
      const response = await runtimeMessage({
        type: 'ACCOUNT_SESSION_GET_MANAGEMENT',
        source: 'business-defense-web-tool',
        expectedVaultScopeId: vaultContext.vaultScopeId,
        expectedVaultFingerprint: await encryptedVaultFingerprint(record),
      });
      if (!response || response.ok === false) {
        throw new Error(response && response.message || '账号库会话恢复失败。');
      }
      const management = response.management && typeof response.management === 'object'
        ? response.management
        : null;
      return management ? {
        unlocked: true,
        vaultScopeId: management.vaultScopeId,
        vaultLockEpoch: management.vaultLockEpoch,
        unlockedAt: management.unlockedAt,
        vault: sanitizeAccountSessionVault(management.vault),
      } : {
        unlocked: false,
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch: Number.isSafeInteger(Number(response.vaultLockEpoch))
          ? Number(response.vaultLockEpoch)
          : vaultContext.vaultLockEpoch,
      };
    }
    if (action === 'encryptAccountVaultFromSession') {
      requireAccountManagementPage();
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const vaultContext = await requireBoundVaultScope();
      if (vaultContext.vaultLockEpoch !== expectedEpoch || await currentVaultLockEpoch() !== expectedEpoch) {
        throw new Error('账号库已在其他页面锁定，请重新登录并解锁。');
      }
      const record = await activeVaultRecord(vaultContext);
      if (!record) throw new Error('未找到当前账号库密文，请重新解锁。');
      const fingerprint = await encryptedVaultFingerprint(record);
      const response = await runtimeMessage({
        type: 'ACCOUNT_SESSION_GET_MANAGEMENT',
        source: 'business-defense-web-tool',
        expectedVaultScopeId: vaultContext.vaultScopeId,
        expectedVaultFingerprint: fingerprint,
      });
      if (!response || response.ok === false || !response.management) {
        throw new Error(response && response.message || '账号库会话已失效，请重新解锁。');
      }
      const encrypted = await encryptVaultWithSessionKey(
        payload && payload.vault,
        record,
        response.management.vaultSessionKey
      );
      return {
        vault: encrypted,
        vaultScopeId: vaultContext.vaultScopeId,
        vaultLockEpoch: expectedEpoch,
        baseFingerprint: fingerprint,
      };
    }
    if (action === 'getAccountSessionSummary') {
      const vaultContext = await requireBoundVaultScope();
      return runtimeMessage({
        type: 'ACCOUNT_SESSION_GET_SUMMARY',
        source: 'business-defense-web-tool',
        expectedVaultScopeId: vaultContext.vaultScopeId,
      });
    }
    if (action === 'clearAccountSession') {
      requireAccountManagementPage();
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
      requireAccountManagementPage();
      const expectedEpoch = requestedVaultLockEpoch(payload && payload.vaultLockEpoch);
      const vaultContext = await requireBoundVaultScope();
      if (vaultContext.vaultLockEpoch !== expectedEpoch || await currentVaultLockEpoch() !== expectedEpoch) {
        throw new Error('账号库已在其他页面锁定，请重新登录并解锁。');
      }
      if (vaultContext.vaultScopeId.startsWith('team:')) {
        throw new Error('在线团队账号库必须先在服务器生成删除标记，不能只清除本机密文。');
      }
      const stored = await chrome.storage.local.get([ACCOUNT_BATCH_STATUS_KEY]);
      const status = stored[ACCOUNT_BATCH_STATUS_KEY];
      if (status && (status.running || status.paused)) {
        throw new Error('请先完成或取消暂停的批量任务，再重置账号库。');
      }
      const lock = await lockAccountVaultSession();
      await chrome.storage.local.remove(scopedVaultStorageKey(vaultContext.vaultScopeId));
      return { cleared: true, vaultLockEpoch: lock.vaultLockEpoch };
    }
    if (action === 'startAccountBatchFromSession') {
      requireOneClickTaskPage();
      const vaultContext = await requireBoundVaultScope();
      return runtimeMessage({
        type: 'ACCOUNT_BATCH_START_FROM_SESSION',
        source: 'business-defense-web-tool',
        payload: sanitizeSessionBatchRequest(payload, vaultContext.vaultScopeId),
      });
    }
    if (action === 'startProjectTask') {
      requireOneClickTaskPage();
      const task = sanitizeProjectTask(payload);
      if (task.credentialMode === 'vault') {
        task.vaultScopeId = (await requireBoundVaultScope()).vaultScopeId;
      }
      return runtimeMessage({
        type: 'PROJECT_TASK_START',
        source: 'business-defense-web-tool',
        payload: task,
      });
    }
    if (action === 'cancelProjectTask') {
      requireInteractiveProjectTaskCancel();
      const taskId = sanitizeProjectTaskId(payload && payload.taskId);
      if (!window.confirm('取消当前登录账号的一键取数任务？已完成的数据会保留，当前步骤将尽快停止。')) {
        return { cancelled: false };
      }
      const response = await runtimeMessage({
        type: 'PROJECT_TASK_CANCEL',
        source: 'business-defense-web-tool',
        taskId,
        confirmedByExtension: true,
      });
      if (!response || response.ok !== true) {
        throw new Error(response && response.message || '当前账号任务取消失败。');
      }
      return response;
    }
    if (action === 'cancelAccountBatch') {
      return runtimeMessage({
        type: 'ACCOUNT_BATCH_CANCEL',
        source: 'business-defense-web-tool',
      });
    }
    if (action === 'testDingTalk') {
      requireAccountManagementPage();
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
        'xhsAnalysisSnapshotV1',
      ]);
      if (stored[ACCOUNT_BATCH_STATUS_KEY] && stored[ACCOUNT_BATCH_STATUS_KEY].running) {
        throw new Error('批量任务执行期间不能切换店铺历史报告。');
      }
      if (stored[PROJECT_TASK_STATUS_KEY] && stored[PROJECT_TASK_STATUS_KEY].running) {
        throw new Error('当前账号任务执行期间不能切换店铺历史记录。');
      }
      const run = stored[STORE_RUN_KEY_PREFIX + runId];
      if (!run || typeof run !== 'object') throw new Error('未找到这条店铺历史归档。');
      if (run.taskType === 'comment_monitor') {
        throw new Error('评论监测归档是独立只读历史，不能恢复为搜索词或经营报告快照。');
      }
      const snapshots = run.snapshots && typeof run.snapshots === 'object' ? run.snapshots : {};
      const restored = {};
      for (const [key, value] of Object.entries(snapshots)) {
        if (isArchiveSnapshotKey(key) && key !== COMMENT_ARCHIVE_SNAPSHOT_KEY) restored[key] = value;
      }
      await chrome.storage.local.remove(Array.from(ARCHIVE_SNAPSHOT_KEYS).concat(
        xhsDetailKeysFromSnapshot(stored.xhsAnalysisSnapshotV1)
      ));
      if (Object.keys(restored).length) await chrome.storage.local.set(restored);
      return { restored: true, runId, storeName: run.account && run.account.storeName || '' };
    }
    throw new Error('网页工具请求不在允许范围内。');
  }

  const COMMENT_MONITOR_WEB_ACTIONS = Object.freeze({
    getState: 'getCommentMonitorState',
    configure: 'configureCommentMonitor',
    runNow: 'runCommentMonitorNow',
    queryComments: 'queryCommentMonitorComments',
    exportRaw: 'exportCommentMonitorRaw',
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (location.pathname === '/comments.html' && message &&
        message.source === 'taobao-full-chain-web-tool' &&
        message.type === 'COMMENT_MONITOR_REQUEST' && message.requestId) {
      const commentAction = COMMENT_MONITOR_WEB_ACTIONS[message.action];
      if (!commentAction) return;
      Promise.resolve(handleRequest(commentAction, message.payload || {})).then((payload) => {
        window.postMessage({
          source: 'taobao-full-chain-web-tool', type: 'COMMENT_MONITOR_RESPONSE',
          requestId: message.requestId, ok: true, payload,
        }, location.origin);
      }).catch((error) => {
        window.postMessage({
          source: 'taobao-full-chain-web-tool', type: 'COMMENT_MONITOR_RESPONSE',
          requestId: message.requestId, ok: false,
          error: { message: error && error.message ? error.message : String(error) },
        }, location.origin);
      });
      return;
    }
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
    const keys = Object.keys(changes || {}).filter((key) => isReadableStorageKey(key));
    const currentScopedKey = scopedVaultStorageKey(currentVaultScopeId());
    const currentRemoteStateKey = vaultRemoteStateStorageKey(currentVaultScopeId());
    if (Object.prototype.hasOwnProperty.call(changes || {}, currentScopedKey) &&
        !keys.includes(ACCOUNT_VAULT_KEY)) {
      keys.push(ACCOUNT_VAULT_KEY);
    }
    if (Object.prototype.hasOwnProperty.call(changes || {}, currentRemoteStateKey) &&
        !keys.includes(ACCOUNT_VAULT_KEY)) {
      keys.push(ACCOUNT_VAULT_KEY);
    }
    if (keys.length) post({ type: 'storageChanged', keys });
  });

  if (autoLockPage) {
    // Login is the final fail-safe for logout/401 paths whose original page
    // disappeared before the runtime lock acknowledgement arrived.
    lockAccountVaultSession().catch(() => {});
  }
  post({ type: 'ready', connected: true });
})();
