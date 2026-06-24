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
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiAuthToken } from '../api/client';
import { SttSocket } from '../api/sttSocket';
import type { SttControlOut } from '../api/sttTypes';
import { voiceRecorder } from '../services/voiceRecorder';
import { appendFinalTranscript, buildLiveCaption } from '../utils/sttAccumulator';

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
}

export interface UseVoiceSttResult {
  status: VoiceSttStatus;
  /** Live caption: committed finals + the in-flight partial. */
  liveCaption: string;
  errorMessage: string;
  start: (options?: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

const LANG = 'zh-CN';
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS = 16;
const STOP_SAFETY_MS = 3_000;
const LIVE_CAPTION_THROTTLE_MS = 120;
const MAX_BUFFERED_AUDIO_BYTES = 512_000;
const MIN_RECORDING_MS = 450;

// Unique per recording: the server uses it as the stt_records primary key +
// audio filename, so a constant would collide across recordings.
const newRequestId = () =>
  `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const recorderErrorMessage = (message: string) =>
  message === 'voice_native_unavailable'
    ? '语音输入不可用:原生音频模块未安装,请重新构建 App(iOS 需 pod install)'
    : message === 'voice_recorder_busy'
      ? '录音设备仍在释放，请稍后重试'
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
  const recorderStopPromiseRef = useRef<Promise<void> | null>(null);
  const recorderStopRequestedRef = useRef(false);
  const audioStreamingReadyRef = useRef(false);
  const startSentRef = useRef(false);
  const recordingRequestedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  // Per-recording request id (server uses it as the stt_records PK + audio name).
  const requestIdRef = useRef('');

  const clearLiveCaptionFlush = useCallback(() => {
    if (!liveCaptionFlushTimerRef.current) return;
    clearTimeout(liveCaptionFlushTimerRef.current);
    liveCaptionFlushTimerRef.current = null;
    pendingLiveCaptionRef.current = null;
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
      () => finishWithRef.current(transcriptRef.current),
      STOP_SAFETY_MS,
    );
  }, []);

  const flushBufferedAudio = useCallback(() => {
    const socket = socketRef.current;
    if (!audioStreamingReadyRef.current || !socket?.isOpen) return;
    const chunks = bufferedAudioRef.current;
    bufferedAudioRef.current = [];
    bufferedAudioBytesRef.current = 0;
    chunks.forEach(chunk => socket.sendBinary(chunk));
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

  const handleAudioFrame = useCallback((frame: ArrayBuffer) => {
    const socket = socketRef.current;
    if (audioStreamingReadyRef.current && socket?.isOpen) {
      socket.sendBinary(frame);
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
  }, []);

  const cleanup = useCallback(() => {
    recordingRequestedRef.current = false;
    stopRequestedRef.current = false;
    if (stopSafetyRef.current) {
      clearTimeout(stopSafetyRef.current);
      stopSafetyRef.current = null;
    }
    clearLiveCaptionFlush();
    resetBufferedAudio();
    socketRef.current?.close();
    socketRef.current = null;
    stopVoiceRecorder();
  }, [clearLiveCaptionFlush, resetBufferedAudio, stopVoiceRecorder]);

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
      if (stopSafetyRef.current) {
        clearTimeout(stopSafetyRef.current);
        stopSafetyRef.current = null;
      }
      clearLiveCaptionFlush();
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
    [clearLiveCaptionFlush, resetBufferedAudio, stopVoiceRecorder],
  );

  const start = useCallback(
    async (options?: StartOptions) => {
      if (status !== 'idle' && status !== 'error') return;
      setErrorMessage('');
      setLiveCaptionNow('');
      resetBufferedAudio();
      transcriptRef.current = '';
      recordingStartedAtRef.current = Date.now();
      recorderStopRequestedRef.current = false;
      onCompleteRef.current = options?.onComplete ?? null;
      recordingRequestedRef.current = true;
      stopRequestedRef.current = false;
      const requestId = newRequestId();
      requestIdRef.current = requestId;

      const token = getApiAuthToken();
      if (!token) {
        recordingRequestedRef.current = false;
        setStatus('error');
        setErrorMessage('未登录，无法使用语音输入');
        return;
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
            finishWith(msg.full_text || transcriptRef.current);
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
              failWith(msg.message || '语音识别失败', {
                keepSocketOpen: msg.code === 'duration_exceeded',
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
              failWith('语音连接已断开，请重试');
            }
          }
        },
        onError: () => {
          if (!recordingRequestedRef.current) return;
          const partial = transcriptRef.current;
          if (partial.trim()) {
            finishWith(partial);
          } else {
            failWith('语音连接错误');
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
          return;
        }
        if (stopRequestedRef.current || !recordingRequestedRef.current) {
          stopVoiceRecorder();
        }
        if (!stopRequestedRef.current && !recordingRequestedRef.current) {
          return;
        }
        if (!stopRequestedRef.current) {
          setStatus('recording');
        }
        const connectResult = await connected;
        if (!connectResult.ok) throw connectResult.error;
        if (!recordingRequestedRef.current && !stopRequestedRef.current) return;
        const sent = socket.sendJson({
          type: 'stt.start',
          request_id: requestId,
          lang: LANG,
          sample_rate: SAMPLE_RATE,
          channels: CHANNELS,
          bits: BITS,
          // Scope the persisted recording to its vibecoding session so admin can
          // browse user → project → session → conversation + replay the audio.
          session_id: options?.sessionId,
          project_path: options?.projectPath,
        });
        if (!sent) throw new Error('stt_start_not_sent');
        startSentRef.current = true;
        audioStreamingReadyRef.current = true;
        flushBufferedAudio();
        if (stopRequestedRef.current) {
          armStopSafety();
          await stopRecorderAndFlush();
          if (!stopRequestedRef.current) return;
          const stopped = socket.sendJson({ type: 'stt.stop', request_id: requestId });
          if (stopped) {
            armStopSafety();
          } else {
            finishWith(transcriptRef.current);
          }
          return;
        }
      } catch (error) {
        if (stopRequestedRef.current) {
          finishWith(transcriptRef.current);
          return;
        }
        const message =
          error instanceof Error && error.message && !error.message.startsWith('stt_')
            ? error.message
            : '无法连接语音服务';
        if (!recordingRequestedRef.current) return;
        failWith(message);
      }
    },
    [
      status,
      failWith,
      finishWith,
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

  return { status, liveCaption, errorMessage, start, stop, cancel };
}
