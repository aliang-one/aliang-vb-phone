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
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  Alert,
  ScrollView,
  TouchableOpacity,


} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { CLOSE_MS as SHEET_CLOSE_MS } from '../../components/shared/BottomSheet';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { ToolsMenu } from '../../components/vibecoding/ToolsMenu';
import { DiagnosticsPanel } from '../../components/vibecoding/DiagnosticsPanel';
import {
  AttachmentMenuSheet,
  type AttachmentMenuAction,
} from '../../components/vibecoding/AttachmentMenuSheet';
import { AttachmentChips } from '../../components/vibecoding/AttachmentChips';
import { SessionPreviewCard } from './SessionPreviewCard';
import { revokePortMapping } from '../../api/portMappings';
import { resolvePullToRefreshAction } from './sessionRefreshDispatch';
import { firstServerConfirmedMessage } from '../../utils/sessionCatchUp';
import {
  MessageComposer,
  type ComposerMode,
} from '../../components/vibecoding/MessageComposer';
import { GoalDraftBar, GoalStatusBar } from '../../components/vibecoding/GoalStatusBar';
import { GoalDeletedFold } from '../../components/vibecoding/GoalDeletedFold';
import { mergeCommands } from '../../utils/agentCommands';
import { TranscriptMessageList } from '../../components/vibecoding/TranscriptMessageList';
import { ConversationScrubber } from '../../components/vibecoding/ConversationScrubber';
import { ResolvedApprovalsGroup } from '../../components/vibecoding/ResolvedApprovalsGroup';
import { ApprovalQuickPolicySheet } from '../../components/vibecoding/ApprovalQuickPolicySheet';
import { ApprovalCustomReply } from '../../components/vibecoding/ApprovalCustomReply';
import { ApprovalCountdownBadge } from '../../components/vibecoding/ApprovalCountdownBadge';
import { SessionOriginBadge } from '../../components/vibecoding/SessionOriginBadge';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useProject,
  useDevice,
  useSessionPreview,
  useSessionApprovals,
  useApproval,
  useApprovalIds,
  useSessionApprovalEvents,
  useRecentActiveTerminalSessionId,
} from '../../store/controlCenterStore';
import type { ApprovalRequest } from '../../store/controlCenterStore';
import type { AgentProvider } from '../../store/types';
import { useAttachmentLibraryStore } from '../../store/slices/attachmentLibrarySlice';
import { useToastStore } from '../../store/toastStore';
import {
  CAMERA_NEEDS_RUNTIME_PERMISSION,
  pickFromCamera,
  pickFromLibrary,
} from '../../services/attachmentUpload';
import {
  defaultAttachmentCaption,
  sendUserMessageWithAssets,
} from '../../services/attachmentSend';
import { takeEditorHandoff } from '../../services/editorHandoff';
import { touchAsset, type LocalAsset } from '../../services/attachmentLibrary';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import type {
  AgentBudgetInfo,
  StructuredActivityEvent,
  VibeCodingRun,
} from '../../data/platformModels';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import {
  catalogEffortOptions,
  useModelOptions,
} from '../../hooks/useModelOptions';
import {
  approvalTimelineItemId,
  buildConversationTimeline,
} from '../../utils/conversationTimeline';
import {
  deriveTurnScrubberStops,
  sampleRailIndices,
} from '../../utils/conversationScrubber';
import {
} from '../../utils/conversationTurns';
import {
  LIVE_TURN_WINDOW_MS,
  isAuthoritativeRunLive,
  isWaitingApprovalStatus,
  liveAssistantMessageId,
  phaseLabel,
  sessionPhaseType,
  shouldLockComposerForProvider,
  shouldSendAsSteer,
} from '../../utils/sessionPhase';
import { isSessionSnapshotStale } from '../../utils/sessionSnapshotStale';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import { formatContextWindow } from '../../utils/contextWindow';
import { isGoalCommand, parseGoalCommand } from '../../utils/goalComposer';
import { GOAL_UI_ENABLED } from '../../config/featureFlags';
import { sessionBusyErrorText } from '../../utils/sessionBusyError';
import { useNowTick } from '../../hooks/useNowTick';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import {

  useStableMeasurement,
} from '../../hooks/useStableMeasurement';
import { useVoiceStt } from '../../hooks/useVoiceStt';
import {
  catalogModelOptions,
  normalizeProvider,
  supportedEffortsFor,
} from '../../utils/modelIntensity';
import { createId } from '../../store/internals';
import {
  acquireDraftRequestId,
  confirmDraftRequestId,
} from './draftRequestRegistry';
import { useUiNoticeStore } from '../../store/uiNoticeStore';
import { useSessionDetailLoader } from './useSessionDetailLoader';
import { useSessionCatchUp } from './useSessionCatchUp';
import { fetchAiSession } from '../../api/sessions';
import { useConversationScrollController } from './useConversationScrollController';
import { useConversationTranscript } from './useConversationTranscript';
import { usePublishedVibeRun } from './usePublishedVibeRun';
import { useGoalControl, goalRequestErrorMessage } from './useGoalControl';
import { useSessionHeader } from './useSessionHeader';
import type { ConversationTurn } from '../../utils/conversationTurns';
import {
  createGoal,
  queueGoalMessage,
  type ServerGoalSnapshot,
} from '../../api/goals';
import { fallbackApprovalStatus } from '../../utils/sessionApprovalFallback';
import {
  countTrailingActiveActivityGroups,
  groupConsecutiveToolMessageIds,
} from '../../utils/activityGrouping';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;
type MessageTimelinePosition = 'single' | 'start' | 'middle' | 'end';

// During streaming the store updates on a ~60ms cadence; driving scroll-driven
// state at 60fps on top of that re-runs the conversation-rail computation every
// frame. Throttle the scroll→state bridge so the rail only recomputes a few
// times per second (leading edge) plus one trailing update when scrolling stops.
// Kept slightly above the server's agent round-trip ceiling
// (AGENT_REQUEST_TIMEOUT_MS = 12s) so the in-band detail response — which may
// wait for the desktop Agent to answer ai.session.detail — isn't pre-empted by
// the screen race. The underlying HTTP request uses its own 15s timeout too
// (fetchAiSession); this race is the safety net on top.

// Bug 2 fix: createGoal (POST /api/goals) hang 时强制超时阈值。
// export 出来便于测试断言常量值。
export const CREATE_GOAL_TIMEOUT_MS = 30_000;
// Bug 3 fix: sendingMessage 卡死自愈阈值。> createGoal 30s 超时 + 网络重试
// 余量；正常发送（含 draft startAgentSession）远不到此阈值。
export const SENDING_STALE_MS = 45_000;
// Bug 3 fix: 纯函数判定「sendingSinceRef 是否已过期」。提取出来便于测试，
// 组件内 handleSendText 复用此判定。
export const isSendingStale = (
  since: number | null,
  now: number = Date.now(),
): boolean => {
  if (since === null) return false;
  return now - since > SENDING_STALE_MS;
};

// goalRequestErrorMessage now in useGoalControl.
// Silent focus auto-refresh: when the chat screen re-focuses a session whose
// local copy may be stale (entered mid-run on another client, or been away long
// enough for idle demotion / a WS gap), re-pull the latest snapshot. See
// isSessionSnapshotStale + mergeVibeRunSnapshot (in-place merge → flicker-free).
const FOCUS_AWAY_THRESHOLD_MS = 60_000;
const AUTO_REFRESH_COOLDOWN_MS = 30_000;
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


const hasRenderableActivity = (events: StructuredActivityEvent[]): boolean =>
  events.some(
    event =>
      (event.kind === 'thinking' && event.active) ||
      event.kind === 'command' ||
      event.kind === 'file_change' ||
      event.kind === 'task' ||
      // 子 agent 行(tool-only 回合的常见唯一活动):缺席会让孤儿锚定直接丢弃,
      // 整个纯子 agent 回合在手机上不可见。
      event.kind === 'subagent',
  );

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

interface ConversationScrubberLayerProps {
  /** ALL conversation turns — the rail represents the whole conversation, not
   *  just the mounted window, so positions stay stable as history loads in. */
  conversationTurns: ConversationTurn[];
  /** The mounted window (a suffix of conversationTurns) — drives the idle
   *  highlight and dims marks whose turns aren't mounted yet. */
  visibleTurns: ConversationTurn[];
  messageLayouts: Record<string, { top: number; height: number }>;
  conversationTop: number;
  viewportHeight: number;
  onCommit: (stopId: string) => void;
  /** Lets the owning screen feed the live ScrollView scrollY into this layer
   *  WITHOUT making scrollY screen-level state (which would re-render the whole
   *  ~3200-line screen on every throttled scroll tick). The layer registers its
   *  setter on mount; the screen calls it from its throttled onScroll. Only this
   *  layer re-renders on scroll — the rest of the screen stays still. */
  registerScrollY: (fn: (y: number) => void) => () => void;
  /** Rendered just below the locator rail (scroll-to-bottom button). */
  belowRail?: React.ReactNode;
}

// 20 marks keeps the idle silhouette dense while stretching the pill to
// ~275px — a target the thumb can actually land on (16 marks ≈ 195px was
// notoriously hard to tap, per real-device feedback).
const MAX_RAIL_MARKS = 20;

// How long a scrubber jump may wait for a just-revealed turn's layout to flush
// before giving up (mounts + deferred layout flushes normally land in <100ms).
const JUMP_LAYOUT_TIMEOUT_MS = 3000;

// Isolates the scrubber's scroll-following focus calculation (the ONLY consumer
// of scrollY) from the giant session screen, so scrolling no longer re-renders
// the entire screen — only this small overlay layer. messageLayouts is passed in
// (it stays screen-level: low-frequency onLayout, shared with preserveFocus).
const ConversationScrubberLayer: React.FC<ConversationScrubberLayerProps> = React.memo(
  ({ conversationTurns, visibleTurns, messageLayouts, conversationTop, viewportHeight, onCommit, registerScrollY, belowRail }) => {
    const [scrollY, setScrollY] = useState(0);
    useEffect(() => registerScrollY(setScrollY), [registerScrollY]);

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
    // The rail samples the WHOLE conversation (≤16 marks). Unmounted turns
    // render as dimmer marks; the mounted window only drives the highlight.
    const conversationRailItems = useMemo(() => {
      if (!conversationTurns.length) return [];
      const activeIndex = activeRailTurnId
        ? conversationTurns.findIndex(turn => turn.id === activeRailTurnId)
        : -1;
      return sampleRailIndices(
        conversationTurns.length,
        MAX_RAIL_MARKS,
        activeIndex >= 0 ? activeIndex : undefined,
      ).map(index => {
        const turn = conversationTurns[index];
        return {
          turn,
          stopIndex: index,
          active: turn.id === activeRailTurnId,
          visible: visibleTurnIds.has(turn.id),
        };
      });
    }, [activeRailTurnId, conversationTurns, visibleTurnIds]);
    const scrubberStops = useMemo(
      () => deriveTurnScrubberStops(conversationTurns),
      [conversationTurns],
    );

    return (
      <ConversationScrubber
        collapsedMarks={conversationRailItems.map(({ turn, active, visible }) => ({
          id: turn.id,
          role: turn.role,
          active,
          visible,
        }))}
        markStopIndices={conversationRailItems.map(({ stopIndex }) => stopIndex)}
        stops={scrubberStops}
        // Every conversation turn is a stop now, so the idle focus is simply
        // the mounted turn nearest the viewport.
        activeStopId={activeRailTurnId}
        onCommit={onCommit}
        belowRail={belowRail}
      />
    );
  },
);
ConversationScrubberLayer.displayName = 'ConversationScrubberLayer';

