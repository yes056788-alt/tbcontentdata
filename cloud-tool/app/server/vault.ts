import { ApiError, requireObject } from "./http";

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function requireRecord(value: unknown, field: string) {
  return requireObject(value, `${field} 不是有效的加密账号库字段。`);
}

function requireBase64(value: unknown, field: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new ApiError(
      400,
      "INVALID_VAULT",
      `${field} 不是有效的加密字段。`,
    );
  }
}

export function validateEncryptedVault(value: unknown): Record<string, unknown> {
  const vault = requireRecord(value, "vault");
  const kdf = requireRecord(vault.kdf, "vault.kdf");
  const cipher = requireRecord(vault.cipher, "vault.cipher");

  if (
    vault.schema !== 1 ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    cipher.name !== "AES-GCM"
  ) {
    throw new ApiError(
      400,
      "INVALID_VAULT",
      "只接受客户端现有的 PBKDF2/AES-GCM 加密账号库。",
    );
  }
  if (
    !Number.isSafeInteger(kdf.iterations) ||
    Number(kdf.iterations) < 100_000 ||
    Number(kdf.iterations) > 2_000_000
  ) {
    throw new ApiError(400, "INVALID_VAULT", "vault.kdf.iterations 无效。");
  }
  requireBase64(kdf.salt, "vault.kdf.salt", 256);
  requireBase64(cipher.iv, "vault.cipher.iv", 256);
  requireBase64(cipher.data, "vault.cipher.data", 2_700_000);
  if (
    vault.updatedAt !== undefined &&
    (!Number.isSafeInteger(vault.updatedAt) || Number(vault.updatedAt) < 0)
  ) {
    throw new ApiError(400, "INVALID_VAULT", "vault.updatedAt 无效。");
  }
  return vault;
}
