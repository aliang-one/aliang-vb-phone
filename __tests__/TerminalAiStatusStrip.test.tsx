import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalAiStatusStrip } from '../src/components/terminal/TerminalAiStatusStrip';
import type { AiSuggestPhase, AiSuggestProgress } from '../src/hooks/useAiCommandSuggestions';

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
  progress?: AiSuggestProgress | null;
  errorText?: string;
}) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalAiStatusStrip
          phase={props.phase}
          textMode={props.textMode ?? false}
          liveCaption={props.liveCaption ?? ''}
          progress={props.progress ?? null}
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
    act(() => { screen.unmount(); });
    await renderStrip({ phase: 'recording', liveCaption: '' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在聆听…')).toBe(true);
  });

  it('generating: 进度行显示 步数/工具/耗时,无进度时回退到生成中文案', async () => {
    await renderStrip({
      phase: 'generating',
      progress: { stepsDone: 4, currentTool: 'read_file', startedAt: Date.now() - 37_000 },
    });
    const texts = () => screen.root.findAllByType(Text).map(n => String(n.props.children));
    expect(texts().some(s => s.includes('第 5 步'))).toBe(true);
    expect(texts().some(s => s.includes('读取文件'))).toBe(true);
    expect(texts().some(s => s.includes('37s'))).toBe(true);
    act(() => { screen.unmount(); });
    await renderStrip({ phase: 'generating', progress: null });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在生成建议…')).toBe(true);
  });

  it('generating: 工具间空档显示已完成步数+耗时,并随时间前进', async () => {
    await renderStrip({
      phase: 'generating',
      progress: { stepsDone: 3, currentTool: null, startedAt: Date.now() - 42_000 },
    });
    const texts = () => screen.root.findAllByType(Text).map(n => String(n.props.children));
    expect(texts().some(s => s.includes('已完成 3 步'))).toBe(true);
    expect(texts().some(s => s.includes('42s'))).toBe(true);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(texts().some(s => s.includes('43s'))).toBe(true);
  });

  it('recovering: 断连恢复文案 + 已运行耗时', async () => {
    await renderStrip({
      phase: 'recovering',
      progress: { stepsDone: 6, currentTool: null, startedAt: Date.now() - 65_000 },
    });
    const texts = () => screen.root.findAllByType(Text).map(n => String(n.props.children));
    expect(texts().some(s => s.includes('连接中断，后台仍在生成'))).toBe(true);
    expect(texts().some(s => s.includes('65s'))).toBe(true);
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
    // 草稿已清空 → 发送钮回到禁用态(空文本不可重复发送)。
    expect(input!.props.value).toBe('');
    expect(byTestID('terminal-ai-text-send').props.disabled).toBe(true);
    act(() => { byTestID('terminal-ai-text-cancel').props.onPress(); });
    expect(handlers.onCloseText).toHaveBeenCalledTimes(1);
  });
});
