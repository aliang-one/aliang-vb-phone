import type { VibeStatus } from '../data/platformModels';

/**
 * L1 — 顶部「整体状态」相位。
 *
 * 判定优先级:
 *  1. `failed`  → 失败(真终态)
 *  2. `isLive`(此刻有生命迹象:最近 delta 在窗口内,或有 active 思考 / started 命令)
 *     → `running`(进行中)。**这一条压过 status 误报的 completed/closed**:
 *     实测中 `session.status` 不可靠——一个略微陈旧的快照、或服务端过早的 idle-settle,
 *     会在会话仍活跃(正在思考/流式)时把 status 推成 closed→completed。此刻顶部若信
 *     status 显示「已完成」就是错的。生命迹象是真相,status 是传言。
 *  3. `completed` → 已完成(上一轮已完成,会话仍可继续)
 *  4. 有 pending approval → 待审批(需用户动作)
 *  5. 否则 → 进行中(`idle` 不再映射成顶部 done;agent 答完一轮回合、球回到用户时会话
 *     仍存活,顶部保持进行中。idle/running 细分下沉到 L2/L3)
 *
 * `isLive` 由调用方用 `livePulse?.hasActive ?? Boolean(liveMessageId)` 传入——和 L2/L3
 * 同源,保证三层对「是否正在干活」的判定一致。
 */
export type SessionPhase = 'running' | 'waiting_approval' | 'completed' | 'failed';

export function deriveSessionPhase(
  status: VibeStatus,
  hasPendingApproval: boolean,
  isLive = false,
): SessionPhase {
  if (status === 'failed') return 'failed';
  if (isLive) return 'running';
  if (status === 'completed') return 'completed';
  if (hasPendingApproval) return 'waiting_approval';
  return 'running';
}

export const sessionPhaseLabel: Record<SessionPhase, string> = {
  running: '进行中',
  waiting_approval: '待审批',
  completed: '已完成',
  failed: '失败',
};

export const sessionPhaseType: Record<
  SessionPhase,
  'success' | 'warning' | 'error' | 'neutral' | 'info'
> = {
  running: 'info',
  waiting_approval: 'warning',
  completed: 'neutral',
  failed: 'error',
};

/**
 * 窗口期:最近一次活动(ai.delta flush 每次会把 run.lastActivityMs 刷成 Date.now())
 * 至今若超过该窗口,认为「最新回合已 settle」(球回到用户)。窗口取 8s:足以覆盖一次
 * 回合内两次 LLM API 请求之间的正常空档(通常百毫秒~数秒),又不会让回合真正结束后
 * 一直挂「处理中…」太久。useNowTick 每 30s 触发一次重算,所以 settle 翻转最多滞后 ~30s。
 */
export const LIVE_TURN_WINDOW_MS = 8_000;

/**
 * 返回「当前仍在流式的最新助手消息」id,用于:
 *  - L2:ActivityBlock 的 `turnSettled`(该回合是否真结束,决定空档显示「已完成」还是「处理中…」)
 *  - L3:底部气泡是否处于 live 态
 *
 * 判定:最近活动在窗口内 + 取 transcript 里最后一条 assistant 消息的 id。
 * 窗口外 / 没有助手消息 → undefined(表示没有 live 回合)。
 */
export function liveAssistantMessageId(
  transcript: ReadonlyArray<{ id: string; role: string }>,
  lastActivityMs: number | undefined,
  now: number,
): string | undefined {
  if (lastActivityMs === undefined) return undefined;
  if (now - lastActivityMs > LIVE_TURN_WINDOW_MS) return undefined;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (transcript[i].role === 'assistant') return transcript[i].id;
  }
  return undefined;
}
