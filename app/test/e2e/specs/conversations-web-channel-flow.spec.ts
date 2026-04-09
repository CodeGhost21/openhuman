// @ts-nocheck
/**
 * E2E test: current conversations flow.
 *
 * Latest observed behavior:
 * - auth uses the bypass deep-link path in E2E
 * - onboarding may still appear and must be dismissed before navigation
 * - macOS Mac2 is reliable for verifying the conversations surface, but not for
 *   end-to-end chat input automation
 * - tauri-driver / DOM-capable runs can still send a real message and assert the
 *   mock backend response
 */
import { waitForApp, waitForAppReady } from '../helpers/app-helpers';
import { triggerAuthDeepLink, triggerAuthDeepLinkBypass } from '../helpers/deep-link-helpers';
import {
  clickText,
  dumpAccessibilityTree,
  textExists,
  waitForText,
  waitForWebView,
  waitForWindowVisible,
} from '../helpers/element-helpers';
import { isMac2 } from '../helpers/platform';
import {
  completeOnboardingIfVisible,
  navigateToConversations,
  navigateViaHash,
  waitForHomePage,
} from '../helpers/shared-flows';
import { clearRequestLog, getRequestLog, startMockServer, stopMockServer } from '../mock-server';

function stepLog(message: string, context?: unknown) {
  const stamp = new Date().toISOString();
  if (context === undefined) {
    console.log(`[ConversationsE2E][${stamp}] ${message}`);
    return;
  }
  console.log(`[ConversationsE2E][${stamp}] ${message}`, JSON.stringify(context, null, 2));
}

async function waitForRequest(method, urlFragment, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const log = getRequestLog();
    const match = log.find(r => r.method === method && r.url.includes(urlFragment));
    if (match) return match;
    await browser.pause(500);
  }
  return undefined;
}

async function waitForAnyText(candidates, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const text of candidates) {
      if (await textExists(text)) return text;
    }
    await browser.pause(500);
  }
  return null;
}

async function findMac2ChatInput(timeout = 15_000) {
  // Only match TextArea — chat inputs render as <textarea> (XCUIElementTypeTextArea).
  // XCUIElementTypeTextField maps to <input type="text"> which includes the login
  // email field; accepting those would produce false positives when auth fails.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const candidates = await browser.$$('//XCUIElementTypeTextArea');
      for (const candidate of candidates) {
        try {
          if (await candidate.isExisting()) {
            return candidate;
          }
        } catch {
          // keep scanning
        }
      }
    } catch {
      // try next poll
    }
    await browser.pause(500);
  }
  return null;
}

async function focusAndSendChatMessage(message) {
  if (isMac2()) {
    const input = await findMac2ChatInput(15_000);
    if (!input) {
      const tree = await dumpAccessibilityTree();
      stepLog('Mac2 chat input not found. Tree:', tree.slice(0, 4000));
      throw new Error('Mac2 chat input textarea/text field not found');
    }
    await input.click();
    await browser.pause(500);
    await input.addValue(message);
    await browser.pause(500);
    await browser.performActions([
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: '\uE007' },
          { type: 'keyUp', value: '\uE007' },
        ],
      },
    ]);
    await browser.releaseActions();
    return;
  }

  const foundInput = await browser.execute(() => {
    const textarea = document.querySelector(
      'textarea[placeholder*="Type a message"]'
    ) as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      textarea.click();
      return true;
    }
    // Fallback: any textarea or contenteditable
    const fallback = document.querySelector('textarea, [contenteditable="true"]') as HTMLElement;
    if (fallback) {
      fallback.focus();
      fallback.click();
      return true;
    }
    return false;
  });
  if (!foundInput) {
    const tree = await dumpAccessibilityTree();
    stepLog('Chat input not found. Tree:', tree.slice(0, 4000));
    throw new Error('Chat input textarea not found');
  }

  await browser.pause(500);

  await browser.execute(value => {
    const textarea = document.querySelector(
      'textarea[placeholder*="Type a message"]'
    ) as HTMLTextAreaElement;
    if (!textarea) return;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    nativeInputValueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }, message);
  await browser.pause(500);

  await browser.execute(() => {
    const textarea = document.querySelector(
      'textarea[placeholder*="Type a message"]'
    ) as HTMLTextAreaElement;
    if (!textarea) return;
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    );
  });
}

