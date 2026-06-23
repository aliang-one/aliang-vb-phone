import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  PanResponder,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/useTheme';
import {
  pickStopAtFraction,
  tickScale,
  type ScrubberStop,
} from '../../utils/conversationScrubber';

/**
 * A mark on the right-edge minimap pill — one sampled conversation message,
 * role-tinted so the pill reads as a conversation silhouette.
 */
export interface ScrubberCollapsedMark {
  id: string;
  role: 'user' | 'assistant' | 'system';
  active: boolean;
  visible: boolean;
}

interface ConversationScrubberProps {
  collapsedMarks: ScrubberCollapsedMark[];
  stops: ScrubberStop[];
  /** Idle focus: the user-turn nearest the viewport's center message. */
  activeStopId?: string;
  /** Fired on release (drag or tap) with the stop under the finger. */
  onCommit: (stopId: string) => void;
}

// Loupe = the rounded-rect "text message" box (role + timestamp + preview) that
// floats beside the rail. Width/height drive only the on-screen clamp.
const LOUPE_WIDTH = 238;
const LOUPE_HEIGHT = 104;
const LOUPE_TOP_PAD = 96; // keep the box below the nav/header
const LOUPE_BOTTOM_PAD = 168; // keep it clear of the input panel
// During a slide: (1) the pill elongates by RAIL_GROW so the bulge has room and
// the capsule visibly "opens up"; (2) marks within FISHEYE_RADIUS of the focus
// MAGNIFY in BOTH height and width and brighten — center-anchored so the
// located position protrudes symmetrically out of the pill. Marks go absolute
// while sliding so growing one never reflows the others; the pill keeps
// overflow visible so the bulge can spill past its edges. At rest the pill is
// the dense flex column, untouched.
const RAIL_GROW = 30;
const FISHEYE_RADIUS = 2.6;
const FISHEYE_BASE_HEIGHT = 6;
const FISHEYE_PEAK_HEIGHT = 28;
const FISHEYE_BASE_WIDTH = 4;
const FISHEYE_PEAK_WIDTH = 9;
const RAIL_TOUCH_WIDTH = 48;

/**
 * Right-edge conversation locator — a dense minimap pill by default, with a
 * magnifier that appears ONLY while sliding.
 *
 * Idle: the original compact silhouette pill (≤16 sampled, role-tinted marks,
 * the active one taller). It looks exactly like the always-there locator — we
 * do not touch its appearance at rest.
 *
 * Slide: press and drag the pill. On the first move a loupe bubble fades in
 * beside the finger, following it on the UI thread (reanimated shared value),
 * showing the user prompt at that position; the marks near the finger brighten
 * (spotlight). Release commits — the chat scrolls to that message — and the
 * magnifier vanishes ("停下→进入"). A bare tap (no slide) just jumps, no loupe.
 *
 * No full-screen backdrop, no expand: the conversation stays visible.
 */
