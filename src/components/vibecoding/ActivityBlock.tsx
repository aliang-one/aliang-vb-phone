import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { CodeHighlight } from '../shared/CodeHighlight';
import { summarizeActivity } from '../../utils/activitySummary';
import { fetchStructuredEventDetail } from '../../api/sessions';
import type { StructuredActivityEvent } from '../../data/platformModels';

/**
 * Collapsed "工具活动" block rendered per assistant turn. Header shows the live
 * headline + counts (from {@link summarizeActivity}) with a spinner while
 * commands/thinking are active; tapping toggles an expandable list of rows
 * grouped commands → files → tasks. Each row lazily fetches its heavy detail
 * (command output / file diff) via {@link fetchStructuredEventDetail} on first
 * open and caches it through the parent-owned `detailCache` / `onCacheDetail`
 * props — this component is purely presentational and never touches the store.
 */
export interface ActivityBlockProps {
  sessionId: string;
  events: StructuredActivityEvent[];
  detailCache: Record<string, { text?: string; truncated?: boolean }>;
  onCacheDetail: (
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void;
}

export const ActivityBlock: React.FC<ActivityBlockProps> = React.memo(
  ({ sessionId, events, detailCache, onCacheDetail }) => {
    const { theme } = useTheme();
    const [expanded, setExpanded] = useState(false);

    const summary = summarizeActivity(events);
    if (!summary) return null;

    const metaParts: string[] = [];
    if (summary.fileCount > 0) metaParts.push(`📝×${summary.fileCount}`);
    if (summary.taskTotal > 0) {
      metaParts.push(`🎯 ${summary.taskDone}/${summary.taskTotal}`);
    }
    if (summary.usageTokens) metaParts.push(`${summary.usageTokens} tok`);

    const commands = events.filter(
      (e): e is Extract<StructuredActivityEvent, { kind: 'command' }> =>
        e.kind === 'command',
    );
    const files = events.filter(
      (e): e is Extract<StructuredActivityEvent, { kind: 'file_change' }> =>
        e.kind === 'file_change',
    );
    const task = events.find(
      (e): e is Extract<StructuredActivityEvent, { kind: 'task' }> =>
        e.kind === 'task',
    );

    return (
      <GlassPanel style={styles.block}>
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? '收起工具活动' : '展开工具活动'
          }
          onPress={() => setExpanded(v => !v)}
          style={styles.header}>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.caret,
            ]}>
            {expanded ? '▾' : '▸'}
          </Text>
          {summary.hasActive ? (
            <ActivityIndicator
              size="small"
              color={theme.colors.primary}
              style={styles.spinner}
            />
          ) : null}
          <Text
            style={[
              theme.typography.labelMd,
              { color: theme.colors.onSurface },
              styles.headline,
            ]}
            numberOfLines={1}>
            {summary.headline}
          </Text>
          {metaParts.length > 0 ? (
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
                styles.meta,
              ]}
              numberOfLines={1}>
              · {metaParts.join(' · ')}
            </Text>
          ) : null}
        </TouchableOpacity>

        {expanded ? (
          <View style={styles.body}>
            {commands.length > 0 ? (
              <View style={styles.group}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                    styles.groupLabel,
                  ]}>
                  命令 COMMANDS
                </Text>
                {commands.map(cmd => (
                  <CommandRow
                    key={cmd.eventId}
                    sessionId={sessionId}
                    event={cmd}
                    detailCache={detailCache}
                    onCacheDetail={onCacheDetail}
                  />
                ))}
              </View>
            ) : null}

            {files.length > 0 ? (
              <View style={styles.group}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                    styles.groupLabel,
                  ]}>
                  文件 FILES
                </Text>
                {files.map(f => (
                  <FileChangeRow
                    key={f.eventId}
                    sessionId={sessionId}
                    event={f}
                    detailCache={detailCache}
                    onCacheDetail={onCacheDetail}
                  />
                ))}
              </View>
            ) : null}

            {task ? <TaskList event={task} /> : null}
          </View>
        ) : null}
      </GlassPanel>
    );
  },
);
ActivityBlock.displayName = 'ActivityBlock';

// ---------------------------------------------------------------------------
// Lazy-fetch hook — shared by CommandRow / FileChangeRow
// ---------------------------------------------------------------------------

/**
 * Per-row local loading flag + the parent-owned cache lookup. On first open we
 * fetch via {@link fetchStructuredEventDetail}; success caches `{text,truncated}`
 * and failure caches `{text: undefined}` as an attempted sentinel so the UI can
 * distinguish "not fetched yet" (no entry) from "fetched, no content".
 */
