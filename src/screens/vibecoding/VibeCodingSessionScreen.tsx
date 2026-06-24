import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { SuggestionActionBar } from '../../components/vibecoding/SuggestionActionBar';
import { ToolsMenu } from '../../components/vibecoding/ToolsMenu';
import { MessageComposer } from '../../components/vibecoding/MessageComposer';
import { mergeCommands } from '../../utils/agentCommands';
import { TranscriptMessageList } from '../../components/vibecoding/TranscriptMessageList';
import { ConversationScrubber } from '../../components/vibecoding/ConversationScrubber';
import { ResolvedApprovalsGroup } from '../../components/vibecoding/ResolvedApprovalsGroup';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useVibeRun,
  useProject,
  useDevice,
  useSessionPreview,
  useSessionApprovals,
} from '../../store/controlCenterStore';
import type { ApprovalRequest } from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import type {
  AgentBudgetInfo,
  StructuredActivityEvent,
  VibeCodingRun,
} from '../../data/platformModels';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import {
  catalogEffortOptions,
  useModelOptions,
} from '../../hooks/useModelOptions';
import { buildDisplayTranscript } from '../../utils/agentTranscript';
import {
  approvalTimelineItemId,
  buildConversationTimeline,
} from '../../utils/conversationTimeline';
import { deriveTurnScrubberStops } from '../../utils/conversationScrubber';
import {
  buildConversationTurns,
} from '../../utils/conversationTurns';
import {
  deriveSessionPhase,
  liveAssistantMessageId,
  sessionPhaseLabel,
  sessionPhaseType,
} from '../../utils/sessionPhase';
import { deriveLivePulse } from '../../utils/activitySummary';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import { useNowTick } from '../../hooks/useNowTick';
import { useVoiceStt } from '../../hooks/useVoiceStt';
import { normalizeProvider } from '../../utils/modelIntensity';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;
type MessageTimelinePosition = 'single' | 'start' | 'middle' | 'end';

// During streaming the store updates on a ~60ms cadence; driving scroll-driven
// state at 60fps on top of that re-runs the conversation-rail computation every
// frame. Throttle the scroll→state bridge so the rail only recomputes a few
// times per second (leading edge) plus one trailing update when scrolling stops.
const SCROLL_THROTTLE_MS = 80;
// Kept slightly above the server's agent round-trip ceiling
// (AGENT_REQUEST_TIMEOUT_MS = 12s) so the in-band detail response — which may
// wait for the desktop Agent to answer ai.session.detail — isn't pre-empted by
// the screen race. The underlying HTTP request uses its own 15s timeout too
// (fetchAiSession); this race is the safety net on top.
const DETAIL_LOAD_TIMEOUT_MS = 15000;
const SCROLL_FOLLOW_THRESHOLD = 180;
const EMPTY_ACTIVITY_EVENTS: StructuredActivityEvent[] = [];

const eventIcon: Record<string, IconName> = {
  command: 'terminal',
  file: 'code',
  test: 'check',
  preview: 'preview',
  approval: 'approval',
  status: 'event',
};

const formatBudget = (budget?: AgentBudgetInfo) =>
  budget
    ? `${budget.currencySymbol}${budget.used.toFixed(2)} / ${
        budget.currencySymbol
      }${budget.limit}`
    : '';

const hasActivityMessageId = (
  event: StructuredActivityEvent,
): event is Extract<StructuredActivityEvent, { messageId: string }> =>
  'messageId' in event &&
  typeof (event as { messageId?: unknown }).messageId === 'string';

// Splits a formatted session title ("Subject · meta · meta …" — the parts are
// joined by formatVibeSessionTitle with ' · ') into a primary subject and a
// metadata tail. Drives the tiered title rendering: head = large caps, tail =
// small, anything beyond one line is folded (tap the chevron to expand). A
// custom title with no ' · ' collapses to a head-only render.
const splitSessionTitle = (title: string): { head: string; tail: string } => {
  const idx = title.indexOf(' · ');
  if (idx === -1) return { head: title, tail: '' };
  return {
    head: title.slice(0, idx).trim(),
    tail: title.slice(idx + 3).trim(),
  };
};

