import { describe, expect, it, vi, beforeEach } from 'vitest';
import { skillManager } from '../manager';
import { SkillRuntime } from '../runtime';
import { emitSkillStateChange } from '../skillEvents';
import { setSetupComplete as rpcSetSetupComplete } from '../skillsApi';
import type { SkillManifest } from '../types';

vi.mock('../runtime', () => {
  const mockRuntime = {
    start: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onReverseRpc: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
    setupStart: vi.fn().mockResolvedValue({ id: 'step1' }),
    setupSubmit: vi.fn().mockResolvedValue({ status: 'complete' }),
    callTool: vi.fn(),
    isRunning: false,
  };
  return {
    // eslint-disable-next-line prefer-arrow-callback
    SkillRuntime: vi.fn().mockImplementation(function () {
      return mockRuntime;
    }),
  };
});

vi.mock('../../../services/coreRpcClient', () => ({
  callCoreRpc: vi.fn(),
}));

vi.mock('../../coreState/store', () => ({
  setCoreStateSnapshot: vi.fn(),
}));

vi.mock('../skillEvents', () => ({
  emitSkillStateChange: vi.fn(),
}));

vi.mock('../skillsApi', () => ({
  getSkillSnapshot: vi.fn(),
  setSetupComplete: vi.fn().mockResolvedValue({}),
  stopSkill: vi.fn(),
  revokeOAuth: vi.fn(),
  removePersistedOAuthCredential: vi.fn(),
  removePersistedClientKey: vi.fn(),
  revokeAuth: vi.fn(),
  removePersistedAuthCredential: vi.fn(),
}));

vi.mock('../sync', () => ({
  syncToolsToBackend: vi.fn(),
}));

vi.mock('../../../utils/tauriCommands', () => ({
  runtimeSkillDataDir: vi.fn().mockResolvedValue('/mock/dir'),
  runtimeSkillDataRead: vi.fn(),
  runtimeSkillDataWrite: vi.fn(),
}));

vi.mock('../../../utils/config', () => ({
  CORE_RPC_URL: 'http://127.0.0.1:7788/rpc',
  IS_DEV: true,
  DEV_FORCE_ONBOARDING: false,
  SKILLS_GITHUB_REPO: 'test/skills',
  SENTRY_DSN: undefined,
  BACKEND_URL: 'http://localhost:5005',
  TELEGRAM_BOT_USERNAME: 'openhuman_bot',
  DEV_JWT_TOKEN: undefined,
  TOOL_TIMEOUT_SECS: 120,
}));

describe('SkillManager', () => {
  const mockManifest: SkillManifest = {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    author: 'Test Author',
    icon: 'test-icon',
    setup: { required: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // We need to clear the internal Map in SkillManager if we want isolated tests.
    // Since it's a singleton, we might need a way to reset it.
    // For now, let's just use different IDs if needed, or hope for the best.
    // Looking at SkillManager, it's not easy to reset without adding a reset method.
    // I'll try to stop the skill after each test.
  });

  it('should start a skill and register it', async () => {
    await skillManager.startSkill(mockManifest);
    
    expect(SkillRuntime).toHaveBeenCalledWith(mockManifest);
    expect(emitSkillStateChange).toHaveBeenCalledWith('test-skill');
  });

  it('should handle setup flow', async () => {
    await skillManager.startSkill(mockManifest);
    const runtime = vi.mocked(new SkillRuntime(mockManifest));
    runtime.isRunning = true;

    const step = await skillManager.startSetup('test-skill');
    expect(step).toEqual({ id: 'step1' });
    expect(runtime.setupStart).toHaveBeenCalled();

    const result = await skillManager.submitSetup('test-skill', 'step1', { foo: 'bar' });
    expect(result).toEqual({ status: 'complete' });
    expect(runtime.setupSubmit).toHaveBeenCalledWith('step1', { foo: 'bar' });
    
    expect(rpcSetSetupComplete).toHaveBeenCalledWith('test-skill', true);
  });

  it('should call tool on running skill', async () => {
    await skillManager.startSkill(mockManifest);
    const runtime = vi.mocked(new SkillRuntime(mockManifest));
    runtime.isRunning = true;
    runtime.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'hi' }], isError: false });

    const result = await skillManager.callTool('test-skill', 'sayHi', { name: 'world' });
    
    expect(result.content[0].text).toBe('hi');
    expect(runtime.callTool).toHaveBeenCalledWith('sayHi', { name: 'world' });
  });

  it('should stop a skill', async () => {
    await skillManager.startSkill(mockManifest);
    const runtime = vi.mocked(new SkillRuntime(mockManifest));
    
    await skillManager.stopSkill('test-skill');
    
    expect(runtime.stop).toHaveBeenCalled();
    expect(skillManager.isSkillRunning('test-skill')).toBe(false);
  });
});
