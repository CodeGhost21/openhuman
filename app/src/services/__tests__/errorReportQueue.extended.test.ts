// @vitest-environment jsdom
/**
 * Extended tests for errorReportQueue.ts
 * Covers uncovered lines 207-210, 222-226:
 *   - sendToSentry when no sender is registered
 *   - sendToSentry when sentryEvent is null
 *   - buildManualSentryEvent with all optional fields
 *   - buildManualSentryEvent without optional fields
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerSentrySender as _registerSentrySender,
  buildManualSentryEvent,
  dequeueError,
  enqueueError,
  getErrors,
  type PendingErrorReport,
  sendToSentry,
} from '../errorReportQueue';

const registerSentrySender = _registerSentrySender;

// Reset queue state between tests by dequeueing all errors
function drainQueue(): void {
  const errors = getErrors();
  for (const err of errors) {
    dequeueError(err.id);
  }
}

let _counter = 0;

function makeReport(overrides?: Partial<PendingErrorReport>): PendingErrorReport {
  _counter++;
  // Use a unique title per call to avoid dedup window collisions
  return {
    id: `test-${_counter}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    source: 'manual',
    title: `Test Error ${_counter}`,
    message: `Something went wrong ${_counter}`,
    sentryEvent: {
      event_id: `abc${_counter}`,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      environment: 'test',
    },
    ...overrides,
  };
}

describe('sendToSentry', () => {
  beforeEach(() => {
    drainQueue();
    // Reset sender by registering null equivalent — use a fresh registration
  });

  it('returns false when no sender is registered (sentryEvent is null)', () => {
    const report = makeReport({ sentryEvent: null });
    enqueueError(report);

    const result = sendToSentry(report);
    expect(result).toBe(false);
  });

  it('returns false when sentryEvent is null even with a sender registered', () => {
    const sender = vi.fn();
    registerSentrySender(sender);

    const report = makeReport({ sentryEvent: null });
    enqueueError(report);

    const result = sendToSentry(report);
    expect(result).toBe(false);
    expect(sender).not.toHaveBeenCalled();

    // Cleanup: register a no-op to reset sender for other tests
    registerSentrySender(() => {});
  });

  it('returns true and calls sender when both event and sender are present', () => {
    const sender = vi.fn();
    registerSentrySender(sender);

    const report = makeReport();
    enqueueError(report);

    const result = sendToSentry(report);
    expect(result).toBe(true);
    expect(sender).toHaveBeenCalledWith(report.sentryEvent);
  });

  it('removes the report from the queue after sending', () => {
    const sender = vi.fn();
    registerSentrySender(sender);

    const report = makeReport();
    enqueueError(report);

    expect(getErrors().find(e => e.id === report.id)).toBeDefined();

    sendToSentry(report);

    expect(getErrors().find(e => e.id === report.id)).toBeUndefined();
  });
});

describe('buildManualSentryEvent', () => {
  it('returns a SanitizedSentryEvent with required fields', () => {
    const event = buildManualSentryEvent({ type: 'Error', value: 'Something broke' });

    expect(event.platform).toBe('javascript');
    expect(typeof event.event_id).toBe('string');
    expect(event.event_id.length).toBeGreaterThan(0);
    expect(typeof event.timestamp).toBe('number');
    expect(event.exception?.values).toHaveLength(1);
    expect(event.exception?.values[0].type).toBe('Error');
    expect(event.exception?.values[0].value).toBe('Something broke');
  });

  it('sets environment to development when IS_DEV is true', () => {
    // setup.ts stubs DEV=true so IS_DEV=true in tests
    const event = buildManualSentryEvent({ type: 'TypeError', value: 'null is not an object' });
    expect(event.environment).toBe('development');
  });

  it('includes tags when provided', () => {
    const tags = { component: 'SkillRuntime', version: '1.2.3' };
    const event = buildManualSentryEvent(
      { type: 'RangeError', value: 'Index out of bounds' },
      tags
    );

    expect(event.tags).toEqual(tags);
  });

  it('omits tags field when not provided', () => {
    const event = buildManualSentryEvent({ type: 'Error', value: 'No tags' });
    // tags is undefined when not passed
    expect(event.tags).toBeUndefined();
  });

  it('generates a unique event_id for each call', () => {
    const event1 = buildManualSentryEvent({ type: 'Error', value: 'A' });
    const event2 = buildManualSentryEvent({ type: 'Error', value: 'B' });

    expect(event1.event_id).not.toBe(event2.event_id);
  });

  it('event_id does not contain hyphens (UUID hyphens are stripped)', () => {
    const event = buildManualSentryEvent({ type: 'Error', value: 'test' });
    expect(event.event_id).not.toContain('-');
  });

  it('timestamp is in seconds (not milliseconds)', () => {
    const before = Date.now() / 1000;
    const event = buildManualSentryEvent({ type: 'Error', value: 'timing test' });
    const after = Date.now() / 1000;

    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after + 1);
  });

  it('handles empty error type and value', () => {
    const event = buildManualSentryEvent({ type: '', value: '' });
    expect(event.exception?.values[0].type).toBe('');
    expect(event.exception?.values[0].value).toBe('');
  });
});
