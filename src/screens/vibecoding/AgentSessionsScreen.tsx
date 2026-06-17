import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import {
  vibeStatusLabel,
  vibeStatusType,
} from '../../components/vibecoding/status';
import { NewSessionButton } from '../../components/vibecoding/NewSessionButton';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type AgentSessionsRoute = RouteProp<RootStackParamList, 'AgentSessions'>;

// Active session statuses for counting
const activeSessionStatuses = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

export const AgentSessionsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<AgentSessionsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const pauseAgentSession = useControlCenterStore(
    state => state.pauseAgentSession,
  );
  const resumeAgentSession = useControlCenterStore(
    state => state.resumeAgentSession,
  );
  const terminateAgentSession = useControlCenterStore(
    state => state.terminateAgentSession,
  );

  const sessions = vibeRuns
    .filter(run =>
      route.params?.deviceId ? run.deviceId === route.params.deviceId : true,
    )
    .filter(run =>
      route.params?.projectId ? run.projectId === route.params.projectId : true,
    )
    .sort(
      (left, right) => (right.lastActivityMs ?? 0) - (left.lastActivityMs ?? 0),
    );

  const activeSessions = useMemo(
    () => sessions.filter(s => activeSessionStatuses.includes(s.status)),
    [sessions],
  );

  const onlineDevices = useMemo(
    () => devices.filter(d => d.status === 'online').length,
    [devices],
  );

  const sessionList = useIncrementalList(sessions, {
    initialCount: 10,
    step: 12,
    resetKey: `${route.params?.deviceId ?? 'all'}:${
      route.params?.projectId ?? 'all'
    }`,
  });

  const device = route.params?.deviceId
    ? devices.find(d => d.id === route.params?.deviceId)
    : devices[0];

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Agent Sessions"
        subtitle={device?.name ?? 'ALL DEVICES'}
        onBack={navigation.goBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <View style={styles.summary}>
          <StatusChip label={`${activeSessions.length} ACTIVE`} type="success" />
          <StatusChip label={`${sessions.length} TOTAL`} type="info" />
          <StatusChip label={`${onlineDevices} AGENTS`} type="info" />
        </View>

        <NewSessionButton
          onPress={() =>
            navigation.navigate('CreateVibeCoding', {
              deviceId: route.params?.deviceId,
              projectId: route.params?.projectId,
            })
          }
          disabled={devices.length === 0}
        />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          ACTIVE AND RECENT SESSIONS
        </Text>

        {sessionList.visibleItems.map(session => {
          const sessionProject = projects.find(
            item => item.id === session.projectId,
          );
          const sessionDevice = devices.find(
            item => item.id === session.deviceId,
          );
          const displayTitle = formatVibeSessionTitle(session.title, {
            directory: session.directory,
            projectName: sessionProject?.name,
          });
          const budgetLabel = session.projectBudget
            ? `${
                session.projectBudget.currencySymbol
              }${session.projectBudget.used.toFixed(1)} / ${
                session.projectBudget.currencySymbol
              }${session.projectBudget.limit}`
            : '';

          return (
            <GlassPanel key={session.id} style={styles.sessionCard}>
              <View style={styles.sessionTop}>
                <IconBadge
                  name={
                    session.model.toLowerCase().includes('codex')
                      ? 'code'
                      : 'agent'
                  }
                  tone={session.status === 'paused' ? 'neutral' : 'primary'}
                  size={40}
                  iconSize={20}
                />
                <View style={styles.titleBlock}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.titleMd,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    {displayTitle}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {session.model} /{' '}
                    {sessionProject?.name ?? session.projectId} /{' '}
                    {sessionDevice?.name ?? session.deviceId}
                  </Text>
                </View>
                <StatusChip
                  label={vibeStatusLabel[session.status]}
                  type={vibeStatusType[session.status]}
                />
              </View>
              <Text
                numberOfLines={2}
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {session.currentStep}
              </Text>
              {session.projectBudget ? (
                <View
                  style={[
                    styles.budgetPill,
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
                    size={24}
                    iconSize={13}
                  />
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: isDark ? '#6A9955' : theme.colors.secondary },
                    ]}
                  >
                    Codex budget {budgetLabel}
                  </Text>
                </View>
              ) : null}
              <View style={styles.sessionActions}>
                <Action
                  label="OPEN"
                  onPress={() =>
                    navigation.navigate('VibeCodingSession', {
                      sessionId: session.id,
                    })
                  }
                />
                <Action
                  label={session.status === 'paused' ? 'RESUME' : 'PAUSE'}
                  onPress={() =>
                    session.status === 'paused'
                      ? resumeAgentSession(session.id)
                      : pauseAgentSession(session.id)
                  }
                />
                <Action
                  label="TERMINATE"
                  danger
                  onPress={() => terminateAgentSession(session.id)}
                />
              </View>
            </GlassPanel>
          );
        })}
        <LoadMoreRow
          visibleCount={sessionList.visibleCount}
          totalCount={sessionList.totalCount}
          onPress={sessionList.showMore}
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface ActionProps {
  label: string;
  onPress: () => void;
  danger?: boolean;
}

const Action: React.FC<ActionProps> = ({ label, onPress, danger }) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.actionButton,
        {
          borderRadius: theme.borderRadius.full,
          borderColor: danger
            ? theme.colors.error
            : theme.colors.outlineVariant,
        },
      ]}
    >
      <Text
        style={[
          theme.typography.codeSm,
          { color: danger ? theme.colors.error : theme.colors.primary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionTitleFirst: {
    marginBottom: 8,
  },
  summary: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  emptyAgentCard: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  emptyAgentCopy: {
    flex: 1,
    gap: 4,
  },
  createPanel: {
    padding: 14,
    gap: 12,
    marginTop: 8,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  selectorRow: {
    gap: 8,
  },
  selectorChip: {
    borderWidth: 1,
    maxWidth: 220,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  projectGrid: {
    gap: 8,
  },
  projectOption: {
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  inlineEmptyPanel: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 12,
    gap: 5,
  },
  objectiveInput: {
    minHeight: 92,
    textAlignVertical: 'top',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  sessionCard: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  sessionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  budgetPill: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
