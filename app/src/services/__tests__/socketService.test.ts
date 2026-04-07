import type {} from '@tauri-apps/api/core';
import { io } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCoreStateSnapshot } from '../../lib/coreState/store';
import { store } from '../../store';
import { socketService } from '../socketService';

// Mock dependencies
vi.mock('socket.io-client', () => {
  const mSocket = {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onAny: vi.fn(),
    id: 'test-socket-id',
    connected: false,
  };
  return { io: vi.fn(() => mSocket), Socket: vi.fn() };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));

vi.mock('../../store', () => ({ store: { dispatch: vi.fn() } }));

vi.mock('../../lib/coreState/store', () => ({
  getCoreStateSnapshot: vi.fn(() => ({ snapshot: { sessionToken: 'test.token.payload' } })),
}));

vi.mock('../../lib/mcp', () => ({ SocketIOMCPTransportImpl: vi.fn() }));

vi.mock('../../lib/skills', () => ({
  skillManager: { resyncRunningSkillsAfterReconnect: vi.fn().mockResolvedValue(undefined) },
  syncToolsToBackend: vi.fn(),
}));

// Mock atob for Node environment if needed, but jsdom usually has it
if (typeof atob === 'undefined') {
  global.atob = (str: string) => Buffer.from(str, 'base64').toString('binary');
}

describe('SocketService', () => {
  let mockSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();
    socketService.disconnect();

    mockSocket = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      onAny: vi.fn(),
      id: 'test-socket-id',
      connected: false,
    };
    (io as any).mockReturnValue(mockSocket);

    // Setup a valid JWT mock payload for getSocketUserId
    const payload = JSON.stringify({ sub: 'user-123' });
    const encodedPayload = Buffer.from(payload).toString('base64').replace(/=/g, '');
    (getCoreStateSnapshot as any).mockReturnValue({
      snapshot: { sessionToken: `header.${encodedPayload}.signature` },
    });
  });

  it('should connect with a token', async () => {
    await socketService.connect('valid-token');

    expect(io).toHaveBeenCalled();
    expect(mockSocket.connect).toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('setStatusForUser'),
        payload: expect.objectContaining({ status: 'connecting' }),
      })
    );
  });

  it('should not connect if token is missing', async () => {
    await socketService.connect('');
    expect(io).not.toHaveBeenCalled();
  });

  it('should disconnect and cleanup', async () => {
    // First connect to set the socket
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    socketService.disconnect();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(socketService.getSocket()).toBeNull();
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('resetForUser') })
    );
  });

  it('should return connection status', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    mockSocket.connected = true;
    expect(socketService.isConnected()).toBe(true);

    mockSocket.connected = false;
    expect(socketService.isConnected()).toBe(false);
  });

  it('should emit events when connected', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    mockSocket.connected = true;

    socketService.emit('test-event', { data: 123 });
    expect(mockSocket.emit).toHaveBeenCalledWith('test-event', { data: 123 });
  });

  it('should not emit events when disconnected', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    mockSocket.connected = false;

    socketService.emit('test-event', { data: 123 });
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('should register event listeners and handle callbacks', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    const callback = vi.fn();
    socketService.on('test-event', callback);

    const wrappedCallback = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'test-event'
    )[1];
    wrappedCallback('data1', 'data2');

    expect(callback).toHaveBeenCalledWith('data1', 'data2');
  });

  it('should register once event listeners', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    const callback = vi.fn();
    socketService.once('test-once', callback);

    expect(mockSocket.once).toHaveBeenCalledWith('test-once', expect.any(Function));

    const wrappedCallback = mockSocket.once.mock.calls.find(
      (call: any) => call[0] === 'test-once'
    )[1];
    wrappedCallback('once-data');
    expect(callback).toHaveBeenCalledWith('once-data');
  });

  it('should remove event listeners', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());

    const callback = vi.fn();
    socketService.off('test-event', callback);
    expect(mockSocket.off).toHaveBeenCalledWith('test-event', callback);

    socketService.off('another-event');
    expect(mockSocket.off).toHaveBeenCalledWith('another-event');
  });

  it('should handle error events', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => {
      if (!mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')) throw new Error();
    });

    const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler(new Error('test error'));
    // Just verifying it doesn't crash and calls logger (implied by execution)
  });

  it('should handle disconnect event', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => {
      if (!mockSocket.on.mock.calls.find((call: any) => call[0] === 'disconnect'))
        throw new Error();
    });

    const disconnectHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'disconnect'
    )[1];
    disconnectHandler('io server disconnect');

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'disconnected' }) })
    );
  });

  it('should handle connect_error event', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => {
      if (!mockSocket.on.mock.calls.find((call: any) => call[0] === 'connect_error'))
        throw new Error();
    });

    const errorHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'connect_error'
    )[1];
    errorHandler(new Error('connect error'));

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'disconnected' }) })
    );
  });

  it('should handle channel:managed-dm-verified event', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => {
      if (!mockSocket.on.mock.calls.find((call: any) => call[0] === 'channel:managed-dm-verified'))
        throw new Error();
    });

    const handler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'channel:managed-dm-verified'
    )[1];
    handler({ token: 'test-token', telegramUsername: 'user', chatId: 123 });

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('upsertChannelConnection') })
    );
  });

  it('should handle onAny for logging', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(mockSocket.onAny).toHaveBeenCalled());

    const onAnyHandler = mockSocket.onAny.mock.calls[0][0];
    onAnyHandler('some-event', { data: 1 });
    // Verifying it doesn't crash
  });

  it('should return MCP transport', async () => {
    await socketService.connect('token');
    await vi.waitFor(() => expect(io).toHaveBeenCalled());
    expect(socketService.getMCPTransport()).toBeDefined();
  });

  it('should handle socket connection events', async () => {
    await socketService.connect('token');

    // Wait for async connect to setup listeners
    await vi.waitFor(() => {
      const call = mockSocket.on.mock.calls.find((call: any) => call[0] === 'connect');
      if (!call) throw new Error('connect listener not found');
    });

    const connectHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'connect')[1];
    connectHandler();

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ status: 'connected' }) })
    );
  });

  it('should handle channel connection updates', async () => {
    await socketService.connect('token');

    await vi.waitFor(() => {
      const call = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'channel:connection-updated'
      );
      if (!call) throw new Error('channel:connection-updated listener not found');
    });

    const updateHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'channel:connection-updated'
    )[1];

    const updatePayload = {
      channel: 'telegram',
      authMode: 'managed_dm',
      status: 'connected',
      lastError: null,
      capabilities: ['dm'],
    };

    updateHandler(updatePayload);

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('upsertChannelConnection') })
    );
  });
});
