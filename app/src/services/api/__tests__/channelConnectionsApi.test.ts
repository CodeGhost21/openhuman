import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCallCoreRpc = vi.fn();

vi.mock('../../coreRpcClient', () => ({
  callCoreRpc: (...args: unknown[]) => mockCallCoreRpc(...args),
}));

const { channelConnectionsApi } = await import('../channelConnectionsApi');

describe('channelConnectionsApi', () => {
  beforeEach(() => {
    mockCallCoreRpc.mockReset();
  });

  describe('listDefinitions', () => {
    it('calls openhuman.channels_list', async () => {
      const definitions = [{ id: 'telegram', name: 'Telegram' }];
      mockCallCoreRpc.mockResolvedValue(definitions);
      const result = await channelConnectionsApi.listDefinitions();
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_list',
        params: {},
      });
      expect(result).toEqual(definitions);
    });

    it('propagates errors', async () => {
      mockCallCoreRpc.mockRejectedValue(new Error('RPC error'));
      await expect(channelConnectionsApi.listDefinitions()).rejects.toThrow('RPC error');
    });
  });

  describe('listStatus', () => {
    it('calls openhuman.channels_status without channel filter', async () => {
      const statuses = [{ channel: 'telegram', connected: true }];
      mockCallCoreRpc.mockResolvedValue(statuses);
      const result = await channelConnectionsApi.listStatus();
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_status',
        params: {},
      });
      expect(result).toEqual(statuses);
    });

    it('passes channel filter when specified', async () => {
      mockCallCoreRpc.mockResolvedValue([]);
      await channelConnectionsApi.listStatus('telegram' as never);
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_status',
        params: { channel: 'telegram' },
      });
    });
  });

  describe('connectChannel', () => {
    it('calls openhuman.channels_connect with credentials', async () => {
      const connResult = { success: true };
      mockCallCoreRpc.mockResolvedValue(connResult);
      const result = await channelConnectionsApi.connectChannel('telegram' as never, {
        authMode: 'bot' as never,
        credentials: { token: 'abc' },
      });
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_connect',
        params: { channel: 'telegram', authMode: 'bot', credentials: { token: 'abc' } },
      });
      expect(result).toEqual(connResult);
    });

    it('uses empty object for credentials when not provided', async () => {
      mockCallCoreRpc.mockResolvedValue({ success: true });
      await channelConnectionsApi.connectChannel('discord' as never, { authMode: 'bot' as never });
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_connect',
        params: { channel: 'discord', authMode: 'bot', credentials: {} },
      });
    });
  });

  describe('disconnectChannel', () => {
    it('calls openhuman.channels_disconnect', async () => {
      mockCallCoreRpc.mockResolvedValue(undefined);
      await channelConnectionsApi.disconnectChannel('telegram' as never, 'bot' as never);
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_disconnect',
        params: { channel: 'telegram', authMode: 'bot' },
      });
    });
  });

  describe('testChannel', () => {
    it('returns success result', async () => {
      mockCallCoreRpc.mockResolvedValue({ success: true, message: 'Connected' });
      const result = await channelConnectionsApi.testChannel('telegram' as never, 'bot' as never, {
        token: 'abc',
      });
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_test',
        params: { channel: 'telegram', authMode: 'bot', credentials: { token: 'abc' } },
      });
      expect(result.success).toBe(true);
    });

    it('returns failure result', async () => {
      mockCallCoreRpc.mockResolvedValue({ success: false, message: 'Invalid token' });
      const result = await channelConnectionsApi.testChannel('telegram' as never, 'bot' as never, {
        token: 'bad',
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid token');
    });
  });

  describe('telegramLoginStart', () => {
    it('calls openhuman.channels_telegram_login_start', async () => {
      const loginResult = {
        linkToken: 'lt-123',
        telegramUrl: 'https://t.me/bot?start=lt-123',
        botUsername: 'bot',
      };
      mockCallCoreRpc.mockResolvedValue(loginResult);
      const result = await channelConnectionsApi.telegramLoginStart();
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_telegram_login_start',
        params: {},
      });
      expect(result.linkToken).toBe('lt-123');
    });
  });

  describe('telegramLoginCheck', () => {
    it('checks login status for a link token', async () => {
      mockCallCoreRpc.mockResolvedValue({ linked: true, details: { username: 'alice' } });
      const result = await channelConnectionsApi.telegramLoginCheck('lt-123');
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_telegram_login_check',
        params: { linkToken: 'lt-123' },
      });
      expect(result.linked).toBe(true);
    });

    it('returns linked=false when not yet linked', async () => {
      mockCallCoreRpc.mockResolvedValue({ linked: false, details: null });
      const result = await channelConnectionsApi.telegramLoginCheck('lt-pending');
      expect(result.linked).toBe(false);
    });
  });

  describe('listDiscordGuilds', () => {
    it('calls openhuman.channels_discord_list_guilds', async () => {
      const guilds = [{ id: 'guild-1', name: 'My Server' }];
      mockCallCoreRpc.mockResolvedValue(guilds);
      const result = await channelConnectionsApi.listDiscordGuilds();
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_discord_list_guilds',
        params: {},
      });
      expect(result).toEqual(guilds);
    });
  });

  describe('listDiscordChannels', () => {
    it('calls openhuman.channels_discord_list_channels with guildId', async () => {
      const channels = [{ id: 'ch-1', name: 'general' }];
      mockCallCoreRpc.mockResolvedValue(channels);
      const result = await channelConnectionsApi.listDiscordChannels('guild-1');
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_discord_list_channels',
        params: { guildId: 'guild-1' },
      });
      expect(result).toEqual(channels);
    });
  });

  describe('checkDiscordPermissions', () => {
    it('calls with guildId and channelId', async () => {
      const perms = { canSend: true, canRead: true };
      mockCallCoreRpc.mockResolvedValue(perms);
      const result = await channelConnectionsApi.checkDiscordPermissions('guild-1', 'ch-1');
      expect(mockCallCoreRpc).toHaveBeenCalledWith({
        method: 'openhuman.channels_discord_check_permissions',
        params: { guildId: 'guild-1', channelId: 'ch-1' },
      });
      expect(result).toEqual(perms);
    });
  });

  describe('updatePreferences', () => {
    it('is a no-op placeholder that resolves without error', async () => {
      await expect(
        channelConnectionsApi.updatePreferences('telegram' as never)
      ).resolves.toBeUndefined();
      expect(mockCallCoreRpc).not.toHaveBeenCalled();
    });
  });
});
