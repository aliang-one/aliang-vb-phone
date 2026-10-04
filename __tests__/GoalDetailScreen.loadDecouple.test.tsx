/**
 * GoalDetailScreen 加载解耦回归(2026-10-05 评审):
 * refreshGoal 原用 Promise.all 同时取快照+事件,任一失败 summary 都不更新——
 * 快照成功而事件失败时头部永远停在「Goal · 同步中」,且 canDelete=false
 * 删除按钮不渲染。契约:快照与事件独立落账,快照成功即更新 summary/
 * 放行删除,事件失败不影响头部;仅快照失败才进错误态。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GoalDetailScreen } from '../src/screens/vibecoding/GoalDetailScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { fetchGoalSnapshot, fetchGoalEvents } from '../src/api/goals';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({
    params: { goalId: 'goal_decouple_1', sourceSessionId: 'session_1' },
  }),
}));

jest.mock('../src/api/goals', () => ({
  fetchGoalSnapshot: jest.fn(),
  fetchGoalEvents: jest.fn(),
  acceptGoal: jest.fn(),
  declineGoal: jest.fn(),
  approveGoalPlan: jest.fn(),
  deleteGoal: jest.fn(),
  recoverGoal: jest.fn(),
  pauseGoal: jest.fn(),
  resumeGoal: jest.fn(),
  forkGoal: jest.fn(),
  abandonFork: jest.fn(),
  mergeFork: jest.fn(),
  goalSnapshotToSummary: jest.requireActual('../src/api/goals').goalSnapshotToSummary,
  newerGoalSummary: jest.requireActual('../src/api/goals').newerGoalSummary,
}));

const snapshot = () => ({
  goal_id: 'goal_decouple_1',
  ai_session_id: 'session_1',
  objective: '解耦回归目标',
  state: 'planning_failed',
  state_version: 2,
  completed_tasks: 0,
  total_tasks: 0,
  updated_at: '2026-07-26T01:06:16.572Z',
});

const renderScreen = async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ insets: { top: 0, bottom: 0, left: 0, right: 0 } } as never}>
        <ThemeContext.Provider
          value={
            {
              theme: utilityMinimalist,
              isDark: false,
              mode: 'system',
              setMode: () => undefined,
            } as never
          }
        >
          <GoalDetailScreen />
        </ThemeContext.Provider>
      </SafeAreaProvider>,
    );
  });
  return renderer!;
};

const collectText = (renderer: ReactTestRenderer.ReactTestRenderer): string => {
  const texts: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance) => {
    if (typeof node.props.children === 'string') texts.push(node.props.children);
    node.children.forEach(child => {
      if (typeof child === 'object') walk(child as ReactTestRenderer.ReactTestInstance);
    });
  };
  walk(renderer.root);
  return texts.join('\n');
};

describe('GoalDetailScreen 快照/事件加载解耦(评审回归)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchGoalEvents as jest.Mock).mockResolvedValue({ events: [], next_after: undefined });
  });

  it('快照成功+事件失败:summary 仍更新,退出同步中且删除按钮可用', async () => {
    (fetchGoalSnapshot as jest.Mock).mockResolvedValue(snapshot());
    (fetchGoalEvents as jest.Mock).mockRejectedValue(new Error('events unavailable'));

    const renderer = await renderScreen();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = collectText(renderer);
    expect(text).toContain('规划需处理');
    expect(text).not.toContain('Goal · 同步中');
    // canDelete=true → 删除按钮渲染
    const deleteButtons = renderer.root.findAllByProps({ accessibilityLabel: '删除 Goal' });
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('双成功:正常渲染,无错误横幅', async () => {
    (fetchGoalSnapshot as jest.Mock).mockResolvedValue(snapshot());
    const renderer = await renderScreen();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = collectText(renderer);
    expect(text).toContain('规划需处理');
    expect(text).not.toContain('Goal 状态同步失败');
  });

  it('快照失败:进入错误态(可重试),不显示状态标签', async () => {
    (fetchGoalSnapshot as jest.Mock).mockRejectedValue(new Error('snapshot unavailable'));
    const renderer = await renderScreen();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = collectText(renderer);
    expect(text).toContain('snapshot unavailable');
    expect(text).not.toContain('规划需处理');
  });
});
