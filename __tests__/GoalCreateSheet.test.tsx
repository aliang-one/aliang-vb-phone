import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { GoalCreateSheet } from '../src/components/vibecoding/GoalCreateSheet';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

jest.mock('../src/components/shared/BottomSheet', () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <>{children}</> : null,
}));

const renderSheet = (
  overrides: Partial<React.ComponentProps<typeof GoalCreateSheet>> = {},
) => {
  const props: React.ComponentProps<typeof GoalCreateSheet> = {
    open: true,
    projectPath: '/workspace/app',
    objective: 'Complete Goal support',
    syncing: false,
    creating: false,
    onClose: jest.fn(),
    onObjectiveChange: jest.fn(),
    onCreate: jest.fn(),
    onOpenActive: jest.fn(),
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: jest.fn(),
        isDark: false,
      }}>
        <GoalCreateSheet {...props} />
      </ThemeContext.Provider>,
    );
  });
  return { renderer: renderer!, props };
};

describe('GoalCreateSheet', () => {
  it('shows the active Goal progress and opens its detail', () => {
    const { renderer, props } = renderSheet({
      activeGoal: {
        goal_id: 'goal-1',
        ai_session_id: 'goal-1',
        objective: 'Complete Goal support',
        state: 'active',
        state_version: 3,
        provider: 'claudecode',
        driver: 'server',
        completed_tasks: 2,
        total_tasks: 5,
        updated_at: '2026-07-21T10:00:00.000Z',
      },
    });
    const text = renderer.root.findAllByType(Text)
      .flatMap(node => node.props.children)
      .join(' ');
    expect(text.replace(/\s+/g, '')).toContain('2/5个任务');

    act(() => renderer.root.findByProps({ testID: 'goal-open-active' }).props.onPress());
    expect(props.onOpenActive).toHaveBeenCalledWith(
      expect.objectContaining({ goal_id: 'goal-1' }),
    );
  });

  it('submits a new objective from the explicit Goal entry', () => {
    const { renderer, props } = renderSheet();
    act(() => renderer.root.findByProps({ testID: 'goal-create-submit' }).props.onPress());
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });
});
