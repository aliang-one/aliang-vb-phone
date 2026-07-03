// Collapsible device selector for the voice→bash confirm step.
//
// Shows the selected device as a single tappable row (online dot + name + cwd +
// chevron). Tapping expands an inline radio list of all entries (no second modal);
// selecting one calls onSelect and collapses. With <2 entries the row renders
// non-interactive (nothing to switch to).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';

export type DevicePickerEntry = {
  id: string;
  name: string;
  platform?: string;
  online: boolean;
  cwd: string;
};

export interface DevicePickerProps {
  entries: DevicePickerEntry[];
  selectedId: string | undefined;
  onSelect: (entry: DevicePickerEntry) => void;
}

export const DevicePicker: React.FC<DevicePickerProps> = ({ entries, selectedId, onSelect }) => {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = entries.find(e => e.id === selectedId) ?? entries[0];
  if (!selected) return null;
  const expandable = entries.length >= 2;

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="device-picker-toggle"
        disabled={!expandable}
        onPress={() => setOpen(value => !value)}
        style={[styles.row, { borderColor: theme.colors.outlineVariant }]}
      >
        <Text style={{ color: selected.online ? theme.colors.primary : theme.colors.onSurfaceVariant }}>
          {selected.online ? '●' : '○'}
        </Text>
        <View style={styles.label}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {selected.name}
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {selected.cwd}
          </Text>
        </View>
        {expandable && (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {open ? '▴' : '▾'}
          </Text>
        )}
      </Pressable>

      {open && expandable && (
        <View testID="device-picker-list" style={[styles.list, { borderColor: theme.colors.outlineVariant }]}>
          {entries.map(entry => {
            const active = entry.id === selected.id;
            return (
              <Pressable
                key={entry.id}
                testID={`device-picker-entry-${entry.id}`}
                onPress={() => {
                  onSelect(entry);
                  setOpen(false);
                }}
                style={styles.entry}
              >
                <Text style={{ color: entry.online ? theme.colors.primary : theme.colors.onSurfaceVariant }}>
                  {active ? '●' : '○'}
                </Text>
                <View style={styles.label}>
                  <Text
                    style={[theme.typography.codeSm, { color: active ? theme.colors.primary : theme.colors.onSurface }]}
                    numberOfLines={1}
                  >
                    {entry.name}
                  </Text>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                    {entry.cwd}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    flex: 1,
    flexShrink: 1,
  },
  list: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
});
