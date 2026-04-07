import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { listen } from '@tauri-apps/api/event';
import {
  emitSkillStateChange,
  onSkillStateChange,
  setupTauriSkillEventBridge,
} from '../skillEvents';

const mockListen = vi.mocked(listen);

describe('skillEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('onSkillStateChange / emitSkillStateChange', () => {
    it('calls registered listener with skillId', () => {
      const fn = vi.fn();
      const unsub = onSkillStateChange(fn);
      emitSkillStateChange('gmail');
      expect(fn).toHaveBeenCalledWith('gmail');
      unsub();
    });

    it('calls listener with no skillId when undefined', () => {
      const fn = vi.fn();
      const unsub = onSkillStateChange(fn);
      emitSkillStateChange();
      expect(fn).toHaveBeenCalledWith(undefined);
      unsub();
    });

    it('calls multiple listeners', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const unsub1 = onSkillStateChange(fn1);
      const unsub2 = onSkillStateChange(fn2);
      emitSkillStateChange('notion');
      expect(fn1).toHaveBeenCalledWith('notion');
      expect(fn2).toHaveBeenCalledWith('notion');
      unsub1();
      unsub2();
    });

    it('unsubscribes listener', () => {
      const fn = vi.fn();
      const unsub = onSkillStateChange(fn);
      unsub();
      emitSkillStateChange('gmail');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('setupTauriSkillEventBridge', () => {
    it('registers two Tauri listeners and returns cleanup fn', async () => {
      const unlisten1 = vi.fn();
      const unlisten2 = vi.fn();
      mockListen.mockResolvedValueOnce(unlisten1).mockResolvedValueOnce(unlisten2);

      const cleanup = await setupTauriSkillEventBridge();
      expect(mockListen).toHaveBeenCalledTimes(2);
      expect(mockListen).toHaveBeenCalledWith('runtime:skill-status-changed', expect.any(Function));
      expect(mockListen).toHaveBeenCalledWith('runtime:skill-state-changed', expect.any(Function));

      cleanup();
      expect(unlisten1).toHaveBeenCalled();
      expect(unlisten2).toHaveBeenCalled();
    });

    it('skill-status-changed event triggers emitSkillStateChange', async () => {
      let statusHandler: ((e: { payload: { skill_id?: string } }) => void) | null = null;
      mockListen.mockImplementation(async (event, handler) => {
        if (event === 'runtime:skill-status-changed') {
          statusHandler = handler as typeof statusHandler;
        }
        return vi.fn();
      });

      const fn = vi.fn();
      const unsub = onSkillStateChange(fn);
      await setupTauriSkillEventBridge();
      statusHandler!({ payload: { skill_id: 'gmail' } });
      expect(fn).toHaveBeenCalledWith('gmail');
      unsub();
    });

    it('skill-state-changed event triggers emitSkillStateChange', async () => {
      let stateHandler: ((e: { payload: { skill_id?: string } }) => void) | null = null;
      mockListen.mockImplementation(async (event, handler) => {
        if (event === 'runtime:skill-state-changed') {
          stateHandler = handler as typeof stateHandler;
        }
        return vi.fn();
      });

      const fn = vi.fn();
      const unsub = onSkillStateChange(fn);
      await setupTauriSkillEventBridge();
      stateHandler!({ payload: { skill_id: 'notion' } });
      expect(fn).toHaveBeenCalledWith('notion');
      unsub();
    });

    it('returns no-op cleanup when listen throws', async () => {
      mockListen.mockRejectedValue(new Error('Not in Tauri'));
      const cleanup = await setupTauriSkillEventBridge();
      expect(typeof cleanup).toBe('function');
      // Should not throw
      cleanup();
    });
  });
});
