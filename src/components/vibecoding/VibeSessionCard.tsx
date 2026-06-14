import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Device, Project, VibeCodingRun } from '../../data/platformModels';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from './status';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge } from '../visual/IconBadge';

const formatBudget = (budget: VibeCodingRun['projectBudget']) =>
  budget
    ? `${budget.currencySymbol}${budget.used.toFixed(1)} / ${budget.currencySymbol}${budget.limit}`
    : '';

interface VibeSessionCardProps {
  session: VibeCodingRun;
  project?: Project;
  device?: Device;
  onPress?: () => void;
  homeFocus?: boolean;
}

export const VibeSessionCard = React.memo<VibeSessionCardProps>(({
  session,
  project,
  device,
  onPress,
  homeFocus = false,
}) => {
  const { theme, isDark } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const [hidden, setHidden] = useState(false);
  const pauseAgentSession = useControlCenterStore(state => state.pauseAgentSession);
  const resumeAgentSession = useControlCenterStore(state => state.resumeAgentSession);
  const deleteAgentSession = useControlCenterStore(state => state.deleteAgentSession);
  const budgetLabel = formatBudget(session.projectBudget);
  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );
  const statusColor =
    session.status === 'waiting_approval'
      ? theme.colors.tertiary
      : session.status === 'failed'
      ? theme.colors.error
      : session.status === 'completed'
      ? theme.colors.secondary
      : session.status === 'paused'
      ? theme.colors.onSurfaceVariant
      : theme.colors.primary;

  if (hidden) {
    return null;
  }

  const handleReport = () => {
    setNotice(`汇报：${vibeStatusLabel[session.status]} / ${session.currentStep}`);
  };

  const handleRefresh = () => {
    setNotice('刷新请求已发送，等待设备同步最新状态。');
  };

  const handlePauseToggle = () => {
    if (session.status === 'paused') {
      resumeAgentSession(session.id);
      setNotice('已请求恢复运行。');
      return;
    }

    pauseAgentSession(session.id);
    setNotice('已请求暂停该 VibeCoding。');
  };

  const handleDelete = () => {
    setMenuVisible(false);
    deleteAgentSession(session.id);
    setHidden(true);
  };

  const renderInfoRow = (label: string, value: string) => (
    <View style={styles.infoRow}>
      <Text style={[theme.typography.labelCaps, styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, styles.infoValue, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );

  const renderMenuAction = (
    label: string,
    onAction: () => void,
    variant: 'primary' | 'secondary' | 'danger' = 'secondary',
  ) => (
    <TouchableOpacity
      activeOpacity={0.76}
      onPress={onAction}
      style={[
        styles.menuAction,
        {
          borderRadius: theme.borderRadius.md,
          borderColor:
            variant === 'danger' ? theme.colors.error : theme.colors.outlineVariant,
          backgroundColor:
            variant === 'primary'
              ? theme.colors.primary
              : variant === 'danger'
              ? isDark
                ? 'rgba(255, 107, 107, 0.12)'
                : 'rgba(186, 26, 26, 0.08)'
              : isDark
              ? 'rgba(255, 255, 255, 0.05)'
              : theme.colors.surfaceContainer,
        },
      ]}>
      <Text
        style={[
          theme.typography.labelMd,
          styles.menuActionText,
          {
            color:
              variant === 'primary'
                ? theme.colors.onPrimary
                : variant === 'danger'
                ? theme.colors.error
                : theme.colors.primary,
          },
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <TouchableOpacity
        onPress={onPress}
        onLongPress={() => {
          setNotice('');
          setDetailsVisible(false);
          setMenuVisible(true);
        }}
        delayLongPress={360}
        activeOpacity={0.75}>
        <GlassPanel
          glowColor={
            session.status === 'waiting_approval'
              ? 'secondary'
              : session.status === 'failed'
              ? 'error'
              : 'none'
          }
          style={[styles.card, homeFocus ? styles.homeCard : null]}>
          <View style={styles.header}>
            <View style={[styles.statusRail, { backgroundColor: statusColor }]} />
            <IconBadge
              name={session.status === 'waiting_approval' ? 'approval' : 'agent'}
              tone={
                session.status === 'waiting_approval'
                  ? 'tertiary'
                  : session.status === 'failed'
                  ? 'error'
                  : 'primary'
              }
              size={42}
              iconSize={21}
            />
            <View style={styles.titleBlock}>
              <Text
                style={[
                  homeFocus ? theme.typography.titleLg : theme.typography.titleMd,
                  { color: theme.colors.onSurface },
                ]}
                numberOfLines={1}>
                {session.title}
              </Text>
              {homeFocus ? (
                <View style={styles.lastActiveRow}>
                  <View
                    style={[
                      styles.activeDot,
                      {
                        backgroundColor:
                          session.status === 'paused'
                            ? theme.colors.onSurfaceVariant
                            : statusColor,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}>
                    上次激活 {session.updatedAt}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}>
                  {project?.name ?? session.projectId} / {device?.name ?? session.deviceId}
                </Text>
              )}
            </View>
            <StatusChip
              label={vibeStatusLabel[session.status]}
              type={vibeStatusType[session.status]}
            />
          </View>
          {homeFocus ? (
            <View
              style={[
                styles.homeTaskPanel,
                {
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.05)'
                    : theme.colors.surfaceContainer,
                },
              ]}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                当前任务
              </Text>
              <Text
                style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}
                numberOfLines={2}>
                {session.currentStep}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.visualRow}>
                <View
                  style={[
                    styles.visualPill,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.05)'
                        : theme.colors.surfaceContainer,
                    },
                  ]}>
                  <IconBadge name="git" tone="neutral" size={26} iconSize={14} />
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {session.branch}
                  </Text>
                </View>
                <View
                  style={[
                    styles.visualPill,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.05)'
                      : theme.colors.surfaceContainer,
                    },
                  ]}>
                  <IconBadge name="play" tone="primary" size={26} iconSize={14} />
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {session.elapsedMinutes}m / {session.timeLimitMinutes}m
                  </Text>
                </View>
                {session.projectBudget ? (
                  <View
                    style={[
                      styles.visualPill,
                      {
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.05)'
                          : theme.colors.surfaceContainer,
                      },
                    ]}>
                    <IconBadge name="quota" tone="secondary" size={26} iconSize={14} />
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}>
                      {budgetLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={2}>
                {session.currentStep}
              </Text>
            </>
          )}
          {homeFocus ? (
            <View style={styles.homeProgressBlock}>
              <ProgressBar progress={progress} color={theme.colors.primary} />
            </View>
          ) : (
            <View style={styles.progressBlock}>
              <View style={styles.progressMeta}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  Runtime
                </Text>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {session.elapsedMinutes}m / {session.timeLimitMinutes}m
                </Text>
              </View>
              <ProgressBar progress={progress} color={theme.colors.primary} />
            </View>
          )}
          {homeFocus ? (
            <View style={styles.homeFooter}>
              <View style={styles.homeMetaCluster}>
                <IconBadge name="git" tone="neutral" size={24} iconSize={13} />
                <Text
                  numberOfLines={1}
                  style={[theme.typography.labelSm, styles.homeMetaText, { color: theme.colors.onSurfaceVariant }]}>
                  {project?.name ?? session.projectId} · {session.branch}
                </Text>
              </View>
              {session.projectBudget ? (
                <View style={styles.budgetHint}>
                  <IconBadge name="quota" tone="secondary" size={22} iconSize={12} />
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.labelSm, { color: theme.colors.secondary }]}>
                    {budgetLabel}
                  </Text>
                </View>
              ) : null}
              <View style={styles.serverHint}>
                <IconBadge name="device" tone="neutral" size={22} iconSize={12} />
                <Text
                  numberOfLines={1}
                  style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {device?.name ?? session.deviceId}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.footer}>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {session.model}
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {session.updatedAt}
              </Text>
            </View>
          )}
        </GlassPanel>
      </TouchableOpacity>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            onPress={() => setMenuVisible(false)}
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(2, 5, 8, 0.78)'
                  : 'rgba(12, 18, 28, 0.34)',
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(0, 209, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.2)',
              },
            ]}
          />
          <GlassPanel glowColor="primary" style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <View style={styles.menuTitleBlock}>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  VIBECODING
                </Text>
                <Text
                  numberOfLines={2}
                  style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                  {session.title}
                </Text>
              </View>
              <StatusChip
                label={vibeStatusLabel[session.status]}
                type={vibeStatusType[session.status]}
              />
            </View>
            <View style={styles.summaryPanel}>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {project?.name ?? session.projectId} / {device?.name ?? session.deviceId}
              </Text>
              <Text
                numberOfLines={2}
                style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
                {session.currentStep}
              </Text>
            </View>
            <View style={styles.reportButtonWrap}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleReport}
                style={[
                  styles.reportButton,
                  {
                    backgroundColor: theme.colors.primary,
                    ...(isDark ? theme.glow.primary : {}),
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.titleMd,
                    styles.reportButtonText,
                    { color: theme.colors.onPrimary },
                  ]}>
                  汇报
                </Text>
              </TouchableOpacity>
            </View>
            {notice ? (
              <Text style={[theme.typography.bodySm, styles.noticeText, { color: theme.colors.tertiary }]}>
                {notice}
              </Text>
            ) : null}
            <View style={styles.actionStack}>
              <View style={styles.actionGrid}>
                {renderMenuAction('刷新', handleRefresh)}
                {renderMenuAction('删除', handleDelete, 'danger')}
              </View>
              <View style={styles.actionGrid}>
                {renderMenuAction(detailsVisible ? '收起' : '更多', () =>
                  setDetailsVisible(current => !current),
                )}
                {renderMenuAction('关闭', () => setMenuVisible(false))}
              </View>
            </View>
            {detailsVisible ? (
              <View style={styles.morePanel}>
                {renderInfoRow('DIRECTORY', session.directory)}
                {renderInfoRow('BRANCH', session.branch)}
                {renderInfoRow('MODEL', session.model)}
                {session.projectBudget
                  ? renderInfoRow('BUDGET', budgetLabel)
                  : null}
                {renderInfoRow('TIME', `${session.elapsedMinutes}m / ${session.timeLimitMinutes}m`)}
                {renderInfoRow('RISK', session.risk.toUpperCase())}
                {renderMenuAction(session.status === 'paused' ? '恢复运行' : '暂停运行', handlePauseToggle)}
              </View>
            ) : null}
          </GlassPanel>
        </View>
      </Modal>
    </>
  );
}, (prev, next) =>
  prev.session === next.session &&
  prev.project === next.project &&
  prev.device === next.device &&
  prev.homeFocus === next.homeFocus,
);

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  homeCard: {
    padding: 14,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  statusRail: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 3,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  lastActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 18,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  homeTaskPanel: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  visualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  visualPill: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  progressBlock: {
    gap: 6,
  },
  homeProgressBlock: {
    opacity: 0.74,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeMetaCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeMetaText: {
    flex: 1,
  },
  budgetHint: {
    maxWidth: '32%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    opacity: 0.82,
  },
  serverHint: {
    maxWidth: '34%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    opacity: 0.68,
  },
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  menuPanel: {
    width: '100%',
    maxWidth: 420,
    padding: 14,
    gap: 12,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  menuTitleBlock: {
    flex: 1,
    gap: 5,
  },
  summaryPanel: {
    gap: 7,
  },
  reportButtonWrap: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  reportButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportButtonText: {
    fontWeight: '700',
  },
  morePanel: {
    gap: 8,
    paddingTop: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {
    width: 76,
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
  },
  noticeText: {
    paddingTop: 2,
  },
  actionStack: {
    gap: 8,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  menuAction: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuActionText: {
    fontWeight: '700',
  },
});
