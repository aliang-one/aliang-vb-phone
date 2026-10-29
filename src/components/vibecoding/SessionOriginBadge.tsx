import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { VibeCodingRun } from '../../data/platformModels';
import {
  deriveSessionOriginBadge,
  type SessionOriginBadgeKind,
} from '../../utils/sessionOrigin';
import { useTheme } from '../../theme/useTheme';
import { IconGlyph, type IconName } from '../visual/IconBadge';
import { StatusChip } from '../shared/StatusChip';

const badgeLabelKey: Record<SessionOriginBadgeKind, string> = {
  phone: 'sessionCard.originBadgePhone',
  dashboard: 'sessionCard.originBadgeDashboard',
  terminal: 'sessionCard.originBadgeTerminal',
};

const badgeIcon: Record<SessionOriginBadgeKind, IconName> = {
  phone: 'phone',
  dashboard: 'device',
  terminal: 'terminal',
};

/**
 * 会话来源角标（跨端统一 P4-3）：origin/终端 id 前缀推导（见
 * deriveSessionOriginBadge）；'managed'/空 → 不渲染（返回 null）。
 *
 * variant='inline'：图标+短文本，挂在会话卡片底部元信息行（原
 * SessionOriginIcon 槽位升级——补 dashboard 来源与可见文字）。
 * variant='chip'：StatusChip，用于会话详情页顶栏状态簇。
 */
export const SessionOriginBadge: React.FC<{
  session: VibeCodingRun;
  color?: string;
  variant?: 'inline' | 'chip';
}> = ({ session, color, variant = 'inline' }) => {
  const { t } = useTranslation('vibecoding');
  const { theme } = useTheme();
  const kind = deriveSessionOriginBadge(session.origin, session.id);
  if (!kind) return null;
  const label = t(badgeLabelKey[kind]);
  if (variant === 'chip') {
    return <StatusChip label={label} type="neutral" />;
  }
  return (
    <View
      accessibilityLabel={label}
      testID="session-origin-badge"
      style={styles.wrap}
    >
      <IconGlyph
        name={badgeIcon[kind]}
        size={13}
        color={color ?? theme.colors.onSurfaceVariant}
      />
      <Text
        numberOfLines={1}
        style={[
          theme.typography.labelSm,
          { color: color ?? theme.colors.onSurfaceVariant },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // inline 变体容器:图标与文字同排、不收缩(长标题行里角标保持完整)。
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
});
