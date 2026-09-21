import React from 'react';
import { ActivityIndicator } from 'react-native';
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
const onPress = jest.fn();
const onLongPress = jest.fn();

const renderFab = async (
  phase: 'idle' | 'recording' | 'generating' | 'error',
  disabled = false,
) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalVoiceFab phase={phase} disabled={disabled} onPress={onPress} onLongPress={onLongPress} />,
      ),
    );
  });
};
const fab = () => screen.root.findByProps({ testID: 'terminal-voice-fab' });
const hasPulse = () => {
  try { return Boolean(screen.root.findByProps({ testID: 'terminal-voice-fab-pulse' })); }
  catch { return false; }
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalVoiceFab', () => {
  it('idle: mic + press/long-press wired', async () => {
    await renderFab('idle');
    expect(fab()).toBeTruthy();
    act(() => { fab().props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => { fab().props.onLongPress?.(); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(hasPulse()).toBe(false);
  });

  it('recording: pulse overlay visible, red error tint', async () => {
    await renderFab('recording');
    expect(hasPulse()).toBe(true);
    expect(JSON.stringify(fab().props.style)).toContain(utilityMinimalist.colors.error);
    // 颜色/动效不能是唯一指示:录音态由无障碍标签同步播报。
    expect(fab().props.accessibilityLabel).toContain('正在聆听…');
  });

  it('generating: spinner replaces the mic', async () => {
    await renderFab('generating');
    expect(screen.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(hasPulse()).toBe(false);
    expect(fab().props.accessibilityState).toEqual({ disabled: false, busy: true });
  });

  it('error: still pressable (retry semantics live in the screen)', async () => {
    await renderFab('error');
    act(() => { fab().props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled passthrough', async () => {
    await renderFab('idle', true);
    expect(fab().props.disabled).toBe(true);
  });
});
