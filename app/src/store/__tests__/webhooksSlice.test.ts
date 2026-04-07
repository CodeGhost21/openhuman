import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import type { Tunnel } from '../../services/api/tunnelsApi';
import webhooksReducer, {
  addActivity,
  addTunnel,
  removeTunnel,
  setError,
  setLoading,
  setRegistrations,
  setTunnels,
  type TunnelRegistration,
  type WebhookActivityEntry,
} from '../webhooksSlice';

function createStore() {
  return configureStore({ reducer: { webhooks: webhooksReducer } });
}

const mockTunnel = (id = 't1'): Tunnel => ({
  id,
  uuid: `uuid-${id}`,
  name: `Tunnel ${id}`,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const mockRegistration = (tunnelUuid = 'uuid-t1'): TunnelRegistration => ({
  tunnel_uuid: tunnelUuid,
  skill_id: 'my-skill',
  tunnel_name: 'My Tunnel',
  backend_tunnel_id: 'bt1',
});

const mockActivity = (correlationId = 'corr-1'): WebhookActivityEntry => ({
  correlation_id: correlationId,
  tunnel_name: 'My Tunnel',
  method: 'POST',
  path: '/hook',
  status_code: 200,
  skill_id: 'my-skill',
  timestamp: Date.now(),
});

describe('webhooksSlice', () => {
  it('has correct initial state', () => {
    const store = createStore();
    const { webhooks } = store.getState();
    expect(webhooks.tunnels).toEqual([]);
    expect(webhooks.registrations).toEqual([]);
    expect(webhooks.activity).toEqual([]);
    expect(webhooks.loading).toBe(false);
    expect(webhooks.error).toBeNull();
  });

  describe('setTunnels', () => {
    it('replaces tunnels list, clears loading and error', () => {
      const store = createStore();
      store.dispatch(setLoading(true));
      store.dispatch(setError('old error'));
      store.dispatch(setTunnels([mockTunnel('t1'), mockTunnel('t2')]));
      const { webhooks } = store.getState();
      expect(webhooks.tunnels).toHaveLength(2);
      expect(webhooks.loading).toBe(false);
      expect(webhooks.error).toBeNull();
    });
  });

  describe('addTunnel', () => {
    it('appends a tunnel to the list', () => {
      const store = createStore();
      store.dispatch(addTunnel(mockTunnel('t1')));
      store.dispatch(addTunnel(mockTunnel('t2')));
      expect(store.getState().webhooks.tunnels).toHaveLength(2);
      expect(store.getState().webhooks.tunnels[1].id).toBe('t2');
    });
  });

  describe('removeTunnel', () => {
    it('removes tunnel by id', () => {
      const store = createStore();
      store.dispatch(setTunnels([mockTunnel('t1'), mockTunnel('t2'), mockTunnel('t3')]));
      store.dispatch(removeTunnel('t2'));
      const ids = store.getState().webhooks.tunnels.map(t => t.id);
      expect(ids).toEqual(['t1', 't3']);
    });

    it('is a no-op when id not found', () => {
      const store = createStore();
      store.dispatch(setTunnels([mockTunnel('t1')]));
      store.dispatch(removeTunnel('missing'));
      expect(store.getState().webhooks.tunnels).toHaveLength(1);
    });
  });

  describe('setRegistrations', () => {
    it('replaces registrations list', () => {
      const store = createStore();
      store.dispatch(setRegistrations([mockRegistration('uuid-a'), mockRegistration('uuid-b')]));
      expect(store.getState().webhooks.registrations).toHaveLength(2);
    });
  });

  describe('addActivity', () => {
    it('prepends activity entries (newest first)', () => {
      const store = createStore();
      const e1 = mockActivity('c1');
      const e2 = mockActivity('c2');
      store.dispatch(addActivity(e1));
      store.dispatch(addActivity(e2));
      const { activity } = store.getState().webhooks;
      expect(activity[0].correlation_id).toBe('c2');
      expect(activity[1].correlation_id).toBe('c1');
    });

    it('caps activity at 100 entries', () => {
      const store = createStore();
      for (let i = 0; i < 105; i++) {
        store.dispatch(addActivity(mockActivity(`c-${i}`)));
      }
      expect(store.getState().webhooks.activity).toHaveLength(100);
    });

    it('keeps the most recent entries when capping', () => {
      const store = createStore();
      for (let i = 0; i < 101; i++) {
        store.dispatch(addActivity(mockActivity(`c-${i}`)));
      }
      // The last dispatched is the newest (first in array after unshift)
      expect(store.getState().webhooks.activity[0].correlation_id).toBe('c-100');
    });
  });

  describe('setLoading', () => {
    it('sets loading flag', () => {
      const store = createStore();
      store.dispatch(setLoading(true));
      expect(store.getState().webhooks.loading).toBe(true);
      store.dispatch(setLoading(false));
      expect(store.getState().webhooks.loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error message and clears loading', () => {
      const store = createStore();
      store.dispatch(setLoading(true));
      store.dispatch(setError('fetch failed'));
      const { webhooks } = store.getState();
      expect(webhooks.error).toBe('fetch failed');
      expect(webhooks.loading).toBe(false);
    });

    it('clears error when null is passed', () => {
      const store = createStore();
      store.dispatch(setError('something'));
      store.dispatch(setError(null));
      expect(store.getState().webhooks.error).toBeNull();
    });
  });
});
