/**
 * Extended tests for authSelectors.ts
 * Covers uncovered lines 10-12: edge cases for null userId,
 * missing encryptionKey, and missing hasIncompleteOnboarding.
 */
import { describe, expect, it } from 'vitest';

import {
  selectHasEncryptionKey,
  selectHasIncompleteOnboarding,
  selectIsOnboarded,
} from '../../store/authSelectors';
import type { RootState } from '../../store/index';

/** Build a minimal RootState fixture */
function makeState(overrides?: {
  userId?: string | null;
  isOnboardedByUser?: Record<string, boolean>;
  encryptionKeyByUser?: Record<string, string>;
  hasIncompleteOnboardingByUser?: Record<string, boolean>;
}): RootState {
  const userId = overrides?.userId !== undefined ? overrides.userId : 'user-123';
  return {
    auth: {
      token: null,
      isAuthBootstrapComplete: false,
      isOnboardedByUser: overrides?.isOnboardedByUser ?? {},
      onboardingTasksByUser: {},
      hasIncompleteOnboardingByUser: overrides?.hasIncompleteOnboardingByUser ?? {},
      isAnalyticsEnabledByUser: {},
      encryptionKeyByUser: overrides?.encryptionKeyByUser ?? {},
      primaryWalletAddressByUser: {},
    },
    user: {
      user: userId ? ({ _id: userId } as { _id: string }) : null,
      isLoading: false,
      error: null,
    },
    // Stub other slices minimally
  } as unknown as RootState;
}

describe('selectIsOnboarded', () => {
  it('returns false when user is null (no userId)', () => {
    const state = makeState({ userId: null });
    expect(selectIsOnboarded(state)).toBe(false);
  });

  it('returns false when userId is not in isOnboardedByUser', () => {
    const state = makeState({ userId: 'user-123', isOnboardedByUser: {} });
    expect(selectIsOnboarded(state)).toBe(false);
  });

  it('returns true when user is marked as onboarded', () => {
    const state = makeState({ userId: 'user-123', isOnboardedByUser: { 'user-123': true } });
    expect(selectIsOnboarded(state)).toBe(true);
  });

  it('returns false when user is explicitly marked as not onboarded', () => {
    const state = makeState({ userId: 'user-456', isOnboardedByUser: { 'user-456': false } });
    expect(selectIsOnboarded(state)).toBe(false);
  });

  it('returns false for a different userId than what is stored', () => {
    const state = makeState({ userId: 'user-999', isOnboardedByUser: { 'user-123': true } });
    expect(selectIsOnboarded(state)).toBe(false);
  });
});

describe('selectHasEncryptionKey', () => {
  it('returns false when user is null', () => {
    const state = makeState({ userId: null });
    expect(selectHasEncryptionKey(state)).toBe(false);
  });

  it('returns false when no encryption key exists for user', () => {
    const state = makeState({ userId: 'user-123', encryptionKeyByUser: {} });
    expect(selectHasEncryptionKey(state)).toBe(false);
  });

  it('returns true when encryption key exists for user', () => {
    const state = makeState({
      userId: 'user-123',
      encryptionKeyByUser: { 'user-123': 'deadbeef1234' },
    });
    expect(selectHasEncryptionKey(state)).toBe(true);
  });

  it('returns false when encryption key is an empty string', () => {
    const state = makeState({ userId: 'user-123', encryptionKeyByUser: { 'user-123': '' } });
    // Empty string is falsy
    expect(selectHasEncryptionKey(state)).toBe(false);
  });

  it('returns false for a different userId than what has a key', () => {
    const state = makeState({
      userId: 'user-999',
      encryptionKeyByUser: { 'user-123': 'deadbeef' },
    });
    expect(selectHasEncryptionKey(state)).toBe(false);
  });
});

describe('selectHasIncompleteOnboarding', () => {
  it('returns false when user is null', () => {
    const state = makeState({ userId: null });
    expect(selectHasIncompleteOnboarding(state)).toBe(false);
  });

  it('returns false when userId is not in hasIncompleteOnboardingByUser', () => {
    const state = makeState({ userId: 'user-123', hasIncompleteOnboardingByUser: {} });
    expect(selectHasIncompleteOnboarding(state)).toBe(false);
  });

  it('returns true when onboarding is incomplete', () => {
    const state = makeState({
      userId: 'user-123',
      hasIncompleteOnboardingByUser: { 'user-123': true },
    });
    expect(selectHasIncompleteOnboarding(state)).toBe(true);
  });

  it('returns false when onboarding is explicitly complete', () => {
    const state = makeState({
      userId: 'user-123',
      hasIncompleteOnboardingByUser: { 'user-123': false },
    });
    expect(selectHasIncompleteOnboarding(state)).toBe(false);
  });
});
