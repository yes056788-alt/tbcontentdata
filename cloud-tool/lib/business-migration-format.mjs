const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export const BUSINESS_MIGRATION_FORMAT = "taobao-business-migration";
export const BUSINESS_MIGRATION_VERSION = 2;
// Cloudflare Workers currently caps WebCrypto PBKDF2 at 100,000 iterations.
// Migration passphrases are therefore deliberately much longer than login
// passwords and every package also uses a fresh, random 128-bit salt.
export const BUSINESS_MIGRATION_KDF_ITERATIONS = 100_000;
export const BUSINESS_MIGRATION_MAX_PASSPHRASE_LENGTH = 256;
export const BUSINESS_MIGRATION_MAX_RECORD_BYTES = 26 * 1024 * 1024;
export const BUSINESS_MIGRATION_MAX_LINE_BYTES = 40 * 1024 * 1024;
export const BUSINESS_MIGRATION_CATALOG_ALGORITHM = "SHA-256-CHAIN-V1";
export const BUSINESS_MIGRATION_CATALOG_SEED = "0".repeat(64);

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value, label = "base64") {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} is not valid base64.`);
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not valid base64.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyArrayBuffer(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function canonicalRecordAad(header, record) {
  return textEncoder.encode([
    BUSINESS_MIGRATION_FORMAT,
    header.version,
    record.index,
    record.kind,
    record.name,
  ].join("|"));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertSafeRecordName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 ||
      value.startsWith("/") || value.includes("\\") || value.includes("..") ||
      !/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error("Migration record name is invalid.");
  }
  return value;
}

function assertRecordKind(value) {
  if (!["vault", "directory", "run", "manifest"].includes(value)) {
    throw new Error("Migration record kind is invalid.");
  }
  return value;
}

export function validateMigrationPassphrase(value) {
  if (typeof value !== "string") {
    throw new Error("Migration passphrase must be a string.");
  }
  const length = Array.from(value).length;
  if (length < 20 || length > BUSINESS_MIGRATION_MAX_PASSPHRASE_LENGTH ||
      !/[a-z]/i.test(value) || !/\d/.test(value) || !/[^a-z0-9]/i.test(value)) {
    throw new Error("Migration passphrase must be 20-256 characters and include letters, numbers, and symbols.");
  }
  return value;
}

export function createMigrationHeader(createdAt = new Date()) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    type: "header",
    format: BUSINESS_MIGRATION_FORMAT,
    version: BUSINESS_MIGRATION_VERSION,
    createdAt: createdAt.toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: BUSINESS_MIGRATION_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      keyLength: 256,
      recordAad: "format|version|index|kind|name",
    },
  };
}

export function validateMigrationHeader(value) {
  const header = assertPlainObject(value, "Migration header");
  const kdf = assertPlainObject(header.kdf, "Migration KDF");
  const cipher = assertPlainObject(header.cipher, "Migration cipher");
  if (header.type !== "header" || header.format !== BUSINESS_MIGRATION_FORMAT ||
      header.version !== BUSINESS_MIGRATION_VERSION ||
      typeof header.createdAt !== "string" || !Number.isFinite(Date.parse(header.createdAt)) ||
      kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" ||
      kdf.iterations !== BUSINESS_MIGRATION_KDF_ITERATIONS ||
      base64ToBytes(kdf.salt, "Migration salt").byteLength !== 16 ||
      cipher.name !== "AES-GCM" || cipher.keyLength !== 256 ||
      cipher.recordAad !== "format|version|index|kind|name") {
    throw new Error("Migration header is unsupported or malformed.");
  }
  return header;
}

export async function deriveMigrationKey(passphrase, headerValue) {
  const header = validateMigrationHeader(headerValue);
  const validPassphrase = validateMigrationPassphrase(passphrase);
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(validPassphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: copyArrayBuffer(base64ToBytes(header.kdf.salt)),
      iterations: header.kdf.iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", copyArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexText(value) {
  return sha256HexBytes(textEncoder.encode(String(value)));
}

export async function encryptMigrationRecord(key, headerValue, descriptor, value) {
  const header = validateMigrationHeader(headerValue);
  const record = {
    type: "record",
    index: Number(descriptor?.index),
    kind: assertRecordKind(descriptor?.kind),
    name: assertSafeRecordName(descriptor?.name),
  };
  if (!Number.isSafeInteger(record.index) || record.index < 0 || record.index > 1_000_002) {
    throw new Error("Migration record index is invalid.");
  }
  const plaintext = textEncoder.encode(JSON.stringify(value));
  if (plaintext.byteLength > BUSINESS_MIGRATION_MAX_RECORD_BYTES) {
    throw new Error("Migration record exceeds the bounded plaintext limit.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: copyArrayBuffer(iv),
      additionalData: copyArrayBuffer(canonicalRecordAad(header, record)),
    },
    key,
    copyArrayBuffer(plaintext),
  );
  const envelope = {
    ...record,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
  const summary = {
    index: record.index,
    kind: record.kind,
    name: record.name,
    bytes: plaintext.byteLength,
    sha256: await sha256HexBytes(plaintext),
  };
  return { envelope, summary };
}

export async function decryptMigrationRecord(key, headerValue, envelopeValue) {
  const header = validateMigrationHeader(headerValue);
  const envelope = assertPlainObject(envelopeValue, "Migration record");
  const record = {
    type: envelope.type,
    index: Number(envelope.index),
    kind: assertRecordKind(envelope.kind),
    name: assertSafeRecordName(envelope.name),
  };
  if (record.type !== "record" || !Number.isSafeInteger(record.index) || record.index < 0) {
    throw new Error("Migration record envelope is invalid.");
  }
  const iv = base64ToBytes(envelope.iv, "Migration IV");
  const ciphertext = base64ToBytes(envelope.ciphertext, "Migration ciphertext");
  if (iv.byteLength !== 12 || ciphertext.byteLength < 16) {
    throw new Error("Migration record envelope is invalid.");
  }
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyArrayBuffer(iv),
        additionalData: copyArrayBuffer(canonicalRecordAad(header, record)),
      },
      key,
      copyArrayBuffer(ciphertext),
    ));
  } catch {
    throw new Error("Migration passphrase is incorrect or the package is damaged.");
  }
  let value;
  try {
    value = JSON.parse(textDecoder.decode(plaintext));
  } catch {
    throw new Error("Migration record plaintext is invalid JSON.");
  }
  return {
    descriptor: record,
    value,
    summary: {
      index: record.index,
      kind: record.kind,
      name: record.name,
      bytes: plaintext.byteLength,
      sha256: await sha256HexBytes(plaintext),
    },
  };
}

export function encodeMigrationLine(value) {
  return `${JSON.stringify(value)}\n`;
}

export function parseMigrationLine(value, lineNumber = 1) {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > BUSINESS_MIGRATION_MAX_LINE_BYTES) {
    throw new Error(`Migration line ${lineNumber} is invalid or too large.`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Migration line ${lineNumber} is invalid JSON.`);
  }
}

function canonicalCatalogSummary(value) {
  const summary = assertPlainObject(value, "Migration catalog summary");
  const index = Number(summary.index);
  const bytes = Number(summary.bytes);
  if (!Number.isSafeInteger(index) || index < 0 || index > 1_000_002 ||
      !["vault", "directory", "run"].includes(summary.kind) ||
      !Number.isSafeInteger(bytes) || bytes < 0 ||
      bytes > BUSINESS_MIGRATION_MAX_RECORD_BYTES ||
      typeof summary.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(summary.sha256)) {
    throw new Error("Migration catalog summary is invalid.");
  }
  return {
    index,
    kind: summary.kind,
    name: assertSafeRecordName(summary.name),
    bytes,
    sha256: summary.sha256,
  };
}

export async function appendMigrationCatalogHash(previousHash, summaryValue) {
  if (typeof previousHash !== "string" || !/^[a-f0-9]{64}$/.test(previousHash)) {
    throw new Error("Migration catalog chain is invalid.");
  }
  const summary = canonicalCatalogSummary(summaryValue);
  return sha256HexText(`${previousHash}\n${JSON.stringify(summary)}`);
}
