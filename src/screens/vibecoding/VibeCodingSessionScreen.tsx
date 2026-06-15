import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { vibeStatusLabel, vibeStatusType } from '../../components/vibecoding/status';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import type { AgentBudgetInfo } from '../../data/platformModels';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { buildDisplayTranscript } from '../../utils/agentTranscript';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;

// During streaming the store updates on a ~60ms cadence; driving scroll-driven
// state at 60fps on top of that re-runs the conversation-rail computation every
// frame. Throttle the scroll→state bridge so the rail only recomputes a few
// times per second (leading edge) plus one trailing update when scrolling stops.
const SCROLL_THROTTLE_MS = 80;

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
    ? `${budget.currencySymbol}${budget.used.toFixed(2)} / ${budget.currencySymbol}${budget.limit}`
    : '';

export const VibeCodingSessionScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionRoute>();
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const projects = useControlCenterStore(state => state.projects);
  const devices = useControlCenterStore(state => state.devices);
  const previewLinks = useControlCenterStore(state => state.previewLinks);
  const loadAgentSessionDetail = useControlCenterStore(state => state.loadAgentSessionDetail);
  const appendAgentMessage = useControlCenterStore(state => state.appendAgentMessage);
  const pauseAgentSession = useControlCenterStore(state => state.pauseAgentSession);
  const resumeAgentSession = useControlCenterStore(state => state.resumeAgentSession);
  const terminateAgentSession = useControlCenterStore(
    state => state.terminateAgentSession,
  );
  const session = vibeRuns.find(item => item.id === route.params.sessionId);

  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [input, setInput] = useState('');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [preparedPrompt, setPreparedPrompt] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollYRef = useRef(0);
  const lastScrollSetRef = useRef(0);
  const trailingScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
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
  const [messageLayouts, setMessageLayouts] = useState<Record<string, { top: number; height: number }>>({});
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const targetSessionId = session?.id ?? route.params.sessionId;
  const transcript = useMemo(
    () => buildDisplayTranscript(session?.transcript ?? []),
    [session?.transcript],
  );
  const visibleSessionEvents = useMemo(
    () => (session?.events ?? []).filter(
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
  const visibleTranscript = transcriptList.visibleItems;
  const visibleAgentEvents = agentEventList.visibleItems;
  const latestAgentEvent = visibleSessionEvents[visibleSessionEvents.length - 1];
  const visibleTranscriptIds = useMemo(
    () => new Set(visibleTranscript.map(message => message.id)),
    [visibleTranscript],
  );
  const activeRailMessageId = useMemo(() => {
    if (!visibleTranscript.length) return undefined;
    const fallbackId = visibleTranscript[visibleTranscript.length - 1]?.id;
    if (!viewportHeight) return fallbackId;

    const focusY = scrollY + Math.min(Math.max(viewportHeight * 0.46, 160), 380);
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
  }, [messageLayouts, scrollY, viewportHeight, visibleTranscript, conversationTop]);
  const conversationRailItems = useMemo(() => {
    if (!transcript.length) return [];
    const maxMarks = 16;
    const step = Math.max(1, Math.ceil(transcript.length / maxMarks));
    return transcript
      .filter((message, index) => index % step === 0 || index === transcript.length - 1 || message.id === activeRailMessageId)
      .map(message => ({
        message,
        active: message.id === activeRailMessageId,
        visible: visibleTranscriptIds.has(message.id),
      }));
  }, [activeRailMessageId, transcript, visibleTranscriptIds]);

  const hasDetail = Boolean(
    session?.detailLoadedAt || session?.transcript.length || session?.events.length,
  );

  useEffect(() => {
    if (!targetSessionId || hasDetail || loadingDetail || detailError) return;

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');

    void loadAgentSessionDetail(targetSessionId)
      .catch(error => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : 'Failed to load session detail.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailError, hasDetail, loadAgentSessionDetail, loadingDetail, targetSessionId]);

  useEffect(() => {
    setMessageLayouts({});
  }, [targetSessionId, visibleTranscript.length]);

  useEffect(() => {
    setTimelineExpanded(false);
  }, [targetSessionId]);

  const handleTranscriptMessageLayout = (messageId: string, y: number, height: number) => {
    // Store the message's offset relative to the conversation container only.
    // `conversationTop` (the container's own offset within the scroll content) is
    // applied at calculation time so stale closure captures can't desync the rail.
    setMessageLayouts(current => {
      const existing = current[messageId];
      if (existing && Math.abs(existing.top - y) < 1 && Math.abs(existing.height - height) < 1) {
        return current;
      }
      return { ...current, [messageId]: { top: y, height } };
    });
  };

  const appendUserMessage = async (content: string, messageMode: 'voice' | 'text') => {
    if (!session) return;
    await appendAgentMessage(session.id, content, messageMode);
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
    if (!preparedPrompt) {
      return;
    }
    void appendUserMessage(preparedPrompt, 'voice')
      .then(() => {
        setVoiceDraft('');
        setPreparedPrompt('');
      })
      .catch(error => {
        console.warn('[vibecoding] failed to send voice prompt', error);
      });
  };

  const handleSendText = () => {
    if (!input.trim()) {
      return;
    }
    void appendUserMessage(input.trim(), 'text').catch(error => {
      console.warn('[vibecoding] failed to send text prompt', error);
    });
    setInput('');
  };

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="VibeCoding" subtitle="LOADING" onBack={navigation.goBack} />
        <View style={styles.loadingState}>
          {loadingDetail && <ActivityIndicator color={theme.colors.primary} />}
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {detailError || '正在加载会话...'}
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  const project = projects.find(item => item.id === session.projectId);
  const device = devices.find(item => item.id === session.deviceId);
  const preview = previewLinks.find(item => item.id === session.previewId);
  const budgetLabel = formatBudget(session.projectBudget);
  const isCodexSession = session.model.toLowerCase().includes('codex');
  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={project?.name ?? session.title}
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
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}
        onScroll={handleScroll}>
        <GlassPanel style={styles.sessionHeader}>
          <View style={styles.headerTop}>
            <IconBadge
              name={isCodexSession ? 'code' : 'agent'}
              tone={session.status === 'waiting_approval' ? 'tertiary' : 'primary'}
              size={48}
              iconSize={24}
              filled={session.status === 'running'}
            />
            <View style={styles.headerTitle}>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {session.title}
              </Text>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {session.directory}
              </Text>
            </View>
            <StatusChip label={session.risk.toUpperCase()} type={session.risk === 'high' ? 'error' : session.risk === 'medium' ? 'warning' : 'success'} />
          </View>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {session.objective}
          </Text>
          <View style={styles.progressMeta}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              Runtime
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
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
                    ? 'rgba(55, 214, 145, 0.1)'
                    : 'rgba(0, 120, 84, 0.08)',
                },
              ]}>
              <IconBadge name="quota" tone="secondary" size={30} iconSize={15} />
              <View style={styles.budgetCopy}>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.secondary }]}>
                  CODEX BUDGET
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {budgetLabel} · updated {session.projectBudget.updatedAt}
                </Text>
              </View>
            </View>
          ) : null}
        </GlassPanel>

        <View style={styles.quickActions}>
          <GlowButton
            title="FILES"
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
            onPress={() => navigation.navigate('Preview', { previewId: preview.id })}>
            <GlassPanel glowColor="primary" style={styles.previewCard}>
              <View style={styles.previewTop}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  Preview ready
                </Text>
                <StatusChip label={`${preview.port}`} type="info" />
              </View>
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                {preview.shortUrl}
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {preview.access.toUpperCase()} / expires in {preview.expiresIn}
              </Text>
            </GlassPanel>
          </TouchableOpacity>
        )}

        <View
          style={styles.conversationSection}
          onLayout={event => setConversationTop(event.nativeEvent.layout.y)}>
          <View style={styles.chatSectionHeader}>
            <View style={styles.chatHeaderLeft}>
              <IconBadge name="chat" tone="primary" size={34} iconSize={17} />
              <View>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  CONVERSATION
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {transcript.length
                    ? `${visibleTranscript.length}/${transcript.length} grouped`
                    : `${session.transcriptCount ?? 0} messages`}
                </Text>
              </View>
            </View>
            <StatusChip label={mode.toUpperCase()} type="info" />
          </View>
        {loadingDetail ? (
          <GlassPanel style={styles.detailStatePanel}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              正在拉取完整会话内容...
            </Text>
          </GlassPanel>
        ) : detailError ? (
          <GlassPanel style={styles.detailStatePanel}>
            <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
              {detailError}
            </Text>
          </GlassPanel>
        ) : transcript.length ? (
          <>
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
        ) : (
          <GlassPanel style={styles.detailStatePanel}>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              暂无会话记录
            </Text>
          </GlassPanel>
        )}
        {latestAgentEvent ? (
          <View style={styles.timelineDock}>
            {timelineExpanded ? (
              <GlassPanel style={styles.timelinePopover}>
                <View style={styles.timelinePopoverHeader}>
                  <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                    AGENT TIMELINE
                  </Text>
                  <TouchableOpacity onPress={() => setTimelineExpanded(false)}>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
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
                        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurface }]}>
                          {event.title}
                        </Text>
                        <Text
                          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                          numberOfLines={2}>
                          {event.detail}
                        </Text>
                        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
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
                    {index < visibleAgentEvents.length - 1 && <View style={styles.divider} />}
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
              ]}>
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
                  style={[theme.typography.labelSm, { color: theme.colors.onSurface }]}
                  numberOfLines={1}>
                  {latestAgentEvent.title}
                </Text>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}>
                  {visibleSessionEvents.length} events · {latestAgentEvent.timestamp}
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
        ]}>
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
        ]}>
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
                  mode === 'voice' ? 'rgba(0, 209, 255, 0.12)' : 'transparent',
              },
            ]}>
            <Text style={[theme.typography.labelSm, { color: mode === 'voice' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
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
                  mode === 'text' ? 'rgba(0, 209, 255, 0.12)' : 'transparent',
              },
            ]}>
            <Text style={[theme.typography.labelSm, { color: mode === 'text' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
              TEXT
            </Text>
          </TouchableOpacity>
          <View style={styles.sessionControls}>
            <TouchableOpacity
              onPress={() =>
                session.status === 'paused'
                  ? resumeAgentSession(session.id)
                  : pauseAgentSession(session.id)
              }>
              <Text style={[theme.typography.codeSm, { color: theme.colors.tertiary }]}>
                {session.status === 'paused' ? 'RESUME' : 'PAUSE'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => terminateAgentSession(session.id)}>
              <Text style={[theme.typography.codeSm, { color: theme.colors.error }]}>
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
                  accessibilityRole="button"
                  accessibilityLabel="Record voice"
                  hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                  style={[
                    styles.recordButtonOuter,
                    {
                      borderColor: isDark
                        ? 'rgba(0, 209, 255, 0.35)'
                        : theme.colors.outlineVariant,
                      backgroundColor: isDark
                        ? 'rgba(0, 209, 255, 0.08)'
                        : theme.colors.surfaceContainerLow,
                    },
                  ]}
                  onPress={handleVoiceCapture}>
                  <View
                    style={[
                      styles.recordButton,
                      {
                        backgroundColor: theme.colors.primary,
                        ...(isDark ? theme.glow.primary : {}),
                      },
                    ]}>
                    <View
                      style={[
                        styles.recordIconRing,
                        { borderColor: theme.colors.onPrimary },
                      ]}>
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
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  VOICE DRAFT
                </Text>
                <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
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
            <TouchableOpacity onPress={handleSendText} style={styles.sendButton}>
              <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
                {'>'}
              </Text>
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
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
