import { describe, expect, it, vi } from 'vitest';

import { ErrorCategory, logAndFormatError, withErrorHandling } from '../errorHandler';
import { ValidationError } from '../validation';

describe('logAndFormatError', () => {
  it('returns an isError MCPToolResult', () => {
    const result = logAndFormatError('myFn', new Error('oops'));
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
  });

  it('returns generic message with error code for generic errors', () => {
    const result = logAndFormatError('someFunction', new Error('internal'));
    expect(result.content[0].text).toMatch(/code:/);
  });

  it('returns the ValidationError message directly', () => {
    const err = new ValidationError('Invalid chat_id: must be integer');
    const result = logAndFormatError('myFn', err, ErrorCategory.VALIDATION);
    expect(result.content[0].text).toBe('Invalid chat_id: must be integer');
  });

  it('includes category in the error code', () => {
    const result = logAndFormatError('doThing', new Error('x'), ErrorCategory.MSG);
    expect(result.content[0].text).toMatch(/MSG-ERR/);
  });

  it('uses VALIDATION-001 code for VALIDATION category', () => {
    const err = new Error('bad param');
    const result = logAndFormatError('fn', err, ErrorCategory.VALIDATION);
    // VALIDATION category produces VALIDATION-001 code
    expect(result.content[0].text).toMatch(/code:/);
  });

  it('handles context object in error code generation', () => {
    const result = logAndFormatError('fn', new Error('x'), ErrorCategory.CHAT, { chatId: 123 });
    expect(result.isError).toBe(true);
  });
});

describe('withErrorHandling', () => {
  it('passes through successful function result', async () => {
    const fn = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      isError: false,
    }));
    const wrapped = withErrorHandling(fn, ErrorCategory.MSG);
    const result = await wrapped();
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('ok');
  });

  it('catches thrown Error and returns isError result', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const wrapped = withErrorHandling(fn as never);
    const result = await wrapped();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/code:/);
  });

  it('catches thrown string and wraps it in Error', async () => {
    const fn = vi.fn(async () => {
      throw 'string error';
    });
    const wrapped = withErrorHandling(fn as never);
    const result = await wrapped();
    expect(result.isError).toBe(true);
  });

  it('catches ValidationError and shows user-friendly message', async () => {
    const fn = vi.fn(async () => {
      throw new ValidationError('Invalid param');
    });
    const wrapped = withErrorHandling(fn as never, ErrorCategory.VALIDATION);
    const result = await wrapped();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid param');
  });

  it('preserves original function arguments', async () => {
    const fn = vi.fn(async (a: number, b: string) => ({
      content: [{ type: 'text' as const, text: `${a}-${b}` }],
      isError: false,
    }));
    const wrapped = withErrorHandling(fn as never);
    await wrapped(42, 'hello');
    expect(fn).toHaveBeenCalledWith(42, 'hello');
  });
});
