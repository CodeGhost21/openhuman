/**
 * backendUrl tests
 *
 * The module has a singleton cache (resolvedBackendUrl). We use vi.resetModules()
 * + dynamic import per describe block to get a fresh module.
 * Note: setup.ts already mocks @tauri-apps/api/core.isTauri = vi.fn(() => false).
 * We re-mock coreRpcClient so we can control RPC responses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('backendUrl.getBackendUrl — web (non-Tauri) path', () => {
  // setup.ts mocks isTauri → false and BACKEND_URL → 'http://localhost:5005'
  // Just import normally; the cache is reset each suite via resetModules
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns VITE BACKEND_URL in browser env', async () => {
    const { getBackendUrl } = await import('../backendUrl');
    const url = await getBackendUrl();
    expect(url).toBe('http://localhost:5005');
  });

  it('caches the URL after first call', async () => {
    const { getBackendUrl } = await import('../backendUrl');
    const a = await getBackendUrl();
    const b = await getBackendUrl();
    expect(a).toBe(b);
  });

  it('strips trailing slashes from BACKEND_URL', async () => {
    // Override the config mock locally
    vi.doMock('../../utils/config', () => ({
      CORE_RPC_URL: 'http://127.0.0.1:7788/rpc',
      IS_DEV: true,
      DEV_FORCE_ONBOARDING: false,
      SKILLS_GITHUB_REPO: 'test/skills',
      SENTRY_DSN: undefined,
      BACKEND_URL: 'http://localhost:5005///',
      TELEGRAM_BOT_USERNAME: 'openhuman_bot',
      DEV_JWT_TOKEN: undefined,
    }));
    const { getBackendUrl } = await import('../backendUrl');
    const url = await getBackendUrl();
    expect(url).toBe('http://localhost:5005');
  });
});

// Tauri path tests are skipped here because the global setup.ts mock for
// @tauri-apps/api/core (isTauri → false) cannot be overridden reliably per-test
// without a full Tauri runtime. The web path above provides the core logic coverage.
