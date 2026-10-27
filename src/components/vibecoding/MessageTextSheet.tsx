/**
 * 长按气泡 → 这条消息的全文，整段选中，一键复制。
 *
 * 为什么要单开一张表而不是让正文自己 `selectable`：iOS 上 `Text selectable`
 * 会吃掉长按手势（它抢 responder 去做文本选择），父级 Pressable 的
 * `onLongPress` 永远不触发——这正是之前「长按气泡没反应」的原因。所以气泡里
 * 的 Text 都不再 selectable，长按统一走这里：正文放进一个只读、可滚动的
 * TextInput，打开时把选区设成 [0, len]（`setSelection` 是 RN 0.7x 起的实例
 * 方法），用户在原生选区上直接点「复制」也行；`复制全文` 按钮是不依赖选区
 * 渲染的兜底通道（有的机型在非焦点态不画选区高亮）。
 *
 * 复制反馈走**行内**文案而不是全局 toast：RN 的 Modal 盖在 ToastViewport
 * 之上，弹出去也看不见。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';

export interface MessageTextSheetProps {
  visible: boolean;
  text: string;
  onClose: () => void;
}

export const MessageTextSheet: React.FC<MessageTextSheetProps> = ({
  visible,
  text,
  onClose,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const inputRef = useRef<TextInput>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCopied(false);
      return;
    }
    if (!text) return;
    // 等挂载 + 文本布局落地再设选区，否则 offset 会被裁到 0。
    const timer = setTimeout(() => {
      inputRef.current?.setSelection?.(0, text.length);
    }, 160);
    return () => clearTimeout(timer);
  }, [visible, text]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const empty = !text.trim();

  const handleCopy = useCallback(() => {
    // 只有空白的消息复制出去等于什么都没复制,直接不响应。
    if (empty) return;
    Clipboard.setString(text);
    setCopied(true);
  }, [empty, text]);

  return (
    <BottomSheet
      open={visible}
      onClose={onClose}
      title={t('messageActions.sheetTitle')}
      subtitle={t('messageActions.sheetSubtitle')}
      height="86%">
      <View style={styles.body}>
        {empty ? (
          <Text
            testID="message-text-sheet-empty"
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t('messageActions.empty')}
          </Text>
        ) : (
          <TextInput
            ref={inputRef}
            testID="message-text-sheet-input"
            value={text}
            multiline
            editable={false}
            scrollEnabled
            // 只读输入框不需要真处理输入，但 value 受控时 RN 会要求给回调。
            onChangeText={() => undefined}
            style={[
              theme.typography.codeSm,
              styles.input,
              {
                color: theme.colors.onSurface,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainer,
                borderColor: isDark
                  ? 'rgba(255,255,255,0.08)'
                  : theme.colors.outlineVariant,
                borderRadius: theme.borderRadius.md,
              },
            ]}
          />
        )}
        <View style={styles.footer}>
          <Text
            testID="message-text-sheet-status"
            style={[
              theme.typography.codeSm,
              { color: copied ? theme.colors.primary : 'transparent' },
            ]}>
            {copied ? t('messageActions.copied') : ' '}
          </Text>
          <GlowButton
            title={copied ? t('messageActions.copied') : t('messageActions.copyAll')}
            onPress={handleCopy}
            disabled={empty}
            testID="message-text-sheet-copy"
          />
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  input: {
    flex: 1,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
