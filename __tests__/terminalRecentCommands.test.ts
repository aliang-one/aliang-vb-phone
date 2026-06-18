import { stateFromSnapshot } from '../src/store/internals';

type Snapshot = Parameters<typeof stateFromSnapshot>[0];

const baseDevice = {
  id: 'device-1', name: 'Mac', status: 'online', platform: 'darwin',
  user_identity: 'u', unique_code: 'c', agent_version: '1', last_seen_at: 'now',
  remote_terminal_enabled: true, ai_control_enabled: true, authorized_directories: [],
  project_ids: [], active_ports: [], capabilities: [], tools: [], history: [], load: null,
  paired_at: 'now', bound_at: 'now', created_at: 'now', agent_started_at: 'now',
  host: 'h', location: 'l', cpu_load: 0, mem_load: 0, battery: null,
};

const mkSnapshot = (sessions: any[]): Snapshot =>
  ({
    devices: [{ ...baseDevice, deviceId: 'device-1', device_id: 'device-1', user_id: 'u' } as any],
    projects: [],
    aiSessions: [],
    terminalSessions: sessions,
    approvals: [],
    notifications: [],
    previewLinks: [],
    realtimeEvents: [],
    loadedAt: 'now',
    warnings: [],
  } as any);

describe('stateFromSnapshot seeds terminalCommandHistory from recent_commands', () => {
  it('maps recent_commands into terminalCommandHistory[session:<id>]', () => {
    const snap = mkSnapshot([
      {
        session_id: 'term-1', kind: 'terminal', user_id: 'u', device_id: 'device-1',
        status: 'active', cwd: '/p', shell: 'bash', cols: 80, rows: 24,
        created_at: 't0', last_active_at: 't1',
        recent_commands: [
          { id: 'c1', command: 'ls', timestamp: 'ts1', created_at: '2024-01-01T00:00:01Z', exit_code: null },
          { id: 'c2', command: 'pwd', timestamp: 'ts2', created_at: '2024-01-01T00:00:02Z', exit_code: null },
        ],
      },
    ]);
    const next = stateFromSnapshot(snap, [], []);
    const slot = next.terminalCommandHistory['session:term-1'];
    expect(slot).toHaveLength(2);
    expect(slot[0]).toMatchObject({ id: 'c2', command: 'pwd', terminalSessionId: 'term-1', deviceId: 'device-1' });
    expect(slot[1]).toMatchObject({ id: 'c1', command: 'ls' });
  });

  it('merges with previous history without dropping other keys (non-destructive)', () => {
    const snap = mkSnapshot([
      {
        session_id: 'term-1', kind: 'terminal', user_id: 'u', device_id: 'device-1',
        status: 'active', cols: 80, rows: 24, created_at: 't0', last_active_at: 't1',
        recent_commands: [{ id: 'c1', command: 'ls', timestamp: 'ts1', created_at: '2024-01-01T00:00:01Z' }],
      },
    ]);
    const prev = {
      'session:term-1': [{ id: 'cold', terminalSessionId: 'term-1', deviceId: 'device-1', command: 'old', timestamp: 'ts0', createdAt: '2024-01-01T00:00:00Z' }],
      'device:device-1': [{ id: 'd1', terminalSessionId: 'term-1', deviceId: 'device-1', command: 'git status', timestamp: 'ts', createdAt: '2024-01-01T00:00:00Z' }],
    };
    const next = stateFromSnapshot(snap, [], [], prev);
    expect(next.terminalCommandHistory['session:term-1'].map(i => i.id)).toEqual(['c1', 'cold']);
    expect(next.terminalCommandHistory['device:device-1']).toEqual(prev['device:device-1']); // untouched
  });

  it('omits empty-command entries', () => {
    const snap = mkSnapshot([
      {
        session_id: 'term-1', kind: 'terminal', user_id: 'u', device_id: 'device-1',
        status: 'active', cols: 80, rows: 24, created_at: 't0', last_active_at: 't1',
        recent_commands: [{ id: 'c1', command: '   ', timestamp: 'ts1', created_at: '2024-01-01T00:00:01Z' }],
      },
    ]);
    const next = stateFromSnapshot(snap, [], []);
    expect(next.terminalCommandHistory['session:term-1']).toEqual([]);
  });

  it('preserves a prior session slot when the snapshot has no recent_commands for it', () => {
    const snap = mkSnapshot([
      {
        session_id: 'term-1', kind: 'terminal', user_id: 'u', device_id: 'device-1',
        status: 'active', cols: 80, rows: 24, created_at: 't0', last_active_at: 't1',
      },
    ]);
    const prev = {
      'session:term-1': [
        { id: 'cold', terminalSessionId: 'term-1', deviceId: 'device-1', command: 'old', timestamp: 'ts0', createdAt: '2024-01-01T00:00:00Z' },
      ],
    };
    const next = stateFromSnapshot(snap, [], [], prev);
    expect(next.terminalCommandHistory['session:term-1'].map(i => i.id)).toEqual(['cold']);
  });
});
