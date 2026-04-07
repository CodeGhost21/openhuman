/**
 * Extended tests for accessibilitySlice.ts
 * Covers uncovered lines: 207-308, 320-321 — specifically the rejected thunk cases
 * and requestAccessibilityPermission lifecycle.
 */
import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openhumanAccessibilityRequestPermission,
  openhumanAccessibilityRequestPermissions,
  openhumanAccessibilityStartSession,
  openhumanAccessibilityStatus,
  openhumanAccessibilityStopSession,
  restartCoreProcess,
} from '../../utils/tauriCommands';
import accessibilityReducer, {
  clearAccessibilityError,
  fetchAccessibilityStatus,
  refreshPermissionsWithRestart,
  requestAccessibilityPermission,
  requestAccessibilityPermissions,
  startAccessibilitySession,
  stopAccessibilitySession,
} from '../accessibilitySlice';

vi.mock('../../utils/tauriCommands', () => ({
  openhumanAccessibilityStatus: vi.fn(),
  openhumanAccessibilityRequestPermissions: vi.fn(),
  openhumanAccessibilityRequestPermission: vi.fn(),
  openhumanAccessibilityStartSession: vi.fn(),
  openhumanAccessibilityStopSession: vi.fn(),
  openhumanAccessibilityInputAction: vi.fn(),
  openhumanAccessibilityVisionRecent: vi.fn(),
  openhumanAccessibilityVisionFlush: vi.fn(),
  openhumanScreenIntelligenceCaptureTest: vi.fn(),
  restartCoreProcess: vi.fn(),
}));

const makeStatus = () => ({
  permissions: {
    screen_recording: 'granted' as const,
    accessibility: 'granted' as const,
    input_monitoring: 'granted' as const,
  },
  session: {
    active: false,
    consent: false,
    screen_monitoring: false,
    device_control: false,
    predictive_input: false,
    session_id: null,
    ttl_secs: null,
    started_at: null,
  },
});

function makeStore() {
  return configureStore({ reducer: { accessibility: accessibilityReducer } });
}

