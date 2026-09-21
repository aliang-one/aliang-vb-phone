import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalAiStatusStrip } from '../src/components/terminal/TerminalAiStatusStrip';
import type { AiSuggestPhase } from '../src/hooks/useAiCommandSuggestions';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

let screen: ReactTestRenderer.ReactTestRenderer;
const handlers = {
  onRetry: jest.fn(),
  onDismissError: jest.fn(),
  onSendText: jest.fn(),
  onCloseText: jest.fn(),
};

const renderStrip = async (props: {
  phase: AiSuggestPhase;
  textMode?: boolean;
  liveCaption?: string;
  liveStatus?: string;
  errorText?: string;
}) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalAiStatusStrip
          phase={props.phase}
          textMode={props.textMode ?? false}
          liveCaption={props.liveCaption ?? ''}
          liveStatus={props.liveStatus ?? ''}
          errorText={props.errorText ?? ''}
          {...handlers}
        />,
      ),
    );
  });
};
const byTestID = (id: string) => screen.root.findByProps({ testID: id });

beforeEach(() => jest.clearAllMocks());
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalAiStatusStrip', () => {
  it('recording: shows live caption or the listening fallback', async () => {
    await renderStrip({ phase: 'recording', liveCaption: '看看状态' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '看看状态')).toBe(true);
    await renderStrip({ phase: 'recording', liveCaption: '' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在聆听…')).toBe(true);
  });

  it('generating: shows liveStatus or the generating fallback', async () => {
    await renderStrip({ phase: 'generating', liveStatus: 'list_dir' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === 'list_dir')).toBe(true);
    await renderStrip({ phase: 'generating', liveStatus: '' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在生成建议…')).toBe(true);
  });

  it('error: message + retry + dismiss', async () => {
    await renderStrip({ phase: 'error', errorText: '生成命令失败' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '生成命令失败')).toBe(true);
    act(() => { byTestID('terminal-ai-retry').props.onPress(); });
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    act(() => { byTestID('terminal-ai-error-dismiss').props.onPress(); });
    expect(handlers.onDismissError).toHaveBeenCalledTimes(1);
  });

  it('textMode: editable input + send (trimmed, clears draft) + cancel', async () => {
    await renderStrip({ phase: 'idle', textMode: true });
    const input = screen.root.findAllByType(TextInput).find(n => n.props.testID === 'terminal-ai-text-input');
    expect(input).toBeTruthy();
    expect(byTestID('terminal-ai-text-send').props.disabled).toBe(true);
    act(() => { input!.props.onChangeText('  看看状态  '); });
    expect(byTestID('terminal-ai-text-send').props.disabled).toBe(false);
    act(() => { byTestID('terminal-ai-text-send').props.onPress(); });
    expect(handlers.onSendText).toHaveBeenCalledWith('看看状态');
    act(() => { byTestID('terminal-ai-text-cancel').props.onPress(); });
    expect(handlers.onCloseText).toHaveBeenCalledTimes(1);
  });
});
