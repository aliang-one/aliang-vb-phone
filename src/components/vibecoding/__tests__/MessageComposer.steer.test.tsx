/**
 * Composer 动作槽契约：回合进行中必须还能发 steer。
 *
 * 曾经的缺陷：renderAction() 里 canInterruptTurn 分支无条件 return，把
 * mode==='text' 的发送按钮挡在整个回合期间之外 —— 用户打完字发现没有发送
 * 按钮（手机端 & TUI 会话都是）。修复后：
 *   - canSteer=true + 有输入 → [发送][停止]
 *   - canSteer=true + 空输入 → [停止]（不摆一个永远 disabled 的发送键）
 *   - canSteer=false（无 steer 通道）→ 仅 [停止]
 *
 * 另：TUI 回合的「电脑图标」从动作槽移到输入框上方的书签 tab，让输入行
 * 让出 ~40pt 给文本。
 */
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../SlashCommandSuggestions', () => ({
  SlashCommandSuggestions: () => null,
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

const baseProps = {
  mode: 'text',
  onModeChange: jest.fn(),
  input: '',
  onInputChange: jest.fn(),
  voiceDraft: '',
  commands: [],
  voiceStt: stableVoiceStt,
  sendingMessage: false,
  interruptingTurn: false,
  canInterruptTurn: true,
  canSteer: false,
  interruptGreyed: false,
  interruptGreyedHint: '终端 TUI 正在运行对话——请在终端里按一次 Esc 停止本轮。',
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
  onSendVoice: jest.fn(),
  onSendText: jest.fn(),
  onInterruptTurn: jest.fn(),
  onEditVoice: jest.fn(),
} as unknown as MessageComposerProps;

const render = (overrides: Partial<MessageComposerProps>) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <MessageComposer {...baseProps} {...overrides} />,
    );
  });
  return renderer;
};

const unmount = (renderer: TestRenderer.ReactTestRenderer) => {
  act(() => renderer.unmount());
};

const hasTestId = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean =>
  renderer.root.findAll(
    node => node.props?.testID === testID && typeof node.type === 'string',
  ).length > 0;

describe('MessageComposer 回合中的动作槽', () => {
  test('有 steer 通道 + 有输入：发送与停止同时可见', () => {
    const renderer = render({ canSteer: true, input: '追加一句' });
    expect(hasTestId(renderer, 'composer-send')).toBe(true);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    unmount(renderer);
  });

  test('有 steer 通道但输入为空：只留停止按钮', () => {
    const renderer = render({ canSteer: true, input: '   ' });
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    unmount(renderer);
  });

  test('无 steer 通道：回合中不出现发送按钮（避免点了必失败）', () => {
    const renderer = render({ canSteer: false, input: '追加一句' });
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    unmount(renderer);
  });

  test('TUI 回合：电脑图标移出动作槽，改作输入框上方的书签 tab', () => {
    const renderer = render({
      canSteer: false,
      input: '追加一句',
      interruptGreyed: true,
    });
    // 动作槽里只剩置灰停止键；发送键仍不可用（TUI 回合无 steer 通道）。
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    // 书签 tab 存在（折叠态 testID），说明桌面标记没占动作槽。
    expect(hasTestId(renderer, 'composer-tui-hint')).toBe(true);
    unmount(renderer);
  });

  test('非 TUI 回合不渲染书签 tab', () => {
    const renderer = render({ canSteer: true, input: 'hi' });
    expect(hasTestId(renderer, 'composer-tui-hint')).toBe(false);
    unmount(renderer);
  });
});