const useDetail = (
  sessionId: string,
  eventId: string,
  detailCache: Record<string, { text?: string; truncated?: boolean }>,
  onCacheDetail: (
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void,
) => {
  const [loading, setLoading] = useState(false);

  const ensureDetail = useCallback(async () => {
    if (detailCache[eventId]) return;
    setLoading(true);
    try {
      const r = await fetchStructuredEventDetail(sessionId, eventId);
      onCacheDetail(eventId, { text: r.text, truncated: r.truncated });
    } catch {
      // Sentinel: empty-string text distinguishes "attempted, no content /
      // failed" from "not fetched yet" (no cache entry), so the row shows
      // "详情不可用" instead of re-fetching on every open.
      onCacheDetail(eventId, { text: '', truncated: false });
    } finally {
      setLoading(false);
    }
  }, [sessionId, eventId, detailCache, onCacheDetail]);

  return { loading, ensureDetail, cached: detailCache[eventId] };
};

// ---------------------------------------------------------------------------
// CommandRow
// ---------------------------------------------------------------------------

interface RowProps {
  sessionId: string;
  detailCache: Record<string, { text?: string; truncated?: boolean }>;
  onCacheDetail: (
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void;
}

const statusBadge = (
  status: string,
  exitCode: number | null | undefined,
): { text: string; tone: BadgeTone } => {
  switch (status) {
    case 'completed':
      return { text: `✓ exit ${exitCode ?? '?'}`, tone: 'success' };
    case 'interrupted':
      return { text: '⊘ 中断', tone: 'warning' };
    case 'started':
    default:
      return { text: '…', tone: 'info' };
  }
};

const CommandRow: React.FC<
  RowProps & {
    event: Extract<StructuredActivityEvent, { kind: 'command' }>;
  }
> = ({ sessionId, event, detailCache, onCacheDetail }) => {
  const { theme, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const { loading, ensureDetail, cached } = useDetail(
    sessionId,
    event.eventId,
    detailCache,
    onCacheDetail,
  );

  const badge = statusBadge(event.status, event.exitCode);

  const handlePress = () => {
    const next = !open;
    setOpen(next);
    if (next) ensureDetail();
  };

  return (
    <View
      style={[
        styles.row,
        { borderColor: isDark ? 'rgba(255,255,255,0.06)' : theme.colors.outlineVariant },
      ]}>
      <TouchableOpacity
        activeOpacity={0.7}
        accessibilityRole="button"
        onPress={handlePress}
        style={styles.rowMain}>
        <Text
          style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}
          numberOfLines={open ? undefined : 1}>
          ⚙ {event.command ?? '(命令)'}
        </Text>
        <Badge text={badge.text} tone={badge.tone} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.detailWrap}>
          {loading ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              加载中…
            </Text>
          ) : cached && cached.text ? (
            <>
              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                {cached.text}
              </Text>
              {cached.truncated ? (
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                    styles.trunc,
                  ]}>
                  · 输出已截断
                </Text>
              ) : null}
            </>
          ) : cached && cached.text === '' ? (
            // Failure sentinel (text:'' on catch): show "详情不可用".
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              详情不可用
            </Text>
          ) : cached ? (
            // Fetched but API returned no content field.
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              无输出
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// FileChangeRow
// ---------------------------------------------------------------------------

const fileBadgeLabel = (changeKind?: string): { text: string; tone: BadgeTone } => {
  switch (changeKind) {
    case 'create':
      return { text: '+ 新建', tone: 'success' };
    case 'delete':
      return { text: '− 删除', tone: 'error' };
    case 'rename':
      return { text: '⇄ 重命名', tone: 'info' };
    case 'edit':
    default:
      return { text: '✎ 编辑', tone: 'info' };
  }
};

const FileChangeRow: React.FC<
  RowProps & {
    event: Extract<StructuredActivityEvent, { kind: 'file_change' }>;
  }
> = ({ sessionId, event, detailCache, onCacheDetail }) => {
  const { theme, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const { loading, ensureDetail, cached } = useDetail(
    sessionId,
    event.eventId,
    detailCache,
    onCacheDetail,
  );

  const badge = fileBadgeLabel(event.changeKind);
  const hasCounts =
    typeof event.added === 'number' || typeof event.removed === 'number';
  const counts =
    hasCounts ? `+${event.added ?? 0}/-${event.removed ?? 0}` : null;
  const label = event.renamedFrom
    ? `${event.renamedFrom} → ${event.path}`
    : event.path ?? '(文件)';

  const handlePress = () => {
    const next = !open;
    setOpen(next);
    if (next) ensureDetail();
  };

  return (
    <View
      style={[
        styles.row,
        { borderColor: isDark ? 'rgba(255,255,255,0.06)' : theme.colors.outlineVariant },
      ]}>
      <TouchableOpacity
        activeOpacity={0.7}
        accessibilityRole="button"
        onPress={handlePress}
        style={styles.rowMain}>
        <View style={styles.fileLabelWrap}>
          <Text
            style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}
            numberOfLines={open ? undefined : 1}>
            📝 {label}
          </Text>
          {counts ? (
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
                styles.counts,
              ]}>
              {counts}
            </Text>
          ) : null}
        </View>
        <Badge text={badge.text} tone={badge.tone} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.detailWrap}>
          {loading ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              加载中…
            </Text>
          ) : cached && cached.text ? (
            <>
              <CodeHighlight
                code={cached.text}
                language="diff"
                style={theme.typography.codeSm}
              />
              {cached.truncated ? (
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                    styles.trunc,
                  ]}>
                  · diff 已截断
                </Text>
              ) : null}
            </>
          ) : cached && cached.text === '' ? (
            // Failure sentinel (text:'' on catch): show "详情不可用".
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              详情不可用
            </Text>
          ) : cached ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              无 diff
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// TaskList
// ---------------------------------------------------------------------------

