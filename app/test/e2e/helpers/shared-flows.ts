// @ts-nocheck
/**
 * Shared E2E flow helpers for Linux (tauri-driver).
 *
 * Extracted from individual spec files to avoid duplication.
 * All navigation uses browser.execute() with window.location.hash
 * because sidebar nav buttons are icon-only (aria-label, no text content).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { waitForAppReady, waitForAuthBootstrap } from './app-helpers';
import { triggerAppRouteDeepLink, triggerAuthDeepLink } from './deep-link-helpers';
import {
  clickNativeButton,
  clickText,
  dumpAccessibilityTree,
  textExists,
  waitForWebView,
  waitForWindowVisible,
} from './element-helpers';
import { supportsExecuteScript } from './platform';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export async function waitForRequest(log, method, urlFragment, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = log().find(r => r.method === method && r.url.includes(urlFragment));
    if (match) return match;
    await browser.pause(500);
  }
  return undefined;
}

export async function waitForHomePage(timeout = 15_000) {
  const candidates = [
    'Welcome Onboard',
    'Good morning',
    'Good afternoon',
    'Good evening',
    'Message OpenHuman',
    'Connected to OpenHuman AI',
  ];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const text of candidates) {
      if (await textExists(text)) return text;
    }
    await browser.pause(1_000);
  }
  return null;
}

export async function waitForTextToDisappear(text, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await textExists(text))) return true;
    await browser.pause(500);
  }
  return false;
}

/**
 * Click the first matching text from a list of candidates.
 */
export async function clickFirstMatch(candidates, timeout = 5_000) {
  for (const text of candidates) {
    if (await textExists(text)) {
      await clickText(text, timeout);
      return text;
    }
  }
  return null;
}

async function clickFirstButtonOrText(candidates, timeout = 10_000) {
  for (const text of candidates) {
    try {
      await clickNativeButton(text, timeout);
      return text;
    } catch {
      // Fall through to generic text click; some WebView nodes are not exposed as buttons.
    }

    if (await textExists(text)) {
      await clickText(text, timeout);
      return text;
    }
  }

  return null;
}

