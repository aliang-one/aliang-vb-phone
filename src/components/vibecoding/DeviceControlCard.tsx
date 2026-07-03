import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Device } from '../../data/platformModels';
import { VoiceTextInput } from './VoiceTextInput';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { RingMeter } from '../visual/RingMeter';
import { useControlCenterStore } from '../../store/controlCenterStore';

interface DeviceControlCardProps {
  device: Device;
  onPress?: () => void;
}

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

type ActionTone = 'default' | 'primary' | 'danger';

export const DeviceControlCard = React.memo<DeviceControlCardProps>(
  ({ device, onPress }) => {
    const { theme, isDark } = useTheme();
    const { t } = useTranslation('vibecoding');
    const renameDevice = useControlCenterStore(s => s.renameDevice);
    const removeDevice = useControlCenterStore(s => s.removeDevice);

    const [menuVisible, setMenuVisible] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [infoVisible, setInfoVisible] = useState(false);

    const openMenu = () => {
      setRenaming(false);
      setConfirmingDelete(false);
      setMenuVisible(true);
    };

    const handleRenameStart = () => {
      setRenameValue(device.name);
      setRenaming(true);
    };
    const handleRenameCancel = () => setRenaming(false);
    const handleRenameSave = async () => {
      const trimmed = renameValue.trim();
      if (!trimmed) return;
      const result = await renameDevice(device.id, trimmed);
      if (result.ok) {
        setRenaming(false);
        setMenuVisible(false);
      }
    };

    const handleConfirmDelete = async () => {
      const result = await removeDevice(device.id);
      if (result.ok) {
        setConfirmingDelete(false);
        setMenuVisible(false);
      }
    };

    const renderMenuAction = (
      label: string,
      onPressAction: () => void,
      tone: ActionTone = 'default',
    ) => {
      const color =
        tone === 'danger'
          ? theme.colors.tertiary
          : tone === 'primary'
          ? theme.colors.primary
          : theme.colors.onSurface;
      return (
        <TouchableOpacity
          key={label}
          style={styles.menuAction}
          activeOpacity={0.7}
          onPress={onPressAction}>
          <Text style={[theme.typography.titleMd, { color }]}>{label}</Text>
        </TouchableOpacity>
      );
    };

    return (
      <>
        <TouchableOpacity
          onPress={onPress}
          onLongPress={openMenu}
          activeOpacity={0.75}
          delayLongPress={350}>
          <GlassPanel
            glowColor={device.status === 'warning' ? 'secondary' : 'none'}
            style={styles.card}>
            <View style={styles.header}>
              <IconBadge
                name="device"
                tone={
                  device.status === 'offline'
                    ? 'neutral'
                    : device.status === 'warning'
                    ? 'tertiary'
                    : 'primary'
                }
                filled={device.status === 'online'}
              />
              <View style={styles.titleBlock}>
                <Text
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
                  numberOfLines={1}>
                  {device.name}
                </Text>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}>
                  {device.host}
                </Text>
              </View>
              <StatusChip label={device.status.toUpperCase()} type={statusType[device.status]} />
            </View>
            <View style={styles.metaRow}>
              <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {device.os}
                </Text>
              </View>
              <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {device.location}
                </Text>
              </View>
            </View>
            <View style={styles.metrics}>
              <RingMeter progress={device.cpuLoad} label="CPU" value={`${device.cpuLoad}%`} color={theme.colors.primary} size={74} />
              <RingMeter progress={device.memLoad} label="MEM" value={`${device.memLoad}%`} color={theme.colors.secondary} size={74} />
              <View style={styles.statStack}>
                <MiniStat icon="project" value={`${device.projectIds.length}`} label="Projects" />
                <MiniStat icon="agent" value={`${device.activeSessionIds.length}`} label="Agents" />
              </View>
            </View>
          </GlassPanel>
        </TouchableOpacity>

        {/* 长按菜单 */}
        <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <View style={styles.modalRoot}>
            <Pressable
              onPress={() => setMenuVisible(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(2,5,8,0.78)' : 'rgba(12,18,28,0.34)' }]}
            />
            <GlassPanel glowColor="primary" style={styles.menuPanel}>
              <View style={styles.menuHeader}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {device.name}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                  {device.host}
                </Text>
              </View>

              {renaming ? (
                <>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('deviceControl.newName')}
                  </Text>
                  <VoiceTextInput
                    value={renameValue}
                    onChangeText={setRenameValue}
                    placeholder={t('deviceControl.renamePlaceholder')}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    maxLength={64}
                    returnKeyType="done"
                    onSubmitEditing={handleRenameSave}
                    testIDPrefix="device-rename"
                  />
                  <View style={styles.actionGrid}>
                    {renderMenuAction(t('deviceControl.cancel'), handleRenameCancel)}
                    {renderMenuAction(t('deviceControl.save'), handleRenameSave, 'primary')}
                  </View>
                </>
              ) : confirmingDelete ? (
                <>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
                    {t('deviceControl.deleteConfirmBody')}
                  </Text>
                  <View style={styles.actionGrid}>
                    {renderMenuAction(t('deviceControl.cancel'), () => setConfirmingDelete(false))}
                    {renderMenuAction(t('deviceControl.confirmDelete'), handleConfirmDelete, 'danger')}
                  </View>
                </>
              ) : (
                <View style={styles.actionGrid}>
                  {renderMenuAction(t('deviceControl.details'), () => {
                    setMenuVisible(false);
                    setInfoVisible(true);
                  })}
                  {renderMenuAction(t('deviceControl.rename'), handleRenameStart)}
                  {renderMenuAction(t('deviceControl.delete'), () => setConfirmingDelete(true), 'danger')}
                </View>
              )}
            </GlassPanel>
          </View>
        </Modal>

        {/* 详细介绍信息卡 */}
        <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
          <View style={styles.modalRoot}>
            <Pressable
              onPress={() => setInfoVisible(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(2,5,8,0.78)' : 'rgba(12,18,28,0.34)' }]}
            />
            <GlassPanel glowColor="primary" style={styles.infoPanel}>
              <View style={styles.menuHeader}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {device.name}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('deviceControl.detailsTitle')}
                </Text>
              </View>
              <ScrollView>
                <InfoRow label={t('deviceControl.fieldHost')} value={device.host} />
                <InfoRow label={t('deviceControl.fieldOs')} value={device.os} />
                <InfoRow label={t('deviceControl.fieldLocation')} value={device.location} />
                <InfoRow label={t('deviceControl.fieldStatus')} value={device.status} />
                <InfoRow label={t('deviceControl.fieldAgentVersion')} value={device.agentVersion ?? '—'} />
                <InfoRow label={t('deviceControl.fieldUniqueCode')} value={device.uniqueCode ?? '—'} />
                <InfoRow label={t('deviceControl.fieldProjectCount')} value={`${device.projectIds.length}`} />
                <InfoRow label={t('deviceControl.fieldAgentCount')} value={`${device.activeSessionIds.length}`} />
                <InfoRow label={t('deviceControl.fieldLastSeen')} value={device.lastSeen} />
                <InfoRow label={t('deviceControl.fieldRemoteTerminal')} value={device.remoteTerminalEnabled ? t('deviceControl.enabled') : t('deviceControl.disabled')} />
                <InfoRow label={t('deviceControl.fieldAiControl')} value={device.aiControlEnabled ? t('deviceControl.enabled') : t('deviceControl.disabled')} />
                <InfoRow label={t('deviceControl.fieldCapabilities')} value={`${device.capabilities.length}`} />
                <InfoRow label={t('deviceControl.fieldTools')} value={`${device.tools.length}`} />
              </ScrollView>
              <View style={styles.actionGrid}>
                {renderMenuAction(t('deviceControl.close'), () => setInfoVisible(false), 'primary')}
              </View>
            </GlassPanel>
          </View>
        </Modal>
      </>
    );
  },
  (prev, next) => prev.device === next.device,
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface, flex: 2 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};

interface MiniStatProps {
  icon: 'project' | 'agent';
  value: string;
  label: string;
}

const MiniStat: React.FC<MiniStatProps> = ({ icon, value, label }) => {
  const { theme, isDark } = useTheme();
  return (
    <View
      style={[
        styles.miniStat,
        { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer },
      ]}>
      <IconBadge name={icon} tone={icon === 'agent' ? 'secondary' : 'primary'} size={30} iconSize={15} />
      <View>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>{value}</Text>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { padding: 12, marginBottom: 10, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  titleBlock: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statStack: { flex: 1, gap: 8 },
  miniStat: { minHeight: 42, borderRadius: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 菜单 / 信息卡
  modalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  menuPanel: { width: '100%', maxWidth: 420, padding: 16, gap: 12 },
  infoPanel: { width: '100%', maxWidth: 460, padding: 16, gap: 10, maxHeight: '80%' },
  menuHeader: { gap: 2 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  menuAction: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  renameInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  infoRow: { flexDirection: 'row', gap: 12, paddingVertical: 4 },
});
