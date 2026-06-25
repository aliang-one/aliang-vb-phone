import type { VibeStatus } from '../data/platformModels';

/**
 * L1 — 顶部「整体状态」相位。
 *
 * 判定优先级:
 *  1. `failed`  → 失败(真终态)
 *  2. `isLive`(此刻有生命迹象:最近 delta 在 8s 窗口内,或有 active 思考 / started 命令)
 *     → `running`(进行中)。生命迹象是真相,压过 status 误报的 completed/closed——一个
 *     略微陈旧的快照会在会话仍活跃时把 status 推成 completed,此刻顶部若信 status 就错了。
 *  3. `completed` → 已完成(会话真关闭;即使有陈旧 pending approval 也优先展示完成)。
 *  4. 有 pending approval → 待审批(需用户动作)。
 *  5. 否则(无生命迹象、无待审批、非真结束)→ 已完成(回合 settle:agent 答完、球回到用户,
 *     会话仍可继续)。**不依赖 status 的 running/idle 区分**:settle 推送可能丢失或被
 *     staleDemotion 守卫卡住使 status 停在 running,而 isLive(8s 窗口 + ai.done 收尾
 *     structuredEvents)才是可靠信号,故「无生命迹象 ⇒ 已完成」。回合内 API 请求空档
 *     (<8s)isLive 仍 true → 进行中,不会误闪已完成。
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
  // `completed` means the session was genuinely closed — trust it over a
  // likely-stale pending approval. (isLive above already wins, so a snapshot
  // that falsely reports closed/completed while the agent is still thinking
  // still shows 进行中.)
  if (status === 'completed') return 'completed';
  if (hasPendingApproval) return 'waiting_approval';
  // No life signs + nothing pending + not failed/closed ⇒ the turn settled
  // (agent answered, ball back with the user). Show 已完成, NOT 进行中.
  // We deliberately ignore the running↔idle distinction in status here: a
  // settle publish can be dropped or held back by mergeVibeRunSnapshot's
  // staleDemotion guard, leaving status pinned at 'running' after the turn
  // ended. isLive (8s window + ai.done-finalized structuredEvents) is the
  // reliable signal, so "no life signs" ⇒ 已完成 regardless of status.
  return 'completed';
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
