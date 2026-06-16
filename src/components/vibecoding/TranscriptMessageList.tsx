import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import type {
  TranscriptCalloutSegment,
  DisplayTranscriptMessage,
  TranscriptFoldedSegment,
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
  TranscriptSegment,
} from '../../utils/agentTranscript';

interface TranscriptMessageListProps {
  items: DisplayTranscriptMessage[];
  onMessageLayout?: (messageId: string, y: number, height: number) => void;
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
}) => {
  const { theme, isDark } = useTheme();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
              ? 'rgba(0, 209, 255, 0.14)'
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
                        ? 'rgba(0, 209, 255, 0.14)'
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
            </View>
            {isUser ? (
              <IconBadge name="user" tone="secondary" size={32} iconSize={16} />
            ) : null}
          </View>
        );
      })}
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
