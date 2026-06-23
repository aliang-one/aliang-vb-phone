import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProjectDetailScreen } from '../src/screens/projects/ProjectDetailScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device, Project } from '../src/data/platformModels';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockReloadProjectSessions = jest.fn().mockResolvedValue(undefined);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
  }),
  useRoute: () => ({
    params: { projectId: 'project-1', deviceId: 'device-1' },
  }),
}));

jest.mock('../src/hooks/useProjectSessions', () => ({
  useProjectSessions: () => ({
    sessions: [],
    totalCount: 0,
    loading: false,
    reload: mockReloadProjectSessions,
  }),
}));

describe('ProjectDetailScreen', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    useControlCenterStore.setState({
      devices: [device()],
      projects: [project()],
      vibeRuns: [],
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
          <ProjectDetailScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  it('opens project settings from the hero card entry', () => {
    act(() => {
      screen = renderScreen();
    });

    act(() => {
      screen!.root.findByProps({ testID: 'project-settings-entry' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('ProjectSettings', {
      projectId: 'project-1',
      deviceId: 'device-1',
    });
  });
});

function project(): Project {
  return {
    id: 'project-1',
    name: 'Vibe Phone',
    status: 'active',
    branch: 'main',
    lastDeploy: '刚刚',
    language: 'TypeScript',
    description: 'Mobile controller',
    path: '~/vibe_on_phone',
    deviceId: 'device-1',
    detectedPorts: [8081],
    approvalScheme: 'custom',
  };
}

function device(): Device {
  return {
    id: 'device-1',
    name: 'MacBook',
    status: 'online',
    location: 'Desk',
    os: 'darwin',
    host: 'localhost',
    cpuLoad: 0,
    memLoad: 0,
    authorizedDirectories: ['~/vibe_on_phone'],
    activePorts: [8081],
    projectIds: ['project-1'],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal'],
    tools: [],
    history: [],
  };
}
