import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  StyleSheet,
  ScrollView,
  View,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { ProjectActionTile } from '../../components/shared/ProjectActionTile';
import { IconBadge } from '../../components/visual/IconBadge';
import { Logo } from '../../components/visual/Logo';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useRecentActiveTerminalSessionId,
} from '../../store/controlCenterStore';
import { useToastStore } from '../../store/toastStore';
import { useProjectSessions } from '../../hooks/useProjectSessions';
import { useProjectPortMappings } from '../../hooks/useProjectPortMappings';
import { refreshFeedback } from '../../utils/refreshFeedback';
import { useTranslation } from 'react-i18next';

// How many recent sessions the project page previews; the full history lives
// behind the "view all" entry (→ AgentSessions, project-scoped).
const PROJECT_SESSION_PREVIEW_COUNT = 5;

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ProjectRoute = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ProjectRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    devices.find(item => item.id === route.params.deviceId) ||
    devices.find(item => project?.deviceId && item.id === project.deviceId) ||
    devices.find(item => item.projectIds.includes(route.params.projectId));
  const terminalDirectory =
    project?.path || device?.authorizedDirectories[0] || '~';
  // attach 优先：带上设备当前 active 终端，进屏即恢复而非另开新会话。
  const activeTerminalId = useRecentActiveTerminalSessionId(device?.id);
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const show = useToastStore(s => s.show);
  // Project-scoped preview. The global vibeRuns store is capped
  // (MAX_VIBE_RUNS), so the project page fetches its own list directly; only
  // the newest PROJECT_SESSION_PREVIEW_COUNT are shown here, with a "view all"
  // entry into the full project-scoped list (AgentSessions). See
  // hooks/useProjectSessions.
  const { sessions, totalCount, loading, reload } = useProjectSessions(
    project?.id,
    {
      limit: PROJECT_SESSION_PREVIEW_COUNT,
    },
  );
  // Hero "ports" metric only reads the active count here — the full list and
  // its management live on the ProjectPorts page the cell navigates to.
  const { activeCount: activePortCount, reload: reloadPorts } =
    useProjectPortMappings(project?.id);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [result] = await Promise.all([
        refreshFromServer(),
        reload(),
        reloadPorts(),
      ]);
      const feedback = refreshFeedback(result, t);
      show(feedback.message, feedback.type);
    } finally {
      setRefreshing(false);
    }
  }, [refreshFromServer, reload, reloadPorts, show, t]);

  // Returning from the ProjectPorts page (native stack keeps this screen
  // mounted) must reflect mappings created/revoked there: refetch the ports
  // count on focus. The FIRST focus per project id is skipped — the hook's own
  // mount effect already fetched — and a changed projectId naturally resets
  // the marker (the hook refetches for the new id via its own effect).
  const focusedPortsProjectRef = useRef<string | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      const projectId = project?.id;
      if (!projectId) return;
      if (focusedPortsProjectRef.current === projectId) {
        reloadPorts();
      } else {
        focusedPortsProjectRef.current = projectId;
      }
    }, [project?.id, reloadPorts]),
  );

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Project" subtitle={t('projectDetail.notFoundSubtitle')} onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  // Hero accent rail tracks project health — teal when active, red on error,
  // blue for idle — echoing the status rails on the session cards below.
  const railColor =
    project.status === 'active'
      ? theme.colors.secondary
      : project.status === 'error'
      ? theme.colors.error
      : theme.colors.primary;

  // Ports cell: "N 公网" (active public mappings) on top, the agent-detected
  // port count as a second dim line when present; falls back to the detected
  // count alone, then "none". The whole cell opens the ProjectPorts page.
  const forwardedLabel =
    activePortCount > 0
      ? `${activePortCount} ${t('projectDetail.metric.forwarded')}`
      : null;
  const detectedCountLabel =
    project.detectedPorts.length > 0
      ? `${project.detectedPorts.length}`
      : null;
  const portsValue = forwardedLabel ?? detectedCountLabel ?? t('projectDetail.metric.none');
  const portsSecondLine = forwardedLabel
    ? detectedCountLabel ?? undefined
    : undefined;
  const approvalSchemeLabel =
    project.approvalScheme === 'allow_all'
      ? t('projectSettings.scheme.allowAll')
      : project.approvalScheme === 'custom'
      ? t('projectSettings.scheme.custom')
      : t('projectSettings.scheme.balanced');
  const heroSettingsEntryStyle = [
    styles.heroSettingsEntry,
    {
      borderRadius: theme.borderRadius.md,
      borderColor: isDark
        ? 'rgba(255,255,255,0.08)'
        : theme.colors.outlineVariant,
      backgroundColor: isDark
        ? 'rgba(255,255,255,0.04)'
        : theme.colors.surfaceContainerLow,
    },
  ];

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={project.name}
        subtitle={device?.name ?? t('projectDetail.projectDetailSubtitle')}
        onBack={navigation.goBack}
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
        {/* ── HERO · project spec sheet ─────────────────────────────── */}
        <GlassPanel style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={[styles.heroRail, { backgroundColor: railColor }]} />
            <View style={styles.heroBody}>
              <View style={styles.heroHead}>
                <View style={styles.heroHeadLeft}>
                  <IconBadge name="code" tone="primary" size={40} iconSize={20} />
                  <View
                    style={[
                      styles.langChip,
                      {
                        backgroundColor: isDark
                          ? `${theme.colors.primary}1F`
                          : `${theme.colors.primary}14`,
                        borderColor: `${theme.colors.primary}55`,
                      },
                    ]}>
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        { color: theme.colors.primary },
                      ]}>
                      {project.language}
                    </Text>
                  </View>
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

              <Text
                style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {project.branch}
              </Text>
              {project.description ? (
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={3}>
                  {project.description}
                </Text>
              ) : null}

              <View style={styles.metricGrid}>
                <View style={styles.metricRow}>
                  <MetricCell label={t('projectDetail.metric.path')} value={project.path || '—'} mono />
                  <MetricCell label={t('projectDetail.metric.device')} value={device?.name || t('projectDetail.metric.noDevice')} />
                </View>
                <View style={styles.metricRow}>
                  <MetricCell
                    label={t('projectDetail.metric.lastActive')}
                    value={project.lastDeploy || t('projectDetail.metric.unknown')}
                  />
                  <MetricCell
                    label={t('projectDetail.metric.ports')}
                    value={portsValue}
                    secondLine={portsSecondLine}
                    mono
                    testID="project-ports-entry"
                    onPress={() =>
                      navigation.navigate('ProjectPorts', {
                        projectId: project.id,
                        deviceId: device?.id,
                      })
                    }
                  />
                </View>
              </View>

              <TouchableOpacity
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel={t('projectDetail.openSettings')}
                testID="project-settings-entry"
                onPress={() =>
                  navigation.navigate('ProjectSettings', {
                    projectId: project.id,
                    deviceId: device?.id,
                  })
                }
                style={heroSettingsEntryStyle}>
                <View style={styles.heroSettingsLeft}>
                  <IconBadge name="settings" tone="neutral" size={32} iconSize={16} />
                  <View style={styles.heroSettingsCopy}>
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.onSurface },
                      ]}>
                      {t('projectDetail.settingsEntryTitle')}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.bodySm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}>
                      {t('projectDetail.approvalPrefix')} {approvalSchemeLabel}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.heroSettingsArrow, { color: theme.colors.primary }]}>
                  →
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </GlassPanel>

        {/* ── PRIMARY CTA · launch a vibe coding session ────────────── */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('CreateVibeCoding', {
              projectId: project.id,
              deviceId: device?.id,
            })
          }
          style={[
            styles.cta,
            { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.lg },
            isDark ? theme.glow.primary : null,
          ]}>
          <View style={styles.ctaContent}>
            <Text style={[styles.ctaPlus, { color: theme.colors.onPrimary }]}>
              +
            </Text>
            <View style={styles.ctaTextBlock}>
              <Text
                style={[
                  theme.typography.labelMd,
                  styles.ctaTitle,
                  { color: theme.colors.onPrimary },
                ]}>
                {t('projectDetail.createVibeCoding')}
              </Text>
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: theme.colors.onPrimary, opacity: 0.82 },
                ]}>
                {t('projectDetail.createSubtitle')}
              </Text>
            </View>
          </View>
          <Text style={[styles.ctaArrow, { color: theme.colors.onPrimary }]}>
            →
          </Text>
        </TouchableOpacity>

        {/* ── QUICK ACTIONS · command grid ──────────────────────────── */}
        <SectionLabel label={t('projectDetail.quickActions')} />
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <ProjectActionTile
              icon="code"
              title={t('projectDetail.filesAction')}
              subtitle={t('projectDetail.filesSubtitle')}
              tone="primary"
              onPress={() =>
                navigation.navigate('FileBrowser', {
                  projectId: project.id,
                  deviceId: device?.id,
                })
              }
            />
            <ProjectActionTile
              icon="terminal"
              title={t('projectDetail.terminalAction')}
              subtitle={t('projectDetail.terminalSubtitle')}
              tone="secondary"
              disabled={!device || !device.remoteTerminalEnabled}
              onPress={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: terminalDirectory,
                  terminalId: activeTerminalId,
                })
              }
            />
          </View>
        </View>

        {/* ── HISTORY ───────────────────────────────────────────────── */}
        <SectionLabel label={t('projectDetail.vibeHistory')} count={totalCount} />
        {sessions.length ? (
          <>
            {sessions.map(session => (
              <VibeSessionCard
                key={session.id}
                session={session}
              />
            ))}
            {totalCount > sessions.length ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() =>
                  navigation.navigate('AgentSessions', {
                    deviceId: device?.id,
                    projectId: project.id,
                  })
                }
                style={[
                  styles.viewAllRow,
                  {
                    borderRadius: theme.borderRadius.md,
                    borderColor: theme.colors.outlineVariant,
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.03)'
                      : theme.colors.surfaceContainerLow,
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.primary },
                  ]}>
                  {t('projectDetail.viewAllSessions', { count: totalCount })}
                </Text>
                <Text
                  style={[styles.viewAllArrow, { color: theme.colors.primary }]}>
                  →
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : loading ? (
          <GlassPanel style={styles.emptyPanel}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text
              style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('projectDetail.loadingHistory')}
            </Text>
          </GlassPanel>
        ) : (
          <GlassPanel style={styles.emptyPanel}>
            <Logo size={48} />
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              {t('projectDetail.emptyHistoryTitle')}
            </Text>
            <Text
              style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('projectDetail.emptyHistoryBody')}
            </Text>
          </GlassPanel>
        )}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

