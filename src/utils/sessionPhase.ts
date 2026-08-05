import type { VibeCodingRun, VibeStatus } from '../data/platformModels';
import i18n from '../i18n';

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

/**
 * 列表/卡片显示相位。与详情页顶部 `sessionPhase`(**VibeCodingSessionScreen**)
 * 同源(优先级一致),保证「外层 vibecoding 列表卡片」与「里层对话详情头」永远
 * 不再冲突 —— 即修用户报告的「审批中列表显 done / 已完成却显进行中」显示脱节。
 *
 * 优先级:
 *   1. `failed` 终态 → 失败(最优先,压过一切)
 *   2. `status === 'running'` → 进行中(乐观/即时:用户刚发送时 store 先把 status
 *      置 running,服务端 phase 尚未跟上;认 status 才有即时「进行中」反馈,与详情头一致)
 *   3. 服务端权威 `phase` → 直接采用
 *   4. 否则 → `deriveSessionPhase(status, false, false)` 兜底(老服务器无 phase)
 *
 * 第 3 步是修「审批中显 done」的关键:审批期间裸 `status` 是 idle/closed(settle 了,
 * `mapSessionStatus` 把 closed 映射成 completed → 列表显 DONE),但服务端 `phase` 仍
 * 是 `waiting_approval`(服务端 `derivePhase` 把 hasPendingApproval 排在 running/
 * closed 之前)。卡片无视 phase 直读 status 就显 done;认 phase 即显待审批。
 *
 * 注意:本函数修不了「快照陈旧」—— 若回合真已结束但手机快照仍报 `status='running'`
 * (settle 推送丢失 / 列表未刷新),第 2 步会让它显进行中。那是**刷新缺口**(列表回不到
 * 服务端拉新快照),不是显示规则 bug;详见 vibecoding-stale-snapshot-focus-refresh。
 *
 * 【lifecycle 收敛纪律 — 2026-08-05 审计】这是 lifecycle 推导的 canonical 入口;主
 * 显示消费点(VibeCodingSessionScreen.sessionPhase、VibeSessionCard、
 * stableSessionSortMs、compareSessionsByStableActivity)已统一经此求值。**别再把下列
 * 裸 status/runState 读点强行收敛到这里**——它们是经过审计的合法更具体判定,强转会改行为:
 *  - `sessionApprovalFallback.isTerminalSession`:保守终态判定(idle+无 phase → 非终态,
 *    保留审批 fallback),与本函数默认 completed 不同。
 *  - `aiSessionSlice` 的 `waitingApproval`:`status/runState === 'waiting_approval'` 的
 *    单值检查;本函数非 v2 会把该 status 兜底成 completed,不等价。
 *  - `controlCenterStore`/`internals`/`approvalSlice` 的 `runStateVersion !== undefined`:
 *    版本权威(merge 信任)判定,非相位推导。
 *  - `AgentSessionsScreen` 的 StatusChip 用裸 status(vibeStatusLabel):故意的粒度保留
 *    (TESTING/PREVIEW/PAUSED),与本函数 4 相位不同抽象层。
 */
export function runDisplayPhase(
  status: VibeStatus,
  phase: SessionPhase | undefined,
  runStateVersion?: number,
  runState?: VibeCodingRun['runState'],
): SessionPhase {
  if (runStateVersion !== undefined) {
    if (runState === 'failed' || runState === 'timed_out') return 'failed';
    if (runState === 'completed' || runState === 'cancelled') return 'completed';
    if (runState === 'waiting_approval') return 'waiting_approval';
    if (
      runState === 'queued' ||
      runState === 'running' ||
      runState === 'cancelling'
    ) {
      return 'running';
    }
    if (phase) return phase;
  }
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (phase) return phase;
  return deriveSessionPhase(status, false, false);
}

export function isAuthoritativeRunLive(
  runStateVersion: number | undefined,
  runState: VibeCodingRun['runState'],
  legacyStatus: VibeStatus,
): boolean {
  if (runStateVersion === undefined) return isSessionTurnActive(legacyStatus);
  return (
    runState === 'queued' ||
    runState === 'running' ||
    runState === 'cancelling'
  );
}

