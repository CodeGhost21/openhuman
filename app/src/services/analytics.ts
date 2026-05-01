// Analytics consent state (Sentry wiring removed pending rebuild).

import { getCoreStateSnapshot } from '../lib/coreState/store';

/** Check if the current user has opted into analytics. */
export function isAnalyticsEnabled(): boolean {
  return getCoreStateSnapshot().snapshot.analyticsEnabled;
}

/** Re-sync analytics state after the user changes their consent. No-op until Sentry is rebuilt. */
export function syncAnalyticsConsent(_enabled: boolean): void {
  // no-op — wired up in a follow-up PR
}
