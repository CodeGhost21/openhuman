import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/coreRpcClient', () => ({
  callCoreRpc: vi.fn(),
}));

import { callCoreRpc } from '../../../services/coreRpcClient';
import {
  disableSkill,
  fetchRegistryFresh,
  getAllSnapshots,
  getSkillSnapshot,
  installSkill,
  listAvailable,
  listInstalled,
  removePersistedAuthCredential,
  removePersistedClientKey,
  removePersistedOAuthCredential,
  revokeAuth,
  revokeOAuth,
  searchSkills,
  setSetupComplete,
  startSkill,
  stopSkill,
  uninstallSkill,
} from '../skillsApi';

const mockRpc = vi.mocked(callCoreRpc);

describe('skillsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSkillSnapshot calls skills_status with skill_id', async () => {
    const snap = { skill_id: 'gmail', name: 'Gmail', status: 'running' };
    mockRpc.mockResolvedValue(snap);
    const result = await getSkillSnapshot('gmail');
    expect(result).toEqual(snap);
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_status',
      params: { skill_id: 'gmail' },
    });
  });

  it('getAllSnapshots calls skills_get_all_snapshots', async () => {
    mockRpc.mockResolvedValue([]);
    const result = await getAllSnapshots();
    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith({ method: 'openhuman.skills_get_all_snapshots' });
  });

  it('listAvailable calls skills_list_available', async () => {
    mockRpc.mockResolvedValue([]);
    await listAvailable();
    expect(mockRpc).toHaveBeenCalledWith({ method: 'openhuman.skills_list_available' });
  });

  it('listInstalled calls skills_list_installed', async () => {
    mockRpc.mockResolvedValue([]);
    await listInstalled();
    expect(mockRpc).toHaveBeenCalledWith({ method: 'openhuman.skills_list_installed' });
  });

  it('searchSkills calls skills_search with query and optional category', async () => {
    mockRpc.mockResolvedValue([]);
    await searchSkills('gmail', 'productivity');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_search',
      params: { query: 'gmail', category: 'productivity' },
    });
  });

  it('searchSkills works without category', async () => {
    mockRpc.mockResolvedValue([]);
    await searchSkills('notion');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_search',
      params: { query: 'notion', category: undefined },
    });
  });

  it('startSkill calls skills_start with skill_id', async () => {
    const snap = { skill_id: 'gmail' };
    mockRpc.mockResolvedValue(snap);
    const result = await startSkill('gmail');
    expect(result).toEqual(snap);
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_start',
      params: { skill_id: 'gmail' },
    });
  });

  it('stopSkill calls skills_stop', async () => {
    mockRpc.mockResolvedValue(undefined);
    await stopSkill('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_stop',
      params: { skill_id: 'gmail' },
    });
  });

  it('installSkill calls skills_install', async () => {
    mockRpc.mockResolvedValue(undefined);
    await installSkill('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_install',
      params: { skill_id: 'gmail' },
    });
  });

  it('uninstallSkill calls skills_uninstall', async () => {
    mockRpc.mockResolvedValue(undefined);
    await uninstallSkill('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_uninstall',
      params: { skill_id: 'gmail' },
    });
  });

  it('setSetupComplete calls skills_set_setup_complete', async () => {
    mockRpc.mockResolvedValue(undefined);
    await setSetupComplete('gmail', true);
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_set_setup_complete',
      params: { skill_id: 'gmail', complete: true },
    });
  });

  it('revokeOAuth calls skills_rpc with oauth/revoked method', async () => {
    mockRpc.mockResolvedValue(undefined);
    await revokeOAuth('gmail', 'user@example.com');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_rpc',
      params: {
        skill_id: 'gmail',
        method: 'oauth/revoked',
        params: { integrationId: 'user@example.com' },
      },
    });
  });

  it('removePersistedOAuthCredential writes empty oauth_credential.json', async () => {
    mockRpc.mockResolvedValue(undefined);
    await removePersistedOAuthCredential('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_data_write',
      params: { skill_id: 'gmail', filename: 'oauth_credential.json', content: '' },
    });
  });

  it('revokeAuth calls skills_rpc with auth/revoked method', async () => {
    mockRpc.mockResolvedValue(undefined);
    await revokeAuth('gmail', 'api_key');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_rpc',
      params: { skill_id: 'gmail', method: 'auth/revoked', params: { mode: 'api_key' } },
    });
  });

  it('revokeAuth uses unknown when mode is not provided', async () => {
    mockRpc.mockResolvedValue(undefined);
    await revokeAuth('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_rpc',
      params: { skill_id: 'gmail', method: 'auth/revoked', params: { mode: 'unknown' } },
    });
  });

  it('removePersistedAuthCredential writes empty auth_credential.json', async () => {
    mockRpc.mockResolvedValue(undefined);
    await removePersistedAuthCredential('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_data_write',
      params: { skill_id: 'gmail', filename: 'auth_credential.json', content: '' },
    });
  });

  it('removePersistedClientKey writes empty client_key.json', async () => {
    mockRpc.mockResolvedValue(undefined);
    await removePersistedClientKey('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_data_write',
      params: { skill_id: 'gmail', filename: 'client_key.json', content: '' },
    });
  });

  it('disableSkill calls skills_disable', async () => {
    mockRpc.mockResolvedValue(undefined);
    await disableSkill('gmail');
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_disable',
      params: { skill_id: 'gmail' },
    });
  });

  it('fetchRegistryFresh calls skills_registry_fetch with force true', async () => {
    mockRpc.mockResolvedValue(undefined);
    await fetchRegistryFresh();
    expect(mockRpc).toHaveBeenCalledWith({
      method: 'openhuman.skills_registry_fetch',
      params: { force: true },
    });
  });
});
