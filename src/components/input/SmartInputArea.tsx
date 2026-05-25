import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface SmartInputAreaProps {
  onSend: (text: string) => void;
  onVoicePress?: () => void;
}

const quickSnippets = [
  '/fix',
  '/refactor',
  '/test',
  '/deploy',
  '/review',
  '/optimize',
];

const sentenceExplosions = [
  'error handling',
  'add logging',
  'async/await',
  'unit test',
  'type safety',
];

export const SmartInputArea: React.FC<SmartInputAreaProps> = ({
  onSend,
  onVoicePress,
}) => {
  const { theme, isDark } = useTheme();
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(17, 20, 23, 0.95)'
            : 'rgba(247, 249, 255, 0.95)',
          borderTopColor: isDark
            ? 'rgba(255, 255, 255, 0.06)'
            : theme.colors.outlineVariant,
        },
      ]}>
      {/* Quick Snippets */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.snippets}>
        {quickSnippets.map((snippet, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setText(prev => prev + ' ' + snippet)}>
            <View
              style={[
                styles.snippet,
                {
                  backgroundColor: isDark
                    ? 'rgba(0, 209, 255, 0.1)'
                    : 'rgba(0, 81, 174, 0.08)',
                  borderRadius: theme.borderRadius.sm,
                },
              ]}>
              <Text
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.primary, fontSize: 11 },
                ]}>
                {snippet}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sentence Explosions */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.explosions}>
        {sentenceExplosions.map((phrase, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setText(prev => prev + ' ' + phrase)}>
            <View
              style={[
                styles.explosion,
                {
                  backgroundColor: isDark
                    ? 'rgba(255, 255, 255, 0.04)'
                    : theme.colors.surfaceContainer,
                  borderRadius: theme.borderRadius.full,
                  borderColor: isDark
                    ? 'rgba(255, 255, 255, 0.08)'
                    : theme.colors.outlineVariant,
                },
              ]}>
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: theme.colors.onSurfaceVariant, fontSize: 11 },
                ]}>
                {phrase}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Input Row */}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask AI..."
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.codeSm,
            {
              color: theme.colors.onSurface,
              backgroundColor: isDark
                ? 'rgba(255, 255, 255, 0.04)'
                : theme.colors.surfaceContainer,
              borderRadius: theme.borderRadius.md,
              borderColor: isDark
                ? 'rgba(255, 255, 255, 0.08)'
                : theme.colors.outlineVariant,
            },
            styles.input,
          ]}
          multiline
        />
        <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
          <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
            {'>'}
          </Text>
        </TouchableOpacity>
        {onVoicePress && (
          <TouchableOpacity onPress={onVoicePress} style={styles.micBtn}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              MIC
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  snippets: {
    marginBottom: 6,
    maxHeight: 30,
  },
  snippet: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
  },
  explosions: {
    marginBottom: 8,
    maxHeight: 28,
  },
  explosion: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    borderWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 80,
  },
  sendBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
