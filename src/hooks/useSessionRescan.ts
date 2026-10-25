import { useCallback, useRef, useState } from 'react';
import { ApiResponseError } from '../api/client';
import {
  fetchProjectAiSessions,
  refreshProjectAiSessions,
  type ProjectAiSessionList,
} from '../api/projects';
import { resolveRescanTick } from '../screens/vibecoding/sessionRescan';

export type RescanOutcome = 'updated' | 'timeout' | 'agent-offline' | 'error';

// 首拍 1.2s × 6 拍 ≈ 8s 封顶(与 ProjectScanScreen 的轮询节奏同族)。
const RESCAN_POLL_MS = 1200;
const RESCAN_MAX_TICKS = 6;

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 「重扫电脑」hook:轻推 agent 立即扫描,并轮询项目会话接口直到检测到
 * 变化(新会话/新消息)或 ~8s 超时。
 *
 * 数据流单源:本 hook 不持有第二份会话列表状态——每拍驱动调用方传入的
 * onPoll(即 useProjectSessions.reload)刷新屏幕既有列表,hook 自身的
 * fetch 只服务于变化判定。
 *
 * 并发语义:进行中第二次触发直接返回 'error'(从简,不排队/不合并)。
 * UI 层 RefreshControl refreshing={rescanning} 已抑制重复触发,此路径
 * 实际不可达;系对 spec §6「复用同一轮询」的有意偏差。
 * 线字段:会话 id 是 ServerAiSession 的 session_id(非 id),活跃时间是
 * last_active_at(非 updated_at)——两个字段名都以 server 下发为准。
 */
export function useSessionRescan(
  projectId: string | undefined,
  onPoll?: () => Promise<void> | void,
) {
  const [rescanning, setRescanning] = useState(false);
  const inFlightRef = useRef(false);

  const rescan = useCallback(async (): Promise<RescanOutcome> => {
    // 无项目上下文 / 已在重扫中:幂等短路,不叠加第二轮询。
    if (!projectId || inFlightRef.current) return 'error';
    inFlightRef.current = true;
    setRescanning(true);
    try {
      const baseline = snapshotOf(await fetchProjectAiSessions(projectId));
      try {
        await refreshProjectAiSessions(projectId);
      } catch (error) {
        return outcomeOfError(error);
      }
      for (let tick = 1; tick <= RESCAN_MAX_TICKS; tick += 1) {
        await delay(RESCAN_POLL_MS);
        const polled = await fetchProjectAiSessions(projectId);
        await onPoll?.();
        const action = resolveRescanTick({
          polledCount: polled.total_count,
          polledIds: polled.sessions.map(session => session.session_id),
          polledLatestLastActiveAt: latestLastActiveAt(polled.sessions),
          baselineCount: baseline.count,
          baselineIds: baseline.ids,
          baselineLatestLastActiveAt: baseline.latestLastActiveAt,
          isFinalTick: tick === RESCAN_MAX_TICKS,
        });
        if (action === 'stop-changed') return 'updated';
        if (action === 'stop-timeout') break;
      }
      return 'timeout';
    } catch {
      return 'error';
    } finally {
      inFlightRef.current = false;
      setRescanning(false);
    }
  }, [projectId, onPoll]);

  return { rescanning, rescan };
}

type RescanSnapshot = {
  count: number;
  ids: string[];
  latestLastActiveAt: string | undefined;
};

const snapshotOf = (list: ProjectAiSessionList): RescanSnapshot => ({
  count: list.total_count,
  ids: list.sessions.map(session => session.session_id),
  latestLastActiveAt: latestLastActiveAt(list.sessions),
});

// server 侧按 lastActiveAt 降序返回,但判定不依赖顺序:取 max。
const latestLastActiveAt = (
  sessions: ProjectAiSessionList['sessions'],
): string | undefined =>
  sessions.reduce<string | undefined>(
    (acc, session) =>
      !acc || session.last_active_at > acc ? session.last_active_at : acc,
    undefined,
  );

const outcomeOfError = (error: unknown): RescanOutcome =>
  error instanceof ApiResponseError &&
  (error.status === 409 || error.code === 'device_offline')
    ? 'agent-offline'
    : 'error';
