import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import {
  mockDevices,
  mockProjects,
  mockVibeCodingRuns,
  VibeStatus,
} from '../../data/mockData';
import { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const filters: Array<{ label: string; value: 'all' | VibeStatus }> = [
  { label: 'ALL', value: 'all' },
  { label: 'RUNNING', value: 'running' },
  { label: 'APPROVAL', value: 'waiting_approval' },
  { label: 'PREVIEW', value: 'preview_ready' },
  { label: 'DONE', value: 'completed' },
];

export const VibeCodingListScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | VibeStatus>('all');

  const filtered = mockVibeCodingRuns.filter(session => {
    const project = mockProjects.find(item => item.id === session.projectId);
    const matchesQuery =
      session.title.toLowerCase().includes(query.toLowerCase()) ||
      session.objective.toLowerCase().includes(query.toLowerCase()) ||
      project?.name.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || session.status === filter;
    return matchesQuery && matchesFilter;
  });

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="VibeCoding"
        subtitle="AGENT SESSIONS"
        rightAction={
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateVibeCoding', {})}
            style={styles.addButton}>
            <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
              +
            </Text>
          </TouchableOpacity>
        }
      />
      <View style={styles.searchContainer}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search sessions..." />
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {filters.map(item => {
            const active = filter === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.filterChip,
                  {
                    borderRadius: theme.borderRadius.full,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(0, 209, 255, 0.15)'
                        : 'rgba(0, 81, 174, 0.1)'
                      : 'transparent',
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.summary}>
          <StatusChip label={`${filtered.length} SESSIONS`} type="info" />
          <StatusChip
            label={`${filtered.filter(item => item.status === 'waiting_approval').length} APPROVAL`}
            type="warning"
          />
          <StatusChip
            label={`${filtered.filter(item => item.previewId).length} PREVIEWS`}
            type="info"
          />
        </View>

        {filtered.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={mockProjects.find(project => project.id === session.projectId)}
            device={mockDevices.find(device => device.id === session.deviceId)}
            onPress={() =>
              navigation.navigate('VibeCodingSession', { sessionId: session.id })
            }
          />
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  addButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  filters: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 10,
  },
  filterChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  summary: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
});
