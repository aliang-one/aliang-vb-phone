import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProjectPortsScreen } from '../src/screens/projects/ProjectPortsScreen';
import { GlassPanel } from '../src/components/shared/GlassPanel';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device, Project } from '../src/data/platformModels';
import type { PortMapping } from '../src/api/portMappings';
import {
  createPortMapping,
  fetchPortMappings,
  revokePortMapping,
} from '../src/api/portMappings';

jest.mock('../src/api/portMappings', () => ({
  fetchPortMappings: jest.fn().mockResolvedValue([]),
  createPortMapping: jest.fn(),
  revokePortMapping: jest.fn(),
}));

const fetchMock = fetchPortMappings as jest.Mock;
const createMock = createPortMapping as jest.Mock;
const revokeMock = revokePortMapping as jest.Mock;

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
// Mutable route params — most tests mount with deviceId set; the no-device
// case rewrites params before render.
let mockRouteParams: { projectId: string; deviceId?: string } = {
  projectId: 'project-1',
  deviceId: 'device-1',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const allText = (root: ReactTestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      if (typeof children === 'string') return children;
      if (Array.isArray(children)) {
        return children.filter(child => typeof child === 'string').join('');
      }
      return '';
    })
    .join('\n');

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
    detectedPorts: [3000, 8081],
    approvalScheme: 'custom',
  };
}

function device(overrides: Partial<Device> = {}): Device {
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
    activePorts: [3000],
    projectIds: ['project-1'],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal', 'http_tunnel_v1', 'websocket_tunnel_v1'],
    tunnelAvailable: true,
    tools: [],
    history: [],
    ...overrides,
  };
}

