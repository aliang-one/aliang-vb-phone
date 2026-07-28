import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
// GoalSummaryHeader is the header block within GoalDetailScreen that surfaces
// the failure real-reason `attention` line. We export it from the screen module
// so it can be unit-tested in isolation without mounting react-navigation +
// control-center store (mirrors the GoalStatusBar.test.tsx pattern).
import { GoalSummaryHeader } from '../src/screens/vibecoding/GoalDetailScreen';
import type { GoalSummary } from '../src/data/platformModels';

const renderHeader = (summary?: GoalSummary) => {
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
        <GoalSummaryHeader summary={summary} />
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

const baseSummary = (overrides: Partial<GoalSummary> = {}): GoalSummary => ({
  goalId: 'goal-1',
  state: 'blocked',
  objective: '修复登录失败',
  ...overrides,
});

describe('GoalDetailScreen — attention (失败真因)', () => {
  it('renders the failure real-reason attention text with testID when present', () => {
    const renderer = renderHeader(
      baseSummary({ attention: 'npm: command not found' }),
    );
    // testID surfaces for downstream UI tests / integration hooks.
    expect(() => renderer.root.findByProps({ testID: 'goal-attention' })).not.toThrow();
    expect(visibleText(renderer)).toContain('npm: command not found');
  });

  it('maps budget/run-failed blockedReasons to the humanized replan hint', () => {
    // goal_run_failed → '任务多次失败，可重新规划' on the server; the phone just
    // echoes summary.attention verbatim, so this is what the user sees.
    const renderer = renderHeader(
      baseSummary({ attention: '任务多次失败，可重新规划' }),
    );
    expect(visibleText(renderer)).toContain('任务多次失败，可重新规划');
    expect(() => renderer.root.findByProps({ testID: 'goal-attention' })).not.toThrow();
  });

  it('does not render the attention block when attention is absent', () => {
    const renderer = renderHeader(baseSummary({ attention: undefined }));
    expect(() => renderer.root.findByProps({ testID: 'goal-attention' })).toThrow();
  });

  it('does not render the attention block when attention is empty string', () => {
    const renderer = renderHeader(baseSummary({ attention: '' }));
    expect(() => renderer.root.findByProps({ testID: 'goal-attention' })).toThrow();
  });
});
