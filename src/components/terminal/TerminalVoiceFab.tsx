// Terminal AI FAB(spec 2026-09-22):短按=文字输入,长按(≥450ms)=STT
// push-to-talk,松开=结束。图标恒为 aliang Logo,任何相位不换图标——相位
// 由表面色/描边(录音红)、脉冲叠层+录音弧线环与生成期 logo 旋转+呼吸表达。纯展示手势
// 分类器:onShortPress/onHoldStart/onHoldEnd 由 screen 接线,并按
// AiSuggestPhase 路由到 useAiCommandSuggestions(hook 自带相位守卫,
// 陈旧闭包最多是被 hook 短路,不会产生错误行为)。
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Logo } from '../visual/Logo';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

export const HOLD_THRESHOLD_MS = 450;

// 呼吸/旋转调优常量(2026-09-28 真机二轮反馈:1.12~1.15@24px logo ≈3px 肉眼
// 难辨):幅度加大到 1.18、半周期放慢到 1250ms。导出供测试钉住调优值,
// 防止后续无意回退(动画值本身无法从渲染树断言)。
export const BREATH_SCALE = 1.18;
export const BREATH_HALF_MS = 1250;
export const SPIN_MS = 3200;

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
    // 呼吸同时覆盖生成与录音两相位(真机反馈录音期看不到呼吸);幅度
    // 1.18、半周期 1250ms(BREATH_HALF_MS),肉眼可辨。旋转只在生成期。
    if ((phase !== 'generating' && phase !== 'recording') || reduceMotion) {
      spin.setValue(0);
      breath.setValue(0);
      return;
    }
    const rotate = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: SPIN_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_HALF_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_HALF_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
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
  // 触摸/视觉分层(2026-09-28 真机反馈#1):外层 54×54 只是视觉锚,pulse/
  // arc 铺满它并允许越出 44px 触摸圆;外层自身区域 box-none 直通,起在角落
  // 的横滚手势能落到左侧按键行的 ScrollView 上。触摸收进 44×44 圆形
  // Pressable;录音/错误态的红边红底画在触摸圆上(圆是唯一可见底座)。

  return (
    <View testID="terminal-voice-fab-layer" style={styles.fabLayer} pointerEvents="box-none">
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
          {/* 54×54 铺满外层视觉锚(允许越出 44px 触摸圆):圆心 27、半径 24,周长≈150.8,弧段≈1/4(37.7)。 */}
          <Svg width={54} height={54} viewBox="0 0 54 54">
            <Circle cx={27} cy={27} r={24} fill="none" stroke={theme.colors.primary} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="37.7 113.1" />
          </Svg>
        </Animated.View>
      ) : null}
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
        hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
        disabled={disabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.fabTouch,
          {
            backgroundColor: recording ? theme.colors.errorContainer : 'transparent',
            borderColor: recording || phase === 'error' ? theme.colors.error : 'transparent',
          },
          disabled && styles.disabled,
        ]}
      >
        {phase === 'generating' && !reduceMotion ? (
          <Animated.View
            testID="terminal-voice-fab-spin"
            style={{
              transform: [
                { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, BREATH_SCALE] }) },
              ],
            }}
          >
            <Logo size={24} />
          </Animated.View>
        ) : (
          <Animated.View
            style={{ transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, BREATH_SCALE] }) }] }}
          >
            <Logo size={24} />
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  // 54×54 视觉锚:无背景无边框,自身不接手势(pointerEvents="box-none" 在
  // JSX 上),只负责铺 pulse/arc 与居中 44×44 触摸圆;alignSelf 保持旧根
  // 节点在 controlsRow(alignItems: 'stretch')里的对齐行为。
  fabLayer: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  // 44×44 圆形触摸层:透明底座,录音/错误态由内联 backgroundColor/
  // borderColor 画红;覆盖区比旧 54 方块小 10px,角落不再挡横滚。
  fabTouch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pulse: { borderRadius: 27 },
  disabled: { opacity: 0.45 },
});
