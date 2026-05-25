import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';

interface AIReasoningBlockProps {
  reasoning: string;
}

export const AIReasoningBlock: React.FC<AIReasoningBlockProps> = ({
  reasoning,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
      <GlassPanel style={styles.container}>
        <View style={styles.header}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.tertiary },
            ]}>
            REASONING
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {expanded ? '[-]' : '[+]'}
          </Text>
        </View>
        {expanded && (
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
              styles.content,
            ]}>
            {reasoning}
          </Text>
        )}
      </GlassPanel>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#FEB127',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    marginTop: 8,
    lineHeight: 18,
  },
});
