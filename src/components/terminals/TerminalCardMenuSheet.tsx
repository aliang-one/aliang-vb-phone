import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import type { IconName } from '../visual/IconBadge';
import { formatDate } from '../../utils/format';
import { formatActivityLabel } from '../../store/internals';
import { getTerminalStatusChip } from '../../utils/terminalInteraction';
import type { TerminalSession } from '../../store/types';

interface TerminalCardMenuSheetProps {
  open: boolean;
  onClose: () => void;
  terminal: TerminalSession;
  deviceName?: string;
  /** 设备离线时"删除"置灰;扫码/简介与终端存续无关,不受影响。 */
  deleteDisabled?: boolean;
  /** 创建人显示名(当前登录账号);缺省展示 "-"。 */
  createdBy?: string;
  onDelete: () => void;
  onScan: () => void;
}

type MenuView = 'menu' | 'info';

/**
 * 终端卡片的 "⋯" 菜单弹层:删除 / 扫码配对 / 简介。
 * 两个视图共用一个 BottomSheet,点"简介"原地切换到信息页(可返回)。
 * 删除直接回调 onDelete(无二次确认,与原 CLOSE 行为一致);
 * 扫码回调 onScan,由调用方带终端上下文跳 DeviceCameraScanner。
 * BottomSheet 用法参照 WebPairConfirmSheet。
 */
export function TerminalCardMenuSheet({
  open,
  onClose,
  terminal,
  deviceName,
  deleteDisabled = false,
  createdBy,
  onDelete,
  onScan,
}: TerminalCardMenuSheetProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('terminals');
  const [view, setView] = useState<MenuView>('menu');

  // 每次打开都回到菜单首页(上次可能停在简介页)。
  useEffect(() => {
    if (open) setView('menu');
  }, [open]);

  const chip = getTerminalStatusChip(terminal.status);
  const activityMs = Date.parse(terminal.lastCommandAt ?? terminal.updatedAt);

  const menuRows: Array<{
    key: string;
    icon: IconName;
    tone: 'primary' | 'error' | 'neutral';
    label: string;
    hint?: string;
    danger?: boolean;
    disabled?: boolean;
    onPress: () => void;
    testID: string;
  }> = [
    {
      key: 'delete',
      icon: 'trash',
      tone: 'error',
      label: t('menu.delete'),
      hint: deleteDisabled ? t('menu.deleteOffline') : undefined,
      danger: true,
      disabled: deleteDisabled,
      onPress: onDelete,
      testID: 'terminal-menu-delete',
    },
    {
      key: 'scan',
      icon: 'scan',
      tone: 'primary',
      label: t('menu.scan'),
      hint: t('menu.scanHint'),
      onPress: onScan,
      testID: 'terminal-menu-scan',
    },
    {
      key: 'info',
      icon: 'terminal',
      tone: 'neutral',
      label: t('menu.info'),
      onPress: () => setView('info'),
      testID: 'terminal-menu-info',
    },
  ];

  const infoRows: Array<{ label: string; value: string }> = [
    { label: t('info.createdAt'), value: formatDate(terminal.createdAt) },
    { label: t('info.createdBy'), value: createdBy || '-' },
    { label: t('info.device'), value: deviceName || terminal.deviceId },
    { label: t('info.shell'), value: terminal.shell || 'shell' },
    { label: t('info.directory'), value: terminal.directory || '~' },
    { label: t('info.status'), value: chip.label },
    {
      label: t('info.lastActive'),
      value: Number.isNaN(activityMs) ? '-' : formatActivityLabel(activityMs),
    },
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={view === 'menu' ? t('menu.title') : t('info.title')}>
      {view === 'menu' ? (
        <View style={styles.menu}>
          {menuRows.map(row => (
            <TouchableOpacity
              key={row.key}
              activeOpacity={0.7}
              disabled={row.disabled}
              accessibilityRole="button"
              testID={row.testID}
              onPress={row.onPress}
              style={[
                styles.menuRow,
                {
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: theme.colors.surfaceContainer,
                  opacity: row.disabled ? 0.4 : 1,
                },
              ]}>
              <IconBadge name={row.icon} tone={row.tone} size={36} iconSize={18} />
              <View style={styles.menuCopy}>
                <Text
                  style={[
                    theme.typography.bodyMd,
                    { color: row.danger ? theme.colors.error : theme.colors.onSurface },
                  ]}>
                  {row.label}
                </Text>
                {row.hint ? (
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}>
                    {row.hint}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.body}>
          <View
            style={[
              styles.infoCard,
              {
                borderColor: theme.colors.outlineVariant,
                backgroundColor: theme.colors.surfaceContainer,
              },
            ]}>
            {infoRows.map(row => (
              <View key={row.label} style={styles.infoRow}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {row.label}
                </Text>
                {/* flex 收缩 + 换行:目录/账号可能很长(简介要让用户看全),
                    不约束会横向溢出卡片(numberOfLines={1} 救不了无收缩的 Text)。 */}
                <Text
                  style={[
                    theme.typography.bodyMd,
                    { color: theme.colors.onSurface, flex: 1, textAlign: 'right' },
                  ]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
          <GlowButton
            title={t('info.back')}
            variant="outline"
            onPress={() => setView('menu')}
            testID="terminal-menu-back"
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  menu: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  menuCopy: {
    flex: 1,
    gap: 2,
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 14,
  },
  infoCard: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
});
