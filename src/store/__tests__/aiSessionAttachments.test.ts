// Task 18：素材随消息进 store —— 发送时透传、乐观气泡立刻挂上。
// 屏幕层「上传→发送→清 chips」的编排在 services/attachmentSend.test.ts；
// 这里只锁 store 这一段：attachments 不被吞掉、两种通道（message/steer）
// 都带上，且乐观气泡在 HTTP 返回前就能显示用户发了什么。
jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    sendAiMessage: jest.fn(),
    sendAiSteer: jest.fn(),
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, getApiAuthToken: jest.fn() };
});

import type { AiAttachmentMeta } from '../../api/attachments';
import { platformTransport } from '../../services/platformTransport';
import { emptySessionData } from '../internals';
import { useControlCenterStore } from '../controlCenterStore';

const sendAiMessageMock = platformTransport.sendAiMessage as jest.Mock;
const sendAiSteerMock = platformTransport.sendAiSteer as jest.Mock;

const metas: AiAttachmentMeta[] = [
  {
    asset_id: 'srv-a',
    kind: 'photo',
    name: 'a.jpg',
    mime: 'image/jpeg',
    bytes: 100,
    width: 10,
    height: 10,
  },
  {
    asset_id: 'srv-b',
    kind: 'photo',
    name: 'b.jpg',
    mime: 'image/jpeg',
    bytes: 200,
  },
];

const run = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    title: 't',
    deviceId: 'd1',
    projectId: 'p1',
    directory: '/tmp',
    status: 'idle',
    provider: 'claude_code',
    objective: '',
    model: 'claude-sonnet',
    risk: 'low',
    currentStep: '',
    branch: 'main',
    updatedAt: '',
    lastActivityMs: 0,
    suggestions: [],
    transcript: [],
    transcriptCount: 0,
    events: [],
    structuredEvents: [],
    ...over,
  }) as never;

const seed = (over: { run?: Record<string, unknown>; devices?: unknown[] } = {}) => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
    vibeRuns: [run(over.run)],
    devices: (over.devices ?? []) as never,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  sendAiMessageMock.mockResolvedValue({ message_id: 'msg_srv', status: 'sent' });
  sendAiSteerMock.mockResolvedValue({ message_id: 'msg_srv', status: 'steered' });
});

describe('appendAgentMessage attachments', () => {
  it('两张图原样透传给 sendAiMessage（第 5 参）', async () => {
    seed();

    await useControlCenterStore.getState().appendAgentMessage('s1', '看图', 'text', metas);

    expect(sendAiMessageMock).toHaveBeenCalledTimes(1);
    const args = sendAiMessageMock.mock.calls[0];
    expect(args[0]).toBe('s1');
    expect(args[1]).toBe('看图');
    expect(args[2]).toBe('text');
    expect(args[4]).toHaveLength(2);
    expect((args[4] as AiAttachmentMeta[]).map(item => item.asset_id)).toEqual([
      'srv-a',
      'srv-b',
    ]);
  });

  it('乐观气泡在 HTTP 返回前就带上 attachments', async () => {
    seed();
    // 挂住响应，观察「发送中」这一刻的 transcript。
    let resolveSend: (value: unknown) => void = () => {};
    sendAiMessageMock.mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );

    const pending = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', '这两张', 'text', metas);

    const bubble = useControlCenterStore
      .getState()
      .vibeRuns[0].transcript.find(message => message.role === 'user');
    expect(bubble?.pending).toBe(true);
    expect(bubble?.attachments?.map(item => item.asset_id)).toEqual(['srv-a', 'srv-b']);

    resolveSend({ message_id: 'msg_srv', status: 'sent' });
    await pending;
  });

  it('steer 通道同样透传（Claude 运行中 + 设备能力位）', async () => {
    seed({
      run: { status: 'running' },
      devices: [{ id: 'd1', capabilities: ['ai_steer_claude'] }],
    });

    await useControlCenterStore.getState().appendAgentMessage('s1', '顺便看图', 'text', metas);

    expect(sendAiSteerMock).toHaveBeenCalledTimes(1);
    expect(sendAiSteerMock.mock.calls[0][3]).toHaveLength(2);
    expect(sendAiMessageMock).not.toHaveBeenCalled();
  });

  it('无素材时第 5 参是空数组，旧调用形状不变', async () => {
    seed();

    await useControlCenterStore.getState().appendAgentMessage('s1', '纯文本', 'text');

    expect(sendAiMessageMock.mock.calls[0][4]).toEqual([]);
  });
});