/**
 * Return a sort timestamp that does not move on liveness-only heartbeats.
 * Concurrent runs otherwise swap positions whenever their staggered
 * `ai.run.progress` events refresh `lastActivityMs`.
 */
export function stableSessionSortMs(run: VibeCodingRun): number {
  const displayPhase = runDisplayPhase(
    run.status,
    run.phase,
    run.runStateVersion,
    run.runState,
  );
  const liveOrWaiting =
    displayPhase === 'running' || displayPhase === 'waiting_approval';
  if (liveOrWaiting) {
    const turnStartedAt = Date.parse(
      run.lastUserMessage?.timestamp ?? run.lastMessage?.timestamp ?? '',
    );
    if (Number.isFinite(turnStartedAt)) return turnStartedAt;
  }
  return run.lastActivityMs ?? 0;
}

/** Active/waiting sessions first, then stable newest-first ordering. */
export function compareSessionsByStableActivity(
  left: VibeCodingRun,
  right: VibeCodingRun,
): number {
  const leftPhase = runDisplayPhase(
    left.status,
    left.phase,
    left.runStateVersion,
    left.runState,
  );
  const rightPhase = runDisplayPhase(
    right.status,
    right.phase,
    right.runStateVersion,
    right.runState,
  );
  const leftActive =
    leftPhase === 'running' || leftPhase === 'waiting_approval';
  const rightActive =
    rightPhase === 'running' || rightPhase === 'waiting_approval';
  if (leftActive !== rightActive) return leftActive ? -1 : 1;
  return stableSessionSortMs(right) - stableSessionSortMs(left);
}

/**
 * 相位 → 显示文案。util 单例 i18n(非组件),运行时求值 → 切语言即时刷新,与
 * backgroundNotifications / activitySummary 同模式(文案见 vibecoding/<lng>.json
 * 的 phaseLabel 节点)。卡片 VibeSessionCard 与会话详情头 VibeCodingSessionScreen
 * 共用,保持简短状态措辞 —— 不复用 session.phase.*(那是描述句:"本轮完成 / 会话失败"),
 * 避免改卡片 StatusChip 的语义。
 */
export const phaseLabel = (phase: SessionPhase): string =>
  i18n.t(`vibecoding:phaseLabel.${phase}`);

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
 * 相位 → 强调色(列表/卡片全局着色源)。蓝=进行中(同默认色,靠呼吸动效区分)/完成(默认)、
 * 黄=待批准、红=失败。VibeSessionCard 消费它驱动 轨道/图标/标签/光晕,跨所有会话卡片统一编码。
 * 接受 theme.colors 以取本主题 success/warning/primary/error 真值(暗/亮自适应)。
 *
 * 进行中不再用绿(success)。全仓 success(绿)语义 = 完成/就绪/在线(见 terminalInteraction
 * 的 READY/DONE、EventStream 的 done、NotificationCenter 的 completed),running 借绿与之
 * 冲突(运行中 ≠ 完成)。故 running 回归 primary(蓝),与 completed 同色;二者区分交给
 * 「呼吸动效(仅 running,VibeSessionCard 内 Animated 透明度脉冲)+ StatusChip 文案
 * (进行中/已完成)」——符合「颜色不能是唯一指示」的无障碍原则。success 字段保留以兼容
 * theme.colors 形状,不再被任何相位使用。
 */
export function phaseAccentColor(
  phase: SessionPhase,
  colors: { success: string; warning: string; primary: string; error: string },
): string {
  switch (phase) {
    case 'running':
      return colors.primary;
    case 'waiting_approval':
      return colors.warning;
    case 'failed':
      return colors.error;
    case 'completed':
    default:
      return colors.primary;
  }
}

/**
 * 相位 → GlassPanel 光晕键(仅暗色生效)。进行中给蓝辉光(同默认色,辅以呼吸动效)、
 * 待批准给黄辉光强调待办;失败给红;完成不给光晕(默认态无需强调)。
 */
export function phaseGlow(
  phase: SessionPhase,
): 'success' | 'warning' | 'primary' | 'error' | 'none' {
  switch (phase) {
    case 'running':
      return 'primary';
    case 'waiting_approval':
      return 'warning';
    case 'failed':
      return 'error';
    case 'completed':
    default:
      return 'none';
  }
}

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
