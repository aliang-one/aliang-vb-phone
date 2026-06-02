import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Device, Project, VibeCodingRun } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from './status';

interface VibeSessionCardProps {
  session: VibeCodingRun;
  project?: Project;
  device?: Device;
  onPress?: () => void;
}

export const VibeSessionCard: React.FC<VibeSessionCardProps> = ({
  session,
  project,
  device,
  onPress,
}) => {
  const { theme, isDark } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const [hidden, setHidden] = useState(false);
  const [localStatus, setLocalStatus] = useState(session.status);
  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  if (hidden) {
    return null;
  }

  const handleReport = () => {
    setNotice(`汇报：${vibeStatusLabel[localStatus]} / ${session.currentStep}`);
  };

  const handleRefresh = () => {
    setNotice('刷新请求已发送，等待设备同步最新状态。');
  };

  const handlePauseToggle = () => {
    const nextStatus = localStatus === 'paused' ? 'running' : 'paused';

    setLocalStatus(nextStatus);
    setNotice(nextStatus === 'paused' ? '已请求暂停该 VibeCoding。' : '已请求恢复运行。');
  };

  const handleDelete = () => {
    setMenuVisible(false);
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
            localStatus === 'waiting_approval'
              ? 'secondary'
              : localStatus === 'failed'
              ? 'error'
              : 'none'
          }
          style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text
                style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
                numberOfLines={1}>
                {session.title}
              </Text>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {project?.name ?? session.projectId} / {device?.name ?? session.deviceId}
              </Text>
            </View>
            <StatusChip
              label={vibeStatusLabel[localStatus]}
              type={vibeStatusType[localStatus]}
            />
          </View>
          <Text
            style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={2}>
            {session.currentStep}
          </Text>
          <View style={styles.progressBlock}>
            <View style={styles.progressMeta}>
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                ${session.budgetUsed.toFixed(2)} / ${session.budgetLimit}
              </Text>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {session.elapsedMinutes}m / {session.timeLimitMinutes}m
              </Text>
            </View>
            <ProgressBar progress={progress} color={theme.colors.primary} />
          </View>
          <View style={styles.footer}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {session.branch}
            </Text>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {session.updatedAt}
            </Text>
          </View>
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
                label={vibeStatusLabel[localStatus]}
                type={vibeStatusType[localStatus]}
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
                {renderInfoRow('BUDGET', `$${session.budgetUsed.toFixed(2)} / $${session.budgetLimit}`)}
                {renderInfoRow('TIME', `${session.elapsedMinutes}m / ${session.timeLimitMinutes}m`)}
                {renderInfoRow('RISK', session.risk.toUpperCase())}
                {renderMenuAction(localStatus === 'paused' ? '恢复运行' : '暂停运行', handlePauseToggle)}
              </View>
            ) : null}
          </GlassPanel>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  progressBlock: {
    gap: 6,
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
