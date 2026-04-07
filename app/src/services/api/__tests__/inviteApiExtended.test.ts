import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { inviteApi } = await import('../inviteApi');

const mockCode = () => ({
  code: 'INVITE01',
  isUsed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  usedAt: null,
  usedBy: null,
});

describe('inviteApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMyInviteCodes', () => {
    it('fetches invite codes from /invite/my-codes', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [mockCode()] });
      const result = await inviteApi.getMyInviteCodes();
      expect(apiClient.get).toHaveBeenCalledWith('/invite/my-codes');
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('INVITE01');
    });

    it('returns empty list when no codes', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      const result = await inviteApi.getMyInviteCodes();
      expect(result).toEqual([]);
    });

    it('propagates errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));
      await expect(inviteApi.getMyInviteCodes()).rejects.toThrow('Unauthorized');
    });
  });

  describe('redeemInviteCode', () => {
    it('posts code to /invite/redeem', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: 'Code redeemed successfully' },
      });
      const result = await inviteApi.redeemInviteCode('VALID01');
      expect(apiClient.post).toHaveBeenCalledWith('/invite/redeem', { code: 'VALID01' });
      expect(result.message).toBe('Code redeemed successfully');
    });

    it('propagates errors for invalid code', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Code not found'));
      await expect(inviteApi.redeemInviteCode('BADCODE')).rejects.toThrow('Code not found');
    });
  });

  describe('checkInviteCode', () => {
    it('gets status for a valid code without auth', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { valid: true } });
      const result = await inviteApi.checkInviteCode('VALID01');
      expect(apiClient.get).toHaveBeenCalledWith('/invite/status?code=VALID01', {
        requireAuth: false,
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for an expired code', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { valid: false } });
      const result = await inviteApi.checkInviteCode('EXPIRED');
      expect(result.valid).toBe(false);
    });

    it('URL-encodes the code', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { valid: true } });
      await inviteApi.checkInviteCode('CODE WITH SPACES');
      expect(apiClient.get).toHaveBeenCalledWith('/invite/status?code=CODE%20WITH%20SPACES', {
        requireAuth: false,
      });
    });
  });
});
