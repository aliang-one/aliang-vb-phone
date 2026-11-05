// MessageComposer 听写契约：composer 侧手势/光标上报/提示行（Task 3 起分批补齐）。
// 仿 memo.test 的 TestRenderer + 全 props 构建惯例。
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

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

function buildProps(overrides: Partial<MessageComposerProps> = {}): MessageComposerProps {
  return {
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
    ...overrides,
  } as MessageComposerProps;
}

describe('MessageComposer 听写契约', () => {
  it('TextInput onSelectionChange 经 onComposerSelectionChange 上报', () => {
    const onComposerSelectionChange = jest.fn();
    // React 19.2.3 的 react-test-renderer 下 create 不经 act 不会同步提交
    // (DefaultLane 调度),裸 create 后立即取 tree.root 会抛 "unmounted" ——
    // 与 memo/steer/attachments 测试一致,create 必须包进 act。
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer {...buildProps({ input: 'hello', onComposerSelectionChange })} />,
      );
    });
    const textInput = tree.root.find(node => node.props.testID === 'composer-text-input');
    act(() => {
      textInput.props.onSelectionChange({
        nativeEvent: { selection: { start: 2, end: 5 } },
      });
    });
    expect(onComposerSelectionChange).toHaveBeenCalledWith({ start: 2, end: 5 });
  });

  it('ref.setSelection 存在且可调用（透传 TextInput）', () => {
    const ref = React.createRef<{ setSelection: (s: number, e: number) => void }>();
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<MessageComposer ref={ref} {...buildProps()} />);
    });
    // TestRenderer 下底层 TextInput 是 host 组件、ref 为 null，但句柄方法
    // 必须存在且空值安全（内部用 ?. 透传，不抛错）。
    expect(typeof ref.current?.setSelection).toBe('function');
    expect(() => ref.current?.setSelection(1, 1)).not.toThrow();
    tree?.unmount();
  });
});
