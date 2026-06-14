import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { TerminalNode } from '../../data/platformModels';

interface TerminalCardProps {
  terminal: TerminalNode;
  onPress?: () => void;
}

const statusMap: Record<string, 'success' | 'error' | 'neutral'> = {
  active: 'success',
  error: 'error',
  idle: 'neutral',
};

export const TerminalCard: React.FC<TerminalCardProps> = ({
  terminal,
  onPress,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <GlassPanel
        glowColor={terminal.status === 'error' ? 'error' : 'none'}
        style={styles.card}>
        <View style={styles.header}>
          <Text
            style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {terminal.name}
          </Text>
          <StatusChip
            label={terminal.status.toUpperCase()}
            type={statusMap[terminal.status]}
          />
        </View>
        <Text
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurfaceVariant },
            styles.host,
          ]}>
          {terminal.host}
        </Text>
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              LATENCY
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: terminal.latency > 50 ? theme.colors.tertiary : theme.colors.secondary },
              ]}>
              {terminal.latency}ms
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              UPTIME
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {terminal.uptime}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              CPU
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                {
                  color:
                    terminal.cpuLoad > 80
                      ? theme.colors.error
                      : theme.colors.onSurface,
                },
              ]}>
              {terminal.cpuLoad}%
            </Text>
          </View>
        </View>
      </GlassPanel>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  host: {
    marginBottom: 8,
  },
  metrics: {
    flexDirection: 'row',
    gap: 16,
  },
  metric: {
    gap: 2,
  },
});
