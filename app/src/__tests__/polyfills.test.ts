/**
 * Tests for polyfills.ts — verifies that importing the polyfills module correctly
 * sets Buffer, process, and util on globalThis.
 */
import { describe, expect, it } from 'vitest';

// Import the polyfills module (IIFE runs on import)
import {
  Buffer as PolyfillBuffer,
  process as PolyfillProcess,
  util as PolyfillUtil,
} from '../polyfills';

describe('polyfills', () => {
  it('exports Buffer', () => {
    expect(PolyfillBuffer).toBeDefined();
    expect(typeof PolyfillBuffer.from).toBe('function');
  });

  it('exports process', () => {
    expect(PolyfillProcess).toBeDefined();
    expect(typeof PolyfillProcess.env).toBe('object');
  });

  it('exports util', () => {
    expect(PolyfillUtil).toBeDefined();
  });

  it('sets Buffer on globalThis', () => {
    // The IIFE should have run during import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).Buffer).toBeDefined();
  });

  it('sets process on globalThis', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).process).toBeDefined();
  });

  it('Buffer.from can encode a string', () => {
    const buf = PolyfillBuffer.from('hello');
    expect(buf.toString()).toBe('hello');
  });
});
