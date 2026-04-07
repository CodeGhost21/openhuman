import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resolves with the promise value when it settles before timeout', async () => {
    const p = Promise.resolve(42);
    const result = await withTimeout(p, 1000, 'test');
    expect(result).toBe(42);
  });

  it('rejects when the operation exceeds the timeout', async () => {
    const never = new Promise<never>(() => {});
    const racePromise = withTimeout(never, 500, 'slow operation');
    vi.advanceTimersByTime(501);
    await expect(racePromise).rejects.toThrow(/slow operation timed out after 1s/);
  });

  it('includes a human-friendly seconds value in the error message', async () => {
    const never = new Promise<never>(() => {});
    const racePromise = withTimeout(never, 5000, 'my task');
    vi.advanceTimersByTime(5001);
    await expect(racePromise).rejects.toThrow('my task timed out after 5s');
  });

  it('bypasses timeout when timeoutMs is 0', async () => {
    // Should return the promise without any race
    const p = Promise.resolve('immediate');
    const result = await withTimeout(p, 0, 'no-op');
    expect(result).toBe('immediate');
  });

  it('bypasses timeout when timeoutMs is negative', async () => {
    const p = Promise.resolve('neg');
    const result = await withTimeout(p, -100, 'negative');
    expect(result).toBe('neg');
  });

  it('propagates rejection from the original promise', async () => {
    const failing = Promise.reject(new Error('original error'));
    await expect(withTimeout(failing, 1000, 'test')).rejects.toThrow('original error');
  });

  it('clears the timer after promise resolves', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('done'), 1000, 'cleanup-test');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
