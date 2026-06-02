import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { mockDevices, mockUserPlan, mockVibeCodingRuns } from '../../data/mockData';

export const SettingsScreen: React.FC = () => {
  const { theme, isDark, mode, setMode } = useTheme();

  const themeOptions = [
    { key: 'system', label: 'SYSTEM' },
    { key: 'dark', label: 'CYBER' },
    { key: 'light', label: 'LIGHT' },
  ] as const;

  const usageRows = [
    ['Today spend', '$8.42'],
    ['This week', '$31.10'],
    ['Voice整理', '42 turns'],
    ['Preview links', '2 active'],
  ];

  return (
    <SafeAreaWrapper>
      <TopAppBar title="Account" subtitle="PLAN / LIMITS / PREFERENCES" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.primary }]}>
              AL
            </Text>
          </View>
          <View style={styles.profileText}>
            <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
              {mockUserPlan.userName}
            </Text>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              Mobile VibeCoding controller
            </Text>
          </View>
          <StatusChip label="PRO" type="info" />
        </View>

        <UsageSummaryCard plan={mockUserPlan} />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          USAGE DETAIL
        </Text>
        <GlassPanel style={styles.panel}>
          {usageRows.map(([label, value], index) => (
            <View key={label}>
              <View style={styles.settingRow}>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                  {label}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  {value}
                </Text>
              </View>
              {index < usageRows.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          CAPACITY
        </Text>
        <View style={styles.capacityGrid}>
          <GlassPanel style={styles.capacityCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.secondary }]}>
              {mockDevices.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              DEVICES
            </Text>
          </GlassPanel>
          <GlassPanel style={styles.capacityCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
              {mockVibeCodingRuns.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              SESSIONS
            </Text>
          </GlassPanel>
        </View>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          INPUT MODE
        </Text>
        <GlassPanel style={styles.panel}>
          <View style={styles.settingRow}>
            <View>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                Voice first
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                Voice notes are整理 into a prompt before sending
              </Text>
            </View>
            <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              ON
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                Require confirmation
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                Confirm every AI-prepared voice instruction
              </Text>
            </View>
            <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              ON
            </Text>
          </View>
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          THEME
        </Text>
        <GlassPanel style={styles.themePanel}>
          {themeOptions.map(option => (
            <TouchableOpacity
              key={option.key}
              onPress={() => setMode(option.key)}
              style={[
                styles.themeOption,
                mode === option.key && {
                  backgroundColor: isDark
                    ? 'rgba(0, 209, 255, 0.1)'
                    : 'rgba(0, 81, 174, 0.08)',
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.primary,
                },
              ]}>
              <Text
                style={[
                  theme.typography.bodyMd,
                  {
                    color:
                      mode === option.key
                        ? theme.colors.primary
                        : theme.colors.onSurface,
                  },
                ]}>
                {option.label}
              </Text>
              {mode === option.key && (
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  ACTIVE
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </GlassPanel>

        <GlowButton
          title="MANAGE BILLING"
          onPress={() => {}}
          variant="secondary"
          style={styles.actionButton}
        />
        <GlowButton
          title="SIGN OUT"
          onPress={() => {}}
          variant="outline"
          style={styles.logoutBtn}
        />
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
    paddingTop: 12,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: {
    flex: 1,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  panel: {
    padding: 0,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 16,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  capacityGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  capacityCard: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  themePanel: {
    padding: 4,
  },
  themeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  actionButton: {
    marginTop: 24,
  },
  logoutBtn: {
    marginTop: 10,
  },
});
