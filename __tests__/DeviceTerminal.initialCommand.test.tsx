import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

const mockTerminalSendText = jest.fn();
const mockTerminalFocus = jest.fn();
const mockTerminalFit = jest.fn();
const mockSetParams = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Live mutable route params. `setParams({ initialCommand: undefined })` must
// actually clear the value so we can assert downstream reads see it cleared.
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

describe('DeviceTerminalScreen initialCommand auto-run', () => {
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
    // clearAllMocks wipes the implementation installed above; re-wire so the
    // screen's navigation.setParams actually mutates the live route params.
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

  it('runs the routed command once when the pty becomes input-available', async () => {
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
      initialCommand: 'git status --short',
    };

    await act(async () => {
      renderScreen();
    });

    expect(mockTerminalSendText).toHaveBeenCalledTimes(1);
    expect(mockTerminalSendText).toHaveBeenCalledWith('git status --short\r', {
      focus: false,
    });
    expect(mockSetParams).toHaveBeenCalledWith({ initialCommand: undefined });
    expect(mockRouteParams.initialCommand).toBeUndefined();
  });

  it('does not re-run after firing even when input toggles', async () => {
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
      initialCommand: 'ls -la',
    };

    await act(async () => {
      renderScreen();
    });

    expect(mockTerminalSendText).toHaveBeenCalledTimes(1);

    // Toggle input OFF (device offline -> terminalInputEnabled false), then
    // back ON. ranInitialRef must keep it from firing a second time.
    act(() => {
      useControlCenterStore.setState(state => ({
        devices: state.devices.map(device =>
          device.id === 'device-1' ? { ...device, status: 'offline' } : device,
        ),
      }));
    });

    act(() => {
      useControlCenterStore.setState(state => ({
        devices: state.devices.map(device =>
          device.id === 'device-1' ? { ...device, status: 'online' } : device,
        ),
      }));
    });

    expect(mockTerminalSendText).toHaveBeenCalledTimes(1);
    expect(mockSetParams).toHaveBeenCalledTimes(1);
  });

  it('does not send anything when no initialCommand is provided', async () => {
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
    };

    await act(async () => {
      renderScreen();
    });

    expect(mockTerminalSendText).not.toHaveBeenCalled();
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});
