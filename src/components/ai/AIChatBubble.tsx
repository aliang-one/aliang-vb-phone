import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ChatMessage } from '../../data/mockData';

interface AIChatBubbleProps {
  message: ChatMessage;
}

export const AIChatBubble: React.FC<AIChatBubbleProps> = ({ message }) => {
  const { theme, isDark } = useTheme();
  const isUser = message.role === 'user';

  return (
    <View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
      ]}>
      {!isUser && (
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: isDark
                ? 'rgba(0, 209, 255, 0.15)'
                : 'rgba(0, 81, 174, 0.1)',
              borderRadius: theme.borderRadius.sm,
            },
          ]}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
            AI
          </Text>
        </View>
      )}
      <GlassPanel
        style={[
          styles.bubble,
          {
            borderLeftWidth: isUser ? 0 : 3,
            borderLeftColor: theme.colors.primary,
          },
        ]}>
        <Text
          style={[
            theme.typography.bodyMd,
            { color: theme.colors.onSurface },
          ]}>
          {message.content}
        </Text>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
            styles.timestamp,
          ]}>
          {message.timestamp}
        </Text>
      </GlassPanel>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  bubble: {
    padding: 12,
    maxWidth: '85%',
  },
  timestamp: {
    marginTop: 6,
    opacity: 0.7,
  },
});
