import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  PushNotificationItem,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';
import {
  buildDeviceStatusIndex,
  isDeviceStatusOffline,
} from '../../utils/deviceStatus';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const notificationTypeLabel: Record<PushNotificationItem['type'], string> = {
  approval: 'Approval',
  completed: 'Completed',
  error: 'Error',
  device_offline: 'Offline',
};

const notificationTypeChip: Record<
  PushNotificationItem['type'],
  'warning' | 'success' | 'error' | 'neutral'
> = {
  approval: 'warning',
  completed: 'success',
  error: 'error',
  device_offline: 'neutral',
};

const notificationIcon: Record<PushNotificationItem['type'], IconName> = {
  approval: 'approval',
  completed: 'check',
  error: 'warning',
  device_offline: 'device',
};

export const NotificationCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const notifications = useControlCenterStore(state => state.notifications);
  const devices = useControlCenterStore(state => state.devices);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const deviceStatusIndex = useMemo(
    () => buildDeviceStatusIndex(devices),
    [devices],
  );
  const markNotificationRead = useControlCenterStore(
    state => state.markNotificationRead,
  );
  const markAllNotificationsRead = useControlCenterStore(
    state => state.markAllNotificationsRead,
  );
  const unreadCount = notifications.filter(item => !item.read).length;
  const notificationList = useIncrementalList(
    [...notifications].sort((left, right) =>
      newestFirst(left.createdAt, right.createdAt),
    ),
    {
      initialCount: 12,
      step: 16,
      resetKey: notifications.length,
    },
  );

  const handleOpen = (item: PushNotificationItem) => {
    void markNotificationRead(item.id).catch(error => {
      console.warn('[notifications] failed to mark read', error);
    });

    if (item.type === 'approval' && item.approvalId) {
      navigation.navigate('ApprovalCenter');
      return;
    }

    if (item.sessionId) {
      navigation.navigate('VibeCodingSession', { sessionId: item.sessionId });
      return;
    }

    if (item.deviceId) {
      navigation.navigate('DeviceDetail', { deviceId: item.deviceId });
    }
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Notifications"
        subtitle="PUSH QUEUE"
        onBack={navigation.goBack}
        rightAction={<StatusChip label={`${unreadCount} UNREAD`} type={unreadCount ? 'warning' : 'success'} />}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => {
            void markAllNotificationsRead().catch(error => {
              console.warn('[notifications] failed to mark all read', error);
            });
          }}
          style={[
            styles.markAllButton,
            {
              borderColor: theme.colors.outlineVariant,
              borderRadius: theme.borderRadius.full,
            },
          ]}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
            MARK ALL READ
          </Text>
        </TouchableOpacity>

        {notificationList.visibleItems.map(item => {
          const device = devices.find(deviceItem => deviceItem.id === item.deviceId);
          const itemDeviceId =
            item.deviceId ??
            vibeRuns.find(run => run.id === item.sessionId)?.deviceId;
          const itemOffline = isDeviceStatusOffline(
            deviceStatusIndex.get(itemDeviceId ?? ''),
          );
          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.75}
              onPress={() => handleOpen(item)}>
              <GlassPanel
                glowColor={!item.read ? 'secondary' : 'none'}
                style={[
                  styles.notificationCard,
                  {
                    opacity: itemOffline ? 0.5 : item.read ? 0.72 : 1,
                    backgroundColor:
                      !item.read && isDark
                        ? 'rgba(255,255,255,0.065)'
                        : undefined,
                  },
                ]}>
                <View style={styles.cardHeader}>
                  <IconBadge
                    name={notificationIcon[item.type]}
                    tone={
                      item.type === 'error'
                        ? 'error'
                        : item.type === 'approval'
                        ? 'tertiary'
                        : item.type === 'completed'
                        ? 'secondary'
                        : 'neutral'
                    }
                    size={42}
                    iconSize={21}
                  />
                  <View style={styles.titleBlock}>
                    <Text
                      style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                      {notificationTypeLabel[item.type].toUpperCase()}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                      {item.title}
                    </Text>
                  </View>
                  <StatusChip
                    label={item.read ? 'READ' : 'NEW'}
                    type={item.read ? 'neutral' : notificationTypeChip[item.type]}
                  />
                </View>
                <Text
                  numberOfLines={3}
                  style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                  {item.body}
                </Text>
                <View style={styles.metaRow}>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                    {device?.name ?? item.deviceId ?? 'all devices'}
                    {itemOffline ? ' · 离线' : ''}
                  </Text>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                    {item.createdAt}
                  </Text>
                </View>
              </GlassPanel>
            </TouchableOpacity>
          );
        })}
        <LoadMoreRow
          visibleCount={notificationList.visibleCount}
          totalCount={notificationList.totalCount}
          onPress={notificationList.showMore}
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
    paddingTop: 12,
    paddingBottom: 40,
  },
  markAllButton: {
    alignSelf: 'flex-end',
    borderWidth: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  notificationCard: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
