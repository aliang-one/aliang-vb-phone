/**
 * 素材库的 UI 侧状态（Task 15）。
 *
 * 为什么不并进 ControlCenterState：素材库是**本机**数据，与服务端快照、
 * WS 事件、登录会话生命周期完全无关——`resetSessionData()`（退出登录/
 * 换账号）不该清空用户本机的最近素材，`refreshFromServer()` 也不该碰它。
 * 放进那个大 store 只会让它被动继承一堆无关的重置语义。所以这里是一个
 * 独立的 zustand store，只做「把 attachmentLibrary 的磁盘索引镜像到内存 +
 * 串行化 UI 动作」这一件事。
 */
import { create } from 'zustand';
import {
  addAsset,
  clearLibrary,
  readLibraryIndex,
  removeAsset,
  touchAsset,
  type AddAssetInput,
  type LocalAsset,
} from '../../services/attachmentLibrary';

export interface AttachmentLibraryState {
  /** 按 lastUsedAt 倒序的镜像；空数组 = 尚未加载或真的没有素材。 */
  assets: LocalAsset[];
  /** 是否完成过一次加载（区分「空」和「还没读」）。 */
  hydrated: boolean;
  loading: boolean;
  /** 最近一次操作的错误文案，供菜单里的小提示使用。 */
  lastError: string | null;

  hydrate: () => Promise<void>;
  add: (input: AddAssetInput) => Promise<LocalAsset | null>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  touch: (id: string) => Promise<void>;
  /** 本地已入库、但可能还没上传成功的素材（选中态由菜单自己管）。 */
  byId: (id: string) => LocalAsset | undefined;
}

/** 与 attachmentLibrary 的 LRU 排序保持一致，避免两处算法漂移。 */
const sortByRecency = (assets: LocalAsset[]): LocalAsset[] =>
  [...assets].sort(
    (a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
  );

export const useAttachmentLibraryStore = create<AttachmentLibraryState>(
  (set, get) => ({
    assets: [],
    hydrated: false,
    loading: false,
    lastError: null,

    hydrate: async () => {
      // 并发 hydrate（菜单反复开关）只跑一次真正的读盘。
      if (get().loading) return;
      set({ loading: true, lastError: null });
      try {
        const assets = await readLibraryIndex();
        set({ assets: sortByRecency(assets), hydrated: true, loading: false });
      } catch (error) {
        set({
          loading: false,
          hydrated: true,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    add: async input => {
      try {
        const asset = await addAsset(input);
        // 重新读索引而不是本地 push：addAsset 可能触发了 LRU 淘汰，本地
        // 拼接会留下已被淘汰的幽灵条目。
        const assets = await readLibraryIndex();
        set({ assets: sortByRecency(assets), lastError: null });
        return asset;
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },

    remove: async id => {
      try {
        await removeAsset(id);
        set(state => ({
          assets: state.assets.filter(asset => asset.id !== id),
          lastError: null,
        }));
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    clear: async () => {
      try {
        await clearLibrary();
        set({ assets: [], lastError: null });
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    touch: async id => {
      try {
        await touchAsset(id);
        set(state => ({
          assets: sortByRecency(
            state.assets.map(asset =>
              asset.id === id ? { ...asset, lastUsedAt: Date.now() } : asset,
            ),
          ),
        }));
      } catch {
        // 排序微调失败不影响发送，静默。
      }
    },

    byId: id => get().assets.find(asset => asset.id === id),
  }),
);

/** 测试辅助：回到初始状态。 */
export function resetAttachmentLibraryStoreForTest(): void {
  useAttachmentLibraryStore.setState({
    assets: [],
    hydrated: false,
    loading: false,
    lastError: null,
  });
}
