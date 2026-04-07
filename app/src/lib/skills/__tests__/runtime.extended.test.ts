/**
 * Extended tests for SkillRuntime
 * Covers previously uncovered lines: 106-133, 157-209
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillRuntime } from '../runtime';

vi.mock('../../../services/coreRpcClient', () => ({
  callCoreRpc: vi.fn(),
}));

vi.mock('../../../utils/tauriCommands', () => ({
  runtimeSkillDataDir: vi.fn().mockResolvedValue('/mock/data/dir'),
  runtimeRpc: vi.fn(),
  runtimeStopSkill: vi.fn(),
}));

import { callCoreRpc } from '../../../services/coreRpcClient';
import { runtimeRpc, runtimeStopSkill } from '../../../utils/tauriCommands';

const mockManifest = {
  id: 'extended-skill',
  name: 'Extended Skill',
  version: '1.0.0',
  description: 'A skill for extended tests',
  author: 'Test',
  icon: 'icon',
};

describe('SkillRuntime (extended coverage)', () => {
  let runtime: SkillRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callCoreRpc).mockResolvedValue({});
    vi.mocked(runtimeRpc).mockResolvedValue({});
    runtime = new SkillRuntime(mockManifest);
  });

  describe('onReverseRpc', () => {
    it('registers a reverse RPC handler without throwing', () => {
      const handler = vi.fn();
      expect(() => runtime.onReverseRpc(handler)).not.toThrow();
    });
  });

  describe('stop()', () => {
    it('does nothing when skill was never started', async () => {
      await runtime.stop();
      expect(runtimeRpc).not.toHaveBeenCalled();
      expect(runtimeStopSkill).not.toHaveBeenCalled();
    });

    it('sends shutdown request and kills transport when started', async () => {
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValue({});

      await runtime.stop();

      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'skill/shutdown',
        expect.anything()
      );
      expect(runtime.isRunning).toBe(false);
    });

    it('handles shutdown errors gracefully (swallows them)', async () => {
      await runtime.start();
      vi.mocked(runtimeRpc).mockRejectedValueOnce(new Error('Skill already dead'));

      await expect(runtime.stop()).resolves.not.toThrow();
      expect(runtime.isRunning).toBe(false);
    });
  });

  describe('listTools()', () => {
    it('returns the tools array from the response', async () => {
      const tools = [{ name: 'tool_a', description: 'A tool' }];
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce({ tools });

      const result = await runtime.listTools();

      expect(result).toEqual(tools);
      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'tools/list',
        expect.anything()
      );
    });

    it('returns empty array when no tools', async () => {
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce({ tools: [] });

      const result = await runtime.listTools();
      expect(result).toEqual([]);
    });
  });

  describe('setupStart()', () => {
    it('returns null when skill returns null response', async () => {
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce(null);

      const result = await runtime.setupStart();
      expect(result).toBeNull();
    });

    it('returns null when response has no step property', async () => {
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce({});

      const result = await runtime.setupStart();
      expect(result).toBeNull();
    });

    it('returns the step when response has step', async () => {
      const step = { id: 'step-1', title: 'Configure API Key' };
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce({ step });

      const result = await runtime.setupStart();
      expect(result).toEqual(step);
    });
  });

  describe('setupSubmit()', () => {
    it('sends setup/submit with stepId and values', async () => {
      const mockResult = { status: 'next', nextStep: { id: 'step-2' } };
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce(mockResult);

      const result = await runtime.setupSubmit('step-1', { apiKey: 'abc123' });

      expect(result).toEqual(mockResult);
      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'setup/submit',
        { stepId: 'step-1', values: { apiKey: 'abc123' } }
      );
    });

    it('returns complete status when setup is done', async () => {
      const mockResult = { status: 'complete' };
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce(mockResult);

      const result = await runtime.setupSubmit('final-step', {});
      expect(result).toEqual(mockResult);
    });
  });

  describe('callTool()', () => {
    it('calls tools/call with name and arguments', async () => {
      const mockResult = { content: [{ type: 'text', text: 'result data' }], isError: false };
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce(mockResult);

      const result = await runtime.callTool('my_tool', { param: 'value' });

      expect(result).toEqual(mockResult);
      expect(runtimeRpc).toHaveBeenCalledWith('extended-skill', 'tools/call', {
        name: 'my_tool',
        arguments: { param: 'value' },
      });
    });

    it('returns isError true when tool execution fails', async () => {
      const errorResult = {
        content: [{ type: 'text', text: 'Tool error occurred' }],
        isError: true,
      };
      await runtime.start();
      vi.mocked(runtimeRpc).mockResolvedValueOnce(errorResult);

      const result = await runtime.callTool('broken_tool', {});
      expect(result.isError).toBe(true);
    });
  });

  describe('oauthComplete()', () => {
    it('sends oauth/complete with credential args', async () => {
      await runtime.start();

      await runtime.oauthComplete({
        credentialId: 'cred-123',
        provider: 'google',
        grantedScopes: ['email', 'profile'],
        accountLabel: 'user@example.com',
      });

      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'oauth/complete',
        expect.objectContaining({
          credentialId: 'cred-123',
          provider: 'google',
        })
      );
    });

    it('sends oauth/complete without optional fields', async () => {
      await runtime.start();

      await runtime.oauthComplete({
        credentialId: 'cred-456',
        provider: 'github',
      });

      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'oauth/complete',
        expect.objectContaining({ credentialId: 'cred-456', provider: 'github' })
      );
    });
  });

  describe('oauthRevoked()', () => {
    it('sends oauth/revoked with credentialId and reason', async () => {
      await runtime.start();

      await runtime.oauthRevoked({
        credentialId: 'cred-789',
        reason: 'user_revoked',
      });

      expect(runtimeRpc).toHaveBeenCalledWith(
        'extended-skill',
        'oauth/revoked',
        expect.objectContaining({ credentialId: 'cred-789', reason: 'user_revoked' })
      );
    });
  });

  describe('skillId getter', () => {
    it('returns the manifest id', () => {
      expect(runtime.skillId).toBe('extended-skill');
    });
  });

  describe('isRunning getter', () => {
    it('returns false before start', () => {
      expect(runtime.isRunning).toBe(false);
    });

    it('returns true after start', async () => {
      await runtime.start();
      expect(runtime.isRunning).toBe(true);
    });

    it('returns false after stop', async () => {
      await runtime.start();
      await runtime.stop();
      expect(runtime.isRunning).toBe(false);
    });
  });
});
