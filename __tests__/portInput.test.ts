import {
  isAllowedTargetHost,
  parsePort,
  resolveTunnelBlocker,
} from '../src/utils/portInput';
import type { Device } from '../src/data/platformModels';

describe('isAllowedTargetHost', () => {
  it('accepts localhost and ::1', () => {
    expect(isAllowedTargetHost('localhost')).toBe(true);
    expect(isAllowedTargetHost('::1')).toBe(true);
  });

  it('accepts loopback and private ranges', () => {
    expect(isAllowedTargetHost('127.0.0.1')).toBe(true);
    expect(isAllowedTargetHost('10.0.0.5')).toBe(true);
    expect(isAllowedTargetHost('10.255.255.255')).toBe(true);
    expect(isAllowedTargetHost('172.16.0.1')).toBe(true);
    expect(isAllowedTargetHost('172.31.255.254')).toBe(true);
    expect(isAllowedTargetHost('192.168.1.10')).toBe(true);
    expect(isAllowedTargetHost('192.168.0.1')).toBe(true);
  });

  it('rejects public IPs', () => {
    expect(isAllowedTargetHost('8.8.8.8')).toBe(false);
    expect(isAllowedTargetHost('172.32.0.1')).toBe(false);
    expect(isAllowedTargetHost('172.15.0.1')).toBe(false);
    expect(isAllowedTargetHost('11.0.0.1')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isAllowedTargetHost('1.2.3')).toBe(false);
    expect(isAllowedTargetHost('1.2.3.4.5')).toBe(false);
    expect(isAllowedTargetHost('256.1.1.1')).toBe(false);
    expect(isAllowedTargetHost('1.2.3.a')).toBe(false);
    expect(isAllowedTargetHost('')).toBe(false);
  });

  it('trims and lowercases before checking', () => {
    expect(isAllowedTargetHost('  LOCALHOST  ')).toBe(true);
    expect(isAllowedTargetHost(' 192.168.1.2 ')).toBe(true);
  });
});

describe('parsePort', () => {
  it('accepts boundary ports', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
    expect(parsePort('3000')).toBe(3000);
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(parsePort('0')).toBeNull();
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('abc')).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('12a')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parsePort(' 8080 ')).toBe(8080);
  });
});

// Minimal Device factory — only the fields resolveTunnelBlocker reads
// (status / capabilities / tunnelAvailable) vary; the rest satisfies the type.
function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'device-1',
    name: 'MacBook',
    status: 'online',
    location: 'Desk',
    os: 'darwin',
    host: 'localhost',
    cpuLoad: 0,
    memLoad: 0,
    authorizedDirectories: ['~/repo'],
    activePorts: [],
    projectIds: [],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['http_tunnel_v1', 'websocket_tunnel_v1'],
    tunnelAvailable: true,
    tools: [],
    history: [],
    ...overrides,
  };
}

describe('resolveTunnelBlocker', () => {
  it('returns offline for a missing device', () => {
    expect(resolveTunnelBlocker(undefined)).toBe('offline');
  });

  it('returns offline for an offline device', () => {
    expect(resolveTunnelBlocker(device({ status: 'offline' }))).toBe('offline');
  });

  it('returns unsupported when tunnel capabilities are missing', () => {
    expect(
      resolveTunnelBlocker(device({ capabilities: ['terminal'] })),
    ).toBe('unsupported');
  });

  it('returns tunnel when caps are present but the server tunnel is unconfigured', () => {
    expect(resolveTunnelBlocker(device({ tunnelAvailable: false }))).toBe(
      'tunnel',
    );
  });

  it('returns null when online + both caps + tunnel configured', () => {
    expect(resolveTunnelBlocker(device())).toBeNull();
  });

  it('offline outranks missing caps (specificity order)', () => {
    expect(
      resolveTunnelBlocker(
        device({ status: 'offline', capabilities: [], tunnelAvailable: false }),
      ),
    ).toBe('offline');
  });
});
