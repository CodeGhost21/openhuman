import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { settingsApi } = await import('../settingsApi');

describe('settingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSettings', () => {
    it('fetches from /settings', async () => {
      const settings = { theme: 'dark', language: 'en' };
      vi.mocked(apiClient.get).mockResolvedValue({ data: settings });
      const result = await settingsApi.getSettings();
      expect(apiClient.get).toHaveBeenCalledWith('/settings');
      expect(result).toEqual(settings);
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'));
      await expect(settingsApi.getSettings()).rejects.toThrow('Not found');
    });
  });

  describe('updateSettings', () => {
    it('patches /settings with partial settings', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({ data: { theme: 'light' } });
      const result = await settingsApi.updateSettings({ theme: 'light' });
      expect(apiClient.patch).toHaveBeenCalledWith('/settings', { theme: 'light' });
      expect(result).toEqual({ theme: 'light' });
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(new Error('Conflict'));
      await expect(settingsApi.updateSettings({})).rejects.toThrow('Conflict');
    });
  });

  describe('setPlatformsConnected', () => {
    it('posts to /settings/platforms-connected', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: null });
      await settingsApi.setPlatformsConnected(['telegram', 'discord']);
      expect(apiClient.post).toHaveBeenCalledWith('/settings/platforms-connected', {
        platforms: ['telegram', 'discord'],
      });
    });

    it('posts empty array when no platforms', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: null });
      await settingsApi.setPlatformsConnected([]);
      expect(apiClient.post).toHaveBeenCalledWith('/settings/platforms-connected', {
        platforms: [],
      });
    });
  });
});
