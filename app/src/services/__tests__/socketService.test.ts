import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCoreStateSnapshot } from '../../lib/coreState/store';
import { socketService } from '../socketService';

// Mock socket.io-client
const mockSocket = {
  connected: false,
  id: 'mock-socket-id',
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  onAny: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: vi.fn(() => mockSocket) }));

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue('http://localhost:5005/rpc'),
}));

// Mock skill manager and sync tools
vi.mock('../../lib/skills', () => ({
  skillManager: { resyncRunningSkillsAfterReconnect: vi.fn().mockResolvedValue(undefined) },
  syncToolsToBackend: vi.fn(),
}));

describe('socketService', () => {
  const testUserId = 'user-123';
  // Simple JWT payload: {"userId": "user-123"}
  const testToken = `header.${btoa(JSON.stringify({ userId: testUserId }))}.signature`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockSocket.id = 'mock-socket-id';

    setCoreStateSnapshot({
      isBootstrapping: false,
      isReady: true,
      snapshot: {
        auth: { isAuthenticated: true, userId: testUserId, user: null, profileId: null },
        sessionToken: testToken,
        currentUser: null,
        onboardingCompleted: true,
        analyticsEnabled: false,
        localState: { encryptionKey: null, primaryWalletAddress: null, onboardingTasks: null },
      },
      teams: [],
      teamMembersById: {},
      teamInvitesById: {},
    });
  });

  afterEach(() => {
    socketService.disconnect();
  });

  it('should connect to the socket server', async () => {
    socketService.connect(testToken);

    // It runs connectAsync which is async, but we can check if it initiated.
    // We might need to wait a bit or use a promise.
    // Since connect() returns void, we can check if io was called.

    // Let's use a small wait to allow async connectAsync to run
    await new Promise(resolve => setTimeout(resolve, 0));

    const { io } = await import('socket.io-client');
    expect(io).toHaveBeenCalled();
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('should handle successful connection', async () => {
    socketService.connect(testToken);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Find the 'connect' callback and call it
    const connectCallback = mockSocket.on.mock.calls.find(call => call[0] === 'connect')[1];
    connectCallback();

    expect(socketService.isConnected()).toBe(false); // mockSocket.connected is still false
    mockSocket.connected = true;
    expect(socketService.isConnected()).toBe(true);
  });

  it('should disconnect from the socket server', async () => {
    socketService.connect(testToken);
    await new Promise(resolve => setTimeout(resolve, 0));

    socketService.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(socketService.getSocket()).toBeNull();
  });

  it('should emit events when connected', async () => {
    socketService.connect(testToken);
    await new Promise(resolve => setTimeout(resolve, 0));

    mockSocket.connected = true;
    socketService.emit('test-event', { data: 'foo' });
    expect(mockSocket.emit).toHaveBeenCalledWith('test-event', { data: 'foo' });
  });

  it('should NOT emit events when NOT connected', async () => {
    socketService.connect(testToken);
    await new Promise(resolve => setTimeout(resolve, 0));

    mockSocket.connected = false;
    socketService.emit('test-event', { data: 'foo' });
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('should register listeners', async () => {
    socketService.connect(testToken);
    await new Promise(resolve => setTimeout(resolve, 0));

    const callback = vi.fn();
    socketService.on('test-event', callback);
    expect(mockSocket.on).toHaveBeenCalledWith('test-event', expect.any(Function));
  });
});
