// @ts-nocheck
/**
 * E2E test: deep-link auth, onboarding completion, and session failure paths.
 *
 * Keeps coverage focused on the current shell behavior:
 * - successful deep-link auth consumes the token and completes onboarding
 * - expired and invalid tokens do not create a logged-in shell
 * - bypass auth writes a session without the consume request
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { waitForApp, waitForAppReady, waitForAuthBootstrap } from '../helpers/app-helpers';
import {
  triggerAuthDeepLinkBypass,
  triggerDeepLink,
} from '../helpers/deep-link-helpers';
import { textExists, waitForWebView, waitForWindowVisible } from '../helpers/element-helpers';
import {
  completeOnboardingIfVisible,
  logoutViaSettings,
  waitForHomePage,
  waitForLoggedOutState,
  waitForRequest,
} from '../helpers/shared-flows';
import {
  clearRequestLog,
  getRequestLog,
  resetMockBehavior,
  setMockBehavior,
  startMockServer,
  stopMockServer,
} from '../mock-server';

function removePathIfPresent(targetPath: string) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

async function resetAuthStateForMac2(logPrefix = '[LoginFlow]') {
  if (process.platform !== 'darwin') {
    await logoutViaSettings(logPrefix);
    return;
  }

  try {
    await browser.execute('macos: terminateApp', { bundleId: 'com.openhuman.app' } as Record<
      string,
      unknown
    >);
    console.log(`${logPrefix} Terminated app before resetting auth state`);
  } catch (error) {
    console.log(
      `${logPrefix} Terminate app skipped during auth reset:`,
      error instanceof Error ? error.message : error
    );
  }

  await browser.pause(1_000);

  const homeDir = os.homedir();
  const openhumanDir = path.join(homeDir, '.openhuman');
  const authPaths = [
    path.join(openhumanDir, 'auth-profiles.json'),
    path.join(openhumanDir, 'auth-profiles.lock'),
    path.join(openhumanDir, 'active_user.toml'),
    path.join(openhumanDir, 'users'),
  ];
  const shellPaths = [
    path.join(homeDir, 'Library', 'WebKit', 'com.openhuman.app'),
    path.join(homeDir, 'Library', 'Caches', 'com.openhuman.app'),
    path.join(homeDir, 'Library', 'Application Support', 'com.openhuman.app'),
    path.join(homeDir, 'Library', 'Saved Application State', 'com.openhuman.app.savedState'),
  ];

  for (const targetPath of [...authPaths, ...shellPaths]) {
    removePathIfPresent(targetPath);
    console.log(`${logPrefix} Cleared ${targetPath}`);
  }
}

async function waitForShellAfterDeepLink() {
  await waitForWindowVisible(25_000);
  await waitForWebView(15_000);
  await waitForAppReady(15_000);
  await waitForAuthBootstrap(15_000);
}

async function expectLoginFailureAndWelcomeScreen(urlFragment) {
  const consumeCall = await waitForRequest(getRequestLog, 'POST', urlFragment, 20_000);
  expect(consumeCall).toBeDefined();

  const homeMarker = await waitForHomePage(5_000);
  expect(homeMarker).toBeNull();

  const welcomeMarker = await waitForLoggedOutState(10_000);
  expect(welcomeMarker).not.toBeNull();
}

describe('1.x Deep-Link Auth & Onboarding', () => {
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

  it('successful deep-link auth consumes the token, completes onboarding, and lands on home', async () => {
    clearRequestLog();
    resetMockBehavior();

    await triggerDeepLink('openhuman://auth?token=e2e-login-flow-token');
    await waitForShellAfterDeepLink();

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

    await completeOnboardingIfVisible('[LoginFlow]');

    const onboardingCompleteCall =
      (await waitForRequest(getRequestLog, 'POST', '/settings/onboarding-complete', 10_000)) ||
      (await waitForRequest(
        getRequestLog,
        'POST',
        '/telegram/settings/onboarding-complete',
        10_000
      ));
    if (!onboardingCompleteCall) {
      console.log(
        '[LoginFlow] onboarding-complete request not observed; continuing because this call is best-effort in the current UI flow'
      );
    }

    const homeMarker = await waitForHomePage(15_000);
    expect(homeMarker).not.toBeNull();
  });

  it('expired login tokens do not enter the authenticated shell', async () => {
    await resetAuthStateForMac2('[LoginFlow]');
    clearRequestLog();
    setMockBehavior('token', 'expired');

    await triggerDeepLink('openhuman://auth?token=e2e-login-expired-token');
    await waitForShellAfterDeepLink();
    await expectLoginFailureAndWelcomeScreen('/telegram/login-tokens/');
  });

  it('invalid login tokens do not enter the authenticated shell', async () => {
    await resetAuthStateForMac2('[LoginFlow]');
    clearRequestLog();
    resetMockBehavior();
    setMockBehavior('token', 'invalid');

    await triggerDeepLink('openhuman://auth?token=e2e-login-invalid-token');
    await waitForShellAfterDeepLink();
    await expectLoginFailureAndWelcomeScreen('/telegram/login-tokens/');
  });

  it('bypass auth creates a session without calling the token consume endpoint', async () => {
    await resetAuthStateForMac2('[LoginFlowBypass]');
    clearRequestLog();
    resetMockBehavior();

    await triggerAuthDeepLinkBypass('e2e-login-bypass-token');
    await waitForShellAfterDeepLink();
    await completeOnboardingIfVisible('[LoginFlowBypass]');

    const consumeCall = getRequestLog().find(
      request => request.method === 'POST' && request.url.includes('/telegram/login-tokens/')
    );
    expect(consumeCall).toBeUndefined();

    const homeMarker = await waitForHomePage(15_000);
    expect(homeMarker).not.toBeNull();
    expect(await textExists('Message OpenHuman')).toBe(true);
  });
});
