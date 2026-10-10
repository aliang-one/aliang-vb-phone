/**
 * useIncrementalList — 分批揭示原语(showMoreGradually / revealThroughGradually)。
 *
 * 背景:一次 setState 揭示过多条目会在单个 React commit 里同步挂载全部内容,
 * 长历史上翻"加载更早"/scrubber 跳转时把 JS 线程与主线程同时打满。这里锁
 * 分批行为本身:批大小、批间隔、取消(resetKey/卸载)、并发钳制。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useIncrementalList } from '../useIncrementalList';

type ListApi = ReturnType<typeof useIncrementalList<number>>;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('useIncrementalList — 分批揭示', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('showMoreGradually 把 +step 拆成小批逐批揭示', () => {
    let api!: ListApi;
    const Harness: React.FC = () => {
      api = useIncrementalList(range(50), {
        initialCount: 12,
        step: 12,
        from: 'end',
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });

    let settled = 0;
    const onSettled = () => {
      settled += 1;
    };
    act(() => {
      api.showMoreGradually({ onSettled });
    });
    // 第一批(4)同步落窗。
    expect(api.visibleCount).toBe(16);
    act(() => {
      jest.advanceTimersByTime(32);
    });
    expect(api.visibleCount).toBe(20);
    act(() => {
      jest.advanceTimersByTime(32);
    });
    // step(12)用尽:12+12=24。
    expect(api.visibleCount).toBe(24);
    act(() => {
      jest.advanceTimersByTime(32 * 5);
    });
    expect(api.visibleCount).toBe(24);
    expect(settled).toBe(1);

    act(() => {
      renderer?.unmount();
    });
  });

  it('from:end 下分批揭示保持端锚定窗口', () => {
    let api!: ListApi;
    const Harness: React.FC = () => {
      api = useIncrementalList(range(50), {
        initialCount: 12,
        step: 12,
        from: 'end',
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });

    expect(api.visibleItems[0]).toBe(38);
    act(() => {
      api.showMoreGradually();
    });
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    // 窗口 = 末尾 24 条(26..49)。
    expect(api.visibleCount).toBe(24);
    expect(api.visibleItems[0]).toBe(26);
    expect(api.visibleItems[api.visibleItems.length - 1]).toBe(49);

    act(() => {
      renderer?.unmount();
    });
  });

  it('revealThroughGradually 分批走到绝对目标且不越过', () => {
    let api!: ListApi;
    const Harness: React.FC = () => {
      api = useIncrementalList(range(60), {
        initialCount: 12,
        step: 12,
        from: 'end',
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });

    let settled = 0;
    act(() => {
      api.revealThroughGradually(40, { onSettled: () => (settled += 1) });
    });
    expect(api.visibleCount).toBe(16);
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    expect(api.visibleCount).toBe(40);
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    expect(api.visibleCount).toBe(40);
    expect(settled).toBe(1);

    act(() => {
      renderer?.unmount();
    });
  });

  it('revealThroughGradually 目标不大于当前窗口时同步 settle 且不回缩', () => {
    let api!: ListApi;
    const Harness: React.FC = () => {
      api = useIncrementalList(range(60), {
        initialCount: 12,
        step: 12,
        from: 'end',
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });

    let settled = 0;
    act(() => {
      api.revealThroughGradually(8, { onSettled: () => (settled += 1) });
    });
    expect(api.visibleCount).toBe(12);
    expect(settled).toBe(1);
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    expect(api.visibleCount).toBe(12);

    act(() => {
      renderer?.unmount();
    });
  });

  it('resetKey 变化重置窗口并取消在途批次', () => {
    let api!: ListApi;
    const Harness: React.FC<{ resetKey?: string }> = props => {
      api = useIncrementalList(range(50), {
        initialCount: 12,
        step: 12,
        from: 'end',
        resetKey: props.resetKey,
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness resetKey="a" />);
    });

    act(() => {
      api.showMoreGradually();
    });
    expect(api.visibleCount).toBe(16);

    act(() => {
      renderer!.update(<Harness resetKey="b" />);
    });
    // 重置回 initialCount;在途批次已取消,计时器推进也不再增长。
    expect(api.visibleCount).toBe(12);
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    expect(api.visibleCount).toBe(12);

    act(() => {
      renderer?.unmount();
    });
  });

  it('卸载取消在途批次:settled 不再触发、计时器推进无副作用', () => {
    let api!: ListApi;
    const Harness: React.FC = () => {
      api = useIncrementalList(range(50), {
        initialCount: 12,
        step: 12,
        from: 'end',
      });
      return null;
    };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });

    let settled = 0;
    act(() => {
      api.showMoreGradually({ onSettled: () => (settled += 1) });
    });
    expect(api.visibleCount).toBe(16);

    act(() => {
      renderer?.unmount();
    });
    act(() => {
      jest.advanceTimersByTime(32 * 10);
    });
    expect(settled).toBe(0);
  });

  describe('Promise 收尾契约(revealHold 竞态根修)', () => {
    it('自然完成:Promise 决议 {superseded:false},onSettled 照常触发', async () => {
      let api!: ListApi;
      const Harness: React.FC = () => {
        api = useIncrementalList(range(50), {
          initialCount: 12,
          step: 12,
          from: 'end',
        });
        return null;
      };
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      act(() => {
        renderer = TestRenderer.create(<Harness />);
      });

      let settled = 0;
      let result!: { superseded: boolean };
      const revealPromise = act(() => {
        const p = api.showMoreGradually({ onSettled: () => (settled += 1) });
        p.then(r => {
          result = r;
        });
      });
      await act(async () => {
        jest.advanceTimersByTime(32 * 10);
        await revealPromise;
      });
      expect(result.superseded).toBe(false);
      expect(settled).toBe(1);

      act(() => {
        renderer?.unmount();
      });
    });

    it('被新揭示顶掉:旧 Promise 决议 {superseded:true} 且旧 onSettled 不触发,新揭示自然收尾', async () => {
      let api!: ListApi;
      const Harness: React.FC = () => {
        api = useIncrementalList(range(50), {
          initialCount: 12,
          step: 12,
          from: 'end',
        });
        return null;
      };
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      act(() => {
        renderer = TestRenderer.create(<Harness />);
      });

      let oldSettled = 0;
      let newSettled = 0;
      let oldResult!: { superseded: boolean };
      let newResult!: { superseded: boolean };
      let oldPromise!: Promise<{ superseded: boolean }>;
      act(() => {
        oldPromise = api.showMoreGradually({
          onSettled: () => (oldSettled += 1),
        });
        oldPromise.then(r => {
          oldResult = r;
        });
      });
      expect(api.visibleCount).toBe(16);

      let newPromise!: Promise<{ superseded: boolean }>;
      act(() => {
        // scrubber 跳转顶掉在途揭示(revealHold 竞态的触发形态)
        newPromise = api.revealThroughGradually(40, {
          onSettled: () => (newSettled += 1),
        });
        newPromise.then(r => {
          newResult = r;
        });
      });
      await act(async () => {
        await oldPromise;
      });
      // 旧揭示立即以 superseded 决议(持有者可安全跳过清理),旧 onSettled
      // 不触发——竞态修复的核心断言。
      expect(oldResult.superseded).toBe(true);
      expect(oldSettled).toBe(0);

      await act(async () => {
        jest.advanceTimersByTime(32 * 10);
        await newPromise;
      });
      expect(api.visibleCount).toBe(40);
      expect(newResult.superseded).toBe(false);
      expect(newSettled).toBe(1);

      act(() => {
        renderer?.unmount();
      });
    });

    it('resetKey 变化:在途 Promise 以 {superseded:true} 决议', async () => {
      let api!: ListApi;
      const Harness: React.FC<{ resetKey?: string }> = props => {
        api = useIncrementalList(range(50), {
          initialCount: 12,
          step: 12,
          from: 'end',
          resetKey: props.resetKey,
        });
        return null;
      };
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      act(() => {
        renderer = TestRenderer.create(<Harness resetKey="a" />);
      });

      let result!: { superseded: boolean };
      let revealPromise!: Promise<{ superseded: boolean }>;
      act(() => {
        revealPromise = api.showMoreGradually();
        revealPromise.then(r => {
          result = r;
        });
      });
      expect(api.visibleCount).toBe(16);

      await act(async () => {
        renderer!.update(<Harness resetKey="b" />);
      });
      // 先让 reset effect 落地(cancelReveal 决议在途 Promise),再 await——
      // 同一 act 内 await 会等 effect flush,互等死锁。
      await act(async () => {
        await revealPromise;
      });
      expect(result.superseded).toBe(true);
      expect(api.visibleCount).toBe(12);

      act(() => {
        renderer?.unmount();
      });
    });
  });
});