describe('accessibilitySlice thunks — rejected paths', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
  });

  describe('fetchAccessibilityStatus.rejected', () => {
    it('sets lastError and clears isLoading on rejection', async () => {
      vi.mocked(openhumanAccessibilityStatus).mockRejectedValueOnce(
        new Error('status fetch failed')
      );

      await store.dispatch(fetchAccessibilityStatus());

      const state = store.getState().accessibility;
      expect(state.isLoading).toBe(false);
      expect(state.lastError).toBe('status fetch failed');
    });

    it('uses fallback error text when error is not an Error instance', async () => {
      vi.mocked(openhumanAccessibilityStatus).mockRejectedValueOnce('plain string error');

      await store.dispatch(fetchAccessibilityStatus());

      const state = store.getState().accessibility;
      expect(state.lastError).toBe('plain string error');
    });
  });

  describe('requestAccessibilityPermissions.rejected', () => {
    it('clears isRequestingPermissions and sets lastError', async () => {
      vi.mocked(openhumanAccessibilityRequestPermissions).mockRejectedValueOnce(
        new Error('permissions denied')
      );

      await store.dispatch(requestAccessibilityPermissions());

      const state = store.getState().accessibility;
      expect(state.isRequestingPermissions).toBe(false);
      expect(state.lastError).toBe('permissions denied');
    });
  });

  describe('requestAccessibilityPermission (single) — full lifecycle', () => {
    it('sets isRequestingPermissions on pending', async () => {
      vi.mocked(openhumanAccessibilityRequestPermission).mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const promise = store.dispatch(requestAccessibilityPermission('screen_recording'));

      const pendingState = store.getState().accessibility;
      expect(pendingState.isRequestingPermissions).toBe(true);
      expect(pendingState.lastError).toBeNull();

      promise.catch(() => {});
    });

    it('updates status and clears isRequestingPermissions on fulfilled', async () => {
      const status = makeStatus();
      vi.mocked(openhumanAccessibilityRequestPermission).mockResolvedValueOnce(undefined);
      vi.mocked(openhumanAccessibilityStatus).mockResolvedValueOnce({ result: status, logs: [] });

      await store.dispatch(requestAccessibilityPermission('accessibility'));

      const state = store.getState().accessibility;
      expect(state.isRequestingPermissions).toBe(false);
      expect(state.status).toEqual(status);
      expect(state.lastError).toBeNull();
    });

    it('clears isRequestingPermissions and sets lastError on rejected', async () => {
      vi.mocked(openhumanAccessibilityRequestPermission).mockRejectedValueOnce(
        new Error('input monitoring denied')
      );

      await store.dispatch(requestAccessibilityPermission('input_monitoring'));

      const state = store.getState().accessibility;
      expect(state.isRequestingPermissions).toBe(false);
      expect(state.lastError).toBe('input monitoring denied');
    });
  });

  describe('startAccessibilitySession.rejected', () => {
    it('clears isStartingSession and sets lastError', async () => {
      vi.mocked(openhumanAccessibilityStartSession).mockRejectedValueOnce(
        new Error('session start failed')
      );

      await store.dispatch(startAccessibilitySession({ consent: true, screen_monitoring: true }));

      const state = store.getState().accessibility;
      expect(state.isStartingSession).toBe(false);
      expect(state.lastError).toBe('session start failed');
    });

    it('sets isStartingSession to true on pending', async () => {
      vi.mocked(openhumanAccessibilityStartSession).mockImplementation(() => new Promise(() => {}));

      const promise = store.dispatch(startAccessibilitySession({ consent: true }));

      const state = store.getState().accessibility;
      expect(state.isStartingSession).toBe(true);
      expect(state.lastError).toBeNull();

      promise.catch(() => {});
    });
  });

  describe('stopAccessibilitySession.rejected', () => {
    it('clears isStoppingSession and sets lastError', async () => {
      vi.mocked(openhumanAccessibilityStopSession).mockRejectedValueOnce(
        new Error('stop session failed')
      );

      await store.dispatch(stopAccessibilitySession('user_request'));

      const state = store.getState().accessibility;
      expect(state.isStoppingSession).toBe(false);
      expect(state.lastError).toBe('stop session failed');
    });

    it('sets isStoppingSession to true on pending', async () => {
      vi.mocked(openhumanAccessibilityStopSession).mockImplementation(() => new Promise(() => {}));

      const promise = store.dispatch(stopAccessibilitySession(undefined));

      const state = store.getState().accessibility;
      expect(state.isStoppingSession).toBe(true);

      promise.catch(() => {});
    });
  });

  describe('stopAccessibilitySession.fulfilled', () => {
    it('updates status on success', async () => {
      const status = makeStatus();
      vi.mocked(openhumanAccessibilityStopSession).mockResolvedValueOnce(undefined);
      vi.mocked(openhumanAccessibilityStatus).mockResolvedValueOnce({ result: status, logs: [] });

      await store.dispatch(stopAccessibilitySession('done'));

      const state = store.getState().accessibility;
      expect(state.isStoppingSession).toBe(false);
      expect(state.status).toEqual(status);
    });
  });

  describe('startAccessibilitySession.fulfilled', () => {
    it('updates status on success', async () => {
      const status = makeStatus();
      vi.mocked(openhumanAccessibilityStartSession).mockResolvedValueOnce(undefined);
      vi.mocked(openhumanAccessibilityStatus).mockResolvedValueOnce({ result: status, logs: [] });

      await store.dispatch(startAccessibilitySession({ consent: true, device_control: true }));

      const state = store.getState().accessibility;
      expect(state.isStartingSession).toBe(false);
      expect(state.status).toEqual(status);
    });
  });

  describe('refreshPermissionsWithRestart.rejected', () => {
    it('clears isRestartingCore and sets lastError', async () => {
      vi.mocked(restartCoreProcess).mockRejectedValueOnce(new Error('restart failed'));

      await store.dispatch(refreshPermissionsWithRestart());

      const state = store.getState().accessibility;
      expect(state.isRestartingCore).toBe(false);
      expect(state.lastError).toBe('restart failed');
    });
  });

  describe('clearAccessibilityError', () => {
    it('clears the lastError field', async () => {
      // Set an error first
      vi.mocked(openhumanAccessibilityStatus).mockRejectedValueOnce(new Error('test error'));
      await store.dispatch(fetchAccessibilityStatus());

      expect(store.getState().accessibility.lastError).toBe('test error');

      store.dispatch(clearAccessibilityError());

      expect(store.getState().accessibility.lastError).toBeNull();
    });
  });
});
