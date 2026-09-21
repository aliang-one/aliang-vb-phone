import React from 'react';
import { Keyboard, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  useAiCommandSuggestions,
  type UseAiCommandSuggestionsResult,
} from '../src/hooks/useAiCommandSuggestions';
import type { UseVoiceSttResult, VoiceSttStatus } from '../src/hooks/useVoiceStt';

jest.useFakeTimers();

// --- controllable mocks (factory-defined arrows read at call time; no TDZ) ---
const mockVoiceSttState: {
  status: VoiceSttStatus;
  liveCaption: string;
  errorMessage: string;
} = { status: 'idle', liveCaption: '', errorMessage: '' };
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockCancel = jest.fn();

jest.mock('../src/hooks/useVoiceStt', () => ({
  useVoiceStt: (): UseVoiceSttResult => ({
    status: mockVoiceSttState.status,
    liveCaption: mockVoiceSttState.liveCaption,
    errorMessage: mockVoiceSttState.errorMessage,
    start: mockStart,
    stop: mockStop,
    cancel: mockCancel,
  }),
}));

const mockGenerateCommand = jest.fn();
jest.mock('../src/api/commandGen', () => ({
  generateCommand: (...args: unknown[]) => mockGenerateCommand(...args),
}));

const mockUnsubscribe = jest.fn();
let mockCommandGenListener: ((e: unknown) => void) | null = null;
jest.mock('../src/services/commandGenEvents', () => ({
  subscribeCommandGenEvents: (listener: (e: unknown) => void) => {
    mockCommandGenListener = listener;
    return mockUnsubscribe;
  },
}));

let latest: UseAiCommandSuggestionsResult;

const Probe = () => {
  latest = useAiCommandSuggestions({
    deviceId: 'device-1',
    cwd: '~/project',
    sessionId: 'term-1',
  });
  return <Text>{latest.phase}</Text>;
};

let screen: ReactTestRenderer.ReactTestRenderer | null = null;

const mount = async () => {
  await act(async () => {
    screen = ReactTestRenderer.create(<Probe />);
  });
};

const opts = () => mockStart.mock.calls.at(-1)?.[0] as
  | { onComplete: (t: string) => void }
  | undefined;

beforeEach(() => {
  screen = null;
  mockCommandGenListener = null;
  mockVoiceSttState.status = 'idle';
  mockVoiceSttState.liveCaption = '';
  mockVoiceSttState.errorMessage = '';
  jest.clearAllMocks();
  jest.spyOn(Keyboard, 'dismiss').mockImplementation();
});

afterEach(() => act(async () => { screen?.unmount(); }));

