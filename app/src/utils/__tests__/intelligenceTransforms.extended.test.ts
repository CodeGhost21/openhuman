/**
 * Extended tests for intelligenceTransforms.ts
 * Covers uncovered lines 196-198, 202-208:
 *   - getSourceInfo edge cases for all source values
 *   - getPriorityInfo for all priority values
 *   - transformMCPToConnectedTools with tools that have no __ separator
 *   - createChatMessage with explicit id
 *   - transformBackendItemsToFrontend with empty array
 *   - transformBackendMessagesToFrontend with empty array
 */
import { describe, expect, it } from 'vitest';

import {
  createChatMessage,
  getExecutionStatusLabel,
  getPriorityInfo,
  getSourceInfo,
  transformBackendItemsToFrontend,
  transformBackendMessagesToFrontend,
  transformConnectedToolsToMCP,
  transformMCPToConnectedTools,
  validateBackendItem,
} from '../intelligenceTransforms';

describe('getSourceInfo — all source values', () => {
  it('returns correct info for email source', () => {
    const info = getSourceInfo('email');
    expect(info.label).toBe('Email');
    expect(info.icon).toBe('📧');
    expect(info.className).toContain('blue');
  });

  it('returns correct info for calendar source', () => {
    const info = getSourceInfo('calendar');
    expect(info.label).toBe('Calendar');
    expect(info.icon).toBe('📅');
    expect(info.className).toContain('green');
  });

  it('returns correct info for telegram source', () => {
    const info = getSourceInfo('telegram');
    expect(info.label).toBe('Telegram');
    expect(info.icon).toBe('💬');
    expect(info.className).toContain('blue');
  });

  it('returns correct info for ai_insight source', () => {
    const info = getSourceInfo('ai_insight');
    expect(info.label).toBe('AI Insight');
    expect(info.icon).toBe('🤖');
    expect(info.className).toContain('purple');
  });

  it('returns correct info for system source', () => {
    const info = getSourceInfo('system');
    expect(info.label).toBe('System');
    expect(info.icon).toBe('⚙️');
    expect(info.className).toContain('stone');
  });

  it('returns correct info for trading source', () => {
    const info = getSourceInfo('trading');
    expect(info.label).toBe('Trading');
    expect(info.icon).toBe('📈');
    expect(info.className).toContain('yellow');
  });

  it('returns correct info for security source', () => {
    const info = getSourceInfo('security');
    expect(info.label).toBe('Security');
    expect(info.icon).toBe('🔒');
    expect(info.className).toContain('red');
  });
});

describe('getPriorityInfo — all priority values', () => {
  it('returns correct info for critical priority', () => {
    const info = getPriorityInfo('critical');
    expect(info.label).toBe('Critical');
    expect(info.color).toBe('coral');
    expect(info.className).toContain('coral');
  });

  it('returns correct info for important priority', () => {
    const info = getPriorityInfo('important');
    expect(info.label).toBe('Important');
    expect(info.color).toBe('amber');
    expect(info.className).toContain('amber');
  });

  it('returns correct info for normal priority', () => {
    const info = getPriorityInfo('normal');
    expect(info.label).toBe('Normal');
    expect(info.color).toBe('sage');
    expect(info.className).toContain('sage');
  });
});

describe('getExecutionStatusLabel — edge cases', () => {
  it('returns Unknown for undefined', () => {
    expect(getExecutionStatusLabel(undefined)).toBe('Unknown');
  });

  it('returns Unknown for empty string', () => {
    expect(getExecutionStatusLabel('')).toBe('Unknown');
  });

  it('returns Unknown for an unrecognized status', () => {
    expect(getExecutionStatusLabel('pending')).toBe('Unknown');
  });

  it('returns Completed for completed', () => {
    expect(getExecutionStatusLabel('completed')).toBe('Completed');
  });

  it('returns Failed for failed', () => {
    expect(getExecutionStatusLabel('failed')).toBe('Failed');
  });
});

describe('createChatMessage with explicit id', () => {
  it('uses the provided id instead of generating one', () => {
    const msg = createChatMessage('test content', 'ai', 'explicit-id-123');
    expect(msg.id).toBe('explicit-id-123');
    expect(msg.content).toBe('test content');
    expect(msg.sender).toBe('ai');
  });

  it('generates an id with ai- prefix for ai sender', () => {
    const msg = createChatMessage('ai response', 'ai');
    expect(msg.id).toMatch(/^ai-/);
  });
});

