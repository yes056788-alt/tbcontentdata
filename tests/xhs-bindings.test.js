const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractPlatformIdentity,
  reconcileStoreBindings,
} = require('../xhs/bindings');

function collections(suffix = 'a') {
  return {
    adstar: { identity: { memberId: `fictional-star-${suffix}`, memberName: `虚构星河 ${suffix}` } },
    pgy: { identity: { brandUserId: `fictional-brand-${suffix}`, brandUserName: `虚构蒲公英 ${suffix}` } },
    juguang: {
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

test('extracts irreversible platform identities instead of trusting the selected store id', () => {
  const input = collections();
  assert.deepEqual(extractPlatformIdentity('adstar', input.adstar), ['adstar:fictional-star-a']);
  assert.deepEqual(extractPlatformIdentity('pgy', input.pgy), ['pgy:fictional-brand-a']);
  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:fictional-brand-a:fictional-advertiser-a:4:main',
    'juguang:fictional-brand-a:fictional-advertiser-child-a:602:fictional-seller-a',
  ]);
});

test('first confirmed current-session run binds actual identities to the selected store', () => {
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-a',
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
    collections: collections('a'),
    registry: null,
    updatedAt: '2030-01-31T16:00:00.000Z',
  });
  assert.equal(result.ready, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.registry.stores['fictional-store-a'].platforms, result.bindings);
  assert.equal(result.issues.length, 0);
});

test('a later run with a different actual login is a critical binding mismatch', () => {
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-a',
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
    collections: collections('a'),
  });
  const mismatch = reconcileStoreBindings({
    storeId: 'fictional-store-a',
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
    collections: collections('b'),
    registry: first.registry,
  });
  assert.equal(mismatch.ready, false);
  assert.equal(mismatch.changed, false);
  assert.deepEqual(mismatch.registry, first.registry);
  assert.ok(mismatch.issues.every((issue) => issue.severity === 'critical'));
  assert.deepEqual(mismatch.issues.map((issue) => issue.code), [
    'account_binding_mismatch', 'account_binding_mismatch', 'account_binding_mismatch',
  ]);
});

test('an identity already bound to another store cannot be silently reassigned', () => {
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-a',
    selectedPlatforms: ['pgy'],
    collections: collections('a'),
  });
  const collision = reconcileStoreBindings({
    storeId: 'fictional-store-b',
    selectedPlatforms: ['pgy'],
    collections: collections('a'),
    registry: first.registry,
  });
  assert.equal(collision.ready, false);
  assert.equal(collision.issues[0].code, 'account_identity_bound_to_other_store');
  assert.equal(collision.registry.stores['fictional-store-b'], undefined);
});

test('missing real identity never falls back to a synthetic accountKey', () => {
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-a',
    selectedPlatforms: ['adstar'],
    collections: { adstar: { accountKey: 'fictional-store-a' } },
  });
  assert.equal(result.ready, false);
  assert.equal(result.bindings.adstar.length, 0);
  assert.equal(result.issues[0].code, 'account_identity_missing');
});

test('a failed source stays unbound while successful identities persist and protect the next mixed run', () => {
  const firstCollections = collections('a');
  firstCollections.juguang = { status: 'failed', accounts: [], errors: [{ code: 'fictional-unavailable' }] };
  firstCollections.adstar.status = 'complete';
  firstCollections.pgy.status = 'complete';
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-mixed',
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
    collections: firstCollections,
    registry: null,
    updatedAt: '2030-02-01T00:00:00.000Z',
  });

  assert.equal(first.ready, false, 'the failed source still blocks decision readiness');
  assert.equal(first.changed, true, 'safe identities from successful sources must be persisted');
  assert.deepEqual(first.registry.stores['fictional-store-mixed'].platforms, {
    adstar: ['adstar:fictional-star-a'],
    pgy: ['pgy:fictional-brand-a'],
  });
  assert.equal(first.registry.stores['fictional-store-mixed'].platforms.juguang, undefined);

  const secondCollections = collections('b');
  secondCollections.juguang = { status: 'failed', accounts: [], errors: [{ code: 'fictional-unavailable' }] };
  secondCollections.adstar.status = 'complete';
  secondCollections.pgy.status = 'complete';
  const second = reconcileStoreBindings({
    storeId: 'fictional-store-mixed',
    selectedPlatforms: ['adstar', 'pgy', 'juguang'],
    collections: secondCollections,
    registry: first.registry,
  });

  assert.equal(second.ready, false);
  assert.equal(second.changed, false);
  assert.deepEqual(second.issues.map((issue) => issue.code), [
    'account_binding_mismatch',
    'account_binding_mismatch',
    'account_identity_missing',
  ]);
  assert.deepEqual(second.registry, first.registry);
});
