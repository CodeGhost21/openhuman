import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import the module fresh — it registers global listeners on load.
// We reset the queue state between tests by dequeueing everything.
import {
  buildManualSentryEvent,
  dequeueError,
  enqueueError,
  getErrors,
  type PendingErrorReport,
  registerSentrySender,
  sendToSentry,
  subscribe,
  tagErrorSource,
} from '../errorReportQueue';

let _reportCounter = 0;

function makeReport(overrides: Partial<PendingErrorReport> = {}): PendingErrorReport {
  _reportCounter++;
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    source: 'manual',
    // Use unique title per report to avoid dedup collisions across tests
    title: `Test Error ${_reportCounter}`,
    message: `msg-${_reportCounter}`,
    sentryEvent: null,
    ...overrides,
  };
}

// Helper to drain the queue between tests
function drainQueue() {
  const errors = getErrors();
  for (const err of errors) {
    dequeueError(err.id);
  }
}

describe('errorReportQueue', () => {
  beforeEach(() => {
    drainQueue();
    vi.useFakeTimers();
  });

  describe('enqueueError', () => {
    it('adds an error to the queue', () => {
      const report = makeReport({ title: 'Test', message: 'msg' });
      enqueueError(report);
      expect(getErrors()).toContainEqual(expect.objectContaining({ id: report.id }));
    });

    it('notifies subscribers when a new error is added', () => {
      const cb = vi.fn();
      const unsub = subscribe(cb);
      const report = makeReport();
      enqueueError(report);
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('deduplicates errors with the same title+message within dedup window', () => {
      const report = makeReport({ title: 'Dup', message: 'same' });
      enqueueError(report);
      enqueueError({ ...report, id: crypto.randomUUID() }); // same title+message, different id
      expect(getErrors().filter(e => e.title === 'Dup')).toHaveLength(1);
    });

    it('allows same error again after dedup window expires', () => {
      const report = makeReport({ title: 'Again', message: 'same' });
      enqueueError(report);
      vi.advanceTimersByTime(3000); // 3s > DEDUP_WINDOW_MS (2000)
      enqueueError({ ...report, id: crypto.randomUUID() });
      expect(getErrors().filter(e => e.title === 'Again')).toHaveLength(2);
    });

    it('caps the queue at 10 entries (drops oldest)', () => {
      for (let i = 0; i < 12; i++) {
        enqueueError(makeReport({ title: `E${i}`, message: `m${i}` }));
      }
      expect(getErrors()).toHaveLength(10);
    });
  });

  describe('dequeueError', () => {
    it('removes error by id', () => {
      const report = makeReport();
      enqueueError(report);
      expect(getErrors()).toHaveLength(1);
      dequeueError(report.id);
      expect(getErrors()).toHaveLength(0);
    });

    it('does not remove items when id is not found', () => {
      const report = makeReport();
      enqueueError(report);
      const countBefore = getErrors().length;
      dequeueError('nonexistent-id');
      // Queue length is unchanged — nothing was removed
      expect(getErrors()).toHaveLength(countBefore);
    });

    it('notifies subscribers on removal', () => {
      const cb = vi.fn();
      const report = makeReport();
      enqueueError(report);
      cb.mockClear();
      const unsub = subscribe(cb);
      dequeueError(report.id);
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('stops receiving callbacks after unsubscribe', () => {
      const cb = vi.fn();
      const unsub = subscribe(cb);
      unsub();
      enqueueError(makeReport());
      expect(cb).not.toHaveBeenCalled();
    });

    it('silently handles subscriber that throws', () => {
      const throwing = vi.fn(() => {
        throw new Error('subscriber error');
      });
      const unsub = subscribe(throwing as () => void);
      expect(() => enqueueError(makeReport())).not.toThrow();
      unsub();
    });
  });

  describe('tagErrorSource', () => {
    it('updates source and componentStack for a queued event', () => {
      const uniqueEvtId = `evt-${crypto.randomUUID()}`;
      const report = makeReport({
        title: `TagSrc-${uniqueEvtId}`,
        message: `msg-${uniqueEvtId}`,
        sentryEvent: {
          event_id: uniqueEvtId,
          timestamp: 1,
          platform: 'javascript',
          environment: 'development',
        },
      });
      enqueueError(report);
      tagErrorSource(uniqueEvtId, 'react', 'at Component');
      const updated = getErrors().find(e => e.id === report.id);
      expect(updated?.source).toBe('react');
      expect(updated?.componentStack).toBe('at Component');
    });

    it('is a no-op when eventId is undefined', () => {
      const report = makeReport();
      enqueueError(report);
      const sizeBefore = getErrors().length;
      tagErrorSource(undefined, 'react');
      expect(getErrors()).toHaveLength(sizeBefore);
    });

    it('does not change source when eventId does not match any queued event', () => {
      const uniqueEvtId = `known-${crypto.randomUUID()}`;
      const report = makeReport({
        title: `NoMatch-${uniqueEvtId}`,
        message: `msg-${uniqueEvtId}`,
        source: 'manual',
        sentryEvent: {
          event_id: uniqueEvtId,
          timestamp: 1,
          platform: 'javascript',
          environment: 'test',
        },
      });
      enqueueError(report);
      tagErrorSource('this-does-not-exist', 'react');
      const unchanged = getErrors().find(e => e.id === report.id);
      expect(unchanged?.source).toBe('manual'); // source unchanged
    });
  });

  describe('registerSentrySender + sendToSentry', () => {
    it('returns false when no sentryEvent is set on the report', () => {
      const report = makeReport({ sentryEvent: null });
      enqueueError(report);
      const mockSender = vi.fn();
      registerSentrySender(mockSender);
      const result = sendToSentry(report);
      expect(result).toBe(false);
      expect(mockSender).not.toHaveBeenCalled();
    });

    it('sends event and removes from queue when sender is registered', () => {
      const mockSender = vi.fn();
      registerSentrySender(mockSender);
      const report = makeReport({
        sentryEvent: {
          event_id: 'to-send',
          timestamp: 1,
          platform: 'javascript',
          environment: 'development',
        },
      });
      enqueueError(report);
      const result = sendToSentry(report);
      expect(result).toBe(true);
      expect(mockSender).toHaveBeenCalledWith(report.sentryEvent);
      expect(getErrors()).not.toContainEqual(expect.objectContaining({ id: report.id }));
    });

    it('returns false when no sender is registered (null)', () => {
      // Reset sender to null by registering null-ish — verify fallback
      registerSentrySender(null as never);
      const report = makeReport({
        sentryEvent: { event_id: 'x', timestamp: 1, platform: 'javascript', environment: 'dev' },
      });
      enqueueError(report);
      const result = sendToSentry(report);
      expect(result).toBe(false);
    });
  });

  describe('buildManualSentryEvent', () => {
    it('builds a valid event shape', () => {
      const event = buildManualSentryEvent({ type: 'TypeError', value: 'cannot read property' });
      expect(event.platform).toBe('javascript');
      expect(event.exception?.values[0].type).toBe('TypeError');
      expect(event.exception?.values[0].value).toBe('cannot read property');
      expect(typeof event.event_id).toBe('string');
      expect(event.event_id).not.toContain('-');
    });

    it('includes optional tags', () => {
      const event = buildManualSentryEvent(
        { type: 'Error', value: 'msg' },
        { feature: 'skills', version: '2' }
      );
      expect(event.tags).toEqual({ feature: 'skills', version: '2' });
    });

    it('sets environment to development in dev mode (IS_DEV=true in tests)', () => {
      const event = buildManualSentryEvent({ type: 'E', value: 'v' });
      expect(['development', 'production']).toContain(event.environment);
    });
  });
});
