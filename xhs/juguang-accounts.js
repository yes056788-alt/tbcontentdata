(function initXhsJuguangAccounts(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsJuguangAccounts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsJuguangAccountsApi(contract) {
  'use strict';

  if (!contract) throw new Error('XhsContract must be loaded before XhsJuguangAccounts');

  function hasIdentityValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function normalizeBrand(data, fallback) {
    const nested = data.brand && typeof data.brand === 'object' && !Array.isArray(data.brand)
      ? data.brand
      : null;
    const brandUserId = nested && hasIdentityValue(nested.brandUserId)
      ? nested.brandUserId
      : data.brandUserId;
    const brandUserName = nested && hasIdentityValue(nested.brandUserName)
      ? nested.brandUserName
      : data.brandUserName;
    if (!nested && !hasIdentityValue(brandUserId) && !hasIdentityValue(brandUserName)) {
      return fallback;
    }
    const brand = Object.assign({}, nested || {});
    if (hasIdentityValue(brandUserId)) brand.brandUserId = brandUserId;
    if (hasIdentityValue(brandUserName)) brand.brandUserName = brandUserName;
    return brand;
  }

  function normalizeCurrentAccount(value) {
    const data = contract.sanitizeSensitiveData(value && typeof value === 'object' ? value : {});
    const subAccount = data.subAccount && typeof data.subAccount === 'object' ? data.subAccount : {};
    const brand = normalizeBrand(data, {});
    return {
      vSellerId: subAccount.agentSubAccountId || data.vSellerId || null,
      name: subAccount.agentSubAccountName || data.name || brand.brandUserName || null,
      advertiserId: data.advertiserId,
      accountType: data.accountType,
      brand,
      agent: data.agent || null,
      subAccount: data.subAccount || null,
    };
  }

  function normalizeListedAccount(value) {
    const row = contract.sanitizeSensitiveData(value && typeof value === 'object' ? value : {});
    const brand = normalizeBrand(row, null);
    return {
      vSellerId: row.virtualSellerId || row.vSellerId || null,
      name: row.owner && row.owner.name || row.accountName || row.name || null,
      advertiserId: row.advertiserId,
      accountType: row.accountType,
      brand,
      agent: row.agent || null,
      owner: row.owner || null,
    };
  }

  function verifyAccount(actualValue, expectedValue) {
    const actual = normalizeListedAccount(actualValue);
    const expected = normalizeListedAccount(expectedValue);
    if (Number(actual.advertiserId) !== Number(expected.advertiserId)) {
      throw new Error(`Juguang account advertiserId mismatch: expected ${expected.advertiserId}, got ${actual.advertiserId}`);
    }
    if (Number(actual.accountType) !== Number(expected.accountType)) {
      throw new Error(`Juguang account accountType mismatch: expected ${expected.accountType}, got ${actual.accountType}`);
    }
    if (Number(expected.accountType) === 602 && String(actual.vSellerId || '') !== String(expected.vSellerId || '')) {
      throw new Error(`Juguang account vSellerId mismatch: expected ${expected.vSellerId}, got ${actual.vSellerId}`);
    }
    return Object.assign({}, expected, { verified: actual });
  }

  function accountKey(account) {
    const normalized = normalizeListedAccount(account);
    return String(normalized.vSellerId || `advertiser-${normalized.advertiserId}`);
  }

  return Object.freeze({
    accountKey,
    normalizeCurrentAccount,
    normalizeListedAccount,
    verifyAccount,
  });
});