describe('transformMCPToConnectedTools — edge cases', () => {
  it('handles tools without __ separator in name', () => {
    const tools = [
      { name: 'simpletool', description: 'A simple tool', inputSchema: { type: 'object' } },
    ] as Parameters<typeof transformMCPToConnectedTools>[0];

    const result = transformMCPToConnectedTools(tools);
    // When no __, split('__') gives ['simpletool'], so skillId = 'simpletool' (truthy)
    // toolName is undefined, so name falls back to tool.name = 'simpletool'
    expect(result[0].name).toBe('simpletool');
    // skillId gets the first segment ('simpletool'), not 'unknown'
    expect(result[0].skillId).toBe('simpletool');
    expect(result[0].enabled).toBe(true);
  });

  it('handles empty tools array', () => {
    const result = transformMCPToConnectedTools([]);
    expect(result).toEqual([]);
  });

  it('handles tools without inputSchema', () => {
    const tools = [{ name: 'skill__tool', description: 'desc' }] as Parameters<
      typeof transformMCPToConnectedTools
    >[0];

    const result = transformMCPToConnectedTools(tools);
    expect(result[0].parameters).toEqual({});
  });
});

describe('transformConnectedToolsToMCP — edge cases', () => {
  it('handles empty array', () => {
    const result = transformConnectedToolsToMCP([]);
    expect(result).toEqual([]);
  });

  it('handles tools with null/undefined parameters (falls back to {})', () => {
    const tools = [
      {
        name: 'tool',
        skillId: 'skill',
        description: 'desc',
        parameters: null as unknown as Record<string, unknown>,
        enabled: true,
      },
    ];
    const result = transformConnectedToolsToMCP(tools);
    // null || {} = {} — the fallback produces an empty properties object
    expect(result[0].inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('transformBackendItemsToFrontend — edge cases', () => {
  it('returns empty array for empty input', () => {
    const result = transformBackendItemsToFrontend([]);
    expect(result).toEqual([]);
  });

  it('transforms multiple items', () => {
    const now = new Date().toISOString();
    const items = [
      {
        id: '1',
        title: 'A',
        source: 'email',
        priority: 'critical',
        status: 'open',
        createdAt: now,
        updatedAt: now,
        actionable: true,
      },
      {
        id: '2',
        title: 'B',
        source: 'telegram',
        priority: 'normal',
        status: 'done',
        createdAt: now,
        updatedAt: now,
        actionable: false,
      },
    ] as Parameters<typeof transformBackendItemsToFrontend>[0];

    const result = transformBackendItemsToFrontend(items);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });
});

describe('transformBackendMessagesToFrontend — edge cases', () => {
  it('returns empty array for empty input', () => {
    const result = transformBackendMessagesToFrontend([]);
    expect(result).toEqual([]);
  });

  it('transforms assistant role to ai sender', () => {
    const msgs = [
      {
        id: 'm1',
        content: 'Hello',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        threadId: 't1',
      },
    ] as Parameters<typeof transformBackendMessagesToFrontend>[0];

    const result = transformBackendMessagesToFrontend(msgs);
    expect(result[0].sender).toBe('ai');
  });

  it('transforms user role to user sender', () => {
    const msgs = [
      {
        id: 'm2',
        content: 'Hi',
        role: 'user',
        timestamp: new Date().toISOString(),
        threadId: 't1',
      },
    ] as Parameters<typeof transformBackendMessagesToFrontend>[0];

    const result = transformBackendMessagesToFrontend(msgs);
    expect(result[0].sender).toBe('user');
  });
});

describe('validateBackendItem — edge cases', () => {
  it('returns false for a number', () => {
    expect(validateBackendItem(42)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(validateBackendItem([])).toBe(false);
  });

  it('returns false when actionable is not boolean', () => {
    const item = {
      id: '1',
      title: 'T',
      source: 's',
      priority: 'p',
      status: 's',
      createdAt: '2023',
      updatedAt: '2023',
      actionable: 'yes', // string instead of boolean
    };
    expect(validateBackendItem(item)).toBe(false);
  });

  it('returns false when required string fields are numbers', () => {
    const item = {
      id: 123, // should be string
      title: 'T',
      source: 's',
      priority: 'p',
      status: 's',
      createdAt: '2023',
      updatedAt: '2023',
      actionable: true,
    };
    expect(validateBackendItem(item)).toBe(false);
  });
});
