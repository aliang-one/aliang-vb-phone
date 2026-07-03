import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { VoiceToBashModal } from '../src/components/terminal/VoiceToBashModal';
import type { DevicePickerEntry } from '../src/components/terminal/DevicePicker';
import { dispatchCommandGenEvent } from '../src/services/commandGenEvents';
import type { VoiceSttStatus, UseVoiceSttResult } from '../src/hooks/useVoiceStt';

// --- controllable useVoiceStt + generateCommand mocks -----------------------
// The factory only DEFINES the arrow (it never reads the `const`s at factory
// time), so the late initializers below are read at render/call time, not
// during hoisting (no TDZ) — same trick VoiceTextInput.test uses.
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

// The modal reads ActivityIndicator + (no Animated.loop in this component, but
// keep the clock frozen for the modal fade + any timers the hook would arm).
jest.useFakeTimers();

let currentRenderer: ReactTestRenderer.ReactTestRenderer | undefined;

interface PropsLike {
  visible: boolean;
  mode: 'initial' | 'live';
  deviceId: string;
  cwd: string;
  deviceOs?: string;
  sessionId?: string;
  projectId?: string;
  onClose: () => void;
  onConfirm: (command: string, deviceId?: string, cwd?: string) => void;
  selectableDevices?: DevicePickerEntry[];
}

const baseProps = (overrides: Partial<PropsLike> = {}): PropsLike => ({
  visible: true,
  mode: 'initial',
  deviceId: 'dev-1',
  cwd: '/repo/proj',
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  ...overrides,
});

