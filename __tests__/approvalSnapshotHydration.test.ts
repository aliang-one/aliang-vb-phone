import { stateFromSnapshot } from '../src/store/internals';

type Snapshot = Parameters<typeof stateFromSnapshot>[0];

const device = {
  id: 'device-1',
  deviceId: 'device-1',
  user_id: 'user-1',
  device_id: 'device-1',
  name: 'Mac',
  status: 'online',
  platform: 'darwin',
  unique_code: 'code',
  agent_version: '1',
  capabilities: [],
  tools: [],
  history: [],
  remote_terminal_enabled: true,
  ai_control_enabled: true,
  authorized_directories: [],
  project_ids: [],
  active_ports: [],
  last_seen_at: '2026-06-20T10:00:00.000Z',
  paired_at: '2026-06-20T10:00:00.000Z',
  bound_at: '2026-06-20T10:00:00.000Z',
  created_at: '2026-06-20T10:00:00.000Z',
  agent_started_at: '2026-06-20T10:00:00.000Z',
  host: 'localhost',
  location: 'desk',
  cpu_load: 0,
  mem_load: 0,
  battery: null,
};

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot =>
  ({
    devices: [device],
    projects: [],
    aiSessions: [],
    terminalSessions: [],
    approvals: [],
    notifications: [],
    previewLinks: [],
    realtimeEvents: [],
    loadedAt: '2026-06-20T10:00:00.000Z',
    warnings: [],
    ...overrides,
  } as Snapshot);

describe('approval snapshot hydration', () => {
  it('recovers approvals from approval.requested realtime events', () => {
    const next = stateFromSnapshot(
      snapshot({
        realtimeEvents: [
          {
            id: 'evt-approval-1',
            origin_instance_id: 'server',
            created_at: '2026-06-20T10:00:00.000Z',
            user_id: 'user-1',
            device_id: 'device-1',
            session_id: 'session-1',
            message_type: 'approval.requested',
            direction: 'server_to_mobile',
            source: { kind: 'server' },
            target: { kind: 'mobile' },
            payload: {
              approval: {
                id: 'approval-1',
                approval_id: 'approval-1',
                user_id: 'user-1',
                device_id: 'device-1',
                session_id: 'session-1',
                kind: 'client_response',
                title: 'Choose next step',
                summary: 'The assistant is waiting for a choice.',
                options: [
                  {
                    id: 'fix',
                    label: 'Fix bug',
                    response: 'Fix bug',
                  },
                ],
                risk: 'low',
                status: 'pending',
                created_at: '2026-06-20T10:00:00.000Z',
              },
            },
          },
        ],
      }),
      [],
      [],
    );

    expect(next.approvals).toHaveLength(1);
    expect(next.approvals[0]).toMatchObject({
      id: 'approval-1',
      sessionId: 'session-1',
      title: 'Choose next step',
      options: [{ id: 'fix', label: 'Fix bug', response: 'Fix bug' }],
    });
    expect(next.events[0]).toMatchObject({
      type: 'approval.requested',
      approvalId: 'approval-1',
      sessionId: 'session-1',
    });
  });
});
