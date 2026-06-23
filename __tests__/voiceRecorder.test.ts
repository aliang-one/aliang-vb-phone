import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import { voiceRecorder } from '../src/services/voiceRecorder';

const audioStream = LiveAudioStream as jest.Mocked<typeof LiveAudioStream>;

describe('voiceRecorder', () => {
  let dataHandler: ((data: string) => void) | null = null;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  beforeEach(async () => {
    await voiceRecorder.stop();
    dataHandler = null;
    audioStream.init.mockClear();
    audioStream.start.mockClear();
    audioStream.stop.mockReset();
    audioStream.stop.mockResolvedValue('');
    audioStream.on.mockReset();
    audioStream.on.mockImplementation((_event, callback) => {
      dataHandler = callback;
    });
  });

  afterEach(async () => {
    await voiceRecorder.stop();
  });

  it('does not stack audio listeners and waits for a pending native stop before restart', async () => {
    const firstFrame = jest.fn();
    const secondFrame = jest.fn();

    await expect(voiceRecorder.start({ onAudioFrame: firstFrame })).resolves.toBe(true);
    expect(audioStream.init).toHaveBeenCalledTimes(1);
    expect(audioStream.on).toHaveBeenCalledTimes(1);
    expect(dataHandler).toBeTruthy();

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
    expect(audioStream.on).toHaveBeenCalledTimes(1);

    dataHandler?.(Buffer.from([1, 2, 3]).toString('base64'));
    expect(firstFrame).not.toHaveBeenCalled();
    expect(secondFrame).toHaveBeenCalledTimes(1);
  });
});
