// Terminal AI FAB(spec 2026-09-22):短按=文字输入,长按(≥450ms)=STT
// push-to-talk,松开=结束。图标恒为 aliang Logo,任何相位不换图标——相位
// 由表面色/描边(录音红)、脉冲叠层+录音弧线环与生成期 logo 旋转+呼吸表达。纯展示手势
// 分类器:onShortPress/onHoldStart/onHoldEnd 由 screen 接线,并按
// AiSuggestPhase 路由到 useAiCommandSuggestions(hook 自带相位守卫,
// 陈旧闭包最多是被 hook 短路,不会产生错误行为)。
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Logo } from '../visual/Logo';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

export const HOLD_THRESHOLD_MS = 450;

export interface TerminalVoiceFabProps {
  phase: AiSuggestPhase;
  disabled: boolean;
  /** 短按(未到阈值松开)→ screen 调 openTextInput()。 */
  onShortPress: () => void;
  /** 按住到阈值 → screen 调 startVoice()。 */
  onHoldStart: () => void;
  /** 长按后松开 → screen 按 phase 调 stopVoice()。 */
  onHoldEnd: () => void;
  /** 长按阈值;测试注入短值用,默认 450ms(spec §2)。 */
  holdThresholdMs?: number;
}

export const TerminalVoiceFab: React.FC<TerminalVoiceFabProps> = ({
  phase,
  disabled,
  onShortPress,
  onHoldStart,
  onHoldEnd,
  holdThresholdMs = HOLD_THRESHOLD_MS,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'recording' || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion, pulse]);

  // 录音弧线环(2026-09-28 真机反馈):长按录音时叠加一圈 1/4 弧段的扫描
  // 旋转(1.4s/圈),与脉冲叠层并行表达录音态;reduce motion 时不出现,
  // 录音态仍由红边红底 + a11y 播报传达(动效不能是唯一指示)。
  const arcSweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'recording' || reduceMotion) {
      arcSweep.setValue(0);
      return;
    }
    const arc = Animated.loop(
      Animated.timing(arcSweep, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
    );
    arc.start();
    return () => arc.stop();
  }, [phase, reduceMotion, arcSweep]);

  // 生成态(2026-09-28):角标 spinner 与圆形 logo 不兼容,改为 logo 本体
  // 旋转(3.2s/圈)+呼吸(0.85s 放大到 112%)。真机反馈旋转太快/呼吸不明显,
  // 2026-09-28 调优:1.6s→3.2s、108%→112%、0.7s→0.85s。reduce motion 或
  // 离开生成态时复位归零;生成态仍由 a11y busy + AI 状态条文案传达(动效
  // 不能是唯一指示)。
  const spin = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'generating' || reduceMotion) {
      spin.setValue(0);
      breath.setValue(0);
      return;
    }
    const rotate = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    rotate.start();
    breathe.start();
    return () => {
      rotate.stop();
      breathe.stop();
    };
  }, [phase, reduceMotion, spin, breath]);

  // 手势状态机:pressActiveRef 保证 pressOut 与 pressIn 配对(滑出/被抢占
  // 触发的 pressOut 也走这里);holdFiredRef 区分短按与长按松开。
  const pressActiveRef = useRef(false);
  const holdFiredRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  // 按压中卸载:清计时器(录音由 hook 的 unmount cancel 兜底)。
  useEffect(() => () => clearHoldTimer(), []);

  const handlePressIn = () => {
    if (disabled) return;
    pressActiveRef.current = true;
    holdFiredRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdFiredRef.current = true;
      onHoldStart();
    }, holdThresholdMs);
  };

  const handlePressOut = () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    clearHoldTimer();
    if (holdFiredRef.current) onHoldEnd();
    else onShortPress();
  };

  const recording = phase === 'recording';
  // 表面色沿用 DeviceTerminalScreen 底栏 FAB 的 elevatedSurface/outline 惯用
  // (dark 用半透明白叠层,light 用主题 token),录音/错误态红边红底盖过默认。
  const restingSurface = isDark ? 'rgba(255,255,255,0.06)' : theme.colors.surfaceContainerLowest;
  const restingOutline = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;

  return (
    <Pressable
      testID="terminal-voice-fab"
      accessibilityRole="button"
      // 颜色/动效不能是唯一指示:无障碍标签随相位播报录音/错误态。
      accessibilityLabel={
        recording
          ? `${t('aiSuggest.voiceFabLabel')}，${t('aiSuggest.listening')}`
          : phase === 'error'
            ? `${t('aiSuggest.voiceFabLabel')}，${t('aiSuggest.errorVoice')}`
            : t('aiSuggest.voiceFabLabel')
      }
      accessibilityHint={t('aiSuggest.emptyHint')}
      accessibilityState={{ disabled, busy: phase === 'generating' }}
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.fab,
        {
          backgroundColor: recording ? theme.colors.errorContainer : restingSurface,
          borderColor: recording || phase === 'error' ? theme.colors.error : restingOutline,
        },
        disabled && styles.disabled,
      ]}
    >
      {recording && !reduceMotion ? (
        <Animated.View
          testID="terminal-voice-fab-pulse"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.pulse,
            {
              backgroundColor: theme.colors.error,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.3] }),
            },
          ]}
        />
      ) : null}
      {recording && !reduceMotion ? (
        <Animated.View
          testID="terminal-voice-fab-arc"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { transform: [{ rotate: arcSweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}
        >
          {/* 54×54 铺满 FAB:圆心 27、半径 24,周长≈150.8,弧段≈1/4(37.7)。 */}
          <Svg width={54} height={54} viewBox="0 0 54 54">
            <Circle cx={27} cy={27} r={24} fill="none" stroke={theme.colors.primary} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="37.7 113.1" />
          </Svg>
        </Animated.View>
      ) : null}
      {phase === 'generating' && !reduceMotion ? (
        <Animated.View
          testID="terminal-voice-fab-spin"
          style={{
            transform: [
              { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
              { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
            ],
          }}
        >
          <Logo size={24} />
        </Animated.View>
      ) : (
        <Logo size={24} />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    alignSelf: 'center',
  },
  pulse: { borderRadius: 27 },
  disabled: { opacity: 0.45 },
});
