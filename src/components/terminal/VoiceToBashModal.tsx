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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useVoiceStt } from '../../hooks/useVoiceStt';
import { generateCommand } from '../../api/commandGen';
import {
  subscribeCommandGenEvents,
  type CommandGenLiveEvent,
} from '../../services/commandGenEvents';
import { isUnsafeSuggestion } from '../../utils/terminalSuggestions';
import { GlassPanel } from '../shared/GlassPanel';
import { DevicePicker, type DevicePickerEntry } from './DevicePicker';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export type VoiceToBashPhase =
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
  onConfirm: (command: string, deviceId?: string, cwd?: string) => void;
  /** Online+enabled devices for the initial-mode confirm picker. Omitted in live mode. */
  selectableDevices?: DevicePickerEntry[];
}

// --- commandGen step timeline rendering -------------------------------------
// The orchestrator publishes the FULL detail of each loop step: tool_call carries
// `toolArgs` (which path was read/listed), tool_result carries `snippet` (the
// agent's response, up to 512 chars). That data is already in memory — the modal
// accumulates whole events — so these helpers surface it instead of collapsing
// every row to a bare tool name (which hid the parameters and the content).

// Compact, readable suffix for a tool's args. All read-only tools here key on
// `path` (list_dir/read_file); git_status/env_info/recent_commands take none.
// Fall back to trimmed JSON so no parameter is ever silently hidden.
const summarizeToolArgs = (args?: Record<string, unknown>): string => {
  if (!args) return '';
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (path) return path;
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  const compact = JSON.stringify(args);
  return compact.length > 48 ? compact.slice(0, 47) + '…' : compact;
};

type StepHeader = { icon: string; text: string; snippet?: string };

// Build the visible header for one commandGen.* step. null = no row (runStarted /
// failed / runFinished are surfaced via the phase transitions, not the timeline).
const stepHeader = (e: CommandGenLiveEvent, t: TFunction): StepHeader | null => {
  if (e.type !== 'commandGen.step') return null;
  if (e.kind === 'tool_call') {
    const arg = summarizeToolArgs(e.toolArgs);
    return { icon: '→', text: e.toolName ? `${e.toolName}${arg ? '  ' + arg : ''}` : t('voiceBash.step.toolFallback') };
  }
  if (e.kind === 'tool_result') {
    return { icon: '✓', text: e.toolName ?? t('voiceBash.step.resultFallback'), snippet: e.snippet };
  }
  if (e.kind === 'final') {
    return { icon: '✓', text: t('voiceBash.step.final') };
  }
  return null;
};

