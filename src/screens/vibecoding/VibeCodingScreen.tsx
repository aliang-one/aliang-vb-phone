import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { StatusBar } from '../../components/code/StatusBar';
import { AIChatBubble } from '../../components/ai/AIChatBubble';
import { GlowButton } from '../../components/shared/GlowButton';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { useControlCenterStore } from '../../store/controlCenterStore';

export const VibeCodingScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const { sessionId } = (route.params as { sessionId?: string }) ?? {};
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const pauseAgentSession = useControlCenterStore(state => state.pauseAgentSession);
  const terminateAgentSession = useControlCenterStore(state => state.terminateAgentSession);

  const session = sessionId
    ? vibeRuns.find(r => r.id === sessionId)
    : vibeRuns[0];

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="VibeCoding" onBack={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.bodyLg, { color: theme.colors.onSurfaceVariant }]}>
            Session not found
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  const statusLabel = session.status === 'running' ? 'APPLYING'
    : session.status === 'waiting_approval' ? 'NEEDS APPROVAL'
    : session.status === 'preview_ready' ? 'PREVIEW READY'
    : session.status === 'completed' ? 'DONE'
    : session.status === 'failed' ? 'FAILED'
    : session.status === 'paused' ? 'PAUSED'
    : 'IDLE';

  const statusType = session.status === 'running' ? 'info' as const
    : session.status === 'completed' ? 'success' as const
    : session.status === 'failed' ? 'error' as const
    : 'warning' as const;
  const statusBarState = session.status === 'running'
    ? 'applying' as const
    : session.status === 'completed'
    ? 'success' as const
    : session.status === 'paused'
    ? 'paused' as const
    : 'thinking' as const;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={session.title}
        subtitle={session.model?.toUpperCase() ?? 'VIBECODING'}
        onBack={() => navigation.goBack()}
      />

      {/* Status Bar */}
      <View style={styles.statusContainer}>
        <StatusBar status={statusBarState} file={session.currentStep} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>

        {/* Session Info */}
        <GlassPanel style={styles.infoPanel}>
          <View style={styles.infoRow}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              STATUS
            </Text>
            <StatusChip label={statusLabel} type={statusType} />
          </View>
          <View style={styles.infoRow}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              BRANCH
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              {session.branch}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              RISK
            </Text>
            <StatusChip label={session.risk.toUpperCase()} type={session.risk === 'high' ? 'error' : session.risk === 'medium' ? 'warning' : 'success'} />
          </View>
          {session.objective ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface, marginTop: 8 }]}>
              {session.objective}
            </Text>
          ) : null}
        </GlassPanel>

        {/* Events */}
        {session.events.length > 0 && (
          <View style={styles.eventsSection}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant, marginBottom: 8 }]}>
              EVENTS
            </Text>
            {session.events.map(evt => (
              <GlassPanel key={evt.id} style={styles.eventCard}>
                <View style={styles.eventRow}>
                  <StatusChip
                    label={evt.status.toUpperCase()}
                    type={evt.status === 'done' ? 'success' : evt.status === 'running' ? 'info' : evt.status === 'failed' ? 'error' : 'warning'}
                  />
                  <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                    {evt.timestamp}
                  </Text>
                </View>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                  {evt.title}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {evt.detail}
                </Text>
              </GlassPanel>
            ))}
          </View>
        )}

        {/* Transcript */}
        {session.transcript.length > 0 && (
          <View style={styles.transcriptSection}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant, marginBottom: 8 }]}>
              TRANSCRIPT
            </Text>
            {session.transcript.map(msg => (
              <AIChatBubble
                key={msg.id}
                message={{
                  id: msg.id,
                  role: msg.role === 'user' ? 'user' : 'assistant',
                  content: msg.content,
                  timestamp: msg.timestamp,
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Action Bar */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: isDark
              ? 'rgba(17, 20, 23, 0.95)'
              : 'rgba(247, 249, 255, 0.95)',
            borderTopColor: isDark
              ? 'rgba(255, 255, 255, 0.06)'
              : theme.colors.outlineVariant,
          },
        ]}>
        {session.status === 'running' ? (
          <GlowButton
            title="PAUSE"
            onPress={() => pauseAgentSession(session.id)}
            variant="outline"
            style={styles.actionBtn}
          />
        ) : null}
        <GlowButton
          title="CHAT"
          onPress={() => navigation.navigate('VibeCodingSession', { sessionId: session.id })}
          variant="primary"
          style={styles.actionBtn}
        />
        <GlowButton
          title="STOP"
          onPress={() => terminateAgentSession(session.id)}
          variant="secondary"
          style={styles.actionBtn}
        />
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  infoPanel: {
    padding: 12,
    marginTop: 8,
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventsSection: {
    marginTop: 16,
  },
  eventCard: {
    padding: 10,
    marginBottom: 6,
    gap: 4,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transcriptSection: {
    marginTop: 16,
  },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
