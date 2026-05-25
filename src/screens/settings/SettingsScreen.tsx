import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';

export const SettingsScreen: React.FC = () => {
  const { theme, isDark, mode, setMode } = useTheme();

  const themeOptions = [
    { key: 'system', label: 'SYSTEM' },
    { key: 'dark', label: 'CYBER-LOGIC' },
    { key: 'light', label: 'UTILITY MINIMALIST' },
  ] as const;

  return (
    <SafeAreaWrapper>
      <TopAppBar title="Settings" subtitle="CONFIGURATION" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Theme Selection */}
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
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.primary },
                  ]}>
                  [ACTIVE]
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </GlassPanel>

        {/* Account */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          ACCOUNT
        </Text>
        <GlassPanel style={styles.settingsPanel}>
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Agent ID
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              agent@terminal-01
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Session
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              ACTIVE
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Region
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              us-east-1a
            </Text>
          </View>
        </GlassPanel>

        {/* Notifications */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          NOTIFICATIONS
        </Text>
        <GlassPanel style={styles.settingsPanel}>
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Critical Alerts
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              ON
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Build Notifications
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
              ON
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              AI Suggestions
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              OFF
            </Text>
          </View>
        </GlassPanel>

        {/* About */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          ABOUT
        </Text>
        <GlassPanel style={styles.settingsPanel}>
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Version
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              0.1.0
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              Build
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              2025.05-alpha
            </Text>
          </View>
        </GlassPanel>

        {/* Logout */}
        <GlowButton
          title="DISCONNECT"
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
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
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
  settingsPanel: {
    padding: 0,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  logoutBtn: {
    marginTop: 24,
  },
});
