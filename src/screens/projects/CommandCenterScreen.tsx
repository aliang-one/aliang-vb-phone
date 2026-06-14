import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import { ActionTile } from '../../components/visual/ActionTile';
import { IconBadge } from '../../components/visual/IconBadge';
import {
  Device,
  Project,
  VibeCodingRun,
} from '../../data/platformModels';
import { RootStackParamList } from '../../app/navigation/types';
import {
  ProjectFileEntry,
  ProjectScanResult,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const liveAgentStatuses: VibeCodingRun['status'][] = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

const getRelativeMinutes = (value: string) => {
  const normalized = value.trim().toLowerCase();

  if (['now', 'just now'].includes(normalized)) {
    return 0;
  }

  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/,
  );

  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];

    if (unit.startsWith('m')) {
      return amount;
    }

    if (unit.startsWith('h')) {
      return amount * 60;
    }

    return amount * 24 * 60;
  }

  const parsed = Date.parse(value);

  if (!Number.isNaN(parsed)) {
    return Math.max(0, (Date.now() - parsed) / 60000);
  }

  return Number.POSITIVE_INFINITY;
};

const ratio = (value: number, total: number) =>
  total > 0 ? Math.min(100, (value / total) * 100) : 0;

export const CommandCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const previewLinks = useControlCenterStore(state => state.previewLinks);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const approvals = useControlCenterStore(state => state.approvals);
  const notifications = useControlCenterStore(state => state.notifications);
  const events = useControlCenterStore(state => state.events);
  const projectFiles = useControlCenterStore(state => state.projectFiles);
  const scanResults = useControlCenterStore(state => state.scanResults);

  const onlineDevices = useMemo(
    () => devices.filter(device => device.status === 'online'),
    [devices],
  );
  const activeAgentRuns = useMemo(
    () =>
      vibeRuns
        .filter(
          session =>
            liveAgentStatuses.includes(session.status) &&
            getRelativeMinutes(session.updatedAt) <= 24 * 60,
        )
        .sort(
          (left, right) =>
            getRelativeMinutes(left.updatedAt) - getRelativeMinutes(right.updatedAt),
        ),
    [vibeRuns],
  );
  const recentAgentRuns = useMemo(
    () =>
      [...vibeRuns].sort((left, right) =>
        newestFirst(left.updatedAt, right.updatedAt),
      ),
    [vibeRuns],
  );
  const projectWorkspace = useMemo(
    () =>
      [...projects].sort((left, right) =>
        newestFirst(left.lastDeploy, right.lastDeploy),
      ),
    [projects],
  );
  const pendingApprovals = useMemo(
    () => approvals.filter(item => item.status === 'pending'),
    [approvals],
  );
  const unreadNotifications = useMemo(
    () => notifications.filter(item => !item.read),
    [notifications],
  );
  const platformSummary = {
    title: 'Platform snapshot',
    headline: `${devices.length} registered devices`,
    statusLabel: `${onlineDevices.length}/${devices.length || 0} ONLINE`,
    primaryMetric: {
      label: 'ONLINE',
      value: `${onlineDevices.length}/${devices.length || 0}`,
      progress: ratio(onlineDevices.length, devices.length),
    },
    secondaryMetric: {
      label: 'ACTIVE',
      value: `${activeAgentRuns.length}`,
      progress: ratio(activeAgentRuns.length, vibeRuns.length),
      tone: 'secondary' as const,
    },
    sideMetric: {
      label: 'APPROVALS',
      value: `${pendingApprovals.length}`,
    },
    meters: [
      {
        label: 'Projects',
        value: `${projects.length} synced`,
        progress: projects.length ? 100 : 0,
      },
      {
        label: 'Notifications',
        value: `${unreadNotifications.length}/${notifications.length || 0} unread`,
        progress: ratio(unreadNotifications.length, notifications.length),
        tone: 'secondary' as const,
      },
    ],
  };

  const getProject = (projectId: string) =>
    projects.find(project => project.id === projectId);
  const getDevice = (deviceId: string) =>
    devices.find(device => device.id === deviceId);
  const getProjectDevice = (project: Project) =>
    devices.find(device => device.id === project.deviceId)
      ?? devices.find(device => device.projectIds.includes(project.id));
  const activeAgentList = useIncrementalList(activeAgentRuns, {
    initialCount: 4,
    step: 6,
    resetKey: activeAgentRuns.length,
  });
  const recentAgentList = useIncrementalList(recentAgentRuns, {
    initialCount: 6,
    step: 8,
    resetKey: recentAgentRuns.length,
  });
  const projectList = useIncrementalList(projectWorkspace, {
    initialCount: 4,
    step: 6,
    resetKey: projectWorkspace.length,
  });
  const previewList = useIncrementalList(previewLinks, {
    initialCount: 3,
    step: 6,
    resetKey: previewLinks.length,
  });
  const deviceList = useIncrementalList(devices, {
    initialCount: 2,
    step: 4,
    resetKey: devices.length,
  });

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Vibe Command"
        subtitle="MOBILE AGENT CONTROL"
        rightAction={
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => navigation.navigate('NotificationCenter')}
            style={styles.avatar}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              {unreadNotifications.length || 'AL'}
            </Text>
          </TouchableOpacity>
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            24H ACTIVE AGENTS
          </Text>
          <StatusChip label={`${activeAgentRuns.length} VIBECODING`} type="success" />
        </View>
        {activeAgentRuns.length ? (
          <>
          {activeAgentList.visibleItems.map(session => (
            <VibeSessionCard
              key={session.id}
              session={session}
              project={getProject(session.projectId)}
              device={getDevice(session.deviceId)}
              homeFocus
              onPress={() =>
                navigation.navigate('VibeCodingSession', { sessionId: session.id })
              }
            />
          ))}
          <LoadMoreRow
            visibleCount={activeAgentList.visibleCount}
            totalCount={activeAgentList.totalCount}
            onPress={activeAgentList.showMore}
          />
          </>
        ) : (
          <GlassPanel style={styles.emptyAgentCard}>
            <IconBadge name="agent" tone="neutral" size={42} iconSize={21} />
            <View style={styles.emptyAgentCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                暂无 24 小时内活跃的 Agent
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                新建一个 VibeCoding，或从设备恢复最近的会话。
              </Text>
            </View>
          </GlassPanel>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            AGENT ACTIONS
          </Text>
          <StatusChip label={`${onlineDevices.length} DEVICES READY`} type="info" />
        </View>
        <View style={styles.operationGrid}>
          <ActionTile
            icon="agent"
            label="Agents"
            value={`${devices.length}`}
            caption="已注册"
            tone="primary"
            compact
            onPress={() => navigation.navigate('AgentSessions')}
            style={styles.operationTileWrap}
          />
          <ActionTile
            icon="approval"
            label="Approvals"
            value={`${pendingApprovals.length}`}
            caption="需要确认"
            tone="tertiary"
            compact
            onPress={() => navigation.navigate('ApprovalCenter')}
            style={styles.operationTileWrap}
          />
          <ActionTile
            icon="event"
            label="Events"
            value={`${events.length}`}
            caption="实时流"
            tone="info"
            compact
            onPress={() => navigation.navigate('EventStream')}
            style={styles.operationTileWrap}
          />
          <ActionTile
            icon="scan"
            label="Scan"
            value="+"
            tone="success"
            caption="扫码设备"
            compact
            onPress={() => navigation.navigate('DeviceCameraScanner')}
            style={styles.operationTileWrap}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            VIBECODING SESSIONS
          </Text>
          <StatusChip label={`${recentAgentRuns.length} TOTAL`} type="info" />
        </View>
        {recentAgentList.visibleItems.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={getProject(session.projectId)}
            device={getDevice(session.deviceId)}
            onPress={() =>
              navigation.navigate('VibeCodingSession', { sessionId: session.id })
            }
          />
        ))}
        <LoadMoreRow
          visibleCount={recentAgentList.visibleCount}
          totalCount={recentAgentList.totalCount}
          onPress={recentAgentList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            RECENT PREVIEWS
          </Text>
        </View>
        {previewList.visibleItems.map(preview => {
          const session = vibeRuns.find(item => item.id === preview.sessionId);
          return (
            <TouchableOpacity
              key={preview.id}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Preview', { previewId: preview.id })}>
              <GlassPanel style={styles.previewCard}>
                <View style={styles.previewTop}>
                  <Text
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
                    numberOfLines={1}>
                    {session?.title ?? preview.targetUrl}
                  </Text>
                  <StatusChip label={`${preview.port}`} type="info" />
                </View>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.primary }]}
                  numberOfLines={1}>
                  {preview.shortUrl}
                </Text>
                <Text
                  style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {preview.access.toUpperCase()} / expires in {preview.expiresIn}
                </Text>
              </GlassPanel>
            </TouchableOpacity>
          );
        })}
        <LoadMoreRow
          visibleCount={previewList.visibleCount}
          totalCount={previewList.totalCount}
          onPress={previewList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            PROJECT WORKSPACE
          </Text>
          <StatusChip label={`${projects.length} PROJECTS`} type="info" />
        </View>
        {projectList.visibleItems.map(project => {
          const device = getProjectDevice(project);
          const sessions = vibeRuns.filter(item => item.projectId === project.id);
          const files = projectFiles.filter(item => item.projectId === project.id);
          const scan = scanResults.find(
            item =>
              item.projectId === project.id &&
              (!device || item.deviceId === device.id),
          );

          return (
            <ProjectWorkspaceCard
              key={project.id}
              project={project}
              device={device}
              sessions={sessions}
              files={files}
              scan={scan}
              onOpen={() =>
                navigation.navigate('ProjectDetail', {
                  projectId: project.id,
                  deviceId: device?.id,
                })
              }
              onFiles={() =>
                navigation.navigate('FileBrowser', {
                  projectId: project.id,
                  deviceId: device?.id,
                })
              }
              onTerminal={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: scan?.path ?? project.path ?? device.authorizedDirectories[0],
                })
              }
              onAgent={() =>
                navigation.navigate('CreateVibeCoding', {
                  deviceId: device?.id,
                  projectId: project.id,
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

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            DEVICE SNAPSHOT
          </Text>
        </View>
        {deviceList.visibleItems.map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
          />
        ))}
        <LoadMoreRow
          visibleCount={deviceList.visibleCount}
          totalCount={deviceList.totalCount}
          onPress={deviceList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            ACCOUNT SNAPSHOT
          </Text>
        </View>
        <UsageSummaryCard summary={platformSummary} />
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => navigation.navigate('CreateVibeCoding', {})}
        style={[
          styles.fab,
          {
            backgroundColor: theme.colors.primary,
            borderRadius: theme.borderRadius.full,
            ...(isDark ? theme.glow.primary : {}),
          },
        ]}>
        <Text style={[theme.typography.headlineMd, { color: theme.colors.onPrimary }]}>
          +
        </Text>
      </TouchableOpacity>
    </SafeAreaWrapper>
  );
};

interface ProjectWorkspaceCardProps {
  project: Project;
  device?: Device;
  sessions: VibeCodingRun[];
  files: ProjectFileEntry[];
  scan?: ProjectScanResult;
  onOpen: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  onAgent: () => void;
}

const ProjectWorkspaceCard = React.memo<ProjectWorkspaceCardProps>(({
  project,
  device,
  sessions,
  files,
  scan,
  onOpen,
  onFiles,
  onTerminal,
  onAgent,
}) => {
  const { theme, isDark } = useTheme();
  const activeSessions = sessions.filter(item =>
    ['running', 'testing', 'waiting_approval', 'preview_ready'].includes(
      item.status,
    ),
  );
  const modifiedFiles = files.filter(item =>
    ['modified', 'added', 'deleted'].includes(item.status),
  );
  const deviceOnline = device?.status === 'online';

  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onOpen}>
      <GlassPanel style={styles.projectWorkspaceCard}>
        <View style={styles.projectTop}>
          <IconBadge name="project" tone="primary" size={44} iconSize={22} />
          <View style={styles.projectCopy}>
            <Text
              numberOfLines={1}
              style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              {project.name}
            </Text>
            <Text
              numberOfLines={1}
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {scan?.path ?? device?.authorizedDirectories[0] ?? project.branch}
            </Text>
          </View>
          <StatusChip
            label={project.status.toUpperCase()}
            type={
              project.status === 'active'
                ? 'success'
                : project.status === 'error'
                ? 'error'
                : 'neutral'
            }
          />
        </View>
        <View
          style={[
            styles.deviceRow,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}>
          <IconBadge
            name="device"
            tone={deviceOnline ? 'secondary' : 'neutral'}
            size={26}
            iconSize={14}
          />
          <Text
            numberOfLines={1}
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
            {device?.name ?? '未绑定设备'} · {device?.os ?? 'unknown'}
          </Text>
          <View
            style={[
              styles.deviceStateDot,
              { backgroundColor: deviceOnline ? theme.colors.secondary : theme.colors.onSurfaceVariant },
            ]}
          />
          <Text
            style={[
              theme.typography.labelSm,
              { color: deviceOnline ? theme.colors.secondary : theme.colors.onSurfaceVariant },
            ]}>
            {deviceOnline ? '在线' : '离线'}
          </Text>
        </View>
        <View style={styles.projectVisualRow}>
          <ProjectMetric icon="code" value={`${files.length}`} label="Files" />
          <ProjectMetric icon="agent" value={`${activeSessions.length}`} label="Agents" />
          <ProjectMetric icon="git" value={`${modifiedFiles.length}`} label="Changed" />
        </View>
        <View style={styles.projectMetaRow}>
          <View
            style={[
              styles.metaPill,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.05)'
                  : theme.colors.surfaceContainer,
              },
            ]}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {project.language}
            </Text>
          </View>
          <View
            style={[
              styles.metaPill,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.05)'
                  : theme.colors.surfaceContainer,
              },
            ]}>
            <Text
              numberOfLines={1}
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {project.branch}
            </Text>
          </View>
        </View>
        <View style={styles.projectActions}>
          <ProjectAction label="Files" icon="code" onPress={onFiles} />
          <ProjectAction label="Term" icon="terminal" onPress={onTerminal} disabled={!device} />
          <ProjectAction label="+ 新对话" icon="plus" onPress={onAgent} emphasize />
        </View>
      </GlassPanel>
    </TouchableOpacity>
  );
}, (prev, next) =>
  prev.project === next.project &&
  prev.device === next.device &&
  prev.sessions === next.sessions &&
  prev.files === next.files &&
  prev.scan === next.scan,
);

