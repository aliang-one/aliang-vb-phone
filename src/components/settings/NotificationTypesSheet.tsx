import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { useSessionStore } from '../../../stores/useSettingsStore';
import {
  isEventTypeEnabled,
  NOTIFIABLE_EVENT_TYPES,
} from '../../utils/notificationDeliveryPolicy';

export const NotificationTypesSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Diagnostic "send test notification" action (moved off the Me page). The
   * sheet body sits in a native Modal above the root ToastViewport, so the
   * press handler closes the sheet FIRST — otherwise the result toast renders
   * behind it and is never seen. */
  onSendTest?: () => void;
}> = ({ open, onClose, onSendTest }) => {
  const { theme, isDark } = useTheme();
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
        {onSendTest ? (
          <View
            style={[
              styles.testSection,
              {
                borderTopColor: isDark
                  ? 'rgba(255,255,255,0.08)'
                  : theme.colors.outlineVariant,
              },
            ]}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t('notifications.testCaption')}
            </Text>
            <GlowButton
              title={t('notifications.sendTest')}
              onPress={() => {
                onClose();
                onSendTest();
              }}
              variant="secondary"
              style={styles.testButton}
            />
          </View>
        ) : null}
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
  testSection: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  testButton: {
    marginTop: 10,
  },
});
