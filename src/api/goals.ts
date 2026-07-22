import { apiGet, apiPost } from './client';
import type {
  GoalCheckSummary,
  GoalRevisionSummary,
  GoalState,
  GoalSummary,
  GoalTaskSummary,
} from '../data/platformModels';

export interface ServerGoalSnapshot {
  goal_id: string;
  objective?: string;
  state: GoalState;
  state_version?: number;
  completed_tasks?: number;
  total_tasks?: number;
  current_task?: string;
  current_run_health?: string;
  attention?: string;
  primary_action_kind?: string;
  primary_action_label?: string;
  provider?: string;
  model?: string;
  effort?: string;
  driver?: string;
  workspace_relation?: 'exact' | 'advanced' | 'unavailable';
  updated_at?: string;
  revision?: {
    id: string;
    number: number;
    objective: string;
    constraints?: string[];
    non_goals?: string[];
    budget?: {
      max_attempts_per_task?: number;
      max_turns?: number;
      deadline_at?: string;
      command_timeout_ms?: number;
      provider_usage_limit?: number;
    };
    manifest_digest?: string;
    created_at?: string;
  };
  tasks?: Array<{
    id: string;
    title: string;
    status?: string;
    is_current?: boolean;
    failure_attempt?: number;
  }>;
  checks?: Array<{
    id: string;
    title: string;
    status?: string;
    detail?: string;
  }>;
}

const mapTasks = (tasks?: ServerGoalSnapshot['tasks']): GoalTaskSummary[] | undefined =>
  tasks?.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    isCurrent: task.is_current,
    failureAttempt: task.failure_attempt,
  }));

const mapChecks = (checks?: ServerGoalSnapshot['checks']): GoalCheckSummary[] | undefined =>
  checks?.map(check => ({
    id: check.id,
    title: check.title,
    status: check.status,
    detail: check.detail,
  }));

const mapRevision = (
  revision?: ServerGoalSnapshot['revision'],
): GoalRevisionSummary | undefined => revision ? ({
  id: revision.id,
  number: revision.number,
  objective: revision.objective,
  constraints: revision.constraints ?? [],
  nonGoals: revision.non_goals ?? [],
  budget: revision.budget ? {
    maxAttemptsPerTask: revision.budget.max_attempts_per_task,
    maxTurns: revision.budget.max_turns,
    deadlineAt: revision.budget.deadline_at,
    commandTimeoutMs: revision.budget.command_timeout_ms,
    providerUsageLimit: revision.budget.provider_usage_limit,
  } : undefined,
  manifestDigest: revision.manifest_digest,
  createdAt: revision.created_at,
}) : undefined;

export const goalSnapshotToSummary = (snapshot: ServerGoalSnapshot): GoalSummary => ({
  goalId: snapshot.goal_id,
  objective: snapshot.objective,
  state: snapshot.state,
  stateVersion: snapshot.state_version,
  completedTasks: snapshot.completed_tasks,
  totalTasks: snapshot.total_tasks,
  currentTask: snapshot.current_task,
  currentRunHealth: snapshot.current_run_health,
  attention: snapshot.attention,
  primaryActionKind: snapshot.primary_action_kind,
  primaryActionLabel: snapshot.primary_action_label,
  provider: snapshot.provider,
  model: snapshot.model,
  effort: snapshot.effort,
  driver: snapshot.driver,
  workspaceRelation: snapshot.workspace_relation,
  updatedAt: snapshot.updated_at,
  revision: mapRevision(snapshot.revision),
  tasks: mapTasks(snapshot.tasks),
  checks: mapChecks(snapshot.checks),
});

export const newerGoalSummary = (
  current: GoalSummary | undefined,
  incoming: GoalSummary,
): GoalSummary => {
  if (
    current?.stateVersion !== undefined &&
    incoming.stateVersion !== undefined &&
    incoming.stateVersion < current.stateVersion
  ) {
    return current;
  }
  return incoming;
};

export const fetchGoalSnapshot = (
  goalId: string,
  signal?: AbortSignal,
): Promise<ServerGoalSnapshot> =>
  apiGet<ServerGoalSnapshot>(`/api/goals/${encodeURIComponent(goalId)}`, { signal });

export const fetchGoals = (input: {
  deviceId: string;
  projectPath?: string;
  signal?: AbortSignal;
}): Promise<Array<ServerGoalSnapshot & { ai_session_id: string }>> => {
  const params = new URLSearchParams({ device_id: input.deviceId });
  if (input.projectPath) params.set('project_path', input.projectPath);
  return apiGet<Array<ServerGoalSnapshot & { ai_session_id: string }>>(
    `/api/goals?${params.toString()}`,
    { signal: input.signal },
  );
};

export const createGoal = (input: {
  deviceId: string;
  projectId?: string;
  projectPath?: string;
  objective: string;
  constraints?: string[];
  nonGoals?: string[];
  idempotencyKey?: string;
  provider?: string;
  model?: string;
  effort?: string;
}): Promise<ServerGoalSnapshot & { ai_session_id: string }> =>
  apiPost<ServerGoalSnapshot & { ai_session_id: string }>('/api/goals', {
    device_id: input.deviceId,
    project_id: input.projectId,
    project_path: input.projectPath,
    objective: input.objective,
    constraints: input.constraints,
    non_goals: input.nonGoals,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    client_request_id: input.idempotencyKey,
  });

export interface GoalMessageReceipt {
  goal_id: string;
  message_id: string;
  status: 'queued' | 'queued_for_replan' | 'replanning' | 'rejected';
  state_version?: number;
  applies_to_run?: number;
}

export interface GoalEventSnapshot {
  event_id: string;
  sequence: number;
  type: string;
  actor: 'user' | 'server' | 'agent';
  revision_id?: string;
  run_id?: string;
  reason?: string;
  created_at: string;
}

export const fetchGoalEvents = (
  goalId: string,
  signal?: AbortSignal,
): Promise<{ events: GoalEventSnapshot[]; next_after?: number }> =>
  apiGet(`/api/goals/${encodeURIComponent(goalId)}/events?limit=100`, { signal });

export const queueGoalMessage = (
  goalId: string,
  input: {
    content: string;
    mode: 'voice' | 'text';
    kind?: 'goal_message' | 'replan_request';
    constraints?: string[];
    nonGoals?: string[];
    idempotencyKey: string;
    expectedStateVersion?: number;
  },
): Promise<GoalMessageReceipt> =>
  apiPost<GoalMessageReceipt>(
    `/api/goals/${encodeURIComponent(goalId)}/messages`,
    {
      content: input.content,
      mode: input.mode,
      kind: input.kind,
      constraints: input.constraints,
      non_goals: input.nonGoals,
      idempotency_key: input.idempotencyKey,
      expected_state_version: input.expectedStateVersion,
    },
  );

export const approveGoalPlan = (
  goalId: string,
  input: {
    revisionId: string;
    expectedStateVersion: number;
    idempotencyKey: string;
  },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/approve`,
    {
      revision_id: input.revisionId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );

export const abandonGoal = (
  goalId: string,
  input: { expectedStateVersion: number; idempotencyKey: string },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/abandon`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );
