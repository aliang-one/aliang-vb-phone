import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useVoiceStt, type UseVoiceSttResult } from '../src/hooks/useVoiceStt';
import type { SttControlOut } from '../src/api/sttTypes';

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

const mockGetApiAuthToken = jest.fn(() => 'token-1');
const mockVoiceRecorderStart = jest.fn(async (_options: unknown) => {
  mockLifecycle.push('recorder.start');
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
      connect: jest.fn(async () => {
        mockLifecycle.push('socket.connect');
      }),
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
    start: (options: unknown) => mockVoiceRecorderStart(options),
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
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  const mount = () => {
    act(() => {
      screen = ReactTestRenderer.create(<Probe />);
    });
  };

  it('waits for stt.started before opening the microphone', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
    });

    expect(mockLifecycle).toEqual(['socket.connect', 'socket.sendJson:stt.start']);
    expect(mockVoiceRecorderStart).not.toHaveBeenCalled();

    await act(async () => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });

    expect(mockVoiceRecorderStart).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16000 }),
    );
    expect(mockLifecycle).toEqual([
      'socket.connect',
      'socket.sendJson:stt.start',
      'recorder.start',
    ]);
    expect(latest.status).toBe('recording');
  });

  it('stops the recorder on server error so retry can start cleanly', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
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
    expect(mockLifecycle).toEqual(['socket.connect', 'socket.sendJson:stt.start']);

    await act(async () => {
      mockSocketInstances[1].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await retryPromise;
    });
    expect(latest.status).toBe('recording');
  });

  it('does not open the microphone if released before stt.started', async () => {
    mount();

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = latest.start();
      await flushMicrotasks();
    });
    expect(mockLifecycle).toEqual(['socket.connect', 'socket.sendJson:stt.start']);

    await act(async () => {
      await latest.stop();
      await flushMicrotasks();
    });
    expect(mockVoiceRecorderStop).toHaveBeenCalled();
    expect(mockLifecycle).toContain('socket.sendJson:stt.stop');

    await act(async () => {
      mockSocketInstances[0].handlers.onMessage({
        type: 'stt.started',
        request_id: 'voice-stt',
        stt_session_id: 'voice-stt',
      });
      await startPromise;
    });

    expect(mockVoiceRecorderStart).not.toHaveBeenCalled();
  });
});
