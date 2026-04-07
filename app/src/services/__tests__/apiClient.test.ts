import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient, setStoreForApiClient } from '../apiClient';
import { getBackendUrl } from '../backendUrl';

vi.mock('../backendUrl', () => ({
  getBackendUrl: vi.fn().mockResolvedValue('http://localhost:5005'),
}));

describe('apiClient', () => {
  const mockFetch = vi.fn();
  const mockGetToken = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockGetToken.mockReset();
    setStoreForApiClient(mockGetToken);
    vi.mocked(getBackendUrl).mockResolvedValue('http://localhost:5005');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request methods', () => {
    it('should make a GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'test' }),
      } as Response);

      const result = await apiClient.get('/test');

      expect(result).toEqual({ data: 'test' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/test',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
    });

    it('should make a POST request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      } as Response);

      const result = await apiClient.post('/test', { foo: 'bar' });

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/test',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ foo: 'bar' }) })
      );
    });

    it('should make a PUT request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ updated: true }),
      } as Response);

      const result = await apiClient.put('/test', { id: 1 });

      expect(result).toEqual({ updated: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/test',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should make a PATCH request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ patched: true }),
      } as Response);

      const result = await apiClient.patch('/test', { patch: 'data' });

      expect(result).toEqual({ patched: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/test',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should make a DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ deleted: true }),
      } as Response);

      const result = await apiClient.delete('/test');

      expect(result).toEqual({ deleted: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/test',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('authentication', () => {
    it('should add Authorization header when token is available', async () => {
      mockGetToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response);

      await apiClient.get('/secure');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/secure',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });

    it('should NOT add Authorization header when requireAuth is false', async () => {
      mockGetToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response);

      await apiClient.get('/public', { requireAuth: false });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5005/public',
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'invalid_params', message: 'Invalid parameters' }),
      } as Response);

      await expect(apiClient.get('/error')).rejects.toEqual({
        success: false,
        error: 'invalid_params',
        message: 'Invalid parameters',
      });
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'text/plain' }),
      } as Response);

      await expect(apiClient.get('/error')).rejects.toEqual({
        success: false,
        error: 'HTTP error! status: 500',
      });
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      await expect(apiClient.get('/error')).rejects.toEqual({
        success: false,
        error: 'Network failure',
      });
    });

    it('should handle timeouts', async () => {
      // Vitest's fake timers could be used here, but apiClient uses real setTimeout inside.
      // We can mock AbortController or just trigger the timeout logic if we can.
      // The apiClient implementation uses a real setTimeout.

      const abortError = new DOMException('Request timed out', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(apiClient.get('/timeout', { timeout: 100 })).rejects.toEqual({
        success: false,
        error: 'Request timed out after 0.1s',
      });
    });
  });
});
