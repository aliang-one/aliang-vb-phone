import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import { voiceRecorder } from '../src/services/voiceRecorder';

const audioStream = LiveAudioStream as jest.Mocked<typeof LiveAudioStream>;

describe('voiceRecorder', () => {
  let dataHandler: ((data: string) => void) | null = null;
  let errorHandler: ((payload: unknown) => void) | null = null;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    // The patched native module emits two events; route by name so tests can
    // drive either path. The upstream .d.ts only types 'data', so the event
    // name is narrowed locally. Installed ONCE for the whole file: the service
    // attaches its listeners on the first start() and never re-subscribes
    // (dataListenerAttached guard), so the captured handlers persist across
    // tests and always route to the CURRENT options object.
    audioStream.on.mockImplementation((event, callback) => {
      const name = event as 'data' | 'error';
      const handler = callback as (payload: unknown) => void;
      if (name === 'error') {
        errorHandler = handler;
      } else {
        dataHandler = handler;
      }
    });
  });

  beforeEach(async () => {
    await voiceRecorder.stop();
    audioStream.init.mockClear();
    audioStream.start.mockClear();
    audioStream.stop.mockReset();
    audioStream.stop.mockResolvedValue('');
    audioStream.on.mockClear(); // keep the routing implementation, clear calls
  });

  afterEach(async () => {
    await voiceRecorder.stop();
  });

  it('does not stack audio listeners and waits for a pending native stop before restart', async () => {
    const firstFrame = jest.fn();
    const secondFrame = jest.fn();

    await expect(voiceRecorder.start({ onAudioFrame: firstFrame })).resolves.toBe(true);
    expect(audioStream.init).toHaveBeenCalledTimes(1);
    // First (and only) subscribe: data + error events.
    expect(audioStream.on).toHaveBeenCalledTimes(2);
    expect(dataHandler).toBeTruthy();
    expect(errorHandler).toBeTruthy();

    let resolveNativeStop!: (value: string) => void;
    audioStream.stop.mockReturnValueOnce(
      new Promise<string>(resolve => {
        resolveNativeStop = resolve;
      }),
    );
    const stopPromise = voiceRecorder.stop();
    const secondStartPromise = voiceRecorder.start({ onAudioFrame: secondFrame });

    await Promise.resolve();
    expect(audioStream.init).toHaveBeenCalledTimes(1);

    resolveNativeStop('');
    await stopPromise;
    await expect(secondStartPromise).resolves.toBe(true);

    expect(audioStream.init).toHaveBeenCalledTimes(2);
    // Still no re-subscribe after the restart — no stacked listeners.
    expect(audioStream.on).toHaveBeenCalledTimes(2);

    dataHandler?.(Buffer.from([1, 2, 3]).toString('base64'));
    expect(firstFrame).not.toHaveBeenCalled();
    expect(secondFrame).toHaveBeenCalledTimes(1);
  });

  it('surfaces native capture errors through onError while recording', async () => {
    const onError = jest.fn();
    const onAudioFrame = jest.fn();

    await expect(voiceRecorder.start({ onAudioFrame, onError })).resolves.toBe(true);

    // The handler closure routes to the CURRENT options — the subscribe
    // happened on the file's first start, not this one.
    errorHandler?.({ message: 'audio session activation failed' });
    expect(onError).toHaveBeenCalledWith('audio session activation failed');

    // Frames keep flowing — an error event alone doesn't stop the capture.
    dataHandler?.(Buffer.from([9, 9]).toString('base64'));
    expect(onAudioFrame).toHaveBeenCalledTimes(1);
  });

  it('ignores native capture errors when nothing is recording', async () => {
    const onError = jest.fn();
    await expect(voiceRecorder.start({ onAudioFrame: jest.fn(), onError })).resolves.toBe(true);
    await voiceRecorder.stop();

    errorHandler?.({ message: 'audio queue start failed (-50)' });
    expect(onError).not.toHaveBeenCalled();
  });

  describe('recover', () => {
    it('recycles the native recorder with the same options mid-take', async () => {
      const onAudioFrame = jest.fn();
      await expect(voiceRecorder.start({ onAudioFrame })).resolves.toBe(true);

      await expect(voiceRecorder.recover()).resolves.toBe(true);
      // stop + start against the native module, init re-run with same config.
      expect(audioStream.stop).toHaveBeenCalledTimes(1);
      expect(audioStream.init).toHaveBeenCalledTimes(2);
      expect(audioStream.start).toHaveBeenCalledTimes(2);

      // No listener re-subscribe during recovery (no stacking), and the
      // persistent data handler still routes frames to the current options.
      expect(audioStream.on).not.toHaveBeenCalled();
      dataHandler?.(Buffer.from([1, 1]).toString('base64'));
      expect(onAudioFrame).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when nothing is recording', async () => {
      await expect(voiceRecorder.recover()).resolves.toBe(false);
      expect(audioStream.stop).not.toHaveBeenCalled();
      expect(audioStream.init).not.toHaveBeenCalled();
    });

    it('returns false when the restarted recorder fails to start', async () => {
      await expect(voiceRecorder.start({ onAudioFrame: jest.fn() })).resolves.toBe(true);
      audioStream.start.mockImplementationOnce(() => {
        throw new Error('audio session activation failed');
      });
      await expect(voiceRecorder.recover()).resolves.toBe(false);
    });
  });
});
