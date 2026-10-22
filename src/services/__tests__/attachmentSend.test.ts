// Task 18（TDD）：带素材发送的编排。
// 契约（plan 原文四条）：
//   1. 选 2 张图 → 发送函数收到长度 2 的数组。
//   2. 发送成功 → onSent 收到每条素材（屏幕据此清 chips + touchAsset）。
//   3. 发送失败 → onSent 不回调（chips 保留，不丢用户素材）。
//   4. 纯 ASCII → content 追加代码块，attachments 仍传（服务端侧物化）。
// 另加：物化失败（上传挂了）→ onUploadError 一次、send 不调用。
import type { AiAttachmentMeta } from '../../api/attachments';
import type { LocalAsset } from '../attachmentLibrary';
import {
  buildAttachmentMetas,
  defaultAttachmentCaption,
  sendUserMessageWithAssets,
  withAsciiBlocks,
} from '../attachmentSend';
import {
  createAsciiAttachment,
  uploadAsset,
} from '../attachmentUpload';

// attachmentLibrary 在模块顶层读 DocumentDir 拼素材目录；这里只做编排，
// 不碰文件系统，给个最小桩即可（与 AttachmentMenuSheet.test.tsx 同款）。
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: { dirs: { DocumentDir: '/tmp/rnbu/documents', CacheDir: '/tmp/rnbu/cache' } },
  },
}));

jest.mock('../attachmentUpload', () => {
  const actual = jest.requireActual('../attachmentUpload');
  return {
    ...actual,
    createAsciiAttachment: jest.fn(),
    uploadAsset: jest.fn(),
  };
});

const createAsciiMock = createAsciiAttachment as unknown as jest.Mock;
const uploadAssetMock = uploadAsset as unknown as jest.Mock;

const makeAsset = (over: Partial<LocalAsset> = {}): LocalAsset => ({
  id: 'asset-1',
  kind: 'photo',
  createdAt: 1,
  localPath: '/docs/attachments/asset-1.jpg',
  bytes: 1234,
  width: 800,
  height: 600,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  uploadAssetMock.mockImplementation((_sessionId: string, asset: LocalAsset) =>
    Promise.resolve({ assetId: `srv-${asset.id}` }),
  );
  createAsciiMock.mockImplementation((_sessionId: string, asset: LocalAsset) =>
    Promise.resolve({ assetId: `srv-${asset.id}` }),
  );
});

describe('buildAttachmentMetas', () => {
  it('图片按上传结果生成元数据，字段齐全', async () => {
    const metas = await buildAttachmentMetas('sess-1', [makeAsset()]);

    expect(uploadAssetMock).toHaveBeenCalledWith('sess-1', expect.objectContaining({ id: 'asset-1' }));
    expect(metas).toEqual([
      {
        asset_id: 'srv-asset-1',
        kind: 'photo',
        name: 'asset-1.jpg',
        mime: 'image/jpeg',
        bytes: 1234,
        width: 800,
        height: 600,
      },
    ]);
  });

  it('ASCII 走 createAsciiAttachment，元数据带正文与字节数', async () => {
    const metas = await buildAttachmentMetas('sess-1', [
      makeAsset({ id: 'a2', kind: 'ascii', localPath: undefined, text: '┌─┐\n│A│\n└─┘' }),
    ]);

    expect(createAsciiMock).toHaveBeenCalledTimes(1);
    expect(uploadAssetMock).not.toHaveBeenCalled();
    expect(metas[0]).toEqual(
      expect.objectContaining({
        asset_id: 'srv-a2',
        kind: 'ascii',
        mime: 'text/plain',
        text: '┌─┐\n│A│\n└─┘',
        // 制表符 3 字节 × 8 + 字母 A 1 字节 + 两个换行 2 字节 = 27。
        bytes: 27,
      }),
    );
  });
});

describe('withAsciiBlocks', () => {
  it('非 ASCII 素材不动正文', () => {
    expect(withAsciiBlocks('看这张图', [makeAsset()])).toBe('看这张图');
  });

  it('ASCII 追加为围栏代码块', () => {
    const out = withAsciiBlocks('看这个布局', [
      makeAsset({ kind: 'ascii', localPath: undefined, text: '┌─┐\n└─┘' }),
    ]);
    expect(out).toBe('看这个布局\n\n```\n┌─┐\n└─┘\n```');
  });

  it('正文为空白的 ASCII 跳过', () => {
    expect(
      withAsciiBlocks('hi', [
        makeAsset({ kind: 'ascii', localPath: undefined, text: '   ' }),
      ]),
    ).toBe('hi');
  });
});

