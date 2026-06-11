import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { UserPlan } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { RingMeter } from '../visual/RingMeter';

interface UsageSummaryCardProps {
  plan: UserPlan;
}

export const UsageSummaryCard: React.FC<UsageSummaryCardProps> = ({
  plan,
}) => {
  const { theme, isDark } = useTheme();
  const balanceRemaining = plan.balanceLimit - plan.balanceUsed;
  const timeRemaining = plan.timeLimitHours - plan.timeUsedHours;

  return (
    <GlassPanel glowColor="primary" style={styles.card}>
      <View style={styles.header}>
        <IconBadge name="quota" tone="secondary" size={48} iconSize={24} filled />
        <View style={styles.titleBlock}>
          <Text
            style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            {plan.planName.toUpperCase()}
          </Text>
          <Text
            style={[
              theme.typography.titleLg,
              { color: theme.colors.onSurface },
              styles.balance,
            ]}>
            ${balanceRemaining.toFixed(2)} remaining
          </Text>
        </View>
        <StatusChip label={`${plan.concurrentUsed}/${plan.concurrentLimit} AGENTS`} type="info" />
      </View>
      <View style={styles.ringRow}>
        <RingMeter
          progress={(plan.balanceUsed / plan.balanceLimit) * 100}
          label="SPEND"
          value={`$${plan.balanceUsed.toFixed(0)}`}
          color={theme.colors.primary}
          size={84}
        />
        <RingMeter
          progress={(plan.timeUsedHours / plan.timeLimitHours) * 100}
          label="TIME"
          value={`${timeRemaining.toFixed(0)}h`}
          color={theme.colors.secondary}
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
            RENEWS
          </Text>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {plan.renewsAt.slice(5)}
          </Text>
        </View>
      </View>
      <View style={styles.meter}>
        <View style={styles.meterLabel}>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            Spend
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
            ${plan.balanceUsed.toFixed(2)} / ${plan.balanceLimit}
          </Text>
        </View>
        <ProgressBar
          progress={(plan.balanceUsed / plan.balanceLimit) * 100}
          color={theme.colors.primary}
        />
      </View>
      <View style={styles.meter}>
        <View style={styles.meterLabel}>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            Runtime
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
            {timeRemaining.toFixed(1)}h left
          </Text>
        </View>
        <ProgressBar
          progress={(plan.timeUsedHours / plan.timeLimitHours) * 100}
          color={theme.colors.secondary}
        />
      </View>
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
