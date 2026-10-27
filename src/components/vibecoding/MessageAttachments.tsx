/**
 * 消息气泡里的素材缩略图（Task 19）。
 *
 * 只渲染**图片类**（照片 / 手绘）。ASCII 不在这里画：它在发送时已经被
 * 并进正文的围栏代码块（`withAsciiBlocks`），再画一次会重复。ASCII 的
 * attachment 元数据仍随消息走，那是给 agent 的，不是给眼睛的。
 *
 * 三条渲染路径，优先级从高到低：
 *   1. 本地有原文件（自己刚发的）→ 直接 `file://`，零网络；
 *   2. 缓存/新签的预签名 URL → `<Image>`；
 *   3. 加载中 → 骨架块；签名失败或过期 → 「图片已过期」占位。
 *
 * **永远不显示裂图**：URL 失效时换成占位文案，而不是让 Image 组件把
 * 系统默认的破图标亮出来。
 *
 * 点缩略图 → 全屏 viewer（双指缩放 / 下滑关闭，见 ImageViewerModal）。
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { AiAttachmentMeta } from '../../api/attachments';
import { localFileUri } from '../../services/attachmentLibrary';
import { ImageViewerModal } from '../shared/ImageViewerModal';
import {
  attachmentUrlFailed,
  ensureAttachmentUrls,
  getSignedUrl,
  localAssetPath,
  signedUrlRefreshDelay,
  subscribeAttachmentUrls,
} from '../../services/attachmentSignCache';

const MAX_WIDTH = 220;
const MAX_HEIGHT = 280;
const MIN_HEIGHT = 56;

export interface MessageAttachmentsProps {
  attachments?: AiAttachmentMeta[];
  /**
   * 所属会话 id。历史图片（server 重启后内存上传位已丢）靠它 + mime 在
   * 服务端推导 COS 对象键，缺了就只能寄希望于内存上传位还命中。
   */
  sessionId?: string;
}

/** 气泡内的单张图。拆出来是为了让每张图各自订阅自己的 URL。 */
const MessageAttachmentImage: React.FC<{
  attachment: AiAttachmentMeta;
  sessionId?: string;
  /** 点图 → 全屏看大图（由 MessageAttachments 打开 viewer）。 */
  onOpen?: (target: { uri: string; name?: string }) => void;
}> = ({ attachment, sessionId, onOpen }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const assetId = attachment.asset_id;

  // 快照必须返回字符串（对象每次都是新引用会让 useSyncExternalStore 死循环）。
  // 把 URL 拼进去，重新签名后快照才会变化、effect 才会重排刷新定时器。
  const snapshot = useSyncExternalStore(
    subscribeAttachmentUrls,
    () => {
      const local = localAssetPath(assetId);
      if (local) return `local:${local}`;
      const url = getSignedUrl(assetId);
      if (url) return `ready:${url}`;
      if (attachmentUrlFailed(assetId)) return 'expired';
      return 'loading';
    },
  );

  const separator = snapshot.indexOf(':');
  const status = separator === -1 ? snapshot : snapshot.slice(0, separator);
  const uri =
    status === 'local'
      ? localFileUri(snapshot.slice(separator + 1))
      : status === 'ready'
        ? snapshot.slice(separator + 1)
        : undefined;

  useEffect(() => {
    if (status === 'loading') {
      ensureAttachmentUrls([{ assetId, mime: attachment.mime, sessionId: sessionId ?? '' }]);
      return;
    }
    if (status !== 'ready') return;
    // 提前 60 秒重新签：用户停在会话里很久，也不会在滚回老消息时撞上过期。
    const delay = signedUrlRefreshDelay(assetId);
    if (delay === undefined) return;
    const timer = setTimeout(
      () => ensureAttachmentUrls([{ assetId, mime: attachment.mime, sessionId: sessionId ?? '' }]),
      delay + 50,
    );
    return () => clearTimeout(timer);
  }, [assetId, attachment.mime, sessionId, status, snapshot]);

  const { width, height } = boxSize(attachment);

  if (uri) {
    return (
      <Pressable
        testID={`message-attachment-open-${assetId}`}
        accessibilityRole="imagebutton"
        accessibilityLabel={attachment.name}
        onPress={() => onOpen?.({ uri, name: attachment.name })}
        style={styles.imageButton}>
        <Image
          testID={`message-attachment-image-${assetId}`}
          source={{ uri }}
          style={[styles.image, { width, height, borderColor: theme.colors.outlineVariant }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityLabel={attachment.name}
        />
      </Pressable>
    );
  }

  if (status === 'expired') {
    return (
      <View
        testID={`message-attachment-expired-${assetId}`}
        style={[
          styles.placeholder,
          {
            width,
            height,
            backgroundColor: theme.colors.surfaceContainerHighest,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {t('attachments.expired')}
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={`message-attachment-loading-${assetId}`}
      style={[
        styles.placeholder,
        {
          width,
          height,
          backgroundColor: theme.colors.surfaceContainerHighest,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
    >
      <ActivityIndicator size="small" color={theme.colors.onSurfaceVariant} />
    </View>
  );
};

/**
 * 按原始宽高比缩放进气泡：先贴最大宽度，太高再按高度收，最后夹一个最小
 * 高度（极端长条图不至于压成一条线）。缺宽高时按 4:3 兜底。
 */
function boxSize(attachment: AiAttachmentMeta): { width: number; height: number } {
  const sourceWidth =
    attachment.width && attachment.width > 0 ? attachment.width : 4;
  const sourceHeight =
    attachment.height && attachment.height > 0 ? attachment.height : 3;
  const ratio = sourceWidth / sourceHeight;

  let width = MAX_WIDTH;
  let height = MAX_WIDTH / ratio;
  if (height > MAX_HEIGHT) {
    height = MAX_HEIGHT;
    width = MAX_HEIGHT * ratio;
  }
  if (height < MIN_HEIGHT) {
    height = MIN_HEIGHT;
    width = Math.min(MAX_WIDTH, MIN_HEIGHT * ratio);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export const MessageAttachments: React.FC<MessageAttachmentsProps> = ({
  attachments,
  sessionId,
}) => {
  // 点图看大图的状态放在这层：每张缩略图只管上报自己的 uri，谁来呈现由
  // 气泡统一决定（顺便保证一屏最多只有一个 viewer）。
  const [preview, setPreview] = useState<{ uri: string; name?: string } | null>(
    null,
  );

  // ASCII 已在正文代码块里；没有图片就整块不渲染，别在气泡里留空白。
  const images = (attachments ?? []).filter(item => item.kind !== 'ascii');
  if (images.length === 0) return null;

  return (
    <>
      <View testID="message-attachments" style={styles.wrap}>
        {images.map(item => (
          <MessageAttachmentImage
            key={item.asset_id}
            attachment={item}
            sessionId={sessionId}
            onOpen={setPreview}
          />
        ))}
      </View>
      <ImageViewerModal
        visible={preview !== null}
        uri={preview?.uri}
        name={preview?.name}
        onClose={() => setPreview(null)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  imageButton: {
    borderRadius: 10,
  },
  image: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#00000010',
  },
  placeholder: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
