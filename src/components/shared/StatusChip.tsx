import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';

type StatusType = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusChipProps {
  label: string;
  type: StatusType;
  style?: object;
  /** 强制强调色(hex,如 '#73C991')——覆盖 type 派生色。会话卡片按相位着色
   *  (进行中=绿 / 待批准=黄 / 空闲完成=蓝 / 失败=红)时传入;text/dot/border
   *  用此色,bg 用其低透明度。 */
  accent?: string;
  /** 运行态呼吸:为 true 时圆点做透明度脉冲(0.2↔1.0)。用于「进行中」状态——
   *  色相与完成态同为蓝,靠动效 + 文案区分(非仅靠颜色,符合无障碍)。reduceMotion
   *  开启时退静态。会话卡片/详情页状态头按 phase==='running' 传入。 */
  pulse?: boolean;
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

export const StatusChip: React.FC<StatusChipProps> = ({
  label,
  type,
  style,
  accent,
  pulse = false,
}) => {
  const { theme, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  // 运行态「三点输入」波纹:三颗小圆点轮流起伏(value 0→1→0),相位错开 180ms,
  // 构成典型「正在输入」动效(AI 思考感)。value 经 interpolate 同时驱动
  // opacity(0.35↔1)与 scale(0.8↔1),全 native driver。pulse && !reduceMotion 时
  // 跑;reduceMotion + pulse → 三点静态全亮(保留"3 点=运行"视觉但不动的降级);
  // 非 pulse 不渲染三点(走单点)。
  const typingDots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    if (!pulse || reduceMotion) {
      typingDots.forEach(d => d.setValue(reduceMotion ? 1 : 0));
      return;
    }
    const CYCLE = 1200;
    const UP = 280;
    const DOWN = 280;
    const PHASE = 180;
    const loops = typingDots.map((dot, i) => {
      const phase = i * PHASE;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(phase),
          Animated.timing(dot, { toValue: 1, duration: UP, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: DOWN, useNativeDriver: true }),
          Animated.delay(Math.max(0, CYCLE - phase - UP - DOWN)),
        ]),
      );
    });
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
    // typingDots 是稳定 ref,不进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse, reduceMotion]);
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
      {pulse ? (
        <View style={styles.dotGroup}>
          {typingDots.map((dotValue, i) => (
            <Animated.View
              key={i}
              style={[
                styles.typingDot,
                {
                  backgroundColor: colors.text,
                  opacity: dotValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
                  transform: [
                    {
                      scale: dotValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.dot, { backgroundColor: colors.text }]} />
      )}
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
  dotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
