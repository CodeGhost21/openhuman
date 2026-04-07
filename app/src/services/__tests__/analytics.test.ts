import * as Sentry from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCoreStateSnapshot } from '../../lib/coreState/store';
import { initSentry, isAnalyticsEnabled, syncAnalyticsConsent } from '../analytics';
import { enqueueError } from '../errorReportQueue';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  getClient: vi.fn(),
  captureEvent: vi.fn(),
  flush: vi.fn(),
  functionToStringIntegration: vi.fn(),
  linkedErrorsIntegration: vi.fn(),
  dedupeIntegration: vi.fn(),
  browserApiErrorsIntegration: vi.fn(),
  globalHandlersIntegration: vi.fn(),
}));

vi.mock('../../lib/coreState/store', () => ({ getCoreStateSnapshot: vi.fn() }));

vi.mock('../errorReportQueue', () => ({ enqueueError: vi.fn(), registerSentrySender: vi.fn() }));

vi.mock('../../utils/config', () => ({ IS_DEV: false, SENTRY_DSN: 'https://mock@sentry.io/1' }));

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isAnalyticsEnabled returns state from store', () => {
    vi.mocked(getCoreStateSnapshot).mockReturnValue({
      snapshot: { analyticsEnabled: true },
    } as any);
    expect(isAnalyticsEnabled()).toBe(true);

    vi.mocked(getCoreStateSnapshot).mockReturnValue({
      snapshot: { analyticsEnabled: false },
    } as any);
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it('initSentry initializes Sentry with privacy-first config', () => {
    initSentry();
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://mock@sentry.io/1',
        sendDefaultPii: false,
        defaultIntegrations: false,
      })
    );
  });

  it('beforeSend sanitizes and enqueues events', () => {
    initSentry();
    const initCall = vi.mocked(Sentry.init).mock.calls[0][0];
    const beforeSend = initCall.beforeSend!;

    const mockEvent: any = {
      event_id: '123',
      breadcrumbs: [{ message: 'test' }],
      request: { cookies: 'secret' },
      extra: { state: 'large' },
      exception: { values: [{ type: 'TypeError', value: 'boom', stacktrace: { frames: [] } }] },
    };

    const result = beforeSend(mockEvent, {});

    // Should return null to block auto-send
    expect(result).toBeNull();

    // Should have queued a sanitized version
    expect(enqueueError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'TypeError',
        message: 'boom',
        sentryEvent: expect.objectContaining({ event_id: '123' }),
      })
    );

    const sanitized = vi.mocked(enqueueError).mock.calls[0][0].sentryEvent;
    expect(sanitized.breadcrumbs).toBeUndefined(); // Stripped in sanitized object
    expect(mockEvent.breadcrumbs).toEqual([]); // Stripped in-place
  });

  it('syncAnalyticsConsent flushes when disabled', () => {
    vi.mocked(Sentry.getClient).mockReturnValue({} as any);
    syncAnalyticsConsent(false);
    expect(Sentry.flush).toHaveBeenCalled();
  });
});
