import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { LogEntry } from '../../data/platformModels';

interface TerminalLogProps {
  logs: LogEntry[];
}

const levelColors: Record<string, string> = {
  info: '#00D1FF',
  warn: '#FEB127',
  error: '#FF6B6B',
  success: '#2FF801',
};

const levelColorsLight: Record<string, string> = {
  info: '#0051AE',
  warn: '#B8860B',
  error: '#BA1A1A',
  success: '#0969DA',
};

export const TerminalLog: React.FC<TerminalLogProps> = ({ logs }) => {
  const { theme, isDark } = useTheme();
  const [expanded, setExpanded] = useState(true);

  return (
    <GlassPanel style={styles.container}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        style={styles.header}>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
          ]}>
          TERMINAL LOG
        </Text>
        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
          {expanded ? '[-]' : '[+]'}
        </Text>
      </TouchableOpacity>
      {expanded && (
        <ScrollView style={styles.logList}>
          {logs.map((log, index) => (
            <View key={index} style={styles.logRow}>
              <Text
                style={[
                  theme.typography.codeSm,
                  {
                    color: isDark
                      ? levelColors[log.level]
                      : levelColorsLight[log.level],
                  },
                  styles.level,
                ]}>
                [{log.level.toUpperCase()}]
              </Text>
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)' },
                  styles.time,
                ]}>
                {log.timestamp}
              </Text>
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                  styles.message,
                ]}>
                {log.message}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logList: {
    maxHeight: 150,
  },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 2,
    gap: 6,
  },
  level: {
    fontSize: 10,
    fontWeight: '700',
  },
  time: {
    fontSize: 10,
  },
  message: {
    flex: 1,
    fontSize: 11,
  },
});
