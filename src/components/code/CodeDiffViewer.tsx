import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { DiffLine } from '../../data/platformModels';

interface CodeDiffViewerProps {
  lines: DiffLine[];
  showLineNumbers?: boolean;
}

export const CodeDiffViewer: React.FC<CodeDiffViewerProps> = ({
  lines,
  showLineNumbers = true,
}) => {
  const { theme, isDark } = useTheme();

  const getLineStyle = (type: DiffLine['type']) => {
    if (isDark) {
      switch (type) {
        case 'add':
          return {
            backgroundColor: 'rgba(86, 156, 214, 0.12)',
            borderLeftColor: '#569CD6',
          };
        case 'remove':
          return {
            backgroundColor: 'rgba(244, 135, 113, 0.12)',
            borderLeftColor: '#F48771',
          };
        default:
          return {
            backgroundColor: 'transparent',
            borderLeftColor: 'transparent',
          };
      }
    }
    switch (type) {
      case 'add':
        return {
          backgroundColor: 'rgba(0, 81, 174, 0.06)',
          borderLeftColor: '#0051AE',
        };
      case 'remove':
        return {
          backgroundColor: 'rgba(186, 26, 26, 0.06)',
          borderLeftColor: '#BA1A1A',
        };
      default:
        return {
          backgroundColor: 'transparent',
          borderLeftColor: 'transparent',
        };
    }
  };

  const getTextColor = (type: DiffLine['type']) => {
    if (isDark) {
      switch (type) {
        case 'add':
          return '#7FFF7F';
        case 'remove':
          return '#FF9999';
        default:
          return '#BBC9CF';
      }
    }
    switch (type) {
      case 'add':
        return '#0051AE';
      case 'remove':
        return '#BA1A1A';
      default:
        return '#424753';
    }
  };

  const getPrefix = (type: DiffLine['type']) => {
    switch (type) {
      case 'add':
        return '+';
      case 'remove':
        return '-';
      default:
        return ' ';
    }
  };

  let lineNum = 0;

  return (
    <ScrollView
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#000000' : '#1e1e2e',
          borderRadius: theme.borderRadius.md,
        },
      ]}
      contentContainerStyle={styles.content}>
      {lines.map((line, index) => {
        if (line.type !== 'remove') lineNum++;
        const lineStyle = getLineStyle(line.type);
        return (
          <View
            key={index}
            style={[
              styles.line,
              lineStyle,
            ]}>
            {showLineNumbers && (
              <Text
                style={[
                  theme.typography.codeSm,
                  styles.lineNumber,
                  { color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.3)' },
                ]}>
                {line.type === 'remove' ? '' : lineNum}
              </Text>
            )}
            <Text
              style={[
                theme.typography.codeSm,
                {
                  color: getTextColor(line.type),
                },
              ]}>
              {getPrefix(line.type)} {line.content}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  content: {
    paddingVertical: 4,
  },
  line: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderLeftWidth: 2,
  },
  lineNumber: {
    width: 32,
    textAlign: 'right',
    marginRight: 8,
    fontSize: 11,
  },
});
