import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Image,
  Switch,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { ActionTile } from '../../components/visual/ActionTile';
import { IconBadge } from '../../components/visual/IconBadge';
import { RingMeter } from '../../components/visual/RingMeter';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useStableVibeRuns } from '../../store/controlCenterStore';
import { useSessionStore } from '../../../stores/useSettingsStore';
import { useToastStore } from '../../store/toastStore';
import { ratioPercent, daysUntil, formatDate } from '../../utils/format';
import type { AccountSubscription } from '../../api/account';
import { UserModelDefaultCard } from '../../components/account/UserModelDefaultCard';
import {
  displayNotification,
  getNotificationPermissionStatus,
  openNotificationSettings,
  requestPermission,
  type LocalNotificationPermissionStatus,
} from '../../services/localNotifications';
import { type NotifiableEventType } from '../../utils/notificationDeliveryPolicy';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const ratio = (value: number, total: number) =>
  total > 0 ? Math.min(100, (value / total) * 100) : 0;

const NOTIFIABLE_EVENT_TYPES: NotifiableEventType[] = [
  'approval',
  'session_done',
  'session_failed',
  'device_offline',
];

export const SettingsScreen: React.FC = () => {
  const { theme, isDark, mode, setMode } = useTheme();
  const { t } = useTranslation('settings');
  const { locale, setLocale } = useLocale();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const vibeRuns = useStableVibeRuns();
  const projects = useControlCenterStore(state => state.projects);
  const approvals = useControlCenterStore(state => state.approvals);
  const notifications = useControlCenterStore(state => state.notifications);
  const user = useSessionStore(state => state.user);
  const logout = useSessionStore(state => state.logout);
  const operatorName = useSessionStore(state => state.operatorName);
  const accountData = useSessionStore(state => state.accountData);
  const refreshAccountData = useSessionStore(state => state.refreshAccountData);
  const clearSavedCredentials = useSessionStore(state => state.clearSavedCredentials);
  const show = useToastStore(s => s.show);
  const notificationPrefs = useSessionStore(s => s.notificationPrefs);
  const setNotificationPrefs = useSessionStore(s => s.setNotificationPrefs);
  const disconnectFromServer = useControlCenterStore(state => state.disconnectFromServer);
  const resetSessionData = useControlCenterStore(state => state.resetSessionData);
  const wsConnected = useControlCenterStore(state => state.wsConnected);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<LocalNotificationPermissionStatus>('unsupported');
  const [updatingNotificationPermission, setUpdatingNotificationPermission] =
    useState(false);

  const refreshNotificationPermission = useCallback(() => {
    void getNotificationPermissionStatus().then(setNotificationPermission);
  }, []);

  useFocusEffect(refreshNotificationPermission);

  // React-Navigation focus fires on tab switches but NOT when the app returns
  // to the foreground. After the user grants (or toggles) notifications in the
  // system settings and comes back, the status would otherwise stay stale — so
  // the SEND TEST button would re-open settings instead of sending. Re-read on
  // every foreground transition.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') refreshNotificationPermission();
    });
    return () => subscription.remove();
  }, [refreshNotificationPermission]);

  // The Account tab's first visit instantiates a heavy subtree (SVG RingMeters,
  // IconBadges, several panels) in one synchronous JS-thread commit that races
  // the tab transition — the "first tap into Me is very laggy" feeling. The
  // heavy sections below are wrapped in <DeferredMount> so the cheap shell
  // (profile + scan tile) paints first; later taps thaw an already-mounted
  // tree instantly.
  const themeOptions = [
    { key: 'system', label: t('themeOptions.system') },
    { key: 'dark', label: t('themeOptions.dark') },
    { key: 'light', label: t('themeOptions.light') },
  ] as const;

  // Language names are shown in their own script regardless of the active locale
  // (so English / 中文 are always recognizable); only the section title is translated.
  const languageOptions = [
    { key: 'en', label: 'English' },
    { key: 'zh', label: '中文' },
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
      title: t('platform.title'),
      headline: t('platform.activeSessions', { count: activeSessions.length }),
      statusLabel: `${onlineDevices.length}/${devices.length || 0} ONLINE`,
      primaryMetric: {
        label: t('platform.metricDevices'),
        value: `${onlineDevices.length}/${devices.length || 0}`,
        progress: ratio(onlineDevices.length, devices.length),
      },
      secondaryMetric: {
        label: t('platform.metricSessions'),
        value: `${activeSessions.length}`,
        progress: ratio(activeSessions.length, vibeRuns.length),
        tone: 'secondary' as const,
      },
      sideMetric: {
        label: t('platform.pending'),
        value: `${pendingApprovals.length}`,
      },
      meters: [
        {
          label: t('platform.metersProjects'),
          value: t('platform.metersProjectsValue', { count: projects.length }),
          progress: projects.length ? 100 : 0,
        },
        {
          label: t('platform.metersNotifications'),
          value: t('platform.metersNotificationsValue', {
            unread: unreadNotifications.length,
            total: notifications.length || 0,
          }),
          progress: ratio(unreadNotifications.length, notifications.length),
          tone: 'secondary' as const,
        },
      ],
    };

    return { platformSummary };
  }, [devices, vibeRuns, projects, approvals, notifications, t]);

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

  const handleNotificationPermission = async () => {
    setUpdatingNotificationPermission(true);
    try {
      // Both branches report a boolean: requestPermission → granted,
      // openNotificationSettings → opened. The old code dropped it, so a
      // rejected openNotificationSettings looked like the button did nothing.
      const opened =
        notificationPermission === 'not_determined'
          ? await requestPermission()
          : await openNotificationSettings();
      setNotificationPermission(await getNotificationPermissionStatus());
      if (!opened) {
        show(t('notifications.openSettingsFailed'), 'error');
      }
    } finally {
      setUpdatingNotificationPermission(false);
    }
  };

  // Diagnostic: pops a local notification immediately, isolating "can notify-kit
  // display at all on this device" from the WS/background trigger chain. Drives
  // the permission flow too, so the button always responds — not_determined →
  // system dialog, denied/unsupported → system settings (user returns to retry),
  // authorized → send right away.
  const handleSendTestNotification = useCallback(async () => {
    if (notificationPermission === 'not_determined') {
      const granted = await requestPermission();
      setNotificationPermission(await getNotificationPermissionStatus());
      if (!granted) {
        show(t('notifications.testDenied'), 'error');
        return;
      }
    } else if (
      notificationPermission === 'denied' ||
      notificationPermission === 'unsupported'
    ) {
      const opened = await openNotificationSettings();
      show(
        opened
          ? t('notifications.testOpenSettings')
          : t('notifications.openSettingsFailed'),
        opened ? 'info' : 'error',
      );
      return;
    }
    const result = await displayNotification({
      id: `vibe_test_${Date.now()}`,
      title: t('notifications.testTitle'),
      body: t('notifications.testBody'),
      data: { type: 'test' },
    });
    show(
      result.ok
        ? t('notifications.testSent')
        : `${t('notifications.testFailed')} — ${result.error}`,
      result.ok ? 'success' : 'error',
    );
  }, [notificationPermission, show, t]);

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
                {t('subscriptions.remainingDays', { count: remainingDays })}
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
      <TopAppBar title={t('appbar.title')} subtitle={t('appbar.subtitle')} />
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
                <StatusChip label={primaryGroup.subscription_type?.toUpperCase() ?? t('states.group')} type="info" />
              ) : null}
              <Text
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {profileEmail}
              </Text>
            </View>
          </View>
          <StatusChip
            label={wsConnected ? t('states.realtime') : serverMode ? t('states.api') : t('states.local')}
            type={wsConnected ? 'success' : serverMode ? 'info' : 'neutral'}
          />
        </View>

        <ActionTile
          icon="scan"
          label={t('scan.label')}
          value={t('scan.value')}
          caption={t('scan.caption')}
          tone="success"
          onPress={() => navigation.navigate('DeviceCameraScanner')}
          style={styles.scanTile}
        />

        <DeferredMount
          fallback={
            <View style={styles.deferredPlaceholder}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {t('loadingConsole')}
              </Text>
            </View>
          }>
          <>
            {renderSectionTitle(t('sections.account'))}
            <GlassPanel style={styles.panel}>
              <View style={styles.planHeader}>
                <View style={styles.planTitle}>
                  <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {profile?.username ?? t('account.notLoggedIn')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('account.balanceColon')}{balanceDisplay}
                  </Text>
                </View>
                <StatusChip
                  label={profile?.status ?? t('account.unknown')}
                  type={profile?.status === 'active' ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.metricGrid}>
                {renderMetricCell(t('account.balance'), balanceDisplay)}
                {renderMetricCell(t('account.totalRecharged'), profile?.total_recharged ? `$${(profile.total_recharged ?? 0).toFixed(2)}` : '-')}
                {renderMetricCell(t('account.concurrencyLimit'), String(profile?.concurrency ?? 0))}
                {renderMetricCell(t('account.requestLimit'), profile?.rpm_limit ? `${profile.rpm_limit}/min` : t('account.unlimited'))}
              </View>
            </GlassPanel>

            {renderSectionTitle(t('sections.usage'))}
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
                      label={t('usage.cost')}
                      color={theme.colors.secondary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      {t('usage.today')}${totalCost.toFixed(4)}
                    </Text>
                  </View>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={Math.min(100, totalRequests / 100)}
                      value={String(totalRequests)}
                      label={t('usage.requests')}
                      color={theme.colors.primary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      {t('usage.requestsUnit')}
                    </Text>
                  </View>
                  <View style={styles.ringCell}>
                    <RingMeter
                      progress={balance > 0 ? Math.min(100, (totalCost / balance) * 100) : 0}
                      value={balanceDisplay}
                      label={t('account.balance')}
                      color={theme.colors.tertiary}
                      size={98}
                    />
                    <Text
                      style={[theme.typography.labelSm, styles.ringCaption]}
                      numberOfLines={1}>
                      {t('usage.available')}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('usage.notLoaded')}
                </Text>
              )}
            </GlassPanel>

            {renderSectionTitle(t('sections.subscriptions'))}
            <GlassPanel style={styles.panel}>
              {subscriptions.length === 0 ? (
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('subscriptions.noneActive')}
                </Text>
              ) : (
                <>
                  <View style={styles.orderSummaryRow}>
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                      {t('subscriptions.activeCount', { count: subscriptions.length })}
                    </Text>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
                      {t('subscriptions.groupAccess')}
                    </Text>
                  </View>
                  <View style={styles.divider} />
                  {subscriptions.map((sub, index) =>
                    renderSubscriptionRow(sub, index === subscriptions.length - 1),
                  )}
                </>
              )}
            </GlassPanel>

            {renderSectionTitle(t('sections.modelConfig'))}
            <UserModelDefaultCard />

            {renderSectionTitle(t('sections.platformService'))}

            <UsageSummaryCard summary={platformSummary} />

            <View style={styles.serviceActions}>
              <GlowButton
                title={t('actions.refreshAccount')}
                onPress={handleRefreshAccount}
                loading={refreshingAccount}
                variant="secondary"
                style={styles.serviceButton}
              />
            </View>

            {renderSectionTitle(t('sections.notifications'))}
            <GlassPanel style={styles.panel}>
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {t('notifications.systemTitle')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t(`notifications.status.${notificationPermission}`)}
                  </Text>
                </View>
                <StatusChip
                  label={t(`notifications.shortStatus.${notificationPermission}`)}
                  type={notificationPermission === 'authorized' ? 'success' : 'warning'}
                />
              </View>
              <View style={styles.serviceActionsInset}>
                <GlowButton
                  title={
                    notificationPermission === 'not_determined'
                      ? t('notifications.enable')
                      : t('notifications.openSettings')
                  }
                  onPress={() => void handleNotificationPermission()}
                  loading={updatingNotificationPermission}
                  disabled={notificationPermission === 'unsupported'}
                  variant="secondary"
                  style={styles.serviceButton}
                />
              </View>
            </GlassPanel>

            <GlassPanel style={styles.panel}>
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {t('notifications.testTitle')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('notifications.testCaption')}
                  </Text>
                </View>
              </View>
              <View style={styles.serviceActionsInset}>
                <GlowButton
                  title={t('notifications.sendTest')}
                  onPress={() => void handleSendTestNotification()}
                  variant="secondary"
                  style={styles.serviceButton}
                />
              </View>
              {NOTIFIABLE_EVENT_TYPES.map(type => {
                const enabled = notificationPrefs[type] ?? true;
                return (
                  <View style={styles.settingRow} key={type}>
                    <View style={styles.settingCopy}>
                      <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                        {t(`notifications.types.${type}`)}
                      </Text>
                    </View>
                    <Switch
                      value={enabled}
                      accessibilityLabel={t(`notifications.types.${type}`)}
                      trackColor={{
                        false: theme.colors.surfaceContainerHighest,
                        true: theme.colors.primaryContainer,
                      }}
                      thumbColor={
                        enabled ? theme.colors.primary : theme.colors.onSurfaceVariant
                      }
                      onValueChange={value =>
                        setNotificationPrefs({ ...notificationPrefs, [type]: value })
                      }
                    />
                  </View>
                );
              })}
            </GlassPanel>

            {renderSectionTitle(t('sections.capacity'))}
            <View style={styles.capacityGrid}>
              <GlassPanel style={styles.capacityCard}>
                <Text style={[theme.typography.headlineMd, { color: theme.colors.secondary }]}>
                  {devices.length}
                </Text>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
                  {t('capacity.devices')}
                </Text>
              </GlassPanel>
              <GlassPanel style={styles.capacityCard}>
                <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
                  {vibeRuns.length}
                </Text>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
                  {t('capacity.sessions')}
                </Text>
              </GlassPanel>
            </View>

            {renderSectionTitle(t('sections.inputMode'))}
            <GlassPanel style={styles.panel}>
              <View style={styles.settingRow}>
                <View>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {t('inputMode.voiceFirst')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('inputMode.voiceFirstCaption')}
                  </Text>
                </View>
                <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
                  {t('states.on')}
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.settingRow}>
                <View>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {t('inputMode.requireConfirmation')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('inputMode.requireConfirmationCaption')}
                  </Text>
                </View>
                <Text style={[theme.typography.codeSm, { color: theme.colors.secondary }]}>
                  {t('states.on')}
                </Text>
              </View>
            </GlassPanel>

            {renderSectionTitle(t('sections.theme'))}
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
                      {t('states.active')}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </GlassPanel>

            {renderSectionTitle(t('language.label'))}
            <GlassPanel style={styles.themePanel}>
              {languageOptions.map(option => (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setLocale(option.key)}
                  style={[
                    styles.themeOption,
                    locale === option.key && {
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
                          locale === option.key
                            ? theme.colors.primary
                            : theme.colors.onSurface,
                      },
                    ]}>
                    {option.label}
                  </Text>
                  {locale === option.key && (
                    <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                      {t('states.active')}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </GlassPanel>

            <GlowButton
              title={t('clearCredentialsLabel')}
              onPress={async () => {
                await clearSavedCredentials();
                show(t('clearCredentialsConfirm'));
              }}
              variant="outline"
              style={styles.logoutBtn}
              testID="settings-clear-credentials"
            />

            <GlowButton
              title={t('actions.signOut')}
              onPress={handleLogout}
              variant="outline"
              style={styles.logoutBtn}
            />
          </>
        </DeferredMount>
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    // Vertical gap between the two wrapped rows. Horizontal gap comes from
    // space-between + each cell being 48% wide (≈4% gutter).
    rowGap: 16,
  },
  ringCell: {
    // Two cells per row regardless of device width, so the fixed-size rings
    // (98px) never overflow their cell and overlap their neighbours. The ring
    // is an absolute-sized Svg, so a flex:1 cell can't shrink it — capping the
    // cell at 48% + wrapping is what prevents the overlap on narrow screens.
    width: '48%',
    alignItems: 'center',
    gap: 8,
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
  settingCopy: {
    flex: 1,
    gap: 3,
  },
  serviceActionsInset: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
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
