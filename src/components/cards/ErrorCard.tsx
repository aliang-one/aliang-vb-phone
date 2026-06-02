import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';

interface ErrorCardProps {
  type: 'critical' | 'warning';
  title: string;
  message: string;
  time: string;
  project: string;
  onPress?: () => void;
}

export const ErrorCard: React.FC<ErrorCardProps> = ({
  type,
  title,
  message,
  time,
  project,
  onPress,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <GlassPanel
        glowColor={type === 'critical' ? 'error' : 'none'}
        style={styles.card}>
        <View style={styles.header}>
          <StatusChip
            label={type === 'critical' ? 'CRITICAL' : 'WARNING'}
            type={type === 'critical' ? 'error' : 'warning'}
          />
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {time}
          </Text>
        </View>
        <Text
          style={[
            theme.typography.titleMd,
            { color: theme.colors.onSurface },
            styles.title,
          ]}>
          {title}
        </Text>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.primary },
            styles.project,
          ]}>
          {project}
        </Text>
        <Text
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurfaceVariant },
            styles.message,
          ]}
          numberOfLines={2}>
          {message}
        </Text>
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
    marginBottom: 8,
  },
  title: {
    marginBottom: 4,
  },
  project: {
    marginBottom: 6,
  },
  message: {
    opacity: 0.8,
  },
});
