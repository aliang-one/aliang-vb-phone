import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Switch, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';
import { NotificationTypesSheet } from '../src/components/settings/NotificationTypesSheet';

const renderSheet = () =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{ theme: utilityMinimalist, mode: 'light', setMode: () => undefined, isDark: false }}
    >
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}
      >
        <NotificationTypesSheet open onClose={() => undefined} />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

describe('NotificationTypesSheet', () => {
  beforeEach(() => {
    useSessionStore.setState({
      notificationPrefs: {
        approval: true, session_done: true, session_failed: true,
        device_offline: true, device_online: true,
      },
    });
  });

  test('renders one switch row per notifiable type (5 rows)', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const labels = r.root.findAllByType(Text).map(t => String(t.props.children ?? ''));
    expect(labels).toContain('审批请求');
    expect(labels).toContain('设备上线');
    expect(r.root.findAllByType(Switch)).toHaveLength(5);
  });

  test('toggling a switch writes back to the store', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const offlineSwitch = r.root
      .findAllByType(Switch)
      .find(s => s.props.accessibilityLabel === '设备离线');
    act(() => { offlineSwitch!.props.onValueChange(false); });
    expect(useSessionStore.getState().notificationPrefs.device_offline).toBe(false);
  });
});
