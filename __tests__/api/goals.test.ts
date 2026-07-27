import { apiGet, apiPost } from '../../src/api/client';
import {
  abandonGoal,
  approveGoalPlan,
  createGoal,
  deleteGoal,
  fetchGoalEvents,
  fetchGoals,
  fetchGoalSnapshot,
  goalSnapshotToSummary,
  queueGoalMessage,
  pauseGoal,
  recoverGoal,
  resumeGoal,
} from '../../src/api/goals';
import { serverAiMessageToAgent } from '../../src/api/sessions';

jest.mock('../../src/api/client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

const mockedGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;

describe('Goal API', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPost.mockReset();
  });

  it('loads one encoded Goal snapshot', async () => {
    mockedGet.mockResolvedValue({ goal_id: 'goal/1', state: 'active' });
    await fetchGoalSnapshot('goal/1');
    expect(mockedGet).toHaveBeenCalledWith('/api/goals/goal%2F1', {
      signal: undefined,
    });
  });

  it('lists Goals for one device and project', async () => {
    mockedGet.mockResolvedValue([]);
    await fetchGoals({ deviceId: 'device/1', projectPath: '/workspace/app one' });
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/goals?device_id=device%2F1&project_path=%2Fworkspace%2Fapp+one',
      { signal: undefined },
    );
  });

  it('queues a Goal Message with version and idempotency guards', async () => {
    mockedPost.mockResolvedValue({
      goal_id: 'goal-1',
      message_id: 'message-1',
      status: 'queued',
    });

    await queueGoalMessage('goal-1', {
      content: 'Continue with the current task',
      mode: 'text',
      idempotencyKey: 'goal-message-1',
      expectedStateVersion: 8,
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/goals/goal-1/messages', {
      content: 'Continue with the current task',
      mode: 'text',
      idempotency_key: 'goal-message-1',
      expected_state_version: 8,
    });
  });

  it('sends a Goal replacement as an explicit replan request', async () => {
    mockedPost.mockResolvedValue({
      goal_id: 'goal-1', message_id: 'message-2', status: 'replanning',
    });

    await queueGoalMessage('goal-1', {
      content: 'Replace the legacy API with the new contract',
      mode: 'text',
      kind: 'replan_request',
      idempotencyKey: 'goal-replan-1',
      expectedStateVersion: 9,
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/goals/goal-1/messages', {
      content: 'Replace the legacy API with the new contract',
      mode: 'text',
      kind: 'replan_request',
      idempotency_key: 'goal-replan-1',
      expected_state_version: 9,
    });
  });

  it('creates a Goal as a product command payload', async () => {
    mockedPost.mockResolvedValue({
      goal_id: 'goal-1',
      ai_session_id: 'goal-1',
      state: 'planning',
    });
    await createGoal({
      deviceId: 'device-1',
      projectId: 'project-1',
      projectPath: '/workspace/app',
      objective: 'Ship the Goal UI',
      constraints: ['Keep ordinary chats independent'],
      nonGoals: ['Workspace locking'],
      idempotencyKey: 'goal-create-1',
      provider: 'claude_code',
    });
    expect(mockedPost).toHaveBeenCalledWith('/api/goals', {
      device_id: 'device-1',
      project_id: 'project-1',
      project_path: '/workspace/app',
      objective: 'Ship the Goal UI',
      constraints: ['Keep ordinary chats independent'],
      non_goals: ['Workspace locking'],
      provider: 'claude_code',
      model: undefined,
      effort: undefined,
      client_request_id: 'goal-create-1',
    });
  });

  it('maps the immutable revision into the phone model', () => {
    expect(goalSnapshotToSummary({
      goal_id: 'goal-1',
      state: 'awaiting_approval',
      model: 'glm-5.2',
      effort: 'high',
      revision: {
        id: 'revision-1',
        number: 2,
        objective: 'Finish Goal support',
        constraints: ['Keep ordinary chats independent'],
        non_goals: ['Workspace locking'],
        budget: {
          max_attempts_per_task: 3,
          max_turns: 12,
          command_timeout_ms: 60_000,
        },
      },
    })).toEqual(expect.objectContaining({
      model: 'glm-5.2',
      effort: 'high',
      revision: {
      id: 'revision-1',
      number: 2,
      objective: 'Finish Goal support',
      constraints: ['Keep ordinary chats independent'],
      nonGoals: ['Workspace locking'],
      budget: {
        maxAttemptsPerTask: 3,
        maxTurns: 12,
        deadlineAt: undefined,
        commandTimeoutMs: 60_000,
        providerUsageLimit: undefined,
      },
      manifestDigest: undefined,
      createdAt: undefined,
      },
    }));
  });

  it('maps task retry progress into the phone model', () => {
    expect(goalSnapshotToSummary({
      goal_id: 'goal-1',
      state: 'active',
      tasks: [{
        id: 'task-1',
        title: 'Implement Goal UI',
        status: 'in_progress',
        is_current: true,
        failure_attempt: 2,
      }],
    }).tasks).toEqual([{
      id: 'task-1',
      title: 'Implement Goal UI',
      status: 'in_progress',
      isCurrent: true,
      failureAttempt: 2,
    }]);
  });

  it('approves the exact revision with state and idempotency guards', async () => {
    mockedPost.mockResolvedValue({
      goal_id: 'goal/1',
      state: 'active',
    });

    await approveGoalPlan('goal/1', {
      revisionId: 'revision-1',
      expectedStateVersion: 7,
      idempotencyKey: 'approval-1',
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/goals/goal%2F1/approve', {
      revision_id: 'revision-1',
      expected_state_version: 7,
      idempotency_key: 'approval-1',
    });
  });

  it('loads durable Goal history and abandons with a state guard', async () => {
    mockedGet.mockResolvedValue({ events: [] });
    mockedPost.mockResolvedValue({ goal_id: 'goal/1', state: 'abandoned' });

    await fetchGoalEvents('goal/1');
    await abandonGoal('goal/1', {
      expectedStateVersion: 9,
      idempotencyKey: 'abandon-1',
    });

    expect(mockedGet).toHaveBeenCalledWith('/api/goals/goal%2F1/events?limit=100', {
      signal: undefined,
    });
    expect(mockedPost).toHaveBeenCalledWith('/api/goals/goal%2F1/abandon', {
      expected_state_version: 9,
      idempotency_key: 'abandon-1',
    });
  });

  it.each([
    ['pause', pauseGoal],
    ['resume', resumeGoal],
    ['delete', deleteGoal],
  ] as const)('sends %s with state and idempotency guards', async (action, invoke) => {
    mockedPost.mockResolvedValue({ goal_id: 'goal/1', state: 'active' });
    await invoke('goal/1', {
      expectedStateVersion: 11,
      idempotencyKey: `goal-${action}-1`,
    });
    expect(mockedPost).toHaveBeenCalledWith(`/api/goals/goal%2F1/${action}`, {
      expected_state_version: 11,
      idempotency_key: `goal-${action}-1`,
    });
  });

  it('forwards stalled/recoverable from the server snapshot into the Goal summary', () => {
    // Server (Task 1-2) annotates stalled runs so the phone can surface a
    // recovery affordance; the mapper must not swallow either flag.
    expect(goalSnapshotToSummary({
      goal_id: 'goal-1',
      state: 'active',
      stalled: true,
      recoverable: true,
    })).toEqual(expect.objectContaining({
      stalled: true,
      recoverable: true,
    }));
    // Omitted flags round-trip as undefined (older servers / healthy runs).
    expect(goalSnapshotToSummary({
      goal_id: 'goal-2',
      state: 'active',
    })).toEqual(expect.objectContaining({
      stalled: undefined,
      recoverable: undefined,
    }));
  });

  it('recovers a stalled Goal via POST with state and idempotency guards', async () => {
    mockedPost.mockResolvedValue({ goal_id: 'goal/1', state: 'active', recoverable: false });

    await recoverGoal('goal/1', {
      expectedStateVersion: 13,
      idempotencyKey: 'goal-recover-1',
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/goals/goal%2F1/recover', {
      expected_state_version: 13,
      idempotency_key: 'goal-recover-1',
    });
  });

  it('maps a server AiMessage goal_id/hidden_at into the phone AgentMessage camelCase shape', () => {
    // Server (Task 8) stamps goal_id/hidden_at on the wire (snake_case). The
    // phone-side mapper must forward both to the AgentMessage camelCase fields
    // so the upcoming goal-fold UI (Task 12/13) can hide finished-goal chatter.
    const mapped = serverAiMessageToAgent({
      id: 'msg-1',
      role: 'assistant',
      mode: 'text',
      content: 'Planning…',
      timestamp: '2026-07-27T00:00:00.000Z',
      index: 3,
      goal_id: 'G1',
      hidden_at: '2026-07-27T00:00:01.000Z',
    });
    expect(mapped).toEqual({
      id: 'msg-1',
      role: 'assistant',
      mode: 'text',
      content: 'Planning…',
      timestamp: '2026-07-27T00:00:00.000Z',
      index: 3,
      goalId: 'G1',
      hiddenAt: '2026-07-27T00:00:01.000Z',
    });
  });

  it('treats missing goal_id/hidden_at as undefined without distorting the mapped AgentMessage', () => {
    // Older servers and ordinary chat sessions omit the new fields entirely —
    // the mapper must not synthesize values (undefined round-trips cleanly).
    const mapped = serverAiMessageToAgent({
      id: 'msg-2',
      role: 'user',
      content: 'hi',
      timestamp: '2026-07-27T00:00:00.000Z',
    });
    expect(mapped.goalId).toBeUndefined();
    expect(mapped.hiddenAt).toBeUndefined();
    expect(mapped).toEqual({
      id: 'msg-2',
      role: 'user',
      mode: undefined,
      content: 'hi',
      timestamp: '2026-07-27T00:00:00.000Z',
      index: undefined,
      goalId: undefined,
      hiddenAt: undefined,
    });
  });
});
