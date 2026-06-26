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
 * `isLive` 由调用方用 `isSessionTurnActive(...)`(见下)算出——和 L2/L3、底部 composer 锁、
 * 停止按钮、发送 guard 全部同源,保证五处对「是否正在干活」的判定一致,不再各自裸读
 * `session.status`(回合 settle 后常停在陈旧的 running)。
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

/**
 * **统一源头**——此刻该会话「是否正在跑一个回合」。供顶部相位 / composer 锁 /
 * 停止按钮 / 发送 guard / L2-L3 脉冲共用,保证判定一致。
 *
 * **事件驱动,只看 `status === 'running'`**。回合边界由确定性事件决定:
 *  - 开始:发送(`appendAgentMessage`)乐观置 running;`ai.status` 维持 running。
 *  - 结束:`ai.done` 翻 idle、`ai.error` 翻 failed、中断(`interruptAgentSession`)翻 idle。
 * 配合 `mergeVibeRunSnapshot` 的双向 stale 守卫(既不让陈旧快照把 running 误降级,也不让
 * 陈旧快照把已结算的会话误重新激活),status 在回合内稳定为 running、回合结束即时为 idle。
 *
 * 故既不抖(回合内 API 请求/工具调用空档不再被误判成完成),也不滞后(不再等 8s 活动窗口
 * 或服务端 settle 推送)。`--print` headless 一个进程跑完整条 prompt 才发一次 `ai.done`,
 * 所以 ai.done 即「这条 prompt 确定结束」,可放心当结算源——这正是去掉 8s 鲁棒延迟的依据:
 * 当年抖动是「用活动新鲜度猜结束」所致,换到事件驱动的 status 后,结束是确定信号,不再需要
 * debounce。
 *
 * `waiting_approval` 不算「在跑」(回合卡在审批上,球在用户侧)——各消费方按需 `|| waiting_approval`
 * 单独处理(见 `shouldLockComposerForProvider` / `canInterruptTurn` / `appendAgentMessage` guard)。
 * 终态 failed/completed/idle 自然不在跑。
 */
export function isSessionTurnActive(status: VibeStatus): boolean {
  return status === 'running';
}

/**
 * Composer 是否因 provider 并发而锁定(claude_code 是单进程 CLI,跑回合时不能并发收新消息)。
 *
 * **关键**:用「生命迹象」(isSessionLive)而不是裸 `session.status` 判活。回合答完后
 * status 常停在陈旧的 `'running'`(settle 推送丢失 / `mergeVibeRunSnapshot` 的
 * staleDemotion 守卫卡住 running→idle),裸读 status 会让 composer 在顶部已显「已完成」时
 * 仍锁「Claude Code 正在运行」——与 L1 相位脱节。`isSessionLive` 与 `deriveSessionPhase`
 * 同源(8s 活动窗口 + active 思考/命令),保证顶部相位与底部 composer 锁对「是否在干活」
 * 的判定一致:顶部说「已完成」(无生命迹象)时,composer 也必须解锁。
 *
 * `waiting_approval` 仍锁:那是 claude_code 卡在权限请求上(服务端主动推送的可靠状态),
 * 与 settle 的陈旧 running 无关,沿用旧行为不放开。`failed`/`completed`/`idle`(非 live、
 * 非待审批)→ 不锁。
 *
 * 非 `claude_code` provider(如 codex,支持排队并发收消息)→ 永不锁。
 */
export function shouldLockComposerForProvider(
  isSessionLive: boolean,
  status: VibeStatus | undefined,
  provider: string | undefined,
): boolean {
  if (provider !== 'claude_code') return false;
  return isSessionLive || status === 'waiting_approval';
}

/**
 * 失败回合定位(case B:消息已送达、agent 报错没回出来)。
 *
 * 返回 transcript 最后一条 user 消息的 id —— 当且仅当会话停在一条**没有后续
 * assistant 回复**的 user 消息上(即最后一条是 user)。这种情况意味着这一轮没收到
 * 回复,可在该消息旁挂「重试」入口,用同内容重开一轮(服务端 claimAiSessionForRun
 * 会把 error 翻回 running)。
 *
 * 最后一条是 assistant(已回复)/ system(事件行)/ 空 → undefined(无失败回合可重试)。
 *
 * 用 display transcript(buildDisplayTranscript 输出):空 prose 的 assistant 锚点
 * 会被 buildDisplayTranscript 丢弃,所以网关 502 这类无回复的失败,最后一条就是
 * 那条 user 消息。
 */
export function lastUnrepliedUserMessageId(
  transcript: ReadonlyArray<{ id: string; role: string }>,
): string | undefined {
  if (transcript.length === 0) return undefined;
  const last = transcript[transcript.length - 1];
  if (last.role !== 'user') return undefined;
  return last.id;
}
