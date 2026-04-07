import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMe = vi.fn();

vi.mock('../../services/api/userApi', () => ({
  userApi: { getMe: (...args: unknown[]) => mockGetMe(...args) },
}));

const { default: userReducer, setUser, clearUser, fetchCurrentUser } = await import('../userSlice');

function createStore() {
  return configureStore({ reducer: { user: userReducer } });
}

const mockUser = {
  _id: 'user-1',
  username: 'alice',
  firstName: 'Alice',
  telegramId: 111,
  hasAccess: true,
  role: 'user',
  activeTeamId: 'team-1',
  subscription: { hasActiveSubscription: false, plan: 'FREE' },
} as Parameters<typeof setUser>[0];

describe('userSlice', () => {
  beforeEach(() => {
    mockGetMe.mockReset();
  });

  it('has correct initial state', () => {
    const store = createStore();
    const { user } = store.getState();
    expect(user.user).toBeNull();
    expect(user.isLoading).toBe(false);
    expect(user.error).toBeNull();
  });

  describe('setUser', () => {
    it('stores user and clears error', () => {
      const store = createStore();
      store.dispatch(setUser(mockUser));
      expect(store.getState().user.user?._id).toBe('user-1');
      expect(store.getState().user.error).toBeNull();
    });

    it('accepts null to clear user', () => {
      const store = createStore();
      store.dispatch(setUser(mockUser));
      store.dispatch(setUser(null));
      expect(store.getState().user.user).toBeNull();
    });
  });

  describe('clearUser', () => {
    it('resets user, error and loading', () => {
      const store = createStore();
      store.dispatch(setUser(mockUser));
      // force loading state via pending action
      store.dispatch({ type: 'user/fetchCurrentUser/pending' });
      store.dispatch(clearUser());
      const { user } = store.getState();
      expect(user.user).toBeNull();
      expect(user.error).toBeNull();
      expect(user.isLoading).toBe(false);
    });
  });

  describe('fetchCurrentUser', () => {
    it('sets isLoading on pending', () => {
      const store = createStore();
      store.dispatch({ type: 'user/fetchCurrentUser/pending' });
      expect(store.getState().user.isLoading).toBe(true);
      expect(store.getState().user.error).toBeNull();
    });

    it('stores user on fulfilled', async () => {
      mockGetMe.mockResolvedValue(mockUser);
      const store = createStore();
      await store.dispatch(fetchCurrentUser());
      const { user } = store.getState();
      expect(user.isLoading).toBe(false);
      expect(user.user?._id).toBe('user-1');
      expect(user.error).toBeNull();
    });

    it('sets error on rejection with {error: string} shape', async () => {
      mockGetMe.mockRejectedValue({ error: 'Unauthorized' });
      const store = createStore();
      await store.dispatch(fetchCurrentUser());
      const { user } = store.getState();
      expect(user.isLoading).toBe(false);
      expect(user.error).toBe('Unauthorized');
    });

    it('uses fallback error message on non-standard rejection', async () => {
      mockGetMe.mockRejectedValue('network gone');
      const store = createStore();
      await store.dispatch(fetchCurrentUser());
      expect(store.getState().user.error).toBe('Failed to fetch user data');
    });
  });
});
