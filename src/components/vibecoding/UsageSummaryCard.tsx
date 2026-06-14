import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { RingMeter } from '../visual/RingMeter';

interface UsageMetric {
  label: string;
  value: string;
  progress: number;
  tone?: 'primary' | 'secondary';
}

export interface PlatformUsageSummary {
  title: string;
  headline: string;
  statusLabel: string;
  primaryMetric: UsageMetric;
  secondaryMetric: UsageMetric;
  sideMetric: {
    label: string;
    value: string;
  };
  meters: UsageMetric[];
}

interface UsageSummaryCardProps {
  summary: PlatformUsageSummary;
}

export const UsageSummaryCard: React.FC<UsageSummaryCardProps> = ({
  summary,
}) => {
  const { theme, isDark } = useTheme();
  const metricColor = (metric: UsageMetric) =>
    metric.tone === 'secondary' ? theme.colors.secondary : theme.colors.primary;

  return (
    <GlassPanel glowColor="primary" style={styles.card}>
      <View style={styles.header}>
        <IconBadge name="quota" tone="secondary" size={48} iconSize={24} filled />
        <View style={styles.titleBlock}>
          <Text
            style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            {summary.title.toUpperCase()}
          </Text>
          <Text
            style={[
              theme.typography.titleLg,
              { color: theme.colors.onSurface },
              styles.balance,
            ]}>
            {summary.headline}
          </Text>
        </View>
        <StatusChip label={summary.statusLabel} type="info" />
      </View>
      <View style={styles.ringRow}>
        <RingMeter
          progress={summary.primaryMetric.progress}
          label={summary.primaryMetric.label}
          value={summary.primaryMetric.value}
          color={metricColor(summary.primaryMetric)}
          size={84}
        />
        <RingMeter
          progress={summary.secondaryMetric.progress}
          label={summary.secondaryMetric.label}
          value={summary.secondaryMetric.value}
          color={metricColor(summary.secondaryMetric)}
          size={84}
        />
        <View
          style={[
            styles.renewBlock,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.05)'
                : theme.colors.surfaceContainer,
            },
          ]}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            {summary.sideMetric.label}
          </Text>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {summary.sideMetric.value}
          </Text>
        </View>
      </View>
      {summary.meters.map(metric => (
        <View key={metric.label} style={styles.meter}>
          <View style={styles.meterLabel}>
            <Text
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {metric.label}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {metric.value}
            </Text>
          </View>
          <ProgressBar
            progress={metric.progress}
            color={metricColor(metric)}
          />
        </View>
      ))}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  balance: {
    marginTop: 4,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  renewBlock: {
    flex: 1,
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    gap: 4,
  },
  meter: {
    gap: 6,
  },
  meterLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
