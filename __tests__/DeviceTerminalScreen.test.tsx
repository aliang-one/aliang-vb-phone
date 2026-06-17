import React from 'react';
import { Keyboard, Platform, Text, type KeyboardEvent } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DeviceTerminalScreen,
  getTerminalProxyKeyboardType,
} from '../src/screens/devices/DeviceTerminalScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { TERMINAL_KEYBOARD_PROXY_VALUE } from '../src/utils/terminalKeyboardProxy';

const mockTerminalSendText = jest.fn();
const mockTerminalFocus = jest.fn();
const mockTerminalFit = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockAutoRenderTerminal = true;

let mockRouteParams = {
  deviceId: 'device-1',
  directory: '~/project',
  terminalId: 'term-1',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => false,
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({
    terminalRef,
    onFocusRequest,
    onRendered,
  }: {
    terminalRef?: React.MutableRefObject<unknown>;
    onFocusRequest?: () => void;
    onRendered?: () => void;
  }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    MockReact.useEffect(() => {
      if (mockAutoRenderTerminal) onRendered?.();
    }, []);
    if (terminalRef) {
      terminalRef.current = {
        sendText: mockTerminalSendText,
        focus: mockTerminalFocus,
        fit: mockTerminalFit,
      };
    }
    return MockReact.createElement(View, {
      testID: 'terminal-emulator',
      onPress: onFocusRequest,
    });
  },
}));