async function swipeUpMac2(logPrefix = '[E2E]') {
  if (supportsExecuteScript()) {
    return;
  }

  const { width, height } = await browser.getWindowSize();
  const x = Math.round(width * 0.5);
  const startY = Math.round(height * 0.82);
  const endY = Math.round(height * 0.28);

  await browser.performActions([
    {
      type: 'pointer',
      id: 'mouse1',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', duration: 10, x, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 120 },
        { type: 'pointerMove', duration: 450, x, y: endY },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
  await browser.pause(900);
  console.log(`${logPrefix} Swiped up to reveal additional Settings actions`);
}

function removePathIfPresent(targetPath: string) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function resolveBuiltAppPath(): string | null {
  const cwd = process.cwd();
  const repoRoot = path.basename(cwd) === 'app' ? path.resolve(cwd, '..') : cwd;
  const appDir = path.basename(cwd) === 'app' ? cwd : path.join(repoRoot, 'app');
  const candidates = [
    path.join(appDir, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'OpenHuman.app'),
    path.join(repoRoot, 'target', 'debug', 'bundle', 'macos', 'OpenHuman.app'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function forceLogoutMac2(logPrefix = '[E2E]') {
  console.log(`${logPrefix} Mac2 logout fallback: clearing auth state and relaunching app`);

  try {
    await browser.execute('macos: terminateApp', { bundleId: 'com.openhuman.app' } as Record<
      string,
      unknown
    >);
    console.log(`${logPrefix} Terminated app before auth reset`);
  } catch (error) {
    console.log(
      `${logPrefix} Terminate app skipped during logout fallback:`,
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

  try {
    await browser.execute('macos: launchApp', { bundleId: 'com.openhuman.app' } as Record<
      string,
      unknown
    >);
    await browser.pause(1_500);
    await waitForWindowVisible(10_000);
  } catch (error) {
    const appPath = resolveBuiltAppPath();
    if (!appPath) {
      throw error;
    }

    console.log(`${logPrefix} macos: launchApp fallback via shell open`, { appPath });
    execFileSync('open', ['-a', appPath]);
    await browser.pause(1_500);
    await waitForWindowVisible(25_000);
  }

  await waitForAppReady(15_000);
}

// ---------------------------------------------------------------------------
// Navigation helpers (JS hash-based — icon-only sidebar buttons)
// ---------------------------------------------------------------------------

/** Appium Mac2 cannot run W3C Execute Script in WKWebView — use sidebar labels instead. */
const HASH_TO_SIDEBAR_LABEL = {
  '/skills': 'Skills',
  '/home': 'Home',
  '/conversations': 'Conversations',
  '/settings': 'Settings',
  '/intelligence': 'Intelligence',
};

export async function navigateViaHash(hash) {
  const normalized = String(hash).replace(/\/$/, '') || hash;

  if (supportsExecuteScript()) {
    try {
      await browser.execute(h => {
        window.location.hash = h;
      }, hash);
      await browser.pause(2_000);
      const currentHash = await browser.execute(() => window.location.hash);
      console.log(`[E2E] Navigated to ${hash} (current: ${currentHash})`);
    } catch (err) {
      console.log(`[E2E] Hash navigation to ${hash} failed:`, err);
    }
    return;
  }

  try {
    await triggerAppRouteDeepLink(normalized);
    await browser.pause(1_500);
    console.log(`[E2E] Mac2 deep-link navigation to ${hash}`);
    return;
  } catch (err) {
    console.log(`[E2E] Mac2 deep-link navigation to ${hash} failed:`, err);
  }

  // Appium Mac2 — Settings → Billing (nested route)
  if (normalized === '/settings/billing') {
    try {
      await clickNativeButton('Settings', 12_000);
      await browser.pause(1_500);
      let sub = await clickFirstButtonOrText(['Billing & Usage', 'Billing'], 4_000);
      if (!sub) {
        const section = await clickFirstButtonOrText(['Account & Security', 'Account'], 12_000);
        console.log(`[E2E] Mac2 billing navigation: account section ${section}`);
        if (!section) {
          throw new Error('Mac2: could not find Account & Security after opening Settings');
        }
        await browser.pause(1_500);
        sub = await clickFirstButtonOrText(['Billing & Usage', 'Billing'], 12_000);
      }
      if (!sub) {
        throw new Error('Mac2: could not find Billing / Billing & Usage after opening Settings');
      }
      await browser.pause(2_000);
      console.log(`[E2E] Mac2 navigated to ${hash} via Settings → ${sub}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[E2E] Mac2: failed to navigate to ${hash}: ${msg}`);
    }
    return;
  }

  const label = HASH_TO_SIDEBAR_LABEL[normalized];
  if (label) {
    try {
      await clickFirstButtonOrText([label], 12_000);
      await browser.pause(2_000);
      console.log(`[E2E] Mac2 sidebar navigation to ${hash} via "${label}"`);
    } catch (err) {
      console.log(`[E2E] Mac2 sidebar navigation to ${hash} failed:`, err);
    }
    return;
  }

  throw new Error(
    `[E2E] Mac2: no sidebar mapping for hash "${hash}". Extend HASH_TO_SIDEBAR_LABEL or add a branch in navigateViaHash.`
  );
}

export async function navigateToHome() {
  await navigateViaHash('/home');
  const homeText = await waitForHomePage(10_000);
  if (!homeText) {
    if (supportsExecuteScript()) {
      try {
        await browser.execute(() => {
          window.location.hash = '/home';
        });
      } catch {
        /* ignore */
      }
    } else {
      try {
        await clickFirstButtonOrText(['Home'], 8_000);
      } catch {
        /* ignore */
      }
    }
    await browser.pause(2_000);
    await waitForHomePage(10_000);
  }
}

export async function navigateToSettings() {
  await navigateViaHash('/settings');
}

export async function navigateToBilling() {
  await navigateViaHash('/settings/billing');

  const deadline = Date.now() + 15_000;
  let hasBilling = false;
  while (Date.now() < deadline) {
    hasBilling =
      (await textExists('Current Plan')) ||
      (await textExists('FREE')) ||
      (await textExists('Upgrade'));
    if (hasBilling) break;
    await browser.pause(500);
  }

  if (hasBilling) {
    console.log('[E2E] Billing page loaded');
    return;
  }

  console.log('[E2E] Billing content not found after initial navigation; running fallback');

  await navigateViaHash('/settings');
  await browser.pause(3_000);

  if (supportsExecuteScript()) {
    const currentHash = await browser.execute(() => window.location.hash);
    console.log(`[E2E] Billing fallback: current hash ${currentHash}`);

    const clicked = await browser.execute(() => {
      const allText = document.querySelectorAll('*');
      for (const el of allText) {
        const text = el.textContent?.trim() || '';
        if (
          (text === 'Billing & Usage' || text === 'Billing') &&
          el.closest('button, [role="button"], a, [class*="MenuItem"]')
        ) {
          (el.closest('button, [role="button"], a, [class*="MenuItem"]') as HTMLElement).click();
          return 'clicked';
        }
      }
      window.location.hash = '/settings/billing';
      return 'hash-fallback';
    });
    console.log(`[E2E] Billing fallback: ${clicked}`);
  } else {
    const sub = await clickFirstButtonOrText(['Billing & Usage', 'Billing'], 10_000);
    console.log(`[E2E] Billing fallback (Mac2): clicked ${sub}`);
  }
  await browser.pause(3_000);

  // Verify billing actually loaded after fallback
  const finalCheck =
    (await textExists('Current Plan')) ||
    (await textExists('FREE')) ||
    (await textExists('Upgrade'));
  if (!finalCheck) {
    let finalHash = '';
    if (supportsExecuteScript()) {
      finalHash = await browser.execute(() => window.location.hash);
    }
    const tree = await dumpAccessibilityTree();
    console.log(`[E2E] Billing verification failed after fallback. Hash: ${finalHash}`);
    console.log(`[E2E] Accessibility tree:\n`, tree.slice(0, 4000));
    throw new Error(
      `navigateToBilling: billing markers not found after fallback (hash: ${finalHash})`
    );
  }
  console.log('[E2E] Billing page loaded (after fallback)');
}

export async function navigateToSkills() {
  await navigateViaHash('/skills');
}

export async function navigateToIntelligence() {
  await navigateViaHash('/intelligence');
}

export async function navigateToConversations() {
  await navigateViaHash('/conversations');
}

// ---------------------------------------------------------------------------
// Onboarding walkthrough
// Current flow: Welcome → Local AI → Screen & Accessibility → Tools → Skills (5 steps, indices 0–4).
// ---------------------------------------------------------------------------

/** Labels used to detect the onboarding overlay (same strings as Onboarding copy). */
export const ONBOARDING_OVERLAY_TEXTS = [
  'Skip',
  'Welcome',
  'Run AI Models Locally',
  'Screen & Accessibility',
  'Enable Tools',
  'Install Skills',
] as const;

/** True when the full-screen onboarding overlay is likely visible. */
async function onboardingOverlayLikelyVisible(): Promise<boolean> {
  for (const label of ONBOARDING_OVERLAY_TEXTS) {
    if (await textExists(label)) return true;
  }
  return false;
}

export async function isOnboardingOverlayVisible(): Promise<boolean> {
  return onboardingOverlayLikelyVisible();
}

export async function waitForOnboardingOverlayVisible(timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await onboardingOverlayLikelyVisible()) return true;
    await browser.pause(400);
  }
  return false;
}

export async function waitForOnboardingOverlayHidden(timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await onboardingOverlayLikelyVisible())) return true;
    await browser.pause(400);
  }
  return false;
}

/**
 * Walk through onboarding: Welcome → Local AI → Screen & Accessibility → Tools → Skills.
 * Each step uses the shared primary button label "Continue" (see OnboardingNextButton).
 * Completing the last step dismisses the overlay.
 */
export async function walkOnboarding(logPrefix = '[E2E]') {
  let visible = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await onboardingOverlayLikelyVisible()) {
      visible = true;
      break;
    }
    await browser.pause(400);
  }

  if (!visible) {
    console.log(`${logPrefix} Onboarding overlay not visible — skipping`);
    await browser.pause(1_000);
    return;
  }

  // Up to 6 "Continue" clicks — covers 5 steps plus one retry if the list is still loading.
  for (let step = 0; step < 6; step++) {
    if (!(await onboardingOverlayLikelyVisible())) {
      console.log(`${logPrefix} Onboarding dismissed after step ${step}`);
      return;
    }

    const clicked = await clickFirstMatch(['Continue'], 12_000);
    if (clicked) {
      console.log(`${logPrefix} Onboarding step ${step}: clicked Continue`);
      await browser.pause(step >= 4 ? 4_000 : 2_000);
    } else {
      const installSkillsLabel = ONBOARDING_OVERLAY_TEXTS[ONBOARDING_OVERLAY_TEXTS.length - 1]!;
      if (await textExists(installSkillsLabel)) {
        await browser.pause(2_500);
        const retry = await clickFirstMatch(['Continue'], 10_000);
        if (retry) {
          console.log(
            `${logPrefix} Onboarding step ${step}: retry Continue on ${installSkillsLabel}`
          );
          await browser.pause(4_000);
        }
      }
      break;
    }
  }
}

/**
 * Walk through onboarding if it is visible, or no-op if already on Home.
 *
 * Delegates to walkOnboarding, which polls up to 8 × 400 ms for the overlay
 * to appear before giving up — safe to call unconditionally after auth so
 * timing races do not cause the helper to skip onboarding prematurely.
 */
export async function completeOnboardingIfVisible(logPrefix = '[E2E]') {
  await walkOnboarding(logPrefix);
}

export async function waitForLoggedOutState(timeout = 10_000): Promise<string | null> {
  const welcomeCandidates = [
    "Sign in! Let's Cook",
    'Continue with email',
    'Enter your email',
    'Google',
    'GitHub',
    'Twitter',
  ];
  const authenticatedMarkers = [
    'Welcome Onboard',
    'Message OpenHuman',
    'Connected to OpenHuman AI',
    'Log out',
    'Logout',
    'Sign out',
  ];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const text of welcomeCandidates) {
      if (await textExists(text)) {
        let stillAuthenticated = false;
        for (const marker of authenticatedMarkers) {
          if (await textExists(marker)) {
            stillAuthenticated = true;
            break;
          }
        }
        if (!stillAuthenticated) {
          return text;
        }
      }
    }
    await browser.pause(500);
  }
  return null;
}

