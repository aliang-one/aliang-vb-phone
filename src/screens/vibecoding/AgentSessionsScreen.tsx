import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from '../../components/vibecoding/status';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  AgentProvider,
  useControlCenterStore,
} from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type AgentSessionsRoute = RouteProp<RootStackParamList, 'AgentSessions'>;

const providerLabels: Record<AgentProvider, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
};

export const AgentSessionsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<AgentSessionsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const startAgentSession = useControlCenterStore(state => state.startAgentSession);
  const pauseAgentSession = useControlCenterStore(state => state.pauseAgentSession);
  const resumeAgentSession = useControlCenterStore(state => state.resumeAgentSession);
  const terminateAgentSession = useControlCenterStore(
    state => state.terminateAgentSession,
  );

  const initialDeviceId = route.params?.deviceId ?? devices[0]?.id ?? '';
  const initialProjectId =
    route.params?.projectId ??
    devices.find(item => item.id === initialDeviceId)?.projectIds[0] ??
    projects[0]?.id ??
    '';
  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [provider, setProvider] = useState<AgentProvider>('codex');
  const [objective, setObjective] = useState(
    'Scan the project, summarize current state, and prepare a safe implementation plan.',
  );

  const device = devices.find(item => item.id === deviceId) ?? devices[0];
  const availableProjects = useMemo(
    () => projects.filter(item => device?.projectIds.includes(item.id)),
    [device?.projectIds, projects],
  );
  const project =
    projects.find(item => item.id === projectId) ??
    availableProjects[0] ??
    projects[0];
  const sessions = vibeRuns.filter(run =>
    route.params?.deviceId ? run.deviceId === route.params.deviceId : true,
  );

  const handleStart = () => {
    if (!device || !project || !objective.trim()) {
      return;
    }

    const sessionId = startAgentSession({
      deviceId: device.id,
      projectId: project.id,
      directory: device.authorizedDirectories[0] ?? '~',
      provider,
      objective: objective.trim(),
      budgetLimit: 12,
      timeLimitMinutes: 60,
    });
    navigation.navigate('VibeCodingSession', { sessionId });
  };

  const handleSelectDevice = (nextDeviceId: string) => {
    const nextDevice = devices.find(item => item.id === nextDeviceId);
    setDeviceId(nextDeviceId);
    setProjectId(nextDevice?.projectIds[0] ?? projectId);
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Agent Sessions"
        subtitle="CLAUDE CODE / CODEX"
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.createPanel}>
          <View style={styles.panelHeader}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              Start Agent
            </Text>
            <StatusChip label={providerLabels[provider].toUpperCase()} type="info" />
          </View>

          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            PROVIDER
          </Text>
          <View style={styles.segmentRow}>
            {(['codex', 'claude_code'] as AgentProvider[]).map(item => {
              const active = item === provider;
              return (
                <TouchableOpacity
                  key={item}
                  activeOpacity={0.75}
                  onPress={() => setProvider(item)}
                  style={[
                    styles.segment,
                    {
                      borderRadius: theme.borderRadius.full,
                      borderColor: active
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                      backgroundColor: active
                        ? isDark
                          ? 'rgba(0, 209, 255, 0.12)'
                          : 'rgba(0, 81, 174, 0.08)'
                        : 'transparent',
                    },
                  ]}>
                  <Text
                    style={[
                      theme.typography.labelSm,
                      {
                        color: active
                          ? theme.colors.primary
                          : theme.colors.onSurfaceVariant,
                      },
                    ]}>
                    {providerLabels[item]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            DEVICE
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}>
            {devices.map(item => {
              const active = item.id === device?.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.75}
                  onPress={() => handleSelectDevice(item.id)}
                  style={[
                    styles.selectorChip,
                    {
                      borderRadius: theme.borderRadius.full,
                      borderColor: active
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      {
                        color: active
                          ? theme.colors.primary
                          : theme.colors.onSurfaceVariant,
                      },
                    ]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            PROJECT
          </Text>
          <View style={styles.projectGrid}>
            {availableProjects.map(item => {
              const active = item.id === project?.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.75}
                  onPress={() => setProjectId(item.id)}
                  style={[
                    styles.projectOption,
                    {
                      borderRadius: theme.borderRadius.md,
                      borderColor: active
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                      backgroundColor: active
                        ? isDark
                          ? 'rgba(0, 209, 255, 0.1)'
                          : 'rgba(0, 81, 174, 0.08)'
                        : 'transparent',
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {item.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {item.branch}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            value={objective}
            onChangeText={setObjective}
            multiline
            placeholder="Agent objective..."
            placeholderTextColor={theme.colors.onSurfaceVariant}
            style={[
              theme.typography.bodyMd,
              styles.objectiveInput,
              {
                color: theme.colors.onSurface,
                borderColor: theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainer,
              },
            ]}
          />
          <GlowButton
            title={`START ${providerLabels[provider].toUpperCase()}`}
            onPress={handleStart}
            disabled={!device || !project || !objective.trim()}
          />
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          ACTIVE AND RECENT SESSIONS
        </Text>

        {sessions.map(session => {
          const sessionProject = projects.find(item => item.id === session.projectId);
          const sessionDevice = devices.find(item => item.id === session.deviceId);
          return (
            <GlassPanel key={session.id} style={styles.sessionCard}>
              <View style={styles.sessionTop}>
                <View style={styles.titleBlock}>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {session.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {session.model} / {sessionProject?.name ?? session.projectId} /{' '}
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
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {session.currentStep}
              </Text>
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
          borderColor: danger ? theme.colors.error : theme.colors.outlineVariant,
        },
      ]}>
      <Text
        style={[
          theme.typography.codeSm,
          { color: danger ? theme.colors.error : theme.colors.primary },
        ]}>
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
  createPanel: {
    padding: 14,
    gap: 12,
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
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
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
