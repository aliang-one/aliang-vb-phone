import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VibeCodingListScreen } from '../src/screens/vibecoding/VibeCodingListScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device, VibeCodingRun } from '../src/data/platformModels';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

jest.mock('../src/components/vibecoding/DeviceControlCard', () => ({
  DeviceControlCard: ({ device: item }: { device: Device }) => {
    const MockReact = require('react');
    const { View: MockView } = require('react-native');
    return MockReact.createElement(MockView, {
      testID: 'device-card',
      'data-device-id': item.id,
    });
  },
}));

jest.mock('../src/components/vibecoding/VibeSessionCard', () => ({
  VibeSessionCard: ({ session }: { session: VibeCodingRun }) => {
    const MockReact = require('react');
    const { View: MockView } = require('react-native');
    return MockReact.createElement(MockView, {
      testID: 'session-card',
      'data-session-id': session.id,
    });
  },
}));

describe('VibeCodingListScreen remote terminal shortcuts', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    useControlCenterStore.setState({
      devices: [device('device-1', 'MacBook', 'online')],
      projects: [],
      vibeRuns: [],
      terminalSessions: [
        terminal('term-active', 'device-1', 'running', '~/project'),
        terminal('term-completed', 'device-1', 'completed', '~/old'),
      ],
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

  it('shows only active remote terminals and resumes or closes the same PTY', async () => {
    act(() => {
      screen = renderScreen();
    });

    const textContent = screen!.root.findAllByType(Text).map(node => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    });
    expect(textContent).toContain('REMOTE TERMINALS');
    expect(textContent).toContain('1 ACTIVE');
    expect(textContent).toContain('MacBook');
    expect(textContent).toContain('zsh · ~/project');
    expect(textContent).toContain('LAST git status --short');
    expect(textContent).not.toContain('zsh · ~/old');

    const buttons = screen!.root.findAllByType(TouchableOpacity);
    const resumeButton = findButtonByLabel(buttons, 'RESUME');
    const closeButton = findButtonByLabel(buttons, 'CLOSE');

    act(() => {
      resumeButton?.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      terminalId: 'term-active',
      directory: '~/project',
    });

    await act(async () => {
      closeButton?.props.onPress();
    });
    expect(useControlCenterStore.getState().stopTerminal).toHaveBeenCalledWith(
      'term-active',
    );
  });

  it('disables remote terminal actions when the owning device is offline', () => {
    useControlCenterStore.setState({
      devices: [device('device-1', 'MacBook', 'offline')],
    });

    act(() => {
      screen = renderScreen();
    });

    const buttons = screen!.root.findAllByType(TouchableOpacity);
    expect(findButtonByLabel(buttons, 'RESUME')?.props.disabled).toBe(true);
    expect(findButtonByLabel(buttons, 'CLOSE')?.props.disabled).toBe(true);
  });
});

function findButtonByLabel(
  buttons: ReactTestRenderer.ReactTestInstance[],
  label: string,
) {
  return buttons.find(button =>
    button.findAllByType(Text).some(node => node.props.children === label),
  );
}

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
  };
}

function terminal(
  id: string,
  deviceId: string,
  status: ReturnType<
    typeof useControlCenterStore.getState
  >['terminalSessions'][number]['status'],
  directory: string,
) {
  return {
    id,
    deviceId,
    directory,
    shell: 'zsh',
    status,
    lines: [],
    createdAt: '2026-06-17T10:00:00.000Z',
    updatedAt: '2026-06-17T10:00:00.000Z',
    lastCommand: status === 'running' ? 'git status --short' : undefined,
    lastCommandAt:
      status === 'running' ? '2026-06-17T10:00:00.000Z' : undefined,
  };
}
