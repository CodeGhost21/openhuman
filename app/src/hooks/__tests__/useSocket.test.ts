import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock socketService before importing the hook
vi.mock('../../services/socketService', () => ({
  socketService: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    getSocket: vi.fn(() => null),
  },
}));

vi.mock('../../store/hooks', () => ({ useAppSelector: vi.fn(), useAppDispatch: vi.fn() }));

vi.mock('../../store/socketSelectors', () => ({ selectSocketStatus: vi.fn() }));

const { socketService } = vi.mocked(await import('../../services/socketService'));
const { useAppSelector } = vi.mocked(await import('../../store/hooks'));
const { useSocket } = await import('../useSocket');

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppSelector).mockReturnValue('disconnected');
  });

  it('returns expected interface shape', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current).toHaveProperty('socket');
    expect(result.current).toHaveProperty('isConnected');
    expect(result.current).toHaveProperty('status');
    expect(result.current).toHaveProperty('emit');
    expect(result.current).toHaveProperty('on');
    expect(result.current).toHaveProperty('off');
    expect(result.current).toHaveProperty('once');
  });

  it('isConnected is true when socketStatus is connected', () => {
    vi.mocked(useAppSelector).mockReturnValue('connected');
    const { result } = renderHook(() => useSocket());
    expect(result.current.isConnected).toBe(true);
  });

  it('isConnected is false when socketStatus is disconnected', () => {
    vi.mocked(useAppSelector).mockReturnValue('disconnected');
    const { result } = renderHook(() => useSocket());
    expect(result.current.isConnected).toBe(false);
  });

  it('emit delegates to socketService.emit', () => {
    const { result } = renderHook(() => useSocket());
    act(() => {
      result.current.emit('test-event', { data: 1 });
    });
    expect(socketService.emit).toHaveBeenCalledWith('test-event', { data: 1 });
  });

  it('on registers a listener via socketService.on and tracks it', () => {
    const { result } = renderHook(() => useSocket());
    const cb = vi.fn();
    act(() => {
      result.current.on('my-event', cb);
    });
    expect(socketService.on).toHaveBeenCalledWith('my-event', cb);
  });

  it('off removes a specific callback via socketService.off', () => {
    const { result } = renderHook(() => useSocket());
    const cb = vi.fn();
    act(() => {
      result.current.on('my-event', cb);
      result.current.off('my-event', cb);
    });
    expect(socketService.off).toHaveBeenCalledWith('my-event', cb);
  });

  it('off without callback removes all listeners for that event', () => {
    const { result } = renderHook(() => useSocket());
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    act(() => {
      result.current.on('my-event', cb1);
      result.current.on('my-event', cb2);
      result.current.off('my-event');
    });
    expect(socketService.off).toHaveBeenCalledWith('my-event', undefined);
  });

  it('once delegates to socketService.once', () => {
    const { result } = renderHook(() => useSocket());
    const cb = vi.fn();
    act(() => {
      result.current.once('one-time', cb);
    });
    expect(socketService.once).toHaveBeenCalledWith('one-time', cb);
  });

  it('cleans up all registered listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useSocket());
    const cb = vi.fn();
    act(() => {
      result.current.on('event-a', cb);
    });
    unmount();
    expect(socketService.off).toHaveBeenCalledWith('event-a', cb);
  });

  it('returns socket from socketService.getSocket', () => {
    const mockSocket = { id: 'sock-1' } as never;
    vi.mocked(socketService.getSocket).mockReturnValue(mockSocket);
    const { result } = renderHook(() => useSocket());
    expect(result.current.socket).toBe(mockSocket);
  });
});
