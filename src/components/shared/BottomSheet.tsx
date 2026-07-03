import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import { StatusChip } from './StatusChip';
import { useTranslation } from 'react-i18next';

// Slide distance: starts fully below the viewport so the sheet is off-screen
// before its first frame, then translates up to 0.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const OPEN_MS = 300;
const CLOSE_MS = 240;

interface BottomSheetBadge {
  label: string;
  tone: 'neutral' | 'warning' | 'error' | 'success' | 'info';
}

interface BottomSheetProps {
  /** Drives the slide animation; closing animates out before unmount. */
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  badge?: BottomSheetBadge;
  /** Scrollable body. The sheet gives it a flex:1 region. */
  children: React.ReactNode;
}

/**
 * A bottom-anchored sheet that slides up over a dimmed scrim. The body area is
 * flex:1 so callers can drop in a <ScrollView> for scrollable content. Tapping
 * the scrim, the close button, or the hardware back (onRequestClose) dismisses.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  const [mounted, setMounted] = useState(open);

  // Mount as soon as we open (the slide runs on the next frame).
  useEffect(() => {
    if (open && !mounted) {
      setMounted(true);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (open) {
      translateY.value = SCREEN_HEIGHT;
      translateY.value = withTiming(0, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, { duration: OPEN_MS });
      return;
    }
    // Closing: slide back down, then unmount once it's off-screen so the
    // dismiss is animated rather than an abrupt vanish.
    translateY.value = withTiming(SCREEN_HEIGHT, {
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
    });
    backdropOpacity.value = withTiming(0, { duration: CLOSE_MS });
    const timer = setTimeout(() => setMounted(false), CLOSE_MS + 16);
    return () => clearTimeout(timer);
  }, [mounted, open, translateY, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!mounted) {
    return null;
  }

  const scrim = isDark ? 'rgba(2,5,8,0.74)' : 'rgba(12,18,28,0.4)';
  const divider = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[StyleSheet.absoluteFill, backdropStyle, { backgroundColor: scrim }]}
          />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark
                ? theme.colors.surfaceContainerHigh
                : theme.colors.surfaceContainerLowest,
              paddingBottom: insets.bottom + 10,
            },
            sheetStyle,
          ]}>
          <View style={styles.grabberRow}>
            <View
              style={[
                styles.grabber,
                {
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.22)'
                    : 'rgba(0,0,0,0.18)',
                },
              ]}
            />
          </View>
          <View style={[styles.header, { borderBottomColor: divider }]}>
            <View style={styles.headerCopy}>
              {title ? (
                <Text
                  numberOfLines={1}
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {badge ? <StatusChip label={badge.label} type={badge.tone} /> : null}
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('bottomSheet.closeA11yLabel')}>
              <IconBadge name="close" tone="neutral" size={32} iconSize={16} />
            </TouchableOpacity>
          </View>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '84%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  grabberRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  closeButton: {
    padding: 4,
  },
  body: {
    flex: 1,
  },
});
