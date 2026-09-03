import { webcrypto } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export { DEFAULT_OPENAI_MODEL, DEFAULT_QWEN_MODEL } from './qwen-search-classifier.mjs';

const COOKIE_NAME = 'tb_openai_api_key';
const COOKIE_PATH = '/api';
const COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_BODY_BYTES = 8_192;
const MAX_API_KEY_LENGTH = 512;
const AAD = new TextEncoder().encode('tb-openai-api-key-cookie:v1:local');
const LOCAL_ORIGINS = new Set([
  'http://127.0.0.1:3400',
  'http://localhost:3400',
]);

class SettingsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Cookie, Origin',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function errorResponse(error) {
  if (error instanceof SettingsError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return json({
    error: {
      code: 'OPENAI_SETTINGS_UNAVAILABLE',
      message: 'OpenAI API Key 设置暂时不可用，请稍后重试。',
    },
  }, 500);
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value || '')) throw new Error('invalid base64url');
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function validatedApiKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > MAX_API_KEY_LENGTH ||
      !/^[\x21-\x7E]+$/u.test(value)) {
    throw new SettingsError(400, 'INVALID_API_KEY', '请输入 8 到 512 个可见字符的 OpenAI API Key，不能包含空格。');
  }
  return value;
}

function environmentApiKey(env) {
  const value = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY : '';
  try {
    return value ? validatedApiKey(value) : '';
  } catch {
    return '';
  }
}

function cookieValues(request) {
  const header = String(request.headers.get('cookie') || '');
  if (!header) return [];
  return header.split(';').map((part) => part.trim()).flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator) !== COOKIE_NAME) return [];
    return [part.slice(separator + 1)];
  });
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=${COOKIE_PATH}; Max-Age=0; ` +
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict';
}

function allowedRequestOrigin(request) {
  try {
    return LOCAL_ORIGINS.has(new URL(request.url).origin);
  } catch {
    return false;
  }
}

function requireTrustedWrite(request) {
  if (!allowedRequestOrigin(request) ||
      String(request.headers.get('origin') || '') !== new URL(request.url).origin) {
    throw new SettingsError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任。');
  }
}

async function readBody(request, allowEmpty = false) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new SettingsError(413, 'PAYLOAD_TOO_LARGE', '请求内容不能超过 8192 字节。');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new SettingsError(413, 'PAYLOAD_TOO_LARGE', '请求内容不能超过 8192 字节。');
  }
  if (!text && allowEmpty) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SettingsError(400, 'INVALID_JSON', '请求内容不是有效的 JSON。');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SettingsError(400, 'INVALID_BODY', '请求内容必须是 JSON 对象。');
  }
  return body;
}

function encryptionBytes(value) {
  if (value == null) return webcrypto.getRandomValues(new Uint8Array(32));
  const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
  if (bytes.byteLength !== 32) throw new Error('OpenAI cookie encryption key must contain 32 bytes');
  return bytes;
}

export async function loadOrCreateLocalEncryptionKey(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('OpenAI cookie encryption key path is required');
  }
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(filePath, 'wx', 0o600);
    try {
      const bytes = webcrypto.getRandomValues(new Uint8Array(32));
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) {
    throw new Error('Local OpenAI cookie encryption key file is invalid');
  }
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    await chmod(filePath, 0o600);
  }
  const bytes = new Uint8Array(await readFile(filePath));
  if (bytes.byteLength !== 32) {
    throw new Error('Local OpenAI cookie encryption key file is invalid');
  }
  return bytes;
}

export function createLocalQwenApiSettings(options = {}) {
  const env = options.env || process.env;
  const keyPromise = webcrypto.subtle.importKey(
    'raw', encryptionBytes(options.encryptionKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );

  async function createCookie(apiKey) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const expiresAt = Date.now() + COOKIE_LIFETIME_SECONDS * 1000;
    const plaintext = new TextEncoder().encode(JSON.stringify({
      version: 1,
      expiresAt,
      apiKey,
    }));
    const ciphertext = await webcrypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: AAD,
      tagLength: 128,
    }, await keyPromise, plaintext);
    const value = `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
    return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; Max-Age=${COOKIE_LIFETIME_SECONDS}; ` +
      `Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`;
  }

  async function resolveApiKey(request) {
    const values = cookieValues(request);
    if (values.length === 0) return { state: 'absent' };
    if (values.length !== 1) return { state: 'invalid' };
    try {
      const parts = values[0].split('.');
      if (parts.length !== 2) throw new Error('invalid envelope');
      const iv = base64UrlDecode(parts[0]);
      const ciphertext = base64UrlDecode(parts[1]);
      if (iv.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > 2048) {
        throw new Error('invalid envelope');
      }
      const plaintext = await webcrypto.subtle.decrypt({
        name: 'AES-GCM',
        iv,
        additionalData: AAD,
        tagLength: 128,
      }, await keyPromise, ciphertext);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).sort()
        : [];
      if (keys.join(',') !== 'apiKey,expiresAt,version' || payload.version !== 1 ||
          !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now() ||
          payload.expiresAt > Date.now() + (COOKIE_LIFETIME_SECONDS + 60) * 1000) {
        throw new Error('invalid payload');
      }
      return { state: 'valid', apiKey: validatedApiKey(payload.apiKey) };
    } catch {
      return { state: 'invalid' };
    }
  }

  async function handle(request) {
    try {
      if (!allowedRequestOrigin(request)) {
        throw new SettingsError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任。');
      }
      if (request.method === 'GET') {
        const resolution = await resolveApiKey(request);
        if (resolution.state === 'invalid') {
          return json({ configured: false, managedByTool: false, needsReentry: true });
        }
        return json({
          configured: resolution.state === 'valid' || Boolean(environmentApiKey(env)),
          managedByTool: resolution.state === 'valid',
          needsReentry: false,
        });
      }
      if (request.method === 'PUT') {
        requireTrustedWrite(request);
        const body = await readBody(request);
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'apiKey')) {
          throw new SettingsError(400, 'INVALID_BODY', '请求只支持 apiKey 字段。');
        }
        const apiKey = validatedApiKey(body.apiKey);
        return json({ configured: true, managedByTool: true, needsReentry: false }, 200, {
          'Set-Cookie': await createCookie(apiKey),
        });
      }
      if (request.method === 'DELETE') {
        requireTrustedWrite(request);
        const body = await readBody(request, true);
        if (Object.keys(body).length) {
          throw new SettingsError(400, 'INVALID_BODY', '清除请求不能包含字段。');
        }
        return json({
          configured: Boolean(environmentApiKey(env)),
          managedByTool: false,
          needsReentry: false,
        }, 200, { 'Set-Cookie': clearCookie() });
      }
      throw new SettingsError(405, 'METHOD_NOT_ALLOWED', '该接口不支持当前请求方法。');
    } catch (error) {
      return errorResponse(error);
    }
  }

  return Object.freeze({ handle, resolveApiKey });
}
