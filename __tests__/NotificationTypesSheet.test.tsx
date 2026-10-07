import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Switch, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';
import { NotificationTypesSheet } from '../src/components/settings/NotificationTypesSheet';

const renderSheet = (overrides?: { onSendTest?: () => void; onClose?: () => void }) =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{ theme: utilityMinimalist, mode: 'light', setMode: () => undefined, isDark: false }}
    >
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}
      >
        <NotificationTypesSheet
          open
          onClose={overrides?.onClose ?? (() => undefined)}
          onSendTest={overrides?.onSendTest}
        />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

const findButtonByText = (
  root: ReactTestRenderer.ReactTestInstance,
  title: string,
) =>
  root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node.findAllByType(Text).some(t => String(t.props.children) === title),
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
    expect(labels).toContain('会话已完成');
    expect(labels).toContain('会话失败');
    expect(labels).toContain('设备离线');
    expect(labels).toContain('设备上线');
    expect(r.root.findAllByType(Switch)).toHaveLength(5);
  });

  test('toggling a switch writes back to the store', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const offlineSwitch = r.root
      .findAllByType(Switch)
      .find(s => s.props.accessibilityLabel === '设备离线');
    expect(offlineSwitch).toBeDefined();
    act(() => { offlineSwitch!.props.onValueChange(false); });
    expect(useSessionStore.getState().notificationPrefs.device_offline).toBe(false);
  });

  test('hides the send-test section when no onSendTest handler is passed', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const labels = r.root.findAllByType(Text).map(t => String(t.props.children ?? ''));
    expect(labels).not.toContain('发送测试通知');
    expect(findButtonByText(r.root, '发送测试通知')).toBeUndefined();
  });

  test('send-test button: pressing closes the sheet and fires onSendTest (toast lives behind the Modal)', () => {
    const onSendTest = jest.fn();
    const onClose = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet({ onSendTest, onClose }); });

    const testBtn = findButtonByText(r.root, '发送测试通知');
    expect(testBtn).toBeDefined();
    expect((testBtn!.props as { disabled?: boolean }).disabled).toBe(false);
    act(() => { testBtn!.props.onPress(); });

    // BottomSheet is a native Modal covering the root ToastViewport — the
    // handler must close the sheet BEFORE firing so the result toast is seen.
    // Pin the ORDER, not just the counts: swapping the two lines reintroduces
    // the toast-hidden-behind-Modal bug with an otherwise green suite.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSendTest).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onSendTest.mock.invocationCallOrder[0],
    );
  });

  test('send-test button ignores a second press during the slide-out window', () => {
    const onSendTest = jest.fn();
    const onClose = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet({ onSendTest, onClose }); });

    const testBtn = findButtonByText(r.root, '发送测试通知');
    expect(testBtn).toBeDefined();
    // The sheet stays mounted ~256ms while animating out, so the button is
    // still hittable after the first press — it must be a one-shot.
    act(() => { testBtn!.props.onPress(); });
    act(() => { testBtn!.props.onPress(); });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSendTest).toHaveBeenCalledTimes(1);
  });

  test('send-test button re-arms when the sheet is reopened', () => {
    const onSendTest = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    const rerender = (open: boolean) =>
      act(() => {
        r.update(
          <ThemeContext.Provider
            value={{ theme: utilityMinimalist, mode: 'light', setMode: () => undefined, isDark: false }}
          >
            <SafeAreaProvider
              initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}
            >
              <NotificationTypesSheet
                open={open}
                onClose={() => undefined}
                onSendTest={onSendTest}
              />
            </SafeAreaProvider>
          </ThemeContext.Provider>,
        );
      });

    act(() => { r = renderSheet({ onSendTest, onClose: () => undefined }); });
    const btn1 = findButtonByText(r.root, '发送测试通知');
    act(() => { btn1!.props.onPress(); });
    expect(onSendTest).toHaveBeenCalledTimes(1);

    // Close (unmounts the animated sheet) then reopen: the guard must reset.
    rerender(false);
    rerender(true);
    const btn2 = findButtonByText(r.root, '发送测试通知');
    expect(btn2).toBeDefined();
    act(() => { btn2!.props.onPress(); });
    expect(onSendTest).toHaveBeenCalledTimes(2);
  });
});
