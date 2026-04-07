import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptIntegrationTokens } from '../../../utils/integrationTokensCrypto';
import { callCoreCommand } from '../../coreCommandClient';
import { callCoreRpc } from '../../coreRpcClient';
import { consumeLoginToken, createChannelLinkToken, fetchIntegrationTokens } from '../authApi';

vi.mock('../../coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

vi.mock('../../coreCommandClient', () => ({ callCoreCommand: vi.fn() }));

vi.mock('../../../utils/integrationTokensCrypto', () => ({
  encryptIntegrationTokens: vi.fn().mockResolvedValue('encrypted-blob'),
  base64ToBytes: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
}));

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('consumeLoginToken', () => {
    it('returns jwtToken on success', async () => {
      vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: { jwtToken: 'jwt-123' } });
      const token = await consumeLoginToken('login-123');
      expect(token).toBe('jwt-123');
      expect(callCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.auth.consume_login_token',
        params: { loginToken: 'login-123' },
      });
    });

    it('throws error if jwtToken is missing', async () => {
      vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: {} });
      await expect(consumeLoginToken('bad')).rejects.toThrow('Login token invalid or expired');
    });
  });

  describe('fetchIntegrationTokens', () => {
    it('fetches and encrypts tokens', async () => {
      const mockTokens = { accessToken: 'at', expiresAt: '2025', refreshToken: 'rt' };
      vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: mockTokens });

      const res = await fetchIntegrationTokens('int-1', '0x' + 'a'.repeat(64));

      expect(res.success).toBe(true);
      expect(res.data?.encrypted).toBe('encrypted-blob');
      expect(encryptIntegrationTokens).toHaveBeenCalled();
    });

    it('throws if required fields are missing', async () => {
      vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: { accessToken: 'at' } });
      await expect(fetchIntegrationTokens('i', 'k')).rejects.toThrow(
        'Integration token handoff did not return required fields'
      );
    });
  });

  describe('createChannelLinkToken', () => {
    it('returns token and launchUrl', async () => {
      vi.mocked(callCoreCommand).mockResolvedValueOnce({
        token: 'link-123',
        url: 'https://launch.me',
      });

      const res = await createChannelLinkToken('telegram');
      expect(res.token).toBe('link-123');
      expect(res.launchUrl).toBe('https://launch.me');
    });

    it('handles alternative field names for token and url', async () => {
      vi.mocked(callCoreCommand).mockResolvedValueOnce({
        linkToken: 'alt-token',
        deepLinkUrl: 'https://deep.link',
        expires_at: 'tomorrow',
      });

      const res = await createChannelLinkToken('discord');
      expect(res.token).toBe('alt-token');
      expect(res.launchUrl).toBe('https://deep.link');
      expect(res.expiresAt).toBe('tomorrow');
    });

    it('throws if no token found in response', async () => {
      vi.mocked(callCoreCommand).mockResolvedValueOnce({});
      await expect(createChannelLinkToken('telegram')).rejects.toThrow(
        'Channel link token response missing token'
      );
    });
  });
});
