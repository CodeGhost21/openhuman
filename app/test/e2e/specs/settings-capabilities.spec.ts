// @ts-nocheck
/**
 * E2E test: current settings and capability surfaces mapped to the flow catalog.
 *
 * This suite covers the parts of the current desktop app that correspond to:
 * - 2. Permissions & System Access
 * - 4. System Tools & Capabilities
 * - 5. Memory System
 * - 6. Automation & Scheduling
 * - 10. Rewards & Progression
 * - 11. Settings & Configuration
 */
import { waitForApp, waitForAppReady } from '../helpers/app-helpers';
import { triggerAuthDeepLinkBypass } from '../helpers/deep-link-helpers';
import {
  textExists,
  waitForText,
  waitForWebView,
  waitForWindowVisible,
} from '../helpers/element-helpers';
import { supportsExecuteScript } from '../helpers/platform';
import { completeOnboardingIfVisible, navigateViaHash } from '../helpers/shared-flows';
import { clearRequestLog, startMockServer, stopMockServer } from '../mock-server';

async function expectRouteWithMarkers(route, title, markers = []) {
  await navigateViaHash(route);
  await waitForText(title, 15_000);
  for (const marker of markers) {
    await waitForText(marker, 15_000);
  }
}

describe('2/4/5/6/10/11 Current Settings & Capability Flows', () => {
  before(async function () {
    if (!supportsExecuteScript()) {
      this.skip();
    }

    await startMockServer();
    await waitForApp();
    clearRequestLog();

    await triggerAuthDeepLinkBypass('e2e-settings-capabilities-token');
    await waitForWindowVisible(25_000);
    await waitForWebView(15_000);
    await waitForAppReady(15_000);
    await completeOnboardingIfVisible('[SettingsCapabilities]');
  });

  after(async () => {
    await stopMockServer();
  });

  it('2.1 and 2.2 — accessibility and screen settings expose permission state and recovery controls', async () => {
    await expectRouteWithMarkers('/settings/accessibility', 'Accessibility Automation', [
      'Permissions',
      'Features',
      'Session',
    ]);

    await expectRouteWithMarkers('/settings/screen-intelligence', 'Screen Intelligence', [
      'Permissions',
      'Screen Intelligence Policy',
    ]);
  });

  it('4.1 to 4.4 — tools settings list the current system, file, vision, web, memory, and automation capabilities', async () => {
    await expectRouteWithMarkers('/settings/tools', 'Tools', [
      'System',
      'Shell Commands',
      'Git Operations',
      'Files',
      'Read Files',
      'Vision',
      'Screenshot',
      'Web',
      'Web Search',
      'Memory',
      'Store Memory',
      'Automation',
      'Scheduled Tasks',
    ]);
  });

  it('5.1 to 5.3 — memory panels for data and recall are reachable', async () => {
    await expectRouteWithMarkers('/settings/memory-data', 'Memory Data');
    await expectRouteWithMarkers('/settings/memory-debug', 'Memory Debug', ['Query & Recall']);
  });

  it('6.1 to 6.3 — cron job controls are reachable from settings', async () => {
    await expectRouteWithMarkers('/settings/cron-jobs', 'Cron Jobs', [
      'Core Cron Jobs',
      'Refresh Cron Jobs',
    ]);
  });

  it('10.1 and 10.2 — rewards route shows current role unlock progress', async () => {
    await expectRouteWithMarkers('/rewards', 'Earn community roles', [
      'Discord Rewards',
      'Progress',
      'Connect Discord',
    ]);
  });

  it('11.1 to 11.5 — profile, linked accounts, messaging, AI, developer tools, and reset entry points are reachable', async () => {
    await expectRouteWithMarkers('/settings/profile', 'Profile');
    await expectRouteWithMarkers('/settings/connections', 'Connections', ['Google', 'Notion']);
    await expectRouteWithMarkers('/settings/messaging', 'Messaging', ['Default Messaging Channel']);
    await expectRouteWithMarkers('/settings/local-model', 'Local Model', ['Runtime Status']);
    await expectRouteWithMarkers('/settings/voice', 'Voice Dictation', ['Hotkey']);
    await expectRouteWithMarkers('/settings/skills', 'Skills');
    await expectRouteWithMarkers('/settings/developer-options', 'Developer Options', [
      'Webhooks',
      'Memory Data',
      'Memory Debug',
    ]);
    await expectRouteWithMarkers('/settings/webhooks-debug', 'Webhooks Debug', [
      'Registered Webhooks',
    ]);

    await navigateViaHash('/settings');
    await waitForText('Clear App Data', 15_000);
    expect(await textExists('Log out')).toBe(true);
  });
});
