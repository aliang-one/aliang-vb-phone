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

  it('does not flash the previous completed v2 run while a new send is pending', async () => {
    let resolveSend:
      | ((value: {
          message_id: string;
          status: string;
          run_id: string;
          run_state: 'queued';
          run_state_version: number;
        }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );
    useControlCenterStore.setState({
      vibeRuns: [
        {
          ...run(),
          status: 'idle',
          phase: 'completed',
          latestRunId: 'old-run',
          runState: 'completed',
          runStateVersion: 8,
        },
      ],
    });

    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'new turn', 'text');
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      status: 'running',
      phase: 'running',
      optimisticRunPending: true,
      optimisticRunBaseVersion: 8,
    });

    resolveSend?.({
      message_id: 'server-new',
      status: 'running',
      run_id: 'new-run',
      run_state: 'queued',
      run_state_version: 9,
    });
    await send;
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      activeRunId: 'new-run',
      latestRunId: 'new-run',
      runState: 'queued',
      runStateVersion: 9,
      optimisticRunPending: false,
    });
  });

  it('does not regress a WS-completed run when the HTTP accepted response arrives late', async () => {
    let resolveSend:
      | ((value: {
          message_id: string;
          status: string;
          run_id: string;
          run_state: 'queued';
          run_state_version: number;
        }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );
    useControlCenterStore.setState({
      vibeRuns: [
        {
          ...run(),
          latestRunId: 'old-run',
          runState: 'completed',
          runStateVersion: 8,
        },
      ],
    });
    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'fast turn', 'text');

    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(item =>
        item.id === 's1'
          ? {
              ...item,
              status: 'idle',
              phase: 'completed',
              activeRunId: undefined,
              latestRunId: 'new-run',
              runState: 'completed',
              runStateVersion: 11,
              optimisticRunPending: false,
              optimisticRunBaseVersion: undefined,
            }
          : item,
      ),
    }));
    resolveSend?.({
      message_id: 'server-fast',
      status: 'running',
      run_id: 'new-run',
      run_state: 'queued',
      run_state_version: 9,
    });
    await send;
    expect(useControlCenterStore.getState().vibeRuns[0]).toMatchObject({
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 11,
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
      // 新模型:status 事件驱动,running 即「真在跑」(ai.done 不再即时翻 idle——对齐服务端
      // soft-settle;idle 由服务端 settle 广播落定),guard 与顶部相位/composer 锁/停止按钮同源。
      setRun({ status: 'running', provider: 'claude_code' });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-a', 'text'),
      ).rejects.toThrow('Claude Code is still running');
    });

    it('status=idle(服务端 settle 已落定)→ 不拦截,允许继续发送', async () => {
      // 回合真正静止,服务端 soft-settle 广播把 status 落成 idle → guard 放行。
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

    it('v2 runState=waiting_approval 即使裸 status=idle 也拦截', async () => {
      setRun({
        status: 'idle',
        provider: 'claude_code',
        runState: 'waiting_approval',
        runStateVersion: 4,
      });
      await expect(
        useControlCenterStore.getState().appendAgentMessage('s1', 'next-d', 'text'),
      ).rejects.toThrow('Claude Code is still running');
    });
  });
});
