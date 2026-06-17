import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

interface GridBackgroundProps {
  spacing?: number;
}

export const GridBackground: React.FC<GridBackgroundProps> = ({
  spacing = 30,
}) => {
  const { isDark } = useTheme();
  const strokeColor = isDark ? 'rgba(86, 156, 214, 0.06)' : 'rgba(0, 81, 174, 0.04)';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        {Array.from({ length: Math.ceil(900 / spacing) }).map((_, i) => (
          <Line
            key={`v${i}`}
            x1={i * spacing}
            y1={0}
            x2={i * spacing}
            y2={900}
            stroke={strokeColor}
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: Math.ceil(900 / spacing) }).map((_, i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={i * spacing}
            x2={900}
            y2={i * spacing}
            stroke={strokeColor}
            strokeWidth={0.5}
          />
        ))}
      </Svg>
    </View>
  );
};
