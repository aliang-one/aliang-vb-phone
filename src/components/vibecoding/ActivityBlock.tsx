import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { GlassPanel } from '../shared/GlassPanel';
import { CodeHighlight } from '../shared/CodeHighlight';
import { summarizeActivity } from '../../utils/activitySummary';
import { fetchStructuredEventDetail } from '../../api/sessions';
import type { StructuredActivityEvent } from '../../data/platformModels';
import { THINKING_RENDER_BUCKET_CHARS } from '../../utils/activityRenderMemo';

/**
 * Thinking is transient and rendered separately while active. Tool/file/task
 * records stay in their own activity block after the turn settles.
 */
export interface ActivityBlockProps {
  sessionId: string;
  events: StructuredActivityEvent[];
  detailCache: Record<string, { text?: string; truncated?: boolean }>;
  onCacheDetail: (
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void;
  /**
   * L2:这一回合是否已经 settle(球回到用户)。仅影响空档兜底标题:
   *  - true(默认,历史回合 / 已结束)→ 「已完成」
   *  - false(最新回合仍在流式,处于两次 API 请求的空档)→ 「处理中…」
   * 由 TranscriptMessageList 按 liveMessageId 计算。
   */
  turnSettled?: boolean;
}

export const ActivityBlock: React.FC<ActivityBlockProps> = React.memo(
  ({ sessionId, events, detailCache, onCacheDetail, turnSettled = true }) => {
    const activeThinking = events.filter(
      (event): event is Extract<StructuredActivityEvent, { kind: 'thinking' }> =>
        event.kind === 'thinking' && event.active,
    );
    const persistentEvents = events.filter(event => event.kind !== 'thinking');

    return (
      <>
        {activeThinking.length > 0 ? (
          <LiveThinkingBlock
            sessionId={sessionId}
            events={activeThinking}
            detailCache={detailCache}
            onCacheDetail={onCacheDetail}
          />
        ) : null}
        {persistentEvents.length > 0 ? (
          <ToolActivityBlock
            sessionId={sessionId}
            events={persistentEvents}
            detailCache={detailCache}
            onCacheDetail={onCacheDetail}
            turnSettled={turnSettled}
          />
        ) : null}
      </>
    );
  },
);
ActivityBlock.displayName = 'ActivityBlock';

const LiveThinkingBlock: React.FC<{
  sessionId: string;
  events: Extract<StructuredActivityEvent, { kind: 'thinking' }>[];
  detailCache: Record<string, { text?: string; truncated?: boolean }>;
  onCacheDetail: ActivityBlockProps['onCacheDetail'];
}> = ({ sessionId, events, detailCache, onCacheDetail }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeActivity(events, false);

  if (!summary) return null;

  return (
    <GlassPanel style={styles.block}>
      <TouchableOpacity
        testID="thinking-activity-header"
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('activity.collapse') : t('activity.expand')}
        onPress={() => setExpanded(value => !value)}
        style={styles.header}>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
            styles.caret,
          ]}>
          {expanded ? '▾' : '▸'}
        </Text>
        <ActivityIndicator
          size="small"
          color={theme.colors.primary}
          style={styles.spinner}
        />
        <Text
          style={[
            theme.typography.labelMd,
            { color: theme.colors.onSurface },
            styles.headline,
          ]}
          numberOfLines={1}>
          {summary.headline}
        </Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.body}>
          <View style={styles.group}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
                styles.groupLabel,
              ]}>
              {t('activity.thinkingGroupLabel')}
            </Text>
            {events.map(event => (
              <ThinkingRow
                key={event.eventId}
                sessionId={sessionId}
                event={event}
                detailCache={detailCache}
                onCacheDetail={onCacheDetail}
              />
            ))}
          </View>
        </View>
      ) : null}
    </GlassPanel>
  );
};

const ToolActivityBlock: React.FC<ActivityBlockProps> = ({
  sessionId,
  events,
  detailCache,
  onCacheDetail,
  turnSettled = true,
}) => {
    const { theme } = useTheme();
    const { t } = useTranslation('vibecoding');
    const [expanded, setExpanded] = useState(false);

    const summary = summarizeActivity(events, turnSettled);
    if (!summary) return null;

    const metaParts: string[] = [];
    if (summary.fileCount > 0) metaParts.push(`📝×${summary.fileCount}`);
    if (summary.commandCount > 0) metaParts.push(`⚙×${summary.commandCount}`);
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
          testID="activity-header"
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? t('activity.collapse') : t('activity.expand')
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
                  {t('activity.commandsLabel')}
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
                  {t('activity.filesLabel')}
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
};

