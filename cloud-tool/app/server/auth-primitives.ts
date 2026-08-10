export const PASSWORD_ITERATIONS = 100_000;
export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_MILLISECONDS = 15 * 60 * 1000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.byteLength, right.byteLength);
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function passwordMeetsPolicy(value: string) {
  const length = Array.from(value).length;
  return (
    length >= 16 &&
    length <= 256 &&
    /[a-z]/i.test(value) &&
    /\d/.test(value) &&
    /[^a-z0-9]/i.test(value)
  );
}

export function nextLoginFailureState(
  failedLoginAttempts: number,
  previousLockedUntilMs: number | null,
  nowMs: number,
) {
  const lockExpired =
    previousLockedUntilMs !== null && previousLockedUntilMs <= nowMs;
  const attempts = Math.max(
    0,
    (lockExpired ? 0 : failedLoginAttempts) + 1,
  );
  return {
    attempts,
    lockedUntilMs:
      attempts >= LOGIN_FAILURE_LIMIT
        ? nowMs + LOGIN_LOCK_MILLISECONDS
        : null,
  };
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltCopy.buffer,
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordBytes(password, salt, PASSWORD_ITERATIONS);
  return {
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  saltBase64: string,
  expectedHashBase64: string,
  iterations: number,
) {
  const salt = base64ToBytes(saltBase64);
  const expected = base64ToBytes(expectedHashBase64);
  if (
    salt.byteLength < 16 ||
    expected.byteLength !== 32 ||
    !Number.isSafeInteger(iterations) ||
    iterations !== PASSWORD_ITERATIONS
  ) {
    return false;
  }
  const actual = await derivePasswordBytes(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

export function createOpaqueSessionToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function secureTextEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  return constantTimeEqual(
    new Uint8Array(leftHash),
    new Uint8Array(rightHash),
  );
}
