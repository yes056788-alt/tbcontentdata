const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractPlatformIdentity,
  normalizeRegistry,
  reconcileStoreBindings,
} = require('../xhs/bindings');

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

test('extracts irreversible platform identities instead of trusting the selected store id', () => {
  const input = collections();
  assert.deepEqual(extractPlatformIdentity('adstar', input.adstar), ['adstar:fictional-star-a']);
  assert.deepEqual(extractPlatformIdentity('pgy', input.pgy), ['pgy:fictional-brand-a']);
  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:fictional-brand-a:fictional-advertiser-a:4:main',
  ]);
});

test('Juguang identity uses one stable main advertiser and ignores a changing child roster', () => {
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-stable-main',
    selectedPlatforms: ['juguang'],
    collections: collections('stable-main'),
  });
  const nextCollections = collections('stable-main');
  nextCollections.juguang.status = 'partial';
  nextCollections.juguang.accounts.push({
    account: {
      advertiserId: 'fictional-advertiser-new-child',
      accountType: 602,
      vSellerId: 'fictional-seller-new-child',
      brand: { brandUserId: 'fictional-brand-stable-main' },
    },
  });
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-stable-main',
    selectedPlatforms: ['juguang'],
    collections: nextCollections,
    registry: first.registry,
  });

  assert.equal(result.ready, true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.registry, first.registry);
  assert.deepEqual(result.actualIdentities.juguang, [
    'juguang:fictional-brand-stable-main:fictional-advertiser-stable-main:4:main',
  ]);
});

test('Juguang falls back to an explicit advertiser-only main identity when brand id is absent', () => {
  const input = collections('advertiser-only');
  delete input.juguang.accounts[0].account.brand;

  assert.deepEqual(extractPlatformIdentity('juguang', input.juguang), [
    'juguang:advertiser-only:fictional-advertiser-advertiser-only:4:main',
  ]);
});

test('Juguang merges duplicate evidence for the same main advertiser and keeps the strongest brand id', () => {
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

test('a complete Juguang collection without exactly one main account is never bound', () => {
  const missing = collections('missing-main');
  missing.juguang.accounts = missing.juguang.accounts.filter((unit) => (
    Number(unit.account.accountType) !== 4
  ));
  const missingResult = reconcileStoreBindings({
    storeId: 'fictional-store-missing-main',
    selectedPlatforms: ['juguang'],
    collections: missing,
  });
  assert.equal(missingResult.ready, false);
  assert.equal(missingResult.changed, false);
  assert.equal(missingResult.issues[0].code, 'account_identity_missing');
  assert.equal(missingResult.registry.stores['fictional-store-missing-main'], undefined);

  const ambiguous = collections('ambiguous-main');
  ambiguous.juguang.accounts.push({
    account: {
      advertiserId: 'fictional-second-main-advertiser',
      accountType: 4,
      vSellerId: null,
      brand: { brandUserId: 'fictional-brand-ambiguous-main' },
    },
  });
  const ambiguousResult = reconcileStoreBindings({
    storeId: 'fictional-store-ambiguous-main',
    selectedPlatforms: ['juguang'],
    collections: ambiguous,
  });
  assert.equal(ambiguousResult.ready, false);
  assert.equal(ambiguousResult.changed, false);
  assert.equal(ambiguousResult.issues[0].code, 'account_identity_ambiguous');
  assert.equal(ambiguousResult.registry.stores['fictional-store-ambiguous-main'], undefined);
});

test('registry v1 migration keeps one Juguang main token and drops legacy child tokens', () => {
  const legacy = {
    schema: 'xhsStoreAccountBindingsV1',
    schemaVersion: 1,
    stores: {
      'fictional-store-legacy': {
        platforms: {
          adstar: ['adstar:fictional-star-legacy'],
          juguang: [
            'juguang:fictional-brand-legacy:fictional-main-legacy:4:main',
            'juguang:fictional-brand-legacy:fictional-child-legacy:602:fictional-seller-legacy',
          ],
        },
        updatedAt: '2030-02-01T00:00:00.000Z',
      },
    },
  };

  const normalized = normalizeRegistry(legacy);
  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(normalized.stores['fictional-store-legacy'].platforms, {
    adstar: ['adstar:fictional-star-legacy'],
    juguang: ['juguang:fictional-brand-legacy:fictional-main-legacy:4:main'],
  });

  const current = collections('legacy');
  current.juguang.status = 'partial';
  current.juguang.accounts[0].account.advertiserId = 'fictional-main-legacy';
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-legacy',
    selectedPlatforms: ['juguang'],
    collections: current,
    registry: legacy,
  });
  assert.equal(result.ready, true);
  assert.equal(result.changed, true, 'normalized v1 migration must be persisted on reconciliation');
  assert.deepEqual(result.registry.stores['fictional-store-legacy'].platforms.juguang, [
    'juguang:fictional-brand-legacy:fictional-main-legacy:4:main',
  ]);

  const idempotent = reconcileStoreBindings({
    storeId: 'fictional-store-legacy',
    selectedPlatforms: ['juguang'],
    collections: current,
    registry: result.registry,
  });
  assert.equal(idempotent.changed, false, 'a persisted v2 registry must not migrate repeatedly');
});

