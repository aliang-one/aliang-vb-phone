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

const REQUEST_ID = 'voice-stt';
const LANG = 'zh-CN';
const SAMPLE_RATE = 16_000;
const STOP_SAFETY_MS = 3_000;

export function useVoiceStt(): UseVoiceSttResult {
  const [status, setStatus] = useState<VoiceSttStatus>('idle');
  const [liveCaption, setLiveCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const socketRef = useRef<SttSocket | null>(null);
  const transcriptRef = useRef('');
  const onCompleteRef = useRef<((transcript: string) => void) | null>(null);
  const stopSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
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

  const start = useCallback(
    async (options?: StartOptions) => {
      if (status !== 'idle' && status !== 'error') return;
      setErrorMessage('');
      setLiveCaption('');
      transcriptRef.current = '';
      onCompleteRef.current = options?.onComplete ?? null;

      const token = getApiAuthToken();
      if (!token) {
        setStatus('error');
        setErrorMessage('未登录，无法使用语音输入');
        return;
      }

      setStatus('connecting');
      const socket = new SttSocket(token, {
        onMessage: (msg: SttControlOut) => {
          if (msg.type === 'stt.partial') {
            setLiveCaption(buildLiveCaption(transcriptRef.current, msg.text));
          } else if (msg.type === 'stt.final') {
            transcriptRef.current = appendFinalTranscript(transcriptRef.current, msg.text);
            setLiveCaption(transcriptRef.current);
          } else if (msg.type === 'stt.completed') {
            finishWith(msg.full_text || transcriptRef.current);
          } else if (msg.type === 'stt.error') {
            setStatus('error');
            setErrorMessage(msg.message || '语音识别失败');
          }
        },
        onClose: (code) => {
          setStatus((s) => (s === 'idle' ? s : 'error'));
          if (code !== 1000) {
            setErrorMessage('语音连接已断开，已保留已识别内容');
          }
        },
        onError: () => {
          setStatus('error');
          setErrorMessage('语音连接错误');
        },
      });
      socketRef.current = socket;

      const recording = await voiceRecorder.start({
        onAudioFrame: (frame) => socket.sendBinary(frame),
        onError: (message) => {
          setStatus('error');
          setErrorMessage(
            message === 'voice_native_unavailable'
              ? '语音输入不可用:原生音频模块未安装,请重新构建 App(iOS 需 pod install)'
              : message,
          );
        },
      });
      if (!recording) {
        // voiceRecorder already set an error message via its onError.
        setStatus('error');
        cleanup();
        return;
      }

      try {
        await socket.connect();
        socket.sendJson({ type: 'stt.start', request_id: REQUEST_ID, lang: LANG, sample_rate: SAMPLE_RATE });
        setStatus('recording');
      } catch {
        setStatus('error');
        setErrorMessage('无法连接语音服务');
        cleanup();
      }
    },
    [status, cleanup, finishWith],
  );

  const stop = useCallback(async () => {
    const socket = socketRef.current;
    setStatus('stopping');
    await voiceRecorder.stop();
    if (socket && socket.isOpen) {
      socket.sendJson({ type: 'stt.stop', request_id: REQUEST_ID });
      // The server replies stt.completed -> finishWith() via onMessage.
      // Safety: if it never arrives, deliver what we have.
      stopSafetyRef.current = setTimeout(() => finishWith(transcriptRef.current), STOP_SAFETY_MS);
    } else {
      finishWith(transcriptRef.current);
    }
  }, [finishWith]);

  const cancel = useCallback(() => {
    onCompleteRef.current = null;
    cleanup();
    setStatus('idle');
    setLiveCaption('');
  }, [cleanup]);

  return { status, liveCaption, errorMessage, start, stop, cancel };
}
