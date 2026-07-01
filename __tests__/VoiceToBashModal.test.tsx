import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { VoiceToBashModal } from '../src/components/terminal/VoiceToBashModal';
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
  onConfirm: (command: string) => void;
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

// Drive the record → transcript → review chain: simulate a hold-to-talk press
// (onPressIn fires start), then release (onPressOut fires stop), then fire the
// hook's captured onComplete (simulating finalized STT). After P4 this lands at
// the review phase (editable transcript) WITHOUT yet calling generateCommand —
// call driveReviewToConfirm() below to press 确认发送 and flush the AI promise.
const driveTranscript = async (
  root: ReactTestRenderer.ReactTestRenderer,
  props: PropsLike,
  transcript: string,
) => {
  // idle on open → capture the mic-pad handlers before press-in (the idle body
  // unmounts once phase flips to 'recording', so onPressOut must be invoked on
  // the captured closure rather than re-queried after the swap).
  const micPadProps = el(root, 'v2b-mic-pad').props as {
    onPressIn: () => void;
    onPressOut: () => void;
  };
  const pressOut = micPadProps.onPressOut;
  act(() => {
    micPadProps.onPressIn();
  });
  expect(mockStart).toHaveBeenCalledTimes(1);
  const opts = latestStartOptions();
  setState('recording');
  rerender(props);
  // Release → stop the recording (invoke the captured press-out handler).
  act(() => {
    pressOut();
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
  it('opens idle: renders the mic pad and does NOT auto-record until press-in', () => {
    const props = baseProps({ sessionId: 'term-1' });
    const root = render(props);

    // Idle mic pad is present.
    expect(() => el(root, 'v2b-mic-pad')).not.toThrow();
    // Recording has NOT started on mount.
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('press-in on the mic pad starts recording scoped to device/session/cwd', () => {
    const props = baseProps({ sessionId: 'term-1' });
    const root = render(props);

    act(() => {
      el(root, 'v2b-mic-pad').props.onPressIn();
    });

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(latestStartOptions()).toEqual(
      expect.objectContaining({
        deviceId: 'dev-1',
        sessionId: 'term-1',
        projectPath: '/repo/proj',
      }),
    );
  });

  it('press-out on the mic pad stops the recording', () => {
    const props = baseProps();
    const root = render(props);

    // Capture the press-out handler before press-in: the idle body unmounts once
    // phase flips to 'recording', so the pad can't be re-queried after the swap.
    const micPadProps = el(root, 'v2b-mic-pad').props as {
      onPressIn: () => void;
      onPressOut: () => void;
    };
    const pressOut = micPadProps.onPressOut;
    act(() => {
      micPadProps.onPressIn();
    });
    setState('recording');
    rerender(props); // component now sees recording state in its closure
    act(() => {
      pressOut();
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
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
    expect(props.onConfirm).toHaveBeenCalledWith('git status --short');
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
    expect(props.onConfirm).toHaveBeenCalledWith('rm -rf node_modules');
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
    expect(props.onConfirm).toHaveBeenCalledWith('rm -rf x');
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

  it('review phase: 重录 returns to idle without calling generateCommand', async () => {
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');
    expect(mockGenerateCommand).not.toHaveBeenCalled();

    act(() => {
      (el(root, 'v2b-rerecord-review').props as { onPress: () => void }).onPress();
    });
    rerender(props);

    // Back to idle (mic pad visible again), no AI call made.
    expect(() => el(root, 'v2b-mic-pad')).not.toThrow();
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

    // Retry returns to idle (hold-to-talk again).
    act(() => {
      el(root, 'v2b-retry').props.onPress();
    });
    expect(() => el(root, 'v2b-error')).toThrow();
    expect(() => el(root, 'v2b-mic-pad')).not.toThrow();
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
