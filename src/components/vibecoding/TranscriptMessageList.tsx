import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconBadge } from '../visual/IconBadge';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { ActivityBlock } from './ActivityBlock';
import type { StructuredActivityEvent } from '../../data/platformModels';
import type {
  TranscriptCalloutSegment,
  DisplayTranscriptMessage,
  TranscriptFoldedSegment,
  TranscriptGoalReportSegment,
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
  TranscriptSegment,
} from '../../utils/agentTranscript';

/**
 * Detail-passthrough shape for the lazily-fetched heavy detail of a structured
 * event (mirrors `VibeCodingRun.eventDetailCache`). Kept inline so this
 * presentational component has no store import.
 */
export type ActivityDetailCache = Record<
  string,
  { text?: string; truncated?: boolean }
>;

interface TranscriptMessageListProps {
  /** Single message to render (this component renders at most one bubble).
   *  Passing one stable reference instead of a fresh `[message]` array each
   *  render lets React.memo skip unchanged bubbles during streaming. */
  message?: DisplayTranscriptMessage;
  onMessageLayout?: (messageId: string, y: number, height: number) => void;
  /**
   * When provided, an `ActivityBlock` is rendered under this assistant bubble
   * from events pre-grouped by the owning screen. That keeps streaming updates
   * from forcing every historical bubble to filter the full activity list.
   */
  activitySessionId?: string;
  /** Fallback only; normal bubbles receive pre-grouped `messageActivityEvents`. */
  structuredEvents?: StructuredActivityEvent[];
  messageActivityEvents?: StructuredActivityEvent[];
  orphanActivityEventsByMessageId?: ReadonlyMap<string, StructuredActivityEvent[]>;
  activityDetailCache?: ActivityDetailCache;
  onCacheActivityDetail?: (
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void;
  /**
   * Assistant message ids that produced no display bubble (tool-only turns
   * whose empty prose was skipped by `buildDisplayTranscript`) but still have
   * structured events. Each renders a standalone activity bubble after the
   * transcript. Built by the owning screen so this component doesn't import
   * the run.
   */
  orphanActivityMessageIds?: string[];
  /**
   * L2:当前仍在流式的最新助手消息 id(由会话屏按 lastActivityMs 窗口算出)。
   * 提供时,属于该消息的 ActivityBlock 在请求空档显示「处理中…」而非「已完成」;
   * 未提供(undefined / null)时所有块都按已 settle 处理(显示「已完成」)。
   */
  liveMessageId?: string;
  /** Retry a failed-to-send user bubble (only fired for `message.failed`). */
  onRetryFailed?: (messageId: string) => void;
  /** Discard a failed-to-send user bubble (only fired for `message.failed`). */
  onDismissFailed?: (messageId: string) => void;
  /**
   * Turn-failed retry (case B): the user message reached the agent but no reply
   * came back (session.status 'failed'). When `turnFailedMessageId` matches a
   * NON-`failed` user bubble, render a small "未收到回复 · 重试" affordance under
   * it; retry re-sends the same content as a fresh turn (the server's
   * claimAiSessionForRun flips the session back to running). Distinct from
   * `onRetryFailed` (case A, client send failure): the message is real, so there
   * is no "删除" — only 重试.
   */
  turnFailedMessageId?: string;
  onRetryTurn?: (messageId: string) => void;
  /** Position of this row in the visible conversation rail. */
  timelinePosition?: TimelinePosition;
}

type TimelinePosition = 'single' | 'start' | 'middle' | 'end';

const roleLabel: Record<DisplayTranscriptMessage['role'], string> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
};

const foldedToneColor = (
  tone: TranscriptFoldedSegment['tone'],
  colors: ReturnType<typeof useTheme>['theme']['colors'],
) => {
  if (tone === 'warning') return colors.tertiary;
  if (tone === 'info') return colors.primary;
  return colors.onSurfaceVariant;
};

const countLines = (value: string) =>
  value.trim() ? value.trim().split(/\r?\n/).length : 0;

const compactText = (value: string, max = 72) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
};

const inlinePlainText = (nodes: TranscriptMarkdownInline[]): string =>
  nodes
    .map(node => {
      if (node.kind === 'text') return node.content;
      if (node.kind === 'inlineCode') return node.content;
      if (node.kind === 'commandName') return node.content;
      if (node.kind === 'commandArgs') return node.content;
      if (node.kind === 'image') return node.alt;
      return inlinePlainText(node.children);
    })
    .join('');

