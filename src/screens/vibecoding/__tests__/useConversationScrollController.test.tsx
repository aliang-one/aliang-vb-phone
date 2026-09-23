/**
 * useConversationScrollController — onContentSizeChange 去重守卫(watchdog
 * stopgap Task 2)。
 *
 * iPhone Fabric 崩溃栈在 RCTScrollViewComponentView 的 clipping/mounting:
 * 同一次 mount 事务会以相同内容高度重复触发 onContentSizeChange,旧代码丢弃
 * height 参数、每次都 scheduleScrollToEnd → 尾部滚动与内容布局互相反馈,
 * 主线程 CPU 长时间 59–71%。契约:
 *   - 相同(±1px)内容高度的重复回调 → 不再调度新的滚动;
 *   - live 流式期间真实高度变化 → 恰好一次非动画尾部滚动;
 *   - 用户主动回到底部(scrollToBottom(true))→ 仍动画;
 *   - pending(发消息/聚焦输入框)→ 无条件滚动一次(沿用旧语义);
 *   - reset(切换会话)清空高度记忆。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, type ScrollView } from 'react-native';
import {
  FOLLOW_TAIL_SCROLL_MS,
  useConversationScrollController,
} from '../useConversationScrollController';

type Controller = ReturnType<typeof useConversationScrollController>;

let controller: Controller;

const Host: React.FC = () => {
  controller = useConversationScrollController();
  return <Text>probe</Text>;
};

const mountController = () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Host />);
  });
  const scrollToEnd = jest.fn();
  controller.scrollViewRef.current = {
    scrollToEnd,
  } as unknown as ScrollView;
  return { renderer, scrollToEnd };
};

const contentSize = (
  height: number,
  opts: { pending?: boolean; followTail?: boolean; live?: boolean } = {},
) =>
  controller.handleContentSizeChange(height, {
    pending: opts.pending ?? false,
    followTail: opts.followTail ?? true,
    live: opts.live ?? true,
  });

describe('useConversationScrollController / handleContentSizeChange', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  let scrollToEnd!: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ renderer, scrollToEnd } = mountController());
  });

  afterEach(() => {
    act(() => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  test('相同内容高度的重复回调 → 不再调度新的滚动(同一次 mount 事务合流)', () => {
    // 首个高度:真实变化,调度一次。
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);

    // Fabric 同一事务的重复回调:高度未变 → 全部拒绝,零新增原生滚动。
    act(() => {
      expect(contentSize(1000)).toBe(false);
      expect(contentSize(1000)).toBe(false);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  test('亚像素抖动(±1px 内)不算内容高度变化', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    act(() => {
      expect(contentSize(1000.4)).toBe(false);
      expect(contentSize(999.7)).toBe(false);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  test('恰好 1px 边界(Δ=容差)→ 仍算内容高度变化并调度非动画滚动', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);

    // Δ=1px 恰好等于容差:实现用 >= 判定,应视为变化(而非抖动)。
    act(() => {
      expect(contentSize(1001)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  });

  test('live 更新导致内容高度变化 → 恰好一次非动画尾部滚动', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });

    // 流式追加一行:高度 +42 → 新的一次(且仅一次)非动画滚动。
    act(() => {
      expect(contentSize(1042, { live: true })).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  });

  test('非 live 会话的尾跟随(高度变化)仍动画(沿用 !live 语义)', () => {
    act(() => {
      expect(contentSize(1000, { live: false })).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  });

  test('pending(发消息/聚焦输入框)→ 即使高度未变也滚动一次并返回 true', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    act(() => {
      expect(contentSize(1000, { pending: true, live: false })).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  });

  test('followTail=false(用户离开尾部)→ 高度变化也不滚动', () => {
    act(() => {
      expect(
        contentSize(1200, { followTail: false }),
      ).toBe(false);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  test('pending 压过 followTail=false:用户离开尾部但正在发消息 → 仍滚动一次', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    act(() => {
      // followTail=false 单独出现会拦截,但 pending 是显式请求 → 优先放行。
      expect(
        contentSize(1042, { pending: true, followTail: false, live: false }),
      ).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  });

  test('用户主动回到底部 scrollToBottom(true) → 仍动画(不经过高度守卫)', () => {
    act(() => {
      controller.scrollToBottom(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
  });

  test('reset 清空高度记忆:同高度在新会话重新出现也算变化', () => {
    act(() => {
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    act(() => {
      controller.reset();
      expect(contentSize(1000)).toBe(true);
      jest.advanceTimersByTime(FOLLOW_TAIL_SCROLL_MS);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
  });
});
