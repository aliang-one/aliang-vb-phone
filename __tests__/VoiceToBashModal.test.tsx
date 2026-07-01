import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { VoiceToBashModal } from '../src/components/terminal/VoiceToBashModal';
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

// Drive the full record → transcript → endpoint chain: wait for auto-start, fire the hook's
// captured onComplete (simulating finalized STT), then flush the mocked
// generateCommand promise so the confirm view mounts.
const driveTranscript = async (
  root: ReactTestRenderer.ReactTestRenderer,
  props: PropsLike,
  transcript: string,
) => {
  expect(mockStart).toHaveBeenCalledTimes(1);
  const opts = latestStartOptions();
  setState('recording');
  rerender(props);
  // onComplete resolves the transcript into the generateCommand promise.
  await act(async () => {
    opts.onComplete(transcript);
    // The real hook flips back to idle once it delivers the transcript.
    setState('idle');
    rerender(props);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('VoiceToBashModal', () => {
  it('starts recording automatically when opened', () => {
    const props = baseProps({ sessionId: 'term-1' });
    render(props);

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(latestStartOptions()).toEqual(
      expect.objectContaining({
        deviceId: 'dev-1',
        sessionId: 'term-1',
        projectPath: '/repo/proj',
      }),
    );
  });

  it('happy path: non-dangerous command is confirmed on a single tap', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'git status --short', dangerous: false });
    const props = baseProps();
    const root = render(props);

    await driveTranscript(root, props, 'show git status');

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

    expect(() => el(root, 'v2b-error')).not.toThrow();
    expect(allTexts(root).some(t => t.includes('upstream 502'))).toBe(true);

    // Retry returns to the recording phase.
    act(() => {
      el(root, 'v2b-retry').props.onPress();
    });
    expect(() => el(root, 'v2b-error')).toThrow();
    expect(mockStart).toHaveBeenCalledTimes(2);
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
});
