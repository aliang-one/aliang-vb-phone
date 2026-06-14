import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import {
  UnifiedEventStatus,
  UnifiedEventType,
  useControlCenterStore,
} from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type EventStreamRoute = RouteProp<RootStackParamList, 'EventStream'>;

const filters: Array<{ label: string; value: 'all' | UnifiedEventType }> = [
  { label: 'ALL', value: 'all' },
  { label: 'TERM', value: 'terminal.output' },
  { label: 'AGENT', value: 'agent.delta' },
  { label: 'CMD', value: 'command.started' },
  { label: 'APPROVAL', value: 'approval.requested' },
  { label: 'FILE', value: 'file.changed' },
  { label: 'PLATFORM', value: 'platform.event' },
];

const eventStatusType: Record<
  UnifiedEventStatus,
  'info' | 'success' | 'warning' | 'error' | 'neutral'
> = {
  info: 'info',
  running: 'info',
  waiting: 'warning',
  done: 'success',
  failed: 'error',
};

const eventIcon: Record<UnifiedEventType, IconName> = {
  'terminal.output': 'terminal',
  'agent.delta': 'agent',
  'platform.event': 'event',
  'command.started': 'play',
  'command.completed': 'check',
  'approval.requested': 'approval',
  'file.changed': 'code',
  'device.bound': 'device',
  'device.offline': 'warning',
  'project.updated': 'project',
  'project.scan.completed': 'scan',
  'agent.session.started': 'agent',
  'agent.session.paused': 'pause',
  'agent.session.resumed': 'play',
  'agent.session.completed': 'check',
  'agent.session.failed': 'warning',
  'agent.session.terminated': 'stop',
};

export const EventStreamScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<EventStreamRoute>();
  const events = useControlCenterStore(state => state.events);
  const [filter, setFilter] = useState<'all' | UnifiedEventType>('all');

  const filtered = events.filter(item => {
    const matchesType = filter === 'all' || item.type === filter;
    const matchesDevice =
      !route.params?.deviceId || item.deviceId === route.params.deviceId;
    const matchesSession =
      !route.params?.sessionId || item.sessionId === route.params.sessionId;
    return matchesType && matchesDevice && matchesSession;
  });

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Event Stream"
        subtitle="UNIFIED AGENT PROTOCOL"
        onBack={navigation.goBack}
        rightAction={<StatusChip label={`${filtered.length}`} type="info" />}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {filters.map(item => {
            const active = item.value === filter;
            return (
              <TouchableOpacity
                key={item.value}
                activeOpacity={0.75}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.filterChip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(0, 209, 255, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
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

        {filtered.map(item => (
          <GlassPanel key={item.id} style={styles.eventCard}>
            <View style={styles.eventTop}>
              <IconBadge
                name={eventIcon[item.type]}
                tone={item.status === 'failed' ? 'error' : item.status === 'waiting' ? 'tertiary' : 'primary'}
                size={40}
                iconSize={20}
              />
              <View style={styles.titleBlock}>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {item.title}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  {item.type}
                </Text>
              </View>
              <StatusChip
                label={item.status.toUpperCase()}
                type={eventStatusType[item.status]}
              />
            </View>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {item.detail}
            </Text>
            <View style={styles.metaGrid}>
              <Meta label="TIME" value={item.timestamp} />
              <Meta label="DEVICE" value={item.deviceId ?? 'none'} />
              <Meta label="SESSION" value={item.sessionId ?? 'none'} />
              <Meta label="TERMINAL" value={item.terminalId ?? 'none'} />
            </View>
            {item.payload ? (
              <View
                style={[
                  styles.payloadBox,
                  {
                    borderColor: theme.colors.outlineVariant,
                    borderRadius: theme.borderRadius.md,
                  },
                ]}>
                {Object.entries(item.payload).map(([key, value]) => (
                  <Text
                    key={key}
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {key}: {String(value)}
                  </Text>
                ))}
              </View>
            ) : null}
          </GlassPanel>
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface MetaProps {
  label: string;
  value: string;
}

const Meta: React.FC<MetaProps> = ({ label, value }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.meta}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
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
  eventCard: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  eventTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  meta: {
    width: '48%',
    gap: 3,
  },
  payloadBox: {
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
});
