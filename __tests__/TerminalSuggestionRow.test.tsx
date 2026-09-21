import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalSuggestionRow } from '../src/components/terminal/TerminalSuggestionRow';
import type { AiSuggestionChip } from '../src/utils/aiSuggestions';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const chip = (command: string, dangerous = false): AiSuggestionChip => ({ command, dangerous });
let screen: ReactTestRenderer.ReactTestRenderer;
const onExecute = jest.fn();

const renderRow = async (props: {
  chips: AiSuggestionChip[];
  disabled?: boolean;
}) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalSuggestionRow
          chips={props.chips}
          disabled={props.disabled ?? false}
          onExecute={onExecute}
        />,
      ),
    );
  });
};
const byTestID = (id: string) => screen.root.findByProps({ testID: id });
const press = (id: string) => act(() => { byTestID(id).props.onPress(); });

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalSuggestionRow', () => {
  it('shows the empty hint when there are no chips', async () => {
    await renderRow({ chips: [] });
    expect(byTestID('terminal-suggestion-empty')).toBeTruthy();
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '点右侧麦克风说出命令，长按可输入文字'),
    ).toBe(true);
  });

  it('renders chips with slugged testIDs and executes a safe chip on tap', async () => {
    await renderRow({ chips: [chip('git status --short')] });
    expect(byTestID('terminal-suggestion-git-status-short')).toBeTruthy();
    press('terminal-suggestion-git-status-short');
    expect(onExecute).toHaveBeenCalledWith('git status --short');
  });

  it('dangerous chip: first tap arms (shows 再点确认执行), second tap executes', async () => {
    await renderRow({ chips: [chip('rm -rf /tmp/vibe-test', true)] });
    press('terminal-suggestion-rm-rf-tmp-vibe-test');
    expect(onExecute).not.toHaveBeenCalled();
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '再点确认执行'),
    ).toBe(true);
    press('terminal-suggestion-rm-rf-tmp-vibe-test');
    expect(onExecute).toHaveBeenCalledWith('rm -rf /tmp/vibe-test');
  });

  it('armed state auto-resets after 3s', async () => {
    await renderRow({ chips: [chip('rm -rf /tmp/vibe-test', true)] });
    const id = 'terminal-suggestion-rm-rf-tmp-vibe-test';
    press(id);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '再点确认执行'),
    ).toBe(false);
    press(id); // 复位后再点 = 重新武装,不执行
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('disabled chips never execute', async () => {
    await renderRow({ chips: [chip('pwd')], disabled: true });
    press('terminal-suggestion-pwd');
    expect(onExecute).not.toHaveBeenCalled();
  });
});
