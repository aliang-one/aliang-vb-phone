// Task 15（TDD）：本地素材库。
// 契约：
//   1. 坏索引 JSON / 非数组 / 单条缺字段 → 回落空数组或只丢坏的那条，绝不抛。
//   2. addAsset 把源文件 cp 进 DocumentDir/attachments/<id>.<ext>，索引里存路径。
//   3. 超过 50 条淘汰 lastUsedAt 最旧的一条，并删掉它的文件。
//   4. 并发 add 不丢条目（写操作串行化）。
//   5. 删文件失败不阻断索引更新（索引先落盘，文件尽力删）。
//   6. removeAsset / clearLibrary 同步删文件；touchAsset 只更新时间戳。
//   7. ascii 素材不落文件、不碰 fs。
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  ATTACHMENT_LIBRARY_KEY,
  ATTACHMENT_LIBRARY_MAX,
  addAsset,
  applyLibraryCap,
  clearLibrary,
  markAssetUploaded,
  readLibraryIndex,
  removeAsset,
  resetAttachmentLibraryQueueForTest,
  touchAsset,
} from '../attachmentLibrary';
import type { LocalAsset } from '../attachmentLibrary';

// babel-jest 把 jest.mock 提升到 import 之上，工厂必须自包含。
jest.mock('react-native-blob-util', () => {
  const DOCUMENT_DIR = '/tmp/rnbu/documents';
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const failUnlink = { value: false };
  const failCp = { value: false };
  const cpMock = jest.fn((from: string, to: string) => {
    if (failCp.value) return Promise.reject(new Error('cp failed'));
    if (!files.has(from)) return Promise.reject(new Error(`missing ${from}`));
    files.set(to, files.get(from) as string);
    return Promise.resolve(true);
  });
  const unlinkMock = jest.fn((path: string) => {
    if (failUnlink.value) return Promise.reject(new Error('unlink failed'));
    files.delete(path);
    return Promise.resolve(undefined);
  });
  const existsMock = jest.fn((path: string) =>
    Promise.resolve(files.has(path) || dirs.has(path)),
  );
  const mkdirMock = jest.fn((path: string) => {
    dirs.add(path);
    return Promise.resolve(undefined);
  });
  const statMock = jest.fn((path: string) =>
    Promise.resolve({ size: (files.get(path) ?? '').length }),
  );
  return {
    __esModule: true,
    default: {
      fs: {
        dirs: { DocumentDir: DOCUMENT_DIR, CacheDir: '/tmp/rnbu/cache' },
        cp: cpMock,
        unlink: unlinkMock,
        exists: existsMock,
        mkdir: mkdirMock,
        stat: statMock,
      },
      __mocks: { files, dirs, failUnlink, failCp, cpMock, unlinkMock, existsMock, mkdirMock, statMock, DOCUMENT_DIR },
    },
  };
});

interface RnbuMocks {
  files: Map<string, string>;
  dirs: Set<string>;
  failUnlink: { value: boolean };
  failCp: { value: boolean };
  cpMock: jest.Mock;
  unlinkMock: jest.Mock;
  existsMock: jest.Mock;
  mkdirMock: jest.Mock;
  statMock: jest.Mock;
  DOCUMENT_DIR: string;
}

const mocks = (ReactNativeBlobUtil as unknown as { __mocks: RnbuMocks }).__mocks;
const { files, failUnlink, failCp, DOCUMENT_DIR } = mocks;

const seedFile = (path: string, body = 'img') => {
  files.set(path, body);
};

beforeEach(async () => {
  await AsyncStorage.clear();
  files.clear();
  failUnlink.value = false;
  failCp.value = false;
  jest.clearAllMocks();
  resetAttachmentLibraryQueueForTest();
});

describe('readLibraryIndex', () => {
  it('无值时返回空数组', async () => {
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });

  it('坏 JSON 回落空数组而不抛', async () => {
    await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, '{not json');
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });

  it('非数组结构回落空数组', async () => {
    await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, '{"a":1}');
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });

  it('单条坏数据只丢那一条', async () => {
    await AsyncStorage.setItem(
      ATTACHMENT_LIBRARY_KEY,
      JSON.stringify([
        { id: 'ok', kind: 'photo', createdAt: 1 },
        { id: 'no-kind', createdAt: 2 },
        null,
        { id: 'bad-kind', kind: 'video', createdAt: 3 },
      ]),
    );
    const index = await readLibraryIndex();
    expect(index.map(a => a.id)).toEqual(['ok']);
  });
});