const formatConversationBoundaryTime = (timestamp?: string) => {
  if (!timestamp) return '';
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return timestamp;
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const VibeCodingSessionScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionRoute>();
  // Fine-grained selectors: subscribe only to the specific session/project/
  // device/preview the user is viewing, so streaming deltas on OTHER sessions
  // don't trigger re-renders here.
  const liveSession = useVibeRun(route.params.sessionId);
  const cachedSessionRef = useRef<VibeCodingRun | null>(null);
  const session =
    liveSession ??
    (cachedSessionRef.current?.id === route.params.sessionId
      ? cachedSessionRef.current
      : undefined);
  useEffect(() => {
    if (liveSession?.id === route.params.sessionId) {
      cachedSessionRef.current = liveSession;
    } else if (cachedSessionRef.current?.id !== route.params.sessionId) {
      cachedSessionRef.current = null;
    }
  }, [liveSession, route.params.sessionId]);
  const project = useProject(session?.projectId);
  const device = useDevice(session?.deviceId);
  const preview = useSessionPreview(session?.id);
  const sessionApprovals = useSessionApprovals(session?.id);
  const allApprovals = useControlCenterStore(state => state.approvals);
  const globalEvents = useControlCenterStore(state => state.events);
  const wsConnected = useControlCenterStore(state => state.wsConnected);
  const loadAgentSessionDetail = useControlCenterStore(
    state => state.loadAgentSessionDetail,
  );
  const loadEarlierAgentMessages = useControlCenterStore(
    state => state.loadEarlierAgentMessages,
  );
  const resolveApproval = useControlCenterStore(state => state.resolveApproval);
  const appendAgentMessage = useControlCenterStore(
    state => state.appendAgentMessage,
  );
  const retryAgentMessage = useControlCenterStore(
    state => state.retryAgentMessage,
  );
  const dismissFailedMessage = useControlCenterStore(
    state => state.dismissFailedMessage,
  );
  const interruptAgentSession = useControlCenterStore(
    state => state.interruptAgentSession,
  );
  const markSessionViewed = useControlCenterStore(
    state => state.markSessionViewed,
  );
  const clearCurrentlyViewedSession = useControlCenterStore(
    state => state.clearCurrentlyViewedSession,
  );

  // Track this session as the one the user is viewing so the idle-demoter
  // never clears its resident data mid-view (which would flash a reload). Mark
  // on focus, clear on blur/leave. lastViewedAt is retained on blur so the idle
  // threshold clock keeps running for this session.
  const focusedSessionId = route.params.sessionId;
  useFocusEffect(
    useCallback(() => {
      markSessionViewed(focusedSessionId);
      return () => {
        clearCurrentlyViewedSession();
      };
    }, [focusedSessionId, markSessionViewed, clearCurrentlyViewedSession]),
  );
  const updateAgentSession = useControlCenterStore(
    state => state.updateAgentSession,
  );
  const cacheStructuredDetail = useControlCenterStore(
    state => state.cacheStructuredDetail,
  );

  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [input, setInput] = useState('');
  const [voiceDraft, setVoiceDraft] = useState('');
  const voiceStt = useVoiceStt();
  const { providerCatalog } = useModelOptions();
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  // Drives the ScrollView's RefreshControl. Pull-to-refresh forces a server
  // re-fetch (`refresh: true`) so an empty / offline result can recover — the
  // auto-load on mount only fires once and respects the cache.
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Dedicated spinner for the bottom-bubble "refresh latest" action. Kept
  // separate from `refreshing` (which now drives the pull-to-load-earlier
  // indicator) so the bubble can show its own state without hijacking the pull.
  const [refreshingLatest, setRefreshingLatest] = useState(false);
  // Transient "已是最早的消息" notice: shown when the user pulls at the top but
  // there is no earlier history to load (and the conversation isn't blank).
  const [noMoreEarlierHint, setNoMoreEarlierHint] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollYRef = useRef(0);
  const followTailRef = useRef(true);
  const pendingScrollToEndRef = useRef(false);
  const lastScrollSetRef = useRef(0);
  const trailingScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollToEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLockRef = useRef<string | null>(null);
  // Guards the mount auto-fetch against re-firing when a transient-empty
  // (skipped_offline / failed) detail result leaves `hasDetail` false. Without
  // it the fetch effect would loop on every render once the store no longer
  // stamps detailLoadedAt for transient-empty results. Reset on session change.
  const autoFetchRef = useRef(false);
  // Tracks the false→true edge of the "recoverable blank conversation" state so
  // the agent-online recovery refresh fires once per transition, not per render.
  const prevRecoverableRef = useRef(false);
  // Pins the viewport to the topmost message while an earlier-history page is
  // prepended above it, so loading older doesn't shove what the user is reading
  // out of view. Set right before a reveal/fetch; consumed (and cleared) by the
  // preserve-focus effect once the focus message is re-measured post-prepend.
  const preserveFocusRef = useRef<{
    id: string;
    distance: number;
    prevTop: number;
  } | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [interruptingTurn, setInterruptingTurn] = useState(false);
  const [toolsMenuVisible, setToolsMenuVisible] = useState(false);
  const [resolvingApproval, setResolvingApproval] = useState<{
    id: string;
    decision: 'approved' | 'denied';
  } | null>(null);
  const focusedApprovalId = route.params.approvalId;
  const resolvableApprovalIds = useMemo(
    () => new Set(allApprovals.map(approval => approval.id)),
    [allApprovals],
  );

  const scheduleScrollToEnd = useCallback((animated = true) => {
    if (scrollToEndTimer.current) {
      clearTimeout(scrollToEndTimer.current);
    }
    scrollToEndTimer.current = setTimeout(() => {
      scrollToEndTimer.current = null;
      scrollViewRef.current?.scrollToEnd({ animated });
    }, 0);
  }, []);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    followTailRef.current =
      contentSize.height - (y + layoutMeasurement.height) <=
      SCROLL_FOLLOW_THRESHOLD;
    scrollYRef.current = y;
    const now = Date.now();
    if (now - lastScrollSetRef.current >= SCROLL_THROTTLE_MS) {
      lastScrollSetRef.current = now;
      if (trailingScrollTimer.current) {
        clearTimeout(trailingScrollTimer.current);
        trailingScrollTimer.current = null;
      }
      setScrollY(y);
    } else if (!trailingScrollTimer.current) {
      trailingScrollTimer.current = setTimeout(() => {
        trailingScrollTimer.current = null;
        lastScrollSetRef.current = Date.now();
        setScrollY(scrollYRef.current);
      }, SCROLL_THROTTLE_MS);
    }
  };
  const [conversationTop, setConversationTop] = useState(0);
  const [messageLayouts, setMessageLayouts] = useState<
    Record<string, { top: number; height: number }>
  >({});
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  // Conversation scrubber (the right-edge magnifier locator). `pendingJumpId`
  // targets already-mounted timeline items; older history loads in chunks.
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const targetSessionId = session?.id ?? route.params.sessionId;
  const transcript = useMemo(
    () => buildDisplayTranscript(session?.transcript ?? []),
    [session?.transcript],
  );
  const activityEventsByMessageId = useMemo(() => {
    const byMessageId = new Map<string, StructuredActivityEvent[]>();
    for (const event of session?.structuredEvents ?? EMPTY_ACTIVITY_EVENTS) {
      if (!hasActivityMessageId(event)) continue;
      const list = byMessageId.get(event.messageId);
      if (list) {
        list.push(event);
      } else {
        byMessageId.set(event.messageId, [event]);
      }
    }
    return byMessageId;
  }, [session?.structuredEvents]);
  const activityEventsByDisplayMessageId = useMemo(() => {
    const byDisplayMessageId = new Map<string, StructuredActivityEvent[]>();
    for (const message of transcript) {
      if (message.role !== 'assistant') continue;
      const events: StructuredActivityEvent[] = [];
      for (const messageId of message.sourceMessageIds) {
        const sourceEvents = activityEventsByMessageId.get(messageId);
        if (sourceEvents) events.push(...sourceEvents);
      }
      if (events.length) {
        byDisplayMessageId.set(message.id, events);
      }
    }
    return byDisplayMessageId;
  }, [activityEventsByMessageId, transcript]);
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
  // sessionApprovals now comes from the useSessionApprovals selector above;
  // no need to re-derive here.
  const visibleTurns = turnList.visibleItems;
  const visibleAgentEvents = agentEventList.visibleItems;
  const latestAgentEvent =
    visibleSessionEvents[visibleSessionEvents.length - 1];
  const hasServerEarlierMessages = Boolean(
    session?.transcriptPage?.hasMore &&
      session?.transcriptPage?.nextBeforeCursor,
  );
  const latestTranscriptKey = useMemo(() => {
    if (!session) return `${targetSessionId}:empty`;
    const latest = session.transcript[session.transcript.length - 1];
    if (!latest) return `${targetSessionId}:empty`;
    return [
      targetSessionId,
      session.transcript.length,
      latest.id,
      latest.role,
      latest.content.length,
    ].join(':');
  }, [session, targetSessionId]);
  const visibleTurnLayoutKey = useMemo(
    () => visibleTurns.map(turn => turn.id).join('|'),
    [visibleTurns],
  );
  const visibleTurnIds = useMemo(
    () => new Set(visibleTurns.map(turn => turn.id)),
    [visibleTurns],
  );
  const activeRailTurnId = useMemo(() => {
    if (!visibleTurns.length) return undefined;
    const fallbackId = visibleTurns[visibleTurns.length - 1]?.id;
    if (!viewportHeight) return fallbackId;

    const focusY =
      scrollY + Math.min(Math.max(viewportHeight * 0.46, 160), 380);
    let activeId = fallbackId;
    let activeDistance = Number.POSITIVE_INFINITY;

    for (const turn of visibleTurns) {
      const layout = messageLayouts[turn.id];
      if (!layout) continue;
      // Absolute position in the scroll content = container offset + message offset.
      const center = conversationTop + layout.top + layout.height / 2;
      const distance = Math.abs(center - focusY);
      if (distance < activeDistance) {
        activeDistance = distance;
        activeId = turn.id;
      }
    }

    return activeId;
  }, [
    messageLayouts,
    scrollY,
    viewportHeight,
    visibleTurns,
    conversationTop,
  ]);
  const conversationRailItems = useMemo(() => {
    if (!visibleTurns.length) return [];
    const maxMarks = 16;
    const activeIndex = activeRailTurnId
      ? visibleTurns.findIndex(turn => turn.id === activeRailTurnId)
      : -1;
    const indices = new Set<number>();

    if (visibleTurns.length <= maxMarks) {
      visibleTurns.forEach((_, index) => indices.add(index));
    } else {
      const slots = activeIndex >= 0 ? maxMarks - 1 : maxMarks;
      const denominator = Math.max(1, slots - 1);
      for (let index = 0; index < slots; index += 1) {
        indices.add(
          Math.round((index * (visibleTurns.length - 1)) / denominator),
        );
      }
      if (activeIndex >= 0) indices.add(activeIndex);
    }

    return Array.from(indices)
      .sort((left, right) => left - right)
      .map(index => {
        const turn = visibleTurns[index];
        return {
          turn,
          active: turn.id === activeRailTurnId,
          visible: visibleTurnIds.has(turn.id),
        };
      });
  }, [activeRailTurnId, visibleTurns, visibleTurnIds]);
  const scrubberStops = useMemo(
    () => deriveTurnScrubberStops(visibleTurns),
    [visibleTurns],
  );
  // The user-turn stop nearest the viewport's focus message — the scrubber's
  // idle preview position. Falls back to the latest stop when the active
  // message can't be resolved (e.g. before any layout has landed).
  const activeScrubberStopId = useMemo(() => {
    if (!scrubberStops.length) return undefined;
    const fallbackId = scrubberStops[scrubberStops.length - 1].id;
    if (!activeRailTurnId) return fallbackId;
    const activeIndex = visibleTurns.findIndex(
      turn => turn.id === activeRailTurnId,
    );
    if (activeIndex < 0) return fallbackId;
    const stopIds = new Set(scrubberStops.map(stop => stop.id));
    let nearestId = fallbackId;
    let nearestDistance = Number.POSITIVE_INFINITY;
    visibleTurns.forEach((turn, index) => {
      if (!stopIds.has(turn.id)) return;
      const distance = Math.abs(index - activeIndex);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = turn.id;
      }
    });
    return nearestId;
  }, [scrubberStops, activeRailTurnId, visibleTurns]);

  // First-fetch guard: skip the auto-load only when we already hold the
  // transcript detail (a prior fetch set detailLoadedAt, or a hot window
  // delivered messages). DO NOT count events — a session can carry lifecycle
  // events while its hot transcript is empty (status-only WS updates), and
  // counting those would suppress the fetch and leave the chat blank.
  const hasDetail = Boolean(
    session?.detailLoadedAt || session?.transcript.length,
  );

  useEffect(() => {
    if (!targetSessionId || hasDetail || loadingDetail || detailError) return;
    // A transient-empty result no longer stamps detailLoadedAt, so hasDetail
    // stays false after such a fetch — without this guard the effect would
    // re-fire immediately and loop. One auto-attempt per mount is enough; live
    // recovery is handled by the recoverable-conversation effect below.
    if (autoFetchRef.current) return;
    autoFetchRef.current = true;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setLoadingDetail(true);
    setDetailError('');

    const detailLoad = loadAgentSessionDetail(targetSessionId);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('完整会话内容拉取超时，实时消息会继续显示。')),
        DETAIL_LOAD_TIMEOUT_MS,
      );
    });

    void Promise.race([detailLoad, timeout])
      .catch(error => {
        if (!cancelled) {
          setDetailError(
            error instanceof Error
              ? error.message
              : 'Failed to load session detail.',
          );
        }
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    detailError,
    hasDetail,
    loadAgentSessionDetail,
    loadingDetail,
    targetSessionId,
  ]);

  // Pull-to-refresh + retry entry point. Unlike the mount auto-load (which runs
  // once and respects the server's page cache), this forces `refresh: true` so
  // the server re-asks the agent — the only way to recover from an earlier
  // empty/offline result. Always fires regardless of hasDetail/detailError.
  // Force a fresh agent detail fetch — the "refresh latest / recover" path that
  // re-asks the agent for the newest transcript snapshot. This is the ONLY way
  // to recover from an earlier blank/offline result. Exposed as a dedicated
  // affordance on the bottom status bubble, so pull-to-refresh can stay
  // dedicated to "load earlier history".
  const handleRefreshLatest = useCallback(async () => {
    if (!targetSessionId) return;
    setRefreshingLatest(true);
    setDetailError('');
    try {
      await loadAgentSessionDetail(targetSessionId, { refresh: true });
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : 'Failed to load session detail.',
      );
    } finally {
      setRefreshingLatest(false);
    }
  }, [loadAgentSessionDetail, targetSessionId]);

  // Capture the topmost visible message so the viewport can be pinned to it
  // once older messages are prepended above (otherwise prepending content
  // shoves what the user is reading down / out of view).
  const capturePreserveFocus = useCallback(() => {
    const focusId = visibleTurns[0]?.id;
    const focusLayout = focusId ? messageLayouts[focusId] : undefined;
    if (!focusId || !focusLayout) return;
    preserveFocusRef.current = {
      id: focusId,
      distance: Math.max(
        0,
        conversationTop + focusLayout.top - scrollYRef.current,
      ),
      prevTop: focusLayout.top,
    };
  }, [conversationTop, messageLayouts, visibleTurns]);

  const handleLoadEarlierMessages = useCallback(async () => {
    if (!targetSessionId || loadingEarlier) return;
    if (turnList.hasMore) {
      // Reveal more of the locally-held transcript (no network). Pin first so
      // the newly revealed older messages appear above without a viewport jump.
      capturePreserveFocus();
      turnList.showMore();
      return;
    }
    if (hasServerEarlierMessages) {
      capturePreserveFocus();
      setLoadingEarlier(true);
      setDetailError('');
      try {
        await loadEarlierAgentMessages(targetSessionId);
        turnList.showMore();
      } catch (error) {
        preserveFocusRef.current = null;
        setDetailError(
          error instanceof Error
            ? error.message
            : 'Failed to load earlier messages.',
        );
      } finally {
        setLoadingEarlier(false);
      }
      return;
    }
  }, [
    capturePreserveFocus,
    hasServerEarlierMessages,
    loadEarlierAgentMessages,
    loadingEarlier,
    targetSessionId,
    turnList,
  ]);

  // Pull-to-refresh dispatcher. In a chat, pulling at the top = "load earlier
  // history" (the universal pattern), NOT "refresh the latest snapshot". So:
  //   • reveal locally-held older messages / fetch the previous server page;
  //   • if we're genuinely at the beginning of the conversation (have messages
  //     but nothing earlier), surface a brief "已是最早消息" notice;
  //   • only if the conversation is blank/offline (nothing held at all) do we
  //     fall back to a forced agent refresh to recover the latest snapshot.
  const handleRefresh = useCallback(async () => {
    if (!targetSessionId) return;
    if (turnList.hasMore || hasServerEarlierMessages) {
      setRefreshing(true);
      try {
        await handleLoadEarlierMessages();
      } finally {
        setRefreshing(false);
      }
      return;
    }
    if ((session?.transcript.length ?? 0) > 0) {
      setNoMoreEarlierHint(true);
      return;
    }
    setRefreshing(true);
    setDetailError('');
    try {
      await handleRefreshLatest();
    } finally {
      setRefreshing(false);
    }
  }, [
    handleLoadEarlierMessages,
    handleRefreshLatest,
    hasServerEarlierMessages,
    session?.transcript.length,
    targetSessionId,
    turnList,
  ]);

  useEffect(() => {
    const visibleIds = new Set(visibleTurns.map(turn => turn.id));
    setMessageLayouts(current => {
      const next: Record<string, { top: number; height: number }> = {};
      for (const [itemId, layout] of Object.entries(current)) {
        if (visibleIds.has(itemId) || itemId.startsWith('approval:')) {
          next[itemId] = layout;
        }
      }
      if (Object.keys(next).length === Object.keys(current).length) {
        return current;
      }
      return next;
    });
  }, [targetSessionId, visibleTurns, visibleTurnLayoutKey]);

  useEffect(() => {
    setTimelineExpanded(false);
    setScrollY(0);
    scrollYRef.current = 0;
    followTailRef.current = true;
    pendingScrollToEndRef.current = true;
    autoFetchRef.current = false;
    prevRecoverableRef.current = false;
    preserveFocusRef.current = null;
    setPendingJumpId(null);
    setNoMoreEarlierHint(false);
    setMessageLayouts({});
  }, [targetSessionId]);

  // Self-heal for the "top bar DONE, conversation blank" case. The run snapshot
  // that flips session.status to completed never carries the transcript, so a
  // session whose last detail fetch was skipped_offline / failed stays empty
  // until something re-asks the agent. When the agent comes back online (device
  // offline→online, or a WS reconnect) while such a blank session is on screen,
  // fire one forced refresh. Edge-triggered so it runs once per recovery, not
  // every render; prevRecoverableRef is reset on session change above.
  const recoverableConversation =
    wsConnected &&
    device?.status !== 'offline' &&
    (session?.transcript.length ?? 0) === 0 &&
    (session?.detailRefreshStatus === 'skipped_offline' ||
      session?.detailRefreshStatus === 'failed');
  useEffect(() => {
    if (!recoverableConversation || prevRecoverableRef.current) return;
    if (!targetSessionId || refreshing || loadingDetail) return;
    prevRecoverableRef.current = true;
    void loadAgentSessionDetail(targetSessionId, { refresh: true }).catch(
      () => {},
    );
  }, [
    recoverableConversation,
    targetSessionId,
    refreshing,
    loadingDetail,
    loadAgentSessionDetail,
  ]);

  useEffect(() => {
    if (!latestTranscriptKey) return;
    if (pendingScrollToEndRef.current || followTailRef.current) {
      pendingScrollToEndRef.current = false;
      scheduleScrollToEnd(true);
    }
  }, [latestTranscriptKey, scheduleScrollToEnd]);

  useEffect(
    () => () => {
      if (trailingScrollTimer.current) {
        clearTimeout(trailingScrollTimer.current);
      }
      if (scrollToEndTimer.current) {
        clearTimeout(scrollToEndTimer.current);
      }
    },
    [],
  );

  const handleConversationItemLayout = useCallback((
    itemId: string,
    y: number,
    height: number,
  ) => {
    // Store the item's offset relative to the conversation container only.
    // `conversationTop` (the container's own offset within the scroll content) is
    // applied at calculation time so stale closure captures can't desync the rail.
    setMessageLayouts(current => {
      const existing = current[itemId];
      if (
        existing &&
        Math.abs(existing.top - y) < 1 &&
        Math.abs(existing.height - height) < 1
      ) {
        return current;
      }
      return { ...current, [itemId]: { top: y, height } };
    });
  }, []);
  // Stable callback so TranscriptMessageList's React.memo isn't defeated by a
  // fresh inline closure on every render.
  const handleCacheActivityDetail = useCallback(
    (eventId: string, detail: { text?: string; truncated?: boolean }) => {
      const sessionId = session?.id;
      if (!sessionId) return;
      cacheStructuredDetail(sessionId, eventId, detail);
    },
    [cacheStructuredDetail, session?.id],
  );

  // User settled on a visible scrubber stop → jump there. The scrubber samples
  // only mounted turns; older history still comes in via LOAD EARLIER, avoiding
  // a long-session showAll() that can freeze the JS thread.
  const handleScrubberCommit = (stopId: string) => {
    followTailRef.current = false;
    setPendingJumpId(stopId);
  };

  useEffect(() => {
    if (!pendingJumpId) return;
    const layout = messageLayouts[pendingJumpId];
    if (!layout) {
      setPendingJumpId(null);
      return;
    }
    const y = conversationTop + layout.top;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
    setPendingJumpId(null);
  }, [
    pendingJumpId,
    messageLayouts,
    conversationTop,
  ]);

  // Restore the viewport to the message that was on top before an earlier-page
  // load, once the newly-prepended older messages have re-laid-out (which
  // shifts that message's offset down). We wait until the focus message has
  // actually been re-measured (its `top` changed) so we don't pin against a
  // stale pre-prepend offset; a session change clears the ref outright above.
  // followTail is already false when pulling at the top, so the tail-follow
  // effect can't fight this.
  useEffect(() => {
    const focus = preserveFocusRef.current;
    if (!focus) return;
    const layout = messageLayouts[focus.id];
    if (!layout) return;
    if (Math.abs(layout.top - focus.prevTop) < 1) return;
    const targetY = Math.max(
      0,
      conversationTop + layout.top - focus.distance,
    );
    preserveFocusRef.current = null;
    scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
  }, [messageLayouts, conversationTop, visibleTurnLayoutKey]);

  // Auto-dismiss the "已是最早消息" notice shortly after it appears.
  useEffect(() => {
    if (!noMoreEarlierHint) return;
    const timer = setTimeout(() => setNoMoreEarlierHint(false), 1600);
    return () => clearTimeout(timer);
  }, [noMoreEarlierHint]);

  const deviceOffline = device?.status === 'offline';
  const effectiveProvider = normalizeProvider(
    session?.effectiveModelConfig?.provider ?? session?.provider,
  );
  const isConversationActiveForInput =
    session?.status === 'running' || session?.status === 'waiting_approval';
  const shouldDisableComposerForProvider =
    isConversationActiveForInput && effectiveProvider === 'claude_code';

  const appendUserMessage = async (
    content: string,
    messageMode: 'voice' | 'text',
  ) => {
    const normalizedContent = content.trim();
    if (
      !session ||
      session.status === 'failed' ||
      shouldDisableComposerForProvider ||
      !normalizedContent ||
      sendLockRef.current
    ) {
      return false;
    }
    const sendKey = `${session.id}:${messageMode}:${normalizedContent}`;
    sendLockRef.current = sendKey;
    pendingScrollToEndRef.current = true;
    setSendingMessage(true);
    // Clear any previous detail load error so a successful send won't show
    // a stale error banner alongside new messages.
    if (detailError) setDetailError('');
    try {
      await appendAgentMessage(session.id, normalizedContent, messageMode);
      return true;
    } catch (error) {
      pendingScrollToEndRef.current = false;
      throw error;
    } finally {
      if (sendLockRef.current === sendKey) {
        sendLockRef.current = null;
      }
      setSendingMessage(false);
    }
  };

  const handleVoiceCaptureStart = useCallback(() => {
    if (deviceOffline || shouldDisableComposerForProvider) return;
    if (
      voiceStt.status === 'recording' ||
      voiceStt.status === 'connecting' ||
      voiceStt.status === 'stopping'
    ) {
      return;
    }
    setVoiceDraft('');
    void voiceStt.start({
      sessionId: session?.id,
      projectPath: session?.directory ?? project?.path,
      onComplete: transcript => {
        if (transcript.trim()) {
          setVoiceDraft(transcript);
        }
      },
    });
  }, [deviceOffline, shouldDisableComposerForProvider, voiceStt, session, project]);

  const handleVoiceCaptureEnd = useCallback(() => {
    if (deviceOffline) return;
    void voiceStt.stop();
  }, [deviceOffline, voiceStt]);

  const handleVoiceCapture = useCallback(() => {
    if (
      voiceStt.status === 'recording' ||
      voiceStt.status === 'connecting' ||
      voiceStt.status === 'stopping'
    ) {
      handleVoiceCaptureEnd();
      return;
    }
    handleVoiceCaptureStart();
  }, [handleVoiceCaptureEnd, handleVoiceCaptureStart, voiceStt.status]);

  // 方案A：转写结果直接发送，不经 AI 润色。
  const handleSendVoice = () => {
    const draft = voiceDraft.trim();
    if (deviceOffline || shouldDisableComposerForProvider || !draft || sendingMessage) {
      return;
    }
    void appendUserMessage(draft, 'voice')
      .then(sent => {
        if (sent) {
          setVoiceDraft('');
        }
      })
      .catch(error => {
        console.warn('[vibecoding] failed to send voice prompt', error);
      });
  };

  // Retry a failed-to-send user bubble directly from its affordance (never via
  // the composer input, so it can't combine with other text).
  const handleRetryFailedMessage = useCallback(
    (messageId: string) => {
      if (!session || sendingMessage) return;
      void retryAgentMessage(session.id, messageId).catch(error => {
        console.warn('[vibecoding] failed to retry message', error);
      });
    },
    [session, sendingMessage, retryAgentMessage],
  );

  const handleDismissFailedMessage = useCallback(
    (messageId: string) => {
      if (!session) return;
      dismissFailedMessage(session.id, messageId);
    },
    [session, dismissFailedMessage],
  );

  const handleSendText = () => {
    if (deviceOffline || shouldDisableComposerForProvider) return;
    const nextInput = input.trim();
    if (!nextInput || sendingMessage) {
      return;
    }
    setInput('');
    // On failure the store keeps the message as a client-only `failed` bubble
    // (retryable / dismissable). The composer input is intentionally NOT
    // restored: restoring it let a follow-up message append to the failed text
    // and ship as one combined prompt ("你好 在吗"). The input stays empty so the
    // next message is always clean.
    void appendUserMessage(nextInput, 'text').catch(error => {
      console.warn('[vibecoding] failed to send text prompt', error);
    });
  };

  const handleResolveApproval = (
    approvalId: string,
    decision: 'approved' | 'denied',
    options?: { selectedOptionId?: string; message?: string },
  ) => {
    if (deviceOffline || resolvingApproval) return;
    setResolvingApproval({ id: approvalId, decision });
    void resolveApproval(approvalId, decision, options)
      .catch(error => {
        console.warn('[vibecoding] failed to resolve approval', error);
      })
      .finally(() => setResolvingApproval(null));
  };

  // Hooks that USED to sit after the `if (!session)` early return below. That
  // placement violated the Rules of Hooks: when `session` went undefined→defined
  // (navigating into a session that loads asynchronously) the hook count changed
  // between renders and React threw "Rendered more hooks than during the previous
  // render". They must run unconditionally, so they live above the guard and are
  // null-safe w.r.t. `session`.
  const sessionCommands = useMemo(() => {
    const provider =
      session?.provider ??
      (session?.model?.toLowerCase().includes('codex')
        ? 'codex'
        : 'claude_code');
    const variants =
      provider === 'codex' ? ['codex'] : ['claude-code', 'claudecode', 'claude'];
    const tool = (device?.tools ?? []).find(item => {
      const id = (item?.id ?? '').toLowerCase().replace(/^ai:/, '');
      return variants.includes(id);
    });
    return mergeCommands(provider, tool?.commands);
  }, [device?.tools, session?.model, session?.provider]);

  const approvals = useMemo(() => {
    if (!session) return sessionApprovals;
    const byId = new Map<string, ApprovalRequest>();
    const addApproval = (approval: ApprovalRequest | undefined) => {
      if (!approval) return;
      byId.set(approval.id, approval);
    };
    const statusFromEvent = (
      status: 'done' | 'running' | 'waiting' | 'failed' | string,
    ): ApprovalRequest['status'] =>
      status === 'failed' ? 'denied' : status === 'done' ? 'approved' : 'pending';
    const fallbackId = (eventId: string, approvalId?: string) =>
      approvalId ?? (eventId.startsWith('approval-') ? eventId.slice(9) : undefined);
    const addFallback = (input: {
      id?: string;
      title: string;
      detail: string;
      status: 'done' | 'running' | 'waiting' | 'failed' | string;
      timestamp: string;
    }) => {
      if (!input.id || byId.has(input.id)) return;
      byId.set(input.id, {
        id: input.id,
        kind: 'client_response',
        title: input.title || 'Approval requested',
        summary: input.detail || 'The assistant is waiting for approval.',
        deviceId: session.deviceId,
        projectId: session.projectId,
        sessionId: session.id,
        risk: 'medium',
        status: statusFromEvent(input.status),
        createdAt: input.timestamp,
      });
    };

    sessionApprovals.forEach(addApproval);
    addApproval(allApprovals.find(approval => approval.id === focusedApprovalId));
    globalEvents
      .filter(
        event =>
          event.type === 'approval.requested' &&
          (event.sessionId === session.id || event.approvalId === focusedApprovalId),
      )
      .forEach(event => {
        addFallback({
          id: fallbackId(event.id, event.approvalId),
          title: event.title,
          detail: event.detail,
          status: event.status,
          timestamp: event.timestamp,
        });
      });
    session.events
      .filter(event => event.type === 'approval')
      .forEach(event => {
        addFallback({
          id: fallbackId(event.id),
          title: event.title,
          detail: event.detail,
          status: event.status,
          timestamp: event.timestamp,
        });
      });

    return Array.from(byId.values()).sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  }, [
    allApprovals,
    focusedApprovalId,
    globalEvents,
    session,
    sessionApprovals,
  ]);
  const pendingApprovals = useMemo(
    () => approvals.filter(approval => approval.status === 'pending'),
    [approvals],
  );
  // 已处理(approved / denied)审批:不再进对话时间线,由末尾的折叠组承载,省屏幕空间。
  const resolvedApprovals = useMemo(
    () => approvals.filter(approval => approval.status !== 'pending'),
    [approvals],
  );
  const topPendingApproval = pendingApprovals[0];
  const conversationItems = useMemo(
    () => buildConversationTimeline(visibleTurns, pendingApprovals),
    [pendingApprovals, visibleTurns],
  );

  const handleJumpToApproval = useCallback(
    (approvalId: string) => {
      const timelineId = approvalTimelineItemId(approvalId);
      if (!conversationItems.some(item => item.id === timelineId)) return;
      followTailRef.current = false;
      setPendingJumpId(timelineId);
    },
    [conversationItems],
  );

  // --- 状态层级派生(L1 整体 / L2 回合 / L3 步骤) ---
  // useNowTick 每 30s 触发一次重算,驱动「live 回合 → settle」的翻转
  // (数据流期间 delta 每 60ms 自带重渲染,窗口判定始终新鲜)。
  const now = useNowTick();
  const liveMessageId = useMemo(
    () =>
      liveAssistantMessageId(
        session?.transcript ?? [],
        session?.lastActivityMs,
        now,
      ),
    [session?.lastActivityMs, session?.transcript, now],
  );
  const isLiveTurn = Boolean(liveMessageId);
  const livePulse = useMemo(
    () => deriveLivePulse(session?.structuredEvents ?? [], isLiveTurn),
    [isLiveTurn, session?.structuredEvents],
  );
  // L1 的生命迹象:和 L2/L3 同源——有 active 思考/started 命令,或最近 delta 在窗口内。
  // 用于压过 session.status 误报的 completed/closed(会话明明还在干活)。
  const isSessionLive = livePulse?.hasActive ?? isLiveTurn;
  const sessionPhase = useMemo(
    () =>
      deriveSessionPhase(
        session?.status ?? 'idle',
        pendingApprovals.length > 0,
        isSessionLive,
      ),
    [isSessionLive, pendingApprovals.length, session?.status],
  );
  const bottomPulseHeadline =
    sessionPhase === 'failed'
      ? '会话失败'
      : sessionPhase === 'completed'
        ? '上一轮已完成'
        : sessionPhase === 'waiting_approval'
          ? '等待审批'
          : livePulse?.headline;
  const composerReadOnlyReason =
    sessionPhase === 'failed'
      ? '该会话已失败，当前仅可查看历史。'
      : shouldDisableComposerForProvider
        ? 'Claude Code 正在运行，停止后可继续输入。'
        : undefined;
  const serviceThinksRunning =
    session?.status === 'running' || session?.status === 'waiting_approval';
  const canInterruptTurn =
    !deviceOffline &&
    !interruptingTurn &&
    session?.status !== 'failed' &&
    session?.status !== 'completed' &&
    (isSessionLive || serviceThinksRunning);

  const handleInterruptTurn = useCallback(() => {
    if (!session || !canInterruptTurn) return;
    if (
      voiceStt.status === 'recording' ||
      voiceStt.status === 'connecting' ||
      voiceStt.status === 'stopping'
    ) {
      void voiceStt.stop();
    }
    setInterruptingTurn(true);
    void interruptAgentSession(session.id)
      .catch(error => {
        console.warn('[vibecoding] failed to interrupt turn', error);
        setDetailError(
          error instanceof Error
            ? `停止失败：${error.message}`
            : '停止失败，请检查服务端连接。',
        );
      })
      .finally(() => setInterruptingTurn(false));
  }, [
    canInterruptTurn,
    interruptAgentSession,
    session,
    voiceStt.status,
    voiceStt.stop,
  ]);
  // Structured-activity attachment (P3.3). `transcript` is the coalesced
  // DisplayTranscriptMessage[] — each assistant bubble already carries the
  // underlying AgentMessage ids it spans (sourceMessageIds). The renderer
  // filters structuredEvents per-bubble from that. But tool-only assistant
  // turns (commands/files with NO prose) parse to zero segments and are
  // dropped by buildDisplayTranscript, so their ids never appear in any
  // sourceMessageIds — those need a synthetic activity bubble. We compute the
  // orphan ids here: assistant message ids that have ≥1 structured event AND
  // are not in any display bubble's sourceMessageIds. Grouped per-id so each
  // orphan turn renders one ActivityBlock. Kept in render order (transcript
  // order) for a stable layout.
  const orphanActivityMessageIds = useMemo(() => {
    if (!session) return [];
    if (activityEventsByMessageId.size === 0) return [];
    // Assistant message ids that DID render (covered by a display bubble).
    const covered = new Set(
      transcript.flatMap(message => message.sourceMessageIds),
    );
    // Walk the raw transcript in order; an assistant id is an orphan iff it
    // has structured events but isn't covered. De-duped.
    const seen = new Set<string>();
    const orphans: string[] = [];
    for (const m of session.transcript) {
      if (m.role !== 'assistant') continue;
      if (covered.has(m.id)) continue;
      if (!activityEventsByMessageId.has(m.id)) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      orphans.push(m.id);
    }
    return orphans;
  }, [activityEventsByMessageId, session, transcript]);
  const messageTimelinePositions = useMemo(() => {
    const entries: Array<{ id?: string; hasRail: boolean }> = [];
    for (const item of conversationItems) {
      if (item.kind !== 'turn') {
        entries.push({ hasRail: false });
        continue;
      }
      for (const message of item.turn.messages) {
        entries.push({ id: message.id, hasRail: message.role !== 'user' });
      }
    }
    if (orphanActivityMessageIds.length > 0) {
      entries.push({ hasRail: true });
    }

    const positions = new Map<string, MessageTimelinePosition>();
    entries.forEach((entry, index) => {
      if (!entry.id || !entry.hasRail) return;
      const hasPreviousRail = Boolean(entries[index - 1]?.hasRail);
      const hasNextRail = Boolean(entries[index + 1]?.hasRail);
      const position: MessageTimelinePosition =
        hasPreviousRail && hasNextRail
          ? 'middle'
          : hasPreviousRail
          ? 'end'
          : hasNextRail
          ? 'start'
          : 'single';
      positions.set(entry.id, position);
    });
    return positions;
  }, [conversationItems, orphanActivityMessageIds.length]);
  const latestConversationKey = useMemo(() => {
    const latest = conversationItems[conversationItems.length - 1];
    if (!latest) return `${targetSessionId}:empty`;
    return [
      targetSessionId,
      conversationItems.length,
      latest.id,
      latest.timestamp,
    ].join(':');
  }, [conversationItems, targetSessionId]);

  useEffect(() => {
    if (!latestConversationKey) return;
    if (pendingScrollToEndRef.current || followTailRef.current) {
      pendingScrollToEndRef.current = false;
      scheduleScrollToEnd(true);
    }
  }, [latestConversationKey, scheduleScrollToEnd]);

  const handleSaveToolsSettings = useCallback(
    async (patch: { model: string; effort: string }) => {
      if (!session) return;
      await updateAgentSession(session.id, patch);
    },
    [session, updateAgentSession],
  );

  const handleInsertCommand = useCallback(
    (text: string) => {
      if (mode !== 'text') setMode('text');
      setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
    },
    [mode],
  );

  const renderApprovalCard = (approval: ApprovalRequest) => {
    const pending = approval.status === 'pending';
    const canResolve = pending && resolvableApprovalIds.has(approval.id);
    const resolving = resolvingApproval?.id === approval.id;
    const optionChoices = canResolve ? approval.options ?? [] : [];

    return (
      <GlassPanel
        glowColor={pending ? 'secondary' : 'none'}
        style={styles.approvalPanel}
      >
        <View style={styles.approvalHeader}>
          <IconBadge
            name="approval"
            tone={
              approval.status === 'denied'
                ? 'error'
                : pending
                ? 'tertiary'
                : 'secondary'
            }
            size={36}
            iconSize={18}
          />
          <View style={styles.approvalCopy}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.primary },
              ]}
            >
              APPROVAL REQUEST
            </Text>
            <Text
              numberOfLines={2}
              style={[
                theme.typography.titleMd,
                { color: theme.colors.onSurface },
              ]}
            >
              {approval.title}
            </Text>
          </View>
          <StatusChip
            label={approval.status.toUpperCase()}
            type={
              pending
                ? 'warning'
                : approval.status === 'approved'
                ? 'success'
                : 'error'
            }
          />
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {approval.summary}
        </Text>
        {approval.command ? (
          <Text
            selectable
            style={[theme.typography.codeSm, { color: theme.colors.primary }]}
          >
            {approval.command}
          </Text>
        ) : null}
        {approval.files?.length ? (
          <View style={styles.approvalFiles}>
            {approval.files.map(file => (
              <Text
                key={file}
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {file}
              </Text>
            ))}
          </View>
        ) : null}
        {pending && !canResolve ? (
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.tertiary },
            ]}
          >
            已识别到审批事件，完整操作数据仍在同步中。下拉刷新后可在这里处理，或从首页进入 Approvals。
          </Text>
        ) : pending && optionChoices.length ? (
          <View style={styles.approvalOptionActions}>
            {optionChoices.map(option => {
              const optionDecision =
                option.id === 'deny' ? 'denied' : 'approved';
              return (
                <GlowButton
                  key={option.id}
                  title={option.label.toUpperCase()}
                  onPress={() =>
                    handleResolveApproval(approval.id, optionDecision, {
                      selectedOptionId: option.id,
                      message: option.response,
                    })
                  }
                  variant={optionDecision === 'denied' ? 'outline' : 'primary'}
                  loading={resolving}
                  disabled={deviceOffline || Boolean(
                    resolvingApproval && resolvingApproval.id !== approval.id,
                  )}
                  style={styles.approvalOptionAction}
                />
              );
            })}
          </View>
        ) : pending ? (
          <View style={styles.approvalActions}>
            <GlowButton
              title="APPROVE"
              onPress={() => handleResolveApproval(approval.id, 'approved')}
              variant="primary"
              loading={
                resolving && resolvingApproval?.decision === 'approved'
              }
              disabled={deviceOffline || Boolean(
                resolvingApproval && resolvingApproval.id !== approval.id,
              )}
              style={styles.approvalAction}
            />
            <GlowButton
              title="DENY"
              onPress={() => handleResolveApproval(approval.id, 'denied')}
              variant="outline"
              loading={resolving && resolvingApproval?.decision === 'denied'}
              disabled={deviceOffline || Boolean(
                resolvingApproval && resolvingApproval.id !== approval.id,
              )}
              style={styles.approvalAction}
            />
          </View>
        ) : null}
      </GlassPanel>
    );
  };

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="VibeCoding"
          subtitle="LOADING"
          onBack={navigation.goBack}
        />
        <View style={styles.loadingState}>
          {loadingDetail && <ActivityIndicator color={theme.colors.primary} />}
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {detailError || '正在加载会话...'}
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  // project / device / preview are now subscribed via fine-grained selectors
  // at the top of the component (useProject / useDevice / useSessionPreview).
  // When the transcript is empty, explain WHY using the server's detail_refresh
  // status (+ proactive device-offline guard) instead of a flat "暂无会话记录".
  // Native sessions keep their history on the agent; if it's offline the server
  // returns skipped_offline + an empty transcript, which must read as "agent
  // offline, pull to retry", not "this conversation is empty".
  const emptyTranscriptState: {
    title: string;
    detail: string;
    tone: 'offline' | 'error' | 'neutral';
  } = (() => {
    if (deviceOffline || session?.detailRefreshStatus === 'skipped_offline') {
      return {
        title: '桌面 Agent 未连接，暂无法同步历史',
        detail:
          '该会话的完整历史保存在电脑端 Agent 上，需要 Agent 在线才能拉取。请确认 Agent 已运行并联网后，下拉刷新重试。',
        tone: 'offline' as const,
      };
    }
    if (session?.detailRefreshStatus === 'failed') {
      return {
        title: '历史拉取失败',
        detail:
          '从桌面 Agent 拉取历史时出错，可能是网络抖动或数据格式异常。请下拉刷新重试；若持续失败，可稍后再试。',
        tone: 'error' as const,
      };
    }
    if (
      (session?.transcriptCount ?? 0) > 0 ||
      Boolean(session?.title || session?.objective || session?.currentStep)
    ) {
      return {
        title: '暂时只有会话摘要',
        detail:
          '后端已同步到这段 VibeCoding 的标题、状态或消息数量，但还没有可展示的消息正文。Agent 在线并支持历史详情后，下拉刷新即可补齐内容。',
        tone: 'neutral' as const,
      };
    }
    return {
      title: '暂无会话记录',
      detail:
        '该会话目前没有消息。下拉可同步历史；若这是新会话，可在下方发送消息开始对话。',
      tone: 'neutral' as const,
    };
  })();
  const budgetLabel = formatBudget(session.projectBudget);
  // Authoritative provider (from the server session), falling back to the model
  // label only for legacy snapshots without the field. Drives the Tools menu's
  // provider-aware effort presets and the agent command-tool lookup.
  const sessionProvider =
    session.provider ??
    (session.model.toLowerCase().includes('codex') ? 'codex' : 'claude_code');
  const isCodexSession = sessionProvider === 'codex';
  // Live model/effort catalog (shared, cached) — drives the ToolsMenu effort
  // chips so they render the provider's catalog efforts (codex 4, claude 6),
  // falling back to the hardcoded ladder before it loads.
  const sessionEffortOptions = catalogEffortOptions(
    sessionProvider,
    providerCatalog,
  );
  const effective = session.effectiveModelConfig;
  const effectiveLabel = effective
    ? [
        `model=${effective.model || '用户默认'}`,
        effective.source?.model ? `(${effective.source.model})` : '',
        `· effort=${effective.effort || '用户默认'}`,
        effective.source?.effort ? `(${effective.source.effort})` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const modelStatusLabel = [
    session.model,
    session.effort ? `effort ${session.effort}` : 'default effort',
  ].join(' / ');
  const displayTitle = formatVibeSessionTitle(session.title, {
    directory: session.directory,
    projectName: project?.name,
  });
  const { head: titleHead, tail: titleTail } = splitSessionTitle(displayTitle);
  const titleHasOverflow = titleTail.length > 0;
  // Also offer expand for long single-segment titles that clip on one line.
  const titleCanExpand = titleHasOverflow || titleHead.length > 24;
  const statusAccent =
    session.status === 'waiting_approval'
      ? theme.colors.tertiary
      : session.status === 'running'
      ? theme.colors.primary
      : session.status === 'failed'
      ? theme.colors.error
      : theme.colors.outlineVariant;
  const conversationBoundaryStart = formatConversationBoundaryTime(
    conversationTurns[0]?.timestamp,
  );
  const conversationBoundaryEnd = formatConversationBoundaryTime(
    conversationTurns[conversationTurns.length - 1]?.endTimestamp ??
      conversationTurns[conversationTurns.length - 1]?.timestamp,
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={project?.name ?? displayTitle}
        subtitle={device?.name ?? 'VIBECODING SESSION'}
        onBack={navigation.goBack}
        rightAction={
          <View style={styles.topStatusCluster}>
            <StatusChip
              label={sessionPhaseLabel[sessionPhase]}
              type={sessionPhaseType[sessionPhase]}
            />
            <Text
              numberOfLines={1}
              style={[
                theme.typography.codeSm,
                styles.topStatusMeta,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {modelStatusLabel}
            </Text>
          </View>
        }
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
              title="同步会话历史..."
              titleColor={theme.colors.onSurfaceVariant}
            />
          }
          scrollEventThrottle={16}
          onLayout={event => {
            const height = event.nativeEvent.layout.height;
            setViewportHeight(height);
          }}
          onMomentumScrollEnd={handleScroll}
          onContentSizeChange={(_, _height) => {
            if (pendingScrollToEndRef.current || followTailRef.current) {
              pendingScrollToEndRef.current = false;
              scheduleScrollToEnd(true);
            }
          }}
          onScroll={handleScroll}
        >
          {deviceOffline ? (
            <View
              style={[
                styles.offlineBanner,
                {
                  backgroundColor: isDark
                    ? 'rgba(248,113,113,0.14)'
                    : 'rgba(248,113,113,0.1)',
                  borderColor: theme.colors.error,
                },
              ]}
            >
              <IconBadge name="device" tone="neutral" size={26} iconSize={14} />
              <View style={styles.offlineBannerCopy}>
                <Text
                  style={[
                    theme.typography.labelMd,
                    { color: theme.colors.error, fontWeight: '700' },
                  ]}
                >
                  设备离线 · 只读模式
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  该设备不可达，发送 / 审批 / 控制已暂停，仍可查看历史。
                </Text>
              </View>
            </View>
          ) : null}
          <GlassPanel style={styles.sessionHeader}>
            <View
              style={[
                styles.headerAccent,
                { backgroundColor: statusAccent },
                session.status === 'running' && isDark
                  ? theme.glow.primary
                  : null,
              ]}
            />
            <View style={styles.headerInner}>
              <View style={styles.headerTop}>
                <IconBadge
                  name={isCodexSession ? 'code' : 'agent'}
                  tone={
                    session.status === 'waiting_approval' ? 'tertiary' : 'primary'
                  }
                  size={44}
                  iconSize={22}
                  filled={session.status === 'running'}
                />
                <View style={styles.headerTitle}>
                  <View style={styles.titleTapRow}>
                    <View style={styles.titleLead}>
                      <Text
                        style={[
                          theme.typography.titleMd,
                          styles.titlePrimary,
                          { color: theme.colors.onSurface },
                        ]}
                        numberOfLines={titleExpanded ? undefined : 1}
                      >
                        {titleHead.toUpperCase()}
                      </Text>
                      {titleHasOverflow ? (
                        <Text
                          style={[
                            theme.typography.labelSm,
                            { color: theme.colors.onSurfaceVariant },
                          ]}
                          numberOfLines={titleExpanded ? undefined : 1}
                        >
                          {titleTail}
                        </Text>
                      ) : null}
                    </View>
                    {titleCanExpand ? (
                      <TouchableOpacity
                        activeOpacity={0.5}
                        accessibilityLabel={
                          titleExpanded ? '收起标题' : '展开标题'
                        }
                        accessibilityRole="button"
                        onPress={() => setTitleExpanded(value => !value)}
                        style={styles.titleExpand}>
                        <Text
                          style={[
                            styles.titleChevron,
                            { color: theme.colors.onSurfaceVariant },
                          ]}>
                          {titleExpanded ? '▴' : '▾'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      styles.titleDirectory,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}
                  >
                    {session.directory}
                  </Text>
                </View>
                <StatusChip
                  label={session.risk.toUpperCase()}
                  type={
                    session.risk === 'high'
                      ? 'error'
                      : session.risk === 'medium'
                      ? 'warning'
                      : 'success'
                  }
                />
              </View>
              {session.objective ? (
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={titleExpanded ? undefined : 2}
                >
                  {session.objective}
                </Text>
              ) : null}
            {session.projectBudget ? (
              <View
                style={[
                  styles.budgetStrip,
                  {
                    backgroundColor: isDark
                      ? 'rgba(106, 153, 85, 0.12)'
                      : 'rgba(0, 120, 84, 0.08)',
                  },
                ]}
              >
                <IconBadge
                  name="quota"
                  tone="secondary"
                  size={30}
                  iconSize={15}
                />
                <View style={styles.budgetCopy}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: isDark ? '#6A9955' : theme.colors.secondary },
                    ]}
                  >
                    CODEX BUDGET
                  </Text>
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {budgetLabel} · updated {session.projectBudget.updatedAt}
                  </Text>
                </View>
              </View>
            ) : null}
            </View>
          </GlassPanel>

          <View style={styles.quickActions}>
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={deviceOffline}
              accessibilityLabel="文件"
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('FileBrowser', {
                  projectId: session.projectId,
                  deviceId: session.deviceId,
                  sessionId: session.id,
                })
              }
              style={[
                styles.quickTile,
                deviceOffline ? styles.quickTileDisabled : null,
              ]}>
              <GlassPanel style={styles.quickTileInner}>
                <IconBadge
                  name="project"
                  tone="secondary"
                  size={40}
                  iconSize={20}
                />
                <View style={styles.quickTileCopy}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: theme.colors.onSurface },
                    ]}>
                    FILES
                  </Text>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}>
                    浏览代码
                  </Text>
                </View>
                <Text
                  style={[
                    styles.quickTileChevron,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  ›
                </Text>
              </GlassPanel>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={deviceOffline}
              accessibilityLabel="终端"
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('DeviceTerminal', {
                  deviceId: session.deviceId,
                  directory: session.directory,
                })
              }
              style={[
                styles.quickTile,
                deviceOffline ? styles.quickTileDisabled : null,
              ]}>
              <GlassPanel style={styles.quickTileInner}>
                <IconBadge
                  name="terminal"
                  tone="primary"
                  size={40}
                  iconSize={20}
                />
                <View style={styles.quickTileCopy}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: theme.colors.onSurface },
                    ]}>
                    TERMINAL
                  </Text>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}>
                    打开终端
                  </Text>
                </View>
                <Text
                  style={[
                    styles.quickTileChevron,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  ›
                </Text>
              </GlassPanel>
            </TouchableOpacity>
          </View>

          {preview && (
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() =>
                navigation.navigate('Preview', { previewId: preview.id })
              }
            >
              <GlassPanel glowColor="primary" style={styles.previewCard}>
                <View style={styles.previewTop}>
                  <Text
                    style={[
                      theme.typography.titleMd,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    Preview ready
                  </Text>
                  <StatusChip label={`${preview.port}`} type="info" />
                </View>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.primary },
                  ]}
                >
                  {preview.shortUrl}
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {preview.access.toUpperCase()} / expires in {preview.expiresIn}
                </Text>
              </GlassPanel>
            </TouchableOpacity>
          )}

          <View
            style={styles.conversationSection}
            onLayout={event => setConversationTop(event.nativeEvent.layout.y)}
          >
            <View style={styles.chatSectionHeader}>
              <View style={styles.chatHeaderLeft}>
                <IconBadge name="chat" tone="primary" size={34} iconSize={17} />
                <View>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: theme.colors.primary },
                    ]}
                  >
                    CONVERSATION
                  </Text>
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {conversationTurns.length
                      ? `${visibleTurns.length}/${conversationTurns.length} turns`
                      : `${session.transcriptCount ?? 0} messages`}
                  </Text>
                </View>
              </View>
              <StatusChip label={mode.toUpperCase()} type="info" />
            </View>
            {conversationItems.length ? (
              <>
                {loadingDetail || detailError || loadingEarlier ? (
                  <GlassPanel style={styles.detailInlinePanel}>
                    {loadingDetail || loadingEarlier ? (
                      <ActivityIndicator
                        color={theme.colors.primary}
                        size="small"
                      />
                    ) : null}
                    <Text
                      style={[
                        theme.typography.bodySm,
                        {
                          color: detailError
                            ? theme.colors.tertiary
                            : theme.colors.onSurfaceVariant,
                        },
                      ]}
                    >
                      {detailError || '正在同步更早的会话内容...'}
                    </Text>
                  </GlassPanel>
                ) : null}
                {conversationTurns.length ? (
                  <LoadMoreRow
                    visibleCount={turnList.visibleCount}
                    totalCount={
                      turnList.hasMore
                        ? turnList.totalCount
                        : hasServerEarlierMessages
                        ? Math.max(
                            session.transcriptCount ?? 0,
                            turnList.visibleCount + 1,
                          )
                        : turnList.totalCount
                    }
                    onPress={handleLoadEarlierMessages}
                    label="LOAD EARLIER TURNS"
                  />
                ) : null}
                <View style={styles.conversationTimeline}>
                  <View style={styles.conversationBoundaryRow}>
                    <View
                      style={[
                        styles.conversationBoundaryNode,
                        {
                          backgroundColor: theme.colors.secondary,
                          borderColor: isDark
                            ? 'rgba(17, 20, 23, 0.98)'
                            : theme.colors.surface,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.conversationBoundaryLine,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.1)'
                            : theme.colors.outlineVariant,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.conversationBoundaryLabel,
                        { color: theme.colors.secondary },
                      ]}
                    >
                      会话开始
                    </Text>
                    {conversationBoundaryStart ? (
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {conversationBoundaryStart}
                      </Text>
                    ) : null}
                  </View>
                  {conversationItems.map(item => {
                    if (item.kind === 'turn') {
                      return (
                        <View
                          key={item.id}
                          style={styles.turnGroup}
                          onLayout={event => {
                            const { y, height } = event.nativeEvent.layout;
                            handleConversationItemLayout(item.turn.id, y, height);
                          }}
                        >
                          {item.turn.messages.map(message => {
                            return (
                              <TranscriptMessageList
                                key={message.id}
                                message={message}
                                activitySessionId={session.id}
                                messageActivityEvents={
                                  activityEventsByDisplayMessageId.get(
                                    message.id,
                                  ) ?? EMPTY_ACTIVITY_EVENTS
                                }
                                activityDetailCache={session.eventDetailCache}
                                onCacheActivityDetail={handleCacheActivityDetail}
                                liveMessageId={liveMessageId}
                                timelinePosition={
                                  messageTimelinePositions.get(message.id) ??
                                  'single'
                                }
                                onRetryFailed={handleRetryFailedMessage}
                                onDismissFailed={handleDismissFailedMessage}
                              />
                            );
                          })}
                        </View>
                      );
                    }

                    return (
                      <View
                        key={item.id}
                        style={styles.approvalTimelineItem}
                        onLayout={event => {
                          const { y, height } = event.nativeEvent.layout;
                          handleConversationItemLayout(item.id, y, height);
                        }}
                      >
                        {renderApprovalCard(item.approval)}
                      </View>
                    );
                  })}
                  {/* Tool-only assistant turns (empty prose, dropped during
                      coalescing) whose structured activity would otherwise vanish.
                      Rendered once for the whole conversation, in transcript
                      order. Each id → one ActivityBlock grouping its events. */}
                  {orphanActivityMessageIds.length > 0 ? (
                    <TranscriptMessageList
                      key="orphan-activity-block"
                      activitySessionId={session.id}
                      orphanActivityEventsByMessageId={activityEventsByMessageId}
                      activityDetailCache={session.eventDetailCache}
                      onCacheActivityDetail={handleCacheActivityDetail}
                      orphanActivityMessageIds={orphanActivityMessageIds}
                      liveMessageId={liveMessageId}
                    />
                  ) : null}
                  {/* 已处理(approved/denied)审批:默认折叠成一行,展开后置灰列出,
                      避免每张占满屏幕。pending 审批仍在上面按时间线完整展示。 */}
                  {resolvedApprovals.length > 0 ? (
                    <ResolvedApprovalsGroup
                      approvals={resolvedApprovals}
                      renderCard={renderApprovalCard}
                    />
                  ) : null}
                  <View style={styles.conversationBoundaryRow}>
                    <View
                      style={[
                        styles.conversationBoundaryLine,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.1)'
                            : theme.colors.outlineVariant,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.conversationBoundaryNode,
                        styles.conversationBoundaryEndNode,
                        {
                          backgroundColor:
                            sessionPhase === 'completed'
                              ? theme.colors.secondary
                              : sessionPhase === 'failed'
                              ? theme.colors.error
                              : theme.colors.primary,
                          borderColor: isDark
                            ? 'rgba(17, 20, 23, 0.98)'
                            : theme.colors.surface,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.conversationBoundaryLabel,
                        {
                          color:
                            sessionPhase === 'completed'
                              ? theme.colors.secondary
                              : sessionPhase === 'failed'
                              ? theme.colors.error
                              : theme.colors.primary,
                        },
                      ]}
                    >
                      {sessionPhase === 'completed'
                        ? '本轮完成'
                        : sessionPhase === 'failed'
                        ? '会话失败'
                        : '进行中'}
                    </Text>
                    {conversationBoundaryEnd ? (
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {conversationBoundaryEnd}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </>
            ) : loadingDetail || refreshing ? (
              <GlassPanel style={styles.detailStatePanel}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {refreshing ? '正在同步会话历史...' : '正在拉取完整会话内容...'}
                </Text>
              </GlassPanel>
            ) : detailError ? (
              <GlassPanel style={styles.detailStatePanel}>
                <Text
                  style={[theme.typography.bodySm, { color: theme.colors.error }]}
                >
                  {detailError}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={handleRefresh}
                  style={[
                    styles.detailRetryButton,
                    { borderColor: theme.colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.primary },
                    ]}
                  >
                    重试
                  </Text>
                </TouchableOpacity>
              </GlassPanel>
            ) : (
              <GlassPanel style={styles.detailStatePanel}>
                <View style={styles.summaryFallbackHeader}>
                  <IconBadge
                    name={isCodexSession ? 'code' : 'agent'}
                    tone="primary"
                    size={34}
                    iconSize={17}
                  />
                  <View style={styles.summaryFallbackTitle}>
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        {
                          color:
                            emptyTranscriptState.tone === 'neutral'
                              ? theme.colors.primary
                              : emptyTranscriptState.tone === 'error'
                              ? theme.colors.error
                              : theme.colors.tertiary,
                        },
                      ]}
                    >
                      HISTORY SUMMARY
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        theme.typography.titleMd,
                        { color: theme.colors.onSurface },
                      ]}
                    >
                      {displayTitle}
                    </Text>
                  </View>
                </View>
                {session.objective || session.currentStep ? (
                  <Text
                    style={[
                      theme.typography.bodySm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {session.objective || session.currentStep}
                  </Text>
                ) : null}
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {session.transcriptCount ?? 0} messages · {session.model}
                  {session.directory ? ` · ${session.directory}` : ''}
                </Text>
                <Text
                  style={[
                    theme.typography.labelMd,
                    {
                      color:
                        emptyTranscriptState.tone === 'neutral'
                          ? theme.colors.onSurface
                          : emptyTranscriptState.tone === 'error'
                            ? theme.colors.error
                            : theme.colors.tertiary,
                    },
                  ]}
                >
                  {emptyTranscriptState.title}
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {emptyTranscriptState.detail}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={handleRefresh}
                  style={[
                    styles.detailRetryButton,
                    {
                      borderColor:
                        emptyTranscriptState.tone === 'offline'
                          ? theme.colors.tertiary
                          : theme.colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.codeSm,
                      {
                        color:
                          emptyTranscriptState.tone === 'offline'
                            ? theme.colors.tertiary
                            : theme.colors.primary,
                      },
                    ]}
                  >
                    下拉或点击刷新
                  </Text>
                </TouchableOpacity>
              </GlassPanel>
            )}
            {latestAgentEvent ? (
              <View style={styles.timelineDock}>
                {timelineExpanded ? (
                  <GlassPanel style={styles.timelinePopover}>
                    <View style={styles.timelinePopoverHeader}>
                      <Text
                        style={[
                          theme.typography.labelCaps,
                          { color: theme.colors.primary },
                        ]}
                      >
                        AGENT TIMELINE
                      </Text>
                      <TouchableOpacity
                        onPress={() => setTimelineExpanded(false)}
                      >
                        <Text
                          style={[
                            theme.typography.codeSm,
                            { color: theme.colors.onSurfaceVariant },
                          ]}
                        >
                          CLOSE
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <LoadMoreRow
                      visibleCount={agentEventList.visibleCount}
                      totalCount={agentEventList.totalCount}
                      onPress={agentEventList.showMore}
                      label="LOAD EARLIER EVENTS"
                    />
                    {visibleAgentEvents.map((event, index) => (
                      <View key={event.id}>
                        <View style={styles.eventRow}>
                          <IconBadge
                            name={eventIcon[event.type] ?? 'event'}
                            tone={
                              event.status === 'failed'
                                ? 'error'
                                : event.status === 'waiting'
                                ? 'tertiary'
                                : 'primary'
                            }
                            size={30}
                            iconSize={15}
                          />
                          <View style={styles.eventText}>
                            <Text
                              style={[
                                theme.typography.labelSm,
                                { color: theme.colors.onSurface },
                              ]}
                            >
                              {event.title}
                            </Text>
                            <Text
                              style={[
                                theme.typography.bodySm,
                                { color: theme.colors.onSurfaceVariant },
                              ]}
                              numberOfLines={2}
                            >
                              {event.detail}
                            </Text>
                            <Text
                              style={[
                                theme.typography.codeSm,
                                { color: theme.colors.onSurfaceVariant },
                              ]}
                            >
                              {event.timestamp}
                            </Text>
                          </View>
                          <StatusChip
                            label={event.status.toUpperCase()}
                            type={
                              event.status === 'done'
                                ? 'success'
                                : event.status === 'failed'
                                ? 'error'
                                : event.status === 'running'
                                ? 'info'
                                : 'warning'
                            }
                          />
                        </View>
                        {index < visibleAgentEvents.length - 1 && (
                          <View style={styles.divider} />
                        )}
                      </View>
                    ))}
                  </GlassPanel>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => setTimelineExpanded(current => !current)}
                  style={[
                    styles.timelineBadge,
                    {
                      backgroundColor: isDark
                        ? 'rgba(17, 20, 23, 0.9)'
                        : 'rgba(255, 255, 255, 0.95)',
                      borderColor: isDark
                        ? 'rgba(255, 255, 255, 0.1)'
                        : theme.colors.outlineVariant,
                    },
                  ]}
                >
                  <IconBadge
                    name={eventIcon[latestAgentEvent.type] ?? 'event'}
                    tone={
                      latestAgentEvent.status === 'failed'
                        ? 'error'
                        : latestAgentEvent.status === 'waiting'
                        ? 'tertiary'
                        : 'primary'
                    }
                    size={28}
                    iconSize={14}
                  />
                  <View style={styles.timelineBadgeText}>
                    {/* L3 实时步骤脉冲:永不显示「已完成/DONE」,取而代之是
                        思考中 / 运行命令 / 处理中… / 等待你的输入。
                        无结构化事件时回退到最近一条事件的标题(保留信息)。 */}
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.onSurface },
                      ]}
                      numberOfLines={1}
                    >
                      {bottomPulseHeadline ?? latestAgentEvent.title}
                    </Text>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                      numberOfLines={1}
                    >
                      {visibleSessionEvents.length} events ·{' '}
                      {latestAgentEvent.timestamp}
                    </Text>
                  </View>
                  {/*
                    Refresh-latest affordance. Pull-to-refresh is now dedicated to
                    "load earlier history", so this is the home for the forced
                    agent detail refresh (recover the newest snapshot / re-sync
                    after an offline gap). Nested in the badge but a separate
                    press target so tapping it doesn't toggle the timeline.
                  */}
                  <TouchableOpacity
                    hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
                    activeOpacity={0.6}
                    disabled={refreshingLatest}
                    onPress={handleRefreshLatest}
                    style={styles.timelineBadgeRefresh}
                    accessibilityLabel="刷新最新会话"
                    accessibilityRole="button">
                    {refreshingLatest ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.primary}
                      />
                    ) : (
                      <IconBadge
                        name="refresh"
                        tone="primary"
                        size={30}
                        iconSize={15}
                      />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {noMoreEarlierHint ? (
          <View
            pointerEvents="none"
            style={[
              styles.noMoreEarlierHint,
              {
                backgroundColor: isDark
                  ? 'rgba(17, 20, 23, 0.92)'
                  : 'rgba(255, 255, 255, 0.96)',
                borderColor: isDark
                  ? 'rgba(255, 255, 255, 0.1)'
                  : theme.colors.outlineVariant,
              },
            ]}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurface },
              ]}>
              已是最早的消息
            </Text>
          </View>
        ) : null}

        <ConversationScrubber
          collapsedMarks={conversationRailItems.map(({ turn, active, visible }) => ({
            id: turn.id,
            role: turn.role,
            active,
            visible,
          }))}
          stops={scrubberStops}
          activeStopId={activeScrubberStopId}
          onCommit={handleScrubberCommit}
        />

        <View
          style={[
            styles.inputPanel,
            {
              backgroundColor: isDark
                ? 'rgba(17, 20, 23, 0.98)'
                : 'rgba(247, 249, 255, 0.98)',
              borderTopColor: isDark
                ? 'rgba(255, 255, 255, 0.06)'
                : theme.colors.outlineVariant,
            },
          ]}
        >
          {toolsMenuVisible && (
            <ToolsMenu
              onClose={() => setToolsMenuVisible(false)}
              model={session.model}
              provider={sessionProvider}
              effort={session.effort ?? ''}
              effortOptions={sessionEffortOptions}
              effectiveLabel={effectiveLabel ?? undefined}
              commands={sessionCommands}
              onSaveSettings={handleSaveToolsSettings}
              onInsertCommand={handleInsertCommand}
            />
          )}
          <SuggestionActionBar
            suggestions={session.suggestions}
            onSelect={suggestion => {
              if (suggestion.toLowerCase().includes('preview') && preview) {
                navigation.navigate('Preview', { previewId: preview.id });
              }
            }}
          />
          {topPendingApproval ? (
            <TouchableOpacity
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="跳转到待审批"
              onPress={() => handleJumpToApproval(topPendingApproval.id)}
              style={[
                styles.pendingApprovalBubble,
                {
                  backgroundColor: isDark
                    ? 'rgba(17, 20, 23, 0.96)'
                    : 'rgba(255, 255, 255, 0.98)',
                  borderColor: theme.colors.tertiary,
                },
              ]}
            >
              <IconBadge name="approval" tone="tertiary" size={28} iconSize={14} />
              <View style={styles.pendingApprovalCopy}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurface },
                  ]}
                  numberOfLines={1}
                >
                  {pendingApprovals.length > 1
                    ? `${pendingApprovals.length} 个待审批`
                    : '1 个待审批'}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={1}
                >
                  {topPendingApproval.title}
                </Text>
              </View>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.tertiary }]}
              >
                GO
              </Text>
            </TouchableOpacity>
          ) : null}
          <MessageComposer
            mode={mode}
            onModeChange={setMode}
            input={input}
            onInputChange={setInput}
            voiceDraft={voiceDraft}
            commands={
              project?.availableCommands?.length
                ? project.availableCommands
                : sessionCommands
            }
            voiceStt={voiceStt}
            sendingMessage={sendingMessage}
            interruptingTurn={interruptingTurn}
            canInterruptTurn={canInterruptTurn}
            deviceOffline={deviceOffline}
            readOnlyReason={composerReadOnlyReason}
            toolsMenuVisible={toolsMenuVisible}
            onToggleTools={() => setToolsMenuVisible(value => !value)}
            onTextInputFocus={() => {
              pendingScrollToEndRef.current = true;
              scheduleScrollToEnd(true);
            }}
            onVoiceCapture={handleVoiceCapture}
            onVoiceCaptureStart={handleVoiceCaptureStart}
            onVoiceCaptureEnd={handleVoiceCaptureEnd}
            onSendVoice={handleSendVoice}
            onSendText={handleSendText}
            onInterruptTurn={handleInterruptTurn}
            onResetVoice={() => {
              setVoiceDraft('');
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  topStatusCluster: {
    alignItems: 'flex-end',
    maxWidth: 156,
    gap: 4,
  },
  topStatusMeta: {
    textAlign: 'right',
    fontSize: 10,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  offlineBannerCopy: {
    flex: 1,
    gap: 2,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sessionHeader: {
    // Padding/gap live in headerInner so the status accent bar can span the
    // panel edge-to-edge under the rounded corners.
    overflow: 'hidden',
  },
  headerAccent: {
    height: 3,
    width: '100%',
  },
  headerInner: {
    padding: 14,
    gap: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    gap: 4,
  },
  titleTapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  titleLead: {
    flex: 1,
    gap: 2,
  },
  titlePrimary: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  titleDirectory: {
    opacity: 0.8,
  },
  titleExpand: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  titleChevron: {
    fontSize: 12,
    fontWeight: '600',
  },
  budgetStrip: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  budgetCopy: {
    flex: 1,
    gap: 2,
  },
  previewCard: {
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickTile: {
    flex: 1,
  },
  quickTileDisabled: {
    opacity: 0.45,
  },
  quickTileInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  quickTileCopy: {
    flex: 1,
    gap: 2,
  },
  quickTileChevron: {
    fontSize: 18,
    fontWeight: '600',
  },
  previewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conversationSection: {
    marginTop: 20,
    gap: 12,
  },
  detailStatePanel: {
    padding: 14,
    gap: 10,
  },
  detailRetryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  detailInlinePanel: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryFallbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryFallbackTitle: {
    flex: 1,
    gap: 3,
  },
  conversationTimeline: {
    gap: 10,
  },
  conversationBoundaryRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 10,
    paddingRight: 2,
  },
  conversationBoundaryLine: {
    width: 24,
    height: 1,
    borderRadius: 999,
  },
  conversationBoundaryNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  conversationBoundaryEndNode: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  conversationBoundaryLabel: {
    minWidth: 58,
  },
  turnGroup: {
    gap: 8,
  },
  approvalTimelineItem: {
    width: '100%',
  },
  approvalPanel: {
    padding: 12,
    gap: 10,
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  approvalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  approvalFiles: {
    gap: 4,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approvalAction: {
    flex: 1,
  },
  approvalOptionActions: {
    gap: 8,
  },
  approvalOptionAction: {
    alignSelf: 'stretch',
  },
  chatSectionHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineDock: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    width: '100%',
    gap: 8,
  },
  timelinePopover: {
    width: '100%',
    padding: 0,
  },
  timelinePopoverHeader: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  timelineBadge: {
    width: '92%',
    maxWidth: 360,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineBadgeText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
  },
  eventText: {
    flex: 1,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  inputPanel: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
  },
  pendingApprovalBubble: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingApprovalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  conversationRail: {
    position: 'absolute',
    right: 7,
    top: 172,
    maxHeight: 210,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 5,
  },
  conversationRailMark: {
    width: 4,
    borderRadius: 999,
  },
  timelineBadgeRefresh: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 34,
    height: 34,
    marginLeft: 2,
  },
  noMoreEarlierHint: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