export const ConversationScrubber: React.FC<ConversationScrubberProps> = ({
  collapsedMarks,
  stops,
  activeStopId,
  onCommit,
}) => {
  const { theme, isDark } = useTheme();
  const viewportH = Dimensions.get('window').height;

  const railRef = useRef<View>(null);
  // pageY + height of the pill in screen coords (for mapping finger moveY →
  // fraction). height is mirrored here so move handlers stay synchronous.
  const railGeom = useRef({ pageY: 0, height: 0 });

  // Loupe position follows the finger on the UI thread; opacity fades it in.
  const loupeY = useSharedValue(0);
  const loupeOpacity = useSharedValue(0);
  const loupeStyle = useAnimatedStyle(() => ({
    opacity: loupeOpacity.value,
    transform: [{ translateY: loupeY.value }],
  }));

  // Loupe + spotlight mount only while sliding. dragStopId holds the stop under
  // the finger (drives loupe content + spotlight focus); it updates on stop
  // boundaries, not every pixel — so heavy text re-renders stay infrequent while
  // the position stays frame-perfect via the shared value.
  const [sliding, setSliding] = useState(false);
  const [dragStopId, setDragStopId] = useState<string | undefined>(undefined);
  // Continuous (per-pixel) drag position as a 0..1 fraction — drives the bulge so
  // it glides smoothly with the finger. The loupe text still snaps per-stop
  // (dragStopId) so the heavier preview re-renders stay infrequent.
  const [dragFraction, setDragFraction] = useState(0);

  // Latest-value refs so the PanResponder (created once) never closes over
  // stale props/state.
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const dragStopIdRef = useRef<string | undefined>(undefined);
  const slidingRef = useRef(false);
  slidingRef.current = sliding;

  const setDrag = (id: string | undefined) => {
    dragStopIdRef.current = id;
    setDragStopId(id);
  };

  const fractionFromMoveY = (moveY: number) => {
    const { pageY, height } = railGeom.current;
    if (height <= 0) return 0;
    return Math.min(1, Math.max(0, (moveY - pageY) / height));
  };

  // Center the box on the finger vertically, clamped so it stays on screen.
  const loupeTopFor = (fingerPageY: number) => {
    const centered = fingerPageY - LOUPE_HEIGHT / 2;
    const maxTop = Math.max(
      LOUPE_TOP_PAD,
      viewportH - LOUPE_HEIGHT - LOUPE_BOTTOM_PAD,
    );
    return Math.min(Math.max(centered, LOUPE_TOP_PAD), maxTop);
  };

  const beginSlide = (moveY: number) => {
    // Elongate the pill a touch (capsule "opens up"). The rail is anchored at a
    // fixed top, so it grows downward; the drag mapping uses this grown height,
    // keeping the finger aligned with the (redistributed) marks from frame one.
    const idleHeight = railGeom.current.height;
    if (idleHeight > 0) {
      railGeom.current = { ...railGeom.current, height: idleHeight + RAIL_GROW };
    }
    loupeY.value = loupeTopFor(moveY);
    loupeOpacity.value = withTiming(1, { duration: 120 });
    setSliding(true);
  };

  const endSlide = () => {
    loupeOpacity.value = 0;
    setSliding(false);
    setDrag(undefined);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: event => {
        const pageX = event.nativeEvent.pageX;
        const screenWidth = Dimensions.get('window').width;
        return pageX >= screenWidth - RAIL_TOUCH_WIDTH;
      },
      onMoveShouldSetPanResponder: (_event, gesture) => {
        const screenWidth = Dimensions.get('window').width;
        return (
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3 &&
          gesture.x0 >= screenWidth - RAIL_TOUCH_WIDTH
        );
      },
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderGrant: (_evt, gesture) => {
        // Capture geometry up front; the loupe itself only appears on first
        // move (a bare tap should just jump, not flash the magnifier).
        railRef.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
          railGeom.current = { pageY, height: h };
          const fraction = fractionFromMoveY(gesture.moveY);
          setDragFraction(fraction);
          // Prime the initial focus so a tap-without-move still commits the
          // right spot.
          const stop = pickStopAtFraction(stopsRef.current, fraction);
          setDrag(stop?.id);
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        if (!slidingRef.current) {
          beginSlide(gesture.moveY);
        } else {
          loupeY.value = loupeTopFor(gesture.moveY);
        }
        const fraction = fractionFromMoveY(gesture.moveY);
        setDragFraction(fraction); // smooth bulge follows the finger
        const stop = pickStopAtFraction(stopsRef.current, fraction);
        if (stop?.id !== dragStopIdRef.current) {
          setDrag(stop?.id);
        }
      },
      onPanResponderRelease: (_evt, gesture) => {
        // A tap (no slide) commits the primed spot; a slide commits the last.
        const id =
          dragStopIdRef.current ??
          pickStopAtFraction(stopsRef.current, fractionFromMoveY(gesture.moveY))
            ?.id;
        endSlide();
        if (id) {
          onCommitRef.current(id);
        }
      },
      onPanResponderTerminate: () => endSlide(),
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  if (!collapsedMarks.length) return null;

  const roleColor = (role: ScrubberStop['role']) =>
    role === 'user'
      ? theme.colors.secondary
      : role === 'assistant'
        ? theme.colors.primary
        : theme.colors.onSurfaceVariant;

  // Loupe text focuses on the stop under the finger (discrete, cheap). The
  // bulge focus is continuous (dragFraction) so it glides with the finger.
  const focusStopId = dragStopId ?? activeStopId;
  const focusStopIndex = focusStopId
    ? stops.findIndex(stop => stop.id === focusStopId)
    : -1;
  const focusStop = focusStopIndex >= 0 ? stops[focusStopIndex] : undefined;
  const focusMarkPos = sliding
    ? dragFraction * (collapsedMarks.length - 1)
    : 0;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View
        ref={railRef}
        style={[
          styles.rail,
          {
            backgroundColor: isDark
              ? 'rgba(17, 20, 23, 0.7)'
              : 'rgba(255, 255, 255, 0.78)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : theme.colors.outlineVariant,
          },
          // While sliding the marks are absolutely positioned (out of flow) and
          // the pill elongates by RAIL_GROW, so pin both height and maxHeight to
          // the grown size — otherwise maxHeight:210 would clamp the growth and
          // the percentage-positioned marks would lose their reference.
          sliding && railGeom.current.height > 0
            ? {
                height: railGeom.current.height,
                maxHeight: railGeom.current.height,
              }
            : null,
        ]}
        onLayout={({ nativeEvent }) => {
          railGeom.current = {
            ...railGeom.current,
            height: nativeEvent.layout.height,
          };
        }}
        {...panResponder.panHandlers}
      >
        {collapsedMarks.map((mark, index) => {
          const role = roleColor(mark.role);
          if (sliding) {
            // Magnifier: marks pin to even fractions (absolute → no reflow) and
            // bulge in BOTH height and width toward the (continuous) focus,
            // brightening as they grow. Each mark is center-anchored on its slot
            // (marginTop/Left = -half) so the bulge protrudes symmetrically — the
            // located position visibly pops out of the pill (rail overflow is
            // visible). This is the "magnifying glass over the rail" effect.
            const topPct =
              collapsedMarks.length > 1
                ? (index / (collapsedMarks.length - 1)) * 100
                : 50;
            const { height, width, opacity } = tickScale(
              Math.abs(index - focusMarkPos),
              {
                radius: FISHEYE_RADIUS,
                baseHeight: FISHEYE_BASE_HEIGHT,
                peakHeight: FISHEYE_PEAK_HEIGHT,
                baseWidth: FISHEYE_BASE_WIDTH,
                peakWidth: FISHEYE_PEAK_WIDTH,
              },
            );
            return (
              <View
                key={mark.id}
                style={[
                  styles.mark,
                  styles.markAbsolute,
                  {
                    top: `${topPct}%`,
                    height,
                    width,
                    marginLeft: -width / 2,
                    marginTop: -height / 2,
                    backgroundColor: role,
                    opacity: Math.max(opacity, 0.4),
                  },
                ]}
              />
            );
          }
          // Idle: the original dense silhouette (active tallest, then visible,
          // then off-screen).
          const idleOpacity = mark.active ? 1 : mark.visible ? 0.66 : 0.28;
          return (
            <View
              key={mark.id}
              style={[
                styles.mark,
                {
                  height: mark.active ? 18 : 8,
                  backgroundColor: role,
                  opacity: idleOpacity,
                },
              ]}
            />
          );
        })}
      </View>

      {sliding && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.loupe,
            {
              width: LOUPE_WIDTH,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
            loupeStyle,
          ]}
        >
          <View
            style={[styles.loupeCaret, { borderLeftColor: theme.colors.surface }]}
          />
          {focusStop ? (
            <>
              <View style={styles.loupeHeader}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: roleColor(focusStop.role) },
                  ]}
                >
                  {focusStop.role === 'user'
                    ? 'YOU'
                    : focusStop.role === 'assistant'
                      ? 'ASSISTANT'
                      : 'SYSTEM'}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {focusStop.timestamp}
                </Text>
              </View>
              <Text
                numberOfLines={5}
                style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
              >
                {focusStop.preview || '（无文本预览）'}
              </Text>
            </>
          ) : (
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              拖动右侧轨道定位到某条对话
            </Text>
          )}
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Paint the pill + loupe above the conversation content. pointerEvents is
    // box-none, so only the pill captures touches — the conversation stays
    // interactive everywhere else.
    elevation: 4,
    zIndex: 4,
  },
  rail: {
    position: 'absolute',
    right: 7,
    top: 172,
    width: 16,
    maxHeight: 210,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 5,
    // Visible so the bulging (center-anchored) marks can protrude past the pill
    // edges during a slide — the "located position pops out" effect.
    overflow: 'visible',
  },
  mark: {
    width: 4,
    borderRadius: 999,
  },
  markAbsolute: {
    position: 'absolute',
    left: '50%',
    marginLeft: -2, // half of width:4 → centers the bar in the pill
  },
  // The rounded-rect preview box. Caret pokes out the right toward the rail, so
  // keep overflow visible (else it's cropped on Android).
  loupe: {
    position: 'absolute',
    right: 38,
    top: 0,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    overflow: 'visible',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  loupeCaret: {
    position: 'absolute',
    right: -6,
    top: '50%',
    marginTop: -6,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 6,
    // borderLeftColor is set inline at render so the caret matches the loupe
    // surface (theme.colors.surface) in both light and dark themes.
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  loupeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
