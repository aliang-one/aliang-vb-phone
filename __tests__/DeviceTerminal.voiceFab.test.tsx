import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

// Stub VoiceToBashModal so we don't drag the full STT chain into this test.
// It renders a button whose press calls onConfirm with a canned command, so we
// can assert the screen wires onConfirm → sendToTerminal + closes the modal.
jest.mock('../src/components/terminal/VoiceToBashModal', () => ({
  VoiceToBashModal: ({
    visible,
    onConfirm,
    onClose,
  }: {
    visible: boolean;
    onConfirm: (command: string) => void;
    onClose: () => void;
  }) => {
    if (!visible) return null;
    const React = require('react');
    const { View, Pressable, Text } = require('react-native');
    return React.createElement(View, { testID: 'v2b-stub' }, [
      React.createElement(
        Pressable,
        {
          key: 'confirm',
          testID: 'v2b-stub-confirm',
          onPress: () => onConfirm('git status --short'),
        },
        React.createElement(Text, null, 'confirm'),
      ),
      React.createElement(
        Pressable,
        {
          key: 'close',
          testID: 'v2b-stub-close',
          onPress: onClose,
        },
        React.createElement(Text, null, 'close'),
      ),
    ]);
  },
}));

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
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
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

  const root = () => screen!.root;
  const fab = () => root().findByProps({ testID: 'terminal-voice-fab' });
  const stubConfirm = () =>
    root().findByProps({ testID: 'v2b-stub-confirm' });
  const hasStub = () => {
    try {
      return Boolean(root().findByProps({ testID: 'v2b-stub' }));
    } catch {
      return false;
    }
  };

  it('renders the FAB at the input bar; disabled until input becomes available', async () => {
    // Device starts online; the pty reports rendered → terminalInputEnabled true.
    await act(async () => {
      renderScreen();
    });

    expect(fab()).toBeTruthy();

    // Toggling the device offline flips terminalInputEnabled false → FAB disabled.
    setDeviceStatus('offline');
    expect(fab().props.disabled).toBe(true);

    // Back online → enabled again.
    setDeviceStatus('online');
    expect(fab().props.disabled).toBe(false);
  });

  it('tap opens the modal when enabled', async () => {
    await act(async () => {
      renderScreen();
    });

    // Modal not yet mounted (stub renders null while !visible).
    expect(hasStub()).toBe(false);

    act(() => {
      fab().props.onPress();
    });

    expect(hasStub()).toBe(true);
  });

  it('onConfirm injects the command into the pty (with \\r) and closes the modal', async () => {
    await act(async () => {
      renderScreen();
    });

    act(() => {
      fab().props.onPress();
    });
    expect(hasStub()).toBe(true);

    act(() => {
      stubConfirm().props.onPress();
    });

    expect(mockTerminalSendText).toHaveBeenCalledWith('git status --short\r', {
      focus: false,
    });
    // Modal closed after confirm.
    expect(hasStub()).toBe(false);
  });

  it('a disabled FAB does not open the modal', async () => {
    await act(async () => {
      renderScreen();
    });

    setDeviceStatus('offline');
    expect(fab().props.disabled).toBe(true);

    // onPress is a no-op for a disabled TouchableOpacity (RN short-circuits),
    // but if invoked directly it still must not open anything because the
    // gate is disabled state — we assert the modal stays absent regardless.
    act(() => {
      fab().props.onPress?.();
    });
    expect(hasStub()).toBe(false);

    // And nothing was sent.
    expect(mockTerminalSendText).not.toHaveBeenCalled();
  });
});
