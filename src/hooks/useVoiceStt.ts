// Real-time voice → STT orchestration for the VibeCoding session.
//
// Owns the SttSocket + voiceRecorder lifecycle for a one-shot recording:
//   start()  -> begin mic capture immediately, open /ws/stt, stream PCM frames.
//   stop()   -> ask the server to finalize immediately, stop mic capture in the
//               background; stt.completed fires onComplete(transcript).
//   cancel() -> tear everything down without delivering a transcript.
//
// Kept as a self-contained hook so the screen only toggles start/stop and reads
// `status` / `liveCaption`; all transport + provider detail lives here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getApiAuthToken } from '../api/client';
import { SttSocket } from '../api/sttSocket';
import type { SttControlOut } from '../api/sttTypes';
import { voiceRecorder } from '../services/voiceRecorder';
import { appendFinalTranscript, buildLiveCaption } from '../utils/sttAccumulator';
import i18n from '../i18n';

export type VoiceSttStatus = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error';

export interface StartOptions {
  /** Fired once with the final transcript when the session completes. */
  onComplete?: (transcript: string) => void;
  /**
   * The vibecoding session this recording belongs to, so the server can persist
   * the audio + transcript scoped to user → project → session (admin 数据浏览).
   * Optional — a recording outside a session is stored user-level only.
   */
  sessionId?: string;
  projectPath?: string;
  deviceId?: string;
}

export interface UseVoiceSttResult {
  status: VoiceSttStatus;
  /** Live caption: committed finals + the in-flight partial. */
  liveCaption: string;
  errorMessage: string;
  // Resolves true if a new recording was actually started; false if rejected
  // because a previous recording is still in flight (idle/error are the only
  // states that admit a fresh start). Lets callers avoid clearing stale state
  // (e.g. a previous transcript) that they'd otherwise be left waiting on.
  start: (options?: StartOptions) => Promise<boolean>;
  stop: () => Promise<void>;
  cancel: () => void;
}

const LANG = 'zh-CN';
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS = 16;
// Must exceed the server's stop-completion path (STOP_SAFETY_MS 6s + NLS tail
// fallback up to 5s+quiet on a congested link, audit 2026-10-16 R4) — otherwise
// this local safety pre-empts the authoritative stt.completed and truncates.
const STOP_SAFETY_MS = 7_000;
const LIVE_CAPTION_THROTTLE_MS = 120;
const MAX_BUFFERED_AUDIO_BYTES = 512_000;
const MIN_RECORDING_MS = 450;
// Digital-silence watchdog (production WAV forensics 2026-10-27, user report
// "语音发出去后再录全是未识别到语音": after an iOS audio-session interruption the
// patched-native queue could STILL deliver all-zero PCM (peak 0 / rms 0 for the
// whole take) while the UI showed a healthy recording — the server faithfully
// returned an empty transcript and the user burned 8s+ per take. Detect the
// all-zero stream locally: 2s of strict digital silence (Int16 peak ≤ 1) trips
// ONE transparent recorder restart; if the stream is still silent 2s later,
// fail the take immediately instead of shipping zeros for the full duration.
// Real speech peaks in the hundreds; even room tone on a live MEMS mic is
// well above ±1 LSB, so false positives essentially require literal zeros.
const MIC_SILENCE_RESTART_BYTES = 64_000; // 2s of 16kHz/16-bit mono
const MIC_SILENCE_FAIL_BYTES = 128_000; // 4s of continuous digital silence
// iOS start() can fail silently natively (setCategory / AudioQueueNewInput only
// RCTLog) — the UI shows "recording" but zero frames ever arrive. Watchdog the
// FIRST frame instead (audit 2026-10-16 R2/R8). The window is 5s, NOT shorter:
// on a fresh install the system mic-permission dialog appears inside the native
// start() and NO frames flow until the user grants — killing the take at 800ms
// turned every first-run recording into a guaranteed error (review 2026-10-16).
// Proper pre-permission before arming is the follow-up fix; 5s covers the common
// grant-while-reading case while still bounding the silent-failure detection.
const CAPTURE_WATCHDOG_MS = 5_000;
// 450ms of 16kHz/16-bit mono. Below this, an empty transcript is a legitimate
// no-op; at/above it, real audio reached the server and came back with nothing.
const EMPTY_RESULT_MIN_AUDIO_BYTES = 14_400;

