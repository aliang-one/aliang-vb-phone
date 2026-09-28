import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalVoiceFab } from '../src/components/terminal/TerminalVoiceFab';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

let screen: ReactTestRenderer.ReactTestRenderer;
const onShortPress = jest.fn();
const onHoldStart = jest.fn();
const onHoldEnd = jest.fn();

const renderFab = async (
  phase: 'idle' | 'recording' | 'generating' | 'error',
  disabled = false,
) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalVoiceFab
          phase={phase}
          disabled={disabled}
          onShortPress={onShortPress}
          onHoldStart={onHoldStart}
          onHoldEnd={onHoldEnd}
        />,
      ),
    );
  });
};

// 旋转容器是 Animated.View:createAnimatedComponent 会把 testID 扇出到
// 多个节点(仓库先例:src/components/terminal/__tests__ 同款注释),故用
// findAll 计数断存在,不能用 findByProps(多匹配会 throw)。
const hasSpin = () => screen.root.findAllByProps({ testID: 'terminal-voice-fab-spin' }).length > 0;

beforeEach(() => jest.clearAllMocks());
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalVoiceFab', () => {
  it('generating: logo spins (no corner spinner)', async () => {
    await renderFab('generating');
    expect(hasSpin()).toBe(true);
    expect(screen.root.findAllByProps({ testID: 'terminal-voice-fab-spinner' })).toHaveLength(0);
  });

  it('idle/recording/error: no spin wrapper', async () => {
    for (const phase of ['idle', 'recording', 'error'] as const) {
      await renderFab(phase);
      expect(hasSpin()).toBe(false);
    }
  });

  it('reduce motion: generating keeps the logo static', async () => {
    const reduce = require('../src/hooks/useReduceMotion');
    reduce.__setMockReduceMotion?.(true);
    await renderFab('generating');
    expect(hasSpin()).toBe(false);
    reduce.__setMockReduceMotion?.(false);
  });
});