// Small labelled cell used inside the hero metric grid — gives the project
// meta (path / device / last active / ports) a structured "spec sheet" read
// instead of two floating code lines. An optional `secondLine` renders a dim
// smaller line under the value (ports: "N 公网" over the detected count), and
// `onPress` makes the whole cell tappable (arrow cue, hero-settings style).
const MetricCell: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  secondLine?: string;
  onPress?: () => void;
  testID?: string;
}> = ({ label, value, mono = false, secondLine, onPress, testID }) => {
  const { theme, isDark } = useTheme();
  const cell = (
    <View
      style={[
        styles.metricCell,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.04)'
            : theme.colors.surfaceContainer,
          borderColor: isDark
            ? 'rgba(255,255,255,0.06)'
            : theme.colors.outlineVariant,
          borderRadius: theme.borderRadius.md,
        },
      ]}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
        ]}>
        {label}
      </Text>
      <View style={styles.metricValueRow}>
        <Text
          numberOfLines={1}
          style={[
            mono ? theme.typography.codeSm : theme.typography.labelSm,
            { color: theme.colors.onSurface },
            styles.metricValue,
          ]}>
          {value}
        </Text>
        {onPress ? (
          <Text style={[styles.metricArrow, { color: theme.colors.primary }]}>
            →
          </Text>
        ) : null}
      </View>
      {secondLine ? (
        <Text
          numberOfLines={1}
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurfaceVariant },
          ]}>
          {secondLine}
        </Text>
      ) : null}
    </View>
  );
  if (!onPress) return cell;
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={styles.metricCellTouchable}>
      {cell}
    </TouchableOpacity>
  );
};

