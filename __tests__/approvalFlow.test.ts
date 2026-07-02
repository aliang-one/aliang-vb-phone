import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { VibeCodingRun } from '../src/data/platformModels';
import type { ApprovalRequest } from '../src/store/controlCenterStore';
import type { ServerApproval } from '../src/api/approvals';
import { ApiResponseError } from '../src/api/client';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    respondApproval: jest.fn(),
  },
}));

const run = (events: VibeCodingRun['events'] = []): VibeCodingRun => ({
  id: 'session-1',
  title: 'run-session-1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'running',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript: [],
  events,
  structuredEvents: [],
});

const serverApproval = (
  status: ApprovalRequest['status'] = 'pending',
  overrides: Partial<ServerApproval> = {},
): ServerApproval => ({
  id: 'approval-1',
  approval_id: 'approval-1',
  user_id: 'user-1',
  device_id: 'device-1',
  project_id: 'project-1',
  session_id: 'session-1',
  terminal_id: undefined,
  kind: 'dangerous_command',
  title: 'Run migration',
  summary: 'The agent wants to run a migration.',
  command: 'npm run migrate',
  files: [],
  risk: 'high' as const,
  status,
  created_at: '2026-06-16T10:00:00.000Z',
  resolved_at:
    status === 'pending' ? undefined : '2026-06-16T10:01:00.000Z',
  ...overrides,
});

const seed = () => {
  useControlCenterStore.setState({
    serverMode: true,
    approvals: [],
    notifications: [],
    events: [],
    vibeRuns: [run()],
  });
};

