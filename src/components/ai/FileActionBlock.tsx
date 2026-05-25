import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { FileAction } from '../../data/mockData';

interface FileActionBlockProps {
  actions: FileAction[];
}

const actionIcons: Record<string, string> = {
  create: '+',
  modify: '~',
  delete: '-',
};

const actionColors: Record<string, string> = {
  create: '#2FF801',
  modify: '#00D1FF',
  delete: '#FF6B6B',
};

export const FileActionBlock: React.FC<FileActionBlockProps> = ({
  actions,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <GlassPanel style={styles.container}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
          styles.title,
        ]}>
        FILE CHANGES
      </Text>
      {actions.map((action, index) => (
        <View key={index} style={styles.actionRow}>
          <Text
            style={[
              theme.typography.codeSm,
              {
                color: isDark
                  ? actionColors[action.type]
                  : action.type === 'create'
                  ? '#0969DA'
                  : action.type === 'modify'
                  ? '#0051AE'
                  : '#BA1A1A',
              },
              styles.icon,
            ]}>
            {actionIcons[action.type]}
          </Text>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.onSurface },
              styles.path,
            ]}
            numberOfLines={1}>
            {action.path}
          </Text>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {action.lines}L
          </Text>
        </View>
      ))}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
    marginTop: 4,
  },
  title: {
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  icon: {
    width: 16,
    fontWeight: '700',
  },
  path: {
    flex: 1,
  },
});
