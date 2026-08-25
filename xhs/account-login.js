(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XhsAccountLogin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLATFORM_IDS = Object.freeze([
    'sycm', 'guanghe', 'wxt', 'dmp', 'adstar', 'pgy', 'juguang',
  ]);
  const TAOBAO_PLATFORMS = new Set(['sycm', 'guanghe', 'wxt', 'dmp', 'adstar']);
  const XHS_PLATFORMS = new Set(['pgy', 'juguang']);
  const ACCOUNT_TYPES = Object.freeze(['taobao', 'xiaohongshu']);
  const BINDING_KEYS = Object.freeze({
    taobao: 'taobaoAccountId',
    xiaohongshu: 'xiaohongshuAccountId',
  });
  const ACCOUNT_TYPE_LABELS = Object.freeze({
    taobao: '淘宝登录账号',
    xiaohongshu: '小红书登录账号（蒲公英 + 聚光共用）',
  });
  const XHS_PLATFORM_ENTRY_URLS = Object.freeze({
    pgy: 'https://pgy.xiaohongshu.com/microapp/creativity/inspire',
    juguang: 'https://ad.xiaohongshu.com/aurora/ad/datareports-basic/note',
  });
  const XHS_LOGIN_ORIGINS = new Set([
    'https://customer.xiaohongshu.com',
    'https://passport.xiaohongshu.com',
  ]);

  function cleanText(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, Number(limit) || 160);
  }

  function strictAccountPlatform(value) {
    return ACCOUNT_TYPES.includes(value) ? value : '';
  }

  function maskUsername(value) {
    const text = cleanText(value, 240);
    if (!text) return '';
    const at = text.indexOf('@');
    if (at > 1) {
      const local = text.slice(0, at);
      return local.slice(0, 2) + '*'.repeat(Math.min(5, Math.max(1, local.length - 2))) + text.slice(at);
    }
    if (text.length <= 2) return text[0] + '*';
    return text.slice(0, 2) + '*'.repeat(Math.min(5, text.length - 3)) + text.slice(-1);
  }

  function trustedHttpsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function isAllowedLoginUrl(value) {
    const url = trustedHttpsUrl(value);
    return Boolean(url && XHS_LOGIN_ORIGINS.has(url.origin));
  }

  function isPlatformOriginUrl(platform, value) {
    const expected = trustedHttpsUrl(XHS_PLATFORM_ENTRY_URLS[platform]);
    const actual = trustedHttpsUrl(value);
    return Boolean(expected && actual && actual.origin === expected.origin);
  }

  function isExpectedPlatformUrl(platform, value) {
    const expected = trustedHttpsUrl(XHS_PLATFORM_ENTRY_URLS[platform]);
    const actual = trustedHttpsUrl(value);
    return Boolean(expected && actual && actual.origin === expected.origin &&
      actual.pathname === expected.pathname);
  }

  function isAllowedPlatformDocumentUrl(platform, value) {
    return isAllowedLoginUrl(value) || isPlatformOriginUrl(platform, value);
  }

  function isAllowedDocumentUrl(value) {
    return isAllowedLoginUrl(value) || Object.keys(XHS_PLATFORM_ENTRY_URLS)
      .some((platform) => isPlatformOriginUrl(platform, value));
  }

  function sameExactOrigin(left, right) {
    const leftUrl = trustedHttpsUrl(left);
    const rightUrl = trustedHttpsUrl(right);
    return Boolean(leftUrl && rightUrl && leftUrl.origin === rightUrl.origin);
  }

  function credentialValues(account) {
    const source = account && typeof account === 'object' ? account : {};
    return [
      cleanText(source.username, 240),
      String(source.password == null ? '' : source.password).slice(0, 360),
    ].filter(Boolean);
  }

  function containsCredential(value, credentials) {
    const text = String(value == null ? '' : value);
    return Boolean(text && credentials.some((credential) =>
      text === credential || text.includes(credential)));
  }

  function safeMetadataText(value, limit, credentials, fallback) {
    const candidate = cleanText(value, limit);
    if (candidate && !containsCredential(candidate, credentials)) return candidate;
    const safeFallback = cleanText(fallback, limit);
    return containsCredential(safeFallback, credentials) ? '' : safeFallback;
  }

  function safeAccountLabel(account) {
    const source = account && typeof account === 'object' ? account : {};
    const platform = strictAccountPlatform(source.platform) || 'taobao';
    const credentials = credentialValues(source);
    const candidate = cleanText(source.label || source.name, 100);
    if (candidate && !containsCredential(candidate, credentials)) return candidate;
    return safeMetadataText('', 100, credentials,
      platform === 'xiaohongshu' ? '小红书账号' : '淘宝账号');
  }

  function safeAccountMetadata(account, store) {
    const source = account && typeof account === 'object' ? account : {};
    const storeSource = store && typeof store === 'object' ? store : {};
    const platform = strictAccountPlatform(source.platform) || 'taobao';
    const credentials = credentialValues(source);
    const label = safeAccountLabel(source);
    return {
      id: safeMetadataText(source.id, 100, credentials, ''),
      label,
      name: label,
      platform,
      storeId: safeMetadataText(storeSource.id || source.storeId, 100, credentials, ''),
      storeName: safeMetadataText(
        storeSource.name || storeSource.storeName || source.storeName,
        120,
        credentials,
        '未命名店铺'
      ),
      usernameMasked: maskUsername(source.username),
      roleKeyword: platform === 'taobao'
        ? safeMetadataText(source.roleKeyword, 80, credentials, '品牌')
        : '',
      accountGroupId: safeMetadataText(source.accountGroupId, 100, credentials, ''),
      accountGroupName: safeMetadataText(source.accountGroupName, 100, credentials, '未分组'),
      storeGroupId: safeMetadataText(
        storeSource.groupId || source.storeGroupId,
        100,
        credentials,
        ''
      ),
      storeGroupName: safeMetadataText(
        storeSource.groupName || source.storeGroupName,
        100,
        credentials,
        '未分组'
      ),
    };
  }

  function requestedAccountTypes(platforms) {
    const selected = Array.from(new Set(Array.isArray(platforms) ? platforms : []));
    selected.forEach((platform) => {
      if (!PLATFORM_IDS.includes(platform)) throw new Error('不支持的平台任务。');
    });
    if (!selected.length) throw new Error('请至少选择一个平台任务。');
    return {
      platforms: selected,
      taobao: selected.some((platform) => TAOBAO_PLATFORMS.has(platform)),
      xiaohongshu: selected.some((platform) => XHS_PLATFORMS.has(platform)),
    };
  }

  function resolveBoundAccount(vault, store, accountType) {
    const bindingKey = BINDING_KEYS[accountType];
    const bindings = store.credentialBindings && typeof store.credentialBindings === 'object'
      ? store.credentialBindings
      : {};
    const accountId = cleanText(bindings[bindingKey], 100);
    const typeLabel = ACCOUNT_TYPE_LABELS[accountType];
    if (!accountId) throw new Error('所选店铺尚未设置' + typeLabel + '。');
    const account = (Array.isArray(vault.accounts) ? vault.accounts : [])
      .find((item) => cleanText(item && item.id, 100) === accountId);
    if (!account) throw new Error(typeLabel + '不可用，请返回账号库重新设置。');
    if (cleanText(account.storeId, 100) !== cleanText(store.id, 100)) {
      throw new Error(typeLabel + '不属于所选店铺。');
    }
    if (strictAccountPlatform(account.platform) !== accountType) {
      throw new Error(typeLabel + '的平台类型不正确。');
    }
    if (account.enabled === false) throw new Error(typeLabel + '已停用，当前不可用。');
    const username = cleanText(account.username, 240);
    const password = String(account.password == null ? '' : account.password).slice(0, 360);
    if (!username || !password) throw new Error(typeLabel + '缺少登录账号或密码。');
    return Object.assign({}, account, {
      id: accountId,
      platform: accountType,
      username,
      password,
      label: safeAccountLabel(account),
      roleKeyword: accountType === 'taobao' ? (cleanText(account.roleKeyword, 80) || '品牌') : '',
    });
  }

  function resolveCredentialPlan(vaultValue, request) {
    const vault = vaultValue && typeof vaultValue === 'object' && !Array.isArray(vaultValue)
      ? vaultValue
      : null;
    if (!vault) throw new Error('账号库尚未在本次 Chrome 会话解锁。');
    const source = request && typeof request === 'object' ? request : {};
    const storeId = cleanText(source.storeId, 100);
    const requested = requestedAccountTypes(source.platforms);
    const store = (Array.isArray(vault.stores) ? vault.stores : [])
      .find((item) => cleanText(item && item.id, 100) === storeId);
    if (!store) throw new Error('账号库中未找到所选店铺。');

    const accounts = {
      taobao: requested.taobao ? resolveBoundAccount(vault, store, 'taobao') : null,
      xiaohongshu: requested.xiaohongshu ? resolveBoundAccount(vault, store, 'xiaohongshu') : null,
    };
    const routes = {};
    requested.platforms.forEach((platform) => {
      const accountType = XHS_PLATFORMS.has(platform) ? 'xiaohongshu' : 'taobao';
      routes[platform] = { accountType, accountId: accounts[accountType].id };
    });
    return {
      store: {
        id: cleanText(store.id, 100),
        name: cleanText(store.name, 120),
        groupId: cleanText(store.groupId, 100),
      },
      platforms: requested.platforms,
      accounts,
      routes,
    };
  }

  return Object.freeze({
    PLATFORM_IDS,
    ACCOUNT_TYPES,
    BINDING_KEYS,
    XHS_PLATFORM_ENTRY_URLS,
    strictAccountPlatform,
    maskUsername,
    isAllowedLoginUrl,
    isPlatformOriginUrl,
    isExpectedPlatformUrl,
    isAllowedPlatformDocumentUrl,
    isAllowedDocumentUrl,
    sameExactOrigin,
    safeAccountLabel,
    safeAccountMetadata,
    requestedAccountTypes,
    resolveCredentialPlan,
  });
});
