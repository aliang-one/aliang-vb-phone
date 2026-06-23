import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useVoiceStt, type UseVoiceSttResult } from '../src/hooks/useVoiceStt';
import type { SttControlOut } from '../src/api/sttTypes';

jest.useFakeTimers();

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
  },
}));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let latest: UseVoiceSttResult;

const Probe = () => {
  latest = useVoiceStt();
  return <Text>{latest.status}</Text>;
};

describe('useVoiceStt', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockLifecycle.length = 0;
    mockSocketInstances.length = 0;
    mockGetApiAuthToken.mockClear();
    mockVoiceRecorderStart.mockClear();
    mockVoiceRecorderStop.mockClear();
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

  const resolveConnect = async () => {
    pendingConnectResolve?.();
    await flushMicrotasks();
  };

  it('opens the microphone immediately and buffers audio until STT is ready', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
    });

    expect(mockLifecycle).toEqual(['socket.connect', 'recorder.start']);
    expect(mockVoiceRecorderStart).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16000 }),
    );
    expect(latest.status).toBe('recording');

    act(() => {
      mockAudioFrameHandler?.(new ArrayBuffer(4));
    });
    expect(mockSocketInstances[0].sendBinary).not.toHaveBeenCalled();

    await act(async () => {
      await resolveConnect();
      await startPromise;
    });
    expect(mockLifecycle).toEqual([
      'socket.connect',
      'recorder.start',
      'socket.sendJson:stt.start',
    ]);
    expect(mockSocketInstances[0].sendBinary).toHaveBeenCalledTimes(1);

    act(() => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
    });
  });

  it('stops the recorder on server error so retry can start cleanly', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
      await resolveConnect();
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });
    expect(latest.status).toBe('recording');

    await act(async () => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.error',
        code: 'nls_unavailable',
        message: 'nls down',
      });
      await flushMicrotasks();
    });

    expect(mockVoiceRecorderStop).toHaveBeenCalled();
    expect(latest.status).toBe('error');
    expect(latest.errorMessage).toBe('nls down');

    mockLifecycle.length = 0;
    let retryPromise!: Promise<void>;
    await act(async () => {
      retryPromise = latest.start();
      await flushMicrotasks();
    });
    expect(mockLifecycle).toEqual(['socket.connect', 'recorder.start']);

    await act(async () => {
      await resolveConnect();
      mockSocketInstances[1].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await retryPromise;
    });
    expect(latest.status).toBe('recording');
  });

  it('throttles live partial captions to avoid rerendering on every STT frame', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
      await resolveConnect();
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });

    act(() => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.partial',
        text: '你',
      });
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.partial',
        text: '你好',
      });
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.partial',
        text: '你好啊',
      });
    });
    expect(latest.liveCaption).toBe('');

    act(() => {
      jest.advanceTimersByTime(119);
    });
    expect(latest.liveCaption).toBe('');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(latest.liveCaption).toBe('你好啊');
  });

  it('stops even when released before the socket finishes connecting', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
    });
    expect(mockLifecycle).toEqual(['socket.connect', 'recorder.start']);

    act(() => {
      mockAudioFrameHandler?.(new ArrayBuffer(4));
    });
    expect(mockSocketInstances[0].sendBinary).not.toHaveBeenCalled();

    await act(async () => {
      await latest.stop();
      await flushMicrotasks();
    });
    expect(mockVoiceRecorderStop).toHaveBeenCalled();
    expect(latest.status).toBe('stopping');
    expect(mockLifecycle).not.toContain('socket.sendJson:stt.stop');

    await act(async () => {
      await resolveConnect();
      await startPromise;
    });

    expect(mockLifecycle).toEqual([
      'socket.connect',
      'recorder.start',
      'recorder.stop',
      'socket.sendJson:stt.start',
      'socket.sendJson:stt.stop',
    ]);
    expect(mockSocketInstances[0].sendBinary).toHaveBeenCalledTimes(1);

    act(() => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.completed',
        request_id: 'voice-stt',
        full_text: '完成',
      });
    });
    expect(latest.status).toBe('idle');
  });

  it('waits for native recorder stop and sends tail audio before stt.stop', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
      await resolveConnect();
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });
    expect(latest.status).toBe('recording');

    let resolveRecorderStop!: () => void;
    mockVoiceRecorderStop.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveRecorderStop = resolve;
        }),
    );

    let stopPromise!: Promise<void>;
    await act(async () => {
      stopPromise = latest.stop();
      await flushMicrotasks();
    });
    expect(mockSocketInstances[0].sendJson).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'stt.start' }),
    );

    act(() => {
      mockAudioFrameHandler?.(new ArrayBuffer(8));
    });
    expect(mockSocketInstances[0].sendBinary).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRecorderStop();
      await stopPromise;
    });
    expect(mockSocketInstances[0].sendJson).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'stt.stop' }),
    );
    expect(mockSocketInstances[0].sendBinary).toHaveBeenCalledTimes(1);
  });

  it('forces completion when stop is tapped again while stopping', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
      await resolveConnect();
      await startPromise;
    });

    let resolveRecorderStop!: () => void;
    mockVoiceRecorderStop.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveRecorderStop = resolve;
        }),
    );

    await act(async () => {
      void latest.stop();
      await flushMicrotasks();
    });
    expect(latest.status).toBe('stopping');

    await act(async () => {
      await latest.stop();
      await flushMicrotasks();
    });
    expect(latest.status).toBe('idle');

    resolveRecorderStop();
  });

  it('falls back to idle if the socket never finishes connecting after stop', async () => {
    mount();

    await act(async () => {
      void latest.start();
      await flushMicrotasks();
    });
    expect(latest.status).toBe('recording');

    await act(async () => {
      await latest.stop();
      await flushMicrotasks();
    });
    expect(latest.status).toBe('stopping');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(latest.status).toBe('idle');
  });
});
