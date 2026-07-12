import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useToastStore } from '../../store/toastStore';

/**
 * Global toast overlay. Mounted once at the root; visibility/message/type come
 * from `useToastStore`, which auto-hides 1.5s after `show()`. `pointerEvents`
 * is none so it never blocks interaction underneath.
 */
export const ToastViewport: React.FC = () => {
  const { theme } = useTheme();
  const visible = useToastStore(s => s.visible);
  const message = useToastStore(s => s.message);
  const type = useToastStore(s => s.type);

  if (!visible || !message) {
    return null;
  }

  const isError = type === 'error';
  const backgroundColor = isError ? theme.colors.error : theme.colors.primary;
  const textColor = isError ? theme.colors.onError : theme.colors.onPrimary;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={[styles.pill, { backgroundColor }]}>
        <Text style={[styles.text, { color: textColor }]} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pill: {
    marginTop: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    maxWidth: '85%',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
