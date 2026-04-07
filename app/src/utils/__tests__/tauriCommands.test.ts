import { invoke, isTauri } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, type Mock, test, vi } from 'vitest';

import { callCoreRpc } from '../../services/coreRpcClient';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('../../services/coreRpcClient', () => ({ callCoreRpc: vi.fn() }));

const mockWindow = {
  show: vi.fn(),
  hide: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  unminimize: vi.fn(),
  setFocus: vi.fn(),
  isVisible: vi.fn().mockResolvedValue(true),
  setTitle: vi.fn(),
};

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => mockWindow }));

describe('tauriCommands', () => {
  const mockIsTauri = isTauri as Mock;
  const mockInvoke = invoke as Mock;
  const mockCallCoreRpc = callCoreRpc as Mock;
  let getAuthState: typeof import('../tauriCommands').getAuthState;
  let resetOpenHumanDataAndRestartCore: typeof import('../tauriCommands').resetOpenHumanDataAndRestartCore;
  let storeSession: typeof import('../tauriCommands').storeSession;
  let openhumanLocalAiStatus: typeof import('../tauriCommands').openhumanLocalAiStatus;
  let openhumanServiceStatus: typeof import('../tauriCommands').openhumanServiceStatus;
  let exchangeToken: typeof import('../tauriCommands').exchangeToken;
  let getSessionToken: typeof import('../tauriCommands').getSessionToken;
  let logout: typeof import('../tauriCommands').logout;
  let showWindow: typeof import('../tauriCommands').showWindow;
  let hideWindow: typeof import('../tauriCommands').hideWindow;
  let minimizeWindow: typeof import('../tauriCommands').minimizeWindow;
  let maximizeWindow: typeof import('../tauriCommands').maximizeWindow;
  let closeWindow: typeof import('../tauriCommands').closeWindow;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    const actual = await vi.importActual<typeof import('../tauriCommands')>('../tauriCommands');
    getAuthState = actual.getAuthState;
    resetOpenHumanDataAndRestartCore = actual.resetOpenHumanDataAndRestartCore;
    storeSession = actual.storeSession;
    openhumanLocalAiStatus = actual.openhumanLocalAiStatus;
    openhumanServiceStatus = actual.openhumanServiceStatus;
    exchangeToken = actual.exchangeToken;
    getSessionToken = actual.getSessionToken;
    logout = actual.logout;
    showWindow = actual.showWindow;
    hideWindow = actual.hideWindow;
    minimizeWindow = actual.minimizeWindow;
    maximizeWindow = actual.maximizeWindow;
    closeWindow = actual.closeWindow;
  });

  test('exchangeToken invokes Tauri command', async () => {
    mockInvoke.mockResolvedValueOnce({ sessionToken: 's1', user: {} });
    const res = await exchangeToken('http://b', 't1');
    expect(mockInvoke).toHaveBeenCalledWith('exchange_token', {
      backendUrl: 'http://b',
      token: 't1',
    });
    expect(res.sessionToken).toBe('s1');
  });

  test('getSessionToken calls RPC', async () => {
    mockCallCoreRpc.mockResolvedValueOnce({ result: { token: 't1' } });
    const res = await getSessionToken();
    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.auth.get_session_token' });
    expect(res).toBe('t1');
  });

  test('logout calls RPC', async () => {
    await logout();
    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.auth.clear_session' });
  });

  test('window commands call Tauri window APIs', async () => {
    await showWindow();
    expect(mockWindow.show).toHaveBeenCalled();

    await hideWindow();
    expect(mockWindow.hide).toHaveBeenCalled();

    await minimizeWindow();
    expect(mockWindow.minimize).toHaveBeenCalled();

    await maximizeWindow();
    expect(mockWindow.toggleMaximize).toHaveBeenCalled();

    await closeWindow();
    expect(mockWindow.close).toHaveBeenCalled();
  });

  test('getAuthState maps result shape from core response', async () => {
    mockCallCoreRpc.mockResolvedValueOnce({
      result: { isAuthenticated: true, user: { id: 'u1' } },
    });

    const response = await getAuthState();

    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.auth.get_state' });
    expect(response).toEqual({ is_authenticated: true, user: { id: 'u1' } });
  });

  test('storeSession calls expected RPC method and params', async () => {
    await storeSession('jwt-token', { id: 'u1' });

    expect(mockCallCoreRpc).toHaveBeenCalledWith({
      method: 'openhuman.auth.store_session',
      params: { token: 'jwt-token', user: { id: 'u1' } },
    });
  });

  test('resetOpenHumanDataAndRestartCore invokes the destructive Tauri command', async () => {
    await resetOpenHumanDataAndRestartCore();

    expect(mockCallCoreRpc).toHaveBeenCalledWith({ method: 'openhuman.config_reset_local_data' });
    expect(mockInvoke).toHaveBeenCalledWith('restart_core_process');
  });

  test('openhumanLocalAiStatus returns upgrade hint on unknown method', async () => {
    mockCallCoreRpc.mockRejectedValueOnce(new Error('unknown method: openhuman.local_ai_status'));

    await expect(openhumanLocalAiStatus()).rejects.toThrow(
      'Local model runtime is unavailable in this core build. Restart app after updating to the latest build.'
    );
  });

  test('openhumanServiceStatus throws when not running in Tauri', async () => {
    mockIsTauri.mockReturnValue(false);

    await expect(openhumanServiceStatus()).rejects.toThrow('Not running in Tauri');
    expect(mockCallCoreRpc).not.toHaveBeenCalled();
  });
});
