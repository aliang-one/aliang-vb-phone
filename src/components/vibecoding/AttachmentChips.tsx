/**
 * 输入框上方的「本轮待发送素材」条（Task 18）。
 *
 * 只负责展示 + 删除：选中态在屏幕层，上传在发送路径里。三条素材混排——
 * 照片/手绘给缩略图，ASCII 没有图片文件，把正文前几行用等宽字体画出来。
 *
 * 每颗 chip 的删除按钮是独立的 a11y 元素：整颗 chip 长按也能删，但 VoiceOver
 * 用户需要一个明确可点的「移除」目标，不能只依赖手势。
 */
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { localFileUri, type LocalAsset } from '../../services/attachmentLibrary';

export interface AttachmentChipsProps {
  assets: LocalAsset[];
  onRemove: (asset: LocalAsset) => void;
  /** 上传/发送中：锁住删除，避免用户把正在上传的素材抽走。 */
  disabled?: boolean;
}

export const AttachmentChips: React.FC<AttachmentChipsProps> = ({
  assets,
  onRemove,
  disabled = false,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');

  if (assets.length === 0) return null;

  const kindLabel = (kind: LocalAsset['kind']) =>
    kind === 'ascii'
      ? t('attachments.kindAscii')
      : kind === 'drawing'
        ? t('attachments.kindDrawing')
        : t('attachments.kindPhoto');

  return (
    <ScrollView
      testID="attachment-chips"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.rail}
      style={styles.railWrap}
    >
      {assets.map(asset => {
        const uri = asset.kind === 'ascii' ? undefined : localFileUri(asset.localPath);
        const label = kindLabel(asset.kind);
        return (
          <View
            key={asset.id}
            testID={`attachment-chip-${asset.id}`}
            style={[
              styles.chip,
              { backgroundColor: theme.colors.surfaceContainerHighest },
            ]}
          >
            {asset.kind === 'ascii' ? (
              <Text
                numberOfLines={3}
                style={[
                  theme.typography.codeSm,
                  styles.asciiText,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                {asset.text ?? ''}
              </Text>
            ) : uri ? (
              <Image
                source={{ uri }}
                style={styles.image}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                accessibilityLabel={label}
              />
            ) : (
              <Text
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
              >
                {label}
              </Text>
            )}
            <Pressable
              testID={`attachment-chip-remove-${asset.id}`}
              accessibilityRole="button"
              accessibilityLabel={t('attachments.removeChip', { name: label })}
              disabled={disabled}
              onPress={() => onRemove(asset)}
              hitSlop={8}
              style={[
                styles.removeBtn,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.outlineVariant,
                  opacity: disabled ? 0.4 : 1,
                },
              ]}
            >
              <Svg width={10} height={10} viewBox="0 0 10 10">
                <Path
                  d="M2 2l6 6M8 2l-6 6"
                  stroke={theme.colors.onSurfaceVariant}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  railWrap: {
    // 只在有素材时占位；横向滚动不抢输入框的纵向空间。
    flexGrow: 0,
    marginBottom: 8,
  },
  rail: {
    gap: 8,
    paddingHorizontal: 4,
  },
  chip: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  asciiText: {
    paddingHorizontal: 4,
    fontSize: 7,
    lineHeight: 9,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
