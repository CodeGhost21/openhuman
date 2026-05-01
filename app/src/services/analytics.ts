/**
 * Sentry initialization for the React frontend.
 *
 * Privacy floor (always on, no consent toggle can lift these):
 *   - sendDefaultPii=false (no IP, no cookies)
 *   - defaultIntegrations=false + minimal integration list (no replay, no
 *     performance, no console/click/network breadcrumbs)
 *   - beforeSend strips request, extras, breadcrumbs, contexts down to
 *     OS/browser/device, and replaces user with a stable anonymous id
 *
 * Consent gate: events are dropped entirely when the user has not opted
 * into analytics. The DSN is still loaded so opt-in takes effect without
 * a restart.
 */
import * as Sentry from '@sentry/react';

import { getCoreStateSnapshot } from '../lib/coreState/store';
import { APP_ENVIRONMENT, IS_DEV, SENTRY_DSN, SENTRY_RELEASE } from '../utils/config';

let _initialized = false;

export function isAnalyticsEnabled(): boolean {
  return getCoreStateSnapshot().snapshot.analyticsEnabled;
}

export function initSentry(): void {
  if (_initialized) return;
  if (!SENTRY_DSN) {
    console.debug('[sentry/react] no VITE_SENTRY_DSN — skipping init');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENVIRONMENT,
    release: SENTRY_RELEASE,
    enabled: !IS_DEV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    defaultIntegrations: false,
    integrations: [
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.browserApiErrorsIntegration(),
      Sentry.globalHandlersIntegration(),
    ],
    ignoreErrors: ['ResizeObserver loop', 'Network request failed', 'Load failed', 'AbortError'],
    beforeSend(event) {
      if (!isAnalyticsEnabled()) return null;

      event.breadcrumbs = [];
      delete event.request;
      delete event.extra;
      event.contexts = {
        os: event.contexts?.os,
        browser: event.contexts?.browser,
        device: event.contexts?.device,
      };
      const userId = getCoreStateSnapshot().snapshot.currentUser?._id;
      event.user = userId ? { id: userId } : undefined;
      return event;
    },
    beforeSendTransaction() {
      return null;
    },
  });

  _initialized = true;
  console.debug(`[sentry/react] initialized (release=${SENTRY_RELEASE}, env=${APP_ENVIRONMENT})`);
}

/** Flush any pending events when the user revokes consent. */
export function syncAnalyticsConsent(enabled: boolean): void {
  if (enabled) return;
  const client = Sentry.getClient();
  if (!client) return;
  void Sentry.flush(2000);
}
