import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { TerminalCard } from '../../components/cards/TerminalCard';
import { SearchBar } from '../../components/input/SearchBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { mockTerminals } from '../../data/mockData';

export const TerminalListScreen: React.FC = () => {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');

  const filtered = mockTerminals.filter(
    t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.host.includes(search),
  );

  const groups = [...new Set(filtered.map(t => t.group))];

  return (
    <SafeAreaWrapper>
      <TopAppBar title="Terminals" subtitle="SSH NODES" />
      <View style={styles.searchContainer}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search terminals..." />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Summary */}
        <View style={styles.summary}>
          <StatusChip label={`${filtered.length} NODES`} type="info" />
          <StatusChip
            label={`${filtered.filter(t => t.status === 'active').length} ACTIVE`}
            type="success"
          />
          <StatusChip
            label={`${filtered.filter(t => t.status === 'error').length} ERROR`}
            type="error"
          />
        </View>

        {/* Grouped terminals */}
        {groups.map(group => (
          <View key={group} style={styles.group}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
                styles.groupTitle,
              ]}>
              {group.toUpperCase()}
            </Text>
            {filtered
              .filter(t => t.group === group)
              .map(terminal => (
                <TerminalCard key={terminal.id} terminal={terminal} />
              ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  summary: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  group: {
    marginTop: 12,
  },
  groupTitle: {
    marginBottom: 8,
  },
});
