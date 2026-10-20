jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, getApiAuthToken: jest.fn() };
});

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData } from '../internals';

const steerBubble = {
  id: 'msg_steer_1',
  role: 'user' as const,
  content: '顺便把测试也补上',
  timestamp: '2026-10-20T00:00:00.000Z',
  pending: true,
};

const run = {
  id: 's1',
  title: 't',
  deviceId: 'd1',
  projectId: 'p1',
  directory: '/tmp',
  status: 'running',
  objective: '',
  model: 'glm-5.2',
  risk: 'low',
  currentStep: 'Steering current turn.',
  branch: 'main',
  updatedAt: '',
  lastActivityMs: 0,
  suggestions: [],
  transcript: [steerBubble],
  events: [],
  structuredEvents: [],
} as never;

const ack = (result: string, error?: string) =>
  ({
    type: 'ai.steer.ack',
    sessionId: 's1',
    messageId: 'msg_steer_1',
    result,
    error,
    raw: {},
  }) as never;

describe('ai.steer.ack reducer', () => {
  beforeEach(() => {
    useControlCenterStore.setState({
      ...emptySessionData(),
      serverMode: true,
      vibeRuns: [run],
    });
  });

  it('成功 ack 只清 pending，不把气泡标失败', () => {
    useControlCenterStore.getState().handleTransportEvent(ack('applied'));
    const message = useControlCenterStore.getState().vibeRuns[0].transcript[0];
    expect(message.pending).toBe(false);
    expect(message.failed).toBeUndefined();
  });

  it('失败 ack（unsupported/error/not_running）把气泡标失败，供 Retry/Dismiss', () => {
    for (const result of ['unsupported', 'error', 'not_running']) {
      useControlCenterStore.setState({
        ...emptySessionData(),
        serverMode: true,
        vibeRuns: [run],
      });
      useControlCenterStore.getState().handleTransportEvent(ack(result, 'no channel'));
      const message = useControlCenterStore.getState().vibeRuns[0].transcript[0];
      expect(message.pending).toBe(false);
      expect(message.failed).toBe(true);
    }
  });
});
