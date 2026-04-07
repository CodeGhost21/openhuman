import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { intelligenceApi } from '../../services/intelligenceApi';
import intelligenceReducer, {
  addItem,
  addMessage,
  clearError,
  clearExecution,
  closeChatSession,
  createChatSession,
  executeTask,
  fetchActionableItems,
  removeItem,
  setChatSession,
  setConnectionStatus,
  setCurrentChatSession,
  setExecution,
  setExecutionResult,
  setInitialized,
  setItems,
  setPriorityFilter,
  setSearchFilter,
  setSourceFilter,
  setTyping,
  snoozeItem,
  updateExecutionProgress,
  updateItemStatus,
} from '../intelligenceSlice';

vi.mock('../../services/intelligenceApi', () => ({
  intelligenceApi: {
    getActionableItems: vi.fn(),
    updateItemStatus: vi.fn(),
    snoozeItem: vi.fn(),
    getOrCreateThread: vi.fn(),
    executeTask: vi.fn(),
    getChatHistory: vi.fn(),
    cancelExecution: vi.fn(),
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

  it('sets items and clears error', () => {
    const store = createStore();
    const items = [{ id: 'i1', title: 'T1' }] as any[];
    store.dispatch(setItems(items));
    expect(store.getState().intelligence.items).toEqual(items);

    store.dispatch(setCurrentChatSession('t1'));
    expect(store.getState().intelligence.currentChatSession).toBe('t1');

    store.dispatch(clearError());
    expect(store.getState().intelligence.error).toBeNull();
  });

  it('handles setExecutionResult and clearExecution', () => {
    const store = createStore();
    const executionId = 'exec-1';
    store.dispatch(
      setExecution({
        executionId,
        execution: { executionId, sessionId: 's1', itemId: 'i1', status: 'running', progress: [] },
      })
    );

    store.dispatch(
      setExecutionResult({ executionId, result: { data: 'ok' }, status: 'completed' })
    );
    expect(store.getState().intelligence.activeExecutions[executionId].status).toBe('completed');
    expect(store.getState().intelligence.activeExecutions[executionId].result).toEqual({
      data: 'ok',
    });

    store.dispatch(clearExecution(executionId));
    expect(store.getState().intelligence.activeExecutions[executionId]).toBeUndefined();
  });

  it('setExecutionResult with error', () => {
    const store = createStore();
    const executionId = 'exec-2';
    store.dispatch(
      setExecution({
        executionId,
        execution: { executionId, sessionId: 's2', itemId: 'i2', status: 'running', progress: [] },
      })
    );
    store.dispatch(
      setExecutionResult({ executionId, result: null, status: 'failed', error: 'Timeout' })
    );
    expect(store.getState().intelligence.activeExecutions[executionId].status).toBe('failed');
    expect(store.getState().intelligence.activeExecutions[executionId].error).toBe('Timeout');
  });

  it('addMessage is no-op for unknown threadId', () => {
    const store = createStore();
    store.dispatch(addMessage({ threadId: 'unknown', message: { id: 'm1' } as any }));
    expect(store.getState().intelligence.activeSessions).toEqual({});
  });

  it('setTyping is no-op for unknown threadId', () => {
    const store = createStore();
    store.dispatch(setTyping({ threadId: 'unknown', isTyping: true }));
    expect(store.getState().intelligence.activeSessions).toEqual({});
  });

  it('updateExecutionProgress is no-op for unknown executionId', () => {
    const store = createStore();
    store.dispatch(updateExecutionProgress({ executionId: 'unknown', progress: [] }));
    expect(store.getState().intelligence.activeExecutions).toEqual({});
  });

  it('closeChatSession does not nullify currentChatSession if different session', () => {
    const store = createStore();
    store.dispatch(setChatSession({ threadId: 't1', itemId: 'i1' }));
    store.dispatch(setChatSession({ threadId: 't2', itemId: 'i2' }));
    store.dispatch(closeChatSession('t1'));
    expect(store.getState().intelligence.currentChatSession).toBe('t2');
  });

  describe('extraReducers (async thunks)', () => {
    it('handles fetchActionableItems.pending', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.getActionableItems).mockReturnValue(new Promise(() => {}));
      store.dispatch(fetchActionableItems());
      expect(store.getState().intelligence.loading).toBe(true);
      expect(store.getState().intelligence.error).toBeNull();
    });

    it('handles fetchActionableItems.fulfilled', async () => {
      const store = createStore();
      const mockItems = [{ id: 'item-1' }];
      vi.mocked(intelligenceApi.getActionableItems).mockResolvedValue(mockItems as any);

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

    it('handles fetchActionableItems.rejected with generic error', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.getActionableItems).mockRejectedValue(new Error('Network'));

      await store.dispatch(fetchActionableItems());

      expect(store.getState().intelligence.error).toBe('Failed to fetch actionable items');
    });

    it('handles updateItemStatus.fulfilled - completed sets completedAt', async () => {
      const store = createStore();
      const item = { id: 'item-1', title: 'T', status: 'pending' } as any;
      store.dispatch(setItems([item]));
      vi.mocked(intelligenceApi.updateItemStatus).mockResolvedValue(undefined);

      await store.dispatch(updateItemStatus({ itemId: 'item-1', status: 'completed' }));

      const updated = store.getState().intelligence.items[0];
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });

    it('handles updateItemStatus.fulfilled - dismissed sets dismissedAt', async () => {
      const store = createStore();
      const item = { id: 'item-1', title: 'T', status: 'pending' } as any;
      store.dispatch(setItems([item]));
      vi.mocked(intelligenceApi.updateItemStatus).mockResolvedValue(undefined);

      await store.dispatch(updateItemStatus({ itemId: 'item-1', status: 'dismissed' }));

      expect(store.getState().intelligence.items[0].dismissedAt).toBeDefined();
    });

    it('handles updateItemStatus.rejected', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.updateItemStatus).mockRejectedValue({ error: 'Update failed' });

      await store.dispatch(updateItemStatus({ itemId: 'item-1', status: 'completed' }));
      expect(store.getState().intelligence.error).toBe('Update failed');
    });

    it('handles snoozeItem.fulfilled', async () => {
      const store = createStore();
      const item = { id: 'item-1', title: 'T', status: 'pending', reminderCount: 0 } as any;
      store.dispatch(setItems([item]));
      vi.mocked(intelligenceApi.snoozeItem).mockResolvedValue(undefined);
      const snoozeUntil = new Date('2026-02-01');

      await store.dispatch(snoozeItem({ itemId: 'item-1', snoozeUntil }));

      const updated = store.getState().intelligence.items[0];
      expect(updated.status).toBe('snoozed');
      expect(updated.reminderCount).toBe(1);
    });

    it('handles snoozeItem.rejected', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.snoozeItem).mockRejectedValue({ error: 'Snooze failed' });

      await store.dispatch(snoozeItem({ itemId: 'item-1', snoozeUntil: new Date() }));
      expect(store.getState().intelligence.error).toBe('Snooze failed');
    });

    it('handles createChatSession.fulfilled', async () => {
      const store = createStore();
      const item = { id: 'item-1', title: 'T' } as any;
      store.dispatch(setItems([item]));
      vi.mocked(intelligenceApi.getOrCreateThread).mockResolvedValue({
        threadId: 'thread-1',
        messages: [],
      });

      await store.dispatch(createChatSession({ itemId: 'item-1' }));

      expect(store.getState().intelligence.activeSessions['thread-1']).toBeDefined();
      expect(store.getState().intelligence.currentChatSession).toBe('thread-1');
      expect(store.getState().intelligence.items[0].threadId).toBe('thread-1');
    });

    it('handles createChatSession.rejected', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.getOrCreateThread).mockRejectedValue({ error: 'Thread failed' });

      await store.dispatch(createChatSession({ itemId: 'item-1' }));
      expect(store.getState().intelligence.error).toBe('Thread failed');
    });

    it('handles executeTask.fulfilled', async () => {
      const store = createStore();
      const item = { id: 'item-1', title: 'T' } as any;
      store.dispatch(setItems([item]));
      vi.mocked(intelligenceApi.executeTask).mockResolvedValue({
        executionId: 'exec-1',
        sessionId: 'sess-1',
        status: 'started',
      } as any);

      await store.dispatch(executeTask({ itemId: 'item-1', connectedTools: [] }));

      expect(store.getState().intelligence.activeExecutions['exec-1']).toBeDefined();
      expect(store.getState().intelligence.items[0].executionStatus).toBe('running');
    });

    it('handles executeTask.rejected', async () => {
      const store = createStore();
      vi.mocked(intelligenceApi.executeTask).mockRejectedValue({ error: 'Exec failed' });

      await store.dispatch(executeTask({ itemId: 'item-1', connectedTools: [] }));
      expect(store.getState().intelligence.error).toBe('Exec failed');
    });
  });
});
