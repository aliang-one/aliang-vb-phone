import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
  interpolate,
  interpolateColor,
} from 'react-native-reanimated';
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

// Icon pop: lively spring with a touch of overshoot
const ICON_SPRING = { damping: 11, stiffness: 200, mass: 0.55 };
// Indicator/pill slide: crisp, minimal overshoot so switches feel decisive
const SLIDE_SPRING = { damping: 22, stiffness: 260, mass: 0.7 };
// Press squish: fast and tight
const PRESS_SPRING = { damping: 16, stiffness: 320, mass: 0.6 };

const BAR_WIDTH = 22;

interface TabItemProps {
  isFocused: boolean;
  label: string;
  icon: IconName;
  onPress: () => void;
}

const TabItem: React.FC<TabItemProps> = ({ isFocused, label, icon, onPress }) => {
  const { theme } = useTheme();
  const focus = useSharedValue(isFocused ? 1 : 0);
  const scale = useSharedValue(isFocused ? 1.1 : 0.86);
  const press = useSharedValue(1);

  useEffect(() => {
    focus.value = withTiming(isFocused ? 1 : 0, { duration: 240 });
    scale.value = withSpring(isFocused ? 1.12 : 0.88, ICON_SPRING);
  }, [isFocused, focus, scale]);

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * press.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      focus.value,
      [0, 1],
      [theme.colors.onSurfaceVariant, theme.colors.primary],
    ),
    opacity: interpolate(focus.value, [0, 1], [0.5, 1]),
    transform: [{ translateY: interpolate(focus.value, [0, 1], [2, 0]) }],
  }));

  const handlePressIn = () => {
    press.value = withSpring(0.88, PRESS_SPRING);
  };
  const handlePressOut = () => {
    press.value = withSpring(1, PRESS_SPRING);
  };

  return (
    <View style={styles.tabSlot}>
      <TouchableOpacity
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={styles.tabButton}>
        <Animated.View style={iconWrapStyle}>
          <IconBadge
            name={icon}
            tone={isFocused ? 'primary' : 'neutral'}
            size={34}
            iconSize={17}
            filled={isFocused}
          />
        </Animated.View>
        <Animated.Text
          style={[theme.typography.labelCaps, styles.tabLabel, labelStyle]}>
          {label.toUpperCase()}
        </Animated.Text>
      </TouchableOpacity>
    </View>
  );
};

export const BottomNavBar: React.FC<BottomTabBarProps> = ({
  state,
  navigation,
}) => {
  const { theme, isDark } = useTheme();
  const { bottom } = useSafeAreaInsets();
  const tabCount = state.routes.length;

  const layoutWidth = useSharedValue(Dimensions.get('window').width);
  const index = useSharedValue(state.index);

  useEffect(() => {
    index.value = withSpring(state.index, SLIDE_SPRING);
  }, [state.index, index]);

  const tabWidth = useDerivedValue(
    () => (layoutWidth.value || Dimensions.get('window').width) / tabCount,
  );

  // Active pill — a soft glowing platform that slides under the focused tab
  const pillWidth = useDerivedValue(() => tabWidth.value * 0.66);
  const pillX = useDerivedValue(
    () =>
      index.value * tabWidth.value + (tabWidth.value - pillWidth.value) / 2,
  );
  const pillStyle = useAnimatedStyle(() => ({
    width: pillWidth.value,
    transform: [{ translateX: pillX.value }],
  }));

  // Top indicator — a glowing bar that springs between tabs
  const barX = useDerivedValue(
    () => index.value * tabWidth.value + tabWidth.value / 2 - BAR_WIDTH / 2,
  );
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: barX.value }],
  }));

  const glow = isDark ? theme.glow.primary : {};

  return (
    <View
      onLayout={(e) => {
        layoutWidth.value = e.nativeEvent.layout.width;
      }}
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(17, 20, 23, 0.96)'
            : 'rgba(247, 249, 255, 0.96)',
          paddingBottom: bottom + 8,
          ...platformShadow(isDark),
        },
      ]}>
      <View
        style={[
          styles.topHair,
          {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.06)'
              : theme.colors.outlineVariant,
          },
        ]}
      />

      <View style={styles.track}>
        {/* Active pill platform */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            pillStyle,
            {
              backgroundColor: isDark
                ? `${theme.colors.primary}22`
                : `${theme.colors.primary}14`,
            },
            glow,
          ]}
        />

        {/* Top sliding indicator */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bar,
            { width: BAR_WIDTH },
            barStyle,
            { backgroundColor: theme.colors.primary },
            glow,
          ]}
        />

        {state.routes.map((route, i) => {
          const isFocused = state.index === i;
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
            <TabItem
              key={route.key}
              isFocused={isFocused}
              label={label}
              icon={icon}
              onPress={onPress}
            />
          );
        })}
      </View>
    </View>
  );
};

// Subtle upward lift so the bar floats above content (iOS shadow + Android elevation)
const platformShadow = (isDark: boolean) =>
  isDark
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
        elevation: 16,
      }
    : {
        shadowColor: '#569CD6',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 8,
      };

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  topHair: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    paddingTop: 8,
  },
  tabSlot: {
    flex: 1,
    alignSelf: 'stretch',
  },
  tabButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 9,
    height: 42,
    borderRadius: 21,
  },
  bar: {
    position: 'absolute',
    top: 0,
    height: 3,
    borderRadius: 1.5,
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 10,
  },
});
