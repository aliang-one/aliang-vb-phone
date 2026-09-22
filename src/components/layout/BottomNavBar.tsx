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
const BULGE_BAND = 22; // 栏体顶线上方的凸起带高度(含图标出头余量)
const BODY_HEIGHT = 54; // 栏体高度(原 track 高)
const TRACK_PADDING_TOP = BULGE_BAND + 4; // track 顶部内边距(与图标静止中心共用推导)
const DOME_RX = 32; // 凸起钟形静止半宽
const DOME_RY = 14; // 凸起钟形静止半高(低弧,避免半圆机械感)

// 聚焦图标升起量由波浪几何推导:图标顶部与波峰齐平
// (中心 = 波峰y + 聚焦视觉半径),波浪变化时升起量自动跟随。
const REST_ICON_CENTER = TRACK_PADDING_TOP + 17; // 图标静止中心(paddingTop + badge 半高)
const FOCUSED_ICON_RADIUS = 17 * 1.25; // badge 半高 × 聚焦缩放
const ICON_RISE = Math.round(
  REST_ICON_CENTER - (BULGE_BAND - DOME_RY + FOCUSED_ICON_RADIUS),
); // ≈14

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface BarGeometry {
  width: number;
  height: number;
  cx: number;
  rx: number;
  ry: number;
}

// 栏体轮廓:矩形主体 + 顶线上的低弧钟形凸起。
// 两侧用三次贝塞尔,基线端与顶端切线均水平,过渡圆润无半圆的竖直切线死角。
function buildBubblePath({ width, height, cx, rx, ry }: BarGeometry): string {
  'worklet';
  const y0 = BULGE_BAND;
  const top = y0 - ry;
  const x1 = clamp(cx - rx, 0, width);
  const x2 = clamp(cx + rx, 0, width);
  const k = rx * 0.5;
  return `M 0 ${height} L 0 ${y0} L ${x1} ${y0} C ${x1 + k} ${y0} ${cx - k} ${top} ${cx} ${top} C ${cx + k} ${top} ${x2 - k} ${y0} ${x2} ${y0} L ${width} ${y0} L ${width} ${height} Z`;
}

// 顶缘发丝线:与栏体同一凸起几何,只描顶线。
function buildHairlinePath({ width, cx, rx, ry }: BarGeometry): string {
  'worklet';
  const y0 = BULGE_BAND;
  const top = y0 - ry;
  const x1 = clamp(cx - rx, 0, width);
  const x2 = clamp(cx + rx, 0, width);
  const k = rx * 0.5;
  return `M 0 ${y0} L ${x1} ${y0} C ${x1 + k} ${y0} ${cx - k} ${top} ${cx} ${top} C ${cx + k} ${top} ${x2 - k} ${y0} ${x2} ${y0} L ${width} ${y0}`;
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
  // 激活放大对比:未聚焦收小(0.82),聚焦明显放大(1.25),尺寸差一眼可辨
  const scale = useSharedValue(isFocused ? 1.25 : 0.82);
  const lift = useSharedValue(isFocused ? 1 : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    focus.value = withTiming(isFocused ? 1 : 0, { duration: 240 });
    const pop = isFocused ? 1 : 0;
    scale.value = reduceMotion
      ? withTiming(isFocused ? 1.25 : 0.82, { duration: 200 })
      : withSpring(isFocused ? 1.25 : 0.82, ICON_SPRING);
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
            {/* 静态光环底碟:聚焦时垫在 badge 后面(绝对定位,不参与布局) */}
            {isFocused ? (
              <View
                pointerEvents="none"
                style={[
                  styles.iconHalo,
                  { backgroundColor: `${theme.colors.primary}1F` },
                ]}
              />
            ) : null}
            <IconBadge
              name={icon}
              tone={isFocused ? 'primary' : 'neutral'}
              size={34}
              iconSize={18}
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
  // 下巴(底部安全区 inset)必须由同一 SVG 填充,否则栏体下方透出内容
  const initHeight = BULGE_BAND + BODY_HEIGHT + bottom + 2;
  const layoutWidth = useSharedValue(initialWidth);
  const layoutHeight = useSharedValue(initHeight);
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

  // 液态 squash-stretch:钟形离目标 tab 越远被拉得越宽越扁,落位回弹归位。
  const movingOf = () => {
    'worklet';
    return clamp(Math.abs(index.value - indexTarget.value) / 0.55, 0, 1);
  };

  const barAnimatedProps = useAnimatedProps(() => {
    const width = layoutWidth.value || initialWidth;
    const height = layoutHeight.value || initHeight;
    const tabW = width / tabCount;
    const cx = index.value * tabW + tabW / 2;
    const moving = motionless.value ? 0 : movingOf();
    const rx = Math.min(DOME_RX * (1 + 0.3 * moving), tabW * 0.85);
    const ry = DOME_RY * (1 - 0.25 * moving);
    return { d: buildBubblePath({ width, height, cx, rx, ry }) };
  });

  const hairAnimatedProps = useAnimatedProps(() => {
    const width = layoutWidth.value || initialWidth;
    const height = layoutHeight.value || initHeight;
    const tabW = width / tabCount;
    const cx = index.value * tabW + tabW / 2;
    const moving = motionless.value ? 0 : movingOf();
    const rx = Math.min(DOME_RX * (1 + 0.3 * moving), tabW * 0.85);
    const ry = DOME_RY * (1 - 0.25 * moving);
    return { d: buildHairlinePath({ width, height, cx, rx, ry }) };
  });

  // 首帧静态兜底(SVG 初始 d,与 worklet 同一几何函数)
  const initCx =
    state.index * (initialWidth / tabCount) + initialWidth / tabCount / 2;
  const initBarD = buildBubblePath({
    width: initialWidth,
    height: initHeight,
    cx: initCx,
    rx: DOME_RX,
    ry: DOME_RY,
  });
  const initHairD = buildHairlinePath({
    width: initialWidth,
    height: initHeight,
    cx: initCx,
    rx: DOME_RX,
    ry: DOME_RY,
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
        layoutHeight.value = e.nativeEvent.layout.height;
        onTabBarHeightChange?.(e.nativeEvent.layout.height);
      }}
      style={[styles.container, { paddingBottom: bottom + 2 }]}>
      {/* SVG 栏体铺满容器全高(含下巴 inset):填充轮廓 + 跟随顶缘的发丝线 */}
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

      <View style={styles.track}>
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
    // 凸起带(钟形区)在前,栏体在后;内容从凸起带底部开始排
    height: BULGE_BAND + BODY_HEIGHT,
    paddingTop: TRACK_PADDING_TOP,
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
  iconHalo: {
    // 聚焦图标背后的静态光环底碟(50px 圆,绝对定位零布局影响)
    position: 'absolute',
    top: -8,
    left: -8,
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 10,
  },
});