// ---------------------------------------------------------------------------
// Lazy-fetch hook — shared by ThinkingRow / CommandRow / FileChangeRow
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
  const requestInFlight = useRef(false);

  const ensureDetail = useCallback(async () => {
    if (detailCache[eventId] || requestInFlight.current) return;
    requestInFlight.current = true;
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
      requestInFlight.current = false;
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

// ---------------------------------------------------------------------------
// ThinkingRow
// ---------------------------------------------------------------------------

const THINKING_DETAIL_CHUNK_CHARS = 4_000;

const ThinkingRowBase: React.FC<
  RowProps & {
    event: Extract<StructuredActivityEvent, { kind: 'thinking' }>;
  }
> = ({ sessionId, event, detailCache, onCacheDetail }) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [open, setOpen] = useState(false);
  const [visibleChars, setVisibleChars] = useState(THINKING_DETAIL_CHUNK_CHARS);
  const { loading, ensureDetail, cached } = useDetail(
    sessionId,
    event.eventId,
    detailCache,
    onCacheDetail,
  );
  const visibleText = useMemo(
    () => cached?.text?.slice(0, visibleChars),
    [cached?.text, visibleChars],
  );
  const hasMore = Boolean(cached?.text && cached.text.length > visibleChars);

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
        testID={`thinking-row-${event.eventId}`}
        activeOpacity={0.7}
        accessibilityRole="button"
        onPress={handlePress}
        style={styles.rowMain}>
        <Text
          style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {open ? '▾' : '▸'} {t('activity.thinkingLabel')}
        </Text>
        <Badge
          text={t('activity.thinkingChars', { count: event.chars })}
          tone="info"
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.detailWrap}>
          {loading ? (
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('activity.loading')}
            </Text>
          ) : visibleText ? (
            <>
              <Text
                selectable
                style={[
                  theme.typography.codeSm,
                  { color: theme.colors.onSurface },
                ]}
              >
                {visibleText}
              </Text>
              {hasMore ? (
                <TouchableOpacity
                  testID={`thinking-show-more-${event.eventId}`}
                  accessibilityRole="button"
                  onPress={() =>
                    setVisibleChars(value =>
                      Math.min(
                        value + THINKING_DETAIL_CHUNK_CHARS,
                        cached?.text?.length ?? value,
                      ),
                    )
                  }
                  style={styles.showMoreButton}
                >
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.primary },
                    ]}
                  >
                    {t('activity.showMore')}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {cached?.truncated && !hasMore ? (
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                    styles.trunc,
                  ]}
                >
                  {t('activity.thinkingTruncated')}
                </Text>
              ) : null}
            </>
          ) : cached && cached.text === '' ? (
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('activity.detailUnavailable')}
            </Text>
          ) : cached ? (
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('activity.noThinking')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const ThinkingRow = React.memo(ThinkingRowBase, (previous, next) => {
  const previousBucket = Math.floor(
    previous.event.chars / THINKING_RENDER_BUCKET_CHARS,
  );
  const nextBucket = Math.floor(
    next.event.chars / THINKING_RENDER_BUCKET_CHARS,
  );
  return (
    previous.sessionId === next.sessionId &&
    previous.event.eventId === next.event.eventId &&
    previous.event.active === next.event.active &&
    previousBucket === nextBucket &&
    previous.detailCache[previous.event.eventId] ===
      next.detailCache[next.event.eventId] &&
    previous.onCacheDetail === next.onCacheDetail
  );
});
ThinkingRow.displayName = 'ThinkingRow';

const statusBadge = (
  status: string,
  exitCode: number | null | undefined,
  t: TFunction<'vibecoding'>,
): { text: string; tone: BadgeTone } => {
  switch (status) {
    case 'completed':
      return { text: `✓ exit ${exitCode ?? '?'}`, tone: 'success' };
    case 'interrupted':
      return { text: t('activity.statusInterrupted'), tone: 'warning' };
    case 'started':
    default:
      return { text: '…', tone: 'info' };
  }
};

const CommandRowBase: React.FC<
  RowProps & {
    event: Extract<StructuredActivityEvent, { kind: 'command' }>;
  }
> = ({ sessionId, event, detailCache, onCacheDetail }) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [open, setOpen] = useState(false);
  const { loading, ensureDetail, cached } = useDetail(
    sessionId,
    event.eventId,
    detailCache,
    onCacheDetail,
  );

  const badge = statusBadge(event.status, event.exitCode, t);

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
          ⚙ {event.command ?? t('activity.commandPlaceholder')}
        </Text>
        <Badge text={badge.text} tone={badge.tone} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.detailWrap}>
          {loading ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('activity.loading')}
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
                  {t('activity.outputTruncated')}
                </Text>
              ) : null}
            </>
          ) : cached && cached.text === '' ? (
            // Failure sentinel (text:'' on catch): show "详情不可用".
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('activity.detailUnavailable')}
            </Text>
          ) : cached ? (
            // Fetched but API returned no content field.
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('activity.noOutput')}
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

