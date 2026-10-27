/**
 * 消息气泡素材渲染（Task 19）。
 *
 * 三条契约，与 plan 的 Step 1 一一对应：
 *   - 有本地文件 → 直接 file://，不发签名请求；
 *   - 没有本地文件 → 一次批量请求（同一气泡里多张图合并）；
 *   - 签名失败 → 「图片已过期」占位，绝不渲染裂图。
 *
 * 另锁一个显示层决定：ASCII 不进缩略图（它在正文代码块里），只渲染图片。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../../api/attachments', () => ({
  signAttachments: jest.fn(),
}));

import { signAttachments } from '../../../api/attachments';
import type { AiAttachmentMeta } from '../../../api/attachments';
import {
  clearAttachmentSignCache,
  registerLocalAssetPath,
} from '../../../services/attachmentSignCache';
import { MessageAttachments } from '../MessageAttachments';

const signMock = signAttachments as jest.Mock;

const photo = (over: Partial<AiAttachmentMeta> = {}): AiAttachmentMeta => ({
  asset_id: 'a1',
  kind: 'photo',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  bytes: 1024,
  width: 800,
  height: 600,
  ...over,
});

const render = async (
  attachments?: AiAttachmentMeta[],
  sessionId = 'sess-1',
) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <MessageAttachments attachments={attachments} sessionId={sessionId} />,
    );
  });
  return renderer;
};

const hasTestId = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean =>
  renderer.root.findAll(
    node => node.props?.testID === testID && typeof node.type === 'string',
  ).length > 0;

const findByTestId = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance =>
  renderer.root.findAll(
    node => node.props?.testID === testID && typeof node.type === 'string',
  )[0];

// Pressable 的触摸回调挂在复合组件上,宿主 View 只有 responder 系列 prop;
// 想触发一次点击要抓带 testID 且 props.onPress 是函数的那个实例。
// viewer 的图片宽高来自 stage 的 onLayout(真机上由布局回填),测试里手动喂一次。
const layoutViewer = async (
  renderer: TestRenderer.ReactTestRenderer,
  width = 390,
  height = 844,
) => {
  await act(async () => {
    findByTestId(renderer, 'image-viewer-stage').props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
};

const press = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): (() => void) => {
  const node = renderer.root.findAll(
    item => item.props?.testID === testID && typeof item.props?.onPress === 'function',
  )[0];
  if (!node) throw new Error(`no pressable with testID=${testID}`);
  return node.props.onPress as () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  clearAttachmentSignCache();
});

describe('本地文件优先', () => {
  it('有 localPath → 用 file:// 渲染且不发签名请求', async () => {
    registerLocalAssetPath('a1', '/tmp/attachments/a1.jpg');
    const renderer = await render([photo()]);

    expect(signMock).not.toHaveBeenCalled();
    const image = findByTestId(renderer, 'message-attachment-image-a1');
    expect(image.props.source.uri).toBe('file:///tmp/attachments/a1.jpg');

    act(() => renderer.unmount());
  });
});

describe('远程签名', () => {
  it('无 localPath → 多张图合并成一次批量请求', async () => {
    signMock.mockImplementation((items: { asset_id: string }[]) =>
      Promise.resolve({
        urls: Object.fromEntries(
          items.map(it => [
            it.asset_id,
            {
              url: `https://cos.example/${it.asset_id}`,
              expires_at: new Date(Date.now() + 900_000).toISOString(),
            },
          ]),
        ),
        expires_in: 900,
      }),
    );

    const renderer = await render([
      photo({ asset_id: 'a1' }),
      photo({ asset_id: 'a2' }),
    ]);

    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock.mock.calls[0][0]).toEqual([
      { asset_id: 'a1', mime: 'image/jpeg', session_id: 'sess-1' },
      { asset_id: 'a2', mime: 'image/jpeg', session_id: 'sess-1' },
    ]);
    expect(
      findByTestId(renderer, 'message-attachment-image-a1').props.source.uri,
    ).toBe('https://cos.example/a1');
    expect(
      findByTestId(renderer, 'message-attachment-image-a2').props.source.uri,
    ).toBe('https://cos.example/a2');

    act(() => renderer.unmount());
  });

  it('签名失败 → 渲染「图片已过期」占位，不出现 Image', async () => {
    signMock.mockRejectedValue(new Error('network down'));

    const renderer = await render([photo()]);

    expect(hasTestId(renderer, 'message-attachment-expired-a1')).toBe(true);
    expect(hasTestId(renderer, 'message-attachment-image-a1')).toBe(false);

    act(() => renderer.unmount());
  });
});

describe('显示范围', () => {
  it('ASCII 不进缩略图（正文代码块已经展示）', async () => {
    const renderer = await render([
      photo({ asset_id: 'a1', kind: 'ascii', mime: 'text/plain', text: '┌─┐' }),
    ]);

    expect(hasTestId(renderer, 'message-attachments')).toBe(false);
    expect(signMock).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });

  it('没有素材 → 整块不渲染', async () => {
    const renderer = await render(undefined);
    expect(hasTestId(renderer, 'message-attachments')).toBe(false);
    act(() => renderer.unmount());
  });
});

describe('点缩略图放大(ImageViewerModal)', () => {
  it('点一下 → 全屏 viewer 出现，且拿到同一张图的 uri', async () => {
    registerLocalAssetPath('a1', '/tmp/attachments/a1.jpg');
    const renderer = await render([photo()]);

    expect(hasTestId(renderer, 'image-viewer-stage')).toBe(false);

    await act(async () => {
      press(renderer, 'message-attachment-open-a1')();
    });

    await layoutViewer(renderer);

    const viewer = findByTestId(renderer, 'image-viewer-image');
    expect(viewer.props.source.uri).toBe('file:///tmp/attachments/a1.jpg');

    act(() => renderer.unmount());
  });

  it('点遮罩关闭 → viewer 消失', async () => {
    registerLocalAssetPath('a1', '/tmp/attachments/a1.jpg');
    const renderer = await render([photo()]);

    await act(async () => {
      press(renderer, 'message-attachment-open-a1')();
    });
    expect(hasTestId(renderer, 'image-viewer-stage')).toBe(true);

    await act(async () => {
      press(renderer, 'image-viewer-backdrop')();
    });
    expect(hasTestId(renderer, 'image-viewer-stage')).toBe(false);

    act(() => renderer.unmount());
  });

  it('多张图各自打开自己那张（不串图）', async () => {
    signMock.mockImplementation((items: { asset_id: string }[]) =>
      Promise.resolve({
        urls: Object.fromEntries(
          items.map(it => [
            it.asset_id,
            {
              url: `https://cos.example/${it.asset_id}`,
              expires_at: new Date(Date.now() + 900_000).toISOString(),
            },
          ]),
        ),
        expires_in: 900,
      }),
    );

    const renderer = await render([
      photo({ asset_id: 'a1' }),
      photo({ asset_id: 'a2' }),
    ]);

    await act(async () => {
      press(renderer, 'message-attachment-open-a2')();
    });
    await layoutViewer(renderer);

    expect(
      findByTestId(renderer, 'image-viewer-image').props.source.uri,
    ).toBe('https://cos.example/a2');

    act(() => renderer.unmount());
  });
});
