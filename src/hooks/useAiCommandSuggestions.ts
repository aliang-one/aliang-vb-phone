import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useVoiceStt, type VoiceSttStatus } from './useVoiceStt';
import { generateCommand } from '../api/commandGen';
import { subscribeCommandGenEvents } from '../services/commandGenEvents';
import { commandGenErrorText } from '../utils/commandGenErrorText';
import {
  chipsFromCommandGenResult,
  mergeAiSuggestions,
  type AiSuggestionChip,
} from '../utils/aiSuggestions';

export type AiSuggestPhase = 'idle' | 'recording' | 'generating' | 'error';

export interface UseAiCommandSuggestionsOptions {
  deviceId: string;
  cwd: string;
  sessionId?: string;
  projectId?: string;
}

export interface UseAiCommandSuggestionsResult {
  phase: AiSuggestPhase;
  chips: AiSuggestionChip[];
  liveCaption: string;
  liveStatus: string;
  errorText: string;
  textMode: boolean;
  voiceStatus: VoiceSttStatus;
  startVoice: () => void;
  stopVoice: () => void;
  submitText: (text: string) => void;
  retry: () => void;
  clearChips: () => void;
  dismissError: () => void;
  openTextInput: () => void;
  closeTextInput: () => void;
  reset: () => void;
}

/**
 * Terminal AI-suggest flow (spec 2026-09-21): tap the FAB to record → STT →
 * straight into commandGen (no review step; editing belongs to the long-press
 * text path) → 1-3 suggestion chips. Live commandGen.step events feed
 * `liveStatus` while generating. reset() must be invoked when the terminal
 * session changes — stale chips must never execute in a different pty.
 */
export function useAiCommandSuggestions(
  options: UseAiCommandSuggestionsOptions,
): UseAiCommandSuggestionsResult {
  const { t } = useTranslation('terminal');
  const voiceStt = useVoiceStt();
  const [phase, setPhase] = useState<AiSuggestPhase>('idle');
  const [chips, setChips] = useState<AiSuggestionChip[]>([]);
  const [liveStatus, setLiveStatus] = useState('');
  const [errorText, setErrorText] = useState('');
  const [textMode, setTextMode] = useState(false);

  // Latest props/handlers in refs so STT's long-lived onComplete closure and
  // the unmount cleanup never go stale (same discipline as VoiceToBashModal).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cancelRef = useRef(voiceStt.cancel);
  cancelRef.current = voiceStt.cancel;
  const lastTextRef = useRef('');
  // Bumped on reset() so a response landing after a terminal switch is dropped
  // instead of merging the old terminal's chips into the new one.
  const generationTokenRef = useRef(0);
  // Single-flight: voice and text funnel into generate(); a second request
  // must never run while one is in flight (re-entry would race chips/phase).
  const generatingRef = useRef(false);

  const generate = useCallback(
    async (text: string) => {
      const opts = optionsRef.current;
      const trimmed = text.trim();
      if (!trimmed || !opts.deviceId) return;
      if (generatingRef.current) return;
      generatingRef.current = true;
      lastTextRef.current = trimmed;
      setTextMode(false);
      setLiveStatus('');
      setPhase('generating');
      const token = ++generationTokenRef.current;
      // Subscribe BEFORE firing the POST so the early commandGen.runStarted
      // (carrying the runId) can't be missed — same ordering as the modal.
      let activeRunId: string | null = null;
      const unsubscribe = subscribeCommandGenEvents(event => {
        if (token !== generationTokenRef.current) return;
        if (activeRunId === null) {
          if ('runId' in event && event.runId) activeRunId = event.runId;
          else return;
        } else if ('runId' in event && event.runId && event.runId !== activeRunId) {
          return;
        }
        if (
          event.type === 'commandGen.step' &&
          event.kind === 'tool_call' &&
          event.toolName
        ) {
          setLiveStatus(event.toolName);
        }
      });
      try {
        const result = await generateCommand({
          text: trimmed,
          deviceId: opts.deviceId,
          cwd: opts.cwd,
          mode: 'live',
          sessionId: opts.sessionId,
          projectId: opts.projectId,
        });
        if (token !== generationTokenRef.current) return;
        setChips(prev => mergeAiSuggestions(prev, chipsFromCommandGenResult(result)));
        setPhase('idle');
      } catch (e) {
        if (token !== generationTokenRef.current) return;
        setErrorText(commandGenErrorText(e, t));
        setPhase('error');
      } finally {
        if (token === generationTokenRef.current) generatingRef.current = false;
        unsubscribe();
      }
    },
    [t],
  );

  const startVoice = useCallback(() => {
    if (phase === 'recording' || phase === 'generating') return;
    Keyboard.dismiss();
    setErrorText('');
    setTextMode(false);
    setPhase('recording');
    void voiceStt.start({
      onComplete: text => {
        void generate(text);
      },
      sessionId: optionsRef.current.sessionId,
      projectPath: optionsRef.current.cwd,
      deviceId: optionsRef.current.deviceId,
    });
  }, [phase, voiceStt, generate]);

  const stopVoice = useCallback(() => {
    if (phase !== 'recording') return;
    void voiceStt.stop();
  }, [phase, voiceStt]);

  // A recording that ends in failure (permission drop, socket close with no
  // transcript, …) never fires onComplete — surface it instead of sitting in
  // `recording` forever.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (voiceStt.status !== 'error') return;
    setErrorText(voiceStt.errorMessage || t('aiSuggest.errorVoice'));
    setPhase('error');
  }, [phase, voiceStt.status, voiceStt.errorMessage, t]);

  const submitText = useCallback(
    (text: string) => {
      if (phase === 'recording' || phase === 'generating') return;
      void generate(text);
    },
    [phase, generate],
  );

  // STT failures land in error phase with empty lastText — retry then falls
  // back to restart recording instead of dead-ending.
  const retry = useCallback(() => {
    if (phase === 'generating') return;
    if (lastTextRef.current) {
      void generate(lastTextRef.current);
    } else {
      startVoice();
    }
  }, [phase, generate, startVoice]);

  const clearChips = useCallback(() => setChips([]), []);
  const dismissError = useCallback(() => {
    setErrorText('');
    setPhase(prev => (prev === 'error' ? 'idle' : prev));
  }, []);
  const openTextInput = useCallback(() => {
    if (phase !== 'idle') return;
    setTextMode(true);
  }, [phase]);
  const closeTextInput = useCallback(() => setTextMode(false), []);

  const reset = useCallback(() => {
    generationTokenRef.current += 1;
    generatingRef.current = false; // 悬挂中的 POST 不堵死下一个终端
    cancelRef.current();
    lastTextRef.current = '';
    setChips([]);
    setLiveStatus('');
    setErrorText('');
    setTextMode(false);
    setPhase('idle');
  }, []);

  // Unmount: kill any in-flight recording (a late stt.completed must not
  // resurrect state after the screen is gone).
  useEffect(() => () => cancelRef.current(), []);

  return {
    phase,
    chips,
    liveCaption: voiceStt.liveCaption,
    liveStatus,
    errorText,
    textMode,
    voiceStatus: voiceStt.status,
    startVoice,
    stopVoice,
    submitText,
    retry,
    clearChips,
    dismissError,
    openTextInput,
    closeTextInput,
    reset,
  };
}
