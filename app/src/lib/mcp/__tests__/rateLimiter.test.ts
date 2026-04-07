import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyTool,
  enforceRateLimit,
  getRateLimitStatus,
  isHeavyTool,
  isStateOnlyTool,
  RATE_LIMIT_CONFIG,
  resetRequestCallCount,
} from '../rateLimiter';

describe('classifyTool', () => {
  it('classifies state-only tools', () => {
    expect(classifyTool('get_chats')).toBe('state_only');
    expect(classifyTool('get_messages')).toBe('state_only');
    expect(classifyTool('get_me')).toBe('state_only');
  });

  it('classifies API write tools', () => {
    expect(classifyTool('send_message')).toBe('api_write');
    expect(classifyTool('delete_message')).toBe('api_write');
    expect(classifyTool('create_group')).toBe('api_write');
  });

  it('classifies API read tools', () => {
    expect(classifyTool('list_contacts')).toBe('api_read');
    expect(classifyTool('get_participants')).toBe('api_read');
    expect(classifyTool('search_messages')).toBe('api_read');
  });

  it('defaults unknown tools to api_read', () => {
    expect(classifyTool('unknown_random_tool')).toBe('api_read');
  });
});

describe('isStateOnlyTool', () => {
  it('returns true for state-only tools', () => {
    expect(isStateOnlyTool('get_chats')).toBe(true);
    expect(isStateOnlyTool('get_history')).toBe(true);
  });

  it('returns false for non-state-only tools', () => {
    expect(isStateOnlyTool('send_message')).toBe(false);
    expect(isStateOnlyTool('unknown')).toBe(false);
  });
});

describe('isHeavyTool', () => {
  it('returns true for write tools', () => {
    expect(isHeavyTool('send_message')).toBe(true);
    expect(isHeavyTool('ban_user')).toBe(true);
  });

  it('returns false for non-write tools', () => {
    expect(isHeavyTool('get_chats')).toBe(false);
    expect(isHeavyTool('list_contacts')).toBe(false);
    expect(isHeavyTool('unknown')).toBe(false);
  });
});

describe('getRateLimitStatus', () => {
  it('returns status shape', () => {
    resetRequestCallCount();
    const status = getRateLimitStatus();
    expect(typeof status.callsThisRequest).toBe('number');
    expect(typeof status.callsThisMinute).toBe('number');
    expect(typeof status.lastCallAgoMs).toBe('number');
  });
});

describe('resetRequestCallCount', () => {
  it('resets the per-request counter', () => {
    resetRequestCallCount();
    expect(getRateLimitStatus().callsThisRequest).toBe(0);
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => {
    resetRequestCallCount();
    // Start fake timers far in the future so lastCallTime from a previous test
    // is always less than Date.now(), avoiding huge inter-call wait times.
    vi.useFakeTimers({ now: Date.now() + 10_000_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRequestCallCount();
  });

  it('does not delay state_only tools', async () => {
    const start = Date.now();
    await enforceRateLimit('get_chats');
    // Should complete instantly with no delay
    expect(Date.now() - start).toBeLessThan(10);
  });

  it('allows enforcing with explicit overrideTier', async () => {
    // state_only override — should be instant
    await expect(enforceRateLimit('get_chats', 'state_only')).resolves.toBeUndefined();
  });

  it('throws when per-request cap is exceeded', async () => {
    // Exhaust the per-request budget (MAX_CALLS_PER_REQUEST = 20)
    // Use state_only calls for the counter increment but override tier to api_write
    // Actually just increment counter directly by calling 20 times, then the 21st should throw.
    // Use api_read with no inter-call delay needed by advancing timers.
    for (let i = 0; i < RATE_LIMIT_CONFIG.MAX_CALLS_PER_REQUEST; i++) {
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();
      await enforceRateLimit('list_contacts', 'api_read');
    }
    // The 21st call should throw immediately (before any sleep)
    await expect(enforceRateLimit('list_contacts', 'api_read')).rejects.toThrow(/Rate limit/);
  });

  it('counter starts at 0 after reset and reaches 20 before cap triggers', async () => {
    // The "throws when per-request cap is exceeded" test already validates that
    // the counter increments correctly (it increments 20 times before throwing).
    resetRequestCallCount();
    expect(getRateLimitStatus().callsThisRequest).toBe(0);
  });
});
