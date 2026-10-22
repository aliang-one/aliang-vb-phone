/**
 * Composer 素材入口契约（Task 17）。
 *
 * 入口只在「确定能上传」时出现：调用方用会话能力位（COS 是否配置）决定
 * attachmentsEnabled。能力位未知时整颗按钮不渲染——不让用户点进一条注定
 * 失败的链路；离线/只读时保留按钮但置灰，用户能看到入口也知道点不动。
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

/** 复合层（TouchableOpacity）自带我们传入的 disabled/onPress，取最外层。 */
const attachmentButton = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(
    node =>
      node.props?.testID === 'composer-attachments' &&
      typeof node.props?.onPress === 'function',
  )[0];

describe('MessageComposer 素材入口', () => {
  test('未确认能力位（默认 false）→ 不渲染入口', () => {
    const renderer = render({});
    expect(hasTestId(renderer, 'composer-attachments')).toBe(false);
    unmount(renderer);
  });

  test('能力位可用 → 渲染入口，点一下请求打开菜单', () => {
    const onOpenAttachments = jest.fn();
    const renderer = render({
      attachmentsEnabled: true,
      onOpenAttachments,
    });

    const button = attachmentButton(renderer);
    expect(button).toBeTruthy();
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('添加素材');

    act(() => button.props.onPress());
    expect(onOpenAttachments).toHaveBeenCalledTimes(1);
    unmount(renderer);
  });

  test('设备离线 → 入口保留但禁用', () => {
    const renderer = render({
      attachmentsEnabled: true,
      deviceOffline: true,
      onOpenAttachments: jest.fn(),
    });
    expect(attachmentButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('只读会话 → 入口保留但禁用', () => {
    const renderer = render({
      attachmentsEnabled: true,
      readOnlyReason: '会话已结束',
      onOpenAttachments: jest.fn(),
    });
    expect(attachmentButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });
});

describe('MessageComposer 发送键（纯素材）', () => {
  const sendButton = (renderer: TestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(
      node =>
        node.props?.testID === 'composer-send' &&
        typeof node.props?.onPress === 'function',
    )[0];

  test('输入为空、没有素材 → 发送键禁用', () => {
    const renderer = render({});
    expect(sendButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('输入为空但已选素材 → 发送键可用（会话页补默认说明）', () => {
    const renderer = render({ attachmentCount: 1 });
    expect(sendButton(renderer).props.disabled).toBe(false);
    unmount(renderer);
  });

  test('有素材但会话只读 → 仍然禁用', () => {
    const renderer = render({
      attachmentCount: 2,
      readOnlyReason: '会话已结束',
    });
    expect(sendButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });

  test('有素材但设备离线 → 仍然禁用', () => {
    const renderer = render({ attachmentCount: 1, deviceOffline: true });
    expect(sendButton(renderer).props.disabled).toBe(true);
    unmount(renderer);
  });
});
