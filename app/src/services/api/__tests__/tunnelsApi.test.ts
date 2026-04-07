import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCallCoreCommand = vi.fn();

vi.mock('../../coreCommandClient', () => ({
  callCoreCommand: (...args: unknown[]) => mockCallCoreCommand(...args),
}));

const { tunnelsApi } = await import('../tunnelsApi');

const mockTunnel = (id = 't1') => ({
  id,
  uuid: `uuid-${id}`,
  name: `Tunnel ${id}`,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('tunnelsApi', () => {
  beforeEach(() => {
    mockCallCoreCommand.mockReset();
  });

  describe('createTunnel', () => {
    it('calls openhuman.webhooks_create_tunnel with name and description', async () => {
      mockCallCoreCommand.mockResolvedValue(mockTunnel());
      const result = await tunnelsApi.createTunnel({ name: 'My Hook', description: 'test' });
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_create_tunnel', {
        name: 'My Hook',
        description: 'test',
      });
      expect(result.id).toBe('t1');
    });

    it('propagates errors', async () => {
      mockCallCoreCommand.mockRejectedValue(new Error('quota exceeded'));
      await expect(tunnelsApi.createTunnel({ name: 'Hook' })).rejects.toThrow('quota exceeded');
    });
  });

  describe('getTunnels', () => {
    it('calls openhuman.webhooks_list_tunnels', async () => {
      mockCallCoreCommand.mockResolvedValue([mockTunnel('t1'), mockTunnel('t2')]);
      const result = await tunnelsApi.getTunnels();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_list_tunnels');
      expect(result).toHaveLength(2);
    });
  });

  describe('getBandwidthUsage', () => {
    it('calls openhuman.webhooks_get_bandwidth', async () => {
      mockCallCoreCommand.mockResolvedValue({ remainingBudgetUsd: 0.5 });
      const result = await tunnelsApi.getBandwidthUsage();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_get_bandwidth');
      expect(result.remainingBudgetUsd).toBe(0.5);
    });
  });

  describe('getTunnel', () => {
    it('calls with tunnel id', async () => {
      mockCallCoreCommand.mockResolvedValue(mockTunnel('t99'));
      const result = await tunnelsApi.getTunnel('t99');
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_get_tunnel', {
        id: 't99',
      });
      expect(result.id).toBe('t99');
    });
  });

  describe('updateTunnel', () => {
    it('spreads tunnelId and body into params', async () => {
      mockCallCoreCommand.mockResolvedValue(mockTunnel('t1'));
      await tunnelsApi.updateTunnel('t1', { name: 'Updated', isActive: false });
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_update_tunnel', {
        id: 't1',
        name: 'Updated',
        isActive: false,
      });
    });
  });

  describe('deleteTunnel', () => {
    it('calls delete with tunnel id', async () => {
      mockCallCoreCommand.mockResolvedValue(undefined);
      await tunnelsApi.deleteTunnel('t1');
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.webhooks_delete_tunnel', {
        id: 't1',
      });
    });
  });

  describe('ingressUrl', () => {
    it('builds ingress URL correctly', () => {
      expect(tunnelsApi.ingressUrl('https://api.example.com', 'uuid-abc')).toBe(
        'https://api.example.com/webhooks/ingress/uuid-abc'
      );
    });

    it('strips trailing slash from backendUrl', () => {
      expect(tunnelsApi.ingressUrl('https://api.example.com/', 'uuid-abc')).toBe(
        'https://api.example.com/webhooks/ingress/uuid-abc'
      );
    });
  });
});
