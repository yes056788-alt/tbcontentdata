(function () {
  'use strict';

  const CHANNEL = 'taobao-full-chain-tool-v1';
  const VAULT_KEY = 'taobaoAccountVaultV1';
  const PROJECT_DIRECTORY_KEY = 'taobaoProjectDirectoryV1';
  const pendingRequests = new Map();
  const $ = (selector) => document.querySelector(selector);

  let connected = false;
  let encryptedVault = null;
  let masterPassword = '';
  let vaultData = null;
  let vaultSessionResumed = false;
  let vaultSaveQueue = Promise.resolve();
  let vaultClearing = false;
  let vaultLockEpoch = 0;
  let vaultAccessGeneration = 0;
  let legacyRecoveryAvailable = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function id(prefix) {
    return prefix + '-' + (crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeAccountPlatform(value, allowLegacyDefault) {
    if (value === 'taobao' || value === 'xiaohongshu') return value;
    return allowLegacyDefault && (value === undefined || value === null || value === '') ? 'taobao' : '';
  }

  function accountPlatformLabel(value) {
    return normalizeAccountPlatform(value) === 'xiaohongshu' ? '小红书' : '淘宝';
  }

  function maskUsername(value) {
    const text = String(value || '');
    if (text.length <= 2) return text ? text[0] + '*' : '-';
    return text.slice(0, 2) + '*'.repeat(Math.min(5, text.length - 2)) + text.slice(-1);
  }

  function setNotice(message, tone) {
    $('#pageNotice').textContent = message || '';
    $('#pageNotice').dataset.tone = tone || '';
  }

  function setConnection(ok, version) {
    connected = Boolean(ok);
    const state = $('#connectionState');
    state.className = 'connection-state ' + (ok ? 'connected' : 'disconnected');
    state.textContent = ok ? '数据助手已连接' : '数据助手未连接';
    $('#extensionVersion').textContent = version ? 'v' + version : '';
  }

  function request(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const requestId = 'account-page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('数据助手响应超时，请确认扩展已重新加载。'));
      }, Number(timeoutMs) || 30000);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({ channel: CHANNEL, type: 'request', requestId, action, payload: payload || {} }, location.origin);
    });
  }

  function defaultVault() {
    return {
      schema: 4,
      accountGroups: [],
      storeGroups: [],
      stores: [],
      accounts: [],
      notification: { webhook: '', secret: '' },
      updatedAt: nowIso(),
    };
  }

  function cleanGroup(value) {
    return {
      id: String(value && value.id || id('group')).slice(0, 100),
      name: String(value && value.name || '').trim().slice(0, 40),
    };
  }

  function classificationText(value, maxLength) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim().slice(0, maxLength)
      : '';
  }

  function classificationInteger(value, maxValue) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return Math.min(parsed, maxValue == null ? Number.MAX_SAFE_INTEGER : maxValue);
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
    const topicTagsExplicit = Array.isArray(patch.topicTagIds);
    const entityRelation = classificationText(
      patch.entityRelation == null ? old.commercialCategory : patch.entityRelation,
      80
    );
    const topicTagId = highestPriorityClassificationTerm(
      patch.topicTagIds == null ? old.topicTagIds : patch.topicTagIds,
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
      topicTagIds.length || topicTagsExplicit ? { topicTagIds } : {},
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
    const overrideId = classificationText(
      item.id || keywordKey || normalizedKeyword || keyword,
      96
    );
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

  function needsVaultMigration(value) {
    const source = value && typeof value === 'object' ? value : {};
    if (Number(source.schema) !== 4 || !Array.isArray(source.stores)) return true;
    if (source.stores.some((store) => !store || !store.credentialBindings)) return true;
    return (Array.isArray(source.accounts) ? source.accounts : []).some((account) => (
      !account || !account.storeId || !['taobao', 'xiaohongshu'].includes(account.platform) || !account.label
    ));
  }

  function credentialBindingKey(platform) {
    return platform === 'xiaohongshu' ? 'xiaohongshuAccountId' : 'taobaoAccountId';
  }

  function defaultAccountLabel(platform) {
    return platform === 'xiaohongshu' ? '小红书账号' : '淘宝账号';
  }

  function safeAccountLabel(item, platform) {
    const username = String(item && item.username || '').trim();
    const label = String(item && (item.label || item.name) || '').trim().slice(0, 80);
    return label && label !== username && !label.includes(username)
      ? label
      : defaultAccountLabel(platform);
  }

  function reconcileCredentialBindings(stores, accounts, inferUnique) {
    const values = Array.isArray(accounts) ? accounts : [];
    (Array.isArray(stores) ? stores : []).forEach((store) => {
      const bindings = store.credentialBindings && typeof store.credentialBindings === 'object'
        ? store.credentialBindings
        : {};
      const next = { taobaoAccountId: '', xiaohongshuAccountId: '' };
      ['taobao', 'xiaohongshu'].forEach((platform) => {
        const key = credentialBindingKey(platform);
        const candidates = values.filter((account) => (
          account.storeId === store.id && account.platform === platform && account.enabled !== false
        ));
        const requested = String(bindings[key] || '');
        if (requested && candidates.some((account) => account.id === requested)) next[key] = requested;
        else if (inferUnique && candidates.length === 1) next[key] = candidates[0].id;
      });
      store.credentialBindings = next;
    });
  }

  function normalizeVault(value) {
    const source = value && typeof value === 'object' ? value : {};
    const sourceSchema = Number(source.schema) || 1;
    const accountGroups = (Array.isArray(source.accountGroups) ? source.accountGroups : [])
      .map(cleanGroup).filter((item) => item.name);
    const storeGroups = (Array.isArray(source.storeGroups) ? source.storeGroups : [])
      .map(cleanGroup).filter((item) => item.name);
    const accountGroupIds = new Set(accountGroups.map((item) => item.id));
    const storeGroupIds = new Set(storeGroups.map((item) => item.id));
    const stores = [];
    const storeIds = new Set();
    const storeKeys = new Map();

    (Array.isArray(source.stores) ? source.stores : []).slice(0, 500).forEach((value) => {
      const item = value && typeof value === 'object' ? value : {};
      const name = String(item.name || '').trim().slice(0, 80);
      if (!name) return;
      let storeId = String(item.id || id('store')).slice(0, 100);
      if (storeIds.has(storeId)) storeId = id('store');
      const store = {
        id: storeId,
        name,
        groupId: storeGroupIds.has(item.groupId) ? item.groupId : '',
        credentialBindings: {
          taobaoAccountId: String(item.credentialBindings && item.credentialBindings.taobaoAccountId || '').slice(0, 100),
          xiaohongshuAccountId: String(item.credentialBindings && item.credentialBindings.xiaohongshuAccountId || '').slice(0, 100),
        },
        createdAt: String(item.createdAt || nowIso()),
        updatedAt: String(item.updatedAt || nowIso()),
      };
      stores.push(store);
      storeIds.add(store.id);
      storeKeys.set(name.toLowerCase(), store.id);
    });

    function ensureLegacyStore(nameValue, groupValue) {
      const name = String(nameValue || '').trim().slice(0, 80);
      if (!name) return '';
      const groupId = storeGroupIds.has(groupValue) ? groupValue : '';
      const key = name.toLowerCase();
      if (storeKeys.has(key)) {
        const existing = stores.find((store) => store.id === storeKeys.get(key));
        if (existing && !existing.groupId && groupId) existing.groupId = groupId;
        return storeKeys.get(key);
      }
      const store = {
        id: id('store'), name, groupId,
        credentialBindings: { taobaoAccountId: '', xiaohongshuAccountId: '' },
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      stores.push(store);
      storeIds.add(store.id);
      storeKeys.set(key, store.id);
      return store.id;
    }

    const accountIds = new Set();
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 500).map((value) => {
      const item = value && typeof value === 'object' ? value : {};
      let accountId = String(item.id || id('account')).slice(0, 100);
      if (accountIds.has(accountId)) accountId = id('account');
      const storeId = storeIds.has(item.storeId)
        ? item.storeId
        : ensureLegacyStore(item.storeName || item.shopName, item.storeGroupId);
      const platform = normalizeAccountPlatform(item.platform, sourceSchema < 3);
      if (!platform) return null;
      const account = {
        id: accountId,
        label: safeAccountLabel(item, platform),
        name: safeAccountLabel(item, platform),
        platform,
        storeId,
        username: String(item.username || '').trim().slice(0, 160),
        password: String(item.password || '').slice(0, 240),
        accountGroupId: accountGroupIds.has(item.accountGroupId) ? item.accountGroupId : '',
        roleKeyword: platform === 'taobao'
          ? (String(item.roleKeyword || '品牌').trim().slice(0, 50) || '品牌')
          : '',
        enabled: item.enabled !== false,
        createdAt: String(item.createdAt || nowIso()),
        updatedAt: String(item.updatedAt || nowIso()),
      };
      accountIds.add(account.id);
      return account;
    }).filter((item) => item && item.storeId && item.username && item.password);

    reconcileCredentialBindings(stores, accounts, sourceSchema < 4);

    return {
      schema: 4,
      accountGroups,
      storeGroups,
      stores,
      accounts,
      notification: {
        webhook: String(source.notification && source.notification.webhook || '').trim().slice(0, 900),
        secret: String(source.notification && source.notification.secret || '').trim().slice(0, 300),
      },
      updatedAt: String(source.updatedAt || nowIso()),
    };
  }

  function syncProjectDirectory(snapshot) {
    return request('getStorage', { keys: [PROJECT_DIRECTORY_KEY] }, 30000).then((stored) => {
      const currentDirectory = stored && stored[PROJECT_DIRECTORY_KEY] &&
        typeof stored[PROJECT_DIRECTORY_KEY] === 'object'
        ? stored[PROJECT_DIRECTORY_KEY]
        : {};
      const classificationByStoreId = new Map();
      (Array.isArray(currentDirectory.stores) ? currentDirectory.stores : []).forEach((store) => {
        const storeId = classificationText(store && store.id, 100);
        const classification = sanitizeStoreClassification(store && store.classification);
        if (storeId && classification) classificationByStoreId.set(storeId, classification);
      });
      const stores = (Array.isArray(snapshot.stores) ? snapshot.stores : []).map((store) => {
        const classification = classificationByStoreId.get(String(store && store.id || ''));
        return Object.assign({
          id: String(store && store.id || '').slice(0, 100),
          name: String(store && store.name || '').trim().slice(0, 120),
          groupId: String(store && store.groupId || '').slice(0, 100),
          createdAt: String(store && store.createdAt || '').slice(0, 80),
          updatedAt: String(store && store.updatedAt || '').slice(0, 80),
        }, classification ? { classification } : {});
      });
      return request('setProjectDirectory', {
        directory: {
          schema: 1,
          storeGroups: snapshot.storeGroups,
          stores,
          updatedAt: Date.now(),
        },
      }, 45000);
    });
  }

  async function syncAccountSession(snapshot, sessionKey) {
    const response = await request('setAccountSession', {
      vault: snapshot,
      vaultLockEpoch,
      ...(sessionKey ? { vaultSessionKey: sessionKey } : {}),
    }, 45000);
    if (!response || response.ok === false) {
      throw new Error(response && response.message || '账号库会话同步失败。');
    }
    return response;
  }

  function assertVaultAccessGeneration(generation) {
    if (generation !== vaultAccessGeneration || !vaultData ||
        (!masterPassword && !vaultSessionResumed)) {
      throw new Error('账号库已锁定或会话已失效，请重新解锁。');
    }
  }

  function invalidateVaultAccess(message) {
    vaultAccessGeneration += 1;
    vaultClearing = true;
    showLocked();
    if (message) setNotice(message, 'error');
  }

  function saveVault(message) {
    if (vaultClearing) {
      return Promise.reject(new Error('账号库正在锁定或重置，请稍后重试。'));
    }
    vaultData.updatedAt = nowIso();
    const snapshot = JSON.parse(JSON.stringify(vaultData));
    const password = masterPassword;
    const generation = vaultAccessGeneration;
    const task = vaultSaveQueue.then(async () => {
      assertVaultAccessGeneration(generation);
      let record;
      let sessionKey = '';
      if (password) {
        const prepared = await window.TaobaoAccountVault.encryptForSession(snapshot, password);
        record = prepared.record;
        sessionKey = prepared.sessionKey;
      } else {
        const prepared = await request('encryptAccountVaultFromSession', {
          vault: snapshot,
          vaultLockEpoch,
        }, 45000);
        record = prepared && prepared.vault;
        if (!record) throw new Error('账号库会话加密失败，请重新解锁。');
      }
      assertVaultAccessGeneration(generation);
      await request('setAccountVault', { vault: record, vaultLockEpoch }, 45000);
      assertVaultAccessGeneration(generation);
      await syncProjectDirectory(snapshot);
      assertVaultAccessGeneration(generation);
      await syncAccountSession(snapshot, sessionKey);
      assertVaultAccessGeneration(generation);
      encryptedVault = record;
      vaultSessionResumed = true;
      if (message) setNotice(message, 'success');
    });
    vaultSaveQueue = task.catch(() => {});
    return task;
  }

  function currentTeamCloudState() {
    const cloud = window.TaobaoCloudSync;
    if (!cloud || typeof cloud.getState !== 'function') return null;
    const cloudState = cloud.getState();
    return cloudState && cloudState.connected === true &&
      String(cloudState.vaultScopeId || '').startsWith('team:')
      ? cloudState
      : null;
  }

  function recreateDeletedTeamVault(message) {
    const cloud = window.TaobaoCloudSync;
    const cloudState = currentTeamCloudState();
    if (!cloudState || cloudState.remoteVaultDeleted !== true ||
        typeof cloud.recreateAccountVault !== 'function') {
      return Promise.reject(new Error('团队账号库删除状态尚未同步，请刷新页面后重试。'));
    }
    if (vaultClearing) {
      return Promise.reject(new Error('账号库正在锁定或重置，请稍后重试。'));
    }
    vaultData.updatedAt = nowIso();
    const snapshot = JSON.parse(JSON.stringify(vaultData));
    const password = masterPassword;
    const generation = vaultAccessGeneration;
    const task = vaultSaveQueue.then(async () => {
      assertVaultAccessGeneration(generation);
      if (!password) throw new Error('重新创建团队账号库前请验证主密码。');
      const prepared = await window.TaobaoAccountVault.encryptForSession(snapshot, password);
      const record = prepared.record;
      assertVaultAccessGeneration(generation);
      const result = await cloud.recreateAccountVault(record);
      assertVaultAccessGeneration(generation);
      const nextEpoch = Number(result && result.vaultLockEpoch);
      if (Number.isSafeInteger(nextEpoch) && nextEpoch >= 0) vaultLockEpoch = nextEpoch;
      await syncProjectDirectory(snapshot);
      assertVaultAccessGeneration(generation);
      await syncAccountSession(snapshot, prepared.sessionKey);
      assertVaultAccessGeneration(generation);
      encryptedVault = record;
      vaultSessionResumed = true;
      if (message) setNotice(message, 'success');
    });
    vaultSaveQueue = task.catch(() => {});
    return task;
  }

  function storeById(storeId) {
    return vaultData && vaultData.stores.find((store) => store.id === storeId) || null;
  }

  function storeForAccount(account) {
    return account ? storeById(account.storeId) : null;
  }

  function isDefaultCredential(account, store) {
    if (!account || !store) return false;
    const bindings = store.credentialBindings || {};
    return bindings[credentialBindingKey(account.platform)] === account.id;
  }

  function groupName(groupId) {
    const group = vaultData.storeGroups.find((item) => item.id === groupId);
    return group ? group.name : '未分组';
  }

  function fillStoreGroupSelect(select, selectedId, includeAll) {
    const leading = includeAll
      ? '<option value="__all__">全部店铺分组</option><option value="__ungrouped__">未分组</option>'
      : '<option value="">未分组</option>';
    select.innerHTML = leading + vaultData.storeGroups.map((group) => (
      '<option value="' + escapeHtml(group.id) + '">' + escapeHtml(group.name) + '</option>'
    )).join('');
    const wanted = selectedId || (includeAll ? '__all__' : '');
    select.value = Array.from(select.options).some((option) => option.value === wanted) ? wanted : select.options[0].value;
  }

  function accountMatchesFilter(account) {
    const store = storeForAccount(account);
    const query = String($('#accountSearch').value || '').trim().toLowerCase();
    const groupId = $('#storeGroupFilter').value;
    const groupMatches = groupId === '__all__' ||
      (groupId === '__ungrouped__' ? !(store && store.groupId) : Boolean(store && store.groupId === groupId));
    const queryMatches = !query || [store && store.name, account.username, accountPlatformLabel(account.platform)]
      .some((value) => String(value || '').toLowerCase().includes(query));
    return groupMatches && queryMatches;
  }

  function renderGroups() {
    $('#storeGroupCount').textContent = vaultData.storeGroups.length + ' 个';
    const activeFilter = $('#storeGroupFilter').value || '__all__';
    const rows = [{ id: '__all__', name: '全部账号' }]
      .concat(vaultData.storeGroups)
      .concat([{ id: '__ungrouped__', name: '未分组' }]);
    $('#storeGroupList').innerHTML = rows.map((group) => {
      const storeIds = group.id === '__all__'
        ? new Set(vaultData.stores.map((store) => store.id))
        : new Set(vaultData.stores.filter((store) => (
          group.id === '__ungrouped__' ? !store.groupId : store.groupId === group.id
        )).map((store) => store.id));
      const accountCount = vaultData.accounts.filter((account) => storeIds.has(account.storeId)).length;
      const addAccount = group.id === '__all__' ? '' : '<button class="group-add-account" type="button" title="新增账号" aria-label="在' +
        escapeHtml(group.name) + '新增账号" data-add-account-group="' + escapeHtml(group.id) + '">+</button>';
      const actions = group.id === '__all__' || group.id === '__ungrouped__' ? '' : '<span class="group-row-actions">' +
        '<button type="button" data-group-action="rename" data-group-id="' + escapeHtml(group.id) + '">重命名</button>' +
        '<button class="danger" type="button" data-group-action="delete" data-group-id="' + escapeHtml(group.id) + '">删除</button></span>';
      return '<div class="group-list-row' + (activeFilter === group.id ? ' active' : '') + '">' +
        '<button class="group-filter-button" type="button" data-group-filter="' + escapeHtml(group.id) + '"><span>' + escapeHtml(group.name) + '</span><b>' + accountCount + '</b></button>' +
        addAccount + actions + '</div>';
    }).join('');
  }

  function renderAccounts() {
    const accounts = vaultData.accounts.filter(accountMatchesFilter);
    const taobaoCount = vaultData.accounts.filter((account) => normalizeAccountPlatform(account.platform) === 'taobao').length;
    const xiaohongshuCount = vaultData.accounts.length - taobaoCount;
    const enabledCount = vaultData.accounts.filter((account) => account.enabled).length;
    $('#accountCount').textContent = vaultData.accounts.length + ' 个账号 · 淘宝 ' + taobaoCount +
      ' · 小红书 ' + xiaohongshuCount + ' · 一键登录启用 ' + enabledCount;
    $('#accountFilterSummary').textContent = '显示 ' + accounts.length + ' / ' + vaultData.accounts.length;
    $('#accountRows').innerHTML = accounts.length ? accounts.map((account) => {
      const store = storeForAccount(account);
      const platform = normalizeAccountPlatform(account.platform);
      const status = account.enabled
        ? (isDefaultCredential(account, store) ? '默认登录' : '已启用')
        : '停用';
      const statusTone = account.enabled && isDefaultCredential(account, store) ? 'success' : 'empty';
      return '<tr><td><span class="account-platform-badge is-' + escapeHtml(platform) + '">' +
        escapeHtml(accountPlatformLabel(platform)) + '</span></td><td><strong>' + escapeHtml(store && store.name || '-') + '</strong></td>' +
        '<td>' + escapeHtml(maskUsername(account.username)) + '</td>' +
        '<td>' + escapeHtml(groupName(store && store.groupId)) + '</td><td>' +
        escapeHtml(platform === 'taobao' ? account.roleKeyword : '-') + '</td>' +
        '<td><span class="status-badge ' + statusTone + '">' + status + '</span></td>' +
        '<td><div class="row-actions"><button class="row-action" type="button" data-account-action="edit" data-account-id="' + escapeHtml(account.id) + '">编辑</button>' +
        '<button class="row-action danger" type="button" data-account-action="delete" data-account-id="' + escapeHtml(account.id) + '">删除</button></div></td></tr>';
    }).join('') : '<tr><td class="empty-cell" colspan="7">当前分组暂无账号</td></tr>';
  }

  function renderAll() {
    if (!vaultData) return;
    const filter = $('#storeGroupFilter').value || '__all__';
    fillStoreGroupSelect($('#storeGroupFilter'), filter, true);
    $('#knownStoreNames').innerHTML = vaultData.stores.map((store) => '<option value="' + escapeHtml(store.name) + '"></option>').join('');
    $('#dingWebhook').value = vaultData.notification.webhook;
    $('#dingSecret').value = vaultData.notification.secret;
    renderGroups();
    renderAccounts();
  }

  function setVaultGateMode() {
    const recovering = !encryptedVault && legacyRecoveryAvailable;
    const creating = !encryptedVault && !recovering;
    $('#vaultTitle').textContent = recovering
      ? '迁移升级前本机账号库'
      : (creating ? '创建账号库' : '解锁账号库');
    $('#vaultCopy').textContent = recovering
      ? '已发现旧版插件保留的本机密文。输入旧主密码验证后，系统会再次请你确认，再安全迁移到当前团队；不会上传主密码或明文。'
      : (creating
        ? '设置团队主密码后，账号信息只以密文同步；在其他电脑登录同一团队后，输入该主密码即可使用。'
        : '输入主密码管理账号与店铺分组。');
    $('#confirmPasswordRow').hidden = !creating;
    $('#confirmPassword').required = creating;
    $('#unlockVaultBtn').textContent = recovering ? '验证并迁移' : (creating ? '创建并解锁' : '解锁');
    $('#resetVaultBtn').hidden = creating || recovering;
  }

  function canRecoverLegacyVault(binding) {
    if (!binding || binding.legacyAvailable !== true ||
        binding.vaultScopeId !== 'team:https://tbdata.aizicheng.com') return false;
    const cloud = window.TaobaoCloudSync;
    if (!cloud || typeof cloud.getState !== 'function' ||
        typeof cloud.migrateLegacyAccountVault !== 'function') return false;
    const cloudState = cloud.getState();
    return Boolean(cloudState && cloudState.connected === true &&
      cloudState.legacyAvailable === true &&
      cloudState.permissions && cloudState.permissions.canWriteVault === true &&
      cloudState.remoteVaultExists === false &&
      Number(cloudState.remoteVaultRevision) === 0 &&
      cloudState.remoteVaultDeleted !== true);
  }

  function showLocked() {
    masterPassword = '';
    vaultData = null;
    vaultSessionResumed = false;
    $('#vaultForm').reset();
    $('#vaultGate').hidden = false;
    $('#vaultWorkspace').hidden = true;
    $('#lockVaultBtn').hidden = true;
    if ($('#accountDialog').open) $('#accountDialog').close();
    setVaultGateMode();
  }

  function showWorkspace() {
    $('#vaultForm').reset();
    $('#vaultGate').hidden = true;
    $('#vaultWorkspace').hidden = false;
    $('#lockVaultBtn').hidden = false;
    renderAll();
  }

  function syncAccountPlatformFields() {
    const isTaobao = normalizeAccountPlatform($('#accountPlatform').value) === 'taobao';
    $('#roleKeywordField').hidden = !isTaobao;
    $('#accountEnabledField').hidden = false;
    $('#accountEnabledLabel').textContent = isTaobao
      ? '用于一键登录并参与淘宝批量任务'
      : '用于蒲公英与聚光一键登录';
    $('#defaultCredentialLabel').textContent = isTaobao
      ? '设为该店铺淘宝默认登录账号（星河及淘宝平台）'
      : '设为该店铺小红书默认登录账号（蒲公英 + 聚光共用）';
    $('#loginUsername').placeholder = isTaobao ? '淘宝账号 / 手机号' : '小红书登录邮箱';
    $('#accountDialogTitle').textContent = ($('#accountId').value ? '编辑' : '新增') +
      accountPlatformLabel($('#accountPlatform').value) + '账号';
  }

  function openAccountDialog(account, requestedGroupId) {
    const value = account || null;
    const store = value ? storeForAccount(value) : null;
    const groupId = value
      ? store && store.groupId
      : requestedGroupId === '__ungrouped__' ? '' : requestedGroupId || '';
    const groupStores = value ? [] : vaultData.stores.filter((item) => item.groupId === groupId);
    $('#accountId').value = value ? value.id : '';
    $('#accountPlatform').value = value ? normalizeAccountPlatform(value.platform) : 'taobao';
    $('#accountStoreName').value = store ? store.name : groupStores.length === 1 ? groupStores[0].name : '';
    $('#loginLabel').value = value ? value.label || value.name || '' : '';
    $('#loginUsername').value = value ? value.username : '';
    $('#loginPassword').value = value ? value.password : '';
    $('#roleKeyword').value = value ? value.roleKeyword : '品牌';
    $('#accountEnabled').checked = value ? value.enabled : true;
    $('#defaultCredential').checked = value ? isDefaultCredential(value, store) : true;
    $('#showAccountPassword').checked = false;
    $('#loginPassword').type = 'password';
    fillStoreGroupSelect($('#accountStoreGroupSelect'), groupId, false);
    syncAccountPlatformFields();
    $('#accountDialog').showModal();
    $('#accountStoreName').focus();
  }

  function closeAccountDialog() {
    if ($('#accountDialog').open) $('#accountDialog').close();
    $('#accountForm').reset();
  }

  function resolveStoreForAccount(existingAccount, name, groupId) {
    const normalized = name.toLowerCase();
    const matching = vaultData.stores.find((store) => store.name.toLowerCase() === normalized);
    if (matching) {
      matching.groupId = groupId;
      matching.updatedAt = nowIso();
      return matching;
    }
    const current = existingAccount && storeById(existingAccount.storeId);
    const currentAccountCount = current
      ? vaultData.accounts.filter((account) => account.storeId === current.id).length
      : 0;
    if (current && currentAccountCount <= 1) {
      current.name = name;
      current.groupId = groupId;
      current.updatedAt = nowIso();
      return current;
    }
    const store = {
      id: id('store'), name, groupId,
      credentialBindings: { taobaoAccountId: '', xiaohongshuAccountId: '' },
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    vaultData.stores.push(store);
    return store;
  }

  async function saveAccount() {
    const accountId = $('#accountId').value;
    const existing = vaultData.accounts.find((account) => account.id === accountId) || null;
    const storeName = $('#accountStoreName').value.trim().slice(0, 80);
    const groupId = $('#accountStoreGroupSelect').value;
    const platform = normalizeAccountPlatform($('#accountPlatform').value);
    if (!platform) throw new Error('账号平台无效。');
    const label = $('#loginLabel').value.trim().slice(0, 80) || defaultAccountLabel(platform);
    const username = $('#loginUsername').value.trim().slice(0, 160);
    const password = $('#loginPassword').value.slice(0, 240);
    if (!storeName || !username || !password) throw new Error('请填写完整的店铺、登录账号和密码。');
    const store = resolveStoreForAccount(existing, storeName, groupId);
    const previousStoreId = existing && existing.storeId;
    const previousPlatform = existing && existing.platform;
    const value = {
      id: existing ? existing.id : id('account'),
      storeId: store.id,
      label,
      name: label,
      platform,
      username,
      password,
      accountGroupId: existing ? existing.accountGroupId : '',
      roleKeyword: platform === 'taobao' ? ($('#roleKeyword').value.trim().slice(0, 50) || '品牌') : '',
      enabled: $('#accountEnabled').checked,
      createdAt: existing ? existing.createdAt : nowIso(),
      updatedAt: nowIso(),
    };
    if (existing && previousStoreId) {
      const previousStore = storeById(previousStoreId);
      const previousKey = credentialBindingKey(previousPlatform);
      if (previousStore && previousStore.credentialBindings && previousStore.credentialBindings[previousKey] === existing.id) {
        previousStore.credentialBindings[previousKey] = '';
      }
    }
    if (existing) Object.assign(existing, value);
    else vaultData.accounts.push(value);
    reconcileCredentialBindings(vaultData.stores, vaultData.accounts, false);
    const key = credentialBindingKey(platform);
    store.credentialBindings = store.credentialBindings || { taobaoAccountId: '', xiaohongshuAccountId: '' };
    if ($('#defaultCredential').checked && value.enabled) store.credentialBindings[key] = value.id;
    else if (store.credentialBindings[key] === value.id) store.credentialBindings[key] = '';
    await saveVault(existing ? '账号已更新。' : '账号已新增。');
    closeAccountDialog();
    renderAll();
  }

  async function addGroup(nameValue) {
    const name = String(nameValue || '').trim().slice(0, 40);
    if (!name) throw new Error('请输入分组名称。');
    if (vaultData.storeGroups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('同名分组已存在。');
    }
    vaultData.storeGroups.push({ id: id('store-group'), name });
    await saveVault('店铺分组已新增。');
    renderAll();
  }

  async function handleGroupAction(button) {
    const group = vaultData.storeGroups.find((item) => item.id === button.dataset.groupId);
    if (!group) return;
    if (button.dataset.groupAction === 'rename') {
      const name = window.prompt('修改分组名称', group.name);
      if (name == null) return;
      const nextName = name.trim().slice(0, 40);
      if (!nextName) throw new Error('分组名称不能为空。');
      if (vaultData.storeGroups.some((item) => item.id !== group.id && item.name.toLowerCase() === nextName.toLowerCase())) {
        throw new Error('同名分组已存在。');
      }
      group.name = nextName;
      await saveVault('分组名称已更新。');
    } else {
      if (!window.confirm('删除“' + group.name + '”分组？组内账号会转为未分组，账号不会删除。')) return;
      vaultData.storeGroups = vaultData.storeGroups.filter((item) => item.id !== group.id);
      vaultData.stores.forEach((store) => { if (store.groupId === group.id) store.groupId = ''; });
      if ($('#storeGroupFilter').value === group.id) $('#storeGroupFilter').value = '__all__';
      await saveVault('分组已删除，原账号已转为未分组。');
    }
    renderAll();
  }

  async function handleAccountAction(button) {
    const account = vaultData.accounts.find((item) => item.id === button.dataset.accountId);
    if (!account) return;
    if (button.dataset.accountAction === 'edit') {
      openAccountDialog(account);
      return;
    }
    if (!window.confirm('删除' + accountPlatformLabel(account.platform) + '账号“' + account.username + '”？店铺项目与历史记录会保留。')) return;
    vaultData.accounts = vaultData.accounts.filter((item) => item.id !== account.id);
    reconcileCredentialBindings(vaultData.stores, vaultData.accounts, false);
    await saveVault('账号已删除。');
    renderAll();
  }

  async function connect() {
    try {
      const response = await request('ping', {}, 5000);
      setConnection(Boolean(response && response.connected), response && response.version);
      const binding = await request('bindAccountVaultScope', {}, 30000);
      const nextEpoch = Number(binding && binding.vaultLockEpoch);
      if (!binding || !binding.vaultScopeId || !Number.isSafeInteger(nextEpoch) || nextEpoch < 0) {
        throw new Error('账号库工作区绑定失败，请刷新页面后重试。');
      }
      vaultLockEpoch = nextEpoch;
      vaultAccessGeneration += 1;
      vaultClearing = false;
      const generation = vaultAccessGeneration;
      const stored = await request('getStorage', { keys: [VAULT_KEY, PROJECT_DIRECTORY_KEY] });
      if (generation !== vaultAccessGeneration || vaultClearing) return;
      encryptedVault = stored && stored[VAULT_KEY] || null;
      legacyRecoveryAvailable = !encryptedVault && canRecoverLegacyVault(binding);
      if (encryptedVault) {
        try {
          const management = await request('getAccountManagementSession', {}, 30000);
          const managementEpoch = Number(management && management.vaultLockEpoch);
          if (Number.isSafeInteger(managementEpoch) && managementEpoch >= 0) {
            vaultLockEpoch = managementEpoch;
          }
          if (generation !== vaultAccessGeneration || vaultClearing) return;
          if (management && management.unlocked === true && management.vault) {
            masterPassword = '';
            vaultData = normalizeVault(management.vault);
            vaultSessionResumed = true;
            setNotice('已恢复本次 Chrome 会话的账号库。', 'success');
            showWorkspace();
            return;
          }
        } catch (error) {}
      }
      setVaultGateMode();
    } catch (error) {
      setConnection(false, '');
      setNotice('未连接到扩展数据助手，请在 chrome://extensions 重新加载扩展后刷新网页。', 'error');
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === 'response' && pendingRequests.has(message.requestId)) {
      const pending = pendingRequests.get(message.requestId);
      pendingRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.message || '数据助手请求失败。'));
      return;
    }
    if (message.type === 'ready') setConnection(true, message.version);
  });

  window.addEventListener('taobao-cloud-sync', (event) => {
    const detail = event && event.detail || {};
    if (detail.type !== 'vault-locked' && detail.type !== 'vault-tombstoned') return;
    const nextEpoch = Number(detail.vaultLockEpoch);
    if (Number.isSafeInteger(nextEpoch) && nextEpoch >= 0) vaultLockEpoch = nextEpoch;
    if (detail.type === 'vault-tombstoned') {
      encryptedVault = null;
      legacyRecoveryAvailable = false;
      invalidateVaultAccess('团队账号库已重置，本机密文与明文会话已清除。');
      vaultClearing = false;
      setVaultGateMode();
      return;
    }
    invalidateVaultAccess('云端会话已失效，账号库已锁定，请重新登录并解锁。');
  });

  $('#vaultForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#masterPassword').value;
    vaultAccessGeneration += 1;
    vaultClearing = false;
    try {
      if (legacyRecoveryAvailable && !encryptedVault) {
        const prepared = await request('getLegacyAccountVault', {}, 30000);
        if (!prepared || prepared.legacyAvailable !== true || !prepared.legacyVault ||
            !/^[a-f0-9]{64}$/i.test(String(prepared.fingerprint || '')) ||
            Number(prepared.vaultLockEpoch) !== vaultLockEpoch) {
          throw new Error('升级前本机账号库已变化，请刷新页面后重试。');
        }
        const opened = await window.TaobaoAccountVault.open(prepared.legacyVault, password);
        const migratedSchema = needsVaultMigration(opened.value);
        const normalized = normalizeVault(opened.value);
        if (!window.confirm('旧主密码已验证。确认将这份升级前本机账号库迁移到当前团队密码库？')) {
          setNotice('已取消迁移，旧账号库密文仍保留在本机。');
          return;
        }
        const result = await window.TaobaoCloudSync.migrateLegacyAccountVault({
          fingerprint: prepared.fingerprint,
          vaultLockEpoch,
        });
        if (!result || result.migrated !== true) {
          const latest = await request('getStorage', { keys: [VAULT_KEY] }, 30000);
          encryptedVault = latest && latest[VAULT_KEY] || null;
          legacyRecoveryAvailable = false;
          setVaultGateMode();
          if (encryptedVault) {
            setNotice('云端已有团队账号库，已下载最新密文；升级前本机密文仍保留。请输入团队主密码解锁。', 'error');
            return;
          }
          throw new Error('云端账号库状态已变化，旧密文已保留，请刷新后重试。');
        }
        encryptedVault = prepared.legacyVault;
        legacyRecoveryAvailable = false;
        masterPassword = password;
        vaultData = normalized;
        if (migratedSchema) await saveVault('旧账号库已迁移并升级，账号数据已保留。');
        else {
          await syncProjectDirectory(vaultData);
          await syncAccountSession(vaultData, opened.sessionKey);
          vaultSessionResumed = true;
        }
      } else if (!encryptedVault) {
        if (password.length < 8) throw new Error('主密码至少需要 8 位。');
        if (password !== $('#confirmPassword').value) throw new Error('两次输入的主密码不一致。');
        masterPassword = password;
        vaultData = defaultVault();
        const cloudState = currentTeamCloudState();
        if (cloudState && cloudState.remoteVaultDeleted === true) {
          await recreateDeletedTeamVault('团队账号库已重新创建。');
        } else {
          await saveVault('账号库已创建。');
        }
      } else {
        const opened = await window.TaobaoAccountVault.open(encryptedVault, password);
        const migrated = needsVaultMigration(opened.value);
        masterPassword = password;
        vaultData = normalizeVault(opened.value);
        if (migrated) await saveVault('旧账号库已升级，账号数据已保留。');
        else {
          await syncProjectDirectory(vaultData);
          await syncAccountSession(vaultData, opened.sessionKey);
          vaultSessionResumed = true;
        }
      }
      setNotice('账号库已解锁。', 'success');
      showWorkspace();
    } catch (error) {
      masterPassword = '';
      vaultData = null;
      vaultSessionResumed = false;
      setNotice(error.message, 'error');
    }
  });

  $('#resetVaultBtn').addEventListener('click', async () => {
    const teamCloudState = currentTeamCloudState();
    const confirmation = teamCloudState
      ? '重置团队账号库会删除所有电脑上的分组、账号和提醒配置，历史归档不会删除。确认继续？'
      : '重置账号库会删除全部分组、账号和提醒配置，历史归档不会删除。确认继续？';
    if (!window.confirm(confirmation)) return;
    vaultClearing = true;
    try {
      await vaultSaveQueue;
      const response = teamCloudState && window.TaobaoCloudSync &&
          typeof window.TaobaoCloudSync.deleteAccountVault === 'function'
        ? await window.TaobaoCloudSync.deleteAccountVault()
        : await request('clearAccountVault', { vaultLockEpoch });
      if (Number.isSafeInteger(Number(response && response.vaultLockEpoch))) {
        vaultLockEpoch = Number(response.vaultLockEpoch);
      }
      encryptedVault = null;
      invalidateVaultAccess();
      setNotice('账号库已重置。', 'success');
    } catch (error) {
      setNotice(error.message, 'error');
    } finally {
      vaultClearing = false;
    }
  });

  $('#lockVaultBtn').addEventListener('click', async () => {
    vaultClearing = true;
    try {
      await vaultSaveQueue;
      const response = await request('lockAccountVault');
      if (!response || response.ok === false) throw new Error(response && response.message || '锁定账号库失败。');
      if (Number.isSafeInteger(Number(response.vaultLockEpoch))) {
        vaultLockEpoch = Number(response.vaultLockEpoch);
      }
      invalidateVaultAccess();
      setNotice('账号库已锁定，本次 Chrome 会话凭据已清除。');
    } catch (error) {
      setNotice(error.message, 'error');
    } finally {
      vaultClearing = false;
    }
  });

  $('#storeGroupForm').addEventListener('submit', (event) => {
    event.preventDefault();
    addGroup($('#storeGroupName').value).then(() => event.currentTarget.reset())
      .catch((error) => setNotice(error.message, 'error'));
  });

  $('#storeGroupList').addEventListener('click', (event) => {
    const addAccount = event.target.closest('[data-add-account-group]');
    if (addAccount) {
      const groupId = addAccount.dataset.addAccountGroup;
      $('#storeGroupFilter').value = groupId;
      renderGroups();
      renderAccounts();
      openAccountDialog(null, groupId);
      return;
    }
    const filter = event.target.closest('[data-group-filter]');
    if (filter) {
      $('#storeGroupFilter').value = filter.dataset.groupFilter;
      renderGroups();
      renderAccounts();
      return;
    }
    const action = event.target.closest('[data-group-action]');
    if (action) handleGroupAction(action).catch((error) => setNotice(error.message, 'error'));
  });

  $('#accountSearch').addEventListener('input', renderAccounts);
  $('#storeGroupFilter').addEventListener('change', () => { renderGroups(); renderAccounts(); });
  $('#accountPlatform').addEventListener('change', syncAccountPlatformFields);
  $('#closeAccountDialogBtn').addEventListener('click', closeAccountDialog);
  $('#cancelAccountBtn').addEventListener('click', closeAccountDialog);
  $('#showAccountPassword').addEventListener('change', (event) => {
    $('#loginPassword').type = event.currentTarget.checked ? 'text' : 'password';
  });
  $('#accountRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-account-action]');
    if (button) handleAccountAction(button).catch((error) => setNotice(error.message, 'error'));
  });
  $('#accountForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveAccount().catch((error) => setNotice(error.message, 'error'));
  });

  $('#showDingSecret').addEventListener('change', (event) => {
    $('#dingSecret').type = event.currentTarget.checked ? 'text' : 'password';
  });
  $('#notificationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    vaultData.notification = { webhook: $('#dingWebhook').value.trim(), secret: $('#dingSecret').value.trim() };
    try { await saveVault('验证码提醒设置已保存。'); } catch (error) { setNotice(error.message, 'error'); }
  });
  $('#testDingTalkBtn').addEventListener('click', async () => {
    try {
      const response = await request('testDingTalk', {
        notification: { webhook: $('#dingWebhook').value.trim(), secret: $('#dingSecret').value.trim() },
      }, 45000);
      if (!response || response.ok === false) throw new Error(response && response.message || '测试消息发送失败。');
      setNotice('钉钉测试消息已发送。', 'success');
    } catch (error) { setNotice(error.message, 'error'); }
  });

  showLocked();
  Promise.resolve(window.TaobaoCloudSync && window.TaobaoCloudSync.ready)
    .catch(() => null)
    .then(connect);
})();