const tree = (props: PropsLike) => (
  <ThemeContext.Provider
    value={{
      theme: utilityMinimalist,
      mode: 'light',
      setMode: jest.fn(),
      isDark: false,
    }}
  >
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <VoiceToBashModal {...props} />
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const render = (props: PropsLike) => {
  act(() => {
    currentRenderer = ReactTestRenderer.create(tree(props));
  });
  return currentRenderer!;
};

const rerender = (props: PropsLike) => {
  act(() => {
    currentRenderer!.update(tree(props));
  });
  return currentRenderer!;
};

afterEach(() => {
  if (currentRenderer) {
    act(() => {
      currentRenderer!.unmount();
    });
    currentRenderer = undefined;
  }
  mockVoiceSttState.status = 'idle';
  mockVoiceSttState.liveCaption = '';
  mockVoiceSttState.errorMessage = '';
  mockStart.mockClear();
  mockStop.mockClear();
  mockCancel.mockClear();
  mockGenerateCommand.mockReset();
});

const setState = (
  status: VoiceSttStatus,
  extra: { liveCaption?: string; errorMessage?: string } = {},
) => {
  mockVoiceSttState.status = status;
  if (extra.liveCaption !== undefined) mockVoiceSttState.liveCaption = extra.liveCaption;
  if (extra.errorMessage !== undefined) mockVoiceSttState.errorMessage = extra.errorMessage;
};

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

const el = (root: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  root.root.findByProps({ testID });

const confirmOf = (root: ReactTestRenderer.ReactTestRenderer) => el(root, 'v2b-confirm');
const commandInputOf = (root: ReactTestRenderer.ReactTestRenderer) =>
  el(root, 'v2b-command') as unknown as { props: { value: string; onChangeText: (t: string) => void } };

const latestStartOptions = () =>
  mockStart.mock.calls[mockStart.mock.calls.length - 1][0] as {
    onComplete: (t: string) => void;
    deviceId?: string;
    sessionId?: string;
    projectPath?: string;
  };

// Drive the record → transcript → review chain: the modal auto-records on open,
// so on mount we capture the captured onComplete; here we simulate the STT hook
// flipping through connecting→recording→stopping (via 完成), then fire the
// captured onComplete with the finalized transcript. After P4 this lands at the
// review phase (editable transcript) WITHOUT yet calling generateCommand — call
// driveReviewToConfirm() below to press 确认发送 and flush the AI promise.
const driveTranscript = async (
  root: ReactTestRenderer.ReactTestRenderer,
  props: PropsLike,
  transcript: string,
) => {
  // Modal auto-started recording on open (start already fired once). The
  // recording phase mounts the 完成 button — tap it to stop the recording.
  const opts = latestStartOptions();
  setState('recording');
  rerender(props);
  act(() => {
    (el(root, 'v2b-done').props as { onPress: () => void }).onPress();
  });
  expect(mockStop).toHaveBeenCalledTimes(1);
  // onComplete hands the transcript to the review phase (no AI call yet).
  await act(async () => {
    opts.onComplete(transcript);
    // The real hook flips back to idle once it delivers the transcript.
    setState('idle');
    rerender(props);
    await Promise.resolve();
  });
};

// From the review phase, press 确认发送 (optionally with an edited transcript)
// and flush the mocked generateCommand promise so the confirming view mounts.
const driveReviewToConfirm = async (
  root: ReactTestRenderer.ReactTestRenderer,
  props: PropsLike,
  editedText?: string,
) => {
  if (editedText !== undefined) {
    act(() => {
      (el(root, 'v2b-transcript').props as { onChangeText: (t: string) => void }).onChangeText(editedText);
    });
    rerender(props);
  }
  await act(async () => {
    (el(root, 'v2b-confirm-send').props as { onPress: () => void }).onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('VoiceToBashModal', () => {
  it('opens directly in the recording phase and auto-starts recording once', () => {
    const props = baseProps({ sessionId: 'term-1' });
    const root = render(props);

    // Recording phase mounted (完成 button is the primary control).
    expect(() => el(root, 'v2b-done')).not.toThrow();
    // Auto-start fired exactly once on open.
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(latestStartOptions()).toEqual(
      expect.objectContaining({
        deviceId: 'dev-1',
        sessionId: 'term-1',
        projectPath: '/repo/proj',
      }),
    );
    // No hold-to-talk mic pad anymore.
    expect(() => el(root, 'v2b-mic-pad')).toThrow();
  });

  it('auto-start does not fire twice on re-render while still opening', () => {
    const props = baseProps();
    const root = render(props);
    // Re-render with identical visible=true — guard ref must prevent a 2nd start.
    rerender(props);
    rerender(props);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('the 完成 button stops the recording', () => {
    const props = baseProps();
    const root = render(props);
    // Native mic finishes init → recording state.
    setState('recording');
    rerender(props);

    act(() => {
      (el(root, 'v2b-done').props as { onPress: () => void }).onPress();
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('recording caption prefers a live transcript when present', () => {
    const props = baseProps();
    const root = render(props);
    setState('recording', { liveCaption: '列出文件' });
    rerender(props);

    expect(el(root, 'v2b-caption').props.children).toBe('列出文件');
  });

  it('recording caption falls back to a status-driven hint when no live caption', () => {
    const props = baseProps();
    const root = render(props);
    // connecting (native mic init) → the only legit "preparing" moment.
    setState('connecting');
    rerender(props);
    expect(el(root, 'v2b-caption').props.children).toBe('正在准备麦克风…');

    setState('recording');
    rerender(props);
    expect(el(root, 'v2b-caption').props.children).toBe('正在聆听…');

    setState('stopping');
    rerender(props);
    expect(el(root, 'v2b-caption').props.children).toBe('识别中…');
  });

  it('STT error propagates to the error phase and surfaces errorMessage', () => {
    const props = baseProps();
    const root = render(props);
    // Hook flips to error mid-recording (start failed or stream broke).
    setState('error', { errorMessage: '麦克风启动失败' });
    rerender(props);

    expect(() => el(root, 'v2b-error')).not.toThrow();
    expect(allTexts(root).some(t => String(t).includes('麦克风启动失败'))).toBe(true);
    // The recording-phase 完成 button is gone once we're in the error phase.
    expect(() => el(root, 'v2b-done')).toThrow();
  });

  it('happy path: non-dangerous command is confirmed on a single tap', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'git status --short', dangerous: false });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');
    await driveReviewToConfirm(root, props);

    // Confirming view shows the generated command in the editable field.
    expect(() => commandInputOf(root)).not.toThrow();
    expect(commandInputOf(root).props.value).toBe('git status --short');
    // No danger warning for a safe command.
    expect(() => el(root, 'v2b-danger')).toThrow();

    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).toHaveBeenCalledWith('git status --short', undefined, undefined);
  });

  it('initial mode: confirm step shows the device picker and onConfirm carries the chosen device', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'ls',
      dangerous: false,
      deviceId: 'd1',
      deviceName: 'Mac',
      cwd: '/repo',
    });
    const selectableDevices: DevicePickerEntry[] = [
      { id: 'd1', name: 'Mac', platform: 'darwin', online: true, cwd: '/repo' },
      { id: 'd9', name: 'Staging', platform: 'linux', online: true, cwd: '/opt/app' },
    ];
    const props = baseProps({ selectableDevices });
    const root = render(props);

    await driveTranscript(root, props, 'list files');
    await driveReviewToConfirm(root, props);

    // Picker rendered in the confirm step, AI's device (d1) pre-selected.
    expect(() => el(root, 'v2b-device-picker')).not.toThrow();

    // Override to Staging via the picker.
    act(() => {
      el(root, 'device-picker-toggle').props.onPress();
    });
    act(() => {
      el(root, 'device-picker-entry-d9').props.onPress();
    });

    // Confirm → onConfirm carries the overridden device + cwd.
    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).toHaveBeenCalledWith('ls', 'd9', '/opt/app');
  });

  it('server-dangerous: requires a second confirm tap', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'rm -rf node_modules', dangerous: true });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, '删掉 node_modules');
    await driveReviewToConfirm(root, props);

    // Danger warning surfaces.
    expect(() => el(root, 'v2b-danger')).not.toThrow();

    // First tap does NOT fire onConfirm — it only arms the second-confirm gate.
    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).not.toHaveBeenCalled();
    // Button relabels to the dangerous variant after the first tap.
    expect(allTexts(root).some(t => t.includes('危险'))).toBe(true);

    // Second tap actually fires onConfirm.
    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).toHaveBeenCalledWith('rm -rf node_modules', undefined, undefined);
  });

  it('locally-dangerous edit trips the warning even when the server said safe', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'ls', dangerous: false });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'list files');
    await driveReviewToConfirm(root, props);
    // Safe initially.
    expect(() => el(root, 'v2b-danger')).toThrow();

    // User edits the TextInput to a destructive command.
    act(() => {
      commandInputOf(root).props.onChangeText('rm -rf x');
    });
    rerender(props);

    // Now the local isUnsafeSuggestion check fires the warning.
    expect(() => el(root, 'v2b-danger')).not.toThrow();

    // First tap arms, second tap fires.
    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).not.toHaveBeenCalled();
    act(() => {
      confirmOf(root).props.onPress();
    });
    expect(props.onConfirm).toHaveBeenCalledWith('rm -rf x', undefined, undefined);
  });

  it('review phase: STT transcript lands pre-filled in an editable TextInput', async () => {
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');

    // Review body mounted with the transcript TextInput.
    const transcriptEl = el(root, 'v2b-transcript') as unknown as {
      props: { value: string; onChangeText: (t: string) => void; multiline?: boolean };
    };
    expect(transcriptEl.props.value).toBe('show git status');
    // The AI call must NOT have fired yet — review gates generateCommand.
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('review phase: editing the TextInput changes its value', async () => {
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');

    const transcriptEl = el(root, 'v2b-transcript') as unknown as {
      props: { value: string; onChangeText: (t: string) => void };
    };
    act(() => {
      transcriptEl.props.onChangeText('show git log --oneline');
    });
    rerender(props);
    expect(el(root, 'v2b-transcript').props.value).toBe('show git log --oneline');
  });

  it('review phase: 确认发送 calls generateCommand with the (possibly edited) text', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'git status --short', dangerous: false });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');
    // Edit before sending.
    await driveReviewToConfirm(root, props, 'show git log --oneline');

    // generateCommand received the EDITED text, not the raw STT transcript.
    expect(mockGenerateCommand).toHaveBeenCalledTimes(1);
    expect(mockGenerateCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'show git log --oneline' }),
    );
    // Landed at the command-edit confirming phase.
    expect(commandInputOf(root).props.value).toBe('git status --short');
  });

  it('review phase: 重录 returns to recording and restarts STT', async () => {
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');
    expect(mockGenerateCommand).not.toHaveBeenCalled();

    const startsBefore = mockStart.mock.calls.length;
    act(() => {
      (el(root, 'v2b-rerecord-review').props as { onPress: () => void }).onPress();
    });
    rerender(props);

    // Back to recording (完成 button visible again) + a fresh start fired.
    expect(() => el(root, 'v2b-done')).not.toThrow();
    expect(mockStart.mock.calls.length).toBeGreaterThan(startsBefore);
    expect(mockGenerateCommand).not.toHaveBeenCalled();
  });

  it('cancel calls stt.cancel() and onClose', () => {
    const props = baseProps();
    const root = render(props);
    act(() => {
      el(root, 'v2b-cancel').props.onPress();
    });
    expect(mockCancel).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('endpoint failure shows the error view with a retry', async () => {
    mockGenerateCommand.mockRejectedValue(new Error('upstream 502'));
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'anything');
    await driveReviewToConfirm(root, props);

    expect(() => el(root, 'v2b-error')).not.toThrow();
    expect(allTexts(root).some(t => t.includes('upstream 502'))).toBe(true);

    // Retry returns to recording + restarts STT (auto-record again).
    const startsBefore = mockStart.mock.calls.length;
    act(() => {
      el(root, 'v2b-retry').props.onPress();
    });
    expect(() => el(root, 'v2b-error')).toThrow();
    expect(() => el(root, 'v2b-done')).not.toThrow();
    expect(mockStart.mock.calls.length).toBeGreaterThan(startsBefore);
  });

  it('cancel() runs on dismiss (visible → false)', () => {
    const props = baseProps();
    const root = render(props);
    setState('recording');
    rerender(baseProps());
    const before = mockCancel.mock.calls.length;
    rerender({ ...props, visible: false });
    expect(mockCancel.mock.calls.length).toBeGreaterThan(before);
  });

  // P5: generating phase renders a live step timeline fed by commandGen.* WS
  // events. The subscription must be active BEFORE the POST fires so the early
  // runStarted (carrying runId) is not missed; non-matching runId events are
  // filtered out.
  it('generating: renders a live timeline row per matching commandGen.step', async () => {
    // Never-resolving promise keeps the modal in the generating phase while we
    // dispatch WS events; the timeline accumulates as events arrive.
    mockGenerateCommand.mockReturnValue(new Promise(() => {}));
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'list files');

    // Trigger 确认发送 → flips to generating; subscription becomes active,
    // POST fires, but our promise never resolves so we stay in generating.
    await act(async () => {
      (el(root, 'v2b-confirm-send').props as { onPress: () => void }).onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // runStarted carries the runId we filter on from here on.
    act(() => {
      dispatchCommandGenEvent({
        type: 'commandGen.runStarted',
        runId: 'cgr_1',
        ts: 't',
      });
    });
    // A matching step must render a timeline row referencing the tool name.
    act(() => {
      dispatchCommandGenEvent({
        type: 'commandGen.step',
        runId: 'cgr_1',
        seq: 1,
        kind: 'tool_call',
        toolName: 'list_dir',
        ts: 't',
      });
    });
    rerender(props);
    expect(allTexts(root).some(t => String(t).includes('list_dir'))).toBe(true);

    // A step with a DIFFERENT runId must NOT add a row.
    act(() => {
      dispatchCommandGenEvent({
        type: 'commandGen.step',
        runId: 'other_run',
        seq: 1,
        kind: 'tool_call',
        toolName: 'should_not_appear_xyz',
        ts: 't',
      });
    });
    rerender(props);
    expect(allTexts(root).some(t => String(t).includes('should_not_appear_xyz'))).toBe(false);
  });

  // T1: the timeline must surface WHAT the AI did, not just tool names. A tool_call
  // row shows its args (which path), and a tool_result row shows the content
  // (snippet) by default — visible without tapping — with a 详情 toggle to expand.
  it('generating: tool_call shows its args and tool_result shows a snippet preview', async () => {
    mockGenerateCommand.mockReturnValue(new Promise(() => {}));
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'read the readme');
    await act(async () => {
      (el(root, 'v2b-confirm-send').props as { onPress: () => void }).onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      dispatchCommandGenEvent({ type: 'commandGen.runStarted', runId: 'cgr_9', ts: 't' });
    });
    act(() => {
      dispatchCommandGenEvent({
        type: 'commandGen.step',
        runId: 'cgr_9',
        seq: 1,
        kind: 'tool_call',
        toolName: 'read_file',
        toolArgs: { path: 'README.md' },
        ts: 't',
      });
    });
    rerender(props);
    // The call row shows WHICH file, not just the bare tool name.
    expect(allTexts(root).some(t => String(t).includes('README.md'))).toBe(true);

    act(() => {
      dispatchCommandGenEvent({
        type: 'commandGen.step',
        runId: 'cgr_9',
        seq: 2,
        kind: 'tool_result',
        toolName: 'read_file',
        snippet: '# Project\nA readme with real content inside',
        ts: 't',
      });
    });
    rerender(props);
    // Result content is visible by default (2-line preview) — no tap needed.
    expect(allTexts(root).some(t => String(t).includes('A readme with real content inside'))).toBe(true);
    // Expandable rows expose a 详情 toggle.
    expect(allTexts(root).some(t => t === '详情')).toBe(true);

    // Tapping the result row expands it; the toggle flips to 收起.
    act(() => {
      (el(root, 'v2b-step-2').props as { onPress?: () => void }).onPress?.();
    });
    rerender(props);
    expect(allTexts(root).some(t => t === '收起')).toBe(true);
  });

  it('generating: empty timeline shows the placeholder spinner', async () => {
    mockGenerateCommand.mockReturnValue(new Promise(() => {}));
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'anything');
    await act(async () => {
      (el(root, 'v2b-confirm-send').props as { onPress: () => void }).onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // No events dispatched yet → placeholder text.
    expect(allTexts(root).some(t => String(t).includes('生成中'))).toBe(true);
  });

  it('generating: resolving the POST lands in confirming with the command pre-filled', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'ls -la',
      dangerous: false,
      runId: 'cgr_1',
    });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'list all files');
    await driveReviewToConfirm(root, props);

    expect(() => commandInputOf(root)).not.toThrow();
    expect(commandInputOf(root).props.value).toBe('ls -la');
  });
});
