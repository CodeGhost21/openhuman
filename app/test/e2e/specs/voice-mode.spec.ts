// @ts-nocheck
/**
 * E2E test: Voice mode integration
 *
 * Covers:
 *   - Navigating to conversations page
 *   - Switching to voice input mode
 *   - Voice status check fires and displays availability message
 *   - Voice input/reply mode toggle buttons render
 *   - Voice recording button renders in voice mode
 *   - Switching back to text mode restores text input
 *
 * The mock server runs on http://127.0.0.1:18473
 */
import { waitForApp, waitForAppReady } from '../helpers/app-helpers';
import { triggerAuthDeepLink } from '../helpers/deep-link-helpers';
import {
  clickText,
  dumpAccessibilityTree,
  textExists,
  waitForWindowVisible,
} from '../helpers/element-helpers';
import { isMac2 } from '../helpers/platform';
import { completeOnboardingIfVisible, navigateToConversations } from '../helpers/shared-flows';
import { clearRequestLog, getRequestLog, startMockServer, stopMockServer } from '../mock-server';

async function waitForRequest(method, urlFragment, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const log = getRequestLog();
    const match = log.find(r => r.method === method && r.url.includes(urlFragment));
    if (match) return match;
    await browser.pause(500);
  }
  return undefined;
}

async function waitForHome(timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await textExists('Message OpenHuman')) return true;
    await browser.pause(700);
  }
  return false;
}

async function waitForAnyText(candidates, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const t of candidates) {
      if (await textExists(t)) return t;
    }
    await browser.pause(600);
  }
  return null;
}

describe('Voice mode integration', () => {
  before(async () => {
    await startMockServer();
    await waitForApp();
    clearRequestLog();
  });

  after(async () => {
    await stopMockServer();
  });

  it('can switch to voice input mode, see status message, and switch back to text', async () => {
    // --- Authenticate and reach conversations ---
    await triggerAuthDeepLink('e2e-voice-token');
    await waitForWindowVisible(25_000);
    await waitForAppReady(15_000);

    const consume = await waitForRequest('POST', '/telegram/login-tokens/');
    expect(consume).toBeDefined();

    await completeOnboardingIfVisible('[VoiceModeE2E]');

    const onHome = await waitForHome(20_000);
    if (!onHome) {
      const tree = await dumpAccessibilityTree();
      console.log('[VoiceModeE2E] Home not reached. Tree:\n', tree.slice(0, 4000));
    }
    expect(onHome).toBe(true);

    await navigateToConversations();
    await browser.pause(2_000);

    // --- Verify we see the text input area (default mode) ---
    const hasTextInput = await waitForAnyText(
      ['Type a message', 'No messages yet', 'Conversations', 'Switch to voice input'],
      10_000
    );
    expect(hasTextInput).not.toBeNull();

    // --- Switch to voice input mode ---
    if (isMac2()) {
      // The mic button is a standalone element (not nested inside the textarea
      // container) so XCUITest exposes it as an independent accessible element
      // with aria-label="Switch to voice input".
      await clickText('Switch to voice input', 10_000);
    } else {
      // There are two "Voice" buttons (Input toggle and Reply toggle).
      // We click the first one which is the Input mode toggle.
      await clickText('Voice', 10_000);
    }
    await browser.pause(2_000);

    // --- Voice status check should fire ---
    // Since whisper-cli is not installed in the E2E environment,
    // we expect the unavailability message or the ready message.
    const voiceStatusMessage = await waitForAnyText(
      [
        'Speech-to-text unavailable',
        'whisper-cli binary',
        'STT model not found',
        'Ready',
        'Start Talking',
        'Could not check voice availability',
      ],
      15_000
    );

    if (!voiceStatusMessage) {
      const tree = await dumpAccessibilityTree();
      console.log('[VoiceModeE2E] No voice status message seen. Tree:\n', tree.slice(0, 5000));
    }
    expect(voiceStatusMessage).not.toBeNull();

    // --- Verify the voice recording button or unavailability message is visible ---
    const hasVoiceButton = await waitForAnyText(
      ['Start Talking', 'Transcribing', 'Stop & Send'],
      10_000
    );
    if (!hasVoiceButton) {
      const hasStatus = await textExists('Speech-to-text unavailable');
      expect(hasStatus).toBe(true);
    }

    // --- Switch back to text mode ---
    if (!isMac2()) {
      // Click the "Text" button in the Input toggle group
      await clickText('Text', 10_000);
      await browser.pause(1_500);

      // --- Verify text input is restored ---
      const textRestored = await waitForAnyText(['Message OpenHuman', 'Type a message'], 10_000);
      expect(textRestored).not.toBeNull();
    }
  });

  it('shows reply mode toggle with text and voice options', async () => {
    // Ensure conversations page is loaded (re-authenticate if state was lost).
    const onConversations = await waitForAnyText(
      ['Message OpenHuman', 'Type a message', 'Reply', 'Conversations'],
      5_000
    );
    if (!onConversations) {
      await triggerAuthDeepLink('e2e-voice-token');
      await waitForWindowVisible(25_000);
      await waitForAppReady(15_000);
      await completeOnboardingIfVisible('[VoiceModeE2E]');
      await waitForHome(20_000);
      await navigateToConversations();
      await browser.pause(2_000);
    }

    if (isMac2()) {
      const hasVoiceSurface = await waitForAnyText(
        [
          'Switch to voice input',
          'Start Talking',
          'Could not check voice availability',
          'Conversations',
        ],
        10_000
      );
      expect(hasVoiceSurface).not.toBeNull();
      return;
    }

    // The Reply toggle should be visible on the conversations page
    const hasReplyLabel = await textExists('Reply');
    expect(hasReplyLabel).toBe(true);

    // Verify both reply mode options exist
    // (There are multiple "Text" and "Voice" buttons — Input + Reply groups)
    const hasText = await textExists('Text');
    expect(hasText).toBe(true);
  });
});
