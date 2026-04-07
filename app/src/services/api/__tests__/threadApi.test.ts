import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock tauriCommands first (required by threadApi)
vi.mock('../../../utils/tauriCommands', () => ({
  isTauri: vi.fn(() => false),
  openhumanAgentChat: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { isTauri: coreIsTauri } = vi.mocked(await import('@tauri-apps/api/core'));
const { threadApi } = await import('../threadApi');

const mockThreads = () => ({
  threads: [{ id: 'th-1', title: 'Thread 1', createdAt: '2026-01-01' }],
});

const mockMessages = () => ({
  messages: [{ id: 'msg-1', role: 'user', content: 'Hello', threadId: 'th-1' }],
});

describe('threadApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coreIsTauri).mockReturnValue(false);
  });

  describe('getThreads', () => {
    it('fetches from /threads', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockThreads() });
      const result = await threadApi.getThreads();
      expect(apiClient.get).toHaveBeenCalledWith('/threads');
      expect(result.threads).toHaveLength(1);
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));
      await expect(threadApi.getThreads()).rejects.toThrow();
    });
  });

  describe('createThread', () => {
    it('creates thread without chatId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'th-new', createdAt: '2026-01-01' },
      });
      const result = await threadApi.createThread();
      expect(apiClient.post).toHaveBeenCalledWith('/threads', undefined);
      expect(result.id).toBe('th-new');
    });

    it('creates thread with chatId when provided', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { id: 'th-new', chatId: 12345, createdAt: '2026-01-01' },
      });
      await threadApi.createThread(12345);
      expect(apiClient.post).toHaveBeenCalledWith('/threads', { chatId: 12345 });
    });
  });

  describe('getThreadMessages', () => {
    it('fetches messages with encoded threadId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMessages() });
      const result = await threadApi.getThreadMessages('th-1');
      expect(apiClient.get).toHaveBeenCalledWith('/threads/th-1/messages');
      expect(result.messages).toHaveLength(1);
    });

    it('URL-encodes special characters in threadId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockMessages() });
      await threadApi.getThreadMessages('th/special?id=1');
      expect(apiClient.get).toHaveBeenCalledWith('/threads/th%2Fspecial%3Fid%3D1/messages');
    });
  });

  describe('deleteThread', () => {
    it('deletes a thread by id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: { deleted: true } });
      const result = await threadApi.deleteThread('th-1');
      expect(apiClient.delete).toHaveBeenCalledWith('/threads/th-1');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('sendMessage (web path)', () => {
    it('posts to /chat/sendMessage in browser env', async () => {
      vi.mocked(coreIsTauri).mockReturnValue(false);
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { response: 'AI reply', conversationId: 'conv-1', route: undefined },
      });
      const result = await threadApi.sendMessage('Hello', 'conv-1');
      expect(apiClient.post).toHaveBeenCalledWith('/chat/sendMessage', {
        message: 'Hello',
        conversationId: 'conv-1',
      });
      expect(result.response).toBe('AI reply');
    });

    it('includes route fields when provided', async () => {
      vi.mocked(coreIsTauri).mockReturnValue(false);
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          response: 'reply',
          conversationId: 'conv-1',
          route: { channel: 'telegram', authMode: 'bot' },
        },
      });
      await threadApi.sendMessage('msg', 'conv-1', {
        channel: 'telegram',
        authMode: 'bot',
      } as never);
      expect(apiClient.post).toHaveBeenCalledWith('/chat/sendMessage', {
        message: 'msg',
        conversationId: 'conv-1',
        channel: 'telegram',
        channelAuthMode: 'bot',
      });
    });
  });

  describe('getSuggestQuestions', () => {
    it('fetches autocomplete without conversationId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { questions: ['What can you do?'] } });
      const result = await threadApi.getSuggestQuestions();
      expect(apiClient.get).toHaveBeenCalledWith('/chat/autocomplete');
      expect(result.questions).toHaveLength(1);
    });

    it('includes conversationId in query when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { questions: [] } });
      await threadApi.getSuggestQuestions('conv-1');
      expect(apiClient.get).toHaveBeenCalledWith('/chat/autocomplete?conversationId=conv-1');
    });

    it('URL-encodes the conversationId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { questions: [] } });
      await threadApi.getSuggestQuestions('conv/1?q=2');
      expect(apiClient.get).toHaveBeenCalledWith(
        '/chat/autocomplete?conversationId=conv%2F1%3Fq%3D2'
      );
    });
  });

  describe('purge', () => {
    it('posts to /purge', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { deleted: 5 } });
      const result = await threadApi.purge({ deleteAll: true });
      expect(apiClient.post).toHaveBeenCalledWith('/purge', { deleteAll: true });
      expect(result).toEqual({ deleted: 5 });
    });
  });
});
