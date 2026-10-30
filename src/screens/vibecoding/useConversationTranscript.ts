/**
 * useConversationTranscript — projects the session's raw transcript +
 * structured events into the display transcript, conversation turns, and
 * incremental lists the conversation UI renders.
 *
 * Extracted from VibeCodingSessionScreen to reduce the screen's useMemo sprawl.
 * All derivations are pure projections of session data — no side effects.
 */
import { useMemo, useRef } from 'react';
import type {
  AgentMessage,
  StructuredActivityEvent,
  VibeCodingRun,
} from '../../data/platformModels';
import {
  applyStreamingPlainTail,
  buildDisplayTranscript,
} from '../../utils/agentTranscript';
import { buildConversationTurns, type ConversationTurn } from '../../utils/conversationTurns';
import { reuseStablePrefix } from '../../utils/arrayReuse';
import { buildGoalFolds, type GoalFoldGroup } from '../../utils/goalFolds';
import { isDeviceLinkReleaseNotice } from '../../utils/conversationTimeline';
import { hasEarlierForRun } from '../../store/internals';
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
  /** Stable: widen the mounted-turn window to cover a needed visible count
   *  (scrubber commit jumps to turns outside the window). */
  revealTurnsThrough: (neededVisibleCount: number) => void;
  showMoreAgentEvents: () => void;
}

export function useConversationTranscript(
  input: ConversationTranscriptInput,
): ConversationTranscript {
  const { session, targetSessionId, isSessionLive } = input;

  // 流式身份保留(C2)的上一轮缓存:转录条目/回合里除尾条外每轮逐字段
  // 相同,reuseStablePrefix 让稳定前缀沿用旧对象引用,下游 memo/依赖链
  // 不再随每 200ms 的重建连锁失效(长会话 O(n) 分配+重渲染底噪的根源)。
  const reuseRef = useRef<{
    transcript: ReturnType<typeof buildDisplayTranscript>;
    turns: ConversationTurn[];
    transcriptMapSig: string;
    sourceToDisplayMessageId: Map<string, string>;
  }>({
    transcript: [],
    turns: [],
    transcriptMapSig: '',
    sourceToDisplayMessageId: new Map<string, string>(),
  });

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
    () => {
      const built = buildDisplayTranscript(visibleDisplaySource);
      // 流式纯文本降级:会话活跃时尾 assistant 气泡改走手工纯文本块
      // (零 markdown 解析),吐字(含积压排空突进)渲染成本 O(1);
      // settle 后 0ms 门立即换回全量 markdown。再叠稳定前缀复用:
      // 除尾条外条目沿用上一轮对象引用。
      const withTail = isSessionLive ? applyStreamingPlainTail(built) : built;
      // key 必须含哨兵原样参与:流式中哨兵+全文 vs settle 后纯全文,
      // 两者 key 必须不同,否则 settle 会被前缀复用拦下、气泡停在纯文本。
      const reused = reuseStablePrefix(
        reuseRef.current.transcript,
        withTail,
        entry => `${entry.id}\u0000${entry.contentKey ?? ''}`,
      );
      reuseRef.current.transcript = reused;
      return reused;
    },
    [visibleDisplaySource, isSessionLive],
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
    // 签名守卫:该映射只由条目 id/role/sourceMessageIds 决定,尾泡内容增长
    // 不改映射——签名(长度+首尾 id)不变时复用上一轮 Map,下游
    // activityEventsByDisplayMessageId 链随之在纯文本流式期间保持稳定。
    const sig = `${transcript.length}:${transcript[0]?.id ?? ''}:${
      transcript[transcript.length - 1]?.id ?? ''
    }`;
    if (reuseRef.current.transcriptMapSig === sig) {
      return reuseRef.current.sourceToDisplayMessageId;
    }
    const bySourceId = new Map<string, string>();
    for (const message of transcript) {
      if (message.role !== 'assistant') continue;
      for (const sourceId of message.sourceMessageIds) {
        bySourceId.set(sourceId, message.id);
      }
    }
    reuseRef.current.transcriptMapSig = sig;
    reuseRef.current.sourceToDisplayMessageId = bySourceId;
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
    () => {
      const built = buildConversationTurns(transcript);
      // 回合身份保留:回合 key = id + 消息数 + 尾消息 contentKey,只有尾
      // 回合随流式变化,历史回合整对象复用(其 messages 内的转录条目已被
      // 上一步复用,引用链全稳定)。
      const reused = reuseStablePrefix(
        reuseRef.current.turns,
        built,
        turn =>
          `${turn.id}\u0000${turn.messages.length}\u0000${
            turn.messages[turn.messages.length - 1]?.contentKey ?? ''
          }`,
      );
      reuseRef.current.turns = reused;
      return reused;
    },
    [transcript],
  );

  const visibleSessionEvents = useMemo(
    () =>
      (session?.events ?? []).filter(
        event =>
          event.title !== 'Imported local vibe session' &&
          // Server disconnect-release notices are device-link history, not
          // conversation events — see isDeviceLinkReleaseNotice. Filtering
          // them here also keeps a stale one from painting the collapsed
          // timeline badge (latestAgentEvent) red next to the refresh key.
          !isDeviceLinkReleaseNotice(event),
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
  // 闸门真值 = total_count 对比(hasEarlierForRun):`hasMore && nextBeforeCursor`
  // 的旧判定在 trim 之后把仍可翻页的会话误判为到头(审计问题6),且自编码
  // 游标让"必须已有服务端 cursor"这个前提不再成立。
  const hasServerEarlierMessages = session
    ? hasEarlierForRun(session)
    : false;
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
    revealTurnsThrough: turnList.revealThrough,
    showMoreAgentEvents: agentEventList.showMore,
  };
}
