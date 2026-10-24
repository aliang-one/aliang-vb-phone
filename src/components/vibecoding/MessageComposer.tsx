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
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlowButton } from '../shared/GlowButton';
import type { UseVoiceSttResult } from '../../hooks/useVoiceStt';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';
import type { AgentCommandInfo } from '../../data/platformModels';
import { isGoalCommand } from '../../utils/goalComposer';
import { GOAL_UI_ENABLED } from '../../config/featureFlags';

export type ComposerMode = 'voice' | 'text';

export interface MessageComposerProps {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  input: string;
  onInputChange: (text: string) => void;
  voiceDraft: string;
  /** Slash commands available for inline `/`-command typeahead in text mode. */
  commands: AgentCommandInfo[];
  voiceStt: UseVoiceSttResult;
  sendingMessage: boolean;
  interruptingTurn?: boolean;
  canInterruptTurn?: boolean;
  /** Turn runs in the desktop terminal TUI (scan-reported running, no v2 run).
      No longer greys the stop button — the agent interrupts external TUI turns
      via SIGINT (>= v1.1.36). It only renders the "runs on the desktop"
      bookmark tab above the composer so the narrow input row keeps its width. */
  interruptGreyed?: boolean;
  /** Expanded text of the TUI bookmark tab (context: where this turn runs). */
  interruptGreyedHint?: string;
  /** 回合进行中是否还有一条可用的插话(steer)通道。为 true 且正在输入
      (文本非空或已选素材)时,动作槽渲染 [停止][发送]——发送键恒在最右。
      父级按 provider + 设备能力位(ai_steer_claude) + 回合来源判定,
      与 store 里 appendAgentMessage 的 sendAsSteer 同源。 */
  canSteer?: boolean;
  deviceOffline: boolean;
  readOnlyReason?: string;
  /** One-shot: focus the text input on mount/prop-true. Used to pop the keyboard
      after "编辑" transfers a voice draft into the text field. */
  autoFocusText?: boolean;
  toolsMenuVisible: boolean;
  toolsDisabled?: boolean;
  onToggleTools: () => void;
  /**
   * 素材入口是否可用。`true` 才渲染「+」按钮：调用方用会话能力位判断
   * （`session.attachmentsCapability?.enabled === true`），能力位未知
   * （列表快照不带）或服务端未配 COS 时都不渲染——不让用户点进一条注定
   * 失败的链路。草稿会话没有 sessionId，无法上传，同样传 false。
   */
  attachmentsEnabled?: boolean;
  /** 打开素材菜单。仅在 attachmentsEnabled 时会被调用。 */
  onOpenAttachments?: () => void;
  /**
   * 已选素材数量。>0 时即使输入框为空也点亮发送键——纯图片/字符画消息由
   * 会话页补一句默认说明（服务端正文 min(1)，空正文会被拒）。
   */
  attachmentCount?: number;
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

type ComposerIconName =
  | 'mic'
  | 'keyboard'
  | 'send'
  | 'sparkle'
  | 'stop'
  | 'sliders'
  | 'desktop'
  | 'image';

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
      {name === 'sliders' && (
        <Path
          d="M4 21V14M4 10V3M12 21V12M12 8V3M20 21V16M20 12V3M1 14H7M9 8H15M17 16H23"
          stroke={color}
          {...common}
        />
      )}
      {name === 'desktop' && (
        <>
          <Rect x="2.5" y="4" width="19" height="12.5" rx="2" stroke={color} {...common} />
          <Path d="M9 20.5h6M12 16.5v4" stroke={color} {...common} />
        </>
      )}
      {name === 'image' && (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke={color} {...common} />
          <Circle cx="9" cy="9.5" r="1.6" stroke={color} {...common} />
          <Path d="m4.5 17 4.6-4.6 3.4 3.4 2.6-2.6 4.4 4.4" stroke={color} {...common} />
        </>
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

const MessageComposerBase: React.FC<MessageComposerProps> = ({
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
  interruptGreyed = false,
  interruptGreyedHint,
  canSteer = false,
  deviceOffline,
  readOnlyReason,
  autoFocusText,
  toolsMenuVisible,
  toolsDisabled = false,
  onToggleTools,
  attachmentsEnabled = false,
  onOpenAttachments,
  attachmentCount = 0,
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
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const status = voiceStt.status;
  const isVoiceActive = ACTIVE_STATUSES.includes(status);
  const isRecording = status === 'recording';
  const hasDraft = Boolean(voiceDraft);
  const composerDisabled = !(goalDraft || goalSession) && (deviceOffline || Boolean(readOnlyReason));
  // /goal 形态输入的特判必须与屏侧同源门控 GOAL_UI_ENABLED：flag 关闭时
  // /goal 就是普通文本，不得绕过 composerDisabled，更不能把回合中的停止键
  // 顶掉（2026-10-24 状态矩阵清洗 G5）。
  const isGoalCommandInput = GOAL_UI_ENABLED && isGoalCommand(input);
  // Slash-command typeahead: active only while the whole input is a single
  // `/token` (slash first, command-name chars, no space yet) in text mode. A
  // space ends the command name and hides the dropdown.
  const slashMatch =
    mode === 'text' && !goalDraft ? input.match(/^\/([a-zA-Z0-9_-]*)$/) : null;
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : '';

  // TUI-driven-turn hint starts collapsed behind the desktop icon; the full
  // text only renders after the user taps it. Re-collapse whenever the greyed
  // episode ends so a later TUI turn enters with the icon again, not stale
  // expanded text left over from the previous one.
  const [greyedHintOpen, setGreyedHintOpen] = useState(false);
  useEffect(() => {
    if (!interruptGreyed) setGreyedHintOpen(false);
  }, [interruptGreyed]);

  // 素材入口跟随「打字中」：聚焦即出现（允许只发图不打字），失焦消失，
  // 但有草稿文字时保留——别让用户清空文字后入口闪烁着不见。
  const [inputFocused, setInputFocused] = useState(false);

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
    // 只读态不禁用切换：用户若困在语音视图（如草稿录到一半回合被锁），
    // 必须能切回文本视图看到只读原因行（G6，2026-10-24）。
    const disabled = isVoiceActive;
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

  const renderSendButton = () => {
    const canSend =
      (input.trim().length > 0 || attachmentCount > 0) &&
      !sendingMessage &&
      // goalDraft 时 composerDisabled 本就为 false，无需重复放行。
      (!composerDisabled || isGoalCommandInput);
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
  };

  // 停止键一律可点（禁用仅限：打断请求在途 / 设备离线）。历史上有过
  // 「TUI 驱动回合置灰」形态，但 agent 自 v1.1.36 起就支持对外部终端
  // Claude Code 回合发 SIGINT（=按一次 Esc，经 server 附 source_session_id
  // 下发），置灰属于过时的保守——2026-10-24 状态矩阵清洗 G1a 放开。
  const renderStopButton = () => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={t('composer.stopGenerate')}
      accessibilityState={interruptingTurn ? { busy: true } : undefined}
      disabled={interruptingTurn || deviceOffline}
      onPress={onInterruptTurn}
      testID="composer-interrupt"
      style={[
        styles.ctrlBtn,
        {
          borderRadius: theme.borderRadius.full,
          backgroundColor: interruptingTurn ? ctrlBg.backgroundColor : theme.colors.error,
          ...(!interruptingTurn && isDark ? theme.glow.primary : {}),
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

  const renderAction = () => {
    // Hold-to-talk model: the recording is stopped by lifting the finger off
    // the hold target (onPressOut -> handleVoicePressOut). There is NO separate
    // stop button here — it would be unreachable while the finger is holding,
    // and showing one signals a different (tap-to-stop) model, which confused
    // the interaction. During a voice recording the slot falls through to the
    // non-interactive placeholder, unless a turn is streaming (then interrupt).
    if (canInterruptTurn && onInterruptTurn && !isGoalCommandInput && !goalDraft) {
      // A live turn takes the action slot. With a steer channel available
      // (canSteer) the send button is the primary action and sits RIGHTMOST
      // (user spec 2026-10-24：输入时最右侧必须是发送键，停止键退居左侧)；
      // 无 steer 通道（或语音模式）时只留停止键。TUI 驱动的回合不再置灰
      // 停止键——外部 SIGINT 通道已存在，见 renderStopButton 注释；桌面
      // 标记继续以书签 tab 形式出现在输入框上方（interruptGreyed 驱动）。
      if (canSteer && mode === 'text' && (input.trim().length > 0 || attachmentCount > 0)) {
        return (
          <View style={styles.ctrlGroup}>
            {renderStopButton()}
            {renderSendButton()}
          </View>
        );
      }
      return renderStopButton();
    }
    if (mode === 'text') {
      return renderSendButton();
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
    // 只读文案行。goal 豁免是承重墙,不是冗余:goalDraft 可以出现在**已有会话**
    // 里(purpose 尚未翻成 goal),此时父层的 tuiDrivenRunning/锁判定可能为真,
    // 豁免能保证 goal 目标草稿永远可输入(2026-10-24 曾误判为冗余想删,复测
    // __tests__/MessageComposer.test.tsx 的 goalDraft 用例后保留)。
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
          onFocus={() => {
            setInputFocused(true);
            onTextInputFocus?.();
          }}
          onBlur={() => setInputFocused(false)}
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
          <Text
            style={[
              theme.typography.labelMd,
              // RN 的 flexShrink 默认是 0(与 Web 的 1 相反)：不允许收缩的长
              // 文案在窄容器里会向两侧溢出，压住左右控件。这里必须显式收缩。
              { color: theme.colors.onSurfaceVariant, flexShrink: 1 },
            ]}
            numberOfLines={1}
          >
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

        <View style={styles.containerCol}>
          {/* TUI bookmark tab: a small "runs on the desktop" marker sitting ON
              the composer's top edge (like a file tab). It lives outside the
              input row so the narrow row keeps its full width for text — the
              old in-row desktop icon ate ~40pt of it. Tap to expand the
              where-to-stop hint, tap again to collapse. */}
          {interruptGreyed && interruptGreyedHint ? (
            <View style={styles.tuiTabRow}>
              {/* Opaque backing, same material as the screen's input panel.
                  The tab's own fill is translucent (it mirrors the composer
                  box), which let the container's top border show through at
                  the seam; this backing masks it so tab and box read as one
                  piece — and the tab stops ghosting the scrolling transcript
                  behind its upper half. */}
              <View
                style={[
                  styles.tuiTabBacking,
                  {
                    backgroundColor: isDark
                      ? 'rgba(17, 20, 23, 0.98)'
                      : 'rgba(247, 249, 255, 0.98)',
                  },
                  greyedHintOpen ? styles.tuiTabExpanded : null,
                ]}
              >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={interruptGreyedHint}
                accessibilityState={{ expanded: greyedHintOpen }}
                onPress={() => setGreyedHintOpen(open => !open)}
                testID={greyedHintOpen ? 'composer-tui-hint-text' : 'composer-tui-hint'}
                style={[
                  styles.tuiTab,
                  {
                    backgroundColor: containerBg,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              >
                <ComposerIcon
                  name="desktop"
                  size={14}
                  color={theme.colors.onSurfaceVariant}
                />
                {!greyedHintOpen ? (
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}
                  >
                    {t('composer.tuiTabLabel')}
                  </Text>
                ) : null}
                {greyedHintOpen ? (
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant, flex: 1 },
                    ]}
                    numberOfLines={3}
                  >
                    {interruptGreyedHint}
                  </Text>
                ) : null}
              </TouchableOpacity>
              </View>
            </View>
          ) : null}
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
              {/* 素材入口：打字时（聚焦/有草稿）出现在输入框内部右侧、发送键
                  旁。能力位未知（列表快照）或 COS 未配置时整颗按钮不出现——
                  比渲染一个禁用态更诚实。离线/只读时保留按钮但置灰，用户能
                  看到入口、知道为什么点不动。语音模式不属于文字输入，不出现。 */}
              {attachmentsEnabled &&
              mode === 'text' &&
              (inputFocused || input.length > 0) ? (
                <TouchableOpacity
                  testID="composer-attachments"
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('attachments.open')}
                  disabled={deviceOffline || Boolean(readOnlyReason)}
                  onPress={onOpenAttachments}
                  style={[
                    styles.ctrlBtn,
                    {
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: ctrlBg.backgroundColor,
                      borderWidth: 1,
                      borderColor: 'transparent',
                      opacity: deviceOffline || readOnlyReason ? 0.45 : 1,
                    },
                  ]}
                >
                  <ComposerIcon name="image" size={20} color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              ) : null}
              {renderAction()}
            </View>
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
              // 只读态（回合锁定 / TUI 驱动回合）禁用发送：父层 handleSendVoice
              // 对锁定态是静默 return，按钮若不跟着禁用就成了「可点但没反应」。
              disabled={deviceOffline || sendingMessage || Boolean(readOnlyReason)}
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
    // Width now comes from the enclosing `containerCol` (which took over the
    // old `flex: 1` role when the TUI tab was stacked above). Keeping flex:1
    // here would collapse to zero height inside an auto-height column.
    alignSelf: 'stretch',
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
  // 注意：这里不能常驻 flex:1。折叠态下它和 contentArea 的 flex:1 会五五分，
  // 把中间的语音提示压到一半宽度；提示行又不收缩(RN 默认 flexShrink:0)，
  // 居中后向两侧溢出、压住左边的模式切换按钮。只有展开提示时才需要它占满。
  ctrlGroup: {
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
  // The composer's outer column. `flex: 1` mirrors the old `container` flex so
  // the row still fills the space left of the tools button. The TUI bookmark
  // tab is absolute (see tuiTabRow) and does not contribute height here.
  containerCol: {
    flex: 1,
  },
  // Tab strip is ABSOLUTELY positioned, pinned just above the input container
  // (bottom:'100%' = flush on its top edge; translateY tucks the open bottom
  // edge 1px over the container's border so the two read as one piece — a file
  // tab stuck onto the input box). Being out of flow it adds ZERO layout
  // height: the composer's height stays driven by the input box alone, so the
  // tab appearing/disappearing (TUI turn starts/ends) no longer shifts the
  // whole bottom sheet. It also follows a growing multiline input for free —
  // it is anchored to the container's top edge, which moves with it.
  tuiTabRow: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: 12,
    transform: [{ translateY: 1 }],
    zIndex: 1,
  },
  tuiTabBacking: {
    // Must mirror `tuiTab`'s top radii so the opaque fill doesn't paint past
    // the tab's rounded corners.
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  tuiTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    // Only the top/side borders are visible: the bottom edge is covered by
    // the composer container that the tab sits on.
    borderBottomWidth: 0,
    maxWidth: '100%',
  },
  tuiTabExpanded: {
    // Expanded hint text needs the full width of the composer row; it grows
    // leftward from the right edge, balancing the row's paddingRight. Applied
    // to the backing wrapper; the touchable inside stretches with it.
    flex: 1,
    marginLeft: 12,
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

// memo:与消息内容无关的输入区。流式期间聊天屏以 ≤5Hz 重渲染
// (usePublishedVibeRun),props 引用稳定(父级 useCallback/useMemo 化 +
// useVoiceStt 返回对象 memo 化)时整块跳过,不再陪跑。
export const MessageComposer = React.memo(MessageComposerBase);
