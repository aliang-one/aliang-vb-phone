import React, { useCallback, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';
import type { ControlCenterState } from '../../store/types';

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
  tool: 'Tool',
  client_response: 'Response',
};

const approvalIcon: Record<ApprovalRequest['kind'], IconName> = {
  dangerous_command: 'terminal',
  file_write: 'code',
  file_delete: 'warning',
  git_push: 'git',
  tool: 'agent',
  client_response: 'approval',
};

export const ApprovalCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const approvals = useControlCenterStore(state => state.approvals);
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const resolveApproval = useControlCenterStore(state => state.resolveApproval);
  const handleOpenSession = useCallback(
    (sessionId: string) =>
      navigation.navigate('VibeCodingSession', { sessionId }),
    [navigation],
  );
  const [filter, setFilter] = useState<ApprovalFilter>('pending');

  const filtered = approvals.filter(item => {
    if (filter === 'pending') {
      return item.status === 'pending';
    }
    if (filter === 'resolved') {
      return item.status !== 'pending';
    }
    return true;
  }).sort((left, right) => newestFirst(left.createdAt, right.createdAt));
  const approvalList = useIncrementalList(filtered, {
    initialCount: 16,
    step: 16,
    resetKey: filter,
  });
  const pendingCount = approvals.filter(item => item.status === 'pending').length;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Approvals"
        subtitle="COMMAND / FILE / GIT"
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={`${pendingCount} PENDING`}
            type={pendingCount ? 'warning' : 'neutral'}
          />
        }
      />
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        data={approvalList.visibleItems}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const device = devices.find(deviceItem => deviceItem.id === item.deviceId);
          const project = projects.find(projectItem => projectItem.id === item.projectId);
          return (
            <ApprovalCard
              item={item}
              deviceName={device?.name ?? item.deviceId ?? ''}
              deviceOffline={device?.status === 'offline'}
              projectName={project?.name ?? item.projectId ?? 'none'}
              resolveApproval={resolveApproval}
              onOpenSession={handleOpenSession}
            />
          );
        }}
        removeClippedSubviews
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={7}
        ListHeaderComponent={
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
                          ? 'rgba(86, 156, 214, 0.12)'
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
        }
        ListEmptyComponent={
          <GlassPanel style={styles.emptyPanel}>
            <IconBadge name="approval" tone="neutral" size={42} iconSize={21} />
            <View style={styles.emptyCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurfaceVariant }]}>
                No approvals
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                当前筛选下没有需要处理的审批。
              </Text>
            </View>
          </GlassPanel>
        }
        ListFooterComponent={
          <LoadMoreRow
            visibleCount={approvalList.visibleCount}
            totalCount={approvalList.totalCount}
            onPress={approvalList.showMore}
          />
        }
      />
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

interface ApprovalCardProps {
  item: ApprovalRequest;
  deviceName: string;
  deviceOffline: boolean;
  projectName: string;
  resolveApproval: ControlCenterState['resolveApproval'];
  onOpenSession: (sessionId: string) => void;
}

const ApprovalCard: React.FC<ApprovalCardProps> = React.memo(
  ({ item, deviceName, deviceOffline, projectName, resolveApproval, onOpenSession }) => {
    const { theme } = useTheme();
    const pending = item.status === 'pending';
    const kindLabel = approvalKindLabel[item.kind] ?? 'Request';
    const iconName = approvalIcon[item.kind] ?? 'approval';
    const optionChoices = item.options ?? [];
    return (
      <GlassPanel
        glowColor={pending ? 'secondary' : 'none'}
        style={styles.approvalCard}>
        <View style={styles.cardHeader}>
          <IconBadge
            name={iconName}
            tone={item.risk === 'high' ? 'error' : 'tertiary'}
            size={42}
            iconSize={21}
          />
          <View style={styles.titleBlock}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
              {kindLabel.toUpperCase()}
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
          <Meta label="DEVICE" value={`${deviceName}${deviceOffline ? ' · 离线' : ''}`} />
          <Meta label="PROJECT" value={projectName} />
          <Meta label="RISK" value={item.risk.toUpperCase()} />
          <Meta label="TIME" value={item.createdAt} />
        </View>
        {pending && optionChoices.length ? (
          <View style={styles.optionActionStack}>
            {optionChoices.map(option => {
              const decision = option.id === 'deny' ? 'denied' : 'approved';
              return (
                <GlowButton
                  key={option.id}
                  title={option.label.toUpperCase()}
                  onPress={() =>
                    resolveApproval(item.id, decision, {
                      selectedOptionId: option.id,
                      message: option.response,
                    })
                  }
                  disabled={deviceOffline}
                  variant={decision === 'denied' ? 'outline' : 'primary'}
                />
              );
            })}
          </View>
        ) : pending ? (
          <View style={styles.actionRow}>
            <GlowButton
              title="APPROVE"
              disabled={deviceOffline}
              onPress={() => resolveApproval(item.id, 'approved')}
              variant="primary"
              style={styles.primaryAction}
            />
            <GlowButton
              title="DENY"
              disabled={deviceOffline}
              onPress={() => resolveApproval(item.id, 'denied')}
              variant="outline"
              style={styles.secondaryAction}
            />
          </View>
        ) : item.sessionId ? (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => onOpenSession(item.sessionId ?? '')}
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
  },
);
ApprovalCard.displayName = 'ApprovalCard';

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
  optionActionStack: {
    gap: 8,
  },
  openButton: {
    borderWidth: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyPanel: {
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    opacity: 0.68,
  },
  emptyCopy: {
    flex: 1,
    gap: 4,
  },
});