const taskMark = (status: string): string => {
  switch (status) {
    case 'completed':
      return '☑';
    case 'in_progress':
      return '◶';
    case 'pending':
    default:
      return '☐';
  }
};

const TaskList: React.FC<{
  event: Extract<StructuredActivityEvent, { kind: 'task' }>;
}> = ({ event }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.group}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
          styles.groupLabel,
        ]}>
        任务 TASKS
      </Text>
      {event.tasks.map((t, i) => (
        <View key={`${i}-${t.subject}`} style={styles.taskRow}>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.onSurface },
            ]}>
            {taskMark(t.status)} {t.subject}
          </Text>
          {t.status === 'in_progress' && t.active_form ? (
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
                styles.taskSub,
              ]}
              numberOfLines={1}>
              {t.active_form}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

type BadgeTone = 'success' | 'warning' | 'error' | 'info';

const badgeStyles: Record<
  BadgeTone,
  { bgDark: string; bgLight: string; fg: string }
> = {
  success: {
    bgDark: 'rgba(106, 153, 85, 0.15)',
    bgLight: 'rgba(0, 120, 84, 0.1)',
    fg: '#6A9955',
  },
  warning: {
    bgDark: 'rgba(206, 145, 120, 0.15)',
    bgLight: 'rgba(180, 120, 0, 0.1)',
    fg: '#CE9178',
  },
  error: {
    bgDark: 'rgba(205, 92, 92, 0.15)',
    bgLight: 'rgba(180, 40, 40, 0.1)',
    fg: '#C53030',
  },
  info: {
    bgDark: 'rgba(86, 156, 214, 0.15)',
    bgLight: 'rgba(0, 81, 174, 0.1)',
    fg: '#569CD6',
  },
};

const Badge: React.FC<{ text: string; tone: BadgeTone }> = ({ text, tone }) => {
  const { theme, isDark } = useTheme();
  const s = badgeStyles[tone];
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: isDark ? s.bgDark : s.bgLight,
          borderRadius: theme.borderRadius.full,
        },
      ]}>
      <Text
        style={[theme.typography.labelSm, { color: s.fg }]}
        numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
};

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  block: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  caret: {
    fontSize: 11,
    width: 12,
  },
  spinner: {
    marginLeft: -2,
  },
  headline: {
    flexShrink: 1,
  },
  meta: {
    flexShrink: 1,
  },
  body: {
    marginTop: 8,
    gap: 10,
  },
  group: {
    gap: 6,
  },
  groupLabel: {
    letterSpacing: 0.6,
    marginBottom: 1,
  },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 6,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fileLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  counts: {
    opacity: 0.85,
  },
  detailWrap: {
    marginTop: 2,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  trunc: {
    marginTop: 4,
  },
  taskRow: {
    gap: 1,
  },
  taskSub: {
    opacity: 0.8,
    marginLeft: 18,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 0,
  },
});