const fileBadgeLabel = (
  changeKind: string | undefined,
  t: TFunction<'vibecoding'>,
): { text: string; tone: BadgeTone } => {
  switch (changeKind) {
    case 'create':
      return { text: t('activity.badgeCreate'), tone: 'success' };
    case 'delete':
      return { text: t('activity.badgeDelete'), tone: 'error' };
    case 'rename':
      return { text: t('activity.badgeRename'), tone: 'info' };
    case 'edit':
    default:
      return { text: t('activity.badgeEdit'), tone: 'info' };
  }
};

const CommandRow = React.memo(
  CommandRowBase,
  (previous, next) =>
    previous.sessionId === next.sessionId &&
    previous.event.eventId === next.event.eventId &&
    previous.event.status === next.event.status &&
    previous.event.exitCode === next.event.exitCode &&
    previous.event.command === next.event.command &&
    previous.detailCache[previous.event.eventId] ===
      next.detailCache[next.event.eventId] &&
    previous.onCacheDetail === next.onCacheDetail,
);
CommandRow.displayName = 'CommandRow';

// ---------------------------------------------------------------------------
// FileChangeRow
// ---------------------------------------------------------------------------

const FileChangeRowBase: React.FC<
  RowProps & {
    event: Extract<StructuredActivityEvent, { kind: 'file_change' }>;
  }
> = ({ sessionId, event, detailCache, onCacheDetail }) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [open, setOpen] = useState(false);
  const { loading, ensureDetail, cached } = useDetail(
    sessionId,
    event.eventId,
    detailCache,
    onCacheDetail,
  );

  const badge = fileBadgeLabel(event.changeKind, t);
  const hasCounts =
    typeof event.added === 'number' || typeof event.removed === 'number';
  const counts =
    hasCounts ? `+${event.added ?? 0}/-${event.removed ?? 0}` : null;
  const label = event.renamedFrom
    ? `${event.renamedFrom} → ${event.path}`
    : event.path ?? t('activity.filePlaceholder');

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
              {t('activity.loading')}
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
                  {t('activity.diffTruncated')}
                </Text>
              ) : null}
            </>
          ) : cached && cached.text === '' ? (
            // Failure sentinel (text:'' on catch): show "详情不可用".
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('activity.detailUnavailable')}
            </Text>
          ) : cached ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('activity.noDiff')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const FileChangeRow = React.memo(
  FileChangeRowBase,
  (previous, next) =>
    previous.sessionId === next.sessionId &&
    previous.event.eventId === next.event.eventId &&
    previous.event.changeKind === next.event.changeKind &&
    previous.event.path === next.event.path &&
    previous.event.renamedFrom === next.event.renamedFrom &&
    previous.event.added === next.event.added &&
    previous.event.removed === next.event.removed &&
    previous.detailCache[previous.event.eventId] ===
      next.detailCache[next.event.eventId] &&
    previous.onCacheDetail === next.onCacheDetail,
);
FileChangeRow.displayName = 'FileChangeRow';

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
  const { t } = useTranslation('vibecoding');
  return (
    <View style={styles.group}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
          styles.groupLabel,
        ]}>
        {t('activity.tasksLabel')}
      </Text>
      {event.tasks.map((task, i) => (
        <View key={`${i}-${task.subject}`} style={styles.taskRow}>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.onSurface },
            ]}>
            {taskMark(task.status)} {task.subject}
          </Text>
          {task.status === 'in_progress' && task.active_form ? (
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
                styles.taskSub,
              ]}
              numberOfLines={1}>
              {task.active_form}
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
    bgDark: 'rgba(86, 156, 214, 0.15)',
    bgLight: 'rgba(0, 81, 174, 0.1)',
    fg: '#569CD6',
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
  showMoreButton: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
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
