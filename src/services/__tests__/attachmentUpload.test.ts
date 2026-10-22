// Task 16（TDD）：拍照 / 相册 / 上传。
// 契约：
//   1. 用户取消 → 空数组，不抛。
//   2. picker 报错（权限/相机不可用）→ 抛，消息带上 errorCode。
//   3. 相机参数必须带 includeExtra:false（EXIF/GPS 不外泄）与 1568 长边上限。
//   4. mime 从扩展名推导，不信任 picker 的 type 字段。
//   5. 上传：create → PUT(Content-Type) → complete，返回 {assetId, objectKey}
//      （发送消息只认 assetId；objectKey 仅回填素材库）。
//   6. 上传失败抛错，且不写 uploadedAt（不调 markAssetUploaded）。
//   7. 进度单调递增，末值为 1。
//   8. 相册多选截到 8 张。
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  completeAttachment,
  createAttachment,
} from '../../api/attachments';
import { addAsset, markAssetUploaded } from '../attachmentLibrary';
import type { LocalAsset } from '../attachmentLibrary';
import {
  JPEG_QUALITY,
  MAX_PICK_PER_ROUND,
  TARGET_LONG_EDGE,
  createAsciiAttachment,
  mimeFromName,
  pickFromCamera,
  pickFromLibrary,
  toLocalPath,
  uploadAsset,
  uploadAssets,
  utf8ByteLength,
} from '../attachmentUpload';

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

// 每个 jest.fn 都在工厂内部创建：babel-jest 把 jest.mock 提升到 import 之上。
jest.mock('react-native-blob-util', () => {
  const progressMock = jest.fn();
  const fetchMock = jest.fn(() => ({
    progress: progressMock,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({
        info: () => ({ status: 200 }),
      }).then(resolve, reject),
  }));
  const wrapMock = jest.fn((path: string) => `wrapped:${path}`);
  return {
    __esModule: true,
    default: {
      fetch: fetchMock,
      wrap: wrapMock,
      __mocks: { fetchMock, progressMock, wrapMock },
    },
  };
});

jest.mock('../../api/attachments', () => ({
  createAttachment: jest.fn(),
  completeAttachment: jest.fn(() => Promise.resolve({ asset_id: 'a1', status: 'ready' })),
  signAttachments: jest.fn(),
}));

jest.mock('../attachmentLibrary', () => ({
  addAsset: jest.fn(),
  markAssetUploaded: jest.fn(() => Promise.resolve()),
}));

interface BlobMocks {
  fetchMock: jest.Mock;
  progressMock: jest.Mock;
  wrapMock: jest.Mock;
}

const blob = (ReactNativeBlobUtil as unknown as { __mocks: BlobMocks }).__mocks;
const launchCameraMock = launchCamera as unknown as jest.Mock;
const launchImageLibraryMock = launchImageLibrary as unknown as jest.Mock;
const createAttachmentMock = createAttachment as unknown as jest.Mock;
const completeAttachmentMock = completeAttachment as unknown as jest.Mock;
const addAssetMock = addAsset as unknown as jest.Mock;
const markUploadedMock = markAssetUploaded as unknown as jest.Mock;

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
  addAssetMock.mockImplementation((input: { kind: string }) =>
    Promise.resolve(makeAsset({ kind: input.kind as LocalAsset['kind'] })),
  );
});

describe('toLocalPath', () => {
  it('剥掉 file:// 前缀，裸路径原样返回', () => {
    expect(toLocalPath('file:///var/mobile/a.jpg')).toBe('/var/mobile/a.jpg');
    expect(toLocalPath('/var/mobile/a.jpg')).toBe('/var/mobile/a.jpg');
  });
});

describe('mimeFromName', () => {
  it('按扩展名推导，未知扩展名回落 jpeg', () => {
    expect(mimeFromName('a.PNG')).toBe('image/png');
    expect(mimeFromName('a.jpeg')).toBe('image/jpeg');
    expect(mimeFromName('a.webp')).toBe('image/webp');
    expect(mimeFromName('a.heic')).toBe('image/jpeg');
    expect(mimeFromName('noext')).toBe('image/jpeg');
  });
});

