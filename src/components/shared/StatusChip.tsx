import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

type StatusType = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusChipProps {
  label: string;
  type: StatusType;
  style?: object;
  /** 强制强调色(hex,如 '#73C991')——覆盖 type 派生色。会话卡片按相位着色
   *  (进行中=绿 / 待批准=黄 / 空闲完成=蓝 / 失败=红)时传入;text/dot/border
   *  用此色,bg 用其低透明度。 */
  accent?: string;
}

/** #RRGGBB → rgba(r,g,b,alpha)。3 位短色(#RGB)自动展开。用于 accent 的低透 bg。 */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// VSCode Dark+ inspired status colors
const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  success: { bg: 'rgba(86, 156, 214, 0.18)', text: '#569CD6' },   // VSCode comment green
  warning: { bg: 'rgba(206, 145, 120, 0.18)', text: '#CE9178' },   // VSCode string orange
  error: { bg: 'rgba(244, 135, 113, 0.18)', text: '#F48771' },     // VSCode error red
  neutral: { bg: 'rgba(204, 204, 204, 0.08)', text: '#9D9D9D' },   // muted gray
  info: { bg: 'rgba(86, 156, 214, 0.18)', text: '#569CD6' },       // VSCode keyword blue
};

export const StatusChip: React.FC<StatusChipProps> = ({ label, type, style, accent }) => {
  const { theme, isDark } = useTheme();
  const colors = accent
    ? { bg: hexToRgba(accent, isDark ? 0.18 : 0.12), text: accent }
    : isDark
    ? statusColorMap[type]
    : {
        bg:
          type === 'success'
            ? 'rgba(9, 105, 218, 0.1)'
            : type === 'warning'
            ? 'rgba(254, 177, 39, 0.15)'
            : type === 'error'
            ? 'rgba(186, 26, 26, 0.1)'
            : type === 'info'
            ? 'rgba(0, 81, 174, 0.1)'
            : 'rgba(0, 0, 0, 0.05)',
        text:
          type === 'success'
            ? '#0969DA'
            : type === 'warning'
            ? '#B8860B'
            : type === 'error'
            ? '#BA1A1A'
            : type === 'info'
            ? '#0051AE'
            : '#424753',
      };

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: colors.bg,
          borderRadius: theme.borderRadius.full,
          borderColor: colors.text,
        },
        style,
      ]}>
      <View style={[styles.dot, { backgroundColor: colors.text }]} />
      <Text
        style={[
          theme.typography.codeSm,
          { color: colors.text },
          styles.label,
        ]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
