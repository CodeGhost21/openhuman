/**
 * Extended tests for useDaemonHealth hook
 * Covers formatRelativeTime edge cases and additional hook paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// formatRelativeTime is exported — import directly
import { formatRelativeTime } from '../useDaemonHealth';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns seconds ago for differences < 60 seconds', () => {
    const now = new Date('2024-01-01T12:00:30Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('30s ago');
  });

  it('returns 0s ago for very recent timestamps', () => {
    const now = new Date('2024-01-01T12:00:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('0s ago');
  });

  it('returns minutes ago for differences between 60s and 1 hour', () => {
    const now = new Date('2024-01-01T12:05:30Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    // 330 seconds = 5 minutes
    expect(formatRelativeTime(isoString)).toBe('5m ago');
  });

  it('returns exactly 1m ago for 60-second difference', () => {
    const now = new Date('2024-01-01T12:01:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('1m ago');
  });

  it('returns hours ago for differences between 1 hour and 1 day', () => {
    const now = new Date('2024-01-01T15:00:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    // 3 hours
    expect(formatRelativeTime(isoString)).toBe('3h ago');
  });

  it('returns exactly 1h ago for exactly 3600 seconds', () => {
    const now = new Date('2024-01-01T13:00:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('1h ago');
  });

  it('returns days ago for differences >= 1 day', () => {
    const now = new Date('2024-01-03T12:00:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    // 2 days
    expect(formatRelativeTime(isoString)).toBe('2d ago');
  });

  it('returns 1d ago for exactly 86400 seconds', () => {
    const now = new Date('2024-01-02T12:00:00Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('1d ago');
  });

  it('handles 59 seconds correctly (below the minute threshold)', () => {
    const now = new Date('2024-01-01T12:00:59Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(isoString)).toBe('59s ago');
  });

  it('handles 3599 seconds correctly (below the hour threshold)', () => {
    const now = new Date('2024-01-01T12:59:59Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    // 3599 seconds = 59 minutes
    expect(formatRelativeTime(isoString)).toBe('59m ago');
  });

  it('handles 86399 seconds correctly (below the day threshold)', () => {
    const now = new Date('2024-01-02T11:59:59Z');
    vi.setSystemTime(now);

    const isoString = new Date('2024-01-01T12:00:00Z').toISOString();
    // 86399 seconds = 23 hours
    expect(formatRelativeTime(isoString)).toBe('23h ago');
  });
});
