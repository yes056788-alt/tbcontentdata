import { ApiError } from "./http.ts";

export { DEFAULT_QWEN_MODEL } from "./qwen-classification.ts";

export const QWEN_API_KEY_COOKIE_NAME = "tb_qwen_api_key";
export const QWEN_API_KEY_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const QWEN_CREDENTIAL_VERSION_HEADER = "X-Qwen-Credential-Version";

const COOKIE_PATH = "/api";
const MAX_COOKIE_VALUE_CHARACTERS = 3_800;
const CREDENTIAL_VERSION_BYTES = 16;
const CREDENTIAL_VERSION_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const HKDF_SALT = new TextEncoder().encode(
  "tb-content-data/qwen-api-key-cookie/hkdf-salt/v1",
);
const HKDF_INFO = new TextEncoder().encode(
  "tb-content-data/qwen-api-key-cookie/aes-gcm/v1",
);
const HKDF_CREDENTIAL_VERSION_INFO = new TextEncoder().encode(
  "tb-content-data/qwen-credential-version/hmac-sha256/v1",
);
const AAD_PURPOSE = "tb-content-data/qwen-api-key-cookie/v1";
const CREDENTIAL_VERSION_PURPOSE =
  "tb-content-data/qwen-credential-version/v1";

type CookieEnvelope = {
  version: 1;
  expiresAt: number;
  iv: string;
  ciphertext: string;
};

type CookiePayload = {
  version: 1;
  subject: string;
  expiresAt: number;
  apiKey: string;
};

type CookieCryptoOptions = {
  encryptionKey?: string;
  nowSeconds?: number;
};

export type QwenCredentialSource = "tool-cookie" | "server-environment";

export type QwenApiKeyCookieState =
  | { state: "absent" }
  | { state: "valid"; apiKey: string; expiresAt: number }
  | { state: "invalid" };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.hasOwn(value, key)
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new ApiError(
      503,
      "QWEN_COOKIE_ENCRYPTION_INVALID",
      "千问 API 配置加密密钥无效，请联系管理员。",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytesToBase64(bytes) !== value) {
    throw new ApiError(
      503,
      "QWEN_COOKIE_ENCRYPTION_INVALID",
      "千问 API 配置加密密钥无效，请联系管理员。",
    );
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("invalid base64url");
  }
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const bytes = base64ToBytes(
    value.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  if (bytesToBase64Url(bytes) !== value) {
    throw new Error("non-canonical base64url");
  }
  return bytes;
}

function nowInSeconds(options: CookieCryptoOptions): number {
  const value = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(
      500,
      "QWEN_COOKIE_CLOCK_INVALID",
      "服务器时间配置无效，请联系管理员。",
    );
  }
  return value;
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validatedSubject(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    containsAsciiControl(value)
  ) {
    throw new ApiError(
      500,
      "QWEN_COOKIE_SUBJECT_INVALID",
      "当前成员标识无效，请重新登录。",
    );
  }
  return value;
}

export function validatedQwenApiKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[!-~]{8,512}$/u.test(value)
  ) {
    throw new ApiError(
      400,
      "INVALID_QWEN_API_KEY",
      "千问 API Key 必须是 8 到 512 个不含空格的可见字符。",
    );
  }
  return value;
}

async function importedHkdfRoot(
  options: CookieCryptoOptions,
): Promise<CryptoKey> {
  const encoded = options.encryptionKey?.trim();
  if (!encoded) {
    throw new ApiError(
      503,
      "QWEN_COOKIE_ENCRYPTION_NOT_CONFIGURED",
      "服务器尚未配置千问 API Key 加密密钥，请联系管理员。",
    );
  }
  const raw = base64ToBytes(encoded);
  if (raw.byteLength !== 32) {
    throw new ApiError(
      503,
      "QWEN_COOKIE_ENCRYPTION_INVALID",
      "千问 API 配置加密密钥必须是 base64 编码的 32 字节密钥。",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    "HKDF",
    false,
    ["deriveKey"],
  );
}

async function derivedEncryptionKey(
  options: CookieCryptoOptions,
): Promise<CryptoKey> {
  const root = await importedHkdfRoot(options);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(HKDF_SALT),
      info: toArrayBuffer(HKDF_INFO),
    },
    root,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function derivedCredentialVersionKey(
  options: CookieCryptoOptions,
): Promise<CryptoKey> {
  const root = await importedHkdfRoot(options);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(HKDF_SALT),
      info: toArrayBuffer(HKDF_CREDENTIAL_VERSION_INFO),
    },
    root,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

function validCredentialSource(
  value: string,
): value is QwenCredentialSource {
  return value === "tool-cookie" || value === "server-environment";
}

function constantTimeVersionMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createQwenCredentialVersion(
  sourceValue: QwenCredentialSource,
  apiKeyValue: string,
  options: CookieCryptoOptions = {},
): Promise<string> {
  if (!validCredentialSource(sourceValue) || !apiKeyValue) {
    throw new ApiError(
      503,
      "QWEN_CONFIGURATION_INVALID",
      "千问服务凭据配置无效。",
    );
  }
  const key = await derivedCredentialVersionKey(options);
  const input = new TextEncoder().encode(JSON.stringify({
    version: 1,
    purpose: CREDENTIAL_VERSION_PURPOSE,
    source: sourceValue,
    apiKey: apiKeyValue,
  }));
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(input),
  ));
  return bytesToBase64Url(signature.subarray(0, CREDENTIAL_VERSION_BYTES));
}

