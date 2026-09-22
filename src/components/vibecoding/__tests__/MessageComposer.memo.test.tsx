/**
 * MessageComposer memo 契约。
 *
 * 聊天屏流式期间以 ≤5Hz 重渲染(见 usePublishedVibeRun)。composer 与会话
 * 内容无关,应在 props 不变时被 React.memo 跳过 —— 前提是父级传来的所有
 * props 引用稳定(useVoiceStt 返回对象、渲染点回调)。
 *
 * 检测信号:mock 掉 SlashCommandSuggestions(plain jest.fn 组件,父级每次
 * 真实重渲染都会调用它;React.Profiler 对 memo bail-out 无区分度,mount 期
 * 内部 effect 也会产生合法的额外提交)。text 模式 + '/' 输入让它必然渲染。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockSuggestionsRender = jest.fn((_props?: unknown) => null);
jest.mock('../SlashCommandSuggestions', () => ({
  SlashCommandSuggestions: (props: unknown) => mockSuggestionsRender(props),
}));

import { MessageComposer } from '../MessageComposer';
import type { MessageComposerProps } from '../MessageComposer';
import type { UseVoiceSttResult } from '../../../hooks/useVoiceStt';

const stableVoiceStt = {
  status: 'idle',
  liveCaption: '',
  errorMessage: '',
  start: jest.fn(),
  stop: jest.fn(),
  cancel: jest.fn(),
} as unknown as UseVoiceSttResult;

// 全部 props 一次构建、跨渲染复用(模拟父级 useCallback/useMemo 化后的稳定引用)。
const baseProps = {
  mode: 'text',
  onModeChange: jest.fn(),
  input: '/he',
  onInputChange: jest.fn(),
  voiceDraft: '',
  commands: [{ name: 'help' }],
  sessionId: 's1',
  voiceStt: stableVoiceStt,
  sendingMessage: false,
  interruptingTurn: false,
  canInterruptTurn: false,
  deviceOffline: false,
  readOnlyReason: undefined,
  autoFocusText: false,
  toolsMenuVisible: false,
  toolsDisabled: false,
  onToggleTools: jest.fn(),
  goalDraft: false,
  goalSession: false,
  showGoalHint: true,
  onTextInputFocus: jest.fn(),
  onVoiceCapture: jest.fn(),
  onVoiceCaptureStart: jest.fn(),
  onVoiceCaptureEnd: jest.fn(),
  onSendVoice: jest.fn(),
  onSendText: jest.fn(),
  onInterruptTurn: jest.fn(),
  onEditVoice: jest.fn(),
} as unknown as MessageComposerProps;

describe('MessageComposer memo', () => {
  beforeEach(() => {
    mockSuggestionsRender.mockClear();
  });

  test('相同 props 重渲染父级时,composer 函数体不再执行(memo 生效)', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<MessageComposer {...baseProps} />);
    });
    expect(mockSuggestionsRender).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(<MessageComposer {...baseProps} />);
    });

    // memo 缺失时这里是 2(RED 信号);memo 生效时父级 update 不再执行子组件。
    expect(mockSuggestionsRender).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  test('input 变化时 composer 必须重渲染(memo 不挡真实更新)', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<MessageComposer {...baseProps} />);
    });
    expect(mockSuggestionsRender).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(
        <MessageComposer {...baseProps} input="/hel" key="changed" />,
      );
    });

    expect(mockSuggestionsRender).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });
});
