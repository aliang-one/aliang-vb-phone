import type { AgentMessage } from '../data/platformModels';

/**
 * A folded group of server-hidden messages (see {@link AgentMessage.hiddenAt})
 * that belong to the same abandoned/closed Goal (see {@link AgentMessage.goalId}).
 *
 * The session screen renders one {@link GoalDeletedFold} per group at the
 * group's first-message position in the conversation timeline, instead of
 * letting those messages flow through {@link buildDisplayTranscript} /
 * {@link buildConversationTurns} as ordinary bubbles.
 *
 * Grouping is GLOBAL by `goalId`: messages belonging to one Goal are pulled
 * together even if they were scattered across the original transcript (e.g.
 * interleaved with assistant/user turns or another Goal's chatter). The
 * anchor timestamp is the EARLIEST hidden message's timestamp so the fold
 * lands at the chronological position where the Goal's content first appeared.
 *
 * `objective` is the Goal's objective line if the parent knows it (e.g. from a
 * historical goalSummary). When unavailable the consumer falls back to a
 * placeholder.
 */
export interface GoalFoldGroup {
  goalId: string;
  objective?: string;
  messages: AgentMessage[];
  /** ISO timestamp of the earliest hidden message in this group. */
  anchorTimestamp: string;
}

const isHidden = (message: AgentMessage): boolean => Boolean(message.hiddenAt);

/**
 * Group hidden messages by `goalId` (globally — order-independent) and return
 * the groups sorted by their earliest message timestamp ascending. Messages
 * without a `goalId` are ignored (a hidden message without a Goal attribution
 * has no fold to live in — the server should always pair `hiddenAt` with a
 * `goalId`).
 *
 * Pure function, deterministic. Order of messages within a group follows the
 * input order (callers pass chronologically-sorted transcripts); order of
 * groups follows the anchor timestamp.
 */
export const buildGoalFolds = (
  messages: AgentMessage[],
): GoalFoldGroup[] => {
  const byGoalId = new Map<string, AgentMessage[]>();
  for (const message of messages) {
    if (!isHidden(message)) continue;
    const goalId = message.goalId;
    if (!goalId) continue;
    const bucket = byGoalId.get(goalId);
    if (bucket) bucket.push(message);
    else byGoalId.set(goalId, [message]);
  }

  const groups: GoalFoldGroup[] = [];
  for (const [goalId, groupMessages] of byGoalId) {
    let anchor = groupMessages[0]?.timestamp;
    for (let i = 1; i < groupMessages.length; i += 1) {
      const ts = groupMessages[i].timestamp;
      if (anchor === undefined || ts < anchor) anchor = ts;
    }
    if (anchor === undefined) continue;
    groups.push({
      goalId,
      messages: groupMessages,
      anchorTimestamp: anchor,
    });
  }

  groups.sort((left, right) => {
    if (left.anchorTimestamp !== right.anchorTimestamp) {
      return left.anchorTimestamp < right.anchorTimestamp ? -1 : 1;
    }
    return left.goalId < right.goalId ? -1 : 1;
  });

  return groups;
};

/**
 * Test helper: split a transcript into visible messages (those that should
 * still flow through the ordinary transcript/turn pipeline) plus the hidden
 * fold groups. The session screen uses this to filter `displayTranscriptSource`
 * and seed {@link buildGoalFolds} in one pass.
 */
export const partitionHiddenGoalMessages = (
  messages: AgentMessage[],
): { visible: AgentMessage[]; folds: GoalFoldGroup[] } => {
  const visible: AgentMessage[] = [];
  const hidden: AgentMessage[] = [];
  for (const message of messages) {
    if (isHidden(message) && message.goalId) hidden.push(message);
    else visible.push(message);
  }
  return { visible, folds: buildGoalFolds(hidden) };
};
