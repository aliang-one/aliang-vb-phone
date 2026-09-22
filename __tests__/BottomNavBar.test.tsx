import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Svg, Path } from 'react-native-svg';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BottomNavBar } from '../src/components/layout/BottomNavBar';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

function makeProps() {
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const navigate = jest.fn();
  const props = {
    state: {
      stale: false,
      type: 'tab',
      key: 'main-tabs',
      index: 1,
      routeNames: ['Dashboard', 'Devices', 'VibeCoding', 'Account'],
      history: [],
      routes: [
        { key: 'dashboard', name: 'Dashboard' },
        { key: 'devices', name: 'Devices' },
        { key: 'vibe', name: 'VibeCoding' },
        { key: 'account', name: 'Account' },
      ],
      preloadedRouteKeys: [],
    },
    descriptors: {},
    navigation: { emit, navigate },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as BottomTabBarProps;
  return { props, emit, navigate };
}

function renderBar(props: BottomTabBarProps) {
  let screen!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
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
          <BottomNavBar {...props} />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return screen;
}

describe('BottomNavBar', () => {
  it('keeps every tab in an equal-width slot and navigates on press', () => {
    const emit = jest.fn(() => ({ defaultPrevented: false }));
    const navigate = jest.fn();
    const props = {
      state: {
        stale: false,
        type: 'tab',
        key: 'main-tabs',
        index: 1,
        routeNames: ['Dashboard', 'Devices', 'VibeCoding', 'Account'],
        history: [],
        routes: [
          { key: 'dashboard', name: 'Dashboard' },
          { key: 'devices', name: 'Devices' },
          { key: 'vibe', name: 'VibeCoding' },
          { key: 'account', name: 'Account' },
        ],
        preloadedRouteKeys: [],
      },
      descriptors: {},
      navigation: { emit, navigate },
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    } as unknown as BottomTabBarProps;

    let screen: ReactTestRenderer.ReactTestRenderer;
    act(() => {
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
            <BottomNavBar {...props} />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
    });

    const buttons = screen!.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(StyleSheet.flatten(button.parent?.props.style)).toMatchObject({
        flex: 1,
        alignSelf: 'stretch',
      });
      expect(StyleSheet.flatten(button.props.style)).toMatchObject({
        width: '100%',
        height: '100%',
      });
    }

    act(() => {
      buttons[2].props.onPress();
    });
    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'vibe',
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith('VibeCoding');

    act(() => {
      screen!.unmount();
    });
  });

  it('draws the bar as an SVG shape with the bulge band inside the layout', () => {
    const { props } = makeProps();
    const screen = renderBar(props);

    // 栏体由 SVG 绘制:一条带凸起的填充路径 + 一条跟随顶缘的发丝线
    const svgs = screen.root.findAllByType(Svg);
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    const paths = svgs[0].findAllByType(Path);
    expect(paths.length).toBe(2);
    const stroked = paths.filter(p => p.props.stroke != null);
    expect(stroked).toHaveLength(1);
    expect(stroked[0].props.strokeWidth).toBe(1);
    expect(paths.some(p => p.props.fill != null)).toBe(true);

    // 凸起带必须计入布局高度(触摸可达 + 屏幕避让):22 凸起带 + 54 栏体
    const track = screen.root
      .findAllByType(View)
      .find(node => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.flexDirection === 'row' && style?.height === 76;
      });
    expect(track).toBeTruthy();

    // 无障碍契约保留:选中态由 accessibilityState 表达
    const buttons = screen.root.findAllByType(TouchableOpacity);
    expect(buttons[1].props.accessibilityRole).toBe('tab');
    expect(buttons[1].props.accessibilityState).toMatchObject({ selected: true });
    expect(buttons[2].props.accessibilityState).toMatchObject({ selected: false });

    act(() => {
      screen.unmount();
    });
  });
});
