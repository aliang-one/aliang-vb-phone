import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    sendAiMessage: jest.fn(),
  },
}));

const run = (transcript: VibeCodingRun['transcript'] = []): VibeCodingRun => ({
  id: 's1',
  title: 'run-s1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'idle',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript,
  events: [],
  structuredEvents: [],
});

describe('appendAgentMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [
        run([
          {
            id: 'old-user',
            role: 'user',
            content: 'Initial prompt',
            timestamp: '09:58',
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Initial reply',
            timestamp: '09:59',
          },
        ]),
      ],
      devices: [
        {
          id: 'device-1',
          name: 'Device',
          status: 'online',
          location: '',
          os: 'macOS',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: [],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: '',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
          capabilities: [],
          tools: [],
          history: [],
        },
      ],
    });
  });

  it('renders a user prompt optimistically at the visible tail before the request resolves', async () => {
    let resolveSend:
      | ((value: { message_id: string; status: string }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );

    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'Follow-up', 'text');

    const optimisticTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(optimisticTranscript.map(item => item.content)).toEqual([
      'Initial prompt',
      'Initial reply',
      'Follow-up',
    ]);
    expect(optimisticTranscript[2]).toMatchObject({
      role: 'user',
      pending: true,
    });

    resolveSend?.({ message_id: 'server-user', status: 'running' });
    await send;

    const confirmedTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(confirmedTranscript.map(item => item.id)).toEqual([
      'old-user',
      'old-assistant',
      'server-user',
    ]);
    expect(confirmedTranscript[2]).toMatchObject({
      role: 'user',
      content: 'Follow-up',
      pending: false,
    });
  });

  describe('claude_code 并发 guard 与 composer 锁 / 停止按钮同源(status 事件驱动)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (platformTransport.sendAiMessage as jest.Mock).mockResolvedValue({
        message_id: 'server-msg',
        status: 'running',
      });
      useControlCenterStore.setState({ serverMode: true, devices: [] });
    });

    const setRun = (overrides: Partial<VibeCodingRun>) => {
      useControlCenterStore.setState({
        vibeRuns: [{ ...run(), ...overrides }],
      });
    };

    it('status=running → 拦截 claude_code 并发(回合确定在跑)', async () => {
      // 新模型:status 现在事件驱动(ai.done 会即时翻 idle),故 running 即「真在跑」,
      // guard 与顶部相位/composer 锁/停止按钮同源(isSessionTurnActive)。
      setRun({ status: 'running', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-a', 'text'),
      ).rejects.toThrow('Claude Code is still running');
    });

    it('status=idle(ai.done 已结算)→ 不拦截,允许继续发送', async () => {
      // 回合结束 ai.done 把 status 翻成 idle → guard 即时放行,不再卡 8s。
      setRun({ status: 'idle', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-b', 'text'),
      ).resolves.toBeUndefined();
    });

    it('waiting_approval → 拦截(审批期间不可发新消息)', async () => {
      setRun({ status: 'waiting_approval', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-c', 'text'),
      ).rejects.toThrow('Claude Code is still running');
    });
  });
});
