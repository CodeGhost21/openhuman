import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatCancel, chatSend, subscribeChatEvents, useRustChat } from '../chatService';
import { socketService } from '../socketService';

vi.mock('../socketService', () => ({
  socketService: { getSocket: vi.fn(), isConnected: vi.fn(), emit: vi.fn() },
}));

const mockGetSocket = vi.mocked(socketService.getSocket);
const mockIsConnected = vi.mocked(socketService.isConnected);
const mockEmit = vi.mocked(socketService.emit);

describe('chatService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribeChatEvents', () => {
    it('returns no-op when socket is null', () => {
      mockGetSocket.mockReturnValue(null);
      const cleanup = subscribeChatEvents({ onDone: vi.fn() });
      expect(typeof cleanup).toBe('function');
      cleanup(); // should not throw
    });

    it('registers onToolCall on chat:tool_call and tool_call events', () => {
      const mockSocket = { on: vi.fn(), off: vi.fn() };
      mockGetSocket.mockReturnValue(mockSocket as any);
      const onToolCall = vi.fn();

      const cleanup = subscribeChatEvents({ onToolCall });
      expect(mockSocket.on).toHaveBeenCalledWith('chat:tool_call', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('tool_call', expect.any(Function));

      cleanup();
      expect(mockSocket.off).toHaveBeenCalledWith('chat:tool_call', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('tool_call', expect.any(Function));
    });

    it('registers onToolResult on chat:tool_result and tool_result events', () => {
      const mockSocket = { on: vi.fn(), off: vi.fn() };
      mockGetSocket.mockReturnValue(mockSocket as any);

      const cleanup = subscribeChatEvents({ onToolResult: vi.fn() });
      expect(mockSocket.on).toHaveBeenCalledWith('chat:tool_result', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('tool_result', expect.any(Function));
      cleanup();
    });

    it('registers onDone on chat:done and chat_done events', () => {
      const mockSocket = { on: vi.fn(), off: vi.fn() };
      mockGetSocket.mockReturnValue(mockSocket as any);

      const cleanup = subscribeChatEvents({ onDone: vi.fn() });
      expect(mockSocket.on).toHaveBeenCalledWith('chat:done', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('chat_done', expect.any(Function));
      cleanup();
    });

    it('registers onError on chat:error and chat_error events', () => {
      const mockSocket = { on: vi.fn(), off: vi.fn() };
      mockGetSocket.mockReturnValue(mockSocket as any);

      const cleanup = subscribeChatEvents({ onError: vi.fn() });
      expect(mockSocket.on).toHaveBeenCalledWith('chat:error', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('chat_error', expect.any(Function));
      cleanup();
    });

    it('forwards payload to onToolCall listener', () => {
      const handlers: Record<string, (payload: unknown) => void> = {};
      const mockSocket = {
        on: vi.fn((event: string, cb: (payload: unknown) => void) => {
          handlers[event] = cb;
        }),
        off: vi.fn(),
      };
      mockGetSocket.mockReturnValue(mockSocket as any);
      const onToolCall = vi.fn();

      subscribeChatEvents({ onToolCall });
      const payload = {
        thread_id: 't1',
        tool_name: 'search',
        skill_id: 'gmail',
        args: {},
        round: 1,
      };
      handlers['chat:tool_call'](payload);
      expect(onToolCall).toHaveBeenCalledWith(payload);
    });

    it('does not register listeners for undefined callbacks', () => {
      const mockSocket = { on: vi.fn(), off: vi.fn() };
      mockGetSocket.mockReturnValue(mockSocket as any);
      subscribeChatEvents({});
      expect(mockSocket.on).not.toHaveBeenCalled();
    });
  });

  describe('chatSend', () => {
    it('emits chat:start with correct payload when connected', async () => {
      mockIsConnected.mockReturnValue(true);
      await chatSend({ threadId: 't1', message: 'hello', model: 'gpt-4' });
      expect(mockEmit).toHaveBeenCalledWith('chat:start', {
        thread_id: 't1',
        message: 'hello',
        model: 'gpt-4',
      });
    });

    it('throws when socket not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      await expect(chatSend({ threadId: 't1', message: 'hello', model: 'gpt-4' })).rejects.toThrow(
        'Socket not connected'
      );
    });
  });

  describe('chatCancel', () => {
    it('emits chat:cancel and returns true when connected', async () => {
      mockIsConnected.mockReturnValue(true);
      const result = await chatCancel('t1');
      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('chat:cancel', { thread_id: 't1' });
    });

    it('returns false when not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const result = await chatCancel('t1');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('useRustChat', () => {
    it('always returns true', () => {
      expect(useRustChat()).toBe(true);
    });
  });
});
