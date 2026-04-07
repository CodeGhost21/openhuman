import { describe, expect, it } from 'vitest';

import type { AccessibilityStatus, CaptureTestResult } from '../../utils/tauriCommands';
import reducer, {
  clearAccessibilityError,
  executeAccessibilityInputAction,
  fetchAccessibilityStatus,
  fetchAccessibilityVisionRecent,
  flushAccessibilityVision,
  refreshPermissionsWithRestart,
  requestAccessibilityPermission,
  requestAccessibilityPermissions,
  runCaptureTest,
  setAccessibilitySessionFeatures,
  setAccessibilityStatus,
  setAccessibilityVisionSummaries,
  startAccessibilitySession,
  stopAccessibilitySession,
} from '../accessibilitySlice';

const sampleStatus: AccessibilityStatus = {
  platform_supported: true,
  permissions: {
    screen_recording: 'granted',
    accessibility: 'granted',
    input_monitoring: 'unknown',
  },
  features: { screen_monitoring: true, device_control: true, predictive_input: true },
  session: {
    active: false,
    started_at_ms: null,
    expires_at_ms: null,
    remaining_ms: null,
    ttl_secs: 300,
    panic_hotkey: 'Cmd+Shift+.',
    stop_reason: null,
    frames_in_memory: 0,
    last_capture_at_ms: null,
    last_context: null,
    vision_enabled: true,
    vision_state: 'idle',
    vision_queue_depth: 0,
    last_vision_at_ms: null,
    last_vision_summary: null,
  },
  config: {
    enabled: true,
    capture_policy: 'hybrid',
    policy_mode: 'all_except_blacklist',
    baseline_fps: 1,
    vision_enabled: true,
    session_ttl_secs: 300,
    panic_stop_hotkey: 'Cmd+Shift+.',
    autocomplete_enabled: true,
    keep_screenshots: false,
    allowlist: [],
    denylist: ['wallet'],
  },
  denylist: ['wallet'],
  is_context_blocked: false,
  permission_check_process_path: '/test/app/src-tauri/binaries/openhuman-core-aarch64-apple-darwin',
};

