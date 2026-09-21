import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';

export type FileMenuActionTone = 'default' | 'primary' | 'danger';

export interface FileMenuAction {
  label: string;
  onPress: () => void;
  tone?: FileMenuActionTone;
}

interface FileLongPressMenuProps {
  visible: boolean;
  fileName: string;
  onClose: () => void;
  actions: FileMenuAction[];
}

/**
 * Long-press menu for a single file row (FileBrowserScreen). Same modal shape
 * as the DeviceControlCard long-press menu — transparent fade Modal over a
 * full-screen scrim Pressable with a GlassPanel action grid — kept local
 * rather than shared: repo convention is one menu per surface.
 */
export const FileLongPressMenu: React.FC<FileLongPressMenuProps> = ({
  visible,
  fileName,
  onClose,
  actions,
}) => {
  const { theme, isDark } = useTheme();

  const renderMenuAction = (action: FileMenuAction) => {
    const tone = action.tone ?? 'default';
    const color =
      tone === 'danger'
        ? theme.colors.tertiary
        : tone === 'primary'
        ? theme.colors.primary
        : theme.colors.onSurface;
    return (
      <TouchableOpacity
        key={action.label}
        style={styles.menuAction}
        activeOpacity={0.7}
        onPress={action.onPress}>
        <Text style={[theme.typography.titleMd, { color }]}>{action.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(2,5,8,0.78)' : 'rgba(12,18,28,0.34)' }]}
        />
        <GlassPanel glowColor="primary" style={styles.menuPanel}>
          <View style={styles.menuHeader}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {fileName}
            </Text>
          </View>
          <View style={styles.actionGrid}>{actions.map(renderMenuAction)}</View>
        </GlassPanel>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  menuPanel: { width: '100%', maxWidth: 420, padding: 16, gap: 12 },
  menuHeader: { gap: 2 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  menuAction: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
});