export async function logoutViaSettings(logPrefix = '[E2E]') {
  if (!supportsExecuteScript()) {
    await forceLogoutMac2(logPrefix);
    const welcomeMarker = await waitForLoggedOutState(15_000);
    if (!welcomeMarker) {
      throw new Error('Mac2 logout fallback did not reach the welcome screen');
    }
    console.log(`${logPrefix} Mac2 logout fallback confirmed: "${welcomeMarker}"`);
    return;
  }

  const logoutCandidates = ['Log out', 'Logout', 'Sign out', 'Sign out of your account'];

  await navigateToSettings();

  let clicked: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    clicked = await clickFirstButtonOrText(logoutCandidates, 4_000);
    if (!clicked && !supportsExecuteScript()) {
      for (let swipeAttempt = 1; swipeAttempt <= 5; swipeAttempt++) {
        await swipeUpMac2(logPrefix);
        clicked = await clickFirstButtonOrText(logoutCandidates, 2_500);
        if (clicked) {
          console.log(`${logPrefix} Logout action became visible after swipe ${swipeAttempt}/5`);
          break;
        }
      }
    }
    if (clicked) {
      break;
    }
    console.log(
      `${logPrefix} Logout entry not clickable (attempt ${attempt}/3); retrying Settings`
    );
    await navigateToSettings();
    await browser.pause(1_000);
  }
  if (!clicked) {
    const tree = await dumpAccessibilityTree();
    console.log(`${logPrefix} Logout button not found. Tree:\n`, tree.slice(0, 4000));
    throw new Error('Could not find logout button in Settings');
  }
  console.log(`${logPrefix} Logout clicked: "${clicked}"`);

  await browser.pause(2_000);

  const hasConfirm = (await textExists('Confirm')) || (await textExists('Yes'));
  if (hasConfirm) {
    const confirmed = await clickFirstButtonOrText(['Confirm', 'Yes'], 10_000);
    if (!confirmed) {
      throw new Error('Logout confirmation dialog appeared but confirm button was not clickable');
    }
    console.log(`${logPrefix} Logout confirmation accepted via "${confirmed}"`);
  }

  let loggedOutMarker = await waitForLoggedOutState(10_000);
  if (!loggedOutMarker) {
    const stillHasLogoutEntry =
      (await textExists('Log out')) ||
      (await textExists('Logout')) ||
      (await textExists('Sign out')) ||
      (await textExists('Sign out of your account'));
    if (stillHasLogoutEntry) {
      console.log(`${logPrefix} Logout entry still visible; retrying logout click once`);
      const retried = await clickFirstButtonOrText(logoutCandidates, 5_000);
      if (retried) {
        await browser.pause(1_500);
        const hasRetryConfirm = (await textExists('Confirm')) || (await textExists('Yes'));
        if (hasRetryConfirm) {
          await clickFirstButtonOrText(['Confirm', 'Yes'], 5_000);
        }
      }
      loggedOutMarker = await waitForLoggedOutState(10_000);
    }
  }
  if (!loggedOutMarker) {
    // Fallback proxy for Mac2: after logout, user should not be on Home and
    // the destructive "Log out" action should disappear from Settings.
    const stillHasLogoutEntry =
      (await textExists('Log out')) ||
      (await textExists('Logout')) ||
      (await textExists('Sign out')) ||
      (await textExists('Sign out of your account'));
    const homeMarker = await waitForHomePage(4_000);
    if (!stillHasLogoutEntry && !homeMarker) {
      console.log(
        `${logPrefix} Logged-out proxy confirmed: no logout entry and no home marker (Mac2 fallback)`
      );
      return;
    }

    const tree = await dumpAccessibilityTree();
    console.log(`${logPrefix} Logged-out state not detected. Tree:\n`, tree.slice(0, 4000));
    throw new Error('Logged-out state was not visible after logout');
  }

  console.log(`${logPrefix} Logged-out state confirmed: "${loggedOutMarker}"`);
}

