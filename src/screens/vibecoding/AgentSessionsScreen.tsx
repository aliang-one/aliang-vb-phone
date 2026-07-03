import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
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
import { useControlCenterStore, useStableVibeRuns } from '../../store/controlCenterStore';
import type { VibeCodingRun } from '../../data/platformModels';
import { IconBadge } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { useProjectSessions } from '../../hooks/useProjectSessions';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import { formatActivityLabel } from '../../store/internals';

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
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<AgentSessionsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useStableVibeRuns();

  // When opened for a specific project, use the project-scoped fetch (full
  // history, decoupled from the globally-capped vibeRuns store). Otherwise
  // fall back to the store (global / per-device views).
  const projectScoped = useProjectSessions(route.params?.projectId);
  const sessions = route.params?.projectId
    ? projectScoped.sessions
    : vibeRuns
        .filter(run =>
          route.params?.deviceId ? run.deviceId === route.params.deviceId : true,
        )
        .sort(
          (left, right) =>
            (right.lastActivityMs ?? 0) - (left.lastActivityMs ?? 0),
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

  const handleOpenSession = useCallback(
    (sessionId: string) =>
      navigation.navigate('VibeCodingSession', { sessionId }),
    [navigation],
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Agent Sessions"
        subtitle={device?.name ?? 'ALL DEVICES'}
        onBack={navigation.goBack}
      />
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        data={sessionList.visibleItems}
        keyExtractor={session => session.id}
        renderItem={({ item: session }) => {
          const sessionProject = projects.find(
            item => item.id === session.projectId,
          );
          const sessionDevice = devices.find(
            item => item.id === session.deviceId,
          );
          return (
            <SessionCard
              session={session}
              projectName={sessionProject?.name ?? session.projectId}
              deviceName={sessionDevice?.name ?? session.deviceId}
              onOpen={handleOpenSession}
            />
          );
        }}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={12}
        windowSize={7}
        ListHeaderComponent={
          <View>
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
          </View>
        }
        ListFooterComponent={
          <LoadMoreRow
            visibleCount={sessionList.visibleCount}
            totalCount={sessionList.totalCount}
            onPress={sessionList.showMore}
          />
        }
      />
    </SafeAreaWrapper>
  );
};

interface SessionCardProps {
  session: VibeCodingRun;
  projectName: string;
  deviceName: string;
  onOpen: (sessionId: string) => void;
}

const SessionCard: React.FC<SessionCardProps> = React.memo(
  ({ session, projectName, deviceName, onOpen }) => {
    const { t } = useTranslation('vibecoding');
    const { theme, isDark } = useTheme();
    const displayTitle = formatVibeSessionTitle(session.title, {
      directory: session.directory,
      projectName,
    });
    const budgetLabel = session.projectBudget
      ? `${session.projectBudget.currencySymbol}${session.projectBudget.used.toFixed(1)} / ${session.projectBudget.currencySymbol}${session.projectBudget.limit}`
      : '';
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => onOpen(session.id)}>
        <GlassPanel style={styles.sessionCard}>
          <View style={styles.sessionTop}>
            <IconBadge
              name={session.model.toLowerCase().includes('codex') ? 'code' : 'agent'}
              tone={session.status === 'paused' ? 'neutral' : 'primary'}
              size={40}
              iconSize={20}
            />
            <View style={styles.titleBlock}>
              <Text
                numberOfLines={1}
                style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {displayTitle}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {session.model} / {projectName} / {deviceName}
              </Text>
            </View>
            <StatusChip
              label={vibeStatusLabel[session.status]}
              type={vibeStatusType[session.status]}
            />
          </View>
          <Text
            numberOfLines={2}
            style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
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
              ]}>
              <IconBadge name="quota" tone="secondary" size={24} iconSize={13} />
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: isDark ? '#6A9955' : theme.colors.secondary },
                ]}>
                Codex budget {budgetLabel}
              </Text>
            </View>
          ) : null}
          <View style={styles.sessionMeta}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {formatActivityLabel(session.lastActivityMs)}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {'  ·  '}
              {t('agentSessions.messagesCount', { count: session.transcriptCount ?? 0 })}
            </Text>
            <View style={styles.metaSpacer} />
            <IconBadge name="chevron" tone="primary" size={24} iconSize={14} />
          </View>
        </GlassPanel>
      </TouchableOpacity>
    );
  },
);
SessionCard.displayName = 'SessionCard';

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
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  metaSpacer: {
    flex: 1,
  },
});