// Section divider with an optional count chip — frames the quick-action grid
// and the history list so neither reads as "dumped" onto the page.
const SectionLabel: React.FC<{
  label: string;
  count?: number;
}> = ({ label, count }) => {
  const { theme, isDark } = useTheme();
  return (
    <View style={styles.sectionLabel}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
        ]}>
        {label}
      </Text>
      {count !== undefined ? (
        <View
          style={[
            styles.countChip,
            {
              backgroundColor: isDark
                ? `${theme.colors.primary}1F`
                : `${theme.colors.primary}14`,
              borderColor: `${theme.colors.primary}55`,
            },
          ]}>
          <Text
            style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
            {count}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.sectionDivider,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.07)'
              : theme.colors.outlineVariant,
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    paddingTop: 12,
  },
  hero: {
    padding: 0,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: 'row',
  },
  heroRail: {
    width: 5,
    alignSelf: 'stretch',
  },
  heroBody: {
    flex: 1,
    padding: 14,
    gap: 9,
  },
  heroHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langChip: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  metricGrid: {
    marginTop: 4,
    gap: 8,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCell: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metricCellTouchable: {
    flex: 1,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    flexShrink: 1,
  },
  metricArrow: {
    fontSize: 14,
    fontWeight: '700',
  },
  heroSettingsEntry: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroSettingsLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  heroSettingsCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  heroSettingsArrow: {
    fontSize: 18,
    fontWeight: '700',
  },
  cta: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ctaPlus: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 28,
  },
  ctaTextBlock: {
    gap: 1,
  },
  ctaTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  ctaArrow: {
    fontSize: 20,
    fontWeight: '600',
    opacity: 0.85,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 10,
  },
  countChip: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionDivider: {
    flex: 1,
    height: 1,
  },
  grid: {
    gap: 8,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emptyPanel: {
    padding: 18,
    gap: 8,
    alignItems: 'center',
  },
  viewAllRow: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  viewAllArrow: {
    fontSize: 18,
    fontWeight: '600',
  },
});
