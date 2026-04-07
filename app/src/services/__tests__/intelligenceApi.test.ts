import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../apiClient';
import { intelligenceApi, IntelligenceApiService } from '../intelligenceApi';

vi.mock('../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);

describe('IntelligenceApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getActionableItems', () => {
    it('returns items from response', async () => {
      const items = [{ id: 'item-1', title: 'Test' }];
      mockGet.mockResolvedValue({ items });
      const result = await intelligenceApi.getActionableItems();
      expect(result).toEqual(items);
      expect(mockGet).toHaveBeenCalledWith('/telegram/actionable-items');
    });

    it('returns empty array when items is undefined', async () => {
      mockGet.mockResolvedValue({});
      const result = await intelligenceApi.getActionableItems();
      expect(result).toEqual([]);
    });

    it('throws on failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      await expect(intelligenceApi.getActionableItems()).rejects.toThrow('Network error');
    });
  });

  describe('updateItemStatus', () => {
    it('calls patch with correct args', async () => {
      mockPatch.mockResolvedValue(undefined);
      await intelligenceApi.updateItemStatus('item-1', 'completed');
      expect(mockPatch).toHaveBeenCalledWith('/actionable-items/item-1', { status: 'completed' });
    });

    it('throws on failure', async () => {
      mockPatch.mockRejectedValue(new Error('Failed'));
      await expect(intelligenceApi.updateItemStatus('item-1', 'dismissed')).rejects.toThrow(
        'Failed'
      );
    });
  });

  describe('snoozeItem', () => {
    it('calls patch with snoozed status and ISO date', async () => {
      mockPatch.mockResolvedValue(undefined);
      const snoozeUntil = new Date('2026-01-01T12:00:00.000Z');
      await intelligenceApi.snoozeItem('item-1', snoozeUntil);
      expect(mockPatch).toHaveBeenCalledWith('/actionable-items/item-1', {
        status: 'snoozed',
        snoozeUntil: '2026-01-01T12:00:00.000Z',
      });
    });

    it('throws on failure', async () => {
      mockPatch.mockRejectedValue(new Error('Snooze failed'));
      await expect(intelligenceApi.snoozeItem('item-1', new Date())).rejects.toThrow(
        'Snooze failed'
      );
    });
  });

  describe('getOrCreateThread', () => {
    it('returns thread response', async () => {
      const thread = { threadId: 'thread-1', messages: [] };
      mockGet.mockResolvedValue(thread);
      const result = await intelligenceApi.getOrCreateThread('item-1');
      expect(result).toEqual(thread);
      expect(mockGet).toHaveBeenCalledWith('/item-1/thread');
    });

    it('throws on failure', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));
      await expect(intelligenceApi.getOrCreateThread('item-1')).rejects.toThrow('Not found');
    });
  });

  describe('getChatHistory', () => {
    it('returns messages array', async () => {
      const messages = [{ id: 'm1', content: 'hello', role: 'user' }];
      mockGet.mockResolvedValue({ messages });
      const result = await intelligenceApi.getChatHistory('thread-1');
      expect(result).toEqual(messages);
      expect(mockGet).toHaveBeenCalledWith('/threads/thread-1/messages');
    });

    it('returns empty array when messages is undefined', async () => {
      mockGet.mockResolvedValue({});
      const result = await intelligenceApi.getChatHistory('thread-1');
      expect(result).toEqual([]);
    });

    it('throws on failure', async () => {
      mockGet.mockRejectedValue(new Error('Failed'));
      await expect(intelligenceApi.getChatHistory('thread-1')).rejects.toThrow('Failed');
    });
  });

  describe('executeTask', () => {
    it('calls post and returns execution response', async () => {
      const response = { executionId: 'exec-1', sessionId: 'sess-1', status: 'started' };
      mockPost.mockResolvedValue(response);
      const tools = [
        { name: 'tool1', description: 'T1', parameters: {}, skillId: 's1', enabled: true },
      ];
      const result = await intelligenceApi.executeTask('item-1', tools);
      expect(result).toEqual(response);
      expect(mockPost).toHaveBeenCalledWith('/item-1/execute', { connectedTools: tools });
    });

    it('throws on failure', async () => {
      mockPost.mockRejectedValue(new Error('Exec failed'));
      await expect(intelligenceApi.executeTask('item-1', [])).rejects.toThrow('Exec failed');
    });
  });

  describe('getExecutionStatus', () => {
    it('returns status', async () => {
      const status = { status: 'running', progress: [] };
      mockGet.mockResolvedValue(status);
      const result = await intelligenceApi.getExecutionStatus('exec-1');
      expect(result).toEqual(status);
      expect(mockGet).toHaveBeenCalledWith('/executions/exec-1/status');
    });

    it('throws on failure', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));
      await expect(intelligenceApi.getExecutionStatus('exec-1')).rejects.toThrow('Not found');
    });
  });

  describe('cancelExecution', () => {
    it('posts to cancel endpoint', async () => {
      mockPost.mockResolvedValue(undefined);
      await intelligenceApi.cancelExecution('exec-1');
      expect(mockPost).toHaveBeenCalledWith('/executions/exec-1/cancel');
    });

    it('throws on failure', async () => {
      mockPost.mockRejectedValue(new Error('Cancel failed'));
      await expect(intelligenceApi.cancelExecution('exec-1')).rejects.toThrow('Cancel failed');
    });
  });

  it('exports a singleton instance', () => {
    expect(intelligenceApi).toBeInstanceOf(IntelligenceApiService);
  });
});
