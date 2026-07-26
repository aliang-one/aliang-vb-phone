import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import type { AgentMessage } from '../../data/platformModels';

/**
 * 已删除 Goal 的折叠占位段。
 *
 * 当一个 Goal 被删除/放弃后,该 Goal 期间被服务端软隐藏(hiddenAt 非空、
 * goalId 标记)的消息不再在对话时间线里逐条展示,而是由父组件按 goalId
 * 分组后,每个 Goal 渲染一张本组件:
 *
 * - 折叠态:一行「已删除的 Goal · <objective> · N 条消息」,点击展开。
 * - 展开态:顺序列出每条消息(role + 正文截断),opacity 置灰表示已归档。
 *
 * 多个 Goal 的分组与排序由父组件负责;不同 goalId 即不同实例。
 */
interface GoalDeletedFoldProps {
  goalId: string;
  objective?: string;
  messages: AgentMessage[];
}

const roleLabel = (role: AgentMessage['role']): string => {
  switch (role) {
    case 'user':
      return '我';
    case 'assistant':
      return 'AI';
    default:
      return '系统';
  }
};

export const GoalDeletedFold: React.FC<GoalDeletedFoldProps> = ({
  objective,
  messages,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  if (!messages.length) return null;

  const objectiveLabel = objective?.trim() || '目标已删除';
  const count = messages.length;

  return (
    <GlassPanel style={styles.group}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`已删除的 Goal,${objectiveLabel},${count} 条消息,${
          expanded ? '收起' : '展开'
        }`}
        testID="goal-deleted-fold-toggle"
        onPress={() => setExpanded(current => !current)}
        style={styles.header}>
        <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
          {expanded ? '▾' : '▸'} 已删除的 Goal
        </Text>
        <Text
          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
          numberOfLines={1}>
          · {objectiveLabel} · {count} 条消息
        </Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.list}>
          {messages.map((message, index) => (
            <View
              key={message.id ?? index}
              testID={`goal-deleted-fold-message-${index}`}
              style={[
                styles.messageRow,
                { borderColor: theme.colors.outlineVariant },
              ]}>
              <Text
                style={[
                  theme.typography.labelSm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {roleLabel(message.role)}
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}
                numberOfLines={3}>
                {message.content}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="收起已删除的 Goal"
            testID="goal-deleted-fold-collapse-bottom"
            onPress={() => setExpanded(false)}
            style={[styles.footerCollapse, { borderColor: theme.colors.outlineVariant }]}>
            <Text
              style={[
                theme.typography.labelMd,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              ▴ 收起
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  group: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingVertical: 2,
  },
  // 整组置灰:已归档的 Goal 消息不再可操作,视觉上退到次要层级。
  list: {
    gap: 8,
    marginTop: 8,
    opacity: 0.55,
  },
  messageRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    gap: 2,
  },
  footerCollapse: {
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 2,
  },
});
