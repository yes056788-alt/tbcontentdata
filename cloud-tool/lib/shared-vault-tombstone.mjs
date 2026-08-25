export const SHARED_VAULT_TOMBSTONE_PAYLOAD = JSON.stringify({
  type: "taobao-shared-vault-tombstone",
  version: 1,
  deleted: true,
});

export function isSharedVaultTombstonePayload(value) {
  return value === SHARED_VAULT_TOMBSTONE_PAYLOAD;
}
