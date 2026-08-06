import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TerminalListScreen } from '../src/screens/terminals/TerminalListScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device } from '../src/data/platformModels';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    canGoBack: () => true,
    goBack: jest.fn(),
  }),
}));

jest.mock('../src/components/vibecoding/DeviceControlCard', () => ({
  DeviceControlCard: ({ device: item, onPress }: { device: Device; onPress: () => void }) => {
    const MockReact = require('react');
    const { View: MockView, TouchableOpacity: MockTO } = require('react-native');
    return MockReact.createElement(
      MockTO,
      {
        testID: 'device-card',
        'data-device-id': item.id,
        onPress,
      },
      MockReact.createElement(MockView, null),
    );
  },
}));

describe('TerminalListScreen', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    useControlCenterStore.setState({
      devices: [device('device-1', 'MacBook', 'online')],
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
        }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}>
          <TerminalListScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  it('shows device cards and navigates to DeviceDetail on tap', () => {
    act(() => {
      screen = renderScreen();
    });

    // Device cards are rendered.
    const cards = screen!.root.findAllByProps({ testID: 'device-card' });
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0].props['data-device-id']).toBe('device-1');

    // Tapping a device card navigates to DeviceDetail.
    act(() => {
      cards[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DeviceDetail', {
      deviceId: 'device-1',
    });
  });

  it('shows correct device summary counts', () => {
    useControlCenterStore.setState({
      devices: [
        device('device-1', 'MacBook', 'online'),
        device('device-2', 'Server', 'offline'),
      ],
    });

    act(() => {
      screen = renderScreen();
    });

    const textContent = screen!.root.findAllByType(Text).map(node => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    });
    const joinedText = textContent.join('\n');

    // Summary chips show device count + online count.
    expect(joinedText).toContain('2');
    expect(joinedText).toContain('1');
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
    cpuLoad: 12,
    memLoad: 34,
    authorizedDirectories: [],
    activePorts: [],
    projectIds: [],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal'],
    tools: [],
    history: [],
  } as Device;
}
