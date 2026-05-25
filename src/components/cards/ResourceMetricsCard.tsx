import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';

interface ResourceMetricsCardProps {
  metrics: {
    label: string;
    value: string | number;
    progress?: number;
    color?: string;
  }[];
}

export const ResourceMetricsCard: React.FC<ResourceMetricsCardProps> = ({
  metrics,
}) => {
  const { theme } = useTheme();

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.grid}>
        {metrics.map((metric, index) => (
          <View key={index} style={styles.metricItem}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {metric.label}
            </Text>
            <Text
              style={[
                theme.typography.headlineMd,
                { color: metric.color || theme.colors.onSurface },
              ]}>
              {metric.value}
            </Text>
            {metric.progress !== undefined && (
              <ProgressBar
                progress={metric.progress}
                color={metric.color || theme.colors.primary}
                height={3}
              />
            )}
          </View>
        ))}
      </View>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metricItem: {
    flex: 1,
    minWidth: '40%',
    gap: 4,
  },
});
