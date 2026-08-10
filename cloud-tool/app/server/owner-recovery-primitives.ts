import { secureTextEqual, sha256Hex } from "./auth-primitives.ts";

export const OWNER_RECOVERY_CODE_MIN_LENGTH = 43;
export const OWNER_RECOVERY_CODE_MAX_LENGTH = 43;

export function canonicalRecoveryTokenHash(value: string) {
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

export function recoverySecretMeetsPolicy(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || new Set(value).size < 10) {
    return false;
  }
  try {
    const encoded = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
    if (bytes.byteLength !== 32) return false;
    const canonical = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return canonical === value;
  } catch {
    return false;
  }
}

export async function recoveryCodeMatchesHash(
  value: unknown,
  expectedHash: string,
) {
  const code = typeof value === "string" ? value.trim() : "";
  const validCode = recoverySecretMeetsPolicy(code);
  const candidateHash = await sha256Hex(validCode ? code : "A".repeat(43));
  const canonicalExpected = canonicalRecoveryTokenHash(expectedHash);
  const matches = await secureTextEqual(
    candidateHash,
    canonicalExpected ?? "0".repeat(64),
  );
  return (
    validCode &&
    canonicalExpected !== null &&
    matches
  );
}
