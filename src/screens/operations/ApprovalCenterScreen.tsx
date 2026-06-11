import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { ApprovalRequest, useControlCenterStore } from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

type ApprovalFilter = 'pending' | 'resolved' | 'all';

const filterLabels: Array<{ label: string; value: ApprovalFilter }> = [
  { label: 'PENDING', value: 'pending' },
  { label: 'RESOLVED', value: 'resolved' },
  { label: 'ALL', value: 'all' },
];

const approvalKindLabel: Record<ApprovalRequest['kind'], string> = {
  dangerous_command: 'Command',
  file_write: 'File write',
  file_delete: 'Delete',
  git_push: 'Git push',
};

const approvalIcon: Record<ApprovalRequest['kind'], IconName> = {
  dangerous_command: 'terminal',
  file_write: 'code',
  file_delete: 'warning',
  git_push: 'git',
};

export const ApprovalCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const approvals = useControlCenterStore(state => state.approvals);
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const resolveApproval = useControlCenterStore(state => state.resolveApproval);
  const [filter, setFilter] = useState<ApprovalFilter>('pending');

  const filtered = approvals.filter(item => {
    if (filter === 'pending') {
      return item.status === 'pending';
    }
    if (filter === 'resolved') {
      return item.status !== 'pending';
    }
    return true;
  });

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Approvals"
        subtitle="COMMAND / FILE / GIT"
        onBack={navigation.goBack}
        rightAction={<StatusChip label={`${approvals.filter(item => item.status === 'pending').length} PENDING`} type="warning" />}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {filterLabels.map(item => {
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

        {filtered.map(item => {
          const device = devices.find(deviceItem => deviceItem.id === item.deviceId);
          const project = projects.find(projectItem => projectItem.id === item.projectId);
          const pending = item.status === 'pending';
          return (
            <GlassPanel
              key={item.id}
              glowColor={pending ? 'secondary' : 'none'}
              style={styles.approvalCard}>
              <View style={styles.cardHeader}>
                <IconBadge
                  name={approvalIcon[item.kind]}
                  tone={item.risk === 'high' ? 'error' : 'tertiary'}
                  size={42}
                  iconSize={21}
                />
                <View style={styles.titleBlock}>
                  <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                    {approvalKindLabel[item.kind].toUpperCase()}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {item.title}
                  </Text>
                </View>
                <StatusChip
                  label={item.status.toUpperCase()}
                  type={
                    item.status === 'pending'
                      ? 'warning'
                      : item.status === 'approved'
                      ? 'success'
                      : 'error'
                  }
                />
              </View>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {item.summary}
              </Text>
              {item.command ? (
                <Text
                  selectable
                  style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  {item.command}
                </Text>
              ) : null}
              {item.files?.length ? (
                <View style={styles.fileList}>
                  {item.files.map(file => (
                    <Text
                      key={file}
                      numberOfLines={1}
                      style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                      {file}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Meta label="DEVICE" value={device?.name ?? item.deviceId} />
                <Meta label="PROJECT" value={project?.name ?? item.projectId ?? 'none'} />
                <Meta label="RISK" value={item.risk.toUpperCase()} />
                <Meta label="TIME" value={item.createdAt} />
              </View>
              {pending ? (
                <View style={styles.actionRow}>
                  <GlowButton
                    title="APPROVE"
                    onPress={() => resolveApproval(item.id, 'approved')}
                    variant="primary"
                    style={styles.primaryAction}
                  />
                  <GlowButton
                    title="DENY"
                    onPress={() => resolveApproval(item.id, 'denied')}
                    variant="outline"
                    style={styles.secondaryAction}
                  />
                </View>
              ) : item.sessionId ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    navigation.navigate('VibeCodingSession', {
                      sessionId: item.sessionId ?? '',
                    })
                  }
                  style={[
                    styles.openButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                    OPEN SESSION
                  </Text>
                </TouchableOpacity>
              ) : null}
            </GlassPanel>
          );
        })}
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
  approvalCard: {
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
  fileList: {
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  meta: {
    width: '48%',
    gap: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryAction: {
    flex: 1,
  },
  secondaryAction: {
    minWidth: 96,
  },
  openButton: {
    borderWidth: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
