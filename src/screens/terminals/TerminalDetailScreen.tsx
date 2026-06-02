import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { GlowButton } from '../../components/shared/GlowButton';
import { ResourceMetricsCard } from '../../components/cards/ResourceMetricsCard';
import { mockTerminals } from '../../data/mockData';

export const TerminalDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const terminal = mockTerminals[0]; // Show first terminal as demo

  const statusMap: Record<string, 'success' | 'error' | 'neutral'> = {
    active: 'success',
    error: 'error',
    idle: 'neutral',
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={terminal.name}
        subtitle="TERMINAL DETAIL"
        onBack={() => {}}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Status Header */}
        <GlassPanel style={styles.statusHeader}>
          <View style={styles.statusRow}>
            <StatusChip
              label={terminal.status.toUpperCase()}
              type={statusMap[terminal.status]}
            />
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {terminal.host}
            </Text>
          </View>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.group,
            ]}>
            Group: {terminal.group}
          </Text>
        </GlassPanel>

        {/* Resource Metrics */}
        <ResourceMetricsCard
          metrics={[
            {
              label: 'LATENCY',
              value: `${terminal.latency}ms`,
              progress: Math.min(terminal.latency, 100),
              color: terminal.latency > 50 ? theme.colors.tertiary : theme.colors.secondary,
            },
            {
              label: 'UPTIME',
              value: terminal.uptime,
            },
            {
              label: 'CPU LOAD',
              value: `${terminal.cpuLoad}%`,
              progress: terminal.cpuLoad,
              color: terminal.cpuLoad > 80 ? theme.colors.error : theme.colors.primary,
            },
            {
              label: 'MEMORY',
              value: `${terminal.memLoad}%`,
              progress: terminal.memLoad,
              color: terminal.memLoad > 80 ? theme.colors.tertiary : theme.colors.primary,
            },
          ]}
        />

        {/* Processes */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          PROCESSES
        </Text>
        <GlassPanel style={styles.processList}>
          {terminal.processes.length === 0 ? (
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              No active processes
            </Text>
          ) : (
            terminal.processes.map((proc, index) => (
              <View key={index} style={styles.processRow}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                    styles.pid,
                  ]}>
                  {proc.pid}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurface },
                    styles.procName,
                  ]}>
                  {proc.name}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    {
                      color:
                        proc.cpu > 50
                          ? theme.colors.error
                          : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {proc.cpu}%
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {proc.memory}MB
                </Text>
              </View>
            ))
          )}
        </GlassPanel>

        {/* Actions */}
        <View style={styles.actions}>
          <GlowButton title="CONNECT SSH" onPress={() => {}} variant="primary" />
          <GlowButton title="RESTART" onPress={() => {}} variant="secondary" />
          <GlowButton title="VIEW LOGS" onPress={() => {}} variant="outline" />
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statusHeader: {
    padding: 12,
    marginTop: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  group: {
    marginTop: 4,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  processList: {
    padding: 12,
  },
  processRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  pid: {
    width: 40,
  },
  procName: {
    flex: 1,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
});
