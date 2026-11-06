/**
 * 「另起续聊」入口契约（跨端统一 P4 + agentcore 壳卡扩容）。
 *
 * 卡片长按菜单的续聊动作由 `sessionResumeTarget` 驱动：
 *   - 终端前缀壳（claude_/codex_）→ 剥前缀原生 id（既有行为，回归锚）；
 *   - agentcore 壳（ai_import_<sha1> + 列表下发 sourceSessionId）→ 直接以
 *     sourceSessionId 回填，创建载荷带 provider:'agentcore'（agentcore 要求
 *     手机显式下发模型，defaultModelFor 补 glm-5.2；claude/codex 不变无模型键）；
 *   - 手机自建 agentcore 会话（ai_<nanoid>，绑定回填 sourceSessionId）不亮入口
 *     ——它与壳卡同 provider 同 sourceSessionId 形态，但不是导入壳（服务端
 *     imported.ts 的同款判据）。
 * 运行中的卡片不提供入口（与 TUI 运行中锁同族，既有条件）。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { VibeSessionCard } from '../src/components/vibecoding/VibeSessionCard';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

const AGENTSHELL_ID = 'ai_import_c7e27e3a8f4b2d6e91';

const baseRun = (overrides: Partial<VibeCodingRun> = {}): VibeCodingRun => ({
  id: 'session-A',
  title: 'title',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'idle',
  objective: '',
  model: 'Claude Code',
  risk: 'low',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 1000,
  updatedAt: '',
  suggestions: [],
  transcript: [],
  events: [],
  structuredEvents: [],
  ...overrides,
});

describe('VibeSessionCard 另起续聊 entry', () => {
  const startAgentSession = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    startAgentSession.mockResolvedValue('new-session-1');
    useControlCenterStore.setState({
      devices: [],
      projects: [],
      approvals: [],
      vibeRuns: [],
      startAgentSession,
      deleteAgentSession: jest.fn().mockResolvedValue(undefined),
      updateAgentSession: jest.fn().mockResolvedValue(undefined),
      generateAgentSessionTitle: jest.fn().mockResolvedValue('t'),
    });
  });

  const renderCard = (session: VibeCodingRun) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<VibeSessionCard session={session} />);
    });
    return renderer;
  };

  const openMenu = (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const card = renderer.root.findByType(TouchableOpacity);
    act(() => {
      card.props.onLongPress();
    });
  };

  const resumeAction = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root
      .findAllByType(TouchableOpacity)
      .find(button =>
        button
          .findAllByType(Text)
          .some(node => node.props.children === '另起续聊'),
      );

  it('shows the resume entry for an agentcore shell card', () => {
    const renderer = renderCard(
      baseRun({
        id: AGENTSHELL_ID,
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
      }),
    );
    openMenu(renderer);
    expect(resumeAction(renderer)).toBeTruthy();
    act(() => renderer.unmount());
  });

  it('creates the continuation with provider agentcore + listed sourceSessionId and navigates', async () => {
    const renderer = renderCard(
      baseRun({
        id: AGENTSHELL_ID,
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
      }),
    );
    openMenu(renderer);
    const onPress = resumeAction(renderer)!.props.onPress;
    await act(async () => {
      await onPress();
    });
    expect(startAgentSession).toHaveBeenCalledTimes(1);
    expect(startAgentSession).toHaveBeenCalledWith({
      deviceId: 'device-1',
      projectId: 'project-1',
      directory: '~/proj',
      provider: 'agentcore',
      objective: '',
      sourceSessionId: 'j-abc123',
      // agentcore 要求手机显式下发模型（requiresExplicitModel）。
      model: 'glm-5.2',
    });
    expect(mockNavigate).toHaveBeenCalledWith('VibeCodingSession', {
      sessionId: 'new-session-1',
    });
    act(() => renderer.unmount());
  });

  it('keeps the claude_ prefix shell entry (regression anchor)', async () => {
    const renderer = renderCard(
      baseRun({ id: 'claude_2f0a9b', provider: 'claude_code' }),
    );
    openMenu(renderer);
    const onPress = resumeAction(renderer)!.props.onPress;
    await act(async () => {
      await onPress();
    });
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude_code',
        sourceSessionId: '2f0a9b',
      }),
    );
    act(() => renderer.unmount());
  });

  it('hides the entry for a phone-created agentcore session even when sourceSessionId is bound', () => {
    const renderer = renderCard(
      baseRun({
        id: 'ai_abc123',
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
      }),
    );
    openMenu(renderer);
    expect(resumeAction(renderer)).toBeUndefined();
    act(() => renderer.unmount());
  });

  it('hides the entry for a running agentcore shell card', () => {
    const renderer = renderCard(
      baseRun({
        id: AGENTSHELL_ID,
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
        status: 'running',
      }),
    );
    openMenu(renderer);
    expect(resumeAction(renderer)).toBeUndefined();
    act(() => renderer.unmount());
  });
});
