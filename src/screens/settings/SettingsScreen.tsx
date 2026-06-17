import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { RingMeter } from '../../components/visual/RingMeter';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import {
  checkPlatformService,
  PLATFORM_SERVICE_BASE_URL,
  PlatformServiceHealth,
} from '../../config/localService';
import { useSessionStore } from '../../../stores/useSettingsStore';
import { ALIANG_ACCOUNT_BASE_URL } from '../../config/accountService';
import { ratioPercent, daysUntil, formatDate } from '../../utils/format';
import type { AccountSubscription } from '../../api/account';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const ratio = (value: number, total: number) =>
  total > 0 ? Math.min(100, (value / total) * 100) : 0;

export const SettingsScreen: React.FC = () => {
  const { theme, isDark, mode, setMode } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const projects = useControlCenterStore(state => state.projects);
  const approvals = useControlCenterStore(state => state.approvals);
  const notifications = useControlCenterStore(state => state.notifications);
  const user = useSessionStore(state => state.user);
  const logout = useSessionStore(state => state.logout);
  const operatorName = useSessionStore(state => state.operatorName);
  const accountData = useSessionStore(state => state.accountData);
  const refreshAccountData = useSessionStore(state => state.refreshAccountData);
  const disconnectFromServer = useControlCenterStore(state => state.disconnectFromServer);
  const resetSessionData = useControlCenterStore(state => state.resetSessionData);
  const wsConnected = useControlCenterStore(state => state.wsConnected);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [connectionStatus, setConnectionStatus] =
    useState<PlatformServiceHealth | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [refreshingAccount, setRefreshingAccount] = useState(false);

  // The Account tab is lazy-mounted by React Navigation, so its first visit
  // instantiates the whole subtree (SVG RingMeters, IconBadges, several panels)
  // in one synchronous JS-thread commit that races the navigation transition —
  // that is the "first tap into Me is very laggy" feeling. Defer the heavy
  // sections until the transition finishes; later taps are instant because the
  // tab stays mounted.
  const [sectionsReady, setSectionsReady] = useState(false);
  useEffect(() => {
    // Defer the heavy sections two animation frames so the tab-switch cross-fade
    // gets to paint its cheap shell first; the SVG/panel tree then mounts on
    // frame 3 instead of blocking the transition's first frames. (Bottom-tab
    // switches don't hold an InteractionManager handle, so rAF is the right
    // signal here — and InteractionManager is deprecated in RN 0.85 anyway.)
    let cancelled = false;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (!cancelled) {
          setSectionsReady(true);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  const themeOptions = [
    { key: 'system', label: 'SYSTEM' },
    { key: 'dark', label: 'CYBER' },
    { key: 'light', label: 'LIGHT' },
  ] as const;

  // --- Account / Subscriptions / Usage (from aliang-official-website backend) ---
  const profile = accountData?.profile;
  const subscriptions = accountData?.subscriptions ?? [];
  const usageStats = accountData?.usageStats;

  // Primary subscription (first active with group access)
  const primarySubscription = subscriptions[0];
  const primaryGroup = primarySubscription?.group;

  // Balance display
  const balance = profile?.balance ?? 0;
  const balanceDisplay = `$${balance.toFixed(2)}`;

  // Token usage display
  const totalTokens = usageStats?.total_tokens ?? 0;
  const totalCost = usageStats?.total_actual_cost ?? 0;
  const totalRequests = usageStats?.total_requests ?? 0;

  // Avatar and profile info
  const avatarUrl = profile?.avatar_url ?? null;
  const profileName = profile?.username || operatorName;
  const profileEmail = profile?.email || user?.email || 'Mobile VibeCoding controller';

  const { platformSummary } = useMemo(() => {
    const onlineDevices = devices.filter(device => device.status === 'online');
    const activeSessions = vibeRuns.filter(
      session =>
        session.status === 'running' ||
        session.status === 'waiting_user' ||
        session.status === 'waiting_approval' ||
        session.status === 'testing' ||
        session.status === 'preview_ready' ||
        session.status === 'paused',
    );
    const pendingApprovals = approvals.filter(item => item.status === 'pending');
    const unreadNotifications = notifications.filter(item => !item.read);
    const platformSummary = {
      title: 'Platform Console',
      headline: `${activeSessions.length} active sessions`,
      statusLabel: `${onlineDevices.length}/${devices.length || 0} ONLINE`,
      primaryMetric: {
        label: 'DEVICES',
        value: `${onlineDevices.length}/${devices.length || 0}`,
        progress: ratio(onlineDevices.length, devices.length),
      },
      secondaryMetric: {
        label: 'SESSIONS',
        value: `${activeSessions.length}`,
        progress: ratio(activeSessions.length, vibeRuns.length),
        tone: 'secondary' as const,
      },
      sideMetric: {
        label: 'PENDING',
        value: `${pendingApprovals.length}`,
      },
      meters: [
        {
          label: 'Projects',
          value: `${projects.length} synced`,
          progress: projects.length ? 100 : 0,
        },
        {
          label: 'Notifications',
          value: `${unreadNotifications.length}/${notifications.length || 0} unread`,
          progress: ratio(unreadNotifications.length, notifications.length),
          tone: 'secondary' as const,
        },
      ],
    };

    return { platformSummary };
  }, [devices, vibeRuns, projects, approvals, notifications]);

  const handleCheckConnection = async () => {
    setCheckingConnection(true);
    const result = await checkPlatformService();
    setConnectionStatus(result);
    setCheckingConnection(false);
  };

  const handleRefreshAccount = async () => {
    setRefreshingAccount(true);
    try {
      await refreshAccountData();
    } finally {
      setRefreshingAccount(false);
    }
  };

  const handleLogout = async () => {
    disconnectFromServer();
    resetSessionData();
    await logout();
  };

  const renderSectionTitle = (label: string) => (
    <Text
      style={[
        theme.typography.labelCaps,
        { color: theme.colors.onSurfaceVariant },
        styles.sectionTitle,
      ]}>
      {label}
    </Text>
  );

  const renderMetricCell = (label: string, value: string) => (
    <View style={styles.metricCell}>
      <Text style={[theme.typography.headlineMd, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </View>
  );

  const renderSubscriptionRow = (sub: AccountSubscription, isLast: boolean) => {
    const group = sub.group;
    const remainingDays = daysUntil(sub.expires_at);
    const isActive = remainingDays > 0;
    // Usage against monthly limit
    const monthlyUsage = sub.monthly_usage_usd ?? 0;
    const monthlyLimit = group?.monthly_limit_usd;

    return (
      <View key={String(sub.id)}>
        <View style={styles.orderRow}>
          <View style={styles.orderMain}>
            <Text
              style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
              numberOfLines={1}>
              {group?.name ?? `Group #${sub.group_id}`}
            </Text>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {formatDate(sub.expires_at)} · {group?.subscription_type ?? 'sub'}
            </Text>
          </View>
          <View style={styles.orderSide}>
            {monthlyLimit ? (
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                ${monthlyUsage.toFixed(2)} / ${monthlyLimit.toFixed(2)}
              </Text>
            ) : (
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                ${monthlyUsage.toFixed(2)}
              </Text>
            )}
            {isActive ? (
              <Text style={[theme.typography.labelSm, { color: theme.colors.secondary }]}>
                剩 {remainingDays} 天
              </Text>
            ) : null}
          </View>
        </View>
        {!isLast && <View style={styles.divider} />}
      </View>
    );
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar title="Platform" subtitle="SERVICE / CONSOLE / PREFERENCES" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <IconBadge name="user" tone="primary" size={46} iconSize={23} />
          )}
          <View style={styles.profileText}>
            <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
              {profileName}
            </Text>
            <View style={styles.profileSub}>
              {primaryGroup ? (
                <StatusChip label={primaryGroup.subscription_type?.toUpperCase() ?? 'GROUP'} type="info" />
              ) : null}
              <Text
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {profileEmail}
              </Text>
            </View>
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

        {sectionsReady ? (
          <>
            {renderSectionTitle('账户 ACCOUNT')}
            <GlassPanel style={styles.panel}>
              <View style={styles.planHeader}>
                <View style={styles.planTitle}>
                  <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {profile?.username ?? '未登录'}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    余额: {balanceDisplay}
                  </Text>
                </View>
                <StatusChip
                  label={profile?.status ?? '未知'}
                  type={profile?.status === 'active' ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.metricGrid}>
                {renderMetricCell('余额', balanceDisplay)}
                {renderMetricCell('累计充值', profile?.total_recharged ? `$${(profile.total_recharged ?? 0).toFixed(2)}` : '-')}
                {renderMetricCell('并发限制', String(profile?.concurrency ?? 0))}
                {renderMetricCell('请求限制', profile?.rpm_limit ? `${profile.rpm_limit}/min` : '无限制')}
              </View>
            </GlassPanel>

            {renderSectionTitle('用量 USAGE')}
            <GlassPanel style={styles.usagePanel}>
              {usageStats ? (
                <View style={styles.ringsRow}>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={ratioPercent(totalTokens, 1_000_000)}
                      value={totalTokens >= 1000000 ? `${(totalTokens / 1000000).toFixed(1)}M` : `${Math.round(totalTokens / 1000)}K`}
                      label="Token"
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      {totalTokens.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={Math.min(100, totalCost * 10)}
                      value={`$${totalCost.toFixed(2)}`}
                      label="费用"
                      color={theme.colors.secondary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      今日: ${totalCost.toFixed(4)}
                    </Text>
                  </View>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={Math.min(100, totalRequests / 100)}
                      value={String(totalRequests)}
                      label="请求"
                      color={theme.colors.primary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      次请求
                    </Text>
                  </View>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={balance > 0 ? Math.min(100, (totalCost / balance) * 100) : 0}
                      value={balanceDisplay}
                      label="余额"
                      color={theme.colors.tertiary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      可用
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  未加载用量数据
                </Text>
              )}
            </GlassPanel>

            {renderSectionTitle('订阅 SUBSCRIPTIONS')}
            <GlassPanel style={styles.panel}>
              {subscriptions.length === 0 ? (
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  暂无活跃订阅
                </Text>
              ) : (
                <>
                  <View style={styles.orderSummaryRow}>
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                      活跃订阅 {subscriptions.length} 个
                    </Text>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
                      分组访问权限
                    </Text>
                  </View>
                  <View style={styles.divider} />
                  {subscriptions.map((sub, index) =>
                    renderSubscriptionRow(sub, index === subscriptions.length - 1),
                  )}
                </>
              )}
            </GlassPanel>

            {renderSectionTitle('PLATFORM SERVICE')}
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
                  <Text
                    style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                    numberOfLines={1}>
                    {ALIANG_ACCOUNT_BASE_URL}
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

            <UsageSummaryCard summary={platformSummary} />

            <View style={styles.serviceActions}>
              <GlowButton
                title="REFRESH ACCOUNT"
                onPress={handleRefreshAccount}
                loading={refreshingAccount}
                variant="secondary"
                style={styles.serviceButton}
              />
            </View>

            {renderSectionTitle('CAPACITY')}
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

            {renderSectionTitle('INPUT MODE')}
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

            {renderSectionTitle('THEME')}
            <GlassPanel style={styles.themePanel}>
              {themeOptions.map(option => (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setMode(option.key)}
                  style={[
                    styles.themeOption,
                    mode === option.key && {
                      backgroundColor: isDark
                        ? 'rgba(86, 156, 214, 0.1)'
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
              title="SIGN OUT"
              onPress={handleLogout}
              variant="outline"
              style={styles.logoutBtn}
            />
          </>
        ) : (
          <View style={styles.deferredPlaceholder}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              正在加载控制台…
            </Text>
          </View>
        )}
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
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  profileText: {
    flex: 1,
  },
  profileSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  scanTile: {
    marginBottom: 14,
  },
  deferredPlaceholder: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  panel: {
    padding: 0,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 12,
  },
  planTitle: {
    flex: 1,
    gap: 2,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  metricCell: {
    width: '50%',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 4,
  },
  usagePanel: {
    padding: 16,
  },
  ringsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  ringCell: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  ringCaption: {
    color: 'rgba(255,255,255,0.55)',
  },
  orderSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  orderMain: {
    flex: 1,
    gap: 2,
  },
  orderSide: {
    alignItems: 'flex-end',
    gap: 2,
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
  logoutBtn: {
    marginTop: 10,
  },
});
