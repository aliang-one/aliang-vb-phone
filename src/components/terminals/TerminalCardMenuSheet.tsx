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
import { useNowTick } from '../../hooks/useNowTick';
import type { TerminalSession } from '../../store/types';

interface TerminalCardMenuSheetProps {
  open: boolean;
  onClose: () => void;
  terminal: TerminalSession;
  deviceName?: string;
  /** 设备离线时"删除/续期"置灰;扫码/简介与终端存续无关,不受影响。 */
  deleteDisabled?: boolean;
  /** 创建人显示名(当前登录账号);缺省展示 "-"。 */
  createdBy?: string;
  onDelete: () => void;
  onScan: () => void;
  /** 续期(有效期):新窗口 = now + hours(服务端上限 24h)。缺省隐藏续期按钮。 */
  onRenew?: (hours: number) => Promise<void>;
}

type MenuView = 'menu' | 'info';

const RENEW_CHOICES = [1, 6, 24] as const;

/** 会话是否还活着(有效期/续期只对活会话有意义)。 */
const isLiveStatus = (status: TerminalSession['status']): boolean =>
  status === 'idle' || status === 'running' || status === 'waiting_approval';

/**
 * 终端卡片的 "⋯" 菜单弹层:有效期(燃尽条 + 续期) / 扫码配对 / 简介 / 删除。
 * 两个视图共用一个 BottomSheet,点"简介"原地切换到信息页(可返回)。
 * 删除固定在最底部(危险操作远离高频入口);删除直接回调 onDelete
 * (无二次确认,与原 CLOSE 行为一致);扫码回调 onScan,由调用方带终端上下文
 * 跳 DeviceCameraScanner。BottomSheet 用法参照 WebPairConfirmSheet。
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
  onRenew,
}: TerminalCardMenuSheetProps) {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminals');
  const [view, setView] = useState<MenuView>('menu');
  const [renewingHours, setRenewingHours] = useState<number | null>(null);
  const [renewError, setRenewError] = useState(false);
  // 30s 一跳的共享时钟:剩余时长标签和燃尽条随它重算(参照 TerminalCard)。
  const nowMs = useNowTick();

  // 每次打开都回到菜单首页(上次可能停在简介页),并清掉上次的续期态。
  useEffect(() => {
    if (open) {
      setView('menu');
      setRenewingHours(null);
      setRenewError(false);
    }
  }, [open]);

  const chip = getTerminalStatusChip(terminal.status);
  const activityMs = Date.parse(terminal.lastCommandAt ?? terminal.updatedAt);
  const live = isLiveStatus(terminal.status);
  const canRenew = Boolean(onRenew) && live && !deleteDisabled;

  const expiresMs = Date.parse(terminal.expiresAt ?? '');
  const grantedMs = Date.parse(terminal.ttlGrantedAt ?? '');
  const hasExpiry = Number.isFinite(expiresMs);
  const remainingMs = hasExpiry
    ? Math.max(0, expiresMs - nowMs)
    : null;
  // 燃尽条:当前窗口内还没烧掉的比例(窗口 = ttlGrantedAt → expiresAt)。
  // 缺 grantedAt 的防御路径按 24h 满窗折算(与服务端单次授予上限一致)。
  const burnFraction = hasExpiry
    ? Math.min(
        1,
        Math.max(
          0,
          Number.isFinite(grantedMs)
            ? (expiresMs - nowMs) / Math.max(1, expiresMs - grantedMs)
            : (expiresMs - nowMs) / (24 * 3_600_000),
        ),
      )
    : null;
  const expired = hasExpiry && remainingMs !== null && remainingMs <= 0;
  const critical = !expired && remainingMs !== null && remainingMs <= 30 * 60_000;
  const barColor = expired
    ? theme.colors.error
    : critical
      ? theme.colors.error
      : theme.colors.primary;

  const formatDuration = (ms: number): string => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h > 0) {
      return m > 0
        ? t('lifetime.durationHm', { h, m })
        : t('lifetime.durationH', { h });
    }
    return t('lifetime.durationM', { m });
  };

  const handleRenew = async (hours: number) => {
    if (!onRenew || renewingHours !== null) return;
    setRenewingHours(hours);
    setRenewError(false);
    try {
      await onRenew(hours);
    } catch {
      setRenewError(true);
    } finally {
      setRenewingHours(null);
    }
  };

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
    // 删除固定最底:危险操作远离高频入口,误触面最小(产品要求 2026-10-22)。
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
  ];

  const infoRows: Array<{ label: string; value: string }> = [
    { label: t('info.createdAt'), value: formatDate(terminal.createdAt) },
    { label: t('info.createdBy'), value: createdBy || '-' },
    { label: t('info.device'), value: deviceName || terminal.deviceId },
    { label: t('info.shell'), value: terminal.shell || 'shell' },
    { label: t('info.directory'), value: terminal.directory || '~' },
    { label: t('info.status'), value: chip.label },
    {
      label: t('info.expiry'),
      value: hasExpiry
        ? `${formatDate(terminal.expiresAt)}${
            remainingMs !== null ? ` · ${formatDuration(remainingMs)}` : ''
          }`
        : t('lifetime.noExpiry'),
    },
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
          {live ? (
            <View
              testID="terminal-menu-lifetime"
              style={[
                styles.lifetimeCard,
                {
                  borderColor: theme.colors.outlineVariant,
                  backgroundColor: theme.colors.surfaceContainer,
                },
              ]}>
              <View style={styles.lifetimeHeader}>
                <IconBadge name="quota" tone="primary" size={30} iconSize={15} />
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('lifetime.title')}
                </Text>
                {hasExpiry && remainingMs !== null && !expired ? (
                  <Text
                    testID="terminal-menu-lifetime-remaining"
                    style={[
                      theme.typography.labelMd,
                      styles.lifetimeRemaining,
                      { color: barColor },
                    ]}>
                    {t('lifetime.remaining', {
                      duration: formatDuration(remainingMs),
                    })}
                  </Text>
                ) : null}
              </View>

              {hasExpiry ? (
                <>
                  {/* 燃尽条:外层轨道 + 内层剩余(从左往右收缩)。底色用
                      barColor 的低透明度叠层,不引新色。 */}
                  <View
                    testID="terminal-menu-lifetime-burn"
                    style={[
                      styles.burnTrack,
                      {
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.08)'
                          : theme.colors.surfaceContainerHighest,
                      },
                    ]}>
                    <View
                      style={[
                        styles.burnFill,
                        {
                          backgroundColor: barColor,
                          // 燃尽条宽度用百分比;expired(≤0)时收为零。
                          width: `${Math.round((burnFraction ?? 0) * 100)}%`,
                          opacity: expired ? 0.35 : 1,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: expired ? theme.colors.error : theme.colors.onSurfaceVariant },
                    ]}>
                    {expired
                      ? t('lifetime.expired')
                      : t('lifetime.expiresAt', {
                          time: formatDate(terminal.expiresAt),
                        })}
                  </Text>
                </>
              ) : (
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('lifetime.noExpiry')}
                </Text>
              )}

              {onRenew ? (
                <View style={styles.renewBlock}>
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {deleteDisabled ? t('lifetime.offlineHint') : t('lifetime.renewTitle')}
                  </Text>
                  <View style={styles.renewRow}>
                    {RENEW_CHOICES.map(hours => {
                      const busy = renewingHours === hours;
                      return (
                        <TouchableOpacity
                          key={hours}
                          testID={`terminal-menu-renew-${hours}`}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t(
                            hours === 24 ? 'lifetime.hours24' : hours === 6 ? 'lifetime.hours6' : 'lifetime.hours1',
                          )}
                          disabled={!canRenew || renewingHours !== null}
                          onPress={() => void handleRenew(hours)}
                          style={[
                            styles.renewChip,
                            {
                              borderColor: theme.colors.outline,
                              backgroundColor: busy
                                ? theme.colors.primaryContainer
                                : theme.colors.surfaceContainerLowest,
                              opacity: canRenew || busy ? 1 : 0.4,
                            },
                          ]}>
                          <Text
                            style={[
                              theme.typography.labelMd,
                              { color: busy ? theme.colors.onPrimaryContainer : theme.colors.primary },
                            ]}>
                            {busy
                              ? t('lifetime.renewing')
                              : hours === 24
                                ? t('lifetime.hours24')
                                : hours === 6
                                  ? t('lifetime.hours6')
                                  : t('lifetime.hours1')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {renewError ? (
                    <Text
                      testID="terminal-menu-renew-error"
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.error },
                      ]}>
                      {t('lifetime.renewFailed')}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

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
  lifetimeCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  lifetimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lifetimeRemaining: {
    marginLeft: 'auto',
  },
  burnTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  burnFill: {
    height: '100%',
    borderRadius: 3,
  },
  renewBlock: {
    gap: 8,
  },
  renewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  renewChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
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