describe('defaultAttachmentCaption', () => {
  /** 记录取过哪些 key，顺带返回 key 本身当文案。 */
  const translator = () => {
    const keys: string[] = [];
    const t = (key: string) => {
      keys.push(key);
      return key;
    };
    return { keys, t };
  };

  it('单张照片 → 照片措辞', () => {
    const { t } = translator();
    expect(defaultAttachmentCaption([makeAsset()], t)).toBe(
      'attachments.defaultPhotoPrompt',
    );
  });

  it('单张手绘 → 手绘措辞', () => {
    const { t } = translator();
    expect(
      defaultAttachmentCaption([makeAsset({ kind: 'drawing' })], t),
    ).toBe('drawing.defaultPrompt');
  });

  it('ASCII → 字符画措辞', () => {
    const { t } = translator();
    expect(
      defaultAttachmentCaption(
        [makeAsset({ kind: 'ascii', text: '─', cols: 1, rows: 1 })],
        t,
      ),
    ).toBe('ascii.defaultPrompt');
  });

  it('多张同类型照片 → 仍用照片措辞', () => {
    const { t } = translator();
    expect(
      defaultAttachmentCaption([makeAsset(), makeAsset({ id: 'asset-2' })], t),
    ).toBe('attachments.defaultPhotoPrompt');
  });

  it('混选不同类型 → 泛称，不误称「手绘图」', () => {
    const { t } = translator();
    expect(
      defaultAttachmentCaption(
        [makeAsset(), makeAsset({ id: 'asset-2', kind: 'drawing' })],
        t,
      ),
    ).toBe('attachments.defaultPrompt');
  });
});

describe('sendUserMessageWithAssets', () => {
  it('选 2 张图 → 发送函数收到长度 2 的数组', async () => {
    const send = jest.fn(() => Promise.resolve());
    await sendUserMessageWithAssets({
      sessionId: 'sess-1',
      content: '这两张',
      assets: [makeAsset({ id: 'a' }), makeAsset({ id: 'b' })],
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [content, attachments] = send.mock.calls[0] as unknown as [string, AiAttachmentMeta[]];
    expect(content).toBe('这两张');
    expect(attachments).toHaveLength(2);
    expect(attachments.map(item => item.asset_id)).toEqual(['srv-a', 'srv-b']);
  });

  it('发送成功 → onSent 收到每条素材', async () => {
    const sent: LocalAsset[][] = [];
    await sendUserMessageWithAssets({
      sessionId: 'sess-1',
      content: 'x',
      assets: [makeAsset({ id: 'a' }), makeAsset({ id: 'b' })],
      send: () => Promise.resolve(),
      onSent: assets => sent.push(assets),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].map(item => item.id)).toEqual(['a', 'b']);
  });

  it('发送失败 → onSent 不回调（chips 保留），错误向上抛', async () => {
    const sent = jest.fn();
    await expect(
      sendUserMessageWithAssets({
        sessionId: 'sess-1',
        content: 'x',
        assets: [makeAsset()],
        send: () => Promise.reject(new Error('409 busy')),
        onSent: sent,
      }),
    ).rejects.toThrow(/409/);
    expect(sent).not.toHaveBeenCalled();
  });

  it('物化失败 → onUploadError 一次，send 不调用', async () => {
    uploadAssetMock.mockRejectedValueOnce(new Error('cos down'));
    const send = jest.fn(() => Promise.resolve());
    const onUploadError = jest.fn();

    await expect(
      sendUserMessageWithAssets({
        sessionId: 'sess-1',
        content: 'x',
        assets: [makeAsset()],
        send,
        onUploadError,
      }),
    ).rejects.toThrow(/cos down/);

    expect(onUploadError).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('纯 ASCII → content 追加代码块，attachments 仍传', async () => {
    const send = jest.fn(() => Promise.resolve());
    await sendUserMessageWithAssets({
      sessionId: 'sess-1',
      content: '照着这个画',
      assets: [
        makeAsset({ id: 'a2', kind: 'ascii', localPath: undefined, text: '┌─┐\n└─┘' }),
      ],
      send,
    });

    const [content, attachments] = send.mock.calls[0] as unknown as [string, AiAttachmentMeta[]];
    expect(content).toContain('```\n┌─┐\n└─┘\n```');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual(expect.objectContaining({ kind: 'ascii' }));
  });

  it('无素材 → 不物化、attachments 为空数组、onSent 不回调', async () => {
    const send = jest.fn(() => Promise.resolve());
    const onSent = jest.fn();
    await sendUserMessageWithAssets({
      sessionId: 'sess-1',
      content: '纯文本',
      assets: [],
      send,
      onSent,
    });

    expect(uploadAssetMock).not.toHaveBeenCalled();
    expect(createAsciiMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('纯文本', []);
    expect(onSent).not.toHaveBeenCalled();
  });
});