// One timeline row. A tool_call is a plain header (no result yet); a tool_result
// always shows a 2-line snippet preview (so content is visible without tapping)
// and taps 详情 to expand the full text. Errors (snippet starts with "error:")
// are tinted so a failed read is obvious at a glance.
const StepRow: React.FC<{ event: CommandGenLiveEvent }> = ({ event }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('terminal');
  const [expanded, setExpanded] = useState(false);
  const header = stepHeader(event, t);
  if (!header) return null;
  const snippet = header.snippet && header.snippet.length > 0 ? header.snippet : undefined;
  const isError = snippet ? snippet.startsWith('error:') : false;
  const toggle = snippet ? () => setExpanded(value => !value) : undefined;
  // stepHeader returns non-null only for commandGen.step events, which carry seq.
  const seq = event.type === 'commandGen.step' ? event.seq : 0;
  return (
    <View style={styles.stepRow}>
      <Pressable
        testID={`v2b-step-${seq}`}
        disabled={!toggle}
        onPress={toggle}
        style={styles.stepHeaderRow}
      >
        <Text
          style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant, flexShrink: 1 }]}
          numberOfLines={1}
        >
          {`${header.icon} ${header.text}`}
        </Text>
        {snippet && (
          <Text style={[theme.typography.bodySm, { color: theme.colors.primary, marginLeft: 8 }]}>
            {expanded ? t('voiceBash.step.collapse') : t('voiceBash.step.details')}
          </Text>
        )}
      </Pressable>
      {snippet && (
        <Text
          style={[
            theme.typography.codeSm,
            styles.snippet,
            {
              color: isError ? theme.colors.error : theme.colors.onSurfaceVariant,
              borderLeftColor: theme.colors.outlineVariant,
            },
          ]}
          numberOfLines={expanded ? undefined : 2}
        >
          {snippet}
        </Text>
      )}
    </View>
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
  selectableDevices,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const voiceStt = useVoiceStt();

  const [phase, setPhase] = useState<VoiceToBashPhase>('recording');
  const [command, setCommand] = useState('');
  const [transcript, setTranscript] = useState('');
  const [dangerous, setDangerous] = useState(false);
  const [error, setError] = useState('');
  // AI/user-chosen target device (initial mode). Captured from the generateCommand
  // result, then possibly overridden via the DevicePicker in the confirm step.
  const [chosenDeviceId, setChosenDeviceId] = useState<string | undefined>(undefined);
  const [chosenCwd, setChosenCwd] = useState<string | undefined>(undefined);
  const [chosenDeviceName, setChosenDeviceName] = useState<string | undefined>(undefined);
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

  // Begin (or re-begin) a recording: cancel any in-flight STT first so a late
  // onComplete from the previous attempt can't land in the new review phase,
  // then start fresh. beginRecordingRef holds the latest stable callback so
  // resetToRecording (defined before beginRecording) can call it without a TDZ
  // hit and without resetting its own deps.
  const beginRecordingRef = useRef<() => void>(() => {});
  const resetToRecording = useCallback(() => {
    setCommand('');
    setTranscript('');
    setDangerous(false);
    setError('');
    setChosenDeviceId(undefined);
    setChosenCwd(undefined);
    setChosenDeviceName(undefined);
    armConfirmDanger(false);
    activeRunIdRef.current = null;
    generateFiredRef.current = false;
    setSteps([]);
    setPhase('recording');
    // Kick off a fresh recording as part of the reset. Re-renders never call
    // resetToRecording, so this fires exactly once per open / 重录 / 重试.
    beginRecordingRef.current();
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
          setChosenDeviceId(result.deviceId);
          setChosenCwd(result.cwd);
          setChosenDeviceName(result.deviceName);
          armConfirmDanger(false);
          setPhase('confirming');
        })
        .catch((e) => {
          const message =
            e instanceof Error && e.message ? e.message : t('voiceBash.error.generateFallback');
          setError(message);
          setPhase('error');
        });
    }

    return () => {
      unsub();
    };
  }, [phase, deviceId, cwd, mode, sessionId, projectId, armConfirmDanger, t]);

  // Begin (or re-begin) a recording: cancel any in-flight STT first so a late
  // onComplete from the previous attempt can't land in the new review phase,
  // then start fresh. The hook guards internally against starting while already
  // connecting/recording, so this is safe even if called right after open.
  const beginRecording = useCallback(() => {
    cancelRef.current();
    void voiceStt.start({
      onComplete: handleTranscript,
      sessionId,
      projectPath: cwd,
      deviceId,
    });
  }, [voiceStt, handleTranscript, sessionId, cwd, deviceId]);
  // Keep the ref in sync so resetToRecording (declared above beginRecording) can
  // invoke the latest beginRecording without a TDZ hit on first render.
  beginRecordingRef.current = beginRecording;

  const handleStop = useCallback(() => {
    void voiceStt.stop();
  }, [voiceStt]);

  const handleClose = useCallback(() => {
    cancelRef.current();
    onCloseRef.current();
  }, []);

  const handleRerecord = useCallback(() => {
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
    onConfirm(finalCommand, chosenDeviceId, chosenCwd);
  }, [command, isDangerous, armConfirmDanger, onConfirm, chosenDeviceId, chosenCwd]);

  // Cleanup: when the overlay closes (visible → false) or unmounts, cancel any
  // in-flight recording so a late stt.completed can't drive a dead modal.
  useEffect(() => {
    if (!visible) {
      cancelRef.current();
    }
  }, [visible]);

  // On open: reset to the recording phase. resetToRecording also kicks off a
  // fresh recording via beginRecordingRef, so start() fires exactly once per
  // open (re-renders never trigger this effect — it's keyed on `visible` only).
  useEffect(() => {
    if (visible) {
      resetToRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Propagate STT failures into the error phase so the existing error UI shows
  // voiceStt.errorMessage instead of a stuck "正在准备麦克风" caption. Only act
  // while we're still in a recording-family phase — once the user has moved on
  // to review/generating/confirming, a late hook error is stale and ignored.
  useEffect(() => {
    if (!visible) return;
    if (phase !== 'recording' && phase !== 'transcribing') return;
    if (voiceStt.status === 'error') {
      setPhase('error');
    }
  }, [visible, phase, voiceStt.status]);

  const sttStatus = voiceStt.status;

  // Caption priority for the recording phase: live transcript > status-driven
  // hint. The connecting state (native mic init) is the only legit "preparing"
  // moment; idle/error are transient here (the error effect moves us to the
  // error phase if it's a real failure, so this branch only shows briefly).
  const recordingCaption = (() => {
    if (voiceStt.liveCaption) return voiceStt.liveCaption;
    if (sttStatus === 'connecting') return t('voiceBash.recording.captionPreparing');
    if (sttStatus === 'recording') return t('voiceBash.recording.captionListening');
    if (sttStatus === 'stopping') return t('voiceBash.recording.captionRecognizing');
    return t('voiceBash.recording.captionPreparing');
  })();

  const primaryBtnLabel =
    isDangerous && confirmDanger
      ? t('voiceBash.confirm.runDangerLabel')
      : isDangerous
        ? t('voiceBash.confirm.runLabel')
        : t('voiceBash.confirm.runLabel');

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
                {t('voiceBash.recording.title')}
              </Text>
              <Text
                testID="v2b-caption"
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={3}
              >
                {recordingCaption}
              </Text>

              <View style={styles.micRow}>
                <Pressable
                  testID="v2b-done"
                  accessibilityRole="button"
                  accessibilityLabel={t('voiceBash.recording.doneA11yLabel')}
                  onPress={handleStop}
                  style={[
                    styles.micBtn,
                    {
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: theme.colors.primary,
                    },
                  ]}
                >
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
                    {t('voiceBash.recording.done')}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.recording.cancel')}
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
                  {t('voiceBash.transcribing.caption')}
                </Text>
              </View>
              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.transcribing.cancel')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'review' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                {t('voiceBash.review.title')}
              </Text>
              <Text
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
              >
                {t('voiceBash.review.body')}
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
                    {t('voiceBash.review.cancel')}
                  </Text>
                </Pressable>
                <Pressable testID="v2b-rerecord-review" onPress={handleRerecord} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    {t('voiceBash.review.rerecord')}
                  </Text>
                </Pressable>
                <Pressable
                  testID="v2b-confirm-send"
                  accessibilityRole="button"
                  accessibilityLabel={t('voiceBash.review.confirmSendA11yLabel')}
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
                    {t('voiceBash.review.confirmSend')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'generating' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                {t('voiceBash.generating.title')}
              </Text>

              {steps.length === 0 ? (
                <View style={styles.spinnerRow}>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface, marginLeft: 8 }]}>
                    {t('voiceBash.generating.placeholder')}
                  </Text>
                </View>
              ) : (
                <ScrollView
                  testID="v2b-timeline"
                  style={styles.timelineScroll}
                  indicatorStyle={isDark ? 'white' : 'default'}
                >
                  <View style={styles.timeline}>
                    {steps.map((e, idx) => (
                      <StepRow key={`${e.type}-${idx}`} event={e} />
                    ))}
                    <View style={styles.spinnerRow}>
                      <ActivityIndicator color={theme.colors.primary} size="small" />
                      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginLeft: 6 }]}>
                        {t('voiceBash.generating.inlineProgress')}
                      </Text>
                    </View>
                  </View>
                </ScrollView>
              )}

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.generating.cancel')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'confirming' && (
            <View style={styles.body}>
              <Text style={[theme.typography.titleMd, styles.titleText, { color: theme.colors.onSurface }]}>
                {t('voiceBash.confirm.title')}
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
                    {t('voiceBash.confirm.dangerWarning')}
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

              {mode === 'initial' && selectableDevices && selectableDevices.length >= 1 && (
                <View testID="v2b-device-picker" style={styles.pickerWrap}>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.confirm.runOnLabel')}
                  </Text>
                  <DevicePicker
                    entries={selectableDevices}
                    selectedId={chosenDeviceId}
                    onSelect={(entry) => {
                      setChosenDeviceId(entry.id);
                      setChosenCwd(entry.cwd);
                      setChosenDeviceName(entry.name);
                    }}
                  />
                </View>
              )}

              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.confirm.cancel')}
                  </Text>
                </Pressable>
                <Pressable testID="v2b-rerecord" onPress={handleRerecord} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    {t('voiceBash.confirm.rerecord')}
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
                {t('voiceBash.error.title')}
              </Text>
              <Text
                testID="v2b-error"
                style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={4}
              >
                {error || voiceStt.errorMessage || t('voiceBash.error.fallback')}
              </Text>
              <View style={styles.footerRow}>
                <Pressable testID="v2b-cancel" onPress={handleClose} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.error.cancel')}
                  </Text>
                </Pressable>
                <Pressable testID="v2b-retry" onPress={resetToRecording} style={styles.textBtn}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    {t('voiceBash.error.retry')}
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
    maxHeight: '80%',
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
  timelineScroll: {
    // Fixed cap (not flex) so the ScrollView scrolls when the timeline is long,
    // without depending on a parent's height. flex:1 here collapsed to 0 because
    // the panel has no definite height (content-sized up to its 80% maxHeight).
    maxHeight: 360,
  },
  stepRow: {
    gap: 4,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  snippet: {
    marginLeft: 14,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  pickerWrap: {
    gap: 4,
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
    maxHeight: 200,
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
