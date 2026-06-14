import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import type {
  DisplayTranscriptMessage,
  TranscriptFoldedSegment,
  TranscriptSegment,
} from '../../utils/agentTranscript';

interface TranscriptMessageListProps {
  items: DisplayTranscriptMessage[];
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
}) => {
  const { theme, isDark } = useTheme();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleSegment = (segmentId: string) => {
    setExpanded(current => ({
      ...current,
      [segmentId]: !current[segmentId],
    }));
  };

  const renderSegment = (segment: TranscriptSegment) => {
    if (segment.kind === 'text') {
      return (
        <Text
          key={segment.id}
          selectable
          style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
          {segment.content}
        </Text>
      );
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
        ]}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => toggleSegment(segment.id)}
          style={styles.foldedHeader}>
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
            style={[theme.typography.codeSm, styles.foldedContent, { color: theme.colors.onSurfaceVariant }]}>
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
            style={[
              styles.messageRow,
              isUser ? styles.messageRowUser : styles.messageRowAgent,
            ]}>
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
              ]}>
              <View
                style={[
                  styles.messageMeta,
                  isUser ? styles.messageMetaUser : styles.messageMetaAgent,
                ]}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {roleLabel[message.role]}
                  {message.mergedCount > 1 ? ` · ${message.mergedCount} parts` : ''}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
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
                ]}>
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
});
