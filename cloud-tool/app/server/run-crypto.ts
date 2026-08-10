import { ApiError } from "./http";
import { runtimeValue } from "./runtime-config";

const DEV_ONLY_KEY_BASE64 =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const AAD = new TextEncoder().encode("taobao-shared-run-v1");

type RunEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
};

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

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
    throw new ApiError(
      500,
      "RUN_ENCRYPTION_INVALID",
      "历史归档加密配置无效，请联系管理员。",
    );
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function getEncryptionKey(request: Request) {
  const configured = runtimeValue("RUN_DATA_KEY");
  const encoded = configured?.trim() ||
    (isLocalRequest(request) ? DEV_ONLY_KEY_BASE64 : "");
  if (!encoded) {
    throw new ApiError(
      500,
      "RUN_ENCRYPTION_NOT_CONFIGURED",
      "服务器尚未配置历史归档加密密钥，请联系管理员。",
    );
  }
  const raw = base64ToBytes(encoded);
  if (raw.byteLength !== 32) {
    throw new ApiError(
      500,
      "RUN_ENCRYPTION_INVALID",
      "历史归档加密密钥必须是 base64 编码的 32 字节密钥。",
    );
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptRunPayload(
  plaintext: string,
  request: Request,
): Promise<string> {
  const key = await getEncryptionKey(request);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: RunEnvelope = {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(envelope);
}

export async function decryptRunPayload(
  stored: string,
  request: Request,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored) as unknown;
  } catch {
    throw new ApiError(
      503,
      "RUN_BODY_INVALID",
      "历史归档密文已损坏，请联系管理员。",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(
      503,
      "RUN_BODY_INVALID",
      "历史归档密文已损坏，请联系管理员。",
    );
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== "AES-GCM" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new ApiError(
      503,
      "RUN_BODY_INVALID",
      "历史归档密文格式无效，请联系管理员。",
    );
  }
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = base64ToBytes(envelope.iv);
    ciphertext = base64ToBytes(envelope.ciphertext);
  } catch {
    throw new ApiError(
      503,
      "RUN_BODY_INVALID",
      "历史归档密文格式无效，请联系管理员。",
    );
  }
  if (iv.byteLength !== 12 || ciphertext.byteLength < 16) {
    throw new ApiError(
      503,
      "RUN_BODY_INVALID",
      "历史归档密文格式无效，请联系管理员。",
    );
  }
  const key = await getEncryptionKey(request);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: AAD },
      key,
      toArrayBuffer(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new ApiError(
      503,
      "RUN_DECRYPT_FAILED",
      "历史归档无法解密，请确认服务器密钥未变更。",
    );
  }
}
