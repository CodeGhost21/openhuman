/**
 * Tests for coreCommandClient.ts
 * Verifies that callCoreCommand properly delegates to callCoreRpc
 * and extracts the result.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { callCoreCommand } from '../coreCommandClient';
// Import after mock
import { callCoreRpc } from '../coreRpcClient';

vi.mock('../coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

describe('callCoreCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls callCoreRpc with correct method and params', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: 'ok', logs: [] });

    await callCoreCommand('openhuman.test_method', { foo: 'bar' });

    expect(callCoreRpc).toHaveBeenCalledWith({
      method: 'openhuman.test_method',
      params: { foo: 'bar' },
    });
  });

  it('returns the result field from the response', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: { data: 42 }, logs: [] });

    const result = await callCoreCommand<{ data: number }>('openhuman.get_data');

    expect(result).toEqual({ data: 42 });
  });

  it('calls callCoreRpc with undefined params when no params provided', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: null, logs: [] });

    await callCoreCommand('openhuman.no_params');

    expect(callCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.no_params', params: undefined });
  });

  it('returns string result correctly', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: 'hello', logs: [] });

    const result = await callCoreCommand<string>('openhuman.greet');

    expect(result).toBe('hello');
  });

  it('returns null result when core returns null', async () => {
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: null, logs: [] });

    const result = await callCoreCommand('openhuman.nullable');

    expect(result).toBeNull();
  });

  it('propagates errors from callCoreRpc', async () => {
    vi.mocked(callCoreRpc).mockRejectedValueOnce(new Error('RPC failure'));

    await expect(callCoreCommand('openhuman.failing')).rejects.toThrow('RPC failure');
  });

  it('handles array result', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: items, logs: [] });

    const result = await callCoreCommand<typeof items>('openhuman.list');

    expect(result).toEqual(items);
    expect(result).toHaveLength(2);
  });
});
