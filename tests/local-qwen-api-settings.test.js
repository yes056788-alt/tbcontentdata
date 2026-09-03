const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const modulePromise = import('../web-tool/qwen-api-settings.mjs');

const API_KEY = 'sk-test-browser-openai-key-that-must-never-leak';
const ORIGIN = 'http://127.0.0.1:3400';

function request(method, body, cookie, origin = ORIGIN) {
  return new Request(ORIGIN + '/api/openai-settings', {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body),
  });
}

function cookiePair(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

test('local tool saves only an encrypted HttpOnly API cookie and never returns the key', async () => {
  const { createLocalQwenApiSettings } = await modulePromise;
  const settings = createLocalQwenApiSettings({
    env: {},
    encryptionKey: new Uint8Array(32).fill(7),
  });

  const saved = await settings.handle(request('PUT', { apiKey: API_KEY }));
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.deepEqual(savedBody, {
    configured: true,
    managedByTool: true,
    needsReentry: false,
  });
  const setCookie = String(saved.headers.get('set-cookie') || '');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api/);
  assert.match(setCookie, /Max-Age=2592000/, 'one tool save remains valid for 30 days');
  assert.match(setCookie, /Expires=/);
  assert.doesNotMatch(setCookie, /; Secure(?:;|$)/);
  assert.doesNotMatch(setCookie, new RegExp(API_KEY));
  assert.doesNotMatch(JSON.stringify(savedBody), new RegExp(API_KEY));

  const cookie = cookiePair(saved);
  const status = await settings.handle(request('GET', undefined, cookie));
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), savedBody);
  assert.deepEqual(await settings.resolveApiKey(request('GET', undefined, cookie)), {
    state: 'valid',
    apiKey: API_KEY,
  });

  const savedAgain = await settings.handle(request('PUT', { apiKey: API_KEY }));
  assert.notEqual(cookiePair(savedAgain), cookie, 'AES-GCM must use a fresh IV for every save');

  const maximum = await settings.handle(request('PUT', { apiKey: 'x'.repeat(512) }));
  assert.ok(String(maximum.headers.get('set-cookie') || '').length < 4096);

  const cleared = await settings.handle(request('DELETE', {} , cookie));
  assert.equal(cleared.status, 200);
  assert.match(String(cleared.headers.get('set-cookie') || ''), /Max-Age=0/);
  assert.deepEqual(await cleared.json(), {
    configured: false,
    managedByTool: false,
    needsReentry: false,
  });
});

test('local cookie encryption key persists securely across server restarts', async (t) => {
  const { loadOrCreateLocalEncryptionKey, createLocalQwenApiSettings } = await modulePromise;
  const directory = await mkdtemp(path.join(tmpdir(), 'tb-openai-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, 'runtime', 'openai-cookie.key');

  const firstKey = await loadOrCreateLocalEncryptionKey(keyPath);
  const firstSettings = createLocalQwenApiSettings({ env: {}, encryptionKey: firstKey });
  const saved = await firstSettings.handle(request('PUT', { apiKey: API_KEY }));
  const cookie = cookiePair(saved);

  const secondKey = await loadOrCreateLocalEncryptionKey(keyPath);
  const secondSettings = createLocalQwenApiSettings({ env: {}, encryptionKey: secondKey });
  assert.deepEqual(secondKey, firstKey);
  assert.equal((await readFile(keyPath)).byteLength, 32);
  if (process.platform !== 'win32') {
    assert.equal((await stat(keyPath)).mode & 0o077, 0);
  }
  assert.deepEqual(await secondSettings.resolveApiKey(request('GET', undefined, cookie)), {
    state: 'valid',
    apiKey: API_KEY,
  });
});

test('local API settings reject cross-origin, malformed and unknown-field writes', async () => {
  const { createLocalQwenApiSettings } = await modulePromise;
  const settings = createLocalQwenApiSettings({
    env: {},
    encryptionKey: new Uint8Array(32).fill(9),
  });

  const crossOrigin = await settings.handle(request(
    'PUT', { apiKey: API_KEY }, '', 'https://evil.example'
  ));
  assert.equal(crossOrigin.status, 403);

  const short = await settings.handle(request('PUT', { apiKey: 'short' }));
  assert.equal(short.status, 400);

  const unknown = await settings.handle(request('PUT', {
    apiKey: API_KEY,
    model: 'unbounded-expensive-model',
  }));
  assert.equal(unknown.status, 400);
  assert.equal(JSON.stringify(await unknown.json()).includes(API_KEY), false);

  const tooLong = await settings.handle(request('PUT', { apiKey: 'x'.repeat(513) }));
  assert.equal(tooLong.status, 400);
});

test('local API settings report an environment fallback without exposing it', async () => {
  const { createLocalQwenApiSettings } = await modulePromise;
  const settings = createLocalQwenApiSettings({
    env: { OPENAI_API_KEY: API_KEY },
    encryptionKey: new Uint8Array(32).fill(3),
  });
  const response = await settings.handle(request('GET'));
  const body = await response.json();
  assert.deepEqual(body, {
    configured: true,
    managedByTool: false,
    needsReentry: false,
  });
  assert.equal(JSON.stringify(body).includes(API_KEY), false);
});

test('an invalid browser cookie fails closed instead of consuming the environment key', async () => {
  const { createLocalQwenApiSettings } = await modulePromise;
  const settings = createLocalQwenApiSettings({
    env: { OPENAI_API_KEY: API_KEY },
    encryptionKey: new Uint8Array(32).fill(5),
  });
  const invalidCookie = 'tb_openai_api_key=damaged-ciphertext';
  const resolution = await settings.resolveApiKey(request('GET', undefined, invalidCookie));
  assert.equal(resolution.state, 'invalid');

  const status = await settings.handle(request('GET', undefined, invalidCookie));
  assert.deepEqual(await status.json(), {
    configured: false,
    managedByTool: false,
    needsReentry: true,
  });
  assert.equal(status.headers.get('set-cookie'), null,
    'invalid state must keep blocking subsequent batches until explicit PUT or DELETE');
});
