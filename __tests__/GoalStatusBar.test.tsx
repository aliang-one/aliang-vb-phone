import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { GoalDraftBar, GoalStatusBar } from '../src/components/vibecoding/GoalStatusBar';
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
    const onView = jest.fn();
    const onPause = jest.fn();
    const onDelete = jest.fn();
    const onMore = jest.fn();
    const renderer = renderBar({
      onView,
      onPause,
      onDelete,
      onMore,
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
    act(() => renderer.root.findByProps({ testID: 'goal-action-view' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'goal-action-pause' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'goal-action-delete' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'goal-action-more' }).props.onPress());
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('shows syncing without fabricating 0/0 when summary is absent', () => {
    const renderer = renderBar({ onView: jest.fn() });
    expect(visibleText(renderer)).toContain('同步中');
    expect(visibleText(renderer)).toContain('正在获取 Goal 状态');
    expect(visibleText(renderer)).not.toContain('0/0');
  });

  it('replaces pause with continue after the server reaches the paused boundary', () => {
    const onResume = jest.fn();
    const renderer = renderBar({
      onView: jest.fn(),
      onResume,
      summary: { goalId: 'goal-1', state: 'paused' },
    });
    expect(() => renderer.root.findByProps({ testID: 'goal-action-pause' })).toThrow();
    act(() => renderer.root.findByProps({ testID: 'goal-action-resume' }).props.onPress());
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders a recover button with the server-provided label when the Goal is recoverable', () => {
    const onRecover = jest.fn();
    const renderer = renderBar({
      onView: jest.fn(),
      onRecover,
      summary: {
        goalId: 'goal-1',
        state: 'active',
        recoverable: true,
        stalled: true,
        primaryActionKind: 'retry',
        primaryActionLabel: '重试任务',
      },
    });
    const button = renderer.root.findByProps({ testID: 'goal-action-recover' });
    expect(visibleText(renderer)).toContain('重试任务');
    act(() => button.props.onPress());
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it('does not render a recover button when the Goal is not recoverable', () => {
    const renderer = renderBar({
      onView: jest.fn(),
      onRecover: jest.fn(),
      summary: {
        goalId: 'goal-1',
        state: 'active',
        recoverable: false,
      },
    });
    expect(() => renderer.root.findByProps({ testID: 'goal-action-recover' })).toThrow();
  });

  it('disables the recover button and shows 恢复中 while actionLoading is recover', () => {
    const onRecover = jest.fn();
    const renderer = renderBar({
      onView: jest.fn(),
      onRecover,
      actionLoading: 'recover',
      summary: {
        goalId: 'goal-1',
        state: 'active',
        recoverable: true,
        primaryActionKind: 'continue',
        primaryActionLabel: '继续',
      },
    });
    const button = renderer.root.findByProps({ testID: 'goal-action-recover' });
    expect(button.props.disabled).toBe(true);
    expect(visibleText(renderer)).toContain('恢复中');
  });

  it('locks Goal draft exit while creation is in flight', () => {
    const onExit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
          <GoalDraftBar creating onExit={onExit} />
        </ThemeContext.Provider>,
      );
    });
    expect(renderer!.root.findByProps({ testID: 'goal-draft-exit' }).props.disabled).toBe(true);
    expect(visibleText(renderer!)).toContain('正在创建 Goal');
  });

  it('shows the current unsent objective in the Goal draft bar', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
          <GoalDraftBar objective="完成登录流程" onExit={jest.fn()} />
        </ThemeContext.Provider>,
      );
    });
    expect(visibleText(renderer!)).toContain('完成登录流程');
  });
});
