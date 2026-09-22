import React, { useContext, useEffect } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  clamp,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import {
  BottomTabBarProps,
  BottomTabBarHeightCallbackContext,
} from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
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
// Bulge slide: crisp, minimal overshoot so switches feel decisive
const SLIDE_SPRING = { damping: 22, stiffness: 260, mass: 0.7 };
// Press squish: fast and tight
const PRESS_SPRING = { damping: 16, stiffness: 320, mass: 0.6 };

// —— 液态凸起几何 ——
// 凸起带计入布局高度:触摸可达(命中测试以布局边界为界)+ 屏幕避让自动跟随。
const BULGE_BAND = 24; // 栏体顶线上方的凸起带高度
const BODY_HEIGHT = 54; // 栏体高度(原 track 高)
const BUBBLE_RX = 25; // 凸起气泡静止半宽
const BUBBLE_RY = 20; // 凸起气泡静止半高
const ICON_RISE = 26; // 聚焦图标升入气泡的位移

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface BarGeometry {
  width: number;
  cx: number;
  rx: number;
  ry: number;
}

// 栏体轮廓:矩形主体 + 顶线上的上凸半椭圆气泡(发丝线共用同一凸起几何)。
function buildBubblePath({ width, cx, rx, ry }: BarGeometry): string {
  'worklet';
  const y0 = BULGE_BAND;
  const h = BULGE_BAND + BODY_HEIGHT;
  const x1 = clamp(cx - rx, 0, width);
  const x2 = clamp(cx + rx, 0, width);
  return `M 0 ${h} L 0 ${y0} L ${x1} ${y0} A ${rx} ${ry} 0 0 1 ${x2} ${y0} L ${width} ${y0} L ${width} ${h} Z`;
}

// 顶缘发丝线:与栏体同一凸起几何,只描顶线。
function buildHairlinePath({ width, cx, rx, ry }: BarGeometry): string {
  'worklet';
  const y0 = BULGE_BAND;
  const x1 = clamp(cx - rx, 0, width);
  const x2 = clamp(cx + rx, 0, width);
  return `M 0 ${y0} L ${x1} ${y0} A ${rx} ${ry} 0 0 1 ${x2} ${y0} L ${width} ${y0}`;
}

interface TabItemProps {
  isFocused: boolean;
  label: string;
  icon: IconName;
  onPress: () => void;
}

