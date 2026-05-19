import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../test/test-utils';
import ApiKeysStep from '../ApiKeysStep';

vi.mock('../../../../services/coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

vi.mock('../../../../utils/openUrl', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../../../utils/tauriCommands/common', () => ({ isTauri: vi.fn(() => true) }));

vi.mock('../../../../services/api/aiSettingsApi', () => ({
  setCloudProviderKey: vi.fn().mockResolvedValue(undefined),
}));

describe('ApiKeysStep OpenAI OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows connected badge when oauth status reports connected', async () => {
    const { callCoreRpc } = await import('../../../../services/coreRpcClient');
    vi.mocked(callCoreRpc).mockResolvedValueOnce({ result: { connected: true } });

    renderWithProviders(<ApiKeysStep onNext={vi.fn()} onSkip={vi.fn()} />);

    expect(await screen.findByTestId('onboarding-openai-oauth-connected')).toBeInTheDocument();
    expect(screen.getByText('Connected with ChatGPT')).toBeInTheDocument();
  });

  it('starts oauth and accepts pasted callback URL', async () => {
    const { callCoreRpc } = await import('../../../../services/coreRpcClient');
    vi.mocked(callCoreRpc)
      .mockResolvedValueOnce({ result: { connected: false } })
      .mockResolvedValueOnce({
        result: {
          authUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
          state: 'state-1',
          redirectUri: 'http://127.0.0.1:1455/auth/callback',
        },
      })
      .mockResolvedValueOnce({ result: { connected: true } });

    const { openUrl } = await import('../../../../utils/openUrl');

    renderWithProviders(<ApiKeysStep onNext={vi.fn()} onSkip={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('onboarding-openai-oauth-connect'));

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/authorize?client_id=test'
      );
    });

    const input = await screen.findByTestId('onboarding-openai-oauth-callback-input');
    fireEvent.change(input, {
      target: { value: 'http://127.0.0.1:1455/auth/callback?code=abc&state=state-1' },
    });
    fireEvent.click(screen.getByTestId('onboarding-openai-oauth-complete'));

    await waitFor(() => {
      expect(callCoreRpc).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'openhuman.inference_openai_oauth_complete',
          params: { callback_url: 'http://127.0.0.1:1455/auth/callback?code=abc&state=state-1' },
        })
      );
    });

    expect(await screen.findByTestId('onboarding-openai-oauth-connected')).toBeInTheDocument();
  });
});
