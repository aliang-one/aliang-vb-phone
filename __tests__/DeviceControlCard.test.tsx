import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { DeviceControlCard } from '../src/components/vibecoding/DeviceControlCard';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device } from '../src/data/platformModels';

const wrap = (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
      >
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}
        >
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const makeDevice = (id = 'd1'): Device =>
  ({
    id,
    name: 'MacBook',
    status: 'online',
    location: 'home',
    os: 'darwin',
    host: 'mac.local',
    cpuLoad: 10,
    memLoad: 20,
    authorizedDirectories: [],
    activePorts: [],
    projectIds: [],
    activeSessionIds: [],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: [],
    tools: [],
  }) as unknown as Device;

const texts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

const tap = (root: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const btn = root.root.findAllByType(TouchableOpacity).find(c =>
    c.findAllByType(Text).some(t => String(t.props.children) === label));
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
};

const longPressCard = (root: ReactTestRenderer.ReactTestRenderer) => {
  act(() => {
    const card = root.root.findAllByType(TouchableOpacity)[0];
    (card.props as { onLongPress?: () => void }).onLongPress?.();
  });
};

describe('DeviceControlCard long-press menu', () => {
  let renameDevice: jest.Mock;
  let removeDevice: jest.Mock;
  let root: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    renameDevice = jest.fn().mockResolvedValue({ ok: true, deviceId: 'd1' });
    removeDevice = jest.fn().mockResolvedValue({ ok: true, deviceId: 'd1' });
    useControlCenterStore.setState({ renameDevice, removeDevice });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
  });

  it('long-press opens the menu with 详细介绍 / 重命名 / 删除', () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    longPressCard(root);
    const t = texts(root);
    expect(t.some(x => x === '详细介绍')).toBe(true);
    expect(t.some(x => x === '重命名')).toBe(true);
    expect(t.some(x => x === '删除')).toBe(true);
  });

  it('delete shows a two-step confirm and calls removeDevice on 确认删除', async () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    longPressCard(root);
    tap(root, '删除');
    expect(texts(root).some(x => x === '确认删除')).toBe(true);
    await act(async () => {
      tap(root, '确认删除');
    });
    expect(removeDevice).toHaveBeenCalledWith('d1');
  });

  it('详细介绍 opens the info sheet with device fields', () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    longPressCard(root);
    tap(root, '详细介绍');
    const t = texts(root);
    expect(t.some(x => x === 'Agent 版本')).toBe(true);
    expect(t.some(x => x === '唯一码')).toBe(true);
  });
});
