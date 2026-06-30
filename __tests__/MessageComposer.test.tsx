import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import {
  MessageComposer,
  type MessageComposerProps,
} from '../src/components/vibecoding/MessageComposer';
import type { UseVoiceSttResult } from '../src/hooks/useVoiceStt';

let currentRenderer: ReactTestRenderer.ReactTestRenderer | undefined;

// The composer's PulseRing/Waveform spin built-in Animated.loop on mount. With
// real timers those run forever (the RN jest-preset drives them on setTimeout),
// so freeze the clock — we assert on labels/controls, never on animation values.
jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => {
  act(() => {
    currentRenderer = ReactTestRenderer.create(
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
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return currentRenderer!;
};

// The composer's PulseRing/Waveform spin Animated.loop on mount; the test
// renderer doesn't auto-unmount, so unmount each tree to fire the stop()
// cleanup. Without this the loops run on real timers forever and OOM the
// worker.
afterEach(() => {
  if (currentRenderer) {
    act(() => {
      currentRenderer!.unmount();
    });
    currentRenderer = undefined;
  }
});

const textsIn = (node: ReactTestRenderer.ReactTestInstance) =>
  node.findAllByType(Text).map(t => String(t.props.children));

const btnByLabel = (root: ReactTestRenderer.ReactTestRenderer, label: string) =>
  root.root.findAllByType(TouchableOpacity).find(c =>
    textsIn(c).some(t => t === label),
  );

const findByTestID = (root: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  root.root.findByProps({ testID });

// All rendered slash-command suggestion rows (testID `slash-cmd-<name>`).
const slashRows = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root
    .findAllByType(TouchableOpacity)
    .filter(
      c =>
        typeof c.props.testID === 'string' &&
        c.props.testID.startsWith('slash-cmd-'),
    );

const mockVoiceStt = (overrides: Partial<UseVoiceSttResult> = {}): UseVoiceSttResult => ({
  status: 'idle',
  liveCaption: '',
  errorMessage: '',
  start: jest.fn(),
  stop: jest.fn(),
  cancel: jest.fn(),
  ...overrides,
});

const defaultProps = (
  overrides: Partial<MessageComposerProps> = {},
): MessageComposerProps => ({
  mode: 'text',
  onModeChange: jest.fn(),
  input: '',
  onInputChange: jest.fn(),
  voiceDraft: '',
  commands: [
    { name: 'clear', description: '清空上下文', scope: 'builtin' },
    {
      name: 'codex-review',
      description: '项目审查',
      argHint: '<file>',
      scope: 'project',
    },
  ],
  voiceStt: mockVoiceStt(),
  sendingMessage: false,
  deviceOffline: false,
  toolsMenuVisible: false,
  onToggleTools: jest.fn(),
  onVoiceCapture: jest.fn(),
  onSendVoice: jest.fn(),
  onSendText: jest.fn(),
  onEditVoice: jest.fn(),
  ...overrides,
});

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

describe('MessageComposer', () => {
  it('text mode renders the input + toggle; send disabled until there is input', () => {
    const root = wrap(<MessageComposer {...defaultProps({ mode: 'text' })} />);
    expect(root.root.findByType(TextInput).props.placeholder).toBe(
      'Send a direction...',
    );
    expect(() => findByTestID(root, 'composer-toggle')).not.toThrow();
    expect(() => findByTestID(root, 'composer-send')).not.toThrow();
    // No draft panel in plain text mode.
    expect(allTexts(root).some(t => t === '语音草稿')).toBe(false);
  });

  it('switches mode via the toggle', () => {
    const onModeChange = jest.fn();
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'text', onModeChange })} />,
    );
    act(() => {
      findByTestID(root, 'composer-toggle').props.onPress();
    });
    expect(onModeChange).toHaveBeenCalledWith('voice');
  });

  it('sends text on the send button', () => {
    const onSendText = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({ mode: 'text', input: '加一个登录页', onSendText })}
      />,
    );
    act(() => {
      findByTestID(root, 'composer-send').props.onPress();
    });
    expect(onSendText).toHaveBeenCalled();
  });

  it('replaces send with interrupt while a turn is running', () => {
    const onInterruptTurn = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'text',
          input: '加一个登录页',
          canInterruptTurn: true,
          onInterruptTurn,
        })}
      />,
    );
    expect(() => findByTestID(root, 'composer-interrupt')).not.toThrow();
    expect(() => findByTestID(root, 'composer-send')).toThrow();
    act(() => {
      findByTestID(root, 'composer-interrupt').props.onPress();
    });
    expect(onInterruptTurn).toHaveBeenCalled();
  });

  it('voice recording shows the listening label', () => {
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          voiceStt: mockVoiceStt({ status: 'recording' }),
        })}
      />,
    );
    const texts = allTexts(root);
    expect(texts.some(t => t.includes('正在聆听'))).toBe(true);
  });

  it('voice mode starts on press and stops on release (hold to talk)', () => {
    const onVoiceCapture = jest.fn();
    const onVoiceCaptureStart = jest.fn();
    const onVoiceCaptureEnd = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          onVoiceCapture,
          onVoiceCaptureStart,
          onVoiceCaptureEnd,
        })}
      />,
    );
    expect(allTexts(root).some(t => t === '点按开始说话')).toBe(true);

    act(() => {
      findByTestID(root, 'composer-voice-hold').props.onPressIn();
    });
    expect(onVoiceCaptureStart).toHaveBeenCalledTimes(1);
    expect(onVoiceCapture).not.toHaveBeenCalled();
    expect(onVoiceCaptureEnd).not.toHaveBeenCalled();

    act(() => {
      findByTestID(root, 'composer-voice-hold').props.onPressOut();
    });
    // Releasing the finger stops the recording we started (hold-to-talk).
    expect(onVoiceCaptureEnd).toHaveBeenCalledTimes(1);
  });

  it('reserves the voice action slot before recording starts', () => {
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          voiceStt: mockVoiceStt({ status: 'idle' }),
        })}
      />,
    );
    expect(() => findByTestID(root, 'composer-action-placeholder')).not.toThrow();
  });

  it('does not restart capture from the hold target while already active', () => {
    const onVoiceCaptureStart = jest.fn();
    const onVoiceCaptureEnd = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          voiceStt: mockVoiceStt({ status: 'recording' }),
          onVoiceCaptureStart,
          onVoiceCaptureEnd,
        })}
      />,
    );

    act(() => {
      findByTestID(root, 'composer-voice-hold').props.onPressIn();
    });
    expect(onVoiceCaptureStart).not.toHaveBeenCalled();
    expect(onVoiceCaptureEnd).not.toHaveBeenCalled();
  });

  it('voice draft (方案A) offers 发送 + 编辑 directly — no AI 润色', () => {
    const onSendVoice = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          voiceDraft: '帮我加一个登录页',
          onSendVoice,
        })}
      />,
    );
    const texts = allTexts(root);
    expect(texts.some(t => t === '语音草稿')).toBe(true);
    // The transcribed text itself is what's shown (方案A: 原样发送).
    expect(texts.some(t => t === '帮我加一个登录页')).toBe(true);
    expect(texts.some(t => t === '发送')).toBe(true);
    expect(texts.some(t => t === '编辑')).toBe(true);
    // 重置 is gone — superseded by 编辑 (re-recording via the mic toggle replaces it).
    expect(texts.some(t => t === '重置')).toBe(false);
    // AI 润色 is gone until 方案B lands.
    expect(texts.some(t => t === 'AI 润色')).toBe(false);

    act(() => {
      btnByLabel(root, '发送')!.props.onPress();
    });
    expect(onSendVoice).toHaveBeenCalled();
  });

  it('tapping 编辑 transfers the draft for editing via onEditVoice', () => {
    const onEditVoice = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({
          mode: 'voice',
          voiceDraft: 'raw transcript',
          onEditVoice,
        })}
      />,
    );
    act(() => {
      btnByLabel(root, '编辑')!.props.onPress();
    });
    expect(onEditVoice).toHaveBeenCalled();
  });

  it('typing "/" shows all command suggestions', () => {
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'text', input: '/' })} />,
    );
    expect(slashRows(root)).toHaveLength(2);
    expect(() => findByTestID(root, 'slash-cmd-clear')).not.toThrow();
    // Row renders the command name (children is an array, so substring-match).
    expect(allTexts(root).some(t => t.includes('clear'))).toBe(true);
  });

  it('typing a prefix filters suggestions case-insensitively', () => {
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'text', input: '/CO' })} />,
    );
    expect(slashRows(root)).toHaveLength(1);
    expect(() => findByTestID(root, 'slash-cmd-codex-review')).not.toThrow();
    expect(() => findByTestID(root, 'slash-cmd-clear')).toThrow();
  });

  it('selecting a command inserts /name with a trailing space', () => {
    const onInputChange = jest.fn();
    const root = wrap(
      <MessageComposer
        {...defaultProps({ mode: 'text', input: '/cl', onInputChange })}
      />,
    );
    act(() => {
      findByTestID(root, 'slash-cmd-clear').props.onPress();
    });
    expect(onInputChange).toHaveBeenCalledWith('/clear ');
  });

  it('a space after the slash token hides suggestions', () => {
    const root = wrap(
      <MessageComposer
        {...defaultProps({ mode: 'text', input: '/clear extra' })}
      />,
    );
    expect(slashRows(root)).toHaveLength(0);
  });

  it('a mid-message slash does not trigger suggestions', () => {
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'text', input: 'do /clear' })} />,
    );
    expect(slashRows(root)).toHaveLength(0);
  });

  it('no matches renders nothing', () => {
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'text', input: '/zzz' })} />,
    );
    expect(slashRows(root)).toHaveLength(0);
  });

  it('does not show suggestions in voice mode', () => {
    const root = wrap(
      <MessageComposer {...defaultProps({ mode: 'voice', input: '/' })} />,
    );
    expect(slashRows(root)).toHaveLength(0);
  });

  it('does NOT surface the old PAUSE / END session controls', () => {
    const root = wrap(<MessageComposer {...defaultProps({ mode: 'text' })} />);
    const texts = allTexts(root);
    // Regression guard: session-level pause/end were moved to the card menu.
    expect(texts.some(t => t === 'PAUSE' || t === 'END')).toBe(false);
    expect(texts.some(t => t === 'VOICE' || t === 'TEXT')).toBe(false);
  });
});
