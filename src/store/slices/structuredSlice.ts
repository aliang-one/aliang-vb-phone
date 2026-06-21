import type {
  StructuredActivityEvent,
  VibeCodingRun,
} from '../../data/platformModels';
import type { PlatformTransportEvent } from '../../services/platformTransport';
import { tail, STRUCTURED_EVENTS_CAP } from '../internals';

// Map a live transport event → a StructuredActivityEvent (camelCase, with eventId).
// (P2.1 transport events already carry camelCase fields + eventId.) The
// file_change transport field `kind` (create/edit/delete/rename) is renamed to
// `changeKind` on the activity to avoid colliding with the union discriminant.
function transportToActivity(
  ev: PlatformTransportEvent,
): StructuredActivityEvent | null {
  switch (ev.type) {
    case 'ai.command':
      return {
        kind: 'command',
        eventId: ev.eventId,
        messageId: ev.messageId,
        itemId: ev.itemId,
        status: ev.status,
        command: ev.command,
        cwd: ev.cwd,
        exitCode: ev.exitCode,
      };
    case 'ai.file_change':
      return {
        kind: 'file_change',
        eventId: ev.eventId,
        messageId: ev.messageId,
        itemId: ev.itemId,
        path: ev.path,
        changeKind: ev.kind,
        added: ev.added,
        removed: ev.removed,
        renamedFrom: ev.renamedFrom,
      };
    case 'ai.thinking':
      return {
        kind: 'thinking',
        eventId: ev.eventId,
        messageId: ev.messageId,
        active: ev.active,
        chars: ev.chars,
      };
    case 'ai.usage':
      return {
        kind: 'usage',
        eventId: ev.eventId,
        messageId: ev.messageId,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        cacheReadTokens: ev.cacheReadTokens,
        model: ev.model,
      };
    case 'ai.task':
      return {
        kind: 'task',
        eventId: ev.eventId,
        messageId: ev.messageId,
        tasks: ev.tasks,
      };
    default:
      return null;
  }
}

// Upsert a live event into the run's structuredEvents (by eventId). Command:
// overlay completed onto started (same deterministic eventId), keeping the
// started envelope's command/cwd if the completed one omits them. Task: replace
// the array. Others: shallow overlay.
export function applyStructuredEvent(
  run: VibeCodingRun,
  ev: PlatformTransportEvent,
): VibeCodingRun {
  const activity = transportToActivity(ev);
  if (!activity) return run;
  const idx = run.structuredEvents.findIndex(
    e => e.eventId === activity.eventId,
  );
  let nextEvents: StructuredActivityEvent[];
  if (idx >= 0) {
    const prev = run.structuredEvents[idx];
    if (activity.kind === 'command' && prev.kind === 'command') {
      // Two-state merge: keep started's command/cwd if completed omits them;
      // always take the latest status/exitCode.
      const merged = {
        ...prev,
        ...activity,
        command: activity.command ?? prev.command,
        cwd: activity.cwd ?? prev.cwd,
      };
      nextEvents = run.structuredEvents.map((e, i) =>
        i === idx ? merged : e,
      );
    } else if (activity.kind === 'task' && prev.kind === 'task') {
      // Task list is replaced wholesale (latest snapshot wins).
      nextEvents = run.structuredEvents.map((e, i) =>
        i === idx ? activity : e,
      );
    } else {
      nextEvents = run.structuredEvents.map((e, i) =>
        i === idx
          ? ({ ...prev, ...activity } as StructuredActivityEvent)
          : e,
      );
    }
  } else {
    nextEvents = [...run.structuredEvents, activity];
  }
  // Hard floor (safety net): cap resident structured activity per session so a
  // long-running active session can't grow structuredEvents without bound.
  // Oldest events drop first (ring-buffer); they remain on the server and are
  // re-fetched with the session detail on re-entry.
  return { ...run, structuredEvents: tail(nextEvents, STRUCTURED_EVENTS_CAP) };
}

// Reconcile a server snapshot's structured_events with live local state.
// Snapshot is authoritative for any eventId it carries (overlays local); local
// events not present in the snapshot are kept — this handles live events that
// arrive after the snapshot was rendered.
export function reconcileStructured(
  local: StructuredActivityEvent[],
  snapshot: StructuredActivityEvent[],
): StructuredActivityEvent[] {
  const byId = new Map<string, StructuredActivityEvent>();
  for (const e of local) byId.set(e.eventId, e);
  for (const e of snapshot) byId.set(e.eventId, e); // snapshot wins on conflict
  // Re-cap after union so a large snapshot can't push past STRUCTURED_EVENTS_CAP.
  return tail([...byId.values()], STRUCTURED_EVENTS_CAP);
}
