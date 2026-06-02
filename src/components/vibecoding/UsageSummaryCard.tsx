import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { UserPlan } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';

interface UsageSummaryCardProps {
  plan: UserPlan;
}

export const UsageSummaryCard: React.FC<UsageSummaryCardProps> = ({
  plan,
}) => {
  const { theme } = useTheme();
  const balanceRemaining = plan.balanceLimit - plan.balanceUsed;
  const timeRemaining = plan.timeLimitHours - plan.timeUsedHours;

  return (
    <GlassPanel glowColor="primary" style={styles.card}>
      <View style={styles.header}>
        <View>
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
      <Text
        style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        Renews {plan.renewsAt}
      </Text>
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
    justifyContent: 'space-between',
    gap: 12,
  },
  balance: {
    marginTop: 4,
  },
  meter: {
    gap: 6,
  },
  meterLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
