(function () {
  'use strict';

  const ITERATIONS = 310000;
  const AAD = new TextEncoder().encode('taobao-account-vault-v1');

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  }

  async function deriveKeyMaterial(passphrase, salt, iterations, usages) {
    const sourceKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(passphrase || '')),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    }, sourceKey, 256);
    const bytes = new Uint8Array(bits);
    const sessionKey = bytesToBase64(bytes);
    const key = await crypto.subtle.importKey(
      'raw',
      bytes,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
    bytes.fill(0);
    return { key, sessionKey };
  }

  function parseRecord(record) {
    if (!record || record.schema !== 1 || !record.kdf || !record.cipher ||
        record.kdf.name !== 'PBKDF2' || record.kdf.hash !== 'SHA-256' ||
        record.cipher.name !== 'AES-GCM') {
      throw new Error('invalid vault');
    }
    const iterations = Number(record.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 150000 || iterations > 1000000) {
      throw new Error('invalid vault');
    }
    return {
      iterations,
      salt: base64ToBytes(record.kdf.salt),
      iv: base64ToBytes(record.cipher.iv),
      ciphertext: base64ToBytes(record.cipher.data),
    };
  }

  async function encryptForSession(value, passphrase) {
    if (String(passphrase || '').length < 8) throw new Error('主密码至少需要 8 位。');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await deriveKeyMaterial(passphrase, salt, ITERATIONS, ['encrypt']);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      material.key,
      plaintext
    );
    return {
      sessionKey: material.sessionKey,
      record: {
        schema: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: ITERATIONS,
          salt: bytesToBase64(salt),
        },
        cipher: {
          name: 'AES-GCM',
          iv: bytesToBase64(iv),
          data: bytesToBase64(new Uint8Array(ciphertext)),
        },
        updatedAt: Date.now(),
      },
    };
  }

  async function encrypt(value, passphrase) {
    return (await encryptForSession(value, passphrase)).record;
  }

  async function open(record, passphrase) {
    try {
      const parsed = parseRecord(record);
      const material = await deriveKeyMaterial(
        passphrase,
        parsed.salt,
        parsed.iterations,
        ['decrypt']
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: parsed.iv, additionalData: AAD },
        material.key,
        parsed.ciphertext
      );
      const value = JSON.parse(new TextDecoder().decode(plaintext));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid payload');
      return { value, sessionKey: material.sessionKey };
    } catch (error) {
      throw new Error('主密码错误或账号库已损坏。');
    }
  }

  async function decrypt(record, passphrase) {
    return (await open(record, passphrase)).value;
  }

  window.TaobaoAccountVault = Object.freeze({ encrypt, encryptForSession, open, decrypt });
})();
