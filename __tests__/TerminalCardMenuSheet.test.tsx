import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import type { TerminalSession } from '../src/store/types';

// --- Mocks (module-level, jest.mock is hoisted; vars prefixed `mock` allowed) ---

// Render BottomSheet children directly — the unit under test is the menu/info
// view logic and callbacks, not the sheet's Modal + reanimated chrome.
jest.mock('../src/components/shared/BottomSheet', () => {
  const React = require('react');
  return {
    BottomSheet: (props: { open: boolean; children: React.ReactNode }) =>
      props.open
        ? React.createElement(React.Fragment, null, props.children)
        : null,
  };
});

import { TerminalCardMenuSheet } from '../src/components/terminals/TerminalCardMenuSheet';

const makeTerminal = (): TerminalSession => ({
  id: 't1',
  deviceId: 'dev1',
  directory: '/home/mac/proj',
  shell: 'zsh',
  status: 'running',
  lines: [],
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-14T02:00:00.000Z',
});

const baseProps = (terminal: TerminalSession) => ({
  open: true,
  onClose: () => undefined,
  terminal,
  onDelete: jest.fn(),
  onScan: jest.fn(),
});

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
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
    await Promise.resolve();
  });
  return renderer!;
};

/** Find a TouchableOpacity by the text it renders (or by testID). */
const buttonBy = (
  root: ReactTestRenderer.ReactTestRenderer,
  match: { text?: string; testID?: string },
) =>
  root.root.findAllByType(TouchableOpacity).find(c => {
    if (match.testID) return c.props.testID === match.testID;
    return c
      .findAllByType(Text)
      .some(t => String(t.props.children) === match.text);
  });

const tap = (btn: ReactTestRenderer.ReactTestInstance | undefined) => {
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
};

describe('TerminalCardMenuSheet', () => {
  it('renders the three menu rows', async () => {
    const renderer = await wrap(
      <TerminalCardMenuSheet {...baseProps(makeTerminal())} />,
    );
    expect(buttonBy(renderer, { text: '删除终端' })).toBeTruthy();
    expect(buttonBy(renderer, { text: '扫码配对' })).toBeTruthy();
    expect(buttonBy(renderer, { text: '终端简介' })).toBeTruthy();
  });

  it('calls onDelete from the delete row', async () => {
    const props = baseProps(makeTerminal());
    const renderer = await wrap(<TerminalCardMenuSheet {...props} />);
    tap(buttonBy(renderer, { testID: 'terminal-menu-delete' }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onScan).not.toHaveBeenCalled();
  });

  it('calls onScan from the scan row', async () => {
    const props = baseProps(makeTerminal());
    const renderer = await wrap(<TerminalCardMenuSheet {...props} />);
    tap(buttonBy(renderer, { testID: 'terminal-menu-scan' }));
    expect(props.onScan).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('keeps the delete row enabled regardless of device state (2026-10-25 解绑)', async () => {
    const props = baseProps(makeTerminal());
    const renderer = await wrap(
      <TerminalCardMenuSheet {...props} renewDisabled />,
    );
    // 删除与设备状态彻底解绑:离线/在线删除都可点(server 离线 close 是
    // best-effort,重连由 reconcile 收刀)。
    expect(buttonBy(renderer, { testID: 'terminal-menu-delete' })?.props.disabled).toBeFalsy();
    expect(
      buttonBy(renderer, { testID: 'terminal-menu-scan' })?.props.disabled,
    ).toBeFalsy();
    // 注:react-test-renderer 直调 onPress 不经过 touch 系统,disabled 的
    // 运行时拦截无法在此层验证,断言 disabled prop 即可。
  });

  it('switches to the info view and back', async () => {
    const renderer = await wrap(
      <TerminalCardMenuSheet
        {...baseProps(makeTerminal())}
        deviceName="Mac Studio"
        createdBy="mac@aliang.one"
      />,
    );
    tap(buttonBy(renderer, { testID: 'terminal-menu-info' }));
    await act(async () => {});

    const textValues = renderer!
      .root.findAllByType(Text)
      .map(t => String(t.props.children));
    expect(textValues).toEqual(expect.arrayContaining([
      '创建时间',
      '创建人',
      'mac@aliang.one',
      '设备',
      'Mac Studio',
      'Shell',
      'zsh',
      '工作目录',
      '/home/mac/proj',
      '状态',
      'READY',
      '最近活动',
    ]));

    // 信息行 value 有 flex 收缩且可换行:长目录/账号不得横向溢出卡片。
    const dirValue = renderer!
      .root.findAllByType(Text)
      .find(t => t.props.children === '/home/mac/proj');
    expect(dirValue).toBeTruthy();
    const style = dirValue!.props.style as Array<
      Record<string, unknown> | undefined
    >;
    expect(style.some(s => s && s.flex === 1)).toBe(true);
    expect(dirValue!.props.numberOfLines).toBeUndefined();

    // 返回菜单首页。
    tap(buttonBy(renderer, { testID: 'terminal-menu-back' }));
    await act(async () => {});
    expect(buttonBy(renderer, { text: '删除终端' })).toBeTruthy();
    expect(renderer!.root.findAllByType(Text).map(t => String(t.props.children)))
      .not.toEqual(expect.arrayContaining(['创建人']));
  });

  it('falls back to "-" when the creator is unknown', async () => {
    const renderer = await wrap(
      <TerminalCardMenuSheet {...baseProps(makeTerminal())} />,
    );
    tap(buttonBy(renderer, { testID: 'terminal-menu-info' }));
    await act(async () => {});
    const textValues = renderer!
      .root.findAllByType(Text)
      .map(t => String(t.props.children));
    expect(textValues).toEqual(expect.arrayContaining(['-']));
  });

  it('renders nothing while closed', async () => {
    const renderer = await wrap(
      <TerminalCardMenuSheet
        {...baseProps(makeTerminal())}
        open={false}
      />,
    );
    expect(renderer!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  });
});
