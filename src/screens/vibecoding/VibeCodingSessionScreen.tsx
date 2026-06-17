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
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { SuggestionActionBar } from '../../components/vibecoding/SuggestionActionBar';
import { TranscriptMessageList } from '../../components/vibecoding/TranscriptMessageList';
import {
  vibeStatusLabel,
  vibeStatusType,
} from '../../components/vibecoding/status';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useVibeRun,
  useProject,
  useDevice,
  useSessionPreview,
  useSessionApprovals,
} from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import type { AgentBudgetInfo } from '../../data/platformModels';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { buildDisplayTranscript } from '../../utils/agentTranscript';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;

// During streaming the store updates on a ~60ms cadence; driving scroll-driven
// state at 60fps on top of that re-runs the conversation-rail computation every
// frame. Throttle the scroll→state bridge so the rail only recomputes a few
// times per second (leading edge) plus one trailing update when scrolling stops.
const SCROLL_THROTTLE_MS = 80;
const DETAIL_LOAD_TIMEOUT_MS = 10000;
const SCROLL_FOLLOW_THRESHOLD = 180;

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

export const VibeCodingSessionScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionRoute>();
  // Fine-grained selectors: subscribe only to the specific session/project/
  // device/preview the user is viewing, so streaming deltas on OTHER sessions
  // don't trigger re-renders here.
  const session = useVibeRun(route.params.sessionId);
  const project = useProject(session?.projectId);
  const device = useDevice(session?.deviceId);
  const preview = useSessionPreview(session?.id);
  const approvals = useSessionApprovals(session?.id);
  const loadAgentSessionDetail = useControlCenterStore(
    state => state.loadAgentSessionDetail,
  );
  const resolveApproval = useControlCenterStore(state => state.resolveApproval);
  const appendAgentMessage = useControlCenterStore(
    state => state.appendAgentMessage,
  );
  const pauseAgentSession = useControlCenterStore(
    state => state.pauseAgentSession,
  );
  const resumeAgentSession = useControlCenterStore(
    state => state.resumeAgentSession,
  );
  const terminateAgentSession = useControlCenterStore(
    state => state.terminateAgentSession,
  );

  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [input, setInput] = useState('');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [preparedPrompt, setPreparedPrompt] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
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
  const [sendingMessage, setSendingMessage] = useState(false);
  const [resolvingApproval, setResolvingApproval] = useState<{
    id: string;
    decision: 'approved' | 'denied';
  } | null>(null);

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
  const targetSessionId = session?.id ?? route.params.sessionId;
  const transcript = useMemo(
    () => buildDisplayTranscript(session?.transcript ?? []),
    [session?.transcript],
  );
  const visibleSessionEvents = useMemo(
    () =>
      (session?.events ?? []).filter(
        event => event.title !== 'Imported local vibe session',
      ),
    [session?.events],
  );
  const transcriptList = useIncrementalList(transcript, {
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
  const visibleTranscript = transcriptList.visibleItems;
  const visibleAgentEvents = agentEventList.visibleItems;
  const latestAgentEvent =
    visibleSessionEvents[visibleSessionEvents.length - 1];
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
  const visibleTranscriptLayoutKey = useMemo(
    () => visibleTranscript.map(message => message.id).join('|'),
    [visibleTranscript],
  );
  const visibleTranscriptIds = useMemo(
    () => new Set(visibleTranscript.map(message => message.id)),
    [visibleTranscript],
  );
  const activeRailMessageId = useMemo(() => {
    if (!visibleTranscript.length) return undefined;
    const fallbackId = visibleTranscript[visibleTranscript.length - 1]?.id;
    if (!viewportHeight) return fallbackId;

    const focusY =
      scrollY + Math.min(Math.max(viewportHeight * 0.46, 160), 380);
    let activeId = fallbackId;
    let activeDistance = Number.POSITIVE_INFINITY;

    for (const message of visibleTranscript) {
      const layout = messageLayouts[message.id];
      if (!layout) continue;
      // Absolute position in the scroll content = container offset + message offset.
      const center = conversationTop + layout.top + layout.height / 2;
      const distance = Math.abs(center - focusY);
      if (distance < activeDistance) {
        activeDistance = distance;
        activeId = message.id;
      }
    }

    return activeId;
  }, [
    messageLayouts,
    scrollY,
    viewportHeight,
    visibleTranscript,
    conversationTop,
  ]);
  const conversationRailItems = useMemo(() => {
    if (!transcript.length) return [];
    const maxMarks = 16;
    const activeIndex = activeRailMessageId
      ? transcript.findIndex(message => message.id === activeRailMessageId)
      : -1;
    const indices = new Set<number>();

    if (transcript.length <= maxMarks) {
      transcript.forEach((_, index) => indices.add(index));
    } else {
      const slots = activeIndex >= 0 ? maxMarks - 1 : maxMarks;
      const denominator = Math.max(1, slots - 1);
      for (let index = 0; index < slots; index += 1) {
        indices.add(
          Math.round((index * (transcript.length - 1)) / denominator),
        );
      }
      if (activeIndex >= 0) indices.add(activeIndex);
    }

    return Array.from(indices)
      .sort((left, right) => left - right)
      .map(index => {
        const message = transcript[index];
        return {
          message,
          active: message.id === activeRailMessageId,
          visible: visibleTranscriptIds.has(message.id),
        };
      });
  }, [activeRailMessageId, transcript, visibleTranscriptIds]);

  const hasDetail = Boolean(
    session?.detailLoadedAt ||
      session?.transcript.length ||
      session?.events.length,
  );

  useEffect(() => {
    if (!targetSessionId || hasDetail || loadingDetail || detailError) return;

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

  useEffect(() => {
    const visibleIds = new Set(visibleTranscript.map(message => message.id));
    setMessageLayouts(current => {
      const next: Record<string, { top: number; height: number }> = {};
      for (const [messageId, layout] of Object.entries(current)) {
        if (visibleIds.has(messageId)) {
          next[messageId] = layout;
        }
      }
      if (Object.keys(next).length === Object.keys(current).length) {
        return current;
      }
      return next;
    });
  }, [targetSessionId, visibleTranscript, visibleTranscriptLayoutKey]);

  useEffect(() => {
    setTimelineExpanded(false);
    setScrollY(0);
    scrollYRef.current = 0;
    followTailRef.current = true;
    pendingScrollToEndRef.current = true;
  }, [targetSessionId]);

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

  const handleTranscriptMessageLayout = (
    messageId: string,
    y: number,
    height: number,
  ) => {
    // Store the message's offset relative to the conversation container only.
    // `conversationTop` (the container's own offset within the scroll content) is
    // applied at calculation time so stale closure captures can't desync the rail.
    setMessageLayouts(current => {
      const existing = current[messageId];
      if (
        existing &&
        Math.abs(existing.top - y) < 1 &&
        Math.abs(existing.height - height) < 1
      ) {
        return current;
      }
      return { ...current, [messageId]: { top: y, height } };
    });
  };

  const appendUserMessage = async (
    content: string,
    messageMode: 'voice' | 'text',
  ) => {
    const normalizedContent = content.trim();
    if (!session || !normalizedContent || sendLockRef.current) return false;
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

  const handleVoiceCapture = () => {
    setVoiceDraft(
      '把当前预览里的卡片层级再压缩一点，重点突出等待我确认的任务，并检查底部导航文字是否清晰。',
    );
    setPreparedPrompt('');
  };

  const handlePrepareVoice = () => {
    setPreparedPrompt(
      '请继续优化当前移动端 VibeCoding 控制台：压缩卡片层级，优先展示等待用户确认的任务，检查底部导航在小屏上的可读性，并完成后生成预览链接。',
    );
  };

  const handleConfirmVoice = () => {
    if (deviceOffline || !preparedPrompt || sendingMessage) {
      return;
    }
    void appendUserMessage(preparedPrompt, 'voice')
      .then(sent => {
        if (sent) {
          setVoiceDraft('');
          setPreparedPrompt('');
        }
      })
      .catch(error => {
        console.warn('[vibecoding] failed to send voice prompt', error);
      });
  };

  const handleSendText = () => {
    if (deviceOffline) return;
    const nextInput = input.trim();
    if (!nextInput || sendingMessage) {
      return;
    }
    setInput('');
    void appendUserMessage(nextInput, 'text').catch(error => {
      console.warn('[vibecoding] failed to send text prompt', error);
      setInput(current => current || nextInput);
    });
  };

  const handleResolveApproval = (
    approvalId: string,
    decision: 'approved' | 'denied',
  ) => {
    if (deviceOffline || resolvingApproval) return;
    setResolvingApproval({ id: approvalId, decision });
    void resolveApproval(approvalId, decision)
      .catch(error => {
        console.warn('[vibecoding] failed to resolve approval', error);
      })
      .finally(() => setResolvingApproval(null));
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
  const deviceOffline = device?.status === 'offline';
  const budgetLabel = formatBudget(session.projectBudget);
  const isCodexSession = session.model.toLowerCase().includes('codex');
  const displayTitle = formatVibeSessionTitle(session.title, {
    directory: session.directory,
    projectName: project?.name,
  });
  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={project?.name ?? displayTitle}
        subtitle={device?.name ?? 'VIBECODING SESSION'}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={vibeStatusLabel[session.status]}
            type={vibeStatusType[session.status]}
          />
        }
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
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
          <View style={styles.headerTop}>
            <IconBadge
              name={isCodexSession ? 'code' : 'agent'}
              tone={
                session.status === 'waiting_approval' ? 'tertiary' : 'primary'
              }
              size={48}
              iconSize={24}
              filled={session.status === 'running'}
            />
            <View style={styles.headerTitle}>
              <Text
                style={[
                  theme.typography.titleLg,
                  { color: theme.colors.onSurface },
                ]}
              >
                {displayTitle}
              </Text>
              <Text
                style={[
                  theme.typography.codeSm,
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
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {session.objective}
          </Text>
          <View style={styles.progressMeta}>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.primary }]}
            >
              Runtime
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {session.elapsedMinutes}m / {session.timeLimitMinutes}m
            </Text>
          </View>
          <ProgressBar progress={progress} color={theme.colors.primary} />
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
        </GlassPanel>

        <View style={styles.quickActions}>
          <GlowButton
            title="FILES"
            disabled={deviceOffline}
            onPress={() =>
              navigation.navigate('FileBrowser', {
                projectId: session.projectId,
                deviceId: session.deviceId,
                sessionId: session.id,
              })
            }
            variant="outline"
            style={styles.quickAction}
          />
          <GlowButton
            title="TERMINAL"
            disabled={deviceOffline}
            onPress={() =>
              navigation.navigate('DeviceTerminal', {
                deviceId: session.deviceId,
                directory: session.directory,
              })
            }
            variant="outline"
            style={styles.quickAction}
          />
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
                  {transcript.length
                    ? `${visibleTranscript.length}/${transcript.length} grouped`
                    : `${session.transcriptCount ?? 0} messages`}
                </Text>
              </View>
            </View>
            <StatusChip label={mode.toUpperCase()} type="info" />
          </View>
          {approvals.length ? (
            <View style={styles.approvalStack}>
              {approvals.map(approval => {
                const pending = approval.status === 'pending';
                const resolving = resolvingApproval?.id === approval.id;
                return (
                  <GlassPanel
                    key={approval.id}
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
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.primary },
                        ]}
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
                    {pending ? (
                      <View style={styles.approvalActions}>
                        <GlowButton
                          title="APPROVE"
                          onPress={() =>
                            handleResolveApproval(approval.id, 'approved')
                          }
                          variant="primary"
                          loading={
                            resolving &&
                            resolvingApproval?.decision === 'approved'
                          }
                          disabled={deviceOffline || Boolean(
                            resolvingApproval &&
                              resolvingApproval.id !== approval.id,
                          )}
                          style={styles.approvalAction}
                        />
                        <GlowButton
                          title="DENY"
                          onPress={() =>
                            handleResolveApproval(approval.id, 'denied')
                          }
                          variant="outline"
                          loading={
                            resolving && resolvingApproval?.decision === 'denied'
                          }
                          disabled={deviceOffline || Boolean(
                            resolvingApproval &&
                              resolvingApproval.id !== approval.id,
                          )}
                          style={styles.approvalAction}
                        />
                      </View>
                    ) : null}
                  </GlassPanel>
                );
              })}
            </View>
          ) : null}
          {transcript.length ? (
            <>
              {loadingDetail || detailError ? (
                <GlassPanel style={styles.detailInlinePanel}>
                  {loadingDetail ? (
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
              <LoadMoreRow
                visibleCount={transcriptList.visibleCount}
                totalCount={transcriptList.totalCount}
                onPress={transcriptList.showMore}
                label="LOAD EARLIER MESSAGES"
              />
              <TranscriptMessageList
                items={visibleTranscript}
                onMessageLayout={handleTranscriptMessageLayout}
              />
            </>
          ) : loadingDetail ? (
            <GlassPanel style={styles.detailStatePanel}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                正在拉取完整会话内容...
              </Text>
            </GlassPanel>
          ) : detailError ? (
            <GlassPanel style={styles.detailStatePanel}>
              <Text
                style={[theme.typography.bodySm, { color: theme.colors.error }]}
              >
                {detailError}
              </Text>
            </GlassPanel>
          ) : (
            <GlassPanel style={styles.detailStatePanel}>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                暂无会话记录
              </Text>
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
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurface },
                    ]}
                    numberOfLines={1}
                  >
                    {latestAgentEvent.title}
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
                <StatusChip
                  label={latestAgentEvent.status.toUpperCase()}
                  type={
                    latestAgentEvent.status === 'done'
                      ? 'success'
                      : latestAgentEvent.status === 'failed'
                      ? 'error'
                      : latestAgentEvent.status === 'running'
                      ? 'info'
                      : 'warning'
                  }
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        pointerEvents="none"
        style={[
          styles.conversationRail,
          {
            backgroundColor: isDark
              ? 'rgba(17, 20, 23, 0.7)'
              : 'rgba(255, 255, 255, 0.78)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : theme.colors.outlineVariant,
          },
        ]}
      >
        {conversationRailItems.map(({ message, active, visible }) => {
          const color =
            message.role === 'user'
              ? theme.colors.secondary
              : message.role === 'assistant'
              ? theme.colors.primary
              : theme.colors.onSurfaceVariant;

          return (
            <View
              key={message.id}
              style={[
                styles.conversationRailMark,
                {
                  height: active ? 18 : 8,
                  backgroundColor: color,
                  opacity: active ? 1 : visible ? 0.66 : 0.28,
                },
              ]}
            />
          );
        })}
      </View>

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
        <SuggestionActionBar
          suggestions={session.suggestions}
          onSelect={suggestion => {
            if (suggestion.toLowerCase().includes('preview') && preview) {
              navigation.navigate('Preview', { previewId: preview.id });
            }
          }}
        />
        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => setMode('voice')}
            style={[
              styles.modeButton,
              {
                borderRadius: theme.borderRadius.full,
                backgroundColor:
                  mode === 'voice' ? 'rgba(86, 156, 214, 0.12)' : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color:
                    mode === 'voice'
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              VOICE
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode('text')}
            style={[
              styles.modeButton,
              {
                borderRadius: theme.borderRadius.full,
                backgroundColor:
                  mode === 'text' ? 'rgba(86, 156, 214, 0.12)' : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color:
                    mode === 'text'
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              TEXT
            </Text>
          </TouchableOpacity>
          <View style={styles.sessionControls}>
            <TouchableOpacity
              disabled={deviceOffline}
              onPress={() =>
                session.status === 'paused'
                  ? resumeAgentSession(session.id)
                  : pauseAgentSession(session.id)
              }
            >
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.tertiary },
                ]}
              >
                {session.status === 'paused' ? 'RESUME' : 'PAUSE'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={deviceOffline}
              onPress={() => terminateAgentSession(session.id)}>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.error }]}
              >
                END
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {mode === 'voice' ? (
          <View style={styles.voiceArea}>
            {!voiceDraft ? (
              <View style={styles.voiceIdleArea}>
                <TouchableOpacity
                  activeOpacity={0.82}
                  disabled={deviceOffline}
                  accessibilityRole="button"
                  accessibilityLabel="Record voice"
                  hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                  style={[
                    styles.recordButtonOuter,
                    {
                      borderColor: isDark
                        ? 'rgba(86, 156, 214, 0.35)'
                        : theme.colors.outlineVariant,
                      backgroundColor: isDark
                        ? 'rgba(86, 156, 214, 0.08)'
                        : theme.colors.surfaceContainerLow,
                    },
                  ]}
                  onPress={handleVoiceCapture}
                >
                  <View
                    style={[
                      styles.recordButton,
                      {
                        backgroundColor: theme.colors.primary,
                        ...(isDark ? theme.glow.primary : {}),
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.recordIconRing,
                        { borderColor: theme.colors.onPrimary },
                      ]}
                    >
                      <View
                        style={[
                          styles.recordIconDot,
                          { backgroundColor: theme.colors.onPrimary },
                        ]}
                      />
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <GlassPanel style={styles.voiceDraft}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.primary },
                  ]}
                >
                  VOICE DRAFT
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurface },
                  ]}
                >
                  {preparedPrompt || voiceDraft}
                </Text>
                <View style={styles.voiceActions}>
                  {!preparedPrompt ? (
                    <GlowButton
                      title="AI ORGANIZE"
                      onPress={handlePrepareVoice}
                      variant="secondary"
                      style={styles.voiceButton}
                    />
                  ) : (
                    <GlowButton
                      title="CONFIRM SEND"
                      onPress={handleConfirmVoice}
                      variant="primary"
                      loading={sendingMessage}
                      disabled={deviceOffline || sendingMessage}
                      style={styles.voiceButton}
                    />
                  )}
                  <GlowButton
                    title="RESET"
                    onPress={() => {
                      setVoiceDraft('');
                      setPreparedPrompt('');
                    }}
                    variant="outline"
                    style={styles.voiceButton}
                  />
                </View>
              </GlassPanel>
            )}
          </View>
        ) : (
          <View style={styles.textInputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Send a direction..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              multiline
              style={[
                theme.typography.bodyMd,
                styles.textInput,
                {
                  color: theme.colors.onSurface,
                  borderRadius: theme.borderRadius.md,
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.04)'
                    : theme.colors.surfaceContainer,
                },
              ]}
            />
            <TouchableOpacity
              activeOpacity={0.76}
              disabled={deviceOffline || !input.trim() || sendingMessage}
              onPress={handleSendText}
              style={[
                styles.sendButton,
                {
                  borderRadius: theme.borderRadius.md,
                  backgroundColor:
                    input.trim() && !sendingMessage
                      ? theme.colors.primary
                      : isDark
                      ? 'rgba(255,255,255,0.08)'
                      : theme.colors.surfaceContainerHigh,
                },
              ]}
            >
              {sendingMessage ? (
                <ActivityIndicator
                  color={theme.colors.onPrimary}
                  size="small"
                />
              ) : (
                <Text
                  style={[
                    theme.typography.labelMd,
                    { color: theme.colors.onPrimary },
                  ]}
                >
                  SEND
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
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
    paddingBottom: 268,
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
    padding: 14,
    gap: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    gap: 3,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    gap: 8,
    marginTop: 12,
  },
  quickAction: {
    flex: 1,
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
  detailInlinePanel: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  approvalStack: {
    gap: 10,
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
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
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sessionControls: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 14,
  },
  voiceArea: {
    gap: 10,
  },
  voiceIdleArea: {
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 2,
  },
  recordButtonOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIconRing: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIconDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  voiceDraft: {
    padding: 12,
    gap: 10,
  },
  voiceActions: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceButton: {
    flex: 1,
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    minHeight: 48,
    maxHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendButton: {
    minWidth: 64,
    height: 52,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
