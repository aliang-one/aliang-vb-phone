import { apiGet, apiPost } from '../../src/api/client';
import {
  abandonGoal,
  approveGoalPlan,
  createGoal,
  fetchGoalEvents,
  fetchGoals,
  fetchGoalSnapshot,
  goalSnapshotToSummary,
  queueGoalMessage,
} from '../../src/api/goals';

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
    }).revision).toEqual({
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
    });
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
});
