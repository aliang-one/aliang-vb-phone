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
import { isUnsafeSuggestion } from '../../utils/terminalSuggestions';
import { GlassPanel } from '../shared/GlassPanel';

export type VoiceToBashPhase =
  | 'recording'
  | 'transcribing'
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

  const [phase, setPhase] = useState<VoiceToBashPhase>('recording');
  const [command, setCommand] = useState('');
  const [dangerous, setDangerous] = useState(false);
  const [error, setError] = useState('');
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

  // Reset to the recording phase (used by 重录 / 重试 and on open).
  const resetToRecording = useCallback(() => {
    setCommand('');
    setDangerous(false);
    setError('');
    armConfirmDanger(false);
    setPhase('recording');
  }, []);

  const handleTranscript = useCallback(
    async (transcript: string) => {
      setPhase('transcribing');
      try {
        const result = await generateCommand({
          text: transcript,
          deviceId,
          cwd,
          mode,
          sessionId,
          projectId,
        });
        setCommand(result.command);
        setDangerous(Boolean(result.dangerous));
        armConfirmDanger(false);
        setPhase('confirming');
      } catch (e) {
        const message =
          e instanceof Error && e.message ? e.message : '生成命令失败，请重试';
        setError(message);
        setPhase('error');
      }
    },
    [deviceId, cwd, mode, sessionId, projectId],
  );

  const handleMicPress = useCallback(() => {
    if (phase !== 'recording') return;
    void voiceStt.start({
      onComplete: handleTranscript,
      sessionId,
      projectPath: cwd,
    });
  }, [phase, voiceStt, handleTranscript, sessionId, cwd]);

  const handleStop = useCallback(() => {
    void voiceStt.stop();
  }, [voiceStt]);

  const handleClose = useCallback(() => {
    cancelRef.current();
    onCloseRef.current();
  }, []);

  const handleRerecord = useCallback(() => {
    cancelRef.current();
    resetToRecording();
  }, [resetToRecording]);

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

  // Reset internal state whenever the modal is (re)opened.
  useEffect(() => {
    if (visible) {
      resetToRecording();
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
                    : '点按麦克风开始说话'}
              </Text>

              <View style={styles.micRow}>
                {isRecording ? (
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
                ) : (
                  <Pressable
                    testID="v2b-mic"
                    accessibilityRole="button"
                    accessibilityLabel="开始录音"
                    onPress={handleMicPress}
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
                )}
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
                <Pressable testID="v2b-retry" onPress={resetToRecording} style={styles.textBtn}>
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
