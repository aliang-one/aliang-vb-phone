// Task P4: NEW TERM FAB long-press → VoiceToBashModal → new DeviceTerminal
// seeded with `initialCommand`. Short tap (onPress) stays the empty-terminal path.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VibeCodingListScreen } from '../src/screens/vibecoding/VibeCodingListScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device } from '../src/data/platformModels';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

// Drive the confirm path without pulling in the full STT + command-gen chain.
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
    const MockReact = require('react');
    const { View: MockView, Text: MockText, TouchableOpacity: MockTouchable } =
      require('react-native');
    return MockReact.createElement(
      MockView,
      { testID: 'v2b-stub' },
      visible
        ? [
            MockReact.createElement(
              MockTouchable,
              {
                key: 'confirm',
                testID: 'v2b-stub-confirm',
                onPress: () => onConfirm('git status --short'),
              },
              MockReact.createElement(MockText, null, 'STUB-CONFIRM'),
            ),
            MockReact.createElement(
              MockTouchable,
              {
                key: 'close',
                testID: 'v2b-stub-close',
                onPress: onClose,
              },
              MockReact.createElement(MockText, null, 'STUB-CLOSE'),
            ),
          ]
        : null,
    );
  },
}));

describe('VibeCodingListScreen NEW TERM long-press → voice→bash', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    useControlCenterStore.setState({
      devices: [device('device-1', 'MacBook', 'online')],
      projects: [],
      vibeRuns: [],
      terminalSessions: [],
      stopTerminal: jest.fn().mockResolvedValue(undefined),
      refreshFromServer: jest.fn().mockResolvedValue(undefined),
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  const renderScreen = () =>
    ReactTestRenderer.create(
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
          <VibeCodingListScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  // Find TouchableOpacity host nodes by testID. react-test-renderer's
  // findAll(predicate) / findAllByProps double-count across the fiber tree in
  // this repo's setup, so narrow by concrete type first.
  const findByTestId = (
    root: ReactTestRenderer.ReactTestInstance,
    id: string,
  ) => root.findAllByType(TouchableOpacity).filter(node => node.props.testID === id);

  // Default activeTab is 0 (Vibecoding); the FAB only mounts on tab 1. Tap the
  // "Terminals" segmented tab to switch — its onPress fires goToTab(1).
  const switchToTerminals = (root: ReactTestRenderer.ReactTestInstance) => {
    const tab = root
      .findAllByType(TouchableOpacity)
      .find(button =>
        button.findAllByType(Text).some(node => node.props.children === 'Terminals'),
      );
    act(() => {
      tab?.props.onPress();
    });
  };

  it('onPress creates an empty terminal without initialCommand', () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      directory: '/repo',
    });
  });

  it('onLongPress opens the voice→bash modal (stub renders)', () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    // Stub mounts with the screen but renders nothing until visible.
    expect(findByTestId(screen!.root, 'v2b-stub-confirm')).toHaveLength(0);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onLongPress();
    });

    expect(findByTestId(screen!.root, 'v2b-stub-confirm')).toHaveLength(1);
  });

  it('confirm navigates to a new terminal seeded with the command and closes the modal', () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onLongPress();
    });

    const confirm = findByTestId(screen!.root, 'v2b-stub-confirm')[0];
    act(() => {
      confirm.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      directory: '/repo',
      initialCommand: 'git status --short',
    });
    // Modal closed → confirm button no longer rendered.
    expect(findByTestId(screen!.root, 'v2b-stub-confirm')).toHaveLength(0);
  });

  it('does not render the FAB on the Vibecoding tab (tab 0)', () => {
    act(() => {
      screen = renderScreen();
    });
    expect(findByTestId(screen!.root, 'new-term-fab')).toHaveLength(0);
  });
});

function device(id: string, name: string, status: Device['status']): Device {
  return {
    id,
    name,
    status,
    location: 'Desk',
    os: 'darwin',
    host: 'localhost',
    cpuLoad: 0,
    memLoad: 0,
    authorizedDirectories: ['/repo'],
    activePorts: [],
    projectIds: [],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal'],
    tools: [],
    history: [],
  };
}
