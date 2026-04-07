import { describe, expect, it } from 'vitest';

import {
  createChatMessage,
  getExecutionStatusLabel,
  getPriorityInfo,
  getSourceInfo,
  transformBackendItemToFrontend,
  transformBackendMessageToFrontend,
  transformConnectedToolsToMCP,
  transformFrontendMessageToBackend,
  transformMCPToConnectedTools,
  validateBackendItem,
} from '../intelligenceTransforms';

describe('intelligenceTransforms', () => {
  describe('transformBackendItemToFrontend', () => {
    it('transforms a complete backend item', () => {
      const now = new Date().toISOString();
      const backendItem = {
        id: '1',
        title: 'Test',
        description: 'Desc',
        source: 'email',
        priority: 'critical',
        status: 'open',
        createdAt: now,
        updatedAt: now,
        actionable: true,
        requiresConfirmation: false,
        hasComplexAction: false,
        reminderCount: 0,
      } as any;

      const frontendItem = transformBackendItemToFrontend(backendItem);
      expect(frontendItem.id).toBe('1');
      expect(frontendItem.createdAt).toBeInstanceOf(Date);
      expect(frontendItem.createdAt.toISOString()).toBe(now);
      expect(frontendItem.source).toBe('email');
    });

    it('handles optional date fields', () => {
      const now = new Date().toISOString();
      const backendItem = {
        id: '1',
        createdAt: now,
        updatedAt: now,
        expiresAt: now,
        snoozeUntil: null,
      } as any;

      const frontendItem = transformBackendItemToFrontend(backendItem);
      expect(frontendItem.expiresAt).toBeInstanceOf(Date);
      expect(frontendItem.snoozeUntil).toBeUndefined();
    });
  });

  describe('message transformations', () => {
    it('transforms backend message to frontend', () => {
      const now = new Date().toISOString();
      const backendMsg = { id: 'm1', content: 'hi', role: 'user', timestamp: now, threadId: 't1' };
      const frontendMsg = transformBackendMessageToFrontend(backendMsg);
      expect(frontendMsg.id).toBe('m1');
      expect(frontendMsg.sender).toBe('user');
      expect(frontendMsg.timestamp).toBeInstanceOf(Date);
    });

    it('transforms assistant role to ai sender', () => {
      const backendMsg = {
        id: 'm1',
        content: 'hi',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        threadId: 't1',
      };
      const frontendMsg = transformBackendMessageToFrontend(backendMsg);
      expect(frontendMsg.sender).toBe('ai');
    });

    it('transforms frontend message to backend', () => {
      const now = new Date();
      const frontendMsg = { id: 'f1', content: 'hello', sender: 'user' as const, timestamp: now };
      const backendMsg = transformFrontendMessageToBackend(frontendMsg, 't1');
      expect(backendMsg.content).toBe('hello');
      expect(backendMsg.role).toBe('user');
      expect(backendMsg.timestamp).toBe(now.toISOString());
      expect(backendMsg.threadId).toBe('t1');
    });
  });

  describe('MCP tools transformations', () => {
    it('transforms MCP tools to connected tools', () => {
      const mcpTools = [
        { name: 'skill1__tool1', description: 'desc1', inputSchema: { type: 'object' } },
      ] as any;
      const connected = transformMCPToConnectedTools(mcpTools);
      expect(connected[0].name).toBe('tool1');
      expect(connected[0].skillId).toBe('skill1');
    });

    it('transforms connected tools back to MCP', () => {
      const connected = [
        { name: 'tool1', skillId: 'skill1', description: 'desc1', parameters: {}, enabled: true },
      ];
      const mcp = transformConnectedToolsToMCP(connected);
      expect(mcp[0].name).toBe('skill1__tool1');
    });
  });

  describe('validateBackendItem', () => {
    it('returns true for valid item', () => {
      const valid = {
        id: '1',
        title: 'T',
        source: 's',
        priority: 'p',
        status: 's',
        createdAt: '2023',
        updatedAt: '2023',
        actionable: true,
      };
      expect(validateBackendItem(valid)).toBe(true);
    });

    it('returns false for invalid item', () => {
      expect(validateBackendItem(null)).toBe(false);
      expect(validateBackendItem({})).toBe(false);
    });
  });

  describe('createChatMessage', () => {
    it('creates a message with generated id', () => {
      const msg = createChatMessage('hello', 'user');
      expect(msg.content).toBe('hello');
      expect(msg.id).toContain('user-');
    });
  });

  describe('display info helpers', () => {
    it('returns correct labels for execution status', () => {
      expect(getExecutionStatusLabel('idle')).toBe('Ready');
      expect(getExecutionStatusLabel('running')).toBe('In Progress');
      expect(getExecutionStatusLabel('unknown')).toBe('Unknown');
    });

    it('returns priority info', () => {
      const info = getPriorityInfo('critical');
      expect(info.label).toBe('Critical');
      expect(info.color).toBe('coral');
    });

    it('returns source info', () => {
      const info = getSourceInfo('telegram');
      expect(info.label).toBe('Telegram');
      expect(info.icon).toBe('💬');
    });
  });
});
