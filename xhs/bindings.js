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
  const BINDING_SCHEMA_VERSION = 2;
  const PLATFORMS = Object.freeze(['adstar', 'pgy', 'juguang']);
  const READY_STATUSES = new Set(['complete', 'verified_no_spend']);
  const JUGUANG_ADVERTISER_ONLY = 'advertiser-only';

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

  function juguangBrandId(account) {
    const source = isObject(account) ? account : {};
    const brand = isObject(source.brand) ? source.brand : {};
    return text(brand.brandUserId || source.brandUserId, 180);
  }

  function juguangMainToken(brandUserId, advertiserId) {
    return identityToken('juguang', [
      text(brandUserId, 180) || JUGUANG_ADVERTISER_ONLY,
      advertiserId,
      4,
      'main',
    ]);
  }

  function juguangIdentityEvidence(collectionValue) {
    const collection = isObject(collectionValue) ? collectionValue : {};
    const accounts = [];
    const units = Array.isArray(collection.accounts) ? collection.accounts : [];
    for (const unit of units) {
      const account = isObject(unit && unit.account) ? unit.account : unit;
      if (isObject(account)) accounts.push(account);
    }
    if (isObject(collection.initialAccount)) accounts.push(collection.initialAccount);
    if (isObject(collection.restoredAccount)) accounts.push(collection.restoredAccount);

    const byAdvertiser = new Map();
    for (const account of accounts) {
      if (Number(account.accountType) !== 4) continue;
      const advertiserId = text(account.advertiserId, 180);
      if (!advertiserId) continue;
      if (!byAdvertiser.has(advertiserId)) byAdvertiser.set(advertiserId, new Set());
      const brandUserId = juguangBrandId(account);
      if (brandUserId) byAdvertiser.get(advertiserId).add(brandUserId);
    }

    const tokens = [];
    let ambiguous = byAdvertiser.size > 1;
    for (const [advertiserId, brandIds] of byAdvertiser.entries()) {
      if (brandIds.size > 1) ambiguous = true;
      if (brandIds.size) {
        for (const brandUserId of brandIds) {
          tokens.push(juguangMainToken(brandUserId, advertiserId));
        }
      } else {
        tokens.push(juguangMainToken('', advertiserId));
      }
    }
    return { tokens: uniqueTokens(tokens), ambiguous };
  }

  function parseJuguangMainToken(value) {
    const token = text(value, 320);
    const parts = token.split(':');
    if (parts.length !== 5 || parts[0] !== 'juguang') return null;
    const rawBrandUserId = text(parts[1], 180);
    const advertiserId = text(parts[2], 180);
    const accountType = text(parts[3], 40);
    const vSellerId = text(parts[4], 180);
    if (!rawBrandUserId || !advertiserId || accountType !== '4' || vSellerId !== 'main') return null;
    const advertiserOnly = rawBrandUserId === 'brand-unknown' ||
      rawBrandUserId === JUGUANG_ADVERTISER_ONLY;
    const brandUserId = advertiserOnly ? '' : rawBrandUserId;
    return {
      advertiserId,
      advertiserOnly,
      brandUserId,
      token: juguangMainToken(brandUserId, advertiserId),
    };
  }

  function normalizeJuguangTokens(value) {
    const parsed = uniqueTokens(value)
      .map(parseJuguangMainToken)
      .filter(Boolean);
    const advertiserIds = Array.from(new Set(parsed.map((item) => item.advertiserId)));
    if (advertiserIds.length !== 1) return [];
    const knownBrandIds = Array.from(new Set(parsed
      .map((item) => item.brandUserId)
      .filter(Boolean)));
    if (knownBrandIds.length > 1) return [];
    return [juguangMainToken(knownBrandIds[0] || '', advertiserIds[0])];
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
      return juguangIdentityEvidence(collection).tokens;
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
        const tokens = platform === 'juguang'
          ? normalizeJuguangTokens(rawPlatforms[platform])
          : uniqueTokens(rawPlatforms[platform]);
        if (tokens.length) platforms[platform] = tokens;
      }
      stores[storeId] = {
        platforms,
        updatedAt: text(rawStore.updatedAt, 80),
      };
    }
    return { schema: BINDING_SCHEMA, schemaVersion: BINDING_SCHEMA_VERSION, stores };
  }

  function sameTokens(left, right) {
    const a = uniqueTokens(left);
    const b = uniqueTokens(right);
    if (a.length === b.length && a.every((value, index) => value === b[index])) return true;
    if (a.length !== 1 || b.length !== 1) return false;
    const parsedA = parseJuguangMainToken(a[0]);
    const parsedB = parseJuguangMainToken(b[0]);
    return Boolean(parsedA && parsedB &&
      parsedA.advertiserId === parsedB.advertiserId &&
      (parsedA.advertiserOnly || parsedB.advertiserOnly ||
        parsedA.brandUserId === parsedB.brandUserId));
  }

  function tokensOverlap(left, right) {
    const a = uniqueTokens(left);
    const b = uniqueTokens(right);
    return a.some((leftToken) => b.some((rightToken) => (
      sameTokens([leftToken], [rightToken])
    )));
  }

  function shouldUpgradeJuguangIdentity(expected, actual) {
    if (!sameTokens(expected, actual) || expected.length !== 1 || actual.length !== 1) return false;
    const previous = parseJuguangMainToken(expected[0]);
    const current = parseJuguangMainToken(actual[0]);
    return Boolean(previous && current && previous.advertiserOnly && !current.advertiserOnly);
  }

  function registryWasNormalized(value, normalized) {
    if (!isObject(value)) return false;
    try {
      return JSON.stringify(value) !== JSON.stringify(normalized);
    } catch (_error) {
      return true;
    }
  }

  function bindingIssue(code, platform, message, fields) {
    return contract.sanitizeSensitiveData(Object.assign({
      severity: 'critical', code, platform, message,
    }, fields || {}));
  }

  function findIdentityCollision(registry, storeId, platform, actual) {
    return Object.entries(registry.stores).find(([otherStoreId, otherStore]) => (
      otherStoreId !== storeId &&
      tokensOverlap(
        otherStore && otherStore.platforms && otherStore.platforms[platform],
        actual,
      )
    ));
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
    const registryChangedByNormalization = registryWasNormalized(source.registry, registry);
    const current = registry.stores[storeId] || { platforms: {}, updatedAt: '' };
    const nextPlatforms = Object.assign({}, current.platforms);
    const bindings = {};
    const actualIdentities = {};
    const issues = [];
    let changed = false;

    for (const platform of selectedPlatforms) {
      const collection = source.collections && source.collections[platform];
      const juguangEvidence = platform === 'juguang'
        ? juguangIdentityEvidence(collection)
        : null;
      const actual = juguangEvidence
        ? juguangEvidence.tokens
        : extractPlatformIdentity(platform, collection);
      const expected = uniqueTokens(current.platforms[platform]);
      const collectionReady = READY_STATUSES.has(String(collection && collection.status || 'missing'));
      actualIdentities[platform] = actual;
      bindings[platform] = (expected.length ? expected : actual).slice();
      if (juguangEvidence && juguangEvidence.ambiguous) {
        bindings[platform] = expected.slice();
        const definiteMismatch = expected.length && !tokensOverlap(expected, actual);
        const collision = findIdentityCollision(registry, storeId, platform, actual);
        if (definiteMismatch) {
          issues.push(bindingIssue(
            'account_binding_mismatch', platform,
            '当前 juguang 登录账号与所选店铺绑定不一致。',
            { expected, actual },
          ));
        } else if (collision) {
          issues.push(bindingIssue(
            'account_identity_bound_to_other_store', platform,
            '当前 juguang 登录账号已绑定到另一店铺，禁止重新归属。',
            { otherStoreId: collision[0], actual },
          ));
        } else {
          issues.push(bindingIssue(
            'account_identity_ambiguous', platform,
            '无法唯一确认聚光主账户，禁止用于店铺决策。',
            { actual },
          ));
        }
        continue;
      }
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
      if (expected.length && platform === 'juguang' && collectionReady &&
          shouldUpgradeJuguangIdentity(expected, actual)) {
        nextPlatforms[platform] = actual.slice();
        bindings[platform] = actual.slice();
        changed = true;
      }
      if (!expected.length) {
        const collision = findIdentityCollision(registry, storeId, platform, actual);
        if (collision) {
          bindings[platform] = [];
          issues.push(bindingIssue(
            'account_identity_bound_to_other_store', platform,
            `当前 ${platform} 登录账号已绑定到另一店铺，禁止重新归属。`,
            { otherStoreId: collision[0], actual },
          ));
          continue;
        }
        if (collectionReady) {
          nextPlatforms[platform] = actual.slice();
          bindings[platform] = actual.slice();
          changed = true;
        }
      }
    }

    const issuesAllowSafePartialCommit = issues.every((issue) => {
      if (!issue) return false;
      const collection = source.collections && source.collections[issue.platform];
      const status = String(collection && collection.status || 'missing');
      if (issue.code === 'account_identity_missing' &&
          ['failed', 'cancelled'].includes(status)) return true;
      return issue.platform === 'juguang' && status === 'partial' && [
        'account_identity_missing', 'account_identity_ambiguous',
      ].includes(issue.code);
    });
    const shouldPersistBindingChanges = changed &&
      (issues.length === 0 || issuesAllowSafePartialCommit);
    if (shouldPersistBindingChanges) {
      registry.stores[storeId] = {
        platforms: nextPlatforms,
        updatedAt: text(source.updatedAt, 80) || new Date().toISOString(),
      };
    }
    const shouldPersist = registryChangedByNormalization || shouldPersistBindingChanges;
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
