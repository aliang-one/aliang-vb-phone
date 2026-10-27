import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import {
  CONTEXT_WINDOW_STOPS,
  contextWindowAtFraction,
  contextWindowFraction,
  contextWindowKValue,
  formatContextWindow,
  nextContextWindowStop,
  parseContextWindowK,
  resolveContextWindow,
} from '../../utils/contextWindow';

const THUMB_SIZE = 16;
const TRACK_HEIGHT = 4;
const TOUCH_HEIGHT = 36;

export interface ContextWindowSliderProps {
  /** 当前窗口（tokens）。 */
  value: number;
  onChange: (value: number) => void;
  /** 无障碍名称（调用方传本地化文案）。 */
  label: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * 上下文窗口滑块：轨道（PanResponder，点/拖吸附常见挡位）+ 右侧 K 输入框。
 *
 * 不引第三方滑块依赖，也不用 react-native-gesture-handler 的 GestureDetector
 * ——本仓库 iOS 26 真机上有后者失效的既有记录（见 TerminalVoiceFab 注释）。
 *
 * 交互契约：
 *  · 点按/拖动轨道 → 吸附到最近挡位；
 *  · 输入框以 K 为单位，失焦/回车提交；非法输入恢复原值，越界按 clamp 收敛；
 *  · 无障碍：adjustable role + increment/decrement 按挡位步进。
 */
export const ContextWindowSlider: React.FC<ContextWindowSliderProps> = ({
  value,
  onChange,
  label,
  disabled = false,
  testID,
}) => {
  const { theme, isDark } = useTheme();
  const [draft, setDraft] = useState(String(contextWindowKValue(value)));
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  // 正在输入时外部值更新不打扰用户；用 ref 而不是 state，避免失焦提交后
  // 「editing 变 false」本身触发一次同步、把刚提交的草稿覆盖回旧 prop。
  const editingRef = useRef(false);
  // onChange 每次渲染可能是新箭头函数；PanResponder 只创建一次，用 ref 取最新。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 外部值变化（Me 默认加载完成 / 另一张卡片保存）→ 同步输入框。
  useEffect(() => {
    if (!editingRef.current) setDraft(String(contextWindowKValue(value)));
  }, [value]);

  // 只读 ref（value/onChange），deps 为空——PanResponder 因此在手势中途不会重建。
  const emit = useCallback((next: number) => {
    if (next === valueRef.current) return;
    valueRef.current = next;
    onChangeRef.current(next);
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: event => {
          const width = widthRef.current;
          if (width > 0) {
            emit(contextWindowAtFraction(event.nativeEvent.locationX / width));
          }
        },
        onPanResponderMove: event => {
          const width = widthRef.current;
          if (width > 0) {
            emit(contextWindowAtFraction(event.nativeEvent.locationX / width));
          }
        },
      }),
    [disabled, emit],
  );

  const tokens = resolveContextWindow(value);
  const fraction = contextWindowFraction(tokens);
  const idleBorder = isDark ? 'rgba(255,255,255,0.10)' : theme.colors.outlineVariant;
  const trackBg = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';

  const commitDraft = () => {
    const parsed = parseContextWindowK(draft);
    if (parsed === undefined) {
      setDraft(String(contextWindowKValue(valueRef.current)));
      return;
    }
    setDraft(String(contextWindowKValue(parsed)));
    emit(parsed);
  };

  const onAccessibilityAction = (event: {
    nativeEvent: { actionName: string };
  }) => {
    const action = event.nativeEvent.actionName;
    if (action === 'increment') emit(nextContextWindowStop(valueRef.current, 1));
    else if (action === 'decrement') emit(nextContextWindowStop(valueRef.current, -1));
  };

  return (
    <View style={[styles.row, disabled ? styles.disabled : null]}>
      <View
        testID={testID}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: CONTEXT_WINDOW_STOPS[0] / 1000,
          max: CONTEXT_WINDOW_STOPS[CONTEXT_WINDOW_STOPS.length - 1] / 1000,
          now: contextWindowKValue(tokens),
          text: formatContextWindow(tokens),
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={event => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        style={styles.trackTouch}
        {...responder.panHandlers}>
        <View
          pointerEvents="none"
          style={[
            styles.track,
            { backgroundColor: trackBg, borderRadius: TRACK_HEIGHT / 2 },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.fill,
            {
              width: `${fraction * 100}%`,
              backgroundColor: theme.colors.primary,
              borderRadius: TRACK_HEIGHT / 2,
            },
          ]}
        />
        {CONTEXT_WINDOW_STOPS.map(stop => (
          <View
            key={stop}
            pointerEvents="none"
            style={[
              styles.tick,
              {
                left: `${contextWindowFraction(stop) * 100}%`,
                backgroundColor: theme.colors.onSurfaceVariant,
              },
            ]}
          />
        ))}
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: `${fraction * 100}%`,
              backgroundColor: theme.colors.primary,
              borderColor: isDark ? '#0B0F14' : '#FFFFFF',
            },
          ]}
        />
      </View>

      <View
        style={[
          styles.inputBox,
          {
            borderColor: idleBorder,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : theme.colors.surfaceContainerLow,
            borderRadius: theme.borderRadius.md,
          },
        ]}>
        <TextInput
          testID={testID ? `${testID}-input` : undefined}
          value={draft}
          editable={!disabled}
          keyboardType="number-pad"
          maxLength={4}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            editingRef.current = false;
            commitDraft();
          }}
          onSubmitEditing={() => {
            editingRef.current = false;
            commitDraft();
          }}
          onChangeText={setDraft}
          accessibilityLabel={label}
          style={[
            theme.typography.codeSm,
            styles.input,
            { color: theme.colors.onSurface },
          ]}
        />
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
          ]}>
          K
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  disabled: {
    opacity: 0.4,
  },
  trackTouch: {
    flex: 1,
    height: TOUCH_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (TOUCH_HEIGHT - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: (TOUCH_HEIGHT - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
  },
  tick: {
    position: 'absolute',
    top: (TOUCH_HEIGHT - 8) / 2,
    width: 1,
    height: 8,
    marginLeft: -0.5,
    opacity: 0.6,
  },
  thumb: {
    position: 'absolute',
    top: (TOUCH_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    marginLeft: -THUMB_SIZE / 2,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 36,
    minWidth: 72,
    borderWidth: 1,
    paddingHorizontal: 9,
  },
  input: {
    flexShrink: 1,
    minWidth: 32,
    padding: 0,
    textAlign: 'right',
  },
});