function mapping(overrides: Partial<PortMapping> = {}): PortMapping {
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
    tag: {
      project_id: 'project-1',
      project_name: 'X',
      source: 'session_preview',
      created_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

/** Old-server response shape: the `tag` key is entirely ABSENT (not null). */
function legacyMapping(overrides: Partial<PortMapping> = {}): PortMapping {
  const { tag: _tag, ...rest } = mapping(overrides);
  return rest as PortMapping;
}

describe('ProjectPortsScreen', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue([]);
    createMock.mockReset().mockResolvedValue(mapping());
    revokeMock.mockReset().mockResolvedValue(
      mapping({ status: 'revoked', revoked_at: new Date().toISOString() }),
    );
    mockRouteParams = { projectId: 'project-1', deviceId: 'device-1' };
    useControlCenterStore.setState({
      devices: [device()],
      projects: [project()],
    });
    alertSpy = jest.spyOn(Alert, 'alert');
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
    alertSpy.mockRestore();
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
          <ProjectPortsScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  it('renders the page title and project-tagged mappings, loaded by projectId', async () => {
    fetchMock.mockResolvedValue([mapping()]);

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    // TopAppBar title = projects ns portMappings.section (zh: 公网端口).
    expect(allText(screen!.root)).toContain('公网端口');
    const text = allText(screen!.root);
    // i18n template '{{host}}:{{port}}' with the fixture's host/port.
    expect(text).toContain(`127.0.0.1:${mapping().target_port}`);
    expect(text).toContain('X');
    expect(fetchMock).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  it('creates a mapping bound to the project', async () => {
    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    act(() => {
      screen!.root.findByProps({ testID: 'port-input' }).props.onChangeText('3000');
    });
    act(() => {
      screen!.root.findByProps({ testID: 'project-port-create' }).props.onPress();
    });
    await act(async () => {});

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        targetHost: '127.0.0.1',
        targetPort: 3000,
        projectId: 'project-1',
      }),
    );
    // Create success → reload() refetches the project list.
    expect(fetchMock.mock.calls.filter(([args]) => args?.projectId === 'project-1').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('revokes a mapping after the destructive confirmation', async () => {
    fetchMock.mockResolvedValue([mapping()]);

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    // The card subtree's actions row is [copy, external, trash] — revoke is
    // the 3rd TouchableOpacity inside the card panel.
    const urlNode = screen!.root.findByProps({
      children: 'https://t.example.com/abc123',
    });
    let cardNode: ReactTestRenderer.ReactTestInstance | null = urlNode;
    while (cardNode && cardNode.type !== GlassPanel) {
      cardNode = cardNode.parent;
    }
    if (!cardNode) throw new Error('mapping card GlassPanel not found');
    const cardButtons = cardNode.findAllByType(TouchableOpacity);
    expect(cardButtons).toHaveLength(3);

    act(() => {
      cardButtons[2].props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const destructive = alertSpy.mock.calls[0][2].find(
      (button: { style?: string }) => button.style === 'destructive',
    );
    act(() => {
      destructive.onPress();
    });
    await act(async () => {});

    expect(revokeMock).toHaveBeenCalledWith('mapping-1');
  });

  it('tapping an expired card prefills port + original expiry for a one-tap recreate', async () => {
    // 8h lifetime, expired 8h ago → recreate restores the 8h chip.
    fetchMock.mockResolvedValue([
      mapping({
        id: 'mapping-exp',
        slug: 'expired1',
        target_port: 5173,
        created_at: new Date(Date.now() - 16 * 3_600_000).toISOString(),
        expires_at: new Date(Date.now() - 8 * 3_600_000).toISOString(),
      }),
    ]);

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(allText(screen!.root)).toContain('已过期');
    expect(allText(screen!.root)).toContain('重建网址');

    act(() => {
      screen!.root
        .findByProps({ accessibilityLabel: '点击按原端口重新生成公网网址' })
        .props.onPress();
    });

    // Port prefilled into the top-of-form input.
    expect(
      screen!.root.findByProps({ testID: 'port-input' }).props.value,
    ).toBe('5173');

    // Create fires with the restored 8h preset — same port, same duration.
    act(() => {
      screen!.root
        .findByProps({ testID: 'project-port-create' })
        .props.onPress();
    });
    await act(async () => {});

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        targetHost: '127.0.0.1',
        targetPort: 5173,
        expiresInSeconds: 28_800,
        projectId: 'project-1',
      }),
    );
  });

  it('shows a read-only notice and no create form without a device', async () => {
    mockRouteParams = { projectId: 'project-1' };
    useControlCenterStore.setState({ devices: [] });

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(
      screen!.root.findAllByProps({ testID: 'port-input' }),
    ).toHaveLength(0);
    expect(allText(screen!.root)).toContain('给项目绑定设备后即可管理公网端口。');
  });

  it('shows the empty state when no mappings exist', async () => {
    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(allText(screen!.root)).toContain('暂无公网端口');
  });

  it('hides the create form while the device is offline', async () => {
    useControlCenterStore.setState({ devices: [device({ status: 'offline' })] });

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(
      screen!.root.findAllByProps({ testID: 'port-input' }),
    ).toHaveLength(0);
    expect(allText(screen!.root)).toContain('设备已离线');
  });

  it('blames the server tunnel, not the agent, when caps are present but tunnel is unconfigured', async () => {
    useControlCenterStore.setState({
      devices: [device({ tunnelAvailable: false })],
    });

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(
      screen!.root.findAllByProps({ testID: 'port-input' }),
    ).toHaveLength(0);
    expect(allText(screen!.root)).toContain('服务端隧道未配置');
    // The stale "upgrade the Agent" copy must NOT show in this state — the
    // agent is capable, the server just lacks the tunnel configuration.
    expect(allText(screen!.root)).not.toContain('请升级桌面端 Agent');
  });

  it('old server (tag field absent on every mapping): upgrade notice instead of the misleading full list', async () => {
    fetchMock.mockResolvedValue([
      legacyMapping(),
      legacyMapping({ id: 'mapping-2', slug: 'def456' }),
    ]);

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(allText(screen!.root)).toContain('服务端版本较旧');
    // Read-only semantics: neither the (device-wide) cards nor the create
    // form may render from an untagged response.
    expect(allText(screen!.root)).not.toContain('https://t.example.com/abc123');
    expect(allText(screen!.root)).not.toContain('https://t.example.com/def456');
    expect(
      screen!.root.findAllByProps({ testID: 'port-input' }),
    ).toHaveLength(0);
  });

  it('tag: null (new-server untagged) still renders the card and the create form', async () => {
    fetchMock.mockResolvedValue([mapping({ tag: null })]);

    act(() => {
      screen = renderScreen();
    });
    await act(async () => {});

    expect(allText(screen!.root)).not.toContain('服务端版本较旧');
    expect(allText(screen!.root)).toContain('https://t.example.com/abc123');
    // RN TextInput renders composite + host nodes that both carry the testID,
    // so presence is asserted with findByProps (suite convention) rather than
    // an exact findAllByProps length.
    expect(() =>
      screen!.root.findByProps({ testID: 'port-input' }),
    ).not.toThrow();
  });
});
