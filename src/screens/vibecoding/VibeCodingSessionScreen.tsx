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

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionRoute = RouteProp<RootStackParamList, 'VibeCodingSession'>;

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

  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [input, setInput] = useState('');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [preparedPrompt, setPreparedPrompt] = useState('');

  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  const appendUserMessage = (content: string, messageMode: 'voice' | 'text') => {
    appendAgentMessage(session.id, content, messageMode);
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
    appendUserMessage(preparedPrompt, 'voice');
    setVoiceDraft('');
    setPreparedPrompt('');
  };

  const handleSendText = () => {
    if (!input.trim()) {
      return;
    }
    appendUserMessage(input.trim(), 'text');
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
              ${session.budgetUsed.toFixed(2)} / ${session.budgetLimit}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {session.elapsedMinutes}m / {session.timeLimitMinutes}m
            </Text>
          </View>
          <ProgressBar progress={progress} color={theme.colors.primary} />
        </GlassPanel>

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

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          CONVERSATION
        </Text>
        {session.transcript.map(message => (
          <View
            key={message.id}
            style={[
              styles.messageBubble,
              {
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor:
                  message.role === 'user'
                    ? isDark
                      ? 'rgba(0, 209, 255, 0.12)'
                      : 'rgba(0, 81, 174, 0.08)'
                    : isDark
                    ? 'rgba(255,255,255,0.05)'
                    : theme.colors.surfaceContainerLow,
                borderColor:
                  message.role === 'user'
                    ? theme.colors.primary
                    : theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
              },
            ]}>
            <View style={styles.messageMeta}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
                {message.role.toUpperCase()}
              </Text>
              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {message.timestamp}
              </Text>
            </View>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              {message.content}
            </Text>
          </View>
        ))}

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
  previewCard: {
    padding: 12,
    marginTop: 12,
    gap: 8,
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
  messageBubble: {
    maxWidth: '88%',
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  messageMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  timelinePanel: {
    padding: 0,
  },
  eventRow: {
    flexDirection: 'row',
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
