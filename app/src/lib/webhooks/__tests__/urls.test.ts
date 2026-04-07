import { describe, expect, it } from 'vitest';

import { buildWebhookIngressUrl } from '../urls';

describe('buildWebhookIngressUrl', () => {
  it('builds URL using config BACKEND_URL when no baseUrl override', () => {
    // setup.ts mocks BACKEND_URL to 'http://localhost:5005'
    const url = buildWebhookIngressUrl('my-tunnel-uuid');
    expect(url).toBe('http://localhost:5005/webhooks/ingress/my-tunnel-uuid');
  });

  it('uses the provided baseUrl override', () => {
    const url = buildWebhookIngressUrl('abc123', 'https://api.example.com');
    expect(url).toBe('https://api.example.com/webhooks/ingress/abc123');
  });

  it('strips trailing slashes from baseUrl override', () => {
    const url = buildWebhookIngressUrl('uuid1', 'https://api.example.com///');
    expect(url).toBe('https://api.example.com/webhooks/ingress/uuid1');
  });

  it('percent-encodes the tunnel UUID', () => {
    const url = buildWebhookIngressUrl('uuid with spaces', 'https://api.example.com');
    expect(url).toBe('https://api.example.com/webhooks/ingress/uuid%20with%20spaces');
  });

  it('handles tunnel UUID with special URI characters', () => {
    const url = buildWebhookIngressUrl('a/b?c=d', 'https://api.example.com');
    expect(url).toContain('/webhooks/ingress/');
    expect(url).not.toContain('?'); // encoded
  });
});
