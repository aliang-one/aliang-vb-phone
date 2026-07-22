// Unified adaptive input composer for the VibeCoding chat screen.
//
// Replaces the old cluttered `modeRow` ([⚙][VOICE][TEXT]…[PAUSE][END]) + the
// orphaned 96px record button + the boxy text input. One cohesive rounded
// container adapts between text and voice, driven by a single mic/keyboard
// toggle. Voice states get a live pulse ring + staggered waveform so the
// voice→text flow feels alive (the STT hook exposes no amplitude, so the
// waveform is a decorative loop keyed off `status`).
//
// Session-level controls (pause/end) deliberately live OUT of the composer.
// Current-turn interrupt lives here because it replaces "send" while streaming.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlowButton } from '../shared/GlowButton';
import type { UseVoiceSttResult } from '../../hooks/useVoiceStt';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';
import type { AgentCommandInfo } from '../../data/platformModels';
import { useControlCenterStore } from '../../store/controlCenterStore';

export type ComposerMode = 'voice' | 'text';

export interface MessageComposerProps {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  input: string;
  onInputChange: (text: string) => void;
  voiceDraft: string;
  /** Slash commands available for inline `/`-command typeahead in text mode. */
  commands: AgentCommandInfo[];
  /** Session id — enables the manual `/`-command refresh button (text mode). */
  sessionId?: string;
  voiceStt: UseVoiceSttResult;
  sendingMessage: boolean;
  interruptingTurn?: boolean;
  canInterruptTurn?: boolean;
  deviceOffline: boolean;
  readOnlyReason?: string;
  /** One-shot: focus the text input on mount/prop-true. Used to pop the keyboard
      after "编辑" transfers a voice draft into the text field. */
  autoFocusText?: boolean;
  toolsMenuVisible: boolean;
  toolsDisabled?: boolean;
  onToggleTools: () => void;
  /** Unsent Goal objective mode. It is text-only and independent of Provider state. */
  goalDraft?: boolean;
  /** Created Goal session. Messages are queued by the server even while Provider work is running. */
  goalSession?: boolean;
  showGoalHint?: boolean;
  onTextInputFocus?: () => void;
  /** Toggles start/stop of voice capture. */
  onVoiceCapture: () => void;
  /** Begins press-and-hold voice capture. Falls back to onVoiceCapture. */
  onVoiceCaptureStart?: () => void;
  /** Deprecated: release no longer ends capture; use the explicit stop button. */
  onVoiceCaptureEnd?: () => void;
  /** Sends the transcribed voice draft as a user message. */
  onSendVoice: () => void;
  onSendText: () => void;
  onInterruptTurn?: () => void;
  /** Moves the voice draft into the text input for editing (switches to text mode). */
  onEditVoice: () => void;
}

// ---------- icons (inline SVG; no shared icon lib ships mic/keyboard/send) ----------

type ComposerIconName = 'mic' | 'keyboard' | 'send' | 'sparkle' | 'stop' | 'refresh' | 'sliders';

interface ComposerIconProps {
  name: ComposerIconName;
  size?: number;
  color: string;
}

const ComposerIcon: React.FC<ComposerIconProps> = ({ name, size = 22, color }) => {
  const common = {
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'mic' && (
        <>
          <Path
            d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
            stroke={color}
            {...common}
          />
          <Path d="M5 11a7 7 0 0 0 14 0" stroke={color} {...common} />
          <Path d="M12 18v3M8 21h8" stroke={color} {...common} />
        </>
      )}
      {name === 'keyboard' && (
        <>
          <Rect x="3" y="6.5" width="18" height="11" rx="2" stroke={color} {...common} />
          <Path d="M7 10.5h.01M12 10.5h.01M17 10.5h.01" stroke={color} {...common} />
          <Path d="M9.5 14h5" stroke={color} {...common} />
        </>
      )}
      {name === 'send' && (
        <>
          <Path d="M21 3 3 10.5l7 2.2 2.2 7L21 3Z" stroke={color} {...common} />
          <Path d="M10 12.7 21 3" stroke={color} {...common} />
        </>
      )}
      {name === 'sparkle' && (
        <Path
          d="M12 3c.7 4.5 2.5 6.3 7 7-4.5.7-6.3 2.5-7 7-.7-4.5-2.5-6.3-7-7 4.5-.7 6.3-2.5 7-7Z"
          stroke={color}
          {...common}
        />
      )}
      {name === 'stop' && <Rect x="7" y="7" width="10" height="10" rx="2.5" stroke={color} {...common} />}
      {name === 'refresh' && (
        <>
          <Path d="M21 12a9 9 0 1 1-2.64-6.36" stroke={color} {...common} />
          <Path d="M21 3v5h-5" stroke={color} {...common} />
        </>
      )}
      {name === 'sliders' && (
        <Path
          d="M4 21V14M4 10V3M12 21V12M12 8V3M20 21V16M20 12V3M1 14H7M9 8H15M17 16H23"
          stroke={color}
          {...common}
        />
      )}
    </Svg>
  );
};

