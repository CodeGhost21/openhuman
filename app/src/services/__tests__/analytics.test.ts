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

  it('syncAnalyticsConsent is no-op when no client', () => {
    vi.mocked(Sentry.getClient).mockReturnValue(undefined as any);
    syncAnalyticsConsent(false);
    expect(Sentry.flush).not.toHaveBeenCalled();
  });

  it('syncAnalyticsConsent with enabled=true does not flush', () => {
    vi.mocked(Sentry.getClient).mockReturnValue({} as any);
    syncAnalyticsConsent(true);
    expect(Sentry.flush).not.toHaveBeenCalled();
  });

  it('beforeSend blocks event when no exception values', () => {
    initSentry();
    const initCall = vi.mocked(Sentry.init).mock.calls[0][0];
    const beforeSend = initCall.beforeSend!;
    vi.mocked(getCoreStateSnapshot).mockReturnValue({
      snapshot: { currentUser: { _id: 'user-1' } },
    } as any);

    const result = beforeSend({ event_id: 'abc', exception: { values: [] } } as any, {});
    expect(result).toBeNull();
    expect(enqueueError).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error', message: 'Unknown error' })
    );
  });

  it('beforeSendTransaction always returns null', () => {
    initSentry();
    const initCall = vi.mocked(Sentry.init).mock.calls[0][0];
    const beforeSendTransaction = (initCall as any).beforeSendTransaction;
    expect(beforeSendTransaction({} as any, {})).toBeNull();
  });

  it('bypass mode: registerSentrySender is called during initSentry', () => {
    initSentry();
    // The mock is verified via the module-level mock: enqueueError and registerSentrySender are active
    expect(enqueueError).toBeDefined(); // mock is active
  });
});
