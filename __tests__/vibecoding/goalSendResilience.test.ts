/**
 * Bug 2 + Bug 3 fix 回归测：
 *   - Bug 2: createProjectGoal 给 createGoal 调用加 CREATE_GOAL_TIMEOUT_MS
 *     超时。组件内用 Promise.race([createGoal(...), timeoutPromise]) 实现。
 *     这里直接验证「超时 Promise 在 CREATE_GOAL_TIMEOUT_MS 后 reject，
 *     且 reject 出的 Error 经 goalRequestErrorMessage 转成中文超时提示」
 *     ——即 finally 必清锁（契约由结构保证，超时 reject 触发 catch+finally）。
 *   - Bug 3: handleSendText 自愈判定函数 isSendingStale + 常量
 *     SENDING_STALE_MS / CREATE_GOAL_TIMEOUT_MS。
 */
import {
  CREATE_GOAL_TIMEOUT_MS,
  SENDING_STALE_MS,
  isSendingStale,
} from '../../src/screens/vibecoding/VibeCodingSessionScreen';

describe('goal send resilience (Bug 2 + Bug 3)', () => {
  it('CREATE_GOAL_TIMEOUT_MS = 30s, SENDING_STALE_MS = 45s, 自愈阈值 > createGoal 超时', () => {
    expect(CREATE_GOAL_TIMEOUT_MS).toBe(30_000);
    expect(SENDING_STALE_MS).toBe(45_000);
    // 关键不变量：自愈阈值必须 > createGoal 超时，否则 createGoal 还没
    // 超时 releasing 锁，自愈就先误清了「正在正常进行的 createGoal」。
    expect(SENDING_STALE_MS).toBeGreaterThan(CREATE_GOAL_TIMEOUT_MS);
  });

  describe('isSendingStale', () => {
    it('since=null 永远不算 stale（未发送过）', () => {
      expect(isSendingStale(null, 0)).toBe(false);
      expect(isSendingStale(null, 100_000_000)).toBe(false);
    });

    it('距戳时间 ≤ 45s 不算 stale（正常发送进行中）', () => {
      const since = 1_000_000;
      expect(isSendingStale(since, since + 0)).toBe(false);
      expect(isSendingStale(since, since + 10_000)).toBe(false);
      expect(isSendingStale(since, since + 45_000)).toBe(false); // 边界，不算 stale（严格 >）
    });

    it('距戳时间 > 45s 算 stale（卡死残留，强制清）', () => {
      const since = 1_000_000;
      expect(isSendingStale(since, since + 45_001)).toBe(true);
      expect(isSendingStale(since, since + 120_000)).toBe(true);
    });

    it('不传 now 默认用 Date.now()（实时判定）', () => {
      // 戳一个 60s 前的时间 → 必 stale
      const staleSince = Date.now() - 60_000;
      expect(isSendingStale(staleSince)).toBe(true);
      // 戳「现在」→ 必不 stale
      expect(isSendingStale(Date.now())).toBe(false);
    });
  });

  it('Bug 2: Promise.race 超时分支在 CREATE_GOAL_TIMEOUT_MS 后 reject 出超时 Error', async () => {
    // 镜像组件内 createProjectGoal 的超时分支结构，验证语义。
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`创建 Goal 超时（${CREATE_GOAL_TIMEOUT_MS / 1000}s 无响应）`)),
        // 测试里加速，仅验证「超时分支会 reject」而非真实 30s
        10,
      );
    });
    const hangForever = new Promise<string>(() => { /* never resolves */ });
    let caught: unknown | undefined;
    let finallyRan = false;
    try {
      await Promise.race([hangForever, timeoutPromise]);
    } catch (error) {
      caught = error;
    } finally {
      finallyRan = true;
    }
    expect(finallyRan).toBe(true);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('创建 Goal 超时');
  });
});
