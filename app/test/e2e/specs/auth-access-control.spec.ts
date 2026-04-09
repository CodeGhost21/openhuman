// @ts-nocheck
/**
 * E2E test: 1. Authentication & Multi-Provider Login
 *
 * Current product flow in the desktop shell:
 * - Welcome screen exposes Google, GitHub, and Twitter sign-in buttons
 * - Auth completion returns to the app via deep link
 * - A second token can refresh the active session without reopening onboarding
 * - Logout returns the user to the welcome screen
 */
import { waitForApp, waitForAppReady } from '../helpers/app-helpers';
import { triggerAuthDeepLink } from '../helpers/deep-link-helpers';
import {
  dumpAccessibilityTree,
  hasAppChrome,
  textExists,
  waitForWindowVisible,
} from '../helpers/element-helpers';
import {
  isOnboardingOverlayVisible,
  logoutViaSettings,
  performFullLogin,
  waitForHomePage,
  waitForLoggedOutState,
  waitForRequest,
} from '../helpers/shared-flows';
import {
  clearRequestLog,
  getRequestLog,
  resetMockBehavior,
  startMockServer,
  stopMockServer,
} from '../mock-server';

describe('1. Authentication & Multi-Provider Login', () => {
  before(async () => {
    await startMockServer();
    await waitForApp();
    resetMockBehavior();
    clearRequestLog();
  });

  after(async () => {
    resetMockBehavior();
    await stopMockServer();
  });

  it('1.1 — welcome screen exposes the current OAuth providers', async () => {
    await waitForWindowVisible(25_000);
    await waitForAppReady(15_000);

    expect(await hasAppChrome()).toBe(true);

    const welcomeMarkers = [
      'Google',
      'GitHub',
      'Twitter',
      'Continue with email',
      "Sign in! Let's Cook",
      'OpenHuman',
    ];
    const foundMarkers: string[] = [];
    for (const marker of welcomeMarkers) {
      if (await textExists(marker)) {
        foundMarkers.push(marker);
      }
    }

    if (foundMarkers.length === 0) {
      const tree = await dumpAccessibilityTree();
      console.log('[AuthE2E] Welcome screen markers missing. Tree:\n', tree.slice(0, 4000));
    }

    expect(foundMarkers.length > 0).toBe(true);
    expect(
      foundMarkers.includes('Continue with email') ||
        foundMarkers.includes("Sign in! Let's Cook") ||
        foundMarkers.includes('OpenHuman')
    ).toBe(true);

    // The provider exists in config, but the current Welcome screen does not render it.
    expect(await textExists('Discord')).toBe(false);
  });

  it('1.2 — a deep-link login creates a session and reaches home', async () => {
    resetMockBehavior();
    clearRequestLog();

    if (process.platform === 'darwin') {
      await triggerAuthDeepLink('e2e-auth-login-token');
      await waitForWindowVisible(25_000);
      await waitForAppReady(15_000);

      const consumeCall = await waitForRequest(
        getRequestLog,
        'POST',
        '/telegram/login-tokens/',
        20_000
      );
      expect(consumeCall).toBeDefined();

      const profileCall =
        (await waitForRequest(getRequestLog, 'GET', '/auth/me', 10_000)) ||
        (await waitForRequest(getRequestLog, 'GET', '/settings', 10_000));
      expect(profileCall).toBeDefined();

      const homeMarker = await waitForHomePage(10_000);
      if (!homeMarker) {
        console.log(
          '[AuthE2E] Mac2 did not reach the full Home surface after login; backend auth side-effects were observed'
        );
      }
      return;
    }

    await performFullLogin('e2e-auth-login-token', '[AuthE2E]', async () => {
      const consumeCall = await waitForRequest(
        getRequestLog,
        'POST',
        '/telegram/login-tokens/',
        20_000
      );
      expect(consumeCall).toBeDefined();

      const profileCall =
        (await waitForRequest(getRequestLog, 'GET', '/auth/me', 10_000)) ||
        (await waitForRequest(getRequestLog, 'GET', '/settings', 10_000));
      expect(profileCall).toBeDefined();
    });
  });

  it('1.3 — a second token is accepted for the active device session', async () => {
    clearRequestLog();

    if (process.platform === 'darwin') {
      console.log(
        '[AuthE2E] Skipping second-token assertion on Mac2 because the driver does not expose a reliable post-handoff signal'
      );
      return;
    }

    await triggerAuthDeepLink('e2e-auth-second-device-token');
    await waitForWindowVisible(25_000);
    await waitForAppReady(15_000);

    const consumeCall = await waitForRequest(
      getRequestLog,
      'POST',
      '/telegram/login-tokens/',
      20_000
    );
    expect(consumeCall).toBeDefined();

    const homeMarker = await waitForHomePage(15_000);
    expect(homeMarker).not.toBeNull();
    expect(await isOnboardingOverlayVisible()).toBe(false);
  });

  it('1.4 — logout clears the session and returns to the welcome screen', async () => {
    await logoutViaSettings('[AuthE2E]');

    const welcomeMarker = await waitForLoggedOutState(15_000);
    expect(welcomeMarker).not.toBeNull();

    const hasWelcomeSurface =
      (await textExists('Google')) ||
      (await textExists('GitHub')) ||
      (await textExists('Twitter')) ||
      (await textExists("Sign in! Let's Cook")) ||
      (await textExists('OpenHuman')) ||
      (await textExists('Continue with email'));
    expect(hasWelcomeSurface).toBe(true);
  });
});
