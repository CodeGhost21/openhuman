import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { apiKeysApi } = await import('../apiKeysApi');

describe('apiKeysApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApiKey', () => {
    it('posts to /api-keys and returns created key', async () => {
      const response = { id: 'key-1', name: 'My Key', key: 'sk-abc123', createdAt: '2026-01-01' };
      vi.mocked(apiClient.post).mockResolvedValue({ data: response });
      const result = await apiKeysApi.createApiKey({ name: 'My Key' });
      expect(apiClient.post).toHaveBeenCalledWith('/api-keys', { name: 'My Key' });
      expect(result.key).toBe('sk-abc123');
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Bad request'));
      await expect(apiKeysApi.createApiKey({ name: '' })).rejects.toThrow('Bad request');
    });
  });

  describe('getApiKeys', () => {
    it('gets list of keys', async () => {
      const keys = [{ id: 'k1', name: 'Key1', keyPreview: 'sk-...abc', createdAt: '2026-01-01' }];
      vi.mocked(apiClient.get).mockResolvedValue({ data: keys });
      const result = await apiKeysApi.getApiKeys();
      expect(apiClient.get).toHaveBeenCalledWith('/api-keys');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('k1');
    });

    it('returns empty array when no keys exist', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      const result = await apiKeysApi.getApiKeys();
      expect(result).toEqual([]);
    });
  });

  describe('revokeApiKey', () => {
    it('deletes the key by id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: null });
      await apiKeysApi.revokeApiKey('key-1');
      expect(apiClient.delete).toHaveBeenCalledWith('/api-keys/key-1');
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Not found'));
      await expect(apiKeysApi.revokeApiKey('missing')).rejects.toThrow('Not found');
    });
  });
});
