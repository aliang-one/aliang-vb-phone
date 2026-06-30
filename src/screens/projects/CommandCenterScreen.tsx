import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import { ActionTile } from '../../components/visual/ActionTile';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { ProjectWorkspaceCard } from '../../components/cards/ProjectWorkspaceCard';
import { Project, VibeCodingRun } from '../../data/platformModels';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useStableVibeRuns } from '../../store/controlCenterStore';
import { useShallow } from 'zustand/shallow';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import {
  buildDeviceStatusIndex,
  isDeviceStatusOffline,
  offlineLastComparator,
} from '../../utils/deviceStatus';
import {
  ACTIVE_AGENT_WINDOW_MS,
  formatConversationRelativeShort,
  getSessionActivityMs,
  isSessionActiveWithin,
  parseConversationTimestampMs,
} from '../../utils/conversationActivity';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const liveAgentStatuses: VibeCodingRun['status'][] = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

const ratio = (value: number, total: number) =>
  total > 0 ? Math.min(100, (value / total) * 100) : 0;

const HOME_CONVERSATION_EVENT_LIMIT = 3;

// --- Home conversation-events feed ---
// The home "events" surface is conversation-scoped: lifecycle events, approvals,
// and recent per-session activity. Every entry links straight into the conversation.

type ConversationFeedKind =
  | 'created'
  | 'completed'
  | 'in_progress'
  | 'activity'
  | 'approval';

interface ConversationFeedItem {
  key: string;
  kind: ConversationFeedKind;
  title: string;
  subtitle: string;
  timeLabel: string;
  sessionId?: string;
  approvalId?: string;
  ms: number;
}

const feedMeta: Record<
  ConversationFeedKind,
  { icon: IconName; label: string }
> = {
  created: { icon: 'chat', label: '新对话' },
  completed: { icon: 'check', label: '已完成' },
  in_progress: { icon: 'agent', label: '进行中' },
  activity: { icon: 'chat', label: '最近交互' },
  approval: { icon: 'approval', label: '待确认' },
};

const projectMatchesSession = (project: Project, session: VibeCodingRun) =>
  session.projectId === project.id ||
  (Boolean(project.path) &&
    session.directory === project.path &&
    (!project.deviceId || session.deviceId === project.deviceId));

const getProjectActivityMs = (
  project: Project,
  sessions: VibeCodingRun[],
  nowMs: number,
) => {
  const projectTime = parseConversationTimestampMs(project.lastDeploy, nowMs);
  const sessionTime = sessions.reduce((latest, session) => {
    if (!projectMatchesSession(project, session)) return latest;
    return Math.max(latest, getSessionActivityMs(session, nowMs));
  }, 0);
  return Math.max(projectTime, sessionTime);
};

