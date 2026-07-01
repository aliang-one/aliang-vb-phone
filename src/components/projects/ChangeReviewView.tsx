import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { CodeDiffViewer } from '../code/CodeDiffViewer';
import type { DiffLine } from '../../data/platformModels';
import type { SessionFileChange } from '../../utils/diff/sessionChanges';
import { parseUnifiedDiff } from '../../utils/diff/parseUnifiedDiff';

/** 当前文件 diff 的加载状态。 */
export type DiffLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface ChangeReviewViewProps {
  /** collectFileChanges 产出的有序文件列表。 */
  changes: SessionFileChange[];
  /** 当前翻页索引。 */
  index: number;
  /** 当前文件解析后的 diff 行（仅 state==='ready' 时有意义）。 */
  diffLines: DiffLine[];
  diffState: DiffLoadState;
  /** detail 是否被 16KB 截断。 */
  truncated: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
}

const baseName = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;

/** changeKind → 单字母徽章。 */
export function changeBadgeLetter(c: SessionFileChange): string {
  if (c.renamedFrom) return 'R';
  if (c.changeKind === 'create') return 'A';
  if (c.changeKind === 'delete') return 'D';
  return 'M'; // edit / unknown
}

/** 徽章配色（固定语义色，深/浅主题都可读）。 */
function badgeColor(c: SessionFileChange): string {
  if (c.renamedFrom) return '#2196f3'; // R - 蓝
  if (c.changeKind === 'create') return '#4caf50'; // A - 绿
  if (c.changeKind === 'delete') return '#f44336'; // D - 红
  return '#ffb300'; // M - 琥珀
}

/**
 * 把一条 file_change 的 detail（`fetchStructuredEventDetail` 的返回）投影成
 * 视图可直接渲染的状态：无 text → empty；有 text → 解析后的行 + ready。
 * 截断标志透传。纯函数，供屏壳与测试复用，避免加载逻辑重复。
 */
export function deriveDiffView(detail: {
  text?: string;
  truncated: boolean;
}): { lines: DiffLine[]; state: DiffLoadState; truncated: boolean } {
  if (!detail.text) {
    return { lines: [], state: 'empty', truncated: false };
  }
  return {
    lines: parseUnifiedDiff(detail.text),
    state: 'ready',
    truncated: detail.truncated,
  };
}

/**
 * Codex 式 diff 审核的展示型视图：文件翻页 + 逐行红绿 diff。
 * 不读 store / 导航，全部数据经 props 传入，便于隔离测试。
 */
export const ChangeReviewView: React.FC<ChangeReviewViewProps> = ({
  changes,
  index,
  diffLines,
  diffState,
  truncated,
  onPrev,
  onNext,
  onRetry,
}) => {
  const { theme } = useTheme();
  const total = changes.length;

  const mainColor = theme.colors.onSurface;
  const subColor = theme.colors.onSurfaceVariant;

  if (total === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[theme.typography.bodyMd, { color: mainColor }]}>
          没有未提交的改动
        </Text>
      </View>
    );
  }

  const current = changes[index];
  const atStart = index <= 0;
  const atEnd = index >= total - 1;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity testID="cr-prev-top" onPress={onPrev} disabled={atStart}>
          <Text
            style={{
              color: theme.colors.primary,
              opacity: atStart ? 0.3 : 1,
              fontSize: 22,
            }}>
            {'‹'}
          </Text>
        </TouchableOpacity>
        <Text style={[theme.typography.labelSm, { color: subColor }]}>
          {`${index + 1}/${total}`}
        </Text>
        <TouchableOpacity testID="cr-next-top" onPress={onNext} disabled={atEnd}>
          <Text
            style={{
              color: theme.colors.primary,
              opacity: atEnd ? 0.3 : 1,
              fontSize: 22,
            }}>
            {'›'}
          </Text>
        </TouchableOpacity>
        <Text style={[styles.badge, { color: badgeColor(current) }]}>
          {changeBadgeLetter(current)}
        </Text>
        <Text
          style={[theme.typography.bodyMd, styles.name, { color: mainColor }]}
          numberOfLines={1}>
          {baseName(current.path)}
        </Text>
        <Text style={[theme.typography.codeSm, { color: '#4caf50' }]}>
          {`+${current.added ?? 0}`}
        </Text>
        <Text style={[theme.typography.codeSm, { color: '#f44336' }]}>
          {`-${current.removed ?? 0}`}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        {diffState === 'loading' && (
          <View style={{ padding: 12 }}>
            <Text style={[theme.typography.bodyMd, { color: subColor }]}>加载中…</Text>
          </View>
        )}
        {diffState === 'ready' && (
          <>
            <CodeDiffViewer lines={diffLines} />
            {truncated && (
              <Text
                style={[theme.typography.labelSm, { color: subColor, padding: 8 }]}>
                diff 已截断，仅显示前 16KB
              </Text>
            )}
          </>
        )}
        {diffState === 'empty' && (
          <View style={{ padding: 12 }}>
            <Text style={[theme.typography.bodyMd, { color: subColor }]}>无 diff</Text>
          </View>
        )}
        {diffState === 'error' && (
          <View style={{ padding: 12 }}>
            <Text style={[theme.typography.bodyMd, { color: mainColor }]}>
              加载 diff 失败
            </Text>
            <TouchableOpacity testID="cr-retry" onPress={onRetry} style={{ marginTop: 8 }}>
              <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
                重试
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity testID="cr-prev" onPress={onPrev} disabled={atStart}>
          <Text
            style={[
              theme.typography.labelSm,
              { color: mainColor, opacity: atStart ? 0.3 : 1 },
            ]}>
            上一个
          </Text>
        </TouchableOpacity>
        <TouchableOpacity testID="cr-next" onPress={onNext} disabled={atEnd}>
          <Text
            style={[
              theme.typography.labelSm,
              { color: mainColor, opacity: atEnd ? 0.3 : 1 },
            ]}>
            下一个
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, columnGap: 8 },
  badge: { width: 20, textAlign: 'center', fontWeight: '700' },
  name: { flex: 1 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
