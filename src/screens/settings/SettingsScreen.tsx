import React, { useState } from 'react';
import {
  Linking,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { ActionTile } from '../../components/visual/ActionTile';
import { IconBadge } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import {
  checkPlatformService,
  PLATFORM_SERVICE_BASE_URL,
  PlatformServiceHealth,
} from '../../config/localService';
import { useSessionStore } from '../../../stores/useSettingsStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export const SettingsScreen: React.FC = () => {
  const { theme, isDark, mode, setMode } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const user = useSessionStore(state => state.user);
  const operatorName = useSessionStore(state => state.operatorName);
  const disconnectFromServer = useControlCenterStore(state => state.disconnectFromServer);
  const wsConnected = useControlCenterStore(state => state.wsConnected);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [connectionStatus, setConnectionStatus] =
    useState<PlatformServiceHealth | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);

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

  const handleCheckConnection = async () => {
    setCheckingConnection(true);
    const result = await checkPlatformService();
    setConnectionStatus(result);
    setCheckingConnection(false);
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar title="Platform" subtitle="SERVICE / CONSOLE / PREFERENCES" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <IconBadge name="user" tone="primary" size={46} iconSize={23} />
          <View style={styles.profileText}>
            <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
              {operatorName}
            </Text>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {user?.email ?? 'Mobile VibeCoding controller'}
            </Text>
          </View>
          <StatusChip
            label={wsConnected ? 'REALTIME' : serverMode ? 'API' : 'LOCAL'}
            type={wsConnected ? 'success' : serverMode ? 'info' : 'neutral'}
          />
        </View>

        <ActionTile
          icon="scan"
          label="扫码绑定设备"
          value="QR"
          caption="打开相机扫描电脑端 Agent 二维码"
          tone="success"
          onPress={() => navigation.navigate('DeviceCameraScanner')}
          style={styles.scanTile}
        />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          PLATFORM SERVICE
        </Text>
        <GlassPanel style={styles.servicePanel}>
          <View style={styles.serviceHeader}>
            <View style={styles.serviceCopy}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                Platform API
              </Text>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.primary }]}
                numberOfLines={1}>
                {PLATFORM_SERVICE_BASE_URL}
              </Text>
            </View>
            <StatusChip
              label={
                checkingConnection
                  ? 'CHECKING'
                  : connectionStatus?.ok
                  ? 'ONLINE'
                  : connectionStatus
                  ? 'OFFLINE'
                  : 'READY'
              }
              type={
                checkingConnection
                  ? 'info'
                  : connectionStatus?.ok
                  ? 'success'
                  : connectionStatus
                  ? 'error'
                  : 'neutral'
              }
            />
          </View>
          {connectionStatus ? (
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color: connectionStatus.ok
                    ? theme.colors.secondary
                    : theme.colors.error,
                },
                styles.serviceMessage,
              ]}>
              {connectionStatus.message} / {connectionStatus.latencyMs}ms
            </Text>
          ) : null}
          <View style={styles.serviceActions}>
            <GlowButton
              title="TEST CONNECTION"
              onPress={handleCheckConnection}
              loading={checkingConnection}
              variant="secondary"
              style={styles.serviceButton}
            />
            <GlowButton
              title="OPEN"
              onPress={() => Linking.openURL(PLATFORM_SERVICE_BASE_URL)}
              variant="outline"
              style={styles.serviceButton}
            />
          </View>
        </GlassPanel>

        <UsageSummaryCard plan={{
          userName: operatorName,
          planName: 'Platform Console',
          renewsAt: '2026-06-25',
          balanceLimit: 120,
          balanceUsed: 46.8,
          timeLimitHours: 80,
          timeUsedHours: 31.5,
          concurrentLimit: 4,
          concurrentUsed: devices.filter(d => d.status === 'online').length,
        }} />

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
              {devices.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              DEVICES
            </Text>
          </GlassPanel>
          <GlassPanel style={styles.capacityCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
              {vibeRuns.length}
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
          title="断开实时连接"
          onPress={disconnectFromServer}
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
  profileText: {
    flex: 1,
  },
  scanTile: {
    marginBottom: 14,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  panel: {
    padding: 0,
  },
  servicePanel: {
    padding: 14,
    gap: 12,
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  serviceCopy: {
    flex: 1,
  },
  serviceMessage: {
    lineHeight: 18,
  },
  serviceActions: {
    flexDirection: 'row',
    gap: 10,
  },
  serviceButton: {
    flex: 1,
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
