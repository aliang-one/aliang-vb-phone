/**
 * uiNoticeStore —— 一次性提示(如 TUI 共享横幅)的「已读」记忆。
 *
 * 核心约束:点击 dismiss 后在本 App 进程生命周期内永久生效——离开会话页再
 * 进入(组件重新挂载、useState 归零)不得复弹。刻意不落盘:用户要求的是
 * 「至少这个 App 没被杀死的生命周期里不再出现」,杀进程后重新提示是可接受的。
 */
import { jest } from '@jest/globals';

const mockAsyncStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockAsyncStorage.delete(key);
  }),
}));

import {
  useUiNoticeStore,
  resetUiNoticeStoreForTest,
  type UiNoticeKey,
} from '../uiNoticeStore';

beforeEach(() => {
  mockAsyncStorage.clear();
  resetUiNoticeStoreForTest();
});

test('未点击过 → 未读,横幅应展示', () => {
  expect(useUiNoticeStore.getState().isDismissed('tuiShared')).toBe(false);
});

test('dismiss 后立即为已读', () => {
  useUiNoticeStore.getState().dismiss('tuiShared');
  expect(useUiNoticeStore.getState().isDismissed('tuiShared')).toBe(true);
});

test('不同提示键互不影响', () => {
  useUiNoticeStore.getState().dismiss('tuiShared');
  // 键是字面量联合:这里用 as 构造一个未来才会有的键,验证记录是按 key 隔离的。
  expect(
    useUiNoticeStore.getState().isDismissed('otherNotice' as UiNoticeKey),
  ).toBe(false);
});

test('dismiss 不落盘:新进程(冷启动)重新提示', async () => {
  useUiNoticeStore.getState().dismiss('tuiShared');
  // 落盘会让「杀进程后重新提示」这一预期失效,因此 store 不得触碰存储。
  const AsyncStorage = jest.requireMock(
    '@react-native-async-storage/async-storage',
  ) as { setItem: jest.Mock };
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();

  // 模拟杀进程重启:模块级记忆清空后回到未读。
  resetUiNoticeStoreForTest();
  expect(useUiNoticeStore.getState().isDismissed('tuiShared')).toBe(false);
});

test('rehydrate 能读回落盘的记忆(为将来需要持久化预留)', async () => {
  mockAsyncStorage.set('uiNotice.tuiShared.dismissed', '1');
  await useUiNoticeStore.getState().hydrate('tuiShared');
  expect(useUiNoticeStore.getState().isDismissed('tuiShared')).toBe(true);
});
