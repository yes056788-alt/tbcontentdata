(function initXhsBindings(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsBindings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsBindingsApi(contract) {
  'use strict';

  if (!contract) throw new Error('XhsContract must be loaded before XhsBindings');

  const BINDING_SCHEMA = 'xhsStoreAccountBindingsV1';
  const PLATFORMS = Object.freeze(['adstar', 'pgy', 'juguang']);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 180);
  }

  function uniqueTokens(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => text(item, 320))
      .filter(Boolean)))
      .sort();
  }

  function identityToken(prefix, values) {
    const parts = values.map((value) => text(value, 180));
    return parts.every(Boolean) ? `${prefix}:${parts.join(':')}` : '';
  }

  function extractPlatformIdentity(platform, collectionValue) {
    const collection = isObject(collectionValue) ? collectionValue : {};
    if (platform === 'adstar') {
      const identity = isObject(collection.identity) ? collection.identity : {};
      return uniqueTokens([
        identityToken('adstar', [identity.memberId || identity.id]),
      ]);
    }
    if (platform === 'pgy') {
      const identity = isObject(collection.identity) ? collection.identity : {};
      return uniqueTokens([
        identityToken('pgy', [identity.brandUserId]),
      ]);
    }
    if (platform === 'juguang') {
      const units = Array.isArray(collection.accounts) && collection.accounts.length
        ? collection.accounts
        : [{ account: collection.initialAccount }];
      return uniqueTokens(units.map((unit) => {
        const account = isObject(unit && unit.account) ? unit.account : {};
        const brand = isObject(account.brand) ? account.brand : {};
        const advertiserId = account.advertiserId;
        if (advertiserId === undefined || advertiserId === null || advertiserId === '') return '';
        return identityToken('juguang', [
          brand.brandUserId || 'brand-unknown',
          advertiserId,
          account.accountType == null ? 'type-unknown' : account.accountType,
          account.vSellerId || 'main',
        ]);
      }));
    }
    return [];
  }

  function normalizeRegistry(value) {
    const source = isObject(value) ? value : {};
    const stores = {};
    const rawStores = isObject(source.stores) ? source.stores : {};
    for (const [rawStoreId, rawStore] of Object.entries(rawStores)) {
      const storeId = text(rawStoreId, 100);
      if (!storeId || !isObject(rawStore)) continue;
      const platforms = {};
      const rawPlatforms = isObject(rawStore.platforms) ? rawStore.platforms : {};
      for (const platform of PLATFORMS) {
        const tokens = uniqueTokens(rawPlatforms[platform]);
        if (tokens.length) platforms[platform] = tokens;
      }
      stores[storeId] = {
        platforms,
        updatedAt: text(rawStore.updatedAt, 80),
      };
    }
    return { schema: BINDING_SCHEMA, schemaVersion: 1, stores };
  }

  function sameTokens(left, right) {
    const a = uniqueTokens(left);
    const b = uniqueTokens(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function bindingIssue(code, platform, message, fields) {
    return contract.sanitizeSensitiveData(Object.assign({
      severity: 'critical', code, platform, message,
    }, fields || {}));
  }

  function reconcileStoreBindings(input) {
    const source = isObject(input) ? input : {};
    const storeId = text(source.storeId, 100);
    if (!storeId) throw new Error('XHS store binding requires storeId.');
    const selectedPlatforms = PLATFORMS.filter((platform) => (
      Array.isArray(source.selectedPlatforms) && source.selectedPlatforms.includes(platform)
    ));
    if (!selectedPlatforms.length) throw new Error('XHS store binding requires selected platforms.');
    const registry = normalizeRegistry(source.registry);
    const current = registry.stores[storeId] || { platforms: {}, updatedAt: '' };
    const nextPlatforms = Object.assign({}, current.platforms);
    const bindings = {};
    const actualIdentities = {};
    const issues = [];
    let changed = false;

    for (const platform of selectedPlatforms) {
      const actual = extractPlatformIdentity(platform, source.collections && source.collections[platform]);
      const expected = uniqueTokens(current.platforms[platform]);
      actualIdentities[platform] = actual;
      bindings[platform] = (expected.length ? expected : actual).slice();
      if (!actual.length) {
        issues.push(bindingIssue(
          'account_identity_missing', platform,
          `无法确认 ${platform} 的真实登录账号，禁止用于店铺决策。`,
        ));
        continue;
      }
      if (expected.length && !sameTokens(expected, actual)) {
        issues.push(bindingIssue(
          'account_binding_mismatch', platform,
          `当前 ${platform} 登录账号与所选店铺绑定不一致。`,
          { expected, actual },
        ));
        continue;
      }
      if (!expected.length) {
        const collision = Object.entries(registry.stores).find(([otherStoreId, otherStore]) => (
          otherStoreId !== storeId &&
          uniqueTokens(otherStore && otherStore.platforms && otherStore.platforms[platform])
            .some((token) => actual.includes(token))
        ));
        if (collision) {
          bindings[platform] = [];
          issues.push(bindingIssue(
            'account_identity_bound_to_other_store', platform,
            `当前 ${platform} 登录账号已绑定到另一店铺，禁止重新归属。`,
            { otherStoreId: collision[0], actual },
          ));
          continue;
        }
        nextPlatforms[platform] = actual.slice();
        bindings[platform] = actual.slice();
        changed = true;
      }
    }

    const issuesAllowSafePartialCommit = issues.every((issue) => {
      if (!issue || issue.code !== 'account_identity_missing') return false;
      const collection = source.collections && source.collections[issue.platform];
      return ['failed', 'cancelled'].includes(String(collection && collection.status || 'missing'));
    });
    const shouldPersist = changed && (issues.length === 0 || issuesAllowSafePartialCommit);
    if (shouldPersist) {
      registry.stores[storeId] = {
        platforms: nextPlatforms,
        updatedAt: text(source.updatedAt, 80) || new Date().toISOString(),
      };
    }
    return contract.sanitizeSensitiveData({
      registry,
      storeId,
      selectedPlatforms,
      bindings,
      actualIdentities,
      issues,
      ready: issues.length === 0,
      changed: shouldPersist,
    });
  }

  return Object.freeze({
    BINDING_SCHEMA,
    PLATFORMS,
    extractPlatformIdentity,
    normalizeRegistry,
    reconcileStoreBindings,
    sameTokens,
  });
});
