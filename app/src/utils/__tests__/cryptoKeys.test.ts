import { describe, expect, it } from 'vitest';

import {
  deriveAesKeyFromMnemonic,
  deriveEvmAddressFromMnemonic,
  generateMnemonicPhrase,
  validateMnemonicPhrase,
} from '../cryptoKeys';

describe('cryptoKeys', () => {
  const testMnemonic = 'test test test test test test test test test test test junk';

  it('generates a valid 12-word mnemonic', () => {
    const mnemonic = generateMnemonicPhrase();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validateMnemonicPhrase(mnemonic)).toBe(true);
  });

  it('validates a known good mnemonic', () => {
    expect(validateMnemonicPhrase(testMnemonic)).toBe(true);
  });

  it('invalidates a bad mnemonic', () => {
    expect(validateMnemonicPhrase('not a mnemonic at all')).toBe(false);
  });

  it('derives a deterministic AES key from mnemonic', () => {
    const key1 = deriveAesKeyFromMnemonic(testMnemonic);
    const key2 = deriveAesKeyFromMnemonic(testMnemonic);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // 32 bytes hex
  });

  it('derives a deterministic EVM address from mnemonic', () => {
    const addr = deriveEvmAddressFromMnemonic(testMnemonic);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Checksum verification (manual spot check or just repeat)
    const addr2 = deriveEvmAddressFromMnemonic(testMnemonic);
    expect(addr).toBe(addr2);
  });

  it('derived EVM address matches expected for known mnemonic', () => {
    // For "test test test test test test test test test test test junk"
    // the first account m/44'/60'/0'/0/0 is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    const addr = deriveEvmAddressFromMnemonic(testMnemonic);
    expect(addr).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
});
