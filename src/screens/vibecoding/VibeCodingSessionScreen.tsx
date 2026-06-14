import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
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
import { vibeStatusLabel, vibeStatusType } from '../../components/vibecoding/status';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import type { AgentBudgetInfo } from '../../data/mockData';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;

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
  const appendAgentMessage = useControlCenterStore(state => state.appendAgentMessage);
  const pauseAgentSession = useControlCenterStore(state => state.pauseAgentSession);
  const resumeAgentSession = useControlCenterStore(state => state.resumeAgentSession);
  const terminateAgentSession = useControlCenterStore(
    state => state.terminateAgentSession,
  );
  const session =
    vibeRuns.find(item => item.id === route.params.sessionId) ??
    vibeRuns[0];
  const project = projects.find(item => item.id === session.projectId);
  const device = devices.find(item => item.id === session.deviceId);
  const preview = previewLinks.find(item => item.id === session.previewId);
  const budgetLabel = formatBudget(session.projectBudget);

  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [input, setInput] = useState('');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [preparedPrompt, setPreparedPrompt] = useState('');

  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  const appendUserMessage = async (content: string, messageMode: 'voice' | 'text') => {
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
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.sessionHeader}>
          <View style={styles.headerTop}>
            <IconBadge
              name={session.model.includes('Codex') ? 'code' : 'agent'}
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

        <View style={styles.conversationSection}>
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
                  {session.transcript.length} messages
                </Text>
              </View>
            </View>
            <StatusChip label={mode.toUpperCase()} type="info" />
          </View>
        {session.transcript.map(message => {
          const isUser = message.role === 'user';
          const isSystem = message.role === 'system';

          return (
          <View
            key={message.id}
            style={[
              styles.messageRow,
              isUser ? styles.messageRowUser : styles.messageRowAgent,
            ]}>
            {!isUser ? (
              <IconBadge
                name={isSystem ? 'event' : 'agent'}
                tone={isSystem ? 'neutral' : 'primary'}
                size={32}
                iconSize={16}
              />
            ) : null}
            <View
              style={[
                styles.messageStack,
                isUser ? styles.messageStackUser : styles.messageStackAgent,
              ]}>
              <View
                style={[
                  styles.messageMeta,
                  isUser ? styles.messageMetaUser : styles.messageMetaAgent,
                ]}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {isUser ? 'YOU' : message.role.toUpperCase()}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {message.timestamp}
                </Text>
              </View>
              <View
                style={[
                  styles.messageBubble,
                  {
                    backgroundColor: isUser
                      ? isDark
                        ? 'rgba(0, 209, 255, 0.14)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : isDark
                      ? 'rgba(255,255,255,0.05)'
                      : theme.colors.surfaceContainerLow,
                    borderColor: isUser
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    borderTopRightRadius: isUser ? 6 : theme.borderRadius.lg,
                    borderTopLeftRadius: isUser ? theme.borderRadius.lg : 6,
                  },
                ]}>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                  {message.content}
                </Text>
              </View>
            </View>
            {isUser ? (
              <IconBadge name="user" tone="secondary" size={32} iconSize={16} />
            ) : null}
          </View>
          );
        })}
        </View>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          AGENT TIMELINE
        </Text>
        <GlassPanel style={styles.timelinePanel}>
          {session.events.map((event, index) => (
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
                  size={36}
                  iconSize={18}
                />
                <View style={styles.eventText}>
                  <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {event.title}
                  </Text>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
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
              {index < session.events.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </GlassPanel>
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
        {session.transcript.map((message, index) => {
          const active = index === session.transcript.length - 1;
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
                  opacity: active ? 1 : 0.46,
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
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  conversationSection: {
    marginTop: 20,
    gap: 12,
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
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAgent: {
    justifyContent: 'flex-start',
  },
  messageStack: {
    maxWidth: '78%',
    gap: 4,
  },
  messageStackUser: {
    alignItems: 'flex-end',
  },
  messageStackAgent: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    borderWidth: 1,
    padding: 12,
    gap: 8,
    borderRadius: 14,
  },
  messageMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  messageMetaUser: {
    justifyContent: 'flex-end',
  },
  messageMetaAgent: {
    justifyContent: 'flex-start',
  },
  timelinePanel: {
    padding: 0,
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