// Unique per recording: the server uses it as the stt_records primary key +
// audio filename, so a constant would collide across recordings.
const newRequestId = () =>
  `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// True when every PCM sample in the frame is (almost exactly) zero — the
// signature of a live capture pipeline that stopped seeing the microphone.
// A single real sample (room tone, breath, dither) breaks the streak.
const isDigitalSilence = (frame: ArrayBuffer): boolean => {
  if (frame.byteLength < 2 || frame.byteLength % 2 !== 0) return false;
  const samples = new Int16Array(frame);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (value > 1 || value < -1) return false;
  }
  return true;
};

const recorderErrorMessage = (message: string) =>
  message === 'voice_native_unavailable'
    ? i18n.t('common:voice.nativeUnavailable')
    : message === 'voice_recorder_busy'
      ? i18n.t('common:voice.recorderBusy')
    : message;

export function useVoiceStt(): UseVoiceSttResult {
  const [status, setStatus] = useState<VoiceSttStatus>('idle');
  const [liveCaption, setLiveCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const socketRef = useRef<SttSocket | null>(null);
  const transcriptRef = useRef('');
  const onCompleteRef = useRef<((transcript: string) => void) | null>(null);
  const finishWithRef = useRef<(text: string) => void>(() => undefined);
  const stopSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveCaptionRef = useRef('');
  const pendingLiveCaptionRef = useRef<string | null>(null);
  const liveCaptionFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferedAudioRef = useRef<ArrayBuffer[]>([]);
  const bufferedAudioBytesRef = useRef(0);
  // Set on the first onAudioFrame of a recording; drives the capture watchdog.
  const firstFrameSeenRef = useRef(false);
  const captureWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bytes actually handed to the socket (direct or flushed from the buffer) —
  // distinguishes "real audio reached the server" from a no-op tap.
  const sentAudioBytesRef = useRef(0);
  const recorderStopPromiseRef = useRef<Promise<void> | null>(null);
  const recorderStopRequestedRef = useRef(false);
  const audioStreamingReadyRef = useRef(false);
  const startSentRef = useRef(false);
  const recordingRequestedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  // Set by failWith: an in-flight start() continuation (e.g. the connect promise
  // finally settling after the capture watchdog already failed the take) must
  // not clobber the established error state back to idle (audit R8).
  const erroredRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  // Per-recording request id (server uses it as the stt_records PK + audio name).
  const requestIdRef = useRef('');
  // Digital-silence watchdog state (see MIC_SILENCE_* constants): consecutive
  // silent bytes this take, whether the one-shot recorder restart was used,
  // and whether that restart is currently in flight.
  const silentBytesRef = useRef(0);
  const captureRecoveredRef = useRef(false);
  const recoveringCaptureRef = useRef(false);

  const clearLiveCaptionFlush = useCallback(() => {
    if (!liveCaptionFlushTimerRef.current) return;
    clearTimeout(liveCaptionFlushTimerRef.current);
    liveCaptionFlushTimerRef.current = null;
    pendingLiveCaptionRef.current = null;
  }, []);

  const clearCaptureWatchdog = useCallback(() => {
    if (!captureWatchdogRef.current) return;
    clearTimeout(captureWatchdogRef.current);
    captureWatchdogRef.current = null;
  }, []);

  const setLiveCaptionNow = useCallback(
    (text: string) => {
      clearLiveCaptionFlush();
      if (liveCaptionRef.current === text) return;
      liveCaptionRef.current = text;
      setLiveCaption(text);
    },
    [clearLiveCaptionFlush],
  );

  const setLiveCaptionThrottled = useCallback((text: string) => {
    if (text === liveCaptionRef.current || text === pendingLiveCaptionRef.current) return;
    pendingLiveCaptionRef.current = text;
    if (liveCaptionFlushTimerRef.current) return;
    liveCaptionFlushTimerRef.current = setTimeout(() => {
      liveCaptionFlushTimerRef.current = null;
      const next = pendingLiveCaptionRef.current;
      pendingLiveCaptionRef.current = null;
      if (next === null || next === liveCaptionRef.current) return;
      liveCaptionRef.current = next;
      setLiveCaption(next);
    }, LIVE_CAPTION_THROTTLE_MS);
  }, []);

  const resetBufferedAudio = useCallback(() => {
    bufferedAudioRef.current = [];
    bufferedAudioBytesRef.current = 0;
    audioStreamingReadyRef.current = false;
    startSentRef.current = false;
  }, []);

  const armStopSafety = useCallback(() => {
    if (stopSafetyRef.current) clearTimeout(stopSafetyRef.current);
    stopSafetyRef.current = setTimeout(
      () => {
        // Local fallback when the server's stt.completed never arrives (dead
        // link past STOP_SAFETY_MS). Prefer the live caption over the bare
        // transcript: it already equals finals + the in-flight partial, which
        // is what the server's buildCompletedText would have delivered. Known
        // trade-off: that tail text is un-finalized quality (review 2026-10-16).
        const tail = pendingLiveCaptionRef.current ?? liveCaptionRef.current;
        finishWithRef.current(tail || transcriptRef.current);
      },
      STOP_SAFETY_MS,
    );
  }, []);

  const flushBufferedAudio = useCallback(() => {
    const socket = socketRef.current;
    if (!audioStreamingReadyRef.current || !socket?.isOpen) return;
    const chunks = bufferedAudioRef.current;
    bufferedAudioRef.current = [];
    bufferedAudioBytesRef.current = 0;
    chunks.forEach(chunk => {
      if (socket.sendBinary(chunk)) sentAudioBytesRef.current += chunk.byteLength;
    });
  }, []);

  const stopVoiceRecorder = useCallback(() => {
    if (recorderStopPromiseRef.current) return recorderStopPromiseRef.current;
    if (recorderStopRequestedRef.current) return Promise.resolve();
    recorderStopRequestedRef.current = true;
    const stopping = voiceRecorder.stop()
      .catch(() => undefined)
      .then(() => {
        if (recorderStopPromiseRef.current === stopping) {
          recorderStopPromiseRef.current = null;
        }
      });
    recorderStopPromiseRef.current = stopping;
    return stopping;
  }, []);

  const stopRecorderAndFlush = useCallback(async () => {
    await stopVoiceRecorder();
    flushBufferedAudio();
    audioStreamingReadyRef.current = false;
  }, [flushBufferedAudio, stopVoiceRecorder]);

  const cleanup = useCallback(() => {
    recordingRequestedRef.current = false;
    stopRequestedRef.current = false;
    if (stopSafetyRef.current) {
      clearTimeout(stopSafetyRef.current);
      stopSafetyRef.current = null;
    }
    clearCaptureWatchdog();
    clearLiveCaptionFlush();
    resetBufferedAudio();
    socketRef.current?.close();
    socketRef.current = null;
    stopVoiceRecorder();
  }, [clearCaptureWatchdog, clearLiveCaptionFlush, resetBufferedAudio, stopVoiceRecorder]);

  useEffect(() => () => cleanup(), [cleanup]);

  const finishWith = useCallback(
    (text: string) => {
      const cb = onCompleteRef.current;
      onCompleteRef.current = null;
      cleanup();
      setStatus('idle');
      setLiveCaptionNow('');
      cb?.(text);
    },
    [cleanup, setLiveCaptionNow],
  );
  finishWithRef.current = finishWith;

  const failWith = useCallback(
    (message: string, options?: { keepSocketOpen?: boolean }) => {
      recordingRequestedRef.current = false;
      stopRequestedRef.current = true;
      erroredRef.current = true;
      if (stopSafetyRef.current) {
        clearTimeout(stopSafetyRef.current);
        stopSafetyRef.current = null;
      }
      clearLiveCaptionFlush();
      clearCaptureWatchdog();
      resetBufferedAudio();
      stopVoiceRecorder();
      if (!options?.keepSocketOpen) {
        onCompleteRef.current = null;
        socketRef.current?.close();
        socketRef.current = null;
      }
      setStatus('error');
      setErrorMessage(message);
    },
    [clearCaptureWatchdog, clearLiveCaptionFlush, resetBufferedAudio, stopVoiceRecorder],
  );

  // One transparent shot at reviving a digitally-silent capture pipeline (see
  // MIC_SILENCE_* constants): recycle the native recorder mid-take — the STT
  // socket and server session keep running, only the mic path is swapped.
  const recoverCapture = useCallback(async () => {
    try {
      if (stopRequestedRef.current || !recordingRequestedRef.current) return;
      const recovered = await voiceRecorder.recover();
      // The user may have released (or the take already failed) while the
      // native swap was in flight: never let the recycled queue outlive the
      // take, and never clobber an established error state.
      if (stopRequestedRef.current || erroredRef.current) {
        void voiceRecorder.stop();
        return;
      }
      if (!recovered && recordingRequestedRef.current) {
        failWith(i18n.t('common:voice.micSilent'));
      }
    } catch {
      if (!stopRequestedRef.current && recordingRequestedRef.current) {
        failWith(i18n.t('common:voice.micSilent'));
      }
    } finally {
      recoveringCaptureRef.current = false;
    }
  }, [failWith]);

  const handleAudioFrame = useCallback(
    (frame: ArrayBuffer) => {
      if (!firstFrameSeenRef.current) {
        firstFrameSeenRef.current = true;
        clearCaptureWatchdog();
      }
      // Digital-silence accounting (see MIC_SILENCE_*). Any single real sample
      // resets the streak; sustained literal zeros mean the mic path is dead.
      if (isDigitalSilence(frame)) {
        silentBytesRef.current += frame.byteLength;
      } else {
        silentBytesRef.current = 0;
      }
      if (
        recordingRequestedRef.current &&
        !stopRequestedRef.current &&
        !recoveringCaptureRef.current
      ) {
        if (silentBytesRef.current >= MIC_SILENCE_FAIL_BYTES) {
          failWith(i18n.t('common:voice.micSilent'));
          return;
        }
        if (
          silentBytesRef.current >= MIC_SILENCE_RESTART_BYTES &&
          !captureRecoveredRef.current
        ) {
          captureRecoveredRef.current = true;
          recoveringCaptureRef.current = true;
          void recoverCapture();
        }
      }
      const socket = socketRef.current;
      if (audioStreamingReadyRef.current && socket?.isOpen) {
        if (socket.sendBinary(frame)) sentAudioBytesRef.current += frame.byteLength;
        return;
      }
      const byteLength = frame.byteLength;
      if (byteLength > MAX_BUFFERED_AUDIO_BYTES) return;
      while (bufferedAudioBytesRef.current + byteLength > MAX_BUFFERED_AUDIO_BYTES) {
        const dropped = bufferedAudioRef.current.shift();
        bufferedAudioBytesRef.current -= dropped?.byteLength ?? 0;
      }
      bufferedAudioRef.current.push(frame);
      bufferedAudioBytesRef.current += byteLength;
    },
    [clearCaptureWatchdog, failWith, recoverCapture],
  );

  // Fired when the recorder is "running" but the native layer never delivers a
  // single frame (iOS start() failures are silent: audit 2026-10-16 R2/R8).
  const armCaptureWatchdog = useCallback(() => {
    clearCaptureWatchdog();
    captureWatchdogRef.current = setTimeout(() => {
      captureWatchdogRef.current = null;
      if (!firstFrameSeenRef.current && recordingRequestedRef.current && !stopRequestedRef.current) {
        failWith(i18n.t('common:voice.captureSilent'));
      }
    }, CAPTURE_WATCHDOG_MS);
  }, [clearCaptureWatchdog, failWith]);

  const start = useCallback(
    async (options?: StartOptions) => {
      if (status !== 'idle' && status !== 'error') return false;
      setErrorMessage('');
      setLiveCaptionNow('');
      resetBufferedAudio();
      transcriptRef.current = '';
      firstFrameSeenRef.current = false;
      sentAudioBytesRef.current = 0;
      silentBytesRef.current = 0;
      captureRecoveredRef.current = false;
      recoveringCaptureRef.current = false;
      recordingStartedAtRef.current = Date.now();
      recorderStopRequestedRef.current = false;
      onCompleteRef.current = options?.onComplete ?? null;
      recordingRequestedRef.current = true;
      stopRequestedRef.current = false;
      erroredRef.current = false;
      const requestId = newRequestId();
      requestIdRef.current = requestId;

      const token = getApiAuthToken();
      if (!token) {
        recordingRequestedRef.current = false;
        setStatus('error');
        setErrorMessage(i18n.t('common:voice.notLoggedIn'));
        return false;
      }

      setStatus('connecting');
      const socket = new SttSocket(token, {
        onMessage: (msg: SttControlOut) => {
          if (msg.type === 'stt.started') {
            flushBufferedAudio();
          } else if (msg.type === 'stt.partial') {
            setLiveCaptionThrottled(buildLiveCaption(transcriptRef.current, msg.text));
          } else if (msg.type === 'stt.final') {
            transcriptRef.current = appendFinalTranscript(transcriptRef.current, msg.text);
            setLiveCaptionNow(transcriptRef.current);
          } else if (msg.type === 'stt.completed') {
            const text = msg.full_text || transcriptRef.current;
            if (!text.trim() && sentAudioBytesRef.current >= EMPTY_RESULT_MIN_AUDIO_BYTES) {
              // Real audio reached the server and came back with nothing — tell
              // the user instead of silently clearing the caption (audit R2:
              // 35% empty transcripts were indistinguishable from a dead mic).
              failWith(i18n.t('common:voice.noSpeechDetected'));
            } else {
              finishWith(text);
            }
          } else if (msg.type === 'stt.error') {
            if (!recordingRequestedRef.current) return;
            // A mid-stream error may still have captured real text (e.g. the
            // NLS gateway dropped after transcribing a sentence). Deliver what
            // we have rather than discarding it; only surface a hard error when
            // nothing was transcribed.
            const partial = transcriptRef.current;
            if (partial.trim()) {
              finishWith(partial);
            } else {
              failWith(msg.message || i18n.t('common:voice.recognizeFailed'), {
                keepSocketOpen: msg.code === 'duration_exceeded' || msg.code === 'idle_timeout',
              });
            }
          }
        },
        onClose: (code) => {
          if (!recordingRequestedRef.current) return;
          if (code !== 1000) {
            // Honor the "已保留已识别内容" promise: if we captured anything,
            // deliver it; otherwise this is a clean disconnect to retry.
            const partial = transcriptRef.current;
            if (partial.trim()) {
              finishWith(partial);
            } else {
              failWith(i18n.t('common:voice.connectionClosed'));
            }
          }
        },
        onError: () => {
          if (!recordingRequestedRef.current) return;
          const partial = transcriptRef.current;
          if (partial.trim()) {
            finishWith(partial);
          } else {
            failWith(i18n.t('common:voice.connectionError'));
          }
        },
      });
      socketRef.current = socket;
      const connected = socket.connect().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      try {
        let recorderStartError: string | null = null;
        const recording = await voiceRecorder.start({
          sampleRate: SAMPLE_RATE,
          onAudioFrame: handleAudioFrame,
          onError: (message) => {
            recorderStartError = recorderErrorMessage(message);
            failWith(recorderStartError);
          },
        });
        if (!recording) {
          if (recordingRequestedRef.current) {
            failWith(recorderStartError ?? recorderErrorMessage('voice_recorder_busy'));
          }
          return true;
        }
        if (stopRequestedRef.current || !recordingRequestedRef.current) {
          stopVoiceRecorder();
        }
        if (!stopRequestedRef.current && !recordingRequestedRef.current) {
          return true;
        }
        if (!stopRequestedRef.current) {
          setStatus('recording');
          armCaptureWatchdog();
        }
        const connectResult = await connected;
        if (!connectResult.ok) throw connectResult.error;
        if (erroredRef.current) return true; // failWith already handled this take
        if (!recordingRequestedRef.current && !stopRequestedRef.current) return true;
        const sent = socket.sendJson({
          type: 'stt.start',
          request_id: requestId,
          lang: LANG,
          sample_rate: SAMPLE_RATE,
          channels: CHANNELS,
          bits: BITS,
          // Scope the persisted recording to its vibecoding session so admin can
          // browse user → project → session → conversation + replay the audio.
          // device_id falls back to the platform so records are attributable even
          // when the caller has no device identity (was 426/500 NULL in prod,
          // audit 2026-10-16 R9).
          session_id: options?.sessionId,
          project_path: options?.projectPath,
          device_id: options?.deviceId ?? Platform.OS,
        });
        if (!sent) throw new Error('stt_start_not_sent');
        startSentRef.current = true;
        audioStreamingReadyRef.current = true;
        flushBufferedAudio();
        if (stopRequestedRef.current) {
          armStopSafety();
          await stopRecorderAndFlush();
          if (!stopRequestedRef.current) return true;
          const stopped = socket.sendJson({ type: 'stt.stop', request_id: requestId });
          if (stopped) {
            armStopSafety();
          } else {
            finishWith(transcriptRef.current);
          }
          return true;
        }
      } catch (error) {
        if (erroredRef.current) {
          // failWith already surfaced the real problem — don't clobber it.
          return true;
        }
        if (stopRequestedRef.current) {
          finishWith(transcriptRef.current);
          return true;
        }
        const message =
          error instanceof Error && error.message === 'stt_socket_connect_timeout'
            ? i18n.t('common:voice.connectTimeout')
            : error instanceof Error && error.message && !error.message.startsWith('stt_')
              ? error.message
              : i18n.t('common:voice.cannotConnect');
        if (!recordingRequestedRef.current) return true;
        failWith(message);
      }
      return true;
    },
    [
      status,
      failWith,
      finishWith,
      armCaptureWatchdog,
      armStopSafety,
      flushBufferedAudio,
      handleAudioFrame,
      resetBufferedAudio,
      setLiveCaptionNow,
      setLiveCaptionThrottled,
      stopRecorderAndFlush,
      stopVoiceRecorder,
    ],
  );

  const stop = useCallback(async () => {
    if (stopRequestedRef.current || status === 'stopping') {
      finishWith(transcriptRef.current);
      return;
    }
    if (!recordingRequestedRef.current && status !== 'recording' && status !== 'connecting') {
      return;
    }
    const recordingAge = Date.now() - recordingStartedAtRef.current;
    if (recordingAge >= 0 && recordingAge < MIN_RECORDING_MS) {
      await new Promise<void>(resolve =>
        setTimeout(resolve, MIN_RECORDING_MS - recordingAge),
      );
      if (!recordingRequestedRef.current && status !== 'recording' && status !== 'connecting') {
        return;
      }
    }
    const socket = socketRef.current;
    recordingRequestedRef.current = false;
    stopRequestedRef.current = true;
    setStatus('stopping');
    armStopSafety();
    if (socket && socket.isOpen && startSentRef.current) {
      await stopRecorderAndFlush();
      if (!stopRequestedRef.current) return;
      const sent = socket.sendJson({ type: 'stt.stop', request_id: requestIdRef.current });
      if (!sent) {
        finishWith(transcriptRef.current);
        return;
      }
      // The server replies stt.completed -> finishWith() via onMessage.
      // Safety: if it never arrives, deliver what we have.
      armStopSafety();
    } else {
      stopVoiceRecorder();
    }
  }, [status, armStopSafety, finishWith, stopRecorderAndFlush, stopVoiceRecorder]);

  const cancel = useCallback(() => {
    onCompleteRef.current = null;
    cleanup();
    setStatus('idle');
    setLiveCaptionNow('');
  }, [cleanup, setLiveCaptionNow]);

  // 引用稳定:聊天屏把整个对象作为 prop 传给 React.memo 的 MessageComposer,
  // 裸 return 每次渲染都产生新对象会击穿 memo。六个成员本身都已稳定
  // (useState 值 + useCallback),只在真变化时才换引用。
  return useMemo(
    () => ({ status, liveCaption, errorMessage, start, stop, cancel }),
    [status, liveCaption, errorMessage, start, stop, cancel],
  );
}
