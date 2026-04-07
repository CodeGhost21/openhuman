import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { formatRelativeTime } from '../useDaemonHealth';

vi.mock('../../store/hooks', () => ({ useAppDispatch: vi.fn(), useAppSelector: vi.fn() }));

vi.mock('../../utils/tauriCommands', () => ({
  openhumanAgentServerStatus: vi.fn(),
  openhumanServiceStart: vi.fn(),
  openhumanServiceStop: vi.fn(),
  openhumanServiceStatus: vi.fn(),
  isTauri: vi.fn(() => false),
  storeSession: vi.fn(),
  getSessionToken: vi.fn(),
  getAuthState: vi.fn(),
  logout: vi.fn(),
  syncMemoryClientToken: vi.fn(),
  openhumanServiceInstall: vi.fn(),
  openhumanServiceUninstall: vi.fn(),
  exchangeToken: vi.fn(),
  invoke: vi.fn(),
}));

// Lazy-import the hook after mocks are in place
const { useDaemonHealth } = await import('../useDaemonHealth');

const {
  openhumanAgentServerStatus,
  openhumanServiceStart,
  openhumanServiceStop,
  openhumanServiceStatus,
} = vi.mocked(await import('../../utils/tauriCommands'));

/** Setup useAppSelector to return sane defaults for each sequential call the hook makes. */
function setupSelector() {
  // The hook calls useAppSelector in this order:
  // 1. selectDaemonStatus → undefined (treated as undefined → derivations use this)
  // 2. selectDaemonComponents → {} (MUST be an object for Object.keys)
  // 3. selectDaemonHealthSnapshot → null
  // 4. selectDaemonLastHealthUpdate → null
  // 5. selectIsDaemonAutoStartEnabled → false
  // 6. selectDaemonConnectionAttempts → 0
  // 7. selectIsDaemonRecovering → false
  vi.mocked(useAppSelector)
    .mockReturnValueOnce(undefined) // status
    .mockReturnValueOnce({}) // components
    .mockReturnValueOnce(null) // healthSnapshot
    .mockReturnValueOnce(null) // lastUpdate
    .mockReturnValueOnce(false) // isAutoStartEnabled
    .mockReturnValueOnce(0) // connectionAttempts
    .mockReturnValueOnce(false) // isRecovering
    // Additional calls (re-renders)
    .mockReturnValue({});
}

describe('useDaemonHealth', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(useAppDispatch).mockReturnValue(mockDispatch);
    setupSelector();

    openhumanAgentServerStatus.mockResolvedValue({ result: { running: true }, logs: [] });
    openhumanServiceStart.mockResolvedValue({ result: { state: 'Running' }, logs: [] });
    openhumanServiceStop.mockResolvedValue({ result: { state: 'Stopped' }, logs: [] });
    openhumanServiceStatus.mockResolvedValue({ result: { state: 'Running' }, logs: [] });
  });

  it('returns expected shape', () => {
    const { result } = renderHook(() => useDaemonHealth('u1'));
    expect(result.current).toHaveProperty('status');
    expect(result.current).toHaveProperty('components');
    expect(result.current).toHaveProperty('startDaemon');
    expect(result.current).toHaveProperty('stopDaemon');
    expect(result.current).toHaveProperty('restartDaemon');
    expect(result.current).toHaveProperty('checkDaemonStatus');
    expect(result.current).toHaveProperty('setAutoStart');
    expect(result.current).toHaveProperty('isHealthy');
    expect(result.current).toHaveProperty('hasErrors');
    expect(result.current).toHaveProperty('isConnected');
    expect(result.current).toHaveProperty('uptimeText');
    expect(result.current.uptimeText).toBe('Unknown'); // null healthSnapshot
  });

  it('probes agent status on mount', async () => {
    renderHook(() => useDaemonHealth('u1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(openhumanAgentServerStatus).toHaveBeenCalled();
  });

  it('startDaemon calls openhumanServiceStart', async () => {
    openhumanAgentServerStatus.mockResolvedValue({ result: { running: true }, logs: [] });
    const { result } = renderHook(() => useDaemonHealth('u1'));
    await act(async () => {
      await result.current.startDaemon();
    });
    expect(openhumanServiceStart).toHaveBeenCalled();
  });

  it('stopDaemon calls openhumanServiceStop', async () => {
    openhumanAgentServerStatus.mockResolvedValue({ result: { running: false }, logs: [] });
    const { result } = renderHook(() => useDaemonHealth('u1'));
    await act(async () => {
      await result.current.stopDaemon();
    });
    expect(openhumanServiceStop).toHaveBeenCalled();
  });

  it('checkDaemonStatus returns service status when agent is running', async () => {
    openhumanAgentServerStatus.mockResolvedValue({ result: { running: true }, logs: [] });
    openhumanServiceStatus.mockResolvedValue({ result: { state: 'Running' }, logs: [] });
    const { result } = renderHook(() => useDaemonHealth('u1'));
    let checkResult: unknown;
    await act(async () => {
      checkResult = await result.current.checkDaemonStatus();
    });
    expect(openhumanServiceStatus).toHaveBeenCalled();
    expect(checkResult).toBeDefined();
  });

  it('checkDaemonStatus returns null when agent is not running', async () => {
    openhumanAgentServerStatus.mockResolvedValue({ result: { running: false }, logs: [] });
    const { result } = renderHook(() => useDaemonHealth('u1'));
    let checkResult: unknown;
    await act(async () => {
      checkResult = await result.current.checkDaemonStatus();
    });
    expect(checkResult).toBeNull();
  });

  it('setAutoStart dispatches action', () => {
    const { result } = renderHook(() => useDaemonHealth('u1'));
    act(() => {
      result.current.setAutoStart(true);
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('handles probe failure gracefully (startDaemon catches errors)', async () => {
    openhumanAgentServerStatus.mockRejectedValue(new Error('IPC error'));
    openhumanServiceStart.mockRejectedValue(new Error('service not found'));
    const { result } = renderHook(() => useDaemonHealth('u1'));
    let returned: unknown;
    await act(async () => {
      returned = await result.current.startDaemon();
    });
    // startDaemon catches errors and returns null
    expect(returned).toBeNull();
    expect(mockDispatch).toHaveBeenCalled();
  });
});

describe('formatRelativeTime', () => {
  it('formats seconds ago', () => {
    const now = new Date();
    const iso = new Date(now.getTime() - 30_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    const now = new Date();
    const iso = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const now = new Date();
    const iso = new Date(now.getTime() - 3 * 3600_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('3h ago');
  });

  it('formats days ago', () => {
    const now = new Date();
    const iso = new Date(now.getTime() - 2 * 86400_000).toISOString();
    expect(formatRelativeTime(iso)).toBe('2d ago');
  });
});
