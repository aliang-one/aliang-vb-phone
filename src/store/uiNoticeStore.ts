/**
 * 一次性提示的「已读」记忆(如 TUI 共享横幅的「知道了」)。
 *
 * 为什么需要它:横幅的显隐原先靠会话页里的 `useState(false)`,组件随导航
 * 卸载后状态归零——用户点「知道了」返回再进来,横幅必然复弹。显隐判据
 * 属于「用户是否已读」,不是页面局部 UI 态,所以搬到模块级 store。
 *
 * 语义边界(用户 2026-10-21 明确):
 * - **进程内永久**:同一次 App 生命周期里点过就不再出现(跨会话页、跨会话
 *   id 都算),这正是原来 useState 做不到的部分。
 * - **不落盘**:冷启动(进程被杀后重开)重新提示是可接受的,用户只要求
 *   「至少这个 App 没被杀死的生命周期里」不再出现。因此 dismiss 刻意不写
 *   AsyncStorage——顺带避免了「一次误点永久消失」且无需版本化失效策略。
 *
 * `hydrate` 只为将来确实需要持久化时预留(单测已覆盖读回路径);当前没有
 * 任何调用方,不改变上述进程内语义。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** 已知提示键。用字面量联合而非 string,避免拼错键导致「静默不复弹」。 */
export type UiNoticeKey = 'tuiShared';

interface UiNoticeState {
  dismissed: Record<UiNoticeKey, boolean>;
  isDismissed: (key: UiNoticeKey) => boolean;
  dismiss: (key: UiNoticeKey) => void;
  /** 从持久化记忆读回(当前无调用方;预留)。 */
  hydrate: (key: UiNoticeKey) => Promise<void>;
}

const storageKey = (key: UiNoticeKey) => `uiNotice.${key}.dismissed`;

export const useUiNoticeStore = create<UiNoticeState>((set, get) => ({
  dismissed: { tuiShared: false },

  isDismissed: key => get().dismissed[key] === true,

  dismiss: key =>
    set(state => ({ dismissed: { ...state.dismissed, [key]: true } })),

  hydrate: async key => {
    try {
      const value = await AsyncStorage.getItem(storageKey(key));
      if (value === '1') {
        set(state => ({ dismissed: { ...state.dismissed, [key]: true } }));
      }
    } catch {
      // 读失败按未读处理:最多多提示一次,不阻断界面。
    }
  },
}));

/** 测试辅助:清空进程内记忆。仅测试使用。 */
export function resetUiNoticeStoreForTest() {
  useUiNoticeStore.setState({ dismissed: { tuiShared: false } });
}
