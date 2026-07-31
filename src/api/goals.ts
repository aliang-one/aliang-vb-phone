import { apiGet, apiPost } from './client';
import type {
  GoalCheckSummary,
  GoalAcceptanceCriterionSummary,
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
  planning_error_code?: string;
  planning_error_detail?: string;
  planning_phase?: string;
  planning_attempt?: number;
  planning_thinking_chars?: number;
  planning_thinking_preview?: string;
  planning_updated_at?: string;
  primary_action_kind?: string;
  primary_action_label?: string;
  branch_suggestion?: { reason: string; pivot_task_key?: string; magnitude?: 'minor' | 'major'; kind?: 'branch' | 'user_input' };
  open_fork?: {
    fork_id: string;
    child_session_id: string;
    pivot_task_key?: string;
    fork_reason?: string;
  };
  stalled?: boolean;
  recoverable?: boolean;
  provider?: string;
  model?: string;
  effort?: string;
  driver?: string;
  deleted_at?: string;
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
    key?: string;
    description?: string;
    allowed_commands?: string[];
    depends_on?: string[];
    required_check_ids?: string[];
  }>;
  checks?: Array<{
    id: string;
    title: string;
    status?: string;
    detail?: string;
    key?: string;
    type?: 'command' | 'file_exists' | 'file_contains';
    command?: string;
    path?: string;
    contains?: string;
    required?: boolean;
    timeout_ms?: number;
    criterion_key?: string;
  }>;
  criteria?: Array<{
    key: string;
    statement: string;
    kind: 'functional' | 'regression' | 'integration' | 'device' | 'delivery';
    verification: 'auto' | 'manual' | 'unverifiable';
    required: boolean;
    user_authored?: boolean;
    mapped_check_keys?: string[];
    status: 'passed' | 'failed' | 'pending' | 'manual' | 'unverifiable';
  }>;
}

const mapTasks = (tasks?: ServerGoalSnapshot['tasks']): GoalTaskSummary[] | undefined =>
  tasks?.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    isCurrent: task.is_current,
    failureAttempt: task.failure_attempt,
    key: task.key,
    description: task.description,
    allowedCommands: task.allowed_commands,
    dependsOn: task.depends_on,
    requiredCheckIds: task.required_check_ids,
  }));

const mapChecks = (checks?: ServerGoalSnapshot['checks']): GoalCheckSummary[] | undefined =>
  checks?.map(check => ({
    id: check.id,
    title: check.title,
    status: check.status,
    detail: check.detail,
    key: check.key,
    type: check.type,
    command: check.command,
    path: check.path,
    contains: check.contains,
    required: check.required,
    timeoutMs: check.timeout_ms,
    criterionKey: check.criterion_key,
  }));

