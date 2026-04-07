import { describe, expect, it } from 'vitest';

import { getCoreStateSnapshot, patchCoreStateSnapshot, setCoreStateSnapshot, type CoreState } from '../store';

function makeState(overrides: Partial<CoreState> = {}): CoreState {
  return {
    isBootstrapping: false,
    isReady: true,
    snapshot: {
      auth: { isAuthenticated: true, userId: 'u1', user: null, profileId: null },
      sessionToken: 'tok',
      currentUser: null,
      onboardingCompleted: false,
      analyticsEnabled: false,
      localState: { encryptionKey: null, primaryWalletAddress: null, onboardingTasks: null },
    },
    teams: [],
    teamMembersById: {},
    teamInvitesById: {},
    ...overrides,
  };
}

describe('getCoreStateSnapshot', () => {
  it('returns current state', () => {
    const state = getCoreStateSnapshot();
    expect(state).toBeDefined();
    expect(typeof state.isBootstrapping).toBe('boolean');
  });
});

describe('setCoreStateSnapshot', () => {
  it('replaces the entire state', () => {
    const next = makeState({ isReady: true, isBootstrapping: false });
    setCoreStateSnapshot(next);
    expect(getCoreStateSnapshot()).toBe(next);
  });
});

describe('patchCoreStateSnapshot', () => {
  it('merges top-level fields', () => {
    setCoreStateSnapshot(makeState({ isReady: false }));
    patchCoreStateSnapshot({ isReady: true });
    expect(getCoreStateSnapshot().isReady).toBe(true);
  });

  it('merges snapshot when provided', () => {
    setCoreStateSnapshot(makeState());
    patchCoreStateSnapshot({ snapshot: { onboardingCompleted: true } });
    expect(getCoreStateSnapshot().snapshot.onboardingCompleted).toBe(true);
    // Other snapshot fields are preserved
    expect(getCoreStateSnapshot().snapshot.auth.isAuthenticated).toBe(true);
  });

  it('merges nested localState within snapshot', () => {
    setCoreStateSnapshot(makeState());
    patchCoreStateSnapshot({
      snapshot: {
        localState: { encryptionKey: 'abc', primaryWalletAddress: null, onboardingTasks: null },
      },
    });
    expect(getCoreStateSnapshot().snapshot.localState.encryptionKey).toBe('abc');
    // Other localState fields preserved
    expect(getCoreStateSnapshot().snapshot.localState.primaryWalletAddress).toBeNull();
  });

  it('does not touch snapshot if not provided in patch', () => {
    const state = makeState();
    setCoreStateSnapshot(state);
    patchCoreStateSnapshot({ isBootstrapping: false });
    expect(getCoreStateSnapshot().snapshot).toEqual(state.snapshot);
  });

  it('preserves teams when not patching teams', () => {
    const teamEntry = { id: 't1', name: 'Team A', role: 'owner' as const };
    setCoreStateSnapshot(makeState({ teams: [teamEntry as never] }));
    patchCoreStateSnapshot({ isReady: true });
    expect(getCoreStateSnapshot().teams).toHaveLength(1);
  });
});
