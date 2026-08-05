import type { AgentMessage } from '../data/platformModels';

export interface ActivityGroupingOptions {
  /** Do not let a recovered group grow without a visible turn boundary. */
  maxEventsPerGroup?: number;
  /** Fallback when an event count is unavailable for an anchor. */
  maxMessageIdsPerGroup?: number;
  eventCountByMessageId?: ReadonlyMap<string, number>;
}

const DEFAULT_MAX_EVENTS_PER_GROUP = 24;
const DEFAULT_MAX_MESSAGE_IDS_PER_GROUP = 6;

/**
 * Groups tool-only assistant anchors into activity bubbles.
 *
 * User messages and assistant prose are hard turn boundaries. System messages
 * are deliberately ignored here: an agent commonly stores tool output as
 * system rows between two assistant tool anchors. For anchors missing from a
 * paged transcript, event order is the only signal available, so recovery is
 * bounded by event/message counts instead of merging the entire session.
 */
export const groupConsecutiveToolMessageIds = (
  messages: Pick<AgentMessage, 'id' | 'role' | 'content'>[],
  activityMessageIds: readonly string[],
  options: ActivityGroupingOptions = {},
): string[][] => {
  if (activityMessageIds.length === 0) return [];

  const maxEventsPerGroup = Math.max(
    1,
    options.maxEventsPerGroup ?? DEFAULT_MAX_EVENTS_PER_GROUP,
  );
  const maxMessageIdsPerGroup = Math.max(
    1,
    options.maxMessageIdsPerGroup ?? DEFAULT_MAX_MESSAGE_IDS_PER_GROUP,
  );
  const eventCount = (messageId: string) =>
    Math.max(1, options.eventCountByMessageId?.get(messageId) ?? 1);
  const activityIds = new Set(activityMessageIds);
  const groups: string[][] = [];
  const seen = new Set<string>();
  let current: string[] = [];
  let currentEventCount = 0;
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    currentEventCount = 0;
  };
  const append = (messageId: string) => {
    const count = eventCount(messageId);
    if (
      current.length > 0 &&
      (current.length >= maxMessageIdsPerGroup ||
        currentEventCount + count > maxEventsPerGroup)
    ) {
      flush();
    }
    current.push(messageId);
    currentEventCount += count;
  };

  for (const message of messages) {
    const isToolOnlyAssistant =
      message.role === 'assistant' &&
      message.content.trim() === '' &&
      activityIds.has(message.id);
    if (isToolOnlyAssistant) {
      append(message.id);
      seen.add(message.id);
    } else if (
      message.role === 'user' ||
      (message.role === 'assistant' && message.content.trim() !== '')
    ) {
      // System rows are usually tool output and do not end the current run.
      flush();
    }
  }
  flush();

  for (const messageId of activityMessageIds) {
    if (seen.has(messageId)) continue;
    append(messageId);
    seen.add(messageId);
  }
  flush();
  return groups;
};
