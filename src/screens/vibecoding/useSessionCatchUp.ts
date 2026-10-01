/**
 * useSessionCatchUp — 聊天屏的水位对账(增量补齐触发器)。
 *
 * 修的洞:focus 判定此前只有时间启发式(isSessionSnapshotStale:离开多久/
 * 活动多旧),从不问"服务端是不是比我多消息"。本 hook 把服务端权威
 * transcript_count 变成每屏常驻的数据比对:
 *
 *   触发 1(mount / 重进 focus):拉一次轻量会话元数据(fetchAiSession,
 *   服务端内存应答、无 agent 往返),把 transcript_count 交给 catch-up;
 *   触发 2(屏内常驻):store 的 transcriptCount 被任何快照/WS 合并推进时
 *   ——包括 WS 断档后重连的全局 snapshot——再次对账。这两条路合起来把
 *   "WS 丢事件无补发"从静默丢消息变成下一次元数据到达即自愈。
 *
 * 网络纪律:真正的闸门在 catchUpAgentMessages(水位不等 early-return、
 * in-flight 去重),本 hook 只加失败冷却(10s),成功不设冷却——水位相等
 * 后连续触发本身就是零成本 no-op。
 *
 * 不直接用 useFocusEffect(避免 navigation 依赖、可独立单测):重进 focus
 * 的重查由会话屏已有的 useFocusEffect 调用本 hook 返回的 refreshLatestCount。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ServerAiSession } from '../../api/sessions';
import type { SessionCatchUpResult } from '../../store/types';

const FAILURE_RETRY_COOLDOWN_MS = 10_000;

export interface SessionCatchUpInput {
  sessionId: string | undefined;
  /**
   * store 中该会话的权威 transcript_count(列表/详情快照、ai.session.updated
   * 都会推进它)。变化即为"服务端有新动静"的对账触发器。
   */
  transcriptCount: number | undefined;
  catchUpAgentMessages: (
    sessionId: string,
    serverCount: number,
  ) => Promise<SessionCatchUpResult>;
  /** 注入点(测试替身):轻量元数据拉取,生产传 fetchAiSession(缓存优先)。 */
  fetchServerSessionMeta: (
    sessionId: string,
  ) => Promise<Pick<ServerAiSession, 'transcript_count'> | undefined>;
}

export interface SessionCatchUpController {
  /** 重新拉一次元数据并对账。幂等、自冷却,可在每次 focus 调用。 */
  refreshLatestCount: () => void;
}

export function useSessionCatchUp(
  input: SessionCatchUpInput,
): SessionCatchUpController {
  const { sessionId, transcriptCount, catchUpAgentMessages, fetchServerSessionMeta } =
    input;

  // Per-session failure cooldown survives session switches within this screen
  // instance (the screen remounts per session in the stack, so a plain ref is
  // effectively per-session anyway).
  const lastFailureAtRef = useRef<Record<string, number>>({});

  const attempt = useCallback(
    async (serverCount: number | undefined) => {
      const id = sessionId;
      if (!id || serverCount === undefined || !Number.isFinite(serverCount)) {
        return;
      }
      if (
        Date.now() - (lastFailureAtRef.current[id] ?? 0) <
        FAILURE_RETRY_COOLDOWN_MS
      ) {
        return;
      }
      try {
        await catchUpAgentMessages(id, serverCount);
      } catch {
        // Catch-up is best-effort recovery: live WS deltas and the manual
        // refresh button remain. Back off before the next attempt.
        lastFailureAtRef.current[id] = Date.now();
      }
    },
    [catchUpAgentMessages, sessionId],
  );

  // 触发 1:拉轻量元数据对账(mount 即重进;refocus 由屏调 refreshLatestCount)。
  const refreshLatestCount = useCallback(() => {
    const id = sessionId;
    if (!id) return;
    void (async () => {
      try {
        const meta = await fetchServerSessionMeta(id);
        await attempt(meta?.transcript_count);
      } catch {
        // Meta fetch itself failed (offline / 404) — the count-driven trigger
        // and manual refresh are the fallbacks. Attempt-level cooldown may
        // already apply; nothing to surface on a silent recovery path.
      }
    })();
  }, [attempt, fetchServerSessionMeta, sessionId]);

  useEffect(() => {
    refreshLatestCount();
    // sessionId switches reset the trigger; transcriptCount is intentionally
    // NOT a dep here (it owns trigger 2 below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshLatestCount]);

  // 触发 2:屏内快照/WS 合并推进计数时对账(WS 断档自愈主路径)。水位相等
  // 时 catchUpAgentMessages 直接 early-return,这里是零成本 no-op。
  useEffect(() => {
    void attempt(transcriptCount);
  }, [attempt, transcriptCount]);

  // Memoized: the session screen threads this controller into its
  // useFocusEffect's useCallback deps — a fresh object per render would
  // re-fire the focus effect every render.
  return useMemo(() => ({ refreshLatestCount }), [refreshLatestCount]);
}
