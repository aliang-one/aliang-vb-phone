/**
 * 素材菜单契约（Task 17）。
 *
 * 菜单是纯展示组件：四个入口各发一个回调，「最近使用」为空时整块不渲染。
 * BottomSheet 依赖 reanimated/safe-area/Modal，测试里整体 stub 成透明容器，
 * 只锁菜单自己的逻辑——和 UpdateAvailableSheet.test.tsx 同一套手法。
 *
 * 另锁 a11y：四宫格必须是 button 且带可读标签（VoiceOver 念「拍照」而不是
 * 一串无名按钮）。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';

// attachmentLibrary 在模块顶层读 DocumentDir 拼素材目录；菜单只用它算缩略图
// URI，不碰文件系统，给个最小桩即可。
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: { dirs: { DocumentDir: '/tmp/rnbu/documents', CacheDir: '/tmp/rnbu/cache' } },
  },
}));

jest.mock('../../shared/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheet: (props: {
      open: boolean;
      title?: string;
      children?: React.ReactNode;
    }) =>
      props.open
        ? React.createElement(
            View,
            { testID: 'bottom-sheet-stub', title: props.title },
            props.children,
          )
        : null,
  };
});

import { AttachmentMenuSheet } from '../AttachmentMenuSheet';
import type { AttachmentMenuSheetProps } from '../AttachmentMenuSheet';
import type { LocalAsset } from '../../../services/attachmentLibrary';

const photo: LocalAsset = {
  id: 'asset-photo',
  kind: 'photo',
  createdAt: 1_700_000_000_000,
  localPath: '/tmp/photo.jpg',
  bytes: 1024,
};

const drawing: LocalAsset = {
  id: 'asset-drawing',
  kind: 'drawing',
  createdAt: 1_700_000_100_000,
  localPath: '/tmp/drawing.png',
  bytes: 2048,
};

const ascii: LocalAsset = {
  id: 'asset-ascii',
  kind: 'ascii',
  createdAt: 1_700_000_200_000,
  text: '┌───┐\n│ A │\n└───┘',
  cols: 5,
  rows: 3,
};

const baseProps = {
  open: true,
  onClose: jest.fn(),
  onSelect: jest.fn(),
  recent: [],
  onPickRecent: jest.fn(),
} as unknown as AttachmentMenuSheetProps;

const render = (overrides: Partial<AttachmentMenuSheetProps> = {}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AttachmentMenuSheet {...baseProps} {...overrides} />,
    );
  });
  return renderer;
};

/** 取带 testID 且自身可点的那一层（Pressable 复合层与宿主层都会带 testID）。 */
const pressable = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance =>
  renderer.root.findAll(
    node =>
      node.props?.testID === testID &&
      typeof node.props?.onPress === 'function',
  )[0];

const hasTestId = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean =>
  renderer.root.findAll(
    node => node.props?.testID === testID && typeof node.type === 'string',
  ).length > 0;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AttachmentMenuSheet 四宫格', () => {
  test('四个入口各按各的回调', () => {
    const onSelect = jest.fn();
    const renderer = render({ onSelect });

    pressable(renderer, 'attachment-tile-camera').props.onPress();
    pressable(renderer, 'attachment-tile-album').props.onPress();
    pressable(renderer, 'attachment-tile-draw').props.onPress();
    pressable(renderer, 'attachment-tile-ascii').props.onPress();

    expect(onSelect.mock.calls.map(call => call[0])).toEqual([
      'camera',
      'album',
      'draw',
      'ascii',
    ]);
    act(() => renderer.unmount());
  });

  test('四宫格是 button 且带中文可读标签', () => {
    const renderer = render();

    const expectations: Array<[string, string]> = [
      ['attachment-tile-camera', '拍照'],
      ['attachment-tile-album', '相册'],
      ['attachment-tile-draw', '手绘'],
      ['attachment-tile-ascii', 'ASCII 图'],
    ];
    for (const [testID, label] of expectations) {
      const node = pressable(renderer, testID);
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toBe(label);
    }
    act(() => renderer.unmount());
  });
});

