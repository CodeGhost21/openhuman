import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-import fresh since setup.ts silences console globally.
// We need to test that the right console methods are called.
const { mcpLog, mcpWarn, mcpError } = await import('../logger');

describe('MCP logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('mcpLog', () => {
    it('calls console.log with [MCP] prefix and message', () => {
      mcpLog('hello world');
      expect(logSpy).toHaveBeenCalledWith('[MCP]', 'hello world');
    });

    it('passes additional data arguments', () => {
      mcpLog('message', { foo: 'bar' }, 42);
      expect(logSpy).toHaveBeenCalledWith('[MCP]', 'message', { foo: 'bar' }, 42);
    });
  });

  describe('mcpWarn', () => {
    it('calls console.warn with [MCP] prefix', () => {
      mcpWarn('rate limit hit');
      expect(warnSpy).toHaveBeenCalledWith('[MCP]', 'rate limit hit');
    });

    it('passes additional arguments', () => {
      mcpWarn('warn msg', 'extra');
      expect(warnSpy).toHaveBeenCalledWith('[MCP]', 'warn msg', 'extra');
    });
  });

  describe('mcpError', () => {
    it('calls console.error with [MCP] prefix', () => {
      mcpError('something failed');
      expect(errorSpy).toHaveBeenCalledWith('[MCP]', 'something failed');
    });

    it('passes Error objects', () => {
      const err = new Error('boom');
      mcpError('error occurred', err);
      expect(errorSpy).toHaveBeenCalledWith('[MCP]', 'error occurred', err);
    });
  });
});
