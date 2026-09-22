import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { TerminalVoiceFab } from '../src/components/terminal/TerminalVoiceFab';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

// The AI-suggest hook is stubbed with a controllable mock: the screen's job in
// these tests is the WIRING (FAB → start/stop, chips → pty, terminal switch →
// reset), not the STT/commandGen machinery (covered by the hook's own tests).
// Tests mutate `mockAi` then `screen.update(tree())` to re-render.
const mockAi = {
  phase: 'idle' as 'idle' | 'recording' | 'generating' | 'error',
  chips: [] as Array<{ command: string; dangerous: boolean }>,
  liveCaption: '',
  liveStatus: '',
  errorText: '',
  textMode: false,
  voiceStatus: 'idle',
  startVoice: jest.fn(),
  stopVoice: jest.fn(),
  submitText: jest.fn(),
  retry: jest.fn(),
  clearChips: jest.fn(),
  dismissError: jest.fn(),
  openTextInput: jest.fn(),
  closeTextInput: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../src/hooks/useAiCommandSuggestions', () => ({
  useAiCommandSuggestions: () => mockAi,
}));

// TerminalSuggestionRow arms a dangerous chip for 3s before auto-disarm —
// fake timers keep that window frozen for the two-tap assertions.
jest.useFakeTimers();

const mockTerminalSendText = jest.fn();
const mockTerminalFocus = jest.fn();
const mockTerminalFit = jest.fn();
const mockSetParams = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Live mutable route params. The screen reads initialCommand/terminalId/etc
// from these, and setParams must actually mutate them so re-renders see updates.
let mockRouteParams: {
  deviceId: string;
  directory?: string;
  terminalId?: string;
  initialCommand?: string;
} = {
  deviceId: 'device-1',
  directory: '~/project',
  terminalId: 'term-1',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => false,
    navigate: mockNavigate,
    goBack: mockGoBack,
    setParams: mockSetParams.mockImplementation((next: Record<string, unknown>) => {
      mockRouteParams = { ...mockRouteParams, ...next };
    }),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({
    terminalRef,
    onRendered,
  }: {
    terminalRef?: React.MutableRefObject<unknown>;
    onRendered?: () => void;
  }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    MockReact.useEffect(() => {
      onRendered?.();
    }, []);
    if (terminalRef) {
      terminalRef.current = {
        sendText: mockTerminalSendText,
        focus: mockTerminalFocus,
        fit: mockTerminalFit,
      };
    }
    return MockReact.createElement(View, { testID: 'terminal-emulator' });
  },
}));

const seedStore = () => {
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
    terminalCommandHistory: {},
    // P4 attach flow: entering with a terminal id now calls attach on mount —
    // keep it a resolved no-op so these tests exercise input/voice UX only.
    attachTerminalSession: jest.fn().mockResolvedValue('term-1'),
    loadTerminalCommandHistory: jest.fn().mockResolvedValue(undefined),
  });
};

const setDeviceStatus = (status: 'online' | 'offline') => {
  act(() => {
    useControlCenterStore.setState(state => ({
      devices: state.devices.map(device =>
        device.id === 'device-1' ? { ...device, status } : device,
      ),
    }));
  });
};