describe('AttachmentMenuSheet 最近素材', () => {
  test('没有最近素材时整块不渲染', () => {
    const renderer = render({ recent: [] });
    expect(hasTestId(renderer, 'attachment-recent-section')).toBe(false);
    act(() => renderer.unmount());
  });

  test('有最近素材时三类混排，点一下=选中（不是发送）', () => {
    const onPickRecent = jest.fn();
    const renderer = render({
      recent: [photo, drawing, ascii],
      onPickRecent,
    });

    expect(hasTestId(renderer, 'attachment-recent-section')).toBe(true);
    for (const asset of [photo, drawing, ascii]) {
      expect(hasTestId(renderer, `attachment-recent-${asset.id}`)).toBe(true);
    }

    pressable(renderer, 'attachment-recent-asset-ascii').props.onPress();
    expect(onPickRecent).toHaveBeenCalledTimes(1);
    expect(onPickRecent).toHaveBeenCalledWith(ascii);
    act(() => renderer.unmount());
  });

  test('长按最近素材 → 先弹确认，确认后才删除', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDeleteRecent = jest.fn();
    const renderer = render({
      recent: [photo],
      onDeleteRecent,
    });

    pressable(renderer, 'attachment-recent-asset-photo').props.onLongPress();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    // 未点确认前什么都不删。
    expect(onDeleteRecent).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text?: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.map(button => button.style)).toEqual(['cancel', 'destructive']);
    act(() => buttons[1].onPress?.());
    expect(onDeleteRecent).toHaveBeenCalledWith(photo);
    act(() => renderer.unmount());
    alertSpy.mockRestore();
  });

  test('取消删除 → 回调不触发', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDeleteRecent = jest.fn();
    const renderer = render({ recent: [photo], onDeleteRecent });

    pressable(renderer, 'attachment-recent-asset-photo').props.onLongPress();
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    act(() => buttons[0].onPress?.());
    expect(onDeleteRecent).not.toHaveBeenCalled();

    act(() => renderer.unmount());
    alertSpy.mockRestore();
  });

  test('未接删除回调时没有长按行为', () => {
    const renderer2 = render({ recent: [photo] });
    expect(
      pressable(renderer2, 'attachment-recent-asset-photo').props.onLongPress,
    ).toBeUndefined();
    act(() => renderer2.unmount());
  });

  test('最多显示 20 条（库可以更多，横滑条只放 20）', () => {
    const many: LocalAsset[] = Array.from({ length: 25 }, (_, i) => ({
      ...photo,
      id: `asset-${i}`,
      createdAt: 1_700_000_000_000 + i,
    }));
    const renderer = render({ recent: many });

    expect(hasTestId(renderer, 'attachment-recent-asset-0')).toBe(true);
    expect(hasTestId(renderer, 'attachment-recent-asset-19')).toBe(true);
    expect(hasTestId(renderer, 'attachment-recent-asset-20')).toBe(false);
    expect(hasTestId(renderer, 'attachment-recent-asset-24')).toBe(false);
    act(() => renderer.unmount());
  });

  test('底部「清空最近素材」→ 确认后回调', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onClearRecent = jest.fn();
    const renderer = render({ recent: [photo, drawing], onClearRecent });

    pressable(renderer, 'attachment-recent-clear').props.onPress();
    expect(onClearRecent).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    act(() => buttons[1].onPress?.());
    expect(onClearRecent).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    alertSpy.mockRestore();
  });

  test('清空后列表消失；未接清空回调时不渲染按钮', () => {
    const renderer = render({ recent: [photo], onClearRecent: jest.fn() });
    expect(hasTestId(renderer, 'attachment-recent-clear')).toBe(true);
    act(() => renderer.unmount());

    const cleared = render({ recent: [] });
    expect(hasTestId(cleared, 'attachment-recent-section')).toBe(false);
    expect(hasTestId(cleared, 'attachment-recent-clear')).toBe(false);
    act(() => cleared.unmount());

    const noHandler = render({ recent: [photo] });
    expect(hasTestId(noHandler, 'attachment-recent-clear')).toBe(false);
    act(() => noHandler.unmount());
  });

  test('最近素材标签按类型区分（照片/手绘/ASCII 图）', () => {
    const renderer = render({ recent: [photo, drawing, ascii] });
    expect(
      pressable(renderer, 'attachment-recent-asset-photo').props
        .accessibilityLabel,
    ).toBe('使用素材 照片');
    expect(
      pressable(renderer, 'attachment-recent-asset-drawing').props
        .accessibilityLabel,
    ).toBe('使用素材 手绘');
    expect(
      pressable(renderer, 'attachment-recent-asset-ascii').props
        .accessibilityLabel,
    ).toBe('使用素材 ASCII 图');
    act(() => renderer.unmount());
  });
});
