import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { threadApi } from '../../services/api/threadApi';
import threadReducer, {
  addInferenceResponse,
  addMessageLocal,
  addReaction,
  createThreadLocal,
  deleteThreadLocal,
  purgeThreads,
  sendMessage,
  setLastViewed,
  setPanelWidth,
  setSelectedThread,
} from '../threadSlice';

vi.mock('../../services/api/threadApi', () => ({
  threadApi: { purge: vi.fn(), sendMessage: vi.fn(), getSuggestQuestions: vi.fn() },
}));

vi.mock('../../lib/channels/routing', () => ({ resolveOutboundRoute: vi.fn(() => null) }));

vi.mock('../../utils/tauriCommands', () => ({
  isTauri: vi.fn(() => false),
  openhumanLocalAiSuggestQuestions: vi.fn(),
}));

function createStore() {
  return configureStore({ reducer: { thread: threadReducer } });
}

describe('threadSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('manages local threads', () => {
    const store = createStore();
    const now = new Date().toISOString();

    store.dispatch(createThreadLocal({ id: 't1', title: 'Thread 1', createdAt: now }));
    expect(store.getState().thread.threads).toHaveLength(1);
    expect(store.getState().thread.threads[0].id).toBe('t1');
    expect(store.getState().thread.messagesByThreadId['t1']).toEqual([]);

    store.dispatch(setSelectedThread('t1'));
    expect(store.getState().thread.selectedThreadId).toBe('t1');

    store.dispatch(deleteThreadLocal('t1'));
    expect(store.getState().thread.threads).toHaveLength(0);
    expect(store.getState().thread.selectedThreadId).toBeNull();
  });

  it('adds and reacts to messages', () => {
    const store = createStore();
    const now = new Date().toISOString();
    store.dispatch(createThreadLocal({ id: 't1', title: 'T1', createdAt: now }));
    store.dispatch(setSelectedThread('t1'));

    const msg = {
      id: 'm1',
      content: 'hi',
      sender: 'user',
      type: 'text',
      createdAt: now,
      extraMetadata: {},
    } as any;
    store.dispatch(addMessageLocal({ threadId: 't1', message: msg }));

    expect(store.getState().thread.messagesByThreadId['t1']).toHaveLength(1);
    expect(store.getState().thread.messages).toHaveLength(1);

    store.dispatch(addReaction({ threadId: 't1', messageId: 'm1', emoji: '👍' }));
    const updatedMsg = store.getState().thread.messages[0];
    expect(updatedMsg.extraMetadata.myReactions).toEqual(['👍']);

    // Toggle reaction
    store.dispatch(addReaction({ threadId: 't1', messageId: 'm1', emoji: '👍' }));
    expect(store.getState().thread.messages[0].extraMetadata.myReactions).toEqual([]);
  });

  it('handles inference responses', () => {
    const store = createStore();
    const now = new Date().toISOString();
    store.dispatch(createThreadLocal({ id: 't1', title: 'T1', createdAt: now }));
    store.dispatch(setSelectedThread('t1'));

    store.dispatch(addInferenceResponse({ content: 'AI Response', threadId: 't1' }));

    expect(store.getState().thread.messages).toHaveLength(1);
    expect(store.getState().thread.messages[0].sender).toBe('agent');
    expect(store.getState().thread.messages[0].content).toBe('AI Response');
  });

  it('sets panel width and last viewed', () => {
    const store = createStore();
    store.dispatch(setPanelWidth(400));
    expect(store.getState().thread.panelWidth).toBe(400);

    store.dispatch(setLastViewed('t1'));
    expect(store.getState().thread.lastViewedAt['t1']).toBeDefined();
  });

  describe('extraReducers (async thunks)', () => {
    it('handles purgeThreads.fulfilled', async () => {
      const store = createStore();
      vi.mocked(threadApi.purge).mockResolvedValue({ success: true } as any);

      await store.dispatch(purgeThreads());

      expect(store.getState().thread.purgeStatus).toBe('success');
      expect(threadApi.purge).toHaveBeenCalled();
    });

    it('handles sendMessage.fulfilled', async () => {
      const store = createStore();
      vi.mocked(threadApi.sendMessage).mockResolvedValue({ id: 'backend-msg-id' } as any);

      await store.dispatch(sendMessage({ threadId: 't1', message: 'Hello AI' }));

      expect(store.getState().thread.sendStatus).toBe('success');
      expect(threadApi.sendMessage).toHaveBeenCalledWith('Hello AI', 't1', undefined);
    });

    it('handles sendMessage.rejected', async () => {
      const store = createStore();
      vi.mocked(threadApi.sendMessage).mockRejectedValue({ error: 'Network Error' });

      await store.dispatch(sendMessage({ threadId: 't1', message: 'Hello AI' }));

      expect(store.getState().thread.sendStatus).toBe('error');
      expect(store.getState().thread.sendError).toBe('Network Error');
      // Should have added an error inference response
      expect(store.getState().thread.messagesByThreadId['t1']).toBeDefined();
    });
  });
});
