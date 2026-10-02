import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { TERMINAL_WEB_PAIR_HOST } from '../../api/terminalWebPair';

// 终端网页扫码配对的确认弹窗(Task 11,规格 2026-10-01-terminal-web-qr-pairing
// §6):DeviceCameraScannerScreen 以 mode='terminalWebPair' 进入并扫到
// `https://terminal.aliang.one/pair#pid&s` 后弹出,展示将授权的设备/目录/网页
// 域名;允许 → approveTerminalWebPair(由扫码屏执行),拒绝 → 本地 reset
// (无服务端调用,pending pairing 由服务端 TTL 过期自清理)。
// BottomSheet 用法参照 ApprovalQuickPolicySheet。

export function WebPairConfirmSheet({
  visible,
  deviceName,
  directory,
  host = TERMINAL_WEB_PAIR_HOST,
  working,
  onAllow,
  onDeny,
}: {
  visible: boolean;
  /** 目标设备显示名;缺省时由调用方回落(如 deviceId)。 */
  deviceName?: string;
  /** 终端当前工作目录。 */
  directory?: string;
  /** 网页域名,默认 terminal.aliang.one。 */
  host?: string;
  /** 批准请求在途:允许/拒绝按钮均禁用,点 scrim/关闭不再触发拒绝
   *(进行中的 approve 可能已在服务端完成,此时"拒绝"会误导用户以为撤销了授权)。 */
  working: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('devices');

  const rows: Array<{ label: string; value: string }> = [
    { label: t('webPair.device'), value: deviceName || '-' },
    { label: t('webPair.directory'), value: directory || '-' },
    { label: t('webPair.domain'), value: host },
  ];

  return (
    <BottomSheet
      open={visible}
      onClose={working ? () => undefined : onDeny}
      title={t('webPair.confirmTitle')}>
      <View style={styles.body}>
        <View
          style={[
            styles.infoCard,
            {
              borderColor: theme.colors.outlineVariant,
              borderRadius: theme.borderRadius.md,
              backgroundColor: theme.colors.surfaceContainer,
            },
          ]}>
          {rows.map(row => (
            <View key={row.label} style={styles.infoRow}>
              <Text
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {row.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.actionRow}>
          <GlowButton
            title={t('webPair.allow')}
            onPress={onAllow}
            variant="primary"
            loading={working}
            disabled={working}
            testID="web-pair-allow"
            style={styles.actionButton}
          />
          <GlowButton
            title={t('webPair.deny')}
            onPress={onDeny}
            variant="outline"
            disabled={working}
            testID="web-pair-deny"
            style={styles.actionButton}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
});
