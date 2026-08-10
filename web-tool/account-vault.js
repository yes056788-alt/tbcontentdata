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

  async function deriveKey(passphrase, salt, iterations, usages) {
    const sourceKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(passphrase || '')),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    }, sourceKey, { name: 'AES-GCM', length: 256 }, false, usages);
  }

  async function encrypt(value, passphrase) {
    if (String(passphrase || '').length < 8) throw new Error('主密码至少需要 8 位。');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS, ['encrypt']);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plaintext);
    return {
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
    };
  }

  async function decrypt(record, passphrase) {
    try {
      if (!record || record.schema !== 1 || record.kdf.name !== 'PBKDF2' ||
          record.kdf.hash !== 'SHA-256' || record.cipher.name !== 'AES-GCM') {
        throw new Error('invalid vault');
      }
      const salt = base64ToBytes(record.kdf.salt);
      const iv = base64ToBytes(record.cipher.iv);
      const ciphertext = base64ToBytes(record.cipher.data);
      const key = await deriveKey(passphrase, salt, Number(record.kdf.iterations), ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: AAD },
        key,
        ciphertext
      );
      const value = JSON.parse(new TextDecoder().decode(plaintext));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid payload');
      return value;
    } catch (error) {
      throw new Error('主密码错误或账号库已损坏。');
    }
  }

  window.TaobaoAccountVault = Object.freeze({ encrypt, decrypt });
})();
