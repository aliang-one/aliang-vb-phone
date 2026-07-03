import type { VibeStatus } from '../data/platformModels';

/**
 * L1 — 顶部「整体状态」相位。
 *
 * 判定优先级:
 *  1. `failed`  → 失败(真终态)
 *  2. `isLive` → `running`(进行中)。`isLive` 由调用方传入 = `isSessionTurnActive(status)`
 *     = `status === 'running'`(事件驱动,见 isSessionTurnActive)。status 在静默期
 *     (subagent / 长 bash / API 重试——无 ai.delta 流动的窗口)由 `ai.run.progress` 心跳
 *     维持 running,故顶部不会在长任务中途误闪已完成。
 *  3. `completed` → 已完成(会话真关闭;即使有陈旧 pending approval 也优先展示完成)。
 *  4. 有 pending approval → 待审批(需用户动作)。
 *  5. 否则(status 非 running、无待审批、非真结束)→ 已完成(回合 settle:agent 答完、球回到
 *     用户,会话仍可继续)。status 是事件驱动的:idle 由**服务端 10s soft-settle 广播**
 *     (ai.session.updated 带更新的 lastActivityMs → mergeVibeRunSnapshot 降级)/ ai.status halt
 *     / interrupt / ai.error 落定。**`ai.done` 本身不再翻 idle**(对齐服务端 soft-settle:生产
 *     agent 一次 run 常发多个 ai.done,每条流式回合结束一个;立即翻 idle 会让多工具回合的工具
 *     间隙误闪「已完成」)。到达此处即回合真结束,不靠活动新鲜度猜测。
 *
 * 与 L2/L3 的区分:`LIVE_TURN_WINDOW_MS`(8s)只用于定位「当前正在流式的助手气泡」
 * (liveAssistantMessageId / 底部脉冲),不参与 L1 相位——L1 只认事件驱动的 status。
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
  // No life signs (status not running) + nothing pending + not failed/closed ⇒
  // the turn settled (agent answered, ball back with the user). Show 已完成.
  // status is event-driven — ai.run.started / ai.run.progress keep it running
  // through quiet gaps, ai.done / ai.status(halt) end it — so reaching here means
  // the turn genuinely ended; no 8s activity-window guess involved.
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
 *  - 开始:发送(`appendAgentMessage`)乐观置 running;`ai.run.started` 显式置 running;
 *    `ai.run.progress`(subagent / 长 bash / API 重试等静默期的心跳)维持 / 恢复 running;
 *    `ai.delta` 每次 flush 也强制 running(token 在流 = 一定在干活)。
 *  - 结束:**服务端 10s soft-settle 广播** idle(生产 agent 一次 run 常发多个 ai.done,每条
 *    流式回合结束一个,故 idle 不能靠 ai.done 即时落定——见 controlCenterStore 的 ai.done 处理)、
 *    `ai.error` 翻 failed、中断(`interruptAgentSession`)/ ai.status halt 翻 idle。
 * 配合 `mergeVibeRunSnapshot` 的双向 stale 守卫(既不让陈旧快照把 running 误降级,也不让
 * 陈旧快照把已结算的会话误重新激活),status 在回合内稳定为 running、真正静止后(服务端
 * settle 广播)落定为 idle。
 *
 * 故既不抖(回合内 API 请求/工具调用空档不再被误判成完成),单回合真正结束后顶部相位/composer
 * 锁/停止按钮也一致地滞后 ~10s 才翻已完成(与服务端 soft-settle 同步,可接受)——这是对齐服务端
 * 语义的代价,换来多工具回合的工具间隙不再误闪「已完成」(即「明明运行中却显示已完成」根因修复)。
 *
 * `waiting_approval` 不算「在跑」(回合卡在审批上,球在用户侧)——各消费方按需 `|| waiting_approval`
 * 单独处理(见 `shouldLockComposerForProvider` / `canInterruptTurn` / `appendAgentMessage` guard)。
 * 终态 failed/completed/idle 自然不在跑。
 */
export function isSessionTurnActive(status: VibeStatus): boolean {
  return status === 'running';
}

/**
 * Composer 是否因 provider 并发而锁定(Claude Code / OpenCode 是单进程 CLI,跑回合时不能并发收新消息)。
 *
 * **关键**:用「生命迹象」(isSessionLive)而不是裸 `session.status` 判活。回合答完后
 * status 常停在陈旧的 `'running'`(settle 推送丢失 / `mergeVibeRunSnapshot` 的
 * staleDemotion 守卫卡住 running→idle),裸读 status 会让 composer 在顶部已显「已完成」时
 * 仍锁「Claude Code 正在运行」——与 L1 相位脱节。`isSessionLive` 与 `deriveSessionPhase`
 * 同源(8s 活动窗口 + active 思考/命令),保证顶部相位与底部 composer 锁对「是否在干活」
 * 的判定一致:顶部说「已完成」(无生命迹象)时,composer 也必须解锁。
 *
 * `waiting_approval` 仍锁:那是单进程 CLI 卡在权限请求上(服务端主动推送的可靠状态),
 * 与 settle 的陈旧 running 无关,沿用旧行为不放开。`failed`/`completed`/`idle`(非 live、
 * 非待审批)→ 不锁。
 *
 * 非单进程 provider(如 codex,支持排队并发收消息)→ 永不锁。
 */
export function shouldLockComposerForProvider(
  isSessionLive: boolean,
  status: VibeStatus | undefined,
  provider: string | undefined,
): boolean {
  if (provider !== 'claude_code' && provider !== 'opencode') return false;
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
