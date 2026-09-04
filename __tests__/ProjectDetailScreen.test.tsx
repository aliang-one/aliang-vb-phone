import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProjectDetailScreen } from '../src/screens/projects/ProjectDetailScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { fetchPortMappings } from '../src/api/portMappings';
import type { PortMapping } from '../src/api/portMappings';
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

// The hero ports metric fetches the project-tagged mappings on mount; stub
// the api so the screen test never touches the real network client.
jest.mock('../src/api/portMappings', () => ({
  fetchPortMappings: jest.fn().mockResolvedValue([]),
  createPortMapping: jest.fn(),
  revokePortMapping: jest.fn(),
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

  it('opens the project ports page from the tappable hero ports cell', async () => {
    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    const portsCell = screen!.root.findByProps({ testID: 'project-ports-entry' });
    expect(portsCell).toBeTruthy();
    // The hero metric fetches the project-tagged mappings for its count.
    expect(fetchPortMappings).toHaveBeenCalledWith({ projectId: 'project-1' });

    act(() => {
      portsCell.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('ProjectPorts', {
      projectId: 'project-1',
      deviceId: 'device-1',
    });
  });

  it('hero ports cell reads "N 公网" with the detected count as the dim second line', async () => {
    // One active + one revoked mapping → activeCount=1; detectedPorts=[8081]
    // → second line "1". jest pins the zh locale, so forwarded renders 公网.
    (fetchPortMappings as jest.Mock).mockResolvedValue([
      activeMapping(),
      activeMapping({ id: 'mapping-2', status: 'revoked' }),
    ]);

    try {
      act(() => {
        screen = renderScreen();
      });
      await act(async () => {});

      const lines = screen!.root
        .findAllByType(Text)
        .map(node => (typeof node.props.children === 'string' ? node.props.children : ''))
        .filter(Boolean);
      expect(lines).toContain('1 公网');
      expect(lines).toContain('1');
    } finally {
      (fetchPortMappings as jest.Mock).mockResolvedValue([]);
    }
  });
});

function activeMapping(overrides: Partial<PortMapping> = {}): PortMapping {
  return {
    id: 'mapping-1',
    slug: 'abc123',
    user_id: 'user-1',
    device_id: 'device-1',
    target_host: '127.0.0.1',
    target_port: 3000,
    upstream_scheme: 'http',
    status: 'active',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    short_url: 'https://t.example.com/abc123',
    tag: null,
    ...overrides,
  };
}

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
