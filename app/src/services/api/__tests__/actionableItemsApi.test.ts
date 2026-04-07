import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { actionableItemsApi } = await import('../actionableItemsApi');

const mockItem = (id = 'item-1') => ({
  id,
  title: 'Do something',
  status: 'pending' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const mockSession = (id = 'sess-1') => ({ id, itemId: 'item-1', status: 'running' as const });

describe('actionableItemsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getActionableItems', () => {
    it('fetches actionable items from /telegram/actionable-items', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [mockItem()] });
      const result = await actionableItemsApi.getActionableItems();
      expect(apiClient.get).toHaveBeenCalledWith('/telegram/actionable-items');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('item-1');
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('network error'));
      await expect(actionableItemsApi.getActionableItems()).rejects.toThrow('network error');
    });
  });

  describe('updateActionableItem', () => {
    it('patches item status', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { ...mockItem(), status: 'dismissed' },
      });
      const result = await actionableItemsApi.updateActionableItem('item-1', {
        status: 'dismissed',
      });
      expect(apiClient.patch).toHaveBeenCalledWith('/telegram/actionable-items/item-1', {
        status: 'dismissed',
      });
      expect(result.status).toBe('dismissed');
    });

    it('patches with snoozeUntil', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({ data: { ...mockItem(), status: 'snoozed' } });
      await actionableItemsApi.updateActionableItem('item-1', {
        status: 'snoozed',
        snoozeUntil: '2026-12-01T00:00:00.000Z',
      });
      expect(apiClient.patch).toHaveBeenCalledWith('/telegram/actionable-items/item-1', {
        status: 'snoozed',
        snoozeUntil: '2026-12-01T00:00:00.000Z',
      });
    });
  });

  describe('getItemThread', () => {
    it('fetches thread for an item', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { threadId: 'th-1', conversationId: 'conv-1' },
      });
      const result = await actionableItemsApi.getItemThread('item-1');
      expect(apiClient.get).toHaveBeenCalledWith('/telegram/actionable-items/item-1/thread');
      expect(result.threadId).toBe('th-1');
    });
  });

  describe('getItemSession', () => {
    it('fetches execution session for an item', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockSession() });
      const result = await actionableItemsApi.getItemSession('item-1');
      expect(apiClient.get).toHaveBeenCalledWith('/telegram/actionable-items/item-1/session');
      expect(result.id).toBe('sess-1');
    });
  });

  describe('executeItem', () => {
    it('posts to execute endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockSession() });
      const result = await actionableItemsApi.executeItem('item-1');
      expect(apiClient.post).toHaveBeenCalledWith('/telegram/actionable-items/item-1/execute');
      expect(result.status).toBe('running');
    });
  });

  describe('getExecutionSession', () => {
    it('fetches session by sessionId', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockSession('sess-99') });
      const result = await actionableItemsApi.getExecutionSession('sess-99');
      expect(apiClient.get).toHaveBeenCalledWith('/telegram/execution-sessions/sess-99');
      expect(result.id).toBe('sess-99');
    });
  });

  describe('confirmExecutionStep', () => {
    it('posts confirm action', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { ...mockSession(), status: 'completed' },
      });
      const result = await actionableItemsApi.confirmExecutionStep('sess-1', 'confirm');
      expect(apiClient.post).toHaveBeenCalledWith('/telegram/execution-sessions/sess-1/confirm', {
        action: 'confirm',
        data: undefined,
      });
      expect(result.status).toBe('completed');
    });

    it('posts reject action with extra data', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { ...mockSession(), status: 'failed' } });
      await actionableItemsApi.confirmExecutionStep('sess-1', 'reject', { reason: 'not safe' });
      expect(apiClient.post).toHaveBeenCalledWith('/telegram/execution-sessions/sess-1/confirm', {
        action: 'reject',
        data: { reason: 'not safe' },
      });
    });
  });
});
