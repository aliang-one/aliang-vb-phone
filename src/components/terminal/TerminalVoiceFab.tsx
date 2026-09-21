// Always-visible voice FAB pinned to the right edge of the terminal bottom
// bar (spec 2026-09-21). Tap = start/stop STT (the screen routes by phase);
// long-press (idle only) = open the editable text input. Purely presentational:
// the phase and handlers come from useAiCommandSuggestions via the screen.
import React, { useEffect, useRef } from 'react';
import { Animated, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

const MicIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M10 2.5a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3Z"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
    />
    <Path
      d="M5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v3M7.5 17h5"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  </Svg>
);

export interface TerminalVoiceFabProps {
  phase: AiSuggestPhase;
  disabled: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export const TerminalVoiceFab: React.FC<TerminalVoiceFabProps> = ({
  phase,
  disabled,
  onPress,
  onLongPress,
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

  const recording = phase === 'recording';
  // 表面色沿用 DeviceTerminalScreen 底栏 FAB 的 elevatedSurface/outline 惯用
  // (dark 用半透明白叠层,light 用主题 token),录音/错误态红边红底盖过默认。
  const restingSurface = isDark ? 'rgba(255,255,255,0.06)' : theme.colors.surfaceContainerLowest;
  const restingOutline = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;
  const accentColor = recording || phase === 'error' ? theme.colors.error : theme.colors.primary;

  return (
    <TouchableOpacity
      testID="terminal-voice-fab"
      activeOpacity={0.74}
      accessibilityRole="button"
      accessibilityLabel={t('aiSuggest.voiceFabLabel')}
      accessibilityState={{ disabled, busy: phase === 'generating' }}
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
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
      {phase === 'generating' ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <MicIcon color={accentColor} />
      )}
    </TouchableOpacity>
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