export function assertQwenCredentialVersionMatches(
  presentedVersion: string | null,
  currentVersion: string,
): void {
  if (presentedVersion === null) return;
  const matches = CREDENTIAL_VERSION_PATTERN.test(presentedVersion) &&
    CREDENTIAL_VERSION_PATTERN.test(currentVersion) &&
    constantTimeVersionMatch(presentedVersion, currentVersion);
  if (!matches) {
    throw new ApiError(
      409,
      "MODEL_CREDENTIAL_CHANGED",
      "千问分类凭据已变化，请重新开始本次取数。",
    );
  }
}

export function withQwenCredentialVersionHeader(
  response: Response,
  credentialVersion: string | undefined,
): Response {
  if (!credentialVersion) return response;
  if (!CREDENTIAL_VERSION_PATTERN.test(credentialVersion)) {
    throw new ApiError(
      500,
      "QWEN_CREDENTIAL_VERSION_INVALID",
      "千问分类凭据版本生成失败。",
    );
  }
  const headers = new Headers(response.headers);
  headers.set(QWEN_CREDENTIAL_VERSION_HEADER, credentialVersion);
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function additionalData(subject: string, expiresAt: number): Uint8Array {
  return new TextEncoder().encode(
    `${AAD_PURPOSE}\u0000${subject}\u0000${expiresAt}`,
  );
}

function cookieValues(request: Request): string[] {
  const header = request.headers.get("cookie") ?? "";
  const output: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== QWEN_API_KEY_COOKIE_NAME) continue;
    output.push(part.slice(separator + 1).trim());
  }
  return output;
}

function encodeEnvelope(envelope: CookieEnvelope): string {
  return bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
}

function decodeEnvelope(value: string): CookieEnvelope {
  if (value.length > MAX_COOKIE_VALUE_CHARACTERS) {
    throw new Error("cookie too large");
  }
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(value)),
  ) as unknown;
  if (
    !isObject(parsed) ||
    !hasExactKeys(parsed, ["version", "expiresAt", "iv", "ciphertext"]) ||
    parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.expiresAt) ||
    typeof parsed.iv !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("invalid envelope");
  }
  return parsed as CookieEnvelope;
}

function decodePayload(value: ArrayBuffer): CookiePayload {
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(value),
  ) as unknown;
  if (
    !isObject(parsed) ||
    !hasExactKeys(parsed, ["version", "subject", "expiresAt", "apiKey"]) ||
    parsed.version !== 1 ||
    typeof parsed.subject !== "string" ||
    !Number.isSafeInteger(parsed.expiresAt) ||
    typeof parsed.apiKey !== "string"
  ) {
    throw new Error("invalid payload");
  }
  return parsed as CookiePayload;
}

export async function createQwenApiKeyCookie(
  apiKeyValue: unknown,
  subjectValue: string,
  options: CookieCryptoOptions = {},
): Promise<string> {
  const apiKey = validatedQwenApiKey(apiKeyValue);
  const subject = validatedSubject(subjectValue);
  const now = nowInSeconds(options);
  const expiresAt = now + QWEN_API_KEY_COOKIE_MAX_AGE_SECONDS;
  const key = await derivedEncryptionKey(options);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: CookiePayload = {
    version: 1,
    subject,
    expiresAt,
    apiKey,
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData(subject, expiresAt)),
    },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const encoded = encodeEnvelope({
    version: 1,
    expiresAt,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  });
  if (encoded.length > MAX_COOKIE_VALUE_CHARACTERS) {
    throw new ApiError(
      500,
      "QWEN_COOKIE_TOO_LARGE",
      "千问 API 配置超过浏览器安全存储上限。",
    );
  }
  return [
    `${QWEN_API_KEY_COOKIE_NAME}=${encoded}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${QWEN_API_KEY_COOKIE_MAX_AGE_SECONDS}`,
    `Expires=${new Date(expiresAt * 1_000).toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function clearQwenApiKeyCookie(): string {
  return [
    `${QWEN_API_KEY_COOKIE_NAME}=`,
    `Path=${COOKIE_PATH}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export async function qwenApiKeyFromRequest(
  request: Request,
  subjectValue: string,
  options: CookieCryptoOptions = {},
): Promise<QwenApiKeyCookieState> {
  const values = cookieValues(request);
  if (values.length === 0) return { state: "absent" };
  if (values.length !== 1 || !values[0]) return { state: "invalid" };

  try {
    const subject = validatedSubject(subjectValue);
    const envelope = decodeEnvelope(values[0]);
    const now = nowInSeconds(options);
    if (
      envelope.expiresAt <= now ||
      envelope.expiresAt > now + QWEN_API_KEY_COOKIE_MAX_AGE_SECONDS
    ) {
      return { state: "invalid" };
    }
    const iv = base64UrlToBytes(envelope.iv);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      return { state: "invalid" };
    }
    const key = await derivedEncryptionKey(options);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(
          additionalData(subject, envelope.expiresAt),
        ),
      },
      key,
      toArrayBuffer(ciphertext),
    );
    const payload = decodePayload(plaintext);
    if (
      payload.subject !== subject ||
      payload.expiresAt !== envelope.expiresAt
    ) {
      return { state: "invalid" };
    }
    const apiKey = validatedQwenApiKey(payload.apiKey);
    return { state: "valid", apiKey, expiresAt: payload.expiresAt };
  } catch {
    return { state: "invalid" };
  }
}
