/**
 * Composer 素材入口契约（Task 17 + 2026-10-23 改版）。
 *
 * 改版：入口不再常驻 composerRow 左侧（把输入区挤得太紧），改为**打字时**
 * （输入框聚焦、或有草稿文字）在输入框内部右侧、发送键旁边出现。
 *
 * 保留的硬规则：入口只在「确定能上传」时出现（attachmentsEnabled 能力位，
 * 未知/false 一律不渲染）；离线/只读时保留按钮但置灰；语音模式不出现。
 */
import { TextInput } from 'react-native';
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
  canInterruptTurn: false,
  canSteer: false,
  interruptGreyed: false,
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

const focusInput = (renderer: TestRenderer.ReactTestRenderer) => {
  const input = renderer.root.findByType(TextInput);
  act(() => input.props.onFocus?.());
};

const blurInput = (renderer: TestRenderer.ReactTestRenderer) => {
  const input = renderer.root.findByType(TextInput);
  act(() => input.props.onBlur?.());
};

/** 复合层（TouchableOpacity）自带我们传入的 disabled/onPress，取最外层。 */
const attachmentButton = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(
    node =>
      node.props?.testID === 'composer-attachments' &&
      typeof node.props?.onPress === 'function',
  )[0];

describe('MessageComposer 素材入口（打字时右侧内嵌）', () => {
  test('未确认能力位（默认 false）→ 永不渲染入口', () => {
    const renderer = render({});
    focusInput(renderer);
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);
    unmount(renderer);
  });

  test('未聚焦且无草稿 → 不渲染；聚焦后出现，点一下请求打开菜单', () => {
    const onOpenAttachments = jest.fn();
    const renderer = render({
      attachmentsEnabled: true,
      onOpenAttachments,
    });
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);

    focusInput(renderer);
    const button = attachmentButton(renderer);
    expect(button).toBeTruthy();
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('添加素材');

    act(() => button.props.onPress());
    expect(onOpenAttachments).toHaveBeenCalledTimes(1);
    unmount(renderer);
  });

  test('失焦后消失；有草稿文字时失焦也保留', () => {
    const renderer = render({ attachmentsEnabled: true, onOpenAttachments: jest.fn() });
    focusInput(renderer);
    expect(hasTestId(renderer, 'composer-attachments')).toBe(true);
    blurInput(renderer);
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);

    const withDraft = render({
      attachmentsEnabled: true,
      input: '看看这张图',
      onOpenAttachments: jest.fn(),
    });
    expect(hasTestId(withDraft, 'composer-attachments')).toBe(true);
    unmount(renderer);
    unmount(withDraft);
  });

  test('聚焦后同时回调屏幕级 onTextInputFocus（保留既有 autoFocus 复位链路）', () => {
    const onTextInputFocus = jest.fn();
    const renderer = render({
      attachmentsEnabled: true,
      onTextInputFocus,
      onOpenAttachments: jest.fn(),
    });
    focusInput(renderer);
    expect(onTextInputFocus).toHaveBeenCalledTimes(1);
    unmount(renderer);
  });

  test('设备离线 → 聚焦后入口保留但禁用', () => {
    const renderer = render({
      attachmentsEnabled: true,
      deviceOffline: true,
      onOpenAttachments: jest.fn(),
    });
    focusInput(renderer);
    expect(attachmentButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('只读会话 → 入口不出现（composer 就地显示只读原因，无输入框可附着）', () => {
    const renderer = render({
      attachmentsEnabled: true,
      readOnlyReason: '会话已结束',
      onOpenAttachments: jest.fn(),
    });
    // 只读态没有 TextInput（被原因行替代），「打字时出现」无从谈起。
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);
    unmount(renderer);
  });

  test('语音模式 → 不渲染（入口属于文字输入）', () => {
    const renderer = render({ attachmentsEnabled: true, mode: 'voice' } as Partial<MessageComposerProps>);
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);
    unmount(renderer);
  });
});