const markdownBlockSummary = (
  block: TranscriptMarkdownBlock,
  t: TFunction<'vibecoding'>,
): string | undefined => {
  if (block.kind === 'folded') return block.label;
  if (block.kind === 'heading') return compactText(inlinePlainText(block.children), 56);
  if (block.kind === 'paragraph') return compactText(inlinePlainText(block.children));
  if (block.kind === 'quote') return compactText(inlinePlainText(block.children));
  if (block.kind === 'list') return `${block.items.length} items`;
  if (block.kind === 'table')
    return t('transcript.tableSummary', { count: block.rows.length + 1 });
  if (block.kind === 'thematicBreak') return undefined;

  const language = block.language ? `${block.language.toUpperCase()} code` : 'Code';
  return `${language} · ${countLines(block.content)} lines`;
};

const systemMessageSummary = (
  message: DisplayTranscriptMessage,
  t: TFunction<'vibecoding'>,
) => {
  const labels: string[] = [];
  for (const segment of message.segments) {
    if (segment.kind === 'folded') {
      labels.push(segment.label);
    } else if (segment.kind === 'callout') {
      labels.push(segment.title);
    } else if (segment.kind === 'goalReport') {
      labels.push(
        `${t('transcript.reportTitle')} · ${t(
          `transcript.reportOutcome.${segment.outcome}`,
        )}`,
      );
    } else {
      for (const block of segment.blocks) {
        const summary = markdownBlockSummary(block, t);
        if (summary) labels.push(summary);
        if (labels.length >= 2) break;
      }
    }
    if (labels.length >= 2) break;
  }
  return labels.length ? labels.join(' · ') : t('transcript.systemFallback');
};

const isTimelineStart = (position: TimelinePosition | undefined) =>
  position === 'start' || position === 'single';

const isTimelineEnd = (position: TimelinePosition | undefined) =>
  position === 'end' || position === 'single';