describe('DeviceTerminalScreen in-terminal voice FAB', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | null;

  beforeEach(() => {
    screen = null;
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
    };
    seedStore();
    jest.clearAllMocks();
    mockSetParams.mockImplementation((next: Record<string, unknown>) => {
      mockRouteParams = { ...mockRouteParams, ...next };
    });
    // Reset the controllable hook mock to a fresh idle state.
    mockAi.phase = 'idle';
    mockAi.chips = [];
    mockAi.liveCaption = '';
    mockAi.liveStatus = '';
    mockAi.errorText = '';
    mockAi.textMode = false;
    mockAi.voiceStatus = 'idle';
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
  });

  const tree = () => (
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
    </ThemeContext.Provider>
  );

  const renderScreen = async () => {
    await act(async () => {
      screen = ReactTestRenderer.create(tree());
      // Fake timers freeze act's timer-driven flush; settle the attach mock's
      // promise chain (setTerminalOpening(false)) explicitly inside this act.
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });
    return screen;
  };

  // Re-render with the current mockAi values (mutate before calling). Async so
  // a terminal-id change (new attach promise chain) settles inside this act.
  const updateScreen = async () => {
    await act(async () => {
      screen!.update(tree());
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });
  };

  const root = () => screen!.root;
  const fab = () => root().findByProps({ testID: 'terminal-voice-fab' });
  // 新手势契约(2026-09-22):onShortPress/onHoldStart/onHoldEnd 是 screen 接到
  // TerminalVoiceFab 组件节点上的 props;testID 节点是内层 Pressable,只透传
  // onPressIn/onPressOut/disabled(组件内部消费手势分类)。故接线断言用
  // findByType(TerminalVoiceFab) 直呼组件 props,assertion 语义不变。
  const fabHandlers = () => root().findByType(TerminalVoiceFab).props;
  const hasNode = (testID: string) => {
    try {
      return Boolean(root().findByProps({ testID }));
    } catch {
      return false;
    }
  };

  it('renders the FAB; disabled while input unavailable', async () => {
    // Device starts online; the pty reports rendered → terminalInputEnabled true.
    await renderScreen();

    expect(fab()).toBeTruthy();
    expect(fab().props.disabled).toBe(false);

    // Toggling the device offline flips terminalInputEnabled false → FAB disabled.
    setDeviceStatus('offline');
    expect(fab().props.disabled).toBe(true);

    // Back online → enabled again.
    setDeviceStatus('online');
    expect(fab().props.disabled).toBe(false);
  });

  it('short-press opens the text input', async () => {
    await renderScreen();

    act(() => {
      fabHandlers().onShortPress();
    });

    expect(mockAi.openTextInput).toHaveBeenCalledTimes(1);
    expect(mockAi.startVoice).not.toHaveBeenCalled();
  });

  it('hold starts voice from idle', async () => {
    await renderScreen();

    act(() => {
      fabHandlers().onHoldStart();
    });

    expect(mockAi.startVoice).toHaveBeenCalledTimes(1);
    expect(mockAi.stopVoice).not.toHaveBeenCalled();
  });

  it('release while recording stops voice', async () => {
    await renderScreen();
    mockAi.phase = 'recording';
    await updateScreen();

    act(() => {
      fabHandlers().onHoldEnd();
    });

    expect(mockAi.stopVoice).toHaveBeenCalledTimes(1);
    expect(mockAi.startVoice).not.toHaveBeenCalled();
  });

  it('renders AI chips and executes on tap', async () => {
    await renderScreen();
    mockAi.chips = [{ command: 'git status --short', dangerous: false }];
    await updateScreen();

    const chip = root().findByProps({
      testID: 'terminal-suggestion-git-status-short',
    });
    expect(chip).toBeTruthy();

    act(() => {
      chip.props.onPress();
    });

    // keepKeyboardProxyFocused is consumed inside sendToTerminal — the
    // emulator only ever sees { focus: false }.
    expect(mockTerminalSendText).toHaveBeenCalledWith('git status --short\r', {
      focus: false,
    });
    // Executed commands land in the persistent voice-command banner.
    expect(hasNode('terminal-voice-banner')).toBe(true);
  });

  it('dangerous chip requires the second tap', async () => {
    await renderScreen();
    mockAi.chips = [{ command: 'rm -rf /tmp/vibe-test', dangerous: true }];
    await updateScreen();

    const chip = root().findByProps({
      testID: 'terminal-suggestion-rm-rf-tmp-vibe-test',
    });

    // First tap only arms the chip (within the 3s fake-timer window).
    act(() => {
      chip.props.onPress();
    });
    expect(mockTerminalSendText).not.toHaveBeenCalled();

    // Second tap confirms and executes.
    act(() => {
      root()
        .findByProps({ testID: 'terminal-suggestion-rm-rf-tmp-vibe-test' })
        .props.onPress();
    });
    expect(mockTerminalSendText).toHaveBeenCalledWith('rm -rf /tmp/vibe-test\r', {
      focus: false,
    });
  });

  it('empty chips show the hint chip', async () => {
    await renderScreen();

    expect(hasNode('terminal-suggestion-empty')).toBe(true);
  });

  it('resets when the terminal id changes', async () => {
    await renderScreen();

    // Mount already ran the reset-once effect for term-1.
    expect(mockAi.reset).toHaveBeenCalledTimes(1);

    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-2',
    };
    await updateScreen();

    // Mount(1) + terminal switch(2) — a bare "called" would pass trivially.
    expect(mockAi.reset).toHaveBeenCalledTimes(2);
  });

  it('status strip shows while generating', async () => {
    await renderScreen();
    mockAi.phase = 'generating';
    mockAi.liveStatus = 'list_dir';
    await updateScreen();

    expect(hasNode('terminal-ai-strip')).toBe(true);
    expect(
      root()
        .findAllByType(Text)
        .some(node => node.props.children === 'list_dir'),
    ).toBe(true);
  });
});
