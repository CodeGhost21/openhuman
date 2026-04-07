import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SkillTransport } from '../transport';
import { runtimeRpc, runtimeStopSkill } from '../../../utils/tauriCommands';

vi.mock('../../../utils/tauriCommands', () => ({
  runtimeRpc: vi.fn(),
  runtimeStopSkill: vi.fn(),
}));

describe('SkillTransport', () => {
  let transport: SkillTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new SkillTransport();
  });

  it('should start with a skillId', async () => {
    await transport.start('test-skill');
    expect(transport.isRunning).toBe(true);
  });

  it('should throw error if request is called before start', async () => {
    await expect(transport.request('test/method')).rejects.toThrow('Skill transport not started');
  });

  it('should send a request via runtimeRpc', async () => {
    vi.mocked(runtimeRpc).mockResolvedValue({ success: true });
    await transport.start('test-skill');
    
    const result = await transport.request('test/method', { foo: 'bar' });
    
    expect(result).toEqual({ success: true });
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'test/method', { foo: 'bar' });
  });

  it('should send a notification via runtimeRpc', async () => {
    vi.mocked(runtimeRpc).mockResolvedValue({});
    await transport.start('test-skill');
    
    transport.notify('test/notify', { foo: 'bar' });
    
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'test/notify', { foo: 'bar' });
  });

  it('should call runtimeStopSkill on kill', async () => {
    await transport.start('test-skill');
    await transport.kill();
    
    expect(runtimeStopSkill).toHaveBeenCalledWith('test-skill');
    expect(transport.isRunning).toBe(false);
  });

  it('should handle runtimeRpc errors in notify gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runtimeRpc).mockRejectedValue(new Error('RPC Error'));
    
    await transport.start('test-skill');
    transport.notify('test/notify');
    
    // Since it's fire and forget, we might need to wait for the promise to reject
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(consoleSpy).toHaveBeenCalledWith('[skill-transport] Notification error:', expect.any(Error));
  });
});
