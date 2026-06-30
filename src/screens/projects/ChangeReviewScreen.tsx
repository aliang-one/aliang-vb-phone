import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  sessionsForProject,
} from '../../utils/diff/sessionChanges';
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
  const { theme } = useTheme();
  const { projectId } = route.params;
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);

  const sessions = useMemo(
    () => sessionsForProject(vibeRuns, projectId),
    [vibeRuns, projectId],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(sessions[0]?.id);
  const selected = sessions.find(s => s.id === selectedId) ?? sessions[0];

  const changes = useMemo(
    () => (selected ? collectFileChanges(selected.structuredEvents) : []),
    [selected],
  );

  const [index, setIndex] = useState(0);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [diffState, setDiffState] = useState<DiffLoadState>('idle');
  const [truncated, setTruncated] = useState(false);
  // eventId 全局唯一（se_<sha>），直接做缓存键；会话内/跨会话翻页命中即免重取。
  const cacheRef = useRef<Record<string, { text?: string; truncated: boolean }>>({});

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
                style={[styles.sessionChip, active && styles.sessionChipActive]}>
                <Text style={theme.typography.labelSm} numberOfLines={1}>
                  {s.title || s.objective || s.id}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <View style={{ flex: 1 }}>
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