describe('pickFromCamera', () => {
  it('带 includeExtra:false 与 1568 长边、0.8 质量', async () => {
    launchCameraMock.mockResolvedValue({
      assets: [{ uri: 'file:///tmp/shot.jpg', width: 800, height: 600, fileSize: 99 }],
    });
    await pickFromCamera();

    expect(launchCameraMock).toHaveBeenCalledTimes(1);
    const options = launchCameraMock.mock.calls[0][0];
    expect(options.includeExtra).toBe(false);
    expect(options.maxWidth).toBe(TARGET_LONG_EDGE);
    expect(options.maxHeight).toBe(TARGET_LONG_EDGE);
    expect(options.quality).toBe(JPEG_QUALITY);
    expect(options.mediaType).toBe('photo');
    expect(options.saveToPhotos).toBe(false);
  });

  it('取消 → 空数组，不入库', async () => {
    launchCameraMock.mockResolvedValue({ didCancel: true });
    await expect(pickFromCamera()).resolves.toEqual([]);
    expect(addAssetMock).not.toHaveBeenCalled();
  });

  it('picker 报错 → 抛，消息含 errorCode', async () => {
    launchCameraMock.mockResolvedValue({ errorCode: 'permission' });
    await expect(pickFromCamera()).rejects.toThrow(/permission/);
    expect(addAssetMock).not.toHaveBeenCalled();
  });

  it('入库用裸路径而不是 file:// URI', async () => {
    launchCameraMock.mockResolvedValue({
      assets: [{ uri: 'file:///tmp/shot.jpg', width: 10, height: 20 }],
    });
    await pickFromCamera();
    expect(addAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'photo', sourcePath: '/tmp/shot.jpg' }),
    );
  });
});

describe('pickFromLibrary', () => {
  it('多选截到 8 张，selectionLimit:0', async () => {
    launchImageLibraryMock.mockResolvedValue({
      assets: Array.from({ length: 12 }, (_, i) => ({
        uri: `file:///tmp/p${i}.jpg`,
      })),
    });
    const assets = await pickFromLibrary();
    expect(launchImageLibraryMock.mock.calls[0][0].selectionLimit).toBe(0);
    expect(addAssetMock).toHaveBeenCalledTimes(MAX_PICK_PER_ROUND);
    expect(assets).toHaveLength(MAX_PICK_PER_ROUND);
  });

  it('取消 → 空数组', async () => {
    launchImageLibraryMock.mockResolvedValue({ didCancel: true });
    await expect(pickFromLibrary()).resolves.toEqual([]);
  });
});

describe('utf8ByteLength', () => {
  it('按 UTF-8 计字节：ASCII 1、中文 3、emoji 4', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('中文')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('createAsciiAttachment', () => {
  it('走文本通道：create(kind:ascii,text)，不 PUT、不 complete，返回 assetId', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-ascii',
      kind: 'ascii',
      status: 'ready',
    });

    const uploaded = await createAsciiAttachment(
      'sess-1',
      makeAsset({ kind: 'ascii', localPath: undefined, text: '┌─┐\n│A│\n└─┘' }),
    );

    expect(createAttachmentMock).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        kind: 'ascii',
        mime: 'text/plain',
        text: '┌─┐\n│A│\n└─┘',
        bytes: utf8ByteLength('┌─┐\n│A│\n└─┘'),
      }),
    );
    expect(blob.fetchMock).not.toHaveBeenCalled();
    expect(completeAttachmentMock).not.toHaveBeenCalled();
    expect(uploaded).toEqual({ assetId: 'srv-ascii' });
  });

  it('正文为空 → 抛，不发请求', async () => {
    await expect(
      createAsciiAttachment(
        'sess-1',
        makeAsset({ kind: 'ascii', localPath: undefined, text: '   ' }),
      ),
    ).rejects.toThrow(/no text/);
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });
});