export const VibeCodingSessionScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionRoute>();
  // 输入面板停靠物理底边，padding 需让出 home indicator。
  const insets = useSafeAreaInsets();
  // Fine-grained selectors: subscribe only to the specific session/project/
  // device/preview the user is viewing, so streaming deltas on OTHER sessions
  // don't trigger re-renders here.
  // Draft mode: opened from "Create VibeCoding" with draftConfig but no
  // sessionId — no session/server interaction until the first message. Render
  // against a local draft run (status idle — NOT running) so the chat UI shows
  // with an enabled composer + a "待开始" bubble. The first send creates the
  // real session; createdSessionId then flips to it, swapping draftRun for live.
  const draftConfig = route.params.draftConfig;
  const [createdSessionId, setCreatedSessionId] = useState(route.params.sessionId);
  const isDraft = !createdSessionId && !!draftConfig;
  const draftRun = useMemo<VibeCodingRun | null>(
    () =>
      isDraft && draftConfig
        ? {
            id: '__draft__',
            title: t('session.draftTitle'),
            deviceId: draftConfig.deviceId,
            projectId: draftConfig.projectId ?? '',
            directory: draftConfig.directory,
            status: 'idle',
            objective: '',
            model: draftConfig.model ?? '',
            provider: draftConfig.provider,
            effort: draftConfig.effort,
            // 草稿也有上下文窗口（创建页滑块），Tools 菜单要能显示并改它。
            contextWindow: draftConfig.contextWindow,
            risk: 'medium',
            currentStep: '',
            branch: '',
            updatedAt: '',
            lastActivityMs: 0,
            suggestions: [],
            transcript: [],
            events: [],
            structuredEvents: [],
          }
        : null,
    [isDraft, draftConfig, t],
  );
  // 发布节流门:流式期间新 run 身份至多 5Hz 发布(settle/失败/waiting_approval
  // 立即),屏幕组件体不再以 10Hz 随每个 stream batch 全量重跑。见 usePublishedVibeRun。
  const liveSession = usePublishedVibeRun(createdSessionId);
  const cachedSessionRef = useRef<VibeCodingRun | null>(null);
  const session =
    liveSession ??
    draftRun ??
    (cachedSessionRef.current?.id === createdSessionId
      ? cachedSessionRef.current
      : undefined);
  useEffect(() => {
    if (liveSession?.id === createdSessionId) {
      cachedSessionRef.current = liveSession ?? null;
    } else if (cachedSessionRef.current?.id !== createdSessionId) {
      cachedSessionRef.current = null;
    }
  }, [liveSession, createdSessionId]);
  const project = useProject(session?.projectId);
  const device = useDevice(session?.deviceId);
  // attach 优先：quick action 打开终端时带上设备当前 active 会话，恢复而非新建。
  const activeTerminalId = useRecentActiveTerminalSessionId(session?.deviceId);
  const preview = useSessionPreview(session?.id);
  const sessionApprovals = useSessionApprovals(session?.id);
  const discoveredSessionCommands = useControlCenterStore(
    state => (session?.id ? state.sessionCommands[session.id] : undefined),
  );
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
  // Used to create the session from the first message in draft mode.
  const startAgentSession = useControlCenterStore(
    state => state.startAgentSession,
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
  const focusedSessionId = createdSessionId;
  // Per-session timestamp of the last silent focus auto-refresh (cooldown).
  // Declared before useFocusEffect so the focus callback can read it.
  const lastAutoRefreshAtRef = useRef<Record<string, number>>({});
  // 水位对账:mount + 屏内快照计数推进时,用服务端权威 transcript_count 做
  // 数据比对,落后才增量补齐(见 useSessionCatchUp)。声明在 useFocusEffect
  // 之前,重进 focus 的重查走下方已有 effect 的 refreshLatestCount 入口。
  const sessionCatchUp = useSessionCatchUp({
    sessionId: focusedSessionId,
    transcriptCount: session?.transcriptCount,
    catchUpAgentMessages: useControlCenterStore(
      state => state.catchUpAgentMessages,
    ),
    cancelCatchUp: useControlCenterStore(
      state => state.cancelAiSessionCatchUp,
    ),
    // 触发1 自愈:元数据响应里现成的 transcript_page 不再被掐掉(审计问题6)。
    mergeServerTranscriptPage: useControlCenterStore(
      state => state.mergeServerTranscriptPage,
    ),
    fetchServerSessionMeta: fetchAiSession,
  });
  useFocusEffect(
    useCallback(() => {
      // Draft mode has no session id yet — nothing to mark as viewed.
      if (!focusedSessionId) return undefined;
      // Silent auto-recovery: if the local snapshot may be stale (session is
      // running on another client, or we've been away long enough for idle
      // demotion / a WS gap), re-pull the latest BEFORE re-stamping
      // lastViewedAt. Silent = no spinner; mergeVibeRunSnapshot merges in place
      // so there is no transcript flicker, and its stale guard rejects the
      // response if newer live deltas have landed since.
      try {
        // 水位重查先行:轻量元数据对账(缓存优先、不落后零请求),与下方的
        // 时间启发式互补——数据比对是权威,时间启发式只兜 WS 长静默的场景。
        sessionCatchUp.refreshLatestCount();
      } catch {
        // Never let a refresh hiccup break the focus marking below.
      }
      try {
        const storeState = useControlCenterStore.getState();
        const run = storeState.vibeRuns.find(r => r.id === focusedSessionId);
        const now = Date.now();
        const cooledDown =
          now - (lastAutoRefreshAtRef.current[focusedSessionId] ?? 0) >=
          AUTO_REFRESH_COOLDOWN_MS;
        if (
          run &&
          cooledDown &&
          isSessionSnapshotStale({
            now,
            status: run.status,
            lastActivityMs: run.lastActivityMs,
            lastViewedAt: run.lastViewedAt,
            awayThresholdMs: FOCUS_AWAY_THRESHOLD_MS,
            liveWindowMs: LIVE_TURN_WINDOW_MS,
          })
        ) {
          lastAutoRefreshAtRef.current[focusedSessionId] = now;
          void storeState
            // Cache-first recovery shares the mount request and avoids forcing an
            // agent round trip whenever a running conversation regains focus.
            .loadAgentSessionDetail(focusedSessionId)
            .catch(() => {
              // Best-effort: live WS + the always-visible manual refresh
              // button are the fallbacks. Cooldown still applies.
            });
        }
      } catch {
        // Never let a refresh hiccup break the focus marking below.
      }
      markSessionViewed(focusedSessionId);
      return () => {
        clearCurrentlyViewedSession(focusedSessionId);
      };
    }, [focusedSessionId, markSessionViewed, clearCurrentlyViewedSession, sessionCatchUp]),
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
  // One-shot: focus the text composer (pop the keyboard) after the voice draft
  // is transferred into the text field via "编辑". Reset on focus so subsequent
  // manual mode toggles don't auto-focus.
  const [autoFocusText, setAutoFocusText] = useState(false);
  const voiceStt = useVoiceStt();
  const { providerCatalog } = useModelOptions();
  const [detailError, setDetailError] = useState('');
  // Drives the ScrollView's RefreshControl. Pull-to-refresh forces a server
  // re-fetch (`refresh: true`) so an empty / offline result can recover — the
  // auto-load on mount only fires once and respects the cache.
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // ScrollView height from onLayout. Raw Fabric sub-pixel values defeat React's
  // bailout and can oscillate → `Maximum update depth exceeded`. Rounded + tol.
  const [viewportHeight, setViewportHeight] = useStableMeasurement(0);

  // Scroll controller (extracted hook — owns ~11 scroll/layout refs).
  const {
    scrollViewRef,
    handleScroll,
    followTail: followTailRef,
    showScrollToBottom,
    scrollToBottom,
    scheduleScrollToEnd,
    handleContentSizeChange,
    registerScrollY,
    preserveFocusRef,
    messageLayouts,
    handleConversationItemLayout,
    pendingJumpId,
    setPendingJumpId,
    reset: resetScroll,
  } = useConversationScrollController();

  // Screen-local scroll flag: pendingScrollToEnd is checked by the
  // scroll-to-end effect in JSX. Not in the hook (coupled to JSX rendering).
  const pendingScrollToEndRef = useRef(false);
  const sendLockRef = useRef<string | null>(null);
  // Bug 3 fix: 自愈兜底。setSendingMessage(true) 时戳时间戳；handleSendText
  // 入口若 isSendingStale(sendingSinceRef.current)，强制清 sendingMessage /
  // sendLockRef，避免 createGoal / appendAgentMessage 路径异常残留导致
  // 「有内容也发不出」的卡死。
  const sendingSinceRef = useRef<number | null>(null);
  const goalCreateRequestRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const targetSessionIdRef = useRef<string | undefined>(undefined);
  // preserveFocusRef now in useConversationScrollController.
  const [sendingMessage, setSendingMessage] = useState(false);
  const [goalDraftActive, setGoalDraftActive] = useState(false);
  const [goalCreating, setGoalCreating] = useState(false);
  const goalDraftPreviousInputRef = useRef('');

  const [interruptingTurn, setInterruptingTurn] = useState(false);
  const [toolsMenuVisible, setToolsMenuVisible] = useState(false);
  // 诊断面板（右侧滑出）：上下文用量 / 回合与守卫状态 / 失败真因。
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const handleToggleDiagnostics = useCallback(() => {
    setDiagnosticsOpen(value => !value);
  }, []);
  // Composer 回调稳定化:MessageComposer 已 React.memo,渲染点内联箭头会
  // 每次生成新引用击穿 memo(流式 ≤5Hz 屏幕重渲染时 composer 白陪跑)。
  const handleComposerModeChange = useCallback((nextMode: ComposerMode) => {
    setMode(nextMode);
  }, []);
  const handleToggleTools = useCallback(() => {
    setToolsMenuVisible(value => !value);
  }, []);

  // 素材菜单（T17）与「本轮待发送素材」选中态（T18）。选中态只活在屏幕层：
  // composer 保持哑组件，chip 渲染在输入面板里、composer 上方。
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState<LocalAsset[]>([]);
  const attachmentLibrary = useAttachmentLibraryStore(state => state.assets);
  const hydrateAttachmentLibrary = useAttachmentLibraryStore(
    state => state.hydrate,
  );
  const removeAttachmentAsset = useAttachmentLibraryStore(
    state => state.remove,
  );
  const clearAttachmentLibrary = useAttachmentLibraryStore(
    state => state.clear,
  );
  const showToast = useToastStore(state => state.show);
  // 服务端下发的单条消息素材上限；能力位未知时按 1 兜底（宁少勿多）。
  const attachmentMaxPerMessage =
    session?.attachmentsCapability?.max_per_message ?? 1;

  const handleOpenAttachments = useCallback(() => {
    // 两个菜单互斥：素材菜单盖在输入面板上，底下再开着工具菜单没有意义。
    setToolsMenuVisible(false);
    setAttachmentMenuVisible(true);
    // 每次打开都刷新「最近使用」：用户可能刚在别的会话里加过图。
    void hydrateAttachmentLibrary();
  }, [hydrateAttachmentLibrary]);

  const handleCloseAttachments = useCallback(() => {
    setAttachmentMenuVisible(false);
  }, []);

  const handleAttachmentAction = useCallback(
    async (action: AttachmentMenuAction) => {
      if (action === 'draw') {
        // 手绘是独立页面：菜单先关，保存后经 editorHandoff 把素材交回来。
        setAttachmentMenuVisible(false);
        navigation.navigate('Drawing');
        return;
      }
      if (action === 'ascii') {
        // 字符画同理：独立页面编辑，保存后经同一个交接槽位回到本屏。
        setAttachmentMenuVisible(false);
        navigation.navigate('Ascii');
        return;
      }
      setAttachmentMenuVisible(false);
      // 相机/相册的 native present 与 BottomSheet 的关闭动画在同一拍会撞车：
      // 上一个呈现还在飞时 UIKit 直接丢弃新呈现——真机 iOS 26 实测取景器
      // 「一闪而过」且无崩溃日志。等收起动画走完再拉系统选择器。
      await new Promise(resolve => setTimeout(resolve, SHEET_CLOSE_MS + 60));
      try {
        if (action === 'camera' && CAMERA_NEEDS_RUNTIME_PERMISSION) {
          // Android 需要在拉起相机前拿到运行时权限；iOS 由系统在 launchCamera
          // 时弹。被拒就停在原地给提示，不进入采集。
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            showToast(t('attachments.cameraDenied'), 'error');
            return;
          }
        }
        const picked =
          action === 'camera' ? await pickFromCamera() : await pickFromLibrary();
        if (picked.length === 0) return; // 用户取消，不是错误
        // 在 updater 外面算：setState 的 updater 可能被 React 重放，
        // 里面弹 toast 会弹两次。
        const merged = [...pendingAssets];
        let capped = false;
        for (const asset of picked) {
          if (merged.some(item => item.id === asset.id)) continue;
          if (merged.length >= attachmentMaxPerMessage) {
            capped = true;
            break;
          }
          merged.push(asset);
        }
        setPendingAssets(merged);
        if (capped) {
          // 已经选满：给出提示，不然用户以为点击没生效。
          showToast(t('attachments.maxReached'), 'info');
        }
      } catch {
        showToast(t('attachments.error'), 'error');
      }
    },
    [attachmentMaxPerMessage, pendingAssets, showToast, t],
  );

  const handlePickRecentAttachment = useCallback(
    (asset: LocalAsset) => {
      setAttachmentMenuVisible(false);
      if (pendingAssets.some(item => item.id === asset.id)) return;
      if (pendingAssets.length >= attachmentMaxPerMessage) {
        showToast(t('attachments.maxReached'), 'info');
        return;
      }
      setPendingAssets(prev => [...prev, asset]);
    },
    [attachmentMaxPerMessage, pendingAssets, showToast, t],
  );

  const handleRemovePendingAttachment = useCallback((asset: LocalAsset) => {
    setPendingAssets(prev => prev.filter(item => item.id !== asset.id));
  }, []);

  // 删本地素材时同步摘掉它的 chip：文件没了，留着 chip 只会在发送时才炸。
  const handleDeleteRecentAttachment = useCallback(
    (asset: LocalAsset) => {
      setPendingAssets(prev => prev.filter(item => item.id !== asset.id));
      void removeAttachmentAsset(asset.id);
    },
    [removeAttachmentAsset],
  );

  // 清空同理：pending 里的素材全部来自库，库清空后它们都没文件了。
  const handleClearRecentAttachments = useCallback(() => {
    setPendingAssets([]);
    void clearAttachmentLibrary();
  }, [clearAttachmentLibrary]);

  // 入口可用性：goal 会话走 queueGoalMessage，没有素材通道；服务端没配 COS
  // 时 `enabled === false`。能力位未知（列表快照不带 → undefined）按不可用
  // 处理——不让用户点进一条注定失败的链路。
  //
  // 草稿（首条消息前）曾经一票否决——「没有 sessionId 上传无处可去」。但
  // capability 的 enabled 只取决于服务端 COS 配置，是**部署级全局**而非会话级
  // （attachments/capability.ts），所以草稿可以用「任意已知会话的能力位」做
  // 忠实代理：有任一会话报告 enabled，草稿将来也必然 enabled。素材本身在
  // 挑选时只是本地 LocalAsset，上传发生在发送时——草稿发送路径已补上
  // 「会话落地后立刻补发素材消息」（见 appendUserMessage 草稿分支）。
  const draftAttachmentsCapability = useControlCenterStore(state => {
    if (!draftConfig) return undefined;
    // 先找同设备的会话（代理最忠实），退化到任意会话。
    for (const run of state.vibeRuns) {
      if (run.deviceId === draftConfig.deviceId && run.attachmentsCapability !== undefined) {
        return run.attachmentsCapability;
      }
    }
    for (const run of state.vibeRuns) {
      if (run.attachmentsCapability !== undefined) return run.attachmentsCapability;
    }
    return undefined;
  });
  const attachmentsEnabled =
    session != null
      ? session.purpose !== 'goal' && session.attachmentsCapability?.enabled === true
      : isDraft && draftAttachmentsCapability?.enabled === true;

  const handleComposerTextInputFocus = useCallback(() => {
    setAutoFocusText(false);
    pendingScrollToEndRef.current = true;
    scheduleScrollToEnd(true);
  }, [scheduleScrollToEnd]);
  const [resolvingApproval, setResolvingApproval] = useState<{
    id: string;
    decision: 'approved' | 'denied';
  } | null>(null);
  // Quick approval-policy sheet ("更多" on a pending approval card). Holds the
  // approval id that should be auto-approved alongside the policy switch, plus
  // the raw tool name (so the sheet can show MCP namespace tiers when relevant).
  const [quickPolicyFor, setQuickPolicyFor] = useState<{
    approvalId: string;
    toolName?: string;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const focusedApprovalId = route.params.approvalId;
  // Fine-grained approval subscriptions, replacing the old global
  // `state.approvals` / `state.events` subscriptions (which re-rendered this
  // screen on ANY approval/event mutation, including other sessions'). Each of
  // these re-renders only when its own slice changes.
  const focusedApproval = useApproval(focusedApprovalId);
  const sessionApprovalEvents = useSessionApprovalEvents(
    session?.id,
    focusedApprovalId,
  );
  const allApprovalIds = useApprovalIds();
  const resolvableApprovalIds = useMemo(
    () => new Set(allApprovalIds),
    [allApprovalIds],
  );

  // scheduleScrollToEnd + handleScroll now in useConversationScrollController.
  // Conversation section's y-offset from onLayout — same sub-pixel guard as
  // viewportHeight. Feeds scroll/scrubber math, must stay stable across passes.
  const [conversationTop, setConversationTop] = useStableMeasurement(0);
  // conversationTimeline's offset within conversationSection. messageLayouts
  // are measured relative to conversationTimeline, so jump targets need this
  // bridge term to land exactly (see the scrubber jump effect).
  const [timelineTop, setTimelineTop] = useStableMeasurement(0);
  // messageLayouts + pendingLayoutsRef + layoutFlushTimerRef now in useConversationScrollController.
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  // pendingJumpId/setPendingJumpId now in useConversationScrollController.
  // In draft mode there's no real session id yet — leave targetSessionId empty
  // so the auto-detail-fetch guard (below) skips (no server call until the
  // first message creates the session).
  const targetSessionId = isDraft
    ? createdSessionId
    : session?.id ?? createdSessionId;
  useEffect(() => {
    targetSessionIdRef.current = targetSessionId;
  }, [targetSessionId, resetScroll]);
  const isSessionLive =
    session != null &&
    isAuthoritativeRunLive(
      session.runStateVersion,
      session.runState,
      session.status,
    );
  // TUI 驱动的运行:扫描上报的 running(无 v2 runStateVersion)且会话与终端
  // 共享(sourceSessionId 在)。停止是真实有效的——server 给 ai.stop 附
  // source_session_id,agent 对外部终端 Claude Code 回合发一次 SIGINT
  // (≈按一次 Esc;agent >= v1.1.36 即支持),所以停止键不再置灰(2026-10-24
  // 状态矩阵清洗 G1a)。但 **steer 通道不存在**:外部 TUI 进程不在 agent 的
  // 会话表里,注入无处可去(连 agent v1.1.67 的 UDS steer 也只覆盖 agent 自己
  // spawn 的注入回合,CAP-6)——运行期间 composer 只读,回合结束再续写。
  const tuiDrivenRunning =
    !isDraft &&
    session?.sourceSessionId != null &&
    session?.status === 'running' &&
    session?.runStateVersion === undefined;
  // TUI 执行器运行（手机发起、但 agent 把消息注入到终端里的 Claude Code）。
  // 与上面的「外部 TUI 驱动」不同：这条 run 在 agent 自己的会话表里，停止是
  // 有效的，但**没有 steer 通道**——注入帧只有文本，运行中塞图片必然失败。
  // 因此运行中锁住 composer，等回合结束再作为新一轮发送（agent 会先下载附件
  // 再注入，见 runTUITurn）。老 server 不下发 executor → 不触发，保持旧行为。
  const tuiExecutorRunning =
    !isDraft && session?.executor === 'tui' && session?.status === 'running';
  // ── Conversation transcript projection (extracted hook) ──
  const {

    transcript,
    goalFolds,
    conversationTurns,
    displayTranscriptSource,
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
    revealTurnsThrough,
    agentEventList,



  } = useConversationTranscript({
    session: session ?? undefined,
    targetSessionId,
    isSessionLive,
  });

  // First-fetch guard: skip the auto-load only when we already hold the
  // transcript detail (an authoritative detailState — ready/empty — or a hot
  // window delivered messages). DO NOT count events — a session can carry
  // lifecycle events while its hot transcript is empty (status-only WS
  // updates), and counting those would suppress the fetch and leave the chat
  // blank. Recoverable/offline/failed states stay non-authoritative so the
  // auto-load keeps re-attempting instead of freezing on a blank conversation.
  const {
    loadingDetail,
    refreshingLatest,
    refreshLatest,
  } = useSessionDetailLoader({
    targetSessionId,
    detailState: session?.detailState,
    transcriptLength: session?.transcript.length ?? 0,
    detailFromPage: session?.detailFromPage,
    wsConnected,
    deviceStatus: device?.status,
    loadAgentSessionDetail,
    t,
    refreshing,
    detailError,
    setDetailError,
  });




  // Pull-to-refresh + retry entry point. Unlike the mount auto-load (which runs
  // once and respects the server's page cache), this forces `refresh: true` so
  // the server re-asks the agent — the only way to recover from an earlier
  // empty/offline result. Always fires regardless of hasDetail/detailError.
  // Force a fresh agent detail fetch — the "refresh latest / recover" path that
  // re-asks the agent for the newest transcript snapshot. This is the ONLY way
  // to recover from an earlier blank/offline result. Exposed as a dedicated
  // affordance on the bottom status bubble, so pull-to-refresh can stay
  // dedicated to "load earlier history".

  // Capture the topmost visible message so the viewport can be pinned to it
  // once older messages are prepended above (otherwise prepending content
  // shoves what the user is reading down / out of view).
  const capturePreserveFocus = useCallback(() => {
    const focusId = visibleTurns[0]?.id;
    const focusLayout = focusId ? messageLayouts[focusId] : undefined;
    if (!focusId || !focusLayout) return;
    preserveFocusRef.current = {
      id: focusId,
      distance: 0,
      prevTop: focusLayout.top,
    };
  }, [messageLayouts, visibleTurns, preserveFocusRef]);

  // 分批揭示进行中:preserve 锚点跨批保持。每批新内容都 prepend 在焦点消息
  // 上方,把它的 layout.top 再往下推——锚定 effect 必须逐批校正,不能在第一
  // 批校正后就清掉锚点(否则后续批次的 prepend 会让视口逐批下坠)。
  const revealHoldRef = useRef(false);

  const handleLoadEarlierMessages = useCallback(async () => {
    if (!targetSessionId || loadingEarlier) return;
    if (turnList.hasMore) {
      // Reveal more of the locally-held transcript (no network). Pin first so
      // the newly revealed older messages appear above without a viewport jump.
      // 分批揭示:一批 4 个 turn,单 commit 巨挂载拆成多个小挂载。
      // 转轮(refreshing)的所有权在本函数:入口置 true、仅当本次揭示自然
      // 收尾(!superseded)才复位——被 scrubber 跳转/按钮连点顶掉时,转轮与
      // hold 一并由接管方负责,旧调用方的 finally 不再互踩(修复"按钮在下拉
      // 揭示中点击→新一轮揭示的转轮被旧 finally 提前熄灭")。
      capturePreserveFocus();
      revealHoldRef.current = true;
      setRefreshing(true);
      const done = await turnList.showMoreGradually();
      if (!done.superseded) {
        revealHoldRef.current = false;
        setRefreshing(false);
      }
      return;
    }
    if (hasServerEarlierMessages) {
      capturePreserveFocus();
      setLoadingEarlier(true);
      setRefreshing(true);
      setDetailError('');
      try {
        await loadEarlierAgentMessages(targetSessionId);
        revealHoldRef.current = true;
        const done = await turnList.showMoreGradually();
        if (!done.superseded) {
          revealHoldRef.current = false;
          setRefreshing(false);
        }
      } catch (error) {
        revealHoldRef.current = false;
        setRefreshing(false);
        preserveFocusRef.current = null;
        setDetailError(
          error instanceof Error
            ? error.message
            : t('session.loading.loadEarlierFailed'),
        );
      } finally {
        setLoadingEarlier(false);
      }
      return;
    }
  }, [
    capturePreserveFocus,
    hasServerEarlierMessages,
    preserveFocusRef,
    loadEarlierAgentMessages,
    loadingEarlier,
    t,
    targetSessionId,
    turnList,
  ]);

  // Pull-to-refresh dispatcher. In a chat, pulling at the top prefers "load
  // earlier history" (the universal pattern), but ONLY when that path can
  // actually do work — the store-level loader silently no-ops without a
  // server-confirmed anchor, so a blank session (or one holding only client
  // bubbles) must fall through to a forced refresh instead of a dead gesture.
  // When there is nothing earlier to fetch, pulling now forces a refresh=true
  // detail load: TUI content is pull-only, so the latest server/agent truth
  // only arrives through that path (2026-10-18 全链审计 S1/S2 修复).
  const handleRefresh = useCallback(async () => {
    if (!targetSessionId) return;
    const action = resolvePullToRefreshAction({
      hasEarlierToLoad: !!(turnList.hasMore || hasServerEarlierMessages),
      hasServerConfirmedAnchor: Boolean(
        firstServerConfirmedMessage(session?.transcript ?? []),
      ),
    });
    if (action === 'load-earlier') {
      // 转轮由 handleLoadEarlierMessages 持有(覆盖揭示期,且与 hold 同一生
      // 命周期)——这里不再自带 setRefreshing,否则按钮路径顶掉揭示时旧
      // finally 会把新一轮的转轮熄灭。
      await handleLoadEarlierMessages();
      return;
    }
    setRefreshing(true);
    setDetailError('');
    try {
      await refreshLatest();
    } finally {
      setRefreshing(false);
    }
  }, [
    handleLoadEarlierMessages,
    refreshLatest,
    hasServerEarlierMessages,
    session?.transcript,
    targetSessionId,
    turnList,
  ]);

  useEffect(() => {
    setTimelineExpanded(false);
    resetScroll();
    pendingScrollToEndRef.current = true;
    // 切会话:解除分批揭示的锚点保持(hook 内部也会取消在途批次)。在途揭示
    // 被顶掉走 superseded 路径时,持有方会跳过清理——转轮必须在这里显式熄灭,
    // 否则泄漏到新会话上永久转圈。
    revealHoldRef.current = false;
    setRefreshing(false);
  }, [targetSessionId, resetScroll]);

  // Self-heal for the "top bar DONE, conversation blank" case. The run snapshot
  // that flips session.status to completed never carries the transcript, so a
  // session whose last detail fetch was skipped_offline / failed stays empty
  // until something re-asks the agent. When the agent comes back online (device
  // offline→online, or a WS reconnect) while such a blank session is on screen,
  // fire one forced refresh. Edge-triggered so it runs once per recovery, not
  // every render; prevRecoverableRef is reset on session change above.

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // handleConversationItemLayout now in useConversationScrollController.
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

  // When the current jump was requested — deadlines the wait-for-layout loop
  // below so a dead target can't leave a pending jump hanging forever.
  const jumpRequestedAtRef = useRef(0);

  // 跳转所需的窗口扩宽:需要揭示的 turn 数超过阈值时分批走到目标——跳向
  // 会话前部≈一帧挂载大半会话,是冻结形态之一。小揭示保持同步,不为几个
  // turn 付出批间隔延迟。目标 turn 在最后一批挂载,jump effect 本就等它的
  // layout 再滚动,分批不影响落点。
  const REVEAL_BATCH_MIN_TURNS = 8;
  const revealTurnsForJump = useCallback(
    (neededVisibleCount: number) => {
      if (neededVisibleCount - turnList.visibleCount > REVEAL_BATCH_MIN_TURNS) {
        turnList.revealThroughGradually(neededVisibleCount);
        return;
      }
      revealTurnsThrough(neededVisibleCount);
    },
    [revealTurnsThrough, turnList],
  );

  // User settled on a scrubber stop → jump there. The rail spans the WHOLE
  // conversation, so the target turn may sit outside the mounted window: widen
  // the window just enough to mount it (targeted, not showAll) and let the jump
  // effect below wait for its layout.
  const handleScrubberCommit = useCallback(
    (stopId: string) => {
      followTailRef.current = false;
      const turnIndex = conversationTurns.findIndex(
        turn => turn.id === stopId,
      );
      if (turnIndex >= 0) {
        revealTurnsForJump(conversationTurns.length - turnIndex);
      }
      jumpRequestedAtRef.current = Date.now();
      setPendingJumpId(stopId);
    },
    [conversationTurns, followTailRef, revealTurnsForJump, setPendingJumpId],
  );

  useEffect(() => {
    if (!pendingJumpId) return;
    const layout = messageLayouts[pendingJumpId];
    if (!layout) {
      // A just-revealed turn hasn't laid out yet (layouts flush in a deferred
      // macrotask after mount). Keep waiting — the effect re-runs on the next
      // layout flush — but give up past the deadline instead of hanging.
      if (Date.now() - jumpRequestedAtRef.current > JUMP_LAYOUT_TIMEOUT_MS) {
        setPendingJumpId(null);
      }
      return;
    }
    // timelineTop bridges the coordinate systems: layout.top is measured
    // relative to the conversationTimeline container, while conversationTop is
    // the section's offset in the scroll content. Without the bridge term the
    // jump landed ~100-200px too high (header/LoadMoreRow/boundary heights).
    const y = conversationTop + timelineTop + layout.top;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
    setPendingJumpId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs/setters are stable
  }, [
    pendingJumpId,
    messageLayouts,
    conversationTop,
    timelineTop,
  ]);

  // Restore the viewport to the message that was on top before an earlier-page
  // load, once the newly-prepended older messages have re-laid-out (which
  // shifts that message's offset down). We wait until the focus message has
  // actually been re-measured (its `top` changed) so we don't pin against a
  // stale pre-prepend offset; a session change clears the ref outright above.
  // followTail is already false when pulling at the top, so the tail-follow
  // effect can't fight this.
  // 分批揭示期间(revealHoldRef)锚点跨批保持:每批 prepend 都把焦点消息的
  // top 再往下推,本 effect 逐批以新偏移为基准继续校正;批次收尾
  // (onSettled 翻下 hold)后走原有的一次性清除路径。
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
    focus.prevTop = layout.top;
    if (!revealHoldRef.current) {
      preserveFocusRef.current = null;
    }
    scrollViewRef.current?.scrollTo({ y: targetY, animated: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [messageLayouts, conversationTop, visibleTurnLayoutKey]);

  const deviceOffline = device?.status === 'offline';
  const effectiveProvider = normalizeProvider(
    session?.effectiveModelConfig?.provider ?? session?.provider,
  );
  // --- live 回合信号(hoist 到此处:composer 锁 / 停止按钮 / 发送 handlers 都先于此用到)---
  // 事件驱动:isSessionLive = isSessionTurnActive(status) = status==='running'。回合边界由
  // 确定性事件决定(发送→running / ai.done→idle / ai.error→failed / 中断→idle),配合
  // mergeVibeRunSnapshot 的双向 stale 守卫——回合内 status 稳定 running、结束即时 idle。
  // 不再用 8s 活动窗口:当年抖动是「用活动新鲜度猜结束」所致,换到事件驱动 status 后,
  // 结束是确定信号(ai.done),不需要 debounce,也就没有 8s 滞后。
  const now = useNowTick();
  // 统一源头:顶部相位 / composer 锁 / 停止按钮 / 发送 guard / L2-L3 脉冲都看它。
  // L3「哪条助手消息在流式」的高亮锚点:仅当回合在跑时才高亮最后一条 assistant 消息;
  // ai.done→idle 后 isSessionLive 即 false,高亮即时消失(不再拖 8s)。
  const liveMessageId = useMemo(
    () =>
      isSessionLive
        ? liveAssistantMessageId(
            session?.transcript ?? [],
            session?.lastActivityMs,
            now,
          )
        : undefined,
    [isSessionLive, session?.lastActivityMs, session?.transcript, now],
  );
  // livePulse now in useSessionHeader.
  // Composer 锁:用 isSessionLive 判活(与顶部相位同源)。失败会话不锁(发新消息/重试会让
  // 服务端把 error 翻回 running)。详见 utils/sessionPhase.shouldLockComposerForProvider。
  // 设备是否具备 Claude 回合中插话通道（新 agent 的 ai_steer_claude 能力位）。
  // 有则运行中不锁 composer，让用户能把消息作为 steer 发出去。
  const canSteerClaude = Boolean(
    device?.capabilities?.includes('ai_steer_claude'),
  );
  // 设备是否具备「外部 TUI 会话插话」通道（ai_steer_external，agent 端 CC
  // >= 2.1.224 版本探测）：tuiDrivenRunning 的导入会话也能经 CC 收件箱排队
  // 插话，composer 不必再只读（2026-10-24 外部 steer 扩展）。
  const canSteerExternal = Boolean(
    device?.capabilities?.includes('ai_steer_external'),
  );
  // 审批等待（runState 感知 canonical 谓词）：composer 锁 / 停止键审批腿 /
  // 只读文案三处共用同一份判定（2026-10-24 codex 审批锁——审批期对任何
  // provider 都是「会话暂停、不得发新消息」）。
  const waitingApproval = isWaitingApprovalStatus(
    session?.status,
    session?.runStateVersion,
    session?.runState,
  );
  const shouldDisableComposerForProvider = shouldLockComposerForProvider(
    isSessionLive,
    session?.status,
    effectiveProvider,
    // TUI 执行器运行没有 steer 通道（注入帧只有文本帧外的东西都不行）：即使
    // 设备宣称 ai_steer_claude，本轮也不能插话，按「运行中锁 composer」处理。
    // tuiDrivenRunning（导入/外部 TUI 回合）原本同样排除——锁谓词与
    // canSteerTurn 必须同源，否则出现「可打字却没有发送键」的混合态
    // （2026-10-24 状态矩阵清洗 G1b）；设备具备 ai_steer_external 后该形态
    // 可插话，不再排除。这里主要是防御，主门在 composerReadOnlyReason。
    canSteerClaude && !tuiExecutorRunning && (!tuiDrivenRunning || canSteerExternal),
    // 审批等待：v2 快照的 status='paused' 形态由 canonical 谓词认出，
    // 任何 provider（含 codex）此刻都锁 composer。
    waitingApproval,
  );

  const goalContext = () => {
    if (isDraft && draftConfig) {
      return {
        deviceId: draftConfig.deviceId,
        projectId: draftConfig.projectId,
        projectPath: draftConfig.directory,
        provider: draftConfig.provider,
        model: draftConfig.model,
        effort: draftConfig.effort,
      };
    }
    if (!session) return undefined;
    return {
      deviceId: session.deviceId,
      projectId: session.projectId,
      projectPath: session.directory,
      provider: session.provider,
      model: session.model,
      effort: session.effort,
    };
  };

  const enterGoalDraft = useCallback((
    objective = '',
    previousDraft = input,
    options: { keepToolsOpen?: boolean } = {},
  ) => {
    if (session?.purpose === 'goal') return;
    if (['connecting', 'recording', 'stopping'].includes(voiceStt.status)) {
      void voiceStt.stop();
    }
    if (!goalDraftActive) goalDraftPreviousInputRef.current = previousDraft;
    setGoalDraftActive(true);
    setMode('text');
    setInput(objective);
    if (!options.keepToolsOpen) setToolsMenuVisible(false);
    setDetailError('');
  }, [goalDraftActive, input, session?.purpose, voiceStt]);

  const exitGoalDraft = useCallback(() => {
    if (goalCreating) return;
    setGoalDraftActive(false);
    setInput(goalDraftPreviousInputRef.current);
    goalDraftPreviousInputRef.current = '';
  }, [goalCreating]);

  const enterGoalSession = (
    goal: ServerGoalSnapshot & { ai_session_id: string },
  ) => {
    setGoalDraftActive(false);
    goalDraftPreviousInputRef.current = '';
    setInput('');
    setCreatedSessionId(goal.ai_session_id);
    // If the goal attached to the current conversation session, stay on it
    // (history preserved, goal is a state of the existing conversation).
    // Only navigate when a brand-new goal session was created (e.g., from a
    // draft with no prior conversation).
    if (goal.ai_session_id !== session?.id) {
      navigation.setParams({
        sessionId: goal.ai_session_id,
        draftConfig: undefined,
      });
    }
    void loadAgentSessionDetail(goal.ai_session_id).catch(error => {
      setDetailError(
        `Goal 已创建，正在重新同步会话：${goalRequestErrorMessage(error)}`,
      );
    });
  };

  const createProjectGoal = async (objective: string): Promise<boolean> => {
    const context = goalContext();
    const normalizedObjective = objective.trim();
    if (!context || !normalizedObjective || sendLockRef.current) return false;
    const fingerprint = JSON.stringify({ ...context, objective: normalizedObjective });
    const existingRequest = goalCreateRequestRef.current;
    const requestId =
      existingRequest?.fingerprint === fingerprint
        ? existingRequest.requestId
        : createId('goal-create');
    goalCreateRequestRef.current = { fingerprint, requestId };
    sendLockRef.current = requestId;
    sendingSinceRef.current = Date.now();
    setSendingMessage(true);
    setGoalCreating(true);
    setDetailError('');
    try {
      // Bug 2 fix: createGoal (POST /api/goals) 若 hang 不返回，finally 不执行
      // → sendLockRef / sendingMessage 残留 → 后续发送全部静默 no-op。
      // 用 Promise.race 加 CREATE_GOAL_TIMEOUT_MS 超时：到点 reject → 进
      // catch 提示 → finally 必执行清锁。配合 Bug 3 的 sendingSinceRef 兜底。
      let goalTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        goalTimeoutId = setTimeout(() => reject(new Error(`创建 Goal 超时（${CREATE_GOAL_TIMEOUT_MS / 1000}s 无响应）`)), CREATE_GOAL_TIMEOUT_MS);
      });
      const created = await Promise.race([
        createGoal({
          deviceId: context.deviceId,
          projectId: context.projectId,
          projectPath: context.projectPath,
          objective: normalizedObjective,
          idempotencyKey: requestId,
          provider: context.provider,
          model: context.model,
          effort: context.effort,
          // Attach to the existing conversation (preserve history) when there is
          // one; only let the server create a fresh goal session from a draft.
          aiSessionId: !isDraft && session ? session.id : undefined,
        }),
        timeoutPromise,
      ]).finally(() => {
        if (goalTimeoutId) clearTimeout(goalTimeoutId);
      });
      goalCreateRequestRef.current = null;
      enterGoalSession(created);
      return true;
    } catch (error) {
      const message = goalRequestErrorMessage(error);
      setDetailError(message);
      return false;
    } finally {
      if (sendLockRef.current === requestId) sendLockRef.current = null;
      sendingSinceRef.current = null;
      setSendingMessage(false);
      setGoalCreating(false);
    }
  };

  const appendUserMessage = async (
    content: string,
    messageMode: 'voice' | 'text',
    assets: LocalAsset[] = [],
  ) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || sendLockRef.current) {
      return false;
    }
    if (goalDraftActive && session?.purpose !== 'goal') {
      return createProjectGoal(normalizedContent);
    }
    // GOAL_UI_ENABLED 关闭时 /goal 不再是建 goal 的入口:文字照普通消息发出去,
    // 不再被拦下来变成 createProjectGoal(否则用户手打 /goal 仍能造出 goal 会话)。
    const parsedGoalCommand = GOAL_UI_ENABLED
      ? parseGoalCommand(normalizedContent)
      : null;
    if (parsedGoalCommand !== null && session?.purpose !== 'goal') {
      const goalCommand = parsedGoalCommand.trim();
      if (goalCommand) return createProjectGoal(goalCommand);
      enterGoalDraft();
      return true;
    }
    // Draft mode: no session yet. The first message CREATES the session — send
    // ONLY this real message (startAgentSession does create+message). No init /
    // hint text is ever sent to the server/agent.
    if (isDraft && draftConfig) {
      const sendKey = `draft:${messageMode}:${normalizedContent}`;
      // The create API does not distinguish voice/text; fingerprint only the
      // actual server payload so changing composer mode cannot create a second
      // conversation for the same first message.
      const requestFingerprint = normalizedContent;
      // 服务端 create 载荷指纹:requestId 复用的两级来源——① 同 draft 的
      // navigation params(pendingRequestId);② 跨导航/跨卸载的登记表
      // (draftRequestRegistry,TTL 10min)。2026-10-28 实锤(7-24 重复卡):
      // params 丢失后重试换 requestId,服务端幂等键含 requestId,同内容也会
      // 建出第二条会话。登记表兜住「失败后离开页面再回来重试」这条缝。
      const draftCreatePayload = {
        deviceId: draftConfig.deviceId,
        projectId: draftConfig.projectId ?? '',
        directory: draftConfig.directory,
        provider: draftConfig.provider,
        objective: normalizedContent,
        model: draftConfig.model,
        effort: draftConfig.effort,
        contextWindow: draftConfig.contextWindow,
        approvalScheme: draftConfig.approvalScheme,
        canRead: draftConfig.canRead,
        canModify: draftConfig.canModify,
        canRun: draftConfig.canRun,
      };
      const clientRequestId =
        draftConfig.pendingRequestFingerprint === requestFingerprint &&
        draftConfig.pendingRequestId
          ? draftConfig.pendingRequestId
          : acquireDraftRequestId(draftCreatePayload);
      if (
        draftConfig.pendingRequestId !== clientRequestId ||
        draftConfig.pendingRequestFingerprint !== requestFingerprint
      ) {
        navigation.setParams({
          draftConfig: {
            ...draftConfig,
            pendingRequestId: clientRequestId,
            pendingRequestFingerprint: requestFingerprint,
          },
        });
      }
      sendLockRef.current = sendKey;
      pendingScrollToEndRef.current = true;
      sendingSinceRef.current = Date.now();
    setSendingMessage(true);
      try {
        const sessionId = await startAgentSession({
          deviceId: draftConfig.deviceId,
          clientRequestId,
          projectId: draftConfig.projectId ?? '',
          directory: draftConfig.directory,
          provider: draftConfig.provider as AgentProvider,
          objective: normalizedContent,
          model: draftConfig.model,
          effort: draftConfig.effort,
          contextWindow: draftConfig.contextWindow,
          // Forward per-session permission override (create-flow "session
          // permissions"). approvalScheme is undefined when 'inherit' — the
          // store/API omit it on the wire so the server keeps the resolved
          // project/device policy. canRead/canModify/canRun pass straight through.
          approvalScheme: draftConfig.approvalScheme,
          canRead: draftConfig.canRead,
          canModify: draftConfig.canModify,
          canRun: draftConfig.canRun,
        });
        // Flip from draft to the real session IN PLACE — no remount. setParams
        // mutates the current route's params so the back-stack / a persisted
        // nav-state restore keeps the real sessionId (not the draftConfig route),
        // while setCreatedSessionId swaps this instance draft→live immediately.
        // NOTE: navigation.replace was used here before, but replace UNMOUNTS
        // this screen and mounts a fresh one — clearing the input, resetting
        // scroll, and re-fetching detail — which the user sees as a jarring
        // "jump to a new same-layout page" right after the first send.
        confirmDraftRequestId(draftCreatePayload);
        setCreatedSessionId(sessionId);
        navigation.setParams({ sessionId, draftConfig: undefined });
        // 草稿现在允许带素材（入口门控见 draftAttachmentsCapability）：create
        // 的首条消息=objective 是原子的、没有素材字段，所以素材作为第二条
        // 「素材消息」立刻补发（默认说明兜底，与活会话的 attachments-only
        // 发送同一条 service 路径）。上传失败会 throw——此时 objective 已经
        // 发出去了，素材留在 chips 里，用户可再点一次发送重试（此时已是
        // 活会话路径）。
        if (assets.length > 0) {
          await sendUserMessageWithAssets({
            sessionId,
            content: defaultAttachmentCaption(assets, t),
            assets,
            send: (outgoingContent, metas) =>
              appendAgentMessage(sessionId, outgoingContent, messageMode, metas),
            onUploadError: () => showToast(t('attachments.error'), 'error'),
            onSent: sentAssets => {
              const sentIds = new Set(sentAssets.map(item => item.id));
              setPendingAssets(prev => prev.filter(item => !sentIds.has(item.id)));
              void Promise.all(sentAssets.map(item => touchAsset(item.id)));
            },
          });
        }
        return true;
      } catch (error) {
        pendingScrollToEndRef.current = false;
        throw error;
      } finally {
        if (sendLockRef.current === sendKey) {
          sendLockRef.current = null;
        }
        sendingSinceRef.current = null;
      setSendingMessage(false);
      }
    }
    // 失败会话不再阻断发送:失败只是「上一轮没收到回复」,发新消息(或点失败消息旁
    // 的「重试」)会让服务端 claimAiSessionForRun 把 error 翻回 running。store 的
    // appendAgentMessage 也会乐观地先把 status 置 running。composer 已解锁,这里
    // 不能再硬闸 failed——否则按钮看着能点、点下去静默 no-op。
    if (!session || (shouldDisableComposerForProvider && session.purpose !== 'goal')) {
      return false;
    }
    // 素材 id 也进锁键：同一段文字配不同图片连发两次是合法操作，不能被
    // 「同文同模式」的锁误判成同一条消息。
    const sendKey = `${session.id}:${messageMode}:${assets
      .map(item => item.id)
      .join(',')}:${normalizedContent}`;
    sendLockRef.current = sendKey;
    pendingScrollToEndRef.current = true;
    sendingSinceRef.current = Date.now();
    setSendingMessage(true);
    // Clear any previous detail load error so a successful send won't show
    // a stale error banner alongside new messages.
    if (detailError) setDetailError('');
    try {
      if (session.purpose === 'goal') {
        const goalId = session.goalSummary?.goalId;
        if (!goalId) {
          throw new Error('Goal 状态尚未同步，暂时不能发送消息');
        }
        const parsedReplanObjective = parseGoalCommand(normalizedContent);
        const replacementObjective = parsedReplanObjective?.trim();
        if (parsedReplanObjective !== null && !replacementObjective) {
          throw new Error('请输入 /goal <新的完整目标> 来重新规划');
        }
        await queueGoalMessage(goalId, {
          content: replacementObjective ?? normalizedContent,
          mode: messageMode,
          kind: parsedReplanObjective !== null ? 'replan_request' : 'goal_message',
          idempotencyKey: createId('goal-message'),
          expectedStateVersion: session.goalSummary?.stateVersion,
        });
        return true;
      }
      // 先物化素材再发消息，成功才清 chips —— 顺序在 service 里钉住，
      // 这里只负责把 store / toast / 选中态接进来。
      await sendUserMessageWithAssets({
        sessionId: session.id,
        content: normalizedContent,
        assets,
        send: (outgoingContent, metas) =>
          appendAgentMessage(session.id, outgoingContent, messageMode, metas),
        onUploadError: () => showToast(t('attachments.error'), 'error'),
        onSent: sentAssets => {
          const sentIds = new Set(sentAssets.map(item => item.id));
          setPendingAssets(prev => prev.filter(item => !sentIds.has(item.id)));
          // 发出去的素材进「最近使用」；失败不影响本次发送（touchAsset 对
          // 不存在的 id 静默）。
          void Promise.all(sentAssets.map(item => touchAsset(item.id)));
        },
      });
      return true;
    } catch (error) {
      pendingScrollToEndRef.current = false;
      throw error;
    } finally {
      if (sendLockRef.current === sendKey) {
        sendLockRef.current = null;
      }
      sendingSinceRef.current = null;
      setSendingMessage(false);
    }
  };

  // 编辑器页（手绘 / 字符画）返回：素材已入库，这里负责「自动勾选」或
  // 「保存并发送」。用 focus 而不是导航参数：保存后编辑器 goBack()，本屏
  // 重新获得焦点时槽位里才有东西；取走即清空，重复聚焦不会重复发送。
  useFocusEffect(
    useCallback(() => {
      const handoff = takeEditorHandoff();
      if (!handoff) return;
      if (pendingAssets.some(item => item.id === handoff.asset.id)) return;
      if (pendingAssets.length >= attachmentMaxPerMessage) {
        showToast(t('attachments.maxReached'), 'info');
        return;
      }
      // 先入 chips：发送失败时素材留在输入框上方，用户重试不用重新画。
      setPendingAssets(prev => [...prev, handoff.asset]);
      if (!handoff.autoSend) return;
      // 服务端正文 min(1)，纯素材消息发不出去；草稿为空时按素材类型用一句
      // 默认说明兜底（字符画走文本通道，说明也要点明它是图）。
      const content =
        input.trim() || defaultAttachmentCaption([handoff.asset], t);
      void appendUserMessage(content, 'text', [handoff.asset]);
    }, [
      appendUserMessage,
      attachmentMaxPerMessage,
      input,
      pendingAssets,
      showToast,
      t,
    ]),
  );

  const handleVoiceCaptureStart = useCallback(() => {
    if (
      session?.purpose !== 'goal' &&
      (deviceOffline || shouldDisableComposerForProvider)
    ) return;
    if (
      voiceStt.status === 'recording' ||
      voiceStt.status === 'connecting' ||
      voiceStt.status === 'stopping'
    ) {
      return;
    }
    // Do NOT clear voiceDraft upfront. A previous recording's transcript is
    // valuable: if this recording fails or its onComplete never fires (short
    // tap / dropped stt.completed / network blip), the user still has the
    // earlier transcript to edit or send. We only replace voiceDraft once the
    // new transcript actually arrives in onComplete.
    void voiceStt
      .start({
        sessionId: session?.id,
        projectPath: session?.directory ?? project?.path,
        onComplete: transcript => {
          // Always overwrite: the latest recording's transcript is the truth.
          // (Empty transcript → reflects "this take recognized nothing".)
          setVoiceDraft(transcript);
        },
      })
      .then(started => {
        if (!started) {
          // Rejected by useVoiceStt (still stopping from a previous take).
          // Surface it so the user knows the tap didn't begin a recording,
          // rather than silently doing nothing.
          Alert.alert(t('common:voice.recognizeFailed'), t('common:voice.recorderBusy'));
        }
      });
  }, [deviceOffline, shouldDisableComposerForProvider, voiceStt, session, project, t]);

  const handleVoiceCaptureEnd = useCallback(() => {
    void voiceStt.stop();
  }, [voiceStt]);

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
    if (
      !draft ||
      sendingMessage ||
      (session?.purpose !== 'goal' && (deviceOffline || shouldDisableComposerForProvider))
    ) {
      return;
    }
    void appendUserMessage(draft, 'voice', pendingAssets)
      .then(sent => {
        if (sent) {
          setVoiceDraft('');
        }
      })
      .catch(error => {
        // 与文本路径同口径：忙类拒绝走既有横幅给友好提示，其余静默（failed 气泡）。
        const busyText = sessionBusyErrorText(error, t);
        if (busyText) setDetailError(busyText);
        console.warn('[vibecoding] failed to send voice prompt', error);
      });
  };

  // 编辑: transfer the voice transcript into the text composer so it can be
  // revised before sending. Clears the draft (a true move, not a copy) so it
  // can't reappear when toggling back to voice mode, then switches to text mode
  // and arms a one-shot auto-focus to bring up the keyboard.
  const handleEditVoice = () => {
    const draft = voiceDraft.trim();
    if (!draft) {
      // Don't silently no-op: the user tapped the edit affordance expecting
      // feedback. An empty draft means the last recording didn't transcribe
      // anything (or its result hasn't arrived yet) — tell them, so they know
      // to re-record instead of wondering why nothing happened.
      Alert.alert(t('common:voice.recognizeFailed'));
      return;
    }
    setInput(draft);
    setVoiceDraft('');
    setMode('text');
    setAutoFocusText(true);
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

  // case B 失败回合「重试」:消息已送达但 agent 没回出来。用同内容重发一轮,
  // 服务端 claimAiSessionForRun 会把 error 翻回 running。不丢原消息(它是真实
  // 送达的,保留在历史)。重试中(sendingMessage)禁用,防重复点。
  const handleRetryTurn = useCallback(
    (messageId: string) => {
      if (!session || sendingMessage) return;
      const target = transcript.find(message => message.id === messageId);
      const sourceId = target?.sourceMessageIds[0];
      const agentMsg = sourceId
        ? session.transcript.find(message => message.id === sourceId)
        : undefined;
      const content = agentMsg?.content?.trim();
      if (!content) return;
      void appendAgentMessage(session.id, content, 'text').catch(error => {
        // 「会话忙」类拒绝（store 硬闸 / 服务端 409）：与文本发送路径同口径
        // 弹横幅——重试点上去不该是无声无息（G10b，2026-10-24）。其余失败维持
        // 既有 failed 气泡，不额外打扰。
        const busyText = sessionBusyErrorText(error, t);
        if (busyText) setDetailError(busyText);
        console.warn('[vibecoding] failed to retry turn', error);
      });
    },
    [session, sendingMessage, transcript, appendAgentMessage, t],
  );

  const handleSendText = () => {
    const nextInput = input.trim();
    const goalCommand = GOAL_UI_ENABLED && isGoalCommand(nextInput);
    const isGoalSend = goalDraftActive || session?.purpose === 'goal' || goalCommand;
    if (!isGoalSend && (deviceOffline || shouldDisableComposerForProvider)) return;
    // Bug 3 fix: 自愈兜底。若 sendingMessage 已为 true 但距戳时间超过
    // SENDING_STALE_MS（45s），认定 createGoal / appendAgentMessage 等路径
    // 异常残留（hang、未捕获 reject、丢 finally），强制清掉 sendingMessage
    // 和 sendLockRef，让用户能继续发；否则用户看到「有内容也发不出」。
    if (sendingMessage && isSendingStale(sendingSinceRef.current)) {
      sendingSinceRef.current = null;
      setSendingMessage(false);
      if (sendLockRef.current) sendLockRef.current = null;
    }
    // 只选素材、不打字也能发：正文用一句默认说明兜底（服务端 min(1)）。
    // goal 路径没有素材通道，chips 不参与，仍要求有文字。
    const sendableAssets = isGoalSend ? [] : pendingAssets;
    const content =
      nextInput ||
      (sendableAssets.length > 0 ? defaultAttachmentCaption(sendableAssets, t) : '');
    if (!content || sendingMessage) {
      return;
    }
    if (goalDraftActive) setToolsMenuVisible(false);
    setInput('');
    // On failure the store keeps the message as a client-only `failed` bubble
    // (retryable / dismissable). The composer input is intentionally NOT
    // restored: restoring it let a follow-up message append to the failed text
    // and ship as one combined prompt ("你好 在吗"). The input stays empty so the
    // next message is always clean.
    // goal 路径没有素材通道（入口也已在 goal 会话隐藏）；显式传空数组，
    // 避免把用户攒的 chips 带进一条注定被忽略的发送。
    void appendUserMessage(content, 'text', sendableAssets)
      .then(sent => {
        if (!sent && isGoalSend) {
          setInput(current => current || nextInput);
        }
      })
      .catch(error => {
        if (isGoalSend) {
          setDetailError(goalRequestErrorMessage(error));
          setInput(current => current || nextInput);
        } else {
          // 发送被「会话忙」拒绝（服务端 409 ai_session_busy / agent tui_busy）：
          // 用既有 detailError 横幅给友好双语提示；其他失败维持既有 failed 气泡
          // 机制，不额外打扰。忙类拒绝发生在 store 乐观入列**之前**（消息没有
          // 变成 failed 气泡），因此必须把原文还给输入框——否则用户整条消息
          // 白打（G10a，2026-10-24）。不会触发「恢复输入导致与失败气泡拼接成
          // 复合消息」的旧问题：那条路径的前提是气泡存在，忙类拒绝没有气泡。
          const busyText = sessionBusyErrorText(error, t);
          if (busyText) {
            setDetailError(busyText);
            setInput(current => current || nextInput);
          }
        }
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
        : session?.model?.toLowerCase().includes('opencode')
          ? 'opencode'
          : 'claude_code');
    const variants =
      provider === 'codex'
        ? ['codex']
        : provider === 'opencode'
          ? ['opencode', 'open-code', 'open_code']
          : ['claude-code', 'claudecode', 'claude'];
    const tool = (device?.tools ?? []).find(item => {
      const id = (item?.id ?? '').toLowerCase().replace(/^ai:/, '');
      return variants.includes(id);
    });
    return mergeCommands(
      provider,
      discoveredSessionCommands
        ?? project?.availableCommands
        ?? tool?.commands,
    );
  }, [
    device?.tools,
    discoveredSessionCommands,
    project?.availableCommands,
    session?.model,
    session?.provider,
  ]);

  // Keep approval derivation independent from the whole session object. The
  // object is replaced for every streamed text batch, while these fields only
  // change when approval or run state actually changes.
  const approvalSessionId = session?.id;
  const approvalDeviceId = session?.deviceId;
  const approvalProjectId = session?.projectId;
  const approvalSessionStatus = session?.status;
  const approvalSessionPhase = session?.phase;
  const approvalRunState = session?.runState;
  const approvalRunStateVersion = session?.runStateVersion;
  const approvalSessionEvents = session?.events;
  const approvals = useMemo(() => {
    if (!approvalSessionId || !approvalDeviceId || !approvalSessionStatus) {
      return sessionApprovals;
    }
    const byId = new Map<string, ApprovalRequest>();
    const addApproval = (approval: ApprovalRequest | undefined) => {
      if (!approval) return;
      byId.set(approval.id, approval);
    };
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
      const status = fallbackApprovalStatus(input.status, {
        status: approvalSessionStatus,
        phase: approvalSessionPhase,
        runState: approvalRunState,
        runStateVersion: approvalRunStateVersion,
      });
      // An unresolved historical event cannot represent a current approval once
      // the authoritative run is terminal. A canonical resolved approval, when
      // available, was already inserted above and remains visible in history.
      if (!status) return;
      byId.set(input.id, {
        id: input.id,
        kind: 'client_response',
        title: input.title || t('session.approval.fallbackTitle'),
        summary: input.detail || t('session.approval.fallbackSummary'),
        deviceId: approvalDeviceId,
        projectId: approvalProjectId,
        sessionId: approvalSessionId,
        risk: 'medium',
        status,
        createdAt: input.timestamp,
      });
    };

    sessionApprovals.forEach(addApproval);
    addApproval(focusedApproval);
    sessionApprovalEvents.forEach(event => {
      addFallback({
        id: fallbackId(event.id, event.approvalId),
        title: event.title,
        detail: event.detail,
        status: event.status,
        timestamp: event.timestamp,
      });
    });
    (approvalSessionEvents ?? [])
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
    focusedApproval,
    approvalDeviceId,
    approvalProjectId,
    approvalRunState,
    approvalRunStateVersion,
    approvalSessionEvents,
    approvalSessionId,
    approvalSessionPhase,
    approvalSessionStatus,
    sessionApprovalEvents,
    sessionApprovals,
    t,
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
    () => buildConversationTimeline(visibleTurns, pendingApprovals, goalFolds),
    [pendingApprovals, visibleTurns, goalFolds],
  );

  const handleJumpToApproval = useCallback(
    (approvalId: string) => {
      const timelineId = approvalTimelineItemId(approvalId);
      if (!conversationItems.some(item => item.id === timelineId)) return;
      followTailRef.current = false;
      setPendingJumpId(timelineId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs/setters are stable
    [conversationItems],
  );

  // --- 状态层级派生(L1 整体 / L2 回合 / L3 步骤) ---
  // live 回合信号(now / liveMessageId / livePulse / isSessionLive)已 hoist 到文件
  // 上方——composer 锁要先于 handlers 用到 isSessionLive。这里直接消费。
  // Top-level phase. Server-authoritative `session.phase` is preferred for
  // COMPLETION (so we never guess "已完成" from a local silence window — the
  // "运行中却显示已完成" bug: any >10s gap without ai.delta, e.g. a long bash /
  // subagent / LLM thinking, used to let a local idle guess win). But a LOCAL
  // running signal still wins while we're actively in a turn: status==='running'
  // is set event-driven (send / ai.run.started / ai.delta-driven structured
  // events / ai.run.progress), so it's a strong "we're in a turn" signal and
  // gives instant 进行中 feedback before the server's phase catches up. Once
  // status leaves running, the server's phase is authoritative; older servers
  // without phase fall back to deriveSessionPhase.
  // Session header phase derivation (extracted hook).
  const {
    sessionPhase,
    failedTurnMessageId,


    bottomPulseHeadline,

  } = useSessionHeader({
    session: session ?? undefined,
    isSessionLive,
    pendingApprovalCount: pendingApprovals.length,
    transcript: displayTranscriptSource,
    isDraft,
    t,
  });  // failed 相位不再锁 composer:失败只是「上一轮没收到回复」,会话仍可继续——发新
  // 消息(或点失败消息旁的「重试」)会经服务端 claimAiSessionForRun 把 error 翻回
  // running。失败原因由底部气泡 failedLabel(「会话失败 · 网关502…」)承担,这里不阻断输入。
  const composerReadOnlyReason = isDraft
    ? undefined
    : session?.purpose !== 'goal' && tuiDrivenRunning && !canSteerExternal
      // TUI 驱动回合运行中且设备无外部插话通道：composer 只读并说明去处
      // （不变量：不接受插话就不得出现「可输入但无发送键」，G1b）。有
      // ai_steer_external 的设备可插话，不再只读。
      ? t('session.composer.tuiRunningReadOnly')
      : session?.purpose !== 'goal' && shouldDisableComposerForProvider && waitingApproval
        // 审批等待（任何 provider，含 codex）：会话暂停、球在用户侧，
        // 新消息会顶掉待审批——只读并说明去处（2026-10-24 codex 审批锁）。
        ? t('session.composer.approvalPendingReadOnly')
        : session?.purpose !== 'goal' && shouldDisableComposerForProvider
          ? t('session.composer.claudeRunning')
          : undefined;
  // TUI 共享提示(低成本方案):仅对「终端里发起」的导入会话展示——它们与
  // 桌面终端共用同一份会话文件,手机上发送的内容不会出现在已打开的 TUI
  // 界面里,TUI 端需重启 resume 才能同步。可手动关闭。
  // 判据用「导入诞生」属性(会话 id 的 ai_import_ 前缀),而不是 origin——
  // origin 自 2026-10-18 起跟随「最近一次对话通道」(手机续写 imported 会话会
  // 把它翻成 'phone'),拿它当触发条件会让横幅在首次手机续写后永久消失,而
  // 共享文件机制并不因此改变。也不用 sourceSessionId——纯手机会话首轮跑完后
  // 也会被 resume 绑定回填(claude-session-resume),会让每条纯手机会话误弹横幅。
  // 措辞为机制描述,不依赖 TUI 当前是否真的开着(避免状态误报)。
  //
  // 「知道了」的已读记忆存在模块级 store 而不是本组件的 useState:原实现用
  // useState,离开会话页组件卸载即归零,返回再进必然复弹。语义 = 本 App 进程
  // 生命周期内不再出现(不落盘,冷启动重新提示可接受)。
  const tuiSharedNoticeDismissed = useUiNoticeStore(state =>
    state.isDismissed('tuiShared'),
  );
  const dismissTuiSharedNotice = useUiNoticeStore(state => state.dismiss);
  const isImportedTuiConversation =
    Boolean(session?.id.startsWith('ai_import_')) &&
    Boolean(session?.sourceSessionId);
  const showTuiSharedNotice = isImportedTuiConversation && !tuiSharedNoticeDismissed;
  // 停止按钮显隐:与顶部相位 / composer 锁同源(看 isSessionLive),不裸读 session.status。
  // 旧版用 `serviceThinksRunning`(裸 status)会在回合答完后 status 卡陈旧 running 时,
  // 让停止按钮常驻显示——顶部已「已完成」、输入框已解锁,唯独停止按钮还在(脱节 bug)。
  // 审批等待(waitingApproval,上方已用 canonical 谓词算好)仍视为可打断。
  // 2026-10-24 清洗:不再因 deviceOffline / interruptingTurn
  // 把停止键整体藏掉——离线时按钮渲染为禁用(诚实可见),打断请求在途时渲染为
  // 「…」进行中态,由 MessageComposer 的按钮级禁用承担,可见性归可见性、可点性归可点性。
  const canInterruptTurn =
    session?.purpose !== 'goal' &&
    !goalDraftActive &&
    session?.status !== 'failed' &&
    session?.status !== 'completed' &&
    (isSessionLive || waitingApproval);

  // 回合进行中是否还有可用的「插话」(steer) 通道 —— composer 据此把发送键
  // 放回动作槽最右（停止键居左）。判据与 store 里 appendAgentMessage 的
  // sendAsSteer 同源 (utils/sessionPhase.shouldSendAsSteer)，避免「按钮可点
  // 但发出去必失败」。TUI 驱动的回合（tuiDrivenRunning）原本排除：那条 run
  // 不在 agent 自己的 sessions 表里；设备具备 ai_steer_external 后，agent 端
  // 凭 pid 记录 + CC 跨会话 UDS 收件箱把插话排队（ack=queued），该形态重新
  // 可插话，不再排除也不再只读（见上）。tuiExecutorRunning 保持排除：注入帧
  // 只有文本，运行中发图/插话都没有通道，必须等回合结束再发。
  const canSteerTurn =
    isSessionLive &&
    !tuiExecutorRunning &&
    (!tuiDrivenRunning || canSteerExternal) &&
    shouldSendAsSteer(
      isSessionLive,
      effectiveProvider,
      canSteerClaude || (tuiDrivenRunning && canSteerExternal),
    );

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
        // 「会话忙」类拒绝（服务端 409 ai_session_busy / agent tui_busy）给友好
        // 提示（TUI 会话在终端里跑回合：稍后再试，或去终端按 Esc）；其余错误
        // 维持既有「停止失败 + 原始信息」横幅。
        const busyText = sessionBusyErrorText(error, t);
        setDetailError(
          busyText ??
            (error instanceof Error
              ? t('session.error.interruptFailedPrefix', { message: error.message })
              : t('session.error.interruptFailed')),
        );
      })
      .finally(() => setInterruptingTurn(false));
  }, [
    canInterruptTurn,
    interruptAgentSession,
    session,
    t,
    voiceStt,
  ]);
  // Structured-activity attachment (P3.3). `transcript` is the coalesced
  // DisplayTranscriptMessage[] — each assistant bubble already carries the
  // underlying AgentMessage ids it spans (sourceMessageIds). The renderer
  // filters structuredEvents per-bubble from that. But tool-only assistant
  // turns (commands/files with NO prose) parse to zero segments and are
  // dropped by buildDisplayTranscript, so their ids never appear in any
  // sourceMessageIds — those need a synthetic activity bubble. We compute the
  // orphan ids here: assistant message ids that have ≥1 structured event AND
  // are not in any display bubble's sourceMessageIds. Keep transcript order
  // when possible, then append events whose paged transcript anchor is not
  // loaded; the next grouping step applies hard/soft boundaries.
  const orphanActivityMessageIds = useMemo(() => {
    if (!session?.transcript) return [];
    if (activityEventsByMessageId.size === 0) return [];
    // Assistant message ids that DID render (covered by a display bubble).
    const covered = new Set(
      transcript.flatMap(message => message.sourceMessageIds),
    );
    // Prefer transcript order when its anchor is present. A paged detail
    // response may not include an older tool-only assistant anchor even though
    // its structured events are still retained, so append every remaining
    // renderable event id in event-arrival order instead of dropping it.
    const seen = new Set<string>();
    const orphans: string[] = [];
    for (const m of session.transcript) {
      if (m.role !== 'assistant') continue;
      if (covered.has(m.id)) continue;
      const events = activityEventsByMessageId.get(m.id);
      if (!events || !hasRenderableActivity(events)) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      orphans.push(m.id);
    }
    for (const [messageId, events] of activityEventsByMessageId) {
      if (covered.has(messageId)) continue;
      if (!hasRenderableActivity(events)) continue;
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      orphans.push(messageId);
    }
    return orphans;
    // 依赖收窄到 session.transcript:status/updatedAt/currentStep 翻面
    // (每次 structured/thinking/usage flush 都会换 run 对象)不重扫全量
    // transcript——扫描只读 transcript 与事件映射。
  }, [activityEventsByMessageId, session?.transcript, transcript]);
  const orphanActivityMessageGroups = useMemo(() => {
    return groupConsecutiveToolMessageIds(
      session?.transcript ?? [],
      orphanActivityMessageIds,
      {
        eventCountByMessageId: activityEventCountsByMessageId,
      },
    );
  }, [
    activityEventCountsByMessageId,
    orphanActivityMessageIds,
    // 只读 transcript,不依赖整个 run 对象(同上,避免 per-flush 重分组)。
    session?.transcript,
  ]);
  // 工具巨兽会话（如 2000+ 次 Bash）的孤儿活动组可以上百，整墙上屏既淹没
  // 对话又拖垮首帧。历史组默认全收起（只留 EARLIER ACTIVITY 计数行），仅当
  // 最新一组仍有在飞活动（命令运行中/思考中）时保留那一块，settle 后随之
  // 收起；更早的经 LoadMoreRow 按需展开。
  const orphanGroupList = useIncrementalList(orphanActivityMessageGroups, {
    initialCount: countTrailingActiveActivityGroups(
      orphanActivityMessageGroups,
      activityEventsByMessageId,
    ),
    step: 12,
    from: 'end',
    resetKey: session?.id ?? 'missing',
  });
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
  const handleSaveToolsSettings = useCallback(
    async (patch: { model: string; effort: string; contextWindow?: number }) => {
      if (isDraft && draftConfig) {
        navigation.setParams({
          draftConfig: {
            ...draftConfig,
            model: patch.model,
            effort: patch.effort,
            // 只在用户动过滑块时写，避免把「未设置」固化成显式默认值。
            ...(patch.contextWindow !== undefined
              ? { contextWindow: patch.contextWindow }
              : {}),
          },
        });
        return;
      }
      if (!session) return;
      await updateAgentSession(session.id, patch);
    },
    [draftConfig, isDraft, navigation, session, updateAgentSession],
  );

  const handleComposerInputChange = useCallback((value: string) => {
    // GOAL_UI_ENABLED 关闭时不把 /goal 识别成入口:消息按普通文本发出去,
    // 不再悄悄把输入框切成 goal draft。
    if (GOAL_UI_ENABLED && !goalDraftActive && session?.purpose !== 'goal') {
      const objective = parseGoalCommand(value);
      if (objective !== null) {
        enterGoalDraft(objective, '');
        return;
      }
    }
    setInput(value);
  }, [enterGoalDraft, goalDraftActive, session?.purpose]);

  const handleInsertCommand = useCallback(
    (text: string) => {
      const goalObjective = GOAL_UI_ENABLED ? parseGoalCommand(text) : null;
      if (goalObjective !== null) {
        const candidate = goalObjective.trim();
        enterGoalDraft(candidate.startsWith('<') ? '' : candidate);
        return;
      }
      if (mode !== 'text') setMode('text');
      setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
    },
    [enterGoalDraft, mode],
  );

  // Goal control (pause/resume/recover/delete) extracted to useGoalControl.
  const {
    actionLoading: goalControlAction,
    runGoalControl,
    confirmDeleteGoal,
  } = useGoalControl({
    session: session ?? undefined,
    loadAgentSessionDetail,
    setDetailError,
    onDeleted: () => navigation.goBack(),
  });

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
              {t('session.approval.requestLabel')}
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
          {/* 作答 SLA 倒计时(跨端统一 P4-2):expiresAt 缺省/已过时组件自渲染 null。 */}
          {pending && (
            <ApprovalCountdownBadge expiresAt={approval.expiresAt} />
          )}
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
            {t('session.approval.pendingSyncHint')}
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
                  style={
                    optionDecision === 'denied'
                      ? styles.approvalOptionAction
                      : styles.approvalOptionActionApprove
                  }
                />
              );
            })}
            <View style={styles.approvalMoreRow}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={deviceOffline || Boolean(resolvingApproval)}
                onPress={() => setQuickPolicyFor({ approvalId: approval.id, toolName: approval.toolName })}
                style={styles.approvalMoreLink}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('session.approval.moreActions')} ⋯
                </Text>
              </TouchableOpacity>
            </View>
            {(approval.kind === 'client_response' || approval.kind === 'tool_ask') && (
              <ApprovalCustomReply
                approvalId={approval.id}
                triggerLabel={t('session.approval.customReply')}
                placeholder={t('session.approval.customReplyPlaceholder')}
                sendLabel={t('session.approval.customReplySend')}
                disabled={deviceOffline || Boolean(resolvingApproval)}
                sessionId={session?.id}
                projectPath={session?.directory}
                onSend={msg =>
                  handleResolveApproval(approval.id, 'approved', { message: msg })
                }
              />
            )}
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
              style={styles.approvalActionApprove}
            />
            <GlowButton
              title="DENY"
              onPress={() => handleResolveApproval(approval.id, 'denied')}
              variant="outline"
              loading={resolving && resolvingApproval?.decision === 'denied'}
              disabled={deviceOffline || Boolean(
                resolvingApproval && resolvingApproval.id !== approval.id,
              )}
              style={styles.approvalActionDeny}
            />
            <GlowButton
              title={t('session.approval.moreActions')}
              onPress={() => setQuickPolicyFor({ approvalId: approval.id, toolName: approval.toolName })}
              variant="outline"
              disabled={deviceOffline || Boolean(resolvingApproval)}
              style={styles.approvalActionMore}
            />
          </View>
        ) : null}
      </GlassPanel>
    );
  };

  // 设备 CLI 实测支持的 effort 档(agent 能力上报,随快照/device.updated 到达)
  // → 传给 ToolsMenu 置灰 + 保存钳制。undefined = 未上报,不设障。
  // 必须位于下方 `if (!session)` 守卫之前:hook 不能条件执行。历史上它曾被放到
  // 守卫之后(96c32c5),session 加载完成时 hook 数 +1 触发 "Rendered more hooks
  // than during the previous render" 真机崩溃(2026-09-24 iPhone16Pro)。
  const sessionProviderSafe =
    session?.provider ??
    (session?.model?.toLowerCase().includes('codex')
      ? 'codex'
      : session?.model?.toLowerCase().includes('opencode')
        ? 'opencode'
        : 'claude_code');
  const sessionSupportedEfforts = useMemo(
    () => supportedEffortsFor(device?.tools, sessionProviderSafe),
    [device?.tools, sessionProviderSafe],
  );

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
            {detailError || t('session.loading.loadingSession')}
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
    if (deviceOffline || session?.detailState?.kind === 'offline') {
      return {
        title: t('session.empty.offlineTitle'),
        detail: t('session.empty.offlineDetail'),
        tone: 'offline' as const,
      };
    }
    if (session?.detailState?.kind === 'failed') {
      return {
        title: t('session.empty.failedTitle'),
        detail: t('session.empty.failedDetail'),
        tone: 'error' as const,
      };
    }
    if (
      (session?.transcriptCount ?? 0) > 0 ||
      Boolean(session?.title || session?.objective || session?.currentStep)
    ) {
      return {
        title: t('session.empty.summaryTitle'),
        detail: t('session.empty.summaryDetail'),
        tone: 'neutral' as const,
      };
    }
    return {
      title: t('session.empty.blankTitle'),
      detail: t('session.empty.blankDetail'),
      tone: 'neutral' as const,
    };
  })();
  const budgetLabel = formatBudget(session.projectBudget);
  // Authoritative provider (from the server session) — hoisted above the
  // `if (!session)` guard as sessionProviderSafe so the effort-capability
  // useMemo can run unconditionally (Rules of Hooks). Identical value once
  // session is loaded; Tools menu provider semantics unchanged.
  const sessionProvider = sessionProviderSafe;
  const isCodexSession = sessionProvider === 'codex';
  // Live model/effort catalog (shared, cached) — drives the ToolsMenu effort
  // chips so they render the provider's catalog efforts (codex 4, claude 6),
  // falling back to the hardcoded ladder before it loads.
  const sessionEffortOptions = catalogEffortOptions(
    sessionProvider,
    providerCatalog,
  );
  const sessionModelOptions = catalogModelOptions(
    sessionProvider,
    providerCatalog,
  );
  const effective = session.effectiveModelConfig;
  const effectiveLabel = effective
    ? [
        `model=${effective.model || t('session.composer.userDefault')}`,
        effective.source?.model ? `(${effective.source.model})` : '',
        `· effort=${effective.effort || t('session.composer.userDefault')}`,
        effective.source?.effort ? `(${effective.source.effort})` : '',
        `· ctx=${formatContextWindow(effective.contextWindow)}`,
        effective.source?.context ? `(${effective.source.context})` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const activeExecution = session.activeExecutionProfile;
  const activeExecutionLabel = activeExecution
    ? [
        `model=${activeExecution.model || t('session.composer.userDefault')}`,
        `· effort=${activeExecution.effort || t('session.composer.userDefault')}`,
        // 老 server 的 profile 不带窗口 → 不写 200k 假装知道（那一轮实际
        // 用的值我们核对不了）。
        activeExecution.contextWindow
          ? `· ctx=${formatContextWindow(activeExecution.contextWindow)}`
          : '',
        `· v${activeExecution.version}`,
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
    sessionPhase === 'waiting_approval'
      ? theme.colors.tertiary
      : sessionPhase === 'running'
      ? theme.colors.primary
      : sessionPhase === 'failed'
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
            {/* 状态气泡(点击开诊断侧边栏) + 来源角标图标 + 诊断入口同一水平
                线：文字只留在状态气泡里，来源与诊断都是图标（P4 顶栏改版——
                三个文字元素挤 196pt 是「In Progress」溢出的根源）。 */}
            <View style={styles.topStatusRow}>
              <TouchableOpacity
                onPress={handleToggleDiagnostics}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={t('session.diagnostics.entryA11y')}>
                <StatusChip
                  label={isDraft ? t('session.phase.notStarted') : phaseLabel(sessionPhase)}
                  type={isDraft ? 'neutral' : sessionPhaseType[sessionPhase]}
                  pulse={!isDraft && sessionPhase === 'running'}
                  style={styles.topStatusChip}
                />
              </TouchableOpacity>
              {/* 来源角标：纯图标（手机/本机/终端），managed/空不渲染。 */}
              {!isDraft && <SessionOriginBadge session={session} variant="icon" />}
              {/* 诊断入口：紧挨状态气泡。草稿会话没有 run 数据，不显示。 */}
              {!isDraft && (
                <TouchableOpacity
                  onPress={handleToggleDiagnostics}
                  activeOpacity={0.72}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('session.diagnostics.entryA11y')}>
                  <IconBadge name="fingerprint" tone="neutral" size={26} iconSize={14} />
                </TouchableOpacity>
              )}
            </View>
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
              title={t('session.loading.syncHistory')}
              titleColor={theme.colors.onSurfaceVariant}
            />
          }
          scrollEventThrottle={16}
          onLayout={event => {
            const height = event.nativeEvent.layout.height;
            setViewportHeight(height);
          }}
          onMomentumScrollEnd={handleScroll}
          onContentSizeChange={(_, height) => {
            // Guarded tail scroll: duplicate content-size callbacks from one
            // Fabric mount transaction (unchanged height) coalesce into the
            // already-scheduled scroll instead of arming a new native one.
            // Pending (send/composer focus) always scrolls once; live
            // streaming tail-follows stay non-animated.
            const scheduled = handleContentSizeChange(height, {
              pending: pendingScrollToEndRef.current,
              followTail: followTailRef.current,
              live: isSessionLive,
            });
            if (scheduled) {
              pendingScrollToEndRef.current = false;
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
                  {t('session.offline.title')}
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('session.offline.detail')}
                </Text>
              </View>
            </View>
          ) : null}
          <GlassPanel style={styles.sessionHeader}>
            <View
              style={[
                styles.headerAccent,
                { backgroundColor: statusAccent },
                sessionPhase === 'running' && isDark
                  ? theme.glow.primary
                  : null,
              ]}
            />
            <View style={styles.headerInner}>
              <View style={styles.headerTop}>
                <IconBadge
                  name={isCodexSession ? 'code' : 'agent'}
                  tone={
                    sessionPhase === 'waiting_approval' ? 'tertiary' : 'primary'
                  }
                  size={44}
                  iconSize={22}
                  filled={sessionPhase === 'running'}
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
                          titleExpanded ? t('session.title.collapse') : t('session.title.expand')
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
                      ? 'rgba(86, 156, 214, 0.12)'
                      : 'rgba(0, 81, 174, 0.08)',
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
                      { color: theme.colors.secondary },
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
              accessibilityLabel={t('session.quickActions.filesLabel')}
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
                    {t('session.quickActions.filesSubtitle')}
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
              accessibilityLabel={t('session.quickActions.terminalLabel')}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate('DeviceTerminal', {
                  deviceId: session.deviceId,
                  directory: session.directory,
                  terminalId: activeTerminalId,
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
                    {t('session.quickActions.terminalSubtitle')}
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
            <SessionPreviewCard
              preview={preview}
              onNavigate={() => navigation.navigate('Preview', { previewId: preview.id })}
              onRevoke={async () => {
                if (!preview.portMappingId) return;
                try {
                  await revokePortMapping(preview.portMappingId);
                  // Server flips linked previews to 'revoked' + broadcasts
                  // preview.updated; the store merge converges this card.
                } catch {
                  // 下一次轮询/广播会纠正状态；不在此处弹错（撤销按钮的
                  // 失败反馈由既有全局错误通道承担，若无可留空）
                }
              }}
            />
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
                      {detailError || t('session.loading.syncEarlier')}
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
                <View
                  style={styles.conversationTimeline}
                  onLayout={event =>
                    setTimelineTop(event.nativeEvent.layout.y)
                  }
                >
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
                      {t('session.phase.conversationStart')}
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
                                sessionId={session.id}
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
                                turnFailedMessageId={failedTurnMessageId}
                                onRetryTurn={handleRetryTurn}
                              />
                            );
                          })}
                        </View>
                      );
                    }

                    if (item.kind === 'goal-fold') {
                      // Server-folded Goal chatter: one fold per goalId at the
                      // group's earliest-message position. objective is taken
                      // from the live goalSummary if it still matches the fold's
                      // goalId (rare — usually the Goal is already gone); falls
                      // back to undefined and GoalDeletedFold shows the default
                      // "目标已删除" placeholder.
                      const foldObjective =
                        session?.goalSummary?.goalId === item.fold.goalId
                          ? session.goalSummary.objective
                          : undefined;
                      return (
                        <View
                          key={item.id}
                          style={styles.turnGroup}
                          onLayout={event => {
                            const { y, height } = event.nativeEvent.layout;
                            handleConversationItemLayout(item.id, y, height);
                          }}
                        >
                          <GoalDeletedFold
                            goalId={item.fold.goalId}
                            objective={foldObjective}
                            messages={item.fold.messages}
                          />
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
                      Adjacent anchors are grouped into bounded ActivityBlocks;
                      user/prose boundaries still split them. 组数按增量列表截尾，
                      只渲染最新几组，更早的经 LoadMoreRow 展开。 */}
                  {orphanActivityMessageGroups.length > 0 ? (
                    <>
                      <LoadMoreRow
                        visibleCount={orphanGroupList.visibleCount}
                        totalCount={orphanGroupList.totalCount}
                        onPress={orphanGroupList.showMore}
                        label="EARLIER ACTIVITY"
                      />
                      <TranscriptMessageList
                        key="orphan-activity-block"
                        activitySessionId={session.id}
                        orphanActivityEventsByMessageId={activityEventsByMessageId}
                        orphanActivityMessageGroups={orphanGroupList.visibleItems}
                        activityDetailCache={session.eventDetailCache}
                        onCacheActivityDetail={handleCacheActivityDetail}
                        liveMessageId={liveMessageId}
                      />
                    </>
                  ) : null}
                  {/* 已处理(approved/denied)审批:默认折叠成一行,展开后置灰列出,
                      避免每张占满屏幕。pending 审批仍在上面按时间线完整展示。 */}
                  {resolvedApprovals.length > 0 ? (
                    <ResolvedApprovalsGroup
                      approvals={resolvedApprovals}
                      renderCard={renderApprovalCard}
                    />
                  ) : null}
                  {session?.retryActive ? (
                    <View style={styles.retryHintRow}>
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.tertiary },
                        ]}
                      >
                        {t('session.error.retryHintBusy', {
                          attempt: session.retryAttempt ?? '?',
                          max: session.retryMax ?? '?',
                        })}
                      </Text>
                    </View>
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
                          backgroundColor: isDraft
                            ? theme.colors.onSurfaceVariant
                            : sessionPhase === 'completed'
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
                          color: isDraft
                            ? theme.colors.onSurfaceVariant
                            : sessionPhase === 'completed'
                            ? theme.colors.secondary
                            : sessionPhase === 'failed'
                            ? theme.colors.error
                            : theme.colors.primary,
                        },
                      ]}
                    >
                      {isDraft
                        ? t('session.phase.notStarted')
                        : sessionPhase === 'completed'
                        ? t('session.phase.turnCompleted')
                        : sessionPhase === 'failed'
                        ? t('session.phase.sessionFailed')
                        : t('session.phase.inProgress')}
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
                  {refreshing ? t('session.loading.syncHistory') : t('session.loading.fetchingFull')}
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
                    {t('session.empty.retry')}
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
                      {t('session.empty.historySummaryLabel')}
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
                    {t('session.empty.pullOrTapRefresh')}
                  </Text>
                </TouchableOpacity>
              </GlassPanel>
            )}
            {!isDraft && session ? (
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
                    name={eventIcon[latestAgentEvent?.type ?? ''] ?? 'event'}
                    tone={
                      latestAgentEvent?.status === 'failed'
                        ? 'error'
                        : latestAgentEvent?.status === 'waiting'
                        ? 'tertiary'
                        : isSessionLive
                        ? 'primary'
                        : 'tertiary'
                    }
                    size={28}
                    iconSize={14}
                  />
                  <View style={styles.timelineBadgeText}>
                    {/* L3 实时步骤脉冲:永不显示「已完成/DONE」,取而代之是
                        思考中 / 运行命令 / 处理中… / 等待你的输入。
                        无结构化事件时(如 demotion 后)回退到 status 兜底,
                        保证 badge 常驻、刷新键永远可达。 */}
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.onSurface },
                      ]}
                      numberOfLines={1}
                    >
                      {bottomPulseHeadline ??
                        latestAgentEvent?.title ??
                        (isSessionLive
                          ? t('activitySummary.processing')
                          : t('activitySummary.awaitingInput'))}
                    </Text>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                      numberOfLines={1}
                    >
                      {latestAgentEvent
                        ? `${visibleSessionEvents.length} events · ${latestAgentEvent.timestamp}`
                        : t('session.quickActions.refreshLatest')}
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
                    onPress={refreshLatest}
                    style={styles.timelineBadgeRefresh}
                    accessibilityLabel={t('session.quickActions.refreshLatest')}
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

        <ConversationScrubberLayer
          conversationTurns={conversationTurns}
          visibleTurns={visibleTurns}
          messageLayouts={messageLayouts}
          conversationTop={conversationTop}
          viewportHeight={viewportHeight}
          onCommit={handleScrubberCommit}
          registerScrollY={registerScrollY}
          belowRail={
            showScrollToBottom ? (
              <TouchableOpacity
                testID="scroll-to-bottom-fab"
                accessibilityRole="button"
                accessibilityLabel={t('scrubber.scrollToLatest')}
                onPress={() => scrollToBottom(true)}
                style={[
                  styles.scrollFab,
                  {
                    backgroundColor: isDark
                      ? 'rgba(17, 20, 23, 0.85)'
                      : 'rgba(255, 255, 255, 0.92)',
                    borderColor: isDark
                      ? 'rgba(255, 255, 255, 0.1)'
                      : theme.colors.outlineVariant,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.scrollFabGlyph,
                    { color: theme.colors.primary },
                  ]}
                >
                  ↓
                </Text>
              </TouchableOpacity>
            ) : null
          }
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
              paddingBottom: Math.max(12, insets.bottom),
            },
          ]}
        >
          {toolsMenuVisible && (
            <ToolsMenu
              onClose={() => setToolsMenuVisible(false)}
              model={session.model}
              provider={sessionProvider}
              effort={session.effort ?? ''}
              contextWindow={session.contextWindow}
              serverModelOptions={sessionModelOptions}
              effortOptions={sessionEffortOptions}
              supportedEfforts={sessionSupportedEfforts}
              effectiveLabel={effectiveLabel ?? undefined}
              activeExecutionLabel={activeExecutionLabel ?? undefined}
              settingsEditable={session.purpose !== 'goal'}
              goalMode={session.purpose === 'goal' ? 'active' : goalDraftActive ? 'draft' : 'ordinary'}
              onGoalModeChange={nextMode => {
                if (nextMode === 'draft') enterGoalDraft('', input, { keepToolsOpen: true });
                else exitGoalDraft();
              }}
              commands={sessionCommands}
              sessionId={session.id}
              onSaveSettings={handleSaveToolsSettings}
              onInsertCommand={handleInsertCommand}
            />
          )}
          {topPendingApproval ? (
            <TouchableOpacity
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={t('session.approval.jumpLabel')}
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
                    ? t('session.approval.pendingMany', { count: pendingApprovals.length })
                    : t('session.approval.pendingOne')}
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
          {session?.purpose === 'goal' ? (
            <GoalStatusBar
              summary={session.goalSummary}
              actionLoading={goalControlAction}
              onView={() =>
                navigation.navigate('GoalDetail', {
                  goalId: session.goalSummary?.goalId ?? session.id,
                  sourceSessionId: session.id,
                })
              }
              onPause={() => void runGoalControl('pause')}
              onResume={() => void runGoalControl('resume')}
              onRecover={() => void runGoalControl('recover')}
              onAccept={() =>
                // Sign-off is trust-critical: route to the detail screen (full
                // evidence + decline path) rather than one-tap from the bar.
                navigation.navigate('GoalDetail', {
                  goalId: session.goalSummary?.goalId ?? session.id,
                  sourceSessionId: session.id,
                })
              }
              onDelete={confirmDeleteGoal}
              onMore={() => setToolsMenuVisible(true)}
            />
          ) : goalDraftActive ? (
            <GoalDraftBar creating={goalCreating} onExit={exitGoalDraft} />
          ) : null}
          {showTuiSharedNotice ? (
            <View style={styles.tuiSharedNoticeRow}>
              <Text
                style={[
                  theme.typography.bodySm,
                  styles.tuiSharedNoticeText,
                ]}
                numberOfLines={3}
              >
                {t('session.tuiSharedNotice')}
              </Text>
              <TouchableOpacity
                onPress={() => dismissTuiSharedNotice('tuiShared')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    theme.typography.bodySm,
                    styles.tuiSharedNoticeDismiss,
                  ]}
                >
                  {t('session.tuiSharedNoticeDismiss')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {/* 已选素材停在输入框正上方：发送前随时可删，发送成功才清空。 */}
          <AttachmentChips
            assets={pendingAssets}
            onRemove={handleRemovePendingAttachment}
            disabled={sendingMessage}
          />
          <MessageComposer
            mode={mode}
            onModeChange={handleComposerModeChange}
            input={input}
            onInputChange={handleComposerInputChange}
            voiceDraft={voiceDraft}
            commands={sessionCommands}
            voiceStt={voiceStt}
            sendingMessage={sendingMessage}
            interruptingTurn={interruptingTurn}
            canInterruptTurn={canInterruptTurn}
            interruptGreyed={tuiDrivenRunning}
            interruptGreyedHint={
              canSteerExternal
                ? t('session.composer.tuiSteerableHint')
                : t('session.composer.tuiStopGreyed')
            }
            canSteer={canSteerTurn}
            deviceOffline={deviceOffline}
            readOnlyReason={composerReadOnlyReason}
            autoFocusText={autoFocusText}
            toolsMenuVisible={toolsMenuVisible}
            toolsDisabled={goalDraftActive && goalCreating}
            onToggleTools={handleToggleTools}
            attachmentCount={
              goalDraftActive || session?.purpose === 'goal'
                ? 0
                : pendingAssets.length
            }
            goalDraft={goalDraftActive}
            goalSession={session?.purpose === 'goal'}
            showGoalHint={session?.purpose !== 'goal'}
            onTextInputFocus={handleComposerTextInputFocus}
            onVoiceCapture={handleVoiceCapture}
            onVoiceCaptureStart={handleVoiceCaptureStart}
            onVoiceCaptureEnd={handleVoiceCaptureEnd}
            onSendVoice={handleSendVoice}
            onSendText={handleSendText}
            onInterruptTurn={handleInterruptTurn}
            onEditVoice={handleEditVoice}
            attachmentsEnabled={attachmentsEnabled}
            onOpenAttachments={handleOpenAttachments}
          />
        </View>
      </KeyboardAvoidingView>
      <AttachmentMenuSheet
        open={attachmentMenuVisible}
        onClose={handleCloseAttachments}
        onSelect={handleAttachmentAction}
        recent={attachmentLibrary}
        onPickRecent={handlePickRecentAttachment}
        onDeleteRecent={handleDeleteRecentAttachment}
        onClearRecent={handleClearRecentAttachments}
      />
      {/* 诊断面板：右侧滑出，展示上下文用量 / 回合与守卫状态 / 失败真因。 */}
      <DiagnosticsPanel
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        run={session}
      />
      <ApprovalQuickPolicySheet
        projectId={session?.projectId ?? ''}
        toolName={quickPolicyFor?.toolName}
        open={quickPolicyFor !== null}
        onClose={() => setQuickPolicyFor(null)}
        onApplied={() => {
          // The user just switched to an auto-approve mode (allow_all /
          // common_auto / an MCP tier) — also release the specific pending
          // approval they were acting on, so it doesn't sit waiting for a rule
          // that only governs future escalations.
          const target = quickPolicyFor;
          if (!target) return;
          handleResolveApproval(target.approvalId, 'approved');
        }}
      />
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  // TUI 共享提示条:机制说明(见 showTuiSharedNotice),中性底色不抢注意力。
  tuiSharedNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(128,128,128,0.14)',
  },
  tuiSharedNoticeText: {
    flex: 1,
    opacity: 0.85,
  },
  tuiSharedNoticeDismiss: {
    opacity: 0.7,
    paddingHorizontal: 4,
  },
  // Small circular "jump to latest" control; the scrubber layer positions it
  // under the locator rail (belowRailSlot owns the geometry).
  scrollFab: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  scrollFabGlyph: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: -2,
  },
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
    // 156 是「状态气泡单行」时代的宽度；现在同一行还要放诊断入口（26 + 6），
    // 窄了英文 "Awaiting approval" 会被迫折行。
    maxWidth: 196,
    gap: 4,
  },
  // 状态气泡与诊断入口同一水平线：竖中对齐，间距 6。chip 自带
  // alignSelf:'flex-start'（左下角卡片场景要顶格），这里在行内改回居中，
  // 否则 chip 会贴着行的上沿、和指纹图标错开半个身位。
  topStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topStatusChip: {
    alignSelf: 'center',
    flexShrink: 1,
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
  retryHintRow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
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
    alignItems: 'flex-end',
    gap: 8,
  },
  // APPROVE is the primary CTA — give it more width (2:1) and extra height so
  // it reads as the bigger, dominant action; DENY stays compact beside it.
  approvalActionApprove: {
    flex: 2,
    minHeight: 56,
  },
  approvalActionDeny: {
    flex: 1,
  },
  // Compact "更多" toggle beside APPROVE/DENY — fixed narrow width, same height
  // so the row reads as three peer actions. Opens the quick-policy sheet.
  approvalActionMore: {
    minHeight: 56,
    minWidth: 64,
    paddingHorizontal: 6,
  },
  approvalMoreRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  approvalMoreLink: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  approvalOptionActions: {
    gap: 8,
  },
  approvalOptionActionApprove: {
    alignSelf: 'stretch',
    minHeight: 56,
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
});
