import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

interface RingMeterProps {
  progress: number;
  label: string;
  value: string;
  color?: string;
  size?: number;
}

export const RingMeter: React.FC<RingMeterProps> = ({
  progress,
  label,
  value,
  color,
  size = 78,
}) => {
  const { theme, isDark } = useTheme();
  const stroke = color ?? theme.colors.primary;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalized = Math.max(0, Math.min(100, progress));
  const dashOffset = circumference - (circumference * normalized) / 100;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={isDark ? 'rgba(255,255,255,0.09)' : theme.colors.outlineVariant}
          strokeWidth={6}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[theme.typography.codeSm, styles.value, { color: theme.colors.onSurface }]}>
          {value}
        </Text>
        <Text style={[theme.typography.labelCaps, styles.label, { color: theme.colors.onSurfaceVariant }]}>
          {label}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    fontSize: 8,
    marginTop: 1,
  },
});