export const CommandCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const previewLinks = useControlCenterStore(state => state.previewLinks);
  const vibeRuns = useStableVibeRuns();
  const notifications = useControlCenterStore(state => state.notifications);
  // Only conversation-lifecycle / approval events drive the home feed. Filtering
  // at the selector (via useShallow) keeps high-frequency agent.delta / terminal
  // events from re-rendering the entire home screen on every token.
  const feedEvents = useControlCenterStore(
    useShallow(state =>
      state.events.filter(
        event =>
          event.type === 'agent.session.started' ||
          event.type === 'agent.session.completed' ||
          event.type === 'approval.requested',
      ),
    ),
  );
  const scanResults = useControlCenterStore(state => state.scanResults);
  const wsConnected = useControlCenterStore(state => state.wsConnected);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const [refreshing, setRefreshing] = useState(false);

  const onlineDevices = useMemo(
    () => devices.filter(device => device.status === 'online'),
    [devices],
  );
  const deviceStatusIndex = useMemo(
    () => buildDeviceStatusIndex(devices),
    [devices],
  );
  const activeAgentRuns = useMemo(
    () => {
      const nowMs = Date.now();
      return vibeRuns
        .filter(session =>
          isSessionActiveWithin(session, ACTIVE_AGENT_WINDOW_MS, nowMs),
        )
        .sort(
          (left, right) =>
            getSessionActivityMs(right, nowMs) -
            getSessionActivityMs(left, nowMs),
        );
    },
    [vibeRuns],
  );
  const recentAgentRuns = useMemo(
    () => {
      const nowMs = Date.now();
      return [...vibeRuns].sort(
        offlineLastComparator(
          deviceStatusIndex,
          session => session.deviceId,
          (left, right) =>
            getSessionActivityMs(right, nowMs) -
            getSessionActivityMs(left, nowMs),
        ),
      );
    },
    [vibeRuns, deviceStatusIndex],
  );
  const activeProjects = useMemo(() => {
    const nowMs = Date.now();
    return [...projects].sort(
      offlineLastComparator(
        deviceStatusIndex,
        project => project.deviceId,
        (left, right) =>
          getProjectActivityMs(right, vibeRuns, nowMs) -
          getProjectActivityMs(left, vibeRuns, nowMs),
      ),
    );
  }, [projects, vibeRuns, deviceStatusIndex]);
  // Filtered home feed: conversation lifecycle, approvals, and recent messages.
  const conversationFeed = useMemo<ConversationFeedItem[]>(() => {
    const nowMs = Date.now();
    const items: ConversationFeedItem[] = [];
    const push = (
      key: string,
      kind: ConversationFeedKind,
      title: string,
      subtitle: string,
      sessionId: string | undefined,
      ms: number,
      approvalId?: string,
    ) => {
      items.push({
        key,
        kind,
        title,
        subtitle,
        sessionId,
        approvalId,
        ms,
        timeLabel: formatConversationRelativeShort(ms, nowMs),
      });
    };
    for (const evt of feedEvents) {
      if (evt.type === 'agent.session.started') {
        push(
          evt.id,
          'created',
          evt.title || '新对话',
          evt.detail,
          evt.sessionId,
          parseConversationTimestampMs(evt.timestamp, nowMs),
        );
      } else if (evt.type === 'agent.session.completed') {
        push(
          evt.id,
          'completed',
          evt.title || '对话完成',
          evt.detail,
          evt.sessionId,
          parseConversationTimestampMs(evt.timestamp, nowMs),
        );
      } else if (evt.type === 'approval.requested') {
        push(
          `approval-${evt.approvalId ?? evt.id}`,
          'approval',
          evt.title || '需要确认',
          evt.detail,
          evt.sessionId,
          parseConversationTimestampMs(evt.timestamp, nowMs),
          evt.approvalId,
        );
      }
    }
    for (const session of activeAgentRuns) {
      const sessionActivityMs = getSessionActivityMs(session, nowMs);
      const sessionTitle = formatVibeSessionTitle(session.title, {
        directory: session.directory,
      });
      const actor =
        session.lastMessage?.role === 'user'
          ? '你'
          : session.lastMessage?.role === 'assistant'
          ? 'AI'
          : '系统';
      const latestActivity = session.lastMessage?.content
        ? `${actor}: ${session.lastMessage.content}`
        : session.currentStep || '最近有交互';
      push(
        `activity-${session.id}-${
          session.lastMessage?.id ?? sessionActivityMs
        }`,
        liveAgentStatuses.includes(session.status) ? 'in_progress' : 'activity',
        sessionTitle,
        latestActivity,
        session.id,
        sessionActivityMs,
      );
    }
    return items.sort((left, right) => right.ms - left.ms).slice(0, 12);
  }, [feedEvents, activeAgentRuns]);
  const visibleConversationFeed = conversationFeed.slice(
    0,
    HOME_CONVERSATION_EVENT_LIMIT,
  );
  const hiddenConversationFeedCount = Math.max(
    0,
    conversationFeed.length - visibleConversationFeed.length,
  );
  const projectWorkspace = useMemo(
    () =>
      [...projects].sort(
        offlineLastComparator(
          deviceStatusIndex,
          project => project.deviceId,
          (left, right) => newestFirst(left.lastDeploy, right.lastDeploy),
        ),
      ),
    [projects, deviceStatusIndex],
  );
  const pendingApprovals = useControlCenterStore(
    useShallow(state =>
      state.approvals.filter(item => item.status === 'pending'),
    ),
  );
  const unreadNotifications = useMemo(
    () => notifications.filter(item => !item.read),
    [notifications],
  );
  const topApproval = pendingApprovals[0];
  const topNotification = unreadNotifications[0];
  const topRealtimeKind = topApproval
    ? 'approval'
    : topNotification
    ? 'notification'
    : undefined;
  const topRealtimeTitle = topApproval?.title ?? topNotification?.title;
  const topRealtimeDetail = topApproval?.summary ?? topNotification?.body;
  const serverStatusLabel = wsConnected
    ? 'Realtime'
    : serverMode
    ? 'API'
    : 'Offline';
  const serverStatusColor = wsConnected
    ? theme.colors.secondary
    : serverMode
    ? theme.colors.primary
    : theme.colors.error;
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
        value: `${unreadNotifications.length}/${
          notifications.length || 0
        } unread`,
        progress: ratio(unreadNotifications.length, notifications.length),
        tone: 'secondary' as const,
      },
    ],
  };

  const getProjectDevice = (project: Project) =>
    devices.find(device => device.id === project.deviceId) ??
    devices.find(device => device.projectIds.includes(project.id));
  // Home cards route by semantic type: approvals go to the global approval queue,
  // conversation activity goes into the matching chat.
  const openConversation = (
    sessionId?: string,
    isApproval = false,
    approvalId?: string,
  ) => {
    if (isApproval) {
      navigation.navigate('ApprovalCenter');
    } else if (sessionId) {
      navigation.navigate('VibeCodingSession', { sessionId, approvalId });
    } else {
      navigation.navigate('NotificationCenter');
    }
  };
  const openConversationEventStream = () => {
    navigation.navigate('EventStream', { scope: 'conversation' });
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
    } finally {
      setRefreshing(false);
    }
  };
  const activeProjectList = useIncrementalList(activeProjects, {
    initialCount: 3,
    step: 6,
    resetKey: activeProjects.length,
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
          <View style={styles.topActions}>
            <ServerStatusCapsule
              label={serverStatusLabel}
              color={serverStatusColor}
              connected={wsConnected}
              apiReachable={serverMode}
              onlineDevices={onlineDevices.length}
              totalDevices={devices.length}
              activeRuns={activeAgentRuns.length}
            />
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => navigation.navigate('NotificationCenter')}
              style={styles.avatar}
            >
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.primary },
                ]}
              >
                {unreadNotifications.length || 'AL'}
              </Text>
            </TouchableOpacity>
          </View>
        }
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        <DeferredMount
          fallback={
            <View style={styles.deferredPlaceholder}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                正在加载首页…
              </Text>
            </View>
          }>
          {topRealtimeKind && topRealtimeTitle ? (
          <TouchableOpacity
            activeOpacity={0.78}
            onPress={() =>
              openConversation(
                topApproval?.sessionId ?? topNotification?.sessionId,
                topRealtimeKind === 'approval',
                topApproval?.id ?? topNotification?.approvalId,
              )
            }
          >
            <GlassPanel style={styles.realtimeCard}>
              <View style={styles.realtimeIconWrap}>
                <IconBadge
                  name={topRealtimeKind === 'approval' ? 'approval' : 'event'}
                  tone={
                    topRealtimeKind === 'approval' ? 'tertiary' : 'secondary'
                  }
                  size={26}
                  iconSize={13}
                />
              </View>
              <View style={styles.realtimeCopy}>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.labelMd,
                    { color: theme.colors.onSurface },
                  ]}
                >
                  {topRealtimeKind === 'approval' ? '待确认' : '新消息'} ·{' '}
                  {topRealtimeTitle}
                  {topRealtimeDetail ? ` · ${topRealtimeDetail}` : ''}
                </Text>
              </View>
              <Text
                style={[
                  theme.typography.codeSm,
                  styles.moreLink,
                  { color: theme.colors.primary },
                ]}
              >
                更多 ›
              </Text>
            </GlassPanel>
          </TouchableOpacity>
        ) : null}
        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
            ]}
          >
            对话事件 / CONVERSATION EVENTS
          </Text>
          <StatusChip label={`${conversationFeed.length} 条`} type="info" />
        </View>
        {conversationFeed.length ? (
          <>
            {visibleConversationFeed.map(item => {
            const meta = feedMeta[item.kind];
            const itemOffline = isDeviceStatusOffline(
              deviceStatusIndex.get(
                vibeRuns.find(run => run.id === item.sessionId)?.deviceId ?? '',
              ),
            );
            const tone =
              item.kind === 'approval'
                ? 'tertiary'
                : item.kind === 'completed'
                ? 'secondary'
                : item.kind === 'activity'
                ? 'secondary'
                : item.kind === 'in_progress'
                ? 'primary'
                : 'primary';
            return (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.75}
                onPress={() =>
                  openConversation(
                    item.sessionId,
                    item.kind === 'approval',
                    item.approvalId,
                  )
                }
              >
                <GlassPanel
                  style={[
                    styles.eventFeedCard,
                    { opacity: itemOffline ? 0.5 : 1 },
                  ]}>
                  <View style={styles.eventFeedIconWrap}>
                    <IconBadge
                      name={meta.icon}
                      tone={tone}
                      size={34}
                      iconSize={17}
                    />
                    {item.timeLabel ? (
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.labelSm,
                          styles.eventFeedTime,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {item.timeLabel}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.eventFeedCopy}>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.titleMd,
                        { color: theme.colors.onSurface },
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.bodySm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {item.subtitle}
                    </Text>
                  </View>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      styles.moreLink,
                      { color: theme.colors.primary },
                    ]}
                  >
                    更多 ›
                  </Text>
                </GlassPanel>
              </TouchableOpacity>
            );
          })}
            {hiddenConversationFeedCount ? (
              <LoadMoreRow
                visibleCount={visibleConversationFeed.length}
                totalCount={conversationFeed.length}
                onPress={openConversationEventStream}
                label="更多对话事件"
              />
            ) : null}
          </>
        ) : (
          <GlassPanel style={styles.emptyAgentCard}>
            <IconBadge name="chat" tone="neutral" size={42} iconSize={21} />
            <View style={styles.emptyAgentCopy}>
              <Text
                style={[
                  theme.typography.titleMd,
                  { color: theme.colors.onSurface },
                ]}
              >
                暂无对话事件
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                新建对话、完成或待确认的操作会显示在这里，点击即可进入对应对话。
              </Text>
            </View>
          </GlassPanel>
        )}

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            AGENT ACTIONS
          </Text>
          <StatusChip
            label={`${onlineDevices.length} DEVICES READY`}
            type="info"
          />
        </View>
        {/* Approvals - 突出显示，占据主要位置 */}
        <TouchableOpacity
          activeOpacity={0.76}
          onPress={() => navigation.navigate('ApprovalCenter')}
          style={styles.approvalsHeroWrap}>
          <GlassPanel
            glowColor={pendingApprovals.length > 0 ? 'error' : 'none'}
            style={[
              styles.approvalsHero,
              {
                borderRadius: theme.borderRadius.lg,
                borderColor: pendingApprovals.length > 0
                  ? theme.colors.error
                  : isDark
                    ? 'rgba(255,255,255,0.08)'
                    : theme.colors.outlineVariant,
              },
            ]}>
            <View style={styles.approvalsHeroTop}>
              <IconBadge
                name="approval"
                tone={pendingApprovals.length > 0 ? 'error' : 'secondary'}
                size={44}
                iconSize={22}
                filled={pendingApprovals.length > 0}
              />
              <View style={styles.approvalsHeroValue}>
                <Text style={[theme.typography.headlineMd, { color: theme.colors.onSurface }]}>
                  {pendingApprovals.length}
                </Text>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
                  PENDING
                </Text>
              </View>
              <View style={styles.approvalsHeroStatus}>
                <StatusChip
                  label={pendingApprovals.length > 0 ? '需要确认' : '无需确认'}
                  type={pendingApprovals.length > 0 ? 'error' : 'success'}
                />
              </View>
            </View>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              Approvals
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              AI 操作需要你的确认才能继续执行
            </Text>
          </GlassPanel>
        </TouchableOpacity>

        {/* Agents + Events + Scan - 紧凑一行 */}
        <View style={styles.actionMiniRow}>
          <ActionTile
            icon="agent"
            label="Sessions"
            value={`${recentAgentRuns.length}`}
            caption={`${activeAgentRuns.length} 活跃`}
            tone={activeAgentRuns.length > 0 ? 'primary' : 'neutral'}
            mini
            onPress={() => navigation.navigate('AgentSessions')}
            style={styles.actionMiniTile}
          />
          <ActionTile
            icon="event"
            label="Events"
            value={`${feedEvents.length}`}
            caption="事件"
            tone="info"
            mini
            onPress={() => navigation.navigate('EventStream')}
            style={styles.actionMiniTile}
          />
          <ActionTile
            icon="scan"
            label="Scan"
            value={`${scanResults.length}`}
            caption="结果"
            tone="secondary"
            mini
            onPress={() => navigation.navigate('DeviceCameraScanner')}
            style={styles.actionMiniTile}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
            ]}
          >
            ACTIVE PROJECTS
          </Text>
          <StatusChip
            label={`${activeProjects.length} PROJECTS`}
            type="success"
          />
        </View>
        {activeProjects.length ? (
          <>
            {activeProjectList.visibleItems.map(project => {
              const sessions = vibeRuns.filter(session =>
                projectMatchesSession(project, session),
              );
              const device = getProjectDevice(project);
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
                  scan={scan}
                  activeProject
                  disabled={device?.status === 'offline'}
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
                      directory:
                        scan?.path ??
                        project.path ??
                        device.authorizedDirectories[0],
                    })
                  }
                />
              );
            })}
            <LoadMoreRow
              visibleCount={activeProjectList.visibleCount}
              totalCount={activeProjectList.totalCount}
              onPress={activeProjectList.showMore}
            />
          </>
        ) : (
          <GlassPanel style={styles.emptyAgentCard}>
            <IconBadge name="project" tone="neutral" size={42} iconSize={21} />
            <View style={styles.emptyAgentCopy}>
              <Text
                style={[
                  theme.typography.titleMd,
                  { color: theme.colors.onSurface },
                ]}
              >
                暂无活跃项目
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                最近有交互的项目会显示在这里。
              </Text>
            </View>
          </GlassPanel>
        )}

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
            ]}
          >
            VIBECODING SESSIONS
          </Text>
          <StatusChip label={`${recentAgentRuns.length} TOTAL`} type="info" />
        </View>
        {recentAgentList.visibleItems.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            disabled={isDeviceStatusOffline(
              deviceStatusIndex.get(session.deviceId),
            )}
          />
        ))}
        <LoadMoreRow
          visibleCount={recentAgentList.visibleCount}
          totalCount={recentAgentList.totalCount}
          onPress={recentAgentList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
            ]}
          >
            RECENT PREVIEWS
          </Text>
        </View>
        {previewList.visibleItems.map(preview => {
          const session = vibeRuns.find(item => item.id === preview.sessionId);
          return (
            <TouchableOpacity
              key={preview.id}
              activeOpacity={0.75}
              onPress={() =>
                navigation.navigate('Preview', { previewId: preview.id })
              }
            >
              <GlassPanel style={styles.previewCard}>
                <View style={styles.previewTop}>
                  <Text
                    style={[
                      theme.typography.titleMd,
                      { color: theme.colors.onSurface },
                    ]}
                    numberOfLines={1}
                  >
                    {formatVibeSessionTitle(
                      session?.title ?? preview.targetUrl,
                      {
                        directory: session?.directory,
                      },
                    )}
                  </Text>
                  <StatusChip label={`${preview.port}`} type="info" />
                </View>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.primary },
                  ]}
                  numberOfLines={1}
                >
                  {preview.shortUrl}
                </Text>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {preview.access.toUpperCase()} / expires in{' '}
                  {preview.expiresIn}
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
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
            ]}
          >
            PROJECT WORKSPACE
          </Text>
          <StatusChip label={`${projects.length} PROJECTS`} type="info" />
        </View>
        {projectList.visibleItems.map(project => {
          const device = getProjectDevice(project);
          const sessions = vibeRuns.filter(
            item => item.projectId === project.id,
          );
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
              scan={scan}
              disabled={device?.status === 'offline'}
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
                  directory:
                    scan?.path ??
                    project.path ??
                    device.authorizedDirectories[0],
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
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            DEVICE SNAPSHOT
          </Text>
        </View>
        {deviceList.visibleItems.map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() =>
              navigation.navigate('DeviceDetail', { deviceId: device.id })
            }
          />
        ))}
        <LoadMoreRow
          visibleCount={deviceList.visibleCount}
          totalCount={deviceList.totalCount}
          onPress={deviceList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            ACCOUNT SNAPSHOT
          </Text>
        </View>
        <UsageSummaryCard summary={platformSummary} />
        </DeferredMount>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface ServerStatusCapsuleProps {
  label: string;
  color: string;
  connected: boolean;
  apiReachable: boolean;
  onlineDevices: number;
  totalDevices: number;
  activeRuns: number;
}

const ServerStatusCapsule: React.FC<ServerStatusCapsuleProps> = ({
  label,
  color,
  connected,
  apiReachable,
  onlineDevices,
  totalDevices,
  activeRuns,
}) => {
  const { theme, isDark } = useTheme();
  const signalLevel = connected ? 3 : apiReachable ? 2 : 1;

  return (
    <View
      accessibilityLabel={`Server ${label}, ${onlineDevices} of ${totalDevices} devices online, ${activeRuns} active sessions`}
      style={[
        styles.serverCapsule,
        {
          borderColor: `${color}66`,
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.06)'
            : theme.colors.surfaceContainerLow,
        },
      ]}
    >
      <View style={styles.serverCapsuleHeader}>
        <View style={[styles.serverStatusOrb, { backgroundColor: color }]} />
        <Text
          numberOfLines={1}
          style={[theme.typography.codeSm, styles.serverStatusText, { color }]}
        >
          {label.toUpperCase()}
        </Text>
        <View style={styles.serverSignal}>
          {[0, 1, 2].map(index => (
            <View
              key={index}
              style={[
                styles.serverSignalBar,
                {
                  height: 5 + index * 3,
                  backgroundColor:
                    index < signalLevel ? color : theme.colors.outlineVariant,
                },
              ]}
            />
          ))}
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={[
          theme.typography.labelSm,
          styles.serverMetaText,
          { color: theme.colors.onSurfaceVariant },
        ]}
      >
        {onlineDevices}/{totalDevices || 0} online · {activeRuns} live
      </Text>
    </View>
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
  deferredPlaceholder: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverCapsule: {
    width: 132,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
    justifyContent: 'center',
    gap: 2,
  },
  serverCapsuleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  serverStatusOrb: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverStatusText: {
    flex: 1,
  },
  serverSignal: {
    width: 20,
    height: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 2,
  },
  serverSignalBar: {
    width: 3,
    borderRadius: 2,
  },
  serverMetaText: {
    fontSize: 10,
  },
  realtimeCard: {
    minHeight: 40,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  realtimeIconWrap: {
    width: 28,
    alignItems: 'center',
  },
  realtimeCopy: {
    flex: 1,
    minWidth: 0,
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
  approvalsHeroWrap: {
    marginTop: 12,
  },
  approvalsHero: {
    minHeight: 116,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  approvalsHeroTop: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  approvalsHeroValue: {
    flex: 1,
    minWidth: 0,
  },
  approvalsHeroStatus: {
    alignItems: 'flex-end',
  },
  actionMiniRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionMiniTile: {
    flex: 1,
    minWidth: 0,
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
  eventFeedCard: {
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  eventFeedIconWrap: {
    width: 44,
    alignItems: 'center',
    gap: 2,
  },
  eventFeedTime: {
    fontSize: 10,
    textAlign: 'center',
  },
  eventFeedCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  moreLink: {
    minWidth: 48,
    flexShrink: 0,
    textAlign: 'right',
  },
});
