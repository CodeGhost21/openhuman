import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  decryptIntegrationTokens,
  encryptIntegrationTokens,
  hexToBase64,
  hexToBytes,
} from '../integrationTokensCrypto';

// 32 bytes = 64 hex chars — valid AES-256 key
const VALID_KEY_HEX = '0'.repeat(64);

const VALID_PAYLOAD = JSON.stringify({
  accessToken: 'access_abc',
  refreshToken: 'refresh_xyz',
  expiresAt: '2026-12-31T00:00:00.000Z',
});

describe('hexToBytes', () => {
  it('converts a lowercase hex string to bytes', () => {
    const bytes = hexToBytes('deadbeef');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('converts an uppercase hex string', () => {
    const bytes = hexToBytes('DEADBEEF');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('strips 0x prefix', () => {
    const bytes = hexToBytes('0xff00');
    expect(bytes).toEqual(new Uint8Array([0xff, 0x00]));
  });

  it('returns empty Uint8Array for empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array());
  });

  it('throws on odd-length hex string', () => {
    expect(() => hexToBytes('abc')).toThrow(/even length/);
  });

  it('throws on invalid hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow(/\[0-9a-fA-F\]/);
  });
});

describe('hexToBase64', () => {
  it('converts hex to base64', () => {
    const b64 = hexToBase64('deadbeef');
    expect(b64).toBe(btoa('\xde\xad\xbe\xef'));
  });

  it('returns empty string for empty hex', () => {
    expect(hexToBase64('')).toBe('');
  });
});

describe('base64ToBytes', () => {
  it('decodes standard base64', () => {
    // btoa('\xde\xad\xbe\xef') = '3q2+7w=='
    const bytes = base64ToBytes(btoa('\xde\xad\xbe\xef'));
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles URL-safe base64 by replacing - and _', () => {
    // standard: +/ → URL: -_
    const standard = btoa('\xfb\xff'); // produces '+/8=' or similar
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const bytes = base64ToBytes(urlSafe);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('handles base64 strings missing padding (pad=2 case)', () => {
    // A 2-byte base64 input needs == padding
    const noPad = btoa('AB').slice(0, -2); // remove ==
    expect(() => base64ToBytes(noPad)).not.toThrow();
  });

  it('handles base64 strings with 3-char remainder (pad=3 case)', () => {
    const noPad = btoa('ABC').slice(0, -1); // remove one =
    expect(() => base64ToBytes(noPad)).not.toThrow();
  });
});

describe('encryptIntegrationTokens + decryptIntegrationTokens (round-trip)', () => {
  it('encrypts and decrypts back to original plaintext', async () => {
    const encrypted = await encryptIntegrationTokens(VALID_PAYLOAD, VALID_KEY_HEX);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = await decryptIntegrationTokens(encrypted, VALID_KEY_HEX);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(VALID_PAYLOAD));
  });

  it('is deterministic — same plaintext + key always produce same ciphertext', async () => {
    const enc1 = await encryptIntegrationTokens(VALID_PAYLOAD, VALID_KEY_HEX);
    const enc2 = await encryptIntegrationTokens(VALID_PAYLOAD, VALID_KEY_HEX);
    expect(enc1).toBe(enc2);
  });
});

describe('encryptIntegrationTokens', () => {
  it('throws when key is not 32 bytes', async () => {
    await expect(encryptIntegrationTokens(VALID_PAYLOAD, '0'.repeat(30))).rejects.toThrow(
      /32-byte/
    );
  });

  it('throws when plaintext is not valid JSON', async () => {
    await expect(encryptIntegrationTokens('not json', VALID_KEY_HEX)).rejects.toThrow(/JSON/);
  });

  it('throws when JSON does not have expiresAt field', async () => {
    const noExpiry = JSON.stringify({ accessToken: 'abc', refreshToken: 'def' });
    await expect(encryptIntegrationTokens(noExpiry, VALID_KEY_HEX)).rejects.toThrow(/expiresAt/);
  });

  it('throws when expiresAt is empty', async () => {
    const emptyExpiry = JSON.stringify({ accessToken: 'a', refreshToken: 'b', expiresAt: '  ' });
    await expect(encryptIntegrationTokens(emptyExpiry, VALID_KEY_HEX)).rejects.toThrow(/expiresAt/);
  });
});

describe('decryptIntegrationTokens', () => {
  it('throws when key is not 32 bytes', async () => {
    const encrypted = await encryptIntegrationTokens(VALID_PAYLOAD, VALID_KEY_HEX);
    await expect(decryptIntegrationTokens(encrypted, '0'.repeat(30))).rejects.toThrow(/32-byte/);
  });

  it('throws on payload too short to contain iv + tag', async () => {
    // base64 of 10 bytes = too short (needs at least 33 bytes)
    const tooShort = btoa('1234567890');
    await expect(decryptIntegrationTokens(tooShort, VALID_KEY_HEX)).rejects.toThrow(/too short/);
  });

  it('throws when decrypting with a different key', async () => {
    const encrypted = await encryptIntegrationTokens(VALID_PAYLOAD, VALID_KEY_HEX);
    const differentKey = 'f'.repeat(64);
    await expect(decryptIntegrationTokens(encrypted, differentKey)).rejects.toThrow();
  });
});