// ---------- animated pieces ----------

const ORB = 48; // recording mic orb diameter
const BTN = 40; // circular control button diameter

/** Expanding ring around the mic while recording. Native driver (transform). */
const PulseRing: React.FC<{ color: string }> = ({ color }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1.95,
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
        width: ORB,
        height: ORB,
        borderRadius: ORB / 2,
        borderWidth: 2,
        borderColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
};

/**
 * Decorative equalizer bars. `calm` lowers the amplitude/speed (used while
 * connecting / transcribing so it reads as "working", not "loud").
 */
const Waveform: React.FC<{ active: boolean; calm: boolean; color: string }> = ({
  active,
  calm,
  color,
}) => {
  const BAR_COUNT = 5;
  const MIN_SCALE = 0.18;
  const MAX_HEIGHT = 26;
  const bars = useRef<Animated.Value[]>(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(MIN_SCALE)),
  ).current;
  useEffect(() => {
    if (!active) {
      bars.forEach(b => b.stopAnimation(() => b.setValue(MIN_SCALE)));
      return;
    }
    const maxScale = calm ? 0.46 : 1;
    const loops = bars.map((bar, i) => {
      const dur = (calm ? 520 : 340) + i * 70;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: maxScale,
            duration: dur,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: MIN_SCALE,
            duration: dur,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
    });
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [active, calm, bars]);
  return (
    <View style={styles.waveformRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: MAX_HEIGHT,
            borderRadius: 2,
            marginHorizontal: 1.5,
            backgroundColor: color,
            opacity: calm ? 0.6 : 0.9,
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  );
};

// ---------- composer ----------

const ACTIVE_STATUSES: Array<UseVoiceSttResult['status']> = [
  'connecting',
  'recording',
  'stopping',
];

export const MessageComposer: React.FC<MessageComposerProps> = ({
  mode,
  onModeChange,
  input,
  onInputChange,
  voiceDraft,
  commands,
  voiceStt,
  sendingMessage,
  interruptingTurn = false,
  canInterruptTurn = false,
  deviceOffline,
  readOnlyReason,
  autoFocusText,
  toolsMenuVisible,
  toolsDisabled = false,
  onToggleTools,
  goalDraft = false,
  goalSession = false,
  showGoalHint = false,
  onTextInputFocus,
  onVoiceCapture,
  onVoiceCaptureStart,
  onVoiceCaptureEnd,
  onSendVoice,
  onSendText,
  onInterruptTurn,
  onEditVoice,
  sessionId,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const status = voiceStt.status;
  const isVoiceActive = ACTIVE_STATUSES.includes(status);
  const isRecording = status === 'recording';
  const hasDraft = Boolean(voiceDraft);
  const composerDisabled = !(goalDraft || goalSession) && (deviceOffline || Boolean(readOnlyReason));
  const isGoalCommandInput = /^\/goal(?:\s|$)/i.test(input.trim());
  // Slash-command typeahead: active only while the whole input is a single
  // `/token` (slash first, command-name chars, no space yet) in text mode. A
  // space ends the command name and hides the dropdown.
  const slashMatch =
    mode === 'text' && !goalDraft ? input.match(/^\/([a-zA-Z0-9_-]*)$/) : null;
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : '';

  // Manual `/`-command refresh (force=true bypasses the 1h gate + server 10s
  // floor still applies). Updates project.availableCommands in the store → the
  // typeahead (SlashCommandSuggestions, fed from availableCommands) re-renders
  // with freshly discovered commands. In-flight guard prevents spam clicks.
  const refreshSessionCommandsAction = useControlCenterStore(s => s.refreshSessionCommands);
  const [refreshingCommands, setRefreshingCommands] = useState(false);
  const handleRefreshCommands = () => {
    if (!sessionId || refreshingCommands) return;
    setRefreshingCommands(true);
    refreshSessionCommandsAction(sessionId, { force: true }).finally(() => {
      setRefreshingCommands(false);
    });
  };

  const containerBg = isDark ? 'rgba(255,255,255,0.045)' : theme.colors.surfaceContainer;
  const ctrlBg: ViewStyle = {
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  };

  const statusLabel =
    status === 'recording'
      ? t('composer.statusRecording')
      : status === 'stopping'
        ? t('composer.statusStopping')
        : status === 'connecting'
          ? t('composer.statusConnecting')
          : '';

  // ----- natural text <-> voice transition -----
  // The content area fades + slides up whenever the mode flips, and the toggle
  // icon springs, so the swap reads as a morph instead of an instant pop. We
  // re-trigger on `mode` only — keying on `status` too would flicker the whole
  // panel on every connecting->recording step mid-session.
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentSlide = useRef(new Animated.Value(6)).current;
  const toggleScale = useRef(new Animated.Value(0.6)).current;
  const draftOpacity = useRef(new Animated.Value(0)).current;
  const draftSlide = useRef(new Animated.Value(10)).current;
  const voicePressActiveRef = useRef(false);

  useEffect(() => {
    contentOpacity.setValue(0);
    contentSlide.setValue(6);
    toggleScale.setValue(0.6);
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(contentSlide, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(toggleScale, {
        toValue: 1,
        friction: 5,
        tension: 200,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (hasDraft && mode === 'voice') {
      draftOpacity.setValue(0);
      draftSlide.setValue(10);
      Animated.parallel([
        Animated.timing(draftOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(draftSlide, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraft, mode]);

  const handleVoicePressIn = () => {
    if (composerDisabled || isVoiceActive) return;
    voicePressActiveRef.current = true;
    (onVoiceCaptureStart ?? onVoiceCapture)();
  };

  const handleVoicePressOut = () => {
    // Hold-to-talk: lifting the finger (or losing the responder) stops a
    // recording we started via press-in. Gated on voicePressActiveRef so a
    // stray press-out without a matching press-in (e.g. already recording when
    // mounted) is a no-op rather than a spurious stop.
    if (!voicePressActiveRef.current) return;
    voicePressActiveRef.current = false;
    (onVoiceCaptureEnd ?? onVoiceCapture)();
  };

  // ----- the round control buttons (mode toggle + primary action) -----

  const renderModeToggle = () => {
    // In text mode the toggle offers voice (mic); in voice mode it offers text
    // (keyboard). Disabled mid-capture so the user can't bail out of a recording
    // by accident.
    const targetMode: ComposerMode = mode === 'text' ? 'voice' : 'text';
    const iconName: ComposerIconName = mode === 'text' ? 'mic' : 'keyboard';
    const disabled = goalDraft || Boolean(readOnlyReason) || isVoiceActive;
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={mode === 'text' ? t('composer.switchToVoice') : t('composer.switchToText')}
        disabled={disabled}
        onPress={() => onModeChange(targetMode)}
        testID="composer-toggle"
        style={[styles.ctrlBtn, { borderRadius: theme.borderRadius.full }, ctrlBg]}
      >
        <Animated.View style={{ transform: [{ scale: toggleScale }] }}>
          <ComposerIcon name={iconName} size={20} color={theme.colors.onSurfaceVariant} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderAction = () => {
    // Hold-to-talk model: the recording is stopped by lifting the finger off
    // the hold target (onPressOut -> handleVoicePressOut). There is NO separate
    // stop button here — it would be unreachable while the finger is holding,
    // and showing one signals a different (tap-to-stop) model, which confused
    // the interaction. During a voice recording the slot falls through to the
    // non-interactive placeholder, unless a turn is streaming (then interrupt).
    if (canInterruptTurn && onInterruptTurn && !isGoalCommandInput && !goalDraft) {
      return (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('composer.stopGenerate')}
          disabled={interruptingTurn || deviceOffline}
          onPress={onInterruptTurn}
          testID="composer-interrupt"
          style={[
            styles.ctrlBtn,
            {
              borderRadius: theme.borderRadius.full,
              backgroundColor: interruptingTurn ? ctrlBg.backgroundColor : theme.colors.error,
              ...(interruptingTurn || !isDark ? {} : theme.glow.primary),
            },
          ]}
        >
          {interruptingTurn ? (
            <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
              …
            </Text>
          ) : (
            <ComposerIcon name="stop" size={20} color={theme.colors.onPrimary} />
          )}
        </TouchableOpacity>
      );
    }
    if (mode === 'text') {
      const canSend =
        input.trim().length > 0 &&
        !sendingMessage &&
        (!composerDisabled || isGoalCommandInput || goalDraft);
      return (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('composer.send')}
          disabled={!canSend}
          onPress={onSendText}
          testID="composer-send"
          style={[
            styles.ctrlBtn,
            {
              borderRadius: theme.borderRadius.full,
              backgroundColor: canSend ? theme.colors.primary : ctrlBg.backgroundColor,
              ...(canSend && isDark ? theme.glow.primary : {}),
            },
          ]}
        >
          {sendingMessage ? (
            <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
              …
            </Text>
          ) : (
            <ComposerIcon name="send" size={20} color={canSend ? theme.colors.onPrimary : theme.colors.onSurfaceVariant} />
          )}
        </TouchableOpacity>
      );
    }
    if (mode === 'voice') {
      return (
        <View
          pointerEvents="none"
          testID="composer-action-placeholder"
          style={styles.ctrlBtn}
        />
      );
    }
    return null;
  };

  // ----- the adaptive content area -----

  const renderContent = () => {
    if (readOnlyReason && !(goalDraft || goalSession)) {
      return (
        <View style={styles.inlineRow}>
          <ComposerIcon name="stop" size={18} color={theme.colors.onSurfaceVariant} />
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, flex: 1 },
            ]}
            numberOfLines={2}
          >
            {readOnlyReason}
          </Text>
        </View>
      );
    }

    if (mode === 'text') {
      return (
        <TextInput
          value={input}
          onChangeText={onInputChange}
          onFocus={onTextInputFocus}
          autoFocus={autoFocusText}
          editable={!sendingMessage}
          placeholder={goalDraft
            ? '描述这个 Goal…'
            : t(showGoalHint ? 'composer.sendPlaceholderWithGoal' : 'composer.sendPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          multiline
          style={[
            theme.typography.bodyMd,
            styles.textInput,
            { color: theme.colors.onSurface },
          ]}
        />
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.inlineRow}>
          <ComposerIcon name="mic" size={18} color={theme.colors.error} />
          <Text
            style={[theme.typography.bodySm, { color: theme.colors.error, flex: 1 }]}
            numberOfLines={2}
          >
            {voiceStt.errorMessage || t('composer.voiceError')}
          </Text>
        </View>
      );
    }

    if (!isVoiceActive) {
      // voice idle — the outer Pressable starts recording; stopping is explicit
      // via the right-side stop control after capture begins.
      return (
        <View style={styles.inlineRow}>
          <View
            style={[
              styles.idleOrb,
              {
                borderRadius: theme.borderRadius.full,
                backgroundColor: isDark ? `${theme.colors.primary}22` : `${theme.colors.primary}14`,
                borderColor: `${theme.colors.primary}55`,
              },
            ]}
          >
            <ComposerIcon name="mic" size={18} color={theme.colors.primary} />
          </View>
          <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
            {t('composer.tapToSpeak')}
          </Text>
        </View>
      );
    }

    // connecting / recording / stopping
    return (
      <View style={styles.activeCol}>
        <View style={styles.activeTopRow}>
          <View style={styles.orbWrap}>
            {isRecording && <PulseRing color={theme.colors.primary} />}
            <View
              style={[
                styles.orb,
                {
                  borderRadius: theme.borderRadius.full,
                  backgroundColor: theme.colors.primary,
                  opacity: isRecording ? 1 : 0.85,
                  ...(isRecording && isDark ? theme.glow.primary : {}),
                },
              ]}
            >
              <ComposerIcon name="mic" size={22} color={theme.colors.onPrimary} />
            </View>
          </View>
          <View style={styles.activeRight}>
            <Text
              style={[theme.typography.labelSm, { color: theme.colors.primary }]}
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
            <Waveform active={isVoiceActive} calm={!isRecording} color={theme.colors.primary} />
          </View>
        </View>
        {voiceStt.liveCaption ? (
          <Text
            style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}
            numberOfLines={2}
          >
            {voiceStt.liveCaption}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderAnimatedContent = () => (
    <Animated.View
      style={{ opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}
    >
      {renderContent()}
    </Animated.View>
  );

  return (
    <View style={styles.wrap}>
      {slashMatch ? (
        <SlashCommandSuggestions
          commands={commands}
          query={slashQuery}
          onSelect={cmd => onInputChange(`/${cmd.name} `)}
        />
      ) : null}
      <View style={styles.composerRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('composer.tools')}
          disabled={toolsDisabled}
          onPress={onToggleTools}
          style={[
            styles.ctrlBtn,
            {
              borderRadius: theme.borderRadius.full,
              backgroundColor: toolsMenuVisible
                ? `${theme.colors.primary}1F`
                : ctrlBg.backgroundColor,
              borderWidth: 1,
              borderColor: toolsMenuVisible ? theme.colors.primary : 'transparent',
              opacity: toolsDisabled ? 0.45 : 1,
            },
          ]}
        >
          <ComposerIcon
            name="sliders"
            size={20}
            color={toolsMenuVisible ? theme.colors.primary : theme.colors.onSurfaceVariant}
          />
        </TouchableOpacity>

        <View
          style={[
            styles.container,
            {
              borderRadius: theme.borderRadius.xl,
              backgroundColor: containerBg,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={styles.innerRow}>
            {renderModeToggle()}
            <View style={styles.contentArea}>
              {mode === 'voice' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isVoiceActive ? t('composer.recordingActive') : t('composer.tapToRecord')}
                  disabled={composerDisabled}
                  onPressIn={handleVoicePressIn}
                  onPressOut={handleVoicePressOut}
                  testID="composer-voice-hold"
                  style={styles.voicePressable}
                >
                  {renderAnimatedContent()}
                </Pressable>
              ) : (
                renderAnimatedContent()
              )}
            </View>
            {mode === 'text' && sessionId && !goalDraft ? (
              <TouchableOpacity
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('composer.refreshCommands')}
                disabled={refreshingCommands}
                onPress={handleRefreshCommands}
                testID="composer-refresh-commands"
                style={[
                  styles.ctrlBtn,
                  {
                    borderRadius: theme.borderRadius.full,
                    backgroundColor: ctrlBg.backgroundColor,
                    opacity: refreshingCommands ? 0.5 : 1,
                  },
                ]}>
                <ComposerIcon
                  name="refresh"
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </TouchableOpacity>
            ) : null}
            {renderAction()}
          </View>
        </View>
      </View>

      {hasDraft && mode === 'voice' ? (
        <Animated.View
          style={[
            styles.draftPanel,
            {
              borderRadius: theme.borderRadius.xl,
              backgroundColor: containerBg,
              borderColor: theme.colors.outlineVariant,
              opacity: draftOpacity,
              transform: [{ translateY: draftSlide }],
            },
          ]}
        >
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            {t('composer.voiceDraft')}
          </Text>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
            {voiceDraft}
          </Text>
          {/* 方案A：转写完成即可直接发送 voiceDraft，不经 AI 润色。
              AI 润色（方案B）暂未实现，等接后端再放回这里。 */}
          <View style={styles.draftActions}>
            <GlowButton
              title={t('composer.sendVoice')}
              onPress={onSendVoice}
              variant="primary"
              loading={sendingMessage}
              disabled={deviceOffline || sendingMessage}
              style={styles.draftBtn}
            />
            <GlowButton
              title={t('composer.editVoice')}
              onPress={onEditVoice}
              variant="outline"
              style={styles.draftBtn}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  container: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 52,
    justifyContent: 'center',
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ctrlBtn: {
    width: BTN,
    height: BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentArea: {
    flex: 1,
    justifyContent: 'center',
  },
  voicePressable: {
    minHeight: 40,
    justifyContent: 'center',
  },
  textInput: {
    minHeight: 40,
    maxHeight: 96,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  idleOrb: {
    width: 34,
    height: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCol: {
    gap: 6,
    paddingVertical: 2,
  },
  activeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orbWrap: {
    width: ORB,
    height: ORB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    width: ORB,
    height: ORB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeRight: {
    flex: 1,
    gap: 5,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
  },
  draftPanel: {
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  draftActions: {
    flexDirection: 'row',
    gap: 8,
  },
  draftBtn: {
    flex: 1,
  },
});
