// Shared voice → bash confirm modal.
//
// One-shot flow reused by two entry points (long-press NEW TERM and the
// in-terminal voice FAB): record voice → STT → POST /api/ai/command-gen →
// show an editable confirm popup (with a danger warning + second-confirm when
// the command looks destructive) → hand the confirmed command to the caller
// via `onConfirm(command)`. The modal is agnostic to what the caller does with
// it (spawn a terminal vs. inject into a live pty).
//
// The useVoiceStt lifecycle mirrors VoiceTextInput: start() with an
// onComplete that fires once with the final transcript, stop() to end the
// recording, cancel() on dismiss/unmount so a late stt.completed can't commit.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { useVoiceStt } from '../../hooks/useVoiceStt';
import { generateCommand } from '../../api/commandGen';
import {
  subscribeCommandGenEvents,
  type CommandGenLiveEvent,
} from '../../services/commandGenEvents';
import { isUnsafeSuggestion } from '../../utils/terminalSuggestions';
import { GlassPanel } from '../shared/GlassPanel';

export type VoiceToBashPhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'review'
  | 'generating'
  | 'confirming'
  | 'error';

export interface VoiceToBashModalProps {
  visible: boolean;
  mode: 'initial' | 'live';
  deviceId: string;
  cwd: string;
  deviceOs?: string;
  sessionId?: string;
  projectId?: string;
  onClose: () => void;
  onConfirm: (command: string) => void;
}

const MicIcon: React.FC<{ size?: number; color: string }> = ({
  size = 26,
  color,
}) => {
  const common = {
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
        stroke={color}
        {...common}
      />
      <Path d="M5 11a7 7 0 0 0 14 0" stroke={color} {...common} />
      <Path d="M12 18v3M8 21h8" stroke={color} {...common} />
    </Svg>
  );
};

// Render a single commandGen.* event as a concise timeline row. Returns null for
// events that don't carry user-visible progress (runStarted / failed / runFinished
// are handled elsewhere or via the closing spinner — only tool steps render rows).
const stepLabel = (e: CommandGenLiveEvent): string | null => {
  switch (e.type) {
    case 'commandGen.step': {
      if (e.kind === 'tool_call') {
        return e.toolName ? `→ ${e.toolName}` : '→ tool';
      }
      if (e.kind === 'tool_result') {
        return e.toolName ? `✓ ${e.toolName}` : '✓ result';
      }
      if (e.kind === 'final') {
        return '生成中…';
      }
      return null;
    }
    default:
      return null;
  }
};