describe('approval realtime flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  it('adds approval requests to global approvals and the matching session timeline', () => {
    useControlCenterStore.getState().handleTransportEvent({
      type: 'approval.requested',
      approval: serverApproval(),
      raw: {},
    });

    const state = useControlCenterStore.getState();
    expect(state.approvals).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      type: 'approval.requested',
      approvalId: 'approval-1',
    });
    expect(state.vibeRuns[0]).toMatchObject({
      status: 'waiting_approval',
      currentStep: 'Run migration',
    });
    expect(state.vibeRuns[0].events).toEqual([
      expect.objectContaining({
        id: 'approval-approval-1',
        type: 'approval',
        title: 'Run migration',
        status: 'waiting',
      }),
    ]);
  });

  it('does not duplicate approval events when the matching notification arrives', () => {
    const store = useControlCenterStore.getState();
    store.handleTransportEvent({
      type: 'approval.requested',
      approval: serverApproval(),
      raw: {},
    });
    store.handleTransportEvent({
      type: 'notification.created',
      notification: {
        id: 'notif-1',
        notification_id: 'notif-1',
        user_id: 'user-1',
        type: 'approval',
        title: 'Run migration',
        body: 'The agent wants to run a migration.',
        device_id: 'device-1',
        session_id: 'session-1',
        approval_id: 'approval-1',
        read: false,
        created_at: '2026-06-16T10:00:00.000Z',
      },
      raw: {},
    });

    const state = useControlCenterStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(
      state.events.filter(item => item.type === 'approval.requested'),
    ).toHaveLength(1);
  });

  it('marks related notifications read and resolves the session approval event after response', async () => {
    useControlCenterStore.setState({
      approvals: [
        {
          id: 'approval-1',
          kind: 'dangerous_command',
          title: 'Run migration',
          summary: 'The agent wants to run a migration.',
          deviceId: 'device-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          risk: 'high',
          status: 'pending',
          createdAt: '2026-06-16T10:00:00.000Z',
        },
      ],
      notifications: [
        {
          id: 'notif-1',
          type: 'approval',
          title: 'Run migration',
          body: 'The agent wants to run a migration.',
          deviceId: 'device-1',
          sessionId: 'session-1',
          approvalId: 'approval-1',
          read: false,
          createdAt: '2026-06-16T10:00:00.000Z',
        },
      ],
      vibeRuns: [
        run([
          {
            id: 'approval-approval-1',
            type: 'approval',
            title: 'Run migration',
            detail: 'The agent wants to run a migration.',
            status: 'waiting',
            timestamp: '2026-06-16T10:00:00.000Z',
          },
        ]),
      ],
    });
    (platformTransport.respondApproval as jest.Mock).mockResolvedValue(
      serverApproval('approved'),
    );

    await useControlCenterStore
      .getState()
      .resolveApproval('approval-1', 'approved');

    const state = useControlCenterStore.getState();
    expect(state.approvals[0].status).toBe('approved');
    expect(state.notifications[0].read).toBe(true);
    expect(state.vibeRuns[0].events).toEqual([
      expect.objectContaining({
        id: 'approval-approval-1',
        title: 'Approval granted',
        status: 'done',
      }),
    ]);
  });

  it('passes option choices through when resolving assistant response approvals', async () => {
    const options: NonNullable<ApprovalRequest['options']> = [
      {
        id: 'pod-detail',
        label: 'Fix PodDetail',
        description: 'Wire the missing detail-page actions.',
        response: 'Fix PodDetail: Wire the missing detail-page actions.',
      },
      {
        id: 'namespace-mgmt',
        label: 'Namespace management',
        response: 'Namespace management',
      },
    ];
    useControlCenterStore.setState({
      approvals: [
        {
          id: 'approval-1',
          kind: 'client_response',
          title: 'Which work should I do next?',
          summary: 'The assistant is waiting for a plan choice.',
          deviceId: 'device-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          options,
          risk: 'low',
          status: 'pending',
          createdAt: '2026-06-16T10:00:00.000Z',
        },
      ],
      vibeRuns: [run()],
    });
    (platformTransport.respondApproval as jest.Mock).mockResolvedValue(
      serverApproval('approved', {
        kind: 'client_response',
        command: undefined,
        options,
      }),
    );

    await useControlCenterStore.getState().resolveApproval('approval-1', 'approved', {
      selectedOptionId: 'pod-detail',
      message: 'Fix PodDetail: Wire the missing detail-page actions.',
    });

    expect(platformTransport.respondApproval).toHaveBeenCalledWith(
      'approval-1',
      'approved',
      {
        selectedOptionId: 'pod-detail',
        message: 'Fix PodDetail: Wire the missing detail-page actions.',
      },
    );
    expect(useControlCenterStore.getState().approvals[0]).toMatchObject({
      kind: 'client_response',
      status: 'approved',
      options,
    });
  });

  it('updates local approval state when another client resolves it', () => {
    useControlCenterStore.setState({
      approvals: [
        {
          id: 'approval-1',
          kind: 'dangerous_command',
          title: 'Run migration',
          summary: 'The agent wants to run a migration.',
          deviceId: 'device-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          risk: 'high',
          status: 'pending',
          createdAt: '2026-06-16T10:00:00.000Z',
        },
      ],
      vibeRuns: [
        {
          ...run(),
          status: 'waiting_approval',
          events: [
            {
              id: 'approval-approval-1',
              type: 'approval',
              title: 'Run migration',
              detail: 'The agent wants to run a migration.',
              status: 'waiting',
              timestamp: '2026-06-16T10:00:00.000Z',
            },
          ],
        },
      ],
    });

    useControlCenterStore.getState().handleTransportEvent({
      type: 'notification.created',
      notification: {
        id: 'notif-result-1',
        notification_id: 'notif-result-1',
        user_id: 'user-1',
        type: 'completed',
        title: 'Approval granted',
        body: 'Run migration',
        device_id: 'device-1',
        session_id: 'session-1',
        approval_id: 'approval-1',
        read: false,
        created_at: '2026-06-16T10:01:00.000Z',
      },
      raw: {},
    });

    const state = useControlCenterStore.getState();
    expect(state.approvals[0]).toMatchObject({
      status: 'approved',
      resolvedAt: '2026-06-16T10:01:00.000Z',
    });
    expect(state.vibeRuns[0]).toMatchObject({
      status: 'running',
      currentStep: 'Approval granted. Waiting for agent to continue.',
    });
    expect(
      state.events.filter(item => item.approvalId === 'approval-1'),
    ).toHaveLength(0);
  });

  const seedPendingApproval = () =>
    useControlCenterStore.setState({
      serverMode: true,
      approvals: [
        {
          id: 'approval-1',
          kind: 'dangerous_command',
          title: 'Run migration',
          summary: '',
          deviceId: 'device-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          risk: 'high',
          status: 'pending',
          createdAt: '2026-06-16T10:00:00.000Z',
        },
      ],
      notifications: [],
      events: [],
      vibeRuns: [run()],
    });

  it('drops the pending approval when the server is unreachable (network error)', async () => {
    seedPendingApproval();
    (platformTransport.respondApproval as jest.Mock).mockRejectedValue(
      new Error('Network request failed'),
    );
    await expect(
      useControlCenterStore.getState().resolveApproval('approval-1', 'approved'),
    ).rejects.toThrow('Network');
    expect(useControlCenterStore.getState().approvals).toHaveLength(0);
  });

  it('drops the pending approval on 404 (gone server-side)', async () => {
    seedPendingApproval();
    (platformTransport.respondApproval as jest.Mock).mockRejectedValue(
      new ApiResponseError('not found', 404, 'not_found'),
    );
    await expect(
      useControlCenterStore.getState().resolveApproval('approval-1', 'approved'),
    ).rejects.toThrow();
    expect(useControlCenterStore.getState().approvals).toHaveLength(0);
  });

  it('drops the pending approval on 409 (already resolved server-side)', async () => {
    seedPendingApproval();
    (platformTransport.respondApproval as jest.Mock).mockRejectedValue(
      new ApiResponseError('already resolved', 409, 'already_resolved'),
    );
    await expect(
      useControlCenterStore.getState().resolveApproval('approval-1', 'approved'),
    ).rejects.toThrow();
    expect(useControlCenterStore.getState().approvals).toHaveLength(0);
  });

  it('KEEPS the pending approval on a retryable 5xx (server up but errored)', async () => {
    seedPendingApproval();
    (platformTransport.respondApproval as jest.Mock).mockRejectedValue(
      new ApiResponseError('internal error', 500, 'internal_error'),
    );
    await expect(
      useControlCenterStore.getState().resolveApproval('approval-1', 'approved'),
    ).rejects.toThrow();
    const kept = useControlCenterStore.getState().approvals;
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe('pending');
  });
});
