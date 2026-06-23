import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Device, Project, VibeCodingRun } from '../../data/platformModels';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from './status';
import {
  useControlCenterStore,
  useDevice,
  useProject,
} from '../../store/controlCenterStore';
import { formatActivityLabel } from '../../store/internals';
import { useNowTick } from '../../hooks/useNowTick';
import { IconBadge } from '../visual/IconBadge';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';

const formatBudget = (budget: VibeCodingRun['projectBudget']) =>
  budget
    ? `${budget.currencySymbol}${budget.used.toFixed(1)} / ${
        budget.currencySymbol
      }${budget.limit}`
    : '';

interface VibeSessionCardProps {
  session: VibeCodingRun;
  project?: Project;
  device?: Device;
  onPress?: () => void;
  homeFocus?: boolean;
  /** 设备离线时置灰并禁用点击/长按菜单。 */
  disabled?: boolean;
}

export const VibeSessionCard = React.memo<VibeSessionCardProps>(
  ({
    session,
    project: projectProp,
    device: deviceProp,
    onPress,
    homeFocus = false,
    disabled = false,
  }) => {
    const { theme, isDark } = useTheme();
    const navigation = useNavigation();
    // Self-sufficient: derive project/device from the store so parent list
    // screens don't pass inline `.find()` results (a fresh reference each
    // render would defeat this React.memo during streaming). The optional
    // props still override for callers that already hold a stable value.
    const projectFromStore = useProject(session.projectId);
    const deviceFromStore = useDevice(session.deviceId);
    const project = projectProp ?? projectFromStore;
    const device = deviceProp ?? deviceFromStore;
    // Default press opens this session's conversation. Parents no longer pass
    // an inline onPress closure (also a fresh reference each render → memo
    // defeat); `onPress` is kept as an optional override.
    const handlePress = () => {
      if (onPress) {
        onPress();
      } else {
        navigation.navigate('VibeCodingSession', { sessionId: session.id });
      }
    };
    const [menuVisible, setMenuVisible] = useState(false);
    const [detailsVisible, setDetailsVisible] = useState(false);
    const [notice, setNotice] = useState('');
    const [hidden, setHidden] = useState(false);
    // Two-tap confirm guard for the destructive 结束 (terminate) action.
    const [confirmTerminate, setConfirmTerminate] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const deleteAgentSession = useControlCenterStore(
      state => state.deleteAgentSession,
    );
    const terminateAgentSession = useControlCenterStore(
      state => state.terminateAgentSession,
    );
    const updateAgentSession = useControlCenterStore(
      state => state.updateAgentSession,
    );
    // Re-render on a shared 30s cadence so the relative "上次激活" label below
    // stays fresh instead of freezing at the value from when activity happened.
    useNowTick();
    const activityLabel = formatActivityLabel(session.lastActivityMs ?? 0);
    const budgetLabel = formatBudget(session.projectBudget);
    const displayTitle = formatVibeSessionTitle(session.title, {
      directory: session.directory,
      projectName: project?.name,
    });
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
      setNotice(
        `汇报：${vibeStatusLabel[session.status]} / ${session.currentStep}`,
      );
    };

    const handleDelete = () => {
      setMenuVisible(false);
      deleteAgentSession(session.id);
      setHidden(true);
    };

    // Terminate the running agent (sends ai.stop terminate). First tap arms a
    // confirm; the second tap fires it. Unlike delete the session record stays
    // (just flips to closed), so we don't hide the card.
    const handleTerminate = () => {
      if (!confirmTerminate) {
        setConfirmTerminate(true);
        setNotice('再次点击「确认结束」以终止该会话。');
        return;
      }
      setConfirmTerminate(false);
      setMenuVisible(false);
      void terminateAgentSession(session.id).catch(() => {
        setNotice('结束失败，设备可能离线。');
      });
    };

    const handleRenameStart = () => {
      setRenameValue(session.title || displayTitle);
      setDetailsVisible(false);
      setConfirmTerminate(false);
      setNotice('');
      setRenaming(true);
    };

    const handleRenameCancel = () => {
      setRenaming(false);
      setNotice('');
    };

    const handleRenameSave = async () => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setNotice('标题不能为空。');
        return;
      }
      if (trimmed === (session.title || displayTitle)) {
        setRenaming(false);
        setNotice('');
        return;
      }
      setNotice('正在重命名…');
      try {
        // PATCH /api/ai/sessions/:id (title) → server stores, publishes to
        // phone, and emits ai.session.rename to the agent. See server index.ts.
        await updateAgentSession(session.id, { title: trimmed });
        setNotice('已重命名');
        setRenaming(false);
      } catch {
        setNotice('重命名失败，请重试。');
      }
    };

    const renderInfoRow = (label: string, value: string) => (
      <View style={styles.infoRow}>
        <Text
          style={[
            theme.typography.labelCaps,
            styles.infoLabel,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            theme.typography.codeSm,
            styles.infoValue,
            { color: theme.colors.onSurface },
          ]}
        >
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
              variant === 'danger'
                ? theme.colors.error
                : theme.colors.outlineVariant,
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
        ]}
      >
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
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );

    return (
      <>
        <TouchableOpacity
          onPress={handlePress}
          onLongPress={() => {
            setNotice('');
            setConfirmTerminate(false);
            setDetailsVisible(false);
            setRenaming(false);
            setMenuVisible(true);
          }}
          delayLongPress={360}
          activeOpacity={0.75}
          disabled={disabled}
          style={{ opacity: disabled ? 0.5 : 1 }}
        >
          <GlassPanel
            glowColor={
              session.status === 'waiting_approval'
                ? 'secondary'
                : session.status === 'failed'
                ? 'error'
                : 'none'
            }
            style={[styles.card, homeFocus ? styles.homeCard : null]}
          >
            <View style={styles.header}>
              <View
                style={[styles.statusRail, { backgroundColor: statusColor }]}
              />
              <IconBadge
                name={
                  session.status === 'waiting_approval' ? 'approval' : 'agent'
                }
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
                    homeFocus
                      ? theme.typography.titleLg
                      : theme.typography.titleMd,
                    { color: theme.colors.onSurface },
                  ]}
                  numberOfLines={1}
                >
                  {displayTitle}
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
                      numberOfLines={1}
                    >
                      上次激活 {activityLabel}
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}
                  >
                    {project?.name ?? session.projectId} /{' '}
                    {device?.name ?? session.deviceId}
                    {disabled ? ' · 设备离线' : ''}
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
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.primary },
                  ]}
                >
                  当前任务
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurface },
                  ]}
                  numberOfLines={2}
                >
                  {session.currentStep}
                </Text>
              </View>
            ) : (
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
                numberOfLines={1}
              >
                {session.currentStep}
              </Text>
            )}
            {homeFocus ? (
              <View style={styles.homeFooter}>
                <View style={styles.homeMetaCluster}>
                  <IconBadge
                    name="git"
                    tone="neutral"
                    size={24}
                    iconSize={13}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelSm,
                      styles.homeMetaText,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {project?.name ?? session.projectId} · {session.branch}
                  </Text>
                </View>
                {session.projectBudget ? (
                  <View style={styles.budgetHint}>
                    <IconBadge
                      name="quota"
                      tone="secondary"
                      size={22}
                      iconSize={12}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.secondary },
                      ]}
                    >
                      {budgetLabel}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.serverHint}>
                  <IconBadge
                    name="device"
                    tone="neutral"
                    size={22}
                    iconSize={12}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {device?.name ?? session.deviceId}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.colors.outlineVariant },
                  ]}
                />
                <View style={styles.metaRow}>
                  <View style={styles.metaCluster}>
                    <IconBadge
                      name="git"
                      tone="neutral"
                      size={20}
                      iconSize={11}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {session.branch}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {session.model}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {activityLabel}
                  </Text>
                </View>
              </>
            )}
          </GlassPanel>
        </TouchableOpacity>

        <Modal
          visible={menuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
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
                    ? 'rgba(86, 156, 214, 0.05)'
                    : 'rgba(255, 255, 255, 0.2)',
                },
              ]}
            />
            <GlassPanel glowColor="primary" style={styles.menuPanel}>
              <View style={styles.menuHeader}>
                <View style={styles.menuTitleBlock}>
                  {renaming ? (
                    <>
                      <Text
                        style={[
                          theme.typography.labelCaps,
                          { color: theme.colors.primary },
                        ]}
                      >
                        重命名
                      </Text>
                      <TextInput
                        value={renameValue}
                        onChangeText={setRenameValue}
                        placeholder="输入新的会话标题"
                        placeholderTextColor={theme.colors.onSurfaceVariant}
                        autoFocus
                        selectTextOnFocus
                        maxLength={200}
                        returnKeyType="done"
                        onSubmitEditing={handleRenameSave}
                        style={[
                          theme.typography.titleLg,
                          styles.renameInput,
                          {
                            color: theme.colors.onSurface,
                            borderColor: theme.colors.outlineVariant,
                          },
                        ]}
                      />
                    </>
                  ) : (
                    <>
                      <Text
                        style={[
                          theme.typography.labelCaps,
                          { color: theme.colors.primary },
                        ]}
                      >
                        VIBECODING
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[
                          theme.typography.titleLg,
                          { color: theme.colors.onSurface },
                        ]}
                      >
                        {displayTitle}
                      </Text>
                    </>
                  )}
                </View>
                {renaming ? null : (
                  <StatusChip
                    label={vibeStatusLabel[session.status]}
                    type={vibeStatusType[session.status]}
                  />
                )}
              </View>
              {renaming ? null : (
                <>
                  <View style={styles.summaryPanel}>
                    <Text
                      numberOfLines={1}
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {project?.name ?? session.projectId} /{' '}
                      {device?.name ?? session.deviceId}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        theme.typography.bodySm,
                        { color: theme.colors.onSurface },
                      ]}
                    >
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
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.titleMd,
                          styles.reportButtonText,
                          { color: theme.colors.onPrimary },
                        ]}
                      >
                        汇报
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
              {notice ? (
                <Text
                  style={[
                    theme.typography.bodySm,
                    styles.noticeText,
                    { color: theme.colors.tertiary },
                  ]}
                >
                  {notice}
                </Text>
              ) : null}
              {renaming ? (
                <View style={styles.actionGrid}>
                  {renderMenuAction('取消', handleRenameCancel)}
                  {renderMenuAction('保存', handleRenameSave, 'primary')}
                </View>
              ) : (
                <View style={styles.actionStack}>
                  <View style={styles.actionGrid}>
                    {renderMenuAction('重命名', handleRenameStart)}
                    {renderMenuAction(
                      detailsVisible ? '收起' : '更多',
                      () => setDetailsVisible(current => !current),
                    )}
                  </View>
                  {detailsVisible ? (
                    <View style={styles.morePanel}>
                      <View style={styles.fullTitleBlock}>
                        <Text
                          style={[
                            theme.typography.labelCaps,
                            { color: theme.colors.onSurfaceVariant },
                          ]}
                        >
                          完整标题
                        </Text>
                        <Text
                          style={[
                            theme.typography.bodySm,
                            { color: theme.colors.onSurface },
                          ]}
                        >
                          {session.title || displayTitle}
                        </Text>
                      </View>
                      {renderInfoRow('DIRECTORY', session.directory)}
                      {renderInfoRow('BRANCH', session.branch)}
                      {renderInfoRow('MODEL', session.model)}
                      {session.projectBudget
                        ? renderInfoRow('BUDGET', budgetLabel)
                        : null}
                      {renderInfoRow('RISK', session.risk.toUpperCase())}
                    </View>
                  ) : null}
                  <View style={styles.actionGrid}>
                    {renderMenuAction(
                      confirmTerminate ? '确认结束' : '结束',
                      handleTerminate,
                      'danger',
                    )}
                    {renderMenuAction('删除', handleDelete, 'danger')}
                  </View>
                </View>
              )}
            </GlassPanel>
          </View>
        </Modal>
      </>
    );
  },
  (prev, next) =>
    prev.session === next.session &&
    prev.project === next.project &&
    prev.device === next.device &&
    prev.homeFocus === next.homeFocus &&
    prev.disabled === next.disabled,
);

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    gap: 9,
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
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  metaCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
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
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  fullTitleBlock: {
    gap: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.18)',
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
