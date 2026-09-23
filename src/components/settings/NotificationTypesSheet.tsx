import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { useSessionStore } from '../../../stores/useSettingsStore';
import {
  isEventTypeEnabled,
  NOTIFIABLE_EVENT_TYPES,
} from '../../utils/notificationDeliveryPolicy';

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
            <Pressable
              style={styles.row}
              key={type}
              onPress={() =>
                setNotificationPrefs({ ...notificationPrefs, [type]: !enabled })
              }
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled }}
            >
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
            </Pressable>
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
