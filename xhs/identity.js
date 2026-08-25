(function initXhsIdentity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsIdentityApi() {
  'use strict';

  const PLATFORMS = Object.freeze(['adstar', 'pgy', 'juguang']);
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
    for (const [advertiserId, brandIds] of byAdvertiser.entries()) {
      if (brandIds.size) {
        for (const brandUserId of brandIds) {
          tokens.push(juguangMainToken(brandUserId, advertiserId));
        }
      } else {
        tokens.push(juguangMainToken('', advertiserId));
      }
    }
    return uniqueTokens(tokens);
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
    if (platform === 'juguang') return juguangIdentityEvidence(collection);
    return [];
  }

  return Object.freeze({
    PLATFORMS,
    extractPlatformIdentity,
  });
});
