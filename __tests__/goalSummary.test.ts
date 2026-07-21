import type { ServerAiSession } from '../src/api/sessions';
import {
  mergeVibeRunSnapshot,
  serverAiSessionToVibeRun,
} from '../src/store/internals';
import {
  goalSnapshotToSummary,
  newerGoalSummary,
} from '../src/api/goals';

const baseSession = (): ServerAiSession => ({
  session_id: 'session-goal',
  kind: 'ai',
  user_id: 'user-1',
  device_id: 'device-1',
  status: 'running',
  mode: 'agent',
  project_path: '/workspace/app',
  created_at: '2026-07-20T00:00:00.000Z',
  last_active_at: '2026-07-20T00:00:00.000Z',
});

describe('Goal session snapshot mapping', () => {
  it('maps the bounded server goal_summary without inventing missing progress', () => {
    const run = serverAiSessionToVibeRun(
      {
        ...baseSession(),
        purpose: 'goal',
        goal_summary: {
          goal_id: 'goal-1',
          state: 'active',
          state_version: 7,
          completed_tasks: 2,
          total_tasks: 5,
          current_task: 'Build GoalStatusBar',
          current_run_health: 'working',
          primary_action_kind: 'pause',
          primary_action_label: 'Pause',
          tasks: [
            { id: 'task-1', title: 'Define contract', status: 'completed' },
            { id: 'task-2', title: 'Build UI', status: 'active', is_current: true },
          ],
        },
      },
      [],
      [],
    );

    expect(run.purpose).toBe('goal');
    expect(run.goalSummary).toEqual(
      expect.objectContaining({
        goalId: 'goal-1',
        state: 'active',
        stateVersion: 7,
        completedTasks: 2,
        totalTasks: 5,
        currentTask: 'Build GoalStatusBar',
      }),
    );
    expect(run.goalSummary?.tasks?.[1]).toEqual(
      expect.objectContaining({ isCurrent: true }),
    );
  });

  it('keeps ordinary sessions free of Goal state', () => {
    const run = serverAiSessionToVibeRun(baseSession(), [], []);
    expect(run.purpose).toBeUndefined();
    expect(run.goalSummary).toBeUndefined();
  });

  it('preserves the newest Goal version across stale or partial snapshots', () => {
    const current = serverAiSessionToVibeRun(
      {
        ...baseSession(),
        purpose: 'goal',
        goal_summary: {
          goal_id: 'goal-1',
          state: 'verifying',
          state_version: 9,
        },
      },
      [],
      [],
    );
    const stale = serverAiSessionToVibeRun(
      {
        ...baseSession(),
        purpose: 'goal',
        goal_summary: {
          goal_id: 'goal-1',
          state: 'active',
          state_version: 8,
        },
      },
      [],
      [],
    );
    const partial = serverAiSessionToVibeRun(baseSession(), [], []);

    expect(mergeVibeRunSnapshot(current, stale).goalSummary?.state).toBe('verifying');
    expect(mergeVibeRunSnapshot(current, partial).goalSummary?.stateVersion).toBe(9);
  });
});

describe('Goal detail snapshot versioning', () => {
  it('maps the authoritative detail response and keeps a newer cached version', () => {
    const incoming = goalSnapshotToSummary({
      goal_id: 'goal-1',
      objective: 'Deliver the Goal UI',
      state: 'active',
      state_version: 4,
      driver: 'server_goal',
      workspace_relation: 'exact',
    });

    expect(incoming).toEqual(
      expect.objectContaining({
        objective: 'Deliver the Goal UI',
        driver: 'server_goal',
        workspaceRelation: 'exact',
      }),
    );
    expect(
      newerGoalSummary(
        { goalId: 'goal-1', state: 'verifying', stateVersion: 5 },
        incoming,
      ).state,
    ).toBe('verifying');
  });
});
