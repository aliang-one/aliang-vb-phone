import type { VibeCodingRun, VibeStatus } from '../data/platformModels';
import { applyDeltasToRun, type DeltaUpdate } from '../utils/deltaBatch';
import type { AiStreamTransportEvent } from './aiStreamBatching';
import { formatActivityLabel, trimTranscriptWithWindow } from './internals';
import { applyStructuredEventsToRun } from './slices/structuredSlice';

export function applyAiStreamEventsToRuns(
  runs: VibeCodingRun[],
  events: AiStreamTransportEvent[],
  makeId: () => string,
  nowLabel: () => string,
): VibeCodingRun[] {
  if (!events.length) return runs;

  const bySession = new Map<string, AiStreamTransportEvent[]>();
  for (const event of events) {
    const batch = bySession.get(event.sessionId);
    if (batch) batch.push(event);
    else bySession.set(event.sessionId, [event]);
  }

  let changed = false;
  const nextRuns = runs.map(run => {
    const batch = bySession.get(run.id);
    if (!batch) return run;

    const deltas: DeltaUpdate[] = [];
    const structured: AiStreamTransportEvent[] = [];
    for (const event of batch) {
      if (event.type === 'ai.delta') {
        deltas.push({
          sessionId: event.sessionId,
          delta: event.delta,
          currentStep: event.currentStep || undefined,
          messageId: event.messageId,
        });
      } else {
        structured.push(event);
      }
    }

    const activityMs = Date.now();
    let next = run;
    if (deltas.length) {
      next = applyDeltasToRun(next, deltas, makeId, nowLabel, activityMs);
    }
    if (structured.length) {
      next = applyStructuredEventsToRun(next, structured);
      if (!deltas.length) {
        const hasVersionAuthority = next.runStateVersion !== undefined;
        const canAssertRunning =
          !hasVersionAuthority &&
          next.status !== 'failed' &&
          next.status !== 'completed' &&
          next.status !== 'waiting_approval';
        if (hasVersionAuthority || canAssertRunning) {
          next = {
            ...next,
            status: canAssertRunning ? ('running' as VibeStatus) : next.status,
            lastActivityMs: activityMs,
            updatedAt: formatActivityLabel(activityMs),
          };
        }
      }
    }

    // 水位地板裁剪(统一收口 trimTranscriptWithWindow):已加载历史不被流式
    // 写入裁掉;头部被裁时窗口事实与 transcript 同帧更新。
    const trimmed = trimTranscriptWithWindow(next.transcript, next.transcriptPage);
    if (trimmed.transcript !== next.transcript || trimmed.pageDelta) {
      next = {
        ...next,
        transcript: trimmed.transcript,
        ...(trimmed.pageDelta && next.transcriptPage
          ? { transcriptPage: { ...next.transcriptPage, ...trimmed.pageDelta } }
          : {}),
      };
    }
    changed = changed || next !== run;
    return next;
  });

  return changed ? nextRuns : runs;
}