test('registry migration drops ambiguous or child-only Juguang identities instead of trusting them', () => {
  const legacy = {
    schema: 'xhsStoreAccountBindingsV1',
    schemaVersion: 1,
    stores: {
      'fictional-store-two-mains': {
        platforms: {
          pgy: ['pgy:fictional-brand-owner'],
          juguang: [
            'juguang:fictional-brand-owner:fictional-main-one:4:main',
            'juguang:fictional-brand-owner:fictional-main-two:4:main',
          ],
        },
      },
      'fictional-store-child-only': {
        platforms: {
          juguang: [
            'juguang:fictional-brand-child:fictional-child-only:602:fictional-seller-child',
          ],
        },
      },
    },
  };
  const normalized = normalizeRegistry(legacy);

  assert.deepEqual(normalized.stores['fictional-store-two-mains'].platforms, {
    pgy: ['pgy:fictional-brand-owner'],
  });
  assert.deepEqual(normalized.stores['fictional-store-child-only'].platforms, {});

  const current = collections('ambiguous-migration');
  current.juguang.accounts.push({
    account: {
      advertiserId: 'fictional-second-current-main',
      accountType: 4,
      vSellerId: null,
      brand: { brandUserId: 'fictional-brand-ambiguous-migration' },
    },
  });
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-two-mains',
    selectedPlatforms: ['juguang'],
    collections: current,
    registry: legacy,
  });
  assert.equal(result.ready, false);
  assert.equal(result.changed, true, 'unsafe legacy tokens must still be pruned and persisted');
  assert.equal(result.issues[0].code, 'account_identity_ambiguous');
  assert.equal(
    result.registry.stores['fictional-store-two-mains'].platforms.juguang,
    undefined,
  );
});

