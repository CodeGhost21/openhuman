import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMyInviteCodes = vi.fn();
const mockRedeemInviteCode = vi.fn();

vi.mock('../../services/api/inviteApi', () => ({
  inviteApi: {
    getMyInviteCodes: (...args: unknown[]) => mockGetMyInviteCodes(...args),
    redeemInviteCode: (...args: unknown[]) => mockRedeemInviteCode(...args),
  },
}));

const {
  default: inviteReducer,
  clearRedeemStatus,
  fetchInviteCodes,
  redeemCode,
} = await import('../inviteSlice');

function createStore() {
  return configureStore({ reducer: { invite: inviteReducer } });
}

const mockCode = {
  code: 'ABCD1234',
  isUsed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  usedAt: null,
  usedBy: null,
};

describe('inviteSlice', () => {
  beforeEach(() => {
    mockGetMyInviteCodes.mockReset();
    mockRedeemInviteCode.mockReset();
  });

  it('has correct initial state', () => {
    const store = createStore();
    const { invite } = store.getState();
    expect(invite.codes).toEqual([]);
    expect(invite.isLoading).toBe(false);
    expect(invite.error).toBeNull();
    expect(invite.redeemStatus).toBe('idle');
    expect(invite.redeemError).toBeNull();
  });

  describe('clearRedeemStatus', () => {
    it('resets redeemStatus and redeemError', () => {
      const store = createStore();
      // Prime the state via rejected action
      store.dispatch({ type: 'invite/redeemCode/rejected', payload: 'some error' });
      store.dispatch(clearRedeemStatus());
      const { invite } = store.getState();
      expect(invite.redeemStatus).toBe('idle');
      expect(invite.redeemError).toBeNull();
    });
  });

  describe('fetchInviteCodes', () => {
    it('sets isLoading true on pending', () => {
      const store = createStore();
      store.dispatch({ type: 'invite/fetchInviteCodes/pending' });
      expect(store.getState().invite.isLoading).toBe(true);
      expect(store.getState().invite.error).toBeNull();
    });

    it('populates codes and clears loading on fulfilled', async () => {
      mockGetMyInviteCodes.mockResolvedValue([mockCode]);
      const store = createStore();
      await store.dispatch(fetchInviteCodes());
      const { invite } = store.getState();
      expect(invite.isLoading).toBe(false);
      expect(invite.codes).toEqual([mockCode]);
      expect(invite.error).toBeNull();
    });

    it('sets error on rejected with API error object', async () => {
      mockGetMyInviteCodes.mockRejectedValue({ error: 'Unauthorized' });
      const store = createStore();
      await store.dispatch(fetchInviteCodes());
      const { invite } = store.getState();
      expect(invite.isLoading).toBe(false);
      expect(invite.error).toBe('Unauthorized');
    });

    it('uses fallback message when error is not an object with .error', async () => {
      mockGetMyInviteCodes.mockRejectedValue(new Error('network error'));
      const store = createStore();
      await store.dispatch(fetchInviteCodes());
      expect(store.getState().invite.error).toBe('Failed to fetch invite codes');
    });
  });

  describe('redeemCode', () => {
    it('sets redeemStatus loading on pending', () => {
      const store = createStore();
      store.dispatch({ type: 'invite/redeemCode/pending' });
      const { invite } = store.getState();
      expect(invite.redeemStatus).toBe('loading');
      expect(invite.redeemError).toBeNull();
    });

    it('sets redeemStatus success on fulfilled and re-fetches codes', async () => {
      mockRedeemInviteCode.mockResolvedValue({ message: 'Code redeemed' });
      mockGetMyInviteCodes.mockResolvedValue([mockCode]);
      const store = createStore();
      await store.dispatch(redeemCode('ABCD1234'));
      const { invite } = store.getState();
      expect(invite.redeemStatus).toBe('success');
      expect(mockRedeemInviteCode).toHaveBeenCalledWith('ABCD1234');
      // fetchInviteCodes also dispatched
      expect(mockGetMyInviteCodes).toHaveBeenCalledTimes(1);
    });

    it('sets redeemStatus error on rejected with API error object', async () => {
      mockRedeemInviteCode.mockRejectedValue({ error: 'Code already used' });
      const store = createStore();
      await store.dispatch(redeemCode('USED0000'));
      const { invite } = store.getState();
      expect(invite.redeemStatus).toBe('error');
      expect(invite.redeemError).toBe('Code already used');
    });

    it('uses fallback error message when error shape is unexpected', async () => {
      mockRedeemInviteCode.mockRejectedValue('something went wrong');
      const store = createStore();
      await store.dispatch(redeemCode('BAD'));
      expect(store.getState().invite.redeemError).toBe('Failed to redeem invite code');
    });
  });
});
