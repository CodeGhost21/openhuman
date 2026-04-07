import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsTauri = vi.fn();
const mockTauriOpenUrl = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: (...args: unknown[]) => mockIsTauri(...args),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => mockTauriOpenUrl(...args),
}));

const { openUrl } = await import('../openUrl');

describe('openUrl', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockIsTauri.mockReset();
    mockTauriOpenUrl.mockReset();
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('uses Tauri openUrl when running in Tauri', async () => {
    mockIsTauri.mockReturnValue(true);
    mockTauriOpenUrl.mockResolvedValue(undefined);

    await openUrl('https://example.com');

    expect(mockTauriOpenUrl).toHaveBeenCalledWith('https://example.com');
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('falls back to window.open when Tauri openUrl throws', async () => {
    mockIsTauri.mockReturnValue(true);
    mockTauriOpenUrl.mockRejectedValue(new Error('Tauri error'));

    await openUrl('https://example.com');

    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('uses window.open directly in browser (non-Tauri) environment', async () => {
    mockIsTauri.mockReturnValue(false);

    await openUrl('https://example.com');

    expect(mockTauriOpenUrl).not.toHaveBeenCalled();
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
