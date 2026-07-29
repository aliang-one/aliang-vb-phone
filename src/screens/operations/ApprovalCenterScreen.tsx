import React, { useCallback, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  ApprovalRequest,
  useStableVibeRuns,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { newestFirst } from '../../utils/timeSort';
import { useTranslation } from 'react-i18next';
import { ApprovalQuickPolicySheet } from '../../components/vibecoding/ApprovalQuickPolicySheet';
import { ApprovalCustomReply } from '../../components/vibecoding/ApprovalCustomReply';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

type ApprovalFilter = 'pending' | 'resolved' | 'all';

const filterValues: ApprovalFilter[] = ['pending', 'resolved', 'all'];

const approvalKindKey: Record<ApprovalRequest['kind'], string> = {
  dangerous_command: 'approval.kindCommand',
  file_write: 'approval.kindFileWrite',
  file_delete: 'approval.kindDelete',
  git_push: 'approval.kindGitPush',
  tool: 'approval.kindTool',
  client_response: 'approval.kindResponse',
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
  const { t } = useTranslation('operations');
  const navigation = useNavigation<Navigation>();
  const approvals = useControlCenterStore(state => state.approvals);
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useStableVibeRuns();
  const resolveApproval = useControlCenterStore(state => state.resolveApproval);
  const [resolvingApproval, setResolvingApproval] = useState<{
    id: string;
    decision: 'approved' | 'denied';
    selectedOptionId?: string;
  } | null>(null);
  const [quickPolicyFor, setQuickPolicyFor] = useState<{
    approvalId: string;
    projectId: string;
    toolName?: string;
  } | null>(null);
  const handleOpenSession = useCallback(
    (sessionId: string) =>
      navigation.navigate('VibeCodingSession', { sessionId }),
    [navigation],
  );
  const [filter, setFilter] = useState<ApprovalFilter>('pending');

  const handleResolveApproval = useCallback(
    (
      approvalId: string,
      decision: 'approved' | 'denied',
      options?: { selectedOptionId?: string; message?: string },
    ) => {
      if (resolvingApproval) return;
      setResolvingApproval({
        id: approvalId,
        decision,
        selectedOptionId: options?.selectedOptionId,
      });
      resolveApproval(approvalId, decision, options)
        .catch(error => {
          console.warn('[approvals] failed to resolve approval', error);
        })
        .finally(() => setResolvingApproval(null));
    },
    [resolveApproval, resolvingApproval],
  );

  const filtered = approvals
    .filter(item => {
      if (filter === 'pending') {
        return item.status === 'pending';
      }
      if (filter === 'resolved') {
        return item.status !== 'pending';
      }
      return true;
    })
    .sort((left, right) => newestFirst(left.createdAt, right.createdAt));
  const approvalList = useIncrementalList(filtered, {
    initialCount: 16,
    step: 16,
    resetKey: filter,
  });
  const pendingCount = approvals.filter(
    item => item.status === 'pending',
  ).length;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('approval.title')}
        subtitle={t('approval.subtitle')}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={t('approval.pendingCount', { count: pendingCount })}
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
          const device = devices.find(
            deviceItem => deviceItem.id === item.deviceId,
          );
          // Older ai.approval.request rows did not persist projectId. Recover it
          // from the owning session so existing pending cards still expose the
          // project-scoped policy actions.
          const projectId =
            item.projectId ??
            (item.sessionId
              ? vibeRuns.find(run => run.id === item.sessionId)?.projectId
              : undefined);
          const project = projects.find(
            projectItem => projectItem.id === projectId,
          );
          return (
            <ApprovalCard
              item={item}
              deviceName={device?.name ?? item.deviceId ?? ''}
              deviceOffline={device?.status === 'offline'}
              projectName={
                project?.name ?? projectId ?? t('approval.projectNone')
              }
              resolvingApproval={resolvingApproval}
              onResolve={handleResolveApproval}
              onOpenPolicy={
                projectId
                  ? () =>
                      setQuickPolicyFor({
                        approvalId: item.id,
                        projectId,
                        toolName: item.toolName,
                      })
                  : undefined
              }
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
            contentContainerStyle={styles.filters}
          >
            {filterValues.map(value => {
              const active = value === filter;
              const label =
                value === 'pending'
                  ? t('approval.filterPending')
                  : value === 'resolved'
                  ? t('approval.filterResolved')
                  : t('approval.filterAll');
              return (
                <TouchableOpacity
                  key={value}
                  activeOpacity={0.75}
                  onPress={() => setFilter(value)}
                  style={[
                    styles.filterChip,
                    active
                      ? isDark
                        ? styles.filterChipActiveDark
                        : styles.filterChipActiveLight
                      : styles.filterChipInactive,
                    {
                      borderRadius: theme.borderRadius.full,
                      borderColor: active
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.labelSm,
                      {
                        color: active
                          ? theme.colors.primary
                          : theme.colors.onSurfaceVariant,
                      },
                    ]}
                  >
                    {label}
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
              <Text
                style={[
                  theme.typography.titleMd,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {t('approval.emptyTitle')}
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {t('approval.emptyBody')}
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
      <ApprovalQuickPolicySheet
        projectId={quickPolicyFor?.projectId ?? ''}
        toolName={quickPolicyFor?.toolName}
        open={quickPolicyFor !== null}
        onClose={() => setQuickPolicyFor(null)}
        onApplied={() => {
          const target = quickPolicyFor;
          if (!target) return;
          handleResolveApproval(target.approvalId, 'approved');
        }}
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
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
        ]}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}
      >
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
  resolvingApproval: {
    id: string;
    decision: 'approved' | 'denied';
    selectedOptionId?: string;
  } | null;
  onResolve: (
    approvalId: string,
    decision: 'approved' | 'denied',
    options?: { selectedOptionId?: string; message?: string },
  ) => void;
  onOpenPolicy?: () => void;
  onOpenSession: (sessionId: string) => void;
}

const ApprovalCard: React.FC<ApprovalCardProps> = React.memo(
  ({
    item,
    deviceName,
    deviceOffline,
    projectName,
    resolvingApproval,
    onResolve,
    onOpenPolicy,
    onOpenSession,
  }) => {
    const { theme } = useTheme();
    const { t } = useTranslation('operations');
    const pending = item.status === 'pending';
    const resolving = resolvingApproval?.id === item.id;
    const anotherApprovalResolving = Boolean(
      resolvingApproval && resolvingApproval.id !== item.id,
    );
    const actionsDisabled = deviceOffline || anotherApprovalResolving;
    const kindLabel = t(approvalKindKey[item.kind] ?? 'approval.kindFallback');
    const iconName = approvalIcon[item.kind] ?? 'approval';
    const optionChoices = item.options ?? [];
    return (
      <GlassPanel
        glowColor={pending ? 'secondary' : 'none'}
        style={styles.approvalCard}
      >
        <View style={styles.cardHeader}>
          <IconBadge
            name={iconName}
            tone={item.risk === 'high' ? 'error' : 'tertiary'}
            size={42}
            iconSize={21}
          />
          <View style={styles.titleBlock}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.primary },
              ]}
            >
              {kindLabel.toUpperCase()}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                theme.typography.titleMd,
                { color: theme.colors.onSurface },
              ]}
            >
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
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {item.summary}
        </Text>
        {item.command ? (
          <View
            style={[
              styles.detailBlock,
              {
                backgroundColor: theme.colors.surfaceContainerLow,
                borderColor: theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
              },
            ]}
          >
            <Text
              selectable
              style={[theme.typography.codeSm, { color: theme.colors.primary }]}
            >
              {item.command}
            </Text>
          </View>
        ) : null}
        {item.files?.length ? (
          <View
            style={[
              styles.detailBlock,
              styles.fileList,
              {
                backgroundColor: theme.colors.surfaceContainerLow,
                borderColor: theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
              },
            ]}
          >
            {item.files.map(file => (
              <Text
                key={file}
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {file}
              </Text>
            ))}
          </View>
        ) : null}
        <View
          style={[
            styles.metaRow,
            { borderTopColor: theme.colors.outlineVariant },
          ]}
        >
          <Meta
            label={t('approval.metaDevice')}
            value={`${deviceName}${
              deviceOffline ? t('approval.offlineSuffix') : ''
            }`}
          />
          <Meta label={t('approval.metaProject')} value={projectName} />
          <Meta
            label={t('approval.metaRisk')}
            value={item.risk.toUpperCase()}
          />
          <Meta label={t('approval.metaTime')} value={item.createdAt} />
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
                    onResolve(item.id, decision, {
                      selectedOptionId: option.id,
                      message: option.response,
                    })
                  }
                  loading={
                    resolving &&
                    resolvingApproval?.selectedOptionId === option.id
                  }
                  disabled={actionsDisabled}
                  variant={decision === 'denied' ? 'outline' : 'primary'}
                  style={styles.optionAction}
                />
              );
            })}
            {onOpenPolicy ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('approval.actionMore')}
                testID={`approval-more-${item.id}`}
                disabled={deviceOffline || Boolean(resolvingApproval)}
                onPress={onOpenPolicy}
                style={styles.moreLink}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {t('approval.actionMore')} ···
                </Text>
              </TouchableOpacity>
            ) : null}
            {item.kind === 'client_response' && (
              <ApprovalCustomReply
                approvalId={item.id}
                triggerLabel={t('approval.customReply')}
                placeholder={t('approval.customReplyPlaceholder')}
                sendLabel={t('approval.customReplySend')}
                disabled={actionsDisabled}
                onSend={msg => onResolve(item.id, 'approved', { message: msg })}
              />
            )}
          </View>
        ) : pending ? (
          <View style={styles.actionRow}>
            <GlowButton
              title={t('approval.actionApprove')}
              disabled={actionsDisabled}
              loading={resolving && resolvingApproval?.decision === 'approved'}
              onPress={() => onResolve(item.id, 'approved')}
              variant="primary"
              style={styles.primaryAction}
            />
            <GlowButton
              title={t('approval.actionDeny')}
              disabled={actionsDisabled}
              loading={resolving && resolvingApproval?.decision === 'denied'}
              onPress={() => onResolve(item.id, 'denied')}
              variant="outline"
              style={styles.secondaryAction}
            />
            {onOpenPolicy ? (
              <GlowButton
                title={t('approval.actionMore')}
                testID={`approval-more-${item.id}`}
                disabled={deviceOffline || Boolean(resolvingApproval)}
                onPress={onOpenPolicy}
                variant="outline"
                style={styles.moreAction}
                textStyle={styles.moreActionText}
              />
            ) : null}
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
            ]}
          >
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.primary }]}
            >
              {t('approval.openSession')}
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
  filterChipActiveDark: {
    backgroundColor: 'rgba(86, 156, 214, 0.12)',
  },
  filterChipActiveLight: {
    backgroundColor: 'rgba(0, 81, 174, 0.08)',
  },
  filterChipInactive: {
    backgroundColor: 'transparent',
  },
  approvalCard: {
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  detailBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  fileList: {
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
  },
  meta: {
    width: '48%',
    gap: 3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  primaryAction: {
    flex: 2,
    minHeight: 52,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 10,
  },
  moreAction: {
    minWidth: 64,
    minHeight: 52,
    paddingHorizontal: 8,
  },
  moreActionText: {
    fontSize: 11,
  },
  optionActionStack: {
    gap: 8,
  },
  optionAction: {
    alignSelf: 'stretch',
    minHeight: 48,
  },
  moreLink: {
    alignSelf: 'flex-end',
    paddingHorizontal: 4,
    paddingVertical: 7,
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
