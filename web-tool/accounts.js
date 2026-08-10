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
  let vaultSaveQueue = Promise.resolve();

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

  function normalizeAccountPlatform(value) {
    return value === 'xiaohongshu' ? 'xiaohongshu' : 'taobao';
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
      schema: 3,
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

  function needsVaultMigration(value) {
    const source = value && typeof value === 'object' ? value : {};
    if (Number(source.schema) !== 3 || !Array.isArray(source.stores)) return true;
    return (Array.isArray(source.accounts) ? source.accounts : []).some((account) => (
      !account || !account.storeId || !['taobao', 'xiaohongshu'].includes(account.platform)
    ));
  }

  function normalizeVault(value) {
    const source = value && typeof value === 'object' ? value : {};
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
      const store = { id: id('store'), name, groupId, createdAt: nowIso(), updatedAt: nowIso() };
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
      const platform = normalizeAccountPlatform(item.platform);
      const account = {
        id: accountId,
        name: String(item.name || item.username || '').trim().slice(0, 80),
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
    }).filter((item) => item.storeId && item.username && item.password);

    return {
      schema: 3,
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
    return request('setProjectDirectory', {
      directory: {
        schema: 1,
        storeGroups: snapshot.storeGroups,
        stores: snapshot.stores,
        updatedAt: Date.now(),
      },
    }, 45000);
  }

  async function syncAccountSession(snapshot) {
    const response = await request('setAccountSession', {
      vault: snapshot,
      masterPassword,
    }, 45000);
    if (!response || response.ok === false) {
      throw new Error(response && response.message || '账号库会话同步失败。');
    }
    return response;
  }

  function saveVault(message) {
    vaultData.updatedAt = nowIso();
    const snapshot = JSON.parse(JSON.stringify(vaultData));
    const password = masterPassword;
    const task = vaultSaveQueue.then(async () => {
      const record = await window.TaobaoAccountVault.encrypt(snapshot, password);
      await request('setAccountVault', { vault: record }, 45000);
      await syncProjectDirectory(snapshot);
      await syncAccountSession(snapshot);
      encryptedVault = record;
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
    const enabledCount = vaultData.accounts.filter((account) => (
      normalizeAccountPlatform(account.platform) === 'taobao' && account.enabled
    )).length;
    $('#accountCount').textContent = vaultData.accounts.length + ' 个账号 · 淘宝 ' + taobaoCount +
      ' · 小红书 ' + xiaohongshuCount + ' · 批量启用 ' + enabledCount;
    $('#accountFilterSummary').textContent = '显示 ' + accounts.length + ' / ' + vaultData.accounts.length;
    $('#accountRows').innerHTML = accounts.length ? accounts.map((account) => {
      const store = storeForAccount(account);
      const platform = normalizeAccountPlatform(account.platform);
      const status = platform === 'taobao' ? (account.enabled ? '启用' : '停用') : '已保存';
      const statusTone = platform === 'taobao' && account.enabled ? 'success' : 'empty';
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
    const creating = !encryptedVault;
    $('#vaultTitle').textContent = creating ? '创建账号库' : '解锁账号库';
    $('#vaultCopy').textContent = creating
      ? '设置主密码后，账号信息将以密文保存在本机。'
      : '输入主密码管理账号与店铺分组。';
    $('#confirmPasswordRow').hidden = !creating;
    $('#confirmPassword').required = creating;
    $('#unlockVaultBtn').textContent = creating ? '创建并解锁' : '解锁';
    $('#resetVaultBtn').hidden = creating;
  }

  function showLocked() {
    masterPassword = '';
    vaultData = null;
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
    $('#accountEnabledField').hidden = !isTaobao;
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
    $('#loginUsername').value = value ? value.username : '';
    $('#loginPassword').value = value ? value.password : '';
    $('#roleKeyword').value = value ? value.roleKeyword : '品牌';
    $('#accountEnabled').checked = value ? value.enabled : true;
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
    const store = { id: id('store'), name, groupId, createdAt: nowIso(), updatedAt: nowIso() };
    vaultData.stores.push(store);
    return store;
  }

  async function saveAccount() {
    const accountId = $('#accountId').value;
    const existing = vaultData.accounts.find((account) => account.id === accountId) || null;
    const storeName = $('#accountStoreName').value.trim().slice(0, 80);
    const groupId = $('#accountStoreGroupSelect').value;
    const platform = normalizeAccountPlatform($('#accountPlatform').value);
    const username = $('#loginUsername').value.trim().slice(0, 160);
    const password = $('#loginPassword').value.slice(0, 240);
    if (!storeName || !username || !password) throw new Error('请填写完整的店铺、登录账号和密码。');
    const store = resolveStoreForAccount(existing, storeName, groupId);
    const value = {
      id: existing ? existing.id : id('account'),
      storeId: store.id,
      name: username,
      platform,
      username,
      password,
      accountGroupId: existing ? existing.accountGroupId : '',
      roleKeyword: platform === 'taobao' ? ($('#roleKeyword').value.trim().slice(0, 50) || '品牌') : '',
      enabled: platform === 'taobao' ? $('#accountEnabled').checked : true,
      createdAt: existing ? existing.createdAt : nowIso(),
      updatedAt: nowIso(),
    };
    if (existing) Object.assign(existing, value);
    else vaultData.accounts.push(value);
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
    await saveVault('账号已删除。');
    renderAll();
  }

  async function connect() {
    try {
      const response = await request('ping', {}, 5000);
      setConnection(Boolean(response && response.connected), response && response.version);
      const stored = await request('getStorage', { keys: [VAULT_KEY, PROJECT_DIRECTORY_KEY] });
      encryptedVault = stored && stored[VAULT_KEY] || null;
      const management = await request('getAccountManagementSession', {}, 10000).catch(() => null);
      const session = management && management.session;
      if (session && session.vault && String(session.masterPassword || '').length >= 8) {
        masterPassword = String(session.masterPassword);
        vaultData = normalizeVault(session.vault);
        showWorkspace();
        setNotice('本次 Chrome 会话已自动恢复账号库。', 'success');
      } else {
        setVaultGateMode();
      }
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

  $('#vaultForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#masterPassword').value;
    try {
      if (!encryptedVault) {
        if (password.length < 8) throw new Error('主密码至少需要 8 位。');
        if (password !== $('#confirmPassword').value) throw new Error('两次输入的主密码不一致。');
        masterPassword = password;
        vaultData = defaultVault();
        await saveVault('账号库已创建。');
      } else {
        const decrypted = await window.TaobaoAccountVault.decrypt(encryptedVault, password);
        const migrated = needsVaultMigration(decrypted);
        masterPassword = password;
        vaultData = normalizeVault(decrypted);
        if (migrated) await saveVault('旧账号库已升级，账号数据已保留。');
        else {
          await syncProjectDirectory(vaultData);
          await syncAccountSession(vaultData);
        }
      }
      setNotice('账号库已解锁。', 'success');
      showWorkspace();
    } catch (error) {
      masterPassword = '';
      vaultData = null;
      setNotice(error.message, 'error');
    }
  });

  $('#resetVaultBtn').addEventListener('click', async () => {
    if (!window.confirm('重置账号库会删除全部分组、账号和提醒配置，历史归档不会删除。确认继续？')) return;
    try {
      await request('clearAccountVault');
      encryptedVault = null;
      showLocked();
      setNotice('账号库已重置。', 'success');
    } catch (error) { setNotice(error.message, 'error'); }
  });

  $('#lockVaultBtn').addEventListener('click', async () => {
    try {
      const response = await request('clearAccountSession');
      if (!response || response.ok === false) throw new Error(response && response.message || '锁定账号库失败。');
      showLocked();
      setNotice('账号库已锁定，本次 Chrome 会话凭据已清除。');
    } catch (error) {
      setNotice(error.message, 'error');
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
