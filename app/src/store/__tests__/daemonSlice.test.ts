import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import daemonReducer, {
  type HealthSnapshot,
  incrementConnectionAttempts,
  resetConnectionAttempts,
  resetForUser,
  selectDaemonComponents,
  selectDaemonStatus,
  setAutoStartEnabled,
  setDaemonStatus,
  setIsRecovering,
  updateHealthSnapshot,
} from '../daemonSlice';

function createStore() {
  return configureStore({ reducer: { daemon: daemonReducer } });
}

describe('daemonSlice', () => {
  it('starts with empty byUser map', () => {
    const store = createStore();
    expect(store.getState().daemon.byUser).toEqual({});
  });

  it('sets status for a user', () => {
    const store = createStore();
    store.dispatch(setDaemonStatus({ userId: 'u1', status: 'starting' }));
    expect(store.getState().daemon.byUser.u1.status).toBe('starting');
  });

  it('clears snapshot when status is disconnected', () => {
    const store = createStore();
    const mockSnapshot: HealthSnapshot = {
      pid: 123,
      updated_at: new Date().toISOString(),
      uptime_seconds: 10,
      components: { gateway: { status: 'ok', restart_count: 0, updated_at: '' } },
    };

    store.dispatch(updateHealthSnapshot({ userId: 'u1', healthSnapshot: mockSnapshot }));
    expect(store.getState().daemon.byUser.u1.status).toBe('running');
    expect(store.getState().daemon.byUser.u1.healthSnapshot).not.toBeNull();

    store.dispatch(setDaemonStatus({ userId: 'u1', status: 'disconnected' }));
    expect(store.getState().daemon.byUser.u1.healthSnapshot).toBeNull();
    expect(store.getState().daemon.byUser.u1.components).toEqual({});
  });

  it('updates overall status based on component health', () => {
    const store = createStore();

    // All OK -> running
    store.dispatch(
      updateHealthSnapshot({
        userId: 'u1',
        healthSnapshot: {
          pid: 1,
          updated_at: '',
          uptime_seconds: 1,
          components: { c1: { status: 'ok', restart_count: 0, updated_at: '' } },
        },
      })
    );
    expect(store.getState().daemon.byUser.u1.status).toBe('running');

    // One error -> error
    store.dispatch(
      updateHealthSnapshot({
        userId: 'u1',
        healthSnapshot: {
          pid: 1,
          updated_at: '',
          uptime_seconds: 1,
          components: {
            c1: { status: 'ok', restart_count: 0, updated_at: '' },
            c2: { status: 'error', restart_count: 0, updated_at: '' },
          },
        },
      })
    );
    expect(store.getState().daemon.byUser.u1.status).toBe('error');

    // One starting -> starting (if no error)
    store.dispatch(
      updateHealthSnapshot({
        userId: 'u1',
        healthSnapshot: {
          pid: 1,
          updated_at: '',
          uptime_seconds: 1,
          components: {
            c1: { status: 'ok', restart_count: 0, updated_at: '' },
            c2: { status: 'starting', restart_count: 0, updated_at: '' },
          },
        },
      })
    );
    expect(store.getState().daemon.byUser.u1.status).toBe('starting');

    // Empty components -> disconnected
    store.dispatch(
      updateHealthSnapshot({
        userId: 'u1',
        healthSnapshot: { pid: 1, updated_at: '', uptime_seconds: 1, components: {} },
      })
    );
    expect(store.getState().daemon.byUser.u1.status).toBe('disconnected');
  });

  it('increments and resets connection attempts', () => {
    const store = createStore();
    store.dispatch(incrementConnectionAttempts({ userId: 'u1' }));
    store.dispatch(incrementConnectionAttempts({ userId: 'u1' }));
    expect(store.getState().daemon.byUser.u1.connectionAttempts).toBe(2);

    store.dispatch(resetConnectionAttempts({ userId: 'u1' }));
    expect(store.getState().daemon.byUser.u1.connectionAttempts).toBe(0);
  });

  it('sets autoStartEnabled and isRecovering', () => {
    const store = createStore();
    store.dispatch(setAutoStartEnabled({ userId: 'u1', enabled: true }));
    expect(store.getState().daemon.byUser.u1.autoStartEnabled).toBe(true);

    store.dispatch(setIsRecovering({ userId: 'u1', isRecovering: true }));
    expect(store.getState().daemon.byUser.u1.isRecovering).toBe(true);
  });

  it('resets user state', () => {
    const store = createStore();
    store.dispatch(setDaemonStatus({ userId: 'u1', status: 'running' }));
    store.dispatch(resetForUser({ userId: 'u1' }));
    expect(store.getState().daemon.byUser.u1.status).toBe('disconnected');
  });

  describe('selectors', () => {
    it('selectDaemonStatus returns status or disconnected for missing user', () => {
      const store = createStore();
      expect(selectDaemonStatus(store.getState())).toBe('disconnected');

      store.dispatch(setDaemonStatus({ userId: 'u1', status: 'running' }));
      expect(selectDaemonStatus(store.getState(), 'u1')).toBe('running');
    });

    it('selectDaemonComponents returns components', () => {
      const store = createStore();
      const mockSnapshot: HealthSnapshot = {
        pid: 123,
        updated_at: '',
        uptime_seconds: 10,
        components: { gateway: { status: 'ok', restart_count: 0, updated_at: '' } },
      };
      store.dispatch(updateHealthSnapshot({ userId: 'u1', healthSnapshot: mockSnapshot }));
      expect(selectDaemonComponents(store.getState(), 'u1')).toEqual(mockSnapshot.components);
    });
  });
});