describe('Conversations web channel flow', () => {
  before(async () => {
    stepLog('starting mock server');
    await startMockServer();
    stepLog('waiting for app');
    await waitForApp();
    stepLog('clearing request log');
    clearRequestLog();
  });

  after(async () => {
    stepLog('stopping mock server');
    await stopMockServer();
  });

  it('opens the current conversations surface and exercises chat where supported', async function () {
    stepLog('trigger deep link');
    if (isMac2()) {
      await triggerAuthDeepLink('e2e-conversations-token');
    } else {
      await triggerAuthDeepLinkBypass('e2e-conversations-token');
    }
    stepLog('wait for window');
    await waitForWindowVisible(25_000);
    stepLog('wait for app ready');
    await waitForAppReady(15_000);
    if (!isMac2()) {
      stepLog('wait for webview');
      await waitForWebView(15_000);
    }

    if (isMac2()) {
      stepLog('wait for auth consume request');
      const consumeCall = await waitForRequest('POST', '/telegram/login-tokens/', 20_000);
      expect(consumeCall).toBeDefined();

      stepLog('wait for user profile request');
      const profileCall =
        (await waitForRequest('GET', '/auth/me', 15_000)) ||
        (await waitForRequest('GET', '/settings', 15_000));
      expect(profileCall).toBeDefined();

      // Wait for the Welcome/login page to clear before running onboarding.
      //
      // The deep link triggers storeSession, but the CoreStateProvider poll
      // (every 3 s) must fire before ProtectedRoute lets the app leave the
      // Welcome page. If completeOnboardingIfVisible starts while the Welcome
      // page is still showing, walkOnboarding matches "Welcome to OpenHuman"
      // for the 'Welcome' candidate and clicks "Continue with email" instead
      // of the real onboarding Continue button, wasting all six allowed clicks.
      stepLog('Mac2: wait for login page to clear (CoreState poll must fire)');
      const authTransitionDeadline = Date.now() + 10_000;
      let welcomeCleared = false;
      while (Date.now() < authTransitionDeadline) {
        const onLoginPage = await textExists("Sign in! Let's Cook");
        if (!onLoginPage) {
          welcomeCleared = true;
          break;
        }
        await browser.pause(500);
      }
      if (!welcomeCleared) {
        const tree = await dumpAccessibilityTree();
        stepLog(
          'Mac2: Welcome page still showing after auth — session may not have been applied. Tree:',
          tree.slice(0, 4000)
        );
        throw new Error(
          'Mac2: app did not navigate away from the Welcome/login page after auth deep link'
        );
      }
      stepLog('Mac2: login page cleared — app is in authenticated state');
    } else {
      // Bypass auth sets the session token directly, so a profile fetch is best-effort only.
      stepLog('wait for user profile request');
      const profileCall = await waitForRequest('GET', '/auth/me', 15_000);
      if (!profileCall) {
        stepLog('user profile call not found — bypass token may have been set without API call');
      }
    }

    stepLog('complete onboarding');
    await completeOnboardingIfVisible('[ConversationsE2E]');

    if (isMac2()) {
      // Wait for Home page before navigating — ensures the session is fully
      // bootstrapped and prevents the app from redirecting back to login.
      stepLog('Mac2: wait for home page after onboarding');
      const homeText = await waitForHomePage(25_000);
      if (!homeText) {
        const tree = await dumpAccessibilityTree();
        stepLog('Mac2: home page not reached after onboarding. Tree:', tree.slice(0, 4000));
        throw new Error('Mac2: home page was not visible after completing onboarding');
      }
      stepLog(`Mac2: home page confirmed — "${homeText}"`);
    }

    stepLog('open conversations');
    // The conversations route is still the primary entrypoint, but the home CTA
    // is a useful fallback if the selected thread surface is not ready yet.
    await navigateToConversations();

    if (isMac2()) {
      // Guard: fail immediately if the app redirected back to login rather than
      // loading the conversations surface.
      if (await textExists("Sign in! Let's Cook")) {
        const tree = await dumpAccessibilityTree();
        stepLog(
          'Mac2: login page visible after navigating to conversations — auth state lost. Tree:',
          tree.slice(0, 4000)
        );
        throw new Error('Mac2: app showed login page instead of conversations surface');
      }

      stepLog('Mac2: waiting for conversations surface markers');
      let conversationsMarker = await waitForAnyText(
        ['Switch to voice input', 'Reply', 'Type a message', 'No messages yet'],
        8_000
      );
      if (!conversationsMarker) {
        stepLog('Mac2: conversations markers not found; trying home CTA fallback');
        await navigateViaHash('/home');
        await browser.pause(1_500);
        try {
          await waitForText('Message OpenHuman', 6_000);
          await clickText('Message OpenHuman', 10_000);
          await browser.pause(1_000);
        } catch {
          stepLog('Mac2: Message OpenHuman button not found; retrying conversations route');
          await navigateToConversations();
          await browser.pause(1_500);
        }
        conversationsMarker = await waitForAnyText(
          ['Switch to voice input', 'Reply', 'Type a message', 'No messages yet'],
          6_000
        );
      }

      if (!conversationsMarker) {
        const tree = await dumpAccessibilityTree();
        stepLog('Mac2: conversations surface markers missing. Tree:', tree.slice(0, 5000));
        throw new Error('Mac2: conversations surface did not become visible');
      }

      stepLog(`Mac2: conversations surface confirmed via "${conversationsMarker}"`);

      expect(await textExists('chat_send is not available')).toBe(false);
      return;
    }

    const hasInput = await textExists('Type a message...');
    if (!hasInput) {
      await navigateViaHash('/home');
      try {
        await waitForText('Message OpenHuman', 10_000);
        await clickText('Message OpenHuman', 10_000);
      } catch {
        stepLog('Message OpenHuman button not found, staying on conversations');
        await navigateToConversations();
      }
    }

    stepLog('send message');
    await focusAndSendChatMessage('hello from e2e web channel');
    await browser.pause(1_000);

    stepLog('validate backend request');
    const chatReq = await waitForRequest('POST', '/openai/v1/chat/completions', 30_000);
    if (!chatReq) {
      const tree = await dumpAccessibilityTree();
      console.log('[ConversationsE2E] Missing openai chat request. Tree:\n', tree.slice(0, 5000));
    }
    expect(chatReq).toBeDefined();

    await waitForText('hello from e2e web channel', 20_000);
    await waitForText('Hello from e2e mock agent', 30_000);

    expect(await textExists('chat_send is not available')).toBe(false);
  });
});
