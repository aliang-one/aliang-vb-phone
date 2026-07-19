import type { PlatformTransportEvent } from '../services/platformTransport';

export const AI_STREAM_TRANSPORT_TYPES = new Set([
  'ai.delta',
  'ai.command',
  'ai.file_change',
  'ai.thinking',
  'ai.usage',
  'ai.task',
]);

export type AiStreamTransportEvent = Extract<
  PlatformTransportEvent,
  {
    type:
      | 'ai.delta'
      | 'ai.command'
      | 'ai.file_change'
      | 'ai.thinking'
      | 'ai.usage'
      | 'ai.task';
  }
>;

const AI_STREAM_FLUSH_MS = 100;

let pendingEvents: AiStreamTransportEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let applyEvents: ((events: AiStreamTransportEvent[]) => void) | null = null;

export const isAiStreamTransportEvent = (
  event: PlatformTransportEvent,
): event is AiStreamTransportEvent => AI_STREAM_TRANSPORT_TYPES.has(event.type);

export function registerAiStreamApplier(
  apply: (events: AiStreamTransportEvent[]) => void,
): void {
  applyEvents = apply;
}

export function cancelAiStreamBatch(): void {
  pendingEvents = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function flushAiStreamEvents(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pendingEvents.length || !applyEvents) return;
  const events = pendingEvents;
  pendingEvents = [];
  applyEvents(events);
}

export function pushAiStreamEvent(event: AiStreamTransportEvent): void {
  pendingEvents.push(event);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!pendingEvents.length || !applyEvents) return;
    const events = pendingEvents;
    pendingEvents = [];
    applyEvents(events);
  }, AI_STREAM_FLUSH_MS);
}
