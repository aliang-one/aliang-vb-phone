import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TranscriptMessageList } from '../src/components/vibecoding/TranscriptMessageList';
import type { DisplayTranscriptMessage } from '../src/utils/agentTranscript';

let currentRenderer: ReactTestRenderer.ReactTestRenderer | undefined;

const wrap = (ui: React.ReactElement) => {
  act(() => {
    currentRenderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}
      >
        {ui}
      </ThemeContext.Provider>,
    );
  });
  return currentRenderer!;
};

afterEach(() => {
  if (currentRenderer) {
    act(() => {
      currentRenderer!.unmount();
    });
    currentRenderer = undefined;
  }
});

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

const textsIn = (node: ReactTestRenderer.ReactTestInstance) =>
  node.findAllByType(Text).map(t => String(t.props.children));

const btnByLabel = (root: ReactTestRenderer.ReactTestRenderer, label: string) =>
  root.root.findAllByType(TouchableOpacity).find(c =>
    textsIn(c).some(t => t === label),
  );

const userMessage = (overrides: Partial<DisplayTranscriptMessage> = {}): DisplayTranscriptMessage => ({
  id: 'u1',
  role: 'user',
  timestamp: '10:01',
  mergedCount: 1,
  segments: [{ id: 'seg1', kind: 'text', content: '帮我修个bug', blocks: [] }],
  sourceMessageIds: ['u1'],
  ...overrides,
});

describe('TranscriptMessageList — 失败回合重试入口 (case B)', () => {
  it('失败回合 user 消息渲染「未收到回复 · 重试」(无「删除」)', () => {
    const root = wrap(
      <TranscriptMessageList
        message={userMessage()}
        turnFailedMessageId="u1"
        onRetryTurn={jest.fn()}
      />,
    );
    const texts = allTexts(root);
    expect(texts.some(t => t === '未收到回复')).toBe(true);
    expect(texts.some(t => t === '重试')).toBe(true);
    // case B 的消息是真实送达的,不给「删除」(那是 case A 失败气泡才有的)。
    expect(texts.some(t => t === '删除')).toBe(false);
    expect(texts.some(t => t === '发送失败')).toBe(false);
  });

  it('点「重试」→ onRetryTurn 带该消息 id 触发', () => {
    const onRetryTurn = jest.fn();
    const root = wrap(
      <TranscriptMessageList
        message={userMessage()}
        turnFailedMessageId="u1"
        onRetryTurn={onRetryTurn}
      />,
    );
    act(() => {
      btnByLabel(root, '重试')!.props.onPress();
    });
    expect(onRetryTurn).toHaveBeenCalledWith('u1');
  });

  it('普通 user 消息(无 turnFailedMessageId)不渲染重试入口', () => {
    const root = wrap(<TranscriptMessageList message={userMessage()} />);
    const texts = allTexts(root);
    expect(texts.some(t => t === '未收到回复')).toBe(false);
  });

  it('turnFailedMessageId 不匹配的消息不渲染入口', () => {
    const root = wrap(
      <TranscriptMessageList
        message={userMessage()}
        turnFailedMessageId="some-other-id"
        onRetryTurn={jest.fn()}
      />,
    );
    expect(allTexts(root).some(t => t === '未收到回复')).toBe(false);
  });

  it('message.failed(case A 发送失败)优先,不叠 case B 入口', () => {
    // 一条气泡不可能同时是「发送失败」又「未收到回复」。failed 优先走 case A 行,
    // 即便 turnFailedMessageId 命中也不重复渲染 case B 入口。
    const root = wrap(
      <TranscriptMessageList
        message={userMessage({ failed: true })}
        turnFailedMessageId="u1"
        onRetryFailed={jest.fn()}
        onDismissFailed={jest.fn()}
        onRetryTurn={jest.fn()}
      />,
    );
    const texts = allTexts(root);
    expect(texts.some(t => t === '发送失败')).toBe(true);
    expect(texts.some(t => t === '未收到回复')).toBe(false);
  });
});
