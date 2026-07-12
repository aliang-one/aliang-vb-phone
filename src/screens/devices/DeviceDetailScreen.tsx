import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { ProjectWorkspaceCard } from '../../components/cards/ProjectWorkspaceCard';
import { GlowButton } from '../../components/shared/GlowButton';
import { ActionGridCard } from '../../components/shared/ActionGridCard';
import { CollapsiblePanel } from '../../components/shared/CollapsiblePanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { TerminalCard } from '../../components/terminals/TerminalCard';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useStableVibeRuns } from '../../store/controlCenterStore';
import { IconBadge } from '../../components/visual/IconBadge';
import { RingMeter } from '../../components/visual/RingMeter';
import { VibeStatus } from '../../data/platformModels';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';
import { isActiveTerminalSessionStatus } from '../../utils/terminalInteraction';
import { compareSessionsByStableActivity } from '../../utils/sessionPhase';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DeviceRoute = RouteProp<RootStackParamList, 'DeviceDetail'>;

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

const activeSessionStatuses: VibeStatus[] = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

const uniqueStrings = (items: string[]) =>
  Array.from(new Set(items.filter(Boolean)));

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  'local-agent': 'Local Agent',
  'local-terminal': 'Local Terminal',
  'project-files': 'Project Files',
  'local-vibecoding': 'VibeCoding Bridge',
};

const workspaceToolLabel = (tool: string) => TOOL_LABELS[tool] ?? tool;

const activePanelStyle = (
  isDark: boolean,
  lightBackgroundColor: string,
) => ({
  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : lightBackgroundColor,
});

