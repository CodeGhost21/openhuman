import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCoreStateSnapshot } from '../../lib/coreState/store';
import { store } from '../../store';
import { callCoreRpc } from '../coreRpcClient';
import { daemonHealthService } from '../daemonHealthService';

vi.mock('../coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

vi.mock('../../store', () => ({ store: { dispatch: vi.fn() } }));

vi.mock('../../lib/coreState/store', () => ({ getCoreStateSnapshot: vi.fn() }));

describe('DaemonHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(getCoreStateSnapshot).mockReturnValue({
      snapshot: { sessionToken: 'h.eyJ1c2VySWQiOiJ1MSJ9.s' },
    } as any);
  });

  afterEach(() => {
    daemonHealthService.cleanup();
    vi.useRealTimers();
  });

  it('sets up polling and timeout on start', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({
      pid: 123,
      updated_at: new Date().toISOString(),
      uptime_seconds: 10,
      components: { gateway: { status: 'ok', restart_count: 0, updated_at: '' } },
    });

    await daemonHealthService.setupHealthListener();

    expect(callCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.health_snapshot' });
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'daemon/updateHealthSnapshot' })
    );
  });

  it('triggers polling at intervals', async () => {
    vi.mocked(callCoreRpc).mockResolvedValue({
      pid: 123,
      updated_at: '',
      uptime_seconds: 1,
      components: {},
    });

    await daemonHealthService.setupHealthListener();
    expect(callCoreRpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(callCoreRpc).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    expect(callCoreRpc).toHaveBeenCalledTimes(3);
  });

  it('handles health timeout if no responses received', async () => {
    vi.mocked(callCoreRpc).mockRejectedValue(new Error('fail'));

    await daemonHealthService.setupHealthListener();

    vi.advanceTimersByTime(30000);

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'daemon/setDaemonStatus',
        payload: { userId: 'u1', status: 'disconnected' },
      })
    );
  });

  it('parses complex health snapshots correctly', async () => {
    const payload = {
      pid: 456,
      updated_at: '2023-01-01',
      uptime_seconds: 100,
      components: {
        comp1: { status: 'ok', restart_count: 1, updated_at: 'now' },
        comp2: { status: 'error', restart_count: 5, updated_at: 'then', last_error: 'boom' },
        bad: { status: 'invalid' },
      },
    };
    vi.mocked(callCoreRpc).mockResolvedValueOnce(payload);

    await daemonHealthService.setupHealthListener();

    const dispatchCall = vi
      .mocked(store.dispatch)
      .mock.calls.find(c => (c[0] as any).type === 'daemon/updateHealthSnapshot');
    const snapshot = (dispatchCall?.[0] as any).payload.healthSnapshot;

    expect(snapshot.pid).toBe(456);
    expect(snapshot.components.comp1.status).toBe('ok');
    expect(snapshot.components.comp2.status).toBe('error');
    expect(snapshot.components.bad).toBeUndefined();
  });

  it('cleans up resources', async () => {
    await daemonHealthService.setupHealthListener();
    daemonHealthService.cleanup();

    vi.advanceTimersByTime(2000);
    expect(callCoreRpc).toHaveBeenCalledTimes(1); // Only the initial call from setup
  });
});