describe('DeviceTerminalScreen mobile terminal input', () => {
  let keyboardListeners: Record<string, Array<(event?: KeyboardEvent) => void>>;
  let screen: ReactTestRenderer.ReactTestRenderer | null;
  let keyboardDismissSpy: jest.SpyInstance;

  beforeEach(() => {
    keyboardListeners = {};
    screen = null;
    mockAutoRenderTerminal = true;
    keyboardDismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
      const listener = callback as (event?: KeyboardEvent) => void;
      keyboardListeners[event] = [...(keyboardListeners[event] ?? []), listener];
      return {
        remove: jest.fn(() => {
          keyboardListeners[event] = (keyboardListeners[event] ?? []).filter(
            item => item !== listener,
          );
        }),
      } as never;
    });
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
    };
    useControlCenterStore.setState({
      serverMode: true,
      devices: [
        {
          id: 'device-1',
          name: 'MacBook',
          status: 'online',
          location: 'Desk',
          os: 'darwin',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: ['~/project'],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: 'now',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
          capabilities: ['terminal'],
          tools: [],
          history: [],
        },
      ],
      terminalSessions: [
        {
          id: 'term-1',
          deviceId: 'device-1',
          directory: '~/project',
          shell: 'zsh',
          status: 'running',
          lines: [],
          createdAt: '2026-06-17T10:00:00.000Z',
          updatedAt: '2026-06-17T10:00:00.000Z',
        },
      ],
      terminalCommandHistory: {
        'session:term-1': [
          {
            id: 'cmd-1',
            terminalSessionId: 'term-1',
            deviceId: 'device-1',
            command: 'git status --short',
            timestamp: '2026-06-17T10:00:00.000Z',
            createdAt: '2026-06-17T10:00:00.000Z',
          },
        ],
      },
      loadTerminalCommandHistory: jest.fn().mockResolvedValue(undefined),
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
    jest.restoreAllMocks();
  });

  const renderScreen = () => {
    screen = ReactTestRenderer.create(
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
          <DeviceTerminalScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
    return screen;
  };

  it('uses a terminal-friendly keyboard type on Android', () => {
    expect(getTerminalProxyKeyboardType('android')).toBe('visible-password');
    expect(getTerminalProxyKeyboardType('ios')).toBe('ascii-capable');
  });

  it('routes soft keyboard text, enter, and shortcut keys through xterm', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardProxy = screen!.root.findByProps({
      testID: 'terminal-keyboard-proxy',
    });

    expect(keyboardProxy.props.value).toBeUndefined();
    expect(keyboardProxy.props.defaultValue).toBe(TERMINAL_KEYBOARD_PROXY_VALUE);
    expect(keyboardProxy.props.keyboardType).toBe(
      getTerminalProxyKeyboardType(Platform.OS),
    );
    expect(keyboardProxy.props.autoComplete).toBe('off');
    expect(keyboardProxy.props.textContentType).toBe('none');
    expect(keyboardProxy.props.disableFullscreenUI).toBe(true);
    expect(keyboardProxy.props.returnKeyType).toBe('done');
    expect(keyboardProxy.props.submitBehavior).toBe('newline');
    expect(
      screen!.root
        .findByProps({ testID: 'terminal-keyboard-focus' })
        .findByProps({ testID: 'terminal-keyboard-proxy' }),
    ).toBeTruthy();

    act(() => {
      keyboardProxy.props.onChangeText(`${TERMINAL_KEYBOARD_PROXY_VALUE}a`);
    });
    act(() => {
      keyboardProxy.props.onChangeText(`${TERMINAL_KEYBOARD_PROXY_VALUE}\n`);
    });
    const tabButton = screen!.root.findByProps({ testID: 'terminal-key-Tab' });
    act(() => {
      tabButton.props.onPress();
    });

    expect(mockTerminalSendText).toHaveBeenNthCalledWith(1, 'a', {
      focus: false,
    });
    expect(mockTerminalSendText).toHaveBeenNthCalledWith(2, '\r', {
      focus: false,
    });
    expect(mockTerminalSendText).toHaveBeenNthCalledWith(3, '\t', {
      focus: false,
    });
    expect(mockTerminalFocus).not.toHaveBeenCalled();
  });

  it('shows focused keyboard state when the KB control requests soft keyboard focus', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);

    act(() => {
      keyboardButton.props.onPressIn();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBe(0);
    expect(
      screen!.root.findByProps({ testID: 'terminal-console-top' }).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 76 })]),
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-proxy' }).props
        .pointerEvents,
    ).toBe('none');
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.primary,
        }),
      ]),
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 300 })]),
    );
    expect(mockTerminalSendText).not.toHaveBeenCalled();
  });

  it('uses xterm touch focus requests to open the native keyboard proxy', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);

    const terminalEmulator = screen!.root.findByProps({
      testID: 'terminal-emulator',
    });

    act(() => {
      terminalEmulator.props.onPress();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBe(0);
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.primary,
        }),
      ]),
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 300 })]),
    );
  });

  it('keeps directory taps available while the soft keyboard is open', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-directory-scroll' }).props
        .keyboardShouldPersistTaps,
    ).toBe('handled');
  });

  it('keeps the terminal disabled until a newly opened session renders', async () => {
    const mockCreateTerminalSession = jest
      .fn()
      .mockResolvedValueOnce('term-2');
    useControlCenterStore.setState(state => ({
      ...state,
      createTerminalSession: mockCreateTerminalSession,
      devices: state.devices.map(device =>
        device.id === 'device-1'
          ? {
              ...device,
              authorizedDirectories: ['~/project', '~/other'],
            }
          : device,
      ),
      terminalSessions: [
        ...state.terminalSessions,
        {
          id: 'term-2',
          deviceId: 'device-1',
          directory: '~/other',
          shell: 'zsh',
          status: 'running',
          lines: [],
          createdAt: '2026-06-17T11:00:00.000Z',
          updatedAt: '2026-06-17T11:00:00.000Z',
        },
      ],
    }));

    await act(async () => {
      screen = renderScreen();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props
        .disabled,
    ).toBe(false);

    mockAutoRenderTerminal = false;
    act(() => {
      screen!.root.findByProps({ testID: 'terminal-directory-other' }).props
        .onPress();
    });

    await act(async () => {
      screen!.root.findByProps({ testID: 'terminal-directory-enter' }).props
        .onPress();
    });

    expect(mockCreateTerminalSession).toHaveBeenCalledWith(
      'device-1',
      '~/other',
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props
        .disabled,
    ).toBe(true);

    expect(mockTerminalSendText).not.toHaveBeenCalled();
  });

  it('keeps suggestions and shortcuts floating above the keyboard', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const hasSuggestion = () =>
      screen!.root
        .findAllByType(Text)
        .some(node => node.props.children === 'git status --short');

    expect(hasSuggestion()).toBe(true);

    const floatingControls = screen!.root.findByProps({
      testID: 'terminal-floating-controls',
    });
    act(() => {
      floatingControls.props.onLayout({
        nativeEvent: { layout: { height: 118 } },
      });
    });
    const viewportBeforeKeyboard = screen!.root.findByProps({
      testID: 'terminal-viewport',
    });
    expect(viewportBeforeKeyboard.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 118 })]),
    );

    act(() => {
      keyboardListeners.keyboardWillShow?.forEach(listener =>
        listener({
          endCoordinates: { height: 300 },
        } as KeyboardEvent),
      );
    });

    expect(hasSuggestion()).toBe(true);
    expect(screen!.root.findByProps({ testID: 'terminal-key-Tab' })).toBeTruthy();
    const floatingControlsAfterKeyboard = screen!.root.findByProps({
      testID: 'terminal-floating-controls',
    });
    expect(floatingControlsAfterKeyboard.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 300 })]),
    );
    const viewportAfterKeyboard = screen!.root.findByProps({
      testID: 'terminal-viewport',
    });
    expect(viewportAfterKeyboard.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 418 })]),
    );

    act(() => {
      keyboardListeners.keyboardDidHide?.forEach(listener => listener());
    });

    const floatingControlsAfterHide = screen!.root.findByProps({
      testID: 'terminal-floating-controls',
    });
    expect(floatingControlsAfterHide.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 0 })]),
    );
  });

  it('reuses the last keyboard height while the soft keyboard is re-opening', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });
    act(() => {
      keyboardButton.props.onPressIn();
    });
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 300 })]),
    );

    act(() => {
      keyboardListeners.keyboardWillShow?.forEach(listener =>
        listener({
          endCoordinates: { height: 256 },
        } as KeyboardEvent),
      );
    });
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 256 })]),
    );

    act(() => {
      keyboardListeners.keyboardDidHide?.forEach(listener => listener());
    });

    act(() => {
      keyboardButton.props.onPressIn();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 256 })]),
    );
  });

  it('sends suggestion chips without dropping the soft keyboard focus', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });

    act(() => {
      keyboardButton.props.onPressIn();
    });

    const suggestionButton = screen!.root.findByProps({
      testID: 'terminal-suggestion-git-status-short',
    });

    act(() => {
      suggestionButton.props.onPress();
    });

    expect(mockTerminalSendText).toHaveBeenCalledWith(
      'git status --short\r',
      {
        focus: false,
      },
    );
    expect(mockTerminalFocus).not.toHaveBeenCalled();
  });

  it('clears the focused keyboard state when the proxy input blurs', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });
    act(() => {
      keyboardButton.props.onPressIn();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.primary,
        }),
      ]),
    );

    const proxyInput = screen!.root.findByProps({
      testID: 'terminal-keyboard-proxy',
    });
    act(() => {
      proxyInput.props.onBlur();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.outlineVariant,
        }),
      ]),
    );
  });

  it('clears the focused keyboard state when the keyboard hides', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });
    act(() => {
      keyboardButton.props.onPressIn();
    });

    act(() => {
      keyboardListeners.keyboardDidHide?.forEach(listener => listener());
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.outlineVariant,
        }),
      ]),
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 0 })]),
    );
  });

  it('dismisses the soft keyboard when terminal input becomes unavailable', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    keyboardDismissSpy.mockClear();
    const keyboardButton = screen!.root.findByProps({
      testID: 'terminal-keyboard-focus',
    });
    act(() => {
      keyboardButton.props.onPressIn();
    });

    act(() => {
      useControlCenterStore.setState(state => ({
        devices: state.devices.map(device =>
          device.id === 'device-1'
            ? {
                ...device,
                status: 'offline',
              }
            : device,
        ),
      }));
    });

    expect(keyboardDismissSpy).toHaveBeenCalledTimes(1);
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: utilityMinimalist.colors.outlineVariant,
        }),
      ]),
    );
  });

  it('collapses the terminal top project controls while the keyboard is open', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);

    act(() => {
      keyboardListeners.keyboardWillShow?.forEach(listener =>
        listener({
          endCoordinates: { height: 300 },
        } as KeyboardEvent),
      );
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBe(0);
    expect(
      screen!.root.findByProps({ testID: 'terminal-console-top' }).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 76 })]),
    );

    act(() => {
      keyboardListeners.keyboardDidHide?.forEach(listener => listener());
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);
  });

  it('collapses and lifts terminal controls from Android keyboard show events', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    const floatingControls = screen!.root.findByProps({
      testID: 'terminal-floating-controls',
    });
    act(() => {
      floatingControls.props.onLayout({
        nativeEvent: { layout: { height: 96 } },
      });
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);

    act(() => {
      keyboardListeners.keyboardDidShow?.forEach(listener =>
        listener({
          endCoordinates: { height: 312 },
        } as KeyboardEvent),
      );
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBe(0);
    expect(
      screen!.root.findByProps({ testID: 'terminal-floating-controls' }).props
        .style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 312 })]),
    );
    expect(
      screen!.root.findByProps({ testID: 'terminal-viewport' }).props.style,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 408 })]),
    );
  });
});