// ---------------------------------------------------------------------------
// Full login flow
// ---------------------------------------------------------------------------

/**
 * @param token          Deep link token string.
 * @param logPrefix      Prefix for console log lines.
 * @param postLoginVerifier  Optional async callback invoked after the Home page
 *   is confirmed.  Receives `logPrefix` so it can log consistently.  If the
 *   verifier throws, performFullLogin propagates the error — callers can use
 *   this to assert that auth side-effects (e.g. token consume, profile fetch)
 *   actually occurred rather than relying on UI alone.
 */
export async function performFullLogin(
  token = 'e2e-test-token',
  logPrefix = '[E2E]',
  postLoginVerifier?: (logPrefix: string) => Promise<void>
) {
  await triggerAuthDeepLink(token);
  await waitForWindowVisible(25_000);
  await waitForWebView(15_000);
  await waitForAppReady(15_000);
  await waitForAuthBootstrap(15_000);

  await walkOnboarding(logPrefix);

  const homeText = await waitForHomePage(15_000);
  if (!homeText) {
    const tree = await dumpAccessibilityTree();
    console.log(`${logPrefix} Home page not reached after login. Tree:\n`, tree.slice(0, 4000));
    throw new Error('Full login did not reach Home page');
  }

  if (postLoginVerifier) {
    await postLoginVerifier(logPrefix);
  }

  console.log(`${logPrefix} Home page confirmed: found "${homeText}"`);
}
