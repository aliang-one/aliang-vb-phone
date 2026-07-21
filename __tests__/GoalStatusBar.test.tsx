import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { GoalStatusBar } from '../src/components/vibecoding/GoalStatusBar';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

const renderBar = (
  props: React.ComponentProps<typeof GoalStatusBar>,
) => {
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
        <GoalStatusBar {...props} />
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const visibleText = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');

describe('GoalStatusBar', () => {
  it('shows authoritative state and progress and opens Goal detail', () => {
    const onPress = jest.fn();
    const renderer = renderBar({
      onPress,
      summary: {
        goalId: 'goal-1',
        state: 'active',
        completedTasks: 2,
        totalTasks: 5,
        currentTask: 'Build mobile status bar',
      },
    });

    expect(visibleText(renderer)).toContain('执行中');
    expect(visibleText(renderer).replace(/\s+/g, '')).toContain('2/5个任务');
    act(() => renderer.root.findByProps({ testID: 'goal-status-bar' }).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows syncing without fabricating 0/0 when summary is absent', () => {
    const renderer = renderBar({ onPress: jest.fn() });
    expect(visibleText(renderer)).toContain('同步中');
    expect(visibleText(renderer)).toContain('正在获取 Goal 状态');
    expect(visibleText(renderer)).not.toContain('0/0');
  });
});
