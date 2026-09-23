import { platformDeviceToClient } from '../src/store/internals';
import type { PlatformDeviceSnapshot } from '../src/services/platformTransport';

// Minimal valid snapshot; only the fields the mapper reads are populated.
const snapshot = (
  overrides: Partial<PlatformDeviceSnapshot> = {},
): PlatformDeviceSnapshot =>
  ({
    id: 'dev-1',
    deviceId: 'dev-1',
    userId: 'user-1',
    name: 'MacBook',
    platform: 'darwin',
    status: 'online',
    capabilities: ['http_tunnel_v1', 'websocket_tunnel_v1'],
    tools: [],
    history: [],
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    activePorts: [],
    authorizedDirectories: [],
    projectIds: [],
    raw: {} as PlatformDeviceSnapshot['raw'],
    ...overrides,
  }) as PlatformDeviceSnapshot;

describe('platformDeviceToClient tool effort-capability passthrough', () => {
  it('passes tool version + efforts through to the client Device', () => {
    const device = platformDeviceToClient(
      snapshot({
        tools: [
          {
            id: 'claude',
            available: true,
            version: '2.1.156',
            efforts: ['low', 'medium', 'high'],
          },
        ],
      }),
    );
    expect(device.tools[0].version).toBe('2.1.156');
    expect(device.tools[0].efforts).toEqual(['low', 'medium', 'high']);
  });

  it('leaves version/efforts undefined when the tool omits them', () => {
    const device = platformDeviceToClient(
      snapshot({ tools: [{ id: 'codex', available: true }] }),
    );
    expect(device.tools[0].version).toBeUndefined();
    expect(device.tools[0].efforts).toBeUndefined();
  });
});

describe('platformDeviceToClient tunnel gating fields', () => {
  it('passes tunnelAvailable=true through to the client Device', () => {
    const device = platformDeviceToClient(snapshot({ tunnelAvailable: true }));
    expect(device.tunnelAvailable).toBe(true);
  });

  it('passes tunnelAvailable=false through (not undefined)', () => {
    const device = platformDeviceToClient(snapshot({ tunnelAvailable: false }));
    expect(device.tunnelAvailable).toBe(false);
  });

  it('leaves tunnelAvailable undefined when the snapshot omits it', () => {
    const device = platformDeviceToClient(snapshot());
    expect(device.tunnelAvailable).toBeUndefined();
  });

  it('still copies capabilities (regression guard)', () => {
    const device = platformDeviceToClient(snapshot());
    expect(device.capabilities).toEqual(['http_tunnel_v1', 'websocket_tunnel_v1']);
  });
});
