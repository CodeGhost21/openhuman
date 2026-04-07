import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { intelligenceApi } from '../../services/intelligenceApi';
import intelligenceReducer, {
  addItem,
  addMessage,
  closeChatSession,
  fetchActionableItems,
  removeItem,
  setChatSession,
  setConnectionStatus,
  setExecution,
  setInitialized,
  setPriorityFilter,
  setSearchFilter,
  setSourceFilter,
  setTyping,
  updateExecutionProgress,
} from '../intelligenceSlice';

vi.mock('../../services/intelligenceApi', () => ({
  intelligenceApi: {
    getActionableItems: vi.fn(),
    updateItemStatus: vi.fn(),
    snoozeItem: vi.fn(),
    getOrCreateThread: vi.fn(),
    executeTask: vi.fn(),
  },
}));

vi.mock('../../utils/intelligenceTransforms', () => ({
  transformBackendItemsToFrontend: vi.fn(items => items),
  transformBackendMessagesToFrontend: vi.fn(msgs => msgs),
}));

function createStore() {
  return configureStore({ reducer: { intelligence: intelligenceReducer } });
}

describe('intelligenceSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets initialized state', () => {
    const store = createStore();
    store.dispatch(setInitialized(true));
    expect(store.getState().intelligence.initialized).toBe(true);
  });

  it('sets connection status', () => {
    const store = createStore();
    store.dispatch(setConnectionStatus('connected'));
    expect(store.getState().intelligence.connectionStatus).toBe('connected');
  });

  it('adds and removes items', () => {
    const store = createStore();
    const mockItem = { id: 'item-1', title: 'Test Item' } as any;

    store.dispatch(addItem(mockItem));
    expect(store.getState().intelligence.items).toHaveLength(1);
    expect(store.getState().intelligence.items[0].id).toBe('item-1');

    store.dispatch(removeItem('item-1'));
    expect(store.getState().intelligence.items).toHaveLength(0);
  });

  it('sets filters', () => {
    const store = createStore();

    store.dispatch(setSourceFilter('telegram'));
    expect(store.getState().intelligence.filters.source).toBe('telegram');

    store.dispatch(setPriorityFilter('critical'));
    expect(store.getState().intelligence.filters.priority).toBe('critical');

    store.dispatch(setSearchFilter('query'));
    expect(store.getState().intelligence.filters.search).toBe('query');
  });

  it('manages chat sessions', () => {
    const store = createStore();

    store.dispatch(
      setChatSession({ threadId: 't1', itemId: 'i1', messages: [{ id: 'm1', text: 'hi' } as any] })
    );
    expect(store.getState().intelligence.activeSessions['t1']).toBeDefined();
    expect(store.getState().intelligence.currentChatSession).toBe('t1');

    store.dispatch(addMessage({ threadId: 't1', message: { id: 'm2', text: 'hello' } as any }));
    expect(store.getState().intelligence.activeSessions['t1'].messages).toHaveLength(2);

    store.dispatch(setTyping({ threadId: 't1', isTyping: true }));
    expect(store.getState().intelligence.activeSessions['t1'].isTyping).toBe(true);

    store.dispatch(closeChatSession('t1'));
    expect(store.getState().intelligence.activeSessions['t1']).toBeUndefined();
    expect(store.getState().intelligence.currentChatSession).toBeNull();
  });

  it('manages execution progress', () => {
    const store = createStore();
    const executionId = 'exec-1';

    store.dispatch(
      setExecution({
        executionId,
        execution: { executionId, sessionId: 's1', itemId: 'i1', status: 'starting', progress: [] },
      })
    );

    const progress = [{ id: 'p1', label: 'Step 1', status: 'completed' as const }];
    store.dispatch(updateExecutionProgress({ executionId, progress }));

    const state = store.getState().intelligence.activeExecutions[executionId];
    expect(state.progress).toEqual(progress);
    expect(state.status).toBe('running');
  });

  describe('extraReducers (async thunks)', () => {
    it('handles fetchActionableItems.fulfilled', async () => {
      const store = createStore();
      const mockItems = [{ id: 'item-1' }];
      vi.mocked(intelligenceApi.getActionableItems).mockResolvedValue(mockItems);

      await store.dispatch(fetchActionableItems());

      expect(store.getState().intelligence.items).toEqual(mockItems);
      expect(store.getState().intelligence.loading).toBe(false);
    });

    it('handles fetchActionableItems.rejected', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.getActionableItems).mockRejectedValue({ error: 'Fetch failed' });

      await store.dispatch(fetchActionableItems());

      expect(store.getState().intelligence.error).toBe('Fetch failed');
      expect(store.getState().intelligence.loading).toBe(false);
    });
  });
});
