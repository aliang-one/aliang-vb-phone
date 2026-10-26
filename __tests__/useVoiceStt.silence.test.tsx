import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useVoiceStt, type UseVoiceSttResult } from '../src/hooks/useVoiceStt';
import type { SttControlOut } from '../src/api/sttTypes';

jest.useFakeTimers();

// Regression harness for the production incident of 2026-10-27 (凌晨 03:06):
// after an iOS audio-session interruption the capture pipeline delivered
// ALL-ZERO PCM for whole takes — the server saw real bytes, returned an empty
// transcript, and the user got a misleading "未识别到语音内容" after 8s+ of
// talking. These tests pin the digital-silence watchdog: one transparent
// recorder restart at 2s of strict silence, a hard error at 4s.

const mockLifecycle: string[] = [];
const mockSocketInstances: Array<{
  handlers: {
    onMessage: (msg: SttControlOut) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: () => void;
  };
  connect: jest.Mock<Promise<void>, []>;
  sendJson: jest.Mock<boolean, [{ type?: string }]>;
  sendBinary: jest.Mock<boolean, [unknown]>;
  close: jest.Mock<void, []>;
  isOpen: boolean;
}> = [];
let mockAudioFrameHandler: ((frame: ArrayBuffer) => void) | undefined;
let pendingConnectResolve: (() => void) | undefined;

const mockGetApiAuthToken = jest.fn(() => 'token-1');
const mockVoiceRecorderStart = jest.fn(async (options: { onAudioFrame?: (frame: ArrayBuffer) => void }) => {
  mockLifecycle.push('recorder.start');
  mockAudioFrameHandler = options.onAudioFrame;
  return true;
});
const mockVoiceRecorderStop = jest.fn(async () => {
  mockLifecycle.push('recorder.stop');
});
const mockVoiceRecorderRecover = jest.fn(async () => {
  mockLifecycle.push('recorder.recover');
  return true;
});

jest.mock('../src/api/client', () => ({
  getApiAuthToken: () => mockGetApiAuthToken(),
}));

jest.mock('../src/api/sttSocket', () => ({
  SttSocket: jest.fn().mockImplementation((_token: string, handlers: unknown) => {
    const instance = {
      handlers: handlers as (typeof mockSocketInstances)[number]['handlers'],
      connect: jest.fn(
        () =>
          new Promise<void>(resolve => {
            mockLifecycle.push('socket.connect');
            pendingConnectResolve = resolve;
          }),
      ),
      sendJson: jest.fn((msg: { type?: string }) => {
        mockLifecycle.push(`socket.sendJson:${msg.type ?? ''}`);
        return true;
      }),
      sendBinary: jest.fn((_data: unknown) => true),
      close: jest.fn(() => {
        mockLifecycle.push('socket.close');
        instance.isOpen = false;
      }),
      isOpen: true,
    };
    mockSocketInstances.push(instance);
    return instance;
  }),
}));

jest.mock('../src/services/voiceRecorder', () => ({
  voiceRecorder: {
    start: (options: { onAudioFrame?: (frame: ArrayBuffer) => void }) =>
      mockVoiceRecorderStart(options),
    stop: () => mockVoiceRecorderStop(),
    recover: () => mockVoiceRecorderRecover(),
  },
}));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// 1s of 16kHz/16-bit mono PCM.
const SILENT_SECOND = new ArrayBuffer(32_000);

const makeLoudSecond = () => {
  const frame = new Int16Array(16_000);
  frame[0] = 500; // any real sample breaks the silence streak
  return frame.buffer;
};

let latest: UseVoiceSttResult;

const Probe = () => {
  latest = useVoiceStt();
  return <Text>{latest.status}</Text>;
};

