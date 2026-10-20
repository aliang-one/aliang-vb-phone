/**
 * generateAgentSessionTitle(重命名面板的 AI 按钮)store 回归:
 * 服务端同步生成标题并直接落库,手机侧拿到落库后的权威快照 → 把 title 并回
 * vibeRuns(卡片即时改名,不必等 WS 推送),再把标题交给调用方回填输入框。
 * 离线/serverMode=false 时必须先抛错且不发请求(与其它平台动作一致)。
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { ServerAiSession } from '../src/api/sessions';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    generateAiSessionTitle: jest.fn(),
  },
}));

const generateMock = platformTransport.generateAiSessionTitle as jest.Mock;

const run = (): VibeCodingRun =>
  ({
    id: 's-ai-1',
    kind: 'ai',
    purpose: 'chat',
    status: 'idle',
    title: '旧标题',
    transcript: [],
    events: [],
    structuredEvents: [],
  }) as unknown as VibeCodingRun;

const snapshot = (title: string): ServerAiSession =>
  ({
    session_id: 's-ai-1',
    kind: 'ai',
    user_id: 'u1',
    device_id: 'd1',
    status: 'idle',
    mode: 'chat',
    purpose: 'chat',
    title,
  }) as ServerAiSession;

describe('generateAgentSessionTitle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run()],
      aiSessionHistory: [],
      sessionCommands: {},
      devices: [],
      projects: [],
    });
  });

  it('返回落库标题,并把权威快照的 title 并回列表卡片', async () => {
    generateMock.mockResolvedValue(snapshot('登录超时排查'));

    const title = await useControlCenterStore
      .getState()
      .generateAgentSessionTitle('s-ai-1');

    expect(generateMock).toHaveBeenCalledWith('s-ai-1');
    expect(title).toBe('登录超时排查');
    expect(useControlCenterStore.getState().vibeRuns[0]?.title).toBe(
      '登录超时排查',
    );
  });

  it('服务端未返回 title 时返回空串(输入框保持原值,由用户决定)', async () => {
    const { title: _title, ...noTitle } = snapshot('x');
    generateMock.mockResolvedValue(noTitle);

    await expect(
      useControlCenterStore.getState().generateAgentSessionTitle('s-ai-1'),
    ).resolves.toBe('');
  });

  it('serverMode=false 时不发请求,直接抛错', async () => {
    useControlCenterStore.setState({ serverMode: false });

    await expect(
      useControlCenterStore.getState().generateAgentSessionTitle('s-ai-1'),
    ).rejects.toThrow(/Platform connection/);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
