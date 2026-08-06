// Mic capture for real-time STT. Wraps react-native-live-audio-stream, which
// streams base64-encoded PCM frames. We decode each frame and forward an
// ArrayBuffer (16 kHz / 16-bit / mono — what Aliyun NLS realtime ASR expects)
// to the caller, which sends it as a binary WebSocket frame over /ws/stt.
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';
import i18n from '../i18n';

export type VoiceRecorderState = 'idle' | 'recording' | 'error';

export interface VoiceRecorderOptions {
  /** PCM sample rate. 16000 matches Aliyun NLS realtime ASR. */
  sampleRate?: number;
  /** Receives each decoded PCM frame as an ArrayBuffer. */
  onAudioFrame: (frame: ArrayBuffer) => void;
  /** Optional error callback (permission denied, init failure, ...). */
  onError?: (message: string) => void;
}

const DEFAULT_SAMPLE_RATE = 16_000;
const NATIVE_STOP_TIMEOUT_MS = 900;

// The minimal surface of react-native-live-audio-stream we use.
interface LiveAudioStreamApi {
  init(options: Record<string, unknown>): void;
  start(): void;
  stop(): Promise<void> | void;
  on(event: 'data', callback: (data: string) => void): unknown;
}

/**
 * react-native-live-audio-stream is an OPTIONAL native module. If it isn't
 * linked into the native build (iOS without `pod install`, a fresh checkout,
 * Expo Go, etc.) then `NativeModules.RNLiveAudioStream` is null and the
 * library throws `new NativeEventEmitter() requires a non-null argument` at
 * module-eval time. We must NOT statically import it — that would evaluate the
 * module eagerly and crash the whole app / chat screen. Require it lazily,
 * guarded by try/catch, so a missing module degrades gracefully (voice simply
 * unavailable) instead of crashing.
 */
let liveAudioStream: LiveAudioStreamApi | null | undefined;

/** Resolve when `promise` settles OR `ms` elapses, whichever comes first.
 * Distinct from a rejecting `withTimeout`: a slow native stop is intentionally
 * treated as success here, so the timeout RESOLVES (never rejects). The timer
 * is cleared on settlement so a fast native stop doesn't leave a pending
 * setTimeout (which Jest's --detectOpenHandles flags and which masks real
 * resource leaks). */
function raceOrTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([Promise.resolve(promise).then(() => undefined), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function patchLiveAudioStreamEmitterMethods(): void {
  const nativeModule = (NativeModules as {
    RNLiveAudioStream?: {
      addListener?: unknown;
      removeListeners?: unknown;
    };
  }).RNLiveAudioStream;
  if (!nativeModule) return;
  if (typeof nativeModule.addListener !== 'function') {
    nativeModule.addListener = () => undefined;
  }
  if (typeof nativeModule.removeListeners !== 'function') {
    nativeModule.removeListeners = () => undefined;
  }
}

function getLiveAudioStream(): LiveAudioStreamApi | null {
  if (liveAudioStream !== undefined) return liveAudioStream;
  try {
    // require() runs the module factory synchronously; if the native module is
    // absent the factory throws (NativeEventEmitter constructor) and we catch
    // it here, caching null so we only pay the check once.
    patchLiveAudioStreamEmitterMethods();
    const mod = require('react-native-live-audio-stream') as
      | (LiveAudioStreamApi & { default?: LiveAudioStreamApi })
      | undefined;
    liveAudioStream = (mod && (mod.default ?? mod)) || null;
  } catch {
    liveAudioStream = null;
  }
  return liveAudioStream;
}

class VoiceRecorderService {
  private state: VoiceRecorderState = 'idle';
  private options: VoiceRecorderOptions | null = null;
  private dataListenerAttached = false;
  private stopPromise: Promise<void> | null = null;

  getState(): VoiceRecorderState {
    return this.state;
  }

  /**
   * Ensure mic access. On Android this requests RECORD_AUDIO at runtime; on iOS
   * the system prompts on first mic use, so there is nothing to request here.
   */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: i18n.t('common:permission.micTitle'),
          message: i18n.t('common:permission.micMessage'),
          buttonNeutral: i18n.t('common:permission.buttonLater'),
          buttonNegative: i18n.t('common:permission.buttonDeny'),
          buttonPositive: i18n.t('common:permission.buttonAllow'),
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  async start(options: VoiceRecorderOptions): Promise<boolean> {
    if (this.stopPromise) {
      await this.stopPromise;
    }
    if (this.state === 'recording') return false;
    this.options = options;

    const api = getLiveAudioStream();
    if (!api) {
      // Native audio module not linked into this build — voice is unavailable.
      this.state = 'error';
      this.options.onError?.('voice_native_unavailable');
      this.options = null;
      return false;
    }

    const granted = await this.requestPermission();
    if (!granted) {
      this.state = 'error';
      this.options.onError?.('microphone_permission_denied');
      this.options = null;
      return false;
    }

    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    try {
      api.init({
        sampleRate,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6, // VOICE_RECOGNITION — best for ASR on Android
        wavFile: '', // no file output; we only stream live frames
      });
      this.attachDataListener(api);
      this.state = 'recording';
      api.start();
      return true;
    } catch (e) {
      this.state = 'error';
      this.options.onError?.((e as Error).message);
      this.options = null;
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }
    if (this.state !== 'recording') {
      this.state = 'idle';
      this.options = null;
      return;
    }
    const activeOptions = this.options;
    const nativeStop = Promise.resolve(getLiveAudioStream()?.stop())
      .catch(() => {
        // ignore
      });
    let stopping!: Promise<void>;
    stopping = raceOrTimeout(nativeStop, NATIVE_STOP_TIMEOUT_MS)
      .then(() => {
        if (this.options === activeOptions) {
          this.options = null;
        }
        this.state = 'idle';
        if (this.stopPromise === stopping) {
          this.stopPromise = null;
        }
      });
    this.stopPromise = stopping;
    await stopping;
  }

  private attachDataListener(api: LiveAudioStreamApi) {
    if (this.dataListenerAttached) return;
    api.on('data', (data: string) => {
      if (this.state !== 'recording') return;
      try {
        const buf = Buffer.from(data, 'base64');
        // Slice to a tight ArrayBuffer (the Buffer's backing buffer may be larger).
        const frame = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        this.options?.onAudioFrame(frame);
      } catch {
        // Ignore a single bad frame rather than aborting the session.
      }
    });
    this.dataListenerAttached = true;
  }
}

export const voiceRecorder = new VoiceRecorderService();
