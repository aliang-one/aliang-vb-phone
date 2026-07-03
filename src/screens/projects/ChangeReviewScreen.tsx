import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { ChangeReviewView } from '../../components/projects/ChangeReviewView';
import type { DiffLoadState } from '../../components/projects/ChangeReviewView';
import type { DiffLine } from '../../data/platformModels';
import type { SessionFileChange } from '../../utils/diff/sessionChanges';
import { parseUnifiedDiff } from '../../utils/diff/parseUnifiedDiff';
import { fetchWorkingTreeDiff } from '../../api/projects';
import type { WorkingTreeFileDiff } from '../../api/projects';
import { describeDeviceError } from '../../utils/deviceError';
import { useTranslation } from 'react-i18next';

type ReviewRoute = RouteProp<RootStackParamList, 'ChangeReview'>;

// 把 live-git 状态词表对齐到 ChangeReviewView 的徽章词表。
const statusToChangeKind = (s: string): string => {
  if (s === 'added') return 'create';
  if (s === 'deleted') return 'delete';
  return 'edit'; // modified / unknown
};

/**
 * 「改动审核」屏：展示本项目**当前工作区未提交的 git diff**（已跟踪改动 +
 * 未跟踪新文件），翻页逐文件审核。覆盖手改 + AI 未提交的改动；AI 已 commit
 * 的不在此（那是 git log）。
 *
 * 数据源是 agent 的 `git diff HEAD`（经 server `/working-tree-diff`）——不再
 * 是 AI 会话的 file_change 事件，所以手动改的文件也会出现。
 */
export const ChangeReviewScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<ReviewRoute>();
  const { theme } = useTheme();
  const { t } = useTranslation('projects');
  const { projectId } = route.params;

  const [entries, setEntries] = useState<WorkingTreeFileDiff[] | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setEntries(null);
    fetchWorkingTreeDiff(projectId)
      .then(r => {
        if (!cancelled) setEntries(r.entries ?? []);
      })
      .catch(e => {
        if (!cancelled) {
          setError(describeDeviceError(e)?.title || t('changeReview.loadFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadTick, t]);

  // entries 缩短时把 index 回夹到合法区间
  useEffect(() => {
    if (entries && index > entries.length - 1) {
      setIndex(Math.max(0, entries.length - 1));
    }
  }, [entries, index]);

  const changes = useMemo<SessionFileChange[]>(
    () =>
      (entries ?? []).map(e => ({
        path: e.path,
        changeKind: statusToChangeKind(e.status),
        added: e.added,
        removed: e.removed,
        eventId: e.path,
        messageId: '',
        itemId: '',
      })),
    [entries],
  );

  const currentEntry = entries ? entries[index] : undefined;
  const diffLines = useMemo<DiffLine[]>(
    () => (currentEntry ? parseUnifiedDiff(currentEntry.diff) : []),
    [currentEntry],
  );

  const onPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const onNext = useCallback(() => setIndex(i => i + 1), []);
  const onRetry = useCallback(() => setReloadTick(t => t + 1), []);

  const safeIndex = changes.length ? Math.min(index, changes.length - 1) : 0;
  const diffState: DiffLoadState = !entries
    ? 'loading'
    : changes.length === 0
      ? 'idle'
      : currentEntry?.diff
        ? 'ready'
        : 'empty';

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('changeReview.title')}
        subtitle={entries ? t('changeReview.filesCount', { count: changes.length }) : undefined}
        onBack={navigation.goBack}
      />
      {error ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
            {error}
          </Text>
          <TouchableOpacity onPress={onRetry} style={{ marginTop: 12 }} testID="cr-retry">
            <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
              {t('changeReview.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : !entries ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ChangeReviewView
            changes={changes}
            index={safeIndex}
            diffLines={diffLines}
            diffState={diffState}
            truncated={false}
            onPrev={onPrev}
            onNext={onNext}
            onRetry={onRetry}
          />
        </View>
      )}
    </SafeAreaWrapper>
  );
};
