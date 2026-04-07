import { describe, expect, it } from 'vitest';

import type { ChannelConnectionsState } from '../../../types/channels';
import { resolveOutboundRoute, resolvePreferredAuthModeForChannel } from '../routing';

function makeState(
  overrides: Partial<ChannelConnectionsState['connections']> = {},
  defaultChannel: ChannelConnectionsState['defaultMessagingChannel'] = 'telegram'
): ChannelConnectionsState {
  return {
    connections: { telegram: {}, discord: {}, web: {}, ...overrides },
    defaultMessagingChannel: defaultChannel,
  };
}

describe('resolvePreferredAuthModeForChannel', () => {
  it('returns null when channel has no connections', () => {
    const state = makeState();
    expect(resolvePreferredAuthModeForChannel(state, 'telegram')).toBeNull();
  });

  it('returns null when no connection is connected', () => {
    const state = makeState({
      telegram: { managed_dm: { status: 'disconnected', authMode: 'managed_dm' } as any },
    });
    expect(resolvePreferredAuthModeForChannel(state, 'telegram')).toBeNull();
  });

  it('returns managed_dm when it is connected', () => {
    const state = makeState({
      telegram: { managed_dm: { status: 'connected', authMode: 'managed_dm' } as any },
    });
    expect(resolvePreferredAuthModeForChannel(state, 'telegram')).toBe('managed_dm');
  });

  it('prefers managed_dm over bot_token', () => {
    const state = makeState({
      telegram: {
        managed_dm: { status: 'connected', authMode: 'managed_dm' } as any,
        bot_token: { status: 'connected', authMode: 'bot_token' } as any,
      },
    });
    expect(resolvePreferredAuthModeForChannel(state, 'telegram')).toBe('managed_dm');
  });

  it('falls back to bot_token when managed_dm is disconnected', () => {
    const state = makeState({
      telegram: {
        managed_dm: { status: 'disconnected', authMode: 'managed_dm' } as any,
        bot_token: { status: 'connected', authMode: 'bot_token' } as any,
      },
    });
    expect(resolvePreferredAuthModeForChannel(state, 'telegram')).toBe('bot_token');
  });

  it('returns null for unknown channel', () => {
    const state = makeState();
    expect(resolvePreferredAuthModeForChannel(state, 'discord')).toBeNull();
  });
});

describe('resolveOutboundRoute', () => {
  it('returns null when no channels are connected', () => {
    const state = makeState();
    expect(resolveOutboundRoute(state)).toBeNull();
  });

  it('returns route for default channel when connected', () => {
    const state = makeState({
      telegram: { managed_dm: { status: 'connected', authMode: 'managed_dm' } as any },
    });
    expect(resolveOutboundRoute(state)).toEqual({ channel: 'telegram', authMode: 'managed_dm' });
  });

  it('uses preferred channel when specified', () => {
    const state = makeState({
      telegram: { managed_dm: { status: 'connected', authMode: 'managed_dm' } as any },
      discord: { bot_token: { status: 'connected', authMode: 'bot_token' } as any },
    });
    expect(resolveOutboundRoute(state, 'discord')).toEqual({
      channel: 'discord',
      authMode: 'bot_token',
    });
  });

  it('falls back to another connected channel when preferred is disconnected', () => {
    const state = makeState({
      telegram: {},
      discord: { oauth: { status: 'connected', authMode: 'oauth' } as any },
    });
    // default is telegram which has nothing, so fallback to discord
    expect(resolveOutboundRoute(state)).toEqual({ channel: 'discord', authMode: 'oauth' });
  });

  it('skips the preferred channel in fallback loop', () => {
    const state = makeState(
      {
        telegram: {},
        discord: {},
        web: { api_key: { status: 'connected', authMode: 'api_key' } as any },
      },
      'telegram'
    );
    expect(resolveOutboundRoute(state)).toEqual({ channel: 'web', authMode: 'api_key' });
  });

  it('returns null when even fallback channels are disconnected', () => {
    const state = makeState({
      telegram: { managed_dm: { status: 'error', authMode: 'managed_dm' } as any },
      discord: {},
      web: {},
    });
    expect(resolveOutboundRoute(state)).toBeNull();
  });
});