interface ProjectMetricProps {
  icon: 'code' | 'agent' | 'git';
  value: string;
  label: string;
}

const ProjectMetric: React.FC<ProjectMetricProps> = ({ icon, value, label }) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.projectMetric,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.05)'
            : theme.colors.surfaceContainer,
        },
      ]}>
      <IconBadge name={icon} tone={icon === 'agent' ? 'secondary' : 'primary'} size={32} iconSize={16} />
      <View>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
          {value}
        </Text>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
          {label}
        </Text>
      </View>
    </View>
  );
};

interface ProjectActionProps {
  icon: 'code' | 'terminal' | 'agent' | 'plus';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  emphasize?: boolean;
}

const ProjectAction: React.FC<ProjectActionProps> = ({
  icon,
  label,
  onPress,
  disabled,
  emphasize = false,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.projectAction,
        {
          borderColor: emphasize ? theme.colors.primary : theme.colors.outlineVariant,
          borderRadius: theme.borderRadius.full,
          backgroundColor: emphasize ? theme.colors.primary : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      <IconBadge
        name={icon}
        tone={emphasize ? 'primary' : 'primary'}
        size={24}
        iconSize={13}
        filled={emphasize}
      />
      <Text
        style={[
          theme.typography.codeSm,
          { color: emphasize ? theme.colors.onPrimary : theme.colors.primary },
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
    paddingBottom: 92,
    paddingTop: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAgentCard: {
    minHeight: 92,
    padding: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyAgentCopy: {
    flex: 1,
    gap: 4,
  },
  operationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  operationTileWrap: {
    width: '48.8%',
  },
  projectWorkspaceCard: {
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  projectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  deviceStateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectCopy: {
    flex: 1,
    gap: 3,
  },
  projectVisualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  projectMetric: {
    flex: 1,
    minHeight: 58,
    borderRadius: 8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metaPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  projectActions: {
    flexDirection: 'row',
    gap: 8,
  },
  projectAction: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewCard: {
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  previewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
