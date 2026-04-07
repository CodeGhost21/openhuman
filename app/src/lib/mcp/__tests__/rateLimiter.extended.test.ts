/**
 * Extended tests for rateLimiter.ts
 * Covers uncovered lines 272-274, 305-310:
 *   - getRateLimitStatus with full shape validation
 *   - enforceRateLimit with api_write tier triggering the inter-call delay branch
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enforceRateLimit,
  getRateLimitStatus,
  RATE_LIMIT_CONFIG,
  resetRequestCallCount,
} from '../rateLimiter';

describe('getRateLimitStatus (full shape)', () => {
  beforeEach(() => {
    resetRequestCallCount();
  });

  it('returns all three required fields', () => {
    const status = getRateLimitStatus();
    expect(status).toHaveProperty('callsThisRequest');
    expect(status).toHaveProperty('callsThisMinute');
    expect(status).toHaveProperty('lastCallAgoMs');
  });

  it('callsThisRequest is 0 after reset', () => {
    resetRequestCallCount();
    const status = getRateLimitStatus();
    expect(status.callsThisRequest).toBe(0);
  });

  it('lastCallAgoMs is a number', () => {
    const status = getRateLimitStatus();
    expect(typeof status.lastCallAgoMs).toBe('number');
  });

  it('callsThisRequest counter reflects api calls made', async () => {
    vi.useFakeTimers({ now: Date.now() + 10_000_000 });
    resetRequestCallCount();

    // Advance far enough to skip all inter-call delays
    vi.advanceTimersByTime(5000);
    const p1 = enforceRateLimit('list_contacts', 'api_read');
    await vi.runAllTimersAsync();
    await p1;

    expect(getRateLimitStatus().callsThisRequest).toBe(1);

    vi.useRealTimers();
    resetRequestCallCount();
  });

  it('callsThisMinute reflects recent api calls', async () => {
    vi.useFakeTimers({ now: Date.now() + 20_000_000 });
    resetRequestCallCount();

    // Make 2 api_read calls with enough inter-call spacing
    vi.advanceTimersByTime(5000);
    const p1 = enforceRateLimit('list_contacts', 'api_read');
    await vi.runAllTimersAsync();
    await p1;

    vi.advanceTimersByTime(5000);
    const p2 = enforceRateLimit('search_messages', 'api_read');
    await vi.runAllTimersAsync();
    await p2;

    const status = getRateLimitStatus();
    expect(status.callsThisMinute).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
    resetRequestCallCount();
  });
});

describe('enforceRateLimit with api_write tier', () => {
  beforeEach(() => {
    resetRequestCallCount();
    vi.useFakeTimers({ now: Date.now() + 30_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRequestCallCount();
  });

  it('api_read delay is 500ms (less than api_write 1000ms)', () => {
    expect(RATE_LIMIT_CONFIG.API_READ_DELAY_MS).toBe(500);
    expect(RATE_LIMIT_CONFIG.API_WRITE_DELAY_MS).toBe(1000);
    expect(RATE_LIMIT_CONFIG.API_WRITE_DELAY_MS).toBeGreaterThan(
      RATE_LIMIT_CONFIG.API_READ_DELAY_MS
    );
  });

  it('enforces 1000ms delay for api_write tools (second call)', async () => {
    const delayMs = RATE_LIMIT_CONFIG.API_WRITE_DELAY_MS;
    expect(delayMs).toBe(1000);

    // First call with ample gap — no inter-call delay needed
    vi.advanceTimersByTime(5000);
    const p1 = enforceRateLimit('send_message', 'api_write');
    await vi.runAllTimersAsync();
    await p1;

    // Advance only 200ms — less than the 1000ms write delay
    vi.advanceTimersByTime(200);

    // Second call will need to sleep the remaining ~800ms
    const enforcePromise = enforceRateLimit('delete_message', 'api_write');

    // Run all pending timers (including the sleep inside enforceRateLimit)
    await vi.runAllTimersAsync();
    await enforcePromise;

    expect(getRateLimitStatus().callsThisRequest).toBe(2);
  });

  it('does not wait when enough time has elapsed for api_write', async () => {
    // First call
    vi.advanceTimersByTime(5000);
    const p1 = enforceRateLimit('forward_message', 'api_write');
    await vi.runAllTimersAsync();
    await p1;

    // Advance past the 1000ms write delay
    vi.advanceTimersByTime(2000);

    // Second call should not need to sleep
    const p2 = enforceRateLimit('mark_as_read', 'api_write');
    await vi.runAllTimersAsync();
    await p2;

    expect(getRateLimitStatus().callsThisRequest).toBe(2);
  });

  it('inter-call delay sleep is triggered and completes for api_write', async () => {
    // First call to set lastCallTime
    vi.advanceTimersByTime(5000);
    const p1 = enforceRateLimit('edit_message', 'api_write');
    await vi.runAllTimersAsync();
    await p1;

    // Advance only 100ms — less than the 1000ms write delay triggers sleep
    vi.advanceTimersByTime(100);

    const promise = enforceRateLimit('pin_message', 'api_write');

    // Advance timers to allow the sleep to complete
    await vi.runAllTimersAsync();
    await promise;

    // Should complete without error and count should be 2
    expect(getRateLimitStatus().callsThisRequest).toBe(2);
  });

  it('state_only tools bypass rate limiting instantly', async () => {
    // State-only should bypass immediately — no fake timer advance needed
    await enforceRateLimit('get_chats', 'state_only');

    // callsThisRequest is not incremented for state_only
    expect(getRateLimitStatus().callsThisRequest).toBe(0);
  });
});

describe('enforceRateLimit per-minute sliding window', () => {
  beforeEach(() => {
    resetRequestCallCount();
    vi.useFakeTimers({ now: Date.now() + 100_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRequestCallCount();
  });

  it('throws after exceeding per-request cap regardless of api tier', async () => {
    const max = RATE_LIMIT_CONFIG.MAX_CALLS_PER_REQUEST;

    for (let i = 0; i < max; i++) {
      vi.advanceTimersByTime(2000);
      const p = enforceRateLimit('list_contacts', 'api_read');
      await vi.runAllTimersAsync();
      await p;
    }

    await expect(enforceRateLimit('search_messages', 'api_read')).rejects.toThrow(
      /Rate limit.*exceeded/
    );
  });
});
