import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ApprovalCustomReply } from '../src/components/vibecoding/ApprovalCustomReply';

// Stub VoiceTextInput so tests drive the host logic without the STT stack.
jest.mock('../src/components/vibecoding/VoiceTextInput', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return {
    VoiceTextInput: (props: any) => (
      <TextInput
        testID={`${props.testIDPrefix ?? 'rename'}-input`}
        value={props.value}
        onChangeText={props.onChangeText}
        onSubmitEditing={props.onSubmitEditing}
      />
    ),
  };
});

const wrap = (ui: React.ReactElement) => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
      >
        {ui}
      </ThemeContext.Provider>,
    );
  });
  return r;
};

const baseProps = (onSend: jest.Mock) => ({
  approvalId: 'a1',
  triggerLabel: 'Reply',
  placeholder: 'Type your reply',
  sendLabel: 'Send',
  onSend,
});

// testID-based lookup (agnostic to TouchableOpacity vs Pressable inside GlowButton).
const findByTID = (r: ReactTestRenderer.ReactTestRenderer, tid: string) =>
  r.root.findAll((node: any) => node.props.testID === tid)[0];

const sendDisabled = (r: ReactTestRenderer.ReactTestRenderer) =>
  findByTID(r, 'approval-custom-reply-send-a1')?.props.disabled;

describe('ApprovalCustomReply', () => {
  it('折叠态:渲染触发器,不渲染输入/发送', () => {
    const r = wrap(<ApprovalCustomReply {...baseProps(jest.fn())} />);
    expect(findByTID(r, 'approval-custom-reply-trigger-a1')).toBeTruthy();
    expect(findByTID(r, 'approval-custom-reply-send-a1')).toBeUndefined();
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });

  it('点触发器展开:出现输入框与发送按钮', () => {
    const r = wrap(<ApprovalCustomReply {...baseProps(jest.fn())} />);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findAllByType(TextInput).length).toBe(1);
    expect(findByTID(r, 'approval-custom-reply-send-a1')).toBeTruthy();
  });

  it('空文本时发送禁用;输入后启用', () => {
    const r = wrap(<ApprovalCustomReply {...baseProps(jest.fn())} />);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(sendDisabled(r)).toBe(true);
    act(() => r.root.findByType(TextInput).props.onChangeText('  hello '));
    expect(sendDisabled(r)).toBe(false);
  });

  it('输入后点发送:调 onSend(trim) 并清空收起', () => {
    const onSend = jest.fn();
    const r = wrap(<ApprovalCustomReply {...baseProps(onSend)} />);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('  hello '));
    act(() => findByTID(r, 'approval-custom-reply-send-a1')!.props.onPress());
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });

  it('点 ✕ 收起:不调 onSend,再次展开文本保留', () => {
    const onSend = jest.fn();
    const r = wrap(<ApprovalCustomReply {...baseProps(onSend)} />);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('keep me'));
    act(() => findByTID(r, 'approval-custom-reply-collapse-a1')!.props.onPress());
    expect(onSend).not.toHaveBeenCalled();
    expect(r.root.findAllByType(TextInput).length).toBe(0);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findByType(TextInput).props.value).toBe('keep me');
  });

  it('disabled 时点触发器不展开', () => {
    const r = wrap(<ApprovalCustomReply {...baseProps(jest.fn())} disabled />);
    act(() => findByTID(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });
});