describe('useAiCommandSuggestions', () => {
  it('starts idle with no chips', async () => {
    await mount();
    expect(latest.phase).toBe('idle');
    expect(latest.chips).toEqual([]);
  });

  it('submitText → generating → chips land, unsubscribes after resolve', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'git status --short',
      commands: ['git status --short', 'git diff --stat'],
      dangerous: false,
      dangerousFlags: [false, false],
    });
    await mount();
    await act(async () => { latest.submitText('看看状态'); await Promise.resolve(); });
    expect(latest.chips).toEqual([
      { command: 'git status --short', dangerous: false },
      { command: 'git diff --stat', dangerous: false },
    ]);
    expect(latest.phase).toBe('idle');
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockGenerateCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: '看看状态', mode: 'live', sessionId: 'term-1' }),
    );
  });

  it('old-server response (no commands field) yields a single chip', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'pwd', dangerous: false });
    await mount();
    await act(async () => { latest.submitText('在哪'); await Promise.resolve(); });
    expect(latest.chips).toEqual([{ command: 'pwd', dangerous: false }]);
  });

  it('maps failures to error phase with text; retry() resends the same text', async () => {
    mockGenerateCommand.mockRejectedValueOnce(new Error('llm_timeout'));
    await mount();
    await act(async () => { latest.submitText('看看状态'); await Promise.resolve(); });
    expect(latest.phase).toBe('error');
    expect(latest.errorText).toBe('llm_timeout');
    mockGenerateCommand.mockResolvedValueOnce({
      command: 'git status --short', commands: ['git status --short'], dangerous: false, dangerousFlags: [false],
    });
    await act(async () => { latest.retry(); await Promise.resolve(); });
    expect(latest.phase).toBe('idle');
    expect(mockGenerateCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '看看状态' }),
    );
  });

  it('startVoice dismisses the keyboard then starts STT; onComplete generates', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'git status', commands: ['git status'], dangerous: false, dangerousFlags: [false],
    });
    await mount();
    act(() => { latest.startVoice(); });
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(latest.phase).toBe('recording');
    const startOpts = opts();
    expect(startOpts?.onComplete).toBeInstanceOf(Function);
    await act(async () => { startOpts!.onComplete('看看 git 状态'); await Promise.resolve(); });
    expect(mockGenerateCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: '看看 git 状态' }),
    );
  });

  it('stopVoice only acts while recording', async () => {
    await mount();
    act(() => { latest.stopVoice(); });
    expect(mockStop).not.toHaveBeenCalled(); // idle 态 no-op
    act(() => { latest.startVoice(); });
    act(() => { latest.stopVoice(); });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('generating ignores re-entry (no second POST, no stt.start)', async () => {
    mockGenerateCommand.mockImplementation(() => new Promise(() => undefined)); // 悬挂
    await mount();
    await act(async () => { latest.submitText('first'); });
    expect(latest.phase).toBe('generating');
    const callsBefore = mockGenerateCommand.mock.calls.length;
    const startCallsBefore = mockStart.mock.calls.length;
    act(() => { latest.submitText('ignored'); });
    act(() => { latest.startVoice(); });
    expect(mockGenerateCommand.mock.calls.length).toBe(callsBefore);
    expect(mockStart).toHaveBeenCalledTimes(startCallsBefore);
  });

  it('voiceStt error during recording surfaces the error phase', async () => {
    await mount();
    act(() => { latest.startVoice(); });
    mockVoiceSttState.status = 'error';
    mockVoiceSttState.errorMessage = '语音识别失败，请重试';
    await act(async () => { screen!.update(<Probe />); });
    expect(latest.phase).toBe('error');
    expect(latest.errorText).toBe('语音识别失败，请重试');
  });

  it('liveStatus tracks commandGen.step tool_call events', async () => {
    mockGenerateCommand.mockImplementation(() => new Promise(() => undefined));
    await mount();
    await act(async () => { latest.submitText('slow'); });
    expect(mockCommandGenListener).not.toBeNull();
    act(() => {
      mockCommandGenListener!({ type: 'commandGen.step', runId: 'r1', seq: 1, kind: 'tool_call', toolName: 'list_dir' });
    });
    expect(latest.liveStatus).toBe('list_dir');
  });

  it('reset() clears chips/phase and cancels STT', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'pwd', commands: ['pwd'], dangerous: false, dangerousFlags: [false],
    });
    await mount();
    await act(async () => { latest.submitText('x'); await Promise.resolve(); });
    await act(async () => { latest.reset(); });
    expect(latest.chips).toEqual([]);
    expect(latest.phase).toBe('idle');
    expect(mockCancel).toHaveBeenCalled();
    const callsBefore = mockGenerateCommand.mock.calls.length;
    await act(async () => { latest.retry(); });
    expect(mockGenerateCommand.mock.calls.length).toBe(callsBefore); // lastText 已清空
  });

  it('startVoice closes the text strip (no hidden recording behind the input)', async () => {
    await mount();
    act(() => { latest.openTextInput(); });
    expect(latest.textMode).toBe(true);
    act(() => { latest.startVoice(); });
    expect(latest.textMode).toBe(false);
    expect(latest.phase).toBe('recording');
  });

  it('submitText during recording is ignored (single path at a time)', async () => {
    await mount();
    act(() => { latest.startVoice(); });
    await act(async () => { latest.submitText('typed during recording'); });
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('retry with no lastText (voice-originated error) restarts recording', async () => {
    await mount();
    act(() => { latest.startVoice(); });
    mockVoiceSttState.status = 'error';
    mockVoiceSttState.errorMessage = '语音识别失败，请重试';
    await act(async () => { screen!.update(<Probe />); });
    expect(latest.phase).toBe('error');
    // STT 错误 effect 依赖 status，若仍为 'error' 会在 retry 翻回 recording 后立刻
    // 再度置 error——置回 idle 让断言钉住「retry 回退到 startVoice」本身。
    mockVoiceSttState.status = 'idle';
    await act(async () => { latest.retry(); });
    expect(latest.phase).toBe('recording');
    expect(mockStart).toHaveBeenCalledTimes(2); // 初次 + retry
  });

  it('a response landing after reset() is dropped (terminal-switch guard)', async () => {
    let resolveGen: (v: unknown) => void = () => {};
    mockGenerateCommand.mockImplementation(
      () => new Promise(resolve => { resolveGen = resolve; }),
    );
    await mount();
    await act(async () => { latest.submitText('slow'); });
    await act(async () => { latest.reset(); });
    expect(latest.phase).toBe('idle');
    await act(async () => {
      resolveGen({ command: 'stale', commands: ['stale'], dangerous: false, dangerousFlags: [false] });
      await Promise.resolve();
    });
    expect(latest.chips).toEqual([]); // 陈旧响应绝不落进新终端
    expect(latest.phase).toBe('idle');
  });

  it('openTextInput only from idle; closeTextInput resets', async () => {
    await mount();
    act(() => { latest.openTextInput(); });
    expect(latest.textMode).toBe(true);
    act(() => { latest.closeTextInput(); });
    expect(latest.textMode).toBe(false);
  });
});