export const VoiceToBashModal: React.FC<VoiceToBashModalProps> = ({
  visible,
  mode,
  deviceId,
  cwd,
  sessionId,
  projectId,
  onClose,
  onConfirm,
}) => {
  const { theme, isDark } = useTheme();
  const voiceStt = useVoiceStt();

  const [phase, setPhase] = useState<VoiceToBashPhase>('idle');
  const [command, setCommand] = useState('');
  const [transcript, setTranscript] = useState('');
  const [dangerous, setDangerous] = useState(false);
  const [error, setError] = useState('');
  // Live commandGen.* step timeline accumulated while the AI tool-loop runs.
  // Reset to empty on every (re-)entry into the generating phase. Captured into
  // the activeRunIdRef from the first matching commandGen.runStarted, after
  // which non-matching runId events are dropped (other concurrent runs).
  const [steps, setSteps] = useState<CommandGenLiveEvent[]>([]);
  const activeRunIdRef = useRef<string | null>(null);
  // Guard so the POST fires exactly once per generating-phase entry even though
  // the effect re-runs on every state change while in that phase.
  const generateFiredRef = useRef(false);
  // The transcript the POST should send; captured synchronously when the user
  // confirms the review-phase text so the effect always has the right value.
  const pendingTextRef = useRef<string>('');
  // Second-confirm gate: the first tap on 确认运行 when dangerous only arms
  // this flag (and relabels the button); the second tap actually fires onConfirm.
  // Backed by a ref so the onPress handler always reads the live value even if
  // the element's closure is stale (test renderer / rapid double-tap).
  const [confirmDanger, setConfirmDanger] = useState(false);
  const confirmDangerRef = useRef(false);
  const armConfirmDanger = useCallback((next: boolean) => {
    confirmDangerRef.current = next;
    setConfirmDanger(next);
  }, []);

  // Re-evaluate danger on every command edit so a user-typed destructive
  // command still trips the warning even if the server returned dangerous=false.
  const locallyUnsafe = isUnsafeSuggestion(command);
  const isDangerous = dangerous || locallyUnsafe;

  // Keep latest props/handlers in refs so the dismiss/unmount effect can call
  // them without re-subscribing on every state change.
  const cancelRef = useRef(voiceStt.cancel);
  cancelRef.current = voiceStt.cancel;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset to the idle phase (used by 重录 / 重试 and on open). Idle waits for a
  // hold-to-talk press before any recording begins.
  const resetToIdle = useCallback(() => {
    setCommand('');
    setTranscript('');
    setDangerous(false);
    setError('');
    armConfirmDanger(false);
    activeRunIdRef.current = null;
    generateFiredRef.current = false;
    setSteps([]);
    setPhase('idle');
  }, [armConfirmDanger]);

  // STT finalized: land in the review phase with the transcript pre-filled in
  // an editable TextInput. The AI generateCommand call is GATED behind 确认发送
  // so the user can fix transcription errors before spending a server round.
  const handleTranscript = useCallback((finalTranscript: string) => {
    setTranscript(finalTranscript);
    setPhase('review');
  }, []);

  // Review → AI: capture the (possibly edited) transcript and flip to the
  // generating phase. The actual POST + WS subscription live in the
  // generating-phase effect below; structuring it that way guarantees the
  // subscription is active BEFORE the POST fires (avoids the subscribe/fire
  // race that would drop the early commandGen.runStarted carrying the runId).
  const handleSend = useCallback(() => {
    const text = transcript.trim();
    if (!text) return;
    pendingTextRef.current = text;
    activeRunIdRef.current = null;
    generateFiredRef.current = false;
    setSteps([]);
    setPhase('generating');
  }, [transcript]);

  // Generating phase: subscribe to the commandGen.* stream FIRST, then fire the
  // POST exactly once. The subscription captures runId from the first matching
  // runStarted and accumulates only same-runId step events into the timeline.
  useEffect(() => {
    if (phase !== 'generating') return;

    const unsub = subscribeCommandGenEvents((e) => {
      if (activeRunIdRef.current === null) {
        // First matching event sets the runId we filter on for the rest of the run.
        if ('runId' in e && e.runId) {
          activeRunIdRef.current = e.runId;
        } else {
          return;
        }
      } else if ('runId' in e && e.runId && e.runId !== activeRunIdRef.current) {
        // A different concurrent run — ignore it (keep our timeline focused).
        return;
      }
      setSteps((prev) => [...prev, e]);
    });

    if (!generateFiredRef.current) {
      generateFiredRef.current = true;
      const text = pendingTextRef.current;
      generateCommand({
        text,
        deviceId,
        cwd,
        mode,
        sessionId,
        projectId,
      })
        .then((result) => {
          setCommand(result.command);
          setDangerous(Boolean(result.dangerous));
          armConfirmDanger(false);
          setPhase('confirming');
        })
        .catch((e) => {
          const message =
            e instanceof Error && e.message ? e.message : '生成命令失败，请重试';
          setError(message);
          setPhase('error');
        });
    }

    return () => {
      unsub();
    };
  }, [phase, deviceId, cwd, mode, sessionId, projectId, armConfirmDanger]);

  const startRecording = useCallback(() => {
    setPhase('recording');
    void voiceStt.start({
      onComplete: handleTranscript,
      sessionId,
      projectPath: cwd,
      deviceId,
    });
  }, [voiceStt, handleTranscript, sessionId, cwd, deviceId]);

  const handleStop = useCallback(() => {
    void voiceStt.stop();
  }, [voiceStt]);

  const handleClose = useCallback(() => {
    cancelRef.current();
    onCloseRef.current();
  }, []);

  const handleRerecord = useCallback(() => {
    cancelRef.current();
    resetToIdle();
  }, [resetToIdle]);

  const handleConfirmPress = useCallback(() => {
    if (!command.trim()) return;
    if (isDangerous && !confirmDangerRef.current) {
      armConfirmDanger(true);
      return;
    }
    const finalCommand = command;
    cancelRef.current();
    onConfirm(finalCommand);
  }, [command, isDangerous, armConfirmDanger, onConfirm]);

  // Cleanup: when the overlay closes (visible → false) or unmounts, cancel any
  // in-flight recording so a late stt.completed can't drive a dead modal.
  useEffect(() => {
    if (!visible) {
      cancelRef.current();
    }
  }, [visible]);

  // Reset internal state whenever the modal is (re)opened (idle waits for a
  // hold-to-talk press; no auto-record on open).
  useEffect(() => {
    if (visible) {
      resetToIdle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sttStatus = voiceStt.status;

  const isRecording =
    sttStatus === 'connecting' ||
    sttStatus === 'recording' ||
    sttStatus === 'stopping';

  const primaryBtnLabel =
    isDangerous && confirmDanger
      ? '确认运行(危险)'
      : isDangerous
        ? '确认运行'
        : '确认运行';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent={false}
    >
      <View style={styles.overlay}>
        <GlassPanel
          bordered
          style={[
            styles.panel,
            { backgroundColor: isDark ? 'rgba(30,30,30,0.96)' : theme.colors.surface },
          ]}
        >
          {phase === 'idle' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                语音转命令
              </Text>
              <Text
                testID="v2b-caption"
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={3}
              >
                按住说话，松手结束
              </Text>

              <View style={styles.micRow}>
                <Pressable
                  testID="v2b-mic-pad"
                  accessibilityRole="button"
                  accessibilityLabel="按住说话，松手结束"
                  onPressIn={startRecording}
                  onPressOut={handleStop}
                  style={[
                    styles.micBtn,
                    {
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: theme.colors.primary,
                    },
                  ]}
                >
                  <MicIcon size={26} color={theme.colors.onPrimary} />
                </Pressable>
              </View>

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'recording' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                说出你想执行的命令
              </Text>
              <Text
                testID="v2b-caption"
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={3}
              >
                {isRecording && voiceStt.liveCaption
                  ? voiceStt.liveCaption
                  : isRecording
                    ? '正在聆听…'
                    : '正在准备麦克风…'}
              </Text>

              <View style={styles.micRow}>
                <Pressable
                  testID="v2b-stop"
                  accessibilityRole="button"
                  accessibilityLabel="停止录音"
                  onPress={handleStop}
                  style={[
                    styles.micBtn,
                    {
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: theme.colors.error,
                    },
                  ]}
                >
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onError }]}>
                    停止
                  </Text>
                </Pressable>
              </View>

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'transcribing' && (
            <View style={styles.body}>
              <View style={styles.spinnerRow}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface, marginLeft: 8 }]}>
                  识别中…
                </Text>
              </View>
              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'review' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                确认转写
              </Text>
              <Text
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
              >
                识别结果如下，可编辑后发送给 AI 生成命令。
              </Text>
              <TextInput
                testID="v2b-transcript"
                value={transcript}
                onChangeText={setTranscript}
                multiline
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  theme.typography.bodyMd,
                  styles.commandInput,
                  {
                    color: theme.colors.onSurface,
                    borderColor: theme.colors.outlineVariant,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
                  },
                ]}
              />
              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
                <Pressable testID="v2b-rerecord-review" onPress={handleRerecord} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    重录
                  </Text>
                </Pressable>
                <Pressable
                  testID="v2b-confirm-send"
                  accessibilityRole="button"
                  accessibilityLabel="确认发送"
                  onPress={handleSend}
                  disabled={!transcript.trim()}
                  style={[
                    styles.primaryBtn,
                    {
                      borderRadius: theme.borderRadius.md,
                      backgroundColor: theme.colors.primary,
                      opacity: transcript.trim() ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
                    确认发送
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'generating' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                正在生成命令
              </Text>

              {steps.length === 0 ? (
                <View style={styles.spinnerRow}>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface, marginLeft: 8 }]}>
                    生成中…
                  </Text>
                </View>
              ) : (
                <View testID="v2b-timeline" style={styles.timeline}>
                  {steps.map((e, idx) => {
                    const label = stepLabel(e);
                    if (!label) return null;
                    return (
                      <Text
                        key={`${e.type}-${idx}`}
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                        numberOfLines={2}
                      >
                        {label}
                      </Text>
                    );
                  })}
                  <View style={styles.spinnerRow}>
                    <ActivityIndicator color={theme.colors.primary} size="small" />
                    <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginLeft: 6 }]}>
                      生成中…
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'confirming' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                确认运行命令
              </Text>

              {isDangerous && (
                <View
                  testID="v2b-danger"
                  style={[
                    styles.warning,
                    {
                      backgroundColor: theme.colors.errorContainer,
                      borderColor: theme.colors.error,
                    },
                  ]}
                >
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onErrorContainer }]}>
                    ⚠ 该命令可能造成破坏性影响，请再次确认后再运行。
                  </Text>
                </View>
              )}

              <TextInput
                testID="v2b-command"
                value={command}
                onChangeText={setCommand}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                style={[
                  theme.typography.codeSm,
                  styles.commandInput,
                  {
                    color: theme.colors.onSurface,
                    borderColor: isDangerous ? theme.colors.error : theme.colors.outlineVariant,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
                  },
                ]}
              />

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
                <Pressable testID="v2b-rerecord" onPress={handleRerecord} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    重录
                  </Text>
                </Pressable>
                <Pressable
                  testID="v2b-confirm"
                  accessibilityRole="button"
                  accessibilityLabel={primaryBtnLabel}
                  onPress={handleConfirmPress}
                  disabled={!command.trim()}
                  style={[
                    styles.primaryBtn,
                    {
                      borderRadius: theme.borderRadius.md,
                      backgroundColor: isDangerous ? theme.colors.error : theme.colors.primary,
                      opacity: command.trim() ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.labelMd,
                      {
                        color: isDangerous ? theme.colors.onError : theme.colors.onPrimary,
                      },
                    ]}
                  >
                    {primaryBtnLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'error' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.error }]}>
                出错了
              </Text>
              <Text
                testID="v2b-error"
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={4}
              >
                {error || voiceStt.errorMessage || '语音识别失败，请重试'}
              </Text>
              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    取消
                  </Text>
                </Pressable>
                <Pressable testID="v2b-retry" onPress={resetToIdle} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    重试
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </GlassPanel>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 16,
  },
  body: {
    gap: 12,
  },
  titleText: {
    marginBottom: 2,
  },
  micRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  micBtn: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  timeline: {
    gap: 6,
    paddingVertical: 4,
  },
  warning: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commandInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  textBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
