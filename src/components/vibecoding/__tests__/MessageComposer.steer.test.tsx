/**
 * Composer 动作槽契约：回合进行中的发送/停止状态矩阵。
 *
 * 历史：renderAction() 曾把 canInterruptTurn 分支无条件 return，发送键整回合
 * 不可达（f05eb52 修复）。2026-10-24 状态矩阵清洗后契约升级：
 *   - canSteer=true + 有输入（文本或附件）→ [停止][发送]，发送键恒在最右
 *     （用户规格：输入时最右侧必须是发送键，停止键退居左侧）
 *   - canSteer=true + 空输入 → [停止]（不摆一个永远 disabled 的发送键）
 *   - canSteer=false（无 steer 通道）→ 仅 [停止]（仍可点——离线/打断在途才禁用）
 *   - 只读态（composer 被锁）→ 只读文案行替代输入框，发送键不出现，停止键可点
 *   - 停止键不再有「TUI 置灰」形态：agent >= v1.1.36 经 SIGINT 可停外部 TUI 回合
 *
 * 另：TUI 回合的「电脑图标」继续以书签 tab 形式挂在输入框上方（由
 * interruptGreyed 驱动），只作上下文说明，不再影响动作槽。
 */
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';

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
  interruptGreyedHint: '本回合正跑在桌面终端里——可以直接点停止键结束本轮。',
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

const testIdSequence = (
  renderer: TestRenderer.ReactTestRenderer,
  ids: string[],
): string[] =>
  renderer.root
    .findAll(
      node =>
        ids.includes(node.props?.testID) && typeof node.type === 'string',
    )
    .map(node => node.props.testID as string);

const interruptNode = (renderer: TestRenderer.ReactTestRenderer) =>
  // 复合节点(TouchableOpacity)上才有 disabled prop;内层宿主 View 只继承
  // testID。按「props 里真的带 disabled」挑节点。
  renderer.root.find(
    node =>
      node.props?.testID === 'composer-interrupt' &&
      node.props.disabled !== undefined,
  );

describe('MessageComposer 回合中的动作槽', () => {
  test('有 steer 通道 + 有输入：[停止][发送] 同时可见,发送键在最右', () => {
    const renderer = render({ canSteer: true, input: '追加一句' });
    expect(hasTestId(renderer, 'composer-send')).toBe(true);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    // 顺序契约（用户规格 2026-10-24：输入时最右侧必须是发送键）：
    // findAll 按深度优先先序遍历,兄弟节点按 JSX 顺序——停止键必须先于发送键。
    expect(
      testIdSequence(renderer, ['composer-interrupt', 'composer-send']).slice(0, 2),
    ).toEqual(['composer-interrupt', 'composer-send']);
    unmount(renderer);
  });

  test('有 steer 通道 + 只选了素材、文本为空：发送键同样出现', () => {
    const renderer = render({ canSteer: true, input: '', attachmentCount: 2 });
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

  test('无 steer 通道：回合中不出现发送按钮（避免点了必失败）,但停止键可点', () => {
    const renderer = render({ canSteer: false, input: '追加一句' });
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    // 停止键必须可点（用户症状 1 契约：运行中+空输入 → 停止可点）。
    expect(interruptNode(renderer).props.disabled).toBe(false);
    unmount(renderer);
  });

  test('空输入 + 运行中：停止键在场且可点（症状 1 契约钉子）', () => {
    const renderer = render({ canSteer: false, input: '' });
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(interruptNode(renderer).props.disabled).toBe(false);
    unmount(renderer);
  });

  test('设备离线：停止键在场但禁用（可见性归可见性,可点性归可点性）', () => {
    const renderer = render({ canSteer: false, deviceOffline: true });
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(interruptNode(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('打断请求在途：停止键变成「…」禁用态,不再整体消失', () => {
    const renderer = render({
      canSteer: false,
      interruptingTurn: true,
      canInterruptTurn: true,
    });
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(interruptNode(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('只读态（composer 被锁）：无输入框、无发送键,停止键仍可点', () => {
    const renderer = render({
      canSteer: false,
      input: '已经打了一半的字',
      readOnlyReason: 'Claude Code 正在运行，停止后可继续输入。',
    });
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(interruptNode(renderer).props.disabled).toBe(false);
    // 输入区被只读文案行替代——不存在可编辑的 TextInput。
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    unmount(renderer);
  });

  test('TUI 回合：书签 tab 在输入框上方,停止键保持可点（不再置灰）', () => {
    const renderer = render({
      canSteer: false,
      input: '追加一句',
      interruptGreyed: true,
    });
    // 发送键不出现（TUI 驱动回合无 steer 通道,屏侧会让 composer 只读）。
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    // 停止键可点（agent >= v1.1.36 经 SIGINT 可停外部 TUI 回合,G1a）。
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(interruptNode(renderer).props.disabled).toBe(false);
    // 书签 tab 存在（折叠态 testID）——桌面标记只作上下文说明。
    expect(hasTestId(renderer, 'composer-tui-hint')).toBe(true);
    unmount(renderer);
  });

  test('非 TUI 回合不渲染书签 tab', () => {
    const renderer = render({ canSteer: true, input: 'hi' });
    expect(hasTestId(renderer, 'composer-tui-hint')).toBe(false);
    unmount(renderer);
  });

  test('goal 草稿：回合打断分支让位,始终只有发送键', () => {
    const renderer = render({ canSteer: false, input: '目标描述', goalDraft: true });
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(false);
    expect(hasTestId(renderer, 'composer-send')).toBe(true);
    unmount(renderer);
  });

  test('/goal 形态输入不绕过打断分支（GOAL_UI_ENABLED=false 时即普通文本,G5）', () => {
    const renderer = render({ canSteer: false, input: '/goal 写个爬虫' });
    // flag 关闭:/goal 是普通文本 → 停止键必须还在,发送键不得借 goal 特判复活。
    expect(hasTestId(renderer, 'composer-interrupt')).toBe(true);
    expect(hasTestId(renderer, 'composer-send')).toBe(false);
    unmount(renderer);
  });
});
