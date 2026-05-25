import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { CodeDiffViewer } from '../../components/code/CodeDiffViewer';
import { GlowButton } from '../../components/shared/GlowButton';
import { mockPullRequest } from '../../data/mockData';

export const GitHubPRScreen: React.FC = () => {
  const { theme } = useTheme();
  const [pr] = useState(mockPullRequest);
  const [selectedFile, setSelectedFile] = useState(0);

  const file = pr.files[selectedFile];

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Pull Request"
        subtitle={`#${pr.id} ${pr.title}`}
        onBack={() => {}}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* PR Header */}
        <GlassPanel style={styles.prHeader}>
          <Text
            style={[
              theme.typography.titleMd,
              { color: theme.colors.onSurface },
            ]}>
            {pr.title}
          </Text>
          <View style={styles.prMeta}>
            <StatusChip label={pr.status.toUpperCase()} type="success" />
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {pr.author}
            </Text>
          </View>
          <View style={styles.branchInfo}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              {pr.branch}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              →
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              {pr.base}
            </Text>
          </View>
          <View style={styles.diffStats}>
            <Text style={[theme.typography.codeSm, { color: '#2FF801' }]}>
              +{pr.additions}
            </Text>
            <Text style={[theme.typography.codeSm, { color: '#FF6B6B' }]}>
              -{pr.deletions}
            </Text>
          </View>
        </GlassPanel>

        {/* Files Tab */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          CHANGED FILES
        </Text>

        {pr.files.map((f, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setSelectedFile(index)}>
            <GlassPanel
              style={[
                styles.fileTab,
                selectedFile === index && {
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.primary,
                },
              ]}>
              <Text
                style={[
                  theme.typography.codeSm,
                  {
                    color:
                      selectedFile === index
                        ? theme.colors.primary
                        : theme.colors.onSurface,
                  },
                ]}>
                {f.filename}
              </Text>
              <View style={styles.fileStats}>
                <Text style={[theme.typography.codeSm, { color: '#2FF801', fontSize: 11 }]}>
                  +{f.additions}
                </Text>
                <Text style={[theme.typography.codeSm, { color: '#FF6B6B', fontSize: 11 }]}>
                  -{f.deletions}
                </Text>
              </View>
            </GlassPanel>
          </TouchableOpacity>
        ))}

        {/* Diff View */}
        {file.hunks.map((hunk, hunkIndex) => (
          <View key={hunkIndex} style={styles.diffSection}>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
                styles.hunkHeader,
              ]}>
              @@ -{hunk.oldStart} +{hunk.newStart} @@
            </Text>
            <CodeDiffViewer lines={hunk.lines} />
          </View>
        ))}

        {/* Actions */}
        <View style={styles.actions}>
          <GlowButton title="APPROVE" onPress={() => {}} variant="primary" />
          <GlowButton title="REQUEST CHANGES" onPress={() => {}} variant="outline" />
          <GlowButton title="MERGE" onPress={() => {}} variant="secondary" />
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
  prHeader: {
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  prMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  branchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diffStats: {
    flexDirection: 'row',
    gap: 12,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  fileTab: {
    padding: 10,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fileStats: {
    flexDirection: 'row',
    gap: 8,
  },
  diffSection: {
    marginTop: 12,
  },
  hunkHeader: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 11,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
});
