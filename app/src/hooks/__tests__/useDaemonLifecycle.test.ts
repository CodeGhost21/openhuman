import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { isTauri } from '../../utils/tauriCommands';
import { useDaemonHealth } from '../useDaemonHealth';
import { useDaemonLifecycle } from '../useDaemonLifecycle';

vi.mock('../../store/hooks', () => ({ useAppDispatch: vi.fn(), useAppSelector: vi.fn() }));

vi.mock('../useDaemonHealth', () => ({ useDaemonHealth: vi.fn() }));

vi.mock('../../utils/tauriCommands', () => ({ isTauri: vi.fn() }));

describe('useDaemonLifecycle', () => {
  const mockDispatch = vi.fn();
  const mockStartDaemon = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(useAppDispatch).mockReturnValue(mockDispatch);
    vi.mocked(useDaemonHealth).mockReturnValue({ startDaemon: mockStartDaemon } as any);
    vi.mocked(isTauri).mockReturnValue(true);
  });

  const setupSelectors = (overrides = {}) => {
    vi.mocked(useAppSelector).mockImplementation(selector => {
      const state = {
        daemon: {
          byUser: {
            u1: {
              status: 'disconnected',
              autoStartEnabled: true,
              connectionAttempts: 0,
              isRecovering: false,
              ...overrides,
            },
          },
        },
      };
      return selector(state);
    });
  };

  it('attempts auto-start on mount after delay', async () => {
    setupSelectors();
    mockStartDaemon.mockResolvedValue({ result: { state: 'Running' } });

    renderHook(() => useDaemonLifecycle('u1'));

    expect(mockStartDaemon).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3000); // AUTO_START_DELAY_MS
    });

    expect(mockStartDaemon).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'daemon/setIsRecovering' })
    );
  });

  it('schedules retry on error status', async () => {
    setupSelectors({ status: 'error', connectionAttempts: 1 });
    mockStartDaemon.mockResolvedValue({ result: { state: 'Running' } });

    renderHook(() => useDaemonLifecycle('u1'));

    await act(async () => {
      vi.advanceTimersByTime(5000); // More than BASE_RETRY_DELAY_MS * 2
    });

    expect(mockStartDaemon).toHaveBeenCalled();
  });

  it('stops retrying after MAX_RECONNECTION_ATTEMPTS', async () => {
    setupSelectors({ status: 'disconnected', connectionAttempts: 5 });

    const { result } = renderHook(() => useDaemonLifecycle('u1'));

    expect(result.current.maxAttemptsReached).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockStartDaemon).not.toHaveBeenCalled();
  });

  it('resets attempts when daemon becomes healthy', () => {
    setupSelectors({ status: 'running', connectionAttempts: 2 });

    renderHook(() => useDaemonLifecycle('u1'));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'daemon/resetConnectionAttempts', payload: { userId: 'u1' } })
    );
  });

  it('does nothing when not in Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    setupSelectors();

    renderHook(() => useDaemonLifecycle('u1'));

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockStartDaemon).not.toHaveBeenCalled();
  });
});
