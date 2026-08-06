/**
 * useConversationTranscript — projects the session's raw transcript +
 * structured events into the display transcript, conversation turns, and
 * incremental lists the conversation UI renders.
 *
 * Extracted from VibeCodingSessionScreen to reduce the screen's useMemo sprawl.
 * All derivations are pure projections of session data — no side effects.
 */
import { useMemo } from 'react';
import type {
  AgentMessage,
  StructuredActivityEvent,
  VibeCodingRun,
} from '../../data/platformModels';
import { buildDisplayTranscript } from '../../utils/agentTranscript';
import { buildConversationTurns, type ConversationTurn } from '../../utils/conversationTurns';
import { buildGoalFolds, type GoalFoldGroup } from '../../utils/goalFolds';
import { useThrottledValue } from '../../hooks/useThrottledValue';
import { useIncrementalList } from '../../hooks/useIncrementalList';

const EMPTY_TRANSCRIPT: AgentMessage[] = [];
const EMPTY_ACTIVITY_EVENTS: StructuredActivityEvent[] = [];
const LIVE_TRANSCRIPT_RENDER_MS = 200;

export interface ConversationTranscriptInput {
  session: VibeCodingRun | undefined;
  targetSessionId: string | undefined;
  isSessionLive: boolean;
}

export interface ConversationTranscript {
  displayTranscriptSource: AgentMessage[];
  transcript: ReturnType<typeof buildDisplayTranscript>;
  goalFolds: GoalFoldGroup[];
  conversationTurns: ConversationTurn[];
  visibleTurns: ConversationTurn[];
  visibleTurnLayoutKey: string;
  activityEventsByDisplayMessageId: Map<string, StructuredActivityEvent[]>;
  activityEventsByMessageId: Map<string, StructuredActivityEvent[]>;
  activityEventCountsByMessageId: Map<string, number>;
  visibleSessionEvents: VibeCodingRun['events'];
  visibleAgentEvents: VibeCodingRun['events'];
  latestAgentEvent: VibeCodingRun['events'][number] | undefined;
  hasServerEarlierMessages: boolean;
  turnListHasMore: boolean;
  turnList: ReturnType<typeof useIncrementalList<ConversationTurn>>;
  agentEventList: ReturnType<typeof useIncrementalList<VibeCodingRun['events'][number]>>;
  showMoreTurns: () => void;
  showMoreAgentEvents: () => void;
}

export function useConversationTranscript(
  input: ConversationTranscriptInput,
): ConversationTranscript {
  const { session, targetSessionId, isSessionLive } = input;

  const displayTranscriptSource = useThrottledValue(
    session?.transcript ?? EMPTY_TRANSCRIPT,
    isSessionLive ? LIVE_TRANSCRIPT_RENDER_MS : 0,
  );

  const visibleDisplaySource = useMemo(
    () =>
      displayTranscriptSource.filter(
        message => !(message.hiddenAt && message.goalId),
      ),
    [displayTranscriptSource],
  );

  const goalFolds = useMemo<GoalFoldGroup[]>(
    () => buildGoalFolds(displayTranscriptSource),
    [displayTranscriptSource],
  );

  const transcript = useMemo(
    () => buildDisplayTranscript(visibleDisplaySource),
    [visibleDisplaySource],
  );

  const activityEventsByMessageId = useMemo(() => {
    const byMessageId = new Map<string, StructuredActivityEvent[]>();
    for (const event of session?.structuredEvents ?? EMPTY_ACTIVITY_EVENTS) {
      if (!event.messageId) continue;
      const list = byMessageId.get(event.messageId);
      if (list) {
        list.push(event);
      } else {
        byMessageId.set(event.messageId, [event]);
      }
    }
    return byMessageId;
  }, [session?.structuredEvents]);

  const activityEventCountsByMessageId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [messageId, events] of activityEventsByMessageId) {
      counts.set(messageId, events.length);
    }
    return counts;
  }, [activityEventsByMessageId]);

  const sourceToDisplayMessageId = useMemo(() => {
    const bySourceId = new Map<string, string>();
    for (const message of transcript) {
      if (message.role !== 'assistant') continue;
      for (const sourceId of message.sourceMessageIds) {
        bySourceId.set(sourceId, message.id);
      }
    }
    return bySourceId;
  }, [transcript]);

  const activityEventsByDisplayMessageId = useMemo(() => {
    const byDisplayMessageId = new Map<string, StructuredActivityEvent[]>();
    for (const [sourceMessageId, events] of activityEventsByMessageId) {
      const displayId = sourceToDisplayMessageId.get(sourceMessageId);
      if (!displayId) continue;
      const existing = byDisplayMessageId.get(displayId);
      if (existing) existing.push(...events);
      else byDisplayMessageId.set(displayId, events.slice());
    }
    return byDisplayMessageId;
  }, [activityEventsByMessageId, sourceToDisplayMessageId]);

  const conversationTurns = useMemo(
    () => buildConversationTurns(transcript),
    [transcript],
  );

  const visibleSessionEvents = useMemo(
    () =>
      (session?.events ?? []).filter(
        event => event.title !== 'Imported local vibe session',
      ),
    [session?.events],
  );

  const turnList = useIncrementalList(conversationTurns, {
    initialCount: 12,
    step: 12,
    from: 'end',
    resetKey: targetSessionId,
  });
  const agentEventList = useIncrementalList(visibleSessionEvents, {
    initialCount: 12,
    step: 12,
    from: 'end',
    resetKey: targetSessionId,
  });

  const visibleTurns = turnList.visibleItems;
  const visibleAgentEvents = agentEventList.visibleItems;
  const latestAgentEvent =
    visibleSessionEvents[visibleSessionEvents.length - 1];
  const hasServerEarlierMessages = Boolean(
    session?.transcriptPage?.hasMore &&
      session?.transcriptPage?.nextBeforeCursor,
  );
  const visibleTurnLayoutKey = useMemo(
    () => visibleTurns.map(turn => turn.id).join('|'),
    [visibleTurns],
  );

  return {
    displayTranscriptSource,
    transcript,
    goalFolds,
    conversationTurns,
    visibleTurns,
    visibleTurnLayoutKey,
    activityEventsByDisplayMessageId,
    activityEventsByMessageId,
    activityEventCountsByMessageId,
    visibleSessionEvents,
    visibleAgentEvents,
    latestAgentEvent,
    hasServerEarlierMessages,
    turnList,
    agentEventList,
    turnListHasMore: turnList.hasMore,
    showMoreTurns: turnList.showMore,
    showMoreAgentEvents: agentEventList.showMore,
  };
}
