import type { VibeCodingRun } from '../data/platformModels';

/**
 * A single streaming token/chunk arriving from the platform for an AI session.
 * Mirrors the payload of the `ai.delta` transport event.
 */
export interface DeltaUpdate {
  sessionId: string;
  delta: string;
  currentStep?: string;
  messageId?: string;
}

/**
 * Merge a batch of streaming `ai.delta` updates into `vibeRuns` in a SINGLE pass.
 *
 * Why this exists: applying deltas one-at-a-time rebuilds the `vibeRuns` array
 * (and re-renders every subscribed screen) once per token. During active AI
 * streaming that saturates the JS thread and makes touches/navigation feel dead.
 * Coalescing the deltas and applying them together collapses N store writes into
 * one, so subscribers only re-render once per flush instead of once per token.
 *
 * Semantics (kept identical to the previous per-token handler):
 * - A delta whose `messageId` matches the run's trailing assistant message is
 *   appended to that message's content.
 * - Otherwise a new assistant message is created.
 * - Runs that receive no deltas keep their original reference so zustand
 *   subscribers skip them entirely.
 */
export function applyDeltasToRuns(
  runs: VibeCodingRun[],
  deltas: DeltaUpdate[],
  makeId: () => string,
  nowLabel: () => string,
): VibeCodingRun[] {
  if (!deltas.length) return runs;

  // Group deltas by session id, preserving arrival order within each session.
  const deltasBySession = new Map<string, DeltaUpdate[]>();
  for (const delta of deltas) {
    const bucket = deltasBySession.get(delta.sessionId);
    if (bucket) {
      bucket.push(delta);
    } else {
      deltasBySession.set(delta.sessionId, [delta]);
    }
  }

  return runs.map(run => {
    const sessionDeltas = deltasBySession.get(run.id);
    if (!sessionDeltas) return run;
    return applyDeltasToRun(run, sessionDeltas, makeId, nowLabel);
  });
}

function resolveAssistantMessageId(
  transcript: VibeCodingRun['transcript'],
  rawMessageId: string,
  makeId: () => string,
) {
  const trailing = transcript[transcript.length - 1];
  if (!rawMessageId) {
    return trailing?.role === 'assistant' ? trailing.id : makeId();
  }

  const assistantWithId = transcript.find(
    message => message.role === 'assistant' && message.id === rawMessageId,
  );
  if (assistantWithId) return rawMessageId;

  const collidesWithNonAssistant = transcript.some(
    message => message.role !== 'assistant' && message.id === rawMessageId,
  );
  return collidesWithNonAssistant ? `${rawMessageId}:assistant` : rawMessageId;
}

function applyDeltasToRun(
  run: VibeCodingRun,
  sessionDeltas: DeltaUpdate[],
  makeId: () => string,
  nowLabel: () => string,
): VibeCodingRun {
  // Mutate one shallow copy of the transcript instead of spreading per delta.
  const transcript = run.transcript.slice();
  let currentStep = run.currentStep;

  for (const delta of sessionDeltas) {
    const stepCandidate = delta.currentStep || delta.delta.slice(0, 100);
    if (stepCandidate) {
      currentStep = stepCandidate;
    }

    const lastIndex = transcript.length - 1;
    const trailing = transcript[lastIndex];
    const messageId = resolveAssistantMessageId(
      transcript,
      delta.messageId ?? '',
      makeId,
    );

    if (trailing && trailing.role === 'assistant' && trailing.id === messageId) {
      transcript[lastIndex] = {
        ...trailing,
        content: trailing.content + delta.delta,
      };
    } else {
      transcript.push({
        id: messageId || makeId(),
        role: 'assistant',
        mode: 'text', // FIX: Add default mode for streaming messages
        content: delta.delta,
        timestamp: nowLabel(),
      });
    }
  }

  const lastMessage = transcript[transcript.length - 1];

  return {
    ...run,
    status: 'running',
    currentStep,
    lastActivityMs: Date.now(),
    updatedAt: '刚刚',
    transcript,
    transcriptCount: Math.max(run.transcriptCount ?? 0, transcript.length),
    lastMessage,
  };
}
