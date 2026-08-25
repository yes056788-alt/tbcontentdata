const assert = require('node:assert/strict');
const test = require('node:test');

const { extractPlatformIdentity } = require('../xhs/identity');

function collections(suffix = 'a') {
  return {
    adstar: {
      status: 'complete',
      identity: { memberId: `fictional-star-${suffix}`, memberName: `虚构星河 ${suffix}` },
    },
    pgy: {
      status: 'complete',
      identity: { brandUserId: `fictional-brand-${suffix}`, brandUserName: `虚构蒲公英 ${suffix}` },
    },
    juguang: {
      status: 'complete',
      accounts: [{
        account: {
          advertiserId: `fictional-advertiser-${suffix}`,
          accountType: 4,
          vSellerId: null,
          brand: { brandUserId: `fictional-brand-${suffix}` },
        },
      }, {
        account: {
          advertiserId: `fictional-advertiser-child-${suffix}`,
          accountType: 602,
          vSellerId: `fictional-seller-${suffix}`,
          brand: { brandUserId: `fictional-brand-${suffix}` },
        },
      }],
    },
  };
}

test('extracts platform identities from collected account evidence', () => {
  const input = collections();
  assert.deepEqual(extractPlatformIdentity('adstar', input.adstar), [
    'adstar:fictional-star-a',
  ]);
  assert.deepEqual(extractPlatformIdentity('pgy', input.pgy), [
    'pgy:fictional-brand-a',
  ]);
  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:fictional-brand-a:fictional-advertiser-a:4:main',
  ]);
});

test('Juguang identity ignores child advertiser roster changes', () => {
  const input = collections('stable-main');
  const expected = extractPlatformIdentity('juguang', input.juguang);
  input.juguang.accounts.push({
    account: {
      advertiserId: 'fictional-advertiser-new-child',
      accountType: 602,
      vSellerId: 'fictional-seller-new-child',
      brand: { brandUserId: 'fictional-brand-stable-main' },
    },
  });

  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), expected);
});

test('Juguang falls back to an explicit advertiser-only identity when brand id is absent', () => {
  const input = collections('advertiser-only');
  delete input.juguang.accounts[0].account.brand;

  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:advertiser-only:fictional-advertiser-advertiser-only:4:main',
  ]);
});

test('Juguang merges duplicate main-account evidence and keeps the strongest brand id', () => {
  const input = collections('merged-main-evidence');
  delete input.juguang.accounts[0].account.brand;
  input.juguang.initialAccount = {
    advertiserId: 'fictional-advertiser-merged-main-evidence',
    accountType: 4,
    vSellerId: null,
    brand: { brandUserId: 'fictional-brand-merged-main-evidence' },
  };

  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:fictional-brand-merged-main-evidence:fictional-advertiser-merged-main-evidence:4:main',
  ]);
});

test('Juguang preserves every distinct main-account token as deterministic snapshot metadata', () => {
  const input = collections('multiple-main');
  input.juguang.accounts.push({
    account: {
      advertiserId: 'fictional-second-main-advertiser',
      accountType: 4,
      vSellerId: null,
      brand: { brandUserId: 'fictional-second-main-brand' },
    },
  });

  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:fictional-brand-multiple-main:fictional-advertiser-multiple-main:4:main',
    'juguang:fictional-second-main-brand:fictional-second-main-advertiser:4:main',
  ]);
});

test('missing or unsupported account evidence yields no synthetic identity', () => {
  const input = collections('missing');
  input.juguang.accounts = input.juguang.accounts.filter((unit) => (
    Number(unit.account.accountType) !== 4
  ));

  assert.deepEqual(extractPlatformIdentity('adstar', { accountKey: 'fictional-store' }), []);
  assert.deepEqual(extractPlatformIdentity('pgy', { accountKey: 'fictional-store' }), []);
  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), []);
  assert.deepEqual(extractPlatformIdentity('unknown', input.adstar), []);
});
