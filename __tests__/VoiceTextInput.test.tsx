import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { VoiceTextInput } from '../src/components/vibecoding/VoiceTextInput';
import type { VoiceSttStatus, UseVoiceSttResult } from '../src/hooks/useVoiceStt';

// --- controllable useVoiceStt mock ---------------------------------------------
// VoiceTextInput owns the hook internally, so we jest.mock the module. The
// factory only DEFINES the arrow (it never reads these at factory time), so the
// late `const` initializers below are safely read at render time, not during the
// hoisted factory call (no TDZ).
const mockVoiceSttState: {
  status: VoiceSttStatus;
  liveCaption: string;
  errorMessage: string;
} = {
  status: 'idle',
  liveCaption: '',
  errorMessage: '',
};

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

// The recording mic spins an Animated.loop on mount; freeze the clock and
// unmount each tree so it can't OOM the worker (same pattern as MessageComposer).
jest.useFakeTimers();

let currentRenderer: ReactTestRenderer.ReactTestRenderer | undefined;

interface VoiceTextInputPropsLike {
  value: string;
  onChangeText: (t: string) => void;
  sessionId?: string;
  projectPath?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  testIDPrefix?: string;
}

const tree = (props: VoiceTextInputPropsLike) => (
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
      <VoiceTextInput {...props} testIDPrefix={props.testIDPrefix ?? 'rename'} />
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const render = (props: VoiceTextInputPropsLike) => {
  act(() => {
    currentRenderer = ReactTestRenderer.create(tree(props));
  });
  return currentRenderer!;
};

// Re-render the same instance so refs/state survive — used after mutating the
// mock's status to simulate the async hook transition.
const rerender = (props: VoiceTextInputPropsLike) => {
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
});

const setState = (
  status: VoiceSttStatus,
  extra: { liveCaption?: string; errorMessage?: string } = {},
) => {
  mockVoiceSttState.status = status;
  if (extra.liveCaption !== undefined) {
    mockVoiceSttState.liveCaption = extra.liveCaption;
  }
  if (extra.errorMessage !== undefined) {
    mockVoiceSttState.errorMessage = extra.errorMessage;
  }
};

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

const micOf = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findByProps({ testID: 'rename-mic' });

const inputOf = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findByType(TextInput);

const baseProps = (overrides: Partial<VoiceTextInputPropsLike> = {}): VoiceTextInputPropsLike => ({
  value: '',
  onChangeText: jest.fn(),
  ...overrides,
});

describe('VoiceTextInput', () => {
  it('renders the title field + a hold-to-talk mic, field shows the controlled value when idle', () => {
    const root = render(baseProps({ value: '旧标题' }));
    expect(() => micOf(root)).not.toThrow();
    expect(inputOf(root).props.value).toBe('旧标题');
    // Idle hint communicates the default-voice affordance.
    expect(allTexts(root).some(t => t.includes('按住麦克风'))).toBe(true);
  });

  it('press-in on the mic starts recording scoped to the session', () => {
    const root = render(baseProps({ sessionId: 's1', projectPath: '/repo/proj' }));
    act(() => {
      micOf(root).props.onPressIn();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        projectPath: '/repo/proj',
        onComplete: expect.any(Function),
      }),
    );
  });

  it('press-out while active stops the recording', () => {
    const props = baseProps();
    const root = render(props);
    act(() => {
      micOf(root).props.onPressIn();
    });
    setState('recording');
    rerender(props); // component now sees isActive=true in its handler closure
    act(() => {
      micOf(root).props.onPressOut();
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('does not start a second recording while already active', () => {
    setState('recording');
    const root = render(baseProps());
    act(() => {
      micOf(root).props.onPressIn();
    });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('a stray press-out (no matching press-in) does not stop', () => {
    setState('recording');
    const root = render(baseProps());
    act(() => {
      micOf(root).props.onPressOut();
    });
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('onComplete commits the transcript to onChangeText (replace semantics)', () => {
    const onChangeText = jest.fn();
    const root = render(baseProps({ value: '旧标题', onChangeText }));
    act(() => {
      micOf(root).props.onPressIn(); // start() captures onComplete in its options
    });
    const opts = mockStart.mock.calls[0][0] as { onComplete: (t: string) => void };
    act(() => {
      opts.onComplete('我说的新标题');
    });
    expect(onChangeText).toHaveBeenCalledWith('我说的新标题');
  });

  it('onComplete truncates the transcript to maxLength', () => {
    const onChangeText = jest.fn();
    const root = render(baseProps({ onChangeText, maxLength: 5 }));
    act(() => {
      micOf(root).props.onPressIn();
    });
    const opts = mockStart.mock.calls[0][0] as { onComplete: (t: string) => void };
    act(() => {
      opts.onComplete('123456789');
    });
    expect(onChangeText).toHaveBeenCalledWith('12345');
  });

  it('shows the live caption in the field (read-only) while recording', () => {
    setState('recording', { liveCaption: '正在转写的标题' });
    const root = render(baseProps({ value: '旧标题' }));
    expect(inputOf(root).props.value).toBe('正在转写的标题');
    expect(inputOf(root).props.editable).toBe(false);
  });

  it('shows the error message and keeps the field editable on error', () => {
    setState('error', { errorMessage: '语音输入不可用' });
    const root = render(baseProps({ value: '旧标题' }));
    expect(allTexts(root).some(t => t.includes('语音输入不可用'))).toBe(true);
    expect(inputOf(root).props.editable).toBe(true);
  });

  it('cancels an in-flight recording on unmount (no late commit)', () => {
    setState('recording');
    const root = render(baseProps());
    act(() => {
      root.unmount();
    });
    currentRenderer = undefined; // already unmounted; skip afterEach's unmount
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });
});
