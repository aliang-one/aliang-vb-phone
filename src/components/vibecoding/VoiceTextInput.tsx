// Voice-first text entry for the session rename modal (and reusable elsewhere).
//
// Default interaction is STT: hold the mic to record + recognize, release to
// finish — the transcript streams into the field (replace semantics). The field
// stays keyboard-editable whenever nothing is recording, so typing is always an
// option and is the graceful-degradation path when STT or the native audio
// module is unavailable.
//
// Owns a `useVoiceStt()` instance internally. Mounted on demand (the host only
// renders it while the rename editor is open), so there's no idle cost across a
// list of cards. Live-caption frames stay local to this component: only the
// finalized transcript is committed via `onChangeText`, so streaming doesn't
// re-render the host card.
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { useVoiceStt, type VoiceSttStatus } from '../../hooks/useVoiceStt';

export interface VoiceTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Scopes the persisted recording to its session (admin 数据浏览). */
  sessionId?: string;
  projectPath?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  maxLength?: number;
  autoFocus?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  /** Prefix for element testIDs; the mic is `${prefix}-mic`. Defaults to 'rename'. */
  testIDPrefix?: string;
  style?: StyleProp<TextStyle>;
}

const ACTIVE: VoiceSttStatus[] = ['connecting', 'recording', 'stopping'];
const MIC_SIZE = 22;
const MIC_BTN = 40;

const MicIcon: React.FC<{ size?: number; color: string }> = ({ size = MIC_SIZE, color }) => {
  const common = {
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" stroke={color} {...common} />
      <Path d="M5 11a7 7 0 0 0 14 0" stroke={color} {...common} />
      <Path d="M12 18v3M8 21h8" stroke={color} {...common} />
    </Svg>
  );
};

// Expanding ring around the mic while recording. Native-driver transform; only
// mounted while recording, so its Animated.loop can't run away in tests.
const PulseRing: React.FC<{ color: string; size: number }> = ({ color, size }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1.9,
          duration: 1500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
};

export const VoiceTextInput: React.FC<VoiceTextInputProps> = ({
  value,
  onChangeText,
  sessionId,
  projectPath,
  placeholder,
  placeholderTextColor,
  maxLength = 200,
  // Voice-first: do NOT autofocus — opening the rename modal keeps the keyboard
  // dismissed so the mic (the default affordance) leads. Typing stays available
  // by tapping the field (graceful degradation). Hosts can pass autoFocus={true}
  // to force the keyboard-open behavior.
  autoFocus = false,
  returnKeyType = 'done',
  onSubmitEditing,
  testIDPrefix = 'rename',
  style,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const resolvedPlaceholder = placeholder ?? t('voiceInput.placeholder');
  const voiceStt = useVoiceStt();
  const pressActiveRef = useRef(false);

  const status = voiceStt.status;
  const isActive = ACTIVE.includes(status);
  const isRecording = status === 'recording';
  const isError = status === 'error';

  // Keep latest values in refs so the unmount-only effect below can read them
  // without re-subscribing (and firing cancel on every status change).
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const cancelRef = useRef(voiceStt.cancel);
  cancelRef.current = voiceStt.cancel;

  // Live caption streams into the field while active; otherwise show the
  // committed value. The streaming text never reaches `onChangeText`, so the
  // host card isn't re-rendered on every caption frame.
  const displayValue = isActive ? voiceStt.liveCaption : value;

  const commit = (transcript: string) => {
    onChangeText(transcript.slice(0, maxLength));
  };

  const handleMicPressIn = () => {
    if (isActive) return;
    pressActiveRef.current = true;
    void voiceStt.start({
      sessionId,
      projectPath,
      onComplete: commit,
    });
  };

  const handleMicPressOut = () => {
    // Hold-to-talk: lifting the finger (or losing the responder) stops a
    // recording we started via press-in. Guarded so a stray press-out without a
    // matching press-in is a no-op.
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    if (isActive) void voiceStt.stop();
  };

  // Closing the host modal unmounts us → cancel any in-flight recording so a
  // late stt.completed can't commit text the user meant to discard. Empty deps
  // so the cleanup runs only on real unmount, not on every status change.
  useEffect(() => {
    return () => {
      if (isActiveRef.current) {
        cancelRef.current();
      }
    };
  }, []);

  const statusLabel =
    status === 'recording'
      ? t('voiceInput.statusRecording')
      : status === 'stopping'
        ? t('voiceInput.statusStopping')
        : status === 'connecting'
          ? t('voiceInput.statusConnecting')
          : '';

  const micIconColor = isActive ? theme.colors.onPrimary : isError ? theme.colors.error : theme.colors.primary;
  const micIdleTint = isDark ? `${theme.colors.primary}22` : `${theme.colors.primary}14`;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          testID={`${testIDPrefix}-input`}
          value={displayValue}
          onChangeText={onChangeText}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={placeholderTextColor ?? theme.colors.onSurfaceVariant}
          autoFocus={autoFocus}
          selectTextOnFocus
          maxLength={maxLength}
          editable={!isActive}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          style={[
            theme.typography.titleLg,
            styles.input,
            {
              color: theme.colors.onSurface,
              borderColor: isError ? theme.colors.error : theme.colors.outlineVariant,
            },
            style,
          ]}
        />
        <Pressable
          testID={`${testIDPrefix}-mic`}
          accessibilityRole="button"
          accessibilityLabel={isActive ? t('voiceInput.micActive') : t('voiceInput.micIdle')}
          onPressIn={handleMicPressIn}
          onPressOut={handleMicPressOut}
          style={[
            styles.micBtn,
            {
              borderRadius: theme.borderRadius.full,
              backgroundColor: isActive ? theme.colors.primary : micIdleTint,
              borderColor: isError ? theme.colors.error : `${theme.colors.primary}55`,
            },
          ]}
        >
          {isRecording && <PulseRing color={theme.colors.primary} size={MIC_BTN} />}
          <MicIcon size={MIC_SIZE} color={micIconColor} />
        </Pressable>
      </View>
      <View style={styles.caption}>
        {isError ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }]} numberOfLines={2}>
            {voiceStt.errorMessage || t('voiceInput.voiceError')}
          </Text>
        ) : isActive ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.primary }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        ) : (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('voiceInput.hint')}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  micBtn: {
    width: MIC_BTN,
    height: MIC_BTN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  caption: {
    paddingLeft: 2,
    minHeight: 16,
  },
});
