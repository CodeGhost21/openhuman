import { describe, expect, it } from 'vitest';

import { chatSendError, type ChatSendErrorCode } from '../chatSendError';

describe('chatSendError', () => {
  it('creates an error object with the given code and message', () => {
    const err = chatSendError('socket_disconnected', 'No connection');
    expect(err.code).toBe('socket_disconnected');
    expect(err.message).toBe('No connection');
  });

  it('returns a plain object (not a thrown Error instance)', () => {
    const err = chatSendError('cloud_send_failed', 'Send failed');
    expect(err).not.toBeInstanceOf(Error);
    expect(typeof err).toBe('object');
  });

  it('supports all defined error codes without TypeScript error', () => {
    const codes: ChatSendErrorCode[] = [
      'socket_disconnected',
      'local_model_failed',
      'cloud_send_failed',
      'voice_transcription',
      'microphone_unavailable',
      'microphone_recording',
      'microphone_access',
      'voice_playback',
      'safety_timeout',
    ];
    for (const code of codes) {
      const err = chatSendError(code, `${code} message`);
      expect(err.code).toBe(code);
    }
  });

  it('preserves the exact message string', () => {
    const msg = 'Detailed error: upstream timeout after 30s';
    const err = chatSendError('safety_timeout', msg);
    expect(err.message).toBe(msg);
  });
});
