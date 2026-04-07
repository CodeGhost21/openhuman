import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const { apiClient } = vi.mocked(await import('../../apiClient'));
const { inferenceApi } = await import('../inferenceApi');

const mockChoice = (text = 'Hello') => ({
  index: 0,
  message: { role: 'assistant' as const, content: text },
  finish_reason: 'stop',
});

const mockUsage = () => ({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

describe('inferenceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listModels', () => {
    it('fetches from /openai/v1/models', async () => {
      const modelsResponse = {
        object: 'list',
        data: [{ id: 'gpt-4', object: 'model', created: 1000, owned_by: 'openai' }],
      };
      vi.mocked(apiClient.get).mockResolvedValue(modelsResponse);
      const result = await inferenceApi.listModels();
      expect(apiClient.get).toHaveBeenCalledWith('/openai/v1/models');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('gpt-4');
    });

    it('propagates network errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Connection refused'));
      await expect(inferenceApi.listModels()).rejects.toThrow('Connection refused');
    });
  });

  describe('createChatCompletion', () => {
    it('posts to /openai/v1/chat/completions', async () => {
      const chatResponse = {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1000,
        model: 'gpt-4',
        choices: [mockChoice('Hello world')],
        usage: mockUsage(),
      };
      vi.mocked(apiClient.post).mockResolvedValue(chatResponse);
      const request = { model: 'gpt-4', messages: [{ role: 'user' as const, content: 'Hi' }] };
      const result = await inferenceApi.createChatCompletion(request);
      expect(apiClient.post).toHaveBeenCalledWith('/openai/v1/chat/completions', request);
      expect(result.choices[0].message.content).toBe('Hello world');
    });

    it('passes tools when provided', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        id: 'cc1',
        object: 'chat.completion',
        created: 1,
        model: 'm1',
        choices: [],
        usage: mockUsage(),
      });
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user' as const, content: 'Use a tool' }],
        tools: [
          {
            type: 'function' as const,
            function: { name: 'search', description: 'search', parameters: {} },
          },
        ],
        tool_choice: 'auto' as const,
      };
      await inferenceApi.createChatCompletion(request);
      expect(apiClient.post).toHaveBeenCalledWith('/openai/v1/chat/completions', request);
    });
  });

  describe('createCompletion', () => {
    it('posts to /openai/v1/completions', async () => {
      const completionResponse = {
        id: 'cmpl-1',
        object: 'text_completion',
        created: 1000,
        model: 'gpt-3.5-turbo-instruct',
        choices: [{ index: 0, text: 'The sky is blue', finish_reason: 'stop' }],
        usage: mockUsage(),
      };
      vi.mocked(apiClient.post).mockResolvedValue(completionResponse);
      const request = { model: 'gpt-3.5-turbo-instruct', prompt: 'The sky is' };
      const result = await inferenceApi.createCompletion(request);
      expect(apiClient.post).toHaveBeenCalledWith('/openai/v1/completions', request);
      expect(result.choices[0].text).toBe('The sky is blue');
    });
  });
});
