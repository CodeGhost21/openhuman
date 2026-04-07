import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { feedbackApi } = await import('../feedbackApi');

const mockFeedback = (id = 'fb-1') => ({
  id,
  type: 'bug' as const,
  title: 'Something broke',
  description: 'It crashes on click',
  status: 'open' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('feedbackApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFeedback', () => {
    it('posts to /feedback', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockFeedback() });
      const result = await feedbackApi.createFeedback({
        type: 'bug',
        title: 'Something broke',
        description: 'It crashes on click',
      });
      expect(apiClient.post).toHaveBeenCalledWith('/feedback', {
        type: 'bug',
        title: 'Something broke',
        description: 'It crashes on click',
      });
      expect(result.id).toBe('fb-1');
    });

    it('posts with optional steps', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockFeedback() });
      await feedbackApi.createFeedback({
        type: 'feature_request',
        title: 'Add dark mode',
        description: 'Would be nice',
        steps: '1. Go to settings',
      });
      expect(apiClient.post).toHaveBeenCalledWith(
        '/feedback',
        expect.objectContaining({ steps: '1. Go to settings' })
      );
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Validation error'));
      await expect(
        feedbackApi.createFeedback({ type: 'general', title: '', description: '' })
      ).rejects.toThrow();
    });
  });

  describe('getFeedback', () => {
    it('fetches list from /feedback', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [mockFeedback('fb-1'), mockFeedback('fb-2')],
      });
      const result = await feedbackApi.getFeedback();
      expect(apiClient.get).toHaveBeenCalledWith('/feedback');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no feedback', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      const result = await feedbackApi.getFeedback();
      expect(result).toEqual([]);
    });
  });

  describe('getFeedbackById', () => {
    it('fetches single feedback item', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockFeedback('fb-99') });
      const result = await feedbackApi.getFeedbackById('fb-99');
      expect(apiClient.get).toHaveBeenCalledWith('/feedback/fb-99');
      expect(result.id).toBe('fb-99');
    });
  });

  describe('updateFeedback', () => {
    it('puts update to feedback item', async () => {
      const updated = { ...mockFeedback(), description: 'Updated description' };
      vi.mocked(apiClient.put).mockResolvedValue({ data: updated });
      const result = await feedbackApi.updateFeedback('fb-1', {
        description: 'Updated description',
      });
      expect(apiClient.put).toHaveBeenCalledWith('/feedback/fb-1', {
        description: 'Updated description',
      });
      expect(result.description).toBe('Updated description');
    });
  });
});
