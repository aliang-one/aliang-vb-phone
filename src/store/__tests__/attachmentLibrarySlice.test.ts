// Task 15 的 store 侧：把 attachmentLibrary 的磁盘索引镜像进独立 store。
// 契约：hydrate 幂等、add 后镜像与磁盘一致（含 LRU 淘汰）、错误落 lastError
// 而不是抛给 UI。
import { useAttachmentLibraryStore } from '../slices/attachmentLibrarySlice';

jest.mock('../../services/attachmentLibrary', () => ({
  readLibraryIndex: jest.fn(() => Promise.resolve([])),
  addAsset: jest.fn(),
  removeAsset: jest.fn(() => Promise.resolve()),
  clearLibrary: jest.fn(() => Promise.resolve()),
  touchAsset: jest.fn(() => Promise.resolve()),
}));

const library = jest.requireMock('../../services/attachmentLibrary') as {
  readLibraryIndex: jest.Mock;
  addAsset: jest.Mock;
  removeAsset: jest.Mock;
  clearLibrary: jest.Mock;
  touchAsset: jest.Mock;
};

const reset = () => {
  useAttachmentLibraryStore.setState({
    assets: [],
    hydrated: false,
    loading: false,
    lastError: null,
  });
  jest.clearAllMocks();
};

describe('useAttachmentLibraryStore', () => {
  beforeEach(reset);

  it('hydrate 按最近使用倒序填充', async () => {
    library.readLibraryIndex.mockResolvedValue([
      { id: 'old', kind: 'photo', createdAt: 1, lastUsedAt: 1 },
      { id: 'new', kind: 'ascii', createdAt: 2, lastUsedAt: 9 },
    ]);
    await useAttachmentLibraryStore.getState().hydrate();

    const state = useAttachmentLibraryStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.assets.map(a => a.id)).toEqual(['new', 'old']);
  });

  it('并发 hydrate 只读一次盘', async () => {
    let resolveRead: (v: unknown) => void = () => {};
    library.readLibraryIndex.mockImplementation(
      () => new Promise(r => { resolveRead = r; }),
    );
    const first = useAttachmentLibraryStore.getState().hydrate();
    const second = useAttachmentLibraryStore.getState().hydrate();
    resolveRead([]);
    await Promise.all([first, second]);

    expect(library.readLibraryIndex).toHaveBeenCalledTimes(1);
  });

  it('add 成功后重新读盘（反映 LRU 淘汰）', async () => {
    library.addAsset.mockResolvedValue({ id: 'fresh', kind: 'photo', createdAt: 5 });
    library.readLibraryIndex.mockResolvedValue([
      { id: 'fresh', kind: 'photo', createdAt: 5 },
    ]);
    const asset = await useAttachmentLibraryStore.getState().add({
      kind: 'photo',
      sourcePath: '/tmp/x.jpg',
    });

    expect(asset?.id).toBe('fresh');
    expect(useAttachmentLibraryStore.getState().assets.map(a => a.id)).toEqual(['fresh']);
  });

  it('add 失败落 lastError 并返回 null，不抛', async () => {
    library.addAsset.mockRejectedValue(new Error('disk full'));
    const asset = await useAttachmentLibraryStore.getState().add({
      kind: 'photo',
      sourcePath: '/tmp/x.jpg',
    });

    expect(asset).toBeNull();
    expect(useAttachmentLibraryStore.getState().lastError).toBe('disk full');
  });

  it('remove 只删本地镜像里那一条', async () => {
    useAttachmentLibraryStore.setState({
      assets: [
        { id: 'a', kind: 'photo', createdAt: 1 },
        { id: 'b', kind: 'photo', createdAt: 2 },
      ],
    });
    await useAttachmentLibraryStore.getState().remove('a');
    expect(useAttachmentLibraryStore.getState().assets.map(x => x.id)).toEqual(['b']);
    expect(library.removeAsset).toHaveBeenCalledWith('a');
  });

  it('clear 清空镜像', async () => {
    useAttachmentLibraryStore.setState({
      assets: [{ id: 'a', kind: 'photo', createdAt: 1 }],
    });
    await useAttachmentLibraryStore.getState().clear();
    expect(useAttachmentLibraryStore.getState().assets).toEqual([]);
  });

  it('touch 把该条提到最前', async () => {
    useAttachmentLibraryStore.setState({
      assets: [
        { id: 'a', kind: 'photo', createdAt: 1, lastUsedAt: 10 },
        { id: 'b', kind: 'photo', createdAt: 2, lastUsedAt: 20 },
      ],
    });
    await useAttachmentLibraryStore.getState().touch('a');
    expect(useAttachmentLibraryStore.getState().assets[0].id).toBe('a');
  });

  it('byId 找不到返回 undefined', () => {
    expect(useAttachmentLibraryStore.getState().byId('nope')).toBeUndefined();
  });
});
