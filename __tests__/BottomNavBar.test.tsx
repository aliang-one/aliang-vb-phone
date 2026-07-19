import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BottomNavBar } from '../src/components/layout/BottomNavBar';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

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
});