const mapCriteria = (
  criteria?: ServerGoalSnapshot['criteria'],
): GoalAcceptanceCriterionSummary[] | undefined =>
  criteria?.map(criterion => ({
    key: criterion.key,
    statement: criterion.statement,
    kind: criterion.kind,
    verification: criterion.verification,
    required: criterion.required,
    userAuthored: criterion.user_authored,
    mappedCheckKeys: criterion.mapped_check_keys ?? [],
    status: criterion.status,
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
  planningErrorCode: snapshot.planning_error_code,
  planningErrorDetail: snapshot.planning_error_detail,
  planningPhase: snapshot.planning_phase,
  planningAttempt: snapshot.planning_attempt,
  planningThinkingChars: snapshot.planning_thinking_chars,
  planningThinkingPreview: snapshot.planning_thinking_preview,
  planningUpdatedAt: snapshot.planning_updated_at,
  primaryActionKind: snapshot.primary_action_kind,
  primaryActionLabel: snapshot.primary_action_label,
  branchSuggestion: snapshot.branch_suggestion
    ? {
        reason: snapshot.branch_suggestion.reason,
        pivotTaskKey: snapshot.branch_suggestion.pivot_task_key,
        magnitude: snapshot.branch_suggestion.magnitude,
        kind: snapshot.branch_suggestion.kind,
      }
    : undefined,
  openFork: snapshot.open_fork
    ? {
        forkId: snapshot.open_fork.fork_id,
        childSessionId: snapshot.open_fork.child_session_id,
        pivotTaskKey: snapshot.open_fork.pivot_task_key,
        forkReason: snapshot.open_fork.fork_reason,
      }
    : undefined,
  stalled: snapshot.stalled,
  recoverable: snapshot.recoverable,
  provider: snapshot.provider,
  model: snapshot.model,
  effort: snapshot.effort,
  driver: snapshot.driver,
  workspaceRelation: snapshot.workspace_relation,
  updatedAt: snapshot.updated_at,
  revision: mapRevision(snapshot.revision),
  tasks: mapTasks(snapshot.tasks),
  checks: mapChecks(snapshot.checks),
  criteria: mapCriteria(snapshot.criteria),
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
  // Content-identical (same version + same semantic fields) → reuse `current`
  // so the consumer's useState/Object.is bails. Without this, a realtime push
  // during streaming that carries the SAME goalSummary content still produces a
  // fresh spread object every tick → the syncing effect re-fires every render
  // → Maximum update depth exceeded. The sparse-merge below still handles
  // genuinely differing content (e.g. an incoming summary missing diagnostics).
  if (
    current &&
    current.stateVersion === incoming.stateVersion &&
    current.state === incoming.state &&
    current.primaryActionKind === incoming.primaryActionKind &&
    current.revision?.id === incoming.revision?.id &&
    current.planningErrorCode === incoming.planningErrorCode &&
    current.planningErrorDetail === incoming.planningErrorDetail &&
    current.updatedAt === incoming.updatedAt
  ) {
    return current;
  }
  if (current?.stateVersion !== undefined && incoming.stateVersion === current.stateVersion) {
    return {
      ...current,
      ...incoming,
      planningErrorCode: incoming.planningErrorCode ?? current.planningErrorCode,
      planningErrorDetail: incoming.planningErrorDetail ?? current.planningErrorDetail,
      revision: incoming.revision ?? current.revision,
      tasks: incoming.tasks ?? current.tasks,
      checks: incoming.checks ?? current.checks,
    };
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
  // Optional: attach the goal to an existing ordinary AiSession (preserves the
  // conversation history) instead of creating a new dedicated goal session.
  aiSessionId?: string;
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
    ai_session_id: input.aiSessionId,
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
    // Phase 2 criterion editing (codex #1): the user's edited acceptance criteria.
    criteria?: Array<{
      key: string;
      statement: string;
      kind: 'functional' | 'regression' | 'integration' | 'device' | 'delivery';
      verification: 'auto' | 'manual' | 'unverifiable';
      required: boolean;
      mapped_check_keys: string[];
    }>;
  },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/approve`,
    {
      revision_id: input.revisionId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      criteria: input.criteria,
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

type GoalControlInput = {
  expectedStateVersion: number;
  idempotencyKey: string;
};

const controlGoal = (
  goalId: string,
  action: 'pause' | 'resume' | 'delete',
  input: GoalControlInput,
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/${action}`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );

export const pauseGoal = (goalId: string, input: GoalControlInput): Promise<ServerGoalSnapshot> =>
  controlGoal(goalId, 'pause', input);

export const resumeGoal = (goalId: string, input: GoalControlInput): Promise<ServerGoalSnapshot> =>
  controlGoal(goalId, 'resume', input);

export const deleteGoal = (goalId: string, input: GoalControlInput): Promise<ServerGoalSnapshot> =>
  controlGoal(goalId, 'delete', input);

/**
 * User-initiated recovery for a stalled Goal run. Server validates the state
 * version (optimistic concurrency) and dedups retries via the idempotency key.
 */
export const recoverGoal = (
  goalId: string,
  input: { expectedStateVersion: number; idempotencyKey: string },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/recover`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );

/**
 * Phase 1 可信签署闸: a goal that passed every task check pauses at
 * awaiting_user_acceptance. accept → the server writes the immutable sign-off
 * decision and completes the goal; decline → blocked (user_rejected_completion),
 * after which /recover replans. Both are idempotent on idempotencyKey.
 */
export const acceptGoal = (
  goalId: string,
  input: { expectedStateVersion: number; idempotencyKey: string },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/accept`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );

export const declineGoal = (
  goalId: string,
  input: { expectedStateVersion: number; idempotencyKey: string },
): Promise<ServerGoalSnapshot> =>
  apiPost<ServerGoalSnapshot>(
    `/api/goals/${encodeURIComponent(goalId)}/decline`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );

/**
 * Phase 2 fork: open a temporary re-planning child session. The main goal pauses;
 * the child session inherits the goal's read-only context. Abandon to discard
 * + resume, or merge to squash the exploration into a new plan (goes through
 * approval). The child session is purpose='chat' — the agent needs no changes.
 */
export const forkGoal = (
  goalId: string,
  input: { reason: string; expectedStateVersion: number; idempotencyKey: string; taskId?: string },
): Promise<{ fork_id: string; child_session_id: string }> =>
  apiPost<{ fork_id: string; child_session_id: string }>(
    `/api/goals/${encodeURIComponent(goalId)}/fork`,
    {
      reason: input.reason,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      ...(input.taskId ? { task_id: input.taskId } : {}),
    },
  );

export const abandonFork = (
  goalId: string,
  forkId: string,
): Promise<{ status: string; fork_id: string }> =>
  apiPost<{ status: string; fork_id: string }>(
    `/api/goals/${encodeURIComponent(goalId)}/fork/${encodeURIComponent(forkId)}/abandon`,
    {},
  );

export const mergeFork = (
  goalId: string,
  forkId: string,
  input: { expectedStateVersion: number; idempotencyKey: string },
): Promise<{ status: string; fork_id: string; goal_state: string }> =>
  apiPost<{ status: string; fork_id: string; goal_state: string }>(
    `/api/goals/${encodeURIComponent(goalId)}/fork/${encodeURIComponent(forkId)}/merge`,
    {
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
    },
  );
