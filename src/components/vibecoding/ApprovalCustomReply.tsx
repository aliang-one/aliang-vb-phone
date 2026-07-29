// 「自定义回复」入口:折叠为一个触发器,展开后是 VoiceTextInput + 发送 + ✕ 收起。
// 纯 UI、不绑 i18n namespace —— 文案由宿主以各自 namespace 翻译后传入。
// 仅用于方案选择(client_response)审批:onSend 触发 resolve(id,'approved',{message})。
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { GlowButton } from '../shared/GlowButton';
import { VoiceTextInput } from './VoiceTextInput';

export interface ApprovalCustomReplyProps {
  approvalId: string;
  triggerLabel: string;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  sessionId?: string;
  projectPath?: string;
  onSend: (message: string) => void;
}

const MAX_LENGTH = 2000; // < 服务端 message.max(4000),前端先截

export const ApprovalCustomReply: React.FC<ApprovalCustomReplyProps> = ({
  approvalId,
  triggerLabel,
  placeholder,
  sendLabel,
  disabled = false,
  sessionId,
  projectPath,
  onSend,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const canSend = trimmed.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(trimmed);
    setText('');
    setExpanded(false);
  };

  const collapse = () => setExpanded(false); // 保留 text
  const toggle = () => {
    if (disabled) return;
    setExpanded(v => !v);
  };

  if (!expanded) {
    return (
      <TouchableOpacity
        testID={`approval-custom-reply-trigger-${approvalId}`}
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        disabled={disabled}
        onPress={toggle}
        style={styles.trigger}
      >
        <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
          {triggerLabel}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.expand}>
      <View style={styles.inputRow}>
        <VoiceTextInput
          testIDPrefix={`approval-custom-reply-${approvalId}`}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          maxLength={MAX_LENGTH}
          returnKeyType="send"
          onSubmitEditing={send}
          sessionId={sessionId}
          projectPath={projectPath}
          style={styles.input}
        />
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          testID={`approval-custom-reply-collapse-${approvalId}`}
          accessibilityRole="button"
          accessibilityLabel="collapse"
          onPress={collapse}
          style={styles.collapseBtn}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={theme.colors.onSurfaceVariant}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </TouchableOpacity>
        <GlowButton
          testID={`approval-custom-reply-send-${approvalId}`}
          title={sendLabel}
          onPress={send}
          disabled={!canSend}
          variant="primary"
          style={styles.sendBtn}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  trigger: { paddingVertical: 7, alignSelf: 'flex-end' },
  expand: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  collapseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { minWidth: 88, minHeight: 44 },
});
