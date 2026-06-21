// Real-time voice → STT orchestration for the VibeCoding session.
//
// Owns the SttSocket + voiceRecorder lifecycle for a one-shot recording:
//   start()  -> open /ws/stt, begin mic capture, stream PCM frames.
//   stop()   -> stop the mic, ask the server to finalize; the server replies
//               stt.completed, which fires onComplete(transcript).
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

// Unique per recording: the server uses it as the stt_records primary key +
// audio filename, so a constant would collide across recordings.
const newRequestId = () =>
  `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const recorderErrorMessage = (message: string) =>
  message === 'voice_native_unavailable'
    ? '语音输入不可用:原生音频模块未安装,请重新构建 App(iOS 需 pod install)'
    : message;

export function useVoiceStt(): UseVoiceSttResult {
  const [status, setStatus] = useState<VoiceSttStatus>('idle');
  const [liveCaption, setLiveCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const socketRef = useRef<SttSocket | null>(null);
  const transcriptRef = useRef('');
  const onCompleteRef = useRef<((transcript: string) => void) | null>(null);
  const stopSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRequestedRef = useRef(false);
  // Per-recording request id (server uses it as the stt_records PK + audio name).
  const requestIdRef = useRef('');

  const cleanup = useCallback(() => {
    recordingRequestedRef.current = false;
    if (stopSafetyRef.current) {
      clearTimeout(stopSafetyRef.current);
      stopSafetyRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    void voiceRecorder.stop();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const finishWith = useCallback(
    (text: string) => {
      const cb = onCompleteRef.current;
      onCompleteRef.current = null;
      cleanup();
      setStatus('idle');
      setLiveCaption('');
      cb?.(text);
    },
    [cleanup],
  );

  const failWith = useCallback(
    (message: string, options?: { keepSocketOpen?: boolean }) => {
      recordingRequestedRef.current = false;
      if (stopSafetyRef.current) {
        clearTimeout(stopSafetyRef.current);
        stopSafetyRef.current = null;
      }
      void voiceRecorder.stop();
      if (!options?.keepSocketOpen) {
        onCompleteRef.current = null;
        socketRef.current?.close();
        socketRef.current = null;
      }
      setStatus('error');
      setErrorMessage(message);
    },
    [],
  );

  const start = useCallback(
    async (options?: StartOptions) => {
      if (status !== 'idle' && status !== 'error') return;
      setErrorMessage('');
      setLiveCaption('');
      transcriptRef.current = '';
      onCompleteRef.current = options?.onComplete ?? null;
      recordingRequestedRef.current = true;

      const token = getApiAuthToken();
      if (!token) {
        recordingRequestedRef.current = false;
        setStatus('error');
        setErrorMessage('未登录，无法使用语音输入');
        return;
      }

      setStatus('connecting');
      let resolveStarted: (() => void) | null = null;
      let rejectStarted: ((error: Error) => void) | null = null;
      const started = new Promise<void>((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      });
      const socket = new SttSocket(token, {
        onMessage: (msg: SttControlOut) => {
          if (msg.type === 'stt.started') {
            resolveStarted?.();
            resolveStarted = null;
            rejectStarted = null;
          } else if (msg.type === 'stt.partial') {
            setLiveCaption(buildLiveCaption(transcriptRef.current, msg.text));
          } else if (msg.type === 'stt.final') {
            transcriptRef.current = appendFinalTranscript(transcriptRef.current, msg.text);
            setLiveCaption(transcriptRef.current);
          } else if (msg.type === 'stt.completed') {
            resolveStarted?.();
            resolveStarted = null;
            rejectStarted = null;
            finishWith(msg.full_text || transcriptRef.current);
          } else if (msg.type === 'stt.error') {
            const message = msg.message || '语音识别失败';
            rejectStarted?.(new Error(message));
            resolveStarted = null;
            rejectStarted = null;
            if (!recordingRequestedRef.current) return;
            failWith(message, { keepSocketOpen: msg.code === 'duration_exceeded' });
          }
        },
        onClose: (code) => {
          rejectStarted?.(new Error('语音连接已断开，已保留已识别内容'));
          resolveStarted = null;
          rejectStarted = null;
          if (!recordingRequestedRef.current) return;
          if (code !== 1000) {
            failWith('语音连接已断开，已保留已识别内容');
          }
        },
        onError: () => {
          rejectStarted?.(new Error('语音连接错误'));
          resolveStarted = null;
          rejectStarted = null;
          if (!recordingRequestedRef.current) return;
          failWith('语音连接错误');
        },
      });
      socketRef.current = socket;

      try {
        await socket.connect();
        if (!recordingRequestedRef.current) return;
        const requestId = newRequestId();
        requestIdRef.current = requestId;
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
        await started;
        if (!recordingRequestedRef.current) return;
        const recording = await voiceRecorder.start({
          sampleRate: SAMPLE_RATE,
          onAudioFrame: (frame) => socket.sendBinary(frame),
          onError: (message) => failWith(recorderErrorMessage(message)),
        });
        if (!recording) {
          setStatus('error');
          cleanup();
          return;
        }
        setStatus('recording');
      } catch (error) {
        const message =
          error instanceof Error && error.message && !error.message.startsWith('stt_')
            ? error.message
            : '无法连接语音服务';
        if (!recordingRequestedRef.current) return;
        failWith(message);
      }
    },
    [status, cleanup, failWith, finishWith],
  );

  const stop = useCallback(async () => {
    if (!recordingRequestedRef.current && status !== 'recording' && status !== 'connecting') {
      return;
    }
    const socket = socketRef.current;
    recordingRequestedRef.current = false;
    setStatus('stopping');
    await voiceRecorder.stop();
    if (socket && socket.isOpen) {
      socket.sendJson({ type: 'stt.stop', request_id: requestIdRef.current });
      // The server replies stt.completed -> finishWith() via onMessage.
      // Safety: if it never arrives, deliver what we have.
      stopSafetyRef.current = setTimeout(() => finishWith(transcriptRef.current), STOP_SAFETY_MS);
    } else {
      finishWith(transcriptRef.current);
    }
  }, [status, finishWith]);

  const cancel = useCallback(() => {
    onCompleteRef.current = null;
    cleanup();
    setStatus('idle');
    setLiveCaption('');
  }, [cleanup]);

  return { status, liveCaption, errorMessage, start, stop, cancel };
}
