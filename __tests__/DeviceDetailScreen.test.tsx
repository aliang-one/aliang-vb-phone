import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceDetailScreen } from '../src/screens/devices/DeviceDetailScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
  }),
  useRoute: () => ({ params: { deviceId: 'device-1' } }),
}));

jest.mock('../src/components/vibecoding/VibeSessionCard', () => ({
  VibeSessionCard: ({ session }: { session: VibeCodingRun }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    return MockReact.createElement(View, {
      testID: 'session-card',
      'data-session-id': session.id,
    });
  },
}));

describe('DeviceDetailScreen', () => {
  beforeEach(() => {
    useControlCenterStore.setState({
      devices: [
        {
          id: 'device-1',
          name: 'MacBook',
          status: 'online',
          location: 'Desk',
          os: 'darwin',
          host: 'localhost',
          cpuLoad: 12,
          memLoad: 34,
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
      projects: [],
      vibeRuns: [
        {
          id: 'older-display-newer-activity',
          title: 'Newer by activity',
          deviceId: 'device-1',
          projectId: 'project-1',
          directory: '~/project',
          status: 'running',
          objective: '',
          model: 'codex',
          timeLimitMinutes: 0,
          elapsedMinutes: 0,
          risk: 'low',
          currentStep: '',
          branch: 'main',
          updatedAt: '1 小时前',
          lastActivityMs: 200,
          suggestions: [],
          events: [],
          transcript: [],
        },
        {
          id: 'newer-display-older-activity',
          title: 'Older by activity',
          deviceId: 'device-1',
          projectId: 'project-1',
          directory: '~/project',
          status: 'running',
          objective: '',
          model: 'codex',
          timeLimitMinutes: 0,
          elapsedMinutes: 0,
          risk: 'low',
          currentStep: '',
          branch: 'main',
          updatedAt: '刚刚',
          lastActivityMs: 100,
          suggestions: [],
          events: [],
          transcript: [],
        },
      ],
      events: [],
      approvals: [],
      scanResults: [],
    });
    jest.clearAllMocks();
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
          <DeviceDetailScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  it('sorts device sessions by last activity timestamp within the active tier', () => {
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      screen = renderScreen();
    });

    const sessionIds = screen!.root
      .findAllByProps({ testID: 'session-card' })
      .map(node => node.props['data-session-id']);

    expect(Array.from(new Set(sessionIds))).toEqual([
      'older-display-newer-activity',
      'newer-display-older-activity',
    ]);
  });
});
