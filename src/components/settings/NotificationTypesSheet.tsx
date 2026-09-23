import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { useSessionStore } from '../../../stores/useSettingsStore';
import {
  isEventTypeEnabled,
  type NotifiableEventType,
} from '../../utils/notificationDeliveryPolicy';

// Per-type notification toggles, reached from the Settings notification
// panel's single 「通知类型」 row. Keys are the NotifiableEventType union —
// identical to the `data.type` string carried by each background notification,
// so the background hook filters with zero mapping (spec §4.4).
const NOTIFIABLE_EVENT_TYPES: NotifiableEventType[] = [
  'approval',
  'session_done',
  'session_failed',
  'device_offline',
  'device_online',
];

export const NotificationTypesSheet: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const notificationPrefs = useSessionStore(s => s.notificationPrefs);
  const setNotificationPrefs = useSessionStore(s => s.setNotificationPrefs);

  return (
    <BottomSheet open={open} onClose={onClose} title={t('notifications.typesTitle')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {NOTIFIABLE_EVENT_TYPES.map(type => {
          const enabled = isEventTypeEnabled(notificationPrefs, type);
          return (
            <View style={styles.row} key={type}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t(`notifications.types.${type}`)}
              </Text>
              <Switch
                value={enabled}
                accessibilityLabel={t(`notifications.types.${type}`)}
                trackColor={{
                  false: theme.colors.surfaceContainerHighest,
                  true: theme.colors.primaryContainer,
                }}
                thumbColor={enabled ? theme.colors.primary : theme.colors.onSurfaceVariant}
                onValueChange={value =>
                  setNotificationPrefs({ ...notificationPrefs, [type]: value })
                }
              />
            </View>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
});
