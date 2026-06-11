import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../visual/IconBadge';

const tabIcons: Record<string, IconName> = {
  Dashboard: 'home',
  Devices: 'device',
  VibeCoding: 'agent',
  Account: 'user',
};

const tabLabels: Record<string, string> = {
  Dashboard: 'HOME',
  Devices: 'DEVICES',
  VibeCoding: 'VIBE',
  Account: 'ME',
};

export const BottomNavBar: React.FC<BottomTabBarProps> = ({
  state,
  navigation,
}) => {
  const { theme, isDark } = useTheme();
  const { bottom } = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(17, 20, 23, 0.95)'
            : 'rgba(247, 249, 255, 0.95)',
          borderTopColor: isDark
            ? 'rgba(255, 255, 255, 0.06)'
            : theme.colors.outlineVariant,
          paddingBottom: bottom + 8,
        },
      ]}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const label = tabLabels[route.name] || route.name;
        const icon = tabIcons[route.name] || 'home';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={[styles.tab, isFocused && styles.tabFocused]}
            activeOpacity={0.7}>
            <IconBadge
              name={icon}
              tone={isFocused ? 'primary' : 'neutral'}
              size={34}
              iconSize={17}
              filled={isFocused}
            />
            <Text
              style={[
                theme.typography.labelCaps,
                {
                  color: isFocused
                    ? theme.colors.primary
                    : theme.colors.onSurfaceVariant,
                },
                styles.tabLabel,
              ]}>
              {label.toUpperCase()}
            </Text>
            {isFocused && (
              <View
                style={[
                  styles.indicator,
                  {
                    backgroundColor: theme.colors.primary,
                    ...(isDark ? theme.glow.primary : {}),
                  },
                ]}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    position: 'relative',
  },
  tabFocused: {},
  tabLabel: {
    marginTop: 4,
    fontSize: 10,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: '25%',
    right: '25%',
    height: 2,
    borderRadius: 1,
  },
});
