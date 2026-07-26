import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GoalDeletedFold } from '../src/components/vibecoding/GoalDeletedFold';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import type { AgentMessage } from '../src/data/platformModels';

const hiddenMessage = (id: string, content: string): AgentMessage => ({
  id,
  role: 'assistant',
  content,
  timestamp: '2026-07-26T00:00:00.000Z',
  goalId: 'G1',
  hiddenAt: '2026-07-26T00:00:05.000Z',
});

const wrap = (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}>
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const visibleText = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');

describe('GoalDeletedFold', () => {
  it('renders collapsed header with title, objective and message count, hiding message bodies', () => {
    const root = wrap(
      <GoalDeletedFold
        goalId="G1"
        objective="搭建登录"
        messages={[
          hiddenMessage('m1', '规划登录步骤'),
          hiddenMessage('m2', '执行登录实现'),
        ]}
      />,
    );

    const text = visibleText(root);
    // 折叠态标题
    expect(text).toContain('已删除的 Goal');
    // objective 显示
    expect(text).toContain('搭建登录');
    // 计数
    expect(text.replace(/\s+/g, '')).toContain('2条消息');

    // 折叠态不渲染消息正文
    expect(text).not.toContain('规划登录步骤');
    expect(text).not.toContain('执行登录实现');

    // 折叠态没有 message-* 节点
    expect(root.root.findAllByProps({ testID: 'goal-deleted-fold-message-0' })).toHaveLength(0);
    expect(root.root.findAllByProps({ testID: 'goal-deleted-fold-message-1' })).toHaveLength(0);

    // toggle 按钮存在
    expect(root.root.findByProps({ testID: 'goal-deleted-fold-toggle' })).toBeTruthy();
  });

  it('expands to reveal messages and collapses again on toggle', () => {
    const root = wrap(
      <GoalDeletedFold
        goalId="G1"
        objective="搭建登录"
        messages={[
          hiddenMessage('m1', '规划登录步骤'),
          hiddenMessage('m2', '执行登录实现'),
        ]}
      />,
    );

    // 展开前消息正文不可见
    expect(visibleText(root)).not.toContain('规划登录步骤');

    act(() => {
      root.root.findByProps({ testID: 'goal-deleted-fold-toggle' }).props.onPress();
    });

    // 展开后渲染 N 条消息
    expect(root.root.findByProps({ testID: 'goal-deleted-fold-message-0' })).toBeTruthy();
    expect(root.root.findByProps({ testID: 'goal-deleted-fold-message-1' })).toBeTruthy();
    expect(visibleText(root)).toContain('规划登录步骤');
    expect(visibleText(root)).toContain('执行登录实现');

    // 再点收起
    act(() => {
      root.root.findByProps({ testID: 'goal-deleted-fold-toggle' }).props.onPress();
    });
    expect(root.root.findAllByProps({ testID: 'goal-deleted-fold-message-0' })).toHaveLength(0);
    expect(root.root.findAllByProps({ testID: 'goal-deleted-fold-message-1' })).toHaveLength(0);
    expect(visibleText(root)).not.toContain('规划登录步骤');
  });

  it('renders nothing when there are no hidden messages', () => {
    const root = wrap(
      <GoalDeletedFold goalId="G1" objective="搭建登录" messages={[]} />,
    );
    // 没有折叠头 toggle
    expect(root.root.findAllByProps({ testID: 'goal-deleted-fold-toggle' })).toHaveLength(0);
  });

  it('falls back to a placeholder objective when absent', () => {
    const root = wrap(
      <GoalDeletedFold
        goalId="G1"
        messages={[hiddenMessage('m1', '内容')]}
      />,
    );
    const text = visibleText(root);
    // 仍有计数
    expect(text.replace(/\s+/g, '')).toContain('1条消息');
  });
});