describe('addAsset', () => {
  it('把图片复制进库目录并记录路径与字节数', async () => {
    seedFile('/tmp/shot.jpg', 'jpeg-bytes');
    const asset = await addAsset({
      kind: 'photo',
      sourcePath: '/tmp/shot.jpg',
      width: 800,
      height: 600,
    });

    expect(asset.kind).toBe('photo');
    expect(asset.localPath).toBe(`${DOCUMENT_DIR}/attachments/${asset.id}.jpg`);
    expect(asset.bytes).toBe('jpeg-bytes'.length);
    expect(asset.createdAt).toBeGreaterThan(0);
    expect(asset.lastUsedAt).toBe(asset.createdAt);
    // 源文件原样复制，未搬移。
    expect(files.get('/tmp/shot.jpg')).toBe('jpeg-bytes');
    expect(files.get(asset.localPath as string)).toBe('jpeg-bytes');

    const index = await readLibraryIndex();
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(asset.id);
  });

  it('未知扩展名按 jpg 存（HEIC 等由上层转码）', async () => {
    seedFile('/tmp/IMG_0001.HEIC', 'heic');
    const asset = await addAsset({ kind: 'photo', sourcePath: '/tmp/IMG_0001.HEIC' });
    expect(asset.localPath).toBe(`${DOCUMENT_DIR}/attachments/${asset.id}.jpg`);
  });

  it('ascii 素材不落文件、不调 cp', async () => {
    const asset = await addAsset({
      kind: 'ascii',
      text: '┌─┐\n└─┘',
      cols: 3,
      rows: 2,
    });
    expect(asset.localPath).toBeUndefined();
    expect(asset.text).toBe('┌─┐\n└─┘');
    expect(mocks.cpMock).not.toHaveBeenCalled();
    const index = await readLibraryIndex();
    expect(index[0].kind).toBe('ascii');
  });

  it('图片缺 sourcePath 时抛错，不留索引', async () => {
    await expect(addAsset({ kind: 'photo' })).rejects.toThrow(/source file/);
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });

  it('cp 失败时抛错且不留索引', async () => {
    seedFile('/tmp/shot.png');
    failCp.value = true;
    await expect(
      addAsset({ kind: 'photo', sourcePath: '/tmp/shot.png' }),
    ).rejects.toThrow(/cp failed/);
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });

  it('并发 add 不丢条目', async () => {
    seedFile('/tmp/a.jpg', 'a');
    seedFile('/tmp/b.jpg', 'b');
    seedFile('/tmp/c.jpg', 'c');
    const [a, b, c] = await Promise.all([
      addAsset({ kind: 'photo', sourcePath: '/tmp/a.jpg' }),
      addAsset({ kind: 'photo', sourcePath: '/tmp/b.jpg' }),
      addAsset({ kind: 'photo', sourcePath: '/tmp/c.jpg' }),
    ]);
    const index = await readLibraryIndex();
    expect(index.map(x => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it(`超过 ${ATTACHMENT_LIBRARY_MAX} 条淘汰最旧并删其文件`, async () => {
    const seeded: LocalAsset[] = Array.from(
      { length: ATTACHMENT_LIBRARY_MAX },
      (_, i) => ({
        id: `old-${i}`,
        kind: 'photo' as const,
        createdAt: i + 1,
        lastUsedAt: i + 1,
        localPath: `${DOCUMENT_DIR}/attachments/old-${i}.jpg`,
      }),
    );
    await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, JSON.stringify(seeded));
    for (const asset of seeded) seedFile(asset.localPath as string);

    seedFile('/tmp/new.jpg', 'new');
    const fresh = await addAsset({ kind: 'photo', sourcePath: '/tmp/new.jpg' });

    const index = await readLibraryIndex();
    expect(index).toHaveLength(ATTACHMENT_LIBRARY_MAX);
    expect(index.some(a => a.id === 'old-0')).toBe(false);
    expect(index.some(a => a.id === fresh.id)).toBe(true);
    expect(files.has(`${DOCUMENT_DIR}/attachments/old-0.jpg`)).toBe(false);
    // 只淘汰一条，其余文件还在。
    expect(files.has(`${DOCUMENT_DIR}/attachments/old-1.jpg`)).toBe(true);
  });
});

describe('applyLibraryCap', () => {
  const mk = (id: string, lastUsedAt?: number, createdAt = 0): LocalAsset => ({
    id,
    kind: 'ascii',
    createdAt,
    lastUsedAt,
  });

  it('按 lastUsedAt 倒序，缺省回落 createdAt', () => {
    const { kept } = applyLibraryCap([
      mk('a', undefined, 1),
      mk('b', 100),
      mk('c', undefined, 50),
    ]);
    expect(kept.map(a => a.id)).toEqual(['b', 'c', 'a']);
  });

  it('未超上限时不淘汰', () => {
    const { kept, evicted } = applyLibraryCap([mk('a'), mk('b')], 5);
    expect(kept).toHaveLength(2);
    expect(evicted).toHaveLength(0);
  });
});

describe('removeAsset', () => {
  it('删索引条目并删文件', async () => {
    seedFile('/tmp/x.jpg');
    const asset = await addAsset({ kind: 'photo', sourcePath: '/tmp/x.jpg' });

    await removeAsset(asset.id);

    await expect(readLibraryIndex()).resolves.toEqual([]);
    expect(files.has(asset.localPath as string)).toBe(false);
  });

  it('文件删不掉也照样更新索引', async () => {
    seedFile('/tmp/x.jpg');
    const asset = await addAsset({ kind: 'photo', sourcePath: '/tmp/x.jpg' });
    failUnlink.value = true;

    await expect(removeAsset(asset.id)).resolves.toBeUndefined();
    await expect(readLibraryIndex()).resolves.toEqual([]);
    // 孤儿文件留在盘上（下次 clear 再试）。
    expect(files.has(asset.localPath as string)).toBe(true);
  });

  it('未知 id 静默返回', async () => {
    await expect(removeAsset('nope')).resolves.toBeUndefined();
  });
});

describe('clearLibrary', () => {
  it('清空索引并删所有文件，删失败不阻断', async () => {
    seedFile('/tmp/a.jpg');
    seedFile('/tmp/b.jpg');
    const a = await addAsset({ kind: 'photo', sourcePath: '/tmp/a.jpg' });
    const b = await addAsset({ kind: 'photo', sourcePath: '/tmp/b.jpg' });
    failUnlink.value = true;

    await expect(clearLibrary()).resolves.toBeUndefined();
    await expect(readLibraryIndex()).resolves.toEqual([]);
    expect(files.has(a.localPath as string)).toBe(true);
    expect(files.has(b.localPath as string)).toBe(true);

    failUnlink.value = false;
    await clearLibrary();
    // 索引已空，clear 无事可做——孤儿文件由下次 add 的同名覆盖/系统清理兜底。
    await expect(readLibraryIndex()).resolves.toEqual([]);
  });
});

describe('touchAsset', () => {
  it('只更新 lastUsedAt，不动 createdAt', async () => {
    const seeded: LocalAsset[] = [
      { id: 'x', kind: 'ascii', createdAt: 1, lastUsedAt: 1, text: 'a' },
    ];
    await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, JSON.stringify(seeded));

    const before = Date.now();
    await touchAsset('x');
    const index = await readLibraryIndex();
    expect(index[0].createdAt).toBe(1);
    expect(index[0].lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  it('未知 id 静默返回', async () => {
    await expect(touchAsset('nope')).resolves.toBeUndefined();
  });
});

describe('markAssetUploaded', () => {
  it('回填 objectKey 与 uploadedAt', async () => {
    const seeded: LocalAsset[] = [
      { id: 'x', kind: 'photo', createdAt: 1, localPath: '/p/x.jpg' },
    ];
    await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, JSON.stringify(seeded));

    await markAssetUploaded('x', 'ai-attachments/u/x.jpg');
    const index = await readLibraryIndex();
    expect(index[0].objectKey).toBe('ai-attachments/u/x.jpg');
    expect(index[0].uploadedAt).toBeGreaterThan(0);
  });
});
