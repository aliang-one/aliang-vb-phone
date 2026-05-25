import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { StatusBar } from '../../components/code/StatusBar';
import { CodeDiffViewer } from '../../components/code/CodeDiffViewer';
import { TerminalLog } from '../../components/code/TerminalLog';
import { GlowButton } from '../../components/shared/GlowButton';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { mockVibeCodingSession } from '../../data/mockData';

export const VibeCodingScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const session = mockVibeCodingSession;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="VibeCoding"
        subtitle={session.project.toUpperCase()}
        onBack={() => {}}
      />

      {/* Status Bar */}
      <View style={styles.statusContainer}>
        <StatusBar status={session.status} file={session.currentFile} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* File Header */}
        <GlassPanel style={styles.fileHeader}>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.primary },
            ]}>
            {session.currentFile}
          </Text>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            +{session.diffLines.filter(l => l.type === 'add').length} -{session.diffLines.filter(l => l.type === 'remove').length}
          </Text>
        </GlassPanel>

        {/* Code Diff */}
        <CodeDiffViewer lines={session.diffLines} />

        {/* Terminal Log */}
        <View style={styles.logSection}>
          <TerminalLog logs={session.logs} />
        </View>
      </ScrollView>

      {/* Action Bar */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: isDark
              ? 'rgba(17, 20, 23, 0.95)'
              : 'rgba(247, 249, 255, 0.95)',
            borderTopColor: isDark
              ? 'rgba(255, 255, 255, 0.06)'
              : theme.colors.outlineVariant,
          },
        ]}>
        <GlowButton
          title="PAUSE"
          onPress={() => {}}
          variant="outline"
          style={styles.actionBtn}
        />
        <GlowButton
          title="APPLY"
          onPress={() => {}}
          variant="primary"
          style={[styles.actionBtn, styles.applyBtn]}
        />
        <GlowButton
          title="ROLLBACK"
          onPress={() => {}}
          variant="secondary"
          style={styles.actionBtn}
        />
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  statusContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  fileHeader: {
    padding: 10,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logSection: {
    marginTop: 12,
  },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
  },
  applyBtn: {},
});