test('a legacy unknown-brand Juguang main migrates during partial collection and upgrades only when ready', () => {
  const legacy = {
    schema: 'xhsStoreAccountBindingsV1',
    schemaVersion: 1,
    stores: {
      'fictional-store-brand-upgrade': {
        platforms: {
          juguang: [
            'juguang:brand-unknown:fictional-main-brand-upgrade:4:main',
            'juguang:fictional-brand-upgrade:fictional-child-brand-upgrade:602:fictional-seller-brand-upgrade',
          ],
        },
      },
    },
  };
  const current = collections('brand-upgrade');
  current.juguang.accounts[0].account.advertiserId = 'fictional-main-brand-upgrade';
  current.juguang.status = 'partial';

  const migrated = reconcileStoreBindings({
    storeId: 'fictional-store-brand-upgrade',
    selectedPlatforms: ['juguang'],
    collections: current,
    registry: legacy,
  });

  assert.equal(migrated.ready, true);
  assert.equal(migrated.changed, true);
  assert.deepEqual(migrated.registry.stores['fictional-store-brand-upgrade'].platforms.juguang, [
    'juguang:advertiser-only:fictional-main-brand-upgrade:4:main',
  ], 'partial evidence must not silently strengthen a stored binding');

  current.juguang.status = 'complete';
  const upgraded = reconcileStoreBindings({
    storeId: 'fictional-store-brand-upgrade',
    selectedPlatforms: ['juguang'],
    collections: current,
    registry: migrated.registry,
  });
  assert.equal(upgraded.ready, true);
  assert.equal(upgraded.changed, true);
  assert.deepEqual(upgraded.registry.stores['fictional-store-brand-upgrade'].platforms.juguang, [
    'juguang:fictional-brand-brand-upgrade:fictional-main-brand-upgrade:4:main',
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

test('partial, failed, and cancelled identities never create a first store binding', () => {
  for (const status of ['partial', 'failed', 'cancelled']) {
    const input = collections(status);
    input.pgy.status = status;
    const result = reconcileStoreBindings({
      storeId: `fictional-store-${status}`,
      selectedPlatforms: ['pgy'],
      collections: input,
      registry: null,
    });

    assert.equal(result.changed, false, status);
    assert.equal(result.registry.stores[`fictional-store-${status}`], undefined, status);
    assert.deepEqual(result.actualIdentities.pgy, [`pgy:fictional-brand-${status}`], status);
  }
});

test('only complete or verified-no-spend identities extend an existing store binding', () => {
  const initial = reconcileStoreBindings({
    storeId: 'fictional-store-mixed-readiness',
    selectedPlatforms: ['adstar'],
    collections: collections('mixed-readiness'),
    registry: null,
  });
  const input = collections('mixed-readiness');
  input.pgy.status = 'partial';
  input.juguang.status = 'verified_no_spend';
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-mixed-readiness',
    selectedPlatforms: ['pgy', 'juguang'],
    collections: input,
    registry: initial.registry,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.registry.stores['fictional-store-mixed-readiness'].platforms, {
    adstar: ['adstar:fictional-star-mixed-readiness'],
    juguang: [
      'juguang:fictional-brand-mixed-readiness:fictional-advertiser-mixed-readiness:4:main',
    ],
  });
  assert.equal(result.registry.stores['fictional-store-mixed-readiness'].platforms.pgy, undefined);
});

test('a partial main identity still detects mismatch without replacing a confirmed binding', () => {
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-partial-mismatch',
    selectedPlatforms: ['juguang'],
    collections: collections('confirmed'),
  });
  const nextCollections = collections('confirmed');
  nextCollections.juguang.status = 'partial';
  nextCollections.juguang.accounts[0].account.advertiserId = 'fictional-advertiser-new-main';
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-partial-mismatch',
    selectedPlatforms: ['juguang'],
    collections: nextCollections,
    registry: first.registry,
  });

  assert.equal(result.ready, false);
  assert.equal(result.changed, false);
  assert.equal(result.issues[0].code, 'account_binding_mismatch');
  assert.deepEqual(result.registry, first.registry);
});

test('a partial identity still detects a confirmed cross-store collision without binding', () => {
  const first = reconcileStoreBindings({
    storeId: 'fictional-store-collision-owner',
    selectedPlatforms: ['pgy'],
    collections: collections('collision'),
  });
  const partialCollections = collections('collision');
  partialCollections.pgy.status = 'partial';
  const result = reconcileStoreBindings({
    storeId: 'fictional-store-collision-candidate',
    selectedPlatforms: ['pgy'],
    collections: partialCollections,
    registry: first.registry,
  });

  assert.equal(result.ready, false);
  assert.equal(result.changed, false);
  assert.equal(result.issues[0].code, 'account_identity_bound_to_other_store');
  assert.equal(result.registry.stores['fictional-store-collision-candidate'], undefined);
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
