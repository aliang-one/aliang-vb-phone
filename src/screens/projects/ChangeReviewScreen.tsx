import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { ChangeReviewView, deriveDiffView } from '../../components/projects/ChangeReviewView';
import type { DiffLoadState } from '../../components/projects/ChangeReviewView';
import type { DiffLine } from '../../data/platformModels';
import {
  collectFileChanges,
  pickChangesWithDiff,
  sessionsForProject,
} from '../../utils/diff/sessionChanges';
import type { SessionFileChange } from '../../utils/diff/sessionChanges';
import { fetchStructuredEventDetail } from '../../api/sessions';

type ReviewRoute = RouteProp<RootStackParamList, 'ChangeReview'>;

/**
 * 「AI 改动审核」屏：从文件浏览器进入，翻页审核本项目会话里 AI 改过的文件。
 *
 * 纯接线：路由取 projectId → store 取 vibeRuns → `sessionsForProject`/
 * `collectFileChanges` 算文件列表 → `fetchStructuredEventDetail` 拉每个文件的
 * diff（本地按 eventId 缓存）→ `deriveDiffView` 投影 → `ChangeReviewView` 渲染。
 * 数据链路、解析、视图均有单测覆盖；本文件只是把它们粘起来。
 */
export const ChangeReviewScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<ReviewRoute>();
  const { theme, isDark } = useTheme();
  const { projectId } = route.params;
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const loadAgentSessionDetail = useControlCenterStore(
    state => state.loadAgentSessionDetail,
  );

  const sessions = useMemo(
    () => sessionsForProject(vibeRuns, projectId),
    [vibeRuns, projectId],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(sessions[0]?.id);
  const selected = sessions.find(s => s.id === selectedId) ?? sessions[0];

  // 只展示真正有 diff 的文件。入屏/切会话时：水合 structuredEvents（列表快照不
  // 带）→ 预取该会话所有 file_change 的 detail → 用 pickChangesWithDiff 过滤掉
  // 无 diff 的（否则审核页会出现「无 diff」空泡）→ 缓存以便翻页即时命中。
  // 单个 loading 标志贯穿全程（避免空态闪烁）。
  const [changes, setChanges] = useState<SessionFileChange[]>([]);
  const [loading, setLoading] = useState(() => Boolean(sessions[0]));
  // eventId 全局唯一（se_<sha>），做缓存键；翻页命中即免重取。
  const cacheRef = useRef<Record<string, { text?: string; truncated: boolean }>>({});
  useEffect(() => {
    if (!selected) {
      setChanges([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const sessionId = selected.id;
    loadAgentSessionDetail(sessionId)
      .then(() => {
        // structuredEvents 现已水合入 store；直接读该会话的 file_change。
        const run = useControlCenterStore.getState().vibeRuns.find(r => r.id === sessionId);
        const fcs = collectFileChanges(run?.structuredEvents ?? []);
        if (fcs.length === 0) {
          if (!cancelled) {
            setChanges([]);
            setLoading(false);
          }
          return;
        }
        return Promise.all(
          fcs.map(fc =>
            fetchStructuredEventDetail(sessionId, fc.eventId)
              .then(detail => ({ fc, detail }))
              .catch(() => null),
          ),
        ).then(results => {
          if (cancelled) return;
          for (const r of results) {
            if (r) cacheRef.current[r.fc.eventId] = r.detail;
          }
          setChanges(pickChangesWithDiff(results));
          setLoading(false);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setChanges([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, loadAgentSessionDetail]);

  const [index, setIndex] = useState(0);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [diffState, setDiffState] = useState<DiffLoadState>('idle');
  const [truncated, setTruncated] = useState(false);

  // 切换会话 → 回到第一个文件
  useEffect(() => {
    setIndex(0);
  }, [selected?.id]);

  // changes 缩短时把 index 回夹到合法区间
  useEffect(() => {
    if (changes.length && index > changes.length - 1) {
      setIndex(Math.max(0, changes.length - 1));
    }
  }, [changes.length, index]);

  const current = changes[index];

  const loadDiff = useCallback(
    (eventId: string, sessionId: string, useCache: boolean) => {
      const cached = cacheRef.current[eventId];
      if (useCache && cached) {
        const view = deriveDiffView(cached);
        setDiffLines(view.lines);
        setDiffState(view.state);
        setTruncated(view.truncated);
        return;
      }
      setDiffState('loading');
      fetchStructuredEventDetail(sessionId, eventId)
        .then(detail => {
          cacheRef.current[eventId] = detail;
          const view = deriveDiffView(detail);
          setDiffLines(view.lines);
          setDiffState(view.state);
          setTruncated(view.truncated);
        })
        .catch(() => setDiffState('error'));
    },
    [],
  );

  useEffect(() => {
    if (!selected || !current) {
      setDiffState('idle');
      return;
    }
    loadDiff(current.eventId, selected.id, true);
  }, [selected?.id, current?.eventId, loadDiff]);

  const onPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const onNext = useCallback(() => setIndex(i => i + 1), []);
  const onRetry = useCallback(() => {
    if (!selected || !current) return;
    delete cacheRef.current[current.eventId];
    loadDiff(current.eventId, selected.id, false);
  }, [selected, current, loadDiff]);

  const safeIndex = changes.length ? Math.min(index, changes.length - 1) : 0;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="AI 改动审核"
        subtitle={sessions.length ? `${sessions.length} 个会话` : undefined}
        onBack={navigation.goBack}
      />
      {sessions.length > 1 && (
        <ScrollView
          horizontal
          style={styles.sessionRow}
          showsHorizontalScrollIndicator={false}>
          {sessions.map(s => {
            const active = s.id === selected?.id;
            return (
              <TouchableOpacity
                key={s.id}
                testID={`cr-session-${s.id}`}
                onPress={() => setSelectedId(s.id)}
                style={[
                  styles.sessionChip,
                  active && styles.sessionChipActive,
                  {
                    borderWidth: 1,
                    borderRadius: 999,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86,156,214,0.14)'
                        : 'rgba(0,81,174,0.08)'
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
                  ]}
                  numberOfLines={1}>
                  {s.title || s.objective || s.id}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <View style={{ flex: 1 }}>
        {loading && changes.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <ChangeReviewView
            changes={changes}
            index={safeIndex}
            diffLines={diffLines}
            diffState={changes.length ? diffState : 'idle'}
            truncated={truncated}
            onPrev={onPrev}
            onNext={onNext}
            onRetry={onRetry}
          />
        )}
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  sessionRow: { maxHeight: 44, paddingVertical: 4 },
  sessionChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    borderRadius: 999,
    opacity: 0.55,
  },
  sessionChipActive: { opacity: 1 },
});