const lowPanelStyle = (isDark: boolean, lightBackgroundColor: string) => ({
  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : lightBackgroundColor,
});

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const DeviceDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('devices');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projectsStore = useControlCenterStore(state => state.projects);
  const vibeRuns = useStableVibeRuns();
  const events = useControlCenterStore(state => state.events);
  const approvals = useControlCenterStore(state => state.approvals);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const terminalSessions = useControlCenterStore(state => state.terminalSessions);
  const stopTerminal = useControlCenterStore(state => state.stopTerminal);
  const device = devices.find(item => item.id === route.params.deviceId);
  const deviceOffline = device?.status === 'offline';

  const projects = useMemo(
    () => {
      if (!device) return [];
      return projectsStore
        .filter(
          project =>
            project.deviceId === device.id || device.projectIds.includes(project.id),
        )
        .sort((left, right) =>
          newestFirst(left.lastDeploy, right.lastDeploy),
        );
    },
    [projectsStore, device],
  );
  const sessions = useMemo(
    () => {
      if (!device) return [];
      return vibeRuns
        .filter(session => session.deviceId === device.id)
        .sort(compareSessionsByStableActivity);
    },
    [vibeRuns, device],
  );
  const activeSessions = useMemo(
    () => sessions.filter(session => activeSessionStatuses.includes(session.status)),
    [sessions],
  );
  const recentEvents = useMemo(
    () => events.filter(e => e.deviceId === device?.id).length,
    [events, device?.id],
  );
  const pendingApprovals = useMemo(
    () => approvals.filter(a => a.status === 'pending').length,
    [approvals],
  );
  const scannedRepos = useMemo(
    () => scanResults.filter(r => r.deviceId === device?.id).length,
    [scanResults, device?.id],
  );
  const terminalDirectory =
    device?.authorizedDirectories[0] ?? projects[0]?.path ?? '~';
  // Active remote shells on this device (running / idle / awaiting approval).
  // Closed/stopped/failed sessions are excluded. Tapping one resumes the SAME
  // PTY (DeviceTerminal reuses when terminalId is passed); Close kills it.
  const activeTerminals = useMemo(() => {
    if (!device) return [];
    return terminalSessions
      .filter(
        t =>
          t.deviceId === device.id && isActiveTerminalSessionStatus(t.status),
      )
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  }, [terminalSessions, device]);
  const knownProjectPaths = uniqueStrings(projects.map(project => project.path));
  const toolList = useIncrementalList(device?.tools ?? [], {
    initialCount: 8,
    step: 12,
    resetKey: device?.id ?? 'missing',
  });
  const workspaceList = useIncrementalList(
    [...(device?.history ?? [])].sort((left, right) =>
      newestFirst(left.updated_at, right.updated_at),
    ),
    {
      initialCount: 8,
      step: 12,
      resetKey: device?.id ?? 'missing',
    },
  );
  const directoryList = useIncrementalList(device?.authorizedDirectories ?? [], {
    initialCount: 8,
    step: 12,
    resetKey: device?.id ?? 'missing',
  });
  const projectPathList = useIncrementalList(knownProjectPaths, {
    initialCount: 8,
    step: 12,
    resetKey: device?.id ?? 'missing',
  });
  const projectList = useIncrementalList(projects, {
    initialCount: 5,
    step: 8,
    resetKey: device?.id ?? 'missing',
  });
  const sessionList = useIncrementalList(sessions, {
    initialCount: 6,
    step: 10,
    resetKey: device?.id ?? 'missing',
  });

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Device" subtitle="NOT FOUND" onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={device.name}
        subtitle={device.host}
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <DeferredMount>
        <GlassPanel style={styles.hero}>
          <View style={styles.heroTop}>
            <IconBadge
              name="device"
              tone={device.status === 'offline' ? 'neutral' : 'primary'}
              size={50}
              iconSize={25}
              filled={device.status === 'online'}
            />
            <View style={styles.heroCopy}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {device.os}
              </Text>
              <Text
                style={[
                  theme.typography.titleLg,
                  { color: theme.colors.onSurface },
                  styles.heroTitle,
                ]}>
                {device.location}
              </Text>
            </View>
            <StatusChip
              label={device.status.toUpperCase()}
              type={statusType[device.status]}
            />
          </View>

          <View style={styles.visualMetrics}>
            <RingMeter
              progress={device.cpuLoad}
              label="CPU"
              value={`${device.cpuLoad}%`}
              color={theme.colors.primary}
              size={78}
            />
            <RingMeter
              progress={device.memLoad}
              label="MEM"
              value={`${device.memLoad}%`}
              color={theme.colors.secondary}
              size={78}
            />
            <View style={styles.metricStack}>
              <MiniMetric label="Projects" value={`${projects.length}`} />
              <MiniMetric label="VibeCoding" value={`${sessions.length}`} />
            </View>
          </View>

          <View style={styles.heroMetaRow}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              Last seen {device.lastSeen}
            </Text>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {device.activePorts.length} ports
            </Text>
          </View>
        </GlassPanel>

        <View style={styles.actionGridRow}>
          <ActionGridCard
            icon="agent"
            title="VibeCoding"
            subtitle="Create AI session"
            onPress={() =>
              navigation.navigate('CreateVibeCoding', { deviceId: device.id })
            }
            accent
          />
          <ActionGridCard
            icon="terminal"
            title="Terminal"
            subtitle={device.remoteTerminalEnabled ? 'Remote shell' : 'Disabled'}
            onPress={() =>
              navigation.navigate('DeviceTerminal', {
                deviceId: device.id,
                directory: terminalDirectory,
              })
            }
            disabled={!device.remoteTerminalEnabled}
          />
          <ActionGridCard
            icon="scan"
            title="Scan"
            subtitle={`${scannedRepos} repos found`}
            onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
          />
        </View>
        <View style={styles.actionGridRow}>
          <ActionGridCard
            icon="agent"
            title="Sessions"
            subtitle={`${sessions.length} session${
              sessions.length === 1 ? '' : 's'
            }${activeSessions.length ? ` · ${activeSessions.length} active` : ''}`}
            onPress={() =>
              navigation.navigate('AgentSessions', { deviceId: device.id })
            }
          />
          <ActionGridCard
            icon="event"
            title="Events"
            subtitle={`${recentEvents} events`}
            onPress={() =>
              navigation.navigate('EventStream', { deviceId: device.id })
            }
          />
          <ActionGridCard
            icon="approval"
            title="Approvals"
            subtitle={pendingApprovals > 0 ? `${pendingApprovals} pending` : 'All clear'}
            onPress={() => navigation.navigate('ApprovalCenter')}
            accent={pendingApprovals > 0}
          />
        </View>

        <SectionTitle title="ACTIVE TERMINALS" />
        {activeTerminals.length ? (
          activeTerminals.map(terminal => (
            <TerminalCard
              key={terminal.id}
              terminal={terminal}
              deviceName={device.name}
              disabled={deviceOffline}
              onPress={() =>
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  terminalId: terminal.id,
                  directory: terminal.directory,
                })
              }
              onClose={() => {
                stopTerminal(terminal.id).catch(() => {});
              }}
            />
          ))
        ) : (
          <GlassPanel style={styles.emptyTerminalCard}>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('detail.emptyTerminal')}
            </Text>
          </GlassPanel>
        )}

        <SectionTitle title="PROJECTS ON DEVICE" />
        {projects.length ? (
          <>
          {projectList.visibleItems.map(project => {
            const projectSessions = sessions.filter(
              session => session.projectId === project.id,
            );
            const scan = scanResults.find(
              item =>
                item.projectId === project.id && item.deviceId === device.id,
            );
            return (
              <ProjectWorkspaceCard
                key={project.id}
                project={project}
                device={device}
                sessions={projectSessions}
                scan={scan}
                disabled={deviceOffline}
                onOpen={() =>
                  navigation.navigate('ProjectDetail', {
                    projectId: project.id,
                    deviceId: device.id,
                  })
                }
                onFiles={() =>
                  navigation.navigate('FileBrowser', {
                    projectId: project.id,
                    deviceId: device.id,
                  })
                }
                onTerminal={() =>
                  navigation.navigate('DeviceTerminal', {
                    deviceId: device.id,
                    directory: scan?.path ?? project.path ?? terminalDirectory,
                  })
                }
              />
            );
          })}
          <LoadMoreRow
            visibleCount={projectList.visibleCount}
            totalCount={projectList.totalCount}
            onPress={projectList.showMore}
          />
          </>
        ) : (
          <EmptyPanel
            title="No projects reported"
            body="Run a device scan or wait for the Agent to publish its project list."
            actionTitle="SCAN PROJECTS"
            onAction={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
          />
        )}

        <View style={styles.sessionHeader}>
          <SectionTitle title="VIBECODING SESSIONS" />
          <View style={styles.sessionChips}>
            <StatusChip label={`${sessions.length} TOTAL`} type="info" />
            <StatusChip label={`${activeSessions.length} ACTIVE`} type="success" />
          </View>
        </View>
        {sessions.length ? (
          <>
          {sessionList.visibleItems.map(session => (
            <VibeSessionCard
              key={session.id}
              session={session}
              disabled={deviceOffline}
            />
          ))}
          <LoadMoreRow
            visibleCount={sessionList.visibleCount}
            totalCount={sessionList.totalCount}
            onPress={sessionList.showMore}
          />
          </>
        ) : (
          <EmptyPanel
            title="No VibeCoding sessions"
            body="Create a session from this device to start recording conversation and Agent events."
            actionTitle="CREATE VIBECODING"
            onAction={() =>
              navigation.navigate('CreateVibeCoding', { deviceId: device.id })
            }
          />
        )}

        <CollapsiblePanel
          title="DEVICE DATA"
          icon="device"
          defaultExpanded={false}>
          <Fact label="DEVICE ID" value={device.id} />
          <Fact label="UNIQUE CODE" value={device.uniqueCode ?? '-'} />
          <Fact label="AGENT" value={device.agentVersion ?? '-'} />
          <Fact label="TERMINAL" value={device.remoteTerminalEnabled ? 'enabled' : 'disabled'} />
          <Fact label="AI CONTROL" value={device.aiControlEnabled ? 'enabled' : 'disabled'} />
          <Fact
            label="CAPABILITIES"
            value={device.capabilities.length ? device.capabilities.join(' / ') : '-'}
          />
          <Fact label="CREATED" value={device.createdAt ?? '-'} />
        </CollapsiblePanel>

        <CollapsiblePanel
          title="INSTALLED TOOLS"
          icon="code"
          badge={`${device.tools.length}`}
          badgeType={device.tools.length > 0 ? 'success' : 'info'}
          defaultExpanded={false}>
          {device.tools.length ? (
            <View style={styles.listPanel}>
              {toolList.visibleItems.map((tool, index) => (
                <View key={tool.id}>
                  <View style={styles.toolRow}>
                    <View style={styles.toolMain}>
                      <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                        {tool.name ?? TOOL_LABELS[tool.id] ?? tool.id}
                      </Text>
                      {tool.command ? (
                        <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                          {tool.command}
                        </Text>
                      ) : null}
                      {tool.description ? (
                        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                          {tool.description}
                        </Text>
                      ) : null}
                    </View>
                    <StatusChip
                      label={tool.available === false ? 'MISSING' : 'READY'}
                      type={tool.available === false ? 'error' : 'success'}
                    />
                  </View>
                  {index < toolList.visibleItems.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
              <LoadMoreRow
                visibleCount={toolList.visibleCount}
                totalCount={toolList.totalCount}
                onPress={toolList.showMore}
              />
            </View>
          ) : (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              Waiting for the desktop Agent to probe for installed AI tools.
            </Text>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel
          title="DETECTED WORKSPACES"
          icon="project"
          badge={`${device.history.length}`}
          badgeType={device.history.length > 0 ? 'success' : 'info'}
          defaultExpanded={false}>
          {device.history.length ? (
            <View style={styles.listPanel}>
              {workspaceList.visibleItems.map((entry, index) => (
                <View key={`${entry.tool}:${entry.path}:${index}`}>
                  <View style={styles.workspaceRow}>
                    <View style={styles.workspaceMain}>
                      <View style={styles.workspaceHead}>
                        <StatusChip label={workspaceToolLabel(entry.tool)} type="info" />
                        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                          {entry.file_count ?? 0} files
                          {entry.total_size ? ` · ${formatBytes(entry.total_size)}` : ''}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={2}
                        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                        {entry.path}
                      </Text>
                      {entry.updated_at ? (
                        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                          Updated {entry.updated_at}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {index < workspaceList.visibleItems.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
              <LoadMoreRow
                visibleCount={workspaceList.visibleCount}
                totalCount={workspaceList.totalCount}
                onPress={workspaceList.showMore}
              />
            </View>
          ) : (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              Scan the device or wait for the Agent to publish workspaces.
            </Text>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel
          title="AUTHORIZED DIRECTORIES"
          icon="terminal"
          badge={`${device.authorizedDirectories.length}`}
          defaultExpanded={false}>
          {device.authorizedDirectories.length ? (
            <View style={styles.listPanel}>
              {directoryList.visibleItems.map((directory, index) => (
                <View key={directory}>
                  <View style={styles.directoryRow}>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurface },
                        styles.directoryPath,
                      ]}>
                      {directory}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() =>
                        navigation.navigate('DeviceTerminal', {
                          deviceId: device.id,
                          directory,
                        })
                      }
                      style={[
                        styles.directoryTerminalButton,
                        {
                          borderColor: theme.colors.outlineVariant,
                          borderRadius: theme.borderRadius.full,
                        },
                      ]}>
                      <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                        TERM
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {index < directoryList.visibleItems.length - 1 && (
                    <View style={styles.divider} />
                  )}
                </View>
              ))}
              <LoadMoreRow
                visibleCount={directoryList.visibleCount}
                totalCount={directoryList.totalCount}
                onPress={directoryList.showMore}
              />
            </View>
          ) : (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              Open a device terminal or wait for the Agent to sync workspace paths.
            </Text>
          )}
        </CollapsiblePanel>

        {knownProjectPaths.length ? (
          <CollapsiblePanel
            title="KNOWN PROJECT PATHS"
            icon="project"
            badge={`${knownProjectPaths.length}`}
            defaultExpanded={false}>
            <View style={styles.listPanel}>
              {projectPathList.visibleItems.map((path, index) => (
                <View key={path}>
                  <View style={styles.directoryRow}>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurface },
                        styles.directoryPath,
                      ]}>
                      {path}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() =>
                        navigation.navigate('DeviceTerminal', {
                          deviceId: device.id,
                          directory: path,
                        })
                      }
                      style={[
                        styles.directoryTerminalButton,
                        {
                          borderColor: theme.colors.outlineVariant,
                          borderRadius: theme.borderRadius.full,
                        },
                      ]}>
                      <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                        TERM
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {index < projectPathList.visibleItems.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
              <LoadMoreRow
                visibleCount={projectPathList.visibleCount}
                totalCount={projectPathList.totalCount}
                onPress={projectPathList.showMore}
              />
            </View>
          </CollapsiblePanel>
        ) : null}
        </DeferredMount>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const SectionTitle: React.FC<{ title: string }> = ({ title }) => {
  const { theme } = useTheme();

  return (
    <Text
      style={[
        theme.typography.labelCaps,
        { color: theme.colors.onSurfaceVariant },
        styles.sectionTitle,
      ]}>
      {title}
    </Text>
  );
};

const MiniMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.miniMetric,
        activePanelStyle(isDark, theme.colors.surfaceContainer),
      ]}>
      <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </View>
  );
};

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.fact,
        lowPanelStyle(isDark, theme.colors.surfaceContainerLow),
      ]}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={2}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
};

interface EmptyPanelProps {
  title: string;
  body: string;
  actionTitle?: string;
  onAction?: () => void;
}

const EmptyPanel: React.FC<EmptyPanelProps> = ({
  title,
  body,
  actionTitle,
  onAction,
}) => {
  const { theme } = useTheme();

  return (
    <GlassPanel style={styles.emptyPanel}>
      <IconBadge name="event" tone="neutral" size={38} iconSize={19} />
      <View style={styles.emptyCopy}>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
          {title}
        </Text>
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
          {body}
        </Text>
      </View>
      {actionTitle && onAction ? (
        <GlowButton
          title={actionTitle}
          onPress={onAction}
          variant="outline"
          style={styles.emptyAction}
        />
      ) : null}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 12,
  },
  hero: {
    padding: 14,
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
  },
  heroTitle: {
    marginTop: 4,
  },
  visualMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricStack: {
    flex: 1,
    gap: 8,
  },
  miniMetric: {
    minHeight: 35,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 1,
  },
  heroMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionGridRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  createButton: {
    marginTop: 12,
  },
  secondaryAction: {
    marginTop: 8,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  gridAction: {
    flex: 1,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  factPanel: {
    padding: 10,
    gap: 8,
  },
  fact: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  listPanel: {
    padding: 0,
  },
  directoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  directoryPath: {
    flex: 1,
  },
  directoryTerminalButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  toolMain: {
    flex: 1,
    gap: 2,
  },
  workspaceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  workspaceMain: {
    flex: 1,
    gap: 4,
  },
  workspaceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  emptyTerminalCard: {
    padding: 12,
    marginBottom: 10,
  },
  sessionHeader: {
    marginTop: 2,
  },
  sessionChips: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  emptyPanel: {
    padding: 14,
    gap: 12,
  },
  emptyCopy: {
    gap: 5,
  },
  emptyAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
});
