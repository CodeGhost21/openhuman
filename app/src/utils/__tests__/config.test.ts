/**
 * Tests for config.ts
 * Verifies each exported constant has the expected type and default value.
 */
import { describe, expect, it } from 'vitest';

import {
  BACKEND_URL,
  CORE_RPC_URL,
  DEV_FORCE_ONBOARDING,
  DEV_JWT_TOKEN,
  IS_DEV,
  SENTRY_DSN,
  SKILLS_GITHUB_REPO,
  TELEGRAM_BOT_USERNAME,
} from '../config';

describe('config', () => {
  describe('CORE_RPC_URL', () => {
    it('is a string', () => {
      expect(typeof CORE_RPC_URL).toBe('string');
    });

    it('has a default value when env var is not set', () => {
      // The global mock in setup.ts sets this to the default
      expect(CORE_RPC_URL).toMatch(/^http/);
    });
  });

  describe('IS_DEV', () => {
    it('is a boolean-like value', () => {
      // vi.stubEnv('DEV', true) is set in setup.ts
      expect(IS_DEV === true || IS_DEV === false || IS_DEV === undefined).toBe(true);
    });
  });

  describe('DEV_FORCE_ONBOARDING', () => {
    it('is a boolean', () => {
      expect(typeof DEV_FORCE_ONBOARDING).toBe('boolean');
    });

    it('is false by default (VITE_DEV_FORCE_ONBOARDING not set)', () => {
      // Only true when DEV && VITE_DEV_FORCE_ONBOARDING === 'true'
      expect(DEV_FORCE_ONBOARDING).toBe(false);
    });
  });

  describe('SKILLS_GITHUB_REPO', () => {
    it('is a string', () => {
      expect(typeof SKILLS_GITHUB_REPO).toBe('string');
    });

    it('has a default fallback value', () => {
      expect(SKILLS_GITHUB_REPO.length).toBeGreaterThan(0);
    });
  });

  describe('SENTRY_DSN', () => {
    it('is undefined or a string', () => {
      expect(SENTRY_DSN === undefined || typeof SENTRY_DSN === 'string').toBe(true);
    });
  });

  describe('BACKEND_URL', () => {
    it('is undefined or a string', () => {
      expect(BACKEND_URL === undefined || typeof BACKEND_URL === 'string').toBe(true);
    });
  });

  describe('TELEGRAM_BOT_USERNAME', () => {
    it('is a non-empty string', () => {
      expect(typeof TELEGRAM_BOT_USERNAME).toBe('string');
      expect(TELEGRAM_BOT_USERNAME.length).toBeGreaterThan(0);
    });

    it('defaults to openhuman_bot when env var is not set', () => {
      // The VITE_TELEGRAM_BOT_USERNAME is not set in tests so falls back
      expect(TELEGRAM_BOT_USERNAME).toBe('openhuman_bot');
    });
  });

  describe('DEV_JWT_TOKEN', () => {
    it('is undefined or a string', () => {
      expect(DEV_JWT_TOKEN === undefined || typeof DEV_JWT_TOKEN === 'string').toBe(true);
    });
  });
});
