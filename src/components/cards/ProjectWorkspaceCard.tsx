import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { Device, Project, VibeCodingRun } from '../../data/platformModels';
import { ProjectScanResult } from '../../store/types';
import { useTranslation } from 'react-i18next';

interface ProjectWorkspaceCardProps {
  project: Project;
  device?: Device;
  sessions: VibeCodingRun[];
  scan?: ProjectScanResult;
  onOpen: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  activeProject?: boolean;
  /** 设备离线时整张卡片置灰并禁用点击与子动作。 */
  disabled?: boolean;
}

// Shared project card used by both the home Command Center and the Device
// Detail screen so the project surface looks and behaves identically everywhere.
export const ProjectWorkspaceCard = React.memo<ProjectWorkspaceCardProps>(
  ({
    project,
    device,
    sessions,
    scan,
    onOpen,
    onFiles,
    onTerminal,
    activeProject = false,
    disabled = false,
  }) => {
    const { theme, isDark } = useTheme();
    const { t } = useTranslation('common');
    const activeSessions = sessions.filter(item =>
      ['running', 'testing', 'waiting_approval', 'preview_ready'].includes(
        item.status,
      ),
    );
    // Project-level live metrics (agent-driven): the agent reports the project's
    // tracked file count (Files) and git working-tree change count (Changed) on
    // every ~1/min inventory snapshot, so the card reflects the real current
    // project state — independent of whether a vibe run is active. Agents stays
    // the count of active sessions for this project.
    const fileCount = project.fileCount ?? 0;
    const gitChanged = project.gitChangedCount ?? 0;
    const deviceOnline = device?.status === 'online';
    // Files/Agents/Changed metrics + language/branch pills are collapsed by
    // default; the toggle below reveals them. The whole card still routes to
    // the project detail page on tap.
    const [expanded, setExpanded] = useState(false);

    if (activeProject) {
      return (
        <TouchableOpacity
          activeOpacity={0.78}
          onPress={onOpen}
          disabled={disabled}
          style={{ opacity: disabled ? 0.5 : 1 }}
        >
          <GlassPanel style={styles.activeProjectCard}>
            <IconBadge name="project" tone="primary" size={38} iconSize={19} />
            <View style={styles.activeProjectCopy}>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.titleMd,
                  { color: theme.colors.onSurface },
                ]}
              >
                {project.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {scan?.path ?? project.path ?? project.branch}
              </Text>
              <View style={styles.activeProjectMeta}>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('workspaceCard.sessionsCount', { count: sessions.length })}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('workspaceCard.changedCount', { count: gitChanged })}
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
          </GlassPanel>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={0.78}
        onPress={onOpen}
        disabled={disabled}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <GlassPanel style={styles.projectWorkspaceCard}>
          <View style={styles.projectTop}>
            <IconBadge name="project" tone="primary" size={38} iconSize={19} />
            <View style={styles.projectCopy}>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.titleMd,
                  { color: theme.colors.onSurface },
                ]}
              >
                {project.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {scan?.path ??
                  device?.authorizedDirectories[0] ??
                  project.branch}
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
            <TouchableOpacity
              activeOpacity={0.5}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
              onPress={() => setExpanded(value => !value)}
            >
              <IconBadge
                name="chevron"
                tone="neutral"
                size={26}
                iconSize={13}
                style={{
                  transform: [{ rotate: expanded ? '180deg' : '0deg' }],
                }}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.deviceLine}>
            <IconBadge
              name="device"
              tone={deviceOnline ? 'secondary' : 'neutral'}
              size={20}
              iconSize={11}
            />
            <Text
              numberOfLines={1}
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant, flex: 1 },
              ]}
            >
              {device?.name ?? t('workspaceCard.unboundDevice')} · {device?.os ?? t('workspaceCard.unknownOs')}
            </Text>
            <View
              style={[
                styles.deviceStateDot,
                {
                  backgroundColor: deviceOnline
                    ? theme.colors.secondary
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            />
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color: deviceOnline
                    ? theme.colors.secondary
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {deviceOnline ? t('workspaceCard.statusOnline') : t('workspaceCard.statusOffline')}
            </Text>
          </View>
          {expanded ? (
            <>
              <View style={styles.projectVisualRow}>
                <ProjectMetric
                  icon="code"
                  value={`${fileCount}`}
                  label={t('workspaceCard.metricFiles')}
                />
                <ProjectMetric
                  icon="agent"
                  value={`${activeSessions.length}`}
                  label={t('workspaceCard.metricAgents')}
                />
                <ProjectMetric
                  icon="git"
                  value={`${gitChanged}`}
                  label={t('workspaceCard.metricChanged')}
                />
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
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
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
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {project.branch}
                  </Text>
                </View>
              </View>
            </>
          ) : null}
          <View style={styles.projectActions}>
            <ProjectAction
              label={t('workspaceCard.actionFiles')}
              icon="code"
              onPress={onFiles}
              disabled={disabled}
            />
            <ProjectAction
              label={t('workspaceCard.actionTerm')}
              icon="terminal"
              onPress={onTerminal}
              disabled={!device || disabled}
            />
          </View>
        </GlassPanel>
      </TouchableOpacity>
    );
  },
  (prev, next) =>
    prev.project === next.project &&
    prev.device === next.device &&
    prev.sessions === next.sessions &&
    prev.scan === next.scan &&
    prev.activeProject === next.activeProject &&
    prev.disabled === next.disabled,
);

interface ProjectMetricProps {
  icon: 'code' | 'agent' | 'git';
  value: string;
  label: string;
}

const ProjectMetric: React.FC<ProjectMetricProps> = ({
  icon,
  value,
  label,
}) => {
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
      ]}
    >
      <IconBadge
        name={icon}
        tone={icon === 'agent' ? 'secondary' : 'primary'}
        size={32}
        iconSize={16}
      />
      <View>
        <Text
          style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
        >
          {value}
        </Text>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
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
          borderColor: emphasize
            ? theme.colors.primary
            : theme.colors.outlineVariant,
          borderRadius: theme.borderRadius.full,
          backgroundColor: emphasize ? theme.colors.primary : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
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
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  projectWorkspaceCard: {
    padding: 12,
    marginBottom: 8,
    gap: 9,
  },
  activeProjectCard: {
    minHeight: 70,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activeProjectCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  activeProjectMeta: {
    flexDirection: 'row',
    gap: 10,
  },
  projectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deviceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceStateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectCopy: {
    flex: 1,
    gap: 2,
  },
  projectVisualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  projectMetric: {
    flex: 1,
    minHeight: 48,
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
});