const TabItem: React.FC<TabItemProps> = ({ isFocused, label, icon, onPress }) => {
  const { theme, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const focus = useSharedValue(isFocused ? 1 : 0);
  const scale = useSharedValue(isFocused ? 1.1 : 0.86);
  const lift = useSharedValue(isFocused ? 1 : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    focus.value = withTiming(isFocused ? 1 : 0, { duration: 240 });
    const pop = isFocused ? 1 : 0;
    scale.value = reduceMotion
      ? withTiming(isFocused ? 1.1 : 0.86, { duration: 200 })
      : withSpring(isFocused ? 1.12 : 0.88, ICON_SPRING);
    lift.value = reduceMotion
      ? withTiming(pop, { duration: 200 })
      : withSpring(pop, ICON_SPRING);
  }, [isFocused, focus, scale, lift, reduceMotion]);

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(lift.value, [0, 1], [0, -ICON_RISE]) },
      { scale: scale.value * press.value },
    ],
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
          {/* 气泡光晕只挂在聚焦图标上(iOS shadow 需 borderRadius 跟随圆形) */}
          <View
            style={[
              styles.iconGlow,
              isFocused && isDark ? theme.glow.primary : null,
            ]}>
            <IconBadge
              name={icon}
              tone={isFocused ? 'primary' : 'neutral'}
              size={34}
              iconSize={17}
              filled={isFocused}
            />
          </View>
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
  const reduceMotion = useReduceMotion();
  const { bottom } = useSafeAreaInsets();
  // 浮动 tab 栏:绝对定位悬浮在物理底边,列表内容从栏底下穿过。
  // 把实测高度(凸起带 + 栏体 + inset)回报给 bottom-tabs,屏幕用 useBottomTabBarHeight() 避让。
  const onTabBarHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const tabCount = state.routes.length;

  const initialWidth = Dimensions.get('window').width;
  const layoutWidth = useSharedValue(initialWidth);
  const index = useSharedValue(state.index);
  const indexTarget = useSharedValue(state.index);
  // 传给 worklet 的「关闭液态形变」开关(reduce motion 时凸起不拉伸)
  const motionless = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    indexTarget.value = state.index;
    index.value = reduceMotion
      ? withTiming(state.index, { duration: 260 })
      : withSpring(state.index, SLIDE_SPRING);
  }, [state.index, index, indexTarget, reduceMotion]);

  useEffect(() => {
    motionless.value = reduceMotion ? 1 : 0;
  }, [reduceMotion, motionless]);

  // 液态 squash-stretch:气泡离目标 tab 越远被拉得越宽越扁,落位回弹归位。
  const movingOf = () => {
    'worklet';
    return clamp(Math.abs(index.value - indexTarget.value) / 0.55, 0, 1);
  };

  const barAnimatedProps = useAnimatedProps(() => {
    const width = layoutWidth.value || initialWidth;
    const tabW = width / tabCount;
    const cx = index.value * tabW + tabW / 2;
    const moving = motionless.value ? 0 : movingOf();
    const rx = Math.min(BUBBLE_RX * (1 + 0.35 * moving), tabW * 0.85);
    const ry = BUBBLE_RY * (1 - 0.22 * moving);
    return { d: buildBubblePath({ width, cx, rx, ry }) };
  });

  const hairAnimatedProps = useAnimatedProps(() => {
    const width = layoutWidth.value || initialWidth;
    const tabW = width / tabCount;
    const cx = index.value * tabW + tabW / 2;
    const moving = motionless.value ? 0 : movingOf();
    const rx = Math.min(BUBBLE_RX * (1 + 0.35 * moving), tabW * 0.85);
    const ry = BUBBLE_RY * (1 - 0.22 * moving);
    return { d: buildHairlinePath({ width, cx, rx, ry }) };
  });

  // 首帧静态兜底(SVG 初始 d,与 worklet 同一几何函数)
  const initCx =
    state.index * (initialWidth / tabCount) + initialWidth / tabCount / 2;
  const initBarD = buildBubblePath({
    width: initialWidth,
    cx: initCx,
    rx: BUBBLE_RX,
    ry: BUBBLE_RY,
  });
  const initHairD = buildHairlinePath({
    width: initialWidth,
    cx: initCx,
    rx: BUBBLE_RX,
    ry: BUBBLE_RY,
  });

  const barColor = isDark
    ? 'rgba(17, 20, 23, 0.96)'
    : 'rgba(247, 249, 255, 0.96)';
  const hairColor = isDark
    ? 'rgba(255, 255, 255, 0.06)'
    : theme.colors.outlineVariant;

  return (
    <View
      onLayout={(e) => {
        layoutWidth.value = e.nativeEvent.layout.width;
        onTabBarHeightChange?.(e.nativeEvent.layout.height);
      }}
      style={[styles.container, { paddingBottom: bottom + 2 }]}>
      <View style={styles.track}>
        {/* SVG 栏体:填充轮廓 + 跟随顶缘的发丝线 */}
        <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <AnimatedPath
              animatedProps={barAnimatedProps}
              d={initBarD}
              fill={barColor}
            />
            <AnimatedPath
              animatedProps={hairAnimatedProps}
              d={initHairD}
              fill="none"
              stroke={hairColor}
              strokeWidth={1}
            />
          </Svg>
        </Animated.View>

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

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // 背景由 SVG 路径绘制(凸起轮廓),容器本身必须透明
    backgroundColor: 'transparent',
  },
  track: {
    flexDirection: 'row',
    // 凸起带(气泡区)在前,栏体在后;内容从凸起带底部开始排
    height: BULGE_BAND + BODY_HEIGHT,
    paddingTop: BULGE_BAND + 6,
  },
  tabSlot: {
    flex: 1,
    alignSelf: 'stretch',
  },
  tabButton: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: 'relative',
  },
  iconGlow: {
    borderRadius: 17,
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 10,
  },
});
