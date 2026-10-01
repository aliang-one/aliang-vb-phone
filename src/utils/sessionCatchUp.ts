/**
 * sessionCatchUp — 会话消息水位与增量锚点(服务端 transcript_count 对账)。
 *
 * 背景:重进聊天屏的"是否落后"判断此前只有时间启发式
 * (isSessionSnapshotStale:离开多久/活动多旧),从不问"服务端是不是比
 * 我多消息"。服务端在列表快照、详情快照、ai.session.updated 三条路上都带
 * 权威 transcript_count;这里把它变成可消费的水位信号:
 *
 *   behind = serverCount > 本地已物化的服务端消息数
 *
 * 配套锚点 = 本地尾部最后一条 server 确认消息 id,喂给 messages 端点的
 * after 游标,只拉缺的段(全量合并语义见 mergeAgentMessages,锚点失效时
 * 服务端降级返回尾窗,id 并集合并等价全量刷新,不会丢数据)。
 *
 * Pure / deterministic — 无 store、无时钟依赖,便于单测。
 */
import type { AgentMessage, VibeCodingRun } from '../data/platformModels';

/**
 * 客户端自造消息 id:store 的 createId('msg') 形如 `msg-<Date.now()>-<rand>`
 * (连字符 + 毫秒时间戳);服务端流式入库是 `msg_<nanoid>`(下划线),扫描
 * 历史是 `import_<sha1>`。用形态区分,不靠 role/content 猜。
 */
export function isClientGeneratedMessageId(id: string): boolean {
  return /^msg-\d+-/.test(id);
}

const isServerConfirmedMessage = (message: AgentMessage): boolean =>
  !message.pending &&
  !message.failed &&
  !isClientGeneratedMessageId(message.id);

/**
 * 本地已物化的服务端消息数。取两个口径的较大者:
 *  - confirmed 条数(排除 pending/failed/客户端 id);
 *  - 确认消息里的最大 index+1(热窗截断后,旧消息虽被裁掉但已被覆盖过,
 *    index 不虚报落后)。
 * 流式期间 delta 逐条物化、服务端逐条入库计数,两侧同向增长;快照计数
 * 领先物化的瞬间由 in-flight 去重 + 冷却兜住(见 useSessionCatchUp)。
 */
export function materializedServerMessageCount(run: VibeCodingRun): number {
  let confirmed = 0;
  let maxIndexEnd = 0;
  for (const message of run.transcript) {
    if (!isServerConfirmedMessage(message)) continue;
    confirmed += 1;
    if (typeof message.index === 'number' && message.index + 1 > maxIndexEnd) {
      maxIndexEnd = message.index + 1;
    }
  }
  return Math.max(confirmed, maxIndexEnd);
}

/** 服务端消息总数是否领先本地物化数(只看严格领先;回缩不算落后)。 */
export function isSessionBehindTranscript(
  run: VibeCodingRun,
  serverCount: number,
): boolean {
  if (!Number.isFinite(serverCount) || serverCount <= 0) return false;
  return serverCount > materializedServerMessageCount(run);
}

/**
 * 增量拉取锚点:本地尾部最后一条 server 确认消息的 id。pending/failed/
 * 客户端 id 没有服务端对应行,必须跳过;全部不可用时返回 undefined,
 * 调用方降级走全量 detail 拉取。
 */
export function latestServerConfirmedMessageId(
  run: VibeCodingRun,
): string | undefined {
  for (let i = run.transcript.length - 1; i >= 0; i -= 1) {
    const message = run.transcript[i];
    if (isServerConfirmedMessage(message)) return message.id;
  }
  return undefined;
}
