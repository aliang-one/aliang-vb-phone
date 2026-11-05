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
    act(() => {
      tree.unmount();
    });
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
    act(() => {
      tree?.unmount();
    });
  });
});

describe('MessageComposer toggle 长按手势', () => {
  it('长按触发 onDictationPressIn，不触发 onModeChange；按住期间点按(双指误触)也不切模式', () => {
    const onDictationPressIn = jest.fn();
    const onDictationPressOut = jest.fn();
    const onModeChange = jest.fn();
    // create 包 act：React 19.2.3 下裸 create 不经同步提交，立即取
    // tree.root 会抛 "unmounted"（见上方 Task 3 注释/steer/attachments 惯例）。
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer
          {...buildProps({ onDictationPressIn, onDictationPressOut, onModeChange })}
        />,
      );
    });
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onLongPress());
    act(() => toggle.props.onPress()); // 按住期间的双指误触/系统重放
    expect(onDictationPressIn).toHaveBeenCalledTimes(1);
    expect(onModeChange).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('长按后的 onPressOut 触发 onDictationPressOut；普通点按的 onPressOut 不触发', () => {
    const onDictationPressIn = jest.fn();
    const onDictationPressOut = jest.fn();
    const onModeChange = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer
          {...buildProps({ onDictationPressIn, onDictationPressOut, onModeChange })}
        />,
      );
    });
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onPressOut()); // 无长按时：no-op
    expect(onDictationPressOut).not.toHaveBeenCalled();
    act(() => toggle.props.onLongPress());
    act(() => toggle.props.onPressOut()); // 长按后松手
    expect(onDictationPressOut).toHaveBeenCalledTimes(1);
    // 按住态已随 onPressOut 复位：此后的普通点按恢复切模式。
    act(() => toggle.props.onPress());
    expect(onModeChange).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
  });

  it('点按仍触发 onModeChange（现行为回归）', () => {
    const onModeChange = jest.fn();
    const onDictationPressIn = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer {...buildProps({ onModeChange, onDictationPressIn })} />,
      );
    });
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onPress());
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onDictationPressIn).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('只读态（readOnlyReason）长按不触发；未传可选 props 时长按不抛错', () => {
    const onDictationPressIn = jest.fn();
    const onDictationPressOut = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer
          {...buildProps({
            readOnlyReason: '会话只读',
            onDictationPressIn,
            onDictationPressOut,
          })}
        />,
      );
    });
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onLongPress?.());
    expect(onDictationPressIn).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });

    let bare!: TestRenderer.ReactTestRenderer;
    act(() => {
      bare = TestRenderer.create(<MessageComposer {...buildProps()} />);
    });
    const bareToggle = bare.root.find(node => node.props.testID === 'composer-toggle');
    // 未传 props（或只传一半）时 onLongPress 不挂载，空调用不抛错。
    expect(() => act(() => bareToggle.props.onLongPress?.())).not.toThrow();
    act(() => {
      bare.unmount();
    });
  });

  it('语音模式长按不进听写（慢按回归）：不触发 In/Out；松手后点按仍切回文本', () => {
    const onDictationPressIn = jest.fn();
    const onDictationPressOut = jest.fn();
    const onModeChange = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageComposer
          {...buildProps({
            mode: 'voice',
            onModeChange,
            onDictationPressIn,
            onDictationPressOut,
          })}
        />,
      );
    });
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    // 语音模式不挂长按处理（onLongPress 为 undefined）：即使 In/Out 成对
    // 传入，慢按也不触发听写、不误切模式——任意时长的按松仍走 onPress。
    expect(toggle.props.onLongPress).toBeUndefined();
    act(() => toggle.props.onLongPress?.());
    expect(onDictationPressIn).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    act(() => toggle.props.onPressOut()); // 无按住态：no-op
    expect(onDictationPressOut).not.toHaveBeenCalled();
    act(() => toggle.props.onPress());
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('text');
    act(() => {
      tree.unmount();
    });
  });
});
