import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
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
    canGoBack: () => true,
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
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

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
          risk: 'low',
          currentStep: '',
          branch: 'main',
          updatedAt: '1 小时前',
          lastActivityMs: 200,
          suggestions: [],
          events: [],
          transcript: [],
          structuredEvents: [],
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
          risk: 'low',
          currentStep: '',
          branch: 'main',
          updatedAt: '刚刚',
          lastActivityMs: 100,
          suggestions: [],
          events: [],
          transcript: [],
          structuredEvents: [],
        },
      ],
      events: [],
      approvals: [],
      scanResults: [],
      terminalSessions: [
        {
          id: 'term-active',
          deviceId: 'device-1',
          directory: '~/project',
          shell: 'zsh',
          status: 'running',
          lines: [],
          createdAt: '2026-06-17T10:00:00.000Z',
          updatedAt: '2026-06-17T10:05:00.000Z',
          lastCommand: 'npm test -- --runInBand',
          lastCommandAt: '2026-06-17T10:04:00.000Z',
        },
        {
          id: 'term-closed',
          deviceId: 'device-1',
          directory: '~/old',
          shell: 'zsh',
          status: 'completed',
          lines: [],
          createdAt: '2026-06-17T09:00:00.000Z',
          updatedAt: '2026-06-17T09:05:00.000Z',
        },
      ],
      stopTerminal: jest.fn().mockResolvedValue(undefined),
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
          <DeviceDetailScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  it('sorts device sessions by last activity timestamp within the active tier', () => {
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

  it('shows active terminals and resumes or closes the same PTY', async () => {
    act(() => {
      screen = renderScreen();
    });

    const textContent = screen!.root.findAllByType(Text).map(node => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    });
    // TerminalCard renders directory (not the terminal ID).
    expect(textContent).toContain('~/project');
    expect(textContent).not.toContain('~/old');

    // TerminalCard wires onPress (resume → navigate) and onClose (→ stopTerminal).
    // Call ALL TouchableOpacity onPress handlers; verify the two side effects.
    const buttons = screen!.root.findAllByType(TouchableOpacity);
    for (const btn of buttons) {
      act(() => {
        btn.props.onPress?.();
      });
    }

    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      terminalId: 'term-active',
      directory: '~/project',
    });

    await act(async () => {
      void useControlCenterStore.getState().stopTerminal;
    });
    expect(useControlCenterStore.getState().stopTerminal).toHaveBeenCalledWith(
      'term-active',
    );
  });
});
