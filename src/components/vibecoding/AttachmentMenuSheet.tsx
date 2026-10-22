/**
 * 输入框「+」入口打开的素材菜单（Task 17 / 25）。
 *
 * 四个入口（拍照 / 相册 / 手绘 / ASCII）+ 最近使用的素材横滑条。菜单只负责
 * 「选什么」，采集、上传、入库都在屏幕层——这个组件保持纯展示，测试里点一下
 * 就能断言回调，不需要拉起任何原生模块。
 *
 * 最近素材里三类混排：照片/手绘渲染缩略图，ASCII 没有图片文件，直接把正文
 * 前几行用等宽字体画出来（它的「样子」就是文本本身）。横滑条最多显示
 * `RECENT_LIMIT` 条：库里可以留 50 条给「重发」用，但菜单只是快捷入口，
 * 无限长只会把四宫格挤出屏幕。
 *
 * 删除/清空都在本组件里弹确认（Alert）。这两个动作会真的删磁盘文件，长按
 * 误触的代价太高；确认框离手势最近，也让屏幕层继续只管「选什么」。
 */
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { localFileUri, type LocalAsset } from '../../services/attachmentLibrary';

export type AttachmentMenuAction = 'camera' | 'album' | 'draw' | 'ascii';

export interface AttachmentMenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** 用户点了四宫格里的某一项。菜单自己不会关闭——由屏幕决定先关还是先采集。 */
  onSelect: (action: AttachmentMenuAction) => void;
  /** 最近使用（已按最近使用倒序）。空数组时整块不渲染。 */
  recent: LocalAsset[];
  /** 点最近素材 = 直接选中（不是发送）。 */
  onPickRecent: (asset: LocalAsset) => void;
  /** 长按最近素材 = 删除（已确认）。未接时退化为普通点击。 */
  onDeleteRecent?: (asset: LocalAsset) => void;
  /** 底部「清空最近素材」（已确认）。未接时不渲染该按钮。 */
  onClearRecent?: () => void;
}

/** 横滑条最多显示几条；库本身（LRU）最多留 50 条。 */
export const RECENT_LIMIT = 20;

/** 四宫格与最近素材的图标；只在这个菜单里用，不值得进 IconBadge 的公共词表。 */
const MenuIcon: React.FC<{
  name: AttachmentMenuAction;
  size?: number;
  color: string;
}> = ({ name, size = 24, color }) => {
  const common = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'camera' ? (
        <>
          <Path
            d="M4 8.5h3l1.5-2h7l1.5 2h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"
            {...common}
          />
          <Circle cx="12" cy="13.5" r="3.2" {...common} />
        </>
      ) : null}
      {name === 'album' ? (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2" {...common} />
          <Circle cx="9" cy="9.5" r="1.6" {...common} />
          <Path d="m4.5 17 4.6-4.6 3.4 3.4 2.6-2.6 4.4 4.4" {...common} />
        </>
      ) : null}
      {name === 'draw' ? (
        <>
          <Path
            d="m4 20 1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20Z"
            {...common}
          />
          <Path d="m13.8 7 3.2 3.2" {...common} />
        </>
      ) : null}
      {name === 'ascii' ? (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2" {...common} />
          <Path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15M15 4.5v15" {...common} />
        </>
      ) : null}
    </Svg>
  );
};

const TILES: AttachmentMenuAction[] = ['camera', 'album', 'draw', 'ascii'];

export const AttachmentMenuSheet: React.FC<AttachmentMenuSheetProps> = ({
  open,
  onClose,
  onSelect,
  recent,
  onPickRecent,
  onDeleteRecent,
  onClearRecent,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');

  const kindLabel = (kind: LocalAsset['kind']) =>
    kind === 'ascii'
      ? t('attachments.kindAscii')
      : kind === 'drawing'
        ? t('attachments.kindDrawing')
        : t('attachments.kindPhoto');

  const visibleRecent = recent.slice(0, RECENT_LIMIT);

  /** 删除类动作统一走「取消 / destructive 确认」两键框。 */
  const confirmDestructive = (
    title: string,
    message: string,
    confirmLabel: string,
    action: () => void,
  ) => {
    Alert.alert(title, message, [
      { text: t('common:cancel'), style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: action },
    ]);
  };

  const handleLongPress = (asset: LocalAsset) => {
    if (!onDeleteRecent) return;
    confirmDestructive(
      t('attachments.deleteRecentTitle'),
      t('attachments.deleteRecentBody'),
      t('common:delete'),
      () => onDeleteRecent(asset),
    );
  };

  const handleClearRecent = () => {
    if (!onClearRecent) return;
    confirmDestructive(
      t('attachments.clearRecentTitle'),
      t('attachments.clearRecentBody'),
      t('common:delete'),
      onClearRecent,
    );
  };

  const renderThumb = (asset: LocalAsset) => {
    const uri = asset.kind === 'ascii' ? undefined : localFileUri(asset.localPath);
    const label = t('attachments.pickRecent', { name: kindLabel(asset.kind) });
    return (
      <Pressable
        key={asset.id}
        testID={`attachment-recent-${asset.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={
          onDeleteRecent ? t('attachments.deleteRecent', { name: kindLabel(asset.kind) }) : undefined
        }
        onPress={() => onPickRecent(asset)}
        onLongPress={onDeleteRecent ? () => handleLongPress(asset) : undefined}
        style={[
          styles.thumb,
          { backgroundColor: theme.colors.surfaceContainerHighest },
        ]}
      >
        {asset.kind === 'ascii' ? (
          <Text
            numberOfLines={6}
            style={[
              theme.typography.codeSm,
              styles.asciiThumb,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {asset.text ?? ''}
          </Text>
        ) : uri ? (
          <Image
            source={{ uri }}
            style={styles.thumbImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <MenuIcon name="album" size={22} color={theme.colors.onSurfaceVariant} />
        )}
      </Pressable>
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('attachments.title')}
      // 菜单本身很矮：没有最近素材时给 30%，有横滑条时给 46%。用固定 84%
      // 会在底部留一大片空白，看起来像加载失败。
      height={recent.length > 0 ? '46%' : '30%'}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.grid}>
          {TILES.map(action => (
            <Pressable
              key={action}
              testID={`attachment-tile-${action}`}
              accessibilityRole="button"
              accessibilityLabel={t(`attachments.${action}`)}
              onPress={() => onSelect(action)}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: theme.colors.surfaceContainerHighest,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <MenuIcon name={action} size={26} color={theme.colors.primary} />
              <Text
                numberOfLines={1}
                style={[theme.typography.labelSm, { color: theme.colors.onSurface }]}
              >
                {t(`attachments.${action}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {recent.length > 0 ? (
          <View testID="attachment-recent-section" style={styles.recentSection}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('attachments.recent')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentRail}
            >
              {visibleRecent.map(renderThumb)}
            </ScrollView>
            {onClearRecent ? (
              <Pressable
                testID="attachment-recent-clear"
                accessibilityRole="button"
                accessibilityLabel={t('attachments.clearRecent')}
                onPress={handleClearRecent}
                style={({ pressed }) => [
                  styles.clearButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.error },
                  ]}
                >
                  {t('attachments.clearRecent')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 22,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  recentSection: {
    gap: 10,
  },
  recentRail: {
    gap: 10,
    paddingRight: 20,
  },
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  asciiThumb: {
    paddingHorizontal: 4,
    fontSize: 8,
    lineHeight: 10,
  },
});
