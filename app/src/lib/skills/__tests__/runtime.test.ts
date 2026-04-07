import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SkillRuntime } from '../runtime';
import { callCoreRpc } from '../../../services/coreRpcClient';
import type { SkillManifest } from '../types';

vi.mock('../../../services/coreRpcClient', () => ({
  callCoreRpc: vi.fn(),
}));

vi.mock('../../../utils/tauriCommands', () => ({
  runtimeSkillDataDir: vi.fn().mockResolvedValue('/mock/data/dir'),
  runtimeRpc: vi.fn(),
  runtimeStopSkill: vi.fn(),
}));


describe('SkillRuntime', () => {
  const mockManifest: SkillManifest = {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    author: 'Test Author',
    icon: 'test-icon',
  };

  let runtime: SkillRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new SkillRuntime(mockManifest);
  });

  it('should start the skill via core RPC and initialize transport', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({});
    
    await runtime.start();
    
    expect(callCoreRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_start',
      params: { skill_id: 'test-skill' },
    });
    expect(runtime.isRunning).toBe(true);
  });

  it('should send load request with manifest and data dir', async () => {
    await runtime.start();
    
    // We need to access the private transport or just assume it calls through.
    // Since we mocked runtimeRpc in transport, let's check if it was called.
    const { runtimeRpc } = await import('../../../utils/tauriCommands');
    
    await runtime.load({ extra: 'param' });
    
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'skill/load', expect.objectContaining({
      manifest: mockManifest,
      dataDir: '/mock/data/dir',
      extra: 'param'
    }));
  });

  it('should call tool via transport', async () => {
    const { runtimeRpc } = await import('../../../utils/tauriCommands');
    vi.mocked(runtimeRpc).mockResolvedValueOnce({ content: [{ type: 'text', text: 'result' }], isError: false });
    
    await runtime.start();
    const result = await runtime.callTool('my-tool', { arg1: 'val1' });
    
    expect(result).toEqual({ content: [{ type: 'text', text: 'result' }], isError: false });
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'tools/call', { name: 'my-tool', arguments: { arg1: 'val1' } });
  });

  it('should stop the skill', async () => {
    const { runtimeRpc, runtimeStopSkill } = await import('../../../utils/tauriCommands');
    
    await runtime.start();
    await runtime.stop();
    
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'skill/shutdown', {});
    expect(runtimeStopSkill).toHaveBeenCalledWith('test-skill');
    expect(runtime.isRunning).toBe(false);
  });

  it('should handle setupStart', async () => {
    const { runtimeRpc } = await import('../../../utils/tauriCommands');
    const mockStep = { id: 'step1', title: 'Step 1' };
    vi.mocked(runtimeRpc).mockResolvedValueOnce({ step: mockStep });
    
    await runtime.start();
    const result = await runtime.setupStart();
    
    expect(result).toEqual(mockStep);
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'setup/start', {});
  });

  it('should handle setupSubmit', async () => {
    const { runtimeRpc } = await import('../../../utils/tauriCommands');
    const mockResult = { status: 'complete' };
    vi.mocked(runtimeRpc).mockResolvedValueOnce(mockResult);
    
    await runtime.start();
    const result = await runtime.setupSubmit('step1', { field1: 'val1' });
    
    expect(result).toEqual(mockResult);
    expect(runtimeRpc).toHaveBeenCalledWith('test-skill', 'setup/submit', { stepId: 'step1', values: { field1: 'val1' } });
  });
});
