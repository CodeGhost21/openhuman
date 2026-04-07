import { describe, expect, it } from 'vitest';

import {
  buildDesktopDeeplink,
  buildPaymentCancelDeeplink,
  buildPaymentSuccessDeeplink,
} from '../deeplink';

describe('buildDesktopDeeplink', () => {
  it('builds auth deep link with token', () => {
    const url = buildDesktopDeeplink('my-token-123');
    expect(url).toBe('openhuman://auth?token=my-token-123');
  });

  it('URL-encodes special characters in token', () => {
    const url = buildDesktopDeeplink('token with spaces & symbols=1');
    expect(url).toBe('openhuman://auth?token=token%20with%20spaces%20%26%20symbols%3D1');
  });

  it('handles empty token', () => {
    const url = buildDesktopDeeplink('');
    expect(url).toBe('openhuman://auth?token=');
  });
});

describe('buildPaymentSuccessDeeplink', () => {
  it('builds payment success deep link with session_id', () => {
    const url = buildPaymentSuccessDeeplink('cs_live_abc123');
    expect(url).toBe('openhuman://payment/success?session_id=cs_live_abc123');
  });

  it('URL-encodes special characters in sessionId', () => {
    const url = buildPaymentSuccessDeeplink('session/id?foo=bar');
    expect(url).toBe('openhuman://payment/success?session_id=session%2Fid%3Ffoo%3Dbar');
  });
});

describe('buildPaymentCancelDeeplink', () => {
  it('returns the cancel deep link', () => {
    const url = buildPaymentCancelDeeplink();
    expect(url).toBe('openhuman://payment/cancel');
  });
});
