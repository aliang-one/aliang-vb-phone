import type { StructuredActivityEvent } from '../data/platformModels';

// The headline displays thinking size, but refreshing it for every character
// defeats the transcript row's memo boundary. A settled event still refreshes
// immediately because `active` is part of the signature.
export const THINKING_RENDER_BUCKET_CHARS = 512;

export const activityEventRenderSignature = (
  event: StructuredActivityEvent,
): string => {
  const base = `${event.eventId}:${event.kind}`;
  switch (event.kind) {
    case 'command':
      return `${base}:${event.status}:${event.exitCode ?? ''}:${
        event.command ?? ''
      }`;
    case 'thinking':
      return `${base}:${event.active ? 1 : 0}:${Math.floor(
        event.chars / THINKING_RENDER_BUCKET_CHARS,
      )}`;
    case 'file_change':
      return `${base}:${event.changeKind ?? ''}:${event.path ?? ''}:${
        event.renamedFrom ?? ''
      }:${event.added ?? ''}:${event.removed ?? ''}`;
    case 'usage':
      return `${base}:${event.inputTokens ?? ''}:${event.outputTokens ?? ''}`;
    case 'task':
      return `${base}:${event.tasks
        .map(task => `${task.subject}:${task.status}:${task.active_form ?? ''}`)
        .join(',')}`;
    default:
      return base;
  }
};

export const activityEventsRenderSignature = (
  events: StructuredActivityEvent[] | undefined,
): string =>
  events && events.length
    ? events.map(activityEventRenderSignature).join('|')
    : '';

export const relevantActivityDetailsEqual = (
  events: Iterable<StructuredActivityEvent>,
  previous: Record<string, { text?: string; truncated?: boolean }> | undefined,
  next: Record<string, { text?: string; truncated?: boolean }> | undefined,
): boolean => {
  if (previous === next) return true;
  for (const event of events) {
    if (previous?.[event.eventId] !== next?.[event.eventId]) return false;
  }
  return true;
};
