import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Device, Project, VibeCodingRun } from '../../data/platformModels';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from './status';
import { VoiceTextInput } from './VoiceTextInput';
import {
  useControlCenterStore,
  useDevice,
  useProject,
} from '../../store/controlCenterStore';
import { formatActivityLabel } from '../../store/internals';
import { useNowTick } from '../../hooks/useNowTick';
import { IconBadge } from '../visual/IconBadge';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import { providerLabel } from '../../utils/modelIntensity';

const formatBudget = (budget: VibeCodingRun['projectBudget']) =>
  budget
    ? `${budget.currencySymbol}${budget.used.toFixed(1)} / ${
        budget.currencySymbol
      }${budget.limit}`
    : '';

// Long-press a session card to open its action menu (rename / delete /
// terminate, with a latest-question preview). Flip to `false` to disable.
const SESSION_LONG_PRESS_MENU_ENABLED = true;

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
    const { t } = useTranslation('vibecoding');
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
    const [notice, setNotice] = useState('');
    const [hidden, setHidden] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const deleteAgentSession = useControlCenterStore(
      state => state.deleteAgentSession,
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
    // Latest user question for the long-press menu preview. Prefer a just-sent
    // user lastMessage (live, before the derived field catches up), then the
    // mapped lastUserMessage, then the objective, so the preview is never empty
    // even for transcript-less list snapshots.
    const lastQuestionText =
      (session.lastMessage?.role === 'user'
        ? session.lastMessage.content
        : '') ||
      session.lastUserMessage?.content ||
      session.objective ||
      session.currentStep ||
      t('sessionCard.noQuestion');
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

    const handleDelete = async () => {
      // Optimistically close the menu + hide the card so the list feels
      // responsive; restore both only if the server rejects the delete.
      setMenuVisible(false);
      setHidden(true);
      try {
        await deleteAgentSession(session.id);
      } catch {
        setHidden(false);
        setMenuVisible(true);
        setNotice(t('sessionCard.deleteFailed'));
      }
    };

    const handleCopyUuid = () => {
      const uuid = session.sourceSessionId;
      if (!uuid) return;
      Clipboard.setString(uuid);
      setNotice(t('sessionCard.copiedId'));
    };

    const handleRenameStart = () => {
      setRenameValue(session.title || displayTitle);
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
        setNotice(t('sessionCard.titleEmpty'));
        return;
      }
      if (trimmed === (session.title || displayTitle)) {
        setRenaming(false);
        setNotice('');
        return;
      }
      setNotice(t('sessionCard.renaming'));
      try {
        // PATCH /api/ai/sessions/:id (title) → server stores, publishes to
        // phone, and emits ai.session.rename to the agent. See server index.ts.
        await updateAgentSession(session.id, { title: trimmed });
        setNotice(t('sessionCard.renamed'));
        setRenaming(false);
      } catch {
        setNotice(t('sessionCard.renameFailed'));
      }
    };

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
          onLongPress={
            SESSION_LONG_PRESS_MENU_ENABLED
              ? () => {
                  setNotice('');
                  setRenaming(false);
                  setMenuVisible(true);
                }
              : undefined
          }
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
                      {t('sessionCard.lastActive', { label: activityLabel })}
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
                    {disabled ? t('sessionCard.deviceOffline') : ''}
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
                  {t('sessionCard.currentTask')}
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
                        {t('sessionCard.renameTitle')}
                      </Text>
                      <VoiceTextInput
                        value={renameValue}
                        onChangeText={setRenameValue}
                        sessionId={session.id}
                        projectPath={session.directory ?? project?.path}
                        placeholder={t('sessionCard.renamePlaceholder')}
                        placeholderTextColor={theme.colors.onSurfaceVariant}
                        maxLength={200}
                        returnKeyType="done"
                        onSubmitEditing={handleRenameSave}
                        testIDPrefix="rename"
                      />
                    </>
                  ) : (
                    <>
                      <View style={styles.menuLabelRow}>
                        <View
                          style={[
                            styles.menuStatusDot,
                            { backgroundColor: statusColor },
                          ]}
                        />
                        <Text
                          style={[
                            theme.typography.labelCaps,
                            { color: theme.colors.primary },
                          ]}
                        >
                          VIBECODING
                        </Text>
                      </View>
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
                <View
                  style={[
                    styles.questionPanel,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.05)'
                        : theme.colors.surfaceContainer,
                      borderLeftColor: statusColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {t('sessionCard.latestQuestion')}
                  </Text>
                  <Text
                    numberOfLines={3}
                    style={[
                      theme.typography.bodyMd,
                      styles.questionText,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    {lastQuestionText}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.codeSm,
                      styles.menuMetaText,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {project?.name ?? session.projectId} ·{' '}
                    {device?.name ?? session.deviceId} · {activityLabel}
                  </Text>
                </View>
              )}
              {renaming || !session.sourceSessionId ? null : (
                <View
                  style={[
                    styles.uuidRow,
                    {
                      borderColor: theme.colors.outlineVariant,
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.04)'
                        : theme.colors.surfaceContainer,
                    },
                  ]}
                >
                  <View style={styles.uuidInfo}>
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {t('sessionCard.sessionIdLabel', { provider: session.provider ? providerLabel(session.provider) : 'Agent' })}
                    </Text>
                    <Text
                      numberOfLines={1}
                      selectable
                      style={[
                        theme.typography.codeSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {session.sourceSessionId}
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.76}
                    onPress={handleCopyUuid}
                    style={[
                      styles.copyBtn,
                      { borderColor: theme.colors.outlineVariant },
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.primary },
                      ]}
                    >
                      {t('sessionCard.copy')}
                    </Text>
                  </TouchableOpacity>
                </View>
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
                  {renderMenuAction(t('sessionCard.cancel'), handleRenameCancel)}
                  {renderMenuAction(t('sessionCard.save'), handleRenameSave, 'primary')}
                </View>
              ) : (
                <View style={styles.actionGrid}>
                  {renderMenuAction(t('sessionCard.rename'), handleRenameStart)}
                  {renderMenuAction(t('sessionCard.delete'), handleDelete, 'danger')}
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
  menuLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  menuStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  questionPanel: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderLeftWidth: 3,
  },
  questionText: {
    fontStyle: 'italic',
  },
  menuMetaText: {
    paddingTop: 2,
    opacity: 0.8,
  },
  uuidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  uuidInfo: {
    flex: 1,
    gap: 3,
  },
  copyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  noticeText: {
    paddingTop: 2,
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