describe('uploadAsset', () => {
  it('create → PUT(Content-Type) → complete，返回 assetId 与 objectKey', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-1',
      status: 'pending',
      put_url: 'https://cos.example.com/put',
      object_key: 'ai-attachments/u/a.jpg',
    });

    const uploaded = await uploadAsset('sess-1', makeAsset());

    expect(createAttachmentMock).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ mime: 'image/jpeg', name: 'asset-1.jpg' }),
    );
    expect(blob.fetchMock).toHaveBeenCalledWith(
      'PUT',
      'https://cos.example.com/put',
      { 'Content-Type': 'image/jpeg' },
      'wrapped:/docs/attachments/asset-1.jpg',
    );
    expect(completeAttachmentMock).toHaveBeenCalledWith('sess-1', 'srv-1');
    expect(uploaded).toEqual({
      assetId: 'srv-1',
      objectKey: 'ai-attachments/u/a.jpg',
    });
    // 成功才回填 objectKey（重发排障用）。
    expect(markUploadedMock).toHaveBeenCalledWith('asset-1', 'ai-attachments/u/a.jpg');
  });

  it('上传 HTTP 非 2xx → 抛，且不 complete、不写 uploadedAt', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-1',
      status: 'pending',
      put_url: 'https://cos.example.com/put',
    });
    blob.fetchMock.mockImplementationOnce(() => ({
      progress: blob.progressMock,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ info: () => ({ status: 403 }) }).then(resolve, reject),
    }));

    await expect(uploadAsset('sess-1', makeAsset())).rejects.toThrow(/403/);
    expect(completeAttachmentMock).not.toHaveBeenCalled();
    expect(markUploadedMock).not.toHaveBeenCalled();
  });

  it('服务端没给 put_url → 抛', async () => {
    createAttachmentMock.mockResolvedValue({ asset_id: 'srv-1', status: 'pending' });
    await expect(uploadAsset('sess-1', makeAsset())).rejects.toThrow(/upload url/);
  });

  it('create 直接 ready 时不走 PUT', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-1',
      status: 'ready',
      object_key: 'ai-attachments/u/a.jpg',
    });
    const uploaded = await uploadAsset('sess-1', makeAsset());
    expect(blob.fetchMock).not.toHaveBeenCalled();
    expect(uploaded).toEqual({
      assetId: 'srv-1',
      objectKey: 'ai-attachments/u/a.jpg',
    });
  });

  it('ascii 素材必须走 createAsciiAttachment，uploadAsset 直接拒绝', async () => {
    await expect(
      uploadAsset('sess-1', makeAsset({ kind: 'ascii', localPath: undefined })),
    ).rejects.toThrow(/createAsciiAttachment/);
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it('没有本地文件 → 抛', async () => {
    await expect(
      uploadAsset('sess-1', makeAsset({ localPath: undefined })),
    ).rejects.toThrow(/local file/);
  });

  it('进度回调单调递增且以 1 收尾', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-1',
      status: 'pending',
      put_url: 'https://cos.example.com/put',
    });
    // 注册 progress 时立刻打一次 50%——模拟真实上传中回调先于完成到达。
    blob.progressMock.mockImplementation(
      (_opts: unknown, cb: (received: number, total: number) => void) => {
        cb(50, 100);
      },
    );

    const ratios: number[] = [];
    await uploadAsset('sess-1', makeAsset(), r => ratios.push(r));

    expect(ratios[0]).toBe(0.5);
    expect(ratios[ratios.length - 1]).toBe(1);
    expect(ratios.every((r, i) => i === 0 || r >= ratios[i - 1])).toBe(true);
  });

  it('进度换算把 ratio 夹在 [0,1]，total 未知时给 0', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv-1',
      status: 'pending',
      put_url: 'https://cos.example.com/put',
    });
    const ratios: number[] = [];
    blob.progressMock.mockImplementation(() => {});
    await uploadAsset('sess-1', makeAsset(), r => ratios.push(r));

    const onProgress = blob.progressMock.mock.calls[0][1] as (
      received: number,
      total: number,
    ) => void;
    ratios.length = 0;
    onProgress(200, 100);
    onProgress(10, 0);

    expect(ratios).toEqual([1, 0]);
    expect(ratios.every(r => Number.isFinite(r) && r >= 0 && r <= 1)).toBe(true);
  });
});

describe('uploadAssets', () => {
  it('串行上传，整体进度按张数推进', async () => {
    createAttachmentMock.mockResolvedValue({
      asset_id: 'srv',
      status: 'pending',
      put_url: 'https://cos.example.com/put',
      object_key: 'k',
    });
    const ratios: number[] = [];
    const uploaded = await uploadAssets(
      'sess-1',
      [makeAsset({ id: 'a' }), makeAsset({ id: 'b' })],
      r => ratios.push(r),
    );
    expect(uploaded).toEqual([
      { assetId: 'srv', objectKey: 'k' },
      { assetId: 'srv', objectKey: 'k' },
    ]);
    expect(blob.fetchMock).toHaveBeenCalledTimes(2);
    expect(ratios[ratios.length - 1]).toBe(1);
    expect(ratios.every((r, i) => i === 0 || r >= ratios[i - 1])).toBe(true);
  });
});
