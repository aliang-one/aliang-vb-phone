import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import type { ApprovalRequest } from '../../store/types';

/**
 * 折叠展示已处理(approved / denied)的审批,避免每张都占一整块屏幕空间。
 *
 * - 默认折叠成一行「✓ 已处理审批 · N」,点击展开。
 * - 展开后按时间顺序列出各张审批卡(复用父级 `renderCard`,即会话屏里的
 *   `renderApprovalCard`),整组置灰(opacity)以表明"已处理、不可操作"。
 *
 * pending 审批不进这里——它们仍在对话时间线里以完整、高亮卡片展示。
 */
interface ResolvedApprovalsGroupProps {
  approvals: ApprovalRequest[];
  /** 复用会话屏的审批卡渲染(返回完整 GlassPanel 卡)。 */
  renderCard: (approval: ApprovalRequest) => React.ReactNode;
}

export const ResolvedApprovalsGroup: React.FC<ResolvedApprovalsGroupProps> = ({
  approvals,
  renderCard,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!approvals.length) return null;

  return (
    <GlassPanel style={styles.group}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起已处理审批' : '展开已处理审批'}
        testID="resolved-approvals-toggle"
        onPress={() => setExpanded(current => !current)}
        style={styles.header}>
        <Text
          style={[
            theme.typography.labelMd,
            { color: theme.colors.onSurfaceVariant },
          ]}>
          {expanded ? '▾' : '▸'} ✓ 已处理审批 · {approvals.length}
        </Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.list}>
          {approvals.map(approval => (
            <View key={approval.id}>{renderCard(approval)}</View>
          ))}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="收起已处理审批"
            testID="resolved-approvals-collapse-bottom"
            onPress={() => setExpanded(false)}
            style={[
              styles.footerCollapse,
              { borderColor: theme.colors.outlineVariant },
            ]}>
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
    paddingVertical: 2,
  },
  // 整组置灰:已处理的审批不再可操作,视觉上退到次要层级。
  list: {
    gap: 8,
    marginTop: 8,
    opacity: 0.55,
  },
  footerCollapse: {
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 2,
  },
});
