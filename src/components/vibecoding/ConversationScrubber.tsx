import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import {
  markPositionForStop,
  pickStopAtFraction,
  railFractionAt,
  railHeightFor,
  railMarkVisual,
  type RailGeometry,
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
  /**
   * For each collapsedMark, the index of its stop in `stops` — marks are a
   * ≤16-point sample of the stop list, so mark k generally stands for stop
   * index ≠ k. Passing this keeps the fisheye bulge centered on the same stop
   * the loupe titles; without it the bulge falls back to raw fraction mapping.
   */
  markStopIndices?: number[];
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
// Loupe entrance/exit: pop in (fade + slight scale-up), shrink back on release.
// The bubble stays mounted through the fade so the exit never snaps.
const LOUPE_HIDDEN_SCALE = 0.94;
const LOUPE_SHOW_MS = 130;
const LOUPE_HIDE_MS = 130;
const LOUPE_UNMOUNT_MS = 170;
// The rail's height is EXPLICIT (railHeightFor), never content-driven: marks
// render absolutely (out of flow) in BOTH states — idle silhouette and fisheye
// — so the pill cannot collapse when marks leave the flow, and idle/slide
// share one geometry (the drag fraction's denominator). Height scales with the
// mark count so the pitch stays compact — the fisheye wave needs close marks.
const RAIL_TOUCH_WIDTH = 48;

/**
 * Right-edge conversation locator — a dense minimap pill by default, with a
 * magnifier that appears ONLY while sliding.
 *
 * Idle: the compact silhouette pill (≤20 sampled, role-tinted marks, the
 * active one taller). It looks exactly like the always-there locator — we do
 * not touch its appearance at rest.
 *
 * Press: the whole gesture reads as one continuous motion from the first frame
 * — marks redistribute to even slots, the fisheye bulges at the pressed stop,
 * and the loupe pops in showing the prompt there. Dragging glides the bulge
 * (continuous) while the title snaps per stop (discrete reads better than a
 * blur of half-titles). Release commits — the chat scrolls to that message —
 * and the bubble shrinks away ("停下→进入"). A bare tap is just press+release:
 * preview then jump.
 *
 * No full-screen backdrop, no expand: the conversation stays visible.
 */
export const ConversationScrubber: React.FC<ConversationScrubberProps> = ({
  collapsedMarks,
  markStopIndices,
  stops,
  activeStopId,
  onCommit,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const viewportH = Dimensions.get('window').height;

  const railRef = useRef<View>(null);
  // Rail geometry in screen coords (for mapping finger moveY → fraction).
  // pageYMeasured gates decoding: until the first measure() callback lands,
  // pageY is a stale 0 and every fraction would clamp to 1 — pinning the
  // loupe/commit to the newest stop no matter where the finger is. height is
  // mirrored here so move handlers stay synchronous.
  const railGeom = useRef<RailGeometry>({
    pageY: 0,
    height: 0,
    pageYMeasured: false,
  });

  // Loupe position follows the finger; opacity + scale give the bubble a soft
  // pop-in / shrink-out instead of a snap.
  const loupeY = useSharedValue(0);
  const loupeOpacity = useSharedValue(0);
  const loupeScale = useSharedValue(LOUPE_HIDDEN_SCALE);
  const loupeStyle = useAnimatedStyle(() => ({
    opacity: loupeOpacity.value,
    transform: [{ translateY: loupeY.value }, { scale: loupeScale.value }],
  }));

  // Finger-down state (press OR drag). dragStopId holds the stop under the
  // finger (drives loupe content + fisheye focus); it updates on stop
  // boundaries, not every pixel — so heavy text re-renders stay infrequent
  // while the position stays frame-perfect via the shared value.
  const [loupeShown, setLoupeShown] = useState(false);
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
  const engagedRef = useRef(false);
  engagedRef.current = loupeShown;
  // Keeps the bubble mounted through its fade-out; a fresh press cancels it.
  const loupeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (loupeHideTimer.current) clearTimeout(loupeHideTimer.current);
    },
    [],
  );

  const setDrag = (id: string | undefined) => {
    dragStopIdRef.current = id;
    setDragStopId(id);
  };

  // Apply fresh on-screen geometry from measure(). `force` marks gesture-time
  // measures (grant), which must always land — they carry the freshest finger
  // coordinates and self-heal an earlier poisoned decode. Layout/mount-driven
  // measures are skipped mid-gesture so a queued callback can never shift the
  // mapping under the finger.
  const applyRailMeasure = useCallback((force: boolean) => {
    railRef.current?.measure((_x, _y, _w, height, _pageX, pageY) => {
      if (!force && engagedRef.current) return;
      railGeom.current = { pageY, height, pageYMeasured: true };
    });
  }, []);

  // Prime the geometry as soon as the rail exists so the FIRST gesture never
  // decodes against the un-measured {pageY:0} state. Grant still re-measures
  // for the current gesture.
  const hasRail = collapsedMarks.length > 0;
  useEffect(() => {
    if (hasRail) applyRailMeasure(false);
  }, [applyRailMeasure, hasRail]);

  const fractionFromMoveY = (moveY: number) =>
    railFractionAt(moveY, railGeom.current);

  // Center the box on the finger vertically, clamped so it stays on screen.
  const loupeTopFor = (fingerPageY: number) => {
    const centered = fingerPageY - LOUPE_HEIGHT / 2;
    const maxTop = Math.max(
      LOUPE_TOP_PAD,
      viewportH - LOUPE_HEIGHT - LOUPE_BOTTOM_PAD,
    );
    return Math.min(Math.max(centered, LOUPE_TOP_PAD), maxTop);
  };

  // Pop the loupe in at the finger (shared by press and slide). Cancels any
  // pending hide so a quick re-press during the fade-out keeps the bubble up.
  const showLoupe = (fingerPageY: number) => {
    if (loupeHideTimer.current) {
      clearTimeout(loupeHideTimer.current);
      loupeHideTimer.current = null;
    }
    loupeY.value = loupeTopFor(fingerPageY);
    loupeScale.value = LOUPE_HIDDEN_SCALE;
    loupeScale.value = withTiming(1, { duration: LOUPE_SHOW_MS });
    loupeOpacity.value = withTiming(1, { duration: LOUPE_SHOW_MS });
    setLoupeShown(true);
  };

  // Soften the exit: fade + shrink, and only unmount after the animation ends
  // — releasing snaps the chat to the target while the bubble fades over it.
  const endSlide = () => {
    loupeOpacity.value = withTiming(0, { duration: LOUPE_HIDE_MS });
    loupeScale.value = withTiming(LOUPE_HIDDEN_SCALE, {
      duration: LOUPE_HIDE_MS,
    });
    setDrag(undefined);
    if (loupeHideTimer.current) clearTimeout(loupeHideTimer.current);
    loupeHideTimer.current = setTimeout(
      () => setLoupeShown(false),
      LOUPE_UNMOUNT_MS,
    );
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
        // Capture geometry up front. This gesture-time measure always applies
        // (force) — it carries the freshest finger coordinates and self-heals
        // any earlier poisoned decode.
        railRef.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
          railGeom.current = { pageY, height: h, pageYMeasured: true };
          const fraction = fractionFromMoveY(gesture.moveY);
          if (fraction === null) return;
          setDragFraction(fraction);
          // Prime the initial focus so a tap-without-move still commits the
          // right spot. One coordinated entrance ON PRESS: the fisheye
          // focuses the pressed stop and the loupe pops in — slide and tap
          // read as a single continuous gesture from the first frame.
          const stop = pickStopAtFraction(stopsRef.current, fraction);
          setDrag(stop?.id);
          showLoupe(gesture.moveY);
        });
      },
      onPanResponderMove: (_evt, gesture) => {
        loupeY.value = loupeTopFor(gesture.moveY);
        const fraction = fractionFromMoveY(gesture.moveY);
        // Geometry not measured yet: decoding would clamp to 1 and pin the
        // loupe/commit to the newest stop. Skip until measure lands (the
        // grant callback or the mount/onLayout prime fills it in).
        if (fraction === null) return;
        setDragFraction(fraction); // smooth bulge follows the finger
        const stop = pickStopAtFraction(stopsRef.current, fraction);
        if (stop?.id !== dragStopIdRef.current) {
          setDrag(stop?.id);
        }
      },
      onPanResponderRelease: (_evt, gesture) => {
        // A tap (no slide) commits the primed spot; a slide commits the last.
        // With no measured geometry (and nothing primed) there is no honest
        // position to commit — skip rather than jump to the wrong stop.
        const fraction = fractionFromMoveY(gesture.moveY);
        const id =
          dragStopIdRef.current ??
          (fraction === null
            ? undefined
            : pickStopAtFraction(stopsRef.current, fraction)?.id);
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
  // bulge, by contrast, GLIDES: it interpolates the exact fractional stop
  // position through the mark↔stop mapping (marks sample the stop list, so
  // raw drag fraction would drift ±1 once the list exceeds the sample size).
  // Gated on loupeShown so a bare press already bulges at the pressed mark.
  const focusStopId = dragStopId ?? activeStopId;
  const focusStopIndex = focusStopId
    ? stops.findIndex(stop => stop.id === focusStopId)
    : -1;
  const focusStop = focusStopIndex >= 0 ? stops[focusStopIndex] : undefined;
  const continuousStopPos = dragFraction * Math.max(0, stops.length - 1);
  const focusMarkPos = !loupeShown
    ? 0
    : markStopIndices && markStopIndices.length === collapsedMarks.length
      ? markPositionForStop(markStopIndices, continuousStopPos)
      : dragFraction * (collapsedMarks.length - 1);

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View
        ref={railRef}
        testID="scrubber-rail"
        // The pill is only 16px wide — hitSlop pads the touch zone (~48px wide,
        // extra head/foot room) so near-misses still land on the rail. Visuals
        // unchanged; fraction mapping clamps out-of-band presses to the ends.
        hitSlop={{ top: 24, bottom: 36, left: 20, right: 12 }}
        style={[
          styles.rail,
          {
            height: railHeightFor(collapsedMarks.length),
            backgroundColor: isDark
              ? 'rgba(17, 20, 23, 0.7)'
              : 'rgba(255, 255, 255, 0.78)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : theme.colors.outlineVariant,
          },
        ]}
        onLayout={({ nativeEvent }) => {
          railGeom.current = {
            ...railGeom.current,
            height: nativeEvent.layout.height,
          };
          // Height changed → re-measure so pageY/height stay truthful for the
          // next gesture. Skipped mid-gesture by applyRailMeasure, so a queued
          // callback can't shift the mapping under the finger.
          applyRailMeasure(false);
        }}
        {...panResponder.panHandlers}
      >
        {collapsedMarks.map((mark, index) => {
          // One layout for both states (see railMarkVisual): marks always pin
          // to an even fraction of the explicit rail height, center-anchored
          // so the fisheye bulge protrudes symmetrically (rail overflow is
          // visible). Idle = compact silhouette; finger down = fisheye.
          const visual = railMarkVisual(
            index,
            collapsedMarks.length,
            focusMarkPos,
            loupeShown,
            mark.active,
            mark.visible,
          );
          return (
            <View
              key={mark.id}
              style={[
                styles.mark,
                styles.markAbsolute,
                {
                  top: `${visual.topPct}%`,
                  height: visual.height,
                  width: visual.width,
                  marginLeft: -visual.width / 2,
                  marginTop: -visual.height / 2,
                  backgroundColor: roleColor(mark.role),
                  opacity: visual.opacity,
                },
              ]}
            />
          );
        })}
      </View>

      {loupeShown && (
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
                    ? t('scrubber.roleYou')
                    : focusStop.role === 'assistant'
                      ? t('scrubber.roleAssistant')
                      : t('scrubber.roleSystem')}
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
                {focusStop.preview || t('scrubber.noPreview')}
              </Text>
            </>
          ) : (
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('scrubber.hint')}
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
    // Height comes from railHeightFor(collapsedMarks.length), applied inline:
    // explicit (marks are absolute in both states — content can never size the
    // pill) yet count-derived so short conversations keep a compact pill.
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    // Visible so the bulging (center-anchored) marks can protrude past the pill
    // edges while engaged — the "located position pops out" effect.
    overflow: 'visible',
  },
  mark: {
    borderRadius: 999,
  },
  markAbsolute: {
    position: 'absolute',
    left: '50%',
  },
  // The rounded-rect preview box. Caret pokes out the right toward the rail, so
  // keep overflow visible (else it's cropped on Android).
  loupe: {
    position: 'absolute',
    right: 38,
    top: 0,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 4,
    overflow: 'visible',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
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