describe('useVoiceStt digital-silence watchdog', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockLifecycle.length = 0;
    mockSocketInstances.length = 0;
    mockGetApiAuthToken.mockClear();
    mockVoiceRecorderStart.mockClear();
    mockVoiceRecorderStop.mockClear();
    mockVoiceRecorderRecover.mockClear();
    mockVoiceRecorderRecover.mockImplementation(async () => {
      mockLifecycle.push('recorder.recover');
      return true;
    });
    mockAudioFrameHandler = undefined;
    pendingConnectResolve = undefined;
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    jest.clearAllTimers();
    screen = undefined;
  });

  const mount = () => {
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
  };

  const startRecording = async () => {
    let startPromise!: Promise<boolean>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
      pendingConnectResolve?.();
      await flushMicrotasks();
      mockSocketInstances[mockSocketInstances.length - 1].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });
    expect(latest.status).toBe('recording');
  };

  const feed = async (frame: ArrayBuffer) => {
    await act(async () => {
      mockAudioFrameHandler?.(frame);
      await flushMicrotasks();
    });
  };

  it('restarts the recorder once after 2s of digital silence and keeps the take alive', async () => {
    mount();
    await startRecording();

    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND); // 2s cumulative → recovery trigger
    expect(mockVoiceRecorderRecover).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe('recording');

    // Recovery came back healthy (a real sample arrives) — the take continues
    // and the streak is reset, so no second attempt and no error.
    await feed(makeLoudSecond());
    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    expect(mockVoiceRecorderRecover).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe('recording');
  });

  it('fails the take with the micSilent message when silence persists past 4s', async () => {
    mount();
    await startRecording();

    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    expect(latest.status).toBe('recording');

    await feed(SILENT_SECOND); // 4s cumulative → give up
    expect(latest.status).toBe('error');
    expect(latest.errorMessage).toBe('麦克风采集异常（持续静音），请重试');
    expect(mockVoiceRecorderRecover).toHaveBeenCalledTimes(1);
    expect(mockVoiceRecorderStop).toHaveBeenCalled();
  });

  it('never enters the watchdog on a healthy (non-silent) stream', async () => {
    mount();
    await startRecording();

    for (let i = 0; i < 8; i++) {
      await feed(makeLoudSecond());
    }
    expect(mockVoiceRecorderRecover).not.toHaveBeenCalled();
    expect(latest.status).toBe('recording');
  });

  it('fails fast when the recovery restart itself returns false', async () => {
    mockVoiceRecorderRecover.mockImplementation(async () => {
      mockLifecycle.push('recorder.recover');
      return false;
    });
    mount();
    await startRecording();

    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    expect(mockVoiceRecorderRecover).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe('error');
    expect(latest.errorMessage).toBe('麦克风采集异常（持续静音），请重试');
  });

  it('does not let a recovered queue outlive a take whose stop landed mid-recovery', async () => {
    let resolveRecover!: (value: boolean) => void;
    mockVoiceRecorderRecover.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          mockLifecycle.push('recorder.recover');
          resolveRecover = resolve;
        }),
    );
    mount();
    await startRecording();

    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND); // recovery starts, hangs
    expect(mockLifecycle).toContain('recorder.recover');

    // User releases while the native swap is still in flight.
    const stopPromise = latest.stop();
    await act(async () => {
      jest.advanceTimersByTime(450);
      await flushMicrotasks();
    });
    resolveRecover(true);
    await act(async () => {
      await stopPromise;
      await flushMicrotasks();
    });

    // The recycled recorder must be stopped again — it can't outlive the take.
    expect(mockVoiceRecorderStop).toHaveBeenCalledTimes(2);
    expect(latest.status).toBe('stopping');
  });

  it('arms the watchdog fresh on the next take after a silence failure', async () => {
    mount();
    await startRecording();
    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND);
    await feed(SILENT_SECOND); // fail
    expect(latest.status).toBe('error');

    // New take: the one-shot recovery budget must be restored.
    await startRecording();
    expect(latest.status).toBe('recording');
    await feed(SILENT_SECOND);
    expect(latest.status).toBe('recording');
    await feed(SILENT_SECOND); // 2s into the NEW take → one recovery again
    expect(mockVoiceRecorderRecover).toHaveBeenCalledTimes(2);
  });
});
