import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import { ActivityBlock } from './ActivityBlock';
import type { StructuredActivityEvent } from '../../data/platformModels';
import type {
  TranscriptCalloutSegment,
  DisplayTranscriptMessage,
  TranscriptFoldedSegment,
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
  items: DisplayTranscriptMessage[];
  onMessageLayout?: (messageId: string, y: number, height: number) => void;
  /**
   * When provided, an `ActivityBlock` is rendered under each assistant bubble
   * for the structured events whose `messageId` matches that bubble's
   * `sourceMessageIds`, plus a synthetic activity bubble for any tool-only
   * assistant turn (empty prose) whose message id was dropped during coalescing
   * but still has structured events. All four props must be supplied together
   * (or all omitted). The component stays store-free — the owning screen owns
   * the run + cache + setter.
   */
  activitySessionId?: string;
  /** All structured events for the run (the component filters per-bubble). */
  structuredEvents?: StructuredActivityEvent[];
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
}

const roleLabel: Record<DisplayTranscriptMessage['role'], string> = {
  user: 'YOU',
  assistant: 'ASSISTANT',
  system: 'SYSTEM',
};

const foldedToneColor = (
  tone: TranscriptFoldedSegment['tone'],
  colors: ReturnType<typeof useTheme>['theme']['colors'],
) => {
  if (tone === 'warning') return colors.tertiary;
  if (tone === 'info') return colors.primary;
  return colors.onSurfaceVariant;
};

export const TranscriptMessageList: React.FC<TranscriptMessageListProps> = ({
  items,
  onMessageLayout,
  activitySessionId,
  structuredEvents,
  activityDetailCache,
  onCacheActivityDetail,
  orphanActivityMessageIds,
}) => {
  const { theme, isDark } = useTheme();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const hasActivity =
    Boolean(activitySessionId) &&
    Boolean(structuredEvents) &&
    Boolean(onCacheActivityDetail);

  // Events for one assistant bubble: those whose messageId is in the (possibly
  // coalesced) bubble's sourceMessageIds. Computed per-render; structuredEvents
  // is small (bounded by the run's structured activity window).
  const eventsForBubble = (message: DisplayTranscriptMessage) =>
    message.role === 'assistant' && structuredEvents
      ? structuredEvents.filter(
          (e): e is Extract<StructuredActivityEvent, { messageId: string }> =>
            'messageId' in e &&
            typeof (e as { messageId?: unknown }).messageId === 'string' &&
            message.sourceMessageIds.includes(
              (e as { messageId: string }).messageId,
            ),
        )
      : [];

  const toggleSegment = (segmentId: string) => {
    setExpanded(current => ({
      ...current,
      [segmentId]: !current[segmentId],
    }));
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
            <View key={`${key}:item:${index}`} style={styles.markdownListItem}>
              <Text
                style={[
                  theme.typography.bodyMd,
                  styles.markdownListMarker,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {block.ordered ? `${index + 1}.` : '•'}
              </Text>
              <Text
                selectable
                style={[
                  theme.typography.bodyMd,
                  styles.markdownListText,
                  { color: theme.colors.onSurface },
                ]}
              >
                {renderInlineList(item, `${key}:item:${index}`)}
              </Text>
            </View>
          ))}
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
        const timestamp =
          message.endTimestamp && message.endTimestamp !== message.timestamp
            ? `${message.timestamp} - ${message.endTimestamp}`
            : message.timestamp;
        // Structured activity for THIS assistant bubble only (events whose
        // messageId matches one of the bubble's coalesced source ids). Empty
        // for user/system bubbles or when no activity context was supplied.
        const bubbleEvents = hasActivity ? eventsForBubble(message) : [];

        return (
          <View
            key={message.id}
            onLayout={event => {
              const { y, height } = event.nativeEvent.layout;
              onMessageLayout?.(message.id, y, height);
            }}
            style={[
              styles.messageRow,
              isUser ? styles.messageRowUser : styles.messageRowAgent,
            ]}
          >
            {!isUser ? (
              <IconBadge
                name={isSystem ? 'event' : 'agent'}
                tone={isSystem ? 'neutral' : 'primary'}
                size={32}
                iconSize={16}
              />
            ) : null}
            <View
              style={[
                styles.messageStack,
                isUser ? styles.messageStackUser : styles.messageStackAgent,
              ]}
            >
              <View
                style={[
                  styles.messageMeta,
                  isUser ? styles.messageMetaUser : styles.messageMetaAgent,
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {roleLabel[message.role]}
                  {message.mergedCount > 1
                    ? ` · ${message.mergedCount} parts`
                    : ''}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {timestamp}
                </Text>
              </View>
              <View
                style={[
                  styles.messageBubble,
                  {
                    backgroundColor: isUser
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.14)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : isDark
                      ? 'rgba(255,255,255,0.05)'
                      : theme.colors.surfaceContainerLow,
                    borderColor: isUser
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    borderTopRightRadius: isUser ? 6 : theme.borderRadius.lg,
                    borderTopLeftRadius: isUser ? theme.borderRadius.lg : 6,
                  },
                ]}
              >
                {message.segments.map(renderSegment)}
              </View>
              {bubbleEvents.length > 0 ? (
                <ActivityBlock
                  sessionId={activitySessionId!}
                  events={bubbleEvents}
                  detailCache={activityDetailCache ?? {}}
                  onCacheDetail={onCacheActivityDetail!}
                />
              ) : null}
            </View>
            {isUser ? (
              <IconBadge name="user" tone="secondary" size={32} iconSize={16} />
            ) : null}
          </View>
        );
      })}
      {hasActivity && orphanActivityMessageIds && structuredEvents
        ? orphanActivityMessageIds.map(messageId => {
            // Tool-only assistant turn: empty prose was dropped during
            // coalescing, but structured events still exist for it. Render a
            // standalone activity bubble (under an agent badge) so the turn's
            // activity is visible. Events are grouped per orphan messageId.
            const orphanEvents = structuredEvents.filter(
              (e): e is Extract<StructuredActivityEvent, { messageId: string }> =>
                'messageId' in e &&
                typeof (e as { messageId?: unknown }).messageId === 'string' &&
                (e as { messageId: string }).messageId === messageId,
            );
            if (orphanEvents.length === 0) return null;
            return (
              <View key={`orphan-activity:${messageId}`} style={styles.messageRow}>
                <IconBadge name="agent" tone="primary" size={32} iconSize={16} />
                <View style={[styles.messageStack, styles.messageStackAgent]}>
                  <ActivityBlock
                    sessionId={activitySessionId!}
                    events={orphanEvents}
                    detailCache={activityDetailCache ?? {}}
                    onCacheDetail={onCacheActivityDetail!}
                  />
                </View>
              </View>
            );
          })
        : null}
    </>
  );
};

const styles = StyleSheet.create({
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAgent: {
    justifyContent: 'flex-start',
  },
  messageStack: {
    maxWidth: '78%',
    gap: 4,
  },
  messageStackUser: {
    alignItems: 'flex-end',
  },
  messageStackAgent: {
    alignItems: 'flex-start',
  },
  messageMeta: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  messageMetaUser: {
    justifyContent: 'flex-end',
  },
  messageMetaAgent: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    borderWidth: 1,
    padding: 12,
    gap: 8,
    borderRadius: 14,
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
});
