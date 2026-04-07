import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SocketIOMCPTransportImpl } from '../transport';

describe('SocketIOMCPTransportImpl', () => {
  let mockSocket: any;
  let transport: SocketIOMCPTransportImpl;

  beforeEach(() => {
    mockSocket = { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    transport = new SocketIOMCPTransportImpl(mockSocket);
  });

  it('should register response handler on start', () => {
    expect(mockSocket.on).toHaveBeenCalledWith('mcp:response', expect.any(Function));
  });

  it('should report connected status based on socket', () => {
    expect(transport.connected).toBe(false);
    mockSocket.connected = true;
    expect(transport.connected).toBe(true);
  });

  it('should emit events when connected', () => {
    mockSocket.connected = true;
    transport.emit('test', { foo: 'bar' });
    expect(mockSocket.emit).toHaveBeenCalledWith('mcp:test', { foo: 'bar' });
  });

  it('should NOT emit events when NOT connected', () => {
    mockSocket.connected = false;
    transport.emit('test', { foo: 'bar' });
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('should handle successful requests', async () => {
    mockSocket.connected = true;
    const request = { id: 1, method: 'test/method', params: {} };
    const promise = transport.request(request as any);

    // Get the response handler registered in beforeEach
    const responseHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'mcp:response'
    )[1];

    // Simulate response
    responseHandler({ id: 1, result: { success: true } });

    const result = await promise;
    expect(result).toEqual({ id: 1, result: { success: true } });
  });

  it('should handle request errors', async () => {
    mockSocket.connected = true;
    const request = { id: 2, method: 'test/error', params: {} };
    const promise = transport.request(request as any);

    const responseHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'mcp:response'
    )[1];
    responseHandler({ id: 2, error: { code: -1, message: 'fail' } });

    await expect(promise).rejects.toThrow('fail');
  });

  it('should handle request timeouts', async () => {
    vi.useFakeTimers();
    mockSocket.connected = true;
    const request = { id: 3, method: 'test/timeout', params: {} };
    const promise = transport.request(request as any, 100);

    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toThrow('MCP request timeout after 100ms');
    vi.useRealTimers();
  });

  it('should update socket and move handlers', () => {
    const newMockSocket = { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() };

    transport.updateSocket(newMockSocket);

    expect(mockSocket.off).toHaveBeenCalledWith('mcp:response', expect.any(Function));
    expect(newMockSocket.on).toHaveBeenCalledWith('mcp:response', expect.any(Function));
    expect(transport.connected).toBe(true);
  });
});
