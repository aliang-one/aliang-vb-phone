import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/useTheme';
import { GlowButton } from '../../components/shared/GlowButton';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { GridBackground } from '../../components/layout/GridBackground';
import { RootStackScreenProps } from '../../app/navigation/types';

export const SplashScreen: React.FC<RootStackScreenProps<'Splash'>> = ({
  navigation,
}) => {
  const { theme, isDark } = useTheme();
  const pulseScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.3);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withTiming(1.15, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    glowOpacity.value = withRepeat(
      withTiming(0.8, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <SafeAreaWrapper>
      {isDark && <GridBackground />}
      <View style={styles.container}>
        {/* Logo Area */}
        <View style={styles.logoArea}>
          <Animated.View style={[styles.iconWrapper, iconStyle]}>
            <Text
              style={[
                theme.typography.displayLg,
                {
                  color: theme.colors.primary,
                  ...(isDark
                    ? {
                        textShadowColor: theme.colors.primary,
                        textShadowRadius: 20,
                      }
                    : {}),
                },
              ]}>
              {'> _'}
            </Text>
          </Animated.View>
          <Animated.View
            style={[
              styles.glowRing,
              glowStyle,
              {
                borderColor: isDark
                  ? `${theme.colors.primary}40`
                  : 'transparent',
              },
            ]}
          />
          <Text
            style={[
              theme.typography.headlineMd,
              { color: theme.colors.onSurface },
              styles.title,
            ]}>
            AI VIBE COMMANDER
          </Text>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
              styles.version,
            ]}>
            v0.1.0 // DEVELOPER TOOLKIT
          </Text>
        </View>

        {/* Status Indicators */}
        <View style={styles.statusArea}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: theme.colors.secondary },
              ]}
            />
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.secondary },
              ]}>
              KERNEL_ACTIVE
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: theme.colors.primary },
              ]}
            />
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.primary },
              ]}>
              UPLINK_STABLE
            </Text>
          </View>
        </View>

        {/* Action Button */}
        <View style={styles.actionArea}>
          <GlowButton
            title="INITIATE_CONNECTION"
            onPress={() => navigation.navigate('Login')}
            variant="primary"
            textStyle={{ fontFamily: 'JetBrains Mono', letterSpacing: 2 }}
          />
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.footerText,
            ]}>
            Secure connection required
          </Text>
        </View>
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logoArea: {
    alignItems: 'center',
    marginTop: 60,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
  },
  glowRing: {
    position: 'absolute',
    top: 10,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  title: {
    marginTop: 24,
  },
  version: {
    marginTop: 8,
  },
  statusArea: {
    gap: 12,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actionArea: {
    alignItems: 'center',
    gap: 12,
  },
  footerText: {
    opacity: 0.6,
  },
});
