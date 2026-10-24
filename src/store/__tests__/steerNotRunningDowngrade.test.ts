// steer 打在「本地认为 running、服务端已空闲」的会话上 → 409
// ai_session_not_running。按用户预期自动降级为普通发送（等价新回合），
// 不把原始错误码甩给用户，也不让消息停在 failed 气泡上。
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

import { platformTransport } from '../../services/platformTransport';
import { emptySessionData } from '../internals';
import { useControlCenterStore } from '../controlCenterStore';

const sendAiMessageMock = platformTransport.sendAiMessage as jest.Mock;
const sendAiSteerMock = platformTransport.sendAiSteer as jest.Mock;

const seedRunning = () => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
    vibeRuns: [
      {
        id: 's1',
        title: 't',
        deviceId: 'd1',
        projectId: 'p1',
        directory: '/tmp',
        status: 'running',
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
      } as never,
    ],
    devices: [{ id: 'd1', capabilities: ['ai_steer_claude'] }] as never,
  });
};

const notRunningError = () =>
  Object.assign(new Error('ai_session_not_running'), {
    code: 'ai_session_not_running',
  });

beforeEach(() => {
  jest.clearAllMocks();
  seedRunning();
  sendAiMessageMock.mockResolvedValue({
    message_id: 'msg_norm',
    status: 'sent',
    run_id: 'r-normal',
    run_state_version: 7,
  });
});

describe('steer 撞上空闲会话 → 自动降级普通发送', () => {
  it('steer 409 not_running → 改走 sendAiMessage，气泡按服务端 id 确认', async () => {
    sendAiSteerMock.mockRejectedValueOnce(notRunningError());

    await useControlCenterStore
      .getState()
      .appendAgentMessage('s1', '顺便看下', 'text');

    expect(sendAiSteerMock).toHaveBeenCalledTimes(1);
    expect(sendAiMessageMock).toHaveBeenCalledTimes(1);
    expect(sendAiMessageMock.mock.calls[0][1]).toBe('顺便看下');

    const run = useControlCenterStore.getState().vibeRuns[0];
    const bubble = run.transcript.find(message => message.role === 'user');
    expect(bubble?.pending).toBe(false);
    expect(bubble?.failed).not.toBe(true);
    expect(bubble?.id).toBe('msg_norm');
    expect(run.status).toBe('running');
    expect(run.activeRunId).toBe('r-normal');
  });

  it('其他错误（如网络失败）不降级：rethrow 给屏幕层 + failed 气泡', async () => {
    sendAiSteerMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      useControlCenterStore.getState().appendAgentMessage('s1', '插话', 'text'),
    ).rejects.toThrow('network down');

    expect(sendAiSteerMock).toHaveBeenCalledTimes(1);
    expect(sendAiMessageMock).not.toHaveBeenCalled();
    const bubble = useControlCenterStore
      .getState()
      .vibeRuns[0].transcript.find(message => message.role === 'user');
    expect(bubble?.failed).toBe(true);
  });
});

describe('TUI 执行器运行中不尝试 steer(2026-10-23 图片事故)', () => {
  it("executor='tui' + running → 不走 sendAiSteer,按并发发送硬拦", async () => {
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(run => ({ ...run, executor: 'tui' as const })),
    }));

    await expect(
      useControlCenterStore.getState().appendAgentMessage('s1', '分析一下这个图片', 'text'),
    ).rejects.toThrow('still running');

    expect(sendAiSteerMock).not.toHaveBeenCalled();
    expect(sendAiMessageMock).not.toHaveBeenCalled();
  });

  it("executor='spawn' + running → 仍走 sendAiSteer(能力位未回归)", async () => {
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(run => ({ ...run, executor: 'spawn' as const })),
    }));
    sendAiSteerMock.mockResolvedValueOnce({
      message_id: 'msg_steer',
      status: 'sent',
      run_id: 'r1',
      run_state_version: 8,
    });

    await useControlCenterStore
      .getState()
      .appendAgentMessage('s1', '顺便看下', 'text');

    expect(sendAiSteerMock).toHaveBeenCalledTimes(1);
    expect(sendAiMessageMock).not.toHaveBeenCalled();
  });
});

describe('导入/TUI 驱动回合不尝试 steer(2026-10-24 状态矩阵清洗 G1c)', () => {
  it('tuiDriven(sourceSessionId + 无 runStateVersion) + running → 硬拦,两个通道都不打', async () => {
    // 导入会话在 agent 侧没有对应会话记录,任何 steer 都撞 not_running——
    // 此前 store 只排 executor==='tui',语音草稿路径会把消息当 steer 打进
    // 一条没有注入通道的运行。与屏侧 canSteerTurn 的排除同源。
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(run => ({
        ...run,
        sourceSessionId: 'uuid-tui-1',
        runStateVersion: undefined,
      })),
    }));

    await expect(
      useControlCenterStore.getState().appendAgentMessage('s1', '语音转的插话', 'voice'),
    ).rejects.toThrow('still running');

    expect(sendAiSteerMock).not.toHaveBeenCalled();
    expect(sendAiMessageMock).not.toHaveBeenCalled();
  });

  it('tuiDriven + 设备宣称 ai_steer_external → 放行 sendAiSteer(CC 收件箱排队)', async () => {
    // agent 端外部 steer 扩展(2026-10-24):pid 记录 + 跨会话 UDS 收件箱使
    // tuiDrivenRunning 可插话。store 门控按设备能力位放开,与屏侧
    // canSteerTurn 的 `!tuiDrivenRunning || canSteerExternal` 同源。
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(run => ({
        ...run,
        sourceSessionId: 'uuid-tui-2',
        runStateVersion: undefined,
      })),
      devices: [
        { id: 'd1', capabilities: ['ai_steer_claude', 'ai_steer_external'] },
      ] as never,
    }));
    sendAiSteerMock.mockResolvedValueOnce({
      message_id: 'msg_steer_ext',
      status: 'sent',
      run_id: 'r-ext',
      run_state_version: 9,
    });

    await useControlCenterStore
      .getState()
      .appendAgentMessage('s1', '外部插话', 'text');

    expect(sendAiSteerMock).toHaveBeenCalledTimes(1);
    expect(sendAiMessageMock).not.toHaveBeenCalled();
  });
});
