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

const render = async (attachments?: AiAttachmentMeta[]) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <MessageAttachments attachments={attachments} />,
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
    signMock.mockImplementation((ids: string[]) =>
      Promise.resolve({
        urls: Object.fromEntries(
          ids.map(id => [
            id,
            {
              url: `https://cos.example/${id}`,
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
    expect(signMock.mock.calls[0][0]).toEqual(['a1', 'a2']);
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
