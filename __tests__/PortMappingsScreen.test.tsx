import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortMappingsScreen } from '../src/screens/devices/PortMappingsScreen';
import { GlowButton } from '../src/components/shared/GlowButton';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import type { Device } from '../src/data/platformModels';
import { createPortMapping, fetchPortMappings } from '../src/api/portMappings';

// --- Mocks ---

// api/portMappings: list resolves empty; mutations are recorded never fired in
// these tests. tunnelHealth is re-exported for the (unrendered here) status
// line so the module shape matches.
jest.mock('../src/api/portMappings', () => ({
  fetchPortMappings: jest.fn().mockResolvedValue([]),
  createPortMapping: jest.fn(),
  revokePortMapping: jest.fn(),
  tunnelHealth: jest.fn(() => 'ok'),
}));

const fetchMock = fetchPortMappings as jest.Mock;
const createMock = createPortMapping as jest.Mock;

// Store selector mock (CreateVibeCodingScreen.test.tsx pattern): devices come
// from a mutable array so each test can shape the device state.
const mockDevices: Device[] = [];
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: unknown) => unknown) =>
    selector({ devices: mockDevices, projects: [] }),
}));

// Navigation: fixed route params pointing at mockDevices[0].
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useRoute: () => ({ params: { deviceId: 'device-1' } }),
}));

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
    authorizedDirectories: ['~/repo'],
    activePorts: [3000],
    projectIds: [],
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

describe('PortMappingsScreen tunnel gate', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  const renderScreen = async () => {
    await act(async () => {
      screen = ReactTestRenderer.create(
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
            <PortMappingsScreen />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
      await Promise.resolve();
    });
    return screen!;
  };

  const createButton = () =>
    screen!.root.findAllByType(GlowButton).find(
      button =>
        typeof button.props.title === 'string' &&
        button.props.title.length > 0,
    );

  /** The port field is the only number-pad TextInput on the screen. */
  const portInput = () =>
    screen!.root
      .findAllByType(TextInput)
      .find(node => node.props.keyboardType === 'number-pad');

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue([]);
    createMock.mockReset();
    mockDevices.length = 0;
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  it('offline device: shows the offline notice and disables create', async () => {
    mockDevices.push(device({ status: 'offline' }));
    await renderScreen();

    expect(allText(screen!.root)).toContain('设备已离线');
    expect(createButton()?.props.disabled).toBe(true);
  });

  it('online device without tunnel caps: shows the upgrade-agent notice', async () => {
    mockDevices.push(device({ capabilities: ['terminal'] }));
    await renderScreen();

    expect(allText(screen!.root)).toContain('请升级桌面端 Agent');
    expect(allText(screen!.root)).not.toContain('服务端隧道未配置');
    expect(createButton()?.props.disabled).toBe(true);
  });

  it('caps present but server tunnel unconfigured: shows the tunnel notice and still refuses a valid submit', async () => {
    mockDevices.push(
      device({ capabilities: ['terminal', 'http_tunnel_v1', 'websocket_tunnel_v1'], tunnelAvailable: false }),
    );
    await renderScreen();

    expect(allText(screen!.root)).toContain('服务端隧道未配置');
    expect(allText(screen!.root)).not.toContain('请升级桌面端 Agent');
    // The regression this screen fixes: old gate (caps-only) let a fully
    // valid host+port submit go through and fail server-side.
    act(() => {
      portInput()!.props.onChangeText('3000');
    });
    expect(createButton()?.props.disabled).toBe(true);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('tunnel-capable device: no blocker notice; valid port enables create', async () => {
    mockDevices.push(device());
    await renderScreen();

    expect(allText(screen!.root)).not.toContain('设备已离线');
    expect(allText(screen!.root)).not.toContain('请升级桌面端 Agent');
    expect(allText(screen!.root)).not.toContain('服务端隧道未配置');
    expect(createButton()?.props.disabled).toBe(true);
    act(() => {
      portInput()!.props.onChangeText('3000');
    });
    expect(createButton()?.props.disabled).toBe(false);
  });

  it('expired card tap prefills host/port/expiry in the form above', async () => {
    mockDevices.push(device());
    // 8h lifetime, expired 8h ago → recreate restores the 8h chip.
    fetchMock.mockResolvedValue([
      {
        id: 'mapping-exp',
        slug: 'expired1',
        user_id: 'user-1',
        device_id: 'device-1',
        target_host: '127.0.0.1',
        target_port: 5173,
        upstream_scheme: 'http',
        status: 'active',
        created_at: new Date(Date.now() - 16 * 3_600_000).toISOString(),
        expires_at: new Date(Date.now() - 8 * 3_600_000).toISOString(),
        short_url: 'https://t.example.com/expired1',
      },
    ]);
    await renderScreen();

    expect(allText(screen!.root)).toContain('重建网址');
    act(() => {
      screen!.root
        .findByProps({ accessibilityLabel: '点击按原端口重新生成公网网址' })
        .props.onPress();
    });

    const inputs = screen!.root.findAllByType(TextInput);
    const host = inputs.find(node => node.props.keyboardType !== 'number-pad');
    expect(host!.props.value).toBe('127.0.0.1');
    expect(portInput()!.props.value).toBe('5173');
  });
});