describe('accessibilitySlice', () => {
  it('has expected initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.status).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it('stores status payload', () => {
    const state = reducer(undefined, setAccessibilityStatus(sampleStatus));
    expect(state.status?.platform_supported).toBe(true);
    expect(state.status?.config.capture_policy).toBe('hybrid');
  });

  it('tracks fetch lifecycle', () => {
    const pending = reducer(undefined, { type: fetchAccessibilityStatus.pending.type });
    expect(pending.isLoading).toBe(true);

    const fulfilled = reducer(
      pending,
      fetchAccessibilityStatus.fulfilled(sampleStatus, 'req-1', undefined)
    );
    expect(fulfilled.isLoading).toBe(false);
    expect(fulfilled.status?.permissions.accessibility).toBe('granted');
  });

  it('stores permission_check_process_path from fetched status', () => {
    const fulfilled = reducer(
      undefined,
      fetchAccessibilityStatus.fulfilled(sampleStatus, 'req-path', undefined)
    );
    expect(fulfilled.status?.permission_check_process_path).toBe(
      '/test/app/src-tauri/binaries/openhuman-core-aarch64-apple-darwin'
    );
  });

  it('stores permission_check_process_path after refreshPermissionsWithRestart', () => {
    const fulfilled = reducer(
      undefined,
      refreshPermissionsWithRestart.fulfilled(sampleStatus, 'req-restart', undefined)
    );
    expect(fulfilled.isRestartingCore).toBe(false);
    expect(fulfilled.status?.permission_check_process_path).toBe(
      '/test/app/src-tauri/binaries/openhuman-core-aarch64-apple-darwin'
    );
  });

  it('tracks session start/stop async flags', () => {
    const starting = reducer(undefined, { type: startAccessibilitySession.pending.type });
    expect(starting.isStartingSession).toBe(true);

    const started = reducer(
      starting,
      startAccessibilitySession.fulfilled(sampleStatus, 'req-2', { consent: true })
    );
    expect(started.isStartingSession).toBe(false);

    const stopping = reducer(started, { type: stopAccessibilitySession.pending.type });
    expect(stopping.isStoppingSession).toBe(true);
  });

  it('clears errors', () => {
    const errored = reducer(undefined, {
      type: fetchAccessibilityStatus.rejected.type,
      payload: 'boom',
    });
    expect(errored.lastError).toBe('boom');

    const cleared = reducer(errored, clearAccessibilityError());
    expect(cleared.lastError).toBeNull();
  });

  it('tracks capture test lifecycle', () => {
    const pending = reducer(undefined, { type: runCaptureTest.pending.type });
    expect(pending.isCaptureTestRunning).toBe(true);
    expect(pending.captureTestResult).toBeNull();

    const testResult: CaptureTestResult = {
      ok: true,
      capture_mode: 'windowed',
      context: {
        app_name: 'Safari',
        window_title: 'GitHub',
        bounds_x: 0,
        bounds_y: 0,
        bounds_width: 1400,
        bounds_height: 900,
      },
      image_ref: 'data:image/png;base64,abc',
      bytes_estimate: 12345,
      error: null,
      timing_ms: 150,
    };

    const fulfilled = reducer(pending, runCaptureTest.fulfilled(testResult, 'req-3', undefined));
    expect(fulfilled.isCaptureTestRunning).toBe(false);
    expect(fulfilled.captureTestResult?.ok).toBe(true);
    expect(fulfilled.captureTestResult?.capture_mode).toBe('windowed');
  });

  it('handles capture test failure', () => {
    const rejected = reducer(undefined, {
      type: runCaptureTest.rejected.type,
      payload: 'capture failed',
    });
    expect(rejected.isCaptureTestRunning).toBe(false);
    expect(rejected.lastError).toBe('capture failed');
  });

  it('tracks requestAccessibilityPermissions lifecycle', () => {
    const pending = reducer(undefined, { type: requestAccessibilityPermissions.pending.type });
    expect(pending.isRequestingPermissions).toBe(true);
    expect(pending.lastError).toBeNull();

    const fulfilled = reducer(
      pending,
      requestAccessibilityPermissions.fulfilled(sampleStatus, 'req', undefined)
    );
    expect(fulfilled.isRequestingPermissions).toBe(false);
    expect(fulfilled.status).toEqual(sampleStatus);

    const rejected = reducer(undefined, {
      type: requestAccessibilityPermissions.rejected.type,
      payload: 'perm failed',
    });
    expect(rejected.isRequestingPermissions).toBe(false);
    expect(rejected.lastError).toBe('perm failed');
  });

  it('tracks requestAccessibilityPermission (single) lifecycle', () => {
    const pending = reducer(undefined, { type: requestAccessibilityPermission.pending.type });
    expect(pending.isRequestingPermissions).toBe(true);

    const fulfilled = reducer(
      pending,
      requestAccessibilityPermission.fulfilled(sampleStatus, 'req', 'accessibility')
    );
    expect(fulfilled.isRequestingPermissions).toBe(false);
    expect(fulfilled.status).toEqual(sampleStatus);

    const rejected = reducer(undefined, {
      type: requestAccessibilityPermission.rejected.type,
      payload: 'single perm failed',
    });
    expect(rejected.lastError).toBe('single perm failed');
  });

  it('tracks stopAccessibilitySession fulfilled and rejected', () => {
    const fulfilled = reducer(
      undefined,
      stopAccessibilitySession.fulfilled(sampleStatus, 'req', undefined)
    );
    expect(fulfilled.isStoppingSession).toBe(false);
    expect(fulfilled.status).toEqual(sampleStatus);

    const rejected = reducer(undefined, {
      type: stopAccessibilitySession.rejected.type,
      payload: 'stop failed',
    });
    expect(rejected.isStoppingSession).toBe(false);
    expect(rejected.lastError).toBe('stop failed');
  });

  it('tracks executeAccessibilityInputAction rejected', () => {
    const rejected = reducer(undefined, {
      type: executeAccessibilityInputAction.rejected.type,
      payload: 'input failed',
    });
    expect(rejected.lastError).toBe('input failed');
  });

  it('tracks fetchAccessibilityVisionRecent lifecycle', () => {
    const pending = reducer(undefined, { type: fetchAccessibilityVisionRecent.pending.type });
    expect(pending.isLoadingVision).toBe(true);

    const summaries = [{ id: 's1' }] as any[];
    const fulfilled = reducer(
      pending,
      fetchAccessibilityVisionRecent.fulfilled(summaries, 'req', undefined)
    );
    expect(fulfilled.isLoadingVision).toBe(false);
    expect(fulfilled.recentVisionSummaries).toEqual(summaries);

    const rejected = reducer(undefined, {
      type: fetchAccessibilityVisionRecent.rejected.type,
      payload: 'vision failed',
    });
    expect(rejected.isLoadingVision).toBe(false);
    expect(rejected.lastError).toBe('vision failed');
  });

  it('tracks flushAccessibilityVision lifecycle', () => {
    const pending = reducer(undefined, { type: flushAccessibilityVision.pending.type });
    expect(pending.isFlushingVision).toBe(true);

    const summary = { id: 'v1', text: 'screen shot' } as any;
    const fulfilled = reducer(
      pending,
      flushAccessibilityVision.fulfilled(summary, 'req', undefined)
    );
    expect(fulfilled.isFlushingVision).toBe(false);
    expect(fulfilled.recentVisionSummaries[0]).toEqual(summary);

    // null summary is a no-op
    const fulfilledNull = reducer(
      pending,
      flushAccessibilityVision.fulfilled(null as any, 'req', undefined)
    );
    expect(fulfilledNull.recentVisionSummaries).toEqual([]);

    const rejected = reducer(undefined, {
      type: flushAccessibilityVision.rejected.type,
      payload: 'flush failed',
    });
    expect(rejected.isFlushingVision).toBe(false);
    expect(rejected.lastError).toBe('flush failed');
  });

  it('setAccessibilitySessionFeatures updates session when status exists', () => {
    const withStatus = reducer(undefined, setAccessibilityStatus(sampleStatus));
    const newSession = { ...sampleStatus.session, active: true };
    const updated = reducer(withStatus, setAccessibilitySessionFeatures(newSession));
    expect(updated.status?.session?.active).toBe(true);
  });

  it('setAccessibilitySessionFeatures is no-op when status is null', () => {
    const state = reducer(undefined, setAccessibilitySessionFeatures({} as any));
    expect(state.status).toBeNull();
  });

  it('setAccessibilityVisionSummaries sets summaries', () => {
    const summaries = [{ id: 's1' }] as any[];
    const state = reducer(undefined, setAccessibilityVisionSummaries(summaries));
    expect(state.recentVisionSummaries).toEqual(summaries);
  });

  it('fetchAccessibilityStatus sets lastError to default when payload undefined', () => {
    const rejected = reducer(undefined, {
      type: fetchAccessibilityStatus.rejected.type,
      payload: undefined,
    });
    expect(rejected.lastError).toBe('Failed to fetch accessibility status');
  });
});