const TranscriptMessageListBase: React.FC<TranscriptMessageListProps> = ({
  message,
  onMessageLayout,
  activitySessionId,
  structuredEvents,
  messageActivityEvents,
  orphanActivityEventsByMessageId,
  activityDetailCache,
  onCacheActivityDetail,
  orphanActivityMessageIds,
  liveMessageId,
  onRetryFailed,
  onDismissFailed,
  turnFailedMessageId,
  onRetryTurn,
  timelinePosition = 'middle',
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  // Render at most one bubble; the owning screen passes a single message.
  const items = message ? [message] : [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const hasActivity =
    Boolean(activitySessionId) &&
    Boolean(onCacheActivityDetail) &&
    Boolean(
      messageActivityEvents || orphanActivityEventsByMessageId || structuredEvents,
    );

  const toggleSegment = (segmentId: string) => {
    setExpanded(current => ({
      ...current,
      [segmentId]: !current[segmentId],
    }));
  };

  const lineColor = isDark
    ? 'rgba(255,255,255,0.1)'
    : theme.colors.outlineVariant;
  const nodeBorderColor = isDark ? 'rgba(17, 20, 23, 0.98)' : theme.colors.surface;

  const renderTimelineNode = (
    name: 'user' | 'event' | 'agent',
    tone: 'secondary' | 'neutral' | 'primary',
    accentColor: string,
    position: TimelinePosition = 'middle',
  ) => {
    const starts = isTimelineStart(position);
    const ends = isTimelineEnd(position);
    return (
      <View style={styles.timelineNodeRail}>
        <View
          style={[
            styles.timelineSegment,
            styles.timelineSegmentTop,
            starts ? styles.timelineSegmentTopStart : null,
            { backgroundColor: lineColor },
          ]}
        />
        <View
          style={[
            styles.timelineSegment,
            styles.timelineSegmentBottom,
            ends ? styles.timelineSegmentBottomEnd : null,
            { backgroundColor: lineColor },
          ]}
        />
        {starts ? (
          <View
            style={[
              styles.timelineStartCap,
              {
                backgroundColor: accentColor,
                borderColor: nodeBorderColor,
              },
            ]}
          />
        ) : null}
        <IconBadge
          name={name}
          tone={tone}
          size={28}
          iconSize={14}
          filled={starts || ends}
          style={styles.timelineNodeIcon}
        />
        {ends ? (
          <View
            style={[
              styles.timelineEndCap,
              {
                backgroundColor: accentColor,
                borderColor: nodeBorderColor,
              },
            ]}
          />
        ) : null}
      </View>
    );
  };

  const renderInline = (
    node: TranscriptMarkdownInline,
    key: string,
  ): React.ReactNode => {
    if (node.kind === 'text') {
      return node.content ? <Text key={key}>{node.content}</Text> : null;
    }

    if (node.kind === 'strong') {
      return (
        <Text key={key} style={styles.strongText}>
          {node.children.map((child, index) =>
            renderInline(child, `${key}:strong:${index}`),
          )}
        </Text>
      );
    }

    if (node.kind === 'emphasis') {
      return (
        <Text key={key} style={styles.emphasisText}>
          {node.children.map((child, index) =>
            renderInline(child, `${key}:emphasis:${index}`),
          )}
        </Text>
      );
    }

    if (node.kind === 'strikethrough') {
      return (
        <Text key={key} style={styles.strikethroughText}>
          {node.children.map((child, index) =>
            renderInline(child, `${key}:strike:${index}`),
          )}
        </Text>
      );
    }

    if (node.kind === 'inlineCode') {
      return (
        <Text
          key={key}
          style={[
            theme.typography.codeSm,
            styles.inlineCode,
            {
              color: theme.colors.onSurface,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.09)'
                : theme.colors.surfaceContainer,
            },
          ]}
        >
          {node.content}
        </Text>
      );
    }

    if (node.kind === 'link') {
      return (
        <Text
          key={key}
          style={[styles.linkText, { color: theme.colors.primary }]}
        >
          {node.children.map((child, index) =>
            renderInline(child, `${key}:link:${index}`),
          )}
        </Text>
      );
    }

    if (node.kind === 'image') {
      // 安全策略:消息里的 URL 是 AI 产出的任意地址,不直接加载远程图
      // (避免 IP 泄露/无超时/大图爆内存)。渲染为「[alt] url」占位文本,
      // 与 link 一致为纯样式文本(长按可复制)。
      return (
        <Text key={key} style={styles.imageChip}>
          {node.alt ? `[${node.alt}] ` : '[image] '}
          <Text style={[styles.linkText, { color: theme.colors.primary }]}>
            {node.url}
          </Text>
        </Text>
      );
    }

    if (node.kind === 'commandArgs') {
      return (
        <Text
          key={key}
          style={[
            theme.typography.codeSm,
            styles.inlineCommandArgs,
            {
              color: theme.colors.onSurfaceVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : theme.colors.surfaceContainerHigh,
            },
          ]}
        >
          {node.content}
        </Text>
      );
    }

    return (
      <Text
        key={key}
        style={[
          theme.typography.codeSm,
          styles.inlineCommand,
          {
            color: theme.colors.primary,
            backgroundColor: isDark
              ? 'rgba(86, 156, 214, 0.14)'
              : 'rgba(0, 81, 174, 0.08)',
          },
        ]}
      >
        {node.content}
      </Text>
    );
  };

  const renderInlineList = (
    nodes: TranscriptMarkdownInline[],
    keyPrefix: string,
  ) => nodes.map((node, index) => renderInline(node, `${keyPrefix}:${index}`));

  const renderMarkdownBlock = (
    block: TranscriptMarkdownBlock,
    key: string,
  ): React.ReactNode => {
    if (block.kind === 'folded') {
      const open = Boolean(expanded[key]);
      const color = foldedToneColor(block.tone, theme.colors);

      return (
        <View
          key={key}
          style={[
            styles.foldedBlock,
            {
              borderColor: theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.035)'
                : theme.colors.surfaceContainer,
              borderRadius: theme.borderRadius.sm,
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => toggleSegment(key)}
            style={styles.foldedHeader}
          >
            <Text style={[theme.typography.labelCaps, { color }]}>
              {open ? 'HIDE' : 'SHOW'} {block.label}
            </Text>
            <Text style={[theme.typography.codeSm, { color }]}>
              {open ? '-' : '+'}
            </Text>
          </TouchableOpacity>
          {open ? (
            <View style={styles.markdownStack}>
              {block.blocks.map((child, index) =>
                renderMarkdownBlock(child, `${key}:child:${index}`),
              )}
            </View>
          ) : block.preview ? (
            <Text
              selectable
              numberOfLines={3}
              style={[
                theme.typography.codeSm,
                styles.foldedPreview,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {block.preview}
            </Text>
          ) : null}
        </View>
      );
    }

    if (block.kind === 'paragraph') {
      return (
        <Text
          key={key}
          selectable
          style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
        >
          {renderInlineList(block.children, key)}
        </Text>
      );
    }

    if (block.kind === 'heading') {
      return (
        <Text
          key={key}
          selectable
          style={[
            block.level <= 2
              ? theme.typography.titleMd
              : theme.typography.bodyMd,
            styles.markdownHeading,
            { color: theme.colors.onSurface },
          ]}
        >
          {renderInlineList(block.children, key)}
        </Text>
      );
    }

    if (block.kind === 'quote') {
      return (
        <View
          key={key}
          style={[
            styles.quoteBlock,
            {
              borderLeftColor: theme.colors.outline,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.035)'
                : theme.colors.surfaceContainer,
            },
          ]}
        >
          <Text
            selectable
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {renderInlineList(block.children, key)}
          </Text>
        </View>
      );
    }

    if (block.kind === 'list') {
      return (
        <View key={key} style={styles.markdownList}>
          {block.items.map((item, index) => (
            <View
              key={`${key}:item:${index}`}
              style={[
                styles.markdownListItem,
                { paddingLeft: item.depth * 14 },
              ]}
            >
              {item.checkbox ? (
                <Text style={styles.checkboxMarker}>
                  {item.checkbox === 'checked' ? '☑' : '☐'}
                </Text>
              ) : (
                <Text
                  style={[
                    theme.typography.bodyMd,
                    styles.markdownListMarker,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {block.ordered ? `${index + 1}.` : '•'}
                </Text>
              )}
              <Text
                selectable
                style={[
                  theme.typography.bodyMd,
                  styles.markdownListText,
                  { color: theme.colors.onSurface },
                ]}
              >
                {renderInlineList(item.children, `${key}:item:${index}`)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    if (block.kind === 'thematicBreak') {
      return (
        <View
          key={key}
          style={[
            styles.thematicBreak,
            { backgroundColor: theme.colors.outlineVariant },
          ]}
        />
      );
    }

    if (block.kind === 'table') {
      const colCount = block.headers.length;
      const renderRow = (
        cells: TranscriptMarkdownInline[][],
        rowIndex: number,
        isHeader: boolean,
      ) => (
        <View
          key={`row:${rowIndex}`}
          style={[
            styles.tableRow,
            isHeader && {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.04)',
            },
            {
              borderTopWidth: rowIndex === 0 ? 0 : 1,
              borderTopColor: theme.colors.outlineVariant,
            },
          ]}
        >
          {Array.from({ length: colCount }).map((_, ci) => (
            <Text
              key={`cell:${ci}`}
              selectable
              style={[
                theme.typography.bodySm,
                styles.tableCell,
                isHeader && styles.tableHeaderCell,
                {
                  textAlign: block.align[ci] ?? 'left',
                  color: theme.colors.onSurface,
                  borderRightWidth: ci === colCount - 1 ? 0 : 1,
                  borderRightColor: theme.colors.outlineVariant,
                },
              ]}
            >
              {renderInlineList(
                cells[ci] ?? [],
                `${key}:row:${rowIndex}:cell:${ci}`,
              )}
            </Text>
          ))}
        </View>
      );
      return (
        <View
          key={key}
          style={[
            styles.tableBlock,
            {
              borderColor: theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.02)'
                : theme.colors.surfaceContainer,
            },
          ]}
        >
          {renderRow(block.headers, 0, true)}
          {block.rows.map((row, ri) => renderRow(row, ri + 1, false))}
        </View>
      );
    }

    return (
      <View
        key={key}
        style={[
          styles.codeBlock,
          {
            borderColor: theme.colors.outlineVariant,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : theme.colors.surfaceContainer,
          },
        ]}
      >
        {block.language ? (
          <Text
            style={[
              theme.typography.labelCaps,
              styles.codeLanguage,
              { color: theme.colors.primary },
            ]}
          >
            {block.language}
          </Text>
        ) : null}
        <Text
          selectable
          style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}
        >
          {block.content}
        </Text>
      </View>
    );
  };

  const renderMarkdownBlocks = (
    blocks: TranscriptMarkdownBlock[],
    segmentId: string,
  ) =>
    blocks.map((block, index) =>
      renderMarkdownBlock(block, `${segmentId}:block:${index}`),
    );

  const renderCallout = (segment: TranscriptCalloutSegment) => {
    const color = foldedToneColor(segment.tone, theme.colors);

    return (
      <View
        key={segment.id}
        style={[
          styles.calloutBlock,
          {
            borderColor: color,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : theme.colors.surfaceContainer,
          },
        ]}
      >
        <Text style={[theme.typography.labelCaps, { color }]}>
          {segment.title}
        </Text>
        <View style={styles.calloutContent}>
          {renderMarkdownBlocks(segment.blocks, segment.id)}
        </View>
      </View>
    );
  };

  // Structured Goal report card. The agent emits `ALIANG_GOAL_REPORT:{json}` as
  // a machine channel at a turn's end; parseMessageContentSegments strips it
  // from the narrative and surfaces it here as a card instead of raw JSON text.
  // success/info tones are blue in StatusChip (not green) per the house rule.
  const goalReportStatusType = (
    outcome: TranscriptGoalReportSegment['outcome'],
  ): 'success' | 'warning' | 'error' =>
    outcome === 'failed' ? 'error' : outcome === 'task_completed' ? 'success' : 'warning';

  const renderGoalReport = (segment: TranscriptGoalReportSegment) => {
    const title =
      segment.reportKind === 'plan'
        ? t('transcript.reportPlanTitle')
        : t('transcript.reportTitle');
    const statusLabel = t(`transcript.reportOutcome.${segment.outcome}`, {
      defaultValue: segment.outcome,
    });
    return (
      <GlassPanel key={segment.id} style={styles.goalReportCard}>
        <View style={styles.goalReportHeader}>
          <Text
            style={[
              theme.typography.labelMd,
              { color: theme.colors.onSurface },
              styles.goalReportTitle,
            ]}
            numberOfLines={1}>
            🎯 {title}
          </Text>
          <StatusChip
            label={statusLabel}
            type={goalReportStatusType(segment.outcome)}
          />
        </View>
        {segment.summary ? (
          <Text
            selectable
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurface },
            ]}>
            {segment.summary}
          </Text>
        ) : null}
        {segment.completionProposed ? (
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.goalReportSub,
            ]}>
            {t('transcript.reportCompletionClaimed')}
          </Text>
        ) : null}
        {segment.blockerCode ? (
          <View
            style={[
              styles.goalReportBlocker,
              {
                borderColor: isDark
                  ? 'rgba(255,255,255,0.08)'
                  : theme.colors.outlineVariant,
              },
            ]}>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              ⬢ {segment.blockerCode}
            </Text>
          </View>
        ) : null}
      </GlassPanel>
    );
  };

  const renderSegment = (segment: TranscriptSegment) => {
    if (segment.kind === 'text') {
      return (
        <View key={segment.id} style={styles.markdownStack}>
          {renderMarkdownBlocks(segment.blocks, segment.id)}
        </View>
      );
    }

    if (segment.kind === 'callout') {
      return renderCallout(segment);
    }

    if (segment.kind === 'goalReport') {
      return renderGoalReport(segment);
    }

    const open = Boolean(expanded[segment.id]);
    const color = foldedToneColor(segment.tone, theme.colors);

    return (
      <View
        key={segment.id}
        style={[
          styles.foldedBlock,
          {
            borderColor: theme.colors.outlineVariant,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.035)'
              : theme.colors.surfaceContainer,
            borderRadius: theme.borderRadius.sm,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => toggleSegment(segment.id)}
          style={styles.foldedHeader}
        >
          <Text style={[theme.typography.labelCaps, { color }]}>
            {open ? 'HIDE' : 'SHOW'} {segment.label}
          </Text>
          <Text style={[theme.typography.codeSm, { color }]}>
            {open ? '-' : '+'}
          </Text>
        </TouchableOpacity>
        {open ? (
          <Text
            selectable
            style={[
              theme.typography.codeSm,
              styles.foldedContent,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {segment.content}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <>
      {items.map(message => {
        const isUser = message.role === 'user';
        const isSystem = message.role === 'system';
        const dotColor = isUser
          ? theme.colors.secondary
          : isSystem
          ? theme.colors.onSurfaceVariant
          : theme.colors.primary;
        const systemToggleKey = `system:${message.id}`;
        const systemOpen = Boolean(expanded[systemToggleKey]);
        const systemSummary = isSystem ? systemMessageSummary(message, t) : '';
        const timestamp =
          message.endTimestamp && message.endTimestamp !== message.timestamp
            ? `${message.timestamp} - ${message.endTimestamp}`
            : message.timestamp;
        // Structured activity for THIS assistant bubble only (events whose
        // messageId matches one of the bubble's coalesced source ids). Empty
        // for user/system bubbles or when no activity context was supplied.
        const bubbleEvents =
          hasActivity && message.role === 'assistant'
            ? messageActivityEvents ?? []
            : [];

        if (isUser) {
          const isFailed = Boolean(message.failed);
          // case B:消息已送达但 agent 没回出来(会话 failed)。失败气泡(case A,
          // message.failed)优先,不在此重复渲染入口。
          const isTurnFailed =
            !isFailed &&
            turnFailedMessageId != null &&
            message.id === turnFailedMessageId;
          return (
            <View
              key={message.id}
              onLayout={event => {
                const { y, height } = event.nativeEvent.layout;
                onMessageLayout?.(message.id, y, height);
              }}
              style={[styles.messageRow, styles.userMessageRow]}
            >
              <View style={styles.userMessageStack}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    styles.messageEyebrow,
                    styles.userMessageEyebrow,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={1}
                >
                  {roleLabel[message.role]} {timestamp}
                </Text>
                <View
                  style={[
                    styles.messageBubble,
                    styles.userMessageBubble,
                    {
                      backgroundColor: isDark
                        ? 'rgba(86, 156, 214, 0.14)'
                        : 'rgba(0, 81, 174, 0.08)',
                      borderColor: isFailed
                        ? theme.colors.error
                        : theme.colors.primary,
                    },
                  ]}
                >
                  {message.segments.map(renderSegment)}
                </View>
                {isFailed ? (
                  <View style={styles.failedSendRow}>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        styles.failedSendLabel,
                        { color: theme.colors.error },
                      ]}
                    >
                      {t('transcript.sendFailed')}
                    </Text>
                    {onRetryFailed ? (
                      <TouchableOpacity
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel={t('transcript.retrySend')}
                        onPress={() => onRetryFailed(message.sourceMessageIds[0] ?? message.id)}
                        style={styles.failedSendButton}
                      >
                        <Text
                          style={[
                            theme.typography.codeSm,
                            styles.failedSendButtonText,
                            { color: theme.colors.primary },
                          ]}
                        >
                          {t('transcript.retry')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {onDismissFailed ? (
                      <TouchableOpacity
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel={t('transcript.dismissFailed')}
                        onPress={() => onDismissFailed(message.sourceMessageIds[0] ?? message.id)}
                        style={styles.failedSendButton}
                      >
                        <Text
                          style={[
                            theme.typography.codeSm,
                            styles.failedSendButtonText,
                            { color: theme.colors.onSurfaceVariant },
                          ]}
                        >
                          {t('transcript.delete')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                {isTurnFailed ? (
                  <View style={styles.failedSendRow}>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        styles.failedSendLabel,
                        { color: theme.colors.error },
                      ]}
                    >
                      {t('transcript.noReply')}
                    </Text>
                    {onRetryTurn ? (
                      <TouchableOpacity
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel={t('transcript.retryTurn')}
                        onPress={() => onRetryTurn(message.id)}
                        style={styles.failedSendButton}
                      >
                        <Text
                          style={[
                            theme.typography.codeSm,
                            styles.failedSendButtonText,
                            { color: theme.colors.primary },
                          ]}
                        >
                          {t('transcript.retry')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <IconBadge
                name="user"
                tone="secondary"
                size={28}
                iconSize={14}
                filled
                style={styles.userAvatar}
              />
            </View>
          );
        }

        return (
          <View
            key={message.id}
            onLayout={event => {
              const { y, height } = event.nativeEvent.layout;
              onMessageLayout?.(message.id, y, height);
            }}
            style={styles.messageRow}
          >
            {renderTimelineNode(
              isSystem ? 'event' : 'agent',
              isSystem ? 'neutral' : 'primary',
              dotColor,
              timelinePosition,
            )}
            <View
              style={styles.messageStack}
            >
              <Text
                style={[
                  theme.typography.codeSm,
                  styles.messageEyebrow,
                  { color: theme.colors.onSurfaceVariant },
                ]}
                numberOfLines={1}
              >
                {roleLabel[message.role]} {timestamp}
              </Text>
              {isSystem ? (
                <>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={systemOpen ? t('transcript.collapseSystem') : t('transcript.expandSystem')}
                    onPress={() => toggleSegment(systemToggleKey)}
                    style={[
                      styles.systemSummary,
                      {
                        borderRadius: theme.borderRadius.md,
                        borderColor: theme.colors.outlineVariant,
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.025)'
                          : theme.colors.surfaceContainerLowest,
                      },
                    ]}
                  >
                    <View style={styles.systemSummaryCopy}>
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                        numberOfLines={1}
                      >
                        {systemSummary}
                      </Text>
                    </View>
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      {systemOpen ? 'HIDE' : 'SHOW'}
                    </Text>
                  </TouchableOpacity>
                  {systemOpen ? (
                    <View
                      style={[
                        styles.messageBubble,
                        styles.messageBubbleSystem,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.025)'
                            : theme.colors.surfaceContainerLowest,
                          borderColor: theme.colors.outlineVariant,
                          borderTopRightRadius: theme.borderRadius.lg,
                          borderTopLeftRadius: 6,
                        },
                      ]}
                    >
                      {message.segments.map(renderSegment)}
                    </View>
                  ) : null}
                </>
              ) : (
                <View
                  style={[
                    styles.messageBubble,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.05)'
                        : theme.colors.surfaceContainerLow,
                      borderColor: theme.colors.outlineVariant,
                      borderTopRightRadius: theme.borderRadius.lg,
                      borderTopLeftRadius: 6,
                    },
                  ]}
                >
                  {message.segments.map(renderSegment)}
                </View>
              )}
              {bubbleEvents.length > 0 ? (
                <ActivityBlock
                  sessionId={activitySessionId!}
                  events={bubbleEvents}
                  detailCache={activityDetailCache ?? {}}
                  onCacheDetail={onCacheActivityDetail!}
                  turnSettled={
                    !liveMessageId ||
                    !message.sourceMessageIds.includes(liveMessageId)
                  }
                />
              ) : null}
            </View>
          </View>
        );
      })}
      {hasActivity && orphanActivityMessageIds
        ? orphanActivityMessageIds.map((messageId, index) => {
            // Tool-only assistant turn: empty prose was dropped during
            // coalescing, but structured events still exist for it. Render a
            // standalone activity bubble (under an agent badge) so the turn's
            // activity is visible. Events are grouped per orphan messageId.
            const orphanEvents =
              orphanActivityEventsByMessageId?.get(messageId) ??
              structuredEvents?.filter(
                e =>
                  'messageId' in e &&
                  typeof (e as { messageId?: unknown }).messageId === 'string' &&
                  (e as { messageId: string }).messageId === messageId,
              ) ??
              [];
            if (orphanEvents.length === 0) return null;
            return (
              <View key={`orphan-activity:${messageId}`} style={styles.messageRow}>
                {renderTimelineNode(
                  'agent',
                  'primary',
                  theme.colors.primary,
                  index === orphanActivityMessageIds.length - 1 ? 'end' : 'middle',
                )}
                <View style={styles.messageStack}>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      styles.messageEyebrow,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                    numberOfLines={1}
                  >
                    assistant activity
                  </Text>
                  <ActivityBlock
                    sessionId={activitySessionId!}
                    events={orphanEvents}
                    detailCache={activityDetailCache ?? {}}
                    onCacheDetail={onCacheActivityDetail!}
                    turnSettled={!liveMessageId || messageId !== liveMessageId}
                  />
                </View>
              </View>
            );
          })
        : null}
    </>
  );
};

// Memoize so that during streaming (~100ms store flushes) only the bubble whose
// content/activity actually changed re-renders, not every bubble in the
// transcript. The DEFAULT shallow compare is NOT enough on its own:
// buildDisplayTranscript rebuilds every DisplayTranscriptMessage object on each
// flush (fresh references even for unchanged bubbles) and the owning screen
// rebuilds the per-message activity Map/array too. So we compare by VALUE on
// the props that drive rendered output — the bubble's contentKey (source text),
// its activity-event signatures (captures command status / thinking-active
// flips and event additions), the live-message id (drives the "处理中… / 已完成"
// label), the timeline slot, and the detail-cache reference. Callbacks and
// activitySessionId don't affect what's rendered, so they're intentionally
// ignored — their identity churn must not force a re-render.
const eventSignature = (event: StructuredActivityEvent): string => {
  // eventId and kind are present on every variant, so read them once before the
  // exhaustive switch narrows `event` to `never` in the default branch.
  const base = `${event.eventId}:${event.kind}`;
  switch (event.kind) {
    case 'command':
      return `${base}:${event.status}:${event.exitCode ?? ''}`;
    case 'thinking':
      return `${base}:${event.active ? 1 : 0}:${event.chars}`;
    case 'file_change':
      return `${base}:${event.changeKind ?? ''}:${event.path ?? ''}`;
    case 'usage':
      return `${base}:${event.inputTokens ?? ''}:${event.outputTokens ?? ''}`;
    case 'task':
      return `${base}:${event.tasks.length}`;
    default:
      return base;
  }
};

const activityEventsSignature = (
  events: StructuredActivityEvent[] | undefined,
): string =>
  events && events.length ? events.map(eventSignature).join('|') : '';

const orphanMapSignature = (
  map: ReadonlyMap<string, StructuredActivityEvent[]> | undefined,
): string => {
  if (!map || !map.size) return '';
  let signature = '';
  for (const [messageId, events] of map) {
    signature += `${messageId}:${activityEventsSignature(events)};`;
  }
  return signature;
};

const sameStringList = (
  a: string[] | undefined,
  b: string[] | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const areTranscriptPropsEqual = (
  prev: TranscriptMessageListProps,
  next: TranscriptMessageListProps,
): boolean => {
  // Turn-message path: a content change (streaming growth, coalesced merge,
  // snapshot re-resolve) must re-render; an identical contentKey means the
  // source text is byte-identical, so the markdown tree can't differ.
  const prevMessage = prev.message;
  const nextMessage = next.message;
  if (prevMessage || nextMessage) {
    if (!prevMessage || !nextMessage) return false;
    if (prevMessage.contentKey !== nextMessage.contentKey) return false;
    if (prevMessage.failed !== nextMessage.failed) return false;
  }

  if (
    activityEventsSignature(prev.messageActivityEvents) !==
    activityEventsSignature(next.messageActivityEvents)
  ) {
    return false;
  }
  if (
    orphanMapSignature(prev.orphanActivityEventsByMessageId) !==
    orphanMapSignature(next.orphanActivityEventsByMessageId)
  ) {
    return false;
  }
  if (
    !sameStringList(prev.orphanActivityMessageIds, next.orphanActivityMessageIds)
  ) {
    return false;
  }
  // liveMessageId is stable for the whole streaming duration of a turn and only
  // flips at settle / new-turn boundaries, so this triggers one reconciled
  // re-render of all bubbles then — never per flush.
  if (prev.liveMessageId !== next.liveMessageId) return false;
  if (prev.timelinePosition !== next.timelinePosition) return false;
  // activityDetailCache is carried by reference through streaming flushes (the
  // store spreads the run but keeps the cache object), so a ref change means a
  // detail was actually fetched/cached.
  if (prev.activityDetailCache !== next.activityDetailCache) return false;
  return true;
};

export const TranscriptMessageList = React.memo(
  TranscriptMessageListBase,
  areTranscriptPropsEqual,
);

const styles = StyleSheet.create({
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  userMessageRow: {
    justifyContent: 'flex-end',
    paddingLeft: 38,
  },
  messageStack: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    gap: 4,
  },
  userMessageStack: {
    alignItems: 'flex-end',
    flexShrink: 1,
    minWidth: 48,
    maxWidth: '88%',
    gap: 4,
  },
  timelineNodeRail: {
    width: 30,
    minHeight: 54,
    alignItems: 'center',
    alignSelf: 'stretch',
    flexShrink: 0,
    position: 'relative',
  },
  timelineSegment: {
    position: 'absolute',
    left: 14,
    width: 1,
    borderRadius: 999,
  },
  timelineSegmentTop: {
    top: 0,
    height: 22,
  },
  timelineSegmentTopStart: {
    top: 6,
    height: 16,
  },
  timelineSegmentBottom: {
    top: 22,
    bottom: 0,
  },
  timelineSegmentBottomEnd: {
    bottom: 6,
  },
  timelineNodeIcon: {
    position: 'absolute',
    top: 8,
    left: 1,
    zIndex: 2,
    elevation: 2,
  },
  timelineStartCap: {
    position: 'absolute',
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    zIndex: 3,
  },
  timelineEndCap: {
    position: 'absolute',
    bottom: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    zIndex: 3,
  },
  messageEyebrow: {
    minHeight: 16,
    textTransform: 'lowercase',
  },
  userMessageEyebrow: {
    textAlign: 'right',
    alignSelf: 'stretch',
  },
  messageBubble: {
    borderWidth: 1,
    padding: 12,
    gap: 8,
    borderRadius: 14,
  },
  userMessageBubble: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    borderTopRightRadius: 6,
    borderTopLeftRadius: 14,
  },
  failedSendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  failedSendLabel: {
    fontWeight: '600',
  },
  failedSendButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(127, 127, 127, 0.35)',
  },
  failedSendButtonText: {
    fontWeight: '600',
  },
  userAvatar: {
    marginTop: 18,
    flexShrink: 0,
  },
  messageBubbleSystem: {
    padding: 10,
  },
  systemSummary: {
    minHeight: 38,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  systemSummaryCopy: {
    flex: 1,
    gap: 2,
  },
  foldedBlock: {
    borderWidth: 1,
    padding: 8,
    gap: 8,
  },
  foldedHeader: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  foldedContent: {
    lineHeight: 18,
  },
  foldedPreview: {
    lineHeight: 18,
    opacity: 0.85,
  },
  markdownStack: {
    gap: 6,
  },
  markdownHeading: {
    marginBottom: 2,
  },
  strongText: {
    fontWeight: '700',
  },
  emphasisText: {
    fontStyle: 'italic',
  },
  inlineCode: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  inlineCommand: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  inlineCommandArgs: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  linkText: {
    textDecorationLine: 'underline',
  },
  quoteBlock: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 6,
    paddingRight: 8,
    borderRadius: 6,
  },
  markdownList: {
    gap: 4,
  },
  markdownListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  markdownListMarker: {
    minWidth: 18,
    textAlign: 'right',
  },
  markdownListText: {
    flex: 1,
  },
  strikethroughText: {
    textDecorationLine: 'line-through',
  },
  imageChip: {
    fontStyle: 'italic',
  },
  checkboxMarker: {
    minWidth: 18,
    textAlign: 'center',
  },
  thematicBreak: {
    height: 1,
    marginVertical: 8,
  },
  tableBlock: {
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    flex: 1,
    padding: 6,
  },
  tableHeaderCell: {
    fontWeight: '700',
  },
  codeBlock: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    gap: 6,
  },
  codeLanguage: {
    alignSelf: 'flex-start',
  },
  calloutBlock: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    gap: 6,
  },
  calloutContent: {
    gap: 6,
  },
  goalReportCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
    marginTop: 4,
  },
  goalReportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  goalReportTitle: {
    flexShrink: 1,
  },
  goalReportSub: {
    marginTop: 2,
  },
  goalReportBlocker: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
});
